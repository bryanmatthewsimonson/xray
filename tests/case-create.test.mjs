// One-step case creation tests — shared/case-create.js (the 2026-07-20
// simplification: "New case" composes workspace + identity + case
// entity + scope + binding in one verb).
//
// The load-bearing pins: the case entity lands in the NEW workspace's
// namespace (never the one you were in), the workspace ends ACTIVE and
// fully bound, the owning profile becomes the live identity, and the
// isolation boundary holds (the case is invisible from default).

import { test } from 'node:test';
import assert from 'node:assert/strict';

const _store = new Map();
globalThis.chrome = {
    storage: {
        local: {
            get(keys, cb) {
                const out = {};
                for (const k of Array.isArray(keys) ? keys : [keys]) {
                    if (_store.has(k)) out[k] = _store.get(k);
                }
                cb(out);
            },
            set(obj, cb) { for (const [k, v] of Object.entries(obj)) _store.set(k, v); cb && cb(); },
            remove(keys, cb) { for (const k of Array.isArray(keys) ? keys : [keys]) _store.delete(k); cb && cb(); }
        }
    }
};

const { Storage } = await import('../src/shared/storage.js');
const { LocalKeyManager } = await import('../src/shared/local-key-manager.js');
const { IdentityProfiles, Workspaces } = await import('../src/shared/identity-profiles.js');
const { EntityModel } = await import('../src/shared/entity-model.js');
const { createCase } = await import('../src/shared/case-create.js');

async function reset() {
    _store.clear();
    LocalKeyManager.keys.clear();
    await Storage.setActiveWorkspaceId('default');
}

test('createCase with a new profile: workspace active + fully bound, entity in the NEW namespace', async () => {
    await reset();
    const { workspace, caseEntity } = await createCase({
        caseName: 'The stolen Legos saga',
        scopeQuestion: 'Who took the Legos, and was it covered up?',
        newProfileLabel: 'anon'
    });

    // The workspace is ACTIVE, labeled with the case name, fully bound.
    assert.equal(await Storage.activeWorkspaceId(), workspace.id);
    assert.notEqual(workspace.id, 'default');
    assert.equal(workspace.label, 'The stolen Legos saga');
    assert.equal(workspace.case_entity_id, caseEntity.id);
    assert.match(workspace.identity_pubkey, /^[0-9a-f]{64}$/);

    // The owning profile became the live signing identity.
    const primary = await Storage.primaryIdentity.get();
    assert.equal(primary.pubkey, workspace.identity_pubkey);
    const profiles = await IdentityProfiles.getAll();
    assert.equal(profiles[workspace.identity_pubkey].label, 'anon');

    // The case entity is real, typed, scoped — and resolvable in the
    // ACTIVE (new) namespace.
    assert.equal(caseEntity.type, 'case');
    assert.equal(caseEntity.name, 'The stolen Legos saga');
    assert.equal(caseEntity.authored_fields.scope_question.value,
        'Who took the Legos, and was it covered up?');
    const resolved = await EntityModel.get(caseEntity.id);
    assert.ok(resolved, 'entity readable in the new workspace');

    // Isolation pin: the entity lives under the PREFIXED key, and the
    // default namespace never saw it.
    assert.ok(_store.has(`ws:${workspace.id}:entities`), 'entities stored in the new namespace');
    const defaultEntities = _store.has('entities') ? JSON.parse(_store.get('entities')) : {};
    assert.ok(!defaultEntities[caseEntity.id], 'default namespace untouched');

    // And the capture pipeline's resolver sees the binding end to end.
    const { resolveActiveCaseRef } = await import('../src/shared/case-membership.js');
    const ref = await resolveActiveCaseRef();
    assert.equal(ref.caseId, caseEntity.id);
    assert.equal(ref.caseName, 'The stolen Legos saga');
    assert.equal(ref.scopeQuestion, 'Who took the Legos, and was it covered up?');
});

