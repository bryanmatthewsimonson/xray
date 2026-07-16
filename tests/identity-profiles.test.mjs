// Identity profiles + workspace reset. Load-bearing: `local_primary_identity`
// stays the ONE live slot (active is DERIVED, never stored twice), removal
// of the active identity is refused, and the reset clear/keep key lists are
// pinned exactly — a new content store that isn't added to the clear list
// will leak across "fresh" workspaces.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// storage.js touches chrome.storage at module load; stub it first.
const _stateStore = new Map();
globalThis.chrome = {
    storage: {
        local: {
            get(keys, cb) {
                if (keys === null) { cb(Object.fromEntries(_stateStore)); return; }
                const out = {};
                for (const k of Array.isArray(keys) ? keys : [keys]) {
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

const {
    IdentityProfiles, workspaceBackup, resetWorkspace,
    WORKSPACE_CLEAR_KEYS, WORKSPACE_KEEP_KEYS, WORKSPACE_DATABASES
} = await import('../src/shared/identity-profiles.js');
const { Storage } = await import('../src/shared/storage.js');

function resetState() { _stateStore.clear(); }

// ------------------------------------------------------------------
// Pinned lists — extend deliberately, with a matching store change.
// ------------------------------------------------------------------

test('WORKSPACE_CLEAR_KEYS is pinned exactly', () => {
    assert.deepEqual([...WORKSPACE_CLEAR_KEYS], [
        'entities', 'local_keys', 'article_claims', 'evidence_links',
        'claim_assessments', 'behavioral_findings',
        'adjudicable_propositions', 'adjudicated_verdicts',
        'integrity_findings', 'platform_accounts', 'portal_identities',
        'lens_jurisdictions', 'url_aliases', 'entity_fact_dismissals',
        'entity_dedupe_dismissals', 'follow_sets'
    ]);
});

test('WORKSPACE_KEEP_KEYS is pinned exactly', () => {
    assert.deepEqual([...WORKSPACE_KEEP_KEYS], [
        'preferences', 'local_primary_identity', 'identity_profiles',
        'xr_signing_state', 'xray:flags', 'xray:llm:key',
        'xray:llm:model', 'xray:llm:suggest_kinds'
    ]);
});

test('WORKSPACE_DATABASES is pinned exactly', () => {
    assert.deepEqual([...WORKSPACE_DATABASES], ['xray-archive', 'xray-audits', 'xray-events']);
});

test('clear and keep lists are disjoint', () => {
    const keep = new Set(WORKSPACE_KEEP_KEYS);
    for (const k of WORKSPACE_CLEAR_KEYS) assert.ok(!keep.has(k), k);
});

// ------------------------------------------------------------------
// Profile lifecycle
// ------------------------------------------------------------------

test('create() generates, saves under the label, and activates', async () => {
    resetState();
    const profile = await IdentityProfiles.create('Epistack');
    assert.equal(profile.label, 'Epistack');
    assert.match(profile.pubkey, /^[0-9a-f]{64}$/);
    assert.match(profile.npub, /^npub1/);
    const { identity, saved, profile: active } = await IdentityProfiles.active();
    assert.equal(identity.pubkey, profile.pubkey);
    assert.equal(saved, true);
    assert.equal(active.label, 'Epistack');
});

test('create() requires a label', async () => {
    resetState();
    await assert.rejects(() => IdentityProfiles.create('   '), /label required/i);
});

test('create(label, {activate:false}) restores the previous identity', async () => {
    resetState();
    const first = await IdentityProfiles.create('Personal');
    const second = await IdentityProfiles.create('Draft', { activate: false });
    const { identity } = await IdentityProfiles.active();
    assert.equal(identity.pubkey, first.pubkey);
    const all = await IdentityProfiles.getAll();
    assert.ok(all[second.pubkey], 'the non-activated profile is still saved');
});

test('saveCurrent() labels an existing unsaved identity', async () => {
    resetState();
    await Storage.primaryIdentity.generate();
    let { saved } = await IdentityProfiles.active();
    assert.equal(saved, false);
    const profile = await IdentityProfiles.saveCurrent('Personal');
    ({ saved } = await IdentityProfiles.active());
    assert.equal(saved, true);
    assert.equal(profile.label, 'Personal');
});

test('saveCurrent() with no live identity rejects', async () => {
    resetState();
    await assert.rejects(() => IdentityProfiles.saveCurrent('X'), /no active identity/i);
});

test('importNsec() saves + activates; invalid input rejects', async () => {
    resetState();
    const hex = '7f'.repeat(32);
    const profile = await IdentityProfiles.importNsec('Imported', hex);
    const { identity } = await IdentityProfiles.active();
    assert.equal(identity.pubkey, profile.pubkey);
    await assert.rejects(() => IdentityProfiles.importNsec('Bad', 'not-a-key'), /nsec1|64-char/);
});

test('activate() switches between saved profiles', async () => {
    resetState();
    const a = await IdentityProfiles.create('A');
    const b = await IdentityProfiles.create('B');
    assert.notEqual(a.pubkey, b.pubkey);
    await IdentityProfiles.activate(a.pubkey);
    let { identity } = await IdentityProfiles.active();
    assert.equal(identity.pubkey, a.pubkey);
    await IdentityProfiles.activate(b.pubkey);
    ({ identity } = await IdentityProfiles.active());
    assert.equal(identity.pubkey, b.pubkey);
});

test('activate() of an unknown pubkey rejects', async () => {
    resetState();
    await assert.rejects(() => IdentityProfiles.activate('c'.repeat(64)), /no saved profile/i);
});

test('remove() refuses the active identity, removes others', async () => {
    resetState();
    const a = await IdentityProfiles.create('A');
    const b = await IdentityProfiles.create('B'); // active
    await assert.rejects(() => IdentityProfiles.remove(b.pubkey), /active identity/i);
    assert.equal(await IdentityProfiles.remove(a.pubkey), true);
    const all = await IdentityProfiles.getAll();
    assert.equal(Object.keys(all).length, 1);
    assert.equal(await IdentityProfiles.remove(a.pubkey), false); // already gone
});

test('rename() relabels a saved profile', async () => {
    resetState();
    const p = await IdentityProfiles.create('Old');
    await IdentityProfiles.rename(p.pubkey, 'New');
    const all = await IdentityProfiles.getAll();
    assert.equal(all[p.pubkey].label, 'New');
});

test('list() is oldest-first and active() is null-safe when empty', async () => {
    resetState();
    assert.deepEqual(await IdentityProfiles.list(), []);
    const { identity, profile, saved } = await IdentityProfiles.active();
    assert.equal(identity, null);
    assert.equal(profile, null);
    assert.equal(saved, false);
});

// ------------------------------------------------------------------
// Workspace reset + backup
// ------------------------------------------------------------------

test('resetWorkspace() clears exactly the clear list and keeps the keep list', async () => {
    resetState();
    for (const k of [...WORKSPACE_CLEAR_KEYS, ...WORKSPACE_KEEP_KEYS]) {
        await Storage.set(k, { marker: k });
    }
    const deleted = [];
    const result = await resetWorkspace({ idb: { deleteDatabase: (n) => deleted.push(n) } });
    assert.deepEqual(result.cleared, [...WORKSPACE_CLEAR_KEYS]);
    assert.deepEqual(deleted, [...WORKSPACE_DATABASES]);
    for (const k of WORKSPACE_CLEAR_KEYS) {
        assert.equal(await Storage.get(k, null), null, `${k} cleared`);
    }
    for (const k of WORKSPACE_KEEP_KEYS) {
        assert.deepEqual(await Storage.get(k, null), { marker: k }, `${k} kept`);
    }
});

test('resetWorkspace() keeps saved identities usable across the reset', async () => {
    resetState();
    const epistack = await IdentityProfiles.create('Epistack');
    await Storage.set('article_claims', { some: 'claim' });
    await resetWorkspace({ idb: { deleteDatabase: () => {} } });
    const { identity, saved, profile } = await IdentityProfiles.active();
    assert.equal(identity.pubkey, epistack.pubkey);
    assert.equal(saved, true);
    assert.equal(profile.label, 'Epistack');
    assert.equal(await Storage.get('article_claims', null), null);
});

test('workspaceBackup() carries content + identities, never the LLM key', async () => {
    resetState();
    await IdentityProfiles.create('Epistack');
    await Storage.set('article_claims', { c1: { id: 'c1' } });
    await Storage.set('xray:llm:key', 'sk-secret');
    const snap = await workspaceBackup();
    assert.equal(snap.format, 'xray-workspace-backup');
    assert.ok(snap.data.identity_profiles, 'profiles included');
    assert.deepEqual(snap.data.article_claims, { c1: { id: 'c1' } });
    assert.ok(!('xray:llm:key' in snap.data), 'LLM key excluded');
});
