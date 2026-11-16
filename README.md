# Radar — an opportunity watchdog, stitched together

**Radar** is an unattended watchdog that polls allowlisted public sources,
detects meaningful changes, **verifies each change against a second source**,
and queues a structured report for a human to approve. Nothing is acted on
without an explicit approval step, and a kill switch can halt the whole
system instantly.

Built for **Kiroween 2026** (Frankenstein category) — existing APIs and feeds
stitched into one new, safety-first app, spec-driven with **Kiro**: the
`/.kiro` directory in this repo holds the steering files, specs and hooks the
app was built from.

## How it works

1. **Poll** — a dependency-light Node.js poller fetches allowlisted sources
   (CoinGecko free API for prices, GitHub release feeds, RSS).
2. **Detect** — each snapshot is compared with the previous one; only changes
   past a configured threshold (e.g. a price move ≥ 2%) become candidates.
3. **Verify** — every candidate is cross-checked against a second,
   independent source. Unverified candidates are flagged, never trusted.
4. **Queue** — verified changes land in a structured JSON report.
5. **Approve** — a human reviews the queue; nothing downstream happens
   without an explicit approval. A `KILL` file (or `RADAR_KILL=1`) stops the
   poller immediately.

## Layout

- `src/` — the Node.js poller (Node 24, no build step, no dependencies)
- `public/` — the static dashboard (deploys to GitHub Pages, renders the
  latest report JSON)
- `data/` — runtime snapshots and the latest report
- `.kiro/` — Kiro steering, specs and hooks used to build this project

## Quick start

```sh
node src/poller.js --once    # one poll → detect → verify → report cycle
```

Then open `public/index.html` (or serve `public/` statically) to see the
latest report.

## Safety rules (enforced, not aspirational)

- Sources are **allowlisted** in config; the poller refuses anything else.
- Every reported change carries its verification evidence.
- The approval gate and kill switch are checked on every cycle.

## License

MIT — see [LICENSE](LICENSE).
