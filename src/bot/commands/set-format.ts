import type { Context } from "telegraf";
import {
  clearOutputFormat,
  getOutputFormat,
  setOutputFormat,
} from "../../services/preferences.js";
import { getOrCreateTelegramUser } from "../../services/users.js";
import { DEFAULT_OUTPUT_FORMAT } from "../formatter.js";

const PLACEHOLDERS = [
  "{{title}}",
  "{{channel}}",
  "{{category}}",
  "{{source_url}}",
  "{{key_insights}}",
  "{{key_insights_numbered}}",
  "{{patterns_antipatterns}}",
  "{{patterns_antipatterns_numbered}}",
  "{{unbiased_grading}}",
  "{{idea_grade}}",
  "{{tailored_learnings}}",
  "{{tailored_learnings_numbered}}",
  "{{tailored_actions}}",
  "{{brain_object_count}}",
];

export async function setFormatCommand(ctx: Context) {
  const user = await getOrCreateTelegramUser(ctx);
  if (!user || user.status === "blocked") return;

  const text = (ctx.message && "text" in ctx.message ? ctx.message.text : "") ?? "";
  const format = text.replace(/^\/set_format(?:@\w+)?\s*/i, "").trim();

  if (!format) {
    const current = await getOutputFormat(user.id);
    await ctx.reply(
      `Current output format:\n\n${current ?? "(default four-section digest)"}\n\n` +
        `To set a custom format, send:\n/set_format\n${DEFAULT_OUTPUT_FORMAT}\n\n` +
        `Available placeholders:\n${PLACEHOLDERS.join(", ")}\n\n` +
        `To reset: /set_format reset`
    );
    return;
  }

  if (/^(reset|default|clear)$/i.test(format)) {
    const cleared = await clearOutputFormat(user.id);
    await ctx.reply(
      cleared
        ? "Output format reset to the default four-section digest."
        : "Could not reset the output format. Check the logs and try again."
    );
    return;
  }

  if (format.length > 8000) {
    await ctx.reply("That format is too long. Keep it under 8,000 characters.");
    return;
  }

  const saved = await setOutputFormat(format, user.id);
  await ctx.reply(
    saved
      ? `Saved output format. Future digests will use:\n\n${format}`
      : "Could not save the output format. Check the logs and try again."
  );
}
