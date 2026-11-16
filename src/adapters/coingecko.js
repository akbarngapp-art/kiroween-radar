/**
 * src/adapters/coingecko.js
 * CoinGecko /simple/price adapter.
 * Returns a Snapshot normalised from the raw API response.
 */

import { fetchWithGuard } from '../fetch.js';

/**
 * @param {object} sourceConfig  Entry from config/sources.json
 * @returns {Promise<Snapshot>}
 */
export async function fetchSnapshot(sourceConfig) {
  const { id, url, assets, vsCurrency = 'usd' } = sourceConfig;

  const params = new URLSearchParams({
    ids: assets.join(','),
    vs_currencies: vsCurrency,
  });

  const fullUrl = `${url}?${params}`;
  const response = await fetchWithGuard(fullUrl);

  let raw;
  try {
    raw = await response.json();
  } catch (err) {
    throw new Error(`[coingecko] Failed to parse JSON from ${fullUrl}: ${err.message}`);
  }

  // Normalize: { bitcoin: { usd: 68000 }, ethereum: { usd: 3200 } }
  const entries = {};
  for (const asset of assets) {
    if (!raw[asset]) {
      throw new Error(`[coingecko] Response missing asset "${asset}" for source ${id}`);
    }
    entries[asset] = raw[asset];
  }

  return {
    sourceId: id,
    capturedAt: new Date().toISOString(),
    entries,
  };
}
