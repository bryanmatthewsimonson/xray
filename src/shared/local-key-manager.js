// Storage-backed cache of entity keypairs. With Phase 1's real crypto
// in place, this module now supports the full lifecycle: generate a
// keypair, derive its pubkey via secp256k1 point multiplication, sign
// events locally via BIP-340 Schnorr.
//
// Three signing paths coexist in X-Ray:
//   1. NIP-07 — keys live in the user's browser extension (nos2x, Alby).
//   2. NSecBunker — keys live in a remote signer; we talk to it over WS.
//   3. LocalKeyManager — keys live in chrome.storage.local on this device.
//
// Path 3 is the fallback for entity keypairs (Phase 4+) and tests. The
// user's primary identity should almost always come from path 1 or 2.

import { Storage } from './storage.js';
import { Utils } from './utils.js';
import { Crypto } from './crypto.js';

export const LocalKeyManager = {
    keys: new Map(),

    init: async () => {
        const storedKeys = await Storage.get('local_keys', {});
        for (const [name, keyData] of Object.entries(storedKeys)) {
            LocalKeyManager.keys.set(name, keyData);
        }
        Utils.log('LocalKeyManager initialized with', LocalKeyManager.keys.size, 'keys');
    },

    createKey: async (name, metadata = {}) => {
        if (LocalKeyManager.keys.has(name)) {
            throw new Error('Key already exists: ' + name);
        }

        const privateKey = Crypto.generatePrivateKey();
        const pubkey = Crypto.getPublicKey(privateKey); // real secp256k1 now
        const keyData = {
            name,
            privateKey,
            pubkey,
            npub: Crypto.hexToNpub(pubkey),
            nsec: Crypto.hexToNsec(privateKey),
            metadata,
            created: Math.floor(Date.now() / 1000)
        };

        LocalKeyManager.keys.set(name, keyData);
        await LocalKeyManager.save();

        Utils.log('Created local key:', name, keyData.npub);
        return keyData;
    },

    /**
     * Install a known private key under `name` (Phase 11.8 — case
     * collaboration bundles import collaborators' entity keys so
     * claims aggregate under the same pubkeys). Idempotent when the
     * same key is already installed; CONFLICT (throws) when a
     * different key occupies the name — never silently overwrite key
     * material.
     */
    importKey: async (name, privateKeyHex, metadata = {}) => {
        if (!/^[0-9a-f]{64}$/.test(String(privateKeyHex || ''))) {
            throw new Error('importKey: privateKey must be 64 hex chars');
        }
        const existing = LocalKeyManager.keys.get(name);
        if (existing) {
            if (existing.privateKey === privateKeyHex) return existing;   // idempotent
            throw new Error('Key conflict: a different key already exists for ' + name);
        }
        const pubkey = Crypto.getPublicKey(privateKeyHex);
        const keyData = {
            name,
            privateKey: privateKeyHex,
            pubkey,
            npub: Crypto.hexToNpub(pubkey),
            nsec: Crypto.hexToNsec(privateKeyHex),
            metadata: { ...metadata, imported: true },
            created: Math.floor(Date.now() / 1000)
        };
        LocalKeyManager.keys.set(name, keyData);
        await LocalKeyManager.save();
        Utils.log('Imported local key:', name, keyData.npub);
        return keyData;
    },

    /**
     * Install a DERIVED private key under `name` (Phase 24.1 — child
     * keys derived from the primary identity, so a lost keystore is
     * recoverable by re-derivation; docs/ENTITY_IDENTITY_DESIGN.md).
     * Same idempotence/CONFLICT semantics as importKey — never silently
     * overwrite key material — but stamped `derived: true` so the
     * restore path can tell recoverable keys from legacy random ones.
     */
    installDerivedKey: async (name, privateKeyHex, metadata = {}) => {
        if (!/^[0-9a-f]{64}$/.test(String(privateKeyHex || ''))) {
            throw new Error('installDerivedKey: privateKey must be 64 hex chars');
        }
        const existing = LocalKeyManager.keys.get(name);
        if (existing) {
            if (existing.privateKey === privateKeyHex) return existing;   // idempotent
            throw new Error('Key conflict: a different key already exists for ' + name);
        }
        const pubkey = Crypto.getPublicKey(privateKeyHex);
        const keyData = {
            name,
            privateKey: privateKeyHex,
            pubkey,
            npub: Crypto.hexToNpub(pubkey),
            nsec: Crypto.hexToNsec(privateKeyHex),
            metadata: { ...metadata, derived: true },
            created: Math.floor(Date.now() / 1000)
        };
        LocalKeyManager.keys.set(name, keyData);
        await LocalKeyManager.save();
        Utils.log('Installed derived key:', name, keyData.npub);
        return keyData;
    },

    getKey: (name) => LocalKeyManager.keys.get(name) || null,

    listKeys: () => Array.from(LocalKeyManager.keys.values()),

    deleteKey: async (name) => {
        LocalKeyManager.keys.delete(name);
        await LocalKeyManager.save();
    },

    save: async () => {
        const data = {};
        for (const [name, keyData] of LocalKeyManager.keys) {
            data[name] = keyData;
        }
        await Storage.set('local_keys', data);
    },

    // BIP-340 Schnorr sign an unsigned event with a locally-stored key.
    // Returns an event with `id` + `sig` filled in, ready to publish.
    signEvent: async (event, keyName) => {
        const key = LocalKeyManager.getKey(keyName);
        if (!key) throw new Error('Key not found: ' + keyName);
        if (!key.privateKey) throw new Error('Key has no private key material: ' + keyName);

        // If the caller hasn't set pubkey on the event, fill it from the
        // stored key. This matches the behavior of NIP-07 signers.
        if (!event.pubkey) event.pubkey = key.pubkey;

        return await Crypto.signEvent(event, key.privateKey);
    }
};
