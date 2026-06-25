import type { Context } from "telegraf";
import { ownerChatId } from "../../config.js";
import { supabase } from "../../db/supabase.js";
import { resolveChannel } from "../../services/youtube.js";
import { pollChannel } from "../../services/rss.js";
import { categories, type Category, type Channel, type Video } from "../../types/index.js";
import { processVideo } from "../../scheduler/cron.js";

export async function addChannelCommand(ctx: Context) {
  if (!ownerChatId || String(ctx.chat?.id) !== ownerChatId) return;

  const text = (ctx.message && "text" in ctx.message ? ctx.message.text : "") ?? "";
  const args = text.replace(/^\/add_channel\s*/, "").trim().split(/\s+/);
  const url = args[0];
  const categoryArg = args[1] as Category | undefined;

  if (!url) {
    await ctx.reply("Usage: /add_channel <youtube_url> [category]\n\nCategories: investing, psychology, podcast_interview, seo_marketing, tech_ai_startup");
    return;
  }

  await ctx.reply("🔍 Resolving channel...");

  const channelInfo = await resolveChannel(url);
  if (!channelInfo) {
    await ctx.reply("❌ Could not resolve YouTube channel from that URL. Try a direct channel link or @handle URL.");
    return;
  }

  const category = categoryArg && categories.includes(categoryArg) ? categoryArg : null;
  const rssFeedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelInfo.channelId}`;

  // Upsert channel
  const { data: existing } = await supabase
    .from("channels")
    .select("id, active")
    .eq("youtube_channel_id", channelInfo.channelId)
    .single();

  if (existing) {
    await supabase
      .from("channels")
      .update({
        active: true,
        name: channelInfo.name,
        default_category: category,
        rss_feed_url: rssFeedUrl,
      })
      .eq("id", existing.id);

    await ctx.reply(`✅ Re-activated "${channelInfo.name}"${category ? ` (${category})` : ""}`);
  } else {
    const { error } = await supabase.from("channels").insert({
      youtube_channel_id: channelInfo.channelId,
      name: channelInfo.name,
      thumbnail_url: channelInfo.thumbnailUrl,
      rss_feed_url: rssFeedUrl,
      active: true,
      default_category: category,
    });

    if (error) {
      await ctx.reply("❌ Failed to save channel. Try again.");
      return;
    }

    await ctx.reply(`✅ Now tracking "${channelInfo.name}"${category ? ` (${category})` : ""}`);
  }

  // Backfill recent videos
  const { data: channelRow } = await supabase
    .from("channels")
    .select("*")
    .eq("youtube_channel_id", channelInfo.channelId)
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
            thumbnail_url: video.thumbnailUrl,
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
            // logged internally
          }
        }
      }

      await ctx.reply("✅ Done! Summaries sent above.");
    }
  }
}
