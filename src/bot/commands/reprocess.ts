import type { Context } from "telegraf";
import { supabase } from "../../db/supabase.js";
import { extractVideoId } from "../../utils/youtube-url.js";
import { getOrCreateTelegramUser } from "../../services/users.js";
import { summarizeVideoById } from "./fetch.js";

export async function reprocessCommand(ctx: Context) {
  const user = await getOrCreateTelegramUser(ctx);
  if (!user || user.status === "blocked") return;

  const text = (ctx.message && "text" in ctx.message ? ctx.message.text : "") ?? "";
  const url = text.replace(/^\/reprocess\s*/, "").trim();

  if (!url) {
    await ctx.reply("Usage: /reprocess <youtube_video_url>");
    return;
  }

  const videoId = extractVideoId(url);
  if (!videoId) {
    await ctx.reply("❌ Could not extract video ID from that URL.");
    return;
  }

  const { data: video } = await supabase
    .from("videos")
    .select("*")
    .eq("youtube_video_id", videoId)
    .single();

  if (!video) {
    await ctx.reply("❌ Video not found in database. Use /digest to process it first.");
    return;
  }

  await ctx.reply(`♻️ Reprocessing your summary for "${video.title}"...`);

  await supabase
    .from("user_summaries")
    .delete()
    .eq("video_id", video.id)
    .eq("user_id", user.id);

  if (video.transcript_status === "unavailable") {
    await supabase
      .from("videos")
      .update({ processed: false, transcript_status: "pending" })
      .eq("id", video.id);
  }

  const { data: updatedVideo } = await supabase
    .from("videos")
    .select("*")
    .eq("id", video.id)
    .single();

  if (!updatedVideo) {
    await ctx.reply("❌ Could not reload the video for reprocessing.");
    return;
  }

  await summarizeVideoById(ctx, videoId, {}, user.id);
}
