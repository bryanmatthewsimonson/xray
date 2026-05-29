// Ranker tests — Phase 9a Day 5.
//
// Spec: XRAY_METADATA_SPEC.md §8.1 + Implementation Plan §8.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { rankAnnotations } = await import('../src/shared/metadata/ranker.js');
const { composeGraph } = await import('../src/shared/metadata/trust-graph.js');

const ME = 'me';
const ALICE = 'alice'.padEnd(64, 'a');
const BOB = 'bob'.padEnd(64, 'b');
const CAROL = 'carol'.padEnd(64, 'c');

function ann(pubkey, created_at, id = '') {
  return { pubkey, created_at, id };
}

test('ranker: trusted bucket contains follows', () => {
  const g = composeGraph({
    pubkey: ME,
    contactList: { kind: 3, pubkey: ME, created_at: 100, tags: [['p', ALICE]] }
  });
  const out = rankAnnotations([
    ann(ALICE, 100, 'a1'),
    ann(BOB,   100, 'b1')
  ], g);
  assert.equal(out.trusted.length, 1);
  assert.equal(out.trusted[0].pubkey, ALICE);
  assert.equal(out.untrusted.length, 0); // includeUntrusted defaults to false
});

test('ranker: includeUntrusted populates untrusted bucket', () => {
  const g = composeGraph({
    pubkey: ME,
    contactList: { kind: 3, pubkey: ME, created_at: 100, tags: [['p', ALICE]] }
  });
  const out = rankAnnotations([
    ann(ALICE, 100, 'a1'),
    ann(BOB,   100, 'b1')
  ], g, { includeUntrusted: true });
  assert.equal(out.trusted.length, 1);
  assert.equal(out.untrusted.length, 1);
  assert.equal(out.untrusted[0].pubkey, BOB);
});

test('ranker: sort by created_at descending within bucket', () => {
  const g = composeGraph({
    pubkey: ME,
    contactList: { kind: 3, pubkey: ME, created_at: 100, tags: [['p', ALICE], ['p', BOB], ['p', CAROL]] }
  });
  const out = rankAnnotations([
    ann(ALICE, 100, 'a1'),
    ann(BOB,   300, 'b1'),
    ann(CAROL, 200, 'c1')
  ], g);
  assert.deepEqual(out.trusted.map((a) => a.created_at), [300, 200, 100]);
});

test('ranker: tie-break on event id (descending)', () => {
  const g = composeGraph({
    pubkey: ME,
    contactList: { kind: 3, pubkey: ME, created_at: 100, tags: [['p', ALICE], ['p', BOB]] }
  });
  const out = rankAnnotations([
    ann(ALICE, 100, 'aaa'),
    ann(BOB,   100, 'bbb')
  ], g);
  // Both same timestamp; bbb > aaa lexicographically → bbb first.
  assert.deepEqual(out.trusted.map((a) => a.id), ['bbb', 'aaa']);
});

test('ranker: empty trust graph + includeUntrusted=false → empty trusted', () => {
  const g = composeGraph({ pubkey: ME });
  const out = rankAnnotations([
    ann(ALICE, 100, 'a1'),
    ann(BOB,   100, 'b1')
  ], g);
  assert.equal(out.trusted.length, 0);
  assert.equal(out.untrusted.length, 0);
});

test('ranker: empty trust graph + includeUntrusted=true → all in untrusted', () => {
  const g = composeGraph({ pubkey: ME });
  const out = rankAnnotations([
    ann(ALICE, 100, 'a1'),
    ann(BOB,   100, 'b1')
  ], g, { includeUntrusted: true });
  assert.equal(out.trusted.length, 0);
  assert.equal(out.untrusted.length, 2);
});

test('ranker: topic + threshold filtering', () => {
  const g = composeGraph({
    pubkey: ME,
    topicTrustEvents: [
      { kind: 30053, pubkey: ME, created_at: 100, id: 'e1', tags: [['p', ALICE], ['t', 'bitcoin'], ['weight', '85']] },
      { kind: 30053, pubkey: ME, created_at: 100, id: 'e2', tags: [['p', BOB],   ['t', 'bitcoin'], ['weight', '40']] }
    ]
  });
  const out = rankAnnotations([
    ann(ALICE, 100, 'a1'),
    ann(BOB,   100, 'b1')
  ], g, { topic: 'bitcoin', threshold: 60 });
  // ALICE clears 60; BOB doesn't.
  assert.equal(out.trusted.length, 1);
  assert.equal(out.trusted[0].pubkey, ALICE);
});

test('ranker: skips entries without pubkey', () => {
  const g = composeGraph({ pubkey: ME, contactList: { kind: 3, pubkey: ME, created_at: 100, tags: [['p', ALICE]] } });
  const out = rankAnnotations([
    null,
    ann(ALICE, 100, 'a1'),
    { created_at: 100 } // no pubkey
  ], g);
  assert.equal(out.trusted.length, 1);
});

test('ranker: bridging is a v3 placeholder (null in v1)', () => {
  const g = composeGraph({ pubkey: ME });
  const out = rankAnnotations([], g);
  assert.equal(out.bridging, null);
});
