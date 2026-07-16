// Creator-binding wire — Phase 24.2 (docs/ENTITY_IDENTITY_DESIGN.md §4).
// The manifest + NIP-26 token round trips, the forged-token rejections,
// and the revocation semantics are the load-bearing tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

const { Crypto } = await import('../src/shared/crypto.js');
const {
    OWNED_KEYS_KIND, OWNED_KEYS_D,
    buildOwnedKeysManifest, parseOwnedKeysManifest,
    entityDelegationConditions, delegationString, mintDelegationTag, verifyDelegationTag,
    computeCreatorBinding
} = await import('../src/shared/identity-builders.js');

const PRIMARY = '11'.repeat(32);
const PRIMARY_PUB = Crypto.getPublicKey(PRIMARY);
const ENTITY_PRIV = '22'.repeat(32);
const ENTITY_PUB = Crypto.getPublicKey(ENTITY_PRIV);
const OTHER_PRIV = '33'.repeat(32);
const OTHER_PUB = Crypto.getPublicKey(OTHER_PRIV);

const CONDITIONS = entityDelegationConditions({ kinds: [0, 30067], from: 1000, until: 2000 });

function entityEvent(overrides = {}) {
    return {
        kind: 0, created_at: 1500, pubkey: ENTITY_PUB,
        tags: [], content: '{}',
        ...overrides
    };
}

// ---- manifest -------------------------------------------------------

test('OwnedKeys manifest: build → parse round-trip, deterministic order', () => {
    const ev = buildOwnedKeysManifest({
        entities: [
            { pubkey: 'ff'.repeat(32), id: 'entity_b', name: 'B' },
            { pubkey: 'aa'.repeat(32), id: 'entity_a', name: 'A' }
        ],
        createdAt: 1000
    });
    assert.equal(ev.kind, OWNED_KEYS_KIND);
    assert.deepEqual(ev.tags[0], ['d', OWNED_KEYS_D]);
    // Sorted by pubkey — 'aa…' first regardless of input order.
    const ownedRows = ev.tags.filter((t) => t[0] === 'owned');
    assert.equal(ownedRows[0][1], 'aa'.repeat(32));
    assert.equal(ownedRows[1][1], 'ff'.repeat(32));

    const back = parseOwnedKeysManifest({ ...ev, pubkey: PRIMARY_PUB });
    assert.equal(back.creatorPubkey, PRIMARY_PUB);
    assert.equal(back.owned.length, 2);
    assert.ok(back.ownedPubkeys.has('aa'.repeat(32)));
    assert.equal(parseOwnedKeysManifest({ kind: 1, tags: [] }), null);
});

// ---- delegation tokens ----------------------------------------------

test('conditions string: sorted kinds + window, exact NIP-26 grammar', () => {
    assert.equal(CONDITIONS, 'kind=0&kind=30067&created_at>1000&created_at<2000');
    assert.equal(delegationString('ab'.repeat(32), CONDITIONS),
        `nostr:delegation:${'ab'.repeat(32)}:${CONDITIONS}`);
});

test('mint → verify: a valid token passes; the delegator is identified', async () => {
    const tag = await mintDelegationTag(PRIMARY, ENTITY_PUB, CONDITIONS);
    assert.equal(tag[0], 'delegation');
    assert.equal(tag[1], PRIMARY_PUB);
    assert.equal(tag[2], CONDITIONS);

    const ev = entityEvent({ tags: [tag] });
    const res = await verifyDelegationTag(ev, { expectedDelegator: PRIMARY_PUB });
    assert.equal(res.ok, true);
    assert.equal(res.delegator, PRIMARY_PUB);
});

test('verify fails closed: forged/foreign/tampered/out-of-window tokens all reject', async () => {
    const tag = await mintDelegationTag(PRIMARY, ENTITY_PUB, CONDITIONS);

    // Token minted for a DIFFERENT delegatee — event pubkey mismatch.
    const stolen = entityEvent({ pubkey: OTHER_PUB, tags: [tag] });
    assert.equal((await verifyDelegationTag(stolen)).ok, false, 'delegatee mismatch');

    // Tampered conditions (widened window) — signature no longer covers them.
    const widened = ['delegation', tag[1], 'kind=0&kind=30067&created_at>0&created_at<9999999999', tag[3]];
    assert.equal((await verifyDelegationTag(entityEvent({ tags: [widened] }))).ok, false, 'tampered conditions');

    // Wrong delegator expected.
    const res = await verifyDelegationTag(entityEvent({ tags: [tag] }), { expectedDelegator: OTHER_PUB });
    assert.equal(res.ok, false);

    // Kind outside the delegation.
    const wrongKind = entityEvent({ kind: 30023, tags: [tag] });
    assert.equal((await verifyDelegationTag(wrongKind)).ok, false, 'kind outside conditions');

    // created_at outside the window.
    assert.equal((await verifyDelegationTag(entityEvent({ created_at: 999, tags: [tag] }))).ok, false);
    assert.equal((await verifyDelegationTag(entityEvent({ created_at: 2000, tags: [tag] }))).ok, false);

    // Unknown condition grammar fails closed.
    const weird = ['delegation', tag[1], 'kind=0&frobnicate=1', tag[3]];
    assert.equal((await verifyDelegationTag(entityEvent({ tags: [weird] }))).ok, false);

    // No tag at all.
    assert.equal((await verifyDelegationTag(entityEvent())).ok, false);
});

// ---- creator-binding classification ---------------------------------

test('computeCreatorBinding: full / partial / unbound / revocation', async () => {
    const tag = await mintDelegationTag(PRIMARY, ENTITY_PUB, CONDITIONS);
    const manifest = {
        ...buildOwnedKeysManifest({ entities: [{ pubkey: ENTITY_PUB, id: 'entity_x', name: 'X' }], createdAt: 1100 }),
        pubkey: PRIMARY_PUB
    };
    const profile = entityEvent({ tags: [tag] });
    const records = [{ event: manifest }, { event: profile }];

    const bound = await computeCreatorBinding(records, PRIMARY_PUB);
    assert.equal(bound.get(ENTITY_PUB), 'full');

    // Manifest only (no token on any event) ⇒ partial.
    const manifestOnly = await computeCreatorBinding([{ event: manifest }, { event: entityEvent() }], PRIMARY_PUB);
    assert.equal(manifestOnly.get(ENTITY_PUB), 'partial');

    // Token only (not manifest-listed) ⇒ partial.
    const tokenOnly = await computeCreatorBinding([{ event: profile }], PRIMARY_PUB);
    assert.equal(tokenOnly.get(ENTITY_PUB), 'partial');

    // REVOCATION: a newer manifest WITHOUT the key demotes it (token
    // still present ⇒ partial, not full).
    const revoked = { ...buildOwnedKeysManifest({ entities: [], createdAt: 1200 }), pubkey: PRIMARY_PUB };
    const afterRevoke = await computeCreatorBinding([{ event: manifest }, { event: revoked }, { event: profile }], PRIMARY_PUB);
    assert.equal(afterRevoke.get(ENTITY_PUB), 'partial', 'newest manifest wins — key disowned');

    // A manifest signed by someone ELSE binds nothing.
    const foreign = { ...manifest, pubkey: OTHER_PUB };
    const none = await computeCreatorBinding([{ event: foreign }, { event: entityEvent() }], PRIMARY_PUB);
    assert.equal(none.size, 0);
});
