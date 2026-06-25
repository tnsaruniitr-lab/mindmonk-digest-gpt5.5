import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import { log } from "../utils/logger.js";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
  return client;
}

export interface Intent {
  action:
    | "add_channel"
    | "digest_video"
    | "list_channels"
    | "remove_channel"
    | "search_brain"
    | "search_summaries"
    | "stats"
    | "help"
    | "my_context"
    | "set_context"
    | "reprocess"
    | "general_chat"
    | "unknown";
  query: string | null;
  url: string | null;
  category: string | null;
  label: string | null;
  context_text: string | null;
}

const ROUTER_PROMPT = `You are an intent classifier for a YouTube digest Telegram bot called MindMonk. Given the user's message, classify the intent.

The bot can:
- Track YouTube channels and auto-summarize new videos
- Digest individual YouTube videos on demand
- Store brain objects (principles, rules, playbooks, anti-patterns, mental models, patterns) extracted from videos
- Search across summaries and brain objects
- Store personal context about the user
- Show stats

Return JSON only:
{
  "action": "<one of: add_channel, digest_video, list_channels, remove_channel, search_brain, search_summaries, stats, help, my_context, set_context, reprocess, general_chat, unknown>",
  "query": "<search query if action is search_brain or search_summaries, or the channel name for add_channel, or null>",
  "url": "<YouTube URL if present, or null>",
  "category": "<channel category if mentioned: investing, psychology, podcast_interview, seo_marketing, tech_ai_startup, or null>",
  "label": "<context label if set_context, or null>",
  "context_text": "<context text if set_context, or null>"
}

Classification rules:
- If the message contains a YouTube video URL → digest_video
- If the message contains a YouTube channel URL → add_channel
- If the user asks about what channels they track → list_channels
- If the user asks to stop/remove/untrack a channel → remove_channel
- If the user asks about their brain, knowledge, insights, learnings, rules, patterns → search_brain
- If the user asks about a specific video summary or what someone said → search_summaries
- If the user asks how many videos, channels, brain objects, or general stats → stats
- If the user asks what the bot does, help, capabilities → help
- If the user asks about their own context/profile/about me → my_context
- If the user wants to set/update personal context → set_context
- If the user mentions a channel/person name without a URL (e.g. "track Dwarkesh", "add Naval") → add_channel with query = the name
- If it's a greeting or general chat → general_chat
- Otherwise → unknown

Output ONLY JSON, no markdown fences.`;

export async function classifyIntent(message: string): Promise<Intent> {
  try {
    const response = await getClient().messages.create({
      model: config.ANTHROPIC_MODEL,
      max_tokens: 200,
      system: ROUTER_PROMPT,
      messages: [{ role: "user", content: message }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const jsonStr = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(jsonStr) as Intent;
    log.info("router", `"${message.slice(0, 50)}" → ${parsed.action}`);
    return parsed;
  } catch (err) {
    log.error("router", "Intent classification failed", err);
    return { action: "unknown", query: null, url: null, category: null, label: null, context_text: null };
  }
}
