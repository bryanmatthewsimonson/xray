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

// Since 13.4 the cache imports event-builder (for the canonical
// article-hash body assembly), which transitively imports Storage —
// and storage.js probes `chrome.storage.local` at module-load time.
// Stub a minimal chrome global before importing (the
// event-builder.test.mjs idiom).
globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

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

// ---------------------------------------------------------------------
// Source documents (v3 — Phase 18 C3)
// ---------------------------------------------------------------------

test('source documents: put/get round-trip, idempotent, keyed by hash', async () => {
    const { putSourceDocument, getSourceDocument } = await import('../src/shared/archive-cache.js');
    const bytes = new TextEncoder().encode('%PDF-1.7 fake body').buffer;
    const hash = 'a'.repeat(64);

    const first = await putSourceDocument({ hash, bytes, mime: 'application/pdf', url: 'https://x.test/a.pdf' });
    assert.equal(first.stored, true);

    const row = await getSourceDocument(hash);
    assert.ok(row);
    assert.equal(row.mime, 'application/pdf');
    assert.equal(row.url, 'https://x.test/a.pdf');
    assert.equal(row.size, bytes.byteLength);
    assert.equal(new TextDecoder().decode(row.bytes), '%PDF-1.7 fake body');

    // Idempotent: a second put for the same hash leaves the row alone.
    const again = await putSourceDocument({ hash, bytes, mime: 'application/pdf', url: 'https://elsewhere.test/b.pdf' });
    assert.equal(again.stored, true);
    assert.equal((await getSourceDocument(hash)).url, 'https://x.test/a.pdf');

    assert.equal(await getSourceDocument('f'.repeat(64)), null);
    assert.equal(await getSourceDocument(''), null);
});

test('source documents: oversized bytes are refused (hash-only provenance)', async () => {
    const { putSourceDocument, getSourceDocument, SOURCE_DOC_MAX_BYTES } =
        await import('../src/shared/archive-cache.js');
    const fake = { byteLength: SOURCE_DOC_MAX_BYTES + 1 };
    const res = await putSourceDocument({ hash: 'b'.repeat(64), bytes: fake, mime: 'application/pdf' });
    assert.equal(res.stored, false);
    assert.match(res.reason, /large/i);
    assert.equal(await getSourceDocument('b'.repeat(64)), null);
});

// Age every source-document row past the pruner's 30-minute grace so
// pruneSourceOrphans actually considers it.
async function ageSourceRows() {
    const { openArchiveDb } = await import('../src/shared/archive-cache.js');
    const db = await openArchiveDb();
    const t = db.transaction('source_documents', 'readwrite');
    const store = t.objectStore('source_documents');
    await new Promise((resolve, reject) => {
        const cur = store.openCursor();
        cur.onsuccess = () => {
            const c = cur.result;
            if (!c) return resolve();
            c.update({ ...c.value, fetchedAt: 1000 });
            c.continue();
        };
        cur.onerror = () => reject(cur.error);
    });
}

test('prune: a figure shared across PDFs survives while ANY article cites it', async () => {
    const { putSourceDocument, getSourceDocument, pruneSourceOrphans } =
        await import('../src/shared/archive-cache.js');
    await resetStore();
    const HASH_A = 'a1'.repeat(32);   // PDF A — its article row is gone
    const HASH_B = 'b1'.repeat(32);   // PDF B — article row still live
    const FIG = 'f1'.repeat(32);      // figure appearing in BOTH PDFs

    await putSourceDocument({ hash: HASH_A, bytes: new ArrayBuffer(8), mime: 'application/pdf', url: 'https://a.test/a.pdf' });
    // Figure stored during A's capture: its url records A as parent.
    await putSourceDocument({ hash: FIG, bytes: new ArrayBuffer(8), mime: 'image/png', url: 'pdf-figure:' + HASH_A });
    await putSourceDocument({ hash: HASH_B, bytes: new ArrayBuffer(8), mime: 'application/pdf', url: 'https://b.test/b.pdf' });
    // B's capture of the same figure dedupes onto the existing row —
    // the parent url still names A.
    await putSourceDocument({ hash: FIG, bytes: new ArrayBuffer(8), mime: 'image/png', url: 'pdf-figure:' + HASH_B });

    // Only B's article exists; its markdown cites the shared figure.
    await saveArticle({
        article: {
            url: 'https://b.test/b.pdf', title: 'B', contentType: 'pdf',
            markdown: 'Intro\n\n![Figure 1](xray-figure:' + FIG + ')\n\nBody',
            content: 'Intro figure body',
            extraction: { source_hash: HASH_B }
        }
    });

    await ageSourceRows();
    await pruneSourceOrphans();

    assert.equal(await getSourceDocument(HASH_A), null, 'unreferenced PDF bytes pruned');
    assert.ok(await getSourceDocument(HASH_B), 'referenced PDF bytes kept');
    assert.ok(await getSourceDocument(FIG),
        'figure cited by a live article must survive its first parent\'s eviction');
});

test('prune: displaced prior versions keep their source bytes and figures', async () => {
    const { putSourceDocument, getSourceDocument, pruneSourceOrphans } =
        await import('../src/shared/archive-cache.js');
    await resetStore();
    const S1 = 'a2'.repeat(32);
    const S2 = 'b2'.repeat(32);
    const FIG1 = 'c2'.repeat(32);
    const FIG2 = 'd2'.repeat(32);
    for (const [hash, mime, url] of [
        [S1, 'application/pdf', 'https://v.test/doc.pdf'],
        [S2, 'application/pdf', 'https://v.test/doc.pdf'],
        [FIG1, 'image/png', 'pdf-figure:' + S1],
        [FIG2, 'image/png', 'pdf-figure:' + S2]
    ]) {
        await putSourceDocument({ hash, bytes: new ArrayBuffer(8), mime, url });
    }

    // v1 capture, then a re-capture with different content — v1 is
    // displaced into priorVersions (13.4 stealth-edit retention).
    await saveArticle({
        article: {
            url: 'https://v.test/doc.pdf', title: 'v1', contentType: 'pdf',
            markdown: 'v1 body ![f](xray-figure:' + FIG1 + ')',
            content: 'v1 body',
            extraction: { source_hash: S1 }
        }
    });
    await saveArticle({
        article: {
            url: 'https://v.test/doc.pdf', title: 'v2', contentType: 'pdf',
            markdown: 'v2 body ![f](xray-figure:' + FIG2 + ')',
            content: 'v2 body different',
            extraction: { source_hash: S2 }
        }
    });
    const rec = await getArticle('https://v.test/doc.pdf');
    assert.equal((rec.priorVersions || []).length, 1, 'v1 snapshot retained');

    await ageSourceRows();
    await pruneSourceOrphans();

    assert.ok(await getSourceDocument(S2), 'current version bytes kept');
    assert.ok(await getSourceDocument(FIG2), 'current version figure kept');
    assert.ok(await getSourceDocument(S1),
        'displaced version\'s source bytes are still local evidence');
    assert.ok(await getSourceDocument(FIG1), 'displaced version\'s figure kept');
});
