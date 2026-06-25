import type { Context } from "telegraf";
import { supabase } from "../../db/supabase.js";
import { pollChannel } from "../../services/rss.js";
import { subscribeUserToChannel, upsertChannel } from "../../services/subscriptions.js";
import { getOrCreateTelegramUser } from "../../services/users.js";
import { resolveChannel } from "../../services/youtube.js";
import type { Channel } from "../../types/index.js";
import { commandArg, summarizeVideoById } from "./fetch.js";

async function getOrCreateChannel(url: string): Promise<Channel | null> {
  const channelInfo = await resolveChannel(url);
  if (!channelInfo) return null;

  const rssFeedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelInfo.channelId}`;
  return upsertChannel({
    youtubeChannelId: channelInfo.channelId,
    name: channelInfo.name,
    thumbnailUrl: channelInfo.thumbnailUrl,
    rssFeedUrl,
    active: true,
  });
}

export async function channelCommand(ctx: Context): Promise<void> {
  const user = await getOrCreateTelegramUser(ctx);
  if (!user || user.status === "blocked") return;

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

  await subscribeUserToChannel(user.id, channel.id, null);

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
  }, user.id);
}
