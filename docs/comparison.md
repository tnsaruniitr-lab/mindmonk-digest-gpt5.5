# Codex vs Claude Build Usage Comparison

This document records the MindMonk build usage comparison between Codex `gpt-5.5` and Claude Code Opus 4.8.

The Claude numbers are dev-only and exclude the separate public-repositories engineering audit. The Codex numbers are from the local Codex session logs for this project.

## Summary

| View | Codex gpt-5.5 | Claude Opus 4.8 Dev-Only | Claude / Codex |
|---|---:|---:|---:|
| Earlier snapshot cost | ~$59.46 | ~$141.33 | 2.38x |
| Current snapshot cost | ~$87.78 | ~$220.91 | 2.52x |
| Earlier snapshot tokens | 73.2M | 150.8M | 2.06x |
| Current snapshot tokens | 109.6M | 224.5M | 2.05x |
| Earlier blended cost / 1M tokens | ~$0.81 | ~$0.94 | 1.16x |
| Current blended cost / 1M tokens | ~$0.80 | ~$0.98 | 1.23x |

Clean read: at matched snapshots, Claude is about 2.4x earlier and 2.5x current cost versus Codex. The difference is roughly from about 2x more tokens plus about 1.2x higher blended cost per token.

## Earlier Snapshot

| Metric | Codex gpt-5.5 | Claude Opus 4.8 Dev-Only | Claude / Codex |
|---|---:|---:|---:|
| Input tokens | 72,957,804 | 150,089,298 | 2.06x |
| Cached input tokens | 69,659,776 | 141,454,857 | 2.03x |
| Uncached input tokens | 3,298,028 | 8,634,441 | 2.62x |
| Output tokens | 271,464 | 693,536 | 2.55x |
| Total tokens | 73,229,268 | 150,782,834 | 2.06x |
| API-equivalent cost | ~$59.46 | ~$141.33 | 2.38x |
| Blended cost / 1M tokens | ~$0.81 | ~$0.94 | 1.16x |

At the earlier cutoff, Claude Thread B hardening dev had not started yet, so Claude dev-only is essentially Thread A build/transcription/docs work.

## Current Snapshot

| Metric | Codex gpt-5.5 | Claude Opus 4.8 Dev-Only | Claude / Codex |
|---|---:|---:|---:|
| Input tokens | 109,200,611 | 223,307,503 | 2.04x |
| Cached input tokens | 104,683,776 | 209,343,549 | 2.00x |
| Uncached input tokens | 4,516,835 | 13,963,954 | 3.09x |
| Output tokens | 428,527 | 1,203,110 | 2.81x |
| Total tokens | 109,629,138 | 224,510,613 | 2.05x |
| API-equivalent cost | ~$87.78 | ~$220.91 | 2.52x |
| Blended cost / 1M tokens | ~$0.80 | ~$0.98 | 1.23x |

## Snapshot Delta

| Metric | Codex Delta | Claude Dev-Only Delta |
|---|---:|---:|
| Total token increase | +36,399,870 | +73,727,779 |
| Cost increase | +$28.32 | +$79.58 |
| Main reason | Continued implementation in Codex | Spec/doc workflows plus hardening and multi-tenant dev |

## Claude Dev-Only Breakdown

| Claude Scope | Earlier Snapshot | Current Snapshot |
|---|---:|---:|
| Thread A: build + transcription + SPEC/PHASES/ARCH docs | 150,782,834 tokens / ~$141.33 | 188,182,701 tokens / ~$181.97 |
| Thread B: hardening + multi-tenant dev only | 0 tokens / $0.00 | 36,327,912 tokens / ~$38.94 |
| Claude dev-only total | 150,782,834 tokens / ~$141.33 | 224,510,613 tokens / ~$220.91 |

Excluded from Claude dev-only:

| Excluded Scope | Tokens | Cost |
|---|---:|---:|
| Public repositories engineering audit | ~33.3M | ~$44.76 |

## Codex Snapshot Detail

| Metric | Earlier Snapshot | Current Snapshot | Delta |
|---|---:|---:|---:|
| Input tokens | 72,957,804 | 109,200,611 | +36,242,807 |
| Cached input tokens | 69,659,776 | 104,683,776 | +35,024,000 |
| Uncached input tokens | 3,298,028 | 4,516,835 | +1,218,807 |
| Output tokens | 271,464 | 428,527 | +157,063 |
| Total tokens | 73,229,268 | 109,629,138 | +36,399,870 |
| Estimated Codex credits | 1,486.6 | 2,194.5 | +707.9 |
| API-equivalent cost | ~$59.46 | ~$87.78 | +$28.32 |

## Time And Work

| Metric | Earlier Codex Snapshot | Current Codex Snapshot |
|---|---:|---:|
| First session event | Jun 25, 2026, 12:20 CEST | Jun 25, 2026, 12:20 CEST |
| Last session event | Jun 25, 2026, 19:27 CEST | Jun 26, 2026, 10:34 CEST |
| Wall-clock span | ~7h 07m | ~22h 14m |
| Git commit span | ~6h 38m | ~13h 13m |
| Model runtime from logs | ~2h 39m | ~4h 11m |
| Commits created | 17 | 24 |

## Cost Formulas

Codex credits:

```text
((input - cached_input) * 125
 + cached_input * 12.5
 + output * 750) / 1,000,000
```

Codex API-equivalent cost shown here uses `credits * $0.04`, matching the prior project accounting.

Claude cost uses Opus 4.8 standard rates from the reconciliation: fresh input at `$5/M`, output at `$25/M`, with cache-write/cache-read pricing included in the source Claude calculation.

## Caveats

- Claude dev-only excludes the public repositories engineering audit.
- Claude Thread B audit/dev split is time-based, so treat the split as approximate near the boundary.
- The two systems did overlapping but not identical work. Claude included large spec/doc workflows and hardening/multi-tenant dev; Codex included the build and later production implementation phases in this repo.
- Current snapshots can drift if more work is done in either thread after this document.
