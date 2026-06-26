import { config } from "../config.js";
import { supabase } from "../db/supabase.js";
import { processVideo } from "../scheduler/cron.js";
import type { Video } from "../types/index.js";
import { log } from "../utils/logger.js";
import {
  claimNextJob,
  completeJob,
  failJob,
  type Job,
  type ProcessVideoJobPayload,
  workerId,
} from "./queue.js";

let timer: NodeJS.Timeout | null = null;
let activeJobs = 0;
let stopped = true;

export function startJobWorker(): void {
  if (!config.JOB_WORKER_ENABLED) {
    log.info("jobs", "Job worker disabled by JOB_WORKER_ENABLED=false");
    return;
  }

  if (timer) return;

  stopped = false;
  log.info(
    "jobs",
    `Job worker started (${workerId}, concurrency ${config.MAX_VIDEO_PROCESSING_CONCURRENCY})`
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

async function tick(): Promise<void> {
  if (stopped) return;

  try {
    while (activeJobs < config.MAX_VIDEO_PROCESSING_CONCURRENCY) {
      const job = await claimNextJob();
      if (!job) break;

      activeJobs++;
      void handleJob(job).finally(() => {
        activeJobs--;
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
      default:
        throw new Error(`Unsupported job type: ${job.type}`);
    }

    await completeJob(job.id);
    log.info("jobs", `Completed ${job.type} ${job.id} in ${Date.now() - startedAt}ms`);
  } catch (err) {
    await failJob(job, err);
  }
}

async function handleProcessVideo(job: Job<ProcessVideoJobPayload>): Promise<void> {
  const videoId = job.payload?.videoId;
  if (!videoId) throw new Error("process_video job missing payload.videoId");

  const { data: video, error } = await supabase
    .from("videos")
    .select("*")
    .eq("id", videoId)
    .single();

  if (error || !video) {
    throw new Error(`Video ${videoId} not found for process_video job`);
  }

  const typedVideo = video as Video;
  if (typedVideo.processed && !job.payload.userId) {
    log.info("jobs", `Video ${videoId} already processed; completing job`);
    return;
  }

  const result = await processVideo(typedVideo, {
    jobId: job.id,
    userId: job.payload.userId ?? null,
    telegramChatId: job.payload.telegramChatId ?? null,
  });
  if (result.status === "summary_failed") {
    throw new Error(`Summary generation failed for video ${videoId}`);
  }
}
