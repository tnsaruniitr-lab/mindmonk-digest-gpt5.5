import { dbQuery } from "../db/supabase.js";
import {
  claimNextJob,
  completeJob,
  enqueueGenerateUserSummaryJob,
  failJob,
  type Job,
  type JobType,
} from "../jobs/queue.js";
import { getOutputFormat, getUserPreferences, setContextEntry, setOutputFormat } from "../services/preferences.js";
import { listUserChannels, subscribeUserToChannel, upsertChannel } from "../services/subscriptions.js";
import {
  evaluateActiveJobQuota,
  evaluateManualFetchQuota,
  getPlanLimits,
  loadUsageTotals,
  recordUsageEvent,
} from "../services/usage.js";
import type { Channel, Video } from "../types/index.js";

type CheckStatus = "pass" | "warn" | "fail";

interface CheckResult {
  label: string;
  status: CheckStatus;
  detail: string;
}

interface CliOptions {
  write: boolean;
  keep: boolean;
  runId: string;
}

interface SyntheticUser {
  id: string;
  telegramUserId: string;
  telegramChatId: string;
  plan: "free";
}

const checks: CheckResult[] = [];
const futureRunAfter = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

function parseOptions(): CliOptions {
  const envRunId = process.env.E2E_RUN_ID?.trim();
  const options: CliOptions = {
    write: process.env.E2E_WRITE === "true",
    keep: process.env.E2E_KEEP === "true",
    runId: envRunId || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  };

  for (const arg of process.argv.slice(2)) {
    if (arg === "--write") options.write = true;
    else if (arg === "--keep") options.keep = true;
    else if (arg.startsWith("--run-id=")) options.runId = arg.slice("--run-id=".length);
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(options.runId)) {
    throw new Error("--run-id may only contain letters, numbers, underscores, and hyphens");
  }

  return options;
}

function record(status: CheckStatus, label: string, detail: string): void {
  checks.push({ status, label, detail });
}

function pass(label: string, detail: string): void {
  record("pass", label, detail);
}

function warn(label: string, detail: string): void {
  record("warn", label, detail);
}

function fail(label: string, detail: string): void {
  record("fail", label, detail);
}

function assertCheck(condition: unknown, label: string, passDetail: string, failDetail: string): void {
  if (condition) pass(label, passDetail);
  else fail(label, failDetail);
}

