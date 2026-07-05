// Platform-account publish selection tests — Knowledge Sharing KS.2.
//
// selectAccountsToPublish unions the run's touched accounts with the
// accounts linked to the run's entities (alias-resolved), dedupes by
// account key, and resolves each linked entity's wire pubkey for the
// role-marked linked-entity p-tag.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const _store = new Map();
globalThis.chrome = {
    storage: {
        local: {
            get(keys, cb) { const o = {}; for (const k of (Array.isArray(keys) ? keys : [keys])) if (_store.has(k)) o[k] = _store.get(k); cb(o); },
            set(obj, cb) { for (const [k, v] of Object.entries(obj)) _store.set(k, v); cb && cb(); },
            remove(keys, cb) { for (const k of (Array.isArray(keys) ? keys : [keys])) _store.delete(k); cb && cb(); }
        }
    }
};

const { selectAccountsToPublish } = await import('../src/shared/identity/account-publish.js');
const { recordAccount, linkAccountToEntity } = await import('../src/shared/identity/account-registry.js');
const { EntityModel } = await import('../src/shared/entity-model.js');
const { LocalKeyManager } = await import('../src/shared/local-key-manager.js');

function reset() { _store.clear(); LocalKeyManager.keys.clear(); }

test('selects a touched account; unlinked → null pubkey', async () => {
    reset();
    await recordAccount('twitter', { handle: 'jane' }, { now: 1 });
    const sel = await selectAccountsToPublish({ touchedAccountKeys: ['twitter:jane'] });
    assert.equal(sel.length, 1);
    assert.equal(sel[0].account.key, 'twitter:jane');
    assert.equal(sel[0].linkedEntityPubkey, null);
});

test('resolves the linked entity wire pubkey', async () => {
    reset();
    const jane = await EntityModel.create({ name: 'Jane Doe', type: 'person' });
    await recordAccount('twitter', { handle: 'jane' }, { now: 1 });
    await linkAccountToEntity('twitter:jane', jane.id);
    const sel = await selectAccountsToPublish({ touchedAccountKeys: ['twitter:jane'] });
    assert.equal(sel[0].linkedEntityPubkey, jane.keypair.pubkey);
});

test('entityIds pull in the entity\'s linked accounts', async () => {
    reset();
    const jane = await EntityModel.create({ name: 'Jane Doe', type: 'person' });
    await recordAccount('twitter', { handle: 'jane' }, { now: 1 });
    await recordAccount('youtube', { channelId: 'UCjane' }, { now: 1 });
    await linkAccountToEntity('twitter:jane', jane.id);
    await linkAccountToEntity('youtube:UCjane', jane.id);
    const sel = await selectAccountsToPublish({ entityIds: [jane.id] });
    assert.deepEqual(sel.map((s) => s.account.key).sort(), ['twitter:jane', 'youtube:UCjane']);
});

test('alias entity ids surface accounts linked to the canonical', async () => {
    reset();
    const canonical = await EntityModel.create({ name: 'Jane Doe', type: 'person' });
    const alias = await EntityModel.create({ name: 'J. Doe', type: 'person', canonical_id: canonical.id });
    await recordAccount('twitter', { handle: 'jane' }, { now: 1 });
    await linkAccountToEntity('twitter:jane', canonical.id);
    const sel = await selectAccountsToPublish({ entityIds: [alias.id] });
    assert.equal(sel.length, 1);
    assert.equal(sel[0].account.key, 'twitter:jane');
});

test('dedupes across touched keys and entity ids', async () => {
    reset();
    const jane = await EntityModel.create({ name: 'Jane Doe', type: 'person' });
    await recordAccount('twitter', { handle: 'jane' }, { now: 1 });
    await linkAccountToEntity('twitter:jane', jane.id);
    const sel = await selectAccountsToPublish({
        touchedAccountKeys: ['twitter:jane', 'twitter:jane'],
        entityIds: [jane.id, jane.id]
    });
    assert.equal(sel.length, 1);
});

test('unknown keys and entity ids are skipped', async () => {
    reset();
    const sel = await selectAccountsToPublish({
        touchedAccountKeys: ['twitter:ghost', null, ''],
        entityIds: ['entity_0000000000000000', null]
    });
    assert.deepEqual(sel, []);
});

test('empty input → empty selection', async () => {
    reset();
    assert.deepEqual(await selectAccountsToPublish({}), []);
    assert.deepEqual(await selectAccountsToPublish(), []);
});

test('a foreign linked entity contributes its foreign pubkey', async () => {
    reset();
    const pk = 'a'.repeat(64);
    const foreign = await EntityModel.importForeign({ name: 'Remote Rita', type: 'person', pubkey: pk });
    await recordAccount('twitter', { handle: 'rita' }, { now: 1 });
    await linkAccountToEntity('twitter:rita', foreign.id);
    const sel = await selectAccountsToPublish({ touchedAccountKeys: ['twitter:rita'] });
    assert.equal(sel[0].linkedEntityPubkey, pk);
});
