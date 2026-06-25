import { z } from "zod";
import dotenv from "dotenv";
dotenv.config({ override: true });

const envSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_CHAT_ID: z.string().optional().default(""),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_KEY: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  GRADER_LLM_BASE_URL: z.string().optional().default("https://api.openai.com/v1"),
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
