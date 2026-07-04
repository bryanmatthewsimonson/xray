// PDF capture — Phase 18 C3/C4 (docs/COMPLEX_CONTENT_DESIGN.md §5).
//
// Runs in the READER (an extension page): full DOM, host permissions,
// no service-worker constraints, identical on Firefox ≥128. The heavy
// pdf.js engine is a separate lazily-imported bundle so the reader
// stays light for the 99% of opens that aren't PDFs.
//
// Provenance chain (§5.4): the ORIGINAL bytes are hashed
// (sha256 → `source_hash`) and archived in the source_documents store
// BEFORE parsing; the extracted markdown becomes the capture (and gets
// the canonical article hash exactly like an HTML capture); the
// `extraction` record ties them together. Page offsets ride along as
// `pageMap` so claims can carry page-level anchors.

import { putSourceDocument } from '../shared/archive-cache.js';
import { buildDocumentFromPages, textDensity } from '../shared/pdf-layout.js';
import { ContentExtractor } from '../shared/content-extractor.js';

const browserApi = (typeof browser !== 'undefined') ? browser : chrome;

/** sha256 (lowercase hex) over raw bytes. */
export async function sha256Bytes(buffer) {
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Lazy engine load — dist/pdf-engine.bundle.js is an ESM bundle of
// pdfjs-dist; its worker is a sibling bundle. Both are extension URLs
// (same-origin: no web_accessible_resources needed).
let _enginePromise = null;
function loadEngine() {
    if (_enginePromise) return _enginePromise;
    _enginePromise = (async () => {
        const engine = await import(browserApi.runtime.getURL('dist/pdf-engine.bundle.js'));
        engine.GlobalWorkerOptions.workerSrc =
            browserApi.runtime.getURL('dist/pdf.worker.bundle.js');
        return engine;
    })();
    return _enginePromise;
}

/**
 * Capture a PDF into a reader-shaped article object.
 *
 * @param {object} opts
 * @param {string} [opts.url]   http(s) URL to fetch (credentials
 *                              included, so cookie-gated PDFs the user
 *                              can see usually work)
 * @param {File}   [opts.file]  a locally-picked file (the offline /
 *                              auth-bound fallback)
 * @returns {Promise<object>}   article object (+ pageMap + extraction)
 */
export async function capturePdfToArticle({ url = '', file = null } = {}) {
    let bytes;
    let sourceUrl = url;
    if (file) {
        bytes = await file.arrayBuffer();
        if (!sourceUrl) sourceUrl = 'file:///' + (file.name || 'document.pdf');
    } else {
        const resp = await fetch(url, { credentials: 'include' });
        if (!resp.ok) throw new Error(`PDF fetch failed (HTTP ${resp.status})`);
        bytes = await resp.arrayBuffer();
    }
    if (!bytes || bytes.byteLength === 0) throw new Error('The PDF was empty.');

    // Archive the evidence FIRST (put() clones synchronously, so the
    // later transfer to the pdf.js worker can't corrupt the copy).
    const sourceHash = await sha256Bytes(bytes);
    let archived = false;
    try {
        const res = await putSourceDocument({
            hash: sourceHash, bytes, mime: 'application/pdf', url: sourceUrl
        });
        archived = !!res.stored;
    } catch (err) {
        console.warn('[X-Ray PDF] source archive failed (continuing):', err);
    }

    const engine = await loadEngine();
    // pdf.js transfers the buffer to its worker — hand it a copy.
    const doc = await engine.getDocument({ data: bytes.slice(0) }).promise;

    const pages = [];
    for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p);
        const viewport = page.getViewport({ scale: 1 });
        const tc = await page.getTextContent();
        pages.push({
            width: viewport.width,
            height: viewport.height,
            items: (tc.items || [])
                .filter((i) => typeof i.str === 'string')
                .map((i) => ({
                    str: i.str,
                    x: i.transform[4],
                    y: i.transform[5],
                    w: i.width || 0,
                    h: i.height || Math.abs(i.transform[3]) || 10
                }))
        });
    }

    let info = {};
    try { info = (await doc.getMetadata())?.info || {}; } catch (_) { /* optional */ }

    if (textDensity(pages) < 8) {
        throw new Error(
            'This PDF has no usable text layer — it is likely a scan. '
            + 'Machine transcription for scans is designed but not built yet '
            + '(COMPLEX_CONTENT_DESIGN.md §6).');
    }

    const { markdown, pageMap, warnings, stats } = buildDocumentFromPages(pages);
    if (!markdown.trim()) throw new Error('No text could be reconstructed from this PDF.');

    const fileName = decodeURIComponent((sourceUrl.split('/').pop() || '')
        .replace(/[?#].*$/, '').replace(/\.pdf$/i, ''));
    const title = String(info.Title || '').trim() || fileName || 'PDF document';

    return {
        url: sourceUrl,
        title,
        byline: String(info.Author || '').trim(),
        markdown,
        content: ContentExtractor.markdownToHtml(markdown),
        excerpt: markdown.replace(/\s+/g, ' ').slice(0, 280),
        contentType: 'pdf',
        platform: 'pdf',
        entities: [],
        pageMap,
        extraction: {
            method: 'pdfjs-' + (engine.version || ''),
            source_hash: sourceHash,
            page_count: doc.numPages,
            archived,
            furniture_dropped: stats.furnitureDropped,
            // Quality honesty (C4.1): present only when something looked
            // shaky — the reader banners these.
            ...(warnings && warnings.length ? { warnings } : {})
        }
    };
}
