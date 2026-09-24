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
//
// ONE STORE, MANY PAGES (JOURNAL 2026-09-24). Every extension page —
// each reader tab, the side panel, the portal, options — holds its own
// module instance and its own `keys` Map over the ONE stored
// `local_keys` value (workspace-mapped by Storage). The stored value is
// the truth; the Map is a read cache for getKey/listKeys/signEvent.
// So, three rules:
//   1. Every write is a read-modify-write of FRESH storage that applies
//      exactly its own change (add/replace one name, delete one name,
//      upsert a set) — never a dump of this page's Map. The pre-fix
//      whole-Map save() let one tab erase every key another tab made
//      after both loaded; save() is gone for that reason (an add-only
//      merge would still resurrect a key another page just deleted).
//   2. Writers serialize on the Web Lock `xray.local_keys` (all writers
//      are same-origin extension pages). Web Locks are NOT re-entrant:
//      no locked section here calls another locked method, and callers
//      must never hold the lock across a call into this module.
//   3. init() is a true refresh (clear + load) and attaches one change
//      listener per module instance, so a page's Map follows other
//      pages' writes, raw restores, resets and workspace switches.
// A page's Map is replaced in place (clear/set) — callers and tests
// hold references to LocalKeyManager.keys.

import { Storage } from './storage.js';
import { Utils } from './utils.js';
import { Crypto } from './crypto.js';

const STORE_KEY = 'local_keys';
// Deliberately NOT `xray:…`: that prefix is the message-bus namespace,
// and structure-guard rule 4 holds every `xray:` literal in src/ to the
// closed message registry. A lock name is neither a message nor a
// storage key. (Lock names are origin-scoped: only this extension's
// pages and worker share it.)
const LOCK_NAME = 'xray.local_keys';
// Fallback mutex slot for contexts without navigator.locks (Node's test
// runner). On globalThis, not in module scope, so two module instances
// in one realm — the tests' "two pages" — share it.
const FALLBACK_MUTEX = Symbol.for('xray.local_keys.mutex');
const HEX64 = /^[0-9a-f]{64}$/;

let generation = 0;         // bumps on every Map replacement; stale reads lose
let pendingRefresh = null;  // the newest in-flight refresh
let watching = false;       // one change listener per module instance

function withKeysLock(fn) {
    const locks = (typeof navigator !== 'undefined' && navigator && navigator.locks
        && typeof navigator.locks.request === 'function') ? navigator.locks : null;
    if (locks) return locks.request(LOCK_NAME, () => fn());
    const tail = globalThis[FALLBACK_MUTEX] || Promise.resolve();
    const run = tail.then(() => fn());
    globalThis[FALLBACK_MUTEX] = run.then(() => undefined, () => undefined);
    return run;
}

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

function assertName(name) {
    if (typeof name !== 'string' || !name || name === '__proto__') {
        throw new Error('LocalKeyManager: key name must be a non-empty string');
    }
}

function buildKeyData(name, privateKeyHex, metadata, created) {
    const pubkey = Crypto.getPublicKey(privateKeyHex);
    return {
        name,
        privateKey: privateKeyHex,
        pubkey,
        npub: Crypto.hexToNpub(pubkey),
        nsec: Crypto.hexToNsec(privateKeyHex),
        metadata,
        created: Number.isFinite(created) ? Math.floor(created) : Math.floor(Date.now() / 1000)
    };
}

function replaceMap(stored) {
    generation++;
    const map = LocalKeyManager.keys;
    map.clear();
    for (const [name, keyData] of Object.entries(stored)) {
        if (keyData) map.set(name, keyData);
    }
}

// Reload the Map from storage. A read that another refresh or a write
// superseded is dropped (it may predate that newer state); the caller
// then waits for the newest refresh so `await init()` still means
// "the Map now reflects storage".
function refresh() {
    const gen = ++generation;
    const run = (async () => {
        const stored = await Storage.get(STORE_KEY, {});
        if (gen === generation) {
            replaceMap(isPlainObject(stored) ? stored : {});
        } else if (pendingRefresh && pendingRefresh !== run) {
            await pendingRefresh;
        }
    })();
    pendingRefresh = run;
    return run;
}

// Any workspace's local_keys (the bare default key or `ws:<id>:local_keys`)
// or the workspace pointer. Matching every namespace instead of only the
// mapped one costs at most a spurious re-read.
function touchesKeystore(changes) {
    for (const k of Object.keys(changes || {})) {
        if (k === STORE_KEY || k === 'active_workspace'
            || (k.startsWith('ws:') && k.endsWith(':' + STORE_KEY))) return true;
    }
    return false;
}

// Listen on the SAME storage area's onChanged that storage.js uses for
// its workspace-pointer cache. storage.js registers at module load, so
// on a workspace switch its cache is invalidated before this listener
// re-reads through it (same event, listeners run in registration order).
// Falls back to chrome.storage.onChanged; no event API at all (a bare
// test stub) just means no live refresh — writes stay correct regardless.
function watchStorage() {
    if (watching) return;
    try {
        const api = (typeof browser !== 'undefined' && browser.storage) ? browser.storage
            : (typeof chrome !== 'undefined' && chrome.storage) ? chrome.storage : null;
        const onAreaChanged = api && api.local && api.local.onChanged;
        const onAnyChanged = api && api.onChanged;
        const handler = (changes) => {
            if (!touchesKeystore(changes)) return;
            refresh().catch((err) => Utils.error('LocalKeyManager refresh failed:', err));
        };
        if (onAreaChanged && typeof onAreaChanged.addListener === 'function') {
            onAreaChanged.addListener(handler);
            watching = true;
        } else if (onAnyChanged && typeof onAnyChanged.addListener === 'function') {
            onAnyChanged.addListener((changes, areaName) => {
                if (!areaName || areaName === 'local') handler(changes);
            });
            watching = true;
        }
    } catch (_) { /* no change events here — init() still loads */ }
}

