import type { Context } from "telegraf";
import { ownerChatId } from "../../config.js";
import { supabase } from "../../db/supabase.js";
import { extractVideoId } from "../../utils/youtube-url.js";
import { getVideoMetadata } from "../../services/youtube.js";
import { processVideo } from "../../scheduler/cron.js";
import type { Video } from "../../types/index.js";

export async function digestCommand(ctx: Context) {
  if (!ownerChatId || String(ctx.chat?.id) !== ownerChatId) return;

  const text = (ctx.message && "text" in ctx.message ? ctx.message.text : "") ?? "";
  const url = text.replace(/^\/digest\s*/, "").trim();

  if (!url) {
    await ctx.reply("Usage: /digest <youtube_video_url>");
    return;
  }

  const videoId = extractVideoId(url);
  if (!videoId) {
    await ctx.reply("❌ Could not extract video ID from that URL.");
    return;
  }

  // Check if already processed
  const { data: existing } = await supabase
    .from("videos")
    .select("*, summaries(*)")
    .eq("youtube_video_id", videoId)
    .single();

  if (existing?.processed && existing.summaries) {
    await ctx.reply("This video has already been processed. Use /reprocess to re-summarize.");
    return;
  }

  // Get metadata
  const meta = await getVideoMetadata(videoId);
  const title = meta?.title ?? "Unknown video";

  await ctx.reply(`⏳ Processing "${title}"...`);

  // Insert video if not exists
  let video: Video;
  if (existing) {
    video = existing as Video;
  } else {
    // Try to find the channel — may not be tracked
    const { data: inserted, error } = await supabase
      .from("videos")
      .insert({
        channel_id: null as unknown as string, // May not have a tracked channel
        youtube_video_id: videoId,
        title,
        thumbnail_url: meta?.thumbnailUrl ?? null,
        processed: false,
        transcript_status: "pending",
      })
      .select()
      .single();

    if (error || !inserted) {
      await ctx.reply("❌ Failed to queue video for processing.");
      return;
    }
    video = inserted as Video;
  }

  // Process immediately
  try {
    await processVideo(video);
    await ctx.reply("✅ Done! Summary sent above.");
  } catch (err) {
    await ctx.reply(`❌ Processing failed: ${err}`);
  }
}
