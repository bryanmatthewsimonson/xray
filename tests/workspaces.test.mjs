// Case-bound workspaces — Phase 28.1a (CASE_BOUND_WORKSPACES_KICKOFF
// §2/§4, §7 decisions 2026-07-19). The storage namespace: 'default'
// (or unset) = the bare keys an existing install already has (zero
// migration); any other workspace maps content keys to ws:<id>:<key>
// and suffixes the IDB names. The registry + pointer live OUTSIDE the
// namespace. Everything ships DARK: until something activates a
// non-default workspace, behavior is byte-identical.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const _store = new Map();
globalThis.chrome = {
    storage: {
        local: {
            get(keys, cb) {
                if (keys === null || keys === undefined) {   // fetch-all, as chrome.storage does
                    cb(Object.fromEntries(_store.entries()));
                    return;
                }
                const out = {};
                for (const k of Array.isArray(keys) ? keys : [keys]) if (_store.has(k)) out[k] = _store.get(k);
                cb(out);
            },
            set(obj, cb) { for (const [k, v] of Object.entries(obj)) _store.set(k, v); cb && cb(); },
            remove(keys, cb) { for (const k of Array.isArray(keys) ? keys : [keys]) _store.delete(k); cb && cb(); }
        }
    }
};

const { Storage } = await import('../src/shared/storage.js');
const { workspaceDbName, WORKSPACE_CONTENT_KEYS } = await import('../src/shared/workspace-keys.js');
const { Workspaces, IdentityProfiles, WORKSPACE_CLEAR_KEYS, WORKSPACE_DATABASES, DERIVED_CACHE_DATABASES,
        identityBindingState } =
    await import('../src/shared/identity-profiles.js');
const { LocalKeyManager } = await import('../src/shared/local-key-manager.js');

async function reset() {
    _store.clear();
    LocalKeyManager.keys.clear();
    await Storage.setActiveWorkspaceId('default');
    _store.delete('active_workspace');
}

// ---- key mapping ----------------------------------------------------

test('ws: the default workspace maps to BARE keys — an existing install IS the default workspace', async () => {
    await reset();
    await Storage.set('entities', { marker: 1 });
    assert.ok(_store.has('entities'), 'content key stored bare');
    assert.deepEqual(await Storage.get('entities'), { marker: 1 });
});

test('ws: a non-default workspace maps content keys to ws:<id>:<key>; globals stay bare', async () => {
    await reset();
    await Storage.setActiveWorkspaceId('ws_test1');
    await Storage.set('entities', { ws: 'one' });
    await Storage.set('preferences', { debug: true });
    assert.ok(_store.has('ws:ws_test1:entities'), 'content key prefixed');
    assert.ok(!_store.has('entities'), 'no bare write');
    assert.ok(_store.has('preferences'), 'config key NEVER prefixed');
    assert.deepEqual(await Storage.get('entities'), { ws: 'one' });
});

test('ws: workspaces are isolated — one workspace never reads another\'s content', async () => {
    await reset();
    await Storage.set('entities', { home: 'default' });
    await Storage.setActiveWorkspaceId('ws_a');
    assert.equal(await Storage.get('entities', null), null, 'default\'s content invisible from ws_a');
    await Storage.set('entities', { home: 'a' });
    await Storage.setActiveWorkspaceId('default');
    assert.deepEqual(await Storage.get('entities'), { home: 'default' }, 'default unchanged');
    await Storage.setActiveWorkspaceId('ws_a');
    assert.deepEqual(await Storage.get('entities'), { home: 'a' });
});

test('ws: keys() is the LOGICAL view — active prefix stripped, foreign workspaces invisible', async () => {
    await reset();
    await Storage.set('entities', { d: 1 });                 // default content
    await Storage.set('preferences', { p: 1 });              // global
    await Storage.setActiveWorkspaceId('ws_a');
    await Storage.set('entities', { a: 1 });
    const inA = await Storage.keys();
    assert.ok(inA.includes('entities'), 'own content bare');
    assert.ok(inA.includes('preferences'), 'globals visible');
    assert.ok(!inA.includes('ws:ws_a:entities'), 'no raw names leak');
    await Storage.setActiveWorkspaceId('default');
    const inDefault = await Storage.keys();
    assert.ok(inDefault.includes('entities'));
    assert.ok(!inDefault.some((k) => k.startsWith('ws:')), 'foreign workspace keys invisible');
});

test('ws: DB names — default bare, others suffixed; Storage follows the active pointer', async () => {
    await reset();
    assert.equal(workspaceDbName('xray-archive', 'default'), 'xray-archive');
    assert.equal(workspaceDbName('xray-archive', undefined), 'xray-archive');
    assert.equal(workspaceDbName('xray-archive', 'ws_a'), 'xray-archive::ws_a');
    assert.equal(await Storage.workspaceDbName('xray-audits'), 'xray-audits');
    await Storage.setActiveWorkspaceId('ws_a');
    assert.equal(await Storage.workspaceDbName('xray-audits'), 'xray-audits::ws_a');
});

// ---- registry + lifecycle -------------------------------------------

