// The entity registry under failed reads and concurrent pages — JOURNAL
// 2026-09-25 (the follow-up #392 named).
//
// The `entities` value (workspace-mapped by Storage) is one JSON object
// every extension page reads and rewrites whole. Before this fix every
// mutator read it with the fail-open `Storage.get`, which returns `{}`
// for a read that FAILED as well as for one that found nothing, and then
// wrote back that snapshot plus its own change: one failed read in
// create / importRecord / importForeign / the entity-sync pull erased
// every other entity record (section 1). Two pages writing the registry
// at once lost one page's write — the lost update #392 fixed for
// `local_keys` (sections 4–5).
//
// The workspace pointer (sections 2–3). ONE pointer per page: every read
// and write — plain and strict, the locked writes, the keystore Map and
// signing, the entity list, the IndexedDB names — resolves the workspace
// through the page's CACHED pointer with origin/main's rule (a failed
// pointer read is 'default', cached until the pointer next changes).
// Callers that find the cache empty share ONE read (single flight), and a
// read that started before a switch never fills the cache after it, so a
// page never holds two answers. Under that fault a page misroutes
// CONSISTENTLY into the default workspace, as on main (a named
// follow-up). The keystore Map answers only while the pointer names the
// workspace it was loaded under, so a Map kept across a switch (a failed
// or unfinished refresh) serves no key. A step of an operation planned in
// one workspace (create, delete, importRecord / importForeign, the
// case-bundle import, the pull, restoreDerivedKeys) is refused rather than
// redone in another. What a page holds across a switch is refused, not
// re-paired: signEvent refuses a key that does not hold the event's
// pubkey, and the case bundle produces no file if the pointer moved. The
// destructive wholesale operations — reset, workspace removal,
// replace-all restore, merge-import, export, the reset's safety file —
// first re-read the pointer strictly and refuse unless it agrees with the
// cache, and re-verify before each later step that resolves the
// workspace through the cache (not the version pre-checks, not the
// removal's deletes — follow-ups). Earlier cuts of this branch mixed a
// strict per-call pointer into ordinary paths, and each review found a
// new straddle between the two (the verifiers' probes S1–S3, erase2/race,
// P1–P6, T4, T6–T8, the case-bundle probe and the join test below are the
// permanent observers).
//
// Each test models extension PAGES as module instances of
// entity-model.js (`?page=B` gives a second instance) over one
// chrome.storage stub. They share storage.js and local-key-manager.js,
// as two real pages share one storage area. The stub is asynchronous
// like the real API, delivers onChanged events, and injects faults: a
// read of the registry, the keystore, the workspace pointer, or the whole
// area can fail by runtime.lastError (chrome's or, Firefox-style,
// browser's), or by a throw, as can a removal; `onRegistryRead(n, fn)`
// (one-shot) runs `fn` after the n-th registry read took its snapshot and
// before the reader sees it — so another actor can land "between a
// write's read and its write" — and `_registryWriteHook` runs right after
// a registry write lands; `onRawWrite` / `onKeyRead` do the same after a
// raw write or read of any named key. An IndexedDB transaction hook lands
// a switch in the middle of one database (section 3).
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
const isKeystoreKey = (k) => k === 'local_keys'
    || (typeof k === 'string' && k.startsWith('ws:') && k.endsWith(':local_keys'));
