/**
 * src/fetch.js
 * Fetch wrapper with kill-switch check, AbortController timeout,
 * and exactly one retry after backoff on network error.
 */

import config from './config.js';
import { checkKill } from './kill.js';

/**
 * @param {string} url
 * @param {RequestInit} [options]
 * @returns {Promise<Response>}
 */
export async function fetchWithGuard(url, options = {}) {
  await checkKill();
  return attemptFetch(url, options, true);
}

async function attemptFetch(url, options, allowRetry) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.fetchTimeoutMs);

  let response;
  try {
    response = await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    clearTimeout(timer);
    const isTimeout = err.name === 'AbortError';
    const label = isTimeout ? 'timeout' : 'network error';
    if (allowRetry) {
      console.warn(`[fetch] ${label} for ${url} — retrying in ${config.fetchBackoffMs}ms`);
      await sleep(config.fetchBackoffMs);
      await checkKill(); // re-check kill switch before retry
      return attemptFetch(url, options, false);
    }
    throw new Error(`Fetch failed (${label}) for ${url}: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }

  if (response.status >= 400 && response.status < 500) {
    throw new Error(`HTTP ${response.status} from ${url} — not retrying`);
  }

  if (!response.ok) {
    if (allowRetry) {
      console.warn(`[fetch] HTTP ${response.status} from ${url} — retrying in ${config.fetchBackoffMs}ms`);
      await sleep(config.fetchBackoffMs);
      await checkKill();
      return attemptFetch(url, options, false);
    }
    throw new Error(`HTTP ${response.status} from ${url}`);
  }

  return response;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
