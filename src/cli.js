/**
 * src/cli.js
 * Approve / reject CLI for the Radar pending queue.
 *
 * Usage:
 *   node src/cli.js list
 *   node src/cli.js approve <event-id>
 *   node src/cli.js reject  <event-id>
 */

import { resolve } from 'path';
import config from './config.js';
import { readJSON, writeJSON } from './store.js';
import { publish } from './publisher.js';

const PENDING_PATH  = resolve(config.repoRoot, 'data', 'pending.json');
const APPROVED_PATH = resolve(config.repoRoot, 'data', 'approved.json');
const COOLDOWN_PATH = resolve(config.repoRoot, 'data', 'cooldown.json');

// ── Helpers ──────────────────────────────────────────────────────────────────

function die(msg, code = 1) {
  console.error(`[cli] ${msg}`);
  process.exit(code);
}

function usage() {
  console.log(`
Radar CLI

  node src/cli.js list
  node src/cli.js approve <event-id>
  node src/cli.js reject  <event-id>
`.trim());
  process.exit(1);
}

function formatOutcomeBadge(outcome) {
  switch (outcome) {
    case 'verified':   return '✓ verified';
    case 'disputed':   return '⚠ disputed';
    case 'unavailable': return '✗ unavailable';
    default:            return outcome ?? '?';
  }
}

function formatPct(pct) {
  if (pct == null) return 'n/a';
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct}%`;
}

// ── Subcommands ───────────────────────────────────────────────────────────────

async function cmdList() {
  const data = await readJSON(PENDING_PATH);
  const events = data?.events ?? [];

  if (events.length === 0) {
    console.log('No pending events.');
    return;
  }

  console.log(`\nPending events (${events.length}):\n`);
  console.log(
    'ID'.padEnd(52) +
    'Source'.padEnd(18) +
    'Asset'.padEnd(14) +
    'Value'.padEnd(14) +
    'Change'.padEnd(10) +
    'Verification'.padEnd(16) +
    'Detected At'
  );
  console.log('─'.repeat(140));

  for (const ev of events) {
    const outcome = ev.verification?.outcome;
    const value = ev.detectedValue != null ? ev.detectedValue.toLocaleString() : 'n/a';
    console.log(
      String(ev.id ?? '').padEnd(52) +
      String(ev.sourceId ?? '').padEnd(18) +
      String(ev.asset ?? '').padEnd(14) +
      String(value).padEnd(14) +
      String(formatPct(ev.changePct)).padEnd(10) +
      String(formatOutcomeBadge(outcome)).padEnd(16) +
      String(ev.detectedAt ?? '')
    );
    // Show evidence on next line if disputed or unavailable
    if (outcome !== 'verified' && ev.verification?.evidence) {
      const evi = ev.verification.evidence;
      const detail = evi.reason ?? `binance: ${evi.binancePrice}, Δ: ${evi.deltaPct}%`;
      console.log(' '.repeat(52) + `  evidence: ${detail}`);
    }
  }
  console.log('');
}

async function cmdApprove(id) {
  if (!id) die('approve requires an event ID. Usage: node src/cli.js approve <event-id>');

  const [pendingData, approvedData] = await Promise.all([
    readJSON(PENDING_PATH),
    readJSON(APPROVED_PATH),
  ]);

  const pending = pendingData?.events ?? [];
  const eventIndex = pending.findIndex(e => e.id === id);
  if (eventIndex === -1) die(`Event "${id}" not found in pending queue.`);

  const [event] = pending.splice(eventIndex, 1);

  const approved = approvedData?.events ?? [];
  approved.push({ ...event, approvedAt: new Date().toISOString() });

  // Record in cooldown
  const cooldownData = await readJSON(COOLDOWN_PATH);
  const cooldownEntries = cooldownData?.entries ?? {};
  cooldownEntries[id] = {
    resolution: 'approved',
    resolvedAt: new Date().toISOString(),
  };

  await Promise.all([
    writeJSON(PENDING_PATH, { updatedAt: new Date().toISOString(), events: pending }),
    writeJSON(APPROVED_PATH, { updatedAt: new Date().toISOString(), events: approved }),
    writeJSON(COOLDOWN_PATH, { entries: cooldownEntries }),
  ]);

  await publish();
  console.log(`[cli] Approved event: ${id}`);
}

async function cmdReject(id) {
  if (!id) die('reject requires an event ID. Usage: node src/cli.js reject <event-id>');

  const pendingData = await readJSON(PENDING_PATH);
  const pending = pendingData?.events ?? [];
  const eventIndex = pending.findIndex(e => e.id === id);
  if (eventIndex === -1) die(`Event "${id}" not found in pending queue.`);

  pending.splice(eventIndex, 1);

  const cooldownData = await readJSON(COOLDOWN_PATH);
  const cooldownEntries = cooldownData?.entries ?? {};
  cooldownEntries[id] = {
    resolution: 'rejected',
    resolvedAt: new Date().toISOString(),
  };

  await Promise.all([
    writeJSON(PENDING_PATH, { updatedAt: new Date().toISOString(), events: pending }),
    writeJSON(COOLDOWN_PATH, { entries: cooldownEntries }),
  ]);

  console.log(`[cli] Rejected event: ${id}`);
}

// ── Entry point ───────────────────────────────────────────────────────────────

const [, , subcommand, ...args] = process.argv;

switch (subcommand) {
  case 'list':
    await cmdList();
    break;
  case 'approve':
    await cmdApprove(args[0]);
    break;
  case 'reject':
    await cmdReject(args[0]);
    break;
  default:
    usage();
}
