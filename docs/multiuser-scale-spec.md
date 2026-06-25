# MindMonk Multiuser Scale Spec

## Goal

Turn MindMonk from a single-owner Telegram digest bot into a multiuser product that can support 1000 users without uncontrolled downloads, duplicate transcription spend, or cross-user data leakage.

The target product should preserve the current experience:

1. A user registers YouTube channels.
2. MindMonk detects new videos.
3. It obtains a transcript through a waterfall:
   - YouTube captions
   - audio download through proxy
   - OpenAI Whisper
   - backup provider
4. It creates the preferred four-section digest.
5. It sends the digest to Telegram.

The scaled version must add multi-tenant ownership, dedupe, quotas, reliable queues, observability, and billing controls.

## Current Constraints

The current implementation is good for a single owner or very small private beta, but not for 1000 users.

- `channels` are global, not owned by users.
- `user_context` is global and keyed by label, not per user.
- Telegram ownership is a single persisted owner chat.
- Scheduled queue processing is guarded by an in-memory boolean only.
- The queue is `videos.processed = false`; there is no durable job state, attempt count, priority, or lease.
- Raw audio is downloaded into the Railway container `/tmp` and deleted after transcription.
- Transcript text is persisted in `summaries.raw_transcript`.
- On-demand `/fetch` can overlap with scheduled processing.
- Multiple Railway replicas would not coordinate safely.
- There are no quotas, billing records, rate limits, or abuse controls.

## Product Requirements

### User Accounts

Each user must have an isolated account keyed first by Telegram identity.

Required user properties:

- Telegram user ID
- Telegram chat ID
- display name / username
- timezone
- plan tier
- active / blocked status
- created timestamp
- last active timestamp

MVP authentication can remain Telegram-only. Later, add a web dashboard with email/OAuth.

### User Profile

Each user needs private profile/context settings:

- profile text
- preferred output format
- categories of interest
- delivery preferences
- max digests per day
- digest verbosity
- optional muted topics

No user should ever see another user's context, channels, summaries, or delivery state.

### Channel Subscriptions

Users subscribe to channels. Channels themselves should be globally deduped.

Example:

- 100 users subscribe to `The Diary Of A CEO`.
- The channel exists once in `channels`.
- Each user has a row in `user_channel_subscriptions`.
- A new video should be discovered once.
- Transcript should be fetched once.
- Personalized summaries can be generated per user only when needed.

### Commands

Keep Telegram as the MVP interface.

Recommended command model:

- `/start` - create or activate user.
- `/channel <channel_url>` - summarize latest video from a channel for this user.
- `/fetch <video_url>` - summarize one video for this user.
- `/add_channel <channel_url>` - subscribe user to a channel.
- `/remove_channel <channel_url_or_name>` - unsubscribe user.
- `/list_channels` - list only this user's subscriptions.
- `/set_context <text>` - save this user's profile.
- `/set_format` - save this user's template.
- `/usage` - show current billing/usage counters.
- `/pause` and `/resume` - pause/resume automatic delivery.

### Delivery Modes

Support three delivery modes:

- instant: summarize new videos as soon as processed
- daily digest: batch summaries into one daily message
- manual only: only process `/fetch` and `/channel`

Default for scale should be daily digest or manual-only for free users.

## Scale Target

The product should be stable at:

- 1000 registered users
- 200-500 active daily users
- 2000-10000 total channel subscriptions
- 1000-5000 discovered videos per day across all channels
- 100-500 transcription jobs per day, depending on caption availability
- 1000-5000 personalized summary deliveries per day

These numbers are intentionally conservative for Railway/Postgres and one worker service. They leave room for later migration to dedicated queue infrastructure.

## Architecture

### Services

Split the app into logical services. These can initially run from the same repo and Railway project.

1. API/Web/Bot service
   - Telegram webhook receiver
   - health endpoint
   - command routing
   - user settings
   - enqueue requests

