import { z } from "zod";

// --- Category ---
export const categories = [
  "investing",
  "psychology",
  "podcast_interview",
  "seo_marketing",
  "tech_ai_startup",
] as const;

export type Category = (typeof categories)[number];

// --- Brain object types ---
export const brainObjectTypes = [
  "principle",
  "rule",
  "playbook",
  "anti_pattern",
  "mental_model",
  "pattern",
] as const;

export type BrainObjectType = (typeof brainObjectTypes)[number];

// --- Confidence ---
export const confidenceLevels = [
  "stated_as_fact",
  "strong_opinion",
  "speculation",
] as const;

export type Confidence = (typeof confidenceLevels)[number];

// --- Transcript status ---
export type TranscriptStatus = "pending" | "available" | "unavailable";

// --- DB row types ---
export interface Channel {
  id: string;
  youtube_channel_id: string;
  name: string;
  thumbnail_url: string | null;
  rss_feed_url: string | null;
  active: boolean;
  default_category: Category | null;
  created_at: string;
}

export interface User {
  id: string;
  telegram_user_id: string;
  telegram_chat_id: string;
  username: string | null;
  display_name: string | null;
  timezone: string;
  plan: string;
  status: "active" | "blocked";
  created_at: string;
  last_seen_at: string | null;
}

export interface UserPreferencesRow {
  user_id: string;
  profile_context: string | null;
  output_format: string | null;
  delivery_mode: string;
  max_auto_digests_per_day: number;
  created_at: string;
  updated_at: string;
}

export interface UserChannelSubscription {
  id: string;
  user_id: string;
  channel_id: string;
  default_category: Category | null;
  active: boolean;
  created_at: string;
}

export interface Video {
  id: string;
  channel_id: string;
  youtube_video_id: string;
  title: string;
  published_at: string | null;
  duration_seconds: number | null;
  thumbnail_url: string | null;
  processed: boolean;
  category: Category | null;
  transcript_status: TranscriptStatus;
  created_at: string;
}

export interface Transcript {
  id: string;
  video_id: string;
  provider: string;
  source: "captions" | "audio" | "summary_cache";
  language: string;
  text: string;
  char_count: number;
  duration_seconds: number | null;
  cost_usd: string | number | null;
  created_at: string;
  updated_at: string;
}

export interface Summary {
  id: string;
  video_id: string;
  tldr: string | null;
  key_learnings: string[] | null;
  applicable_to_me: string[] | null;
  action_items: string[] | null;
  quotable_moments: string[] | null;
  skip_assessment: string | null;
  raw_transcript: string | null;
  model_used: string | null;
  tokens_used: number | null;
  created_at: string;
}

export interface BrainObject {
  id: string;
  type: BrainObjectType;
  content: string;
  author: string | null;
  source_video_id: string | null;
  channel_name: string | null;
  category: string | null;
  context: string | null;
  confidence: Confidence | null;
  tags: string[];
  created_at: string;
}

export interface UserContext {
  id: string;
  label: string;
  context: string;
  active: boolean;
  created_at: string;
}

// --- Zod schemas for Claude JSON output validation ---
export const SummaryResponseSchema = z.object({
  tldr: z.string(),
  key_learnings: z.array(z.string()),
  applicable_to_me: z.array(z.string()),
  action_items: z.array(z.string()),
  quotable_moments: z.array(z.string()),
  skip_assessment: z.string(),
});

export type SummaryResponse = z.infer<typeof SummaryResponseSchema>;

export const BrainObjectItemSchema = z.object({
  type: z.enum(brainObjectTypes),
  content: z.string(),
  author: z.string().nullable(),
  context: z.string(),
  confidence: z.enum(confidenceLevels),
  tags: z.array(z.string()),
});

export const BrainObjectResponseSchema = z.array(BrainObjectItemSchema);

export type BrainObjectResponse = z.infer<typeof BrainObjectResponseSchema>;

export const ClassificationResponseSchema = z.object({
  category: z.enum(categories),
  reasoning: z.string(),
});

export type ClassificationResponse = z.infer<typeof ClassificationResponseSchema>;
