import { z } from "zod";
import dotenv from "dotenv";
dotenv.config({ override: true });

function copyLegacyEnv(target: string, legacy: string): void {
  const current = process.env[target]?.trim();
  const fallback = process.env[legacy]?.trim();
  if (!current && fallback) process.env[target] = fallback;
}

copyLegacyEnv("AUDIO_CHUNK_SECONDS", "GROQ_AUDIO_CHUNK_SECONDS");
copyLegacyEnv("AUDIO_MAX_RATE_LIMIT_WAIT_SECONDS", "GROQ_MAX_RATE_LIMIT_WAIT_SECONDS");
copyLegacyEnv("AUDIO_MAX_UPLOAD_MB", "GROQ_MAX_UPLOAD_MB");

const optionalHttpUrl = z
  .string()
  .optional()
  .default("")
  .refine((value) => !value || /^https?:\/\//i.test(value), {
    message: "Expected an http(s) URL",
  });

function emptyToUndefined(value: unknown): unknown {
  return typeof value === "string" && value.trim() === "" ? undefined : value;
}

function numberEnv(defaultValue: number, min: number, max?: number) {
  let schema = z.coerce.number().min(min);
  if (typeof max === "number") schema = schema.max(max);
  return z.preprocess((value) => emptyToUndefined(value) ?? defaultValue, schema);
}

const envSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_CHAT_ID: z.string().optional().default(""),
  TELEGRAM_WEBHOOK_URL: optionalHttpUrl,
  TELEGRAM_WEBHOOK_SECRET: z.string().optional().default(""),
  BOT_MODE: z.enum(["auto", "polling", "webhook"]).optional().default("auto"),
  SERVICE_ROLE: z.enum(["all", "web", "worker", "scheduler"]).optional().default("all"),
  ADMIN_METRICS_TOKEN: z.string().optional().default(""),
  DATABASE_URL: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  ANTHROPIC_MODEL: z.string().optional().default("claude-sonnet-4-6"),
  ANTHROPIC_INPUT_COST_PER_MILLION_USD: numberEnv(3, 0),
  ANTHROPIC_OUTPUT_COST_PER_MILLION_USD: numberEnv(15, 0),
  OPENAI_API_KEY: z.string().optional().default(""),
  OPENAI_TRANSCRIPTION_MODEL: z.string().optional().default("whisper-1"),
  OPENAI_TRANSCRIPTION_COST_PER_MINUTE_USD: numberEnv(0.006, 0),
  GROQ_API_KEY: z.string().optional().default(""),
  GROQ_TRANSCRIPTION_MODEL: z.string().optional().default("whisper-large-v3-turbo"),
  GROQ_TRANSCRIPTION_COST_PER_MINUTE_USD: numberEnv(0, 0),
  AUDIO_TRANSCRIPTION_PROVIDERS: z.string().optional().default(""),
  AUDIO_CHUNK_SECONDS: numberEnv(180, 60, 1800),
  AUDIO_MAX_RATE_LIMIT_WAIT_SECONDS: numberEnv(600, 30, 1800),
  AUDIO_MAX_UPLOAD_MB: numberEnv(24, 1, 100),
  JOB_WORKER_ENABLED: z
    .string()
    .optional()
    .default("true")
    .transform((value) => value.toLowerCase() !== "false"),
  JOB_POLL_INTERVAL_SECONDS: numberEnv(10, 2, 300),
  JOB_LOCK_SECONDS: numberEnv(900, 30, 3600),
  JOB_RETRY_BASE_SECONDS: numberEnv(60, 10, 3600),
  MAX_VIDEO_PROCESSING_CONCURRENCY: numberEnv(1, 1, 10),
  MAX_TRANSCRIPT_CONCURRENCY: numberEnv(2, 1, 10),
  MAX_SUMMARY_CONCURRENCY: numberEnv(3, 1, 20),
  MAX_DELIVERY_CONCURRENCY: numberEnv(10, 1, 50),
  MAX_EXTRACTION_CONCURRENCY: numberEnv(1, 1, 10),
  GROQ_AUDIO_CHUNK_SECONDS: numberEnv(180, 60, 1800),
  GROQ_MAX_RATE_LIMIT_WAIT_SECONDS: numberEnv(600, 30, 1800),
  GROQ_MAX_UPLOAD_MB: numberEnv(24, 1, 100),
  TRANSCRIPT_AUDIO_FALLBACK: z
    .string()
    .optional()
    .default("true")
    .transform((value) => value.toLowerCase() !== "false"),
  YTDLP_PROXY_URL: optionalHttpUrl,
  YTDLP_BINARY_PATH: z.string().optional().default(""),
  GRADER_LLM_BASE_URL: optionalHttpUrl.default("https://api.openai.com/v1"),
  GRADER_LLM_MODEL: z.string().optional().default(""),
  GRADER_LLM_API_KEY: z.string().optional().default(""),
  FREE_CHANNEL_LIMIT: numberEnv(3, 0),
  FREE_MANUAL_FETCHES_PER_MONTH: numberEnv(5, 0),
  FREE_MAX_VIDEO_MINUTES: numberEnv(60, 1),
  FREE_MAX_ACTIVE_JOBS: numberEnv(2, 0),
  BETA_CHANNEL_LIMIT: numberEnv(20, 0),
  BETA_MANUAL_FETCHES_PER_MONTH: numberEnv(100, 0),
  BETA_MAX_VIDEO_MINUTES: numberEnv(180, 1),
  BETA_MAX_ACTIVE_JOBS: numberEnv(10, 0),
  ADMIN_MAX_VIDEO_MINUTES: numberEnv(240, 1),
  GLOBAL_DAILY_TRANSCRIPTION_MINUTES_CAP: numberEnv(600, 0),
  GLOBAL_DAILY_LLM_TOKENS_CAP: numberEnv(5_000_000, 0),
  GLOBAL_DAILY_ESTIMATED_COST_CAP_USD: numberEnv(100, 0),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("[youtube-digest] Missing environment variables:");
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

export const config = parsed.data;

/** Set once the owner sends /start. All commands are gated to this ID. */
export let ownerChatId: string = config.TELEGRAM_CHAT_ID;

export function setOwnerChatId(chatId: string) {
  ownerChatId = chatId;
  console.log(`[youtube-digest] Owner chat ID set to ${chatId}`);
}
