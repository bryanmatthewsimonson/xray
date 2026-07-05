// verifyEvents tests — Knowledge Sharing KS.1 (verify-on-ingest).
//
// Relay-supplied events are untrusted input; verifyEvents partitions a
// batch into BIP-340-valid events and a dropped count. The verified-id
// cache may skip the Schnorr math on repeats but must never skip the
// id-equals-content-hash check.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Crypto } from '../src/shared/crypto.js';
import { verifyEvents } from '../src/shared/nostr-events.js';

async function signedEvent(content = 'hello', kind = 1) {
  const priv = Crypto.generatePrivateKey();
  const event = {
    pubkey: Crypto.getPublicKey(priv),
    created_at: 1700000000,
    kind,
    tags: [],
    content
  };
  return await Crypto.signEvent(event, priv);
}

function flipHexChar(hex, index = 0) {
  const c = hex[index] === '0' ? '1' : '0';
  return c + hex.slice(1);
}

test('valid signed event passes', async () => {
  const ev = await signedEvent('valid passes');
  const { valid, dropped } = await verifyEvents([ev]);
  assert.equal(valid.length, 1);
  assert.equal(valid[0], ev);
  assert.equal(dropped, 0);
});

test('tampered content is dropped (id no longer matches)', async () => {
  const ev = await signedEvent('original content A');
  const forged = { ...ev, content: 'tampered content' };
  const { valid, dropped } = await verifyEvents([forged]);
  assert.equal(valid.length, 0);
  assert.equal(dropped, 1);
});

test('tampered signature is dropped', async () => {
  const ev = await signedEvent('original content B');
  const forged = { ...ev, sig: flipHexChar(ev.sig) };
  const { valid, dropped } = await verifyEvents([forged]);
  assert.equal(valid.length, 0);
  assert.equal(dropped, 1);
});

test('swapped pubkey is dropped', async () => {
  const ev = await signedEvent('original content C');
  const other = Crypto.getPublicKey(Crypto.generatePrivateKey());
  const forged = { ...ev, pubkey: other };
  const { valid, dropped } = await verifyEvents([forged]);
  assert.equal(valid.length, 0);
  assert.equal(dropped, 1);
});

test('forged id is dropped', async () => {
  const ev = await signedEvent('original content D');
  const forged = { ...ev, id: flipHexChar(ev.id) };
  const { valid, dropped } = await verifyEvents([forged]);
  assert.equal(valid.length, 0);
  assert.equal(dropped, 1);
});

test('missing sig / pubkey / id are dropped up front', async () => {
  const ev = await signedEvent('original content E');
  const noSig = { ...ev };    delete noSig.sig;
  const noPub = { ...ev };    delete noPub.pubkey;
  const noId  = { ...ev };    delete noId.id;
  const { valid, dropped } = await verifyEvents([noSig, noPub, noId, null]);
  assert.equal(valid.length, 0);
  assert.equal(dropped, 4);
});

test('mixed batch partitions correctly and preserves order', async () => {
  const a = await signedEvent('mixed A');
  const b = await signedEvent('mixed B');
  const bad = { ...(await signedEvent('mixed C')), content: 'oops' };
  const { valid, dropped } = await verifyEvents([a, bad, b]);
  assert.deepEqual(valid, [a, b]);
  assert.equal(dropped, 1);
});

test('cache hit skips Schnorr but never the content-hash check', async () => {
  const ev = await signedEvent('cache semantics');
  const first = await verifyEvents([ev]);
  assert.equal(first.valid.length, 1);

  // Same id + same content but garbled sig: passes via the cache
  // (the Schnorr check is skipped on a known-good id; the content is
  // still exactly what was verified, because the id binds it).
  const garbledSig = { ...ev, sig: flipHexChar(ev.sig) };
  const second = await verifyEvents([garbledSig]);
  assert.equal(second.valid.length, 1, 'cached id with identical content passes');

  // Same (cached) id but tampered content: the hash re-check drops it.
  const tampered = { ...ev, content: 'evil twin' };
  const third = await verifyEvents([tampered]);
  assert.equal(third.valid.length, 0, 'cached id must not launder tampered content');
  assert.equal(third.dropped, 1);
});

test('empty and non-array input', async () => {
  assert.deepEqual(await verifyEvents([]), { valid: [], dropped: 0 });
  assert.deepEqual(await verifyEvents(undefined), { valid: [], dropped: 0 });
});

test('chunking survives batches larger than one chunk', async () => {
  const evs = [];
  for (let i = 0; i < 7; i++) evs.push(await signedEvent('chunk ' + i));
  const { valid, dropped } = await verifyEvents(evs, { chunkSize: 3 });
  assert.equal(valid.length, 7);
  assert.equal(dropped, 0);
});
