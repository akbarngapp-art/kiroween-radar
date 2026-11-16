/**
 * src/queue.js
 * Pending queue manager.
 * Deduplicates by event ID, enforces cooldown, validates verification presence,
 * and writes data/pending.json atomically.
 */

import { resolve } from 'path';
import config from './config.js';
import { readJSON, writeJSON } from './store.js';

const PENDING_PATH = resolve(config.repoRoot, 'data', 'pending.json');
const COOLDOWN_PATH = resolve(config.repoRoot, 'data', 'cooldown.json');

const VALID_OUTCOMES = new Set(['verified', 'disputed', 'unavailable']);

/**
 * Append candidate events to the pending queue, subject to deduplication
 * and cooldown checks. Events with missing or invalid verification are dropped.
 *
 * @param {object[]} events  Enriched CandidateEvents (with .verification)
 * @returns {Promise<{ added: number, skipped: number }>}
 */
export async function enqueue(events) {
  const [pendingData, cooldownData] = await Promise.all([
    readJSON(PENDING_PATH),
    readJSON(COOLDOWN_PATH),
  ]);

  const existing = pendingData?.events ?? [];
  const cooldownEntries = cooldownData?.entries ?? {};

  const existingIds = new Set(existing.map(e => e.id));

  let added = 0;
  let skipped = 0;
  const now = Date.now();

  for (const event of events) {
    // Validation: verification object must be present and outcome must be valid
    if (!event.verification || !VALID_OUTCOMES.has(event.verification.outcome)) {
      console.warn(`[queue] Dropping event ${event.id}: missing or invalid verification outcome`);
      skipped++;
      continue;
    }

    // Events with unavailable outcome are not queued (safety rule)
    if (event.verification.outcome === 'unavailable') {
      console.warn(`[queue] Dropping event ${event.id}: verification outcome is unavailable`);
      skipped++;
      continue;
    }

    // Deduplicate against pending
    if (existingIds.has(event.id)) {
      console.log(`[queue] Skipping duplicate event ${event.id} (already pending)`);
      skipped++;
      continue;
    }

    // Cooldown check
    const cooldownEntry = cooldownEntries[event.id];
    if (cooldownEntry) {
      const resolvedAt = new Date(cooldownEntry.resolvedAt).getTime();
      if (now - resolvedAt < config.cooldownWindowMs) {
        console.log(`[queue] Skipping event ${event.id} — in cooldown until ${new Date(resolvedAt + config.cooldownWindowMs).toISOString()}`);
        skipped++;
        continue;
      }
    }

    existing.push(event);
    existingIds.add(event.id);
    added++;
  }

  await writeJSON(PENDING_PATH, {
    updatedAt: new Date().toISOString(),
    events: existing,
  });

  return { added, skipped };
}
