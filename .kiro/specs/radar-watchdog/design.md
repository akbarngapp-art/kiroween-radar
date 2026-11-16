# Radar Watchdog — Design

## Architecture Overview

The system is a linear pipeline. Each stage is a pure function or thin module that reads its input, does one job, and passes a result forward. No stage reaches back into a previous stage.

```
Poll → Normalize → Detect → Corroborate → Pending Queue → Approve → Publish → Dashboard
```

The poller drives the first four stages on a timer. The last three stages are triggered by the CLI approve command. The dashboard is a static file that reads the published report at load time.

---

## Pipeline Stages

### Poll
Calls each allowlisted source adapter in sequence (or in parallel with a concurrency limit). Checks the kill switch before every fetch. Returns raw payloads keyed by source ID.

### Normalize
Each adapter converts its raw payload into the canonical `Snapshot` format. Normalization is adapter-specific and isolated inside the adapter module.

### Detect
Compares the new snapshot to the stored previous snapshot. Applies per-source thresholds. Emits `CandidateEvent` objects for each threshold-crossing change. Writes the new snapshot atomically.

### Corroborate
For each `CandidateEvent`, calls the appropriate verifier. Returns the event enriched with a `verification` object. Events with `outcome: unavailable` are logged but not added to the pending queue.

### Pending Queue
Deduplicates by event ID. Checks the cooldown log. Writes surviving events into `data/pending.json` atomically.

### Approve
CLI command. Reads `data/pending.json`, moves the selected event to `data/approved.json`, records the approval in the cooldown log, and calls the publisher.

### Publish
Reads `data/approved.json`, writes `public/report.json` atomically with a top-level `generatedAt` timestamp.

### Dashboard
Static `public/index.html`. Fetches `report.json` at load time via `fetch('./report.json')`. Renders events and a staleness indicator. No build step, no framework.

---

## Component List

| Module | Path | Responsibility |
|---|---|---|
| Config loader | `src/config.js` | Reads and validates `config/sources.json` and environment variables. Exports a frozen config object. |
| Kill-switch guard | `src/kill.js` | Exports `checkKill()` — reads `data/KILL` and `RADAR_KILL` env; throws `KillSwitchError` if active. |
| Fetch wrapper | `src/fetch.js` | Wraps global `fetch` with `AbortController` timeout, one retry with backoff, and kill-switch check. |
| State store | `src/store.js` | Atomic read/write of JSON files in `data/`. Exposes `readJSON`, `writeJSON` (temp-then-rename). |
| CoinGecko adapter | `src/adapters/coingecko.js` | Fetches prices; normalizes to `Snapshot`. |
| GitHub releases adapter | `src/adapters/github-releases.js` | Fetches Atom feed; parses XML with Node's built-in `DOMParser` (via `--experimental-vm-modules` shim or regex parse); normalizes to `Snapshot`. |
| Detector | `src/detector.js` | Stateless. Takes previous and current snapshots, applies thresholds, returns `CandidateEvent[]`. |
| Price verifier | `src/verifiers/binance.js` | Fetches Binance Vision public API; computes price delta; returns `VerificationResult`. |
| Release verifier | `src/verifiers/github-rest.js` | Calls GitHub REST API for the tag; returns `VerificationResult`. |
| Verifier router | `src/verifier.js` | Dispatches a `CandidateEvent` to the correct verifier by source type. |
| Queue manager | `src/queue.js` | Reads pending + cooldown; deduplicates; writes updated pending atomically. |
| Publisher | `src/publisher.js` | Reads approved; writes `public/report.json` atomically. |
| Poller | `src/poller.js` | `setInterval` loop with lock flag. Orchestrates poll → normalize → detect → corroborate → queue. |
| CLI | `src/cli.js` | Entry point for `list`, `approve <id>`, `reject <id>` subcommands. |
| Dashboard | `public/index.html` | Single-file static page. Vanilla JS, no dependencies. |

---

## Data Models

### Snapshot
Stored in `data/snapshots/{sourceId}.json`.

```jsonc
{
  "sourceId": "coingecko-btc",        // stable source identifier
  "capturedAt": "2026-10-31T12:00:00Z",
  "entries": {
    "bitcoin": { "usd": 68000.00 }    // shape varies by adapter; detector knows the schema
  }
}
```

### CandidateEvent
In-memory only; enriched by the verifier before being written to the queue.

```jsonc
{
  "id": "coingecko-btc-bitcoin-2026103112",  // source + asset + UTC hour bucket
  "sourceId": "coingecko-btc",
  "type": "price-move" | "new-release",
  "asset": "bitcoin",
  "detectedAt": "2026-10-31T12:34:56Z",
  "detectedValue": 68000.00,
  "previousValue": 65000.00,
  "changePct": 4.62,
  "verification": {                          // added by verifier
    "source": "binance-vision",
    "outcome": "verified" | "disputed" | "unavailable",
    "evidence": { "binancePrice": 67980.00, "deltaP ct": 0.03, "fetchedAt": "..." }
  }
}
```

### Pending Queue (`data/pending.json`)
```jsonc
{
  "updatedAt": "2026-10-31T12:34:56Z",
  "events": [ /* CandidateEvent[] */ ]
}
```

### Cooldown Log (`data/cooldown.json`)
```jsonc
{
  "entries": {
    "coingecko-btc-bitcoin-2026103112": {
      "resolution": "approved" | "rejected",
      "resolvedAt": "2026-10-31T13:00:00Z"
    }
  }
}
```

### Published Report (`public/report.json`)
```jsonc
{
  "generatedAt": "2026-10-31T13:05:00Z",
  "events": [ /* approved CandidateEvent[] with full verification objects */ ]
}
```

---

## Error Handling

| Failure | Behavior |
|---|---|
| Config missing or invalid | Process exits with code 1 and a descriptive message. |
| Kill switch active | `KillSwitchError` thrown before fetch; caught by poller; cycle exits cleanly; logged once. |
| Fetch timeout | `AbortController` fires; logged as warning; retry once after 2 s backoff. |
| Fetch retry failure | Error logged; source skipped for this cycle; previous snapshot retained. |
| 4xx HTTP response | Logged as error; no retry; source skipped. |
| Malformed JSON/XML response | Logged as parse error; source skipped; previous snapshot retained. |
| Atomic write failure | Error propagated; original file untouched (temp file left for inspection). |
| Duplicate event ID in queue | Silently discarded; deduplication is not an error. |
| Unknown event ID in CLI | Printed to stderr; process exits with code 1. |

---

## Correctness Properties

1. **No phantom publishes.** `public/report.json` is only ever written by the publisher, which is only ever called from the approve CLI path.
2. **Snapshot monotonicity.** The snapshot for a source is only updated when a fresh successful fetch and normalization succeed. A failed cycle leaves the previous snapshot in place.
3. **Idempotent event IDs.** The ID derivation function is pure: same source, asset, and UTC hour always produces the same ID. Re-running detection in the same hour produces the same ID and the queue deduplication discards the repeat.
4. **Atomic state transitions.** All JSON files that change as part of a logical step (snapshot update, queue update, cooldown update) are written via temp-then-rename. A crash mid-write leaves the previous version intact.
5. **No overlapping cycles.** The lock flag in the poller ensures that a slow cycle cannot produce concurrent snapshot writes or duplicate events.
6. **Verification completeness.** The queue manager enforces that every event reaching `data/pending.json` carries a `verification` object; events without one are rejected at the queue boundary, not silently passed through.
