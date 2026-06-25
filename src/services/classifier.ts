import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import { CLASSIFY_SYSTEM_PROMPT, buildClassifyPrompt } from "../prompts/classify.js";
import { ClassificationResponseSchema, type Category } from "../types/index.js";
import { withRetry } from "../utils/retry.js";
import { log } from "../utils/logger.js";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
  return client;
}

/**
 * Classify a video into one of the 5 categories using Claude.
 */
export async function classifyVideo(
  videoTitle: string,
  channelName: string,
  transcriptSnippet: string,
  defaultCategory: string | null
): Promise<Category> {
  // If channel has a default and transcript is short/empty, trust the default
  if (defaultCategory && !transcriptSnippet) {
    return defaultCategory as Category;
  }

  try {
    const userPrompt = buildClassifyPrompt(
      videoTitle,
      channelName,
      transcriptSnippet.slice(0, 2000),
      defaultCategory
    );

    const response = await withRetry(
      () =>
        getClient().messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 200,
          system: CLASSIFY_SYSTEM_PROMPT,
          messages: [{ role: "user", content: userPrompt }],
        }),
      { label: "classify", maxRetries: 2 }
    );

    const text =
      response.content[0].type === "text" ? response.content[0].text : "";
    const parsed = ClassificationResponseSchema.safeParse(JSON.parse(text));

    if (parsed.success) {
      log.info("classifier", `"${videoTitle}" → ${parsed.data.category} (${parsed.data.reasoning})`);
      return parsed.data.category;
    }
  } catch (err) {
    log.error("classifier", `Failed to classify "${videoTitle}"`, err);
  }

  // Fallback to default or podcast_interview
  return (defaultCategory as Category) ?? "podcast_interview";
}
