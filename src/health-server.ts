import http from "node:http";
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
  uptime_seconds: number;
  timestamp: string;
}

function buildHealthStatus(): HealthStatus {
  return {
    service: "mindmonk-digest",
    status: "ok",
    uptime_seconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  };
}

export function startHealthServer(options: HealthServerOptions = {}): http.Server {
  const port = Number(process.env.PORT ?? 3000);
  const host = "0.0.0.0";

  const server = http.createServer(async (req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;

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
