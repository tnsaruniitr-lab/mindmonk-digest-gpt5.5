import type { Context } from "telegraf";
import { removeUserChannelsByName } from "../../services/subscriptions.js";
import { getOrCreateTelegramUser } from "../../services/users.js";

export async function removeChannelCommand(ctx: Context) {
  const user = await getOrCreateTelegramUser(ctx);
  if (!user || user.status === "blocked") return;

  const text = (ctx.message && "text" in ctx.message ? ctx.message.text : "") ?? "";
  const name = text.replace(/^\/remove_channel\s*/, "").trim();

  if (!name) {
    await ctx.reply("Usage: /remove_channel <channel name>");
    return;
  }

  const removed = await removeUserChannelsByName(user.id, name);

  if (!removed.length) {
    await ctx.reply(`❌ You do not have an active channel matching "${name}".`);
    return;
  }

  const names = removed.join(", ");
  await ctx.reply(`✅ Stopped tracking: ${names}`);
}
