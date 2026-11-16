/**
 * src/verifiers/github-rest.js
 * Corroborates a new-release event by calling the GitHub REST Releases API.
 *
 * Outcomes:
 *   verified    — 200 and tag_name matches event.tag
 *   disputed    — HTTP 404, or tag_name mismatch
 *   unavailable — network failure, timeout, or non-404 HTTP error
 *
 * NOTE: This is same-origin corroboration. Both the Atom feed and this endpoint
 * are served by github.com.  The evidence object records this explicitly so
 * downstream consumers are not misled.
 */

import { fetchWithGuard } from '../fetch.js';
import { KillSwitchError } from '../kill.js';

const VERIFICATION_SOURCE = 'github-rest';

/**
 * @param {object} event         CandidateEvent (must have .tag, .repo)
 * @param {object} sourceConfig  Source config entry (carries verification.apiUrl)
 * @returns {Promise<VerificationResult>}
 */
export async function verify(event, sourceConfig) {
  const apiUrl = sourceConfig?.verification?.apiUrl;
  if (!apiUrl) {
    return {
      source: VERIFICATION_SOURCE,
      outcome: 'unavailable',
      evidence: { reason: 'No verification.apiUrl configured for this source' },
    };
  }

  const repo = event.repo ?? sourceConfig.repo;
  const tag  = event.tag;

  if (!repo || !tag) {
    return {
      source: VERIFICATION_SOURCE,
      outcome: 'unavailable',
      evidence: { reason: `Missing repo or tag on event (repo=${repo}, tag=${tag})` },
    };
  }

  const verifyUrl = `${apiUrl}/repos/${repo}/releases/tags/${tag}`;
  const fetchedAt = new Date().toISOString();

  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'radar-watchdog',
  };
  if (process.env.GITHUB_TOKEN) {
    headers['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  let json;
  try {
    const response = await fetchWithGuard(verifyUrl, { headers });
    json = await response.json();
  } catch (err) {
    // Re-throw kill-switch errors — they must propagate
    if (err instanceof KillSwitchError) throw err;

    if (/HTTP 404/i.test(err.message)) {
      return {
        source: VERIFICATION_SOURCE,
        outcome: 'disputed',
        evidence: {
          mode: 'same-origin corroboration',
          note: 'Atom feed and REST API are both served by github.com; this corroborates the feed parse against a second GitHub endpoint, it is not an independent operator.',
          reason: `Tag "${tag}" not found via GitHub REST API (HTTP 404)`,
          fetchedAt,
        },
      };
    }

    return {
      source: VERIFICATION_SOURCE,
      outcome: 'unavailable',
      evidence: {
        mode: 'same-origin corroboration',
        note: 'Atom feed and REST API are both served by github.com; this corroborates the feed parse against a second GitHub endpoint, it is not an independent operator.',
        reason: err.message,
        fetchedAt,
      },
    };
  }

  const apiTag  = json?.tag_name ?? null;
  const htmlUrl = json?.html_url ?? null;
  const outcome = apiTag === tag ? 'verified' : 'disputed';

  return {
    source: VERIFICATION_SOURCE,
    outcome,
    evidence: {
      mode: 'same-origin corroboration',
      note: 'Atom feed and REST API are both served by github.com; this corroborates the feed parse against a second GitHub endpoint, it is not an independent operator.',
      apiTag,
      htmlUrl,
      fetchedAt,
    },
  };
}
