import type { Context } from "telegraf";
import { ownerChatId, setOwnerChatId } from "../../config.js";
import { supabase } from "../../db/supabase.js";

const OWNER_CHAT_ID_LABEL = "telegram_owner_chat_id";

export async function startCommand(ctx: Context) {
  const chatId = String(ctx.chat?.id);

  // First user to /start becomes the owner
  if (!ownerChatId) {
    setOwnerChatId(chatId);
    await supabase.from("user_context").upsert(
      {
        label: OWNER_CHAT_ID_LABEL,
        context: chatId,
        active: false,
      },
      { onConflict: "label" }
    );
  }

  if (chatId !== ownerChatId) {
    await ctx.reply("This is a personal bot. Access denied.");
    return;
  }

  await ctx.reply(
    `🎬 *MindMonk — YouTube Digest Bot*\n\n` +
      `I track your YouTube channels, summarize new videos, and extract structured insights into your personal brain\\.\n\n` +
      `Your chat ID: \`${chatId}\`\n` +
      `Save this in your \\.env as TELEGRAM\\_CHAT\\_ID for persistence across restarts\\.\n\n` +
      `*Get started:*\n` +
      `/add\\_channel \\<url\\> \\[category\\] — Track a channel\n` +
      `/set\\_format — Set your preferred digest template\n` +
      `/digest \\<url\\> — Summarize a single video\n` +
      `/help — See all commands`,
    { parse_mode: "MarkdownV2" }
  );
}
