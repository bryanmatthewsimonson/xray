// Deterministic child-key derivation — Phase 24.1
// (docs/ENTITY_IDENTITY_DESIGN.md). The durability layer: same primary
// + same entity id ⇒ the same key, forever. The pinned vector is the
// load-bearing test — if it moves, every previously-derived entity
// pubkey silently changes.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const _store = new Map();
globalThis.chrome = {
    storage: {
        local: {
            get(keys, cb) { const out = {}; for (const k of Array.isArray(keys) ? keys : [keys]) if (_store.has(k)) out[k] = _store.get(k); cb(out); },
            set(obj, cb) { for (const [k, v] of Object.entries(obj)) _store.set(k, v); cb && cb(); },
            remove(keys, cb) { for (const k of Array.isArray(keys) ? keys : [keys]) _store.delete(k); cb && cb(); }
        }
    }
};

const { Crypto } = await import('../src/shared/crypto.js');
const { LocalKeyManager } = await import('../src/shared/local-key-manager.js');
const { EntityModel, ENTITY_KEY_DOMAIN } = await import('../src/shared/entity-model.js');
const { Storage } = await import('../src/shared/storage.js');

const PARENT = '11'.repeat(32);

// ---- scalarFromHash -------------------------------------------------

test('scalarFromHash: in-range bytes pass through; zero and n reduce to null', () => {
    const one = new Uint8Array(32); one[31] = 1;
    assert.equal(Crypto.scalarFromHash(one), '0'.repeat(63) + '1');

    assert.equal(Crypto.scalarFromHash(new Uint8Array(32)), null, 'zero scalar rejected');

    // Exactly the curve order n ⇒ 0 mod n ⇒ null.
    const N_HEX = 'fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141';
    assert.equal(Crypto.scalarFromHash(Crypto.hexToBytes(N_HEX)), null, 'n reduces to zero');

    // n+1 reduces to 1.
    const nPlus1 = 'fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364142';
    assert.equal(Crypto.scalarFromHash(Crypto.hexToBytes(nPlus1)), '0'.repeat(63) + '1');
});

// ---- deriveChildKey -------------------------------------------------

test('deriveChildKey: PINNED VECTOR — the derivation recipe must never silently change', async () => {
    const child = await Crypto.deriveChildKey(PARENT, ENTITY_KEY_DOMAIN, 'entity_0123456789abcdef');
    assert.equal(child, '371e815da8353f5c282970386ad62112b7471d3e468e52979120e4d71624bc81');
    assert.equal(Crypto.getPublicKey(child),
        'e33d5f6465e0182b3549ef75345ac0b5208a7aa37fe796057aac3f6d416885be');
});

test('deriveChildKey: deterministic; independent across info and domain', async () => {
    const a1 = await Crypto.deriveChildKey(PARENT, ENTITY_KEY_DOMAIN, 'entity_a');
    const a2 = await Crypto.deriveChildKey(PARENT, ENTITY_KEY_DOMAIN, 'entity_a');
    const b = await Crypto.deriveChildKey(PARENT, ENTITY_KEY_DOMAIN, 'entity_b');
    const otherDomain = await Crypto.deriveChildKey(PARENT, 'xray-entity-v2', 'entity_a');
    const otherParent = await Crypto.deriveChildKey('22'.repeat(32), ENTITY_KEY_DOMAIN, 'entity_a');
    assert.equal(a1, a2, 'same inputs ⇒ same child');
    assert.notEqual(a1, b, 'different entity ids ⇒ independent keys');
    assert.notEqual(a1, otherDomain, 'different domain ⇒ independent keys');
    assert.notEqual(a1, otherParent, 'different parent ⇒ independent keys');
    // Every derived key is a valid signing key.
    for (const k of [a1, b, otherDomain, otherParent]) Crypto.getPublicKey(k);
});

test('deriveChildKey: rejects a malformed parent key', async () => {
    await assert.rejects(() => Crypto.deriveChildKey('nope', ENTITY_KEY_DOMAIN, 'x'), /64 hex/);
});

// ---- entity lifecycle: derive on create, restore after keystore loss --

async function reset() {
    _store.clear();
    LocalKeyManager.keys.clear();
}

test('EntityModel.create derives the key from the primary; keystore loss is recoverable', async () => {
    await reset();
    await Storage.primaryIdentity.set(PARENT);
    const e = await EntityModel.create({ name: 'Test Person', type: 'person' });
    const key = LocalKeyManager.getKey(e.keyName);
    assert.ok(key, 'key installed');
    assert.equal(key.metadata.derived, true, 'stamped derived');
    const expected = await Crypto.deriveChildKey(PARENT, ENTITY_KEY_DOMAIN, e.id);
    assert.equal(key.privateKey, expected, 'key IS the derived child');
    const originalPubkey = key.pubkey;

    // Simulate keystore loss: wipe local_keys but keep the entity record.
    LocalKeyManager.keys.clear();
    _store.delete('local_keys');
    assert.equal(LocalKeyManager.getKey(e.keyName), null);

    const restored = await EntityModel.restoreDerivedKeys();
    assert.equal(restored.length, 1);
    assert.equal(restored[0].pubkey, originalPubkey, 'the SAME pubkey came back');
    assert.equal(LocalKeyManager.getKey(e.keyName).pubkey, originalPubkey);
});

test('EntityModel.create falls back to a random key without a primary identity', async () => {
    await reset();
    const e = await EntityModel.create({ name: 'Keyless Era', type: 'person' });
    const key = LocalKeyManager.getKey(e.keyName);
    assert.ok(key, 'key still created');
    assert.ok(!key.metadata.derived, 'legacy random path — not stamped derived');
});

test('restoreDerivedKeys never clobbers a present key and requires a primary', async () => {
    await reset();
    await Storage.primaryIdentity.set(PARENT);
    const e = await EntityModel.create({ name: 'Present Key', type: 'person' });
    const before = LocalKeyManager.getKey(e.keyName).privateKey;
    const restored = await EntityModel.restoreDerivedKeys();
    assert.equal(restored.length, 0, 'present keys are left alone');
    assert.equal(LocalKeyManager.getKey(e.keyName).privateKey, before);

    await Storage.primaryIdentity.clear();
    await assert.rejects(() => EntityModel.restoreDerivedKeys(), /no primary identity/);
});

test('installDerivedKey: idempotent on the same key, CONFLICT on a different one', async () => {
    await reset();
    const k1 = await Crypto.deriveChildKey(PARENT, ENTITY_KEY_DOMAIN, 'entity_x');
    const first = await LocalKeyManager.installDerivedKey('entity:entity_x', k1, {});
    const again = await LocalKeyManager.installDerivedKey('entity:entity_x', k1, {});
    assert.equal(first.pubkey, again.pubkey, 'idempotent');
    const k2 = await Crypto.deriveChildKey(PARENT, ENTITY_KEY_DOMAIN, 'entity_y');
    await assert.rejects(() => LocalKeyManager.installDerivedKey('entity:entity_x', k2, {}), /conflict/i);
});
