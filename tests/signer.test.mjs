// Signer façade tests. Verifies the three signing branches dispatch to
// the right backend and that storage round-trips work for the local
// primary identity.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// chrome.storage.local shim — same pattern as entity-sync.test.mjs.
const _stateStore = new Map();
globalThis.chrome = {
    storage: {
        local: {
            get(keys, cb) {
                const out = {};
                const arr = keys === null ? Array.from(_stateStore.keys())
                    : Array.isArray(keys) ? keys : [keys];
                for (const k of arr) {
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
const { Crypto } = await import('../src/shared/crypto.js');
const { Signer } = await import('../src/shared/signer.js');

function resetStorage() {
    _stateStore.clear();
}

test('default signing method is local', async () => {
    resetStorage();
    await Storage.initialize();
    assert.equal(await Signer.getMethod(), 'local');
});

test('signing_method_configured starts false', async () => {
    resetStorage();
    await Storage.initialize();
    assert.equal(await Signer.isConfigured(), false);
});

test('migration sets signing_method=local on a profile that lacks it', async () => {
    resetStorage();
    // Pre-seed preferences without signing_method to simulate an upgrade.
    await Storage.set('preferences', {
        default_relays: ['wss://relay.damus.io'],
        media_handling: 'embed',
        theme: 'dark',
        debug: false
    });
    await Storage.initialize();
    const prefs = await Storage.get('preferences', {});
    assert.equal(prefs.signing_method, 'local');
    assert.equal(prefs.signing_method_configured, false);
});

test('local primaryIdentity.generate creates a key with matching pubkey', async () => {
    resetStorage();
    await Storage.initialize();
    const id = await Storage.primaryIdentity.generate();
    assert.match(id.privateKey, /^[0-9a-f]{64}$/);
    assert.equal(id.pubkey, Crypto.getPublicKey(id.privateKey));
    assert.ok(id.npub.startsWith('npub1'));
    assert.ok(id.nsec.startsWith('nsec1'));
    const stored = await Storage.primaryIdentity.get();
    assert.deepEqual(stored, id);
});

test('importNsec accepts nsec1 and 64-char hex', async () => {
    resetStorage();
    await Storage.initialize();
    const hex = '0000000000000000000000000000000000000000000000000000000000000001';
    const idFromHex = await Storage.primaryIdentity.importNsec(hex);
    assert.equal(idFromHex.privateKey, hex);

    resetStorage();
    await Storage.initialize();
    const nsec = Crypto.hexToNsec(hex);
    const idFromNsec = await Storage.primaryIdentity.importNsec(nsec);
    assert.equal(idFromNsec.privateKey, hex);
});

test('importNsec rejects garbage', async () => {
    resetStorage();
    await Storage.initialize();
    await assert.rejects(() => Storage.primaryIdentity.importNsec('not-a-key'));
});

test('Signer.signEvent (local) signs with the primary identity', async () => {
    resetStorage();
    await Storage.initialize();
    const id = await Storage.primaryIdentity.generate();
    // Mark configured so isReady passes.
    const prefs = await Storage.get('preferences', {});
    prefs.signing_method = 'local';
    prefs.signing_method_configured = true;
    await Storage.set('preferences', prefs);

    const event = {
        kind: 1,
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content: 'hello, world',
        pubkey: id.pubkey
    };
    const signed = await Signer.signEvent(event);
    assert.equal(signed.pubkey, id.pubkey);
    assert.match(signed.id, /^[0-9a-f]{64}$/);
    assert.match(signed.sig, /^[0-9a-f]{128}$/);
});

test('Signer.getPublicKey (local) returns the stored hex pubkey', async () => {
    resetStorage();
    await Storage.initialize();
    const id = await Storage.primaryIdentity.generate();
    const prefs = await Storage.get('preferences', {});
    prefs.signing_method = 'local';
    await Storage.set('preferences', prefs);
    assert.equal(await Signer.getPublicKey(), id.pubkey);
});

test('Signer routes nip07 calls to injected client', async () => {
    resetStorage();
    await Storage.initialize();
    const prefs = await Storage.get('preferences', {});
    prefs.signing_method = 'nip07';
    await Storage.set('preferences', prefs);

    const calls = [];
    const fakeNip07 = {
        probe: async () => true,
        getPublicKey: async () => { calls.push('getPublicKey'); return 'a'.repeat(64); },
        signEvent: async (e) => { calls.push('signEvent'); return { ...e, id: 'x', sig: 'y' }; }
    };
    Signer.configure({ nip07Client: fakeNip07 });
    assert.equal(await Signer.getPublicKey(), 'a'.repeat(64));
    const signed = await Signer.signEvent({ kind: 1 });
    assert.equal(signed.id, 'x');
    assert.deepEqual(calls, ['getPublicKey', 'signEvent']);
});

test('Signer routes nsecbunker calls to injected client', async () => {
    resetStorage();
    await Storage.initialize();
    const prefs = await Storage.get('preferences', {});
    prefs.signing_method = 'nsecbunker';
    prefs.nsecbunker_url = 'wss://bunker.example.com';
    await Storage.set('preferences', prefs);

    const calls = [];
    const fakeBunker = {
        connected: true,
        connect: async (url) => { calls.push(['connect', url]); fakeBunker.connected = true; },
        getPublicKey: async () => { calls.push('getPublicKey'); return 'b'.repeat(64); },
        signEvent: async (e, pubId) => { calls.push(['signEvent', pubId]); return { ...e, id: 'b', sig: 'c' }; }
    };
    Signer.configure({ nsecBunkerClient: fakeBunker });
    assert.equal(await Signer.getPublicKey(), 'b'.repeat(64));
    const signed = await Signer.signEvent({ kind: 1 });
    assert.equal(signed.id, 'b');
});

test('methodRequiresPageContext: only nip07 needs a web page', () => {
    // This predicate is the contract behind the capture→publish routing:
    // Local / NSecBunker sign in the service worker (no tab), so publishing
    // captures with no live page (imported EPUB chapters, transcript
    // imports, PDFs, portal reconstructions) must NOT route through a tab.
    assert.equal(Signer.methodRequiresPageContext('nip07'), true);
    assert.equal(Signer.methodRequiresPageContext('local'), false);
    assert.equal(Signer.methodRequiresPageContext('nsecbunker'), false);
    // Unknown / falsy methods are treated as not-needing a page (they fall
    // to the in-worker façade, never to a phantom tab).
    assert.equal(Signer.methodRequiresPageContext(undefined), false);
    assert.equal(Signer.methodRequiresPageContext('whatever'), false);
});

test('Signer.isReady is honest about local key presence', async () => {
    resetStorage();
    await Storage.initialize();
    const prefs = await Storage.get('preferences', {});
    prefs.signing_method = 'local';
    await Storage.set('preferences', prefs);
    assert.equal(await Signer.isReady(), false);
    await Storage.primaryIdentity.generate();
    assert.equal(await Signer.isReady(), true);
});

test('relays.set persists structured shape and syncs default_relays', async () => {
    resetStorage();
    await Storage.initialize();
    await Storage.relays.set([
        { url: 'wss://a.example', read: true, write: true, enabled: true },
        { url: 'wss://b.example', read: true, write: false, enabled: true },
        { url: 'wss://c.example', read: true, write: true, enabled: false }
    ]);
    const prefs = await Storage.get('preferences', {});
    assert.equal(prefs.relays.length, 3);
    // default_relays should contain only enabled+write URLs.
    assert.deepEqual(prefs.default_relays, ['wss://a.example']);
    const got = await Storage.relays.get();
    assert.equal(got.relays.length, 3);
});
