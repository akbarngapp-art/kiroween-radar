/**
 * src/detector.js
 * Stateless change detector.
 * Branches on sourceConfig.type:
 *   'price'          — emits price-move events when |changePct| >= threshold
 *   'github-release' — emits new-release events for entries absent from prev snapshot
 */

import config from './config.js';

/**
 * Format a UTC date as YYYYMMDDHH for use in the event ID bucket.
 * @param {Date} date
 * @returns {string}
 */
function utcHourBucket(date) {
  const y = date.getUTCFullYear();
  const mo = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  const h = String(date.getUTCHours()).padStart(2, '0');
  return `${y}${mo}${d}${h}`;
}

/**
 * Build a deterministic event ID.
 * Pattern: {sourceId}-{asset}-{utcHourBucket}
 * @param {string} sourceId
 * @param {string} asset
 * @param {Date} detectedAt
 * @returns {string}
 */
export function makeEventId(sourceId, asset, detectedAt) {
  return `${sourceId}-${asset}-${utcHourBucket(detectedAt)}`;
}

/**
 * Detect threshold-crossing price changes between two snapshots.
 *
 * @param {object|null} prev  Previous snapshot (null on first run)
 * @param {object} curr       Current snapshot
 * @param {object} sourceConfig  Source config entry (carries threshold)
 * @returns {CandidateEvent[]}
 */
function detectPriceMoves(prev, curr, sourceConfig) {
  if (!prev) return [];

  const threshold = sourceConfig.threshold ?? config.priceDefaultThreshold;
  const detectedAt = new Date();
  const events = [];

  for (const [asset, currPrices] of Object.entries(curr.entries)) {
    const prevPrices = prev.entries?.[asset];
    if (!prevPrices) continue;

    const currency = sourceConfig.vsCurrency ?? 'usd';
    const prevPrice = prevPrices[currency];
    const currPrice = currPrices[currency];

    if (prevPrice == null || currPrice == null) continue;
    if (prevPrice === 0) continue;

    const changePct = (currPrice - prevPrice) / prevPrice;

    if (Math.abs(changePct) >= threshold) {
      events.push({
        id: makeEventId(curr.sourceId, asset, detectedAt),
        sourceId: curr.sourceId,
        type: 'price-move',
        asset,
        detectedAt: detectedAt.toISOString(),
        detectedValue: currPrice,
        previousValue: prevPrice,
        changePct: Math.round(changePct * 10000) / 100, // percent, 2 decimals
      });
    }
  }

  return events;
}

/**
 * Detect new GitHub release entries — entries present in curr but absent from prev.
 *
 * @param {object|null} prev  Previous snapshot (null on first run)
 * @param {object} curr       Current snapshot
 * @param {object} sourceConfig
 * @returns {CandidateEvent[]}
 */
function detectNewReleases(prev, curr, sourceConfig) {
  if (!prev) return [];  // First run: establish baseline, no events

  const sourceId   = curr.sourceId;
  const repo       = sourceConfig.repo;
  const detectedAt = new Date().toISOString();
  const events     = [];

  for (const [entryId, entry] of Object.entries(curr.entries)) {
    if (prev.entries?.[entryId]) continue; // already seen

    events.push({
      id:             `${sourceId}-${entry.tag}`,
      sourceId,
      type:           'new-release',
      asset:          repo,
      repo,
      tag:            entry.tag,
      title:          entry.title,
      link:           entry.link,
      detectedAt,
      detectedValue:  entry.tag,
    });
  }

  return events;
}

/**
 * Route detection by source type.
 *
 * @param {object|null} prev  Previous snapshot (null on first run)
 * @param {object} curr       Current snapshot
 * @param {object} sourceConfig  Source config entry
 * @returns {CandidateEvent[]}
 */
export function detect(prev, curr, sourceConfig) {
  if (sourceConfig.type === 'github-release') {
    return detectNewReleases(prev, curr, sourceConfig);
  }
  // Default: price sources
  return detectPriceMoves(prev, curr, sourceConfig);
}
