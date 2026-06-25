import { Markup, type Context } from "telegraf";
import { classifyIntent } from "../../services/intent-router.js";
import {
  searchBrain,
  searchSummaries,
  getStats,
  getMyContext,
  generateChatResponse,
} from "../../services/brain-search.js";
import {
  isYoutubeUrl,
  extractVideoId,
  extractChannelInfo,
} from "../../utils/youtube-url.js";
import {
  resolveChannel,
  searchChannels,
} from "../../services/youtube.js";
import { listUserChannels, removeUserChannelsByName } from "../../services/subscriptions.js";
import { setContextEntry } from "../../services/preferences.js";
import { getOrCreateTelegramUser } from "../../services/users.js";
import { summarizeVideoById } from "../commands/fetch.js";
import { log } from "../../utils/logger.js";

/**
 * Smart text handler — uses Claude to classify intent, then routes to the right action.
 */
export async function smartHandler(ctx: Context) {
  const text =
    (ctx.message && "text" in ctx.message ? ctx.message.text : "") ?? "";

  // Skip commands — let Telegraf handle those
  if (text.startsWith("/")) return;
  if (!text.trim()) return;

  const user = await getOrCreateTelegramUser(ctx);
  if (!user || user.status === "blocked") return;

  log.info("handler", `Text received: ${text.slice(0, 80)}`);

  // Fast path: if it's clearly a YouTube URL, skip the Claude call
  const videoId = extractVideoId(text);
  if (videoId) {
    await handleDigestVideo(ctx, videoId, user.id);
    return;
  }

  if (isYoutubeUrl(text)) {
    const urlMatch = text.match(/https?:\/\/[^\s]+/);
    if (urlMatch && extractChannelInfo(urlMatch[0])) {
      await handleChannelUrl(ctx, urlMatch[0]);
      return;
    }

    await ctx.reply(
      "I saw a YouTube URL, but I could not recognize it as a video or channel link. Try a standard youtube.com/watch, youtu.be, shorts, live, /channel, or /@handle URL."
    );
    return;
  }

  // Use Claude to classify intent
  const intent = await classifyIntent(text);

  switch (intent.action) {
    case "add_channel":
      if (intent.url) {
        await handleChannelUrl(ctx, intent.url);
      } else if (intent.query) {
        await handleChannelSearch(ctx, intent.query, intent.category);
      } else {
        await ctx.reply("Which channel? Send a YouTube URL or type the channel name.");
      }
      break;

    case "digest_video":
      if (intent.url) {
        const vid = extractVideoId(intent.url);
        if (vid) {
          await handleDigestVideo(ctx, vid, user.id);
        } else {
          await ctx.reply("Couldn't extract a video ID from that URL.");
        }
      } else {
        await ctx.reply("Send me a YouTube video URL to digest.");
      }
      break;

    case "list_channels":
      await handleListChannels(ctx, user.id);
      break;

    case "remove_channel":
      if (intent.query) {
        await handleRemoveChannel(ctx, user.id, intent.query);
      } else {
        await ctx.reply("Which channel should I stop tracking? Give me the name.");
      }
      break;

    case "search_brain":
      if (intent.query) {
        const result = await searchBrain(intent.query);
        await ctx.reply(result);
      } else {
        await ctx.reply("What should I search for? Try: \"investing rules\" or \"mental models\" or \"what did I learn about scaling\"");
      }
      break;

    case "search_summaries":
      if (intent.query) {
        const result = await searchSummaries(intent.query, user.id);
        await ctx.reply(result);
      } else {
        await ctx.reply("What are you looking for in your summaries?");
      }
      break;

    case "stats":
      await ctx.reply(await getStats());
      break;

    case "help":
      await ctx.reply(await generateChatResponse(text));
      break;

    case "my_context":
        await ctx.reply(await getMyContext(user.id));
      break;

    case "set_context": {
      const label = intent.label;
      const contextText = intent.context_text;
      if (label && contextText) {
        const saved = await setContextEntry(user.id, label, contextText);
        await ctx.reply(
          saved
            ? `Saved context "${label}" — this will be used in your future summaries.`
            : "I could not save that context. Try again."
        );
      } else {
        await ctx.reply("Tell me what to save. Example: \"My context: I'm a SaaS founder focused on AI and SEO\"");
      }
      break;
    }

    case "general_chat":
      await ctx.reply(await generateChatResponse(text));
      break;

    default:
      await ctx.reply(await generateChatResponse(text));
      break;
  }
}

// --- Action handlers ---

async function handleDigestVideo(ctx: Context, videoId: string, userId: string): Promise<void> {
  await summarizeVideoById(ctx, videoId, {}, userId);
}

async function handleChannelUrl(ctx: Context, url: string): Promise<void> {
  await ctx.reply("🔍 Resolving channel...");

  const info = await resolveChannel(url);
  if (!info) {
    await ctx.reply("Could not resolve that channel. Try searching by name instead.");
    return;
  }

  await showCategoryPicker(ctx, info.channelId);
}

async function handleChannelSearch(ctx: Context, query: string, category: string | null): Promise<void> {
  await ctx.reply(`🔍 Searching for "${query}"...`);

  const results = await searchChannels(query);

  if (!results.length) {
    await ctx.reply("No channels found. Try a different name or paste a direct URL.");
    return;
  }

  // Build rich text description
  let msg = `Found ${results.length} channel(s):\n\n`;
  results.forEach((r, i) => {
    msg += `${i + 1}. ${r.name}`;
    if (r.handle) msg += ` (${r.handle})`;
    if (r.subscribers) msg += ` — ${r.subscribers}`;
    msg += "\n";
    if (r.description) {
      const desc = r.description.length > 80 ? r.description.slice(0, 80) + "..." : r.description;
      msg += `   ${desc}\n`;
    }
  });

  // Send description first, then buttons
  const buttons = results.map((r, i) => [
    Markup.button.callback(
      `${i + 1}. ${r.name}`,
      `pickch:${r.channelId}`
    ),
  ]);

  await ctx.reply(msg + "\nPick one:", Markup.inlineKeyboard(buttons));
}

async function showCategoryPicker(ctx: Context, channelId: string): Promise<void> {
  await ctx.reply(
    "Pick a category:",
    Markup.inlineKeyboard([
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
    ])
  );
}

async function handleListChannels(ctx: Context, userId: string): Promise<void> {
  const channels = await listUserChannels(userId);

  if (!channels.length) {
    await ctx.reply("No channels tracked yet. Send me a YouTube channel name or URL to get started.");
    return;
  }

  let msg = "📺 Tracked channels:\n\n";
  channels.forEach(({ channel, subscription }, i) => {
    const category = subscription.default_category ?? channel.default_category;
    const cat = category?.replace("_", " ") ?? "auto";
    msg += `${i + 1}. ${channel.name} (${cat})\n`;
  });

  await ctx.reply(msg);
}

async function handleRemoveChannel(ctx: Context, userId: string, name: string): Promise<void> {
  const removed = await removeUserChannelsByName(userId, name);

  if (!removed.length) {
    await ctx.reply(`No active channel matching "${name}".`);
    return;
  }

  const names = removed.join(", ");
  await ctx.reply(`Stopped tracking: ${names}`);
}
