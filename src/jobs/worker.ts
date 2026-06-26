import { config } from "../config.js";
import { supabase } from "../db/supabase.js";
import { extractBrainObjects } from "../services/brain-extractor.js";
import { classifyVideo } from "../services/classifier.js";
import {
  deliverSummary,
  deliverSummaryToChat,
  notify,
  sendPlainTextToChat,
} from "../services/delivery.js";
import { generateSummary, loadStoredSummary } from "../services/summarizer.js";
import { getOrCreateTranscriptForVideo } from "../services/transcript.js";
import { loadActiveSubscribers } from "../services/users.js";
import type { Category, Channel, Transcript, UserSummary, Video } from "../types/index.js";
import { log } from "../utils/logger.js";
import {
  claimNextJob,
  completeJob,
  enqueueDeliverSummaryJob,
  enqueueExtractBrainObjectsJob,
  enqueueFetchTranscriptJob,
  enqueueGenerateUserSummaryJob,
  failJob,
  type DeliverSummaryJobPayload,
  type ExtractBrainObjectsJobPayload,
  type FetchTranscriptJobPayload,
  type GenerateUserSummaryJobPayload,
  type Job,
  type JobType,
  type ProcessVideoJobPayload,
  workerId,
} from "./queue.js";

let timer: NodeJS.Timeout | null = null;
let stopped = true;

const activeByType = new Map<JobType, number>();

const jobLimits: Record<JobType, number> = {
  process_video: config.MAX_VIDEO_PROCESSING_CONCURRENCY,
  fetch_transcript: config.MAX_TRANSCRIPT_CONCURRENCY,
  generate_user_summary: config.MAX_SUMMARY_CONCURRENCY,
  deliver_summary: config.MAX_DELIVERY_CONCURRENCY,
  extract_brain_objects: config.MAX_EXTRACTION_CONCURRENCY,
};

const jobTypes = Object.keys(jobLimits) as JobType[];

export function startJobWorker(): void {
  if (!config.JOB_WORKER_ENABLED) {
    log.info("jobs", "Job worker disabled by JOB_WORKER_ENABLED=false");
    return;
  }

  if (timer) return;

  stopped = false;
  log.info(
    "jobs",
    `Job worker started (${workerId}, limits ${JSON.stringify(jobLimits)})`
  );
  scheduleNextTick(500);
}

export function stopJobWorker(): void {
  stopped = true;
  if (timer) clearTimeout(timer);
  timer = null;
  log.info("jobs", "Job worker stopped");
}

function scheduleNextTick(delayMs = config.JOB_POLL_INTERVAL_SECONDS * 1000): void {
  if (stopped) return;
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    void tick();
  }, delayMs);
}

function activeCount(type: JobType): number {
  return activeByType.get(type) ?? 0;
}

function availableTypes(): JobType[] {
  return jobTypes.filter((type) => activeCount(type) < jobLimits[type]);
}

async function tick(): Promise<void> {
  if (stopped) return;

  try {
    while (true) {
      const types = availableTypes();
      if (!types.length) break;

      const job = await claimNextJob(types);
      if (!job) break;

      activeByType.set(job.type, activeCount(job.type) + 1);
      void handleJob(job).finally(() => {
        activeByType.set(job.type, Math.max(0, activeCount(job.type) - 1));
        if (!stopped) scheduleNextTick(500);
      });
    }
  } catch (err) {
    log.error("jobs", "Worker tick failed", err);
  } finally {
    scheduleNextTick();
  }
}

