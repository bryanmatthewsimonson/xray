// Platform-account storage registry tests — Phase 9 identity layer, Phase I.
//
// Exercises Storage.platformAccounts against a chrome.storage.local shim
// (same pattern as entity-sync.test.mjs).

import { test } from 'node:test';
import assert from 'node:assert/strict';

const _store = new Map();
globalThis.chrome = {
  storage: {
    local: {
      get(keys, cb) {
        const out = {};
        const arr = keys === null ? Array.from(_store.keys()) : Array.isArray(keys) ? keys : [keys];
        for (const k of arr) if (_store.has(k)) out[k] = _store.get(k);
        cb(out);
      },
      set(obj, cb) { for (const [k, v] of Object.entries(obj)) _store.set(k, v); cb && cb(); },
      remove(keys, cb) { for (const k of (Array.isArray(keys) ? keys : [keys])) _store.delete(k); cb && cb(); }
    }
  }
};

const { Storage } = await import('../src/shared/storage.js');

function reset() { _store.clear(); }

function record(key, over = {}) {
  return {
    key,
    accountPubkey: 'a'.repeat(64),
    platform: 'twitter',
    stableId: key.split(':')[1],
    handle: 'jack',
    displayName: 'Jack',
    profileUrl: 'https://x.com/jack',
    avatarUrl: '',
    verified: false,
    linkedEntityId: null,
    firstSeen: 100,
    lastSeen: 100,
    npub: 'npub1xxx',
    ...over
  };
}

test('platformAccounts: save + get round-trips', async () => {
  reset();
  await Storage.platformAccounts.save(record('twitter:jack'));
  const got = await Storage.platformAccounts.get('twitter:jack');
  assert.equal(got.handle, 'jack');
  assert.equal(got.accountPubkey, 'a'.repeat(64));
});

test('platformAccounts: get unknown key → null', async () => {
  reset();
  assert.equal(await Storage.platformAccounts.get('twitter:nobody'), null);
});

test('platformAccounts: save requires a key', async () => {
  reset();
  await assert.rejects(() => Storage.platformAccounts.save({ accountPubkey: 'x' }));
});

test('platformAccounts: re-save preserves firstSeen, bumps lastSeen', async () => {
  reset();
  await Storage.platformAccounts.save(record('twitter:jack', { firstSeen: 100, lastSeen: 100 }));
  const again = await Storage.platformAccounts.save(record('twitter:jack', {
    displayName: 'Jack Dorsey', firstSeen: 999, lastSeen: 999
  }));
  // firstSeen preserved from the original; lastSeen bumped to ~now.
  assert.equal(again.firstSeen, 100);
  assert.ok(again.lastSeen >= 100 && again.lastSeen !== 100);
  // mutable display field updated
  assert.equal(again.displayName, 'Jack Dorsey');
});

test('platformAccounts: re-save does not clobber an existing entity link', async () => {
  reset();
  await Storage.platformAccounts.save(record('twitter:jack'));
  await Storage.platformAccounts.link('twitter:jack', 'entity_jack');
  // A later capture (linkedEntityId: null on the fresh record) must NOT
  // wipe the manual link.
  const after = await Storage.platformAccounts.save(record('twitter:jack', { linkedEntityId: null }));
  assert.equal(after.linkedEntityId, 'entity_jack');
});

test('platformAccounts: findByPubkey reverse lookup', async () => {
  reset();
  await Storage.platformAccounts.save(record('twitter:jack', { accountPubkey: 'b'.repeat(64) }));
  await Storage.platformAccounts.save(record('youtube:UCabc', { platform: 'youtube', accountPubkey: 'c'.repeat(64) }));
  const found = await Storage.platformAccounts.findByPubkey('c'.repeat(64));
  assert.equal(found.key, 'youtube:UCabc');
  assert.equal(await Storage.platformAccounts.findByPubkey('d'.repeat(64)), null);
});

test('platformAccounts: findByEntity returns all linked accounts', async () => {
  reset();
  await Storage.platformAccounts.save(record('twitter:jack', { accountPubkey: 'b'.repeat(64) }));
  await Storage.platformAccounts.save(record('youtube:UCabc', { platform: 'youtube', accountPubkey: 'c'.repeat(64) }));
  await Storage.platformAccounts.save(record('substack:42', { platform: 'substack', accountPubkey: 'e'.repeat(64) }));
  await Storage.platformAccounts.link('twitter:jack', 'entity_jack');
  await Storage.platformAccounts.link('youtube:UCabc', 'entity_jack');
  const linked = await Storage.platformAccounts.findByEntity('entity_jack');
  assert.equal(linked.length, 2);
  const keys = linked.map((r) => r.key).sort();
  assert.deepEqual(keys, ['twitter:jack', 'youtube:UCabc']);
});

test('platformAccounts: link to unknown account throws', async () => {
  reset();
  await assert.rejects(() => Storage.platformAccounts.link('twitter:ghost', 'entity_x'));
});

test('platformAccounts: link then unlink (entityId null)', async () => {
  reset();
  await Storage.platformAccounts.save(record('twitter:jack'));
  await Storage.platformAccounts.link('twitter:jack', 'entity_jack');
  const unlinked = await Storage.platformAccounts.link('twitter:jack', null);
  assert.equal(unlinked.linkedEntityId, null);
});

test('platformAccounts: delete removes the record', async () => {
  reset();
  await Storage.platformAccounts.save(record('twitter:jack'));
  await Storage.platformAccounts.delete('twitter:jack');
  assert.equal(await Storage.platformAccounts.get('twitter:jack'), null);
});

test('platformAccounts: getAll returns the registry object', async () => {
  reset();
  await Storage.platformAccounts.save(record('twitter:jack'));
  await Storage.platformAccounts.save(record('youtube:UCabc', { platform: 'youtube', accountPubkey: 'c'.repeat(64) }));
  const all = await Storage.platformAccounts.getAll();
  assert.deepEqual(Object.keys(all).sort(), ['twitter:jack', 'youtube:UCabc']);
});
