// The entity keystore under concurrent pages — JOURNAL 2026-09-24.
//
// LocalKeyManager keeps private keys in a per-page in-memory Map. Before
// this fix every write ended in save(), which wrote the page's WHOLE Map
// over the stored `local_keys`, and nothing refreshed a page's Map when
// another page changed the store: with two reader tabs open, tagging a
// new entity in each left only the second key (the first entity silently
// became unsignable). Same bug, more faces: a page loaded in workspace A
// that saved after a switch to B copied A's keys into B; the entity-sync
// pull wrote a whole-Map save AND a whole-registry `entities` snapshot
// read before its decrypt loop; restoreDerivedKeys judged "present" from
// an empty Map and re-keyed entities whose keys were in storage.
//
// Each test models two extension PAGES as two module instances of
// local-key-manager.js (a query string gives a second instance) over one
// chrome.storage stub. Instance A is the plain import — the one
// entity-model.js and entity-sync.js bind to; B is "the other tab".
// Both share storage.js (dependencies resolve without the query).
//
// The stub is asynchronous like the real API (callbacks on a later
// turn), and it DELIVERS onChanged events — to chrome.storage.local.
// onChanged (storage.js's workspace-cache listener registers there) and
// to chrome.storage.onChanged — so the refresh path is observable.
// `muteEvents()` withholds events, modelling "the other tab's change
// has not reached this page yet": every read-modify-write must be
// correct WITHOUT the listener.
//
// Key material: only the BIP-340 vector keys TV1/TV2/TV3 appear here
// (tests/tools/fixture-keys.mjs), plus keys the code generates or
// derives at test time. Comparisons never print a key value.
//
// Provenance: INTERPRETATION (2026-09-24) — an agent artifact; the
// maintainer has not ruled on it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

await import('fake-indexeddb/auto');

// ---- chrome.storage stub with change events --------------------------
const _store = new Map();
const _areaListeners = [];     // chrome.storage.local.onChanged
const _globalListeners = [];   // chrome.storage.onChanged
let _muted = false;
const later = (fn) => setImmediate(fn);

function emit(changes) {
    if (_muted || Object.keys(changes).length === 0) return;
    later(() => {
        for (const l of [..._areaListeners]) l(changes);
        for (const l of [..._globalListeners]) l(changes, 'local');
    });
}

const localArea = {
    get(keys, cb) {
        let out;
        if (keys === null) out = Object.fromEntries(_store);
        else {
            out = {};
            for (const k of Array.isArray(keys) ? keys : [keys]) {
                if (_store.has(k)) out[k] = _store.get(k);
            }
        }
        later(() => cb(out));
    },
    set(obj, cb) {
        const changes = {};
        for (const [k, v] of Object.entries(obj)) {
            changes[k] = { oldValue: _store.get(k), newValue: v };
            _store.set(k, v);
        }
        later(() => cb && cb());
        emit(changes);
    },
    remove(keys, cb) {
        const changes = {};
        for (const k of Array.isArray(keys) ? keys : [keys]) {
            if (_store.has(k)) changes[k] = { oldValue: _store.get(k), newValue: undefined };
            _store.delete(k);
        }
        later(() => cb && cb());
        emit(changes);
    },
    onChanged: { addListener(fn) { _areaListeners.push(fn); } }
};
globalThis.chrome = {
    storage: {
        local: localArea,
        onChanged: { addListener(fn) { _globalListeners.push(fn); } }
    }
};

const { Storage } = await import('../src/shared/storage.js');
const { Crypto } = await import('../src/shared/crypto.js');
const { LocalKeyManager: A } = await import('../src/shared/local-key-manager.js');
const { LocalKeyManager: B } = await import('../src/shared/local-key-manager.js?page=B');
const { EntityModel, ENTITY_KEY_DOMAIN } = await import('../src/shared/entity-model.js');
const { pullEntities, serializeEntityForSync } = await import('../src/shared/entity-sync.js');
const { NostrClient } = await import('../src/shared/nostr-client.js');
const { TV1, TV2, TV3, FIXED_TIME_S } = await import('./tools/fixture-keys.mjs');

