import http from "node:http";
import { log } from "./utils/logger.js";

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

export function startHealthServer(): http.Server {
  const port = Number(process.env.PORT ?? 3000);
  const host = "0.0.0.0";

  const server = http.createServer((req, res) => {
    if (req.method !== "GET") {
      res.writeHead(405, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "method_not_allowed" }));
      return;
    }

    if (req.url !== "/" && req.url !== "/health") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not_found" }));
      return;
    }

    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(buildHealthStatus()));
  });

  server.listen(port, host, () => {
    log.info("health", `Health server listening on ${host}:${port}`);
  });

  return server;
}
