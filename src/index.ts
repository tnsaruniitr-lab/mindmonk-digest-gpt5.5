import { Telegraf } from "telegraf";
import { config } from "./config.js";
import { log } from "./utils/logger.js";
import { startCommand } from "./bot/commands/start.js";
import { helpCommand } from "./bot/commands/help.js";
import { addChannelCommand } from "./bot/commands/add-channel.js";
import { removeChannelCommand } from "./bot/commands/remove-channel.js";
import { listChannelsCommand } from "./bot/commands/list-channels.js";
import { digestCommand } from "./bot/commands/digest.js";
import { statusCommand } from "./bot/commands/status.js";
import { brainCommand } from "./bot/commands/brain.js";
import { setContextCommand } from "./bot/commands/set-context.js";
import { setFormatCommand } from "./bot/commands/set-format.js";
import { reprocessCommand } from "./bot/commands/reprocess.js";
import { pickChannelCallback, addChannelCallback } from "./bot/handlers/url-detect.js";
import { smartHandler } from "./bot/handlers/smart-handler.js";
import { startScheduler, stopScheduler } from "./scheduler/cron.js";
import { setBot } from "./services/delivery.js";

const bot = new Telegraf(config.TELEGRAM_BOT_TOKEN);
setBot(bot);

// --- Commands ---
bot.start(startCommand);
bot.command("help", helpCommand);
bot.command("add_channel", addChannelCommand);
bot.command("remove_channel", removeChannelCommand);
bot.command("list_channels", listChannelsCommand);
bot.command("digest", digestCommand);
bot.command("status", statusCommand);
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
bot.launch(() => {
  log.info("bot", "Bot started (long polling mode)");
});

startScheduler();

// Graceful shutdown
process.once("SIGINT", () => {
  stopScheduler();
  try { bot.stop("SIGINT"); } catch {}
});
process.once("SIGTERM", () => {
  stopScheduler();
  try { bot.stop("SIGTERM"); } catch {}
});
