# Radar Watchdog — Requirements

## Introduction

Radar polls a fixed set of allowlisted public sources, detects changes that cross configurable thresholds, corroborates each detection against an independent second source, holds candidates in a pending queue for human review, and publishes an approved-only JSON report rendered by a static dashboard. The system must run unattended, stay dependency-free, and never publish unverified data.

---

## Requirements

### 1. Allowlisted Source Configuration

**User story:** As an operator, I want all polled sources declared in a single config file, so that I can audit and control every network destination the poller contacts.

**Acceptance criteria:**

- WHEN the poller starts, IF a source URL is not present in `config/sources.json`, THEN the system shall refuse to fetch it and log an error.
- WHEN `config/sources.json` is updated and the poller is restarted, THEN the system shall use the new allowlist without code changes.
- IF the config file is missing or malformed, THEN the system shall exit with a non-zero status and a descriptive error message.

---

### 2. Crypto Price Adapter (CoinGecko)

**User story:** As an operator, I want Radar to poll cryptocurrency prices from the CoinGecko free API, so that I can detect significant price moves without maintaining exchange credentials.

**Acceptance criteria:**

- WHEN a poll cycle runs, THEN the system shall fetch the current price for each configured asset from the CoinGecko `/simple/price` endpoint.
- WHEN the CoinGecko API returns a non-200 response, THEN the system shall retry once after a backoff delay and log the failure if the retry also fails.
- WHEN a fetch exceeds the configured timeout (default 10 s), THEN the system shall abort the request, log a timeout warning, and continue with the next source.
- WHEN a successful response is received, THEN the system shall normalize the payload into the canonical snapshot format before passing it to the detector.

---

### 3. GitHub Releases Adapter (Atom Feed)

**User story:** As an operator, I want Radar to poll GitHub repository release feeds, so that I can detect new software releases automatically.

**Acceptance criteria:**

- WHEN a poll cycle runs, THEN the system shall fetch the Atom feed at `https://github.com/{owner}/{repo}/releases.atom` for each configured repository.
- WHEN a new `<entry>` appears in the feed that was not present in the previous snapshot, THEN the system shall treat it as a candidate change event.
- WHEN the feed is unreachable or malformed XML, THEN the system shall log the error, leave the existing snapshot unchanged, and continue with other sources.
- WHEN a successful feed is parsed, THEN the system shall normalize entries into the canonical snapshot format before passing them to the detector.

---

### 4. Change Detection

**User story:** As an operator, I want change detection driven by configurable thresholds, so that I receive alerts only for meaningful signals and not noise.

**Acceptance criteria:**

- WHEN the detector compares a new price snapshot to the previous one, IF the absolute percentage change meets or exceeds the configured threshold (default 3%), THEN the system shall emit a candidate event.
- WHEN the detector compares GitHub release snapshots, IF a new release tag is present that was absent in the previous snapshot, THEN the system shall emit a candidate event.
- WHEN no threshold-crossing change is found, THEN the system shall update the snapshot silently with no candidate event.
- WHEN a candidate event is emitted, THEN the system shall assign it a deterministic ID derived from the source identifier, asset, and UTC hour bucket.

---

### 5. Price Corroboration (Binance Vision)

**User story:** As an operator, I want every crypto price event cross-checked against Binance public data, so that I can trust that a detected move is real and not a data artifact.

**Acceptance criteria:**

- WHEN a crypto price candidate event is queued for corroboration, THEN the system shall fetch the corresponding price from the Binance Vision public API.
- WHEN the Binance price is within 0.5% of the CoinGecko price AND the Binance data timestamp is within the configured freshness window (default 5 minutes), THEN the system shall set `verification.outcome` to `verified`.
- WHEN the Binance price differs by more than 0.5% from the CoinGecko price, THEN the system shall set `verification.outcome` to `disputed` and record both prices in `verification.evidence`.
- WHEN the Binance API is unreachable or returns no usable data, THEN the system shall set `verification.outcome` to `unavailable` and NOT promote the event to the pending queue as verified.

---

### 6. Release Corroboration (GitHub REST API)

**User story:** As an operator, I want every detected GitHub release confirmed via the GitHub REST API, so that feed parsing artifacts do not produce false positives.

**Acceptance criteria:**

- WHEN a GitHub release candidate event is queued for corroboration, THEN the system shall call the GitHub REST API (`/repos/{owner}/{repo}/releases/tags/{tag}`) to confirm the release exists.
- WHEN the REST API returns a 200 response with a matching `tag_name`, THEN the system shall set `verification.outcome` to `verified`.
- WHEN the REST API returns 404 or the `tag_name` does not match, THEN the system shall set `verification.outcome` to `disputed`.
- WHEN the REST API is unreachable, THEN the system shall set `verification.outcome` to `unavailable`.

---

### 7. Verification Outcomes

