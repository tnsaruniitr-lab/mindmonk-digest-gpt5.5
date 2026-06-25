import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import { supabase } from "../db/supabase.js";
import { log } from "../utils/logger.js";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
  return client;
}

/**
 * Search brain objects by keyword matching.
 */
export async function searchBrain(query: string): Promise<string> {
  const keywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);

  // Search brain_objects with ILIKE across content, tags, author, type
  let results: any[] = [];

  // Try matching type directly first
  const typeMap: Record<string, string> = {
    rule: "rule", rules: "rule",
    principle: "principle", principles: "principle",
    playbook: "playbook", playbooks: "playbook",
    "anti-pattern": "anti_pattern", "anti pattern": "anti_pattern", antipattern: "anti_pattern",
    "mental model": "mental_model", "mental models": "mental_model", framework: "mental_model",
    pattern: "pattern", patterns: "pattern",
  };

  const queryLower = query.toLowerCase();
  const matchedType = Object.entries(typeMap).find(([key]) => queryLower.includes(key))?.[1];

  if (matchedType) {
    const { data } = await supabase
      .from("brain_objects")
      .select("*")
      .eq("type", matchedType)
      .order("created_at", { ascending: false })
      .limit(10);
    results = data ?? [];
  }

  // If no type match or no results, search content
  if (!results.length) {
    for (const keyword of keywords) {
      const { data } = await supabase
        .from("brain_objects")
        .select("*")
        .ilike("content", `%${keyword}%`)
        .order("created_at", { ascending: false })
        .limit(10);

      if (data?.length) {
        results.push(...data);
      }
    }

    // Deduplicate
    const seen = new Set<string>();
    results = results.filter(r => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    }).slice(0, 10);
  }

  if (!results.length) {
    return "No brain objects found matching your query. Try different keywords or process more videos first.";
  }

  // Format results
  const typeEmojis: Record<string, string> = {
    principle: "💡", rule: "📏", playbook: "📋",
    anti_pattern: "⚠️", mental_model: "🧠", pattern: "🔄",
  };

  let msg = `Found ${results.length} brain object(s):\n\n`;
  for (const obj of results) {
    const emoji = typeEmojis[obj.type] || "📌";
    msg += `${emoji} ${obj.type.replace("_", " ").toUpperCase()}\n`;
    msg += `${obj.content}\n`;
    if (obj.author) msg += `— ${obj.author}`;
    if (obj.channel_name) msg += ` (${obj.channel_name})`;
    if (obj.author || obj.channel_name) msg += "\n";
    msg += "\n";
  }

  return msg.trim();
}

/**
 * Search summaries by keyword.
 */
export async function searchSummaries(query: string): Promise<string> {
  const keywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);

  let results: any[] = [];

  for (const keyword of keywords) {
    // Search across tldr and key_learnings
    const { data } = await supabase
      .from("summaries")
      .select("*, videos!inner(title, category)")
      .or(`tldr.ilike.%${keyword}%,skip_assessment.ilike.%${keyword}%`)
      .order("created_at", { ascending: false })
      .limit(5);

    if (data?.length) results.push(...data);
  }

  // Deduplicate
  const seen = new Set<string>();
  results = results.filter(r => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  }).slice(0, 5);

  if (!results.length) {
    return "No matching summaries found. Try different keywords.";
  }

  let msg = `Found ${results.length} summary(ies):\n\n`;
  for (const s of results) {
    const title = s.videos?.title ?? "Unknown";
    msg += `📹 ${title}\n`;
    msg += `${s.tldr}\n`;
    if (s.skip_assessment) msg += `${s.skip_assessment}\n`;
    msg += "\n";
  }

  return msg.trim();
}

/**
 * Get stats from the database.
 */
export async function getStats(): Promise<string> {
  const [channels, videos, processed, summaries, brain, unavailable] = await Promise.all([
    supabase.from("channels").select("*", { count: "exact", head: true }).eq("active", true),
    supabase.from("videos").select("*", { count: "exact", head: true }),
    supabase.from("videos").select("*", { count: "exact", head: true }).eq("processed", true),
    supabase.from("summaries").select("*", { count: "exact", head: true }),
    supabase.from("brain_objects").select("*", { count: "exact", head: true }),
    supabase.from("videos").select("*", { count: "exact", head: true }).eq("transcript_status", "unavailable"),
  ]);

  // Brain breakdown by type
  const { data: brainTypes } = await supabase
    .from("brain_objects")
    .select("type");

  const typeCounts: Record<string, number> = {};
  for (const obj of brainTypes ?? []) {
    typeCounts[obj.type] = (typeCounts[obj.type] ?? 0) + 1;
  }

  let msg = `📊 MindMonk Stats\n\n`;
  msg += `Channels tracked: ${channels.count ?? 0}\n`;
  msg += `Videos found: ${videos.count ?? 0}\n`;
  msg += `Videos processed: ${processed.count ?? 0}\n`;
  msg += `No captions: ${unavailable.count ?? 0}\n`;
  msg += `Summaries: ${summaries.count ?? 0}\n`;
  msg += `Brain objects: ${brain.count ?? 0}\n`;

  if (Object.keys(typeCounts).length > 0) {
    msg += `\n🧠 Brain breakdown:\n`;
    const typeEmojis: Record<string, string> = {
      principle: "💡", rule: "📏", playbook: "📋",
      anti_pattern: "⚠️", mental_model: "🧠", pattern: "🔄",
    };
    for (const [type, count] of Object.entries(typeCounts).sort((a, b) => b[1] - a[1])) {
      msg += `  ${typeEmojis[type] ?? "📌"} ${type.replace("_", " ")}: ${count}\n`;
    }
  }

  return msg.trim();
}

/**
 * Get user's personal context.
 */
export async function getMyContext(): Promise<string> {
  const { data } = await supabase
    .from("user_context")
    .select("label, context, active")
    .order("created_at", { ascending: true });

  if (!data?.length) {
    return "No personal context set yet. Tell me about yourself!\n\nExample: \"My context: I'm a SaaS founder building AI-powered SEO tools, and I invest in tech stocks\"";
  }

  let msg = "🪞 Your personal context:\n\n";
  for (const c of data) {
    const status = c.active ? "✅" : "⏸️";
    msg += `${status} ${c.label}: ${c.context}\n`;
  }
  msg += "\nThis is injected into every summary to personalize insights for you.";

  return msg;
}

/**
 * Generate a natural language response for general chat.
 */
export async function generateChatResponse(message: string): Promise<string> {
  try {
    const response = await getClient().messages.create({
      model: config.ANTHROPIC_MODEL,
      max_tokens: 300,
      system: `You are MindMonk, a personal YouTube digest bot. You track YouTube channels, summarize videos with structured insights, and build a personal knowledge base ("brain") from video content.

Your capabilities:
- Track YouTube channels by name or URL
- Auto-summarize new videos with category-specific templates (investing, psychology, podcast, SEO/marketing, tech/AI)
- Extract brain objects: principles, rules, playbooks, anti-patterns, mental models, patterns
- Search across your brain and summaries
- Store personal context to personalize insights

Be concise, friendly, and helpful. Don't use emojis excessively.`,
      messages: [{ role: "user", content: message }],
    });

    return response.content[0].type === "text" ? response.content[0].text : "I'm not sure how to respond to that.";
  } catch {
    return "I'm MindMonk — I track YouTube channels, summarize videos, and build your personal knowledge brain. Try sending a YouTube link or ask me about your brain objects!";
  }
}
