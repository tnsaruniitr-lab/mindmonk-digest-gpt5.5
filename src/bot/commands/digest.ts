import type { Context } from "telegraf";
import { ownerChatId } from "../../config.js";
import { commandArg, summarizeVideoFromUrl } from "./fetch.js";

export async function digestCommand(ctx: Context): Promise<void> {
  if (!ownerChatId || String(ctx.chat?.id) !== ownerChatId) return;

  const url = commandArg(ctx, "digest");
  if (!url) {
    await ctx.reply("Usage: /digest <youtube_video_url>");
    return;
  }

  await summarizeVideoFromUrl(ctx, url);
}
