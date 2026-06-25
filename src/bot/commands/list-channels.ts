import type { Context } from "telegraf";
import { ownerChatId } from "../../config.js";
import { supabase } from "../../db/supabase.js";

export async function listChannelsCommand(ctx: Context) {
  if (!ownerChatId || String(ctx.chat?.id) !== ownerChatId) return;

  const { data: channels, error } = await supabase
    .from("channels")
    .select("name, default_category, youtube_channel_id")
    .eq("active", true)
    .order("created_at", { ascending: true });

  if (error || !channels?.length) {
    await ctx.reply("No channels tracked yet. Use /add_channel to get started.");
    return;
  }

  let msg = "📺 *Tracked Channels*\n\n";
  for (let i = 0; i < channels.length; i++) {
    const ch = channels[i];
    const cat = ch.default_category ? ` (${ch.default_category})` : "";
    msg += `${i + 1}. ${ch.name}${cat}\n`;
  }

  await ctx.reply(msg, { parse_mode: "Markdown" });
}
