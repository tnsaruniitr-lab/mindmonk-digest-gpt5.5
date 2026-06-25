# YouTube Digest Bot

A personal Telegram bot that tracks favorite YouTube channels, detects new uploads from their RSS feeds, fetches transcripts, turns them into structured digests, and sends them to Telegram.

## What It Does

- Register YouTube channels with `/add_channel`.
- Poll active channels every 20 minutes through YouTube RSS.
- Queue newly published videos.
- Fetch English transcripts from YouTube captions.
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
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
ANTHROPIC_API_KEY=
GRADER_LLM_BASE_URL=https://api.openai.com/v1
GRADER_LLM_MODEL=
GRADER_LLM_API_KEY=
```

The grader LLM fields are optional. Leave them blank to use the main summarizer's grading. Fill them when you want the "Unbiased grading" section to be produced by a separate model. Do not commit a real API key.

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

## Telegram Commands

- `/start` - bind the bot to your Telegram chat.
- `/add_channel <youtube_url> [category]` - track a YouTube channel.
- `/remove_channel <name>` - stop tracking a channel.
- `/list_channels` - show tracked channels.
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
YouTube RSS -> videos table -> transcript fetch -> classification -> summary -> Telegram delivery
```

The scheduler polls RSS every 20 minutes and processes queued videos every 5 minutes.
