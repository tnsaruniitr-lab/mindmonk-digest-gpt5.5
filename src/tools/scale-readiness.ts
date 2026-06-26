import { config } from "../config.js";
import { dbQuery } from "../db/supabase.js";

const requiredTables = [
  "users",
  "user_preferences",
  "user_channel_subscriptions",
  "channels",
  "videos",
  "transcripts",
  "user_summaries",
  "delivery_log",
  "jobs",
  "usage_events",
];

const requiredIndexes = [
  "idx_users_telegram_user_id",
  "idx_user_channel_subscriptions_user_id",
  "idx_user_channel_subscriptions_channel_id",
  "idx_transcripts_video_id",
  "idx_user_summaries_user_video",
  "idx_jobs_status_run_after",
  "idx_jobs_locked_until",
  "idx_usage_events_user_created",
];

interface CheckResult {
  label: string;
  status: "pass" | "warn" | "fail";
  detail: string;
}

const checks: CheckResult[] = [];

function pass(label: string, detail: string): void {
  checks.push({ label, status: "pass", detail });
}

function warn(label: string, detail: string): void {
  checks.push({ label, status: "warn", detail });
}

function fail(label: string, detail: string): void {
  checks.push({ label, status: "fail", detail });
}

function fmt(value: unknown): string {
  return typeof value === "number" ? value.toLocaleString("en-US") : String(value);
}

async function checkSchema(): Promise<void> {
  const tables = await dbQuery<{ table_name: string }>(
    `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY($1::text[])
    `,
    [requiredTables]
  );
  const presentTables = new Set(tables.rows.map((row) => row.table_name));
  const missingTables = requiredTables.filter((table) => !presentTables.has(table));

  if (missingTables.length) fail("schema.tables", `Missing: ${missingTables.join(", ")}`);
  else pass("schema.tables", `${requiredTables.length} required tables present`);

  const indexes = await dbQuery<{ indexname: string }>(
    `
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = ANY($1::text[])
    `,
    [requiredIndexes]
  );
  const presentIndexes = new Set(indexes.rows.map((row) => row.indexname));
  const missingIndexes = requiredIndexes.filter((index) => !presentIndexes.has(index));

  if (missingIndexes.length) fail("schema.indexes", `Missing: ${missingIndexes.join(", ")}`);
  else pass("schema.indexes", `${requiredIndexes.length} critical indexes present`);
}

function checkEnvironment(): void {
  pass("env.role", `SERVICE_ROLE=${config.SERVICE_ROLE}`);

  if (config.SERVICE_ROLE === "web" && config.BOT_MODE !== "webhook") {
    warn("env.webhook", "Scale web service should use BOT_MODE=webhook");
  } else {
    pass("env.webhook", `BOT_MODE=${config.BOT_MODE}`);
  }

  if (!config.ADMIN_METRICS_TOKEN) {
    warn("env.metrics", "ADMIN_METRICS_TOKEN is not set, so /metrics is unavailable");
  } else {
    pass("env.metrics", "/metrics is protected by ADMIN_METRICS_TOKEN");
  }

  const caps = [
    ["GLOBAL_DAILY_TRANSCRIPTION_MINUTES_CAP", config.GLOBAL_DAILY_TRANSCRIPTION_MINUTES_CAP],
    ["GLOBAL_DAILY_LLM_TOKENS_CAP", config.GLOBAL_DAILY_LLM_TOKENS_CAP],
    ["GLOBAL_DAILY_ESTIMATED_COST_CAP_USD", config.GLOBAL_DAILY_ESTIMATED_COST_CAP_USD],
  ] as const;

  for (const [name, value] of caps) {
    if (value <= 0) warn(`env.${name}`, "disabled");
    else pass(`env.${name}`, fmt(value));
  }
}

async function checkDataAndQueue(): Promise<void> {
  const counts = await dbQuery<{
    users: number;
    active_subscriptions: number;
    videos: number;
    transcripts: number;
  }>(
    `
      SELECT
        (SELECT COUNT(*)::int FROM users) AS users,
        (SELECT COUNT(*)::int FROM user_channel_subscriptions WHERE active = true) AS active_subscriptions,
        (SELECT COUNT(*)::int FROM videos) AS videos,
        (SELECT COUNT(*)::int FROM transcripts) AS transcripts
    `
  );
  const row = counts.rows[0];

  pass(
    "data.counts",
    `users=${row?.users ?? 0}, subscriptions=${row?.active_subscriptions ?? 0}, videos=${row?.videos ?? 0}, transcripts=${row?.transcripts ?? 0}`
  );

  const jobs = await dbQuery<{ status: string; count: number }>(
    "SELECT status, COUNT(*)::int AS count FROM jobs GROUP BY status"
  );
  const jobCounts = Object.fromEntries(jobs.rows.map((job) => [job.status, job.count]));
  const dead = Number(jobCounts.dead ?? 0);
  const failed = Number(jobCounts.failed ?? 0);

  if (dead > 0) fail("queue.dead_jobs", `${dead} dead job(s) need review`);
  else if (failed > 0) warn("queue.failed_jobs", `${failed} failed job(s) present`);
  else pass("queue.failures", "No failed/dead jobs");

  const oldest = await dbQuery<{ oldest_queued_seconds: number | null }>(
    `
      SELECT EXTRACT(EPOCH FROM (now() - MIN(created_at)))::int AS oldest_queued_seconds
      FROM jobs
      WHERE status = 'queued'
    `
  );
  const age = oldest.rows[0]?.oldest_queued_seconds;
  if (age && age > 3600) warn("queue.age", `Oldest queued job is ${age}s old`);
  else pass("queue.age", age ? `Oldest queued job is ${age}s old` : "No queued jobs");
}

function printResults(): void {
  for (const check of checks) {
    const icon = check.status === "pass" ? "PASS" : check.status === "warn" ? "WARN" : "FAIL";
    console.log(`${icon.padEnd(4)} ${check.label.padEnd(38)} ${check.detail}`);
  }

  const failed = checks.filter((check) => check.status === "fail").length;
  const warned = checks.filter((check) => check.status === "warn").length;
  console.log("");
  console.log(`Scale readiness: ${failed ? "FAIL" : warned ? "WARN" : "PASS"} (${failed} fail, ${warned} warn)`);
}

async function main(): Promise<number> {
  checkEnvironment();
  await checkSchema();
  await checkDataAndQueue();
  printResults();
  return checks.some((check) => check.status === "fail") ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("FAIL scale.check", err);
    process.exit(1);
  });
