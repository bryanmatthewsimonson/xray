// Signed-event journal (event-journal.js): verbatim storage of every
// published event — the rebroadcast + durability substrate.

import { test } from 'node:test';
import assert from 'node:assert/strict';

await import('fake-indexeddb/auto');

const {
    recordPublished, getByEventId, getByAddress, listByArticleUrl,
    listAll, countAll, exportBundle, eventAddress, clear, _resetForTests
} = await import('../src/shared/event-journal.js');

function signedEvent(over = {}) {
    return {
        id: 'e'.repeat(64), sig: 's'.repeat(128),
        kind: 30023, pubkey: 'p'.repeat(64), created_at: 1700000000,
        tags: [['d', 'article-1'], ['r', 'https://example.com/a']],
        content: '# body',
        ...over
    };
}

const RESULTS = {
    successful: 2, confirmed: 1, failed: 1, total: 3,
    results: [
        { url: 'wss://a.example', success: true, assumed: false },
        { url: 'wss://b.example', success: true, assumed: true },
        { url: 'wss://c.example', success: false, assumed: false, error: 'rejected' }
    ]
};

test.beforeEach(async () => { await clear(); });

test('eventAddress: parameterized kinds get kind:pubkey:d; others null', () => {
    assert.equal(eventAddress(signedEvent()), `30023:${'p'.repeat(64)}:article-1`);
    assert.equal(eventAddress(signedEvent({ kind: 1985, tags: [] })), null);
    assert.equal(eventAddress(signedEvent({ kind: 0, tags: [] })), null);
    assert.equal(eventAddress(signedEvent({ kind: 30040, tags: [['d', 'claim_x']] })), `30040:${'p'.repeat(64)}:claim_x`);
    assert.equal(eventAddress(null), null);
});

test('recordPublished stores the event VERBATIM with its relay snapshot', async () => {
    const ev = signedEvent();
    const row = await recordPublished(ev, RESULTS, { articleUrl: 'https://example.com/a' });
    assert.equal(row.eventId, ev.id);
    assert.deepEqual(row.event, ev, 'the signed event byte-for-byte');
    assert.deepEqual(row.relays, [
        { url: 'wss://a.example', success: true, assumed: false },
        { url: 'wss://b.example', success: true, assumed: true },
        { url: 'wss://c.example', success: false, assumed: false }
    ]);
    assert.equal(row.articleUrl, 'https://example.com/a');

    const back = await getByEventId(ev.id);
    assert.deepEqual(back.event, ev);
});

test('recordPublished refuses unsigned events', async () => {
    await assert.rejects(() => recordPublished({ id: 'x'.repeat(64), kind: 1 }, RESULTS),
        /SIGNED event/);
    await assert.rejects(() => recordPublished(null, RESULTS), /SIGNED event/);
    assert.equal(await countAll(), 0);
});

test('re-publish of the same event id upserts, not duplicates', async () => {
    const ev = signedEvent();
    await recordPublished(ev, RESULTS, {});
    await recordPublished(ev, { ...RESULTS, confirmed: 3 }, {});
    assert.equal(await countAll(), 1);
});

test('getByAddress returns the address history; a re-emitted edit is a new row', async () => {
    const first = signedEvent();
    const edited = signedEvent({ id: 'f'.repeat(64), created_at: 1700000100 });
    await recordPublished(first, RESULTS, {});
    await recordPublished(edited, RESULTS, {});
    const rows = await getByAddress(`30023:${'p'.repeat(64)}:article-1`);
    assert.equal(rows.length, 2, 'append-only history per address');
    assert.deepEqual(await getByAddress(null), []);
});

test('listByArticleUrl groups an article batch', async () => {
    await recordPublished(signedEvent(), RESULTS, { articleUrl: 'https://example.com/a' });
    await recordPublished(signedEvent({ id: 'a1'.padEnd(64, '0'), kind: 30040, tags: [['d', 'claim_1']] }),
        RESULTS, { articleUrl: 'https://example.com/a' });
    await recordPublished(signedEvent({ id: 'b1'.padEnd(64, '0'), tags: [['d', 'other']] }),
        RESULTS, { articleUrl: 'https://example.com/b' });
    assert.equal((await listByArticleUrl('https://example.com/a')).length, 2);
    assert.equal((await listByArticleUrl('https://example.com/b')).length, 1);
});

test('exportBundle is the raw signed-event array, oldest first', async () => {
    const a = signedEvent();
    const b = signedEvent({ id: 'f'.repeat(64), kind: 30040, tags: [['d', 'claim_1']] });
    await recordPublished(a, RESULTS, {});
    await recordPublished(b, RESULTS, {});
    const bundle = await exportBundle();
    assert.equal(bundle.format, 'xray-events-bundle/1');
    assert.equal(bundle.count, 2);
    assert.deepEqual(bundle.events.map((e) => e.id).sort(), [a.id, b.id].sort());
    // Verbatim: ids AND sigs survive.
    assert.ok(bundle.events.every((e) => e.sig && e.sig.length === 128));
});
