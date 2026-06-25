import type { Context } from "telegraf";
import { supabase } from "../../db/supabase.js";
import { formatSummary } from "../formatter.js";
import { processVideo } from "../../scheduler/cron.js";
import { getOutputFormat } from "../../services/preferences.js";
import { getOrCreateTelegramUser } from "../../services/users.js";
import { getVideoMetadata } from "../../services/youtube.js";
import { extractVideoId } from "../../utils/youtube-url.js";
import type { Summary, Video } from "../../types/index.js";

interface VideoSeed {
  channelId?: string | null;
  title?: string | null;
  publishedAt?: string | null;
  thumbnailUrl?: string | null;
}

export function commandArg(ctx: Context, command: string): string {
  const text = (ctx.message && "text" in ctx.message ? ctx.message.text : "") ?? "";
  return text.replace(new RegExp(`^/${command}(?:@\\w+)?\\s*`, "i"), "").trim();
}

async function getChannelName(video: Video): Promise<string> {
  if (!video.channel_id) return "Unknown";

  const { data: channel } = await supabase
    .from("channels")
    .select("name")
    .eq("id", video.channel_id)
    .single();

  return channel?.name ?? "Unknown";
}

async function sendSummaryToChat(
  ctx: Context,
  video: Video,
  summary: Summary,
  channelName: string,
  userId?: string | null
): Promise<void> {
  const outputFormat = await getOutputFormat(userId);
  const messages = formatSummary(video, summary, channelName, undefined, outputFormat);

  for (const msg of messages) {
    const options = msg.parseMode ? { parse_mode: msg.parseMode } : undefined;
    await ctx.reply(msg.text, options);
  }
}

async function loadSummary(videoId: string): Promise<Summary | null> {
  const { data } = await supabase
    .from("summaries")
    .select("*")
    .eq("video_id", videoId)
    .single();

  return (data as Summary | null) ?? null;
}

async function upsertVideo(videoId: string, seed: VideoSeed): Promise<Video | null> {
  const { data: existing } = await supabase
    .from("videos")
    .select("*")
    .eq("youtube_video_id", videoId)
    .single();

  if (existing) return existing as Video;

  const meta = seed.title ? null : await getVideoMetadata(videoId);
  const title = seed.title ?? meta?.title ?? "Unknown video";

  const { data: inserted } = await supabase
    .from("videos")
    .insert({
      channel_id: seed.channelId ?? null,
      youtube_video_id: videoId,
      title,
      published_at: seed.publishedAt ?? null,
      thumbnail_url: seed.thumbnailUrl ?? meta?.thumbnailUrl ?? null,
      processed: false,
      transcript_status: "pending",
    })
    .select()
    .single();

  return (inserted as Video | null) ?? null;
}

export async function summarizeVideoById(
  ctx: Context,
  videoId: string,
  seed: VideoSeed = {},
  userId?: string | null
): Promise<void> {
  const video = await upsertVideo(videoId, seed);
  if (!video) {
    await ctx.reply("❌ Failed to queue video for processing.");
    return;
  }

  if (video.processed) {
    const summary = await loadSummary(video.id);
    if (summary) {
      await ctx.reply(`✅ Found cached summary for "${video.title}".`);
      await sendSummaryToChat(ctx, video, summary, await getChannelName(video), userId);
      return;
    }

    if (video.transcript_status === "unavailable") {
      await ctx.reply(`♻️ I previously could not find captions for "${video.title}". Checking again now...`);
    } else {
      await ctx.reply(`♻️ "${video.title}" was marked processed, but the summary is missing. Reprocessing now...`);
    }
  } else {
    await ctx.reply(`⏳ Processing "${video.title}"...`);
  }

  const result = await processVideo(video, {
    deliver: false,
    notifyOnFailure: false,
    userId,
  });

  if (result.status === "no_transcript") {
    await ctx.reply(`⚠️ No captions available for "${video.title}".`);
    return;
  }

  if (result.status === "summary_failed") {
    await ctx.reply(`❌ Failed to summarize "${video.title}".`);
    return;
  }

  const summary = result.summary ?? (await loadSummary(video.id));
  if (!summary) {
    await ctx.reply(`❌ Summary was generated, but I could not load it for "${video.title}".`);
    return;
  }

  await sendSummaryToChat(ctx, video, summary, result.channelName, userId);
  await ctx.reply("✅ Done.");
}

export async function summarizeVideoFromUrl(
  ctx: Context,
  url: string,
  userId?: string | null
): Promise<void> {
  const videoId = extractVideoId(url);
  if (!videoId) {
    await ctx.reply("❌ Could not extract a YouTube video ID from that URL.");
    return;
  }

  await summarizeVideoById(ctx, videoId, {}, userId);
}

export async function fetchCommand(ctx: Context): Promise<void> {
  const user = await getOrCreateTelegramUser(ctx);
  if (!user || user.status === "blocked") return;

  const url = commandArg(ctx, "fetch");
  if (!url) {
    await ctx.reply("Usage: /fetch <youtube_video_url>");
    return;
  }

  await summarizeVideoFromUrl(ctx, url, user.id);
}
