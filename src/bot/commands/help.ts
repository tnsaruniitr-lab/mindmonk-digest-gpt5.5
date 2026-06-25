import type { Context } from "telegraf";
import { ownerChatId } from "../../config.js";

export async function helpCommand(ctx: Context) {
  if (!ownerChatId || String(ctx.chat?.id) !== ownerChatId) return;

  await ctx.reply(
    `*Commands*\n\n` +
      `/add\\_channel \\<url\\> \\[category\\] — Track a YouTube channel\n` +
      `/remove\\_channel \\<name\\> — Stop tracking a channel\n` +
      `/list\\_channels — Show all tracked channels\n` +
      `/fetch \\<url\\> — Summarize a single YouTube video now\n` +
      `/channel \\<url\\> — Summarize the latest video from a channel\n` +
      `/digest \\<url\\> — Summarize a single video now\n` +
      `/status — Processing queue stats\n` +
      `/brain \\[type\\] — Browse brain objects\n` +
      `/set\\_context \\<label\\> \\<text\\> — Set personal context\n` +
      `/set\\_format — Set your preferred digest template\n` +
      `/reprocess \\<url\\> — Re\\-summarize a video\n` +
      `/help — This message\n\n` +
      `*Categories:* investing, psychology, podcast\\_interview, seo\\_marketing, tech\\_ai\\_startup\n\n` +
      `You can also just paste a YouTube link and I'll ask what to do\\.`,
    { parse_mode: "MarkdownV2" }
  );
}
