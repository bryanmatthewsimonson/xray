// The entity registry under failed reads and concurrent pages — JOURNAL
// 2026-09-25 (the follow-up #392 named).
//
// The `entities` value (workspace-mapped by Storage) is one JSON object
// every extension page reads and rewrites whole. Before this fix every
// mutator read it with the fail-open `Storage.get`, which returns `{}`
// for a read that FAILED as well as for one that found nothing, and then
// wrote back that snapshot plus its own change: one failed read in
// create / importRecord / importForeign / the entity-sync pull erased
// every other entity record. The workspace pointer had the same shape: a
// failed pointer read became 'default', was CACHED for the page's
// lifetime, and routed that page's writes (a reset, a replace-all
// restore, a merge-import included) into the default workspace. And two
// pages writing the registry at once lost one page's write — the
// lost-update #392 fixed for `local_keys`.
//
// Each test models extension PAGES as module instances of
// entity-model.js (`?page=B` gives a second instance) over one
// chrome.storage stub. They share storage.js and local-key-manager.js,
// as two real pages share one storage area. The stub is asynchronous
// like the real API, delivers onChanged events, and injects faults: a
// read of the registry, of the workspace pointer, or of the whole area
// can fail by runtime.lastError or by a throw, and `onRegistryRead(n,
// fn)` (one-shot) runs `fn` after the n-th registry read took its
// snapshot and before the reader sees it — so another actor can land
// "between a write's read and its write".
//
// Key material: only the BIP-340 vector keys TV1/TV2/TV3
// (tests/tools/fixture-keys.mjs) plus keys derived at test time.
// Comparisons never print a key value.
//
// Provenance: INTERPRETATION (2026-09-25) — an agent artifact; the
// maintainer has not ruled on it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

await import('fake-indexeddb/auto');

// ---- chrome.storage stub ---------------------------------------------------
const _store = new Map();
const _areaListeners = [];
const _globalListeners = [];
const later = (fn) => setImmediate(fn);

const isRegistryKey = (k) => k === 'entities'
    || (typeof k === 'string' && k.startsWith('ws:') && k.endsWith(':entities'));
// fail.<kind> = null | { mode: 'lastError' | 'throw', skip, times }
const fail = { registry: null, pointer: null, all: null };
let _registryHook = null;     // { n, fn }: one-shot, fires on the n-th registry read after arming

function withLastError(message, fn) {
    const saved = globalThis.chrome.runtime;
    globalThis.chrome.runtime = { lastError: { message } };
    try { fn(); } finally {
        if (saved === undefined) delete globalThis.chrome.runtime;
        else globalThis.chrome.runtime = saved;
    }
}
/** Consume one read of `kind`; returns the failure mode to apply, or null. */
function takeFailure(kind) {
    const f = fail[kind];
    if (!f) return null;
    if (f.skip > 0) { f.skip--; return null; }
    if (f.times <= 0) return null;
    f.times--;
    return f.mode;
}
function emit(changes) {
    if (Object.keys(changes).length === 0) return;
    later(() => {
        for (const l of [..._areaListeners]) l(changes);
        for (const l of [..._globalListeners]) l(changes, 'local');
    });
}

