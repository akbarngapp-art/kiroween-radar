/**
 * src/publisher.js
 * Reads data/approved.json and writes public/report.json (and data/report.json)
 * atomically. Pending events never appear in the report.
 * Checks the kill switch before writing.
 */

import { resolve } from 'path';
import config from './config.js';
import { readJSON, writeJSON } from './store.js';
import { checkKill } from './kill.js';

const APPROVED_PATH  = resolve(config.repoRoot, 'data', 'approved.json');
const PUBLIC_REPORT  = resolve(config.repoRoot, 'public', 'report.json');
const DATA_REPORT    = resolve(config.repoRoot, 'data', 'report.json');

/**
 * Regenerate the published report from data/approved.json.
 * Writes both public/report.json and data/report.json atomically.
 */
export async function publish() {
  await checkKill();

  const approvedData = await readJSON(APPROVED_PATH);
  const events = approvedData?.events ?? [];

  const report = {
    generatedAt: new Date().toISOString(),
    events,
  };

  await Promise.all([
    writeJSON(PUBLIC_REPORT, report),
    writeJSON(DATA_REPORT, report),
  ]);

  console.log(`[publisher] Report written — ${events.length} approved event(s).`);
  return report;
}
