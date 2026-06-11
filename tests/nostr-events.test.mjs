// shared/nostr-events.js tests — Phase 12.1.
//
// The shared dedupeReplaceable generalizes the side panel's old
// all-30040 helper to the portal's mixed corpus, so the NIP-01 class
// boundaries are pinned here: a kind moving between classes (or a new
// corpus kind landing in the wrong class) should fail a test, not
// silently drop or duplicate events.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { eventClass, replaceableKey, dedupeReplaceable } from '../src/shared/nostr-events.js';

const PK_A = 'a'.repeat(64);
const PK_B = 'b'.repeat(64);

function ev(kind, pubkey, createdAt, { d, id } = {}) {
    return {
        id: id || `id_${kind}_${pubkey.slice(0, 4)}_${createdAt}_${d || ''}`,
        kind,
        pubkey,
        created_at: createdAt,
        tags: d !== undefined ? [['d', d]] : [],
        content: ''
    };
}

// ------------------------------------------------------------------
// Class pins — every kind the portal queries, in its NIP-01 class
// ------------------------------------------------------------------

test('eventClass pins the NIP-01 class of every corpus kind', () => {
    const expected = {
        0:     'replaceable',
        3:     'replaceable',
        10002: 'replaceable',
        30023: 'addressable',
        30040: 'addressable',
        30041: 'addressable',
        30050: 'addressable',
        30051: 'addressable',
        30052: 'addressable',
        30053: 'addressable',
        30054: 'addressable',
        30055: 'addressable',
        30078: 'addressable',
        32125: 'addressable',
        32126: 'addressable',
        1985:  'regular',
        9803:  'regular',
        1:     'regular'
    };
    for (const [kind, cls] of Object.entries(expected)) {
        assert.equal(eventClass(Number(kind)), cls, `kind ${kind}`);
    }
});

test('replaceableKey shape per class', () => {
    assert.equal(replaceableKey(ev(0, PK_A, 1)), `0:${PK_A}`);
    assert.equal(replaceableKey(ev(30040, PK_A, 1, { d: 'claim_x' })), `30040:${PK_A}:claim_x`);
    assert.equal(replaceableKey(ev(1985, PK_A, 1)), null);
    // Addressable with no d falls back to the event id — a malformed
    // event must never swallow its siblings.
    const noD = ev(30040, PK_A, 1, { id: 'idX' });
    assert.equal(replaceableKey(noD), `30040:${PK_A}:idX`);
});

// ------------------------------------------------------------------
// dedupeReplaceable behavior
// ------------------------------------------------------------------

test('addressable: latest wins per (kind, pubkey, d)', () => {
    const oldV = ev(30040, PK_A, 100, { d: 'claim_x' });
    const newV = ev(30040, PK_A, 200, { d: 'claim_x' });
    const other = ev(30040, PK_A, 50, { d: 'claim_y' });
    const out = dedupeReplaceable([oldV, newV, other]);
    assert.deepEqual(out.map((e) => e.id), [newV.id, other.id]);
});

test('addressable: same d under different pubkeys both survive', () => {
    const a = ev(30040, PK_A, 100, { d: 'claim_x' });
    const b = ev(30040, PK_B, 100, { d: 'claim_x' });
    assert.equal(dedupeReplaceable([a, b]).length, 2);
});

test('replaceable: kind 0 and 10002 collapse per (kind, pubkey) with no d tag', () => {
    const profile1 = ev(0, PK_A, 100);
    const profile2 = ev(0, PK_A, 200);
    const relays1 = ev(10002, PK_A, 100);
    const relays2 = ev(10002, PK_A, 300);
    const otherAuthor = ev(0, PK_B, 50);
    const out = dedupeReplaceable([profile1, profile2, relays1, relays2, otherAuthor]);
    assert.deepEqual(out.map((e) => e.id), [profile2.id, relays2.id, otherAuthor.id]);
});

test('regular: every 1985 / 9803 event is kept', () => {
    const l1 = ev(1985, PK_A, 100);
    const l2 = ev(1985, PK_A, 100);
    const v1 = ev(9803, PK_A, 100);
    assert.equal(dedupeReplaceable([l1, l2, v1]).length, 3);
});

test('created_at tie keeps the first-seen event', () => {
    const a = ev(30040, PK_A, 100, { d: 'claim_x', id: 'first' });
    const b = ev(30040, PK_A, 100, { d: 'claim_x', id: 'second' });
    const out = dedupeReplaceable([a, b]);
    assert.deepEqual(out.map((e) => e.id), ['first']);
});

test('output preserves input order and skips falsy entries', () => {
    const c1 = ev(30040, PK_A, 100, { d: 'c1' });
    const label = ev(1985, PK_A, 150);
    const c2 = ev(30040, PK_A, 200, { d: 'c2' });
    const out = dedupeReplaceable([c1, null, label, undefined, c2]);
    assert.deepEqual(out.map((e) => e.id), [c1.id, label.id, c2.id]);
});

test('non-array input yields an empty array', () => {
    assert.deepEqual(dedupeReplaceable(null), []);
    assert.deepEqual(dedupeReplaceable(undefined), []);
});