// ---- helpers ------------------------------------------------------------
const settle = () => new Promise((r) => setTimeout(r, 15));
const muteEvents = () => { _muted = true; };
const listenerCount = () => _areaListeners.length + _globalListeners.length;

function readJson(rawKey) {
    const raw = _store.get(rawKey);
    if (raw === undefined || raw === null) return {};
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
}
const storedKeys = (rawKey = 'local_keys') => readJson(rawKey);
const storedNames = (rawKey = 'local_keys') => Object.keys(storedKeys(rawKey)).sort();

function keyRecord(name, tv, metadata = {}) {
    return {
        name, privateKey: tv.privateKey, pubkey: tv.pubkey, npub: tv.npub, nsec: tv.nsec,
        metadata, created: FIXED_TIME_S
    };
}
/** Silent seed: data that was already there when the pages loaded. */
function seedKeys(obj, rawKey = 'local_keys') { _store.set(rawKey, JSON.stringify(obj)); }
function seedEntities(obj) { _store.set('entities', JSON.stringify(obj)); }

function samePriv(rawKeyOrObj, name, tv, msg) {
    const obj = typeof rawKeyOrObj === 'string' ? storedKeys(rawKeyOrObj) : rawKeyOrObj;
    const rec = obj[name];
    assert.ok(rec, `${msg}: ${name} is present`);
    assert.ok(rec.privateKey === tv.privateKey, `${msg}: ${name} holds the expected key material (value not printed)`);
}

async function reset() {
    await settle();
    _muted = false;
    await Storage.setActiveWorkspaceId('default');
    await settle();
    _store.clear();
    A.keys.clear();
    B.keys.clear();
}

