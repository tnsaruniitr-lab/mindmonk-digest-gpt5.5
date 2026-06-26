import http from "node:http";
import { config } from "./config.js";
import { dbQuery } from "./db/supabase.js";
import { renderLandingPage } from "./landing-page.js";
import { log } from "./utils/logger.js";

type WebhookHandler = (
  req: http.IncomingMessage,
  res: http.ServerResponse
) => void | Promise<void>;

interface HealthServerOptions {
  webhookPath?: string;
  webhookHandler?: WebhookHandler;
}

interface HealthStatus {
  service: string;
  status: "ok";
  role: string;
  uptime_seconds: number;
  timestamp: string;
}

function buildHealthStatus(): HealthStatus {
  return {
    service: "mindmonk-digest",
    status: "ok",
    role: config.SERVICE_ROLE,
    uptime_seconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  };
}

async function buildReadyStatus(): Promise<Record<string, unknown>> {
  await dbQuery("SELECT 1");
  const jobs = await dbQuery<{ status: string; count: number }>(
    "SELECT status, COUNT(*)::int AS count FROM jobs GROUP BY status"
  ).catch(() => ({ rows: [] }));

  return {
    ...buildHealthStatus(),
    db: "ok",
    jobs: Object.fromEntries(jobs.rows.map((row) => [row.status, row.count])),
  };
}

async function buildMetricsStatus(): Promise<Record<string, unknown>> {
  const [jobs, oldestQueued, usage, users, subscriptions] = await Promise.all([
    dbQuery<{ status: string; count: number }>(
      "SELECT status, COUNT(*)::int AS count FROM jobs GROUP BY status"
    ),
    dbQuery<{ oldest_queued_seconds: number | null }>(
      `
        SELECT EXTRACT(EPOCH FROM (now() - MIN(created_at)))::int AS oldest_queued_seconds
        FROM jobs
        WHERE status = 'queued'
      `
    ),
    dbQuery<{
      transcription_minutes: string | null;
      llm_tokens: string | null;
      estimated_cost_usd: string | null;
    }>(
      `
        SELECT
          COALESCE(SUM(quantity) FILTER (WHERE event_type = 'transcription_minutes'), 0) AS transcription_minutes,
          COALESCE(SUM(quantity) FILTER (WHERE event_type = 'llm_tokens'), 0) AS llm_tokens,
          COALESCE(SUM(estimated_cost_usd), 0) AS estimated_cost_usd
        FROM usage_events
        WHERE created_at >= date_trunc('day', now())
      `
    ),
    dbQuery<{ count: number }>("SELECT COUNT(*)::int AS count FROM users"),
    dbQuery<{ count: number }>(
      "SELECT COUNT(*)::int AS count FROM user_channel_subscriptions WHERE active = true"
    ),
  ]);

  return {
    ...buildHealthStatus(),
    users: users.rows[0]?.count ?? 0,
    active_subscriptions: subscriptions.rows[0]?.count ?? 0,
    jobs: Object.fromEntries(jobs.rows.map((row) => [row.status, row.count])),
    oldest_queued_seconds: oldestQueued.rows[0]?.oldest_queued_seconds ?? null,
    usage_today: usage.rows[0] ?? {
      transcription_minutes: 0,
      llm_tokens: 0,
      estimated_cost_usd: 0,
    },
  };
}

function hasMetricsAccess(req: http.IncomingMessage, url: URL): boolean {
  if (!config.ADMIN_METRICS_TOKEN) return false;
  const auth = req.headers.authorization ?? "";
  const bearer = auth.match(/^Bearer\s+(.+)$/i)?.[1];
  return bearer === config.ADMIN_METRICS_TOKEN || url.searchParams.get("token") === config.ADMIN_METRICS_TOKEN;
}

export function startHealthServer(options: HealthServerOptions = {}): http.Server {
  const port = Number(process.env.PORT ?? 3000);
  const host = "0.0.0.0";

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;

    if (
      options.webhookPath &&
      options.webhookHandler &&
      path === options.webhookPath
    ) {
      if (req.method !== "POST") {
        res.writeHead(405, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "method_not_allowed" }));
        return;
      }

      try {
        await options.webhookHandler(req, res);
      } catch (err) {
        log.error("health", "Telegram webhook handler failed", err);
        if (!res.headersSent) {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "webhook_failed" }));
        }
      }
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "method_not_allowed" }));
      return;
    }

    if (path === "/") {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "public, max-age=300",
      });
      if (req.method !== "HEAD") res.end(renderLandingPage());
      else res.end();
      return;
    }

    if (path === "/ready") {
      try {
        const ready = await buildReadyStatus();
        res.writeHead(200, { "content-type": "application/json" });
        if (req.method !== "HEAD") res.end(JSON.stringify(ready));
        else res.end();
      } catch (err) {
        log.error("health", "Readiness check failed", err);
        res.writeHead(503, { "content-type": "application/json" });
        if (req.method !== "HEAD") {
          res.end(JSON.stringify({ ...buildHealthStatus(), status: "not_ready" }));
        } else {
          res.end();
        }
      }
      return;
    }

    if (path === "/metrics") {
      if (!hasMetricsAccess(req, url)) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }

      try {
        const metrics = await buildMetricsStatus();
        res.writeHead(200, { "content-type": "application/json" });
        if (req.method !== "HEAD") res.end(JSON.stringify(metrics));
        else res.end();
      } catch (err) {
        log.error("health", "Metrics check failed", err);
        res.writeHead(503, { "content-type": "application/json" });
        if (req.method !== "HEAD") {
          res.end(JSON.stringify({ ...buildHealthStatus(), error: "metrics_unavailable" }));
        } else {
          res.end();
        }
      }
      return;
    }

    if (path !== "/health") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not_found" }));
      return;
    }

    res.writeHead(200, { "content-type": "application/json" });
    if (req.method !== "HEAD") res.end(JSON.stringify(buildHealthStatus()));
    else res.end();
  });

  server.listen(port, host, () => {
    log.info("health", `Health server listening on ${host}:${port}`);
  });

  return server;
}