**User story:** As an operator, I want every event to carry an explicit verification outcome, so that I can make an informed approval decision.

**Acceptance criteria:**

- WHEN an event is written to the pending queue, THEN it shall include a `verification` object containing `source` (string), `outcome` (`verified` | `disputed` | `unavailable`), and `evidence` (object with raw data from the corroboration fetch).
- IF `verification.outcome` is `unavailable`, THEN the system shall not automatically promote the event and shall surface a warning in the queue entry.
- WHEN an operator reviews a pending event, THEN the full `verification.evidence` object shall be visible in the CLI output.

---

### 8. Pending Queue with Dedupe and Cooldown

**User story:** As an operator, I want a pending queue that suppresses duplicates and enforces a cooldown, so that I am not flooded with repeated alerts for the same event.

**Acceptance criteria:**

- WHEN a candidate event is generated, IF an event with the same deterministic ID already exists in `data/pending.json`, THEN the system shall discard the duplicate without writing.
- WHEN an event is approved or rejected, THEN the system shall record its ID and resolution timestamp in `data/cooldown.json`.
- WHEN a new candidate event would be generated for an ID that appears in `data/cooldown.json` within the configured cooldown window (default 1 hour), THEN the system shall suppress it.
- WHEN the pending queue is written, THEN the system shall use an atomic write (temp file then rename).

---

### 9. CLI Approve / Reject

**User story:** As an operator, I want a CLI command to approve or reject pending events, so that I control what gets published.

**Acceptance criteria:**

- WHEN the operator runs `node src/cli.js approve <event-id>`, THEN the system shall move the event from `data/pending.json` to `data/approved.json` and trigger report publication.
- WHEN the operator runs `node src/cli.js reject <event-id>`, THEN the system shall remove the event from `data/pending.json`, record the rejection in `data/cooldown.json`, and not publish it.
- WHEN the operator runs `node src/cli.js list`, THEN the system shall print all pending events with their IDs, sources, detected values, and verification outcomes.
- WHEN an unknown event ID is supplied to approve or reject, THEN the system shall print an error and exit with a non-zero status.

---

### 10. Approved-Only Report Publication

**User story:** As an operator, I want the published report to contain only explicitly approved events, so that unverified or unapproved data never reaches the dashboard.

**Acceptance criteria:**

- WHEN the publish step runs, THEN the system shall read `data/approved.json` and write `public/report.json` atomically.
- WHEN `public/report.json` is written, THEN it shall include a top-level `generatedAt` ISO timestamp and a `events` array containing only approved events with their full `verification` objects.
- WHEN no approved events exist, THEN the system shall write an empty `events` array rather than omitting the file.
- WHEN the publish step runs, IF `data/KILL` exists or `RADAR_KILL=1` is set, THEN the system shall skip the write and log a kill-switch message.

---

### 11. Kill Switch

**User story:** As an operator, I want a kill switch that immediately halts all network activity, so that I can stop the poller safely in an emergency without killing the process.

**Acceptance criteria:**

- WHEN `data/KILL` exists, THEN the system shall skip every outbound fetch in the current and all subsequent cycles until the file is removed.
- WHEN the environment variable `RADAR_KILL=1` is set, THEN the system shall behave identically to the file-based kill switch.
- WHEN the kill switch is active, THEN the system shall log a kill-switch message once per cycle (not once per fetch).
- WHEN the kill switch is cleared (file removed or env var unset), THEN the system shall resume normal polling on the next cycle without restart.

---

### 12. Static Dashboard

**User story:** As a stakeholder, I want a static dashboard served from `public/` that renders the approved report, so that I can review opportunities without running a server.

**Acceptance criteria:**

- WHEN `public/index.html` is opened in a browser, THEN the page shall fetch `report.json` from the same directory and render all approved events in a readable list.
- WHEN `report.json` was generated more than the configured staleness threshold (default 1 hour) ago, THEN the dashboard shall display a visible staleness indicator.
- WHEN `report.json` is absent or unparseable, THEN the dashboard shall display an error message rather than a blank page.
- WHEN the dashboard is deployed to GitHub Pages, THEN it shall function correctly with no server-side code.

---

### 13. Reliability — Timeouts, Retry, No Overlapping Cycles

**User story:** As an operator, I want the poller to be self-contained and resilient, so that transient network failures do not corrupt state or cause cascading retries.

**Acceptance criteria:**

- WHEN a fetch call is issued, THEN the system shall attach an `AbortController` signal with a timeout of at most 10 seconds (configurable).
- WHEN a fetch fails with a network error, THEN the system shall wait the configured backoff delay (default 2 s) and retry exactly once.
- WHEN the retry also fails, THEN the system shall log the error and move on; it shall not retry a third time.
- WHEN a poll cycle is still running at the next scheduled tick, THEN the system shall skip the new tick, log a warning, and not start a second concurrent cycle.
