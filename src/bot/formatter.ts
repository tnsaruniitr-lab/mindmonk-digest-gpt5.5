import type { Summary, Video } from "../types/index.js";

const MAX_MSG_LENGTH = 4096;

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
    key_learnings: plainList(summary.key_learnings),
    key_learnings_numbered: numberedList(summary.key_learnings),
    applicable_to_me: plainList(summary.applicable_to_me),
    applicable_to_me_numbered: numberedList(summary.applicable_to_me),
    action_items: plainList(summary.action_items),
    action_items_numbered: numberedList(summary.action_items),
    quotable_moments: plainList(summary.quotable_moments),
    quotable_moments_numbered: numberedList(summary.quotable_moments),
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
  if (outputFormat?.trim()) {
    return splitMessage(
      renderCustomFormat(outputFormat, video, summary, channelName, brainObjectCount)
    );
  }

  const cat = video.category ?? "general";
  const title = escapeMarkdown(video.title);
  const channel = escapeMarkdown(channelName);

  let msg = `*${title}*\n`;
  msg += `${channel} \\| ${cat}\n\n`;

  if (summary.tldr) {
    msg += `*TL;DR*\n${escapeMarkdown(summary.tldr)}\n\n`;
  }

  if (summary.key_learnings?.length) {
    msg += `*Key Learnings*\n`;
    summary.key_learnings.forEach((l, i) => {
      msg += `${i + 1}\\. ${escapeMarkdown(l)}\n`;
    });
    msg += "\n";
  }

  if (summary.applicable_to_me?.length) {
    msg += `*Applicable to Me*\n`;
    summary.applicable_to_me.forEach((a) => {
      msg += `• ${escapeMarkdown(a)}\n`;
    });
    msg += "\n";
  }

  if (summary.action_items?.length) {
    msg += `*Action Items*\n`;
    summary.action_items.forEach((a) => {
      msg += `☐ ${escapeMarkdown(a)}\n`;
    });
    msg += "\n";
  }

  if (summary.quotable_moments?.length) {
    msg += `*Quotable Moments*\n`;
    summary.quotable_moments.forEach((q) => {
      msg += `> ${escapeMarkdown(q)}\n`;
    });
    msg += "\n";
  }

  if (summary.skip_assessment) {
    msg += `*Skip?* ${escapeMarkdown(summary.skip_assessment)}\n`;
  }

  if (brainObjectCount !== undefined && brainObjectCount > 0) {
    msg += `\n🧠 *${brainObjectCount} brain objects extracted*`;
  }

  return splitMessage(msg, "MarkdownV2");
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
