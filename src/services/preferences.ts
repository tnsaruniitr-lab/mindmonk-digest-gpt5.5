import { supabase } from "../db/supabase.js";
import { log } from "../utils/logger.js";

export const OUTPUT_FORMAT_LABEL = "output_format";

export interface ContextEntry {
  label: string;
  context: string;
}

export interface UserPreferences {
  personalContext: ContextEntry[];
  outputFormat: string | null;
}

function parseContextEntries(profileContext: string | null | undefined): ContextEntry[] {
  if (!profileContext?.trim()) return [];

  return profileContext
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separatorIndex = line.indexOf(":");
      if (separatorIndex === -1) return { label: "profile", context: line };

      return {
        label: line.slice(0, separatorIndex).trim() || "profile",
        context: line.slice(separatorIndex + 1).trim(),
      };
    })
    .filter((entry) => entry.context);
}

function serializeContextEntries(entries: ContextEntry[]): string {
  return entries.map((entry) => `${entry.label}: ${entry.context}`).join("\n");
}

async function getLegacyPreferences(): Promise<UserPreferences> {
  const { data, error } = await supabase
    .from("user_context")
    .select("label, context")
    .eq("active", true);

  if (error) {
    log.error("preferences", "Failed to load preferences", error);
    return { personalContext: [], outputFormat: null };
  }

  const entries = (data ?? []) as ContextEntry[];
  const outputFormat =
    entries.find((entry) => entry.label === OUTPUT_FORMAT_LABEL)?.context.trim() || null;

  return {
    outputFormat,
    personalContext: entries.filter((entry) => entry.label !== OUTPUT_FORMAT_LABEL),
  };
}

export async function getUserPreferences(userId?: string | null): Promise<UserPreferences> {
  if (!userId) return getLegacyPreferences();

  const { data, error } = await supabase
    .from("user_preferences")
    .select("profile_context, output_format")
    .eq("user_id", userId)
    .single();

  if (error) {
    log.error("preferences", `Failed to load preferences for user ${userId}`, error);
    return getLegacyPreferences();
  }

  return {
    outputFormat: data?.output_format?.trim() || null,
    personalContext: parseContextEntries(data?.profile_context),
  };
}

export async function getOutputFormat(userId?: string | null): Promise<string | null> {
  if (userId) {
    const { data, error } = await supabase
      .from("user_preferences")
      .select("output_format")
      .eq("user_id", userId)
      .single();

    if (error) return null;
    return data?.output_format?.trim() || null;
  }

  const { data, error } = await supabase
    .from("user_context")
    .select("context")
    .eq("label", OUTPUT_FORMAT_LABEL)
    .eq("active", true)
    .single();

  if (error) return null;
  return data?.context?.trim() || null;
}

export async function setOutputFormat(format: string, userId?: string | null): Promise<boolean> {
  const cleanFormat = format.trim();
  if (!cleanFormat) return false;

  if (userId) {
    const { error } = await supabase
      .from("user_preferences")
      .upsert(
        {
          user_id: userId,
          output_format: cleanFormat,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );

    if (error) {
      log.error("preferences", `Failed to save output format for user ${userId}`, error);
      return false;
    }
    return true;
  }

  const { data: existing, error: lookupError } = await supabase
    .from("user_context")
    .select("id")
    .eq("label", OUTPUT_FORMAT_LABEL)
    .single();

  if (lookupError && lookupError.code !== "PGRST116") {
    log.error("preferences", "Failed to look up output format", lookupError);
    return false;
  }

  if (existing) {
    const { error } = await supabase
      .from("user_context")
      .update({ context: cleanFormat, active: true })
      .eq("id", existing.id);

    if (error) {
      log.error("preferences", "Failed to update output format", error);
      return false;
    }
    return true;
  }

  const { error } = await supabase
    .from("user_context")
    .insert({ label: OUTPUT_FORMAT_LABEL, context: cleanFormat, active: true });

  if (error) {
    log.error("preferences", "Failed to save output format", error);
    return false;
  }

  return true;
}

export async function clearOutputFormat(userId?: string | null): Promise<boolean> {
  if (userId) {
    const { error } = await supabase
      .from("user_preferences")
      .upsert(
        {
          user_id: userId,
          output_format: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );

    if (error) {
      log.error("preferences", `Failed to clear output format for user ${userId}`, error);
      return false;
    }
    return true;
  }

  const { error } = await supabase
    .from("user_context")
    .update({ active: false })
    .eq("label", OUTPUT_FORMAT_LABEL);

  if (error) {
    log.error("preferences", "Failed to clear output format", error);
    return false;
  }

  return true;
}

export async function setContextEntry(
  userId: string,
  label: string,
  context: string
): Promise<boolean> {
  const cleanLabel = label.trim();
  const cleanContext = context.trim();
  if (!cleanLabel || !cleanContext) return false;

  const preferences = await getUserPreferences(userId);
  const entries = preferences.personalContext.filter(
    (entry) => entry.label.toLowerCase() !== cleanLabel.toLowerCase()
  );
  entries.push({ label: cleanLabel, context: cleanContext });

  const { error } = await supabase
    .from("user_preferences")
    .upsert(
      {
        user_id: userId,
        profile_context: serializeContextEntries(entries),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );

  if (error) {
    log.error("preferences", `Failed to save context for user ${userId}`, error);
    return false;
  }

  return true;
}
