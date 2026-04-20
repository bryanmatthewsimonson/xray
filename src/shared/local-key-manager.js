// ============================================
// SECTION 12: LOCAL KEY MANAGER (Fallback)
// ============================================
//
// Storage-backed cache of entity keypairs, used when neither NIP-07
// nor NSecBunker is available. `signEvent` is a placeholder — actual
// signing still requires one of the real signing paths; this module
// exists primarily so the init sequence can stand up the cache and
// `Storage.keypairs` / UI code has a consistent Map to iterate.
//
// Ported verbatim from nostr-article-capture.user.js lines 5115–5190.
// Only change: declared as `var` so later content scripts in the
// isolated world can see it (module wasn't shipping in the initial
// port — it's the cause of the "LocalKeyManager is not defined"
// error that aborted init and prevented the FAB from appearing).

import { Storage } from './storage.js';
import { Utils } from './utils.js';
import { NostrCrypto } from './crypto.js';

export const LocalKeyManager = {
    // Store keys locally (encrypted with user password in future).
    // This is a fallback when NSecBunker is not available.

    keys: new Map(),

    // Initialize from storage
    init: async () => {
        const storedKeys = await Storage.get('local_keys', {});
        for (const [name, keyData] of Object.entries(storedKeys)) {
            LocalKeyManager.keys.set(name, keyData);
        }
        Utils.log('LocalKeyManager initialized with', LocalKeyManager.keys.size, 'keys');
    },

    // Create a new key
    createKey: async (name, metadata = {}) => {
        if (LocalKeyManager.keys.has(name)) {
            throw new Error('Key already exists: ' + name);
        }

        const privateKey = NostrCrypto.generatePrivateKey();
        // Note: In a real implementation, we'd derive pubkey using secp256k1
        // For now, store a placeholder and require NSecBunker for actual signing.
        const keyData = {
            name,
            privateKey,
            pubkey: null, // Would be derived from privateKey
            metadata,
            created: Math.floor(Date.now() / 1000)
        };

        LocalKeyManager.keys.set(name, keyData);
        await LocalKeyManager.save();

        Utils.log('Created local key:', name);
        return keyData;
    },

    // Get key by name
    getKey: (name) => {
        return LocalKeyManager.keys.get(name) || null;
    },

    // List all keys
    listKeys: () => {
        return Array.from(LocalKeyManager.keys.values());
    },

    // Delete a key
    deleteKey: async (name) => {
        LocalKeyManager.keys.delete(name);
        await LocalKeyManager.save();
    },

    // Save to storage
    save: async () => {
        const data = {};
        for (const [name, keyData] of LocalKeyManager.keys) {
            data[name] = keyData;
        }
        await Storage.set('local_keys', data);
    },

    // Sign event (requires secp256k1 — placeholder)
    signEvent: async (event, keyName) => {
        const key = LocalKeyManager.getKey(keyName);
        if (!key) {
            throw new Error('Key not found: ' + keyName);
        }

        // Placeholder — real signing requires secp256k1 library
        Utils.error('Local signing not implemented — use NSecBunker');
        throw new Error('Local signing requires secp256k1 library. Please use NSecBunker.');
    }
};
