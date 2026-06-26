import { z } from "zod";
import dotenv from "dotenv";
dotenv.config({ override: true });

process.env.AUDIO_CHUNK_SECONDS ??= process.env.GROQ_AUDIO_CHUNK_SECONDS;
process.env.AUDIO_MAX_RATE_LIMIT_WAIT_SECONDS ??= process.env.GROQ_MAX_RATE_LIMIT_WAIT_SECONDS;
process.env.AUDIO_MAX_UPLOAD_MB ??= process.env.GROQ_MAX_UPLOAD_MB;

const optionalHttpUrl = z
  .string()
  .optional()
  .default("")
  .refine((value) => !value || /^https?:\/\//i.test(value), {
    message: "Expected an http(s) URL",
  });

const envSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_CHAT_ID: z.string().optional().default(""),
  TELEGRAM_WEBHOOK_URL: optionalHttpUrl,
  TELEGRAM_WEBHOOK_SECRET: z.string().optional().default(""),
  BOT_MODE: z.enum(["auto", "polling", "webhook"]).optional().default("auto"),
  SERVICE_ROLE: z.enum(["all", "web", "worker", "scheduler"]).optional().default("all"),
  DATABASE_URL: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  ANTHROPIC_MODEL: z.string().optional().default("claude-sonnet-4-6"),
  ANTHROPIC_INPUT_COST_PER_MILLION_USD: z.coerce.number().min(0).optional().default(3),
  ANTHROPIC_OUTPUT_COST_PER_MILLION_USD: z.coerce.number().min(0).optional().default(15),
  OPENAI_API_KEY: z.string().optional().default(""),
  OPENAI_TRANSCRIPTION_MODEL: z.string().optional().default("whisper-1"),
  OPENAI_TRANSCRIPTION_COST_PER_MINUTE_USD: z.coerce.number().min(0).optional().default(0.006),
  GROQ_API_KEY: z.string().optional().default(""),
  GROQ_TRANSCRIPTION_MODEL: z.string().optional().default("whisper-large-v3-turbo"),
  GROQ_TRANSCRIPTION_COST_PER_MINUTE_USD: z.coerce.number().min(0).optional().default(0),
  AUDIO_TRANSCRIPTION_PROVIDERS: z.string().optional().default(""),
  AUDIO_CHUNK_SECONDS: z.coerce.number().min(60).max(1800).optional().default(180),
  AUDIO_MAX_RATE_LIMIT_WAIT_SECONDS: z.coerce.number().min(30).max(1800).optional().default(600),
  AUDIO_MAX_UPLOAD_MB: z.coerce.number().min(1).max(100).optional().default(24),
  JOB_WORKER_ENABLED: z
    .string()
    .optional()
    .default("true")
    .transform((value) => value.toLowerCase() !== "false"),
  JOB_POLL_INTERVAL_SECONDS: z.coerce.number().min(2).max(300).optional().default(10),
  JOB_LOCK_SECONDS: z.coerce.number().min(30).max(3600).optional().default(900),
  JOB_RETRY_BASE_SECONDS: z.coerce.number().min(10).max(3600).optional().default(60),
  MAX_VIDEO_PROCESSING_CONCURRENCY: z.coerce.number().min(1).max(10).optional().default(1),
  GROQ_AUDIO_CHUNK_SECONDS: z.coerce.number().min(60).max(1800).optional().default(180),
  GROQ_MAX_RATE_LIMIT_WAIT_SECONDS: z.coerce.number().min(30).max(1800).optional().default(600),
  GROQ_MAX_UPLOAD_MB: z.coerce.number().min(1).max(100).optional().default(24),
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
  FREE_CHANNEL_LIMIT: z.coerce.number().min(0).optional().default(3),
  FREE_MANUAL_FETCHES_PER_MONTH: z.coerce.number().min(0).optional().default(5),
  FREE_MAX_VIDEO_MINUTES: z.coerce.number().min(1).optional().default(60),
  FREE_MAX_ACTIVE_JOBS: z.coerce.number().min(0).optional().default(2),
  BETA_CHANNEL_LIMIT: z.coerce.number().min(0).optional().default(20),
  BETA_MANUAL_FETCHES_PER_MONTH: z.coerce.number().min(0).optional().default(100),
  BETA_MAX_VIDEO_MINUTES: z.coerce.number().min(1).optional().default(180),
  BETA_MAX_ACTIVE_JOBS: z.coerce.number().min(0).optional().default(10),
  ADMIN_MAX_VIDEO_MINUTES: z.coerce.number().min(1).optional().default(240),
  GLOBAL_DAILY_TRANSCRIPTION_MINUTES_CAP: z.coerce.number().min(0).optional().default(600),
  GLOBAL_DAILY_LLM_TOKENS_CAP: z.coerce.number().min(0).optional().default(5_000_000),
  GLOBAL_DAILY_ESTIMATED_COST_CAP_USD: z.coerce.number().min(0).optional().default(100),
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
