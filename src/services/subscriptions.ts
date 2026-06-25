import { supabase } from "../db/supabase.js";
import type { Category, Channel, UserChannelSubscription } from "../types/index.js";
import { log } from "../utils/logger.js";

export interface UserChannel {
  channel: Channel;
  subscription: UserChannelSubscription;
}

export async function upsertChannel(input: {
  youtubeChannelId: string;
  name: string;
  thumbnailUrl?: string | null;
  rssFeedUrl: string;
  defaultCategory?: Category | null;
  active?: boolean;
}): Promise<Channel | null> {
  const { data: existing } = await supabase
    .from("channels")
    .select("*")
    .eq("youtube_channel_id", input.youtubeChannelId)
    .single();

  if (existing) {
    await supabase
      .from("channels")
      .update({
        active: input.active ?? true,
        name: input.name,
        thumbnail_url: input.thumbnailUrl ?? existing.thumbnail_url ?? null,
        rss_feed_url: input.rssFeedUrl,
        default_category: input.defaultCategory ?? existing.default_category ?? null,
      })
      .eq("id", existing.id);

    const { data: refreshed } = await supabase
      .from("channels")
      .select("*")
      .eq("id", existing.id)
      .single();

    return (refreshed as Channel | null) ?? (existing as Channel);
  }

  const { data: inserted, error } = await supabase
    .from("channels")
    .insert({
      youtube_channel_id: input.youtubeChannelId,
      name: input.name,
      thumbnail_url: input.thumbnailUrl ?? null,
      rss_feed_url: input.rssFeedUrl,
      active: input.active ?? true,
      default_category: input.defaultCategory ?? null,
    })
    .select()
    .single();

  if (error) {
    log.error("subscriptions", "Failed to create channel", error);
    return null;
  }

  return (inserted as Channel | null) ?? null;
}

export async function subscribeUserToChannel(
  userId: string,
  channelId: string,
  defaultCategory: Category | null
): Promise<boolean> {
  const { error } = await supabase
    .from("user_channel_subscriptions")
    .upsert(
      {
        user_id: userId,
        channel_id: channelId,
        default_category: defaultCategory,
        active: true,
      },
      { onConflict: "user_id,channel_id" }
    );

  if (error) {
    log.error("subscriptions", `Failed to subscribe user ${userId} to channel ${channelId}`, error);
    return false;
  }

  await supabase.from("channels").update({ active: true }).eq("id", channelId);
  return true;
}

export async function listUserChannels(userId: string): Promise<UserChannel[]> {
  const { data: subscriptions, error } = await supabase
    .from("user_channel_subscriptions")
    .select("*")
    .eq("user_id", userId)
    .eq("active", true)
    .order("created_at", { ascending: true });

  if (error) {
    log.error("subscriptions", `Failed to list channels for user ${userId}`, error);
    return [];
  }

  const rows: UserChannel[] = [];
  for (const subscription of (subscriptions ?? []) as UserChannelSubscription[]) {
    const { data: channel } = await supabase
      .from("channels")
      .select("*")
      .eq("id", subscription.channel_id)
      .single();

    if (channel) rows.push({ channel: channel as Channel, subscription });
  }

  return rows;
}

export async function removeUserChannelsByName(userId: string, name: string): Promise<string[]> {
  const rows = await listUserChannels(userId);
  const needle = name.trim().toLowerCase();
  const matches = rows.filter(({ channel }) => {
    return (
      channel.name.toLowerCase().includes(needle) ||
      channel.youtube_channel_id.toLowerCase() === needle
    );
  });

  const removed: string[] = [];
  for (const { channel, subscription } of matches) {
    const { error } = await supabase
      .from("user_channel_subscriptions")
      .update({ active: false })
      .eq("id", subscription.id);

    if (!error) {
      removed.push(channel.name);
      await deactivateChannelIfUnused(channel.id);
    }
  }

  return removed;
}

async function deactivateChannelIfUnused(channelId: string): Promise<void> {
  const { count } = await supabase
    .from("user_channel_subscriptions")
    .select("*", { count: "exact", head: true })
    .eq("channel_id", channelId)
    .eq("active", true);

  if ((count ?? 0) === 0) {
    await supabase.from("channels").update({ active: false }).eq("id", channelId);
  }
}
