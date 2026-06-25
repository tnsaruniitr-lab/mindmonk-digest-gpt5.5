import type { Context } from "telegraf";
import { commandArg, summarizeVideoFromUrl } from "./fetch.js";
import { getOrCreateTelegramUser } from "../../services/users.js";

export async function digestCommand(ctx: Context): Promise<void> {
  const user = await getOrCreateTelegramUser(ctx);
  if (!user || user.status === "blocked") return;

  const url = commandArg(ctx, "digest");
  if (!url) {
    await ctx.reply("Usage: /digest <youtube_video_url>");
    return;
  }

  await summarizeVideoFromUrl(ctx, url, user.id);
}
