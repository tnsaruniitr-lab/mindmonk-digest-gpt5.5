import type { Context } from "telegraf";
import { ownerChatId, setOwnerChatId } from "../config.js";
import { supabase } from "../db/supabase.js";
import type { Channel, User } from "../types/index.js";
import { log } from "../utils/logger.js";

export const OWNER_CHAT_ID_LABEL = "telegram_owner_chat_id";

function displayName(ctx: Context): string | null {
  const from = ctx.from;
  if (!from) return null;
  return [from.first_name, from.last_name].filter(Boolean).join(" ").trim() || null;
}

export function isAdminChat(ctx: Context): boolean {
  const chatId = String(ctx.chat?.id ?? "");
  return Boolean(ownerChatId && chatId === ownerChatId);
}

export async function getOrCreateTelegramUser(ctx: Context): Promise<User | null> {
  const from = ctx.from;
  const chat = ctx.chat;

  if (!from || !chat) {
    await ctx.reply("I could not identify this Telegram chat. Please DM the bot and send /start.");
    return null;
  }

  const telegramUserId = String(from.id);
  const telegramChatId = String(chat.id);
  const username = from.username ?? null;
  const name = displayName(ctx);

  const { data: existing, error: lookupError } = await supabase
    .from("users")
    .select("*")
    .eq("telegram_user_id", telegramUserId)
    .single();

  if (lookupError && lookupError.code !== "PGRST116") {
    log.error("users", "Failed to load Telegram user", lookupError);
    await ctx.reply("I could not load your MindMonk account. Please try again.");
    return null;
  }

  if (existing) {
    const { data: updated, error } = await supabase
      .from("users")
      .update({
        telegram_chat_id: telegramChatId,
        username,
        display_name: name,
        last_seen_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .select()
      .single();

    if (error) {
      log.error("users", "Failed to update Telegram user", error);
      await ctx.reply("I could not update your MindMonk account. Please try again.");
      return null;
    }

    await ensurePreferenceRow(updated.id);
    return updated as User;
  }

  const { data: inserted, error } = await supabase
    .from("users")
    .insert({
      telegram_user_id: telegramUserId,
      telegram_chat_id: telegramChatId,
      username,
      display_name: name,
      last_seen_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error || !inserted) {
    log.error("users", "Failed to create Telegram user", error);
    await ctx.reply("I could not create your MindMonk account. Please try again.");
    return null;
  }

  await ensurePreferenceRow(inserted.id);

  if (!ownerChatId) {
    setOwnerChatId(telegramChatId);
    await supabase.from("user_context").upsert(
      {
        label: OWNER_CHAT_ID_LABEL,
        context: telegramChatId,
        active: false,
      },
      { onConflict: "label" }
    );
  }

  return inserted as User;
}

export async function ensurePreferenceRow(userId: string): Promise<void> {
  const { error } = await supabase
    .from("user_preferences")
    .upsert({ user_id: userId }, { onConflict: "user_id" });

  if (error) log.error("users", `Failed to ensure preferences for user ${userId}`, error);
}

export async function ensureLegacyOwnerUser(chatId: string): Promise<User | null> {
  const { data: existing } = await supabase
    .from("users")
    .select("*")
    .eq("telegram_user_id", chatId)
    .single();

  let user = existing as User | null;

  if (!user) {
    const { data: inserted, error } = await supabase
      .from("users")
      .insert({
        telegram_user_id: chatId,
        telegram_chat_id: chatId,
        display_name: "MindMonk owner",
        plan: "admin",
        last_seen_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error || !inserted) {
      log.error("users", "Failed to create legacy owner user", error);
      return null;
    }

    user = inserted as User;
  }

  await ensurePreferenceRow(user.id);
  await migrateLegacyPreferences(user.id);
  await subscribeLegacyChannels(user.id);
  return user;
}

async function migrateLegacyPreferences(userId: string): Promise<void> {
  const { data: currentPreferences } = await supabase
    .from("user_preferences")
    .select("profile_context, output_format")
    .eq("user_id", userId)
    .single();

  if (currentPreferences?.profile_context || currentPreferences?.output_format) return;

  const { data: legacyEntries } = await supabase
    .from("user_context")
    .select("label, context")
    .eq("active", true);

  if (!legacyEntries?.length) return;

  const outputFormat = legacyEntries.find(
    (entry: { label: string }) => entry.label === "output_format"
  )?.context;
  const profileContext = legacyEntries
    .filter((entry: { label: string }) => entry.label !== "output_format")
    .map((entry: { label: string; context: string }) => `${entry.label}: ${entry.context}`)
    .join("\n");

  await supabase
    .from("user_preferences")
    .upsert(
      {
        user_id: userId,
        profile_context: profileContext || null,
        output_format: outputFormat || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );
}

async function subscribeLegacyChannels(userId: string): Promise<void> {
  const { data: channels } = await supabase
    .from("channels")
    .select("*")
    .eq("active", true);

  for (const channel of (channels ?? []) as Channel[]) {
    await supabase
      .from("user_channel_subscriptions")
      .upsert(
        {
          user_id: userId,
          channel_id: channel.id,
          default_category: channel.default_category,
          active: true,
        },
        { onConflict: "user_id,channel_id" }
      );
  }
}

export async function loadUserByChatId(chatId: string): Promise<User | null> {
  const { data } = await supabase
    .from("users")
    .select("*")
    .eq("telegram_chat_id", chatId)
    .single();

  return (data as User | null) ?? null;
}

export async function loadActiveSubscribers(channelId: string): Promise<User[]> {
  const { data: subscriptions, error } = await supabase
    .from("user_channel_subscriptions")
    .select("user_id")
    .eq("channel_id", channelId)
    .eq("active", true);

  if (error || !subscriptions?.length) {
    if (error) log.error("users", `Failed to load subscribers for channel ${channelId}`, error);
    return [];
  }

  const users: User[] = [];
  for (const subscription of subscriptions as Array<{ user_id: string }>) {
    const { data: user } = await supabase
      .from("users")
      .select("*")
      .eq("id", subscription.user_id)
      .eq("status", "active")
      .single();

    if (user) users.push(user as User);
  }

  return users;
}
