import type { Context } from "telegraf";
import { ownerChatId } from "../../config.js";
import { supabase } from "../../db/supabase.js";

export async function statusCommand(ctx: Context) {
  if (!ownerChatId || String(ctx.chat?.id) !== ownerChatId) return;

  const { count: pendingCount } = await supabase
    .from("videos")
    .select("*", { count: "exact", head: true })
    .eq("processed", false);

  const { count: unavailableCount } = await supabase
    .from("videos")
    .select("*", { count: "exact", head: true })
    .eq("transcript_status", "unavailable");

  const { count: totalVideos } = await supabase
    .from("videos")
    .select("*", { count: "exact", head: true });

  const { count: totalBrain } = await supabase
    .from("brain_objects")
    .select("*", { count: "exact", head: true });

  const { count: channelCount } = await supabase
    .from("channels")
    .select("*", { count: "exact", head: true })
    .eq("active", true);

  // Recent processed
  const { data: recent } = await supabase
    .from("videos")
    .select("title, created_at")
    .eq("processed", true)
    .order("created_at", { ascending: false })
    .limit(5);

  let msg = `📊 *Status*\n\n`;
  msg += `Channels tracked: ${channelCount ?? 0}\n`;
  msg += `Total videos: ${totalVideos ?? 0}\n`;
  msg += `Pending in queue: ${pendingCount ?? 0}\n`;
  msg += `No captions: ${unavailableCount ?? 0}\n`;
  msg += `Brain objects: ${totalBrain ?? 0}\n`;

  if (recent?.length) {
    msg += `\n*Recent:*\n`;
    recent.forEach((v: { title: string }) => {
      msg += `• ${v.title}\n`;
    });
  }

  await ctx.reply(msg, { parse_mode: "Markdown" });
}
