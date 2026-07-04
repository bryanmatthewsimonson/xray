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

// Figure extraction bounds (C4.2). Displayed size is in PDF points,
// intrinsic size in pixels; both floors skip decorations. A hash that
// recurs on ≥ FIGURE_FURNITURE_PAGES pages is page furniture (logos,
// watermarks) — dropped like repeating header text.
const FIGURE_MIN_POINTS = 40;
const FIGURE_MIN_PIXELS = 40;
const FIGURE_FURNITURE_PAGES = 3;
const FIGURE_MAX_COUNT = 40;

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

// ------------------------------------------------------------------
// Figure extraction (C4.2) — image XObjects from the operator list
// ------------------------------------------------------------------

// 2×3 matrix multiply (PDF transform composition).
function matMul(m1, m2) {
    return [
        m1[0] * m2[0] + m1[2] * m2[1],
        m1[1] * m2[0] + m1[3] * m2[1],
        m1[0] * m2[2] + m1[2] * m2[3],
        m1[1] * m2[2] + m1[3] * m2[3],
        m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
        m1[1] * m2[4] + m1[3] * m2[5] + m1[5]
    ];
}

// Resolve a decoded image object from the page (falls back to the
// document-common store). pdf.js resolves these asynchronously via a
// callback; some builds only send large images at render time, so a
// timeout keeps a never-resolved object from wedging the whole capture
// — it becomes a skipped figure (visible in figures_diag), not a hang.
const OBJECT_RESOLVE_TIMEOUT_MS = 8000;
function getPageObject(page, name) {
    return new Promise((resolve) => {
        let settled = false;
        const done = (v) => { if (!settled) { settled = true; resolve(v); } };
        setTimeout(() => done(null), OBJECT_RESOLVE_TIMEOUT_MS);
        try {
            page.objs.get(name, done);
        } catch (_) {
            try { page.commonObjs.get(name, done); }
            catch (_) { done(null); }
        }
    });
}

// Is `v` a drawImage-able source (ImageBitmap / canvas)? Treated by
// duck-typing so it works even where the global constructors differ.
function isDrawable(v) {
    if (!v || typeof v !== 'object') return false;
    if (typeof ImageBitmap !== 'undefined' && v instanceof ImageBitmap) return true;
    if (typeof OffscreenCanvas !== 'undefined' && v instanceof OffscreenCanvas) return true;
    if (typeof HTMLCanvasElement !== 'undefined' && v instanceof HTMLCanvasElement) return true;
    // Duck-type: has width/height and looks bitmap-ish (has close()) or is a canvas.
    return typeof v.width === 'number' && typeof v.height === 'number'
        && (typeof v.close === 'function' || typeof v.getContext === 'function');
}

// Decoded image → PNG bytes. pdf.js 6.x hands back image objects in
// several shapes depending on the worker/OffscreenCanvas path:
//   • the object IS an ImageBitmap/canvas (bare drawable),
//   • { bitmap: <drawable>, width, height }  (OffscreenCanvas path),
//   • { data: <TypedArray>, width, height, kind }  (raw channels; kind is
//     pdf.js ImageKind — 1 GRAYSCALE_1BPP(packed), 2 RGB_24BPP, 3 RGBA_32BPP).
// We handle all of them; unknown shapes return null (figure is skipped,
// never a failed capture).
async function imageToPngBytes(img) {
    if (!img) return null;

    const drawable = isDrawable(img) ? img
        : (img.bitmap && isDrawable(img.bitmap)) ? img.bitmap : null;
    const width = img.width || (drawable && drawable.width);
    const height = img.height || (drawable && drawable.height);
    if (!width || !height) return null;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    if (drawable) {
        ctx.drawImage(drawable, 0, 0, width, height);
    } else if (img.data && img.data.length) {
        const rgba = new Uint8ClampedArray(width * height * 4);
        // Prefer pdf.js's own ImageKind when present; else infer channels.
        const kind = img.kind;
        const channels = kind === 2 ? 3 : kind === 3 ? 4
            : Math.round(img.data.length / (width * height));
        if (channels === 4) {
            rgba.set(img.data.subarray ? img.data.subarray(0, rgba.length) : img.data);
        } else if (channels === 3) {
            for (let i = 0, j = 0; j + 2 < img.data.length; i += 4, j += 3) {
                rgba[i] = img.data[j]; rgba[i + 1] = img.data[j + 1];
                rgba[i + 2] = img.data[j + 2]; rgba[i + 3] = 255;
            }
        } else if (channels === 1) {
            for (let i = 0, j = 0; j < img.data.length; i += 4, j += 1) {
                rgba[i] = rgba[i + 1] = rgba[i + 2] = img.data[j]; rgba[i + 3] = 255;
            }
        } else {
            return null;
        }
        ctx.putImageData(new ImageData(rgba, width, height), 0, 0);
    } else {
        return null;
    }
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    return blob ? await blob.arrayBuffer() : null;
}

/**
 * Extract a page's displayed images: walk the operator list tracking
 * the transform stack, decode each paintImageXObject, and return
 * placement + PNG bytes. Best-effort by design — any failure yields
 * fewer figures, never a failed capture.
 *
 * `stats` (optional) accumulates diagnostic counts across pages:
 *   seen     candidate images that cleared the on-page size filter
 *   resolved candidates whose decoded object came back from pdf.js
 *   decoded  candidates that produced PNG bytes
 * The gap between these three localizes any figure loss.
 *
 * @returns {Promise<Array<{bytes: ArrayBuffer, x,y,w,h: number, px: number}>>}
 */
