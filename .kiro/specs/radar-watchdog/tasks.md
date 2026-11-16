# Radar Watchdog — Tasks

Tasks are ordered so that each step produces a runnable, testable increment. Complete them in sequence; later tasks depend on earlier ones.

---

## Phase 1: Runnable Skeleton

The goal of this phase is a working end-to-end pipeline for crypto prices: poll → detect → corroborate → queue → report → dashboard. No CLI, no releases adapter yet.

- [x] **1.1 Repo scaffold**
  - Create `package.json` with `"type": "module"`, `"name": "radar"`, `"engines": { "node": ">=24" }`, and npm scripts: `start` (`node src/poller.js`), `cli` (`node src/cli.js`).
  - Create directory structure: `config/`, `data/`, `public/`, `src/adapters/`, `src/verifiers/`.
  - Add `.gitignore` covering `data/KILL`, `.env`, `*.tmp`.
  - Add `.env.example` with placeholder entries for `GITHUB_TOKEN` and `RADAR_KILL`.

- [x] **1.2 Config loader (`src/config.js`)**
  - Read and parse `config/sources.json`.
  - Validate that each source entry has `id`, `type`, and `url` fields; throw on missing fields.
  - Merge environment variables (`FETCH_TIMEOUT_MS`, `FETCH_BACKOFF_MS`, `POLL_INTERVAL_MS`, `COOLDOWN_WINDOW_MS`, `STALENESS_THRESHOLD_MS`) with defaults.
  - Export a frozen config object; throw if the file is absent.
  - Add `config/sources.json` with two CoinGecko entries (BTC, ETH) and two GitHub release entries (placeholder repos).

- [x] **1.3 Kill-switch guard (`src/kill.js`)**
  - Export `checkKill()`: synchronously checks `process.env.RADAR_KILL === '1'`; asynchronously checks for `data/KILL` using `fs.access`.
  - Throw a `KillSwitchError` (custom error class, exported) when active.

- [x] **1.4 Fetch wrapper (`src/fetch.js`)**
  - Export `fetchWithGuard(url, options)`.
  - Call `checkKill()` before every fetch.
  - Attach an `AbortController` with the configured timeout.
  - On network error, wait the configured backoff and retry exactly once.
  - Do not retry on 4xx; throw a descriptive error.
  - Return the `Response` object on success.

- [x] **1.5 State store (`src/store.js`)**
  - Export `readJSON(path)`: returns parsed JSON or `null` if the file is absent.
  - Export `writeJSON(path, data)`: writes to `{path}.tmp` then renames to `path`.
  - Both functions handle `data/` path resolution relative to the repo root.

- [x] **1.6 CoinGecko adapter (`src/adapters/coingecko.js`)**
  - Export `fetchSnapshot(sourceConfig)`.
  - Build the CoinGecko `/simple/price` URL from `sourceConfig.assets` and `sourceConfig.vsCurrency` (default `usd`).
  - Return a `Snapshot` object with `sourceId`, `capturedAt`, and `entries`.

- [x] **1.7 Detector (`src/detector.js`)**
  - Export `detect(previousSnapshot, currentSnapshot, thresholds)`.
  - For price snapshots: emit a `CandidateEvent` when `|changePct| >= threshold` (default 3%).
  - Compute the deterministic event ID: `{sourceId}-{asset}-{utcHourBucket}` where `utcHourBucket` is `YYYYMMDDHH`.
  - Return `CandidateEvent[]`; return `[]` when no previous snapshot exists.

- [x] **1.8 Price verifier (`src/verifiers/binance.js`)**
  - Export `verify(event)`.
  - Fetch the Binance Vision public ticker endpoint for the asset.
  - Compute `|deltaP ct|` between CoinGecko and Binance prices.
  - Set `outcome` to `verified` when delta ≤ 0.5% and data is within the freshness window (default 5 min).
  - Set `outcome` to `disputed` when delta > 0.5%.
  - Set `outcome` to `unavailable` on fetch failure.
  - Return a `VerificationResult` (`{ source, outcome, evidence }`).

- [x] **1.9 Verifier router (`src/verifier.js`)**
  - Export `corroborate(event)`.
  - Dispatch to `binance.js` for `type: 'price-move'`; to `github-rest.js` for `type: 'new-release'` (stub returning `unavailable` until Phase 2).
  - Attach the result to `event.verification` and return the enriched event.

- [x] **1.10 Queue manager (`src/queue.js`)**
  - Export `enqueue(events)`.
  - Read `data/pending.json` and `data/cooldown.json`.
  - Discard events whose ID already appears in pending or in the cooldown window.
  - Reject (log and drop) events where `verification` is absent or `outcome` is not one of the three valid values.
  - Write updated `data/pending.json` atomically.

- [x] **1.11 Publisher (`src/publisher.js`)**
  - Export `publish()`.
  - Check the kill switch before writing.
  - Read `data/approved.json` (treat absent file as empty array).
  - Write `public/report.json` atomically with `generatedAt` and `events` array.

