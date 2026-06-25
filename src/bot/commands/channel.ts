import type { Context } from "telegraf";
import { ownerChatId } from "../../config.js";
import { supabase } from "../../db/supabase.js";
import { pollChannel } from "../../services/rss.js";
import { resolveChannel } from "../../services/youtube.js";
import type { Channel } from "../../types/index.js";
import { commandArg, summarizeVideoById } from "./fetch.js";

function isOwner(ctx: Context): boolean {
  return Boolean(ownerChatId && String(ctx.chat?.id) === ownerChatId);
}

async function getOrCreateChannel(url: string): Promise<Channel | null> {
  const channelInfo = await resolveChannel(url);
  if (!channelInfo) return null;

  const rssFeedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelInfo.channelId}`;
  const { data: existing } = await supabase
    .from("channels")
    .select("*")
    .eq("youtube_channel_id", channelInfo.channelId)
    .single();

  if (existing) {
    await supabase
      .from("channels")
      .update({
        name: channelInfo.name,
        thumbnail_url: channelInfo.thumbnailUrl,
        rss_feed_url: rssFeedUrl,
      })
      .eq("id", existing.id);

    const { data: refreshed } = await supabase
      .from("channels")
      .select("*")
      .eq("id", existing.id)
      .single();

    return (refreshed as Channel | null) ?? (existing as Channel);
  }

  const { data: inserted } = await supabase
    .from("channels")
    .insert({
      youtube_channel_id: channelInfo.channelId,
      name: channelInfo.name,
      thumbnail_url: channelInfo.thumbnailUrl,
      rss_feed_url: rssFeedUrl,
      active: false,
      default_category: null,
    })
    .select()
    .single();

  return (inserted as Channel | null) ?? null;
}

export async function channelCommand(ctx: Context): Promise<void> {
  if (!isOwner(ctx)) return;

  const url = commandArg(ctx, "channel");
  if (!url) {
    await ctx.reply("Usage: /channel <youtube_channel_url>");
    return;
  }

  await ctx.reply("🔍 Resolving channel and checking latest upload...");

  const channel = await getOrCreateChannel(url);
  if (!channel) {
    await ctx.reply("❌ Could not resolve that YouTube channel. Try a /channel URL or @handle URL.");
    return;
  }

  const videos = await pollChannel(channel);
  const latest = videos[0];

  if (!latest) {
    await ctx.reply(`⚠️ I could not find any recent videos for "${channel.name}".`);
    return;
  }

  await ctx.reply(`Latest from "${channel.name}": "${latest.title}"`);
  await summarizeVideoById(ctx, latest.videoId, {
    channelId: channel.id,
    title: latest.title,
    publishedAt: latest.publishedAt,
    thumbnailUrl: latest.thumbnailUrl,
  });
}