async function extractPageFigures(page, OPS, stats) {
    const out = [];
    let opList;
    try { opList = await page.getOperatorList(); }
    catch (_) { return out; }

    let ctm = [1, 0, 0, 1, 0, 0];
    const stack = [];
    for (let i = 0; i < opList.fnArray.length; i++) {
        const fn = opList.fnArray[i];
        const args = opList.argsArray[i];
        if (fn === OPS.save) { stack.push(ctm.slice()); continue; }
        if (fn === OPS.restore) { ctm = stack.pop() || [1, 0, 0, 1, 0, 0]; continue; }
        if (fn === OPS.transform) { ctm = matMul(ctm, args); continue; }
        if (fn !== OPS.paintImageXObject) continue;

        // The image fills the unit square under the current transform;
        // for the (typical) axis-aligned case that is:
        const w = Math.abs(ctm[0]);
        const h = Math.abs(ctm[3]);
        if (w < FIGURE_MIN_POINTS || h < FIGURE_MIN_POINTS) continue;
        if (stats) stats.seen += 1;
        try {
            const img = await getPageObject(page, args[0]);
            if (!img) continue;
            if (stats) stats.resolved += 1;
            // Intrinsic pixels — read from the wrapper or its drawable.
            const iw = img.width || (img.bitmap && img.bitmap.width) || 0;
            const ih = img.height || (img.bitmap && img.bitmap.height) || 0;
            if (Math.min(iw, ih) < FIGURE_MIN_PIXELS) continue;
            const bytes = await imageToPngBytes(img);
            if (!bytes) continue;
            if (stats) stats.decoded += 1;
            out.push({ bytes, x: ctm[4], y: ctm[5], w, h, px: Math.min(iw, ih) });
        } catch (_) { /* skip this image */ }
    }
    return out;
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
    const figuresByHash = new Map();   // hash → { bytes, pages: Set<number> }
    const figureStats = { seen: 0, resolved: 0, decoded: 0 };
    let figureCount = 0;
    let figuresCapped = false;
    for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p);
        const viewport = page.getViewport({ scale: 1 });
        const tc = await page.getTextContent();

        // Figures (C4.2) — best-effort, capped, deduped by content hash.
        // Some PDFs paint the same XObject twice on one page (clip-split
        // renders); a page shows each distinct image once.
        let figures = [];
        if (figureCount < FIGURE_MAX_COUNT) {
            try {
                const raw = await extractPageFigures(page, engine.OPS, figureStats);
                const seenOnPage = new Set();
                for (const fig of raw) {
                    if (figureCount >= FIGURE_MAX_COUNT) { figuresCapped = true; break; }
                    const hash = await sha256Bytes(fig.bytes);
                    if (seenOnPage.has(hash)) continue;
                    seenOnPage.add(hash);
                    let entry = figuresByHash.get(hash);
                    if (!entry) {
                        entry = { bytes: fig.bytes, pages: new Set() };
                        figuresByHash.set(hash, entry);
                    }
                    entry.pages.add(p);
                    figures.push({ hash, x: fig.x, y: fig.y, w: fig.w, h: fig.h });
                    figureCount += 1;
                }
            } catch (err) {
                console.warn('[X-Ray PDF] figure extraction failed on page', p, err);
            }
        } else {
            figuresCapped = true;
        }

        pages.push({
            width: viewport.width,
            height: viewport.height,
            figures,
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

    // Furniture pass: an identical image on many pages is a logo or
    // watermark, not a figure (the image analogue of repeating header
    // text). Then archive the survivors, content-addressed.
    const furniture = new Set();
    for (const [hash, entry] of figuresByHash) {
        if (entry.pages.size >= FIGURE_FURNITURE_PAGES) furniture.add(hash);
    }
    let archivedFigures = 0;
    for (const page of pages) {
        page.figures = (page.figures || []).filter((f) => !furniture.has(f.hash));
        for (const fig of page.figures) fig.ref = 'xray-figure:' + fig.hash;
    }
    for (const [hash, entry] of figuresByHash) {
        if (furniture.has(hash)) continue;
        try {
            const res = await putSourceDocument({
                hash, bytes: entry.bytes, mime: 'image/png',
                url: `pdf-figure:${sourceHash}`
            });
            if (res.stored) archivedFigures += 1;
        } catch (err) {
            console.warn('[X-Ray PDF] figure archive failed (continuing):', err);
        }
    }

    // Self-diagnosis: if we saw candidate images but archived none, the
    // loss is in object resolution or PNG encoding (env-specific pdf.js
    // image shapes). Surface it loudly and stash the counts on the record
    // so `state.article.extraction.figures_diag` explains a silent miss.
    const figuresMissed = figureStats.seen > 0 && archivedFigures === 0;
    if (figuresMissed) {
        console.warn('[X-Ray PDF] figures seen but none captured:',
            `seen=${figureStats.seen} resolved=${figureStats.resolved} `
            + `decoded=${figureStats.decoded} archived=${archivedFigures}`);
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
            // Figures (C4.2): count of archived, content-addressed images.
            ...(archivedFigures ? { figures: archivedFigures } : {}),
            ...(figuresCapped ? { figures_capped: true } : {}),
            // Diagnostic: only when candidates were seen but none survived,
            // so a silent figure miss is self-explaining on the record.
            ...(figuresMissed ? { figures_diag: { ...figureStats } } : {}),
            // Quality honesty (C4.1): present only when something looked
            // shaky — the reader banners these.
            ...(warnings && warnings.length ? { warnings } : {})
        }
    };
}
