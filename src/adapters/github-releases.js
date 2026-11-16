/**
 * src/adapters/github-releases.js
 * GitHub Atom feed adapter.
 * Fetches the releases Atom feed for a repo and returns a normalised Snapshot.
 */

import { fetchWithGuard } from '../fetch.js';

/**
 * Extract all occurrences of a tag's inner text from an XML string.
 * Returns the first match, or null.
 * @param {string} xml
 * @param {string} tag
 * @returns {string|null}
 */
function firstTagText(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = xml.match(re);
  return m ? m[1].trim() : null;
}

/**
 * Extract the href attribute of <link rel="alternate" ...> within a block.
 * Falls back to any <link href="..."> when rel="alternate" is absent.
 * @param {string} block
 * @returns {string|null}
 */
function extractAlternateHref(block) {
  // Prefer rel="alternate"
  const relAlt = block.match(/<link[^>]+rel=["']alternate["'][^>]*href=["']([^"']+)["']/i)
    || block.match(/<link[^>]+href=["']([^"']+)["'][^>]*rel=["']alternate["']/i);
  if (relAlt) return relAlt[1];

  // Fall back to any <link href="..."> that isn't rel="self"
  const anyLink = block.match(/<link[^>]+href=["']([^"']+)["'][^>]*>/ig);
  if (anyLink) {
    for (const tag of anyLink) {
      if (/rel=["']self["']/i.test(tag)) continue;
      const m = tag.match(/href=["']([^"']+)["']/i);
      if (m) return m[1];
    }
  }
  return null;
}

/**
 * Derive the release tag from the link href.
 * Looks for the segment after "/tag/"; falls back to the last "/" segment of entryId.
 * @param {string|null} link
 * @param {string} entryId
 * @returns {string}
 */
function deriveTag(link, entryId) {
  if (link) {
    const m = link.match(/\/tag\/([^/?#]+)/);
    if (m) return decodeURIComponent(m[1]);
  }
  // Fall back to last "/" segment of entry id
  const parts = entryId.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? entryId;
}

/**
 * Split Atom XML into individual <entry>…</entry> blocks.
 * @param {string} xml
 * @returns {string[]}
 */
function splitEntries(xml) {
  const entries = [];
  const re = /<entry[\s>]([\s\S]*?)<\/entry>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    entries.push(m[1]);
  }
  return entries;
}

/**
 * @param {object} sourceConfig  Entry from config/sources.json
 * @returns {Promise<Snapshot>}
 */
export async function fetchSnapshot(sourceConfig) {
  const { id, url } = sourceConfig;

  const response = await fetchWithGuard(url);
  let xml;
  try {
    xml = await response.text();
  } catch (err) {
    throw new Error(`[github-releases] Failed to read response text from ${url}: ${err.message}`);
  }

  const entryBlocks = splitEntries(xml);
  if (entryBlocks.length === 0) {
    throw new Error(`[github-releases] Malformed Atom feed from ${url}: no <entry> elements found`);
  }

  const entries = {};

  for (const block of entryBlocks) {
    const entryId = firstTagText(block, 'id');
    if (!entryId) continue;

    const title   = firstTagText(block, 'title') ?? '';
    const updated = firstTagText(block, 'updated') ?? '';
    const link    = extractAlternateHref(block);
    const tag     = deriveTag(link, entryId);

    entries[entryId] = { id: entryId, tag, title, updated, link };
  }

  if (Object.keys(entries).length === 0) {
    throw new Error(`[github-releases] No parseable entries in Atom feed from ${url}`);
  }

  return {
    sourceId: id,
    capturedAt: new Date().toISOString(),
    entries,
  };
}