2. Scheduler service
   - polls YouTube RSS
   - discovers new videos
   - enqueues transcript jobs

3. Worker service
   - claims jobs from Postgres
   - downloads audio when needed
   - transcribes
   - summarizes
   - delivers Telegram messages

For MVP scale, these may be one deployed service with worker loops. For 1000 users, split bot/API and worker into separate Railway services so web responsiveness is not affected by `ffmpeg` and audio downloads.

### Processing Flow

```text
Telegram command / RSS discovery
  -> upsert channel
  -> upsert video
  -> create transcript job if transcript missing
  -> transcript waterfall
  -> create canonical transcript
  -> create per-user summary job
  -> generate personalized summary
  -> deliver to Telegram
  -> record usage and cost
```

### Dedupe Rules

Canonical data:

- `channels` unique by YouTube channel ID.
- `videos` unique by YouTube video ID.
- `transcripts` unique by video ID and provider/language.

Per-user data:

- subscriptions
- profile/context
- summary preferences
- personalized summaries
- delivery records
- usage/cost records

The expensive waterfall should happen once per video whenever possible. Summary generation may be per user because profile-tailoring differs.

## Database Design

### New Tables

#### users

```sql
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_user_id text UNIQUE NOT NULL,
  telegram_chat_id text UNIQUE NOT NULL,
  username text,
  display_name text,
  timezone text NOT NULL DEFAULT 'UTC',
  plan text NOT NULL DEFAULT 'free',
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz
);
```

#### user_preferences

```sql
CREATE TABLE user_preferences (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  profile_context text,
  output_format text,
  delivery_mode text NOT NULL DEFAULT 'manual',
  max_auto_digests_per_day int NOT NULL DEFAULT 3,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

#### user_channel_subscriptions

```sql
CREATE TABLE user_channel_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  default_category digest_category,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, channel_id)
);
```

#### transcripts

```sql
CREATE TABLE transcripts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id uuid NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  provider text NOT NULL,
  source text NOT NULL,
  language text NOT NULL DEFAULT 'en',
  text text NOT NULL,
  char_count int NOT NULL,
  duration_seconds int,
  cost_usd numeric(12, 6),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (video_id, language)
);
```

Move long transcript text out of `summaries.raw_transcript` and into `transcripts`.

#### user_summaries

```sql
CREATE TABLE user_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  video_id uuid NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  transcript_id uuid REFERENCES transcripts(id) ON DELETE SET NULL,
  tldr text,
  key_learnings text[],
  applicable_to_me text[],
  action_items text[],
  quotable_moments text[],
  skip_assessment text,
  model_used text,
  tokens_used int,
  cost_usd numeric(12, 6),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, video_id)
);
```

#### jobs

```sql
CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  priority int NOT NULL DEFAULT 100,
  run_after timestamptz NOT NULL DEFAULT now(),
  locked_by text,
  locked_until timestamptz,
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 5,
  payload jsonb NOT NULL,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

Job types:

- `poll_channel`
- `fetch_transcript`
- `generate_user_summary`
- `deliver_summary`
- `extract_brain_objects`

#### usage_events

```sql
CREATE TABLE usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  video_id uuid REFERENCES videos(id) ON DELETE SET NULL,
  job_id uuid REFERENCES jobs(id) ON DELETE SET NULL,
  provider text NOT NULL,
  event_type text NOT NULL,
  units numeric(12, 4) NOT NULL,
  unit_name text NOT NULL,
  cost_usd numeric(12, 6),
  created_at timestamptz NOT NULL DEFAULT now()
);
```

Use this for OpenAI audio minutes, Anthropic tokens, proxy bandwidth estimates, and Telegram deliveries.

### Indexes

Add indexes:

