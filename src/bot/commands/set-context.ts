import type { Context } from "telegraf";
import { setContextEntry } from "../../services/preferences.js";
import { getOrCreateTelegramUser } from "../../services/users.js";

export async function setContextCommand(ctx: Context) {
  const user = await getOrCreateTelegramUser(ctx);
  if (!user || user.status === "blocked") return;

  const text = (ctx.message && "text" in ctx.message ? ctx.message.text : "") ?? "";
  const args = text.replace(/^\/set_context\s*/, "").trim();

  // Parse: first word is label, rest is context
  const spaceIdx = args.indexOf(" ");
  if (spaceIdx === -1 || !args) {
    await ctx.reply(
      "Usage: /set_context <label> <your context>\n\n" +
        "Example: /set_context role I'm a SaaS founder building AI-powered SEO tools\n" +
        "Example: /set_context investing I focus on tech stocks and index funds with a 10-year horizon"
    );
    return;
  }

  const label = args.slice(0, spaceIdx).trim();
  const context = args.slice(spaceIdx + 1).trim();

  const saved = await setContextEntry(user.id, label, context);
  await ctx.reply(
    saved
      ? `✅ Saved context "${label}"\n\nThis will be injected into your future summaries.`
      : "❌ Could not save your context. Try again."
  );
}
