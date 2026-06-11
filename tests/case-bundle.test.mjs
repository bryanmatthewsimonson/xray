// Case collaboration bundle tests — Phase 11.8.
// Same chrome.storage.local shim pattern as entity-model.test.mjs.
//
// The shim's Map doubles as "two devices": exporting from a seeded
// store, wiping it (resetState), and importing simulates the
// collaborator's fresh install.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const _stateStore = new Map();
globalThis.chrome = {
    storage: {
        local: {
            get(keys, cb) {
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

const { collectCaseBundle, buildCaseBundleJson, isCaseBundle, importCaseBundle,
        CASE_BUNDLE_FORMAT } = await import('../src/shared/case-bundle.js');
const { EntityModel } = await import('../src/shared/entity-model.js');
const { ClaimModel } = await import('../src/shared/claim-model.js');
const { LocalKeyManager } = await import('../src/shared/local-key-manager.js');

function resetState() {
    _stateStore.clear();
    LocalKeyManager.keys.clear();
}

async function seedCase() {
    const kase   = await EntityModel.create({ name: 'Bricks & Minifigs scandal', type: 'case' });
    const person = await EntityModel.create({ name: 'Ben Schneider', type: 'person' });
    const org    = await EntityModel.create({ name: 'Bricks & Minifigs', type: 'organization' });
    await ClaimModel.create({
        text: 'The collection was illegally retained.',
        source_url: 'https://example.com/v1',
        about: [kase.id, person.id],
        source: org.id
    });
    // Renamed after creation — id no longer matches sha(type:name);
    // the bundle must preserve the ORIGINAL id.
    const renamed = await EntityModel.update(person.id, { name: 'Reckless Ben' });
    assert.equal(renamed.id, person.id);
    return { kase, person, org };
}

// ---------------------------------------------------------------------

test('bundle: collect gathers the case orbit with keys', async () => {
    resetState();
    const { kase, person, org } = await seedCase();
    // An unrelated entity must NOT ride along.
    await EntityModel.create({ name: 'Unrelated', type: 'thing' });

    const bundle = await collectCaseBundle(kase.id);
    assert.equal(bundle.format, CASE_BUNDLE_FORMAT);
    assert.equal(bundle.case_id, kase.id);
    assert.deepEqual(bundle.entities.map((e) => e.id).sort(),
        [kase.id, person.id, org.id].sort(), 'case + about + entity source, nothing else');
    for (const e of bundle.entities) {
        assert.match(e.privkey, /^[0-9a-f]{64}$/, `${e.name} carries its key`);
        assert.equal(e.keyName, `entity:${e.id}`);
    }
    const ben = bundle.entities.find((e) => e.id === person.id);
    assert.equal(ben.name, 'Reckless Ben', 'post-rename name with the ORIGINAL id');

    const json = buildCaseBundleJson(bundle, '2026-06-10T12:00:00.000Z');
    assert.ok(isCaseBundle(JSON.parse(json)));
    assert.equal(isCaseBundle([{ id: 'x' }]), false, 'legacy array export is not a bundle');
});

test('bundle: import on a fresh install — same ids, same pubkeys', async () => {
    resetState();
    const { kase, person } = await seedCase();
    const bundle = await collectCaseBundle(kase.id);
    const exporterPubkeys = new Map();
    for (const id of [kase.id, person.id]) {
        exporterPubkeys.set(id, (await EntityModel.get(id)).keypair.pubkey);
    }

    // "Device B": wipe everything, import the parsed bundle.
    resetState();
    const parsed = JSON.parse(buildCaseBundleJson(bundle, '2026-06-10T12:00:00.000Z'));
    const r = await importCaseBundle(parsed);
    assert.equal(r.added, 3);
    assert.equal(r.updated, 0);
    assert.equal(r.keysInstalled, 3);
    assert.deepEqual(r.conflicts, []);
    assert.equal(r.caseId, kase.id);

    // THE collaboration property: identical entity pubkeys, so both
    // sides' claims aggregate under the same #p.
    for (const [id, pubkey] of exporterPubkeys) {
        const imported = await EntityModel.get(id);
        assert.ok(imported, `${id} exists under its original id`);
        assert.equal(imported.keypair.pubkey, pubkey, 'same pubkey as the exporter');
        assert.ok(imported.keypair.privateKey, 'can sign (kind-0 publish works)');
    }
    const ben = await EntityModel.get(person.id);
    assert.equal(ben.name, 'Reckless Ben');

    // Re-import is idempotent: records update, no new keys.
    const again = await importCaseBundle(parsed);
    assert.equal(again.added, 0);
    assert.equal(again.updated, 3);
    assert.equal(again.keysInstalled, 0);
    assert.deepEqual(again.conflicts, []);
});

test('bundle: key conflicts keep local keys and are reported', async () => {
    resetState();
    const { kase } = await seedCase();
    const bundle = await collectCaseBundle(kase.id);

    // Device B independently created the SAME case (same name+type →
    // same deterministic id) with its OWN key.
    resetState();
    const local = await EntityModel.create({ name: 'Bricks & Minifigs scandal', type: 'case' });
    assert.equal(local.id, kase.id, 'deterministic ids collide on purpose');
    const localPubkey = local.keypair.pubkey;

    const r = await importCaseBundle(JSON.parse(buildCaseBundleJson(bundle, '2026-06-10T12:00:00.000Z')));
    assert.equal(r.conflicts.length, 1, 'the case key conflicts');
    assert.ok(r.conflicts[0].includes('Bricks & Minifigs scandal'));
    assert.equal(r.added, 2, 'non-conflicting entities still import');

    const after = await EntityModel.get(local.id);
    assert.equal(after.keypair.pubkey, localPubkey, 'local key NEVER overwritten');
});

test('bundle: malformed input is rejected or skipped', async () => {
    resetState();
    await assert.rejects(() => importCaseBundle({ format: 'nope' }), /Not an X-Ray case bundle/);
    await assert.rejects(() => importCaseBundle({ format: CASE_BUNDLE_FORMAT, version: 99, entities: [] }),
        /newer than this X-Ray understands/);
    const r = await importCaseBundle({
        format: CASE_BUNDLE_FORMAT, version: 1,
        entities: [{ id: 'not-an-id', name: 'X', type: 'person' }, null]
    });
    assert.equal(r.skipped, 2);
    assert.equal(r.added, 0);
});