- `users(telegram_user_id)`
- `users(telegram_chat_id)`
- `user_channel_subscriptions(user_id, active)`
- `user_channel_subscriptions(channel_id, active)`
- `videos(youtube_video_id)`
- `videos(published_at)`
- `transcripts(video_id, language)`
- `user_summaries(user_id, created_at DESC)`
- `jobs(status, run_after, priority)`
- `jobs(locked_until)`
- `usage_events(user_id, created_at DESC)`

## Queue and Concurrency

### Job Claiming

Use Postgres row locking:

```sql
WITH next_job AS (
  SELECT id
  FROM jobs
  WHERE status = 'queued'
    AND run_after <= now()
  ORDER BY priority ASC, created_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1
)
UPDATE jobs
SET status = 'processing',
    locked_by = $1,
    locked_until = now() + interval '15 minutes',
    attempts = attempts + 1,
    updated_at = now()
WHERE id = (SELECT id FROM next_job)
RETURNING *;
```

This allows multiple worker containers without double-processing the same job.

### Concurrency Limits

Use separate concurrency limits per resource:

- caption fetch: 10 concurrent
- audio download: 1-3 concurrent
- ffmpeg: 1-2 concurrent per worker
- OpenAI Whisper: 2-5 concurrent, depending on rate limits
- Claude summary: 3-10 concurrent, depending on rate limits
- Telegram sends: rate-limited and retried

For 1000 users, do not process 50 audio downloads in parallel by default. Start with:

- `MAX_AUDIO_DOWNLOAD_CONCURRENCY=2`
- `MAX_TRANSCRIPTION_CONCURRENCY=3`
- `MAX_SUMMARY_CONCURRENCY=5`

Increase only after measuring Railway CPU, proxy reliability, and API rate limits.

### Backoff and Retries

Retry transient failures with exponential backoff:

- YouTube/proxy 403/429: retry later, rotate proxy if available
- OpenAI 429/5xx: retry with backoff
- Anthropic 429/5xx: retry with backoff
- Telegram 429: respect retry-after

Permanent failures:

- video unavailable
- private video
- captions disabled and audio download impossible after attempts
- transcript empty after all providers

## Cost Controls

### Cost Attribution

Every expensive operation must write a `usage_events` row.

Track:

- audio minutes transcribed
- OpenAI transcription cost
- Anthropic input/output tokens
- estimated Anthropic cost
- proxy MB downloaded
- failed attempt count

### Quotas

Suggested free tier:

- 5 manual fetches/month
- 3 channels
- daily digest off by default
- no automatic processing unless explicitly enabled

Suggested paid tier:

- 50-200 manual fetches/month
- 20-100 channels
- daily digest
- priority queue

### Budget Guards

Hard stops:

- per-user monthly spend cap
- global daily transcription minute cap
- global daily summarization token cap
- per-video max duration cap, e.g. 3 hours
- per-user max active jobs

No request should be able to trigger unlimited audio downloads.

## Multiuser Personalization Strategy

Use two-layer processing:

1. Canonical transcript layer
   - shared across all users
   - expensive audio/caption work happens once

2. Personalized summary layer
   - generated per user
   - uses the shared transcript plus that user's profile/context/format

For heavily subscribed videos, consider a third layer:

3. Canonical neutral summary
   - generated once per video
   - personalized summaries can be generated from neutral summary plus key transcript excerpts
   - reduces token cost for very popular videos

## Security and Privacy

Required controls:

- Never log API keys, proxy URLs, Telegram tokens, or raw authorization headers.
- Store provider secrets only in Railway environment variables.
- Scope all user commands by Telegram user ID.
- Never load global `user_context` for multiuser summaries.
- Add data deletion path for a user.
- Avoid storing downloaded audio permanently.
- Encrypt sensitive user profile text if required later.
- Make admin commands explicitly gated by admin user IDs.

## Observability

Add structured logs with:

- `request_id`
- `user_id`
- `job_id`
- `video_id`
- `provider`
- `stage`
- `duration_ms`
- `cost_usd`

