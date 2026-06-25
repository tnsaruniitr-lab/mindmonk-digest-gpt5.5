# YouTube Digest Bot

A personal Telegram bot that tracks favorite YouTube channels, detects new uploads from their RSS feeds, fetches transcripts, turns them into structured digests, and sends them to Telegram.

## What It Does

- Register YouTube channels with `/add_channel`.
- Poll active channels every 20 minutes through YouTube RSS.
- Queue newly published videos.
- Fetch English transcripts from YouTube captions.
- Generate a structured summary with Anthropic.
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
```

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

## Preferred Output Format

Send `/set_format` with a multi-line template. Future Telegram digests will use that layout.

Example:

```text
/set_format
{{title}}
{{channel}} | {{category}}
{{source_url}}

TL;DR
{{tldr}}

Best ideas
{{key_learnings_numbered}}

Why this matters to me
{{applicable_to_me}}

Next actions
{{action_items}}

Watch decision
{{skip_assessment}}
```

Available placeholders:

- `{{title}}`
- `{{channel}}`
- `{{category}}`
- `{{source_url}}`
- `{{tldr}}`
- `{{key_learnings}}`
- `{{key_learnings_numbered}}`
- `{{applicable_to_me}}`
- `{{applicable_to_me_numbered}}`
- `{{action_items}}`
- `{{action_items_numbered}}`
- `{{quotable_moments}}`
- `{{quotable_moments_numbered}}`
- `{{skip_assessment}}`
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
