// Follow-set registry tests — Knowledge Sharing KS.5 engine half
// (Phase 25.1). Anchors, pubkey normalization, CRUD, idempotence,
// relay-hint harvest (injected pull), and the pinned scope enum.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const _store = new Map();
globalThis.chrome = {
    storage: {
        local: {
            get(keys, cb) { const o = {}; for (const k of (Array.isArray(keys) ? keys : [keys])) if (_store.has(k)) o[k] = _store.get(k); cb(o); },
            set(obj, cb) { for (const [k, v] of Object.entries(obj)) _store.set(k, v); cb && cb(); },
            remove(keys, cb) { for (const k of (Array.isArray(keys) ? keys : [keys])) _store.delete(k); cb && cb(); }
        }
    }
};

const { FollowModel, FOLLOW_SCOPES, MAX_RELAY_HINTS, anchorKey, normalizeFollowPubkey } =
    await import('../src/shared/follow-model.js');
const { Crypto } = await import('../src/shared/crypto.js');

const GLOBAL = { scope: 'global' };
const CASE_A = { scope: 'case', entityId: 'entity_case_a' };
const PK_1 = '1'.repeat(64);
const PK_2 = '2'.repeat(64);

beforeEach(() => _store.clear());

// ------------------------------------------------------------------
// Pins — extend deliberately, with a design-doc change.
// ------------------------------------------------------------------

test('FOLLOW_SCOPES is pinned exactly', () => {
    assert.deepEqual([...FOLLOW_SCOPES], ['case', 'entity', 'global']);
});

test('MAX_RELAY_HINTS is pinned', () => {
    assert.equal(MAX_RELAY_HINTS, 4);
});

// ------------------------------------------------------------------
// anchorKey
// ------------------------------------------------------------------

test('anchorKey: global has no entityId; case/entity require one', () => {
    assert.equal(anchorKey(GLOBAL), 'global');
    assert.equal(anchorKey(CASE_A), 'case:entity_case_a');
    assert.equal(anchorKey({ scope: 'entity', entityId: 'entity_x' }), 'entity:entity_x');
    assert.throws(() => anchorKey({ scope: 'case' }), /requires entityId/);
    assert.throws(() => anchorKey({ scope: 'team' }), /unknown scope/);
    assert.throws(() => anchorKey(null), /unknown scope/);
});

// ------------------------------------------------------------------
// normalizeFollowPubkey
// ------------------------------------------------------------------

test('normalizeFollowPubkey: hex, npub, garbage', () => {
    assert.equal(normalizeFollowPubkey(PK_1), PK_1);
    assert.equal(normalizeFollowPubkey(PK_1.toUpperCase()), PK_1);
    const npub = Crypto.hexToNpub(PK_1);
    assert.ok(npub.startsWith('npub1'));
    assert.equal(normalizeFollowPubkey(npub), PK_1);
    assert.equal(normalizeFollowPubkey('npub1notreal'), null);
    assert.equal(normalizeFollowPubkey('abc'), null);
    assert.equal(normalizeFollowPubkey(''), null);
    assert.equal(normalizeFollowPubkey(undefined), null);
});

// ------------------------------------------------------------------
// CRUD
// ------------------------------------------------------------------

test('addFollow stores an entry; getSet/followedPubkeys/isFollowed see it', async () => {
    const entry = await FollowModel.addFollow(GLOBAL, { pubkey: PK_1, label: 'Alice' });
    assert.equal(entry.pubkey, PK_1);
    assert.equal(entry.label, 'Alice');
    assert.ok(entry.addedAt > 0);
    assert.deepEqual(entry.relayHints, []);

    const set = await FollowModel.getSet(GLOBAL);
    assert.equal(set.length, 1);
    assert.deepEqual(await FollowModel.followedPubkeys(GLOBAL), [PK_1]);
    assert.equal(await FollowModel.isFollowed(GLOBAL, PK_1), true);
    assert.equal(await FollowModel.isFollowed(GLOBAL, PK_2), false);
});

test('addFollow accepts npub input and rejects garbage', async () => {
    const npub = Crypto.hexToNpub(PK_2);
    await FollowModel.addFollow(GLOBAL, { pubkey: npub });
    assert.equal(await FollowModel.isFollowed(GLOBAL, PK_2), true);
    await assert.rejects(FollowModel.addFollow(GLOBAL, { pubkey: 'nope' }), /invalid pubkey/);
});

test('addFollow is idempotent: no duplicate, addedAt kept, label refreshed', async () => {
    const first = await FollowModel.addFollow(GLOBAL, { pubkey: PK_1, label: 'Alice' });
    const again = await FollowModel.addFollow(GLOBAL, { pubkey: PK_1, label: 'Alice B.' });
    assert.equal(again.addedAt, first.addedAt);
    assert.equal(again.label, 'Alice B.');
    const set = await FollowModel.getSet(GLOBAL);
    assert.equal(set.length, 1);
});

