import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import { supabase } from "../db/supabase.js";
import {
  BRAIN_EXTRACT_SYSTEM_PROMPT,
  buildBrainExtractPrompt,
} from "../prompts/brain-extract.js";
import { BrainObjectResponseSchema } from "../types/index.js";
import { withRetry } from "../utils/retry.js";
import { log } from "../utils/logger.js";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
  return client;
}

/**
 * Extract brain objects from a video transcript (Pass 2 — async).
 * Returns count of objects extracted.
 */
export async function extractBrainObjects(
  videoId: string,
  transcript: string,
  videoTitle: string,
  channelName: string,
  category: string
): Promise<number> {
  try {
    const userPrompt = buildBrainExtractPrompt(
      transcript,
      videoTitle,
      channelName,
      category
    );

    const response = await withRetry(
      () =>
        getClient().messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 4096,
          system: BRAIN_EXTRACT_SYSTEM_PROMPT,
          messages: [{ role: "user", content: userPrompt }],
        }),
      { label: "brain-extract", maxRetries: 2 }
    );

    const text =
      response.content[0].type === "text" ? response.content[0].text : "";

    const jsonStr = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = BrainObjectResponseSchema.safeParse(JSON.parse(jsonStr));

    if (!parsed.success) {
      log.error("brain", `Invalid brain object JSON for "${videoTitle}"`, parsed.error);
      return 0;
    }

    if (parsed.data.length === 0) {
      log.info("brain", `No brain objects extracted from "${videoTitle}"`);
      return 0;
    }

    // Bulk insert
    const rows = parsed.data.map((obj) => ({
      type: obj.type,
      content: obj.content,
      author: obj.author,
      source_video_id: videoId,
      channel_name: channelName,
      category,
      context: obj.context,
      confidence: obj.confidence,
      tags: obj.tags,
    }));

    const { error } = await supabase.from("brain_objects").insert(rows);
    if (error) {
      log.error("brain", `Failed to insert brain objects`, error);
      return 0;
    }

    log.info("brain", `Extracted ${rows.length} brain objects from "${videoTitle}"`);
    return rows.length;
  } catch (err) {
    log.error("brain", `Brain extraction failed for "${videoTitle}"`, err);
    return 0;
  }
}
