// Userscript migration importer tests — issue #7.
//
// Pins the import contract: userscript-shaped JSON in, X-Ray
// canonical storage shape out. The schema-tolerance bits
// (privkey / privateKey, 16- / 64-char ids) are tested here too
// because the importer is the surface where migration users
// experience them.

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
            set(obj, cb) { for (const [k, v] of Object.entries(obj)) _stateStore.set(k, v); cb && cb(); },
            remove(keys, cb) { for (const k of Array.isArray(keys) ? keys : [keys]) _stateStore.delete(k); cb && cb(); }
        }
    }
};

const { migrateUserscriptBlob } = await import('../src/shared/userscript-migration.js');
const { Crypto } = await import('../src/shared/crypto.js');
const { LocalKeyManager } = await import('../src/shared/local-key-manager.js');
const { Storage } = await import('../src/shared/storage.js');

// Reset module state between tests so each starts clean.
async function freshState() {
    _stateStore.clear();
    LocalKeyManager.keys.clear();
    await LocalKeyManager.init();
}

// Real keypair — generated once, reused across tests so the
// identity-import pubkey check has something valid to verify.
const PRIV = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
const PUB  = Crypto.getPublicKey(PRIV);

test('imports user_identity, deriving npub if missing', async () => {
    await freshState();
    const out = await migrateUserscriptBlob({
        user_identity: { pubkey: PUB, privkey: PRIV }
    });
    assert.equal(out.perKey.user_identity.ok, true);
    const stored = LocalKeyManager.getKey('xray:user');
    assert.ok(stored, 'must persist xray:user');
    assert.equal(stored.privateKey, PRIV);
    assert.equal(stored.pubkey, PUB);
    assert.ok(stored.npub.startsWith('npub1'));
});

test('rejects user_identity with mismatched pubkey/privkey', async () => {
    await freshState();
    const out = await migrateUserscriptBlob({
        user_identity: { pubkey: 'f'.repeat(64), privkey: PRIV }
    });
    assert.equal(out.perKey.user_identity.ok, false);
    assert.match(out.perKey.user_identity.reason, /pubkey mismatch/);
    assert.equal(LocalKeyManager.getKey('xray:user'), null,
        'no identity must be persisted on mismatch');
});

test('imports entity_registry, normalizing privkey → privateKey', async () => {
    await freshState();
    const userscriptId = 'entity_' + 'a'.repeat(64);  // 64-char id
    const blob = {
        entity_registry: {
            [userscriptId]: {
                id:   userscriptId,
                name: 'Test Person',
                type: 'person',
                keypair: { privkey: 'b'.repeat(64), pubkey: 'c'.repeat(64) }
            }
        }
    };
    const out = await migrateUserscriptBlob(blob);
    assert.equal(out.perKey.entity_registry.ok, true);
    assert.equal(out.perKey.entity_registry.added, 1);

    const entities = await Storage.get('entities', {});
    assert.ok(entities[userscriptId], 'entity must be in storage');
    assert.equal(entities[userscriptId].name, 'Test Person');
    assert.equal(entities[userscriptId].keyName, `entity:${userscriptId}`);

    const kp = LocalKeyManager.getKey(`entity:${userscriptId}`);
    assert.ok(kp, 'keypair must be persisted under derived keyName');
    assert.equal(kp.privateKey, 'b'.repeat(64),
        'privkey must be normalized to privateKey');
});

test('imports relay_config, merging only enabled relays', async () => {
    await freshState();
    // Pre-seed an existing relay so we can verify merge-not-replace.
    await Storage.set('preferences', { default_relays: ['wss://existing.example'] });

    const out = await migrateUserscriptBlob({
        relay_config: {
            relays: [
                { url: 'wss://new-a.example', enabled: true,  read: true, write: true },
                { url: 'wss://new-b.example', enabled: true,  read: true, write: true },
                { url: 'wss://muted.example', enabled: false, read: true, write: true }
            ]
        }
    });
    assert.equal(out.perKey.relay_config.ok, true);

    const prefs = await Storage.get('preferences', {});
    assert.ok(prefs.default_relays.includes('wss://existing.example'),
        'must preserve existing relays');
    assert.ok(prefs.default_relays.includes('wss://new-a.example'));
    assert.ok(prefs.default_relays.includes('wss://new-b.example'));
    assert.ok(!prefs.default_relays.includes('wss://muted.example'),
        'disabled relays must be skipped');
});

test('passes article_claims through under merge semantics', async () => {
    await freshState();
    await Storage.set('article_claims', { 'claim_existing': { id: 'claim_existing', text: 'old' } });

    const out = await migrateUserscriptBlob({
        article_claims: {
            'claim_new': { id: 'claim_new', text: 'fresh' }
        }
    });
    assert.equal(out.perKey.article_claims.ok, true);
    assert.equal(out.perKey.article_claims.added, 1);

    const claims = await Storage.get('article_claims', {});
    assert.ok(claims.claim_existing, 'pre-existing claim survives');
    assert.ok(claims.claim_new, 'new claim landed');
});

test('reports unknown top-level keys as ignored, not silently dropped', async () => {
    await freshState();
    const out = await migrateUserscriptBlob({
        user_identity: { pubkey: PUB, privkey: PRIV },
        some_random_key: { whatever: true }
    });
    assert.ok(out.errors.some((e) => e.includes('some_random_key')),
        'unknown key must be reported in errors');
});

test('rejects non-object top-level input cleanly', async () => {
    await freshState();
    const out = await migrateUserscriptBlob('not an object');
    assert.deepEqual(out.perKey, {});
    assert.ok(out.errors.length > 0);
});
