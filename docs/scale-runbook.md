# MindMonk Scale Runbook

This runbook is the production checklist for moving beyond a private beta.

## Service Roles

Recommended Railway services from the same repo:

| Service | Env | Purpose |
|---|---|---|
| `mindmonk-web` | `SERVICE_ROLE=web`, `BOT_MODE=webhook` | Telegram commands, landing page, health/readiness |
| `mindmonk-worker` | `SERVICE_ROLE=worker`, `JOB_WORKER_ENABLED=true` | Transcript, audio fallback, summaries, delivery |
| `mindmonk-scheduler` | `SERVICE_ROLE=scheduler` | RSS polling and queue seeding |

Keep `SERVICE_ROLE=all` only for local development or a small private beta.

## Required Checks

Run before inviting users:

```bash
npm run build
npm run scale:check
```

Check production endpoints:

```bash
curl https://<domain>/health
curl https://<domain>/ready
curl -H "Authorization: Bearer $ADMIN_METRICS_TOKEN" https://<domain>/metrics
```

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
- Dead jobs are zero.
- Global caps are non-zero.
- `MAX_VIDEO_PROCESSING_CONCURRENCY` has been load-tested above `1` before increasing it.
- Railway services are split into web, worker, and scheduler.
- A DB backup and restore path has been verified.
