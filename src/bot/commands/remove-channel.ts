import type { Context } from "telegraf";
import { ownerChatId } from "../../config.js";
import { supabase } from "../../db/supabase.js";

export async function removeChannelCommand(ctx: Context) {
  if (!ownerChatId || String(ctx.chat?.id) !== ownerChatId) return;

  const text = (ctx.message && "text" in ctx.message ? ctx.message.text : "") ?? "";
  const name = text.replace(/^\/remove_channel\s*/, "").trim();

  if (!name) {
    await ctx.reply("Usage: /remove_channel <channel name>");
    return;
  }

  const { data, error } = await supabase
    .from("channels")
    .update({ active: false })
    .ilike("name", `%${name}%`)
    .eq("active", true)
    .select("name");

  if (error || !data?.length) {
    await ctx.reply(`❌ No active channel matching "${name}" found.`);
    return;
  }

  const names = data.map((c: { name: string }) => c.name).join(", ");
  await ctx.reply(`✅ Stopped tracking: ${names}`);
}
