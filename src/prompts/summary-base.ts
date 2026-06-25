import type { Category } from "../types/index.js";
import { INVESTING_TEMPLATE } from "./templates/investing.js";
import { PSYCHOLOGY_TEMPLATE } from "./templates/psychology.js";
import { PODCAST_INTERVIEW_TEMPLATE } from "./templates/podcast-interview.js";
import { SEO_MARKETING_TEMPLATE } from "./templates/seo-marketing.js";
import { TECH_AI_STARTUP_TEMPLATE } from "./templates/tech-ai-startup.js";

const categoryTemplates: Record<Category, string> = {
  investing: INVESTING_TEMPLATE,
  psychology: PSYCHOLOGY_TEMPLATE,
  podcast_interview: PODCAST_INTERVIEW_TEMPLATE,
  seo_marketing: SEO_MARKETING_TEMPLATE,
  tech_ai_startup: TECH_AI_STARTUP_TEMPLATE,
};

export const SUMMARY_SYSTEM_PROMPT = `You are a personal learning assistant that creates structured video summaries. You only surface genuinely novel, non-obvious insights. Skip anything generic or widely known.

Your output MUST be valid JSON matching this exact schema:
{
  "tldr": "2-3 sentence executive summary",
  "key_learnings": ["array of 3-7 genuinely novel insights — skip obvious stuff"],
  "applicable_to_me": ["array of 2-4 points specifically relevant to the personal context below"],
  "action_items": ["array of 1-3 concrete, specific next steps — not vague advice"],
  "quotable_moments": ["array of 1-3 memorable quotes or striking phrases with approximate timestamps if available"],
  "skip_assessment": "One of: 'MUST WATCH: <reason>' or 'WORTH IT: <reason>' or 'SKIP: <reason>'"
}

Output ONLY the JSON object, no markdown fences, no explanation.`;

export function buildSummaryPrompt(
  category: Category,
  transcript: string,
  userContextEntries: { label: string; context: string }[],
  videoTitle: string,
  channelName: string,
  outputFormat?: string | null
): string {
  const contextBlock =
    userContextEntries.length > 0
      ? userContextEntries.map((c) => `- ${c.label}: ${c.context}`).join("\n")
      : "No personal context set. Give general insights.";

  const outputFormatBlock = outputFormat?.trim()
    ? `The final Telegram message will be rendered with this template:\n${outputFormat}\n\nPrioritize the JSON fields that map to this template.`
    : "No custom output format set. Use the default structured digest.";

  const template = categoryTemplates[category] ?? "";

  // Truncate very long transcripts (>80k chars ~ 2hr+ videos)
  const maxChars = 80000;
  const truncated =
    transcript.length > maxChars
      ? transcript.slice(0, maxChars) + "\n\n[TRANSCRIPT TRUNCATED — video is very long]"
      : transcript;

return `## Personal Context
${contextBlock}

## Preferred Output Format
${outputFormatBlock}

## Category-Specific Focus
${template}

## Video
Title: ${videoTitle}
Channel: ${channelName}
Category: ${category}

## Transcript
${truncated}`;
}
