import type { Context } from "telegraf";
import { listUserChannels } from "../../services/subscriptions.js";
import { getOrCreateTelegramUser } from "../../services/users.js";

export async function listChannelsCommand(ctx: Context) {
  const user = await getOrCreateTelegramUser(ctx);
  if (!user || user.status === "blocked") return;

  const channels = await listUserChannels(user.id);

  if (!channels.length) {
    await ctx.reply("No channels tracked yet. Use /add_channel to get started.");
    return;
  }

  let msg = "📺 *Your Tracked Channels*\n\n";
  for (let i = 0; i < channels.length; i++) {
    const ch = channels[i].channel;
    const category = channels[i].subscription.default_category ?? ch.default_category;
    const cat = category ? ` (${category})` : "";
    msg += `${i + 1}. ${ch.name}${cat}\n`;
  }

  await ctx.reply(msg, { parse_mode: "Markdown" });
}
