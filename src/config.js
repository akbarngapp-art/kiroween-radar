/**
 * src/config.js
 * Reads config/sources.json, validates it, merges environment variable overrides,
 * and exports a frozen config object.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

function loadSources() {
  const sourcesPath = resolve(REPO_ROOT, 'config', 'sources.json');
  let raw;
  try {
    raw = readFileSync(sourcesPath, 'utf8');
  } catch (err) {
    console.error(`[config] Cannot read config/sources.json: ${err.message}`);
    process.exit(1);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error(`[config] config/sources.json is not valid JSON: ${err.message}`);
    process.exit(1);
  }

  if (!Array.isArray(parsed.sources)) {
    console.error('[config] config/sources.json must have a top-level "sources" array.');
    process.exit(1);
  }

  for (const source of parsed.sources) {
    for (const field of ['id', 'type', 'url']) {
      if (!source[field]) {
        console.error(`[config] Source entry is missing required field "${field}": ${JSON.stringify(source)}`);
        process.exit(1);
      }
    }
  }

  return parsed.sources;
}

function env(name, defaultValue) {
  const val = process.env[name];
  if (val === undefined || val === '') return defaultValue;
  const n = Number(val);
  if (isNaN(n)) {
    console.error(`[config] Environment variable ${name} must be a number; got "${val}"`);
    process.exit(1);
  }
  return n;
}

const sources = loadSources();

const config = Object.freeze({
  repoRoot: REPO_ROOT,
  sources,
  fetchTimeoutMs:       env('FETCH_TIMEOUT_MS',       10_000),
  fetchBackoffMs:       env('FETCH_BACKOFF_MS',         2_000),
  pollIntervalMs:       env('POLL_INTERVAL_MS',       300_000),
  cooldownWindowMs:     env('COOLDOWN_WINDOW_MS',    3_600_000),
  stalenessThresholdMs: env('STALENESS_THRESHOLD_MS', 3_600_000),
  priceDeltaTolerance:  0.005,   // 0.5% — Binance vs CoinGecko agreement threshold
  priceDefaultThreshold: 0.02,   // 2% — default threshold when source doesn't specify
  freshnesWindowMs:     5 * 60 * 1000, // 5 min — Binance data freshness
});

export default config;
