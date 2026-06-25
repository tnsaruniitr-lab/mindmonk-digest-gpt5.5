import { Markup, type Context } from "telegraf";
import { ownerChatId } from "../../config.js";
import { supabase } from "../../db/supabase.js";
import {
  isYoutubeUrl,
  extractVideoId,
  extractChannelInfo,
} from "../../utils/youtube-url.js";
import { resolveChannel, searchChannels, getVideoMetadata } from "../../services/youtube.js";
import { pollChannel } from "../../services/rss.js";
import { processVideo } from "../../scheduler/cron.js";
import { categories, type Category, type Channel, type Video } from "../../types/index.js";
import { log } from "../../utils/logger.js";

/**
 * Smart text handler:
 * - YouTube video URL → auto-digest
 * - YouTube channel URL → auto-add with category picker
 * - Plain text → search YouTube channels and show results as buttons
 */
export async function urlDetectHandler(ctx: Context) {
  if (!ownerChatId || String(ctx.chat?.id) !== ownerChatId) return;

  const text =
    (ctx.message && "text" in ctx.message ? ctx.message.text : "") ?? "";

  // Skip commands
  if (text.startsWith("/")) return;

  // --- Case 1: YouTube video URL → auto-digest ---
  const videoId = extractVideoId(text);
  if (videoId) {
    await handleVideoUrl(ctx, videoId);
    return;
  }

  // --- Case 2: YouTube channel URL → auto-add ---
  if (isYoutubeUrl(text)) {
    const urlMatch = text.match(/https?:\/\/[^\s]+/);
    if (urlMatch && extractChannelInfo(urlMatch[0])) {
      await handleChannelUrl(ctx, urlMatch[0]);
      return;
    }
  }

  // --- Case 3: Plain text → search for channels ---
  const query = text.trim();
  if (query.length < 2 || query.length > 100) return;

  // Only trigger search if it looks like a channel name / search query
  // Skip obvious non-search messages
  if (/^(hey|hi|hello|thanks|ok|yes|no|sure)\b/i.test(query)) return;

  await handleSearch(ctx, query);
}

async function handleVideoUrl(ctx: Context, videoId: string): Promise<void> {
  // Check if already processed
  const { data: existing } = await supabase
    .from("videos")
    .select("id, processed, title")
    .eq("youtube_video_id", videoId)
    .single();

  if (existing?.processed) {
    await ctx.reply(`Already digested "${existing.title}". Use /reprocess to redo.`);
    return;
  }

  const meta = await getVideoMetadata(videoId);
  const title = meta?.title ?? "Unknown video";

  await ctx.reply(`⏳ Digesting "${title}"...`);

  let video: Video;
  if (existing) {
    const { data } = await supabase.from("videos").select("*").eq("id", existing.id).single();
    video = data as Video;
  } else {
    const { data, error } = await supabase
      .from("videos")
      .insert({
        youtube_video_id: videoId,
        title,
        thumbnail_url: meta?.thumbnailUrl ?? null,
        processed: false,
        transcript_status: "pending",
      })
      .select()
      .single();

    if (error || !data) {
      await ctx.reply("❌ Failed to queue video.");
      return;
    }
    video = data as Video;
  }

  try {
    await processVideo(video);
    await ctx.reply("✅ Done!");
  } catch (err) {
    await ctx.reply(`❌ Processing failed: ${err}`);
  }
}

async function handleChannelUrl(ctx: Context, url: string): Promise<void> {
  await ctx.reply("🔍 Resolving channel...");

  const info = await resolveChannel(url);
  if (!info) {
    await ctx.reply("❌ Could not resolve that channel. Try searching by name instead.");
    return;
  }

  // Show category picker
  await ctx.reply(
    `Found: *${info.name}*\n\nPick a category:`,
    {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback("💰 Investing", `addch:${info.channelId}:investing`),
          Markup.button.callback("🧠 Psychology", `addch:${info.channelId}:psychology`),
        ],
        [
          Markup.button.callback("🎙️ Podcast", `addch:${info.channelId}:podcast_interview`),
          Markup.button.callback("📈 SEO/Marketing", `addch:${info.channelId}:seo_marketing`),
        ],
        [
          Markup.button.callback("🤖 Tech/AI", `addch:${info.channelId}:tech_ai_startup`),
          Markup.button.callback("🔄 Auto-detect", `addch:${info.channelId}:auto`),
        ],
      ]),
    }
  );
}

