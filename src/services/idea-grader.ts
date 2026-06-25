import { z } from "zod";
import { config } from "../config.js";
import type { Category, SummaryResponse } from "../types/index.js";
import type { ContextEntry } from "./preferences.js";
import { log } from "../utils/logger.js";

const GraderResponseSchema = z.object({
  score: z.string(),
  verdict: z.string(),
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  hidden_assumptions: z.array(z.string()),
  overclaims_or_risks: z.array(z.string()),
  confidence: z.string(),
});

type GraderResponse = z.infer<typeof GraderResponseSchema>;

interface GradeIdeasInput {
  videoTitle: string;
  channelName: string;
  category: Category;
  summary: SummaryResponse;
  userContextEntries: ContextEntry[];
}

function isGraderConfigured(): boolean {
  return Boolean(config.GRADER_LLM_API_KEY.trim() && config.GRADER_LLM_MODEL.trim());
}

function formatList(items: string[]): string {
  if (!items.length) return "- None";
  return items.map((item) => `- ${item}`).join("\n");
}

function formatGraderResponse(response: GraderResponse): string {
  return [
    `Model: ${config.GRADER_LLM_MODEL}`,
    `Grade: ${response.score}`,
    `Verdict: ${response.verdict}`,
    "",
    "What is strong:",
    formatList(response.strengths),
    "",
    "What is weak:",
    formatList(response.weaknesses),
    "",
    "Hidden assumptions:",
    formatList(response.hidden_assumptions),
    "",
    "Overclaims or risks:",
    formatList(response.overclaims_or_risks),
    "",
    `Confidence: ${response.confidence}`,
  ].join("\n");
}

function buildGraderPrompt(input: GradeIdeasInput): string {
  const profile =
    input.userContextEntries.length > 0
      ? input.userContextEntries.map((entry) => `- ${entry.label}: ${entry.context}`).join("\n")
      : "No profile context provided.";

  return `You are an independent idea grader. Evaluate the podcast ideas without hype, fandom, or hostility.

Grade the ideas for truth-seeking quality, originality, evidence, practical usefulness, transferability to the user's profile, and downside awareness.

Return JSON only with this exact shape:
{
  "score": "number out of 10 with one-sentence label",
  "verdict": "short balanced verdict",
  "strengths": ["array"],
  "weaknesses": ["array"],
  "hidden_assumptions": ["array"],
  "overclaims_or_risks": ["array"],
  "confidence": "low | medium | high, with one short reason"
}

Podcast:
Title: ${input.videoTitle}
Channel: ${input.channelName}
Category: ${input.category}

User profile:
${profile}

Key insights:
${formatList(input.summary.key_learnings)}

Patterns and anti-patterns:
${formatList(input.summary.quotable_moments)}

Profile-tailored learnings:
${formatList(input.summary.applicable_to_me)}

Initial grade from summarizer:
${input.summary.skip_assessment}`;
}

export async function gradeIdeasWithConfiguredLlm(
  input: GradeIdeasInput
): Promise<string | null> {
  if (!isGraderConfigured()) return null;

  const baseUrl = config.GRADER_LLM_BASE_URL.trim() || "https://api.openai.com/v1";
  const endpoint = `${baseUrl.replace(/\/$/, "")}/chat/completions`;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.GRADER_LLM_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.GRADER_LLM_MODEL,
        temperature: 0.1,
        max_tokens: 1200,
        messages: [
          {
            role: "system",
            content:
              "You are a rigorous, unbiased evaluator. You grade ideas, not people. Output only valid JSON.",
          },
          { role: "user", content: buildGraderPrompt(input) },
        ],
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      log.error("idea-grader", `Grader LLM failed (${response.status})`, body);
      return null;
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data.choices?.[0]?.message?.content?.trim() ?? "";
    const jsonStr = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = GraderResponseSchema.safeParse(JSON.parse(jsonStr));

    if (!parsed.success) {
      log.error("idea-grader", "Invalid grader JSON", parsed.error);
      return null;
    }

    return formatGraderResponse(parsed.data);
  } catch (err) {
    log.error("idea-grader", "Failed to grade ideas", err);
    return null;
  }
}
