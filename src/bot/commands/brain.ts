import type { Context } from "telegraf";
import { supabase } from "../../db/supabase.js";
import { getOrCreateTelegramUser } from "../../services/users.js";
import { formatBrainObject } from "../formatter.js";
import { brainObjectTypes } from "../../types/index.js";

export async function brainCommand(ctx: Context) {
  const user = await getOrCreateTelegramUser(ctx);
  if (!user || user.status === "blocked") return;

  const text = (ctx.message && "text" in ctx.message ? ctx.message.text : "") ?? "";
  const typeFilter = text.replace(/^\/brain\s*/, "").trim().toLowerCase();

  let query = supabase
    .from("brain_objects")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(10);

  if (typeFilter && brainObjectTypes.includes(typeFilter as any)) {
    query = query.eq("type", typeFilter);
  }

  const { data: objects, error } = await query;

  if (error || !objects?.length) {
    await ctx.reply(
      "No brain objects yet. Process some videos first with /digest or wait for auto-processing."
    );
    return;
  }

  let msg = `🧠 *Brain Objects*${typeFilter ? ` (${typeFilter})` : ""}\n\n`;

  for (const obj of objects) {
    const formatted = formatBrainObject(obj);
    if (msg.length + formatted.length + 2 > 4000) {
      // Send current batch and start new message
      await ctx.reply(msg, { parse_mode: "MarkdownV2" });
      msg = "";
    }
    msg += formatted + "\n\n";
  }

  if (msg.trim()) {
    await ctx.reply(msg, { parse_mode: "MarkdownV2" });
  }
}
