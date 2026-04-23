// EventBuilder tests — issue #9.
//
// Covers the small/synchronous builders. The big one
// (buildArticleEvent) does enough storage-touching work that it
// already gets exercised end-to-end in the smoke test; pinning
// every tag here would be high-maintenance churn. Focus instead
// on the wire-shape contracts that other clients depend on:
// kind-30078 entity-sync events and kind-10002 NIP-65 relay lists.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// EventBuilder transitively imports Storage which probes
// `chrome.storage.local` at module-load time. Stub a minimal
// chrome global before importing.
globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

const { EventBuilder } = await import('../src/shared/event-builder.js');

const PUBKEY = '4ba5145ddce7322c3422096997fdf9d5cf9198312d7567b0dda275e580654a9f';

test('buildEntitySyncEvent has the d/L/l tags the userscript pull filter expects', () => {
    const ev = EventBuilder.buildEntitySyncEvent('entity_abc', 'CIPHERTEXT', 'person', PUBKEY);
    assert.equal(ev.kind, 30078);
    assert.equal(ev.pubkey, PUBKEY);
    assert.equal(ev.content, 'CIPHERTEXT');
    const dTag = ev.tags.find((t) => t[0] === 'd');
    const LTag = ev.tags.find((t) => t[0] === 'L');
    const lTag = ev.tags.find((t) => t[0] === 'l');
    const tTag = ev.tags.find((t) => t[0] === 'entity-type');
    assert.deepEqual(dTag, ['d', 'entity_abc']);
    assert.deepEqual(LTag, ['L', 'nac/entity-sync']);
    assert.deepEqual(lTag, ['l', 'v1', 'nac/entity-sync']);
    assert.deepEqual(tTag, ['entity-type', 'person']);
});

test('buildRelayListEvent emits one r-tag per relay, kind 10002', () => {
    const relays = [
        'wss://relay.damus.io',
        'wss://nos.lol',
        'wss://relay.nostr.band'
    ];
    const ev = EventBuilder.buildRelayListEvent(relays, PUBKEY);
    assert.equal(ev.kind, 10002);
    assert.equal(ev.pubkey, PUBKEY);
    assert.equal(ev.content, '');
    const rTags = ev.tags.filter((t) => t[0] === 'r');
    assert.equal(rTags.length, 3);
    assert.deepEqual(rTags.map((t) => t[1]), relays);
});

test('buildRelayListEvent ignores non-string and empty entries', () => {
    const ev = EventBuilder.buildRelayListEvent(
        ['wss://a.example', null, '', undefined, 42, 'wss://b.example'],
        PUBKEY
    );
    const rTags = ev.tags.filter((t) => t[0] === 'r');
    assert.deepEqual(rTags.map((t) => t[1]), ['wss://a.example', 'wss://b.example']);
});

test('buildRelayListEvent stamps created_at to a recent unix second', () => {
    const before = Math.floor(Date.now() / 1000);
    const ev = EventBuilder.buildRelayListEvent(['wss://a'], PUBKEY);
    const after = Math.floor(Date.now() / 1000);
    assert.ok(ev.created_at >= before && ev.created_at <= after,
        `created_at ${ev.created_at} outside [${before}, ${after}]`);
});