Add health endpoints:

- `/health` - process health
- `/ready` - DB and queue readiness
- `/metrics` - operational metrics, protected

Key metrics:

- queue depth by job type
- oldest queued job age
- success/failure rate by provider
- average transcript latency
- average summary latency
- OpenAI minutes used today
- Anthropic tokens used today
- proxy failures
- temp disk usage
- active downloads

## Deployment Model

Recommended Railway services:

1. `mindmonk-web`
   - Telegram webhook
   - landing page
   - health endpoints
   - no audio download work

2. `mindmonk-worker`
   - Postgres-backed jobs
   - audio download
   - transcription
   - summarization
   - delivery

3. `Postgres`
   - canonical data, users, jobs, usage

Optional later:

- Redis/BullMQ for queues
- object storage for temporary audio if needed
- separate metrics/logging service
- admin dashboard

## Migration Plan

### Phase 1: Multiuser Foundation

- Add `users`.
- Replace single owner chat with per-user command routing.
- Add `user_preferences`.
- Add `user_channel_subscriptions`.
- Migrate global context into first admin user's preferences.
- Make all commands user-scoped.

### Phase 2: Durable Queue

- Add `jobs`.
- Replace `videos.processed = false` worker loop with job processing.
- Add row-lock job claiming.
- Add retry/backoff/attempt tracking.
- Add per-resource concurrency limits.
- Add idempotency keys to avoid duplicate jobs.

### Phase 3: Transcript Dedupe

- Add `transcripts`.
- Move `raw_transcript` out of summaries.
- Ensure one transcript per video/language.
- Make `/fetch` reuse existing transcript.
- Make automatic channel processing reuse existing transcript.

### Phase 4: Personalized Summaries

- Add `user_summaries`.
- Generate summary per user from shared transcript.
- Deliver per-user summary.
- Add daily digest delivery mode.

### Phase 5: Cost and Quotas

- Add `usage_events`.
- Add `/usage`.
- Add user plan limits.
- Add global spend caps.
- Add admin status command.

### Phase 6: Scale Hardening

- Split web and worker Railway services.
- Add webhook mode for Telegram.
- Add structured logging.
- Add metrics.
- Add alerts.
- Load test 100, 500, 1000 users.

## Product Decisions to Make Before Build

1. Is this Telegram-only for MVP, or should there be a web dashboard?
2. What is the free-tier quota?
3. Should automatic channel summaries be opt-in or on by default?
4. Should popular videos generate one neutral summary first to reduce per-user token cost?
5. Should users bring their own OpenAI/Anthropic keys or should the product bill them?
6. What is the maximum video length allowed per tier?

## Recommended MVP for 1000 Users

Build this first:

- Telegram-only accounts.
- Per-user channels and profile.
- Shared channel/video/transcript tables.
- Postgres-backed jobs with row locks.
- Concurrency limits:
  - 2 audio downloads
  - 3 transcriptions
  - 5 summaries
- Manual fetch for free users.
- Daily digest for paid users.
- Usage tracking and hard global budget caps.
- Webhook mode instead of polling.

This keeps the product simple while protecting the expensive path.

## Non-Goals for First Scale Pass

- Full web app dashboard.
- Team accounts.
- Payment provider integration.
- Fine-grained admin UI.
- Long-term audio storage.
- Multi-region deployment.
- Recommendation engine.

## Acceptance Criteria

The scale migration is ready when:

- 1000 users can register without global state conflicts.
- Two users can subscribe to the same channel without duplicate channel rows.
- One new video creates one canonical transcript job.
- Multiple users can get personalized summaries from that transcript.
- A worker crash leaves jobs retryable.
- Multiple workers do not process the same job.
- A single user cannot exceed quota.
- A global budget cap prevents runaway API spend.
- `/usage` shows a user's usage.
- Admin logs show queue depth and provider failure rates.
- No raw audio remains after job completion.