function withTimeout(p, ms, label) {
    let t;
    return Promise.race([
        p.finally(() => clearTimeout(t)),
        new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${label}: timed out after ${ms}ms (deadlock?)`)), ms); })
    ]);
}

test('sanity: two module instances are two pages over one store', () => {
    assert.notEqual(A, B, 'distinct LocalKeyManager objects');
    assert.notEqual(A.keys, B.keys, 'distinct in-memory maps');
});

// ---- the headline bug ---------------------------------------------------

test('two pages add/add: both keys survive (the two-reader-tab repro)', async () => {
    await reset();
    await A.init();
    await B.init();
    await A.installDerivedKey('entity:a', TV2.privateKey, {});
    await B.installDerivedKey('entity:b', TV3.privateKey, {});
    assert.deepEqual(storedNames(), ['entity:a', 'entity:b'], 'page B\'s write kept page A\'s key');
    samePriv('local_keys', 'entity:a', TV2, 'A\'s key');
    samePriv('local_keys', 'entity:b', TV3, 'B\'s key');
});

test('two pages add/add with change events withheld: the write itself merges, and refreshes the writer\'s map', async () => {
    await reset();
    await A.init();
    await B.init();
    muteEvents();
    await B.installDerivedKey('entity:b', TV3.privateKey, {});
    await A.installDerivedKey('entity:a', TV2.privateKey, {});
    assert.deepEqual(storedNames(), ['entity:a', 'entity:b']);
    assert.ok(A.getKey('entity:b'), 'A\'s map now holds B\'s key — refreshed from what A wrote');
    assert.ok(A.getKey('entity:b').pubkey === TV3.pubkey, 'B\'s key material, as stored (value not printed)');
});

test('add, then the other page deletes a DIFFERENT key: the add survives, the delete is not resurrected', async () => {
    await reset();
    seedKeys({ 'entity:old': keyRecord('entity:old', TV1) });
    await A.init();
    await B.init();
    muteEvents();   // A keeps a stale map that still lists entity:old
    await A.installDerivedKey('entity:a', TV2.privateKey, {});
    await B.deleteKey('entity:old');
    assert.deepEqual(storedNames(), ['entity:a'], 'B\'s delete removed only entity:old');
    await A.importKey('entity:c', TV3.privateKey, {});
    assert.deepEqual(storedNames(), ['entity:a', 'entity:c'], 'A\'s next write did not resurrect entity:old');
    assert.ok(A.getKey('entity:old') === null, 'A\'s map dropped the deleted key (value not printed)');
});

test('concurrent writes from two pages (Promise.all): every key is kept', async () => {
    await reset();
    await A.init();
    await B.init();
    await Promise.all([
        A.installDerivedKey('entity:a', TV1.privateKey, {}),
        B.installDerivedKey('entity:b', TV2.privateKey, {}),
        A.importKey('entity:c', TV3.privateKey, {}),
        B.createKey('entity:d', {}),
        A.createKey('entity:e', {})
    ]);
    assert.deepEqual(storedNames(), ['entity:a', 'entity:b', 'entity:c', 'entity:d', 'entity:e']);
    await settle();
    assert.deepEqual([...A.keys.keys()].sort(), storedNames(), 'A\'s map converges on storage');
    assert.deepEqual([...B.keys.keys()].sort(), storedNames(), 'B\'s map converges on storage');
});

test('a stale page never overwrites DIFFERENT material another page stored under a name', async () => {
    await reset();
    await A.init();
    await B.init();
    muteEvents();
    await B.installDerivedKey('entity:x', TV2.privateKey, {});
    const before = _store.get('local_keys');
    await assert.rejects(() => A.installDerivedKey('entity:x', TV3.privateKey, {}), /conflict/i);
    await assert.rejects(() => A.importKey('entity:x', TV3.privateKey, {}), /conflict/i);
    await assert.rejects(() => A.createKey('entity:x', {}), /already exists/i);
    assert.ok(_store.get('local_keys') === before, 'storage is byte-for-byte unchanged by the refused writes');
    samePriv('local_keys', 'entity:x', TV2, 'the first writer\'s key');

    // Identical material stays idempotent against the FRESH store.
    const again = await A.installDerivedKey('entity:x', TV2.privateKey, {});
    assert.ok(again.pubkey === TV2.pubkey, 'idempotent install returns the stored key (value not printed)');
    assert.ok(A.getKey('entity:x'), 'and A\'s map now holds it');
});

test('importKey across pages (case-bundle import in two tabs): keys from both survive, conflicts refuse', async () => {
    await reset();
    await A.init();
    await B.init();
    muteEvents();
    await B.importKey('entity:i', TV3.privateKey, { entityId: 'i' });
    await A.importKey('entity:j', TV2.privateKey, { entityId: 'j' });
    assert.deepEqual(storedNames(), ['entity:i', 'entity:j']);
    await assert.rejects(() => A.importKey('entity:i', TV2.privateKey, {}), /conflict/i);
    const same = await A.importKey('entity:i', TV3.privateKey, {});
    assert.ok(same.pubkey === TV3.pubkey, 'same material is idempotent (value not printed)');
    assert.equal(storedKeys()['entity:i'].metadata.imported, true, 'the stored record keeps its import stamp');
});

// ---- the explicit overwrite API -----------------------------------------

test('upsertKeys: the side panel\'s xray:user REINSTALL replaces that name and keeps every other key', async () => {
    await reset();
    seedKeys({
        'xray:user': keyRecord('xray:user', TV2, { role: 'user-primary' }),
        'entity:e': keyRecord('entity:e', TV3)
    });
    await A.init();
    await B.init();
    muteEvents();
    await B.createKey('entity:new', {});   // A's map does not know this one
    await A.upsertKeys([{
        name: 'xray:user', privateKey: TV1.privateKey,
        metadata: { role: 'user-primary', source: 'sync-setup' }
    }]);
    const s = storedKeys();
    assert.deepEqual(Object.keys(s).sort(), ['entity:e', 'entity:new', 'xray:user']);
    samePriv(s, 'xray:user', TV1, 'the reinstalled identity');
    assert.ok(s['xray:user'].pubkey === TV1.pubkey && s['xray:user'].npub === TV1.npub,
        'pubkey/npub are derived from the installed private key (values not printed)');
    assert.equal(s['xray:user'].metadata.source, 'sync-setup');
    samePriv(s, 'entity:e', TV3, 'an untouched entity key');
    assert.ok(A.getKey('xray:user').pubkey === TV1.pubkey, 'A\'s map holds the new identity (value not printed)');

    // Invalid material refuses BEFORE anything is written.
    const before = _store.get('local_keys');
    await assert.rejects(() => A.upsertKeys([
        { name: 'entity:ok', privateKey: TV2.privateKey },
        { name: 'entity:bad', privateKey: 'not-a-key' }
    ]), /64 hex/);
    assert.ok(_store.get('local_keys') === before, 'a batch with one bad entry writes nothing');
});

// ---- the refresh path ---------------------------------------------------

test('init() is a TRUE refresh: it drops a key deleted elsewhere and keeps the same Map object', async () => {
    await reset();
    seedKeys({ 'entity:a': keyRecord('entity:a', TV1), 'entity:b': keyRecord('entity:b', TV2) });
    await A.init();
    await B.init();
    muteEvents();
    await B.deleteKey('entity:a');
    const ref = A.keys;
    assert.ok(A.getKey('entity:a'), 'precondition: A\'s map is stale');
    await A.init();
    assert.ok(A.getKey('entity:a') === null, 'init() cleared the key another page deleted (value not printed)');
    assert.ok(A.getKey('entity:b'), 'and reloaded the rest');
    assert.ok(A.keys === ref, 'the Map is mutated in place — callers holding LocalKeyManager.keys stay current');
});

test('a storage change refreshes the map without init(): another page\'s write, a raw restore, a raw removal', async () => {
    await reset();
    await A.init();
    await B.installDerivedKey('entity:b', TV3.privateKey, {});
    await settle();
    assert.ok(A.getKey('entity:b'), 'A sees B\'s new key via the change listener');

    // A backup restore writes local_keys raw, bypassing LocalKeyManager.
    await new Promise((r) => chrome.storage.local.set({
        local_keys: JSON.stringify({ 'entity:r': keyRecord('entity:r', TV1) })
    }, r));
    await settle();
    assert.deepEqual([...A.keys.keys()], ['entity:r'], 'the raw restore replaced A\'s map');

    // A workspace reset removes the key outright.
    await new Promise((r) => chrome.storage.local.remove(['local_keys'], r));
    await settle();
    assert.equal(A.keys.size, 0, 'the removal emptied A\'s map');
});

test('init() attaches exactly ONE change listener per module instance, however often it runs', async () => {
    await reset();
    const { LocalKeyManager: C } = await import('../src/shared/local-key-manager.js?page=C');
    const before = listenerCount();
    await C.init();
    await C.init();
    await C.init();
    assert.equal(listenerCount() - before, 1, 'one listener, not one per init()');
});

test('an environment without storage change events: init and writes still work', async () => {
    await reset();
    const saved = { area: localArea.onChanged, global: chrome.storage.onChanged };
    delete localArea.onChanged;
    delete chrome.storage.onChanged;
    try {
        const { LocalKeyManager: D } = await import('../src/shared/local-key-manager.js?page=D');
        await D.init();
        await D.installDerivedKey('entity:d', TV2.privateKey, {});
        assert.deepEqual(storedNames(), ['entity:d']);
        assert.ok(D.getKey('entity:d'));
    } finally {
        localArea.onChanged = saved.area;
        chrome.storage.onChanged = saved.global;
    }
});

// ---- the workspace face --------------------------------------------------

test('workspace switch by ANOTHER page: A\'s map follows it, and A\'s next write never copies workspace-A keys into B', async () => {
    await reset();
    seedKeys({ 'entity:a': keyRecord('entity:a', TV2) });
    await A.init();
    assert.ok(A.getKey('entity:a'));
    // The options page switches workspace — a raw pointer write, as
    // seen from this page.
    await new Promise((r) => chrome.storage.local.set({ active_workspace: JSON.stringify('wsb') }, r));
    await settle();
    assert.equal(A.keys.size, 0, 'A\'s map now shows workspace wsb\'s (empty) keystore');
    await A.installDerivedKey('entity:n', TV3.privateKey, {});
    assert.deepEqual(storedNames('ws:wsb:local_keys'), ['entity:n'], 'wsb holds only the key created in wsb');
    assert.deepEqual(storedNames('local_keys'), ['entity:a'], 'the default workspace keystore is untouched');
    samePriv('local_keys', 'entity:a', TV2, 'default-workspace key');

    await new Promise((r) => chrome.storage.local.set({ active_workspace: JSON.stringify('default') }, r));
    await settle();
    assert.deepEqual([...A.keys.keys()], ['entity:a'], 'switching back reloads the default keystore');
});

test('workspace switch with the change event withheld: the write still reads the NEW workspace fresh', async () => {
    await reset();
    seedKeys({ 'entity:a': keyRecord('entity:a', TV2) });
    await A.init();
    muteEvents();
    await Storage.setActiveWorkspaceId('wsb');
    assert.ok(A.getKey('entity:a'), 'precondition: A\'s map still lists workspace-default keys');
    await A.installDerivedKey('entity:n', TV3.privateKey, {});
    assert.deepEqual(storedNames('ws:wsb:local_keys'), ['entity:n'], 'no default-workspace key leaked into wsb');
    assert.deepEqual(storedNames('local_keys'), ['entity:a']);
    assert.deepEqual([...A.keys.keys()], ['entity:n'], 'A\'s map now reflects wsb');
});

test('a workspace switch landing BETWEEN a write\'s read and its write redoes the write in the new workspace', async () => {
    await reset();
    seedKeys({ 'entity:a': keyRecord('entity:a', TV2) });
    await A.init();
    muteEvents();
    // The other page's switch lands exactly while A's write is reading.
    const origGet = Storage.get;
    Storage.get = async (key, dflt) => {
        const v = await origGet(key, dflt);
        if (key === 'local_keys') {
            Storage.get = origGet;
            await Storage.setActiveWorkspaceId('wsb');
        }
        return v;
    };
    try { await A.installDerivedKey('entity:n', TV3.privateKey, {}); } finally { Storage.get = origGet; }
    assert.deepEqual(storedNames('ws:wsb:local_keys'), ['entity:n'], 'the write landed in wsb alone');
    assert.deepEqual(storedNames('local_keys'), ['entity:a'], 'default-workspace keys were neither copied nor touched');
});

// ---- restoreDerivedKeys ----------------------------------------------------

const ID_LEGACY = 'entity_00000000000000a1';
const ID_DERIVED = 'entity_00000000000000a2';
const ID_MISSING = 'entity_00000000000000a3';
const ID_OTHER = 'entity_00000000000000b1';

function entityRow(id, name, extra = {}) {
    return {
        id, name, type: 'person', description: '', nip05: '', canonical_id: null,
        keyName: `entity:${id}`, created: FIXED_TIME_S, updated: FIXED_TIME_S, ...extra
    };
}

test('restoreDerivedKeys with an EMPTY map never re-derives keys that exist in storage, and never erases others', async () => {
    await reset();
    await Storage.primaryIdentity.set(TV1.privateKey);
    const derivedChild = await Crypto.deriveChildKey(TV1.privateKey, ENTITY_KEY_DOMAIN, ID_DERIVED);
    seedEntities({
        [ID_LEGACY]: entityRow(ID_LEGACY, 'Legacy Random'),                              // pre-derivation, no stamp
        [ID_DERIVED]: entityRow(ID_DERIVED, 'Derived One', { derived_from: TV1.pubkey })
    });
    seedKeys({
        [`entity:${ID_LEGACY}`]: keyRecord(`entity:${ID_LEGACY}`, TV3),                   // a legacy RANDOM key
        [`entity:${ID_DERIVED}`]: { ...keyRecord(`entity:${ID_DERIVED}`, TV3), privateKey: derivedChild,
            pubkey: Crypto.getPublicKey(derivedChild), npub: null, nsec: null },
        'xray:user': keyRecord('xray:user', TV2)
    });
    assert.equal(A.keys.size, 0, 'precondition: this page never loaded the keystore');

    const { restored, skipped } = await EntityModel.restoreDerivedKeys();
    assert.equal(restored.length, 0, 'every owned entity already has its key in storage');
    assert.equal(skipped.length, 0);
    samePriv('local_keys', `entity:${ID_LEGACY}`, TV3, 'the legacy random key');
    samePriv('local_keys', 'xray:user', TV2, 'the sync identity');
    assert.ok(storedKeys()[`entity:${ID_DERIVED}`].privateKey === derivedChild, 'the derived key is untouched (value not printed)');
    assert.equal(readJson('entities')[ID_LEGACY].derived_from, undefined, 'nothing restored ⇒ nothing stamped');
});

test('restoreDerivedKeys restores a genuinely missing key, keeps every other key, and keeps entity records created mid-restore', async () => {
    await reset();
    await Storage.primaryIdentity.set(TV1.privateKey);
    seedEntities({ [ID_MISSING]: entityRow(ID_MISSING, 'Lost Key') });   // no stamp ⇒ stamped at restore
    seedKeys({ 'xray:user': keyRecord('xray:user', TV2) });
    await A.init();
    await B.init();
    muteEvents();
    await B.installDerivedKey('entity:elsewhere', TV3.privateKey, {});   // A's map is stale

    // Another page creates an entity while the restore is deriving.
    const orig = Crypto.deriveChildKey;
    Crypto.deriveChildKey = async (...args) => {
        Crypto.deriveChildKey = orig;
        const ents = await Storage.get('entities', {});
        ents[ID_OTHER] = entityRow(ID_OTHER, 'Made Meanwhile');
        await Storage.set('entities', ents);
        return orig(...args);
    };
    let res;
    try { res = await EntityModel.restoreDerivedKeys(); } finally { Crypto.deriveChildKey = orig; }

    assert.equal(res.restored.length, 1);
    const expected = await Crypto.deriveChildKey(TV1.privateKey, ENTITY_KEY_DOMAIN, ID_MISSING);
    assert.ok(storedKeys()[`entity:${ID_MISSING}`].privateKey === expected, 'the derived child is back (value not printed)');
    assert.deepEqual(storedNames(), ['entity:elsewhere', `entity:${ID_MISSING}`, 'xray:user'], 'no other key was erased');
    const ents = readJson('entities');
    assert.ok(ents[ID_OTHER], 'the entity created mid-restore survived the stamp write');
    assert.equal(ents[ID_MISSING].derived_from, TV1.pubkey, 'the restored record was stamped');
});

test('EntityModel.create keeps entity records another page wrote while it derived the key', async () => {
    await reset();
    await Storage.primaryIdentity.set(TV1.privateKey);
    await A.init();
    const orig = Crypto.deriveChildKey;
    Crypto.deriveChildKey = async (...args) => {
        Crypto.deriveChildKey = orig;
        const ents = await Storage.get('entities', {});
        ents[ID_OTHER] = entityRow(ID_OTHER, 'Made Meanwhile');
        await Storage.set('entities', ents);
        return orig(...args);
    };
    let e;
    try { e = await EntityModel.create({ name: 'Fresh Person', type: 'person' }); } finally { Crypto.deriveChildKey = orig; }
    const ents = readJson('entities');
    assert.ok(ents[e.id], 'the created record is stored');
    assert.ok(ents[ID_OTHER], 'the record another page wrote meanwhile survived');
});

// ---- the entity-sync pull face ---------------------------------------------

const PULL_ID = 'entity_00000000000000c1';

async function syncEvent(record, eventId) {
    const convKey = await Crypto.nip44GetConversationKey(TV1.privateKey, TV1.pubkey);
    const content = await Crypto.nip44Encrypt(serializeEntityForSync(record), convKey);
    return { id: eventId, kind: 30078, pubkey: TV1.pubkey, created_at: FIXED_TIME_S, tags: [], content };
}
function pulledRecord(tv, updated) {
    return {
        id: PULL_ID, name: 'Pulled Person', type: 'person', created: FIXED_TIME_S, updated,
        keypair: { privateKey: tv.privateKey, pubkey: tv.pubkey, npub: tv.npub, nsec: tv.nsec }
    };
}
async function pullWith(events) {
    const origQuery = NostrClient.queryRelays;
    NostrClient.queryRelays = async () => ({ events, byRelay: {}, invalid: 0 });
    try {
        return await pullEntities({ userPrivkey: TV1.privateKey, relays: ['wss://relay.example'] });
    } finally {
        NostrClient.queryRelays = origQuery;
    }
}

test('entity-sync pull keeps a key AND an entity record another page created mid-pull', async () => {
    await reset();
    await A.init();
    await B.init();
    const ev = await syncEvent(pulledRecord(TV3, FIXED_TIME_S + 10), 'ev-1');

    const origDecrypt = Crypto.nip44Decrypt;
    Crypto.nip44Decrypt = async (...args) => {
        Crypto.nip44Decrypt = origDecrypt;
        // The other tab tags a new entity while the pull is decrypting.
        await B.installDerivedKey(`entity:${ID_OTHER}`, TV2.privateKey, {});
        const ents = await Storage.get('entities', {});
        ents[ID_OTHER] = entityRow(ID_OTHER, 'Made Meanwhile');
        await Storage.set('entities', ents);
        return origDecrypt(...args);
    };
    let out;
    try { out = await pullWith([ev]); } finally { Crypto.nip44Decrypt = origDecrypt; }

    assert.equal(out.added, 1);
    assert.deepEqual(storedNames(), [`entity:${ID_OTHER}`, `entity:${PULL_ID}`], 'the pull kept the key made mid-pull');
    samePriv('local_keys', `entity:${PULL_ID}`, TV3, 'the pulled key');
    samePriv('local_keys', `entity:${ID_OTHER}`, TV2, 'the mid-pull key');
    const ents = readJson('entities');
    assert.ok(ents[PULL_ID], 'the pulled record is stored');
    assert.ok(ents[ID_OTHER], 'the record created mid-pull survived the pull\'s entities write');
    assert.ok(A.getKey(`entity:${PULL_ID}`), 'the pulling page can sign with the pulled key at once');
});

test('entity-sync pull keeps its semantics: a FRESHER pulled record overwrites that name\'s key; a staler one does not', async () => {
    await reset();
    seedEntities({ [PULL_ID]: entityRow(PULL_ID, 'Pulled Person', { updated: FIXED_TIME_S + 5 }) });
    seedKeys({ [`entity:${PULL_ID}`]: keyRecord(`entity:${PULL_ID}`, TV2), 'xray:user': keyRecord('xray:user', TV1) });
    await A.init();

    const fresher = await pullWith([await syncEvent(pulledRecord(TV3, FIXED_TIME_S + 50), 'ev-2')]);
    assert.equal(fresher.updated, 1);
    samePriv('local_keys', `entity:${PULL_ID}`, TV3, 'the fresher pull replaced the key');
    samePriv('local_keys', 'xray:user', TV1, 'the sync identity is untouched');
    assert.equal(readJson('entities')[PULL_ID].updated, FIXED_TIME_S + 50);

    const staler = await pullWith([await syncEvent(pulledRecord(TV1, FIXED_TIME_S + 20), 'ev-3')]);
    assert.equal(staler.unchanged, 1);
    samePriv('local_keys', `entity:${PULL_ID}`, TV3, 'a staler pull leaves the key alone');
});

// ---- the Web Locks path -----------------------------------------------------

test('writers serialize on the Web Lock "xray.local_keys" when navigator.locks exists — and nothing re-enters it', async () => {
    await reset();
    // A NON-reentrant FIFO lock, like the real one: a locked section
    // that requested the lock again would wait on itself forever.
    const requested = [];
    let tail = Promise.resolve();
    const locks = {
        request(name, cb) {
            requested.push(name);
            const run = tail.then(() => cb({ name, mode: 'exclusive' }));
            tail = run.then(() => undefined, () => undefined);
            return run;
        }
    };
    const saved = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', { value: { locks }, configurable: true, writable: true });
    try {
        await Storage.primaryIdentity.set(TV1.privateKey);
        seedEntities({ [ID_MISSING]: entityRow(ID_MISSING, 'Lost Key', { derived_from: TV1.pubkey }) });
        await A.init();
        await B.init();
        await withTimeout(Promise.all([
            A.installDerivedKey('entity:a', TV2.privateKey, {}),
            B.importKey('entity:b', TV3.privateKey, {}),
            A.createKey('entity:c', {}),
            B.upsertKeys([{ name: 'xray:user', privateKey: TV1.privateKey }])
        ]), 2000, 'parallel writers');
        await withTimeout(B.deleteKey('entity:c'), 2000, 'deleteKey');
        await withTimeout(EntityModel.restoreDerivedKeys(), 2000, 'restoreDerivedKeys');
        await withTimeout(EntityModel.create({ name: 'Locked Person', type: 'person' }), 2000, 'EntityModel.create');
    } finally {
        if (saved) Object.defineProperty(globalThis, 'navigator', saved);
        else delete globalThis.navigator;
    }
    assert.ok(requested.length >= 7, `every write took the lock (saw ${requested.length} requests)`);
    assert.ok(requested.every((n) => n === 'xray.local_keys'), 'one lock name for every writer on every page');
    const names = storedNames();
    for (const n of ['entity:a', 'entity:b', 'xray:user', `entity:${ID_MISSING}`]) {
        assert.ok(names.includes(n), `${n} survived`);
    }
    assert.ok(!names.includes('entity:c'), 'the delete held');
});

// ---- the source guard: nobody writes the map or whole-map saves -------------

// The rule, not the call shape: outside the module nothing may touch the
// Map at all — an alias (`const m = LocalKeyManager.keys; m.set(…)`)
// would dodge a pattern that only matched `.keys.set(`. Reads go through
// getKey / listKeys; writes through the locked methods.
test('guard: no module outside local-key-manager.js touches LocalKeyManager.keys or calls save()', () => {
    const ROOT = new URL('..', import.meta.url).pathname;
    const files = [];
    const walk = (dir) => {
        for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
            const p = `${dir}/${e.name}`;
            if (e.isDirectory()) walk(p);
            else if (e.name.endsWith('.js')) files.push(p);
        }
    };
    walk('src');
    assert.ok(files.includes('src/shared/entity-sync.js'), 'sanity: the walker sees src/shared');
    const offenders = [];
    for (const f of files) {
        if (f === 'src/shared/local-key-manager.js') continue;
        const body = readFileSync(join(ROOT, f), 'utf8');
        if (/LocalKeyManager\s*(\.\s*keys\b|\[\s*['"`]keys['"`]\s*\])/.test(body)) offenders.push(`${f}: touches LocalKeyManager.keys`);
        if (/\{[^}]*\bkeys\b[^}]*\}\s*=\s*LocalKeyManager\b/.test(body)) offenders.push(`${f}: destructures LocalKeyManager.keys`);
        if (/LocalKeyManager\s*\.\s*save\b/.test(body)) offenders.push(`${f}: calls LocalKeyManager.save()`);
    }
    assert.deepEqual(offenders, [], 'reads go through getKey / listKeys; writes through createKey / importKey / installDerivedKey / upsertKeys / deleteKey');
});
