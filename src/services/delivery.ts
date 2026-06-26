import type { Telegraf, Context } from "telegraf";
import { supabase } from "../db/supabase.js";
import { ownerChatId } from "../config.js";
import { formatSummary } from "../bot/formatter.js";
import { getOutputFormat } from "./preferences.js";
import type { Video, Summary, UserSummary } from "../types/index.js";
import { log } from "../utils/logger.js";

let botInstance: Telegraf<Context> | null = null;

type DeliverableSummary = Summary | UserSummary;

export function setBot(bot: Telegraf<Context>) {
  botInstance = bot;
}

/**
 * Send a formatted summary to the user's Telegram chat.
 */
export async function deliverSummary(
  video: Video,
  summary: DeliverableSummary,
  channelName: string,
  brainObjectCount?: number
): Promise<boolean> {
  if (!ownerChatId) {
    log.warn("delivery", `No Telegram owner chat bound; skipping delivery for "${video.title}"`);
    return false;
  }

  return deliverSummaryToChat(video, summary, channelName, ownerChatId, null, brainObjectCount);
}

export async function deliverSummaryToChat(
  video: Video,
  summary: DeliverableSummary,
  channelName: string,
  telegramChatId: string,
  userId?: string | null,
  brainObjectCount?: number
): Promise<boolean> {
  if (!botInstance) {
    log.error("delivery", "Bot not initialized");
    return false;
  }

  try {
    const outputFormat = await getOutputFormat(userId);
    const messages = formatSummary(video, summary, channelName, brainObjectCount, outputFormat);

    let lastMessageId: number | undefined;
    for (const msg of messages) {
      const options = msg.parseMode ? { parse_mode: msg.parseMode } : undefined;
      const sent = await botInstance.telegram.sendMessage(
        telegramChatId,
        msg.text,
        options
      );
      lastMessageId = sent.message_id;
    }

    const isUserSummary = "user_id" in summary && Boolean(summary.user_id);

    // Log delivery
    await supabase.from("delivery_log").insert({
      summary_id: isUserSummary ? null : summary.id,
      user_summary_id: isUserSummary ? summary.id : null,
      user_id: userId ?? (isUserSummary ? summary.user_id : null),
      telegram_chat_id: telegramChatId,
      telegram_message_id: lastMessageId?.toString() ?? null,
      status: "sent",
    });

    log.info("delivery", `Delivered summary for "${video.title}" to chat ${telegramChatId}`);
    return true;
  } catch (err) {
    log.error("delivery", `Failed to deliver summary for "${video.title}" to chat ${telegramChatId}`, err);

    await supabase.from("delivery_log").insert({
      summary_id: "user_id" in summary && summary.user_id ? null : summary.id,
      user_summary_id: "user_id" in summary && summary.user_id ? summary.id : null,
      user_id: userId ?? ("user_id" in summary ? summary.user_id : null),
      telegram_chat_id: telegramChatId,
      status: "failed",
    });

    return false;
  }
}

export async function sendPlainTextToChat(
  telegramChatId: string,
  text: string
): Promise<boolean> {
  if (!botInstance) {
    log.error("delivery", "Bot not initialized");
    return false;
  }

  try {
    await botInstance.telegram.sendMessage(telegramChatId, text);
    return true;
  } catch (err) {
    log.error("delivery", `Failed to send plain text to chat ${telegramChatId}`, err);
    return false;
  }
}

/**
 * Send a plain text notification to the user.
 */
export async function notify(message: string): Promise<void> {
  if (!botInstance) return;
  if (!ownerChatId) {
    log.warn("delivery", "No Telegram owner chat bound; skipping notification");
    return;
  }
  try {
    await botInstance.telegram.sendMessage(ownerChatId, message);
  } catch (err) {
    log.error("delivery", "Failed to send notification", err);
  }
}
