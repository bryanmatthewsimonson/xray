// Trust graph tests — Phase 9a Day 4.
//
// Spec: XRAY_METADATA_SPEC.md §8.1 + Implementation Plan §7.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  composeGraph,
  isTrusted,
  trustedAuthors,
  getTrustedTopicsFor,
  serializeGraph,
  deserializeGraph
} = await import('../src/shared/metadata/trust-graph.js');

const ME = 'ownerpubkey';
const ALICE = 'alice'.padEnd(64, 'a');
const BOB = 'bob'.padEnd(64, 'b');
const CAROL = 'carol'.padEnd(64, 'c');
const DAVE = 'dave'.padEnd(64, 'd');

// ------------------------------------------------------------------
// composeGraph
// ------------------------------------------------------------------

test('composeGraph: empty inputs yield empty graph', () => {
  const g = composeGraph({ pubkey: ME });
  assert.equal(g.firstOrderFollows.size, 0);
  assert.equal(g.topicTrust.size, 0);
});

test('composeGraph: rejects missing owner pubkey', () => {
  assert.throws(() => composeGraph({}));
});

test('composeGraph: extracts NIP-02 follows from kind 3', () => {
  const g = composeGraph({
    pubkey: ME,
    contactList: {
      kind: 3,
      pubkey: ME,
      created_at: 100,
      tags: [
        ['p', ALICE, 'wss://relay.example/', 'alice'],
        ['p', BOB],
        ['e', 'unrelated'],     // ignore
        ['p']                    // malformed; ignore
      ]
    }
  });
  assert.equal(g.firstOrderFollows.size, 2);
  assert.ok(g.firstOrderFollows.has(ALICE));
  assert.ok(g.firstOrderFollows.has(BOB));
});

test('composeGraph: builds topic-trust from kind 30053', () => {
  const g = composeGraph({
    pubkey: ME,
    topicTrustEvents: [
      {
        kind: 30053, pubkey: ME, created_at: 100, id: 'e1',
        tags: [['p', ALICE], ['t', 'bitcoin'], ['weight', '85']]
      },
      {
        kind: 30053, pubkey: ME, created_at: 100, id: 'e2',
        tags: [['p', BOB], ['t', 'bitcoin'], ['weight', '40']]
      },
      {
        kind: 30053, pubkey: ME, created_at: 100, id: 'e3',
        tags: [['p', ALICE], ['t', 'macroeconomics'], ['weight', '60']]
      }
    ]
  });
  assert.equal(g.topicTrust.get('bitcoin').get(ALICE).weight, 85);
  assert.equal(g.topicTrust.get('bitcoin').get(BOB).weight, 40);
  assert.equal(g.topicTrust.get('macroeconomics').get(ALICE).weight, 60);
});

test('composeGraph: latest event wins per (topic, target)', () => {
  const g = composeGraph({
    pubkey: ME,
    topicTrustEvents: [
      { kind: 30053, pubkey: ME, created_at: 100, id: 'older', tags: [['p', ALICE], ['t', 'bitcoin'], ['weight', '40']] },
      { kind: 30053, pubkey: ME, created_at: 200, id: 'newer', tags: [['p', ALICE], ['t', 'bitcoin'], ['weight', '85']] }
    ]
  });
  assert.equal(g.topicTrust.get('bitcoin').get(ALICE).weight, 85);
  assert.equal(g.topicTrust.get('bitcoin').get(ALICE).eventId, 'newer');
});

test('composeGraph: ignores non-30053 events in topicTrustEvents', () => {
  const g = composeGraph({
    pubkey: ME,
    topicTrustEvents: [
      { kind: 1, pubkey: ME, created_at: 100, tags: [['p', ALICE], ['t', 'bitcoin'], ['weight', '85']] }
    ]
  });
  assert.equal(g.topicTrust.size, 0);
});

