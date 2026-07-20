// portal/identity.js tests — Phase 12.1 (docs/PORTAL_DESIGN.md).
//
// The resolver unions four pubkey sources; these tests drive all of
// them through the real Storage / LocalKeyManager / models against the
// standard chrome.storage.local shim. The NIP-07 case pins the design
// decision: no tab-routing in v1 — the signer source resolves to null
// with a human-readable reason instead of throwing.

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

const { Storage } = await import('../src/shared/storage.js');
const { LocalKeyManager } = await import('../src/shared/local-key-manager.js');
const { Crypto } = await import('../src/shared/crypto.js');
const {
    resolveIdentities, addManualIdentity, removeManualIdentity, getManualIdentities
} = await import('../src/portal/identity.js');

const SIGNER_PK = 'a'.repeat(64);
const SYNC_PK = 'b'.repeat(64);
const HISTORY_PK_1 = 'c'.repeat(64);
const HISTORY_PK_2 = 'd'.repeat(64);
const MANUAL_PK = 'e'.repeat(64);
const ENTITY_PK = 'f'.repeat(64);

async function seedEverything() {
    _stateStore.clear();
    LocalKeyManager.keys.clear(); // module-level Map — reset between tests
    await Storage.set('preferences', { signing_method: 'local', signing_method_configured: true });
    await Storage.set('local_primary_identity', { pubkey: SIGNER_PK, privateKey: '1'.repeat(64) });
    await Storage.set('local_keys', {
        'xray:user': { name: 'xray:user', pubkey: SYNC_PK, privateKey: '2'.repeat(64) },
        'entity:entity_0123456789abcdef': {
            name: 'entity:entity_0123456789abcdef', pubkey: ENTITY_PK, privateKey: '3'.repeat(64)
        }
    });
    await Storage.set('article_claims', {
        claim_x: {
            id: 'claim_x', text: 'A claim', source_url: 'https://example.com',
            publishedPubkey: HISTORY_PK_1,
            publishedPubkeys: [HISTORY_PK_1, HISTORY_PK_2]
        }
    });
    await Storage.set('portal_identities', [MANUAL_PK]);
    await Storage.set('entities', {
        entity_0123456789abcdef: {
            id: 'entity_0123456789abcdef', name: 'Test Person', type: 'person',
            keyName: 'entity:entity_0123456789abcdef'
        }
    });
}

function sourcesFor(identities, pubkey) {
    const hit = identities.find((i) => i.pubkey === pubkey);
    return hit ? [...hit.sources].sort() : null;
}

test('resolveIdentities: me-sources union into identities; a pasted npub is a VIEWER (28.4)', async () => {
    await seedEverything();
    const { identities, viewers, entities, signer } = await resolveIdentities();

    assert.equal(signer.method, 'local');
    assert.equal(signer.pubkey, SIGNER_PK);
    assert.deepEqual(sourcesFor(identities, SIGNER_PK), ['signer']);
    assert.deepEqual(sourcesFor(identities, SYNC_PK), ['sync-key']);
    assert.deepEqual(sourcesFor(identities, HISTORY_PK_1), ['publish-history']);
    assert.deepEqual(sourcesFor(identities, HISTORY_PK_2), ['publish-history']);
    assert.equal(identities.length, 4, 'the pasted npub is NOT an identity');
    // The fence: manual-only pubkeys are read-only viewers — never "me".
    assert.equal(sourcesFor(identities, MANUAL_PK), null);
    assert.deepEqual(sourcesFor(viewers, MANUAL_PK), ['manual']);
    assert.equal(viewers.length, 1);

    assert.equal(entities.length, 1);
    assert.equal(entities[0].pubkey, ENTITY_PK);
    assert.equal(entities[0].name, 'Test Person');
    assert.equal(entities[0].type, 'person');
});

test('a pubkey reachable via several sources gets one entry, merged provenance — and stays an IDENTITY', async () => {
    await seedEverything();
    await Storage.set('portal_identities', [SYNC_PK]); // manual duplicate of the sync key
    const { identities, viewers } = await resolveIdentities();
    // Pasting your OWN key must not demote it to a viewer (28.4): any
    // me-source keeps it in identities, provenance intact.
    assert.deepEqual(sourcesFor(identities, SYNC_PK), ['manual', 'sync-key']);
    assert.equal(sourcesFor(viewers, SYNC_PK), null);
});

test('NIP-07 mode: signer unresolved with a reason, other sources still flow', async () => {
    await seedEverything();
    await Storage.set('preferences', { signing_method: 'nip07', signing_method_configured: true });
    const { identities, signer } = await resolveIdentities();
    assert.equal(signer.pubkey, null);
    assert.match(signer.reason, /NIP-07/);
    assert.equal(sourcesFor(identities, SIGNER_PK), null); // signer source gone
    assert.deepEqual(sourcesFor(identities, SYNC_PK), ['sync-key']);
});

test('garbage in storage never reaches the identity set', async () => {
    await seedEverything();
    await Storage.set('portal_identities', ['not-a-key', 42, null, MANUAL_PK]);
    await Storage.set('article_claims', {
        claim_y: { id: 'claim_y', text: 't', source_url: 'https://x.com', publishedPubkeys: ['xyz', HISTORY_PK_1] }
    });
    const { identities, viewers } = await resolveIdentities();
    for (const id of [...identities, ...viewers]) assert.match(id.pubkey, /^[0-9a-f]{64}$/);
    assert.deepEqual(sourcesFor(viewers, MANUAL_PK), ['manual'], 'valid pasted key survives as a viewer');
    assert.deepEqual(sourcesFor(identities, HISTORY_PK_1), ['publish-history']);
});

test('addManualIdentity accepts npub and hex, rejects junk, dedups', async () => {
    _stateStore.clear();
    LocalKeyManager.keys.clear();
    await Storage.set('preferences', { signing_method: 'local' });

    const npub = Crypto.hexToNpub(MANUAL_PK);
    assert.ok(npub && npub.startsWith('npub1'), 'test needs a valid npub');

    const viaNpub = await addManualIdentity(npub);
    assert.deepEqual(viaNpub, { ok: true, pubkey: MANUAL_PK });

    const viaHexDup = await addManualIdentity(MANUAL_PK.toUpperCase());
    assert.deepEqual(viaHexDup, { ok: true, pubkey: MANUAL_PK });
    assert.deepEqual(await getManualIdentities(), [MANUAL_PK]); // no dup

    const junk = await addManualIdentity('npub1notreal');
    assert.equal(junk.ok, false);
    const empty = await addManualIdentity('   ');
    assert.equal(empty.ok, false);
    const shortHex = await addManualIdentity('abc123');
    assert.equal(shortHex.ok, false);
});

test('removeManualIdentity removes only the asked-for key', async () => {
    _stateStore.clear();
    LocalKeyManager.keys.clear();
    await Storage.set('portal_identities', [MANUAL_PK, HISTORY_PK_1]);
    await removeManualIdentity(MANUAL_PK);
    assert.deepEqual(await getManualIdentities(), [HISTORY_PK_1]);
    await removeManualIdentity('not-present');
    assert.deepEqual(await getManualIdentities(), [HISTORY_PK_1]);
});
