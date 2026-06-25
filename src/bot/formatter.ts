import type { Summary, Video } from "../types/index.js";

const MAX_MSG_LENGTH = 4096;

export const DEFAULT_OUTPUT_FORMAT = `{{title}}
{{channel}} | {{category}}
{{source_url}}

1. Key insights
{{key_insights_numbered}}

2. Patterns and anti-patterns
{{patterns_antipatterns}}

3. Unbiased grading of the ideas
{{unbiased_grading}}

4. Tailor-made learnings for my profile
{{tailored_learnings}}

Next actions
{{tailored_actions}}`;

export interface FormattedMessage {
  text: string;
  parseMode?: "MarkdownV2";
}

function escapeMarkdown(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, "\\$1");
}

function splitMessage(text: string, parseMode?: "MarkdownV2"): FormattedMessage[] {
  const messages: FormattedMessage[] = [];
  let remaining = text.trim();

  while (remaining.length > MAX_MSG_LENGTH) {
    const paragraphBreak = remaining.lastIndexOf("\n\n", MAX_MSG_LENGTH - 200);
    const lineBreak = remaining.lastIndexOf("\n", MAX_MSG_LENGTH - 200);
    const breakAt =
      paragraphBreak > 0 ? paragraphBreak : lineBreak > 0 ? lineBreak : MAX_MSG_LENGTH;

    messages.push({ text: remaining.slice(0, breakAt).trim(), parseMode });
    remaining = remaining.slice(breakAt).trim();
  }

  if (remaining) messages.push({ text: remaining, parseMode });
  return messages;
}

function plainList(items: string[] | null | undefined): string {
  if (!items?.length) return "";
  return items.map((item) => `- ${item}`).join("\n");
}

function numberedList(items: string[] | null | undefined): string {
  if (!items?.length) return "";
  return items.map((item, index) => `${index + 1}. ${item}`).join("\n");
}

function renderCustomFormat(
  template: string,
  video: Video,
  summary: Summary,
  channelName: string,
  brainObjectCount?: number
): string {
  const category = video.category ?? "general";
  const sourceUrl = `https://www.youtube.com/watch?v=${video.youtube_video_id}`;
  const values: Record<string, string> = {
    title: video.title,
    channel: channelName,
    category,
    source_url: sourceUrl,
    youtube_url: sourceUrl,
    published_at: video.published_at ?? "",
    tldr: summary.tldr ?? "",
    key_insights: plainList(summary.key_learnings),
    key_insights_numbered: numberedList(summary.key_learnings),
    key_learnings: plainList(summary.key_learnings),
    key_learnings_numbered: numberedList(summary.key_learnings),
    tailored_learnings: plainList(summary.applicable_to_me),
    tailored_learnings_numbered: numberedList(summary.applicable_to_me),
    profile_matched_learnings: plainList(summary.applicable_to_me),
    profile_matched_learnings_numbered: numberedList(summary.applicable_to_me),
    applicable_to_me: plainList(summary.applicable_to_me),
    applicable_to_me_numbered: numberedList(summary.applicable_to_me),
    tailored_actions: plainList(summary.action_items),
    tailored_actions_numbered: numberedList(summary.action_items),
    action_items: plainList(summary.action_items),
    action_items_numbered: numberedList(summary.action_items),
    patterns_antipatterns: plainList(summary.quotable_moments),
    patterns_antipatterns_numbered: numberedList(summary.quotable_moments),
    patterns_and_antipatterns: plainList(summary.quotable_moments),
    patterns_and_antipatterns_numbered: numberedList(summary.quotable_moments),
    quotable_moments: plainList(summary.quotable_moments),
    quotable_moments_numbered: numberedList(summary.quotable_moments),
    unbiased_grading: summary.skip_assessment ?? "",
    idea_grade: summary.skip_assessment ?? "",
    idea_grading: summary.skip_assessment ?? "",
    skip_assessment: summary.skip_assessment ?? "",
    brain_object_count: brainObjectCount?.toString() ?? "0",
  };

  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => {
    return values[key.toLowerCase()] ?? "";
  });
}

export function formatSummary(
  video: Video,
  summary: Summary,
  channelName: string,
  brainObjectCount?: number,
  outputFormat?: string | null
): FormattedMessage[] {
  const template = outputFormat?.trim() || DEFAULT_OUTPUT_FORMAT;
  let msg = renderCustomFormat(template, video, summary, channelName, brainObjectCount);

  if (brainObjectCount !== undefined && brainObjectCount > 0) {
    msg += `\n\nBrain objects extracted: ${brainObjectCount}`;
  }

  return splitMessage(msg);
}

export function formatBrainObject(obj: {
  type: string;
  content: string;
  author: string | null;
  channel_name: string | null;
  confidence: string | null;
}): string {
  const typeEmojis: Record<string, string> = {
    principle: "💡",
    rule: "📏",
    playbook: "📋",
    anti_pattern: "⚠️",
    mental_model: "🧠",
    pattern: "🔄",
  };
  const emoji = typeEmojis[obj.type] || "📌";
  const conf = obj.confidence === "stated_as_fact" ? "fact" : obj.confidence === "strong_opinion" ? "opinion" : "speculation";

  let msg = `${emoji} *${escapeMarkdown(obj.type.replace("_", " "))}*\n`;
  msg += escapeMarkdown(obj.content) + "\n";
  if (obj.author) msg += `— ${escapeMarkdown(obj.author)}`;
  if (obj.channel_name) msg += ` \\(${escapeMarkdown(obj.channel_name)}\\)`;
  if (obj.author || obj.channel_name) msg += "\n";
  msg += `_${conf}_`;
  return msg;
}