const localArea = {
    get(keys, cb) {
        const list = keys === null ? null : (Array.isArray(keys) ? keys : [keys]);
        const kind = list === null ? 'all'
            : list.some(isRegistryKey) ? 'registry'
            : list.includes('active_workspace') ? 'pointer' : null;
        const mode = kind ? takeFailure(kind) : null;
        if (mode === 'throw') throw new Error('stub: storage read threw');
        if (mode === 'lastError') {
            later(() => withLastError('stub: IO error', () => cb(undefined)));
            return;
        }
        const out = {};
        for (const [k, v] of _store) {
            if (list === null || list.includes(k)) out[k] = v;
        }
        let hook = null;
        if (kind === 'registry' && _registryHook && --_registryHook.n === 0) {
            hook = _registryHook.fn;
            _registryHook = null;
        }
        if (hook) {
            Promise.resolve().then(hook).then(() => later(() => cb(out)));
            return;
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
const { Utils } = await import('../src/shared/utils.js');
const { LocalKeyManager } = await import('../src/shared/local-key-manager.js');
const { EntityModel: A } = await import('../src/shared/entity-model.js');
const { EntityModel: B } = await import('../src/shared/entity-model.js?page=B');
const { pullEntities, serializeEntityForSync } = await import('../src/shared/entity-sync.js');
const { NostrClient } = await import('../src/shared/nostr-client.js');
const { applyBackup, mergeBackup, BACKUP_FORMAT } = await import('../src/shared/backup.js');
const { resetWorkspace, workspaceBackup } = await import('../src/shared/identity-profiles.js');
const { TV1, TV2, TV3, FIXED_TIME_S } = await import('./tools/fixture-keys.mjs');

// ---- helpers ---------------------------------------------------------------
const settle = () => new Promise((r) => setTimeout(r, 15));
const rawSet = (obj) => new Promise((r) => chrome.storage.local.set(obj, r));
const failReads = (kind, mode, { skip = 0, times = Infinity } = {}) => { fail[kind] = { mode, skip, times }; };
const onRegistryRead = (n, fn) => { _registryHook = { n, fn }; };
/** Inside a hook: let the racing operation run to completion — or, when it
 *  is (correctly) blocked on the lock the hooked write holds, give up
 *  after a window so the hooked write can finish and release it. */
const raceWindow = (p) => Promise.race([Promise.resolve(p).catch(() => {}), new Promise((r) => setTimeout(r, 150))]);
/** Run `fn`; resolve to the error it threw (or null) — state is asserted BEFORE the error, so a red run shows the damage. */
async function attempt(fn) {
    try { await fn(); return null; } catch (err) { return err; }
}
function assertRefused(err, label) {
    assert.ok(err, `${label}: an error reached the caller (it resolved instead)`);
    assert.match(String(err.message || err), REFUSED, `${label}: the error says nothing was written`);
}
const NO_IDB = { deleteDatabase() {} };
const REFUSED = /nothing written/;

function readJson(rawKey) {
    const raw = _store.get(rawKey);
    if (raw === undefined || raw === null) return {};
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
}
const ids = (rawKey = 'entities') => Object.keys(readJson(rawKey)).sort();
function seed(rawKey, obj) { _store.set(rawKey, JSON.stringify(obj)); }

const E1 = 'entity_00000000000000e1';
const E2 = 'entity_00000000000000e2';
const E3 = 'entity_00000000000000e3';
const EX = 'entity_00000000000000ee';
const PULL_ID = 'entity_00000000000000c1';

function row(id, name, extra = {}) {
    return {
        id, name, type: 'person', description: '', nip05: '', canonical_id: null,
        keyName: `entity:${id}`, created: FIXED_TIME_S, updated: FIXED_TIME_S, ...extra
    };
}
function keyRecord(name, tv) {
    return { name, privateKey: tv.privateKey, pubkey: tv.pubkey, npub: tv.npub, nsec: tv.nsec, metadata: {}, created: FIXED_TIME_S };
}
function samePriv(name, tv, msg) {
    const rec = readJson('local_keys')[name];
    assert.ok(rec, `${msg}: ${name} is present`);
    assert.ok(rec.privateKey === tv.privateKey, `${msg}: ${name} holds the expected key material (value not printed)`);
}
function captureErrors() {
    const orig = Utils.error;
    const calls = [];
    Utils.error = (...args) => { calls.push(args.map((a) => String(a && a.message ? a.message : a)).join(' ')); };
    return { calls, restore: () => { Utils.error = orig; } };
}
function withTimeout(p, ms, label) {
    let t;
    return Promise.race([
        p.finally(() => clearTimeout(t)),
        new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${label}: timed out after ${ms}ms (deadlock?)`)), ms); })
    ]);
}

async function reset() {
    fail.registry = fail.pointer = fail.all = null;
    _registryHook = null;
    await settle();
    await Storage.setActiveWorkspaceId('default');
    await settle();
    _store.clear();
    await LocalKeyManager.init();
}
/** Point storage at `ws` the way another page does it (a raw write + a change event). */
async function otherPageSwitchesTo(ws) {
    await rawSet({ active_workspace: JSON.stringify(ws) });
    await settle();
}

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
const backupWith = (storage) => ({ format: BACKUP_FORMAT, storage, databases: {} });

// ---- 1. a failed registry read never becomes "empty" and gets written back --
// Each test asserts STORAGE first and the error second, so a red run
// names the damage (what the pre-fix code erased), not just "no error".

for (const mode of ['lastError', 'throw']) {
    test(`create: a failed registry read refuses — no record erased, no key installed (${mode})`, async () => {
        await reset();
        await Storage.primaryIdentity.set(TV1.privateKey);
        seed('entities', { [E1]: row(E1, 'One'), [E2]: row(E2, 'Two') });
        failReads('registry', mode);
        const errs = captureErrors();
        let err;
        try { err = await attempt(() => A.create({ name: 'Fresh Person', type: 'person' })); } finally { fail.registry = null; errs.restore(); }
        assert.deepEqual(ids(), [E1, E2], 'the registry still holds both records (nothing was written over them)');
        assert.deepEqual(Object.keys(readJson('local_keys')), [], 'no key was installed for a record that was never written');
        assertRefused(err, 'create');
    });

    test(`importRecord / importForeign: a failed registry read refuses instead of writing one record over the rest (${mode})`, async () => {
        await reset();
        seed('entities', { [E1]: row(E1, 'One'), [E2]: row(E2, 'Two') });
        failReads('registry', mode);
        const errs = captureErrors();
        let e1, e2;
        try {
            e1 = await attempt(() => A.importRecord({ id: EX, name: 'Imported', type: 'person' }));
            e2 = await attempt(() => A.importForeign({ name: 'Foreign', type: 'person', pubkey: TV2.pubkey }));
        } finally { fail.registry = null; errs.restore(); }
        assert.deepEqual(ids(), [E1, E2], 'the registry still holds both records (nothing was written over them)');
        assertRefused(e1, 'importRecord');
        assertRefused(e2, 'importForeign');
    });

    test(`update / linkAlias / delete / markPublished / markProfilePublished: a failed read is an error, not "not found" (${mode})`, async () => {
        await reset();
        seed('entities', { [E1]: row(E1, 'One'), [E2]: row(E2, 'Two') });
        const before = _store.get('entities');
        failReads('registry', mode);
        const errs = captureErrors();
        const got = {};
        try {
            got.update = await attempt(() => A.update(E1, { description: 'x' }));
            got.linkAlias = await attempt(() => A.linkAlias(E2, E1));
            got.delete = await attempt(() => A.delete(E1));
            got.markPublished = await attempt(() => A.markPublished(E1, 'ev'));
            got.markProfilePublished = await attempt(() => A.markProfilePublished(E1, { profileEventId: 'ev' }));
        } finally { fail.registry = null; errs.restore(); }
        assert.ok(_store.get('entities') === before, 'the registry is byte-for-byte unchanged');
        for (const [label, err] of Object.entries(got)) assertRefused(err, label);
    });

    test(`restoreDerivedKeys: a failed registry read is an error, never "nothing to restore" (${mode})`, async () => {
        await reset();
        await Storage.primaryIdentity.set(TV1.privateKey);
        seed('entities', { [E1]: row(E1, 'Lost Key') });   // its key is missing
        failReads('registry', mode);
        const errs = captureErrors();
        let err;
        try { err = await attempt(() => A.restoreDerivedKeys()); } finally { fail.registry = null; errs.restore(); }
        assert.deepEqual(Object.keys(readJson('local_keys')), [], 'nothing was derived from an unread registry');
        assertRefused(err, 'restoreDerivedKeys');
        const { restored } = await A.restoreDerivedKeys();
        assert.deepEqual(restored.map((r) => r.id), [E1], 'with the read back, the restore finds the missing key');
    });
}

test('entity-sync pull: every registry read failing — the pull refuses, no record erased, no key replaced', async () => {
    await reset();
    seed('entities', { [E1]: row(E1, 'Other'), [PULL_ID]: row(PULL_ID, 'Pulled Person', { updated: FIXED_TIME_S + 50 }) });
    seed('local_keys', { [`entity:${PULL_ID}`]: keyRecord(`entity:${PULL_ID}`, TV2) });
    await LocalKeyManager.init();
    const ev = await syncEvent(pulledRecord(TV3, FIXED_TIME_S + 20), 'ev-stale');   // staler than local
    failReads('registry', 'lastError');
    const errs = captureErrors();
    let err;
    try { err = await attempt(() => pullWith([ev])); } finally { fail.registry = null; errs.restore(); }
    assert.deepEqual(ids(), [E1, PULL_ID].sort(), 'the registry still holds both records');
    assert.equal(readJson('entities')[PULL_ID].updated, FIXED_TIME_S + 50, 'the fresher local record was not replaced');
    samePriv(`entity:${PULL_ID}`, TV2, 'a staler pulled key did not replace the local one');
    assertRefused(err, 'pull');
});

test('entity-sync pull: only the PLANNING read fails — refused before any key is written', async () => {
    await reset();
    seed('entities', { [PULL_ID]: row(PULL_ID, 'Pulled Person', { updated: FIXED_TIME_S + 50 }) });
    seed('local_keys', { [`entity:${PULL_ID}`]: keyRecord(`entity:${PULL_ID}`, TV2) });
    await LocalKeyManager.init();
    const ev = await syncEvent(pulledRecord(TV3, FIXED_TIME_S + 20), 'ev-stale');
    failReads('registry', 'lastError', { times: 1 });
    const errs = captureErrors();
    let err;
    try { err = await attempt(() => pullWith([ev])); } finally { fail.registry = null; errs.restore(); }
    samePriv(`entity:${PULL_ID}`, TV2, 'the local (fresher) record keeps its key — a staler pulled key did not replace it');
    assertRefused(err, 'pull');
});

test('entity-sync pull: only the WRITE-phase read fails — the pull refuses and the registry is intact', async () => {
    await reset();
    seed('entities', { [E1]: row(E1, 'Other'), [E2]: row(E2, 'Another') });
    const ev = await syncEvent(pulledRecord(TV3, FIXED_TIME_S + 20), 'ev-new');
    failReads('registry', 'lastError', { skip: 1, times: 1 });
    const errs = captureErrors();
    let err;
    try { err = await attempt(() => pullWith([ev])); } finally { fail.registry = null; errs.restore(); }
    assert.ok(ids().includes(E1) && ids().includes(E2), `the records that were there survive (registry now: ${ids().join(', ')})`);
    assert.equal(readJson('entities')[PULL_ID], undefined, 'no pulled record was written by a write whose read failed');
    assertRefused(err, 'pull');
});

// ---- 2. the workspace pointer: absent is 'default', unreadable is not ------

for (const mode of ['lastError', 'throw']) {
    test(`a failed pointer read routes no entity write into the default workspace, and poisons no later write (${mode})`, async () => {
        await reset();
        seed('entities', { [E1]: row(E1, 'Default One') });
        seed('ws:wsb:entities', { [E2]: row(E2, 'B One') });
        const errs = captureErrors();
        failReads('pointer', mode);            // armed BEFORE the switch: every pointer read after
        await otherPageSwitchesTo('wsb');      // the switch's cache invalidation fails
        let err;
        try { err = await attempt(() => A.importRecord({ id: EX, name: 'Imported', type: 'person' })); } finally { fail.pointer = null; errs.restore(); }
        assert.deepEqual(ids('entities'), [E1], 'the default workspace registry is untouched');
        assert.deepEqual(ids('ws:wsb:entities'), [E2], 'and so is wsb');
        assertRefused(err, 'importRecord');

        await A.importRecord({ id: EX, name: 'Imported', type: 'person' });
        assert.deepEqual(ids('entities'), [E1], 'with the pointer readable again, nothing lands in the default workspace');
        assert.deepEqual(ids('ws:wsb:entities'), [E2, EX], 'the write lands in wsb');
    });
}

test('plain reads under a failed pointer read work as before (default view), uncached; global keys never depend on the pointer', async () => {
    await reset();
    await Storage.preferences.set({ debug: false, marker: 'prefs' });
    seed('entities', { [E1]: row(E1, 'Default One') });
    seed('ws:wsb:entities', { [E2]: row(E2, 'B One') });
    const errs = captureErrors();
    failReads('pointer', 'lastError');
    await otherPageSwitchesTo('wsb');
    let during, prefs;
    try {
        during = await Storage.get('entities', {});
        prefs = await Storage.preferences.get();
    } finally { fail.pointer = null; errs.restore(); }
    assert.deepEqual(Object.keys(during), [E1], 'a plain content read falls back to the default workspace, as it always did');
    assert.equal(prefs.marker, 'prefs', 'a global key reads normally');
    assert.deepEqual(Object.keys(await Storage.get('entities', {})), [E2],
        'the fallback was not cached: the next read follows the real pointer');
    assert.equal(await Storage.activeWorkspaceId(), 'wsb');
});

test('a workspace reset under a failed pointer read clears nothing — least of all the default workspace', async () => {
    await reset();
    seed('entities', { [E1]: row(E1, 'Default One') });
    seed('ws:wsb:entities', { [E2]: row(E2, 'B One') });
    const errs = captureErrors();
    failReads('pointer', 'lastError');
    await otherPageSwitchesTo('wsb');
    let err;
    try { err = await attempt(() => resetWorkspace({ idb: NO_IDB })); } finally { fail.pointer = null; errs.restore(); }
    assert.deepEqual(ids('entities'), [E1], 'the default workspace keeps its registry');
    assert.deepEqual(ids('ws:wsb:entities'), [E2], 'and the active one was not half-cleared');
    assertRefused(err, 'resetWorkspace');
});

test('the safety backup a reset downloads first refuses on a failed read — the reset flow never clears after an empty file', async () => {
    await reset();
    seed('entities', { [E1]: row(E1, 'One') });
    failReads('registry', 'lastError');
    let err, snapshot;
    try {
        err = await attempt(async () => { snapshot = await workspaceBackup(); });
    } finally { fail.registry = null; }
    assert.ok(!snapshot || (snapshot.data.entities && snapshot.data.entities[E1]),
        'no safety file was produced without the registry in it');
    assert.ok(err, 'the backup rejected, so the Options flow stops before resetWorkspace');
    assert.deepEqual(ids(), [E1], 'and the registry is still there');
});

for (const [label, run] of [
    ['replace-all restore', (b) => applyBackup(b)],
    ['merge-import', (b) => mergeBackup(b)]
]) {
    test(`a ${label} under a failed pointer read writes nothing into the default workspace`, async () => {
        await reset();
        seed('entities', { [E1]: row(E1, 'Default One') });
        seed('ws:wsb:entities', { [E2]: row(E2, 'B One') });
        const errs = captureErrors();
        failReads('pointer', 'lastError');
        await otherPageSwitchesTo('wsb');
        let err;
        try { err = await attempt(() => run(backupWith({ entities: JSON.stringify({ [E3]: row(E3, 'From File') }) }))); } finally { fail.pointer = null; errs.restore(); }
        assert.deepEqual(ids('entities'), [E1], 'the default workspace registry is untouched');
        assert.deepEqual(ids('ws:wsb:entities'), [E2], 'and so is wsb');
        assertRefused(err, label);
    });
}

test('a merge-import whose read of current storage fails refuses instead of writing the file\'s registry over the local one', async () => {
    await reset();
    seed('entities', { [E1]: row(E1, 'Local One'), [E2]: row(E2, 'Local Two') });
    failReads('all', 'lastError');
    let err;
    try { err = await attempt(() => mergeBackup(backupWith({ entities: JSON.stringify({ [E3]: row(E3, 'From File') }) }))); } finally { fail.all = null; }
    assert.deepEqual(ids(), [E1, E2], 'the local registry is as it was');
    assertRefused(err, 'mergeBackup');
});

test('a replace-all restore whose read of current storage fails refuses instead of leaving stale content behind', async () => {
    await reset();
    seed('entities', { [E1]: row(E1, 'Local One') });
    seed('claims', { c1: { id: 'c1' } });
    failReads('all', 'lastError');
    let err;
    try { err = await attempt(() => applyBackup(backupWith({ entities: JSON.stringify({ [E3]: row(E3, 'From File') }) }))); } finally { fail.all = null; }
    assert.deepEqual(Object.keys(readJson('claims')), ['c1'], 'sanity: content outside the file is still there');
    assert.deepEqual(ids('entities'), [E1], 'nothing was half-replaced: the registry is the local one, not the file\'s beside stale claims');
    assertRefused(err, 'applyBackup');
});

// ---- 3. two pages, one registry: no lost update ------------------------------

test('two pages update different entities at once: both updates survive', async () => {
    await reset();
    seed('entities', { [E1]: row(E1, 'One'), [E2]: row(E2, 'Two') });
    await Promise.all([
        A.update(E1, { description: 'from page A' }),
        B.update(E2, { description: 'from page B' })
    ]);
    const ents = readJson('entities');
    assert.equal(ents[E1].description, 'from page A');
    assert.equal(ents[E2].description, 'from page B');
});

test('two pages create entities at once: every record survives, each with its key', async () => {
    await reset();
    await Storage.primaryIdentity.set(TV1.privateKey);
    const made = await Promise.all([
        A.create({ name: 'Page A First', type: 'person' }),
        B.create({ name: 'Page B First', type: 'person' }),
        A.create({ name: 'Page A Second', type: 'organization' }),
        B.create({ name: 'Page B Second', type: 'place' })
    ]);
    assert.deepEqual(ids(), made.map((e) => e.id).sort(), 'every created record is in the registry');
    const keys = readJson('local_keys');
    for (const e of made) assert.ok(keys[e.keyName], `${e.name} has its key`);
});

test('another page\'s create landing between a create\'s registry read and its write survives', async () => {
    await reset();
    await Storage.primaryIdentity.set(TV1.privateKey);
    let racing = null;
    // Read 1 is create's planning read; read 2 is the one its write is built on.
    onRegistryRead(2, async () => { racing = B.create({ name: 'Made Meanwhile', type: 'person' }); await raceWindow(racing); });
    const mine = await A.create({ name: 'Fresh Person', type: 'person' });
    assert.ok(racing, 'sanity: the other create started mid-write');
    const theirs = await racing;
    assert.deepEqual(ids(), [mine.id, theirs.id].sort(), 'both records are in the registry');
});

test('import, adopt, alias, delete and publish-stamps from two pages at once: nothing is lost', async () => {
    await reset();
    seed('entities', { [E1]: row(E1, 'One'), [E2]: row(E2, 'Two'), [E3]: row(E3, 'Three') });
    await Promise.all([
        A.importRecord({ id: EX, name: 'Imported', type: 'person' }),
        B.importForeign({ name: 'Foreign', type: 'person', pubkey: TV2.pubkey }),
        A.linkAlias(E2, E1),
        B.delete(E3),
        A.markPublished(E1, 'ev-1'),
        B.markProfilePublished(E2, { profileEventId: 'ev-2' })
    ]);
    const ents = readJson('entities');
    const lost = [];
    if (!ents[EX]) lost.push('the imported record');
    if (!Object.values(ents).some((r) => r.foreign_pubkey === TV2.pubkey)) lost.push('the adopted foreign record');
    if (!ents[E2] || ents[E2].canonical_id !== E1) lost.push('the alias link');
    if (ents[E3]) lost.push('the delete');
    if (!ents[E1] || ents[E1].publishedEventId !== 'ev-1') lost.push('the publish stamp');
    if (!ents[E2] || ents[E2].publishedProfileEventId !== 'ev-2') lost.push('the profile stamp');
    assert.deepEqual(lost, [], 'every page\'s write is in the registry');
});

test('an update landing between the pull\'s registry read and its write survives the pull', async () => {
    await reset();
    seed('entities', { [E1]: row(E1, 'One') });
    const ev = await syncEvent(pulledRecord(TV3, FIXED_TIME_S + 20), 'ev-new');
    let racing = null;
    // Read 1 is the pull's planning read; read 2 is the one its write is built on.
    onRegistryRead(2, async () => { racing = B.update(E1, { description: 'mid-pull' }); await raceWindow(racing); });
    const out = await pullWith([ev]);
    assert.ok(racing, 'sanity: the update started mid-pull');
    await racing;
    assert.equal(out.added, 1);
    const ents = readJson('entities');
    assert.ok(ents[PULL_ID], 'the pulled record');
    assert.equal(ents[E1].description, 'mid-pull', 'the other page\'s update was not overwritten by the pull');
});

for (const [label, start, expectIds] of [
    ['a replace-all restore', () => applyBackup(backupWith({ entities: JSON.stringify({ [E3]: row(E3, 'Restored') }) })), [E3]],
    ['a workspace reset', () => resetWorkspace({ idb: NO_IDB }), []]
]) {
    test(`${label} racing an entity update is never undone: it takes the registry lock`, async () => {
        await reset();
        seed('entities', { [E1]: row(E1, 'One') });
        let wholesale = null;
        onRegistryRead(1, async () => { wholesale = start(); await raceWindow(wholesale); });
        await attempt(() => A.update(E1, { description: 'late' }));   // after a reset, E1 is legitimately gone
        assert.ok(wholesale, `sanity: ${label} started mid-update`);
        await wholesale;
        await settle();
        assert.deepEqual(ids(), expectIds, `the registry is what ${label} left — the racing update did not put the old one back`);
    });
}

test('a merge-import racing an entity update keeps both', async () => {
    await reset();
    seed('entities', { [E1]: row(E1, 'One') });
    let merging = null;
    onRegistryRead(1, async () => {
        merging = mergeBackup(backupWith({ entities: JSON.stringify({ [E3]: row(E3, 'Merged') }) }));
        await raceWindow(merging);
    });
    await A.update(E1, { description: 'late' });
    assert.ok(merging, 'sanity: the merge started mid-update');
    await merging;
    const ents = readJson('entities');
    assert.ok(ents[E3], 'the merged record');
    assert.equal(ents[E1].description, 'late', 'the update');
});

// ---- 4. the lock itself --------------------------------------------------------

test('entity writers serialize on the Web Lock "xray.entities" and never nest another lock inside it', async () => {
    await reset();
    await Storage.primaryIdentity.set(TV1.privateKey);
    seed('entities', { [E1]: row(E1, 'One'), [E2]: row(E2, 'Two'), [E3]: row(E3, 'No Stamp', { keyName: `entity:${E3}` }) });
    // ONE non-reentrant FIFO for every name: a locked section that asked
    // for any lock (the same or the keystore's) would wait on itself.
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
    const ev = await syncEvent(pulledRecord(TV3, FIXED_TIME_S + 20), 'ev-lock');
    try {
        await withTimeout(Promise.all([
            A.create({ name: 'Locked Person', type: 'person' }),
            B.update(E1, { description: 'b' }),
            A.importRecord({ id: EX, name: 'Imported', type: 'person' }),
            B.importForeign({ name: 'Foreign', type: 'person', pubkey: TV2.pubkey }),
            A.linkAlias(E2, E1),
            B.markPublished(E1, 'ev'),
            A.markProfilePublished(E2, { profileEventId: 'ev' })
        ]), 3000, 'parallel entity writers');
        await withTimeout(A.restoreDerivedKeys(), 3000, 'restoreDerivedKeys');
        await withTimeout(pullWith([ev]), 3000, 'pull');
        await withTimeout(B.delete(EX), 3000, 'delete');
    } finally {
        if (saved) Object.defineProperty(globalThis, 'navigator', saved);
        else delete globalThis.navigator;
    }
    const entityLocks = requested.filter((n) => n === 'xray.entities').length;
    assert.ok(entityLocks >= 10, `every registry write took the lock (saw ${entityLocks})`);
    assert.deepEqual([...new Set(requested)].sort(), ['xray.entities', 'xray.local_keys'], 'the registry lock and the keystore lock, nothing else');
    const ents = readJson('entities');
    for (const id of [E1, E2, E3, PULL_ID]) assert.ok(ents[id], `${id} survived`);
    assert.equal(ents[EX], undefined, 'the delete held');
    assert.equal(ents[E3].derived_from, TV1.pubkey, 'the restore stamped the record it re-keyed');
});

test('entity writers refuse to run outside an extension origin', async () => {
    await reset();
    seed('entities', { [E1]: row(E1, 'One'), [E2]: row(E2, 'Two') });
    const before = _store.get('entities');
    const requested = [];
    const locks = { request(name, cb) { requested.push(name); return Promise.resolve().then(() => cb({ name })); } };
    const savedNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', { value: { locks }, configurable: true, writable: true });
    try {
        for (const protocol of ['https:', 'http:', 'file:']) {
            globalThis.location = { protocol, href: `${protocol}//page.example/` };
            const refused = /extension/;
            await assert.rejects(() => A.update(E1, { description: 'x' }), refused, `${protocol} update`);
            await assert.rejects(() => A.importRecord({ id: EX, name: 'Imported', type: 'person' }), refused, `${protocol} importRecord`);
            await assert.rejects(() => A.importForeign({ name: 'Foreign', type: 'person', pubkey: TV2.pubkey }), refused, `${protocol} importForeign`);
            await assert.rejects(() => A.linkAlias(E2, E1), refused, `${protocol} linkAlias`);
            await assert.rejects(() => A.delete(E1), refused, `${protocol} delete`);
            await assert.rejects(() => A.markPublished(E1, 'ev'), refused, `${protocol} markPublished`);
        }
        assert.ok(!requested.includes('xray.entities'), 'the registry lock was never requested under a web page\'s origin');
        assert.ok(_store.get('entities') === before, 'and nothing was written');
        globalThis.location = { protocol: 'chrome-extension:', href: 'chrome-extension://abcdef/src/sidepanel/sidepanel.html' };
        await A.update(E1, { description: 'from an extension page' });
        assert.equal(readJson('entities')[E1].description, 'from an extension page', 'an extension origin writes as before');
    } finally {
        delete globalThis.location;
        if (savedNav) Object.defineProperty(globalThis, 'navigator', savedNav);
        else delete globalThis.navigator;
    }
});

// ---- 5. the source guard ------------------------------------------------------
// A tripwire on the call shape, not the invariant: a raw chrome.storage
// writer or a key held in a variable passes it (the wholesale writers in
// backup.js write raw — under withEntityStoreLock). The behavior tests
// above are the observers.

const DIRECT_REGISTRY_RMW = /Storage\s*\.\s*(set|getStrict|delete)\s*\(\s*['"`]entities['"`]/;

test('guard: no module outside entity-model.js reads-for-write or writes the entity registry directly', () => {
    assert.ok(DIRECT_REGISTRY_RMW.test("await Storage.set('entities', all)"), 'sanity: the pattern sees the pre-fix pull\'s write');
    assert.ok(!DIRECT_REGISTRY_RMW.test("await Storage.get('entities', {})"), 'sanity: display reads are allowed');
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
        if (f === 'src/shared/entity-model.js') continue;
        const body = readFileSync(join(ROOT, f), 'utf8');
        if (DIRECT_REGISTRY_RMW.test(body)) offenders.push(f);
    }
    assert.deepEqual(offenders, [], 'registry writes go through EntityModel\'s locked mutators (wholesale writers take withEntityStoreLock)');
});
