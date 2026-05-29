// kind 32126 PlatformAccount event tests — Phase 9 identity layer, Phase I.
//
// Verifies buildPlatformAccountEvent emits the spec'd tag set from a
// PlatformAccount record, and that reconstructPlatformAccount is its
// inverse.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// chrome.storage shim — event-builder.js transitively imports storage.js.
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

const { EventBuilder } = await import('../src/shared/event-builder.js');
const { makeAccountRecord, normalizeAuthor } = await import('../src/shared/identity/platform-account.js');

const USER = 'f'.repeat(64);

function tagsAsMap(tags) {
  const out = {};
  for (const t of tags) { if (!out[t[0]]) out[t[0]] = []; out[t[0]].push(...t.slice(1)); }
  return out;
}

test('buildPlatformAccountEvent: emits kind 32126 with the account tag set', async () => {
  const rec = await makeAccountRecord(
    normalizeAuthor('youtube', { channelId: 'UCabc', handle: '@jane', displayName: 'Jane', verified: true }),
    { now: 1700000000 }
  );
  rec.profileUrl = 'https://youtube.com/@jane';
  const evt = EventBuilder.buildPlatformAccountEvent(rec, USER);

  assert.equal(evt.kind, 32126);
  assert.equal(evt.pubkey, USER);          // authored by the capturing user
  const m = tagsAsMap(evt.tags);
  assert.equal(m.d[0], 'youtube:UCabc');   // d == account key
  // p references the account pubkey with the 'account' marker
  const pTag = evt.tags.find((t) => t[0] === 'p');
  assert.deepEqual(pTag, ['p', rec.accountPubkey, '', 'account']);
  assert.equal(m['account-platform'][0], 'youtube');
  assert.equal(m['account-id'][0], 'UCabc');
  assert.equal(m['account-username'][0], '@jane');
  assert.equal(m['account-name'][0], 'Jane');
  assert.equal(m['account-verified'][0], 'true');
  assert.equal(m.r[0], 'https://youtube.com/@jane');
});

test('buildPlatformAccountEvent: emits linked-entity when present', async () => {
  const rec = await makeAccountRecord(normalizeAuthor('twitter', { handle: 'jack' }), {
    now: 1, linkedEntityId: 'entity_jack'
  });
  const evt = EventBuilder.buildPlatformAccountEvent(rec, USER);
  assert.equal(tagsAsMap(evt.tags)['linked-entity'][0], 'entity_jack');
});

test('buildPlatformAccountEvent: omits linked-entity + verified when absent', async () => {
  const rec = await makeAccountRecord(normalizeAuthor('twitter', { handle: 'jack' }), { now: 1 });
  const evt = EventBuilder.buildPlatformAccountEvent(rec, USER);
  const m = tagsAsMap(evt.tags);
  assert.equal(m['linked-entity'], undefined);
  assert.equal(m['account-verified'], undefined);
});

test('buildPlatformAccountEvent: rejects a record missing key/accountPubkey', () => {
  assert.throws(() => EventBuilder.buildPlatformAccountEvent({ platform: 'twitter' }, USER));
  assert.throws(() => EventBuilder.buildPlatformAccountEvent(null, USER));
});

test('reconstructPlatformAccount: inverse of build', async () => {
  const rec = await makeAccountRecord(
    normalizeAuthor('substack', { userId: 4242, handle: 'jane', name: 'Jane Smith' }),
    { now: 1, linkedEntityId: 'entity_jane' }
  );
  rec.profileUrl = 'https://jane.substack.com';
  const evt = EventBuilder.buildPlatformAccountEvent(rec, USER);
  const back = EventBuilder.reconstructPlatformAccount(evt);

  assert.equal(back.key, 'substack:4242');
  assert.equal(back.accountPubkey, rec.accountPubkey);
  assert.equal(back.platform, 'substack');
  assert.equal(back.stableId, '4242');
  assert.equal(back.handle, 'jane');
  assert.equal(back.displayName, 'Jane Smith');
  assert.equal(back.profileUrl, 'https://jane.substack.com');
  assert.equal(back.linkedEntityId, 'entity_jane');
});

test('reconstructPlatformAccount: null on wrong kind / malformed', () => {
  assert.equal(EventBuilder.reconstructPlatformAccount({ kind: 1, tags: [] }), null);
  assert.equal(EventBuilder.reconstructPlatformAccount(null), null);
  assert.equal(EventBuilder.reconstructPlatformAccount({ kind: 32126, tags: [['d', 'x']] }), null); // no p/platform/id
});

// ── buildArticleEvent author p-tag (Phase III.b) ───────────────────────

test('buildArticleEvent: emits author p-tag when authorAccountPubkey given', async () => {
  const article = { title: 'T', url: 'https://example.com/a', content: 'plain text body', byline: 'Jane' };
  const authorPubkey = 'a'.repeat(64);
  const evt = await EventBuilder.buildArticleEvent(article, [], USER, [], authorPubkey);
  const pAuthor = evt.tags.find((t) => t[0] === 'p' && t[3] === 'author');
  assert.ok(pAuthor, 'expected an author p-tag');
  assert.equal(pAuthor[1], authorPubkey);
});

test('buildArticleEvent: no author p-tag when omitted (back-compat)', async () => {
  const article = { title: 'T', url: 'https://example.com/a', content: 'plain text body', byline: 'Jane' };
  const evt = await EventBuilder.buildArticleEvent(article, [], USER, []);
  const pAuthor = evt.tags.find((t) => t[0] === 'p' && t[3] === 'author');
  assert.equal(pAuthor, undefined);
  // The display-name `author` tag is unaffected.
  assert.ok(evt.tags.find((t) => t[0] === 'author' && t[1] === 'Jane'));
});
