// Composite metadata relay-query tests — Phase 9b.
//
// buildMetadataFilters / bucketEvents / fetchMetadataForUrl /
// fetchHelpfulnessVotes + the client-side responds-to filter.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  buildMetadataFilters, bucketEvents, isRespondsToTarget,
  fetchMetadataForUrl, fetchHelpfulnessVotes
} = await import('../src/shared/metadata/relay-query.js');

const URL = 'https://example.com/article';

// ── buildMetadataFilters ───────────────────────────────────────────────

test('buildMetadataFilters: matches the NIP_DRAFT filter set', () => {
  const f = buildMetadataFilters(URL);
  assert.equal(f.length, 7);
  // annotations/factchecks/ratings on #r
  assert.deepEqual(f[0], { kinds: [30050, 30051, 30052], '#r': [URL], limit: 200 });
  // highlights #r
  assert.deepEqual(f[1], { kinds: [9802], '#r': [URL], limit: 100 });
  // comments #i (NIP-22)
  assert.deepEqual(f[2], { kinds: [1111], '#i': [URL], limit: 200 });
  // labels #r
  assert.deepEqual(f[3], { kinds: [1985], '#r': [URL], limit: 100 });
  // reactions #i
  assert.deepEqual(f[4], { kinds: [17], '#i': [URL], limit: 200 });
  // reports #r
  assert.deepEqual(f[5], { kinds: [1984], '#r': [URL], limit: 50 });
  // responds-to via 30023 #r
  assert.deepEqual(f[6], { kinds: [30023], '#r': [URL], limit: 50 });
});

test('buildMetadataFilters: normalizes the URL (utm stripped, host lowercased)', () => {
  const f = buildMetadataFilters('HTTPS://Example.COM/article?utm_source=x');
  assert.equal(f[0]['#r'][0], 'https://example.com/article');
});

// ── isRespondsToTarget ─────────────────────────────────────────────────

test('isRespondsToTarget: true when a responds-to tag matches', () => {
  const ev = { tags: [['responds-to', 'https://example.com/article', 'rebuts'], ['d', 'x']] };
  assert.equal(isRespondsToTarget(ev, 'https://example.com/article'), true);
});

test('isRespondsToTarget: matches after normalization', () => {
  const ev = { tags: [['responds-to', 'HTTPS://Example.COM/article?utm_source=x', 'rebuts']] };
  assert.equal(isRespondsToTarget(ev, 'https://example.com/article'), true);
});

test('isRespondsToTarget: false when no responds-to / different target', () => {
  assert.equal(isRespondsToTarget({ tags: [['r', URL]] }, URL), false);
  assert.equal(isRespondsToTarget({ tags: [['responds-to', 'https://other.com/x', 'rebuts']] }, URL), false);
  assert.equal(isRespondsToTarget(null, URL), false);
});

// ── bucketEvents ───────────────────────────────────────────────────────

function ev(id, kind, tags = []) { return { id, kind, tags }; }

test('bucketEvents: routes each kind to its bucket', () => {
  const out = bucketEvents([
    ev('a1', 30050), ev('f1', 30051), ev('r1', 30052), ev('h1', 9802),
    ev('c1', 1111), ev('l1', 1985), ev('x1', 17), ev('rep1', 1984)
  ], URL);
  assert.equal(out.annotations.length, 1);
  assert.equal(out.factchecks.length, 1);
  assert.equal(out.ratings.length, 1);
  assert.equal(out.highlights.length, 1);
  assert.equal(out.comments.length, 1);
  assert.equal(out.labels.length, 1);
  assert.equal(out.reactions.length, 1);
  assert.equal(out.reports.length, 1);
  assert.equal(out.all.length, 8);
});

test('bucketEvents: dedupes by event id across overlapping filters', () => {
  const out = bucketEvents([ev('a1', 30050), ev('a1', 30050), ev('a2', 30050)], URL);
  assert.equal(out.annotations.length, 2);
  assert.equal(out.all.length, 2);
});

test('bucketEvents: keeps only responds-to-matching kind-30023 events', () => {
  const matching = ev('art1', 30023, [['responds-to', URL, 'rebuts'], ['r', URL]]);
  const nonMatching = ev('art2', 30023, [['r', URL]]); // r-tagged but no responds-to
  const out = bucketEvents([matching, nonMatching], URL);
  assert.equal(out.respondsTo.length, 1);
  assert.equal(out.respondsTo[0].id, 'art1');
});

test('bucketEvents: ignores unknown kinds + malformed events', () => {
  const out = bucketEvents([ev('k1', 1), { kind: 30050 }, null, ev('a1', 30050)], URL);
  assert.equal(out.all.length, 1);
  assert.equal(out.annotations[0].id, 'a1');
});

// ── fetchMetadataForUrl ────────────────────────────────────────────────

test('fetchMetadataForUrl: fans out filters + merges into buckets', async () => {
  // queryOne returns events keyed off the filter's first kind so we can
  // assert the fan-out hit every filter.
  const calls = [];
  const queryOne = async (relays, filter) => {
    calls.push(filter.kinds);
    if (filter.kinds[0] === 30050) return [ev('a1', 30050), ev('f1', 30051)];
    if (filter.kinds[0] === 1111)  return [ev('c1', 1111)];
    return [];
  };
  const out = await fetchMetadataForUrl(URL, { relays: ['wss://r'], queryOne });
  assert.equal(calls.length, 7);               // all 7 filters fired
  assert.equal(out.annotations.length, 1);
  assert.equal(out.factchecks.length, 1);
  assert.equal(out.comments.length, 1);
  assert.equal(out.url, URL);
});

test('fetchMetadataForUrl: a failing filter does not sink the fetch', async () => {
  const queryOne = async (relays, filter) => {
    if (filter.kinds[0] === 1111) throw new Error('relay timeout');
    if (filter.kinds[0] === 30050) return [ev('a1', 30050)];
    return [];
  };
  const out = await fetchMetadataForUrl(URL, { relays: ['wss://r'], queryOne });
  assert.equal(out.annotations.length, 1);  // survived despite the comments filter throwing
  assert.equal(out.comments.length, 0);
});

test('fetchMetadataForUrl: no relays → empty buckets, no query', async () => {
  let called = false;
  const queryOne = async () => { called = true; return []; };
  const out = await fetchMetadataForUrl(URL, { relays: [], queryOne });
  assert.equal(called, false);
  assert.equal(out.all.length, 0);
  assert.equal(out.url, URL);
});

test('fetchMetadataForUrl: requires queryOne', async () => {
  await assert.rejects(() => fetchMetadataForUrl(URL, { relays: ['wss://r'] }));
});

// ── fetchHelpfulnessVotes ──────────────────────────────────────────────

test('fetchHelpfulnessVotes: queries kind 9803 by #a coords', async () => {
  let seenFilter = null;
  const queryOne = async (relays, filter) => {
    seenFilter = filter;
    return [ev('v1', 9803), ev('v1', 9803), ev('v2', 9803)]; // dup v1
  };
  const out = await fetchHelpfulnessVotes(['30050:abc:d1'], { relays: ['wss://r'], queryOne });
  assert.deepEqual(seenFilter.kinds, [9803]);
  assert.deepEqual(seenFilter['#a'], ['30050:abc:d1']);
  assert.equal(out.length, 2); // deduped
});

test('fetchHelpfulnessVotes: empty coords → no query', async () => {
  let called = false;
  const out = await fetchHelpfulnessVotes([], { relays: ['wss://r'], queryOne: async () => { called = true; return []; } });
  assert.equal(called, false);
  assert.deepEqual(out, []);
});
