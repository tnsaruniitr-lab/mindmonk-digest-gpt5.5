import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { dbQuery } from "../db/supabase.js";
import { log } from "../utils/logger.js";

export type JobStatus = "queued" | "processing" | "succeeded" | "failed" | "dead";
export type JobType = "process_video";

export interface Job<TPayload = any> {
  id: string;
  type: JobType;
  status: JobStatus;
  priority: number;
  run_after: string;
  locked_by: string | null;
  locked_until: string | null;
  attempts: number;
  max_attempts: number;
  payload: TPayload;
  idempotency_key: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProcessVideoJobPayload {
  videoId: string;
}

export const workerId = `worker-${randomUUID()}`;

export async function enqueueJob(
  type: JobType,
  payload: Record<string, unknown>,
  options: {
    idempotencyKey?: string;
    priority?: number;
    maxAttempts?: number;
    runAfter?: Date;
  } = {}
): Promise<Job | null> {
  const result = await dbQuery<Job>(
    `
      INSERT INTO jobs (
        type,
        payload,
        idempotency_key,
        priority,
        max_attempts,
        run_after
      )
      VALUES ($1, $2::jsonb, $3, $4, $5, $6)
      ON CONFLICT (idempotency_key)
      DO UPDATE SET
        payload = EXCLUDED.payload,
        priority = LEAST(jobs.priority, EXCLUDED.priority),
        status = CASE
          WHEN jobs.status IN ('succeeded', 'processing') THEN jobs.status
          ELSE 'queued'
        END,
        run_after = CASE
          WHEN jobs.status IN ('succeeded', 'processing') THEN jobs.run_after
          ELSE LEAST(jobs.run_after, EXCLUDED.run_after)
        END,
        updated_at = now()
      RETURNING *
    `,
    [
      type,
      JSON.stringify(payload),
      options.idempotencyKey ?? null,
      options.priority ?? 100,
      options.maxAttempts ?? 5,
      options.runAfter?.toISOString() ?? new Date().toISOString(),
    ]
  );

  return result.rows[0] ?? null;
}

export function processVideoIdempotencyKey(videoId: string): string {
  return `process_video:${videoId}`;
}

export async function enqueueProcessVideoJob(videoId: string, priority = 100): Promise<Job | null> {
  return enqueueJob(
    "process_video",
    { videoId } satisfies ProcessVideoJobPayload,
    {
      idempotencyKey: processVideoIdempotencyKey(videoId),
      priority,
      maxAttempts: 5,
    }
  );
}

export async function claimNextJob(): Promise<Job | null> {
  const result = await dbQuery<Job>(
    `
      WITH next_job AS (
        SELECT id
        FROM jobs
        WHERE
          (
            status = 'queued'
            AND run_after <= now()
          )
          OR (
            status = 'processing'
            AND locked_until < now()
          )
        ORDER BY priority ASC, created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE jobs
      SET
        status = 'processing',
        locked_by = $1,
        locked_until = now() + ($2::int * interval '1 second'),
        attempts = attempts + 1,
        updated_at = now()
      WHERE id = (SELECT id FROM next_job)
      RETURNING *
    `,
    [workerId, config.JOB_LOCK_SECONDS]
  );

  return result.rows[0] ?? null;
}

export async function completeJob(jobId: string): Promise<void> {
  await dbQuery(
    `
      UPDATE jobs
      SET status = 'succeeded',
          locked_by = null,
          locked_until = null,
          last_error = null,
          updated_at = now()
      WHERE id = $1
    `,
    [jobId]
  );
}

export async function failJob(job: Job, err: unknown): Promise<void> {
  const message = truncateError(err);
  const shouldDeadLetter = job.attempts >= job.max_attempts;
  const retryDelaySeconds = retryDelayForAttempt(job.attempts);

  await dbQuery(
    `
      UPDATE jobs
      SET status = $2,
          locked_by = null,
          locked_until = null,
          last_error = $3,
          run_after = CASE
            WHEN $2 = 'dead' THEN run_after
            ELSE now() + ($4::int * interval '1 second')
          END,
          updated_at = now()
      WHERE id = $1
    `,
    [job.id, shouldDeadLetter ? "dead" : "queued", message, retryDelaySeconds]
  );

  log.warn(
    "jobs",
    `${shouldDeadLetter ? "Dead-lettered" : "Retrying"} ${job.type} ${job.id}: ${message}`
  );
}

export async function getJobCounts(): Promise<Record<string, number>> {
  const result = await dbQuery<{ status: string; count: number }>(
    `SELECT status, COUNT(*)::int AS count FROM jobs GROUP BY status`
  );

  return Object.fromEntries(result.rows.map((row) => [row.status, row.count]));
}

function retryDelayForAttempt(attempt: number): number {
  const exponential = config.JOB_RETRY_BASE_SECONDS * Math.pow(2, Math.max(0, attempt - 1));
  return Math.min(exponential, 60 * 60);
}

function truncateError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.slice(0, 2000);
}
