import { Markup, type Context } from "telegraf";
import { ownerChatId } from "../../config.js";
import { supabase } from "../../db/supabase.js";
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
  getVideoMetadata,
} from "../../services/youtube.js";
import { pollChannel } from "../../services/rss.js";
import { processVideo } from "../../scheduler/cron.js";
import { categories, type Category, type Channel, type Video } from "../../types/index.js";
import { log } from "../../utils/logger.js";

/**
 * Smart text handler — uses Claude to classify intent, then routes to the right action.
 */
export async function smartHandler(ctx: Context) {
  if (!ownerChatId || String(ctx.chat?.id) !== ownerChatId) return;

  const text =
    (ctx.message && "text" in ctx.message ? ctx.message.text : "") ?? "";

  // Skip commands — let Telegraf handle those
  if (text.startsWith("/")) return;
  if (!text.trim()) return;

  // Fast path: if it's clearly a YouTube URL, skip the Claude call
  const videoId = extractVideoId(text);
  if (videoId) {
    await handleDigestVideo(ctx, videoId);
    return;
  }

  if (isYoutubeUrl(text)) {
    const urlMatch = text.match(/https?:\/\/[^\s]+/);
    if (urlMatch && extractChannelInfo(urlMatch[0])) {
      await handleChannelUrl(ctx, urlMatch[0]);
      return;
    }
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
          await handleDigestVideo(ctx, vid);
        } else {
          await ctx.reply("Couldn't extract a video ID from that URL.");
        }
      } else {
        await ctx.reply("Send me a YouTube video URL to digest.");
      }
      break;

    case "list_channels":
      await handleListChannels(ctx);
      break;

    case "remove_channel":
      if (intent.query) {
        await handleRemoveChannel(ctx, intent.query);
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
        const result = await searchSummaries(intent.query);
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
      await ctx.reply(await getMyContext());
      break;

    case "set_context": {
      const label = intent.label;
      const contextText = intent.context_text;
      if (label && contextText) {
        const { data: existing } = await supabase
          .from("user_context")
          .select("id")
          .eq("label", label)
          .single();

        if (existing) {
          await supabase
            .from("user_context")
            .update({ context: contextText, active: true })
            .eq("id", existing.id);
          await ctx.reply(`Updated context "${label}"`);
        } else {
          await supabase.from("user_context").insert({ label, context: contextText, active: true });
          await ctx.reply(`Saved context "${label}" — this will be used in all future summaries.`);
        }
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

async function handleDigestVideo(ctx: Context, videoId: string): Promise<void> {
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
      await ctx.reply("Failed to queue video.");
      return;
    }
    video = data as Video;
  }

  try {
    await processVideo(video);
    await ctx.reply("✅ Done!");
  } catch (err) {
    await ctx.reply(`Processing failed: ${err}`);
  }
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

async function handleListChannels(ctx: Context): Promise<void> {
  const { data: channels } = await supabase
    .from("channels")
    .select("name, default_category")
    .eq("active", true)
    .order("created_at", { ascending: true });

  if (!channels?.length) {
    await ctx.reply("No channels tracked yet. Send me a YouTube channel name or URL to get started.");
    return;
  }

  let msg = "📺 Tracked channels:\n\n";
  channels.forEach((ch: { name: string; default_category: string | null }, i: number) => {
    const cat = ch.default_category?.replace("_", " ") ?? "auto";
    msg += `${i + 1}. ${ch.name} (${cat})\n`;
  });

  await ctx.reply(msg);
}

async function handleRemoveChannel(ctx: Context, name: string): Promise<void> {
  const { data, error } = await supabase
    .from("channels")
    .update({ active: false })
    .ilike("name", `%${name}%`)
    .eq("active", true)
    .select("name");

  if (error || !data?.length) {
    await ctx.reply(`No active channel matching "${name}".`);
    return;
  }

  const names = data.map((c: { name: string }) => c.name).join(", ");
  await ctx.reply(`Stopped tracking: ${names}`);
}
