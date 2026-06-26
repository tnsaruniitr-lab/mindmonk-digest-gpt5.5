import { config } from "../config.js";
import { dbQuery, supabase } from "../db/supabase.js";
import type { UsageEventType, User, Video } from "../types/index.js";
import { log } from "../utils/logger.js";

const UNLIMITED = 1_000_000_000;

export interface PlanLimits {
  plan: string;
  channelLimit: number;
  manualFetchesPerMonth: number;
  maxVideoMinutes: number;
  maxActiveJobs: number;
  unrestricted: boolean;
}

export interface QuotaDecision {
  allowed: boolean;
  reason?: string;
}

export interface UsageTotals {
  manualFetches: number;
  autoDigests: number;
  transcriptionMinutes: number;
  proxyMb: number;
  llmTokens: number;
  estimatedCostUsd: number;
}

export interface UsageEventInput {
  userId?: string | null;
  jobId?: string | null;
  videoId?: string | null;
  eventType: UsageEventType;
  provider?: string | null;
  quantity: number;
  unit: string;
  estimatedCostUsd?: number | null;
  metadata?: Record<string, unknown>;
}

export interface UsageContext {
  userId?: string | null;
  jobId?: string | null;
  videoId?: string | null;
}

function startOfUtcDay(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function startOfUtcMonth(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function numberFrom(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

export function getPlanLimits(planName?: string | null): PlanLimits {
  const plan = (planName || "free").toLowerCase();

  if (plan === "admin") {
    return {
      plan,
      channelLimit: UNLIMITED,
      manualFetchesPerMonth: UNLIMITED,
      maxVideoMinutes: config.ADMIN_MAX_VIDEO_MINUTES,
      maxActiveJobs: UNLIMITED,
      unrestricted: true,
    };
  }

  if (plan === "beta") {
    return {
      plan,
      channelLimit: config.BETA_CHANNEL_LIMIT,
      manualFetchesPerMonth: config.BETA_MANUAL_FETCHES_PER_MONTH,
      maxVideoMinutes: config.BETA_MAX_VIDEO_MINUTES,
      maxActiveJobs: config.BETA_MAX_ACTIVE_JOBS,
      unrestricted: false,
    };
  }

  return {
    plan: "free",
    channelLimit: config.FREE_CHANNEL_LIMIT,
    manualFetchesPerMonth: config.FREE_MANUAL_FETCHES_PER_MONTH,
    maxVideoMinutes: config.FREE_MAX_VIDEO_MINUTES,
    maxActiveJobs: config.FREE_MAX_ACTIVE_JOBS,
    unrestricted: false,
  };
}

export async function recordUsageEvent(input: UsageEventInput): Promise<void> {
  if (!Number.isFinite(input.quantity) || input.quantity < 0) return;

  const { error } = await supabase.from("usage_events").insert({
    user_id: input.userId ?? null,
    job_id: input.jobId ?? null,
    video_id: input.videoId ?? null,
    event_type: input.eventType,
    provider: input.provider ?? null,
    quantity: input.quantity,
    unit: input.unit,
    estimated_cost_usd: input.estimatedCostUsd ?? null,
    metadata: input.metadata ?? {},
  });

  if (error) log.error("usage", `Failed to record ${input.eventType}`, error);
}

export async function loadUsageTotals(
  userId: string | null,
  since: Date
): Promise<UsageTotals> {
  const result = await dbQuery<{
    manual_fetches: number;
    auto_digests: number;
    transcription_minutes: string | null;
    proxy_mb: string | null;
    llm_tokens: string | null;
    estimated_cost_usd: string | null;
  }>(
    `
      SELECT
        COUNT(*) FILTER (WHERE event_type = 'manual_fetch')::int AS manual_fetches,
        COUNT(*) FILTER (WHERE event_type = 'auto_digest')::int AS auto_digests,
        COALESCE(SUM(quantity) FILTER (WHERE event_type = 'transcription_minutes'), 0) AS transcription_minutes,
        COALESCE(SUM(quantity) FILTER (WHERE event_type = 'proxy_mb'), 0) AS proxy_mb,
        COALESCE(SUM(quantity) FILTER (WHERE event_type = 'llm_tokens'), 0) AS llm_tokens,
        COALESCE(SUM(estimated_cost_usd), 0) AS estimated_cost_usd
      FROM usage_events
      WHERE created_at >= $1
        AND ($2::uuid IS NULL OR user_id = $2::uuid)
    `,
    [since.toISOString(), userId]
  );

  const row = result.rows[0];
  return {
    manualFetches: row?.manual_fetches ?? 0,
    autoDigests: row?.auto_digests ?? 0,
    transcriptionMinutes: numberFrom(row?.transcription_minutes),
    proxyMb: numberFrom(row?.proxy_mb),
    llmTokens: numberFrom(row?.llm_tokens),
    estimatedCostUsd: numberFrom(row?.estimated_cost_usd),
  };
}

export async function evaluateChannelQuota(
  user: Pick<User, "id" | "plan">,
  channelId?: string | null
): Promise<QuotaDecision> {
  const limits = getPlanLimits(user.plan);
  if (limits.unrestricted) return { allowed: true };

  if (channelId) {
    const { count: alreadySubscribed } = await supabase
      .from("user_channel_subscriptions")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("channel_id", channelId)
      .eq("active", true);

    if ((alreadySubscribed ?? 0) > 0) return { allowed: true };
  }

  const { count } = await supabase
    .from("user_channel_subscriptions")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("active", true);

  const current = count ?? 0;
  if (current >= limits.channelLimit) {
    return {
      allowed: false,
      reason: `Your ${limits.plan} plan can track up to ${limits.channelLimit} channel(s). Remove one or ask to move to beta.`,
    };
  }

  return { allowed: true };
}

export async function evaluateManualFetchQuota(
  user: Pick<User, "id" | "plan">,
  video?: Pick<Video, "duration_seconds"> | null
): Promise<QuotaDecision> {
  const limits = getPlanLimits(user.plan);
  if (!limits.unrestricted) {
    const maxSeconds = limits.maxVideoMinutes * 60;
    if (video?.duration_seconds && video.duration_seconds > maxSeconds) {
      return {
        allowed: false,
        reason: `This video is about ${Math.ceil(video.duration_seconds / 60)} minutes. Your ${limits.plan} plan allows videos up to ${limits.maxVideoMinutes} minutes.`,
      };
    }
  }

  if (limits.unrestricted) return { allowed: true };

  const monthly = await loadUsageTotals(user.id, startOfUtcMonth());
  if (monthly.manualFetches >= limits.manualFetchesPerMonth) {
    return {
      allowed: false,
      reason: `You have used ${monthly.manualFetches}/${limits.manualFetchesPerMonth} manual fetches this month on the ${limits.plan} plan.`,
    };
  }

  return { allowed: true };
}

export async function recordManualFetch(
  userId: string,
  videoId?: string | null,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  await recordUsageEvent({
    userId,
    videoId,
    eventType: "manual_fetch",
    quantity: 1,
    unit: "request",
    metadata,
  });
}

export async function evaluateGlobalBudget(
  kind: "transcription_minutes" | "llm_tokens" | "estimated_cost_usd",
  additionalQuantity: number
): Promise<QuotaDecision> {
  if (!Number.isFinite(additionalQuantity) || additionalQuantity <= 0) {
    return { allowed: true };
  }

  const cap =
    kind === "transcription_minutes"
      ? config.GLOBAL_DAILY_TRANSCRIPTION_MINUTES_CAP
      : kind === "llm_tokens"
        ? config.GLOBAL_DAILY_LLM_TOKENS_CAP
        : config.GLOBAL_DAILY_ESTIMATED_COST_CAP_USD;

  if (!cap || cap <= 0) return { allowed: true };

  const daily = await loadUsageTotals(null, startOfUtcDay());
  const current =
    kind === "transcription_minutes"
      ? daily.transcriptionMinutes
      : kind === "llm_tokens"
        ? daily.llmTokens
        : daily.estimatedCostUsd;

  if (current + additionalQuantity > cap) {
    return {
      allowed: false,
      reason: `Global daily ${kind.replace(/_/g, " ")} cap reached (${round(current)}/${cap}).`,
    };
  }

  return { allowed: true };
}

export async function recordTranscriptionUsage(
  context: UsageContext,
  provider: string,
  durationSeconds: number | null,
  costUsd: number | null,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  if (!durationSeconds || durationSeconds <= 0) return;

  await recordUsageEvent({
    userId: context.userId ?? null,
    jobId: context.jobId ?? null,
    videoId: context.videoId ?? null,
    eventType: "transcription_minutes",
    provider,
    quantity: round(durationSeconds / 60, 3),
    unit: "minute",
    estimatedCostUsd: costUsd,
    metadata,
  });
}

export async function recordProxyUsage(
  context: UsageContext,
  bytes: number | null,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  if (!bytes || bytes <= 0) return;

  await recordUsageEvent({
    userId: context.userId ?? null,
    jobId: context.jobId ?? null,
    videoId: context.videoId ?? null,
    eventType: "proxy_mb",
    provider: "yt-dlp",
    quantity: round(bytes / 1024 / 1024, 3),
    unit: "MB",
    metadata,
  });
}

export async function recordLlmUsage(input: {
  context: UsageContext;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}): Promise<void> {
  const quantity = input.inputTokens + input.outputTokens;
  if (quantity <= 0) return;

  const estimatedCostUsd =
    (input.inputTokens / 1_000_000) * config.ANTHROPIC_INPUT_COST_PER_MILLION_USD +
    (input.outputTokens / 1_000_000) * config.ANTHROPIC_OUTPUT_COST_PER_MILLION_USD;

  await recordUsageEvent({
    userId: input.context.userId ?? null,
    jobId: input.context.jobId ?? null,
    videoId: input.context.videoId ?? null,
    eventType: "llm_tokens",
    provider: input.provider,
    quantity,
    unit: "token",
    estimatedCostUsd: Number(estimatedCostUsd.toFixed(6)),
    metadata: {
      model: input.model,
      input_tokens: input.inputTokens,
      output_tokens: input.outputTokens,
    },
  });
}

export async function buildUsageReport(user: Pick<User, "id" | "plan">): Promise<string> {
  const limits = getPlanLimits(user.plan);
  const monthly = await loadUsageTotals(user.id, startOfUtcMonth());
  const dailyGlobal = await loadUsageTotals(null, startOfUtcDay());

  const fetchLimit = limits.unrestricted ? "unlimited" : String(limits.manualFetchesPerMonth);
  const channelLimit = limits.unrestricted ? "unlimited" : String(limits.channelLimit);
  const maxVideo = `${limits.maxVideoMinutes} min`;

  return [
    "*Usage*",
    "",
    `Plan: ${limits.plan}`,
    `Manual fetches this month: ${monthly.manualFetches}/${fetchLimit}`,
    `Tracked channel limit: ${channelLimit}`,
    `Max video length: ${maxVideo}`,
    `Your transcription: ${round(monthly.transcriptionMinutes)} min`,
    `Your LLM tokens: ${Math.round(monthly.llmTokens).toLocaleString("en-US")}`,
    `Your estimated cost: $${monthly.estimatedCostUsd.toFixed(4)}`,
    "",
    "*Global today*",
    `Transcription: ${round(dailyGlobal.transcriptionMinutes)}/${config.GLOBAL_DAILY_TRANSCRIPTION_MINUTES_CAP || "off"} min`,
    `LLM tokens: ${Math.round(dailyGlobal.llmTokens).toLocaleString("en-US")}/${config.GLOBAL_DAILY_LLM_TOKENS_CAP || "off"}`,
    `Estimated cost: $${dailyGlobal.estimatedCostUsd.toFixed(4)}/$${config.GLOBAL_DAILY_ESTIMATED_COST_CAP_USD || "off"}`,
  ].join("\n");
}
