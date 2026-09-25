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
// Section 2 pins the pointer rule. PLAIN paths (Storage.get / set /
// delete / keys, the IndexedDB names) keep origin/main's: a failed read
// is 'default' (storage.js caches it), so a page's plain reads and
// writes agree.
// STRICT paths (getStrict and the locked writes on it, the backup
// restore / merge / export, the reset and its safety backup, workspace
// removal) re-read the pointer, never use that cache, fail closed, and
// write the workspace their read resolved. Two earlier cuts split a
// plain read from its write and erased the active workspace's records
// (the verifiers' probes S1–S3, now permanent below).
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
// (`write`: a write of the registry key fails by runtime.lastError).
const fail = { registry: null, pointer: null, all: null, write: null };
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
        if (Object.keys(obj).some(isRegistryKey) && takeFailure('write')) {
            later(() => withLastError('stub: write failed', () => cb && cb()));
            return;
        }
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
const { LocalKeyManager, lockedReadModifyWrite, withStoreLock } = await import('../src/shared/local-key-manager.js');
const { EntityModel: A, withEntityStoreLock } = await import('../src/shared/entity-model.js');
const { EntityModel: B } = await import('../src/shared/entity-model.js?page=B');
const { pullEntities, pushEntities, serializeEntityForSync } = await import('../src/shared/entity-sync.js');
const { NostrClient } = await import('../src/shared/nostr-client.js');
const { applyBackup, mergeBackup, collectBackup, BACKUP_FORMAT } = await import('../src/shared/backup.js');
const { resetWorkspace, workspaceBackup, Workspaces } = await import('../src/shared/identity-profiles.js');
const { ClaimModel } = await import('../src/shared/claim-model.js');
const { importCaseBundle, collectCaseBundle, CASE_BUNDLE_FORMAT } = await import('../src/shared/case-bundle.js');
const { activeWorkspaceId: wsKeysActiveWorkspaceId } = await import('../src/shared/workspace-keys.js');
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
    fail.registry = fail.pointer = fail.all = fail.write = null;
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

// ---- 2. the workspace pointer: plain paths fall back as on main, strict paths fail closed

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

// PLAIN paths keep origin/main's rule: a failed pointer read is 'default'
// and is CACHED, so the page's plain reads and plain writes resolve the
// same workspace until the pointer changes. Under a fault that misroutes
// a plain write into the default workspace (as on main — a listed
// follow-up) but never straddles: a read of one workspace is never
// written back into another. S1–S3 are the verifiers' probes; the rule
// they replaced (a fallen-back read marked its key, a later successful
// read cleared the mark) let S3 erase the active workspace's records.
const claim = (id, text) => ({ id, text, about: [], source: null, is_key: false, source_url: 'https://example.com/a', created: 1, updated: 1 });
/** Another page switches to wsb while this page's pointer reads fail; then exactly ONE more of them fails. */
async function switchToWsbThenFailOnePointerRead() {
    failReads('pointer', 'lastError');   // through the switch: the keystore's strict refresh cannot resolve it either
    await otherPageSwitchesTo('wsb');
    failReads('pointer', 'lastError', { times: 1 });
}
async function seedClaims() {
    seed('article_claims', { claim_d1: claim('claim_d1', 'DEFAULT workspace claim') });
    seed('ws:wsb:article_claims', { claim_w1: claim('claim_w1', 'wsb claim 1'), claim_w2: claim('claim_w2', 'wsb claim 2') });
}

test('S1: a failed pointer read inside a plain read-then-write (ClaimModel.create) erases nothing in the active workspace — main\'s outcome', async () => {
    await reset();
    await seedClaims();
    const errs = captureErrors();
    let made;
    try {
        await switchToWsbThenFailOnePointerRead();
        made = await ClaimModel.create({ text: 'A new claim made in wsb', source_url: 'https://example.com/b' });
    } finally { fail.pointer = null; errs.restore(); }
    assert.deepEqual(ids('ws:wsb:article_claims'), ['claim_w1', 'claim_w2'], 'wsb keeps its own claims and gains none of the default workspace\'s');
    assert.deepEqual(ids('article_claims'), ['claim_d1', made.id].sort(),
        'the claim lands beside what its own read saw — the default workspace, as on origin/main');
});

