# Codex vs Claude vs GLM Build Usage Comparison

This document records the MindMonk build usage comparison between Codex `gpt-5.5`, Claude Code Opus 4.8, and the single available GLM-5.2/ZCode snapshot.

The Claude numbers are dev-only and exclude the separate public-repositories engineering audit. The Codex numbers are from the local Codex session logs for this project. GLM-5.2 currently has one provided project snapshot only, so it is shown separately and not as a two-snapshot trend.

## Summary

| View | Codex gpt-5.5 | Claude Opus 4.8 Dev-Only | Claude / Codex |
|---|---:|---:|---:|
| Earlier snapshot cost | ~$59.46 | ~$141.33 | 2.38x |
| Current snapshot cost | ~$87.78 | ~$220.91 | 2.52x |
| Earlier snapshot tokens | 73.2M | 150.8M | 2.06x |
| Current snapshot tokens | 109.6M | 224.5M | 2.05x |
| Earlier main-thread runtime | ~2h 39m | ~2h 40m | ~1.0x |
| Current main-thread runtime | ~4h 11m | ~4h 22m | ~1.04x |
| Earlier blended cost / 1M tokens | ~$0.81 | ~$0.94 | 1.16x |
| Current blended cost / 1M tokens | ~$0.80 | ~$0.98 | 1.23x |

Clean read: at matched snapshots, Claude is about 2.4x earlier and 2.5x current cost versus Codex. The difference is roughly from about 2x more tokens plus about 1.2x higher blended cost per token.

## GLM-5.2 Single Available Snapshot

GLM-5.2/ZCode has one provided project snapshot, from a single-thread Python implementation. It had no subagents or parallel fan-out. The table below uses the GLM snapshot supplied for this project and compares it with the current Codex and Claude baselines already used in this document.

### Tokens

| Metric | GLM-5.2 ZCode | Codex gpt-5.5 Current | Claude Opus 4.8 Dev Current |
|---|---:|---:|---:|
| Input tokens | 89,834,849 | 109,200,611 | 223,307,503 |
| Cached input tokens | 75,850,368 | 104,683,776 | 209,343,549 |
| Cached input share | 84.4% | 95.9% | 93.7% |
| Uncached input tokens | 13,984,481 | 4,516,835 | 13,963,954 |
| Uncached input share | 15.6% | 4.1% | 6.3% |
| Output tokens | 219,690 | 428,527 | 1,203,110 |
| Total tokens | 90,054,539 | 109,629,138 | 224,510,613 |
| Model/API calls | 611 | n/a | n/a |
| Total tokens vs GLM | 1.00x | 1.22x | 2.49x |

Readout: GLM-5.2 is the most token-frugal of the three in this supplied snapshot: about 18% fewer total tokens than current Codex and about 60% fewer than current Claude.

### Cost

| Metric | GLM-5.2 ZCode | Codex gpt-5.5 Current | Claude Opus 4.8 Dev Current |
|---|---:|---:|---:|
| API-equivalent cost | ~$37.49 / ¥269.73 | ~$87.78 | ~$220.91 |
| Blended cost / 1M tokens | ~$0.416 | ~$0.80 | ~$0.98 |
| Cost vs GLM | 1.00x | 2.34x | 5.89x |

Readout: GLM-5.2 is the lowest-cost snapshot: less than half the Codex current cost and about one-sixth of the Claude current cost. The supplied GLM rate card was ¥8/¥2/¥28 per 1M input/cached/output tokens, roughly `$1.11/$0.28/$3.89`.

### Runtime

| Metric | GLM-5.2 ZCode | Codex gpt-5.5 Current | Claude Opus 4.8 Dev Current |
|---|---:|---:|---:|
| Wall-clock span | ~22.74h | ~22h 14m | n/a |
| Summed model runtime | ~3h 00m | ~4h 11m | ~4h 22m |
| Turn runtime | ~280m | n/a | n/a |
| Tool calls | 550 / ~72m runtime | 1,033 | n/a |
| Subagents | 0 / serial | 0 | 69 runs / ~2h 44m summed |
| Commits | 18 | 24 | n/a |

