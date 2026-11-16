/**
 * src/store.js
 * Atomic JSON read/write for the data/ directory.
 * writeJSON writes to {path}.tmp then renames to path.
 */

import { readFile, writeFile, rename, mkdir } from 'fs/promises';
import { dirname } from 'path';

/**
 * Read and parse a JSON file.
 * Returns null if the file is absent; throws on parse error.
 * @param {string} filePath  Absolute path
 * @returns {Promise<any|null>}
 */
export async function readJSON(filePath) {
  try {
    const text = await readFile(filePath, 'utf8');
    return JSON.parse(text);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * Write data as JSON to filePath atomically (temp file + rename).
 * Creates parent directories if absent.
 * @param {string} filePath  Absolute path
 * @param {any} data
 */
export async function writeJSON(filePath, data) {
  const tmpPath = `${filePath}.tmp`;
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf8');
  await rename(tmpPath, filePath);
}
