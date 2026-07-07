// Entity equivalence tests — Knowledge Sharing KS.4 (rendezvous R5).
//
// equivalencePubkeys unions the alias family's wire pubkeys (local
// minted + adopted foreign) with the deterministic account pubkeys of
// every linked platform account, per-reader.

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

const { equivalencePubkeys } = await import('../src/shared/entity-equivalence.js');
const { EntityModel } = await import('../src/shared/entity-model.js');
const { recordAccount, linkAccountToEntity } = await import('../src/shared/identity/account-registry.js');
const { LocalKeyManager } = await import('../src/shared/local-key-manager.js');

function reset() { _store.clear(); LocalKeyManager.keys.clear(); }

test('missing / unknown entity → empty set', async () => {
    reset();
    assert.deepEqual((await equivalencePubkeys(null)).pubkeys, []);
    assert.deepEqual((await equivalencePubkeys('entity_0000000000000000')).pubkeys, []);
});

test('standalone entity → its own pubkey only', async () => {
    reset();
    const e = await EntityModel.create({ name: 'Solo Sam', type: 'person' });
    const eq = await equivalencePubkeys(e.id);
    assert.deepEqual(eq.pubkeys, [e.keypair.pubkey]);
    assert.equal(eq.breakdown.self, e.keypair.pubkey);
    assert.equal(eq.rootId, e.id);
});

test('alias family unions pubkeys — from either end', async () => {
    reset();
    const canonical = await EntityModel.create({ name: 'Jane Doe', type: 'person' });
    const alias = await EntityModel.create({ name: 'J. Doe', type: 'person', canonical_id: canonical.id });

    const fromAlias = await equivalencePubkeys(alias.id);
    assert.deepEqual(new Set(fromAlias.pubkeys),
        new Set([canonical.keypair.pubkey, alias.keypair.pubkey]));
    assert.equal(fromAlias.rootId, canonical.id);

    const fromCanonical = await equivalencePubkeys(canonical.id);
    assert.deepEqual(new Set(fromCanonical.pubkeys),
        new Set([canonical.keypair.pubkey, alias.keypair.pubkey]));
});

test('adopted foreign alias contributes its foreign pubkey', async () => {
    reset();
    const mine = await EntityModel.create({ name: 'Jane Local', type: 'person' });
    const pk = 'b'.repeat(64);
    await EntityModel.importForeign({ name: 'Jane Remote', type: 'person', pubkey: pk, canonicalId: mine.id });
    const eq = await equivalencePubkeys(mine.id);
    assert.ok(eq.pubkeys.includes(pk));
    assert.deepEqual(eq.breakdown.foreignPubkeys, [pk]);
});

test('linked platform accounts contribute account pubkeys across the family', async () => {
    reset();
    const canonical = await EntityModel.create({ name: 'Jane Doe', type: 'person' });
    const alias = await EntityModel.create({ name: 'J. Doe', type: 'person', canonical_id: canonical.id });
    const acct = await recordAccount('twitter', { handle: 'jane' }, { now: 1 });
    await linkAccountToEntity('twitter:jane', canonical.id);

    const eq = await equivalencePubkeys(alias.id);   // queried from the alias
    assert.ok(eq.pubkeys.includes(acct.accountPubkey));
    assert.deepEqual(eq.breakdown.accountPubkeys, [acct.accountPubkey]);
});

test('unrelated entities stay out of the set', async () => {
    reset();
    const jane = await EntityModel.create({ name: 'Jane Doe', type: 'person' });
    const bob = await EntityModel.create({ name: 'Bob Other', type: 'person' });
    const eq = await equivalencePubkeys(jane.id);
    assert.ok(!eq.pubkeys.includes(bob.keypair.pubkey));
});

test('pubkeys are deduped', async () => {
    reset();
    const e = await EntityModel.create({ name: 'Dedupe Dana', type: 'person' });
    const eq = await equivalencePubkeys(e.id);
    assert.equal(new Set(eq.pubkeys).size, eq.pubkeys.length);
});