Readout: GLM-5.2 was serial and had no subagent fan-out, but still had the lowest supplied summed model runtime among the three current baselines.

### Codebase Size

| Metric | GLM-5.2 Python | Codex TypeScript Current | Claude TypeScript Current |
|---|---:|---:|---:|
| Source files | 14 | 50 | 39 |
| Source LOC | 2,434 | 6,476 | 2,486 |
| Test files | 0 | 0 | 7 |
| Test LOC | 0 | 0 | 304 |
| Docs (`.md`) files | 1 | 6 | 8 |
| Docs LOC | 174 | 2,283 | 2,924 |
| Landing files | 3 / 673 LOC | n/a | n/a |
| DB tables | 1 | 12 | 12 |
| Runtime dependencies | 10 | 10 | 8 |
| Total files | 27 | 61 | 63 |
| Commits | 18 | 24 | n/a |

Readout: GLM-5.2 produced the smallest repo footprint by file count. It also has a much smaller DB schema in the supplied snapshot: 1 table versus 12 in the current Codex and Claude baselines.

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

## Runtime Comparison

The main-thread runtime is the most honest like-for-like comparison: one agent turn stream from trigger to reply, excluding Claude's parallel subagent fan-out. Claude's main-thread value is end-to-end including network/streaming overhead; Codex's value is parsed from model/runtime logs and is closer to pure model response runtime.

| Runtime Metric | Earlier Snapshot | Current Snapshot |
|---|---:|---:|
| Codex model runtime | ~2h 39m | ~4h 11m |
| Claude main-thread runtime | ~2h 40m | ~4h 22m |
| Difference, Claude minus Codex | ~+1m | ~+11m |
| Claude subagent runs, summed | ~1h 05m / 43 runs | ~2h 44m / 69 runs |
| Claude total agent runtime, main + subagents | ~3h 45m | ~7h 06m |

Readout: main-thread runtime is very close between the two systems. Claude's extra runtime is mostly parallel subagent work from spec/doc/hardening workflows. The subagent row is summed agent-seconds; because those agents can run concurrently, it is not the same as wall-clock waiting time.

## Codebase Size Comparison

Codex codebase size was computed from tracked Git files in this repository. Claude codebase size uses the provided `mindmonk-digest-claude4.8opus` metrics. Raw LOC includes comments and blank lines. SLOC/non-blank LOC counts only lines with non-whitespace text.

### Snapshot 1 Size Side-By-Side - All Three

This is the clean Snapshot 1 codebase-size comparison across Codex, Claude, and GLM-5.2. GLM used Python while Codex and Claude used TypeScript, so raw source LOC is useful as a footprint signal but not a perfect productivity metric across languages. Non-blank SLOC is the stronger headline metric where it is available.

| Metric | Codex S1 | Claude S1 | GLM-5.2 S1 | Readout |
|---|---:|---:|---:|---|
| Source language | TypeScript | TypeScript | Python | GLM is cross-language versus the TypeScript repos |
| Source files | 46 | 29 | 14 | GLM has the smallest source file count |
| Source LOC, raw | 5,284 | 1,609 | 2,434 | Codex is largest; GLM sits between Codex and Claude |
| Source SLOC, non-blank | 4,485 | 1,443 | n/a | GLM non-blank source SLOC was not provided |
| Test files | 0 | 0 | 0 | No tests in Snapshot 1 for any build |
| Test LOC | 0 | 0 | 0 | No test LOC in Snapshot 1 |
| DB tables | 6 | 6 | 1 | GLM had the simplest schema |
| Docs (`.md`) files | 1 | 1 | 1 | Same doc file count |
| Docs LOC, raw | 170 | 96 | 174 | Similar docs footprint in Snapshot 1 |
| Docs LOC, non-blank | 127 | 73 | n/a | GLM non-blank docs LOC was not provided |
| Landing files | n/a | n/a | 3 / 673 LOC | GLM separately counted landing-page files |
| Runtime dependencies | 10 | 8 | 10 | Codex and GLM had the same runtime dependency count |
| Total files in repo | 52 | 38 | 27 | GLM had the smallest total repo footprint |
| Commits | 17 | n/a | 18 | Codex and GLM had similar commit counts; Claude S1 commit count was not provided |

