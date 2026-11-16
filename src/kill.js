/**
 * src/kill.js
 * Kill-switch guard. Checks both the RADAR_KILL env var and the data/KILL file.
 * Exports checkKill() and KillSwitchError.
 */

import { access } from 'fs/promises';
import { resolve } from 'path';
import config from './config.js';

export class KillSwitchError extends Error {
  constructor(reason) {
    super(`Kill switch active: ${reason}`);
    this.name = 'KillSwitchError';
  }
}

const KILL_FILE = resolve(config.repoRoot, 'data', 'KILL');

/**
 * Check whether the kill switch is active.
 * Throws KillSwitchError if it is.
 * This must be called before every outbound fetch.
 */
export async function checkKill() {
  if (process.env.RADAR_KILL === '1') {
    throw new KillSwitchError('RADAR_KILL=1 environment variable is set');
  }

  try {
    await access(KILL_FILE);
    // File exists
    throw new KillSwitchError('data/KILL file is present');
  } catch (err) {
    if (err instanceof KillSwitchError) throw err;
    // ENOENT means file is absent — that's the normal case, no kill
  }
}