test('S2: Storage.initialize under a failed pointer read seeds nothing over the active workspace\'s accounts — main\'s outcome', async () => {
    await reset();
    seed('ws:wsb:platform_accounts', { acct1: { key: 'acct1' } });
    const errs = captureErrors();
    try {
        await switchToWsbThenFailOnePointerRead();
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
        await switchToWsbThenFailOnePointerRead();
        snap = await Storage.get('article_claims', {});
        fail.pointer = null;
        again = await Storage.get('article_claims', {});
        snap.claim_new = claim('claim_new', 'new');
        wrote = await Storage.set('article_claims', snap);
    } finally { fail.pointer = null; errs.restore(); }
    assert.deepEqual(ids('ws:wsb:article_claims'), ['claim_w1', 'claim_w2'], 'wsb\'s claims are intact');
    assert.deepEqual(ids('article_claims'), ['claim_d1', 'claim_new'], 'the write landed in the workspace both reads saw');
    assert.deepEqual(Object.keys(again), ['claim_d1'], 'the second read used the cached fallback — no read/write straddle');
    assert.equal(wrote, true);
    assert.equal(await Storage.activeWorkspaceId(), 'default', 'the page\'s plain cache holds the fallback');
    await otherPageSwitchesTo('wsb');
    assert.deepEqual(Object.keys(await Storage.get('article_claims', {})).sort(), ['claim_w1', 'claim_w2'],
        'the next pointer change re-reads it: plain reads follow the real workspace again');
});

// STRICT paths never use that cache: they re-read the pointer, fail closed,
// and write the workspace their read resolved.
test('a strict writer is correct while the page\'s plain cache holds a fallen-back \'default\': entity, key, reset and removal act on the ACTIVE workspace; the default one is untouched', async () => {
    await reset();
    await Storage.primaryIdentity.set(TV1.privateKey);
    seed('entities', { [E1]: row(E1, 'Default One') });
    seed('ws:wsb:entities', { [E2]: row(E2, 'B One') });
    seed('workspaces', { default: { id: 'default', label: 'Default workspace' }, wsb: { id: 'wsb', label: 'B' } });
    const errs = captureErrors();
    let during;
    try {
        await switchToWsbThenFailOnePointerRead();
        during = await Storage.get('entities', {});
    } finally { fail.pointer = null; errs.restore(); }
    assert.deepEqual(Object.keys(during), [E1], 'sanity: this page\'s plain read fell back to the default workspace');
    const defaultBefore = _store.get('entities');

    await A.update(E2, { description: 'strict write' });
    await A.importRecord({ id: EX, name: 'Imported', type: 'person' });
    await A.create({ name: 'Made In B', type: 'person' });
    const wsb = readJson('ws:wsb:entities');
    const madeId = Object.keys(wsb).find((id) => ![E2, EX].includes(id));
    assert.equal(wsb[E2].description, 'strict write', 'the update landed in wsb');
    assert.ok(wsb[EX] && madeId, 'so did the import and the create');
    assert.ok(readJson('ws:wsb:local_keys')[wsb[madeId].keyName], 'the created entity\'s key is in wsb\'s keystore');
    assert.ok(_store.get('entities') === defaultBefore, 'the default workspace registry is byte-for-byte unchanged');
    assert.equal(_store.has('local_keys'), false, 'and no keystore was written into the default workspace');

    // The export and the reset's safety backup read strictly too: under an
    // unreadable pointer the export refuses (it never exports 'default'), and
    // with the cache fallen back the safety file holds what the reset clears.
    failReads('pointer', 'lastError');
    const exported = await attempt(() => collectBackup());
    fail.pointer = null;
    assert.ok(exported && exported.name === 'StoreRefusedError', `an export under an unreadable pointer refuses (got ${exported && exported.message})`);
    const snap = await workspaceBackup();
    assert.deepEqual(snap.data.entities, readJson('ws:wsb:entities'), 'the safety backup is the ACTIVE workspace\'s registry, not the default one');

    const removal = await attempt(() => Workspaces.remove('wsb', { idb: NO_IDB }));
    assert.match(String(removal && removal.message), /switch away from the active workspace/, 'removing the ACTIVE workspace is refused, whatever the cache says');
    assert.ok(_store.has('ws:wsb:entities'), 'and wsb\'s data is still there');

    seed('article_claims', { d1: { id: 'd1' } });
    seed('ws:wsb:article_claims', { c1: { id: 'c1' } });
    await resetWorkspace({ idb: NO_IDB });
    assert.equal(_store.has('ws:wsb:article_claims'), false, 'the reset cleared wsb');
    assert.ok(snap.data.entities[E2] && !snap.data.entities[E1], 'so the safety file taken first holds what the reset cleared');
    assert.equal(_store.has('ws:wsb:entities'), false);
    assert.ok(_store.get('entities') === defaultBefore && _store.has('article_claims'), 'and left the default workspace alone');
    assert.equal(await Storage.activeWorkspaceId(), 'default', 'the strict paths left the plain cache as it was — plain reads and writes still agree');
});