// fail.<kind> = null | { mode: 'lastError' | 'ffLastError' | 'throw', skip, times }
// (`write`: a write of the registry key fails by runtime.lastError;
// `remove`: a removal of any key does).
const fail = { registry: null, keystore: null, pointer: null, all: null, write: null, remove: null };
let _registryHook = null;     // { n, fn }: one-shot, fires on the n-th registry read after arming
let _registryWriteHook = null;   // fn: one-shot, runs right after a registry write lands, before its callback

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
            : list.some(isKeystoreKey) ? 'keystore'
            : list.includes('active_workspace') ? 'pointer' : null;
        const mode = kind ? takeFailure(kind) : null;
        if (mode === 'throw') throw new Error('stub: storage read threw');
        if (mode === 'lastError') {
            later(() => withLastError('stub: IO error', () => cb(undefined)));
            return;
        }
        if (mode === 'ffLastError') {   // Firefox: the error on browser.runtime, and a result object anyway
            later(() => {
                globalThis.browser = { runtime: { lastError: { message: 'stub: IO error' } } };
                try { cb({}); } finally { delete globalThis.browser; }
            });
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
        if (Object.keys(obj).some(isRegistryKey) && takeFailure('write')) {
            later(() => withLastError('stub: write failed', () => cb && cb()));
            return;
        }
        const changes = {};
        for (const [k, v] of Object.entries(obj)) {
            changes[k] = { oldValue: _store.get(k), newValue: v };
            _store.set(k, v);
        }
        const hook = Object.keys(obj).some(isRegistryKey) ? _registryWriteHook : null;
        if (hook) { _registryWriteHook = null; hook(); }
        later(() => cb && cb());
        emit(changes);
    },
    remove(keys, cb) {
        if (takeFailure('remove')) {
            later(() => withLastError('stub: remove failed', () => cb && cb()));
            return;
        }
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
const { LocalKeyManager, lockedReadModifyWrite, withStoreLock } = await import('../src/shared/local-key-manager.js');
const { EntityModel: A, withEntityStoreLock } = await import('../src/shared/entity-model.js');
const { EntityModel: B } = await import('../src/shared/entity-model.js?page=B');
const { pullEntities, pushEntities, serializeEntityForSync } = await import('../src/shared/entity-sync.js');
const { NostrClient } = await import('../src/shared/nostr-client.js');
const { applyBackup, mergeBackup, collectBackup, BACKUP_FORMAT } = await import('../src/shared/backup.js');
const { resetWorkspace, workspaceBackup, Workspaces } = await import('../src/shared/identity-profiles.js');
const { ClaimModel } = await import('../src/shared/claim-model.js');
const { importCaseBundle, collectCaseBundle, CASE_BUNDLE_FORMAT } = await import('../src/shared/case-bundle.js');
const { activeWorkspaceId: wsKeysActiveWorkspaceId, resolveActiveDbName } = await import('../src/shared/workspace-keys.js');
const { TV1, TV2, TV3, FIXED_TIME_S } = await import('./tools/fixture-keys.mjs');
const { openArchiveDb } = await import('../src/shared/archive-cache.js');
const { openEventJournalDb } = await import('../src/shared/event-journal.js');

// ---- helpers ---------------------------------------------------------------
const settle = () => new Promise((r) => setTimeout(r, 15));
const rawSet = (obj) => new Promise((r) => globalThis.chrome.storage.local.set(obj, r));
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
    for (const k of Object.keys(fail)) fail[k] = null;
    _registryHook = _registryWriteHook = null;
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

test('entity-sync pull: a pulled record with no `updated` never replaces a record another page made between the plan and the write', async () => {
    await reset();
    // An older sender's payload: no `updated` stamp (the userscript era).
    const convKey = await Crypto.nip44GetConversationKey(TV1.privateKey, TV1.pubkey);
    const payload = JSON.stringify({ schemaVersion: 1, id: PULL_ID, name: 'Pulled Person', type: 'person', created: FIXED_TIME_S,
        keypair: { privateKey: TV3.privateKey, pubkey: TV3.pubkey } });
    const ev = { id: 'ev-unstamped', kind: 30078, pubkey: TV1.pubkey, created_at: FIXED_TIME_S, tags: [], content: await Crypto.nip44Encrypt(payload, convKey) };
    // Registry read 1 is the pull's plan: the record appears right after it.
    onRegistryRead(1, async () => { await rawSet({ entities: JSON.stringify({ [PULL_ID]: row(PULL_ID, 'Made Meanwhile') }) }); });
    const out = await pullWith([ev]);
    assert.equal(readJson('entities')[PULL_ID].name, 'Made Meanwhile', 'the stored record stays — an unstamped pull never wins against it');
    assert.equal(out.unchanged, 1);
});

// Store-level refusals (unreadable, corrupt, unwritable, the workspace
// moving) are TYPED, so a caller importing many rows stops instead of
// skipping each one as "malformed" behind a success toast.
test('every store-level refusal is a StoreRefusedError that says nothing was written', async () => {
    await reset();
    seed('entities', [row(E1, 'Array Shape')]);   // corrupt: not an object
    const corrupt = await attempt(() => A.importRecord({ id: EX, name: 'Imported', type: 'person' }));
    assert.ok(Array.isArray(readJson('entities')), 'the corrupt value was not overwritten');
    seed('entities', { [E1]: row(E1, 'One') });
    const before = _store.get('entities');
    failReads('write', 'lastError');
    const unwritable = await attempt(() => A.update(E1, { description: 'x' }));
    fail.write = null;
    failReads('registry', 'lastError');
    const unreadable = await attempt(() => A.update(E1, { description: 'x' }));
    fail.registry = null;
    assert.ok(_store.get('entities') === before, 'the registry is unchanged');
    for (const [label, err] of Object.entries({ corrupt, unwritable, unreadable })) {
        assertRefused(err, label);
        assert.equal(err.name, 'StoreRefusedError', `${label}: typed`);
    }
    const rowError = await attempt(() => A.update(EX, { description: 'x' }));
    assert.ok(rowError && rowError.name !== 'StoreRefusedError', 'a row-level error ("not found") is not a store refusal');
});

test('a case-bundle import over an unreadable registry refuses before installing any key — never "skipped malformed entries"', async () => {
    await reset();
    seed('entities', { [E1]: row(E1, 'One') });
    failReads('registry', 'lastError');
    const bundle = { format: CASE_BUNDLE_FORMAT, version: 1, case_id: EX, entities: [{ ...row(EX, 'Bundled'), privkey: TV2.privateKey }] };
    let err, out;
    try { err = await attempt(async () => { out = await importCaseBundle(bundle); }); } finally { fail.registry = null; }
    assert.deepEqual(ids(), [E1], 'the registry is intact');
    assert.deepEqual(Object.keys(readJson('local_keys')), [], 'no key was installed for a row that could not be written');
    assert.equal(out, undefined, 'no import summary (with the row filed under "malformed") was produced');
    assertRefused(err, 'importCaseBundle');

    // Readable at the start, unreadable at the row's write: the import stops
    // there with the refusal (its key, installed first, stays — harmless;
    // a re-import is idempotent) instead of filing the row as malformed.
    failReads('registry', 'lastError', { skip: 1 });
    out = undefined;
    try { err = await attempt(async () => { out = await importCaseBundle(bundle); }); } finally { fail.registry = null; }
    assert.deepEqual(ids(), [E1], 'the registry is intact');
    assert.equal(out, undefined, 'no summary filing a storage failure under "malformed"');
    assertRefused(err, 'importCaseBundle (mid-loop)');
});

test('restoreDerivedKeys: the keys come back but recording their origin fails — the result says so', async () => {
    await reset();
    await Storage.primaryIdentity.set(TV1.privateKey);
    seed('entities', { [E1]: row(E1, 'Lost Key') });
    failReads('registry', 'lastError', { skip: 1, times: 1 });   // read 1 plans; read 2 is the stamp's
    const errs = captureErrors();
    let out;
    try { out = await A.restoreDerivedKeys(); } finally { fail.registry = null; errs.restore(); }
    assert.deepEqual(out.restored.map((r) => r.id), [E1], 'the key was restored');
    assert.equal(readJson('entities')[E1].derived_from, undefined, 'the origin stamp was not written');
    assert.equal(out.stampFailed, true, 'and the caller is told, so Options can say so');
});

test('a registry that is not an object stops create, the pull and a bundle import before any key is written', async () => {
    await reset();
    await Storage.primaryIdentity.set(TV1.privateKey);
    seed('entities', [row(E1, 'Array Shape')]);   // corrupt: not an object
    const before = _store.get('entities');
    const ev = await syncEvent(pulledRecord(TV3, FIXED_TIME_S + 20), 'ev-corrupt');
    const bundle = { format: CASE_BUNDLE_FORMAT, version: 1, case_id: EX, entities: [{ ...row(EX, 'Bundled'), privkey: TV2.privateKey }] };
    const errs = captureErrors();
    const got = {};
    try {
        got.create = await attempt(() => A.create({ name: 'Fresh Person', type: 'person' }));
        got.pull = await attempt(() => pullWith([ev]));
        got.bundle = await attempt(() => importCaseBundle(bundle));
    } finally { errs.restore(); }
    assert.ok(_store.get('entities') === before, 'the corrupt value was not overwritten');
    assert.deepEqual(Object.keys(readJson('local_keys')), [], 'no key was installed for a record that could not be planned');
    for (const [label, err] of Object.entries(got)) {
        assertRefused(err, label);
        assert.equal(err.name, 'StoreRefusedError', `${label}: typed`);
    }
});

test('a case-bundle import whose key install the keystore refuses stops there — never filed as a conflict or a malformed row', async () => {
    await reset();
    seed('entities', { [E1]: row(E1, 'One') });
    const bundle = { format: CASE_BUNDLE_FORMAT, version: 1, case_id: EX, entities: [{ ...row(EX, 'Bundled'), privkey: TV2.privateKey }] };
    failReads('keystore', 'lastError');
    let err, out;
    try { err = await attempt(async () => { out = await importCaseBundle(bundle); }); } finally { fail.keystore = null; }
    assert.deepEqual(ids(), [E1], 'no row was written after its key was refused');
    assert.equal(out, undefined, 'no summary filing a storage refusal under conflicts or malformed rows');
    assert.equal(err && err.name, 'StoreRefusedError', 'the typed refusal reached the caller');
});

// ---- 2. ONE workspace pointer per page: a fault misroutes consistently, never straddles

const claim = (id, text) => ({ id, text, about: [], source: null, is_key: false, source_url: 'https://example.com/a', created: 1, updated: 1 });
async function seedClaims() {
    seed('article_claims', { claim_d1: claim('claim_d1', 'DEFAULT workspace claim') });
    seed('ws:wsb:article_claims', { claim_w1: claim('claim_w1', 'wsb claim 1'), claim_w2: claim('claim_w2', 'wsb claim 2') });
}
/** Another page switches to wsb while this page's pointer reads fail: the page caches the
 *  'default' fallback (origin/main's rule) and keeps it once the pointer is readable again. */
async function cacheFallsBackWhileWsbIsActive(mode = 'lastError') {
    failReads('pointer', mode);
    await otherPageSwitchesTo('wsb');
    const cached = await Storage.activeWorkspaceId();
    fail.pointer = null;
    assert.equal(cached, 'default', 'sanity: the page cached the fallback');
    assert.equal(JSON.parse(_store.get('active_workspace')), 'wsb', 'sanity: the stored pointer is wsb');
}
const wsbKeys = () => JSON.stringify([..._store.entries()].filter(([k]) => k.startsWith('ws:wsb:')).sort());

// S1–S3: the verifiers' probes (a failed pointer read inside PLAIN
// read-then-write code the fix did not convert). Outcome identical to
// origin/main: the active workspace loses nothing and gains nothing.
test('S1: a failed pointer read inside ClaimModel.create erases nothing in the active workspace — the claim lands in the page\'s cached workspace, as on main', async () => {
    await reset();
    await seedClaims();
    const errs = captureErrors();
    let made;
    try {
        failReads('pointer', 'lastError', { times: 1 });   // exactly one, as in the probe
        await otherPageSwitchesTo('wsb');
        made = await ClaimModel.create({ text: 'A new claim made in wsb', source_url: 'https://example.com/b' });
    } finally { fail.pointer = null; errs.restore(); }
    assert.deepEqual(ids('ws:wsb:article_claims'), ['claim_w1', 'claim_w2'], 'wsb keeps its own claims and gains none of the default workspace\'s');
    assert.deepEqual(ids('article_claims'), ['claim_d1', made.id].sort(), 'the claim lands beside what its own read saw — the default workspace');
});

test('S2: Storage.initialize under a failed pointer read seeds nothing over the active workspace\'s accounts — main\'s outcome', async () => {
    await reset();
    seed('ws:wsb:platform_accounts', { acct1: { key: 'acct1' } });
    const errs = captureErrors();
    try {
        failReads('pointer', 'lastError', { times: 1 });
        await otherPageSwitchesTo('wsb');
        await Storage.initialize();
    } finally { fail.pointer = null; errs.restore(); }
    assert.deepEqual(ids('ws:wsb:platform_accounts'), ['acct1'], 'wsb keeps its platform accounts');
    assert.equal(_store.get('platform_accounts'), '{}', 'the empty seed went where its read went — the default workspace');
});

test('S3: a fallen-back plain read, a second plain read of the same key, then set(first snapshot + new) — the active workspace loses nothing', async () => {
    await reset();
    await seedClaims();
    const errs = captureErrors();
    let snap, again, wrote;
    try {
        failReads('pointer', 'lastError', { times: 1 });
        await otherPageSwitchesTo('wsb');
        snap = await Storage.get('article_claims', {});
        again = await Storage.get('article_claims', {});
        snap.claim_new = claim('claim_new', 'new');
        wrote = await Storage.set('article_claims', snap);
    } finally { fail.pointer = null; errs.restore(); }
    assert.deepEqual(ids('ws:wsb:article_claims'), ['claim_w1', 'claim_w2'], 'wsb\'s claims are intact');
    assert.deepEqual(ids('article_claims'), ['claim_d1', 'claim_new'], 'the write landed in the workspace both reads saw');
    assert.deepEqual(Object.keys(again), ['claim_d1'], 'the second read used the cached fallback — no read/write straddle');
    assert.equal(wrote, true);
    await otherPageSwitchesTo('wsb');
    assert.deepEqual(Object.keys(await Storage.get('article_claims', {})).sort(), ['claim_w1', 'claim_w2'],
        'the next pointer change re-reads it: the page follows the real workspace again');
});

for (const mode of ['lastError', 'throw']) {
    test(`an entity write under a fallen-back pointer lands in the page's cached workspace beside that workspace's records — nothing erased in either (${mode})`, async () => {
        await reset();
        seed('entities', { [E1]: row(E1, 'Default One') });
        seed('ws:wsb:entities', { [E2]: row(E2, 'B One') });
        const wsbBefore = wsbKeys();
        const errs = captureErrors();
        try {
            await cacheFallsBackWhileWsbIsActive(mode);
            await A.importRecord({ id: EX, name: 'Imported', type: 'person' });
            await A.update(E1, { description: 'edited under the fallback' });
        } finally { errs.restore(); }
        assert.equal(wsbKeys(), wsbBefore, 'wsb is byte-for-byte untouched');
        assert.deepEqual(ids('entities'), [E1, EX].sort(), 'both writes joined the default workspace\'s records — the page\'s workspace, as on origin/main');
        assert.equal(readJson('entities')[E1].description, 'edited under the fallback');

        await otherPageSwitchesTo('wsb');
        await A.importRecord({ id: E3, name: 'After The Switch', type: 'person' });
        assert.deepEqual(ids('ws:wsb:entities'), [E2, E3].sort(), 'after the next pointer change the page writes wsb again');
        assert.deepEqual(ids('entities'), [E1, EX].sort(), 'and leaves the default workspace alone');
    });
}

// The join: records (a plain read) and keys (the keystore Map, loaded by a
// strict VALUE read) come from the same cached pointer, so a record is only
// ever paired with its own workspace's key — in display, signing, the sync
// push and the case bundle that ships keys. Both workspaces hold the SAME
// entity id with different keys (TV2 in default, TV3 in wsb).
test('no straddle: with the cache fallen back to \'default\' and the pointer at wsb, every read, write, key join, signature, bundle and push acts on the default workspace alone', async () => {
    await reset();
    await Storage.primaryIdentity.set(TV1.privateKey);
    const kn = `entity:${E1}`;
    seed('entities', { [E1]: row(E1, 'Shared Name', { description: 'DEFAULT workspace text' }) });
    seed('local_keys', { [kn]: keyRecord(kn, TV2) });
    seed('ws:wsb:entities', { [E1]: row(E1, 'Shared Name', { description: 'WSB workspace text' }) });
    seed('ws:wsb:local_keys', { [kn]: keyRecord(kn, TV3) });
    const wsbBefore = wsbKeys();
    const errs = captureErrors();
    try { await cacheFallsBackWhileWsbIsActive(); } finally { errs.restore(); }
    await LocalKeyManager.refresh();                   // the keystore's own read — through the same cache

    const sent = [];
    const origPublish = NostrClient.publishToRelays;
    NostrClient.publishToRelays = async (relays, ev) => { sent.push(ev); return { successful: 1, total: 1, results: [] }; };
    let one, all, bundle, pushed, signed;
    try {
        one = await A.get(E1);
        all = await A.getAll();
        signed = await LocalKeyManager.signEvent({ kind: 0, content: '{}', tags: [], created_at: FIXED_TIME_S }, kn);
        bundle = await collectCaseBundle(E1);
        pushed = await pushEntities({ userPrivkey: TV1.privateKey, relays: ['wss://relay.example'] });
        await A.update(E1, { nip05: 'under@fallback.example' });
        await A.importRecord({ id: EX, name: 'Imported', type: 'person' });
        await A.create({ name: 'Made Under The Fallback', type: 'person' });
    } finally { NostrClient.publishToRelays = origPublish; }
    const convKey = await Crypto.nip44GetConversationKey(TV1.privateKey, TV1.pubkey);
    const payloads = [];
    for (const ev of sent.filter((e) => e.kind === 30078)) payloads.push(JSON.parse(await Crypto.nip44Decrypt(ev.content, convKey)));
    const isTV2 = (k) => !!k && k.pubkey === TV2.pubkey && (k.privateKey === undefined || k.privateKey === TV2.privateKey);

    assert.ok(LocalKeyManager.getKey(kn).pubkey === TV2.pubkey, 'the keystore refresh loaded the default workspace\'s keys');
    assert.equal(one.description, 'DEFAULT workspace text', 'get(): the default record…');
    assert.ok(isTV2(one.keypair), '…with the default workspace\'s key');
    assert.ok(all[E1].description === 'DEFAULT workspace text' && isTV2(all[E1].keypair), 'getAll(): the same pair');
    assert.equal(signed.pubkey, TV2.pubkey, 'signEvent signs with the default workspace\'s key');
    const shipped = bundle.entities.find((e) => e.id === E1);
    assert.ok(shipped.description === 'DEFAULT workspace text' && shipped.privkey === TV2.privateKey, 'the case bundle ships the default record with its own key');
    const p = payloads.find((x) => x.id === E1);
    assert.ok(pushed.pushed >= 1 && p && p.description === 'DEFAULT workspace text' && p.keypair.privateKey === TV2.privateKey,
        'the sync push publishes the default record with its own key');
    const ents = readJson('entities');
    const madeId = Object.keys(ents).find((id) => ![E1, EX].includes(id));
    assert.equal(ents[E1].nip05, 'under@fallback.example', 'the update landed in the default workspace');
    assert.ok(ents[EX] && madeId, 'so did the import and the create');
    assert.ok(readJson('local_keys')[ents[madeId].keyName], 'and the created entity\'s key is in the default workspace\'s keystore');
    assert.equal(await resolveActiveDbName('xray-archive'), 'xray-archive', 'the IndexedDB names resolve the same cached workspace');
    assert.equal(await wsKeysActiveWorkspaceId(), 'default', 'as does every workspace-keys caller (the LLM-job scope)');
    assert.equal(wsbKeys(), wsbBefore, 'wsb is byte-for-byte untouched');

    await otherPageSwitchesTo('wsb');                  // the pointer changes: the cache re-reads, the Map refreshes
    await LocalKeyManager.refresh();
    const again = await A.get(E1);
    assert.ok(again.description === 'WSB workspace text' && again.keypair.pubkey === TV3.pubkey, 'following the pointer again, the page pairs wsb\'s record with wsb\'s key');
    const ok = await LocalKeyManager.signEvent({ kind: 0, content: '{}', tags: [], created_at: FIXED_TIME_S }, kn);
    assert.equal(ok.pubkey, TV3.pubkey, 'and signs with it');
    assert.equal(await resolveActiveDbName('xray-archive'), 'xray-archive::wsb');
});

// Both workspaces hold the SAME entity id: default with TV2, wsb with TV3.
function sameEntityInTwoWorkspaces({ defaultUpdated = FIXED_TIME_S, wsbUpdated = FIXED_TIME_S } = {}) {
    const kn = `entity:${E1}`;
    seed('entities', { [E1]: row(E1, 'Shared Name', { description: 'DEFAULT workspace text', updated: defaultUpdated }) });
    seed('local_keys', { [kn]: keyRecord(kn, TV2) });
    seed('ws:wsb:entities', { [E1]: row(E1, 'Shared Name', { description: 'WSB workspace text', updated: wsbUpdated }) });
    seed('ws:wsb:local_keys', { [kn]: keyRecord(kn, TV3) });
    return kn;
}
const unsignedProfile = () => ({ kind: 0, content: '{}', tags: [], created_at: FIXED_TIME_S });
/** Page code that runs on every pointer change (the side panel re-renders). Returns its remover. */
function onPointerChange(fn) {
    const l = (changes) => { if ('active_workspace' in changes) fn(); };
    _areaListeners.push(l);
    return () => { _areaListeners.splice(_areaListeners.indexOf(l), 1); };
}
/** Another page's switch, landing synchronously inside whatever is running. */
function switchNow(ws) {
    _store.set('active_workspace', JSON.stringify(ws));
    emit({ active_workspace: { newValue: JSON.stringify(ws) } });
}
async function pushCapture() {
    const sent = [];
    const origPublish = NostrClient.publishToRelays;
    NostrClient.publishToRelays = async (relays, ev) => { sent.push(ev); return { successful: 1, total: 1, results: [] }; };
    let pushed;
    try { pushed = await pushEntities({ userPrivkey: TV1.privateKey, relays: ['wss://relay.example'] }); } finally { NostrClient.publishToRelays = origPublish; }
    const convKey = await Crypto.nip44GetConversationKey(TV1.privateKey, TV1.pubkey);
    const payloads = [];
    for (const ev of sent.filter((e) => e.kind === 30078)) payloads.push(JSON.parse(await Crypto.nip44Decrypt(ev.content, convKey)));
    return { pushed, payloads };
}

// SINGLE FLIGHT: every caller that finds the cache empty shares ONE pointer
// read, so one failed read can never hand one caller the fallback and
// another the real pointer (the verifiers' erase2 and race probes).
test('single flight: page code racing the keystore\'s re-read after a switch shares its ONE pointer read — a plain read-modify-write stays in one workspace', async () => {
    await reset();
    await seedClaims();
    let rmw = null, other = null;
    const off = onPointerChange(() => {
        rmw = (async () => { const snap = await Storage.get('article_claims', {}); snap.claim_new = claim('claim_new', 'new'); return Storage.set('article_claims', snap); })();
        other = Storage.get('platform_accounts', {});
    });
    const errs = captureErrors();
    failReads('pointer', 'lastError', { skip: 1, times: 1 });   // a SECOND pointer read would fail
    try { await otherPageSwitchesTo('wsb'); await rmw; await other; await settle(); } finally { off(); fail.pointer = null; errs.restore(); }
    assert.equal(await Storage.activeWorkspaceId(), 'wsb', 'one read, one answer');
    assert.deepEqual(ids('ws:wsb:article_claims'), ['claim_new', 'claim_w1', 'claim_w2'], 'wsb keeps both its claims and gains the new one');
    assert.deepEqual(ids('article_claims'), ['claim_d1'], 'the default workspace neither lost nor gained a claim');
});

test('single flight: the keystore\'s refresh and a re-render racing it get ONE answer, even a failed one — each record is shown, signed and bundled with its own workspace\'s key', async () => {
    await reset();
    await Storage.primaryIdentity.set(TV1.privateKey);
    const kn = sameEntityInTwoWorkspaces();
    await LocalKeyManager.refresh();
    let rerender = null;
    const off = onPointerChange(() => { rerender = A.getAll(); });
    const errs = captureErrors();
    failReads('pointer', 'lastError', { times: 1 });   // the one shared read fails
    try { await otherPageSwitchesTo('wsb'); await rerender; await settle(); } finally { off(); fail.pointer = null; errs.restore(); }
    const shown = await rerender;
    const one = await A.get(E1);
    const signed = await LocalKeyManager.signEvent(unsignedProfile(), kn);
    const shipped = (await collectCaseBundle(E1)).entities.find((e) => e.id === E1);
    assert.equal(await Storage.activeWorkspaceId(), 'default', 'the page took the fallback, consistently (as on main — a named follow-up)');
    assert.ok(shown[E1].description === 'DEFAULT workspace text' && shown[E1].keypair.pubkey === TV2.pubkey, 'the re-render: the default record with its own key');
    assert.ok(one.description === 'DEFAULT workspace text' && one.keypair.pubkey === TV2.pubkey, 'get(): the same pair');
    assert.equal(signed.pubkey, TV2.pubkey, 'signEvent: the default workspace\'s key, for the default workspace\'s record');
    assert.ok(shipped.description === 'DEFAULT workspace text' && shipped.privkey === TV2.privateKey, 'the case bundle: one workspace\'s record with its own key');
});

test('a pointer read that started before a switch never fills the cache after it — the page re-reads instead of keeping the old workspace', async () => {
    await reset();
    const invalidate = (ws) => {                       // storage.js's own listener (registered first)
        _store.set('active_workspace', JSON.stringify(ws));
        _areaListeners[0]({ active_workspace: { newValue: JSON.stringify(ws) } });
    };
    invalidate('default');
    assert.equal(Storage.cachedWorkspaceId(), undefined, 'sanity: the cache is cold');
    const early = Storage.activeWorkspaceId();         // its read snapshots 'default'…
    invalidate('wsb');                                  // …and the switch lands before it returns
    assert.equal(await early, 'default', 'sanity: the early caller got the pointer as it was when it asked');
    assert.equal(await Storage.activeWorkspaceId(), 'wsb', 'the next caller reads the pointer afresh');
});

// THE KEYSTORE MAP answers only while the page's pointer names the workspace
// it was loaded under: a Map kept from before a switch (a failed refresh, or
// the refresh still in flight) serves no key at all.
test('the keystore Map answers only for its own workspace: after a switch whose keystore read fails, nothing is shown, signed, bundled or pushed with the previous workspace\'s key', async () => {
    await reset();
    await Storage.primaryIdentity.set(TV1.privateKey);
    const kn = sameEntityInTwoWorkspaces();
    await LocalKeyManager.refresh();
    assert.equal(LocalKeyManager.getKey(kn).pubkey, TV2.pubkey, 'sanity: the Map holds the default workspace\'s key');
    const errs = captureErrors();
    failReads('keystore', 'lastError', { times: 1 });   // the refresh the switch triggers
    try { await otherPageSwitchesTo('wsb'); } finally { fail.keystore = null; errs.restore(); }
    assert.equal(await Storage.activeWorkspaceId(), 'wsb', 'sanity: the page follows the switch');
    assert.ok(LocalKeyManager.keys.has(kn), 'sanity: the failed refresh kept the previous Map');

    const one = await A.get(E1);
    const all = await A.getAll();
    const signErr = await attempt(() => LocalKeyManager.signEvent(unsignedProfile(), kn));
    const shipped = (await collectCaseBundle(E1)).entities.find((e) => e.id === E1);
    const { pushed, payloads } = await pushCapture();
    assert.ok(one.description === 'WSB workspace text' && one.keypair === null, 'get(): wsb\'s record, with NO key — never the default workspace\'s');
    assert.equal(all[E1].keypair, null, 'getAll(): the same');
    assert.match(String(signErr && signErr.message), /Key not found/, 'signEvent refuses instead of signing with the default workspace\'s key');
    assert.ok(shipped && !shipped.privkey, 'the case bundle ships no private key with wsb\'s record');
    assert.ok(pushed.pushed === 0 && payloads.length === 0, 'the sync push publishes no record with a key');
    assert.deepEqual(LocalKeyManager.listKeys(), [], 'listKeys serves nothing either');

    await LocalKeyManager.refresh();                   // readable again
    const again = await A.get(E1);
    assert.ok(again.description === 'WSB workspace text' && again.keypair.pubkey === TV3.pubkey, 'with wsb\'s keys loaded, wsb\'s record gets its own key');
});

test('the keystore Map answers only for its own workspace: between this page\'s switch and the refresh it triggers, no key is served', async () => {
    await reset();
    const kn = sameEntityInTwoWorkspaces();
    await LocalKeyManager.refresh();
    await Storage.setActiveWorkspaceId('wsb');        // the change event is still queued
    assert.ok(LocalKeyManager.keys.has(kn), 'sanity: the Map still holds the default workspace\'s key');
    assert.equal(LocalKeyManager.getKey(kn), null, 'getKey serves nothing from the previous workspace');
    await assert.rejects(() => LocalKeyManager.signEvent(unsignedProfile(), kn), /Key not found/, 'signEvent refuses');
    await settle();                                    // the event: the Map refreshes under wsb
    assert.equal(LocalKeyManager.getKey(kn).pubkey, TV3.pubkey, 'then wsb\'s own key');
});

// A STEP of an operation planned in one workspace never lands in another:
// a switch from another page mid-operation refuses the rest (nothing is
// redone in the new workspace — the plan was never read there).
test('a create that another page\'s switch interrupts after its plan makes nothing — no record and no key in either workspace', async () => {
    await reset();
    await Storage.primaryIdentity.set(TV1.privateKey);
    seed('ws:wsb:entities', { [E2]: row(E2, 'B One') });
    const wsbBefore = wsbKeys();
    onRegistryRead(1, () => otherPageSwitchesTo('wsb'));   // create's planning read (the default workspace's)
    const errs = captureErrors();
    let err;
    try { err = await attempt(() => A.create({ name: 'Fresh Person', type: 'person' })); } finally { errs.restore(); }
    assert.equal(wsbKeys(), wsbBefore, 'wsb gained no record and no key');
    assert.deepEqual(ids(), [], 'the default workspace gained no record…');
    assert.deepEqual(Object.keys(readJson('local_keys')), [], '…and no orphan key');
    assertRefused(err, 'create');
    assert.equal(err.name, 'StoreRefusedError');
});

test('a delete that another page\'s switch interrupts never reaches into that workspace: wsb keeps its record AND its key', async () => {
    await reset();
    const kn = sameEntityInTwoWorkspaces();
    await LocalKeyManager.refresh();
    _registryWriteHook = () => switchNow('wsb');       // lands right on the record delete
    const errs = captureErrors();
    let ok;
    try { ok = await A.delete(E1); } finally { errs.restore(); }
    await settle();
    assert.ok(readJson('ws:wsb:entities')[E1], 'wsb\'s record stays');
    assert.ok(readJson('ws:wsb:local_keys')[kn].privateKey === TV3.privateKey, 'wsb\'s key stays (value not printed)');
    assert.equal(readJson('entities')[E1], undefined, 'the default record is gone — the delete ran there');
    assert.ok(readJson('local_keys')[kn], 'its key stays behind (the key delete refused rather than follow the switch; nothing points at it)');
    assert.equal(ok, true);
});

test('a pull that another page\'s switch interrupts after its plan installs no key and writes no row — wsb\'s fresher record keeps its own key', async () => {
    await reset();
    await Storage.primaryIdentity.set(TV1.privateKey);
    const kn = sameEntityInTwoWorkspaces({ defaultUpdated: FIXED_TIME_S, wsbUpdated: FIXED_TIME_S + 1000 });
    await LocalKeyManager.refresh();
    const pulled = { id: E1, name: 'Shared Name', type: 'person', created: FIXED_TIME_S, updated: FIXED_TIME_S + 500,
        keypair: { privateKey: TV1.privateKey, pubkey: TV1.pubkey, npub: TV1.npub, nsec: TV1.nsec } };
    const ev = await syncEvent(pulled, 'ev-mid-switch');   // fresher than default's record, staler than wsb's
    onRegistryRead(1, () => otherPageSwitchesTo('wsb'));   // the pull's planning read (the default workspace's)
    const errs = captureErrors();
    let out;
    try { out = await pullWith([ev]); } finally { errs.restore(); }
    assert.ok(readJson('ws:wsb:local_keys')[kn].privateKey === TV3.privateKey, 'wsb\'s key was not replaced (value not printed)');
    assert.equal(readJson('ws:wsb:entities')[E1].updated, FIXED_TIME_S + 1000, 'wsb\'s record is as it was');
    assert.ok(readJson('local_keys')[kn].privateKey === TV2.privateKey && readJson('entities')[E1].updated === FIXED_TIME_S,
        'and the default workspace, where it planned, is untouched too');
    assert.ok(out.failed === 1 && out.updated === 0 && out.added === 0, 'the pull reports the refusal as a failure');
});

// RECORDS AND PLANS HELD ACROSS A SWITCH (the verifiers' probes T4, T6–T8 and
// the case-bundle probe). A record read before another page's switch, a
// bundle collected across one, an import whose key and record straddle one,
// and an import judging "is a key installed?" from a Map that has not caught
// up: each is refused (or judged from storage) — never paired with another
// workspace's key.
/** One-shot: `fn` runs after the first raw write of `key` landed, before its callback. */
function onRawWrite(key, fn) {
    const orig = localArea.set;
    localArea.set = function (obj, cb) {
        if (!(key in obj)) return orig.call(this, obj, cb);
        localArea.set = orig;
        const r = orig.call(this, obj, cb);
        fn();
        return r;
    };
    return () => { const fired = localArea.set === orig; localArea.set = orig; return fired; };
}
/** One-shot: `fn` runs after the first read of a key matching `pred` took its snapshot, before the reader sees it. */
function onKeyRead(pred, fn) {
    const orig = localArea.get;
    localArea.get = function (keys, cb) {
        if (keys === null || ![].concat(keys).some(pred)) return orig.call(this, keys, cb);
        localArea.get = orig;
        return orig.call(this, keys, (res) => { Promise.resolve().then(fn).then(() => cb(res)); });
    };
    return () => { const fired = localArea.get === orig; localArea.get = orig; return fired; };
}

test('T7: a record read before a switch is never signed with the key the new workspace holds under the same name — signEvent refuses a key that does not hold the event\'s pubkey', async () => {
    await reset();
    const kn = sameEntityInTwoWorkspaces();
    await otherPageSwitchesTo('wsb');
    await LocalKeyManager.refresh();
    const entity = await A.get(E1);                    // wsb's record with wsb's key (TV3)
    const unsigned = { ...unsignedProfile(), pubkey: entity.keypair.pubkey };   // as buildProfileEvent sets it
    await otherPageSwitchesTo('default');              // lands during the publish's own awaits
    await LocalKeyManager.refresh();
    assert.equal(LocalKeyManager.getKey(kn).pubkey, TV2.pubkey, 'sanity: the Map now serves the default workspace\'s key under that name');
    const err = await attempt(() => LocalKeyManager.signEvent(unsigned, kn));
    assert.equal(unsigned.sig, undefined, 'nothing was signed');
    assert.match(String(err && err.message), /Key mismatch: entity:\S+ does not hold the event's pubkey/);
    const ok = await LocalKeyManager.signEvent({ ...unsignedProfile(), pubkey: TV2.pubkey }, kn);
    assert.ok(ok.pubkey === TV2.pubkey && await Crypto.verifySignature(ok), 'an event whose pubkey the key holds still signs');
});

test('T4: a case-bundle import that another page\'s switch interrupts between a row\'s key and its record writes the record nowhere — never beside the other workspace\'s different key', async () => {
    await reset();
    await otherPageSwitchesTo('wsb');
    const kn2 = `entity:${E2}`;
    seed('entities', { [E2]: row(E2, 'Default E2', { description: 'DEFAULT E2' }) });
    seed('local_keys', { [kn2]: keyRecord(kn2, TV3) });   // a DIFFERENT key — the conflict the import would refuse
    const defaultBefore = [_store.get('entities'), _store.get('local_keys')];
    const bundle = { format: CASE_BUNDLE_FORMAT, version: 1, case_id: E2,
        entities: [{ ...row(E2, 'Bundle E2', { description: 'BUNDLE E2' }), privkey: TV2.privateKey }] };
    const unhook = onRawWrite('ws:wsb:local_keys', () => switchNow('default'));
    let out, err;
    try { err = await attempt(async () => { out = await importCaseBundle(bundle); }); } finally { assert.ok(unhook(), 'sanity: the switch landed right after the key write'); }
    await settle();
    assert.deepEqual([_store.get('entities'), _store.get('local_keys')], defaultBefore, 'the default workspace is untouched: no bundle record beside its different key');
    assert.equal(readJson('ws:wsb:entities')[E2], undefined, 'and no record in wsb either — the step was refused, not redone');
    assert.equal(out, undefined, 'no import summary');
    assert.equal(err && err.name, 'StoreRefusedError');
});

// Default holds the case and E1 (TV2); wsb holds E1 with TV3. Each switch
// point lands another page's switch to wsb mid-collection.
const EC = 'entity_000000000000cafe';
function seedCaseInTwoWorkspaces() {
    const kn = sameEntityInTwoWorkspaces();
    const all = readJson('entities');
    seed('entities', { ...all, [EC]: row(EC, 'The Case', { type: 'case', keyName: null }) });
    seed('article_claims', { claim_1: { ...claim('claim_1', 'about the case'), about: [EC, E1] } });
    return kn;
}
for (const [where, arm] of [
    ['the orbit\'s claims read', () => onKeyRead((k) => k === 'article_claims', () => otherPageSwitchesTo('wsb'))],
    ['the orbit\'s claims read, there and back', () => onKeyRead((k) => k === 'article_claims', async () => { await otherPageSwitchesTo('wsb'); await otherPageSwitchesTo('default'); })],
    ['the first registry read', () => { onRegistryRead(1, () => otherPageSwitchesTo('wsb')); return () => _registryHook === null; }],
    ['the second registry read', () => { onRegistryRead(2, () => otherPageSwitchesTo('wsb')); return () => _registryHook === null; }]
]) {
    test(`T6: a case bundle that another page's switch interrupts (${where}) produces no file — never one workspace's records or keys beside another's`, async () => {
        await reset();
        seedCaseInTwoWorkspaces();
        await LocalKeyManager.refresh();
        const unhook = arm();
        let out, err;
        try { err = await attempt(async () => { out = await collectCaseBundle(EC); }); } finally { const fired = unhook(); _registryHook = null; assert.ok(fired, 'sanity: the switch landed mid-bundle'); }
        assert.equal(out, undefined, 'no bundle (it ships private keys)');
        assert.equal(err && err.name, 'StoreRefusedError');
        assert.match(err.message, /workspace changed mid-bundle — no file/);
    });
}

test('T6 control: with no switch the case bundle ships each record with its own workspace\'s key', async () => {
    await reset();
    seedCaseInTwoWorkspaces();
    await LocalKeyManager.refresh();
    const bundle = await collectCaseBundle(EC);
    assert.equal(bundle.case_id, EC);
    const e1 = bundle.entities.find((e) => e.id === E1);
    assert.ok(e1.description === 'DEFAULT workspace text' && e1.privkey === TV2.privateKey, 'the default record with its own key (value not printed)');
});

test('T8: an import judging "is a key installed?" while the Map has not caught up with a switch never downgrades a keyed entity to foreign, nor adopts a shadow of it', async () => {
    await reset();
    const kn = sameEntityInTwoWorkspaces();
    await LocalKeyManager.refresh();
    const errs = captureErrors();
    failReads('keystore', 'lastError', { times: 1 });   // the refresh the switch triggers
    try { await otherPageSwitchesTo('wsb'); } finally { fail.keystore = null; errs.restore(); }
    assert.equal(LocalKeyManager.getKey(kn), null, 'sanity: the Map (the default workspace\'s) serves nothing in wsb');
    const imported = await A.importRecord({ id: E1, name: 'Shared Name', type: 'person', foreign_pubkey: TV1.pubkey });
    const adopted = await B.importForeign({ name: 'Somebody', type: 'person', pubkey: TV3.pubkey });
    const w = readJson('ws:wsb:entities');
    assert.ok(w[E1].keyName === kn && !w[E1].foreign_pubkey, 'wsb\'s E1 keeps its key binding — not downgraded to foreign');
    assert.equal(imported.id, E1);
    assert.deepEqual(Object.keys(w), [E1], 'no foreign shadow of wsb\'s own keyed entity was adopted');
    assert.equal(adopted.id, E1, 'importForeign returns the local keyed entity');
    assert.ok(readJson('ws:wsb:local_keys')[kn].privateKey === TV3.privateKey, 'wsb\'s key is still stored (value not printed)');
});

test('a destructive check on a cold cache adopts the pointer it verified — no fallback read is cached behind it', async () => {
    await reset();
    _store.set('active_workspace', JSON.stringify('wsb'));
    _areaListeners[0]({ active_workspace: { newValue: JSON.stringify('wsb') } });   // storage.js's own listener (registered first): cold, nothing in flight
    assert.equal(Storage.cachedWorkspaceId(), undefined, 'sanity: the cache is cold');
    failReads('pointer', 'lastError', { skip: 1 });   // the strict read succeeds; any later pointer read would fail
    let verified;
    try { verified = await Storage.verifiedWorkspaceId('probe'); } finally { fail.pointer = null; }
    assert.equal(verified, 'wsb');
    assert.equal(await Storage.activeWorkspaceId(), 'wsb', 'the page follows the pointer it just verified');
});

// ---- 3. destructive wholesale operations verify the page's pointer first ---------
// Each acts on the page's cached workspace only when a STRICT re-read of the
// pointer agrees with it; unreadable or different, it refuses with a
// StoreRefusedError before writing, deleting or producing anything.

const WORKSPACES = { default: { id: 'default', label: 'Default workspace' }, wsb: { id: 'wsb', label: 'B' }, wsc: { id: 'wsc', label: 'C' } };
function seedThreeWorkspaces() {
    seed('workspaces', WORKSPACES);
    seed('entities', { [E1]: row(E1, 'Default One') });
    seed('article_claims', { d1: { id: 'd1' } });
    seed('ws:wsb:entities', { [E2]: row(E2, 'B One') });
    seed('ws:wsb:article_claims', { b1: { id: 'b1' } });
    seed('ws:wsc:entities', { [EX]: row(EX, 'C One') });
}
const storeSnapshot = () => JSON.stringify([..._store.entries()].sort());
const fromFile = () => backupWith({ entities: JSON.stringify({ [E3]: row(E3, 'From File') }) });
// Stamped newer than any schema: the version check would refuse it too, after opening
// the databases — so a pointer refusal proves it came FIRST, before anything opened.
const newerFile = () => ({ ...fromFile(), dbVersions: { 'xray-archive': 9999 } });
const DESTRUCTIVE = [
    ['resetWorkspace', () => resetWorkspace({ idb: NO_IDB })],
    ['Workspaces.remove', () => Workspaces.remove('wsc', { idb: NO_IDB })],
    ['applyBackup (replace-all restore)', () => applyBackup(newerFile())],
    ['mergeBackup', () => mergeBackup(newerFile())],
    ['collectBackup (export)', () => collectBackup()],
    ['workspaceBackup (the reset\'s safety file)', () => workspaceBackup()]
];
function assertStoreRefused(err, label) {
    assertRefused(err, label);
    assert.equal(err.name, 'StoreRefusedError', `${label}: a typed store refusal (got ${err.name}: ${err.message})`);
}

for (const [label, run] of DESTRUCTIVE) {
    test(`${label}: refused, nothing changed, when the page's cached pointer ('default', fallen back) differs from the stored one (wsb)`, async () => {
        await reset();
        seedThreeWorkspaces();
        const errs = captureErrors();
        try { await cacheFallsBackWhileWsbIsActive(); } finally { errs.restore(); }
        const before = storeSnapshot();
        let out;
        const err = await attempt(async () => { out = await run(); });
        assert.equal(storeSnapshot(), before, 'storage is byte-for-byte unchanged');
        assert.equal(out, undefined, 'nothing was produced (no file to download)');
        assertStoreRefused(err, label);
    });

    for (const mode of ['lastError', 'throw', 'ffLastError']) {
        test(`${label}: refused, nothing changed, when the strict pointer read fails (${mode})`, async () => {
            await reset();
            seedThreeWorkspaces();
            assert.equal(await Storage.activeWorkspaceId(), 'default', 'sanity: the cache is warm and right');
            const before = storeSnapshot();
            let out, err;
            failReads('pointer', mode);
            try { err = await attempt(async () => { out = await run(); }); } finally { fail.pointer = null; }
            assert.equal(storeSnapshot(), before, 'storage is byte-for-byte unchanged');
            assert.equal(out, undefined, 'nothing was produced (no file to download)');
            assertStoreRefused(err, label);
        });
    }
}

test('with the pointer verified (cache == stored == wsb), every destructive operation proceeds — on wsb, and only wsb', async () => {
    await reset();
    seedThreeWorkspaces();
    await otherPageSwitchesTo('wsb');
    const defaultBefore = [_store.get('entities'), _store.get('article_claims')];

    const exported = await collectBackup();
    assert.deepEqual(Object.keys(JSON.parse(exported.storage.entities)), [E2], 'the export holds wsb\'s registry');
    const safety = await workspaceBackup();
    assert.equal(safety.workspace, 'wsb', 'the safety file names its workspace');
    assert.deepEqual(Object.keys(safety.data.entities), [E2], 'and holds wsb\'s registry');
    await mergeBackup(fromFile());
    assert.deepEqual(ids('ws:wsb:entities'), [E2, E3].sort(), 'the merge accrued into wsb');
    await applyBackup(backupWith({ entities: JSON.stringify({ [E1]: row(E1, 'Restored') }) }));
    assert.deepEqual(ids('ws:wsb:entities'), [E1], 'the restore replaced wsb\'s registry');
    assert.equal(_store.has('ws:wsb:article_claims'), false, 'and its other content');
    await Workspaces.remove('wsc', { idb: NO_IDB });
    assert.equal(_store.has('ws:wsc:entities'), false, 'removing wsc deleted its data');
    const removal = await attempt(() => Workspaces.remove('wsb', { idb: NO_IDB }));
    assert.match(String(removal && removal.message), /switch away from the active workspace/, 'removing the active workspace is refused');
    seed('ws:wsb:article_claims', { b2: { id: 'b2' } });
    await resetWorkspace({ idb: NO_IDB, workspace: safety.workspace });
    assert.ok(!_store.has('ws:wsb:entities') && !_store.has('ws:wsb:article_claims'), 'the reset cleared wsb');
    assert.deepEqual([_store.get('entities'), _store.get('article_claims')], defaultBefore, 'the default workspace was never touched');
});

test('the reset clears exactly the workspace its safety file holds, and refuses any other', async () => {
    await reset();
    seedThreeWorkspaces();
    await otherPageSwitchesTo('wsb');
    const safety = await workspaceBackup();
    assert.equal(safety.workspace, 'wsb');
    assert.deepEqual(safety.data.entities, readJson('ws:wsb:entities'), 'the file holds wsb\'s registry');
    await otherPageSwitchesTo('wsc');                  // another page switches between the download and the reset
    const before = storeSnapshot();
    const err = await attempt(() => resetWorkspace({ idb: NO_IDB, workspace: safety.workspace }));
    assert.equal(storeSnapshot(), before, 'nothing cleared: this page now verifies wsc, which the file does not hold');
    assertStoreRefused(err, 'resetWorkspace');
    await otherPageSwitchesTo('wsb');
    await resetWorkspace({ idb: NO_IDB, workspace: safety.workspace });
    assert.equal(_store.has('ws:wsb:entities'), false, 'with the page back on wsb, the reset cleared wsb — the file\'s workspace');
    assert.ok(_store.has('entities') && _store.has('ws:wsc:entities'), 'and nothing else');
});

for (const [label, start, expect] of [
    ['a workspace reset', () => resetWorkspace({ idb: NO_IDB }), /nothing written/],
    ['a replace-all restore', () => applyBackup(fromFile()), /nothing written/],
    ['a merge-import', () => mergeBackup(fromFile()), /nothing written/]
]) {
    test(`${label} whose workspace is switched while it waits for the locks writes nothing`, async () => {
        await reset();
        seedThreeWorkspaces();
        const before = storeSnapshot();
        let release;
        const holding = withEntityStoreLock(() => new Promise((r) => { release = r; }));
        const running = start();                      // verifies 'default', then waits on the registry lock
        await settle();
        await otherPageSwitchesTo('wsb');
        const afterSwitch = storeSnapshot();
        release();
        await holding;
        const err = await attempt(() => running);
        assert.notEqual(afterSwitch, before, 'sanity: the switch itself wrote the pointer');
        assert.equal(storeSnapshot(), afterSwitch, 'nothing was written after the switch — in either workspace');
        assert.match(String(err && err.message), expect, `${label}: refused`);
    });
}

test('the safety backup a reset downloads first refuses on a failed registry read — the reset flow never clears after an empty file', async () => {
    await reset();
    seed('entities', { [E1]: row(E1, 'One') });
    failReads('registry', 'lastError');
    let err, snapshot;
    try {
        err = await attempt(async () => { snapshot = await workspaceBackup(); });
    } finally { fail.registry = null; }
    assert.equal(snapshot, undefined, 'no safety file was produced without the registry in it');
    assert.ok(err, 'the backup rejected, so the Options flow stops before resetWorkspace');
    assert.deepEqual(ids(), [E1], 'and the registry is still there');
});

test('a merge-import whose read of current storage fails refuses instead of writing the file\'s registry over the local one', async () => {
    await reset();
    seed('entities', { [E1]: row(E1, 'Local One'), [E2]: row(E2, 'Local Two') });
    failReads('all', 'lastError');
    let err;
    try { err = await attempt(() => mergeBackup(fromFile())); } finally { fail.all = null; }
    assert.deepEqual(ids(), [E1, E2], 'the local registry is as it was');
    assertStoreRefused(err, 'mergeBackup');
});

test('a replace-all restore whose read of current storage fails refuses instead of leaving stale content behind', async () => {
    await reset();
    seed('entities', { [E1]: row(E1, 'Local One') });
    seed('claims', { c1: { id: 'c1' } });
    failReads('all', 'lastError');
    let err;
    try { err = await attempt(() => applyBackup(fromFile())); } finally { fail.all = null; }
    assert.deepEqual(Object.keys(readJson('claims')), ['c1'], 'sanity: content outside the file is still there');
    assert.deepEqual(ids('entities'), [E1], 'nothing was half-replaced: the registry is the local one, not the file\'s beside stale claims');
    assertStoreRefused(err, 'applyBackup');
});

// MID-OPERATION: a multi-step destructive operation re-verifies right before
// each step resolves the workspace (a database open, a key read) in the same
// microtask chain, so every step acts on the verified workspace or the rest
// is refused. An IndexedDB transaction hook lands another page's switch in
// the middle of one database.
function onIdbTransaction(pred, fn) {
    const P = globalThis.IDBDatabase.prototype;
    const orig = P.transaction;
    let fired = false;
    P.transaction = function (stores, mode, ...rest) {
        if (!fired && pred(this.name, mode)) { fired = true; fn(); }
        return orig.call(this, stores, mode, ...rest);
    };
    return () => { P.transaction = orig; return fired; };
}
const EVENTS = Array.from((await openEventJournalDb()).objectStoreNames)[0];
async function putRow(open, store, value) {
    const db = await open();
    await new Promise((res, rej) => { const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).put(value); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
}
async function rowKeys(open, store, field) {
    const db = await open();
    return new Promise((res) => { const r = db.transaction(store, 'readonly').objectStore(store).getAll(); r.onsuccess = () => res(r.result.map((x) => x[field])); });
}
const articleHashes = () => rowKeys(openArchiveDb, 'articles', 'urlHash');
/** Seed one article in wsb's archive (and come back to the default workspace). */
async function seedWsbArticle(hash) {
    await otherPageSwitchesTo('wsb');
    await putRow(openArchiveDb, 'articles', { urlHash: hash, url: `https://wsb.example/${hash}` });
    await otherPageSwitchesTo('default');
}

test('a replace-all restore that another page\'s switch interrupts mid-database stops before the next one — the other workspace\'s databases are untouched', async () => {
    await reset();
    seed('entities', { [E1]: row(E1, 'Default One') });
    await seedWsbArticle('h-wsb-restore');
    const file = { ...fromFile(), databases: { 'xray-events': { [EVENTS]: [] }, 'xray-archive': { articles: [] } } };
    const unhook = onIdbTransaction((name, mode) => name === 'xray-events' && mode === 'readwrite', () => switchNow('wsb'));
    let err;
    try { err = await attempt(() => applyBackup(file)); } finally { assert.ok(unhook(), 'sanity: the switch landed mid-restore'); }
    await settle();
    assert.equal(await Storage.activeWorkspaceId(), 'wsb', 'sanity: the page followed the switch');
    assert.ok((await articleHashes()).includes('h-wsb-restore'), 'wsb\'s archive was never cleared');
    assert.deepEqual(ids(), [E3], 'the default workspace\'s storage was restored before the switch');
    assert.equal(err && err.name, 'StoreRefusedError');
    assert.match(err.message, /stopped/);
});

test('a merge-import that another page\'s switch interrupts mid-database merges nothing into the other workspace, and reports what it did not merge', async () => {
    await reset();
    seed('entities', { [E1]: row(E1, 'Default One') });
    const file = { ...fromFile(), databases: { 'xray-events': { [EVENTS]: [] }, 'xray-archive': { articles: [{ urlHash: 'h-merged', url: 'https://merged.example/' }] } } };
    const unhook = onIdbTransaction((name, mode) => name === 'xray-events' && mode === 'readwrite', () => switchNow('wsb'));
    let result;
    try { result = await mergeBackup(file); } finally { assert.ok(unhook(), 'sanity: the switch landed mid-merge'); }
    await settle();
    assert.ok(!(await articleHashes()).includes('h-merged'), 'nothing was merged into wsb\'s archive');
    await otherPageSwitchesTo('default');
    assert.ok(!(await articleHashes()).includes('h-merged'), 'nor, after the switch, into the default one');
    assert.ok(ids().includes(E3), 'the storage merge that ran before the switch stands');
    assert.ok(result.errors.some((e) => e.database === 'xray-archive' && /stopped/.test(e.error)), 'the unmerged database is reported');
});

test('an export that another page\'s switch interrupts mid-dump produces no file — never one workspace\'s storage beside another\'s databases', async () => {
    await reset();
    seed('entities', { [E1]: row(E1, 'Default One') });
    await otherPageSwitchesTo('wsb');
    await putRow(openEventJournalDb, EVENTS, { eventId: 'ev-wsb-export', kind: 1, flush: { state: 'done' } });
    await otherPageSwitchesTo('default');
    const unhook = onIdbTransaction((name, mode) => name === 'xray-archive' && mode === 'readonly', () => switchNow('wsb'));
    let out, err;
    try { err = await attempt(async () => { out = await collectBackup(); }); } finally { assert.ok(unhook(), 'sanity: the switch landed mid-export'); }
    assert.equal(out, undefined, 'no file');
    assert.equal(err && err.name, 'StoreRefusedError');
});

test('the reset\'s safety backup that another page\'s switch interrupts mid-read produces no file — never one naming a workspace it only partly holds', async () => {
    await reset();
    seedThreeWorkspaces();
    onRegistryRead(1, () => otherPageSwitchesTo('wsb'));   // its first key read (the default workspace's registry)
    let snap, err;
    try { err = await attempt(async () => { snap = await workspaceBackup(); }); } finally { _registryHook = null; }
    assert.equal(snap, undefined, 'no safety file, so the Options flow never reaches the reset');
    assert.equal(err && err.name, 'StoreRefusedError');
});

test('a reset whose delete fails stops there: the stores after it and every database are left, and it says how far it got', async () => {
    await reset();
    seedThreeWorkspaces();
    const deleted = [];
    failReads('remove', 'lastError', { skip: 1, times: 1 });   // the first store clears; the second fails
    let err;
    try { err = await attempt(() => resetWorkspace({ idb: { deleteDatabase(name) { deleted.push(name); } } })); } finally { fail.remove = null; }
    assert.equal(_store.has('entities'), false, 'the first store was cleared');
    assert.ok(_store.has('article_claims'), 'the stores after the failed one are untouched');
    assert.deepEqual(deleted, [], 'no database was deleted after a failed store');
    assert.match(String(err && err.message), /clearing local_keys failed after 1 of/);
});

test('the wholesale writers nest the registry lock inside the keystore lock (restore, reset, removal); the merge takes the registry lock alone', async () => {
    await reset();
    seedThreeWorkspaces();
    const taken = [];
    const locks = { request(name, cb) { taken.push(name); return Promise.resolve().then(() => cb({ name })); } };
    const saved = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', { value: { locks }, configurable: true, writable: true });
    const order = {};
    try {
        for (const [label, run] of [
            ['applyBackup', () => applyBackup(fromFile())],
            ['mergeBackup', () => mergeBackup(fromFile())],
            ['Workspaces.remove', () => Workspaces.remove('wsc', { idb: NO_IDB })],
            ['resetWorkspace', () => resetWorkspace({ idb: NO_IDB })]
        ]) {
            taken.length = 0;
            await run();
            order[label] = [...taken];
        }
    } finally {
        if (saved) Object.defineProperty(globalThis, 'navigator', saved);
        else delete globalThis.navigator;
    }
    const nested = ['xray.local_keys', 'xray.entities'];
    assert.deepEqual(order, { applyBackup: nested, mergeBackup: ['xray.entities'], 'Workspaces.remove': nested, resetWorkspace: nested });
});

test('a replace-all restore or merge whose raw storage remove or write fails says so — never "restored" over an emptied workspace', async () => {
    await reset();
    seed('entities', { [E1]: row(E1, 'Local One') });
    seed('article_claims', { c1: { id: 'c1' } });
    let removeErr;
    failReads('remove', 'lastError');
    try { removeErr = await attempt(() => applyBackup(fromFile())); } finally { fail.remove = null; }
    assert.match(String(removeErr && removeErr.message), /removing storage keys failed/, 'the restore reports the failed remove…');
    assert.deepEqual(ids(), [E1], '…and writes nothing after it');
    let restoreErr, mergeErr;
    failReads('write', 'lastError');
    try {
        restoreErr = await attempt(() => applyBackup(fromFile()));
        mergeErr = await attempt(() => mergeBackup(fromFile()));
    } finally { fail.write = null; }
    assert.match(String(restoreErr && restoreErr.message), /writing storage failed/, 'the restore reports the failed write');
    assert.match(String(mergeErr && mergeErr.message), /writing storage failed/, 'so does the merge');
});

// ---- 4. two pages, one registry: no lost update ------------------------------

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

// ---- 5. the lock itself --------------------------------------------------------

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

test('each locked store has ONE fixed lock: no other key or lock name can be taken', async () => {
    await reset();
    seed('article_claims', { c1: { id: 'c1' } });
    const before = _store.get('article_claims');
    await assert.rejects(() => lockedReadModifyWrite({ key: 'article_claims', label: 'Probe', apply: () => ({ write: true }) }), /no lock is fixed/);
    await assert.rejects(() => withStoreLock('xray.something_else', async () => {}), /not a store lock/);
    assert.ok(_store.get('article_claims') === before, 'nothing was written');
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

// ---- 6. the source guard ------------------------------------------------------
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
