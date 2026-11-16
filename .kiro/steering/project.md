---
inclusion: always
---

# Radar — Project Steering

## Summary

Radar is an unattended opportunity-watchdog built for the Kiroween 2026 hackathon (Frankenstein category).

A dependency-light Node.js 24 poller — no build step, no npm dependencies, Node core modules plus global `fetch` only — polls allowlisted public sources on a configurable schedule, detects noteworthy changes against the previous snapshot, corroborates each change against a second independent source, queues candidates for human approval, and publishes an approved-only JSON report. A static dashboard in `public/` renders the report and is deployable to GitHub Pages with no server required.

## Safety Rules (always apply)

1. **Allowlist only.** Every polled URL and API endpoint must be declared in `config/sources.json`. The poller never fetches an arbitrary URL constructed from external input.
2. **Verification evidence is mandatory.** Every candidate event carried into the report must include a `verification` object with fields `source`, `outcome`, and `evidence`. Valid `outcome` values are `verified`, `disputed`, and `unavailable`. An `outcome` of `unavailable` never counts as verified — the event stays in `pending` or is rejected.
3. **Human approval gate.** Nothing is written to the published report without passing through the explicit CLI `approve` step. Automated polling may populate `data/pending.json`; it may not write to `data/report.json`.
4. **Kill switch.** Before every outbound network fetch the runtime checks for the existence of `data/KILL` or the environment variable `RADAR_KILL=1`. If either is present, the fetch is skipped and the cycle exits cleanly.
5. **No secrets in the repo.** API keys, tokens, and credentials live in environment variables or a `.env` file that is gitignored. The repo contains only the `.env.example` template.

## Code Conventions

- **Plain ESM Node.** All modules use `import`/`export` syntax; `"type": "module"` in `package.json`. No CommonJS.
- **Single-purpose modules.** Each file does one thing. Max ~150 lines per module; extract helpers when that limit is approached.
- **Atomic JSON writes.** Write to a `.tmp` file first, then `fs.rename` to the final path. Never write directly to the target while another process might be reading it.
- **Stable event IDs.** Each candidate event gets a deterministic ID derived from its source, asset, and timestamp bucket so that duplicate detections across poll cycles are automatically deduplicated.
- **Fetch discipline.** Every `fetch` call sets an `AbortController` timeout (default 10 s). On network failure, retry exactly once after an exponential backoff delay (default 2 s). Do not retry on 4xx responses.
- **No overlapping cycles.** The poller holds a lock flag; if a cycle is still running when the next tick fires, the tick is skipped and logged.
- **Immutable snapshots.** The previous snapshot is read but never mutated in place. Detection produces a new snapshot written atomically.
