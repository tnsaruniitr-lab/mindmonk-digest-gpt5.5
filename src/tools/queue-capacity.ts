import { dbQuery } from "../db/supabase.js";

interface CliOptions {
  jobs: number;
  write: boolean;
  cleanupOnly: boolean;
}

function parseOptions(): CliOptions {
  const options: CliOptions = {
    jobs: Number(process.env.SCALE_TEST_JOBS || 1000),
    write: process.env.SCALE_TEST_WRITE === "true",
    cleanupOnly: false,
  };

  for (const arg of process.argv.slice(2)) {
    if (arg === "--write") options.write = true;
    else if (arg === "--cleanup-only") options.cleanupOnly = true;
    else if (arg.startsWith("--jobs=")) options.jobs = Number(arg.slice("--jobs=".length));
  }

  if (!Number.isInteger(options.jobs) || options.jobs < 1 || options.jobs > 10_000) {
    throw new Error("--jobs must be an integer from 1 to 10000");
  }

  return options;
}

function ms(startedAt: bigint): number {
  return Math.round(Number(process.hrtime.bigint() - startedAt) / 1_000_000);
}

async function cleanup(runId: string): Promise<number> {
  const result = await dbQuery<{ count: number }>(
    `
      WITH deleted AS (
        DELETE FROM jobs
        WHERE idempotency_key LIKE $1
        RETURNING 1
      )
      SELECT COUNT(*)::int AS count FROM deleted
    `,
    [`scale_test:${runId}:%`]
  );
  return result.rows[0]?.count ?? 0;
}

async function cleanupOldSyntheticJobs(): Promise<number> {
  const result = await dbQuery<{ count: number }>(
    `
      WITH deleted AS (
        DELETE FROM jobs
        WHERE idempotency_key LIKE 'scale_test:%'
          AND created_at < now() - interval '1 hour'
        RETURNING 1
      )
      SELECT COUNT(*)::int AS count FROM deleted
    `
  );
  return result.rows[0]?.count ?? 0;
}

async function main(): Promise<number> {
  const options = parseOptions();
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  console.log(`Queue capacity target: ${options.jobs.toLocaleString("en-US")} synthetic jobs`);
  console.log("Synthetic jobs use run_after=+7 days and are deleted before exit.");

  const oldDeleted = await cleanupOldSyntheticJobs();
  if (oldDeleted) console.log(`Cleaned ${oldDeleted} old synthetic job(s).`);

  if (options.cleanupOnly) return 0;

  if (!options.write) {
    console.log("Dry run only. Re-run with --write or SCALE_TEST_WRITE=true to insert/delete synthetic jobs.");
    return 0;
  }

  const startedAt = process.hrtime.bigint();
  let inserted = 0;

  try {
    const insertStartedAt = process.hrtime.bigint();
    const result = await dbQuery<{ count: number }>(
      `
        WITH payloads AS (
          SELECT
            generate_series(1, $1::int) AS index,
            now() + interval '7 days' AS run_after
        ),
        inserted AS (
          INSERT INTO jobs (
            type,
            payload,
            idempotency_key,
            priority,
            max_attempts,
            run_after
          )
          SELECT
            'fetch_transcript',
            jsonb_build_object(
              'videoId', '00000000-0000-0000-0000-000000000000',
              'synthetic', true,
              'runId', $2,
              'index', payloads.index
            ),
            'scale_test:' || $2 || ':' || payloads.index,
            9999,
            1,
            payloads.run_after
          FROM payloads
          ON CONFLICT (idempotency_key) DO NOTHING
          RETURNING 1
        )
        SELECT COUNT(*)::int AS count FROM inserted
      `,
      [options.jobs, runId]
    );

    inserted = result.rows[0]?.count ?? 0;
    const insertMs = ms(insertStartedAt);
    const insertedPerSecond = insertMs > 0 ? Math.round((inserted / insertMs) * 1000) : inserted;
    console.log(`Inserted ${inserted}/${options.jobs} synthetic job(s) in ${insertMs}ms (${insertedPerSecond}/s).`);

    if (inserted !== options.jobs) {
      console.log("FAIL queue.capacity inserted count mismatch");
      return 1;
    }

    const count = await dbQuery<{ count: number }>(
      "SELECT COUNT(*)::int AS count FROM jobs WHERE idempotency_key LIKE $1",
      [`scale_test:${runId}:%`]
    );
    if ((count.rows[0]?.count ?? 0) !== options.jobs) {
      console.log("FAIL queue.capacity verification count mismatch");
      return 1;
    }

    console.log(`PASS queue.capacity verified ${options.jobs} queued synthetic job(s).`);
    return 0;
  } finally {
    if (inserted > 0) {
      const cleanupStartedAt = process.hrtime.bigint();
      const deleted = await cleanup(runId);
      console.log(`Cleaned ${deleted} synthetic job(s) in ${ms(cleanupStartedAt)}ms.`);
    }
    console.log(`Total queue capacity check time: ${ms(startedAt)}ms`);
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("FAIL queue.capacity", err);
    process.exit(1);
  });