test('composeGraph: rejects invalid weight (out of range)', () => {
  const g = composeGraph({
    pubkey: ME,
    topicTrustEvents: [
      { kind: 30053, pubkey: ME, created_at: 100, id: 'a', tags: [['p', ALICE], ['t', 'bitcoin'], ['weight', '-5']] },
      { kind: 30053, pubkey: ME, created_at: 100, id: 'b', tags: [['p', BOB], ['t', 'bitcoin'], ['weight', '105']] },
      { kind: 30053, pubkey: ME, created_at: 100, id: 'c', tags: [['p', CAROL], ['t', 'bitcoin'], ['weight', 'foo']] }
    ]
  });
  assert.equal(g.topicTrust.size, 0);
});

test('composeGraph: rejects events missing required tags', () => {
  const g = composeGraph({
    pubkey: ME,
    topicTrustEvents: [
      { kind: 30053, pubkey: ME, created_at: 100, id: 'no-target', tags: [['t', 'bitcoin'], ['weight', '50']] },
      { kind: 30053, pubkey: ME, created_at: 100, id: 'no-topic',  tags: [['p', ALICE], ['weight', '50']] },
      { kind: 30053, pubkey: ME, created_at: 100, id: 'no-weight', tags: [['p', ALICE], ['t', 'bitcoin']] }
    ]
  });
  assert.equal(g.topicTrust.size, 0);
});

test('composeGraph: excludes expired entries', () => {
  const g = composeGraph({
    pubkey: ME,
    now: 1000,
    topicTrustEvents: [
      { kind: 30053, pubkey: ME, created_at: 100, id: 'e1',
        tags: [['p', ALICE], ['t', 'bitcoin'], ['weight', '85'], ['expires', '500']] },
      { kind: 30053, pubkey: ME, created_at: 100, id: 'e2',
        tags: [['p', BOB], ['t', 'bitcoin'], ['weight', '85'], ['expires', '2000']] },
      { kind: 30053, pubkey: ME, created_at: 100, id: 'e3',
        tags: [['p', CAROL], ['t', 'bitcoin'], ['weight', '85']] }     // never expires
    ]
  });
  assert.equal(g.topicTrust.get('bitcoin').size, 2);
  assert.ok(g.topicTrust.get('bitcoin').has(BOB));
  assert.ok(g.topicTrust.get('bitcoin').has(CAROL));
  assert.equal(g.topicTrust.get('bitcoin').has(ALICE), false);
});

// ------------------------------------------------------------------
// isTrusted
// ------------------------------------------------------------------

test('isTrusted: NIP-02 follow → trusted on any topic by default', () => {
  const g = composeGraph({
    pubkey: ME,
    contactList: { kind: 3, pubkey: ME, created_at: 100, tags: [['p', ALICE]] }
  });
  assert.equal(isTrusted(g, ALICE), true);
  assert.equal(isTrusted(g, ALICE, 'bitcoin'), true);
  assert.equal(isTrusted(g, ALICE, 'cooking'), true);
});

test('isTrusted: non-follow with no topic-trust → not trusted', () => {
  const g = composeGraph({ pubkey: ME });
  assert.equal(isTrusted(g, ALICE), false);
});

test('isTrusted: topic-trust above threshold → trusted on that topic', () => {
  const g = composeGraph({
    pubkey: ME,
    topicTrustEvents: [
      { kind: 30053, pubkey: ME, created_at: 100, id: 'e1',
        tags: [['p', ALICE], ['t', 'bitcoin'], ['weight', '60']] }
    ]
  });
  assert.equal(isTrusted(g, ALICE, 'bitcoin'), true);
  assert.equal(isTrusted(g, ALICE, 'cooking'), false);
});

test('isTrusted: weight below threshold → not trusted on that topic', () => {
  const g = composeGraph({
    pubkey: ME,
    topicTrustEvents: [
      { kind: 30053, pubkey: ME, created_at: 100, id: 'e1',
        tags: [['p', ALICE], ['t', 'bitcoin'], ['weight', '40']] }
    ]
  });
  assert.equal(isTrusted(g, ALICE, 'bitcoin'), false);
});

