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

export async function getUserPreferences(): Promise<UserPreferences> {
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

export async function getOutputFormat(): Promise<string | null> {
  const { data, error } = await supabase
    .from("user_context")
    .select("context")
    .eq("label", OUTPUT_FORMAT_LABEL)
    .eq("active", true)
    .single();

  if (error) return null;
  return data?.context?.trim() || null;
}

export async function setOutputFormat(format: string): Promise<boolean> {
  const cleanFormat = format.trim();
  if (!cleanFormat) return false;

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

export async function clearOutputFormat(): Promise<boolean> {
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
