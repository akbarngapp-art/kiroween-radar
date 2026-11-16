/**
 * src/poller.js
 * Main poller. Runs either once (--once flag) or on a setInterval loop.
 * Holds a lock to prevent overlapping cycles.
 *
 * Usage:
 *   node src/poller.js           # interval mode
 *   node src/poller.js --once    # single cycle then exit
 */

import { resolve } from 'path';
import config from './config.js';
import { readJSON, writeJSON } from './store.js';
import { fetchSnapshot as coingeckoFetch }       from './adapters/coingecko.js';
import { fetchSnapshot as githubReleasesFetch }  from './adapters/github-releases.js';
import { detect } from './detector.js';
import { corroborate } from './verifier.js';
import { enqueue } from './queue.js';
import { KillSwitchError } from './kill.js';

const SNAPSHOTS_DIR = resolve(config.repoRoot, 'data', 'snapshots');

function snapshotPath(sourceId) {
  return resolve(SNAPSHOTS_DIR, `${sourceId}.json`);
}

function getAdapter(source) {
  switch (source.adapter) {
    case 'coingecko':        return coingeckoFetch;
    case 'github-releases':  return githubReleasesFetch;
    default:
      throw new Error(`Unknown adapter: ${source.adapter}`);
  }
}

let running = false;

async function runCycle() {
  if (running) {
    console.warn('[poller] Cycle already in progress — skipping tick');
    return;
  }
  running = true;
  const cycleStart = new Date().toISOString();
  console.log(`\n[poller] ── Cycle start ${cycleStart} ──`);

  let killTriggered = false;

  for (const source of config.sources) {
    console.log(`[poller] Polling source: ${source.id}`);
    try {
      const adapter = getAdapter(source);
      const currentSnapshot = await adapter(source);

      const prevSnapshot = await readJSON(snapshotPath(source.id));

      if (!prevSnapshot) {
        console.log(`[poller] ${source.id}: first run — storing baseline snapshot, no events.`);
        await writeJSON(snapshotPath(source.id), currentSnapshot);
        printSnapshotSummary(source.id, currentSnapshot, null, source);
        continue;
      }

      const candidates = detect(prevSnapshot, currentSnapshot, source);

      // Write updated snapshot atomically
      await writeJSON(snapshotPath(source.id), currentSnapshot);

      if (candidates.length === 0) {
        console.log(`[poller] ${source.id}: no changes detected.`);
        printSnapshotSummary(source.id, currentSnapshot, prevSnapshot, source);
        continue;
      }

      console.log(`[poller] ${source.id}: ${candidates.length} candidate event(s) detected.`);

      // Corroborate each candidate
      const enriched = [];
      for (const event of candidates) {
        const withVerification = await corroborate(event, source);
        enriched.push(withVerification);
        const displayValue = event.type === 'new-release'
          ? `tag=${event.tag}`
          : `${event.changePct >= 0 ? '+' : ''}${event.changePct}%`;
        console.log(`[poller]   ${event.id}: ${displayValue} → verification: ${withVerification.verification.outcome}`);
      }

      const { added, skipped } = await enqueue(enriched);
      console.log(`[poller] ${source.id}: queued ${added} event(s), skipped ${skipped}.`);

    } catch (err) {
      if (err instanceof KillSwitchError) {
        if (!killTriggered) {
          console.warn(`[poller] ${err.message} — stopping cycle.`);
          killTriggered = true;
        }
        break;
      }
      console.error(`[poller] Error processing source ${source.id}: ${err.message}`);
    }
  }

  console.log(`[poller] ── Cycle end ──`);
  running = false;
}

/**
 * Log a human-readable summary line per entry in the snapshot.
 * Price sources show asset + price (and change % when prev is available).
 * Release sources show repo + latest tag.
 */
function printSnapshotSummary(sourceId, curr, prev, source) {
  if (source?.type === 'github-release') {
    // Find the most-recently-updated entry as the "latest" tag
    let latestEntry = null;
    for (const entry of Object.values(curr.entries)) {
      if (!latestEntry) { latestEntry = entry; continue; }
      if (entry.updated && latestEntry.updated && entry.updated > latestEntry.updated) {
        latestEntry = entry;
      }
    }
    const tag = latestEntry?.tag ?? '(none)';
    console.log(`[poller]   ${source.repo}: latest tag ${tag}`);
    return;
  }

  // Price source
  for (const [asset, prices] of Object.entries(curr.entries)) {
    const currency = source?.vsCurrency ?? 'usd';
    const currPrice = prices[currency];
    if (currPrice == null) continue;

    if (prev) {
      const prevPrice = prev.entries?.[asset]?.[currency];
      if (prevPrice != null && prevPrice !== 0) {
        const pct = ((currPrice - prevPrice) / prevPrice * 100).toFixed(2);
        const sign = pct >= 0 ? '+' : '';
        console.log(`[poller]   ${asset}: ${currency.toUpperCase()} ${currPrice.toLocaleString()} (${sign}${pct}%)`);
        continue;
      }
    }
    console.log(`[poller]   ${asset}: ${currency.toUpperCase()} ${currPrice.toLocaleString()}`);
  }
}

const onceMode = process.argv.includes('--once');

if (onceMode) {
  runCycle().catch(err => {
    console.error('[poller] Fatal error:', err.message);
    process.exit(1);
  });
} else {
  console.log(`[poller] Starting in interval mode (every ${config.pollIntervalMs / 1000}s).`);
  // Run immediately, then on interval
  runCycle();
  const interval = setInterval(runCycle, config.pollIntervalMs);

  function shutdown(signal) {
    console.log(`\n[poller] Received ${signal} — shutting down gracefully.`);
    clearInterval(interval);
    // Wait for any in-progress cycle to finish naturally before exiting
    const wait = setInterval(() => {
      if (!running) {
        clearInterval(wait);
        process.exit(0);
      }
    }, 100);
  }

  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}
