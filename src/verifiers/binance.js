/**
 * src/verifiers/binance.js
 * Corroborates a price-move event against Binance Vision public API.
 *
 * Outcomes:
 *   verified   — Binance price within 0.5% of CoinGecko price
 *   disputed   — Binance price differs by more than 0.5%
 *   unavailable — Fetch failed or data unusable
 */

import { fetchWithGuard } from '../fetch.js';
import { KillSwitchError } from '../kill.js';
import config from '../config.js';

/**
 * @param {object} event     CandidateEvent
 * @param {object} sourceConfig  Source config entry (carries verification.url)
 * @returns {Promise<VerificationResult>}
 */
export async function verify(event, sourceConfig) {
  const verifyUrl = sourceConfig?.verification?.url;
  if (!verifyUrl) {
    return {
      source: 'binance-vision',
      outcome: 'unavailable',
      evidence: { reason: 'No verification URL configured for this source' },
    };
  }

  let raw;
  const fetchedAt = new Date().toISOString();

  try {
    const response = await fetchWithGuard(verifyUrl);
    raw = await response.json();
  } catch (err) {
    if (err instanceof KillSwitchError) throw err;
    return {
      source: 'binance-vision',
      outcome: 'unavailable',
      evidence: { reason: err.message, fetchedAt },
    };
  }

  // Binance ticker/price returns { symbol, price }
  const binancePriceStr = raw?.price;
  if (binancePriceStr == null) {
    return {
      source: 'binance-vision',
      outcome: 'unavailable',
      evidence: { reason: 'Missing price field in Binance response', raw, fetchedAt },
    };
  }

  const binancePrice = parseFloat(binancePriceStr);
  if (isNaN(binancePrice) || binancePrice === 0) {
    return {
      source: 'binance-vision',
      outcome: 'unavailable',
      evidence: { reason: 'Unusable price value from Binance', raw, fetchedAt },
    };
  }

  const coingeckoPrice = event.detectedValue;
  const deltaPct = Math.abs((binancePrice - coingeckoPrice) / coingeckoPrice);

  const evidence = {
    coingeckoPrice,
    binancePrice,
    deltaPct: Math.round(deltaPct * 10000) / 100,
    fetchedAt,
  };

  if (deltaPct <= config.priceDeltaTolerance) {
    return { source: 'binance-vision', outcome: 'verified', evidence };
  } else {
    return { source: 'binance-vision', outcome: 'disputed', evidence };
  }
}
