// PDF capture against the REAL pdf.js (Phase 18 C3/C4).
//
// The stub-engine tests (pdf-capture-stub.test.mjs) pin OUR pipeline's
// behavior; this file pins the CONTRACT WITH pdf.js itself — the API
// surface of the pinned pdfjs-dist version driven through
// capturePdfToArticle with a real, hand-built PDF. It exists because
// that contract has already broken once silently: pdf.js 6.x removed
// PDFDocumentProxy.destroy() and a swallow-all catch hid the loss of
// teardown. A version bump that changes shapes we rely on
// (getDocument/loadingTask, getTextContent items, getViewport,
// getOperatorList, getMetadata) should fail HERE, loudly.
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
