// NIP-73-conformant URL normalization for X-Ray metadata events.
//
// Spec: XRAY_METADATA_SPEC.md §6.2 + Phase 9a Implementation Plan §5.
//
// Goal: every metadata event published against a URL must agree on the
// canonical form of that URL so that relay-side `#r=<url>` and
// `#i=<url>` filters return everything for that target. Without this,
// every tracking-param variant forks the metadata graph and readers
// see partial coverage.
//
// Rules (do NOT change without bumping the spec):
//
//   1. Lowercase scheme and host.
//   2. Strip default ports (:80 for http, :443 for https, :21 for ftp).
//   3. Drop tracking query parameters (utm_*, fbclid, gclid, msclkid,
//      ref, referrer, mc_cid, mc_eid, _ga, igshid, feature, si,
//      __source, __share). The list is deliberately conservative —
//      only params that ARE tracking, never params that change content.
//   4. Strip URL fragments unless they're explicit text fragments
//      (`#:~:text=...` per the W3C Text Fragment proposal). Text
//      fragments ARE part of the canonical URL because the metadata
//      may be anchored to one.
//   5. Remove trailing slashes from non-root paths. `/article/` →
//      `/article`; `/` stays as `/`.
//   6. Sort remaining query parameters alphabetically. `?b=2&a=1` and
//      `?a=1&b=2` produce the same canonical URL → same hash → same
//      metadata bucket.
//   7. Leave path-case alone. Most servers are case-sensitive on the
//      path; lowercasing the path would cause real false-negatives.
//
// Public surface:
//   - normalize(url: string): string                    — canonical form
//   - urlHash(url: string): Promise<string>             — sha256 prefix
//
// `Utils.normalizeUrl` (legacy, in `utils.js`) is now a thin wrapper
// around `normalize()`. Existing call-sites continue to work; new code
// should import from this module directly to make the dependency
// explicit.

const TRACKING_PARAMS = new Set([
  // Universal analytics
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content',
  'utm_term', 'utm_id', 'utm_name', 'utm_brand',
  // Ad-platform click ids
  'fbclid', 'gclid', 'gclsrc', 'msclkid', 'dclid',
  'yclid', 'twclid', 'wbraid', 'gbraid',
  // Generic referrer / share trackers
  'ref', 'referrer', 'referer', 'source', 'share_source', 'from',
  // Mailchimp
  'mc_cid', 'mc_eid',
  // Google Analytics
  '_ga', '_gl', '_gid',
  // Marketo / Omeda / Vero / Wicked Reports (merged from the legacy
  // ContentExtractor.normalizeUrl list when the two normalizers were
  // unified — JOURNAL 2026-07-09)
  'mkt_tok', 'oly_anon_id', 'oly_enc_id', 'vero_id', 'wickedid',
  // Alibaba-family + Twitter legacy impression tracking
  'spm', '__twitter_impression',
  // Instagram share
  'igshid', 'igsh',
  // YouTube share
  'feature',
  // Spotify share
  'si',
  // Substack share / source
  '__source', '__share',
  // LinkedIn
  'trk', 'trkCampaign',
  // HubSpot
  '_hsenc', '_hsmi', 'hsCtaTracking', 'hsa_acc', 'hsa_cam',
  // X / Twitter share
  's', 't', // careful: these are also content params on some sites; documented mismatch acceptable per spec §5
  'cxt'
]);

// Some hosts use single-letter params (`s`, `t`) for content too. The
// spec acknowledges this trade-off; X/Twitter status URLs don't use
// them as content, and the cost of NOT stripping them on share-links
// is large (every share gets a different URL hash). If a host arises
// where `s=` or `t=` is meaningful content, that host gets a
// per-domain exception here.
const HOSTS_WHERE_S_T_ARE_TRACKING = new Set([
  'x.com', 'twitter.com', 'mobile.twitter.com', 'mobile.x.com'
]);

/**
 * Canonicalize a URL per the rules in this module's docstring.
 * Returns the input unchanged if URL parsing fails (preserves the
 * existing `Utils.normalizeUrl` contract — never throws).
 *
 * @param {string} url
 * @returns {string}
 */
