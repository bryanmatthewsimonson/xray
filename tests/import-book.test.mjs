// EPUB book import — the pure helpers (metadata mapping + the
// markdown-canonical chapter hash). The orchestration (importEpub) and the
// UI panel touch chrome/IndexedDB and are verified in-extension.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// import-book.js transitively imports entity/archive modules that read
// chrome.* at call time (not load), but stub it so the import is clean.
globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb && cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

const { buildBookDescription, buildChapterArticle, chapterArticleHash } =
    await import('../src/portal/import-book.js');

const D2021 = Math.floor(Date.parse('2021-01-01') / 1000);

test('import-book: buildBookDescription — author · date · ISBN, whichever present', () => {
    assert.equal(buildBookDescription({ author: 'Jane Roe', date: D2021, isbn: '9780000000001' }),
        'Jane Roe · 2021-01-01 · ISBN 9780000000001');
    assert.equal(buildBookDescription({ author: 'Jane Roe' }), 'Jane Roe');
    assert.equal(buildBookDescription({ isbn: '123' }), 'ISBN 123');
    assert.equal(buildBookDescription({}), '');
    assert.equal(buildBookDescription(null), '');
});

test('import-book: buildChapterArticle — metadata mapping + identity', () => {
    const meta = { title: 'The Whole Book', author: 'Jane Roe', date: D2021 };
    const a = buildChapterArticle({
        chapter: { id: 'ch1', title: 'Chapter One', markdown: '# Chapter One\n\nHello there.' },
        meta, epubHash: 'a'.repeat(64), bookEntityId: 'entity_book01', bookName: 'The Whole Book', index: 0
    });
    assert.equal(a.byline, 'Jane Roe', 'author → byline');
    assert.equal(a.siteName, 'The Whole Book', 'book title → siteName (Publisher)');
    assert.equal(a.publishedAt, D2021, 'release date → publishedAt');
    assert.equal(a.title, 'Chapter One');
    assert.equal(a.contentType, 'epub');
    assert.equal(a.url, 'file:///imported/epub/aaaaaaaaaaaaaaaa/ch1', 'url = epubHash16 + spine id');
    assert.ok(a.markdown.includes('Hello there.'));
    assert.ok(/<h1/.test(a.content), 'content is the derived HTML rendering');
    assert.ok(a.excerpt.startsWith('# Chapter One Hello there.'), 'excerpt is the collapsed raw markdown (PDF/transcript convention)');
    assert.deepEqual(a.entities, [{ entity_id: 'entity_book01', type: 'thing', name: 'The Whole Book', context: '' }],
        'tagged about the book thing → groups');
    assert.equal(a.extraction.method, 'epub');
    assert.equal(a.extraction.source_hash, 'a'.repeat(64), 'keeps the .epub bytes alive');
});

test('import-book: buildChapterArticle — title/id fallbacks', () => {
    const a = buildChapterArticle({
        chapter: { markdown: 'body only' }, meta: {}, epubHash: 'b'.repeat(64),
        bookEntityId: 'entity_x', bookName: 'X', index: 4
    });
    assert.equal(a.title, 'Chapter 5', 'no title → numbered');
    assert.equal(a.url, 'file:///imported/epub/bbbbbbbbbbbbbbbb/4', 'no id → index');
    assert.equal(a.byline, '', 'no author → empty byline');
    assert.equal(a.publishedAt, null);
});

test('import-book: chapterArticleHash is markdown-canonical + deterministic', async () => {
    const meta = { title: 'B', author: 'A', date: D2021 };
    const a1 = buildChapterArticle({
        chapter: { id: 'c', title: 'C', markdown: '# C\n\nsame words' },
        meta, epubHash: 'c'.repeat(64), bookEntityId: 'entity_b', bookName: 'B', index: 0
    });
    const h1 = await chapterArticleHash(a1);
    // Deterministic.
    assert.equal(await chapterArticleHash(a1), h1);
    // Independent of the DERIVED html content — proving it hashes the markdown
    // substrate (so the row hash can't fork from the reader/publish x tag).
    const a2 = { ...a1, content: '<p>completely different html here</p>' };
    assert.equal(await chapterArticleHash(a2), h1, 'hash ignores article.content (markdown-canonical)');
    // A different markdown DOES change it.
    const a3 = { ...a1, markdown: '# C\n\ndifferent words' };
    assert.notEqual(await chapterArticleHash(a3), h1);
    assert.match(h1, /^[0-9a-f]{64}$/);
});
