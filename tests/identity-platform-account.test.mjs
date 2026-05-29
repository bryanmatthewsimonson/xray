// Platform-account identity core tests — Phase 9 identity layer, Phase I.
//
// Covers resolveStableId precedence, accountKey, normalizeAuthor,
// deterministic deriveAccountPubkey, and makeAccountRecord.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  KNOWN_PLATFORMS,
  resolveStableId,
  accountKey,
  normalizeAuthor,
  deriveAccountPubkey,
  makeAccountRecord
} = await import('../src/shared/identity/platform-account.js');
const { Crypto } = await import('../src/shared/crypto.js');

// ------------------------------------------------------------------
// resolveStableId — per-platform precedence
// ------------------------------------------------------------------

test('resolveStableId: youtube prefers channelId', () => {
  assert.equal(resolveStableId('youtube', { channelId: 'UCabc', handle: '@foo' }), 'UCabc');
});

test('resolveStableId: substack prefers numeric userId over handle', () => {
  assert.equal(resolveStableId('substack', { userId: 12345, handle: 'jane' }), '12345');
  assert.equal(resolveStableId('substack', { handle: 'jane' }), 'jane'); // falls back
});

test('resolveStableId: twitter falls to handle (no numeric id captured)', () => {
  assert.equal(resolveStableId('twitter', { handle: 'jack' }), 'jack');
});

test('resolveStableId: instagram prefers pk', () => {
  assert.equal(resolveStableId('instagram', { pk: 987, handle: 'foo' }), '987');
});

test('resolveStableId: handles numeric id of 0 as a real value', () => {
  assert.equal(resolveStableId('instagram', { pk: 0 }), '0');
});

test('resolveStableId: unknown platform → null', () => {
  assert.equal(resolveStableId('myspace', { handle: 'tom' }), null);
});

test('resolveStableId: no usable field → null (generic display-name-only commenter)', () => {
  assert.equal(resolveStableId('twitter', { displayName: 'Some Name' }), null);
  assert.equal(resolveStableId('youtube', {}), null);
});

test('resolveStableId: bad inputs → null', () => {
  assert.equal(resolveStableId('twitter', null), null);
  assert.equal(resolveStableId(null, { handle: 'x' }), null);
});

test('KNOWN_PLATFORMS includes the six handlers', () => {
  for (const p of ['youtube', 'substack', 'twitter', 'instagram', 'facebook', 'tiktok']) {
    assert.ok(KNOWN_PLATFORMS.includes(p), p);
  }
});

// ------------------------------------------------------------------
// accountKey
// ------------------------------------------------------------------

test('accountKey: lowercases platform, preserves stableId case', () => {
  assert.equal(accountKey('YouTube', 'UCabcDEF'), 'youtube:UCabcDEF');
});

// ------------------------------------------------------------------
// normalizeAuthor
// ------------------------------------------------------------------

test('normalizeAuthor: maps a Substack comment author', () => {
  const out = normalizeAuthor('substack', {
    handle: 'janesmith', name: 'Jane Smith', userId: 4242,
    profileUrl: 'https://janesmith.substack.com', avatarUrl: 'https://x/a.jpg'
  });
  assert.deepEqual(out, {
    platform: 'substack',
    stableId: '4242',
    handle: 'janesmith',
    displayName: 'Jane Smith',
    profileUrl: 'https://janesmith.substack.com',
    avatarUrl: 'https://x/a.jpg',
    verified: false
  });
});

test('normalizeAuthor: maps a YouTube comment author with channelId', () => {
  const out = normalizeAuthor('youtube', {
    channelId: 'UCxyz', handle: '@janedoe', displayName: 'Jane Doe', verified: true
  });
  assert.equal(out.platform, 'youtube');
  assert.equal(out.stableId, 'UCxyz');
  assert.equal(out.handle, '@janedoe');
  assert.equal(out.verified, true);
});

test('normalizeAuthor: returns null when no stable identifier', () => {
  // Generic WordPress commenter: display name only.
  assert.equal(normalizeAuthor('wordpress', { name: 'Anonymous' }), null);
  assert.equal(normalizeAuthor('twitter', { displayName: 'No Handle' }), null);
});

test('normalizeAuthor: lowercases platform', () => {
  const out = normalizeAuthor('TWITTER', { handle: 'jack' });
  assert.equal(out.platform, 'twitter');
});

test('normalizeAuthor: coerces verified to strict boolean', () => {
  assert.equal(normalizeAuthor('twitter', { handle: 'a', verified: 'yes' }).verified, false);
  assert.equal(normalizeAuthor('twitter', { handle: 'b', verified: true }).verified, true);
});

