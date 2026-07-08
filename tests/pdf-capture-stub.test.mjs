// PDF capture pipeline against a stub engine — Phase 18 C3/C4
// regression tests for behavior only reachable through
// capturePdfToArticle itself:
//
//   1. Teardown goes through the LOADING TASK (pdf.js 6.x removed
//      PDFDocumentProxy.destroy(); calling the absent method inside a
//      swallow-all catch silently skipped cleanup — the worker document
//      and its decoded bitmaps leaked for the tab's lifetime), on the
//      success AND the refusal paths.
//   2. /Rotate pages: getTextContent transforms are raw user space;
//      the capture must map them through the viewport (where pdf.js
//      applies /Rotate + the MediaBox origin) or a rotated page's
//      visual lines share one baseline and reconstruct as jammed,
//      wrongly-ordered text.
//   3. The source bytes archive row and extraction record.

import { test } from 'node:test';
import assert from 'node:assert/strict';

await import('fake-indexeddb/auto');

const _store = new Map();
globalThis.chrome = {
    storage: {
        local: {
            get(keys, cb) { const o = {}; for (const k of (Array.isArray(keys) ? keys : [keys])) if (_store.has(k)) o[k] = _store.get(k); cb(o); },
            set(obj, cb) { for (const [k, v] of Object.entries(obj)) _store.set(k, v); cb && cb(); },
            remove(keys, cb) { for (const k of (Array.isArray(keys) ? keys : [keys])) _store.delete(k); cb && cb(); }
        }
    },
    runtime: {
        // Route the lazy engine import at the stub module.
        getURL: (p) => (p === 'dist/pdf-engine.bundle.js'
            ? new URL('./fixtures/stub-pdf-engine.mjs', import.meta.url).href
            : 'chrome-extension://test/' + p)
    }
};

const { capturePdfToArticle } = await import('../src/reader/pdf-capture.js');
const { getSourceDocument } = await import('../src/shared/archive-cache.js');

// --- stub document builders -----------------------------------------

function stubPage({ viewport, items }) {
    return {
        getViewport: () => viewport,
        getTextContent: async () => ({ items }),
        getOperatorList: async () => ({ fnArray: [], argsArray: [] }),
        cleanup() {},
        objs: { get(_n, cb) { cb(null); } },
        commonObjs: { get(_n, cb) { cb(null); } }
    };
}

function stubDoc(pages, info = {}) {
    return {
        numPages: pages.length,
        getPage: async (p) => pages[p - 1],
        getMetadata: async () => ({ info })
    };
}

// pdf.js PageViewport at scale 1 for a 612×792 page.
const PORTRAIT = {
    width: 612, height: 792, rotation: 0,
    transform: [1, 0, 0, -1, 0, 792],
    convertToViewportPoint: (x, y) => [x, 792 - y]
};
// Same page with /Rotate 90 (values verified against pdf.js 6.1.200:
// viewport 792×612, transform [0,1,1,0,0,0]).
const ROTATED = {
    width: 792, height: 612, rotation: 90,
    transform: [0, 1, 1, 0, 0, 0],
    convertToViewportPoint: (x, y) => [y, x]
};

function textItem(str, x, y, { rotated = false, width = 100, height = 12 } = {}) {
    // pdf.js text items: transform in RAW user space; a page authored
    // for /Rotate 90 viewing rotates its text matrix to compensate.
    return {
        str, width, height,
        transform: rotated ? [0, height, -height, 0, x, y] : [height, 0, 0, height, x, y]
    };
}

async function capture(doc, name = 'doc.pdf', bytes = null) {
    globalThis.__stubPdfEngine = { doc };
    const payload = bytes || crypto.getRandomValues(new Uint8Array(64));
    const file = new File([payload], name, { type: 'application/pdf' });
    const article = await capturePdfToArticle({ file });
    return { article, cfg: globalThis.__stubPdfEngine };
}

// --- tests -----------------------------------------------------------

test('pdf capture: teardown destroys the LOADING TASK on success', async () => {
    const doc = stubDoc([stubPage({
        viewport: PORTRAIT,
        items: [
            textItem('A perfectly ordinary opening line of text', 72, 700),
            textItem('And a second line below it to be safe', 72, 680)
        ]
    })]);
    const { article, cfg } = await capture(doc);
    assert.match(article.markdown, /ordinary opening line/);
    assert.equal(cfg.destroyCalls, 1,
        'loadingTask.destroy() must run after a successful capture');
});

test('pdf capture: teardown destroys the loading task on scan refusal too', async () => {
    const doc = stubDoc([stubPage({ viewport: PORTRAIT, items: [] })]);
    await assert.rejects(() => capture(doc), /no usable text layer/i);
    assert.equal(globalThis.__stubPdfEngine.destroyCalls, 1,
        'the refusal path must not leak the worker document');
});

test('pdf capture: /Rotate 90 pages reconstruct in viewed order with real lines', async () => {
    // Three visual lines on a rotated page. In raw user space they all
    // share y=72 (one baseline!) at x=500/520/540 — the pre-fix mapping
    // clustered them into a single jammed line. Viewed (y-up viewport
    // space) they are three baselines 20pt apart: Alpha, Beta, Gamma.
    const doc = stubDoc([stubPage({
        viewport: ROTATED,
        items: [
            textItem('Alpha line of rotated text', 500, 72, { rotated: true }),
            textItem('Beta line of rotated text', 520, 72, { rotated: true }),
            textItem('Gamma line of rotated text', 540, 72, { rotated: true })
        ]
    })]);
    const { article } = await capture(doc);
    assert.equal(article.markdown,
        'Alpha line of rotated text Beta line of rotated text Gamma line of rotated text');
    assert.deepEqual(article.pageMap, [{ page: 1, start: 0, end: article.markdown.length }]);
});

test('pdf capture: source bytes archived under their sha256, recorded on extraction', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.7 stub-bytes-for-archive');
    const doc = stubDoc([stubPage({
        viewport: PORTRAIT,
        items: [textItem('Enough text to clear the scan gate easily', 72, 700)]
    })], { Title: 'Stub Title' });
    const { article } = await capture(doc, 'report.pdf', bytes);

    assert.equal(article.title, 'Stub Title');
    assert.equal(article.contentType, 'pdf');
    assert.equal(article.extraction.page_count, 1);
    assert.equal(article.extraction.archived, true);
    assert.match(article.extraction.source_hash, /^[0-9a-f]{64}$/);
    assert.match(article.url,
        new RegExp('^file:///imported/' + article.extraction.source_hash.slice(0, 16) + '/report\\.pdf$'),
        'local imports key identity on the content hash');

    const row = await getSourceDocument(article.extraction.source_hash);
    assert.ok(row, 'original bytes must be in the source_documents store');
    assert.equal(row.mime, 'application/pdf');
    assert.equal(new TextDecoder().decode(row.bytes), '%PDF-1.7 stub-bytes-for-archive');
});

test('pdf capture: a fragment on the source URL does not fork the identity', async () => {
    const doc = stubDoc([stubPage({
        viewport: PORTRAIT,
        items: [textItem('Enough text to clear the scan gate easily', 72, 700)]
    })]);
    globalThis.__stubPdfEngine = { doc };
    const file = new File([new TextEncoder().encode('%PDF-frag')], 'x.pdf');
    const article = await capturePdfToArticle({ file, url: 'https://docs.test/paper.pdf#page=3' });
    assert.equal(article.url, 'https://docs.test/paper.pdf');
});
