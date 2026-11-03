// PDF capture against the REAL pdf.js (Phase 18 C3/C4).
//
// The stub-engine tests (pdf-capture-stub.test.mjs) pin OUR pipeline's
// behavior; this file pins the CONTRACT WITH pdf.js itself — the API
// surface of the pinned pdfjs-dist version driven through
// capturePdfToArticle with a real, hand-built PDF. It exists because
// that contract has already broken once silently: pdf.js 6.x removed
// PDFDocumentProxy.destroy() and a swallow-all catch hid the loss of
// teardown. A version bump that changes shapes we rely on
// (getDocument/loadingTask, getTextContent items, getViewport and its
// convertTo* methods, getAnnotations, getOperatorList, getMetadata)
// should fail HERE, loudly. It broke silently a second time for link
// annotations: the capture called viewport.convertToViewportRectangle,
// which pdf.js 6 does not have, inside a catch that cost only the
// links — so no PDF ever produced one, and the helper-level tests
// (pdf-links.test.mjs, hand-built runs and rects) stayed green.
//
// Uses the legacy build (the modern build needs DOMMatrix, absent in
// node); both builds share the same API.

import { test } from 'node:test';
import assert from 'node:assert/strict';

await import('fake-indexeddb/auto');

const LEGACY_ENGINE = new URL('../node_modules/pdfjs-dist/legacy/build/pdf.mjs', import.meta.url).href;
const LEGACY_WORKER = new URL('../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).href;

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
        getURL: (p) => (p === 'dist/pdf-engine.bundle.js'
            ? new URL('./fixtures/real-pdf-engine.mjs', import.meta.url).href
            : p === 'dist/pdf.worker.bundle.js' ? LEGACY_WORKER
            : 'chrome-extension://test/' + p)
    }
};
// The fixture engine re-exports from this URL (computed here so the
// path resolves regardless of the test runner's cwd).
globalThis.__realPdfEngineUrl = LEGACY_ENGINE;

const { capturePdfToArticle } = await import('../src/reader/pdf-capture.js');
const { EventBuilder } = await import('../src/shared/event-builder.js');
const { TV1 } = await import('./tools/fixture-keys.mjs');

// Minimal but valid PDF: correct xref offsets, Helvetica text.
// Page 1: portrait, two lines. Page 2: /Rotate 90 with a compensating
// rotated text matrix (reads horizontally in the viewer).
function buildPdf() {
    const objects = [];
    objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    objects[2] = '<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>';
    objects[3] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>';
    objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
    const s1 = 'BT /F1 12 Tf 72 700 Td (Portrait page one has a first line of text) Tj 0 -16 Td (and a second line that joins the paragraph) Tj ET';
    objects[5] = `<< /Length ${s1.length} >>\nstream\n${s1}\nendstream`;
    objects[6] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Rotate 90 /Resources << /Font << /F1 4 0 R >> >> /Contents 7 0 R >>';
    const s2 = 'BT /F1 12 Tf 0 1 -1 0 500 72 Tm (Rotated top line of the landscape page) Tj 0 1 -1 0 520 72 Tm (rotated second line follows underneath it) Tj ET';
    objects[7] = `<< /Length ${s2.length} >>\nstream\n${s2}\nendstream`;
    return serializePdf(objects);
}

// The same shape with Link annotations (Phase 27). Each linked run sits
// between two unlinked lines 16pt away and before an unlinked run on
// its own line, so the anchor text pins where the rect landed on BOTH
// axes: a rect mapped through the wrong transform, or a run measured
// on the wrong side of its baseline, reads a neighbour's words (or
// none) instead of the linked ones. /Rect is raw user space on both
// pages. Page 1: portrait, a URI link on "Read the probe source"
// (baseline y=684) plus an internal GoTo link (/Dest, no URI) that must
// not surface. Page 2: /Rotate 90 — glyphs extend toward SMALLER raw x
// there, so the box around the baseline at x=516 spans x 503..519.
function buildLinkedPdf() {
    const objects = [];
    objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    objects[2] = '<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>';
    objects[3] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R /Annots [8 0 R 9 0 R] >>';
    objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
    const s1 = 'BT /F1 12 Tf'
        + ' 1 0 0 1 72 700 Tm (Unlinked opening line above the link) Tj'
        + ' 1 0 0 1 72 684 Tm (Read the probe source) Tj'
        + ' 1 0 0 1 300 684 Tm (then keep reading on) Tj'
        + ' 1 0 0 1 72 668 Tm (unlinked closing line below the link) Tj ET';
    objects[5] = `<< /Length ${s1.length} >>\nstream\n${s1}\nendstream`;
    objects[6] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Rotate 90 /Resources << /Font << /F1 4 0 R >> >> /Contents 7 0 R /Annots [10 0 R] >>';
    const s2 = 'BT /F1 12 Tf'
        + ' 0 1 -1 0 500 72 Tm (Rotated line above the link) Tj'
        + ' 0 1 -1 0 516 72 Tm (Open the rotated source) Tj'
        + ' 0 1 -1 0 516 300 Tm (then more unlinked words) Tj'
        + ' 0 1 -1 0 532 72 Tm (rotated line below the link) Tj ET';
    objects[7] = `<< /Length ${s2.length} >>\nstream\n${s2}\nendstream`;
    objects[8] = '<< /Type /Annot /Subtype /Link /Rect [70 681 200 697] /Border [0 0 0] /A << /S /URI /URI (https://example.org/probe-source) >> >>';
    objects[9] = '<< /Type /Annot /Subtype /Link /Rect [70 665 200 681] /Border [0 0 0] /Dest [3 0 R /XYZ 0 792 0] >>';
    objects[10] = '<< /Type /Annot /Subtype /Link /Rect [503 70 519 200] /Border [0 0 0] /A << /S /URI /URI (https://example.org/rotated-source) >> >>';
    return serializePdf(objects);
}

