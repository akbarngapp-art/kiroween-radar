/**
 * src/verifier.js
 * Verifier router. Dispatches each CandidateEvent to the correct verifier
 * by its type, attaches the VerificationResult, and returns the enriched event.
 */

import { verify as binanceVerify }     from './verifiers/binance.js';
import { verify as githubRestVerify }  from './verifiers/github-rest.js';

/**
 * @param {object} event         CandidateEvent
 * @param {object} sourceConfig  Matching entry from config/sources.json
 * @returns {Promise<object>}    Event with .verification attached
 */
export async function corroborate(event, sourceConfig) {
  let verification;

  switch (event.type) {
    case 'price-move':
      verification = await binanceVerify(event, sourceConfig);
      break;

    case 'new-release':
      verification = await githubRestVerify(event, sourceConfig);
      break;

    default:
      verification = {
        source: 'unknown',
        outcome: 'unavailable',
        evidence: { reason: `Unknown event type: ${event.type}` },
      };
  }

  return { ...event, verification };
}