test('anchors are independent: case follow does not appear globally', async () => {
    await FollowModel.addFollow(CASE_A, { pubkey: PK_1 });
    assert.equal(await FollowModel.isFollowed(GLOBAL, PK_1), false);
    assert.deepEqual(await FollowModel.followedPubkeys(CASE_A), [PK_1]);
});

test('listAnchors reports scope/entityId/count and skips empty sets', async () => {
    await FollowModel.addFollow(GLOBAL, { pubkey: PK_1 });
    await FollowModel.addFollow(CASE_A, { pubkey: PK_1 });
    await FollowModel.addFollow(CASE_A, { pubkey: PK_2 });
    const anchors = await FollowModel.listAnchors();
    const byKey = Object.fromEntries(anchors.map((a) => [a.key, a]));
    assert.equal(byKey.global.count, 1);
    assert.equal(byKey.global.entityId, null);
    assert.equal(byKey['case:entity_case_a'].count, 2);
    assert.equal(byKey['case:entity_case_a'].scope, 'case');
    assert.equal(byKey['case:entity_case_a'].entityId, 'entity_case_a');
});

test('removeFollow deletes the entry and prunes the empty anchor', async () => {
    await FollowModel.addFollow(GLOBAL, { pubkey: PK_1 });
    assert.equal(await FollowModel.removeFollow(GLOBAL, PK_1), true);
    assert.equal(await FollowModel.removeFollow(GLOBAL, PK_1), false);
    assert.deepEqual(await FollowModel.getSet(GLOBAL), []);
    assert.deepEqual(await FollowModel.listAnchors(), []);
});

test('relabel updates and clears the label', async () => {
    await FollowModel.addFollow(GLOBAL, { pubkey: PK_1, label: 'Alice' });
    assert.equal(await FollowModel.relabel(GLOBAL, PK_1, 'Dr. A'), true);
    let [entry] = await FollowModel.getSet(GLOBAL);
    assert.equal(entry.label, 'Dr. A');
    assert.equal(await FollowModel.relabel(GLOBAL, PK_1, ''), true);
    [entry] = await FollowModel.getSet(GLOBAL);
    assert.equal(entry.label, undefined);
    assert.equal(await FollowModel.relabel(GLOBAL, PK_2, 'x'), false);
});

test('labels are trimmed and capped at 60 chars', async () => {
    const long = 'x'.repeat(80);
    const entry = await FollowModel.addFollow(GLOBAL, { pubkey: PK_1, label: `  ${long}  ` });
    assert.equal(entry.label.length, 60);
});

// ------------------------------------------------------------------
// Relay hints
// ------------------------------------------------------------------

test('relayHints are validated, deduped, and capped on add', async () => {
    const entry = await FollowModel.addFollow(GLOBAL, {
        pubkey: PK_1,
        relayHints: [
            'wss://a.example', 'wss://a.example', 'http://not-a-relay.example',
            'wss://b.example', 'wss://c.example', 'wss://d.example', 'wss://e.example'
        ]
    });
    assert.deepEqual(entry.relayHints, ['wss://a.example', 'wss://b.example', 'wss://c.example', 'wss://d.example']);
});

test('harvestRelayHints stores capped hints via the injected pull', async () => {
    await FollowModel.addFollow(GLOBAL, { pubkey: PK_1 });
    const pull = async ({ pubkey }) => {
        assert.equal(pubkey, PK_1);
        return { found: true, relays: ['wss://r1.example', 'wss://r2.example', 'wss://r3.example', 'wss://r4.example', 'wss://r5.example'] };
    };
    const hints = await FollowModel.harvestRelayHints(GLOBAL, PK_1, { relays: ['wss://seed.example'], pull });
    assert.equal(hints.length, MAX_RELAY_HINTS);
    const [entry] = await FollowModel.getSet(GLOBAL);
    assert.deepEqual(entry.relayHints, hints);
});

test('harvestRelayHints is best-effort: pull failure or not-found → []', async () => {
    await FollowModel.addFollow(GLOBAL, { pubkey: PK_1 });
    assert.deepEqual(await FollowModel.harvestRelayHints(GLOBAL, PK_1, { pull: async () => { throw new Error('net'); } }), []);
    assert.deepEqual(await FollowModel.harvestRelayHints(GLOBAL, PK_1, { pull: async () => ({ found: false, relays: [] }) }), []);
    assert.deepEqual(await FollowModel.harvestRelayHints(GLOBAL, PK_1, {}), []);
    const [entry] = await FollowModel.getSet(GLOBAL);
    assert.deepEqual(entry.relayHints, []);
});

// ------------------------------------------------------------------
// The unfollow-keeps contract (TC §10.4) — removal touches ONLY the
// registry key; anything else in storage survives.
// ------------------------------------------------------------------

test('removeFollow writes only follow_sets', async () => {
    _store.set('article_claims', JSON.stringify([{ id: 'c1' }]));
    await FollowModel.addFollow(GLOBAL, { pubkey: PK_1 });
    await FollowModel.removeFollow(GLOBAL, PK_1);
    assert.equal(_store.get('article_claims'), JSON.stringify([{ id: 'c1' }]));
});
