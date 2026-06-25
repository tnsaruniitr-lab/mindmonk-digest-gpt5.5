# YouTube Digest Bot

A personal Telegram bot that tracks favorite YouTube channels, detects new uploads from their RSS feeds, fetches transcripts, turns them into structured digests, and sends them to Telegram.

## What It Does

- Register YouTube channels with `/add_channel`.
- Poll active channels every 20 minutes through YouTube RSS.
- Queue newly published videos.
- Fetch English transcripts from YouTube captions.
- Fall back to proxy-backed audio transcription with OpenAI Whisper/Groq when captions are missing.
- Generate a structured summary with Anthropic.
- Optionally grade the ideas with a separate OpenAI-compatible grader LLM.
- Render the result in your preferred Telegram format.
- Send the digest to your Telegram chat.

## Setup

1. Copy the environment template:

```bash
cp .env.example .env
```

2. Fill in:

```bash
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
TELEGRAM_WEBHOOK_URL=
TELEGRAM_WEBHOOK_SECRET=
BOT_MODE=auto
DATABASE_URL=
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-sonnet-4-6
OPENAI_API_KEY=
OPENAI_TRANSCRIPTION_MODEL=whisper-1
OPENAI_TRANSCRIPTION_COST_PER_MINUTE_USD=0.006
AUDIO_TRANSCRIPTION_PROVIDERS=openai,groq
AUDIO_CHUNK_SECONDS=180
AUDIO_MAX_RATE_LIMIT_WAIT_SECONDS=600
AUDIO_MAX_UPLOAD_MB=24
JOB_WORKER_ENABLED=true
JOB_POLL_INTERVAL_SECONDS=10
JOB_LOCK_SECONDS=900
JOB_RETRY_BASE_SECONDS=60
MAX_VIDEO_PROCESSING_CONCURRENCY=1
GROQ_API_KEY=
GROQ_TRANSCRIPTION_MODEL=whisper-large-v3-turbo
GROQ_TRANSCRIPTION_COST_PER_MINUTE_USD=0
GROQ_AUDIO_CHUNK_SECONDS=180
GROQ_MAX_RATE_LIMIT_WAIT_SECONDS=600
GROQ_MAX_UPLOAD_MB=24
TRANSCRIPT_AUDIO_FALLBACK=true
YTDLP_PROXY_URL=
YTDLP_BINARY_PATH=
GRADER_LLM_BASE_URL=https://api.openai.com/v1
GRADER_LLM_MODEL=
GRADER_LLM_API_KEY=
```

The grader LLM fields are optional. Leave them blank to use the main summarizer's grading. Fill them when you want the "Unbiased grading" section to be produced by a separate model. Do not commit a real API key.

The OpenAI/Groq and `yt-dlp` fields are optional but recommended when you want fallback transcription for videos with disabled captions. `AUDIO_TRANSCRIPTION_PROVIDERS` is a comma-separated order such as `openai,groq`; use `openai` alone if you want to avoid Groq entirely. `YTDLP_PROXY_URL` should be a residential proxy URL stored as a secret, not committed. If `YTDLP_BINARY_PATH` is blank, the app downloads a runtime `yt-dlp` binary into `/tmp`. Audio is chunked before upload so provider rate limits can be retried chunk by chunk. The transcription cost values are estimates used for stored transcript metadata and future quota reporting.

The job worker fields control the durable Postgres-backed queue. Keep `MAX_VIDEO_PROCESSING_CONCURRENCY=1` until the proxy, OpenAI, Anthropic, and Railway CPU limits have been measured under load.

3. Install dependencies:

```bash
npm install
```

4. Run locally:

```bash
npm run start
```

For development with reloads:

```bash
npm run dev
```

## Railway Deployment

Railway's public URL expects an HTTP listener, so the app starts a small health server on `process.env.PORT`.

- `/` serves the product landing page and `/health` returns a JSON health response.
- In Railway, set `DATABASE_URL` from the attached Postgres service.
- Set `BOT_MODE=webhook` and `TELEGRAM_WEBHOOK_URL=https://<your-railway-domain>/telegram/<secret>` to avoid Telegram long-polling conflicts.
- The real product interface is still Telegram.
- Set all required environment variables in Railway before deploying.
- Railway should run `npm run build` and then `npm start`, which starts the compiled app from `dist/index.js`.

## Telegram Commands

- `/start` - bind the bot to your Telegram chat.
- `/add_channel <youtube_url> [category]` - track a YouTube channel.
- `/remove_channel <name>` - stop tracking a channel.
- `/list_channels` - show tracked channels.
- `/fetch <youtube_video_url>` - summarize one video now, or resend the cached summary.
- `/channel <youtube_channel_url>` - summarize the latest video from a channel.
- `/digest <youtube_video_url>` - summarize one video now.
- `/set_context <label> <text>` - add personal context for better summaries.
- `/set_format` - show or set your preferred digest template.
- `/reprocess <youtube_video_url>` - regenerate a summary.
- `/status` - show queue and processing stats.

Categories:

- `investing`
- `psychology`
- `podcast_interview`
- `seo_marketing`
- `tech_ai_startup`

## Profile Context

Set your profile so the fourth section can match ideas to you:

```text
/set_context profile I am a SaaS founder building AI-powered SEO tools. I care about practical growth, durable moats, product velocity, and investment-quality thinking.
```

## Preferred Output Format

Send `/set_format` with a multi-line template. Future Telegram digests will use that layout.

Default format:

```text
/set_format
{{title}}
{{channel}} | {{category}}
{{source_url}}

1. Key insights
{{key_insights_numbered}}

2. Patterns and anti-patterns
{{patterns_antipatterns}}

3. Unbiased grading of the ideas
{{unbiased_grading}}

4. Tailor-made learnings for my profile
{{tailored_learnings}}

Next actions
{{tailored_actions}}
```

Available placeholders:

- `{{title}}`
- `{{channel}}`
- `{{category}}`
- `{{source_url}}`
- `{{key_insights}}`
- `{{key_insights_numbered}}`
- `{{patterns_antipatterns}}`
- `{{patterns_antipatterns_numbered}}`
- `{{unbiased_grading}}`
- `{{idea_grade}}`
- `{{tailored_learnings}}`
- `{{tailored_learnings_numbered}}`
- `{{tailored_actions}}`
- `{{tailored_actions_numbered}}`
- `{{brain_object_count}}`

Reset to the default layout:

```text
/set_format reset
```

## Processing Flow

```text
YouTube RSS -> videos table -> jobs table -> transcripts table -> classification -> summary -> Telegram delivery
```

The scheduler polls RSS every 20 minutes and enqueues pending videos every 5 minutes. The worker claims jobs with Postgres row locks so retries and future multi-worker processing are safer. Transcripts are stored once per video/language in `transcripts`; summaries reuse that canonical transcript instead of writing new raw transcript blobs into `summaries`.
