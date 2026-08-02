// Signed-event journal (event-journal.js): verbatim storage of every
// signed event — the rebroadcast + durability substrate, and since
// 29.1 the store-first publish OUTBOX (EVENT_STORE_DESIGN §3.1):
// recordSigned lands a 'pending' row at sign time, recordFlushAttempt
// merges relay snapshots and flips to 'flushed' on a CONFIRMED OK.

import { test } from 'node:test';
import assert from 'node:assert/strict';

await import('fake-indexeddb/auto');

const {
    recordPublished, recordSigned, recordFlushAttempt,
    getByEventId, getByAddress, listByArticleUrl,
    listAll, countAll, exportBundle, eventAddress, clear, _resetForTests,
    FLUSH_BACKOFF_S
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

// ------------------------------------------------------------------
// v2 (29.1) — the outbox shape
// ------------------------------------------------------------------

test('v2: recordPublished derives the flush state and stamps signedAt', async () => {
    const now = Math.floor(Date.now() / 1000);
    const row = await recordPublished(signedEvent(), RESULTS, {});
    assert.equal(row.flush.state, 'flushed', 'a confirmed OK in the snapshot → flushed');
    assert.equal(row.flush.attempts, 1);
    assert.equal(row.flush.nextAttemptAt, null);
    assert.ok(row.signedAt >= now, 'signedAt stamped on first write');
    assert.equal(row.ledger, null);

    const assumedOnly = {
        successful: 1, confirmed: 0, failed: 0, total: 1,
        results: [{ url: 'wss://a.example', success: true, assumed: true }]
    };
    const row2 = await recordPublished(signedEvent({ id: 'a2'.padEnd(64, '0') }), assumedOnly, {});
    assert.equal(row2.flush.state, 'pending', 'assumed-only stays pending (retry doctrine)');
    assert.ok(row2.flush.nextAttemptAt > now, 'pending rows carry a backoff schedule');
});

test('v2: address is replaceableKey — kind 0 and d-less addressables get addresses', async () => {
    const kind0 = await recordPublished(signedEvent({ id: 'b2'.padEnd(64, '0'), kind: 0, tags: [] }), RESULTS, {});
    assert.equal(kind0.address, `0:${'p'.repeat(64)}`,
        'replaceable kinds address as kind:pubkey (eventAddress gave null)');
    const dless = await recordPublished(signedEvent({ id: 'c2'.padEnd(64, '0'), kind: 30040, tags: [] }), RESULTS, {});
    assert.equal(dless.address, `30040:${'p'.repeat(64)}:${'c2'.padEnd(64, '0')}`,
        'missing d falls back to the event id (the documented divergence)');
    const regular = await recordPublished(signedEvent({ id: 'd2'.padEnd(64, '0'), kind: 1985, tags: [] }), RESULTS, {});
    assert.equal(regular.address, null, 'regular kinds stay unaddressed');
});

test('recordSigned lands a pending row BEFORE any relay attempt', async () => {
    const ev = signedEvent();
    const now = Math.floor(Date.now() / 1000);
    const row = await recordSigned(ev, {
        ledger: { model: 'claim', localId: 'claim_1', extra: { dTag: 'x' } },
        articleUrl: 'https://example.com/a'
    });
    assert.deepEqual(row.event, ev, 'verbatim');
    assert.equal(row.flush.state, 'pending');
    assert.equal(row.flush.attempts, 0);
    assert.ok(row.flush.nextAttemptAt >= now, 'due immediately — the inline attempt is next');
    assert.equal(row.publishedAt, null, 'no attempt yet');
    assert.deepEqual(row.relays, []);
    assert.deepEqual(row.ledger, { model: 'claim', localId: 'claim_1', extra: { dTag: 'x' }, markedAt: null });
    assert.equal(row.articleUrl, 'https://example.com/a');
});

test('recordSigned refuses unsigned events and never downgrades a flushed row', async () => {
    await assert.rejects(() => recordSigned({ id: 'x'.repeat(64), kind: 1 }), /SIGNED event/);
    const ev = signedEvent();
    await recordPublished(ev, RESULTS, { articleUrl: 'https://example.com/a' });
    const again = await recordSigned(ev, { ledger: { model: 'claim', localId: 'c1' } });
    assert.equal(again.flush.state, 'flushed', 're-recording an already-flushed id keeps flushed');
    assert.equal(again.articleUrl, 'https://example.com/a', 'existing context survives');
    assert.deepEqual(again.ledger, { model: 'claim', localId: 'c1', extra: null, markedAt: null },
        'a missing ledger fills in from the new call');
    assert.equal(await countAll(), 1, 'upsert, not duplicate');
});

test('recordFlushAttempt: zero-confirmation attempts stay pending with backoff; a confirmed OK flushes', async () => {
    const ev = signedEvent();
    await recordSigned(ev, {});
    const now = Math.floor(Date.now() / 1000);

    // Attempt 1: all relays down.
    const failed = {
        successful: 0, confirmed: 0, failed: 2, total: 2,
        results: [
            { url: 'wss://a.example', success: false, assumed: false, error: 'down' },
            { url: 'wss://b.example', success: false, assumed: false, error: 'down' }
        ]
    };
    let row = await recordFlushAttempt(ev.id, failed);
    assert.equal(row.flush.state, 'pending', 'the signature survives a total relay failure');
    assert.equal(row.flush.attempts, 1);
    assert.ok(row.flush.nextAttemptAt >= now + FLUSH_BACKOFF_S[0], 'backoff after attempt 1');
    assert.ok(row.publishedAt >= now, 'the attempt is stamped');

    // Attempt 2: assumed-only — still not confirmation.
    const assumed = {
        successful: 1, confirmed: 0, failed: 1, total: 2,
        results: [
            { url: 'wss://a.example', success: true, assumed: true },
            { url: 'wss://b.example', success: false, assumed: false, error: 'down' }
        ]
    };
    row = await recordFlushAttempt(ev.id, assumed);
    assert.equal(row.flush.state, 'pending', 'assumed-only never marks (JOURNAL 2026-07-10)');
    assert.equal(row.flush.attempts, 2);

    // Attempt 3: one CONFIRMED OK → flushed; the merged snapshot keeps
    // per-relay history without downgrading the confirmation.
    const confirmed = {
        successful: 1, confirmed: 1, failed: 1, total: 2,
        results: [
            { url: 'wss://a.example', success: false, assumed: false, error: 'flaky' },
            { url: 'wss://b.example', success: true, assumed: false }
        ]
    };
    row = await recordFlushAttempt(ev.id, confirmed);
    assert.equal(row.flush.state, 'flushed');
    assert.equal(row.flush.nextAttemptAt, null);
    const byUrl = Object.fromEntries(row.relays.map((r) => [r.url, r]));
    assert.equal(byUrl['wss://b.example'].success, true);

    // A later failed attempt cannot downgrade the confirmed entry.
    row = await recordFlushAttempt(ev.id, failed);
    assert.equal(row.flush.state, 'flushed');
    const byUrl2 = Object.fromEntries(row.relays.map((r) => [r.url, r]));
    assert.equal(byUrl2['wss://b.example'].success, true, 'confirmed stays confirmed');
});

test('recordSigned: an EXISTING ledger descriptor always wins — a later call cannot overwrite it', async () => {
    const ev = signedEvent();
    await recordSigned(ev, { ledger: { model: 'claim', localId: 'first' } });
    const again = await recordSigned(ev, { ledger: { model: 'claim', localId: 'second' } });
    assert.deepEqual(again.ledger, { model: 'claim', localId: 'first', extra: null, markedAt: null },
        'existing-always-wins: the caller\'s values only fill fields the row lacks');
});

test('recordFlushAttempt on a never-journaled id returns null (no phantom rows)', async () => {
    assert.equal(await recordFlushAttempt('9'.repeat(64), RESULTS), null);
    assert.equal(await countAll(), 0);
});

test('getByAddress and exportBundle order on signedAt, so pending rows (publishedAt null) sort correctly', async () => {
    const addr = `30023:${'p'.repeat(64)}:article-1`;
    const older = signedEvent({ id: 'e1'.padEnd(64, '0') });
    const newer = signedEvent({ id: 'e2'.padEnd(64, '0'), created_at: 1700000100 });
    // Pin the clock so ordering is deterministic inside one second.
    const realNow = Date.now;
    try {
        const t0 = Math.floor(realNow.call(Date) / 1000);
        Date.now = () => (t0 - 100) * 1000;
        await recordPublished(older, RESULTS, {});        // published 100 s ago
        Date.now = () => t0 * 1000;
        const pending = await recordSigned(newer, {});    // signed now, never sent
        assert.equal(pending.publishedAt, null);
        const rows = await getByAddress(addr);
        assert.deepEqual(rows.map((r) => r.eventId), [newer.id, older.id],
            'newest SIGNED first — a pending row is never pushed last for lacking publishedAt');
        const bundle = await exportBundle();
        assert.equal(bundle.count, 2, 'the bundle includes signed-but-nowhere-accepted events (§5 widening)');
        assert.deepEqual(bundle.events.map((e) => e.id), [older.id, newer.id], 'oldest signed first');
    } finally {
        Date.now = realNow;
    }
});
