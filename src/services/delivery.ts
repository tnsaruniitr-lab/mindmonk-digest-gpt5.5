import type { Telegraf, Context } from "telegraf";
import { supabase } from "../db/supabase.js";
import { ownerChatId } from "../config.js";
import { formatSummary } from "../bot/formatter.js";
import { getOutputFormat } from "./preferences.js";
import type { Video, Summary } from "../types/index.js";
import { log } from "../utils/logger.js";

let botInstance: Telegraf<Context> | null = null;

export function setBot(bot: Telegraf<Context>) {
  botInstance = bot;
}

/**
 * Send a formatted summary to the user's Telegram chat.
 */
export async function deliverSummary(
  video: Video,
  summary: Summary,
  channelName: string,
  brainObjectCount?: number
): Promise<boolean> {
  if (!botInstance) {
    log.error("delivery", "Bot not initialized");
    return false;
  }

  try {
    const outputFormat = await getOutputFormat();
    const messages = formatSummary(video, summary, channelName, brainObjectCount, outputFormat);

    let lastMessageId: number | undefined;
    for (const msg of messages) {
      const options = msg.parseMode ? { parse_mode: msg.parseMode } : undefined;
      const sent = await botInstance.telegram.sendMessage(
        ownerChatId,
        msg.text,
        options
      );
      lastMessageId = sent.message_id;
    }

    // Log delivery
    await supabase.from("delivery_log").insert({
      summary_id: summary.id,
      telegram_chat_id: ownerChatId,
      telegram_message_id: lastMessageId?.toString() ?? null,
      status: "sent",
    });

    log.info("delivery", `Delivered summary for "${video.title}"`);
    return true;
  } catch (err) {
    log.error("delivery", `Failed to deliver summary for "${video.title}"`, err);

    await supabase.from("delivery_log").insert({
      summary_id: summary.id,
      telegram_chat_id: ownerChatId,
      status: "failed",
    });

    return false;
  }
}

/**
 * Send a plain text notification to the user.
 */
export async function notify(message: string): Promise<void> {
  if (!botInstance) return;
  try {
    await botInstance.telegram.sendMessage(ownerChatId, message);
  } catch (err) {
    log.error("delivery", "Failed to send notification", err);
  }
}
