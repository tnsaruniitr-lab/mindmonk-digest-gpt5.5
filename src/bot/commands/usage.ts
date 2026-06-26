import type { Context } from "telegraf";
import { buildUsageReport } from "../../services/usage.js";
import { getOrCreateTelegramUser } from "../../services/users.js";

export async function usageCommand(ctx: Context): Promise<void> {
  const user = await getOrCreateTelegramUser(ctx);
  if (!user || user.status === "blocked") return;

  const report = await buildUsageReport(user);
  await ctx.reply(report, { parse_mode: "Markdown" });
}