export function normalize(url) {
  if (typeof url !== 'string' || url.length === 0) return url;
  let parsed;
  try {
    parsed = new URL(url);
  } catch (_) {
    return url;
  }

  // Rule 1 — scheme + host.
  parsed.protocol = parsed.protocol.toLowerCase();
  parsed.hostname = parsed.hostname.toLowerCase();

  // Rule 2 — default ports.
  if (
    (parsed.protocol === 'https:' && parsed.port === '443') ||
    (parsed.protocol === 'http:'  && parsed.port === '80') ||
    (parsed.protocol === 'ftp:'   && parsed.port === '21') ||
    (parsed.protocol === 'ws:'    && parsed.port === '80') ||
    (parsed.protocol === 'wss:'   && parsed.port === '443')
  ) {
    parsed.port = '';
  }

  // Rule 3 — drop tracking params.
  // URLSearchParams.delete is the correct API but we need to iterate
  // over a snapshot of keys because deletion mutates the iterator.
  const keys = Array.from(parsed.searchParams.keys());
  const stripST = HOSTS_WHERE_S_T_ARE_TRACKING.has(parsed.hostname.replace(/^www\./, ''));
  for (const key of keys) {
    const lower = key.toLowerCase();
    if (TRACKING_PARAMS.has(lower)) {
      // The s/t single-letter keys are only stripped on hosts where
      // they ARE tracking; on every other host treat them as content.
      if ((lower === 's' || lower === 't') && !stripST) continue;
      parsed.searchParams.delete(key);
    }
  }

  // Rule 6 — sort remaining params alphabetically.
  const sorted = Array.from(parsed.searchParams.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  // Rebuild searchParams in sorted order. Mutating in place is fragile
  // across runtimes; reconstruct the search string by hand.
  parsed.search = sorted.length === 0
    ? ''
    : '?' + sorted.map(([k, v]) =>
        encodeURIComponent(k) + (v === '' ? '' : '=' + encodeURIComponent(v))
      ).join('&');

  // Rule 4 — fragments. Preserve only W3C Text Fragments (`#:~:text=...`).
  // The Text Fragment spec uses `#:~:text=` as the prefix; technically
  // a URL fragment can carry both a hash anchor AND a text fragment
  // (`#some-anchor:~:text=foo`), but the canonical form for metadata
  // anchoring is to keep the text fragment as-is.
  if (parsed.hash) {
    if (parsed.hash.includes(':~:text=')) {
      // keep
    } else {
      parsed.hash = '';
    }
  }

  let normalized = parsed.toString();

  // Strip a bare trailing `#` that the URL serializer may emit even
  // when the hash is empty. (Node's URL keeps the `#` separator from
  // the input string in some versions; browsers vary.)
  if (normalized.endsWith('#')) normalized = normalized.slice(0, -1);

  // Rule 5 — strip trailing slash on non-root paths.
  // The URL constructor doesn't expose a clean way to do this without
  // round-tripping. Operate on the string. Watch for: trailing slash
  // followed by `?` query or `#` fragment, where the slash is between
  // path and search/hash.
  normalized = stripTrailingPathSlash(normalized);

  return normalized;
}

/**
 * Strip a single trailing slash from a non-root path. Handles these
 * shapes:
 *   https://x.com/foo/   → https://x.com/foo
 *   https://x.com/foo/?q=1 → https://x.com/foo?q=1
 *   https://x.com/foo/#:~:text=hi → https://x.com/foo#:~:text=hi
 *   https://x.com/         → https://x.com/      (root, untouched)
 */
function stripTrailingPathSlash(s) {
  // Find where the path ends — at `?`, `#`, or end of string.
  // The URL is already serialized; find the boundary after the host.
  // `URL.toString()` always includes scheme://host[:port]/...
  const m = /^([a-z][a-z0-9+\-.]*:\/\/[^/?#]+)(\/[^?#]*)?(\?[^#]*)?(#.*)?$/i.exec(s);
  if (!m) return s;
  const origin = m[1];
  let path = m[2] || '';
  const search = m[3] || '';
  const hash = m[4] || '';
  if (path.length > 1 && path.endsWith('/')) {
    path = path.slice(0, -1);
  }
  return origin + path + search + hash;
}

/**
 * 16-character hex prefix of sha256(normalize(url)). Matches the
 * existing `urlHash` convention in `archive-cache.js` so cross-store
 * joins work.
 *
 * Uses the WebCrypto subtle API which is available in:
 *   - browser content scripts and pages
 *   - service workers
 *   - Node 20+ (where it lives on globalThis.crypto)
 *
 * @param {string} url
 * @returns {Promise<string>}
 */
export async function urlHash(url) {
  const canonical = normalize(url);
  const bytes = new TextEncoder().encode(canonical);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0')).join('');
  return hex.slice(0, 16);
}

/**
 * Synchronous variant for the small number of test fixtures that need
 * a stable hash without async. Not exported on the public API; tests
 * can import the async path.
 */
