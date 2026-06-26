# MindMonk Scale Runbook

This runbook is the production checklist for moving beyond a private beta.

## Service Roles

Recommended Railway services from the same repo:

| Service | Env | Purpose |
|---|---|---|
| `mindmonk-digest-gpt5.5` | `SERVICE_ROLE=web`, `BOT_MODE=webhook` | Telegram commands, landing page, health/readiness |
| `mindmonk-worker` | `SERVICE_ROLE=worker`, `JOB_WORKER_ENABLED=true` | Transcript, audio fallback, summaries, delivery |
| `mindmonk-scheduler` | `SERVICE_ROLE=scheduler` | RSS polling and queue seeding |

Keep `SERVICE_ROLE=all` only for local development or a small private beta.

## Required Checks

Run before inviting users:

```bash
npm run build
npm run scale:check
npm run ops:production-check
npm run ops:railway-check
```

Check production endpoints:

```bash
curl https://<domain>/health
curl https://<domain>/ready
curl -H "Authorization: Bearer $ADMIN_METRICS_TOKEN" https://<domain>/metrics
```

Run the DB-backed checks inside the Railway production environment so they use the same secrets and private network as the deployed service:

```bash
railway ssh --service mindmonk-worker npm run scale:check
railway ssh --service mindmonk-worker npm run ops:e2e-regression -- --write
railway ssh --service mindmonk-worker npm run ops:queue-capacity -- --write --jobs=1000
```

`railway run` executes locally with Railway variables injected; it will fail when `DATABASE_URL` points at `postgres.railway.internal`. Use Railway SSH, a Railway one-off/job execution path, or a temporary public DB TCP proxy for DB-backed gates.

The E2E regression check creates synthetic users, preferences, subscriptions, video, transcript, user summaries, usage rows, and non-worker job types. It checks multiuser isolation, shared channel dedupe, canonical transcript uniqueness, per-user summary caching, quota enforcement, queue idempotency, lease/complete/dead-letter behavior, and cleanup. It does not download audio, call LLMs, or send Telegram messages.

The queue-capacity check creates future-dated synthetic jobs with `scale_test:*` idempotency keys, verifies the requested insert count, and deletes them before exit. It does not download audio, call LLMs, or send Telegram messages.

## Current Production Split

As of the current implementation, the Railway production project is split into:

| Service | Role | Public Domain |
|---|---|---|
| `mindmonk-digest-gpt5.5` | Web/API | `mindmonk-digest-gpt55-production.up.railway.app` |
| `mindmonk-worker` | Background worker | None |
| `mindmonk-scheduler` | RSS scheduler | None |

There are currently two Postgres services visible in the Railway project. Treat the duplicate as an ops audit item: verify which `DATABASE_URL` is used by the app and take a backup before removing anything.

## Quota Defaults

| Plan | Channels | Manual Fetches | Max Video |
|---|---:|---:|---:|
| Free | 3 | 5/month | 60 min |
| Beta | 20 | 100/month | 180 min |
| Admin | Unlimited | Unlimited | 240 min |

Global daily caps:

| Cap | Env |
|---|---|
| Transcription minutes | `GLOBAL_DAILY_TRANSCRIPTION_MINUTES_CAP` |
| LLM tokens | `GLOBAL_DAILY_LLM_TOKENS_CAP` |
| Estimated cost | `GLOBAL_DAILY_ESTIMATED_COST_CAP_USD` |

Worker concurrency:

| Resource | Env | Starting Value |
|---|---|---:|
| Legacy wrapper | `MAX_VIDEO_PROCESSING_CONCURRENCY` | 1 |
| Transcript/audio | `MAX_TRANSCRIPT_CONCURRENCY` | 2 |
| Summary LLM | `MAX_SUMMARY_CONCURRENCY` | 3 |
| Telegram delivery | `MAX_DELIVERY_CONCURRENCY` | 10 |
| Brain extraction | `MAX_EXTRACTION_CONCURRENCY` | 1 |

## UAT Checklist

- New user can send `/start`.
- User can add up to their channel limit.
- User over channel limit is refused before subscription.
- User can send `/fetch <url>`.
- User over monthly fetch limit is refused before transcript/LLM work.
- In `SERVICE_ROLE=web`, `/fetch` queues work and returns quickly.
- In `SERVICE_ROLE=worker`, queued jobs are claimed and completed.
- Worker delivers queued manual fetch output to the requesting chat.
- `/usage` shows current plan, fetch usage, transcription minutes, LLM tokens, and global daily caps.
- `/ready` returns 200 after DB schema is initialized.
- `/metrics` requires `ADMIN_METRICS_TOKEN`.
- Killing a worker leaves processing jobs retryable after `JOB_LOCK_SECONDS`.
- No duplicate transcript is created for the same video/language.

## Launch Gates

Do not invite broad usage until:

- `npm run scale:check` has no failures.
- `npm run ops:production-check` reports the public service as `SERVICE_ROLE=web`.
- `npm run ops:railway-check` confirms web, worker, and scheduler services are deployed with the expected roles.
- `npm run ops:e2e-regression -- --write` passes in the Railway production environment.
- `npm run ops:queue-capacity -- --write --jobs=1000` passes in the Railway production environment.
- Dead jobs are zero.
- Global caps are non-zero.
- `MAX_VIDEO_PROCESSING_CONCURRENCY` has been load-tested above `1` before increasing it.
- Railway services are split into web, worker, and scheduler.
- A DB backup and restore path has been verified.
