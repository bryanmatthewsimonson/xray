// Entity sync tests — Phase 6 (issue #17).
//
// Covers the serialize → encrypt → decrypt → deserialize round trip
// and the malformed-payload rejection path. Network-backed push /
// pull orchestration is not exercised here — those require a real
// relay connection and live in smoke tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// chrome.storage.local shim so Storage / LocalKeyManager work in Node.
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

const { Crypto } = await import('../src/shared/crypto.js');
const {
    serializeEntityForSync,
    deserializeEntityFromSync
} = await import('../src/shared/entity-sync.js');

// ---------------------------------------------------------------------

test('entity-sync: self-ECDH conversation key is stable under the same privkey', async () => {
    const priv = Crypto.generatePrivateKey();
    const pub = Crypto.getPublicKey(priv);
    const k1 = await Crypto.nip44GetConversationKey(priv, pub);
    const k2 = await Crypto.nip44GetConversationKey(priv, pub);
    assert.equal(k1.length, k2.length);
    for (let i = 0; i < k1.length; i++) assert.equal(k1[i], k2[i]);
});

test('entity-sync: different users get different self-conversation-keys', async () => {
    const priv1 = Crypto.generatePrivateKey();
    const priv2 = Crypto.generatePrivateKey();
    const pub1 = Crypto.getPublicKey(priv1);
    const pub2 = Crypto.getPublicKey(priv2);
    const k1 = await Crypto.nip44GetConversationKey(priv1, pub1);
    const k2 = await Crypto.nip44GetConversationKey(priv2, pub2);
    // Practically impossible collision.
    let diff = 0;
    for (let i = 0; i < k1.length; i++) diff |= k1[i] ^ k2[i];
    assert.notEqual(diff, 0);
});

test('entity-sync: serialize → nip44 encrypt → decrypt → deserialize round-trip', async () => {
    const priv = Crypto.generatePrivateKey();
    const pub = Crypto.getPublicKey(priv);
    const convKey = await Crypto.nip44GetConversationKey(priv, pub);

    // Build a fake entity with the shape `EntityModel.get` returns.
    const entityPriv = Crypto.generatePrivateKey();
    const entityPub = Crypto.getPublicKey(entityPriv);
    const entity = {
        id:           'entity_aabbccddee112233',
        name:         'Donald Trump',
        type:         'person',
        description:  'Some notes.',
        nip05:        '',
        canonical_id: null,
        created:      1_700_000_000,
        updated:      1_700_000_100,
        publishedAt:  1_700_000_200,
        publishedEventId: 'ae'.repeat(32),
        keyName:      'entity:entity_aabbccddee112233',
        keypair: {
            privateKey: entityPriv,
            pubkey:     entityPub,
            npub:       Crypto.hexToNpub(entityPub),
            nsec:       Crypto.hexToNsec(entityPriv)
        }
    };

    const payload    = serializeEntityForSync(entity);
    const ciphertext = await Crypto.nip44Encrypt(payload, convKey);
    const recovered  = await Crypto.nip44Decrypt(ciphertext, convKey);
    const parsed     = deserializeEntityFromSync(recovered);
    assert.ok(parsed, 'deserialize should succeed');
    assert.equal(parsed.id,   entity.id);
    assert.equal(parsed.name, entity.name);
    assert.equal(parsed.type, entity.type);
    assert.equal(parsed.keypair.privateKey, entityPriv);
    assert.equal(parsed.keypair.pubkey,     entityPub);
    assert.equal(parsed.updated, entity.updated);
    assert.equal(parsed.publishedEventId, entity.publishedEventId);
    assert.equal(parsed.schemaVersion, 1);
});

test('entity-sync: serialize refuses entities without a local keypair', () => {
    assert.throws(() => serializeEntityForSync({
        id: 'entity_0000000000000000', name: 'X', type: 'person',
        keypair: { pubkey: 'ab'.repeat(32) }   // no privateKey
    }), /missing a local keypair/);

    assert.throws(() => serializeEntityForSync({
        id: 'entity_0000000000000000', name: 'X', type: 'person'
        // no keypair at all
    }), /missing a local keypair/);

    assert.throws(() => serializeEntityForSync({
        // no id
        name: 'X', type: 'person',
        keypair: { privateKey: 'ab'.repeat(32), pubkey: 'cd'.repeat(32) }
    }), /missing entity\.id/);
});

test('entity-sync: deserialize rejects garbage payloads without throwing', () => {
    assert.equal(deserializeEntityFromSync('not json'),                  null);
    assert.equal(deserializeEntityFromSync('null'),                      null);
    assert.equal(deserializeEntityFromSync('{}'),                        null);
    assert.equal(deserializeEntityFromSync('{"id":"bogus"}'),            null);
    assert.equal(deserializeEntityFromSync(
        JSON.stringify({ id: 'entity_0000000000000000', name: 'X' })),   null);   // no type
    assert.equal(deserializeEntityFromSync(
        JSON.stringify({
            id: 'entity_0000000000000000', name: 'X', type: 'person'
            // no keypair
        })),                                                              null);
});

test('entity-sync: deserialize accepts a minimally-valid payload', () => {
    const valid = deserializeEntityFromSync(JSON.stringify({
        id: 'entity_0000000000000000',
        name: 'Minimum',
        type: 'thing',
        keypair: { privateKey: 'a'.repeat(64), pubkey: 'b'.repeat(64) }
    }));
    assert.ok(valid);
    assert.equal(valid.id, 'entity_0000000000000000');
    assert.equal(valid.type, 'thing');
});

test('entity-sync: HMAC tamper is rejected on decrypt (belt and braces for self-ECDH)', async () => {
    const priv = Crypto.generatePrivateKey();
    const pub = Crypto.getPublicKey(priv);
    const convKey = await Crypto.nip44GetConversationKey(priv, pub);

    const entity = {
        id: 'entity_aabbccddee112233', name: 'x', type: 'thing',
        keypair: { privateKey: 'a'.repeat(64), pubkey: 'b'.repeat(64) }
    };
    const payload = serializeEntityForSync(entity);
    const ciphertext = await Crypto.nip44Encrypt(payload, convKey);

    // Flip one byte near the end (inside the HMAC region).
    const raw = Uint8Array.from(atob(ciphertext), c => c.charCodeAt(0));
    raw[raw.length - 1] ^= 0x01;
    let bin = '';
    for (let i = 0; i < raw.length; i++) bin += String.fromCharCode(raw[i]);
    const tampered = btoa(bin);

    await assert.rejects(() => Crypto.nip44Decrypt(tampered, convKey), /HMAC verification failed/);
});
