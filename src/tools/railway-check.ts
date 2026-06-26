import { execFile } from "node:child_process";
import { promisify } from "node:util";

type CheckStatus = "pass" | "warn" | "fail";

interface CheckResult {
  label: string;
  status: CheckStatus;
  detail: string;
}

interface ServiceExpectation {
  service: string;
  role: "web" | "worker" | "scheduler";
  botMode?: string;
  workerEnabled?: string;
}

const execFileAsync = promisify(execFile);
const checks: CheckResult[] = [];

const services: ServiceExpectation[] = [
  {
    service: process.env.RAILWAY_WEB_SERVICE || "mindmonk-digest-gpt5.5",
    role: "web",
    botMode: "webhook",
    workerEnabled: "false",
  },
  {
    service: process.env.RAILWAY_WORKER_SERVICE || "mindmonk-worker",
    role: "worker",
    workerEnabled: "true",
  },
  {
    service: process.env.RAILWAY_SCHEDULER_SERVICE || "mindmonk-scheduler",
    role: "scheduler",
    workerEnabled: "false",
  },
];

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

async function railwayJson<T = Record<string, unknown>>(args: string[]): Promise<T> {
  const { stdout } = await execFileAsync("railway", [...args, "--json"], {
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout) as T;
}

async function checkServiceStatus(service: string): Promise<void> {
  const status = await railwayJson<Record<string, unknown>>([
    "service",
    "status",
    "--service",
    service,
  ]);

  const deployment = asObject(status.latestDeployment ?? status);
  const deploymentStatus = String(deployment.status ?? status.status ?? "unknown");
  const instances = Array.isArray(deployment.instances)
    ? deployment.instances.map((instance) => String(asObject(instance).status ?? "unknown"))
    : [];
  const commitHash = asObject(deployment.meta).commitHash;

  if (deploymentStatus === "SUCCESS" && instances.every((item) => item === "RUNNING")) {
    pass(
      `railway.${service}.deploy`,
      instances.length
        ? `SUCCESS${commitHash ? ` @ ${String(commitHash).slice(0, 7)}` : ""}, instances=${instances.length}`
        : `SUCCESS${commitHash ? ` @ ${String(commitHash).slice(0, 7)}` : ""}, instance details unavailable`
    );
    return;
  }

  if (deploymentStatus === "SUCCESS" && !instances.length) {
    pass(`railway.${service}.deploy`, "SUCCESS");
    return;
  }

  fail(
    `railway.${service}.deploy`,
    `status=${deploymentStatus}, instances=${instances.join(",") || "unknown"}`
  );
}

async function checkServiceVariables(expectation: ServiceExpectation): Promise<void> {
  const variables = await railwayJson<Record<string, string>>([
    "variables",
    "--service",
    expectation.service,
  ]);

  if (variables.SERVICE_ROLE === expectation.role) {
    pass(`railway.${expectation.service}.role`, `SERVICE_ROLE=${expectation.role}`);
  } else {
    fail(
      `railway.${expectation.service}.role`,
      `Expected SERVICE_ROLE=${expectation.role}, got ${variables.SERVICE_ROLE || "missing"}`
    );
  }

  if (expectation.botMode) {
    if (variables.BOT_MODE === expectation.botMode) {
      pass(`railway.${expectation.service}.bot`, `BOT_MODE=${expectation.botMode}`);
    } else {
      fail(
        `railway.${expectation.service}.bot`,
        `Expected BOT_MODE=${expectation.botMode}, got ${variables.BOT_MODE || "missing"}`
      );
    }
  }

  if (expectation.workerEnabled) {
    if (variables.JOB_WORKER_ENABLED === expectation.workerEnabled) {
      pass(
        `railway.${expectation.service}.worker`,
        `JOB_WORKER_ENABLED=${expectation.workerEnabled}`
      );
    } else {
      fail(
        `railway.${expectation.service}.worker`,
        `Expected JOB_WORKER_ENABLED=${expectation.workerEnabled}, got ${variables.JOB_WORKER_ENABLED || "missing"}`
      );
    }
  }
}

async function checkProjectShape(): Promise<void> {
  const project = await railwayJson<Record<string, unknown>>(["status"]);
  const environment = asObject(
    asObject(project.environments).edges &&
      Array.isArray(asObject(project.environments).edges)
      ? asObject((asObject(project.environments).edges as unknown[])[0]).node
      : null
  );
  const serviceEdges = asObject(environment.serviceInstances).edges;
  const serviceNames = Array.isArray(serviceEdges)
    ? serviceEdges.map((edge) => String(asObject(asObject(edge).node).serviceName ?? ""))
    : [];

  for (const expected of services) {
    if (serviceNames.includes(expected.service)) pass(`railway.${expected.service}.exists`, "service present");
    else fail(`railway.${expected.service}.exists`, "service missing");
  }

  const postgresServices = serviceNames.filter((name) => name.toLowerCase().startsWith("postgres"));
  if (postgresServices.length > 1) {
    warn("railway.postgres", `multiple Postgres services present: ${postgresServices.join(", ")}`);
  } else if (postgresServices.length === 1) {
    pass("railway.postgres", `${postgresServices[0]} present`);
  } else {
    fail("railway.postgres", "no Postgres service found");
  }
}

function printResults(): void {
  for (const check of checks) {
    const icon = check.status === "pass" ? "PASS" : check.status === "warn" ? "WARN" : "FAIL";
    console.log(`${icon.padEnd(4)} ${check.label.padEnd(44)} ${check.detail}`);
  }

  const failed = checks.filter((check) => check.status === "fail").length;
  const warned = checks.filter((check) => check.status === "warn").length;
  console.log("");
  console.log(`Railway ops check: ${failed ? "FAIL" : warned ? "WARN" : "PASS"} (${failed} fail, ${warned} warn)`);
}

async function main(): Promise<number> {
  try {
    await checkProjectShape();
    for (const service of services) {
      await checkServiceStatus(service.service);
      await checkServiceVariables(service);
    }
  } catch (err) {
    fail("railway.exception", err instanceof Error ? err.message : String(err));
  }

  printResults();
  return checks.some((check) => check.status === "fail") ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("FAIL railway.check", err);
    process.exit(1);
  });