test('isTrusted: weight exactly at threshold → trusted (>=)', () => {
  const g = composeGraph({
    pubkey: ME,
    topicTrustEvents: [
      { kind: 30053, pubkey: ME, created_at: 100, id: 'e1',
        tags: [['p', ALICE], ['t', 'bitcoin'], ['weight', '50']] }
    ]
  });
  assert.equal(isTrusted(g, ALICE, 'bitcoin'), true);
  assert.equal(isTrusted(g, ALICE, 'bitcoin', { threshold: 50 }), true);
  assert.equal(isTrusted(g, ALICE, 'bitcoin', { threshold: 51 }), false);
});

test('isTrusted: custom threshold respected', () => {
  const g = composeGraph({
    pubkey: ME,
    topicTrustEvents: [
      { kind: 30053, pubkey: ME, created_at: 100, id: 'e1',
        tags: [['p', ALICE], ['t', 'bitcoin'], ['weight', '85']] }
    ]
  });
  assert.equal(isTrusted(g, ALICE, 'bitcoin', { threshold: 90 }), false);
  assert.equal(isTrusted(g, ALICE, 'bitcoin', { threshold: 85 }), true);
});

test('isTrusted: followsTrustAllTopics=false requires explicit topic trust', () => {
  const g = composeGraph({
    pubkey: ME,
    contactList: { kind: 3, pubkey: ME, created_at: 100, tags: [['p', ALICE]] }
  });
  assert.equal(isTrusted(g, ALICE, 'bitcoin', { followsTrustAllTopics: false }), false);
});

test('isTrusted: followsTrustAllTopics=false + explicit topic trust → trusted', () => {
  const g = composeGraph({
    pubkey: ME,
    contactList: { kind: 3, pubkey: ME, created_at: 100, tags: [['p', ALICE]] },
    topicTrustEvents: [
      { kind: 30053, pubkey: ME, created_at: 100, id: 'e1',
        tags: [['p', ALICE], ['t', 'bitcoin'], ['weight', '60']] }
    ]
  });
  assert.equal(isTrusted(g, ALICE, 'bitcoin', { followsTrustAllTopics: false }), true);
  assert.equal(isTrusted(g, ALICE, 'cooking', { followsTrustAllTopics: false }), false);
});

// ------------------------------------------------------------------
// trustedAuthors
// ------------------------------------------------------------------

test('trustedAuthors: union of follows + topic-trust above threshold', () => {
  const g = composeGraph({
    pubkey: ME,
    contactList: { kind: 3, pubkey: ME, created_at: 100, tags: [['p', ALICE]] },
    topicTrustEvents: [
      { kind: 30053, pubkey: ME, created_at: 100, id: 'e1',
        tags: [['p', BOB], ['t', 'bitcoin'], ['weight', '60']] },
      { kind: 30053, pubkey: ME, created_at: 100, id: 'e2',
        tags: [['p', CAROL], ['t', 'cooking'], ['weight', '60']] }
    ]
  });
  const all = trustedAuthors(g);
  assert.equal(all.size, 3);
  const onBitcoin = trustedAuthors(g, 'bitcoin');
  // ALICE (follow) + BOB (bitcoin trust) — but not CAROL (cooking only).
  assert.equal(onBitcoin.size, 2);
  assert.ok(onBitcoin.has(ALICE));
  assert.ok(onBitcoin.has(BOB));
  assert.equal(onBitcoin.has(CAROL), false);
});

test('trustedAuthors: filters by threshold', () => {
  const g = composeGraph({
    pubkey: ME,
    topicTrustEvents: [
      { kind: 30053, pubkey: ME, created_at: 100, id: 'a',
        tags: [['p', ALICE], ['t', 'bitcoin'], ['weight', '85']] },
      { kind: 30053, pubkey: ME, created_at: 100, id: 'b',
        tags: [['p', BOB], ['t', 'bitcoin'], ['weight', '40']] }
    ]
  });
  const set = trustedAuthors(g, 'bitcoin', { threshold: 60 });
  assert.equal(set.size, 1);
  assert.ok(set.has(ALICE));
  assert.equal(set.has(BOB), false);
});