// The keystore Map is loaded STRICTLY (it plans key writes), while the
// entity list is a PLAIN read. A record joins a key, and a key signs, only
// when the Map is the workspace that record came from — never one
// workspace's record with another's private key (display, kind-0 signing,
// entity-sync push, the case bundle that ships keys).
test('a fallen-back plain cache never pairs the default workspace\'s records with the active workspace\'s keys — not in display, signing, sync push or a case bundle', async () => {
    await reset();
    const kn = `entity:${E1}`;
    seed('entities', { [E1]: row(E1, 'Shared Name', { description: 'DEFAULT workspace text' }) });
    seed('local_keys', { [kn]: keyRecord(kn, TV2) });
    seed('ws:wsb:entities', { [E1]: row(E1, 'Shared Name', { description: 'WSB workspace text' }) });
    seed('ws:wsb:local_keys', { [kn]: keyRecord(kn, TV3) });
    const errs = captureErrors();
    try {
        await switchToWsbThenFailOnePointerRead();
        await Storage.get('entities', {});            // the page's plain cache falls back to 'default'
    } finally { fail.pointer = null; errs.restore(); }
    await LocalKeyManager.init();                     // as every page's init does: the Map is wsb's
    assert.equal(await Storage.activeWorkspaceId(), 'default', 'sanity: the plain cache fell back');

    const sent = [];
    const origPublish = NostrClient.publishToRelays;
    NostrClient.publishToRelays = async (relays, ev) => { sent.push(ev); return { successful: 1, total: 1, results: [] }; };
    let one, all, bundle, pushed, signed;
    try {
        one = await A.get(E1);
        all = await A.getAll();
        bundle = await collectCaseBundle(E1);
        pushed = await pushEntities({ userPrivkey: TV1.privateKey, relays: ['wss://relay.example'] });
        signed = await attempt(() => LocalKeyManager.signEvent({ kind: 0, content: '{}', tags: [], created_at: FIXED_TIME_S }, kn));
    } finally { NostrClient.publishToRelays = origPublish; }
    const convKey = await Crypto.nip44GetConversationKey(TV1.privateKey, TV1.pubkey);
    const payloadKeys = [];
    for (const ev of sent.filter((e) => e.kind === 30078)) {
        const p = JSON.parse(await Crypto.nip44Decrypt(ev.content, convKey));
        payloadKeys.push(p.keypair && (p.keypair.privateKey || p.keypair.privkey));
    }
    const wsbKey = (k) => !!k && (k.pubkey === TV3.pubkey || k.privateKey === TV3.privateKey);

    // The invariant (origin/main holds it too: its Map followed the cache).
    assert.equal(one.description, 'DEFAULT workspace text', 'sanity: the plain read shows the default workspace');
    assert.ok(!wsbKey(one.keypair), 'get(): the default record never carries wsb\'s key');
    assert.ok(!wsbKey(all[E1].keypair), 'getAll(): nor does the list');
    assert.ok(!bundle.entities.some((e) => e.privkey === TV3.privateKey), 'the case bundle ships no wsb key under a default record');
    assert.ok(!payloadKeys.includes(TV3.privateKey), 'the sync push publishes no wsb key under a default record');
    assert.ok(!(signed && signed.pubkey === TV3.pubkey), 'nothing is signed with wsb\'s key for the displayed (default) record');
    // How this branch holds it: the Map is loaded strictly (wsb's), so while
    // the two disagree the record reads keyless and signing refuses.
    assert.ok(LocalKeyManager.getKey(kn).pubkey === TV3.pubkey, 'the strictly-loaded Map holds wsb\'s key');
    assert.equal(one.keypair, null, 'the record reads keyless while the Map and the cache disagree');
    assert.equal(pushed.pushed, 0, 'so the push skips it');
    assert.ok(signed instanceof Error && /Key not found/.test(signed.message), 'and signing refuses');

    await otherPageSwitchesTo('wsb');                 // the pointer changes: the cache re-reads, the Map refreshes
    await LocalKeyManager.refresh();
    const again = await A.get(E1);
    assert.equal(again.description, 'WSB workspace text', 'with the cache following the pointer, the list shows wsb');
    assert.ok(again.keypair && again.keypair.pubkey === TV3.pubkey, 'and joins wsb\'s own key');
    const ok = await LocalKeyManager.signEvent({ kind: 0, content: '{}', tags: [], created_at: FIXED_TIME_S }, kn);
    assert.equal(ok.pubkey, TV3.pubkey, 'and signs with it');
});

