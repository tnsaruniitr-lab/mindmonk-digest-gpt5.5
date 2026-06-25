import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import { supabase } from "../db/supabase.js";
import { SUMMARY_SYSTEM_PROMPT, buildSummaryPrompt } from "../prompts/summary-base.js";
import { getUserPreferences } from "./preferences.js";
import { SummaryResponseSchema, type Category, type SummaryResponse } from "../types/index.js";
import { withRetry } from "../utils/retry.js";
import { log } from "../utils/logger.js";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
  return client;
}

/**
 * Generate a structured summary for a video transcript.
 */
export async function generateSummary(
  videoId: string,
  transcript: string,
  category: Category,
  videoTitle: string,
  channelName: string
): Promise<SummaryResponse | null> {
  try {
    const preferences = await getUserPreferences();

    const userPrompt = buildSummaryPrompt(
      category,
      transcript,
      preferences.personalContext,
      videoTitle,
      channelName,
      preferences.outputFormat
    );

    const response = await withRetry(
      () =>
        getClient().messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 4096,
          system: SUMMARY_SYSTEM_PROMPT,
          messages: [{ role: "user", content: userPrompt }],
        }),
      { label: "summarize", maxRetries: 2 }
    );

    const text =
      response.content[0].type === "text" ? response.content[0].text : "";

    // Try to parse JSON — handle potential markdown fences
    const jsonStr = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = SummaryResponseSchema.safeParse(JSON.parse(jsonStr));

    if (!parsed.success) {
      log.error("summarizer", `Invalid summary JSON for "${videoTitle}"`, parsed.error);
      return null;
    }

    // Store in DB
    const tokensUsed =
      (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0);

    await supabase.from("summaries").upsert(
      {
        video_id: videoId,
        tldr: parsed.data.tldr,
        key_learnings: parsed.data.key_learnings,
        applicable_to_me: parsed.data.applicable_to_me,
        action_items: parsed.data.action_items,
        quotable_moments: parsed.data.quotable_moments,
        skip_assessment: parsed.data.skip_assessment,
        raw_transcript: transcript,
        model_used: "claude-sonnet-4-20250514",
        tokens_used: tokensUsed,
      },
      { onConflict: "video_id" }
    );

    log.info("summarizer", `Summary generated for "${videoTitle}" (${tokensUsed} tokens)`);
    return parsed.data;
  } catch (err) {
    log.error("summarizer", `Failed to summarize "${videoTitle}"`, err);
    return null;
  }
}
