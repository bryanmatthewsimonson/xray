// Claim-ref tests — Phase 11.1 (docs/ASSESSMENTS_DESIGN.md).
// Same chrome.storage.local shim pattern as entity-model.test.mjs.
//
// Pins the canonical-ref rules everything in the assessment layer
// keys on: local id for our own claims, coordinate for foreign ones,
// and the collapse of our-own-published-claim coordinates back to the
// local id (which needs ClaimModel.markPublished's publishedPubkey).

import { test } from 'node:test';
import assert from 'node:assert/strict';

const _stateStore = new Map();
globalThis.chrome = {
    storage: {
        local: {
            get(keys, cb) {
                const out = {};
                for (const k of Array.isArray(keys) ? keys : [keys]) {
                    if (_stateStore.has(k)) out[k] = _stateStore.get(k);
                }
                cb(out);
            },
            set(obj, cb) {
                for (const [k, v] of Object.entries(obj)) _stateStore.set(k, v);
                cb && cb();
            },
            remove(keys, cb) {
                for (const k of Array.isArray(keys) ? keys : [keys]) _stateStore.delete(k);
                cb && cb();
            }
        }
    }
};

const {
    isLocalClaimId, isClaimCoord, parseClaimCoord, buildClaimCoord,
    assertValidClaimRef, canonicalizeClaimRef, CLAIM_KIND
} = await import('../src/shared/claim-ref.js');
const { ClaimModel } = await import('../src/shared/claim-model.js');

function resetState() { _stateStore.clear(); }

const PUBKEY_A = 'a'.repeat(64);
const PUBKEY_B = 'b'.repeat(64);
const LOCAL_ID = 'claim_aaaaaaaaaaaaaaaa';

// ---------------------------------------------------------------------

test('claim-ref: local-id shape', () => {
    assert.equal(isLocalClaimId(LOCAL_ID), true);
    assert.equal(isLocalClaimId('claim_AAAAAAAAAAAAAAAA'), false, 'hex is lowercase');
    assert.equal(isLocalClaimId('claim_aaaa'), false, 'sixteen hex chars exactly');
    assert.equal(isLocalClaimId(`30040:${PUBKEY_A}:${LOCAL_ID}`), false);
    assert.equal(isLocalClaimId(null), false);
});

test('claim-ref: coordinate parse + build round-trip', () => {
    assert.equal(CLAIM_KIND, 30040);
    const coord = buildClaimCoord(PUBKEY_A, LOCAL_ID);
    assert.equal(coord, `30040:${PUBKEY_A}:${LOCAL_ID}`);
    assert.deepEqual(parseClaimCoord(coord), { kind: 30040, pubkey: PUBKEY_A, d: LOCAL_ID });
    assert.equal(isClaimCoord(coord), true);

    // Foreign d-tags may contain colons — only the first two delimit.
    const colonD = parseClaimCoord(`30040:${PUBKEY_A}:ann:deadbeef:v2`);
    assert.equal(colonD.d, 'ann:deadbeef:v2');

    assert.equal(parseClaimCoord(`30023:${PUBKEY_A}:${LOCAL_ID}`), null, 'wrong kind');
    assert.equal(parseClaimCoord(`30040:shortkey:${LOCAL_ID}`), null, 'malformed pubkey');
    assert.equal(parseClaimCoord(`30040:${PUBKEY_A}:`), null, 'empty d');
    assert.equal(parseClaimCoord(LOCAL_ID), null);

    assert.throws(() => buildClaimCoord('nope', LOCAL_ID), /64 hex/);
    assert.throws(() => buildClaimCoord(PUBKEY_A, ''), /d-tag value required/);
});

test('claim-ref: assertValidClaimRef accepts both forms, rejects garbage', () => {
    assert.equal(assertValidClaimRef(LOCAL_ID, 'ref'), LOCAL_ID);
    assert.equal(assertValidClaimRef(`  ${LOCAL_ID}  `, 'ref'), LOCAL_ID, 'trims');
    const coord = buildClaimCoord(PUBKEY_A, LOCAL_ID);
    assert.equal(assertValidClaimRef(coord, 'ref'), coord);
    assert.throws(() => assertValidClaimRef('', 'source_claim_id'), /source_claim_id is required/);
    assert.throws(() => assertValidClaimRef('not-a-ref', 'ref'),
        /must be a claim id or a 30040 coordinate/);
});

test('claim-ref: canonicalize passes local ids through', async () => {
    resetState();
    assert.equal(await canonicalizeClaimRef(LOCAL_ID), LOCAL_ID);
});

test('claim-ref: canonicalize collapses coordinates of our own published claims', async () => {
    resetState();
    const claim = await ClaimModel.create({
        text: 'The defendant said X.', source_url: 'https://example.com/video-1'
    });
    await ClaimModel.markPublished(claim.id, 'e'.repeat(64), PUBKEY_A);

    const ours = buildClaimCoord(PUBKEY_A, claim.id);
    assert.equal(await canonicalizeClaimRef(ours), claim.id, 'our published claim → local id');

    // Same d under a DIFFERENT pubkey is somebody else's claim: claim
    // ids hash (url|text), so two users capturing the same quote derive
    // the same d. The pubkey must match.
    const theirs = buildClaimCoord(PUBKEY_B, claim.id);
    assert.equal(await canonicalizeClaimRef(theirs), theirs, 'foreign pubkey stays a coordinate');
});

test('claim-ref: collapse matches ANY recorded publishing pubkey (re-keyed republish)', async () => {
    resetState();
    const claim = await ClaimModel.create({
        text: 'Republished under a new identity.', source_url: 'https://example.com/video-6'
    });
    await ClaimModel.markPublished(claim.id, 'e'.repeat(64), PUBKEY_A);
    await ClaimModel.markPublished(claim.id, 'f'.repeat(64), PUBKEY_B);   // re-keyed

    // Coordinates under BOTH identities are live addressable events on
    // relays — both must keep collapsing (publishedPubkeys history).
    assert.equal(await canonicalizeClaimRef(buildClaimCoord(PUBKEY_A, claim.id)), claim.id,
        'old-identity coordinate still collapses');
    assert.equal(await canonicalizeClaimRef(buildClaimCoord(PUBKEY_B, claim.id)), claim.id,
        'new-identity coordinate collapses');
});

test('claim-ref: coordinates of unpublished or unknown claims stay coordinates', async () => {
    resetState();
    const claim = await ClaimModel.create({
        text: 'Not yet on the wire.', source_url: 'https://example.com/video-2'
    });
    const coord = buildClaimCoord(PUBKEY_A, claim.id);
    assert.equal(await canonicalizeClaimRef(coord), coord,
        'no recorded publishedPubkey → cannot claim it as ours');

    const foreign = buildClaimCoord(PUBKEY_A, 'their-arbitrary-d');
    assert.equal(await canonicalizeClaimRef(foreign), foreign);
});