async function handleSearch(ctx: Context, query: string): Promise<void> {
  await ctx.reply(`🔍 Searching YouTube for "${query}"...`);

  const results = await searchChannels(query);

  if (!results.length) {
    await ctx.reply("No channels found. Try a different search term or paste a direct URL.");
    return;
  }

  const buttons = results.map((r) => [
    Markup.button.callback(
      `${r.name}${r.handle ? ` (${r.handle})` : ""}`,
      `pickch:${r.channelId}`
    ),
  ]);

  await ctx.reply("Select a channel to track:", Markup.inlineKeyboard(buttons));
}

/**
 * Handle callback when user picks a channel from search results.
 * Shows category picker.
 */
export async function pickChannelCallback(ctx: Context) {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;

  const channelId = ctx.callbackQuery.data.replace("pickch:", "");
  await ctx.answerCbQuery();

  // Show category picker for this channel
  await ctx.editMessageText("Pick a category:", {
    ...Markup.inlineKeyboard([
      [
        Markup.button.callback("💰 Investing", `addch:${channelId}:investing`),
        Markup.button.callback("🧠 Psychology", `addch:${channelId}:psychology`),
      ],
      [
        Markup.button.callback("🎙️ Podcast", `addch:${channelId}:podcast_interview`),
        Markup.button.callback("📈 SEO/Marketing", `addch:${channelId}:seo_marketing`),
      ],
      [
        Markup.button.callback("🤖 Tech/AI", `addch:${channelId}:tech_ai_startup`),
        Markup.button.callback("🔄 Auto-detect", `addch:${channelId}:auto`),
      ],
    ]),
  });
}

/**
 * Handle callback when user picks a category for a channel.
 * Actually adds the channel to tracking.
 */
export async function addChannelCallback(ctx: Context) {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;

  const parts = ctx.callbackQuery.data.replace("addch:", "").split(":");
  const channelId = parts[0];
  const categoryStr = parts[1];
  const category: Category | null =
    categoryStr === "auto" ? null : (categoryStr as Category);

  await ctx.answerCbQuery("Adding channel...");

  // Resolve channel name from RSS
  const rssFeedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
  let channelName = channelId;

  try {
    const { default: RssParser } = await import("rss-parser");
    const parser = new RssParser();
    const feed = await parser.parseURL(rssFeedUrl);
    channelName = feed.title ?? channelId;
  } catch {}

  // Upsert channel
  const { data: existing } = await supabase
    .from("channels")
    .select("id")
    .eq("youtube_channel_id", channelId)
    .single();

  if (existing) {
    await supabase
      .from("channels")
      .update({ active: true, name: channelName, default_category: category, rss_feed_url: rssFeedUrl })
      .eq("id", existing.id);
  } else {
    await supabase.from("channels").insert({
      youtube_channel_id: channelId,
      name: channelName,
      rss_feed_url: rssFeedUrl,
      active: true,
      default_category: category,
    });
  }

  const catLabel = category?.replace("_", " ") ?? "auto-detect";
  await ctx.editMessageText(`✅ Now tracking ${channelName} (${catLabel})`);

  // Backfill recent videos
  const { data: channelRow } = await supabase
    .from("channels")
    .select("*")
    .eq("youtube_channel_id", channelId)
    .single();

  if (channelRow) {
    const videos = await pollChannel(channelRow as Channel);
    const newVideoIds: string[] = [];

    for (const video of videos.slice(0, 1)) {
      const { data: existingVid } = await supabase
        .from("videos")
        .select("id")
        .eq("youtube_video_id", video.videoId)
        .single();

      if (!existingVid) {
        const { data: inserted } = await supabase
          .from("videos")
          .insert({
            channel_id: channelRow.id,
            youtube_video_id: video.videoId,
            title: video.title,
            published_at: video.publishedAt,
            processed: false,
            transcript_status: "pending",
          })
          .select("id")
          .single();

        if (inserted) newVideoIds.push(inserted.id);
      }
    }

    if (newVideoIds.length > 0) {
      await ctx.reply(`⏳ Digesting ${newVideoIds.length} latest video(s)...`);

      // Process immediately instead of waiting for cron
      for (const id of newVideoIds) {
        const { data: videoRow } = await supabase
          .from("videos")
          .select("*")
          .eq("id", id)
          .single();

        if (videoRow) {
          try {
            await processVideo(videoRow as Video);
          } catch (err) {
            log.error("addch", `Failed to process video ${id}`, err);
          }
        }
      }

      await ctx.reply("✅ Done! Summaries sent above.");
    }
  }
}
