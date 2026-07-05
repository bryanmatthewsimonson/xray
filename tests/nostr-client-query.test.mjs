// NostrClient.queryRelays verify-on-ingest tests — Knowledge Sharing
// KS.1. A WebSocket stub replays scripted relay frames through the real
// handleMessage dispatch, proving that forged relay events are dropped
// before the caller sees them and that EOSE resolution is intact.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Crypto } from '../src/shared/crypto.js';

// ── WebSocket stub ─────────────────────────────────────────────────────
// Opens asynchronously; on REQ replays the events scripted for its URL,
// then EOSE. CLOSE frames are ignored.
class FakeWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  static script = new Map();   // url → [event, …]

  constructor(url) {
    this.url = url;
    this.readyState = 0;
    setTimeout(() => {
      this.readyState = FakeWebSocket.OPEN;
      if (this.onopen) this.onopen();
    }, 0);
  }

  send(frame) {
    const parsed = JSON.parse(frame);
    if (parsed[0] !== 'REQ') return;
    const subId = parsed[1];
    const events = FakeWebSocket.script.get(this.url) || [];
    setTimeout(() => {
      for (const ev of events) {
        this.onmessage({ data: JSON.stringify(['EVENT', subId, ev]) });
      }
      this.onmessage({ data: JSON.stringify(['EOSE', subId]) });
    }, 0);
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
    if (this.onclose) this.onclose({ code: 1000 });
  }
}

globalThis.WebSocket = FakeWebSocket;

const { NostrClient } = await import('../src/shared/nostr-client.js');

async function signedEvent(content) {
  const priv = Crypto.generatePrivateKey();
  const event = {
    pubkey: Crypto.getPublicKey(priv),
    created_at: 1700000000,
    kind: 1,
    tags: [],
    content
  };
  return await Crypto.signEvent(event, priv);
}

test('queryRelays returns verified events and resolves on EOSE', async () => {
  const url = 'wss://fake.relay/one';
  const a = await signedEvent('relay event A');
  const b = await signedEvent('relay event B');
  FakeWebSocket.script.set(url, [a, b]);

  const started = Date.now();
  const out = await NostrClient.queryRelays([url], { kinds: [1] }, 500);
  assert.ok(Date.now() - started < 400, 'resolved on EOSE, not the timeout');
  assert.equal(out.events.length, 2);
  assert.equal(out.invalid, 0);
  assert.equal(out.byRelay[url].received, 2);
  assert.equal(out.byRelay[url].eose, true);
});

test('queryRelays drops a forged relay event and counts it', async () => {
  const url = 'wss://fake.relay/two';
  const good = await signedEvent('honest event');
  const forged = { ...(await signedEvent('to be tampered')), content: 'relay-injected lie' };
  FakeWebSocket.script.set(url, [good, forged]);

  const out = await NostrClient.queryRelays([url], { kinds: [1] }, 500);
  assert.equal(out.events.length, 1);
  assert.equal(out.events[0].id, good.id);
  assert.equal(out.invalid, 1);
  // The forged frame was still *received* — verification happens after.
  assert.equal(out.byRelay[url].received, 2);
});

test('queryRelays drops an unsigned relay event', async () => {
  const url = 'wss://fake.relay/three';
  const bare = { id: 'f'.repeat(64), pubkey: 'e'.repeat(64), kind: 1, tags: [], content: 'no sig', created_at: 1 };
  FakeWebSocket.script.set(url, [bare]);

  const out = await NostrClient.queryRelays([url], { kinds: [1] }, 500);
  assert.equal(out.events.length, 0);
  assert.equal(out.invalid, 1);
});

test('queryRelays still dedups the same event across relays', async () => {
  const urlA = 'wss://fake.relay/four-a';
  const urlB = 'wss://fake.relay/four-b';
  const shared = await signedEvent('published to both relays');
  FakeWebSocket.script.set(urlA, [shared]);
  FakeWebSocket.script.set(urlB, [shared]);

  const out = await NostrClient.queryRelays([urlA, urlB], { kinds: [1] }, 500);
  assert.equal(out.events.length, 1);
  assert.equal(out.invalid, 0);
  assert.equal(out.byRelay[urlA].received, 1);
  assert.equal(out.byRelay[urlB].received, 1);
});