test('createCase with an EXISTING profile switches to it; scope optional', async () => {
    await reset();
    const owner = await IdentityProfiles.create('work', { activate: false });
    const { workspace, caseEntity } = await createCase({
        caseName: 'Case Two', profilePubkey: owner.pubkey.toUpperCase()   // case-insensitive
    });
    assert.equal(workspace.identity_pubkey, owner.pubkey);
    assert.equal((await Storage.primaryIdentity.get()).pubkey, owner.pubkey);
    assert.equal(caseEntity.authored_fields, undefined, 'no scope stamped when none given');
});

test('createCase unbound: no identity switch, workspace carries no identity', async () => {
    await reset();
    const before = await Storage.primaryIdentity.set(
        '1111111111111111111111111111111111111111111111111111111111111111');
    const { workspace } = await createCase({ caseName: 'NIP-07 case' });
    assert.equal(workspace.identity_pubkey, null);
    assert.equal((await Storage.primaryIdentity.get()).pubkey, before.pubkey, 'signer untouched');
    assert.equal(await Storage.activeWorkspaceId(), workspace.id, 'namespace still switches');
});

test('createCase validation: empty name / both profile params → throws with NOTHING created', async () => {
    await reset();
    await assert.rejects(() => createCase({ caseName: '   ' }), /Case name required/);
    await assert.rejects(
        () => createCase({ caseName: 'X', profilePubkey: 'a'.repeat(64), newProfileLabel: 'x' }),
        /not both/);
    await assert.rejects(
        () => createCase({ caseName: 'X', profilePubkey: 'f'.repeat(64) }),
        /No saved profile/);
    assert.equal(await Storage.activeWorkspaceId(), 'default', 'still in default');
    // getAll() never mints the registry — after pure-validation
    // failures there must be NO non-default workspace anywhere.
    const all = await Workspaces.getAll();
    assert.deepEqual(Object.keys(all).filter((id) => id !== 'default'), [], 'no workspace minted');
});

test('describeActiveContext — the chrome chip line: bound case, unbound workspace, default', async () => {
    const { describeActiveContext } = await import('../src/shared/case-membership.js');

    // Default, unbound: the chrome shows the workspace label, no case.
    await reset();
    const dflt = await describeActiveContext();
    assert.equal(dflt.isDefault, true);
    assert.equal(dflt.caseName, null);
    assert.equal(dflt.profileLabel, null);

    // A created case: name + owning profile resolve for the chip.
    const { workspace, caseEntity } = await createCase({
        caseName: 'The stolen Legos saga', newProfileLabel: 'anon'
    });
    const ctx = await describeActiveContext();
    assert.deepEqual(ctx, {
        wsId: workspace.id,
        wsLabel: 'The stolen Legos saga',
        caseName: 'The stolen Legos saga',
        profileLabel: 'anon',
        isDefault: false
    });

    // A broken binding (case retyped) falls back to the workspace
    // label — never a guessed case name.
    await EntityModel.update(caseEntity.id, { type: 'thing' });
    const broken = await describeActiveContext();
    assert.equal(broken.caseName, null);
    assert.equal(broken.wsLabel, 'The stolen Legos saga');
});

test('two cases owned by ONE profile — "a profile owns a set of cases"', async () => {
    await reset();
    const owner = await IdentityProfiles.create('home', { activate: false });
    const a = await createCase({ caseName: 'Case A', profilePubkey: owner.pubkey });
    const b = await createCase({ caseName: 'Case B', profilePubkey: owner.pubkey });
    assert.equal(a.workspace.identity_pubkey, owner.pubkey);
    assert.equal(b.workspace.identity_pubkey, owner.pubkey);
    assert.notEqual(a.workspace.id, b.workspace.id);
    // Each case entity is invisible from the other's namespace.
    assert.equal(await Storage.activeWorkspaceId(), b.workspace.id);
    assert.equal(await EntityModel.get(a.caseEntity.id), null, 'A is not readable from B');
});
