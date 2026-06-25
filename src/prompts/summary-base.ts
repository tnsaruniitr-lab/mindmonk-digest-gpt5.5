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

export const SUMMARY_SYSTEM_PROMPT = `You are a personal learning assistant that converts podcast transcripts into four high-signal sections:
1. Key insights
2. Patterns and anti-patterns
3. Unbiased grading of the ideas
4. Tailor-made learnings for the user's stated profile

Be specific, skeptical, and evidence-aware. Do not flatter the guest. Do not punish ideas for being unconventional if the reasoning is strong. Distinguish what the speaker actually supports from what is speculation.

Your output MUST be valid JSON matching this exact schema:
{
  "tldr": "1-2 sentence neutral context for the podcast",
  "key_learnings": ["array of 5-8 key insights, phrased as standalone ideas with evidence or caveats"],
  "applicable_to_me": ["array of 4-6 profile-matched learnings tailored to the user's stated profile, constraints, and goals"],
  "action_items": ["array of 2-4 concrete next steps for the user, derived only from strong ideas"],
  "quotable_moments": ["array of 4-8 patterns and anti-patterns. Prefix each item with either 'Pattern:' or 'Anti-pattern:'"],
  "skip_assessment": "Unbiased grading of the ideas: include score out of 10, what is strong, what is weak, hidden assumptions, and where the speaker may be overclaiming"
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
    : "No custom output format set. Use the default four-section digest: key insights, patterns and anti-patterns, unbiased grading, and profile-matched learnings.";

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
