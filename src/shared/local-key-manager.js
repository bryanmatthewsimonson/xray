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
// So, four rules:
//   1. Every write is a read-modify-write of FRESH storage that applies
//      exactly its own change (add/replace one name, delete one name,
//      upsert a set) — never a dump of this page's Map. The pre-fix
//      whole-Map save() let one tab erase every key another tab made
//      after both loaded; save() is gone for that reason (an add-only
//      merge would still resurrect a key another page just deleted).
//      A read that FAILS aborts the write (Storage.getStrict): writing
//      back "{ my key }" over an unreadable store would erase the rest.
//   2. Writers serialize on the Web Lock `xray.local_keys`. That
//      includes the wholesale writers outside this module — the
//      replace-all backup restore and the workspace reset / removal —
//      through `withKeyStoreLock`. Web Locks are NOT re-entrant: no
//      locked section here calls another locked method, and nobody may
//      call into this module's writers while holding the lock.
//   3. Nothing locked runs outside an extension origin. A lock is
//      scoped to the origin of the document that requests it: in an
//      extension page or the service worker that is the extension's
//      own origin, but in a content script it is the WEB PAGE's, whose
//      script could hold the same name. Content scripts hold no
//      keystore (JOURNAL 2026-09-24, THREAT_MODEL G10).
//   4. The Map is written ONLY by the refresh loop, which always ends on
//      a read that started after the latest request. init() is a true
//      refresh (clear + load) and attaches one change listener per
//      module instance; every change event and every finished write
//      requests a refresh, so a page's Map converges on storage after
//      other pages' writes, raw restores, resets and workspace switches.
// A page's Map is replaced in place (clear/set) — callers and tests
// hold references to LocalKeyManager.keys. Rules 1–3 also serve the entity
// registry (JOURNAL 2026-09-25): each store's ONE lock is fixed in STORE_LOCKS,
// and the only nesting is keystore → registry, in the wholesale writers.

import { Storage } from './storage.js';
import { Utils } from './utils.js';
import { Crypto } from './crypto.js';
import { StoreRefusedError } from './workspace-keys.js';

const STORE_KEY = 'local_keys';
// Deliberately NOT `xray:…`: that prefix is the message-bus namespace,
// and structure-guard rule 4 holds every `xray:` literal in src/ to the
// closed message registry. A lock name is neither a message nor a
// storage key. It is shared by everything running in the REQUESTING
// document's origin — which is why rule 3 above exists.
const LOCK_NAME = 'xray.local_keys';
export const STORE_LOCKS = Object.freeze({ [STORE_KEY]: LOCK_NAME, entities: 'xray.entities' });
const EXTENSION_PROTOCOLS = new Set(['chrome-extension:', 'moz-extension:']);
const HEX64 = /^[0-9a-f]{64}$/;

let refreshWanted = false;  // a refresh was requested since the loop's last read began
let refreshLoop = null;     // the running refresh loop, if any
let mapWorkspace;           // the workspace the Map was loaded from (a strict pointer read)
let watching = false;       // one change listener per module instance

// Rule 3. No location at all (Node's test runner) passes; any location
// that is not an extension page or worker is refused before a lock is
// requested.
function assertExtensionOrigin(what) {
    const loc = globalThis.location;
    if (loc === undefined || loc === null) return;
    const protocol = String(loc.protocol || '');
    if (!EXTENSION_PROTOCOLS.has(protocol)) {
        throw new StoreRefusedError(`${what} is written only from extension pages — refused under a ${protocol || 'non-extension'} origin`);
    }
}

// Rules 2–3. Without navigator.locks (Node's tests) the fallback slot is on
// globalThis, so two module instances — the tests' "two pages" — share it.
export async function withStoreLock(name, fn, what = 'LocalKeyManager: the keystore') {
    if (!Object.values(STORE_LOCKS).includes(name)) throw new Error(`withStoreLock: ${name} is not a store lock`);
    assertExtensionOrigin(what);
    const locks = (typeof navigator !== 'undefined' && navigator && navigator.locks
        && typeof navigator.locks.request === 'function') ? navigator.locks : null;
    if (locks) return locks.request(name, () => fn());
    const slot = Symbol.for(`${name}.mutex`);
    const tail = globalThis[slot] || Promise.resolve();
    const run = tail.then(() => fn());
    globalThis[slot] = run.then(() => undefined, () => undefined);
    return run;
}

/**
 * Run `fn` holding the keystore lock — for the few writers OUTSIDE this
 * module that replace or clear `local_keys` wholesale (the replace-all
 * backup restore, the workspace reset, the workspace removal), so a key
 * write in flight on another page cannot land after them and undo
 * them. Same refusal outside an extension origin as every write. NOT
 * re-entrant: `fn` must never call a LocalKeyManager writer (it would
 * wait on itself forever).
 */
