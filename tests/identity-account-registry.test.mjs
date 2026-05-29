// Account registry orchestration tests — Phase 9 identity layer, Phase II.
//
// recordAccount: normalize → derive → persist, returning the record (or
// null for authors with no stable id). Best-effort, never throws.

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

const { recordAccount } = await import('../src/shared/identity/account-registry.js');
const { Storage } = await import('../src/shared/storage.js');
const { deriveAccountPubkey } = await import('../src/shared/identity/platform-account.js');

function reset() { _store.clear(); }

test('recordAccount: materializes, persists, returns record with accountPubkey', async () => {
  reset();
  const rec = await recordAccount('substack', {
    handle: 'janesmith', name: 'Jane Smith', userId: 4242,
    profileUrl: 'https://janesmith.substack.com'
  }, { seenOnUrl: 'https://x/post', now: 100 });

  assert.ok(rec);
  assert.equal(rec.key, 'substack:4242');
  assert.equal(rec.accountPubkey, await deriveAccountPubkey('substack', '4242'));

  // Persisted to the registry.
  const stored = await Storage.platformAccounts.get('substack:4242');
  assert.equal(stored.accountPubkey, rec.accountPubkey);
  assert.equal(stored.handle, 'janesmith');
});

test('recordAccount: null for an author with no stable identifier', async () => {
  reset();
  const rec = await recordAccount('wordpress', { name: 'Anonymous Commenter' });
  assert.equal(rec, null);
  // Nothing persisted.
  assert.deepEqual(await Storage.platformAccounts.getAll(), {});
});

test('recordAccount: idempotent — same account dedups to one registry entry', async () => {
  reset();
  await recordAccount('twitter', { handle: 'jack', name: 'Jack' }, { now: 100 });
  await recordAccount('twitter', { handle: 'jack', name: 'Jack Dorsey' }, { now: 200 });
  const all = await Storage.platformAccounts.getAll();
  assert.deepEqual(Object.keys(all), ['twitter:jack']);
  // Display field refreshed, firstSeen preserved.
  assert.equal(all['twitter:jack'].displayName, 'Jack Dorsey');
  assert.equal(all['twitter:jack'].firstSeen, 100);
});

test('recordAccount: never throws on malformed input (returns null)', async () => {
  reset();
  assert.equal(await recordAccount('twitter', null), null);
  assert.equal(await recordAccount(null, { handle: 'x' }), null);
  assert.equal(await recordAccount('twitter', {}), null);
});

test('recordAccount: YouTube channel id becomes the stable key', async () => {
  reset();
  const rec = await recordAccount('youtube', {
    channelId: 'UCabc123', handle: '@jane', displayName: 'Jane', verified: true
  }, { now: 1 });
  assert.equal(rec.key, 'youtube:UCabc123');
  assert.equal(rec.verified, true);
});
