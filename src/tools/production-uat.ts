type CheckStatus = "pass" | "warn" | "fail";

interface CheckResult {
  label: string;
  status: CheckStatus;
  detail: string;
}

interface HttpResult {
  status: number;
  json: Record<string, unknown> | null;
  text: string;
}

const checks: CheckResult[] = [];
const baseUrl = (
  process.env.PRODUCTION_BASE_URL ||
  process.env.MINDMONK_BASE_URL ||
  "https://mindmonk-digest-gpt55-production.up.railway.app"
).replace(/\/$/, "");
const expectedRole = process.env.EXPECTED_WEB_ROLE || "web";
const maxQueuedAgeSeconds = Number(process.env.MAX_QUEUED_AGE_SECONDS || 3600);
const maxDeadJobs = Number(process.env.MAX_DEAD_JOBS || 0);

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

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

async function request(path: string, init: RequestInit = {}): Promise<HttpResult> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let json: Record<string, unknown> | null = null;

  if (text) {
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      json = null;
    }
  }

  return { status: response.status, json, text };
}

async function checkHealth(): Promise<void> {
  const health = await request("/health");
  if (health.status !== 200 || health.json?.status !== "ok") {
    fail("http.health", `Expected 200 ok, got ${health.status}`);
    return;
  }

  pass("http.health", `status=ok, uptime=${health.json.uptime_seconds ?? "unknown"}s`);

  if (health.json.role === expectedRole) {
    pass("service.role", `role=${expectedRole}`);
  } else {
    fail(
      "service.role",
      `Expected public service role=${expectedRole}, got ${String(health.json.role ?? "missing")}`
    );
  }
}

async function checkReady(): Promise<void> {
  const ready = await request("/ready");
  if (ready.status !== 200 || ready.json?.status !== "ok" || ready.json?.db !== "ok") {
    fail("http.ready", `Expected 200 db=ok, got ${ready.status}`);
    return;
  }

  const jobs = asObject(ready.json.jobs);
  pass("http.ready", `db=ok, jobs=${JSON.stringify(jobs)}`);
}

async function checkMetricsAuth(): Promise<Record<string, unknown> | null> {
  const unauthenticated = await request("/metrics");
  if (unauthenticated.status === 401) {
    pass("metrics.auth", "unauthenticated request rejected");
  } else {
    fail("metrics.auth", `Expected 401 without token, got ${unauthenticated.status}`);
  }

  const token = process.env.ADMIN_METRICS_TOKEN;
  if (!token) {
    warn("metrics.token", "ADMIN_METRICS_TOKEN not present locally; skipped authenticated metrics check");
    return null;
  }

  const metrics = await request("/metrics", {
    headers: { authorization: `Bearer ${token}` },
  });
  if (metrics.status !== 200 || !metrics.json) {
    fail("metrics.read", `Expected 200 JSON with token, got ${metrics.status}`);
    return null;
  }

  pass(
    "metrics.read",
    `users=${metrics.json.users ?? "unknown"}, subscriptions=${metrics.json.active_subscriptions ?? "unknown"}`
  );
  return metrics.json;
}

function checkQueueMetrics(metrics: Record<string, unknown> | null): void {
  if (!metrics) return;

  const jobs = asObject(metrics.jobs);
  const dead = asNumber(jobs.dead);
  const failed = asNumber(jobs.failed);
  const queued = asNumber(jobs.queued);
  const processing = asNumber(jobs.processing);
  const oldestQueuedSeconds = asNumber(metrics.oldest_queued_seconds);

  if (dead > maxDeadJobs) {
    fail("queue.dead", `dead=${dead}, allowed=${maxDeadJobs}`);
  } else {
    pass("queue.dead", `dead=${dead}`);
  }

  if (failed > 0) warn("queue.failed", `failed=${failed}`);
  else pass("queue.failed", "failed=0");

  if (oldestQueuedSeconds > maxQueuedAgeSeconds) {
    warn("queue.age", `oldest queued job is ${oldestQueuedSeconds}s`);
  } else {
    pass(
      "queue.age",
      queued ? `queued=${queued}, processing=${processing}, oldest=${oldestQueuedSeconds}s` : "no queued jobs"
    );
  }
}

function printResults(): void {
  console.log(`Production UAT target: ${baseUrl}`);
  console.log("");
  for (const check of checks) {
    const icon = check.status === "pass" ? "PASS" : check.status === "warn" ? "WARN" : "FAIL";
    console.log(`${icon.padEnd(4)} ${check.label.padEnd(24)} ${check.detail}`);
  }

  const failed = checks.filter((check) => check.status === "fail").length;
  const warned = checks.filter((check) => check.status === "warn").length;
  console.log("");
  console.log(`Production UAT: ${failed ? "FAIL" : warned ? "WARN" : "PASS"} (${failed} fail, ${warned} warn)`);
}

async function main(): Promise<number> {
  try {
    await checkHealth();
    await checkReady();
    const metrics = await checkMetricsAuth();
    checkQueueMetrics(metrics);
  } catch (err) {
    fail("uat.exception", err instanceof Error ? err.message : String(err));
  }

  printResults();
  return checks.some((check) => check.status === "fail") ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("FAIL production.uat", err);
    process.exit(1);
  });