async function handleJob(job: Job): Promise<void> {
  const startedAt = Date.now();
  log.info("jobs", `Claimed ${job.type} ${job.id}`);

  try {
    switch (job.type) {
      case "process_video":
        await handleProcessVideo(job as Job<ProcessVideoJobPayload>);
        break;
      case "fetch_transcript":
        await handleFetchTranscript(job as Job<FetchTranscriptJobPayload>);
        break;
      case "generate_user_summary":
        await handleGenerateUserSummary(job as Job<GenerateUserSummaryJobPayload>);
        break;
      case "deliver_summary":
        await handleDeliverSummary(job as Job<DeliverSummaryJobPayload>);
        break;
      case "extract_brain_objects":
        await handleExtractBrainObjects(job as Job<ExtractBrainObjectsJobPayload>);
        break;
      default:
        throw new Error(`Unsupported job type: ${job.type}`);
    }

    await completeJob(job.id);
    log.info("jobs", `Completed ${job.type} ${job.id} in ${Date.now() - startedAt}ms`);
  } catch (err) {
    await failJob(job, err);
  }
}

async function loadVideo(videoId: string, jobType: string): Promise<Video> {
  const { data: video, error } = await supabase
    .from("videos")
    .select("*")
    .eq("id", videoId)
    .single();

  if (error || !video) throw new Error(`Video ${videoId} not found for ${jobType} job`);
  return video as Video;
}

async function loadChannel(video: Video): Promise<Channel | null> {
  if (!video.channel_id) return null;

  const { data } = await supabase
    .from("channels")
    .select("*")
    .eq("id", video.channel_id)
    .single();

  return (data as Channel | null) ?? null;
}

async function loadTranscript(videoId: string): Promise<Transcript | null> {
  const { data } = await supabase
    .from("transcripts")
    .select("*")
    .eq("video_id", videoId)
    .eq("language", "en")
    .single();

  return (data as Transcript | null) ?? null;
}

async function classifyAndPersist(
  video: Video,
  channel: Channel | null,
  transcript: Transcript
): Promise<Category> {
  const channelName = channel?.name ?? "Unknown";
  const category = await classifyVideo(
    video.title,
    channelName,
    transcript.text.slice(0, 2000),
    channel?.default_category ?? null
  );

  await supabase.from("videos").update({ category }).eq("id", video.id);
  video.category = category;
  return category;
}

function shouldExtractBrain(category: Category, title: string): boolean {
  const brainCategories = ["investing", "seo_marketing", "tech_ai_startup", "psychology"];
  if (brainCategories.includes(category)) return true;

  const podcastBrainTopics =
    /invest|startup|founder|ceo|business|ai\b|tech|market|saas|product|scale|growth|venture|capital|finance|economy|trading|crypto|blockchain/i;
  return category === "podcast_interview" && podcastBrainTopics.test(title);
}

async function handleProcessVideo(job: Job<ProcessVideoJobPayload>): Promise<void> {
  const videoId = job.payload?.videoId;
  if (!videoId) throw new Error("process_video job missing payload.videoId");

  // Backward-compatible wrapper for older queued jobs.
  if (job.payload.userId) {
    await enqueueGenerateUserSummaryJob(videoId, {
      userId: job.payload.userId,
      telegramChatId: job.payload.telegramChatId ?? null,
      priority: job.priority,
    });
  } else {
    await enqueueFetchTranscriptJob(videoId, job.priority);
  }
}

async function handleFetchTranscript(job: Job<FetchTranscriptJobPayload>): Promise<void> {
  const videoId = job.payload?.videoId;
  if (!videoId) throw new Error("fetch_transcript job missing payload.videoId");

  const video = await loadVideo(videoId, "fetch_transcript");
  const channel = await loadChannel(video);
  const transcript = await getOrCreateTranscriptForVideo(video, {
    jobId: job.id,
    videoId: video.id,
  });

  if (!transcript) {
    await supabase.from("videos").update({ processed: true }).eq("id", video.id);
    log.info("jobs", `No transcript available for ${video.title}`);
    return;
  }

  const category = await classifyAndPersist(video, channel, transcript);

  if (video.channel_id) {
    const subscribers = await loadActiveSubscribers(video.channel_id);
    for (const subscriber of subscribers) {
      await enqueueGenerateUserSummaryJob(video.id, {
        userId: subscriber.id,
        telegramChatId: subscriber.telegram_chat_id,
        priority: 80,
      });
    }
  }

  if (!video.channel_id) {
    await enqueueGenerateUserSummaryJob(video.id, { priority: 100 });
  }

  if (shouldExtractBrain(category, video.title)) {
    await enqueueExtractBrainObjectsJob(video.id);
  }

  await supabase.from("videos").update({ processed: true }).eq("id", video.id);
}