// ------------------------------------------------------------------
// getTrustedTopicsFor
// ------------------------------------------------------------------

test('getTrustedTopicsFor: lists all reasons a pubkey is trusted', () => {
  const g = composeGraph({
    pubkey: ME,
    contactList: { kind: 3, pubkey: ME, created_at: 100, tags: [['p', ALICE]] },
    topicTrustEvents: [
      { kind: 30053, pubkey: ME, created_at: 100, id: 'e1',
        tags: [['p', ALICE], ['t', 'bitcoin'], ['weight', '85']] },
      { kind: 30053, pubkey: ME, created_at: 100, id: 'e2',
        tags: [['p', ALICE], ['t', 'macroeconomics'], ['weight', '60']] }
    ]
  });
  const reasons = getTrustedTopicsFor(g, ALICE);
  // 1 from follows + 2 from topic-trust = 3 reasons
  assert.equal(reasons.length, 3);
  assert.ok(reasons.find(r => r.source === 'follows'));
  assert.ok(reasons.find(r => r.source === 'topic-trust' && r.topic === 'bitcoin' && r.weight === 85));
  assert.ok(reasons.find(r => r.source === 'topic-trust' && r.topic === 'macroeconomics' && r.weight === 60));
});

test('getTrustedTopicsFor: empty for unknown pubkey', () => {
  const g = composeGraph({ pubkey: ME });
  assert.deepEqual(getTrustedTopicsFor(g, DAVE), []);
});

// ------------------------------------------------------------------
// serialize / deserialize
// ------------------------------------------------------------------

test('serialize/deserialize round-trips graph state', () => {
  const g = composeGraph({
    pubkey: ME,
    contactList: { kind: 3, pubkey: ME, created_at: 100, tags: [['p', ALICE], ['p', BOB]] },
    topicTrustEvents: [
      { kind: 30053, pubkey: ME, created_at: 100, id: 'e1',
        tags: [['p', ALICE], ['t', 'bitcoin'], ['weight', '85']] }
    ]
  });

  const ser = serializeGraph(g);
  const json = JSON.stringify(ser);            // must be JSON-safe
  const back = deserializeGraph(JSON.parse(json));

  assert.equal(back.pubkey, ME);
  assert.ok(back.firstOrderFollows.has(ALICE));
  assert.ok(back.firstOrderFollows.has(BOB));
  assert.equal(back.topicTrust.get('bitcoin').get(ALICE).weight, 85);

  // isTrusted continues to work on the deserialized state.
  assert.equal(isTrusted(back, ALICE, 'bitcoin'), true);
  assert.equal(isTrusted(back, BOB, 'bitcoin'), true);
});

test('serializeGraph: returns null for null input', () => {
  assert.equal(serializeGraph(null), null);
});

test('deserializeGraph: returns null for null input', () => {
  assert.equal(deserializeGraph(null), null);
});

// ------------------------------------------------------------------
// Performance budget — composeGraph builds < 200ms on 10k follows
// ------------------------------------------------------------------

test('composeGraph: 10k follows builds in under 200ms', () => {
  const tags = [];
  for (let i = 0; i < 10000; i++) {
    // padStart with hex makes each 64-char id unique.
    tags.push(['p', i.toString(16).padStart(64, '0')]);
  }
  const t0 = performance.now();
  const g = composeGraph({
    pubkey: ME,
    contactList: { kind: 3, pubkey: ME, created_at: 100, tags }
  });
  const t1 = performance.now();
  assert.equal(g.firstOrderFollows.size, 10000);
  assert.ok(t1 - t0 < 200, `expected < 200ms, got ${t1 - t0}ms`);
});
