import type { Context } from "telegraf";
import { ownerChatId, setOwnerChatId } from "../../config.js";
import { supabase } from "../../db/supabase.js";
import { getOrCreateTelegramUser, OWNER_CHAT_ID_LABEL } from "../../services/users.js";

export async function startCommand(ctx: Context) {
  const chatId = String(ctx.chat?.id);
  const user = await getOrCreateTelegramUser(ctx);
  if (!user) return;

  // Keep the legacy owner binding for scheduled delivery/admin fallback.
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

  await ctx.reply(
    `🎬 *MindMonk — YouTube Digest Bot*\n\n` +
      `I track your YouTube channels, summarize new videos, and extract structured insights into your personal brain\\.\n\n` +
      `Your account is ready\\.\n\n` +
      `*Get started:*\n` +
      `/add\\_channel \\<url\\> \\[category\\] — Track a channel\n` +
      `/set\\_format — Set your preferred digest template\n` +
      `/digest \\<url\\> — Summarize a single video\n` +
      `/help — See all commands`,
    { parse_mode: "MarkdownV2" }
  );
}