async function handleGenerateUserSummary(
  job: Job<GenerateUserSummaryJobPayload>
): Promise<void> {
  const videoId = job.payload?.videoId;
  if (!videoId) throw new Error("generate_user_summary job missing payload.videoId");

  const video = await loadVideo(videoId, "generate_user_summary");
  const userId = job.payload.userId ?? null;

  if (video.transcript_status === "unavailable") {
    if (job.payload.telegramChatId) {
      await sendPlainTextToChat(
        job.payload.telegramChatId,
        `⚠️ No transcript is available for "${video.title}", so I cannot summarize it yet.`
      );
    }
    return;
  }

  let transcript = await loadTranscript(video.id);
  if (!transcript) {
    await enqueueFetchTranscriptJob(video.id, 50);
    throw new Error(`Transcript not ready for ${video.id}; fetch_transcript queued`);
  }

  const channel = await loadChannel(video);
  const channelName = channel?.name ?? "Unknown";
  const category = video.category ?? await classifyAndPersist(video, channel, transcript);
  const existing = await loadStoredSummary(video.id, userId);

  if (!existing) {
    const generated = await generateSummary(
      video.id,
      transcript.text,
      category,
      video.title,
      channelName,
      userId,
      transcript.id,
      {
        userId,
        jobId: job.id,
        videoId: video.id,
      }
    );

    if (!generated) throw new Error(`Summary generation failed for ${video.id}`);
  }

  await enqueueDeliverSummaryJob(video.id, {
    userId,
    telegramChatId: job.payload.telegramChatId ?? null,
    priority: 70,
  });
}

async function handleDeliverSummary(job: Job<DeliverSummaryJobPayload>): Promise<void> {
  const videoId = job.payload?.videoId;
  if (!videoId) throw new Error("deliver_summary job missing payload.videoId");

  const video = await loadVideo(videoId, "deliver_summary");
  const channel = await loadChannel(video);
  const userId = job.payload.userId ?? null;
  const summary = await loadStoredSummary(video.id, userId);
  if (!summary) throw new Error(`Summary not found for delivery: ${video.id}`);

  const delivered = job.payload.telegramChatId
    ? await deliverSummaryToChat(
        video,
        summary as UserSummary,
        channel?.name ?? "Unknown",
        job.payload.telegramChatId,
        userId
      )
    : await deliverSummary(video, summary, channel?.name ?? "Unknown");

  if (!delivered) throw new Error(`Telegram delivery failed for ${video.id}`);
}

async function handleExtractBrainObjects(
  job: Job<ExtractBrainObjectsJobPayload>
): Promise<void> {
  const videoId = job.payload?.videoId;
  if (!videoId) throw new Error("extract_brain_objects job missing payload.videoId");

  const video = await loadVideo(videoId, "extract_brain_objects");
  const transcript = await loadTranscript(video.id);
  if (!transcript) throw new Error(`Transcript not found for brain extraction: ${video.id}`);

  const channel = await loadChannel(video);
  const category = video.category ?? "podcast_interview";
  if (!shouldExtractBrain(category, video.title)) {
    log.info("jobs", `Skipping brain extraction for ${video.title} (${category})`);
    return;
  }

  const count = await extractBrainObjects(
    video.id,
    transcript.text,
    video.title,
    channel?.name ?? "Unknown",
    category
  );

  if (count > 0) {
    await notify(`🧠 ${count} brain objects extracted from "${video.title}"`);
  }
}
