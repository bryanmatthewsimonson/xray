// Composite metadata relay query — Phase 9b.
//
// Spec: NIP_DRAFT.md §Querying + XRAY_METADATA_SPEC.md §10 (relay-query).
//
// Given a URL, fetch every kind of metadata anchored to it — annotations,
// fact-checks, ratings, highlights, comments, labels, reactions, reports,
// and `responds-to` articles — by fanning out the NIP_DRAFT filter set in
// parallel and merging the results into typed buckets.
//
// This module is transport-agnostic: it takes an injected `queryOne`
// (relays, filter) → Promise<events[]> so the heavy lifting (the actual
// relay WebSocket pool) stays in the background SW behind the existing
// `xray:relay:query` handler, and the filter-building / bucketing logic
// stays pure and unit-testable. The thin SW-backed `queryOne` lives at
// the call site (reader / content script).

import { normalize } from './url-normalizer.js';

// Kind → metadata bucket. Mirrors NIP_DRAFT.md's kind table.
const KIND_BUCKET = {
  30050: 'annotations',
  30051: 'factchecks',
  30052: 'ratings',
  9802:  'highlights',
  1111:  'comments',
  1985:  'labels',
  17:    'reactions',
  1984:  'reports',
  30023: 'respondsTo'   // filtered client-side to those carrying a matching responds-to tag
};

const EMPTY_BUCKETS = () => ({
  annotations: [], factchecks: [], ratings: [], highlights: [],
  comments: [], labels: [], reactions: [], reports: [], respondsTo: []
});

/**
 * Build the parallel filter set for all metadata on a URL. The URL is
 * normalized first so the `#r` / `#i` values match what publishers wrote
 * (every builder normalizes before tagging).
 *
 * @param {string} url
 * @returns {Array<object>} NIP-01 filter objects
 */
export function buildMetadataFilters(url) {
  const u = normalize(url);
  return [
    { kinds: [30050, 30051, 30052], '#r': [u], limit: 200 },
    { kinds: [9802],                '#r': [u], limit: 100 },
    { kinds: [1111],                '#i': [u], limit: 200 },
    { kinds: [1985],                '#r': [u], limit: 100 },
    { kinds: [17],                  '#i': [u], limit: 200 },
    { kinds: [1984],                '#r': [u], limit: 50  },
    { kinds: [30023],               '#r': [u], limit: 50  }
  ];
}

/**
 * Does a kind-30023 event actually declare a `responds-to` against this
 * URL? The relay query matches on the co-emitted `r` tag (multi-letter
 * tags aren't indexed), so we confirm client-side per NIP_DRAFT.md.
 */
export function isRespondsToTarget(event, normalizedUrl) {
  if (!event || !Array.isArray(event.tags)) return false;
  return event.tags.some((t) =>
    Array.isArray(t) && t[0] === 'responds-to' &&
    typeof t[1] === 'string' && normalize(t[1]) === normalizedUrl);
}

/**
 * Sort received events into typed buckets by kind. Dedupes by event id
 * across the (overlapping) filter results. kind-30023 events are kept
 * only when they carry a matching `responds-to` tag.
 *
 * @param {Array<object>} events
 * @param {string} normalizedUrl  the normalized target (for responds-to)
 * @returns {object} buckets + `all`
 */
export function bucketEvents(events, normalizedUrl) {
  const buckets = EMPTY_BUCKETS();
  const seen = new Set();
  const all = [];
  for (const ev of (Array.isArray(events) ? events : [])) {
    if (!ev || typeof ev.kind !== 'number' || !ev.id) continue;
    if (seen.has(ev.id)) continue;
    const bucket = KIND_BUCKET[ev.kind];
    if (!bucket) continue;
    if (bucket === 'respondsTo' && !isRespondsToTarget(ev, normalizedUrl)) continue;
    seen.add(ev.id);
    buckets[bucket].push(ev);
    all.push(ev);
  }
  return { ...buckets, all };
}

/**
 * Fetch all metadata for a URL. Fans out the filter set through the
 * injected `queryOne`, tolerating per-filter failures (a relay timeout on
 * one filter never sinks the whole fetch), then buckets the merged result.
 *
 * @param {string} url
 * @param {object} opts
 * @param {string[]} opts.relays
 * @param {(relays: string[], filter: object) => Promise<Array<object>>} opts.queryOne
 * @returns {Promise<{annotations,factchecks,ratings,highlights,comments,labels,reactions,reports,respondsTo,all,url}>}
 */
export async function fetchMetadataForUrl(url, { relays, queryOne } = {}) {
  const normalizedUrl = normalize(url);
  if (typeof queryOne !== 'function') throw new Error('fetchMetadataForUrl: queryOne required');
  if (!Array.isArray(relays) || relays.length === 0) {
    return { ...EMPTY_BUCKETS(), all: [], url: normalizedUrl };
  }
  const filters = buildMetadataFilters(url);
  const perFilter = await Promise.all(
    filters.map((f) => Promise.resolve()
      .then(() => queryOne(relays, f))
      .then((evs) => (Array.isArray(evs) ? evs : []))
      .catch(() => []))
  );
  return { ...bucketEvents(perFilter.flat(), normalizedUrl), url: normalizedUrl };
}

/**
 * Follow-up: fetch kind-9803 HelpfulnessVotes for a set of addressable
 * coordinates (`<kind>:<pubkey>:<d>`), per NIP_DRAFT.md. Returns the raw
 * vote events; aggregation/bridging is the ranker's job (v3).
 *
 * @param {string[]} coords  addressable coordinates to query `#a` against
 * @param {object} opts  { relays, queryOne }
 * @returns {Promise<Array<object>>}
 */
export async function fetchHelpfulnessVotes(coords, { relays, queryOne } = {}) {
  if (!Array.isArray(coords) || coords.length === 0) return [];
  if (typeof queryOne !== 'function' || !Array.isArray(relays) || relays.length === 0) return [];
  const filter = { kinds: [9803], '#a': coords, limit: 500 };
  try {
    const evs = await queryOne(relays, filter);
    // Dedupe by id.
    const seen = new Set();
    return (Array.isArray(evs) ? evs : []).filter((e) => {
      if (!e || !e.id || seen.has(e.id)) return false;
      seen.add(e.id); return true;
    });
  } catch (_) {
    return [];
  }
}
