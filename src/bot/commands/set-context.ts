import type { Context } from "telegraf";
import { ownerChatId } from "../../config.js";
import { supabase } from "../../db/supabase.js";

export async function setContextCommand(ctx: Context) {
  if (!ownerChatId || String(ctx.chat?.id) !== ownerChatId) return;

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

  // Upsert by label
  const { data: existing } = await supabase
    .from("user_context")
    .select("id")
    .eq("label", label)
    .single();

  if (existing) {
    await supabase
      .from("user_context")
      .update({ context, active: true })
      .eq("id", existing.id);
    await ctx.reply(`✅ Updated context "${label}"`);
  } else {
    await supabase.from("user_context").insert({ label, context, active: true });
    await ctx.reply(`✅ Saved context "${label}"\n\nThis will be injected into all future summaries.`);
  }
}
