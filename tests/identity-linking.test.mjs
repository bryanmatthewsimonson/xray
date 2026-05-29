// Account ↔ entity linking tests — Phase 9 identity layer, Phase IV.
//
// linkAccountToEntity / unlinkAccount / resolveAccountToEntity /
// accountsForEntity / listUnlinkedAccounts, including alias-chain
// resolution and the cross-platform collapse (many accounts → one
// entity).

import { test } from 'node:test';
import assert from 'node:assert/strict';

const _store = new Map();
globalThis.chrome = {
  storage: {
    local: {
      get(keys, cb) { const o = {}; for (const k of (keys === null ? [..._store.keys()] : Array.isArray(keys) ? keys : [keys])) if (_store.has(k)) o[k] = _store.get(k); cb(o); },
      set(obj, cb) { for (const [k, v] of Object.entries(obj)) _store.set(k, v); cb && cb(); },
      remove(keys, cb) { for (const k of (Array.isArray(keys) ? keys : [keys])) _store.delete(k); cb && cb(); }
    }
  }
};

const {
  recordAccount, linkAccountToEntity, unlinkAccount,
  resolveAccountToEntity, accountsForEntity, listUnlinkedAccounts
} = await import('../src/shared/identity/account-registry.js');
const { Storage } = await import('../src/shared/storage.js');

function reset() { _store.clear(); }

// Seed an entity directly in the 'entities' store (EntityModel.get reads it).
async function seedEntity(id, name, type = 'person', extra = {}) {
  const all = await Storage.get('entities', {});
  all[id] = { id, name, type, keypair: { npub: 'npub1' + id }, ...extra };
  await Storage.set('entities', all);
  return all[id];
}

test('linkAccountToEntity: links a materialized account to an entity', async () => {
  reset();
  await seedEntity('person_jack', 'Jack Dorsey');
  await recordAccount('twitter', { handle: 'jack' }, { now: 1 });

  const updated = await linkAccountToEntity('twitter:jack', 'person_jack');
  assert.equal(updated.linkedEntityId, 'person_jack');

  const stored = await Storage.platformAccounts.get('twitter:jack');
  assert.equal(stored.linkedEntityId, 'person_jack');
});

test('linkAccountToEntity: rejects unknown entity', async () => {
  reset();
  await recordAccount('twitter', { handle: 'jack' }, { now: 1 });
  await assert.rejects(() => linkAccountToEntity('twitter:jack', 'person_ghost'));
});

test('linkAccountToEntity: rejects missing args', async () => {
  reset();
  await assert.rejects(() => linkAccountToEntity('', 'e'));
  await assert.rejects(() => linkAccountToEntity('twitter:jack', ''));
});

test('resolveAccountToEntity: by account key', async () => {
  reset();
  await seedEntity('person_jack', 'Jack Dorsey');
  await recordAccount('twitter', { handle: 'jack' }, { now: 1 });
  await linkAccountToEntity('twitter:jack', 'person_jack');

  const ent = await resolveAccountToEntity('twitter:jack');
  assert.equal(ent.id, 'person_jack');
  assert.equal(ent.name, 'Jack Dorsey');
});

test('resolveAccountToEntity: by deterministic accountPubkey', async () => {
  reset();
  await seedEntity('person_jane', 'Jane Macro');
  const rec = await recordAccount('youtube', { channelId: 'UCjane', displayName: 'Jane' }, { now: 1 });
  await linkAccountToEntity('youtube:UCjane', 'person_jane');

  const ent = await resolveAccountToEntity(rec.accountPubkey); // 64-hex → findByPubkey
  assert.equal(ent.id, 'person_jane');
});

test('resolveAccountToEntity: follows the entity alias chain to canonical', async () => {
  reset();
  // alias "Jack D." → canonical "Jack Dorsey"
  await seedEntity('person_canon', 'Jack Dorsey');
  await seedEntity('person_alias', 'Jack D.', 'person', { canonical_id: 'person_canon' });
  await recordAccount('twitter', { handle: 'jack' }, { now: 1 });
  await linkAccountToEntity('twitter:jack', 'person_alias');

  const ent = await resolveAccountToEntity('twitter:jack');
  // Resolved through the alias to the canonical entity.
  assert.equal(ent.id, 'person_canon');
  assert.equal(ent.name, 'Jack Dorsey');
});

test('resolveAccountToEntity: null for unknown / unlinked', async () => {
  reset();
  assert.equal(await resolveAccountToEntity('twitter:nobody'), null);
  await recordAccount('twitter', { handle: 'jack' }, { now: 1 });
  assert.equal(await resolveAccountToEntity('twitter:jack'), null); // materialized but unlinked
  assert.equal(await resolveAccountToEntity(''), null);
});

test('cross-platform collapse: many accounts → one entity', async () => {
  reset();
  await seedEntity('person_jane', 'Jane Macro');
  await recordAccount('twitter', { handle: 'jane' }, { now: 1 });
  await recordAccount('youtube', { channelId: 'UCjane' }, { now: 1 });
  await recordAccount('substack', { userId: 99, handle: 'jane' }, { now: 1 });

  await linkAccountToEntity('twitter:jane', 'person_jane');
  await linkAccountToEntity('youtube:UCjane', 'person_jane');
  await linkAccountToEntity('substack:99', 'person_jane');

  const accounts = await accountsForEntity('person_jane');
  assert.equal(accounts.length, 3);
  const platforms = accounts.map((a) => a.platform).sort();
  assert.deepEqual(platforms, ['substack', 'twitter', 'youtube']);

  // Each resolves back to the same canonical person.
  for (const key of ['twitter:jane', 'youtube:UCjane', 'substack:99']) {
    const ent = await resolveAccountToEntity(key);
    assert.equal(ent.id, 'person_jane');
  }
});

test('unlinkAccount: removes the link', async () => {
  reset();
  await seedEntity('person_jack', 'Jack');
  await recordAccount('twitter', { handle: 'jack' }, { now: 1 });
  await linkAccountToEntity('twitter:jack', 'person_jack');
  await unlinkAccount('twitter:jack');
  assert.equal(await resolveAccountToEntity('twitter:jack'), null);
  assert.deepEqual(await accountsForEntity('person_jack'), []);
});

test('listUnlinkedAccounts: only unlinked accounts', async () => {
  reset();
  await seedEntity('person_jack', 'Jack');
  await recordAccount('twitter', { handle: 'jack' }, { now: 1 });
  await recordAccount('youtube', { channelId: 'UCfoo' }, { now: 1 });
  await linkAccountToEntity('twitter:jack', 'person_jack');

  const unlinked = await listUnlinkedAccounts();
  assert.equal(unlinked.length, 1);
  assert.equal(unlinked[0].key, 'youtube:UCfoo');
});