// objects[1..n] → PDF bytes with a correct xref table.
function serializePdf(objects) {
    let out = '%PDF-1.4\n';
    const offsets = [];
    for (let i = 1; i < objects.length; i++) {
        offsets[i] = out.length;
        out += `${i} 0 obj\n${objects[i]}\nendobj\n`;
    }
    const xrefPos = out.length;
    out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
    for (let i = 1; i < objects.length; i++) out += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
    out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
    return new TextEncoder().encode(out);
}

test('real pdf.js: portrait + /Rotate 90 pages capture end-to-end', async () => {
    const file = new File([buildPdf()], 'real.pdf', { type: 'application/pdf' });
    const article = await capturePdfToArticle({ file });

    // Portrait page: lines join into one paragraph.
    assert.ok(article.markdown.includes(
        'Portrait page one has a first line of text and a second line that joins the paragraph'),
        article.markdown);
    // Rotated page: visual order, real line structure (raw user-space
    // coordinates would have jammed/reversed these).
    assert.ok(article.markdown.includes(
        'Rotated top line of the landscape page rotated second line follows underneath it'),
        article.markdown);

    // Page map: two pages, contiguous non-overlapping spans.
    assert.equal(article.pageMap.length, 2);
    assert.equal(article.pageMap[0].start, 0);
    assert.ok(article.pageMap[0].end <= article.pageMap[1].start);
    assert.equal(article.pageMap[1].end, article.markdown.length);

    // Extraction record + archive row.
    assert.match(article.extraction.method, /^pdfjs-/);
    assert.equal(article.extraction.page_count, 2);
    assert.equal(article.extraction.archived, true);
    assert.match(article.extraction.source_hash, /^[0-9a-f]{64}$/);
});

test('real pdf.js: URI link annotations reach article.links and the 30023 link tags', async () => {
    const file = new File([buildLinkedPdf()], 'linked.pdf', { type: 'application/pdf' });
    const article = await capturePdfToArticle({ file });

    // What the capture feeds downstream (deriveLinkEdges, the capture
    // frontier, the reader's Media dialog): both URI links in document
    // order, each carrying the words its rect covers on the VIEWED page
    // — on the rotated page too. The GoTo link has no url; dropped.
    assert.deepEqual(article.links, [
        { url: 'https://example.org/probe-source', text: 'Read the probe source', count: 1, internal: false },
        { url: 'https://example.org/rotated-source', text: 'Open the rotated source', count: 1, internal: false }
    ]);
    assert.equal(article.links_truncated, undefined);

    // The wire consumer: each external link publishes as a `link` tag
    // with its anchor text, and co-emits an indexed `r`.
    const ev = await EventBuilder.buildArticleEvent(article, [], TV1.pubkey);
    assert.deepEqual(ev.tags.filter((t) => t[0] === 'link'), [
        ['link', 'https://example.org/probe-source', 'Read the probe source'],
        ['link', 'https://example.org/rotated-source', 'Open the rotated source']
    ]);
    const rs = ev.tags.filter((t) => t[0] === 'r').map((t) => t[1]);
    assert.equal(rs[0], article.url, 'the FIRST r stays the article URL');
    assert.ok(rs.includes('https://example.org/probe-source'), rs.join(' '));
    assert.ok(rs.includes('https://example.org/rotated-source'), rs.join(' '));
});
