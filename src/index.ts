import { Telegraf } from "telegraf";
import type http from "node:http";
import { config, ownerChatId, setOwnerChatId } from "./config.js";
import { log } from "./utils/logger.js";
import { startCommand } from "./bot/commands/start.js";
import { helpCommand } from "./bot/commands/help.js";
import { addChannelCommand } from "./bot/commands/add-channel.js";
import { removeChannelCommand } from "./bot/commands/remove-channel.js";
import { listChannelsCommand } from "./bot/commands/list-channels.js";
import { digestCommand } from "./bot/commands/digest.js";
import { fetchCommand } from "./bot/commands/fetch.js";
import { channelCommand } from "./bot/commands/channel.js";
import { statusCommand } from "./bot/commands/status.js";
import { usageCommand } from "./bot/commands/usage.js";
import { brainCommand } from "./bot/commands/brain.js";
import { setContextCommand } from "./bot/commands/set-context.js";
import { setFormatCommand } from "./bot/commands/set-format.js";
import { reprocessCommand } from "./bot/commands/reprocess.js";
import { pickChannelCallback, addChannelCallback } from "./bot/handlers/url-detect.js";
import { smartHandler } from "./bot/handlers/smart-handler.js";
import { startScheduler, stopScheduler } from "./scheduler/cron.js";
import { startJobWorker, stopJobWorker } from "./jobs/worker.js";
import { setBot } from "./services/delivery.js";
import { startHealthServer } from "./health-server.js";
import { ensureDatabaseSchema, supabase } from "./db/supabase.js";
import { ensureLegacyOwnerUser } from "./services/users.js";

const OWNER_CHAT_ID_LABEL = "telegram_owner_chat_id";

const bot = new Telegraf(config.TELEGRAM_BOT_TOKEN);
setBot(bot);
const serviceRole = config.SERVICE_ROLE;
const shouldStartWeb = serviceRole === "all" || serviceRole === "web";
const shouldStartScheduler = serviceRole === "all" || serviceRole === "scheduler";
const shouldStartWorker = serviceRole === "all" || serviceRole === "worker";
const webhookPath = buildWebhookPath();
const webhookUrl = buildWebhookUrl(webhookPath);
const shouldUseWebhook =
  shouldStartWeb &&
  (config.BOT_MODE === "webhook" || (config.BOT_MODE === "auto" && Boolean(webhookUrl)));
let shuttingDown = false;
const healthServer = startHealthServer(
  shouldUseWebhook
    ? {
        webhookPath,
        webhookHandler: bot.webhookCallback(webhookPath),
      }
    : {}
);

// --- Commands ---
bot.start(startCommand);
bot.command("help", helpCommand);
bot.command("add_channel", addChannelCommand);
bot.command("remove_channel", removeChannelCommand);
bot.command("list_channels", listChannelsCommand);
bot.command("digest", digestCommand);
bot.command("fetch", fetchCommand);
bot.command("channel", channelCommand);
bot.command("status", statusCommand);
bot.command("usage", usageCommand);
bot.command("brain", brainCommand);
bot.command("set_context", setContextCommand);
bot.command("set_format", setFormatCommand);
bot.command("reprocess", reprocessCommand);

// --- Callback handlers (inline buttons) ---
bot.action(/^pickch:/, pickChannelCallback);
bot.action(/^addch:/, addChannelCallback);

// --- Smart conversational handler ---
bot.on("text", smartHandler);

// --- Launch ---
startBot().catch((err) => {
  log.error("bot", "Failed to start bot", err);
  shutdown(healthServer, "STARTUP_FAILURE");
  process.exit(1);
});

// Graceful shutdown
process.once("SIGINT", () => shutdown(healthServer, "SIGINT"));
process.once("SIGTERM", () => shutdown(healthServer, "SIGTERM"));

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTelegramConflict(err: unknown): boolean {
  const maybeError = err as {
    code?: number;
    response?: { error_code?: number };
  };
  return maybeError.code === 409 || maybeError.response?.error_code === 409;
}

function buildWebhookPath(): string {
  const secret =
    config.TELEGRAM_WEBHOOK_SECRET ||
    config.TELEGRAM_BOT_TOKEN.replace(/[^a-zA-Z0-9_-]/g, "").slice(-32);
  return `/telegram/${secret}`;
}

function buildWebhookUrl(path: string): string {
  if (config.TELEGRAM_WEBHOOK_URL) return config.TELEGRAM_WEBHOOK_URL;

  const publicDomain = process.env.RAILWAY_PUBLIC_DOMAIN;
  if (!publicDomain) return "";

  const origin = publicDomain.startsWith("http")
    ? publicDomain
    : `https://${publicDomain}`;
  return `${origin.replace(/\/$/, "")}${path}`;
}

async function startBot(): Promise<void> {
  await ensureDatabaseSchema();
  log.info("db", `Database schema ready (role=${serviceRole})`);
  await loadPersistedOwnerChatId();

  if (shouldStartWeb) {
    if (shouldUseWebhook) {
      if (!webhookUrl) {
        throw new Error("BOT_MODE=webhook requires TELEGRAM_WEBHOOK_URL or RAILWAY_PUBLIC_DOMAIN");
      }

      await bot.telegram.setWebhook(webhookUrl, { drop_pending_updates: true });
      log.info("bot", "Bot started (webhook mode)");
    } else {
      startPollingWithRetry();
    }
  } else {
    log.info("bot", `Telegram listener disabled for role=${serviceRole}`);
  }

  if (shouldStartScheduler) startScheduler();
  else log.info("cron", `Scheduler disabled for role=${serviceRole}`);

  if (shouldStartWorker) startJobWorker();
  else log.info("jobs", `Worker disabled for role=${serviceRole}`);
}

async function loadPersistedOwnerChatId(): Promise<void> {
  if (ownerChatId) {
    await ensureLegacyOwnerUser(ownerChatId);
    return;
  }

  const { data } = await supabase
    .from("user_context")
    .select("context")
    .eq("label", OWNER_CHAT_ID_LABEL)
    .single();

  if (data?.context) {
    setOwnerChatId(data.context);
    await ensureLegacyOwnerUser(data.context);
    log.info("bot", "Loaded persisted Telegram owner chat");
  }
}

function startPollingWithRetry(): void {
  void (async () => {
    while (!shuttingDown) {
      try {
        await bot.launch({ dropPendingUpdates: true });

        if (!shuttingDown) {
          log.warn("bot", "Long polling stopped unexpectedly; retrying in 5s");
          await delay(5000);
        }
      } catch (err) {
        if (shuttingDown) return;

        if (isTelegramConflict(err)) {
          log.warn("bot", "Telegram polling conflict; retrying in 65s");
          await delay(65000);
          continue;
        }

        log.error("bot", "Long polling failed; retrying in 30s", err);
        await delay(30000);
      }
    }
  })();

  log.info("bot", "Bot starting (long polling mode)");
}

function shutdown(healthServer: http.Server, signal: string): void {
  shuttingDown = true;
  stopScheduler();
  stopJobWorker();
  healthServer.close();
  try { bot.stop(signal); } catch {}
  log.info("bot", `Shutdown complete (${signal})`);
}