- [x] **1.12 Poller (`src/poller.js`)**
  - Set up a `setInterval` loop at the configured `POLL_INTERVAL_MS` (default 5 min).
  - Hold a `running` lock flag; skip and log if a cycle is already in progress.
  - Per cycle: load config → iterate CoinGecko sources → fetch snapshot → detect (load previous snapshot from store) → corroborate → enqueue.
  - Write the new snapshot atomically after successful detection.
  - Catch and log all errors per source without crashing the process.

- [x] **1.13 Static dashboard (`public/index.html`)**
  - Single HTML file; no external dependencies; vanilla JS only.
  - On load, `fetch('./report.json')`.
  - Render each event as a card: source, asset, detected value, change %, verification outcome badge, detectedAt timestamp.
  - Show a staleness banner when `generatedAt` is older than `STALENESS_THRESHOLD_MS` (hardcoded default 1 hour in the page).
  - Show a readable error message when `report.json` is absent or unparseable.

---

## Phase 2: GitHub Releases Adapter

- [x] **2.1 GitHub releases adapter (`src/adapters/github-releases.js`)**
  - Export `fetchSnapshot(sourceConfig)`.
  - Fetch the Atom feed URL from `sourceConfig.url`.
  - Parse XML using Node's `util` or a hand-rolled regex/string parser (no npm XML library).
  - Extract `<entry>` elements: `id`, `title`, `updated`, `link`.
  - Return a `Snapshot` with entries keyed by entry ID.

- [x] **2.2 Release verifier (`src/verifiers/github-rest.js`)**
  - Export `verify(event)`.
  - Extract `owner`, `repo`, `tag` from `event`.
  - Call `https://api.github.com/repos/{owner}/{repo}/releases/tags/{tag}` with an optional `Authorization: Bearer {GITHUB_TOKEN}` header when the env var is set.
  - Return `verified` on 200 + matching `tag_name`, `disputed` on 404 or mismatch, `unavailable` on network failure.

- [x] **2.3 Wire releases into poller**
  - Update `src/poller.js` to iterate `type: 'github-release'` sources.
  - Use `github-releases.js` adapter and `github-rest.js` verifier.
  - Detector: emit `new-release` event when a release entry ID is absent from the previous snapshot.

---

## Phase 3: Approve CLI

- [x] **3.1 CLI skeleton (`src/cli.js`)**
  - Parse `process.argv` for subcommand and arguments; print usage and exit 1 on unknown subcommand.

- [x] **3.2 `list` subcommand**
  - Read `data/pending.json`.
  - Print a table: ID, source, asset/repo, detected value, change, verification outcome, detectedAt.
  - Print "No pending events." when queue is empty.

- [x] **3.3 `approve <id>` subcommand**
  - Look up the event by ID in `data/pending.json`; exit 1 if not found.
  - Move the event to `data/approved.json` (append to array) atomically.
  - Remove the event from `data/pending.json` atomically.
  - Record approval in `data/cooldown.json`.
  - Call `publish()` to regenerate `public/report.json`.
  - Print confirmation with the event ID.

- [x] **3.4 `reject <id>` subcommand**
  - Look up the event by ID in `data/pending.json`; exit 1 if not found.
  - Remove the event from `data/pending.json` atomically.
  - Record rejection in `data/cooldown.json`.
  - Print confirmation with the event ID.

---

## Phase 4: Kill Switch and Hardening

- [x] **4.1 Kill-switch integration test**
  - Create `data/KILL`, run a poll cycle, verify no network calls are made and the cycle exits cleanly, then remove the file.
  - Repeat with `RADAR_KILL=1` env var.

- [x] **4.2 Per-cycle kill-switch logging**
  - Ensure the poller logs the kill-switch message exactly once per cycle, not once per fetch attempt.

- [ ] **4.3 Graceful shutdown**
  - Handle `SIGINT` and `SIGTERM`: set the lock flag, wait for any in-progress cycle to finish, then exit cleanly.

- [ ] **4.4 Snapshot retention on failure**
  - Add a test that simulates a fetch failure mid-cycle and asserts the previous snapshot file is unchanged.

---

## Phase 5: Polish

- [x] **5.1 `config/sources.json` examples**
  - Replace placeholder GitHub repos with real, actively-releasing public repos.
  - Document each field in a companion `config/sources.schema.json`.

- [x] **5.2 Dashboard improvements**
  - Add a manual refresh button.
  - Color-code verification outcome badges (green = verified, yellow = disputed, red = unavailable).
  - Display a "last polled" timestamp from the report.

- [ ] **5.3 README**
  - Quickstart: clone → set env vars → `node src/poller.js` → `node src/cli.js list`.
  - GitHub Pages deployment instructions.
  - Kill-switch usage.

- [ ] **5.4* Cooldown window configurability via CLI flag**
  - Allow `node src/cli.js approve <id> --cooldown 2h` to override the default cooldown for that event. *(stretch)*

- [ ] **5.5* Multi-asset threshold overrides**
  - Allow per-asset thresholds in `config/sources.json` overriding the global default. *(stretch)*

- [ ] **5.6* Dashboard auto-refresh**
  - Poll `report.json` every 60 s in the browser and re-render if `generatedAt` changed. *(stretch)*
