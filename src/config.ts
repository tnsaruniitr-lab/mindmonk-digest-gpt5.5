import { z } from "zod";
import dotenv from "dotenv";
dotenv.config({ override: true });

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
  DATABASE_URL: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  GRADER_LLM_BASE_URL: optionalHttpUrl.default("https://api.openai.com/v1"),
  GRADER_LLM_MODEL: z.string().optional().default(""),
  GRADER_LLM_API_KEY: z.string().optional().default(""),
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