export function withKeyStoreLock(fn) {
    return withStoreLock(LOCK_NAME, fn);
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
    const map = LocalKeyManager.keys;
    map.clear();
    for (const [name, keyData] of Object.entries(stored)) {
        if (keyData) map.set(name, keyData);
    }
}

// Rule 4 — reload the Map from storage. ONE loop per module instance:
// a request made while a read is in flight marks the loop dirty and it
// reads again afterwards, so the Map always ends on a read that STARTED
// after the latest request, and `await init()` / `await refresh()` still
// mean "the Map now reflects storage". Nothing else writes the Map, so
// no newer read can be dropped or overwritten by an older view. (The
// pre-hardening write path installed what IT wrote and dropped any
// listener refresh in flight — which, after an unlocked change such as
// a workspace switch, had read NEWER state and was never retried.)
// A read that fails keeps the last good Map: an empty one would make
// every key look missing.
function refresh() {
    refreshWanted = true;
    if (!refreshLoop) {
        refreshLoop = (async () => {
            try {
                while (refreshWanted) {
                    refreshWanted = false;
                    let stored, ws;
                    try {
                        ws = await Storage.activeWorkspaceId({ strict: true });
                        stored = await Storage.getStrict(STORE_KEY, {}, { workspace: ws });
                    } catch (err) {
                        Utils.error('LocalKeyManager: reading local_keys failed — keeping the keys loaded before:', err);
                        continue;
                    }
                    replaceMap(isPlainObject(stored) ? stored : {});
                    mapWorkspace = ws;
                }
            } finally {
                refreshLoop = null;
            }
        })();
    }
    return refreshLoop;
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

/** A StoreRefusedError for `label`; a nested one (a failed pointer read) keeps its own text. */
export const storeRefusal = (label, why, err) => new StoreRefusedError(`${label}: ${err && err.name === 'StoreRefusedError'
    ? err.message : `${why} — nothing written${err ? ` (${err.message || err})` : ''}`}`);

// The one write path. Under the lock: read local_keys FRESH, let
// `apply` change exactly its own names on that object, and write it
// back (only when `apply` says so). After the lock is released the
// page's Map is refreshed from storage (rule 4) — never set to what
// this write produced, because an unlocked change (another page's
// workspace switch, say) can land between the write and that install.
// `apply` must be synchronous and must not call back into this module
// (the lock is not re-entrant). Serves every STORE_LOCKS key.
//
// The read is STRICT: an unreadable store aborts the write instead of
// being read as empty (rule 1) — so does an unreadable pointer (never cached).
//
// The write names the workspace the read resolved, so it can never
// carry one workspace's keys into another; and if the pointer moved
// meanwhile the whole read-modify-write is redone in the new one.
export async function lockedReadModifyWrite({ key, label, what, apply }) {
    if (!Object.hasOwn(STORE_LOCKS, key)) throw new Error(`lockedReadModifyWrite: no lock is fixed for ${key}`);
    return withStoreLock(STORE_LOCKS[key], async () => {
        for (let attempt = 1; ; attempt++) {
            let ws, raw;
            try {
                ws = await Storage.activeWorkspaceId({ strict: true });
                raw = await Storage.getStrict(key, {}, { workspace: ws });
            } catch (err) {
                throw storeRefusal(label, `reading ${key} failed`, err);
            }
            if (!isPlainObject(raw)) throw storeRefusal(label, `stored ${key} is not an object — refusing to overwrite it`);
            const stored = { ...raw };
            const { write, result: out } = apply(stored);
            if (await Storage.activeWorkspaceId({ strict: true }) !== ws) {   // an unreadable pointer rejects
                if (attempt < 3) continue;
                throw storeRefusal(label, 'the workspace kept changing during a write');
            }
            if (write) {
                const ok = await Storage.set(key, stored, { workspace: ws });
                if (ok === false) throw storeRefusal(label, `writing ${key} failed`);
            }
            return out;
        }
    }, what);
}

async function mutate(apply) {
    const result = await lockedReadModifyWrite({ key: STORE_KEY, label: 'LocalKeyManager', apply });
    await refresh();
    return result;
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
    /** For a record read through the PLAIN pointer: null unless the Map is `workspace`'s (JOURNAL 2026-09-25). */
    getKeyIn: (name, workspace) => (workspace === mapWorkspace ? LocalKeyManager.getKey(name) : null),

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
        const key = LocalKeyManager.getKeyIn(keyName, await Storage.activeWorkspaceId());
        if (!key) throw new Error('Key not found: ' + keyName);
        if (!key.privateKey) throw new Error('Key has no private key material: ' + keyName);

        // If the caller hasn't set pubkey on the event, fill it from the
        // stored key. This matches the behavior of NIP-07 signers.
        if (!event.pubkey) event.pubkey = key.pubkey;

        return await Crypto.signEvent(event, key.privateKey);
    }
};
