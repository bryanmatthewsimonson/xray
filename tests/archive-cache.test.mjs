// Archive cache tests — Phase 7 (issue #18).
//
// Uses `fake-indexeddb` to give us a real-enough IDB in Node so we
// can exercise the open/upgrade/put/get/eviction paths without
// mocking the module's internals.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// Install fake-indexeddb BEFORE the cache module is imported so the
// module's `globalThis.indexedDB` lookup lands on the fake.
await import('fake-indexeddb/auto');

const {
    openArchiveDb, urlHash,
    saveArticle, getArticle, hasArticle, deleteArticle,
    listArticles, count, clear, evictIfNeeded, _resetForTests
} = await import('../src/shared/archive-cache.js');

async function resetStore() {
    try { await clear(); } catch (_) { /* db may not exist yet */ }
}

// ---------------------------------------------------------------------

test('archive: urlHash normalizes + shortens to 16 hex', async () => {
    const a = await urlHash('https://Example.COM/path?utm_source=x&foo=1');
    const b = await urlHash('https://example.com/path?foo=1');
    assert.equal(a, b, 'tracking-param strip + hostname lowercasing should collide');
    assert.match(a, /^[0-9a-f]{16}$/);

    const c = await urlHash('https://example.com/different');
    assert.notEqual(a, c);
});

test('archive: save + get round-trip, stamps cachedAt + lastAccessed', async () => {
    await resetStore();
    const article = { url: 'https://example.com/a', title: 'A', content: '<p>x</p>' };
    const saved = await saveArticle({ article });
    assert.match(saved.urlHash, /^[0-9a-f]{16}$/);
    assert.ok(saved.cachedAt > 0);
    assert.ok(saved.lastAccessed >= saved.cachedAt);
    assert.equal(saved.source, 'capture');
    assert.equal(saved.publishedToRelay, false);

    const fetched = await getArticle('https://example.com/a');
    assert.ok(fetched);
    assert.equal(fetched.article.title, 'A');
});

test('archive: save merges publish metadata on existing entry', async () => {
    await resetStore();
    const article = { url: 'https://example.com/b', title: 'B' };

    // Initial capture — unpublished.
    const first = await saveArticle({ article });
    assert.equal(first.publishedToRelay, false);

    // Same URL, now with publish metadata. cachedAt should stick;
    // lastAccessed should bump; publish flags should land.
    const second = await saveArticle({
        article,
        publishedToRelay: true,
        publishedEventId: 'deadbeef'.repeat(8)
    });
    assert.equal(second.cachedAt, first.cachedAt,               'cachedAt preserved');
    assert.ok(second.lastAccessed >= first.lastAccessed,         'lastAccessed bumped');
    assert.equal(second.publishedToRelay, true);
    assert.equal(second.publishedEventId, 'deadbeef'.repeat(8));
});

test('archive: hasArticle is a cheap boolean — no payload read', async () => {
    await resetStore();
    assert.equal(await hasArticle('https://example.com/c'), false);
    await saveArticle({ article: { url: 'https://example.com/c', title: 'C' } });
    assert.equal(await hasArticle('https://example.com/c'), true);
});

test('archive: delete removes entry', async () => {
    await resetStore();
    await saveArticle({ article: { url: 'https://example.com/d', title: 'D' } });
    assert.equal(await hasArticle('https://example.com/d'), true);
    await deleteArticle('https://example.com/d');
    assert.equal(await hasArticle('https://example.com/d'), false);
});

test('archive: evictIfNeeded respects LRU and published-first ordering', async () => {
    await resetStore();

    // 6 entries: 3 published (safe to evict) + 3 unpublished (precious).
    // We manually backdate lastAccessed to control eviction order.
    const db = await openArchiveDb();
    const rows = [
        { urlHash: '00'.repeat(8), url: 'https://e.com/1', article: { url: 'https://e.com/1', title: '1' }, cachedAt: 100, lastAccessed: 101, source: 'capture', publishedToRelay: true,  publishedEventId: null },
        { urlHash: '01'.repeat(8), url: 'https://e.com/2', article: { url: 'https://e.com/2', title: '2' }, cachedAt: 100, lastAccessed: 102, source: 'capture', publishedToRelay: true,  publishedEventId: null },
        { urlHash: '02'.repeat(8), url: 'https://e.com/3', article: { url: 'https://e.com/3', title: '3' }, cachedAt: 100, lastAccessed: 103, source: 'capture', publishedToRelay: true,  publishedEventId: null },
        { urlHash: '03'.repeat(8), url: 'https://e.com/4', article: { url: 'https://e.com/4', title: '4' }, cachedAt: 100, lastAccessed: 201, source: 'capture', publishedToRelay: false, publishedEventId: null },
        { urlHash: '04'.repeat(8), url: 'https://e.com/5', article: { url: 'https://e.com/5', title: '5' }, cachedAt: 100, lastAccessed: 202, source: 'capture', publishedToRelay: false, publishedEventId: null },
        { urlHash: '05'.repeat(8), url: 'https://e.com/6', article: { url: 'https://e.com/6', title: '6' }, cachedAt: 100, lastAccessed: 203, source: 'capture', publishedToRelay: false, publishedEventId: null }
    ];
    const tx = db.transaction('articles', 'readwrite');
    for (const r of rows) tx.objectStore('articles').put(r);
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; tx.onabort = rej; });

    // Keep only 2 entries. Expected eviction order: oldest published
    // first (00, 01, 02) then oldest unpublished (03, 04), leaving
    // 05. Wait — 6 entries, keep 2, evict 4.
    //
    //   sort: published-first, then LRU-first within tier:
    //     00 (pub, LA=101)
    //     01 (pub, LA=102)
    //     02 (pub, LA=103)
    //     03 (unpub, LA=201)
    //     04 (unpub, LA=202)
    //     05 (unpub, LA=203)
    //
    //   evict the first 4 → survivors are 04 and 05.
    const removed = await evictIfNeeded(2);
    assert.equal(removed, 4);

    const remainingUrls = (await listArticles()).map((r) => r.url).sort();
    assert.deepEqual(remainingUrls, ['https://e.com/5', 'https://e.com/6']);
});

test('archive: eviction is a no-op when under the limit', async () => {
    await resetStore();
    await saveArticle({ article: { url: 'https://example.com/solo', title: 'Solo' } });
    const removed = await evictIfNeeded(500);
    assert.equal(removed, 0);
    assert.equal(await count(), 1);
});

test('archive: relay-sourced entry flagged differently from captures', async () => {
    await resetStore();
    const saved = await saveArticle({
        article: { url: 'https://example.com/reconstruct', title: 'R' },
        source:  'relay'
    });
    assert.equal(saved.source, 'relay');
});