### Codex Codebase Size - `mindmonk-digest-gpt5.5`

| Metric | Earlier (`e88d8a8`) | Current (`c07a4ea`) | Delta |
|---|---:|---:|---:|
| TypeScript source files | 46 | 50 | +4 |
| TypeScript source LOC | 5,284 | 6,476 | +1,192 |
| TypeScript source SLOC (non-blank) | 4,485 | 5,531 | +1,046 |
| Test files | 0 | 0 | 0 |
| Test LOC | 0 | 0 | 0 |
| DB tables | 6 | 12 | +6 |
| Docs (`.md`) files | 1 | 6 | +5 |
| Docs LOC | 170 | 2,283 | +2,113 |
| Docs LOC (non-blank) | 127 | 1,715 | +1,588 |
| Runtime dependencies | 10 | 10 | 0 |
| Total files in repo | 52 | 61 | +9 |

### Claude Codebase Size - `mindmonk-digest-claude4.8opus`

| Metric | Earlier (`8c91e8b`) | Current Working Tree | Delta |
|---|---:|---:|---:|
| TypeScript source files | 29 | 39 | +10 |
| TypeScript source LOC | 1,609 | 2,486 | +877 |
| TypeScript source SLOC (non-blank) | 1,443 | 2,247 | +804 |
| Test files | 0 | 7 | +7 |
| Test LOC | 0 | 304 | +304 |
| DB tables | 6 | 12 | +6 |
| Docs (`.md`) files | 1 | 8 | +7 |
| Docs LOC | 96 | 2,924 | +2,828 |
| Docs LOC (non-blank) | 73 | ~2,298 | ~+2,225 |
| Runtime dependencies | 8 | 8 | 0 |
| Total files in repo | 38 | 63 | +25 |

### Current Snapshot Size Side-By-Side

| Metric | Codex Current | Claude Current | Readout |
|---|---:|---:|---|
| TypeScript source files | 50 | 39 | Codex has more app source files |
| TypeScript source LOC | 6,476 | 2,486 | Codex has more source LOC in this repo snapshot |
| TypeScript source SLOC (non-blank) | 5,531 | 2,247 | Codex has about 2.5x Claude's non-blank source SLOC |
| Test files | 0 | 7 | Claude added tests; Codex has not yet added tests |
| Test LOC | 0 | 304 | Claude has test coverage started |
| DB tables | 12 | 12 | Same table count at current snapshot |
| Docs (`.md`) files | 6 | 8 | Claude has two more docs files |
| Docs LOC | 2,283 | 2,924 | Claude has more planning/docs LOC |
| Docs LOC (non-blank) | 1,715 | ~2,298 | Claude has more non-blank docs LOC |
| Runtime dependencies | 10 | 8 | Codex has two more runtime dependencies |
| Total files in repo | 61 | 63 | Similar total file count |

Readout: Claude's largest codebase delta came from docs, tests, and multi-tenant/hardening files. Codex's current repo is larger in TypeScript LOC and non-blank source SLOC, while Claude has more test files and docs LOC at the compared current snapshot.

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
- GLM-5.2 currently has one supplied project snapshot only, so it is not included in the two-snapshot Codex/Claude trend tables.
- Claude Thread B audit/dev split is time-based, so treat the split as approximate near the boundary.
- The two systems did overlapping but not identical work. Claude included large spec/doc workflows and hardening/multi-tenant dev; Codex included the build and later production implementation phases in this repo.
- Current snapshots can drift if more work is done in either thread after this document.