// ------------------------------------------------------------------
// deriveAccountPubkey — the deterministic identifier
// ------------------------------------------------------------------

test('deriveAccountPubkey: returns a 64-hex x-only pubkey', async () => {
  const pub = await deriveAccountPubkey('youtube', 'UCabc');
  assert.match(pub, /^[0-9a-f]{64}$/);
});

test('deriveAccountPubkey: deterministic for the same (platform, stableId)', async () => {
  const a = await deriveAccountPubkey('youtube', 'UCabc');
  const b = await deriveAccountPubkey('youtube', 'UCabc');
  assert.equal(a, b);
});

test('deriveAccountPubkey: platform is part of the namespace', async () => {
  // Same stableId on different platforms → different pubkeys.
  const yt = await deriveAccountPubkey('youtube', 'shared-id');
  const tw = await deriveAccountPubkey('twitter', 'shared-id');
  assert.notEqual(yt, tw);
});

test('deriveAccountPubkey: distinct stableIds → distinct pubkeys', async () => {
  const a = await deriveAccountPubkey('youtube', 'UC1');
  const b = await deriveAccountPubkey('youtube', 'UC2');
  assert.notEqual(a, b);
});

test('deriveAccountPubkey: platform case does not affect derivation', async () => {
  const a = await deriveAccountPubkey('YouTube', 'UCabc');
  const b = await deriveAccountPubkey('youtube', 'UCabc');
  assert.equal(a, b);
});

test('deriveAccountPubkey: derived pubkey is a valid curve point', async () => {
  // If getPublicKey accepted the derived scalar, the pubkey is on-curve.
  // Re-derive the same way and confirm it round-trips through npub.
  const pub = await deriveAccountPubkey('substack', '4242');
  const npub = Crypto.hexToNpub(pub);
  assert.ok(npub.startsWith('npub1'));
  assert.equal(Crypto.npubToHex(npub), pub);
});

test('deriveAccountPubkey: rejects empty stableId', async () => {
  await assert.rejects(() => deriveAccountPubkey('youtube', ''));
  await assert.rejects(() => deriveAccountPubkey('', 'x'));
});

// ------------------------------------------------------------------
// makeAccountRecord
// ------------------------------------------------------------------

test('makeAccountRecord: assembles a full record with derived pubkey', async () => {
  const normalized = normalizeAuthor('youtube', {
    channelId: 'UCabc', handle: '@jane', displayName: 'Jane', verified: true
  });
  const rec = await makeAccountRecord(normalized, { now: 1700000000, seenOnUrl: 'https://yt/watch?v=1' });
  assert.equal(rec.key, 'youtube:UCabc');
  assert.match(rec.accountPubkey, /^[0-9a-f]{64}$/);
  assert.equal(rec.accountPubkey, await deriveAccountPubkey('youtube', 'UCabc'));
  assert.equal(rec.platform, 'youtube');
  assert.equal(rec.stableId, 'UCabc');
  assert.equal(rec.handle, '@jane');
  assert.equal(rec.verified, true);
  assert.equal(rec.linkedEntityId, null);
  assert.equal(rec.firstSeen, 1700000000);
  assert.equal(rec.lastSeen, 1700000000);
  assert.ok(rec.npub.startsWith('npub1'));
});

test('makeAccountRecord: accepts a preset linkedEntityId', async () => {
  const normalized = normalizeAuthor('twitter', { handle: 'jack' });
  const rec = await makeAccountRecord(normalized, { now: 1, linkedEntityId: 'entity_abc' });
  assert.equal(rec.linkedEntityId, 'entity_abc');
});

test('makeAccountRecord: rejects a non-normalized input', async () => {
  await assert.rejects(() => makeAccountRecord({ platform: 'twitter' })); // no stableId
  await assert.rejects(() => makeAccountRecord(null));
});

test('makeAccountRecord: two captures of the same account derive the same pubkey', async () => {
  // The dedup guarantee: capture @jack today and next week → same key + pubkey.
  const a = await makeAccountRecord(normalizeAuthor('twitter', { handle: 'jack', displayName: 'Jack' }), { now: 1 });
  const b = await makeAccountRecord(normalizeAuthor('twitter', { handle: 'jack', displayName: 'Jack D.' }), { now: 2 });
  assert.equal(a.key, b.key);
  assert.equal(a.accountPubkey, b.accountPubkey);
});