test('a workspace reset whose workspace is switched while it waits for the locks clears nothing', async () => {
    await reset();
    seed('entities', { [E1]: row(E1, 'Default One') });
    seed('ws:wsb:entities', { [E2]: row(E2, 'B One') });
    const deleted = [];
    const idb = { deleteDatabase(name) { deleted.push(name); } };
    let release;
    const holding = withEntityStoreLock(() => new Promise((r) => { release = r; }));
    const resetting = resetWorkspace({ idb });   // reads the pointer ('default'), then waits on the registry lock
    await settle();
    await otherPageSwitchesTo('wsb');
    release();
    await holding;
    const err = await attempt(() => resetting);
    assert.deepEqual(ids('ws:wsb:entities'), [E2], 'the workspace switched to was not cleared');
    assert.deepEqual(ids('entities'), [E1], 'nor the one the reset started in');
    assert.deepEqual(deleted, [], 'and no database was deleted');
    assertRefused(err, 'resetWorkspace');
});

test('a Firefox-style failure (browser.runtime.lastError) is a failed pointer read too', async () => {
    const pointerArea = {
        get(keys, cb) {
            globalThis.browser.runtime.lastError = { message: 'stub: IO error' };
            try { cb({}); } finally { delete globalThis.browser.runtime.lastError; }
        }
    };
    globalThis.browser = { runtime: {}, storage: { local: pointerArea } };
    try {
        await assert.rejects(() => wsKeysActiveWorkspaceId({ strict: true }), /workspace pointer/);
        assert.equal(await wsKeysActiveWorkspaceId(), 'default', 'a plain caller still gets the default');
    } finally { delete globalThis.browser; }
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
