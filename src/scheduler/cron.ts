import cron from "node-cron";
import { supabase } from "../db/supabase.js";
import { pollAllChannels } from "../services/rss.js";
import { getTranscriptForVideo } from "../services/transcript.js";
import { classifyVideo } from "../services/classifier.js";
import { generateSummary } from "../services/summarizer.js";
import { extractBrainObjects } from "../services/brain-extractor.js";
import { deliverSummary, notify } from "../services/delivery.js";
import type { Video, Channel, Summary } from "../types/index.js";
import type { Category } from "../types/index.js";
import { log } from "../utils/logger.js";

let rssJob: cron.ScheduledTask | null = null;
let queueJob: cron.ScheduledTask | null = null;
let processing = false;

/**
 * Process a single video through the full pipeline.
 */
export async function processVideo(video: Video): Promise<void> {
  // Get channel info
  const { data: channel } = await supabase
    .from("channels")
    .select("*")
    .eq("id", video.channel_id)
    .single();

  const channelName = (channel as Channel | null)?.name ?? "Unknown";
  const defaultCategory = (channel as Channel | null)?.default_category ?? null;

  // 1. Fetch transcript
  const transcript = await getTranscriptForVideo(video.youtube_video_id, video.id);
  if (!transcript) {
    await notify(`⚠️ No captions available for "${video.title}" from ${channelName}`);
    return;
  }

  // 2. Classify
  const category = await classifyVideo(
    video.title,
    channelName,
    transcript.slice(0, 2000),
    defaultCategory
  );

  await supabase.from("videos").update({ category }).eq("id", video.id);

  // 3. Generate summary (Pass 1)
  const summaryData = await generateSummary(
    video.id,
    transcript,
    category,
    video.title,
    channelName
  );

  if (!summaryData) {
    await notify(`❌ Failed to summarize "${video.title}"`);
    return;
  }

  // 4. Fetch the stored summary row for delivery
  const { data: summaryRow } = await supabase
    .from("summaries")
    .select("*")
    .eq("video_id", video.id)
    .single();

  if (summaryRow) {
    // 5. Deliver to Telegram
    await deliverSummary(video, summaryRow as Summary, channelName);
  }

  // 6. Mark processed
  await supabase.from("videos").update({ processed: true }).eq("id", video.id);

  // 7. Brain object extraction (Pass 2 — only for actionable categories)
  const brainCategories = ["investing", "seo_marketing", "tech_ai_startup", "psychology"];
  const shouldExtractBrain = brainCategories.includes(category);

  // For podcast_interview, only extract if guest is in business/tech/investing
  const podcastBrainTopics = /invest|startup|founder|ceo|business|ai\b|tech|market|saas|product|scale|growth|venture|capital|finance|economy|trading|crypto|blockchain/i;
  const isPodcastWithBrainValue =
    category === "podcast_interview" && podcastBrainTopics.test(video.title);

  if (shouldExtractBrain || isPodcastWithBrainValue) {
    extractBrainObjects(video.id, transcript, video.title, channelName, category)
      .then((count) => {
        if (count > 0) {
          notify(`🧠 ${count} brain objects extracted from "${video.title}"`);
        }
      })
      .catch((err) => log.error("cron", "Brain extraction error", err));
  } else {
    log.info("cron", `Skipping brain extraction for "${video.title}" (${category} — not actionable)`);
  }
}

/**
 * Process the queue of unprocessed videos.
 */
async function processQueue(): Promise<void> {
  if (processing) {
    log.warn("cron", "Queue processor already running, skipping");
    return;
  }

  processing = true;

  try {
    const { data: videos, error } = await supabase
      .from("videos")
      .select("*")
      .eq("processed", false)
      .order("created_at", { ascending: true })
      .limit(3);

    if (error || !videos?.length) {
      if (error) log.error("cron", "Failed to fetch queue", error);
      return;
    }

    log.info("cron", `Processing ${videos.length} video(s) from queue`);

    for (const video of videos as Video[]) {
      try {
        await processVideo(video);
      } catch (err) {
        log.error("cron", `Failed to process "${video.title}"`, err);
      }
    }
  } finally {
    processing = false;
  }
}

export function startScheduler(): void {
  // Poll RSS every 20 minutes
  rssJob = cron.schedule("*/20 * * * *", async () => {
    log.info("cron", "RSS poll starting...");
    const count = await pollAllChannels();
    if (count > 0) log.info("cron", `RSS poll found ${count} new video(s)`);
  });

  // Process queue every 5 minutes
  queueJob = cron.schedule("*/5 * * * *", async () => {
    await processQueue();
  });

  log.info("cron", "Scheduler started (RSS: every 20min, Queue: every 5min)");
}

export function stopScheduler(): void {
  rssJob?.stop();
  queueJob?.stop();
  log.info("cron", "Scheduler stopped");
}
