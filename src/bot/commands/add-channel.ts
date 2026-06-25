import type { Context } from "telegraf";
import { resolveChannel } from "../../services/youtube.js";
import { pollChannel } from "../../services/rss.js";
import { subscribeUserToChannel, upsertChannel } from "../../services/subscriptions.js";
import { getOrCreateTelegramUser } from "../../services/users.js";
import { categories, type Category, type Channel } from "../../types/index.js";
import { summarizeVideoById } from "./fetch.js";

export async function addChannelCommand(ctx: Context) {
  const user = await getOrCreateTelegramUser(ctx);
  if (!user || user.status === "blocked") return;

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

  const channel = await upsertChannel({
    youtubeChannelId: channelInfo.channelId,
    name: channelInfo.name,
    thumbnailUrl: channelInfo.thumbnailUrl,
    rssFeedUrl,
    defaultCategory: category,
    active: true,
  });

  if (!channel) {
    await ctx.reply("❌ Failed to save channel. Try again.");
    return;
  }

  const subscribed = await subscribeUserToChannel(user.id, channel.id, category);
  if (!subscribed) {
    await ctx.reply("❌ Failed to subscribe you to that channel. Try again.");
    return;
  }

  await ctx.reply(`✅ Now tracking "${channelInfo.name}" for you${category ? ` (${category})` : ""}`);

  // Backfill recent videos
  const videos = await pollChannel(channel as Channel);
  const latest = videos[0];

  if (latest) {
    await ctx.reply(`⏳ Digesting latest video: "${latest.title}"`);
    await summarizeVideoById(ctx, latest.videoId, {
      channelId: channel.id,
      title: latest.title,
      publishedAt: latest.publishedAt,
      thumbnailUrl: latest.thumbnailUrl,
    }, user.id);
  }
}