function startOfUtcMonth(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

async function cleanup(runId: string): Promise<number> {
  const pattern = `e2e:${runId}:%`;
  let deleted = 0;

  const statements: Array<[string, unknown[]]> = [
    [
      "DELETE FROM usage_events WHERE metadata->>'runId' = $1 OR provider = $2",
      [runId, `e2e-${runId}`],
    ],
    [
      `
        DELETE FROM jobs
        WHERE idempotency_key LIKE $1
          OR payload->>'runId' = $2
          OR payload->>'userId' IN (
            SELECT id::text FROM users WHERE telegram_user_id LIKE $3
          )
          OR payload->>'videoId' IN (
            SELECT id::text FROM videos WHERE youtube_video_id = $4
          )
      `,
      [pattern, runId, `e2e-${runId}-%`, `e2e-video-${runId}`],
    ],
    [
      "DELETE FROM delivery_log WHERE telegram_chat_id LIKE $1",
      [`e2e-${runId}-%`],
    ],
    [
      "DELETE FROM user_summaries WHERE video_id IN (SELECT id FROM videos WHERE youtube_video_id = $1)",
      [`e2e-video-${runId}`],
    ],
    [
      "DELETE FROM transcripts WHERE video_id IN (SELECT id FROM videos WHERE youtube_video_id = $1)",
      [`e2e-video-${runId}`],
    ],
    ["DELETE FROM videos WHERE youtube_video_id = $1", [`e2e-video-${runId}`]],
    [
      "DELETE FROM user_channel_subscriptions WHERE user_id IN (SELECT id FROM users WHERE telegram_user_id LIKE $1)",
      [`e2e-${runId}-%`],
    ],
    ["DELETE FROM channels WHERE youtube_channel_id = $1", [`e2e-channel-${runId}`]],
    [
      "DELETE FROM user_preferences WHERE user_id IN (SELECT id FROM users WHERE telegram_user_id LIKE $1)",
      [`e2e-${runId}-%`],
    ],
    ["DELETE FROM users WHERE telegram_user_id LIKE $1", [`e2e-${runId}-%`]],
  ];

  for (const [sql, params] of statements) {
    const result = await dbQuery(sql, params);
    deleted += result.rowCount ?? 0;
  }

  return deleted;
}

async function countArtifacts(runId: string): Promise<number> {
  const result = await dbQuery<{ count: number }>(
    `
      SELECT (
        (SELECT COUNT(*) FROM users WHERE telegram_user_id LIKE $1) +
        (SELECT COUNT(*) FROM channels WHERE youtube_channel_id = $2) +
        (SELECT COUNT(*) FROM videos WHERE youtube_video_id = $3) +
        (SELECT COUNT(*) FROM jobs WHERE idempotency_key LIKE $4 OR payload->>'runId' = $5 OR payload->>'userId' IN (SELECT id::text FROM users WHERE telegram_user_id LIKE $1) OR payload->>'videoId' IN (SELECT id::text FROM videos WHERE youtube_video_id = $3)) +
        (SELECT COUNT(*) FROM usage_events WHERE metadata->>'runId' = $5 OR provider = $6)
      )::int AS count
    `,
    [
      `e2e-${runId}-%`,
      `e2e-channel-${runId}`,
      `e2e-video-${runId}`,
      `e2e:${runId}:%`,
      runId,
      `e2e-${runId}`,
    ]
  );

  return result.rows[0]?.count ?? 0;
}

async function createSyntheticUser(runId: string, suffix: "a" | "b"): Promise<SyntheticUser> {
  const telegramUserId = `e2e-${runId}-${suffix}`;
  const telegramChatId = `e2e-${runId}-chat-${suffix}`;
  const result = await dbQuery<{ id: string }>(
    `
      INSERT INTO users (
        telegram_user_id,
        telegram_chat_id,
        username,
        display_name,
        plan,
        status,
        last_seen_at
      )
      VALUES ($1, $2, $3, $4, 'free', 'active', now())
      RETURNING id
    `,
    [
      telegramUserId,
      telegramChatId,
      `e2e_${runId}_${suffix}`,
      `E2E ${runId} ${suffix.toUpperCase()}`,
    ]
  );

  const id = result.rows[0]?.id;
  if (!id) throw new Error(`Failed to create synthetic user ${suffix}`);
  return { id, telegramUserId, telegramChatId, plan: "free" };
}

async function checkIdentityAndPreferences(userA: SyntheticUser, userB: SyntheticUser): Promise<void> {
  await setOutputFormat(`format-a-${userA.telegramUserId}`, userA.id);
  await setOutputFormat(`format-b-${userB.telegramUserId}`, userB.id);
  await setContextEntry(userA.id, "profile", `context-a-${userA.telegramUserId}`);
  await setContextEntry(userB.id, "profile", `context-b-${userB.telegramUserId}`);

  const [formatA, formatB, preferencesA, preferencesB] = await Promise.all([
    getOutputFormat(userA.id),
    getOutputFormat(userB.id),
    getUserPreferences(userA.id),
    getUserPreferences(userB.id),
  ]);

  assertCheck(
    formatA?.includes(userA.telegramUserId) && formatB?.includes(userB.telegramUserId),
    "identity.output_format_isolation",
    "two users have distinct output formats",
    `unexpected formats: A=${formatA ?? "null"}, B=${formatB ?? "null"}`
  );

  const contextA = preferencesA.personalContext.map((entry) => entry.context).join("\n");
  const contextB = preferencesB.personalContext.map((entry) => entry.context).join("\n");
  assertCheck(
    contextA.includes(userA.telegramUserId) && contextB.includes(userB.telegramUserId),
    "identity.profile_isolation",
    "two users have distinct profile context",
    `unexpected context: A=${contextA || "empty"}, B=${contextB || "empty"}`
  );
}

async function checkSubscriptions(runId: string, userA: SyntheticUser, userB: SyntheticUser): Promise<Channel> {
  const channel = await upsertChannel({
    youtubeChannelId: `e2e-channel-${runId}`,
    name: `E2E Channel ${runId}`,
    rssFeedUrl: `https://example.com/e2e/${runId}.xml`,
    defaultCategory: "tech_ai_startup",
  });

  if (!channel) throw new Error("Failed to create synthetic channel");

  const [subscribedA, subscribedADuplicate, subscribedB] = await Promise.all([
    subscribeUserToChannel(userA.id, channel.id, "tech_ai_startup"),
    subscribeUserToChannel(userA.id, channel.id, "tech_ai_startup"),
    subscribeUserToChannel(userB.id, channel.id, "tech_ai_startup"),
  ]);

  assertCheck(
    subscribedA && subscribedADuplicate && subscribedB,
    "subscriptions.upsert",
    "subscription upserts succeeded",
    "one or more subscription upserts failed"
  );

  const [channelsA, channelsB, count] = await Promise.all([
    listUserChannels(userA.id),
    listUserChannels(userB.id),
    dbQuery<{ count: number }>(
      `
        SELECT COUNT(*)::int AS count
        FROM user_channel_subscriptions
        WHERE channel_id = $1
          AND active = true
      `,
      [channel.id]
    ),
  ]);

  assertCheck(
    channelsA.filter((row) => row.channel.id === channel.id).length === 1 &&
      channelsB.filter((row) => row.channel.id === channel.id).length === 1 &&
      count.rows[0]?.count === 2,
    "subscriptions.multiuser_dedupe",
    "shared channel has two active user subscriptions and no duplicate for user A",
    `subscription count=${count.rows[0]?.count ?? "missing"}`
  );

  return channel;
}

async function createVideo(runId: string, channel: Channel): Promise<Video> {
  const result = await dbQuery<Video>(
    `
      INSERT INTO videos (
        channel_id,
        youtube_video_id,
        title,
        published_at,
        duration_seconds,
        processed,
        category,
        transcript_status
      )
      VALUES ($1, $2, $3, now(), 300, false, 'tech_ai_startup', 'pending')
      RETURNING *
    `,
    [channel.id, `e2e-video-${runId}`, `E2E Video ${runId}`]
  );

  const video = result.rows[0];
  if (!video) throw new Error("Failed to create synthetic video");
  return video;
}

async function checkTranscriptAndSummaries(
  runId: string,
  video: Video,
  userA: SyntheticUser,
  userB: SyntheticUser
): Promise<void> {
  const transcriptResult = await dbQuery<{ id: string }>(
    `
      INSERT INTO transcripts (
        video_id,
        provider,
        source,
        language,
        text,
        char_count,
        duration_seconds,
        cost_usd
      )
      VALUES ($1, $2, 'captions', 'en', $3, length($3), 300, 0)
      ON CONFLICT (video_id, language)
      DO UPDATE SET
        text = EXCLUDED.text,
        char_count = EXCLUDED.char_count,
        updated_at = now()
      RETURNING id
    `,
    [video.id, `e2e-${runId}`, `canonical transcript for ${runId}`]
  );
  await dbQuery(
    `
      INSERT INTO transcripts (
        video_id,
        provider,
        source,
        language,
        text,
        char_count,
        duration_seconds,
        cost_usd
      )
      VALUES ($1, $2, 'captions', 'en', $3, length($3), 300, 0)
      ON CONFLICT (video_id, language)
      DO UPDATE SET
        text = EXCLUDED.text,
        char_count = EXCLUDED.char_count,
        updated_at = now()
    `,
    [video.id, `e2e-${runId}`, `canonical transcript updated for ${runId}`]
  );

  const transcriptCount = await dbQuery<{ count: number; text: string }>(
    `
      SELECT COUNT(*)::int AS count, MAX(text) AS text
      FROM transcripts
      WHERE video_id = $1
        AND language = 'en'
    `,
    [video.id]
  );
  assertCheck(
    transcriptCount.rows[0]?.count === 1 &&
      transcriptCount.rows[0]?.text === `canonical transcript updated for ${runId}`,
    "transcript.canonical",
    "one canonical transcript per video/language",
    `transcript count=${transcriptCount.rows[0]?.count ?? "missing"}`
  );

  const transcriptId = transcriptResult.rows[0]?.id;
  if (!transcriptId) throw new Error("Synthetic transcript id missing");

  await dbQuery(
    `
      INSERT INTO user_summaries (
        user_id,
        video_id,
        transcript_id,
        tldr,
        key_learnings,
        applicable_to_me,
        action_items,
        quotable_moments,
        skip_assessment,
        model_used,
        tokens_used
      )
      VALUES ($1, $2, $3, $4, ARRAY['k1'], ARRAY['a1'], ARRAY['do1'], ARRAY['q1'], 'keep', 'e2e', 1)
      ON CONFLICT (user_id, video_id)
      DO UPDATE SET tldr = EXCLUDED.tldr, updated_at = now()
    `,
    [userA.id, video.id, transcriptId, `summary-a-${runId}`]
  );
  await dbQuery(
    `
      INSERT INTO user_summaries (
        user_id,
        video_id,
        transcript_id,
        tldr,
        key_learnings,
        applicable_to_me,
        action_items,
        quotable_moments,
        skip_assessment,
        model_used,
        tokens_used
      )
      VALUES ($1, $2, $3, $4, ARRAY['k2'], ARRAY['a2'], ARRAY['do2'], ARRAY['q2'], 'keep', 'e2e', 1)
      ON CONFLICT (user_id, video_id)
      DO UPDATE SET tldr = EXCLUDED.tldr, updated_at = now()
    `,
    [userB.id, video.id, transcriptId, `summary-b-${runId}`]
  );
  await dbQuery(
    `
      INSERT INTO user_summaries (
        user_id,
        video_id,
        transcript_id,
        tldr,
        key_learnings,
        applicable_to_me,
        action_items,
        quotable_moments,
        skip_assessment,
        model_used,
        tokens_used
      )
      VALUES ($1, $2, $3, $4, ARRAY['k1-new'], ARRAY['a1'], ARRAY['do1'], ARRAY['q1'], 'keep', 'e2e', 2)
      ON CONFLICT (user_id, video_id)
      DO UPDATE SET tldr = EXCLUDED.tldr, updated_at = now()
    `,
    [userA.id, video.id, transcriptId, `summary-a-updated-${runId}`]
  );

  const summaries = await dbQuery<{ count: number; user_a_tldr: string | null; user_b_tldr: string | null }>(
    `
      SELECT
        COUNT(*)::int AS count,
        MAX(tldr) FILTER (WHERE user_id = $2) AS user_a_tldr,
        MAX(tldr) FILTER (WHERE user_id = $3) AS user_b_tldr
      FROM user_summaries
      WHERE video_id = $1
    `,
    [video.id, userA.id, userB.id]
  );
  const row = summaries.rows[0];
  assertCheck(
    row?.count === 2 &&
      row.user_a_tldr === `summary-a-updated-${runId}` &&
      row.user_b_tldr === `summary-b-${runId}`,
    "summaries.per_user_cache",
    "per-user summaries are isolated and idempotent",
    `count=${row?.count ?? "missing"}, A=${row?.user_a_tldr ?? "missing"}, B=${row?.user_b_tldr ?? "missing"}`
  );
}

async function checkUsageAndQuotas(runId: string, video: Video, userA: SyntheticUser, userB: SyntheticUser): Promise<void> {
  const limits = getPlanLimits("free");
  for (let index = 0; index < limits.manualFetchesPerMonth; index++) {
    await recordUsageEvent({
      userId: userA.id,
      videoId: video.id,
      eventType: "manual_fetch",
      provider: `e2e-${runId}`,
      quantity: 1,
      unit: "fetch",
      metadata: { runId, index },
    });
  }

  await recordUsageEvent({
    userId: userA.id,
    videoId: video.id,
    eventType: "llm_tokens",
    provider: `e2e-${runId}`,
    quantity: 1234,
    unit: "tokens",
    estimatedCostUsd: 0.0123,
    metadata: { runId },
  });

  const [usageA, usageB, quotaA, quotaB] = await Promise.all([
    loadUsageTotals(userA.id, startOfUtcMonth()),
    loadUsageTotals(userB.id, startOfUtcMonth()),
    evaluateManualFetchQuota(userA, video),
    evaluateManualFetchQuota(userB, video),
  ]);

  assertCheck(
    usageA.manualFetches >= limits.manualFetchesPerMonth &&
      usageA.llmTokens >= 1234 &&
      usageB.manualFetches === 0,
    "usage.per_user_totals",
    "usage totals are isolated by user",
    `A fetches=${usageA.manualFetches}, A tokens=${usageA.llmTokens}, B fetches=${usageB.manualFetches}`
  );

  assertCheck(
    !quotaA.allowed && quotaB.allowed,
    "quotas.manual_fetch",
    "manual fetch quota blocks only the saturated user",
    `A allowed=${quotaA.allowed}, B allowed=${quotaB.allowed}`
  );

  for (let index = 0; index < limits.maxActiveJobs; index++) {
    await dbQuery(
      `
        INSERT INTO jobs (
          type,
          payload,
          idempotency_key,
          priority,
          max_attempts,
          run_after
        )
        VALUES ('generate_user_summary', $1::jsonb, $2, 900, 1, $3)
      `,
      [
        JSON.stringify({
          videoId: video.id,
          userId: userA.id,
          telegramChatId: userA.telegramChatId,
          runId,
          index,
        }),
        `e2e:${runId}:active-quota:${index}`,
        futureRunAfter.toISOString(),
      ]
    );
  }

  const [activeA, activeB] = await Promise.all([
    evaluateActiveJobQuota(userA),
    evaluateActiveJobQuota(userB),
  ]);

  assertCheck(
    !activeA.allowed && activeB.allowed,
    "quotas.active_jobs",
    "active job quota blocks only the saturated user",
    `A allowed=${activeA.allowed}, B allowed=${activeB.allowed}`
  );
}

async function checkQueueSemantics(runId: string, video: Video, userB: SyntheticUser): Promise<void> {
  await enqueueGenerateUserSummaryJob(video.id, {
    userId: userB.id,
    telegramChatId: userB.telegramChatId,
    priority: 80,
    runAfter: futureRunAfter,
  });
  await enqueueGenerateUserSummaryJob(video.id, {
    userId: userB.id,
    telegramChatId: userB.telegramChatId,
    priority: 40,
    runAfter: futureRunAfter,
  });

  const idempotent = await dbQuery<{ count: number; priority: number }>(
    `
      SELECT COUNT(*)::int AS count, MIN(priority)::int AS priority
      FROM jobs
      WHERE idempotency_key = $1
    `,
    [`generate_user_summary:${video.id}:${userB.id}`]
  );
  assertCheck(
    idempotent.rows[0]?.count === 1 && idempotent.rows[0]?.priority === 40,
    "queue.idempotency",
    "duplicate summary enqueue collapses to one higher-priority job",
    `count=${idempotent.rows[0]?.count ?? "missing"}, priority=${idempotent.rows[0]?.priority ?? "missing"}`
  );

  await dbQuery(
    `
      INSERT INTO jobs (type, payload, idempotency_key, priority, max_attempts, run_after)
      VALUES ('e2e_regression', $1::jsonb, $2, 1, 3, now())
    `,
    [JSON.stringify({ runId, stage: "complete" }), `e2e:${runId}:claim-complete`]
  );

  const claimed = await claimNextJob(["e2e_regression" as JobType]);
  assertCheck(
    Boolean(claimed) &&
      String(claimed?.type) === "e2e_regression" &&
      claimed?.status === "processing" &&
      claimed?.attempts === 1,
    "queue.claim",
    "synthetic due job can be claimed and leased",
    `claimed=${claimed ? `${claimed.type}/${claimed.status}/${claimed.attempts}` : "none"}`
  );
  if (claimed) {
    await completeJob(claimed.id);
    const completed = await dbQuery<{ status: string }>("SELECT status FROM jobs WHERE id = $1", [claimed.id]);
    assertCheck(
      completed.rows[0]?.status === "succeeded",
      "queue.complete",
      "completeJob marks job succeeded",
      `status=${completed.rows[0]?.status ?? "missing"}`
    );
  }

  await dbQuery(
    `
      INSERT INTO jobs (type, payload, idempotency_key, priority, max_attempts, run_after)
      VALUES ('e2e_regression', $1::jsonb, $2, 1, 1, now())
    `,
    [JSON.stringify({ runId, stage: "dead-letter" }), `e2e:${runId}:claim-dead`]
  );

  const toFail = await claimNextJob(["e2e_regression" as JobType]);
  if (toFail) await failJob(toFail as Job, new Error(`e2e-regression-${runId}`));
  const failedJob = await dbQuery<{ status: string; last_error: string | null }>(
    "SELECT status, last_error FROM jobs WHERE idempotency_key = $1",
    [`e2e:${runId}:claim-dead`]
  );
  assertCheck(
    failedJob.rows[0]?.status === "dead" &&
      Boolean(failedJob.rows[0]?.last_error?.includes(`e2e-regression-${runId}`)),
    "queue.dead_letter",
    "max-attempt failure is dead-lettered with error",
    `status=${failedJob.rows[0]?.status ?? "missing"}`
  );
}

function printResults(runId: string): void {
  console.log(`E2E regression run: ${runId}`);
  console.log("");
  for (const check of checks) {
    const icon = check.status === "pass" ? "PASS" : check.status === "warn" ? "WARN" : "FAIL";
    console.log(`${icon.padEnd(4)} ${check.label.padEnd(34)} ${check.detail}`);
  }

  const failed = checks.filter((check) => check.status === "fail").length;
  const warned = checks.filter((check) => check.status === "warn").length;
  console.log("");
  console.log(`E2E regression: ${failed ? "FAIL" : warned ? "WARN" : "PASS"} (${failed} fail, ${warned} warn)`);
}

async function main(): Promise<number> {
  const options = parseOptions();

  if (!options.write) {
    console.log("Dry run only. Re-run with --write or E2E_WRITE=true to create/delete synthetic regression data.");
    return 0;
  }

  await cleanup(options.runId);

  try {
    const [userA, userB] = await Promise.all([
      createSyntheticUser(options.runId, "a"),
      createSyntheticUser(options.runId, "b"),
    ]);
    await checkIdentityAndPreferences(userA, userB);
    const channel = await checkSubscriptions(options.runId, userA, userB);
    const video = await createVideo(options.runId, channel);
    await checkTranscriptAndSummaries(options.runId, video, userA, userB);
    await checkUsageAndQuotas(options.runId, video, userA, userB);
    await checkQueueSemantics(options.runId, video, userB);
  } catch (err) {
    fail("e2e.exception", err instanceof Error ? err.message : String(err));
  } finally {
    if (options.keep) {
      warn("cleanup.skipped", `synthetic artifacts kept for run ${options.runId}`);
    } else {
      const deleted = await cleanup(options.runId);
      const remaining = await countArtifacts(options.runId);
      if (remaining === 0) pass("cleanup.synthetic_artifacts", `deleted=${deleted}, remaining=0`);
      else fail("cleanup.synthetic_artifacts", `deleted=${deleted}, remaining=${remaining}`);
    }
  }

  printResults(options.runId);
  return checks.some((check) => check.status === "fail") ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("FAIL e2e.regression", err);
    process.exit(1);
  });