// The one write path. Under the lock: read local_keys FRESH, let
// `apply` change exactly its own names on that object, write it back
// (only when `apply` says so), then make this page's Map what storage
// now holds. `apply` must be synchronous and must not call back into
// this module (the lock is not re-entrant).
//
// Storage maps the key per call, so a workspace switch landing between
// the read and the write would carry one workspace's keys into the
// other. The pointer is re-checked right before the write (no event can
// run between that check and the write's own mapping) and the whole
// read-modify-write is redone if it moved.
function mutate(apply) {
    return withKeysLock(async () => {
        for (let attempt = 1; ; attempt++) {
            const ws = await Storage.activeWorkspaceId();
            const raw = await Storage.get(STORE_KEY, {});
            if (!isPlainObject(raw)) {
                throw new Error('LocalKeyManager: stored local_keys is not an object — refusing to overwrite it');
            }
            const stored = { ...raw };
            const { write, result } = apply(stored);
            if (await Storage.activeWorkspaceId() !== ws) {
                if (attempt < 3) continue;
                throw new Error('LocalKeyManager: the workspace kept changing during a key write — nothing written');
            }
            if (write) {
                const ok = await Storage.set(STORE_KEY, stored);
                if (ok === false) throw new Error('LocalKeyManager: writing local_keys failed');
            }
            replaceMap(stored);
            return result;
        }
    });
}

// importKey / installDerivedKey: add under a free name, idempotent for
// identical material, CONFLICT for different material — judged against
// the FRESH store, never this page's possibly-stale Map.
function addIfAbsent(name, keyData, label) {
    return mutate((stored) => {
        const existing = stored[name];
        if (existing) {
            if (existing.privateKey === keyData.privateKey) return { write: false, result: existing };   // idempotent
            throw new Error('Key conflict: a different key already exists for ' + name);
        }
        stored[name] = keyData;
        Utils.log(label, name, keyData.npub);
        return { write: true, result: keyData };
    });
}

export const LocalKeyManager = {
    keys: new Map(),

    /**
     * Load (or reload) this page's Map from storage and start following
     * storage changes. Safe to call repeatedly: every call is a full
     * refresh, and the change listener attaches once per instance.
     */
    init: async () => {
        watchStorage();
        await refresh();
        Utils.log('LocalKeyManager initialized with', LocalKeyManager.keys.size, 'keys');
    },

    /** Reload the Map from storage without attaching the listener. */
    refresh: () => refresh(),

    createKey: async (name, metadata = {}) => {
        assertName(name);
        const keyData = buildKeyData(name, Crypto.generatePrivateKey(), metadata);
        return mutate((stored) => {
            if (stored[name]) throw new Error('Key already exists: ' + name);
            stored[name] = keyData;
            Utils.log('Created local key:', name, keyData.npub);
            return { write: true, result: keyData };
        });
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
        if (!HEX64.test(String(privateKeyHex || ''))) {
            throw new Error('importKey: privateKey must be 64 hex chars');
        }
        assertName(name);
        const keyData = buildKeyData(name, privateKeyHex, { ...metadata, imported: true });
        return addIfAbsent(name, keyData, 'Imported local key:');
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
        if (!HEX64.test(String(privateKeyHex || ''))) {
            throw new Error('installDerivedKey: privateKey must be 64 hex chars');
        }
        assertName(name);
        const keyData = buildKeyData(name, privateKeyHex, { ...metadata, derived: true });
        return addIfAbsent(name, keyData, 'Installed derived key:');
    },

    /**
     * The EXPLICIT overwrite path: install each `{ name, privateKey,
     * metadata?, created? }`, REPLACING whatever key that name holds.
     * Only for callers whose job is to overwrite — the entity-sync pull
     * (a fresher pulled record's key wins for its name) and the side
     * panel's `xray:user` reinstall. Every other name in storage is
     * kept. pubkey/npub/nsec are derived from the private key, never
     * taken from the caller. Every entry is validated before anything
     * is written: one bad entry writes nothing.
     */
    upsertKeys: async (entries) => {
        const list = Array.isArray(entries) ? entries : [];
        const built = list.map((e) => {
            const hex = String((e && e.privateKey) || '').toLowerCase();
            if (!HEX64.test(hex)) throw new Error('upsertKeys: privateKey must be 64 hex chars');
            assertName(e.name);
            return buildKeyData(e.name, hex, { ...(e.metadata || {}) }, e.created);
        });
        if (built.length === 0) return [];
        return mutate((stored) => {
            for (const keyData of built) stored[keyData.name] = keyData;
            Utils.log('Upserted local keys:', built.map((k) => k.name).join(', '));
            return { write: true, result: built };
        });
    },

    getKey: (name) => LocalKeyManager.keys.get(name) || null,

    listKeys: () => Array.from(LocalKeyManager.keys.values()),

    /** Delete one name from storage; every other name is kept. */
    deleteKey: async (name) => mutate((stored) => {
        if (!Object.prototype.hasOwnProperty.call(stored, name)) return { write: false };
        delete stored[name];
        return { write: true };
    }),

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