test('ws: the registry mints the default workspace on first touch; create uses random ws_ ids (§7 Q1)', async () => {
    await reset();
    const list = await Workspaces.list();
    assert.equal(list.length, 1);
    assert.equal(list[0].id, 'default');
    const made = await Workspaces.create({ label: 'Eggs corpus' });
    assert.match(made.id, /^ws_[0-9a-f]{16}$/, 'random id, never an entity-id shape');
    const made2 = await Workspaces.create({ label: 'LHC corpus' });
    assert.notEqual(made.id, made2.id);
});

test('ws: activate flips the namespace AND the bound identity together', async () => {
    await reset();
    const profile = await IdentityProfiles.create('eggs', { activate: false });
    const made = await Workspaces.create({ label: 'Eggs', identityPubkey: profile.pubkey });
    await Workspaces.activate(made.id);
    assert.equal(await Storage.activeWorkspaceId(), made.id, 'namespace moved');
    const primary = await Storage.primaryIdentity.get();
    assert.equal(primary.pubkey, profile.pubkey, 'signing identity moved with it');
    // The registry + pointer are stored OUTSIDE the namespace.
    assert.ok(_store.has('workspaces'));
    assert.ok(!_store.has(`ws:${made.id}:workspaces`));
});

test('ws: remove refuses the default and the active workspace; deletes a foreign workspace\'s keys + DBs', async () => {
    await reset();
    const made = await Workspaces.create({ label: 'Doomed' });
    await Storage.setActiveWorkspaceId(made.id);
    await Storage.set('entities', { doomed: true });
    await assert.rejects(() => Workspaces.remove('default'), /default workspace/);
    await assert.rejects(() => Workspaces.remove(made.id), /active workspace/);
    await Storage.setActiveWorkspaceId('default');
    const deleted = [];
    const result = await Workspaces.remove(made.id, { idb: { deleteDatabase: (n) => deleted.push(n) } });
    assert.ok(!_store.has(`ws:${made.id}:entities`), 'namespaced keys gone');
    assert.deepEqual(result.databases,
        [...WORKSPACE_DATABASES, ...DERIVED_CACHE_DATABASES].map((b) => `${b}::${made.id}`),
        'that workspace\'s suffixed DBs deleted');
    assert.deepEqual(deleted, result.databases);
    const list = await Workspaces.list();
    assert.ok(!list.some((w) => w.id === made.id), 'registry row gone');
});

test('ws: WORKSPACE_CLEAR_KEYS re-export is the same frozen list (pin compat)', () => {
    assert.equal(WORKSPACE_CLEAR_KEYS, WORKSPACE_CONTENT_KEYS, 'one list, two names');
});

// ---- dangling bindings (the 2026-07-20 restore incident) -------------

test('ws: identityBindingState — unbound / bound / missing, the one predicate the repair UI trusts', async () => {
    await reset();
    const profile = await IdentityProfiles.create('eggs', { activate: false });
    const profiles = await IdentityProfiles.getAll();
    assert.equal(identityBindingState({ identity_pubkey: null }, profiles), 'unbound');
    assert.equal(identityBindingState({}, profiles), 'unbound');
    assert.equal(identityBindingState({ identity_pubkey: profile.pubkey }, profiles), 'bound');
    assert.equal(identityBindingState({ identity_pubkey: 'f'.repeat(64) }, profiles), 'missing');
    assert.equal(identityBindingState({ identity_pubkey: profile.pubkey }, {}), 'missing',
        'a replaced profile registry (restore) dangles every binding');
});

test('ws: activate REFUSES a dead identity binding and moves nothing — the model stays strict; repair is a consented UI act', async () => {
    await reset();
    await IdentityProfiles.create('keeper');         // the surviving active identity
    const profile = await IdentityProfiles.create('doomed', { activate: false });
    const made = await Workspaces.create({ label: 'Orphaned', identityPubkey: profile.pubkey });
    await IdentityProfiles.remove(profile.pubkey);   // the profile dies; the binding dangles
    await assert.rejects(() => Workspaces.activate(made.id), /No saved profile/);
    assert.equal(await Storage.activeWorkspaceId(), 'default',
        'a refused switch must not move the namespace pointer');
    // The repair path the UI drives: clear the dead binding, THEN switch.
    await Workspaces.update(made.id, { identityPubkey: null });
    await Workspaces.activate(made.id);
    assert.equal(await Storage.activeWorkspaceId(), made.id, 'clears then switches cleanly');
});

test('ws: update rebinds the identity of an ALREADY-BOUND workspace — a healthy binding is changeable, not locked', async () => {
    await reset();
    const alpha = await IdentityProfiles.create('alpha');
    const beta = await IdentityProfiles.create('beta', { activate: false });
    const made = await Workspaces.create({ label: 'Rebindable', identityPubkey: alpha.pubkey });
    // Rebind bound → bound (the 2026-07-21 gap: the UI only offered
    // binders on EMPTY/dangling slots, so this path had no affordance).
    const patched = await Workspaces.update(made.id, { identityPubkey: beta.pubkey });
    assert.equal(patched.identity_pubkey, beta.pubkey, 'binding replaced in place');
    // Activating now switches the live signer to the NEW owner.
    await Workspaces.activate(made.id);
    const { identity } = await IdentityProfiles.active();
    assert.equal(identity.pubkey, beta.pubkey, 'activate follows the rebound identity');
});
