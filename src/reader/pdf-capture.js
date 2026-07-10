// PDF capture — Phase 18 C3/C4 (docs/COMPLEX_CONTENT_DESIGN.md §5).
//
// Runs in the READER (an extension page): full DOM, host permissions,
// no service-worker constraints, identical on Firefox ≥128. The heavy
// pdf.js engine is a separate lazily-imported bundle so the reader
// stays light for the 99% of opens that aren't PDFs.
//
// Provenance chain (§5.4): the ORIGINAL bytes are hashed
// (sha256 → `source_hash`); the extracted markdown becomes the capture
// (and gets the canonical article hash exactly like an HTML capture);
// the `extraction` record ties them together. Page offsets ride along
// as `pageMap` so claims can carry page-level anchors. Bytes and
// figures are archived only AFTER reconstruction succeeds — a refused
// capture (scan, empty text) must not leave orphaned blobs behind.

import { putSourceDocument } from '../shared/archive-cache.js';
import { buildDocumentFromPages, textDensity } from '../shared/pdf-layout.js';
import { ContentExtractor } from '../shared/content-extractor.js';
import { extractScholarlyMeta } from '../shared/platforms/scholar-meta.js';
import { resolveUrlIdentityFromUrl } from '../shared/url-identity.js';

// Figure extraction bounds (C4.2). Displayed size is in PDF points,
// intrinsic size in pixels; both floors skip decorations. A hash that
// recurs on ≥ FIGURE_FURNITURE_PAGES pages is page furniture (logos,
// watermarks) — dropped like repeating header text. PAGE_FIGURE_MAX
// bounds per-page decode work; FIGURE_MAX_COUNT caps the document
// AFTER the furniture pass, so a per-page logo can't eat the budget
// that real figures on later pages need.
const FIGURE_MIN_POINTS = 40;
const FIGURE_MIN_PIXELS = 40;
const FIGURE_FURNITURE_PAGES = 3;
const FIGURE_MAX_COUNT = 40;
const PAGE_FIGURE_MAX = 12;
// Distinct figures whose PNG BYTES are retained during the document
// walk. Page membership is tracked for every hash (the furniture pass
// needs it), but holding decoded PNGs for a 500-page catalog's
// thousands of distinct images kept gigabytes live; only the first
// FIGURE_MAX_COUNT non-furniture figures can ever be archived, so a
// generous multiple bounds memory without starving the archive.
const FIGURE_BYTES_MAX = 256;

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

// Axis-aligned bbox of the unit square under a CTM, from ALL FOUR
// transformed corners. The naive read (w=|a|, h=|d|, corner=(e,f))
// misplaced top-down draws (negative d puts the TOP edge in f — the
// figure then merged a full height away from where it sits) and sized
// 90°-rotated images (extent in b/c, a≈d≈0) to ~zero, silently
// dropping them at the size filter.
export function unitSquareBBox(ctm) {
    const [a, b, c, d, e, f] = ctm;
    const xs = [e, e + a, e + c, e + a + c];
    const ys = [f, f + b, f + d, f + b + d];
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

// Figure bbox in the VIEWED page's y-up space: compose the viewport
// transform (which is where pdf.js applies /Rotate and the MediaBox
// origin — operator CTMs are raw user space) over the placement CTM,
// take the bbox in the viewport's y-down space, and flip back to the
// y-up convention the layout engine shares with the text items. On a
// /Rotate 90 page the raw-CTM bbox landed in coordinates the text no
// longer occupied — figures placed against the wrong lines/captions.
export function viewportBBox(ctm, viewport) {
    const down = unitSquareBBox(matMul(viewport.transform, ctm));
    return {
        x: down.x,
        y: viewport.height - (down.y + down.h),
        w: down.w,
        h: down.h
    };
}

// Resolve a decoded image object. pdf.js keeps globally-cached objects
// (images reused across pages — logos, repeated figures) in the
// DOCUMENT-level store under `g_`-prefixed ids and page-local objects
// in `page.objs`; it dispatches on the prefix and so must we — asking
// the wrong store never throws, the callback just never fires. A
// timeout still guards render-time-only objects: they become a skipped
// figure (visible in figures_diag), not a hang.
const OBJECT_RESOLVE_TIMEOUT_MS = 8000;
function getPageObject(page, name) {
    return new Promise((resolve) => {
        let settled = false;
        let timer = null;
        const done = (v) => {
            if (settled) return;
            settled = true;
            if (timer) clearTimeout(timer);
            resolve(v);
        };
        timer = setTimeout(() => done(null), OBJECT_RESOLVE_TIMEOUT_MS);
        const store = String(name || '').startsWith('g_') ? page.commonObjs : page.objs;
        try { store.get(name, done); }
        catch (_) { done(null); }
    });
}

// Is `v` a drawImage-able source (ImageBitmap / canvas / VideoFrame)?
// Treated by duck-typing so it works even where the global constructors
// differ. VideoFrame matters: Chrome's pdf.js decodes JPEGs through
// ImageDecoder and hands back { data: null, bitmap: <VideoFrame> } —
// and a VideoFrame has NO width/height (only displayWidth/codedWidth),
// so the bitmap duck-type alone rejected it and every JPEG photograph
// figure was silently dropped on Chrome. Exported for tests.
export function isDrawable(v) {
    if (!v || typeof v !== 'object') return false;
    if (typeof ImageBitmap !== 'undefined' && v instanceof ImageBitmap) return true;
    if (typeof OffscreenCanvas !== 'undefined' && v instanceof OffscreenCanvas) return true;
    if (typeof HTMLCanvasElement !== 'undefined' && v instanceof HTMLCanvasElement) return true;
    if (typeof VideoFrame !== 'undefined' && v instanceof VideoFrame) return true;
    // Duck-types: bitmap-ish (width/height + close()), canvas-ish
    // (getContext), or VideoFrame-ish (displayWidth/Height + close()).
    if (typeof v.width === 'number' && typeof v.height === 'number'
        && (typeof v.close === 'function' || typeof v.getContext === 'function')) {
        return true;
    }
    return typeof v.displayWidth === 'number' && typeof v.displayHeight === 'number'
        && typeof v.close === 'function';
}

// Intrinsic pixel size of a drawable, across its API families.
function drawableDim(v, axis) {
    if (!v) return 0;
    return (axis === 'w' ? (v.width || v.displayWidth) : (v.height || v.displayHeight)) || 0;
}

// Paint `paint(ctx)` onto a width×height canvas; return PNG bytes plus
// the raw RGBA pixels (for content addressing — see imageToFigure), or
// null if encoding produced nothing.
async function canvasToPng(width, height, paint) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    try { paint(ctx); }
    catch (_) { return null; }
    let pixels = null;
    try { pixels = ctx.getImageData(0, 0, width, height).data; }
    catch (_) { /* oversize canvas — PNG bytes still usable for hashing */ }
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const bytes = blob ? await blob.arrayBuffer() : null;
    return bytes && bytes.byteLength ? { bytes, pixels } : null;
}

// Raw channel data → RGBA (or null for an unknown layout). `kind` is
// pdf.js ImageKind — 1 GRAYSCALE_1BPP (packed bits, rows padded to a
// byte boundary, MSB first, 1 = white), 2 RGB_24BPP, 3 RGBA_32BPP;
// else channels are inferred. Exported for tests.
export function channelsToRgba(data, width, height, kind) {
    if (!data || !data.length) return null;
    const rgba = new Uint8ClampedArray(width * height * 4);
    if (kind === 1) {
        // 1-bit line art (scanned diagrams, fax-style charts). Inferring
        // channels from data.length rounded this to 0 and dropped the
        // figure; expand the bits the way pdf.js's own canvas path does.
        const rowBytes = Math.ceil(width / 8);
        if (data.length < rowBytes * height) return null;
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const bit = (data[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
                const v = bit ? 255 : 0;
                const o = (y * width + x) * 4;
                rgba[o] = rgba[o + 1] = rgba[o + 2] = v;
                rgba[o + 3] = 255;
            }
        }
        return rgba;
    }
    const channels = kind === 2 ? 3 : kind === 3 ? 4
        : Math.round(data.length / (width * height));
    if (channels === 4) {
        rgba.set(data.subarray ? data.subarray(0, rgba.length) : data);
    } else if (channels === 3) {
        for (let i = 0, j = 0; j + 2 < data.length; i += 4, j += 3) {
            rgba[i] = data[j]; rgba[i + 1] = data[j + 1];
            rgba[i + 2] = data[j + 2]; rgba[i + 3] = 255;
        }
    } else if (channels === 1) {
        for (let i = 0, j = 0; j < data.length; i += 4, j += 1) {
            rgba[i] = rgba[i + 1] = rgba[i + 2] = data[j]; rgba[i + 3] = 255;
        }
    } else {
        return null;
    }
    return rgba;
}

// Decoded image → { bytes: PNG, hash: content address }. pdf.js 6.x
// hands back image objects in several shapes depending on the
// worker/OffscreenCanvas path:
//   • the object IS an ImageBitmap/canvas (bare drawable),
//   • { bitmap: <drawable>, width, height }  (OffscreenCanvas path),
//   • { data: <TypedArray>, width, height, kind }  (raw channels),
//   • { data, bitmap, width, height }  (both — but the bitmap can be
//     dimensionless/flaky, so we fall back to the raw data).
// The content address is the sha256 of the DECODED RGBA PIXELS, not of
// the PNG container: canvas.toBlob's PNG encoder differs across
// browsers and versions, and since the figure ref rides inside the
// markdown that feeds the canonical article hash, encoder drift forked
// `x` for byte-identical PDFs (false stealth-edit banners, orphaned
// claim provenance). The PNG is presentation; the pixels are content.
// Unknown shapes return null (figure skipped, never a failed capture).
async function imageToFigure(img) {
    if (!img) return null;

    const drawable = isDrawable(img) ? img
        : (img.bitmap && isDrawable(img.bitmap)) ? img.bitmap : null;
    const width = img.width || drawableDim(drawable, 'w');
    const height = img.height || drawableDim(drawable, 'h');
    if (!width || !height) return null;

    // Strategy 1: draw the decoded bitmap/canvas/frame. Only the
    // decoded RGBA pixels are an acceptable hash input — when
    // getImageData fails (oversize canvas) the PNG container bytes are
    // encoder-dependent, which is the exact cross-browser x-fork #111
    // removed; fall through to the raw data (or skip) instead.
    if (drawable) {
        const png = await canvasToPng(width, height,
            (ctx) => ctx.drawImage(drawable, 0, 0, width, height));
        if (png && png.pixels) {
            return { bytes: png.bytes, hash: await sha256Bytes(png.pixels.buffer) };
        }
        // Draw produced nothing (dimensionless bitmaps) or pixels were
        // unreadable — fall through to the raw channel data if any.
    }

    // Strategy 2: raw channel data. Hash the source RGBA directly —
    // it is the most deterministic representation we ever hold.
    const rgba = channelsToRgba(img.data, width, height, img.kind);
    if (rgba) {
        const png = await canvasToPng(width, height,
            (ctx) => ctx.putImageData(new ImageData(rgba, width, height), 0, 0));
        if (png) {
            return { bytes: png.bytes, hash: await sha256Bytes(rgba.buffer) };
        }
    }
    return null;
}

/**
 * Extract a page's displayed images: walk the operator list tracking
 * the transform stack, decode each image placement, and return
 * placement + PNG bytes + content hash. Best-effort by design — any
 * failure yields fewer figures, never a failed capture.
 *
 * `stats` (optional) accumulates diagnostic counts across pages:
 *   seen     candidate images that cleared the on-page size filter
 *   resolved candidates whose decoded object came back from pdf.js
 *   decoded  candidates that produced PNG bytes
 * The gap between these three localizes any figure loss.
 *
 * @returns {Promise<Array<{bytes: ArrayBuffer, hash: string, x,y,w,h: number, px: number}>>}
 *
 * Exported for tests (the CTM walk is unreachable through stubs
 * otherwise; pdf.js arg shapes — Float32Array matrices, annotation
 * spans — have already diverged from naive expectations once).
 */
export async function extractPageFigures(page, OPS, stats, viewport) {
    const out = [];
    let opList;
    try { opList = await page.getOperatorList(); }
    catch (_) { return out; }

    let ctm = [1, 0, 0, 1, 0, 0];
    const stack = [];
    let annotationDepth = 0;
    for (let i = 0; i < opList.fnArray.length; i++) {
        const fn = opList.fnArray[i];
        const args = opList.argsArray[i];
        // Annotation appearance streams (stamps, signatures, widgets)
        // ride the SAME operator list, bracketed by begin/endAnnotation
        // with their own transform regime. They are not page content —
        // and walking their ops both mis-measured their images under
        // the page CTM and let their `cm`s corrupt every later
        // placement on the page. Skip the whole span.
        if (fn === OPS.beginAnnotation) { annotationDepth += 1; continue; }
        if (fn === OPS.endAnnotation) {
            annotationDepth = Math.max(0, annotationDepth - 1);
            continue;
        }
        if (annotationDepth > 0) continue;
        if (fn === OPS.save) { stack.push(ctm.slice()); continue; }
        if (fn === OPS.restore) { ctm = stack.pop() || [1, 0, 0, 1, 0, 0]; continue; }
        if (fn === OPS.transform) { ctm = matMul(ctm, args); continue; }
        // Form XObjects are an implicit save + matrix concat on begin
        // and an implicit restore on end (pdf.js renders them exactly
        // so). Publisher PDFs routinely wrap figures in forms —
        // ignoring these ops measured such figures under the wrong CTM
        // and let a form-internal `cm` corrupt every later placement
        // on the page. NOTE: pdf.js 6.x ships the matrix as a
        // Float32Array (it even transfers its buffer) — an
        // Array.isArray guard here silently disabled the concat.
        if (fn === OPS.paintFormXObjectBegin) {
            stack.push(ctm.slice());
            const m = args && args[0];
            if (m && m.length === 6) ctm = matMul(ctm, m);
            continue;
        }
        if (fn === OPS.paintFormXObjectEnd) {
            ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
            continue;
        }
        const isRepeat = fn === OPS.paintImageXObjectRepeat;
        if (fn !== OPS.paintImageXObject && !isRepeat) continue;
        // Decode-work bound, as the constant's contract promises: past
        // the per-page cap, stop resolving/decoding — the caller could
        // never keep more than PAGE_FIGURE_MAX anyway.
        if (out.length >= PAGE_FIGURE_MAX) break;

        let imgCtm = ctm;
        if (isRepeat) {
            // Repeat ops tile one XObject at several positions
            // (args: id, scaleX, scaleY, positions). Best-effort: one
            // placement at the current CTM, scaled — enough to size-
            // filter and place the figure once in reading order.
            const sx = Math.abs(Number(args && args[1])) || 1;
            const sy = Math.abs(Number(args && args[2])) || 1;
            imgCtm = matMul(ctm, [sx, 0, 0, sy, 0, 0]);
        }
        const box = viewportBBox(imgCtm, viewport);
        if (box.w < FIGURE_MIN_POINTS || box.h < FIGURE_MIN_POINTS) continue;
        if (stats) stats.seen += 1;
        try {
            const img = await getPageObject(page, args[0]);
            if (!img) continue;
            if (stats) stats.resolved += 1;
            // Intrinsic pixels — read from the wrapper or its drawable.
            const iw = img.width || drawableDim(img.bitmap, 'w') || 0;
            const ih = img.height || drawableDim(img.bitmap, 'h') || 0;
            if (Math.min(iw, ih) < FIGURE_MIN_PIXELS) continue;
            const fig = await imageToFigure(img);
            if (!fig) continue;
            if (stats) stats.decoded += 1;
            out.push({
                bytes: fig.bytes, hash: fig.hash,
                x: box.x, y: box.y, w: box.w, h: box.h,
                px: Math.min(iw, ih)
            });
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
    // Fragment ≠ identity: `#page=3` is a viewer instruction the server
    // never sees — same bytes, same document. The d-tag hashes the RAW
    // url, so a carried fragment would fork the article identity (and
    // the archive row) between a deep link and the bare URL.
    try {
        const u = new URL(sourceUrl);
        if (u.hash) { u.hash = ''; sourceUrl = u.href; }
    } catch (_) { /* file imports have no url */ }
    if (file) {
        bytes = await file.arrayBuffer();
    } else {
        const resp = await fetch(url, { credentials: 'include' });
        if (!resp.ok) throw new Error(`PDF fetch failed (HTTP ${resp.status})`);
        bytes = await resp.arrayBuffer();
    }
    if (!bytes || bytes.byteLength === 0) throw new Error('The PDF was empty.');

    const sourceHash = await sha256Bytes(bytes);
    if (!sourceUrl) {
        // Local imports: a bare filename collides across different
        // documents named alike (every "report.pdf") — the archive row
        // would overwrite and claims from unrelated PDFs would share
        // one d-tag namespace. Key the identity on the content hash;
        // the name stays for display.
        const name = encodeURIComponent((file && file.name) || 'document.pdf');
        sourceUrl = `file:///imported/${sourceHash.slice(0, 16)}/${name}`;
    }

    const engine = await loadEngine();
    // pdf.js transfers the buffer to its worker — hand it a copy. Keep
    // the loading task: pdf.js 6.x removed PDFDocumentProxy.destroy()
    // (teardown lives on the task), and calling a method that isn't
    // there inside a swallow-all catch silently skipped cleanup.
    //
    // The asset URLs (copied into dist/ by the build) are load-bearing:
    // without cMapUrl a predefined-CMap (CJK) PDF extracts ZERO text
    // and is falsely refused as a scan; without wasmUrl JBIG2/JPEG2000
    // images (archival scans, some publishers) can never decode — even
    // pdf.js's no-wasm fallback module resolves relative to wasmUrl.
    const loadingTask = engine.getDocument({
        data: bytes.slice(0),
        cMapUrl: browserApi.runtime.getURL('dist/cmaps/'),
        cMapPacked: true,
        standardFontDataUrl: browserApi.runtime.getURL('dist/standard_fonts/'),
        wasmUrl: browserApi.runtime.getURL('dist/wasm/'),
        iccUrl: browserApi.runtime.getURL('dist/iccs/')
    });
    let doc;
    try {
        doc = await loadingTask.promise;
        // Pass 1 — text only. The scan gate must run BEFORE any figure
        // work or archival: refusing a 300-page scan after decoding and
        // storing its images wasted minutes and left orphaned blobs.
        const pages = [];
        const pageProxies = [];
        const pageViewports = [];
        for (let p = 1; p <= doc.numPages; p++) {
            const page = await doc.getPage(p);
            pageProxies.push(page);
            const viewport = page.getViewport({ scale: 1 });
            pageViewports.push(viewport);
            const tc = await page.getTextContent();
            pages.push({
                width: viewport.width,
                height: viewport.height,
                figures: [],
                // getTextContent transforms are RAW user space — pdf.js
                // applies /Rotate (and the MediaBox origin) only in the
                // viewport. Mapping through the viewport (then back to
                // y-up) is what keeps a /Rotate 90 page's visual lines
                // as lines: raw coords put every chunk of a rotated
                // line on a different baseline and the reconstruction
                // shredded/interleaved them — quote-corrupting output.
                // Identity for the common unrotated origin-0 page.
                items: (tc.items || [])
                    .filter((i) => typeof i.str === 'string')
                    .map((i) => {
                        const [vx, vy] = viewport.convertToViewportPoint(
                            i.transform[4], i.transform[5]);
                        return {
                            str: i.str,
                            x: vx,
                            y: viewport.height - vy,
                            w: i.width || 0,
                            // Rotated text matrices zero transform[3];
                            // the font-size vector magnitude covers all
                            // orientations.
                            h: i.height
                                || Math.hypot(i.transform[2], i.transform[3])
                                || 10
                        };
                    })
            });
        }

        if (textDensity(pages) < 8) {
            throw new Error(
                'This PDF has no usable text layer — it is likely a scan. '
                + 'Machine transcription for scans is designed but not built yet '
                + '(COMPLEX_CONTENT_DESIGN.md §6).');
        }

        // Pass 2 — figures (C4.2): best-effort, deduped by content hash,
        // per-page work cap. Some PDFs paint the same XObject twice on
        // one page (clip-split renders); a page shows each distinct
        // image once. Pages are cleaned up as they finish so decoded
        // bitmaps and operator lists don't accumulate for the whole
        // document.
        const figuresByHash = new Map();   // hash → { bytes, pages: Set<number> }
        const figureStats = { seen: 0, resolved: 0, decoded: 0 };
        for (let p = 1; p <= doc.numPages; p++) {
            const page = pageProxies[p - 1];
            const figures = pages[p - 1].figures;
            try {
                const raw = await extractPageFigures(
                page, engine.OPS, figureStats, pageViewports[p - 1]);
                const seenOnPage = new Set();
                for (const fig of raw) {
                    if (figures.length >= PAGE_FIGURE_MAX) break;
                    if (seenOnPage.has(fig.hash)) continue;
                    seenOnPage.add(fig.hash);
                    let entry = figuresByHash.get(fig.hash);
                    if (!entry) {
                        entry = {
                            // Past the retention cap, keep counting pages
                            // (furniture detection) but drop the payload.
                            bytes: figuresByHash.size < FIGURE_BYTES_MAX ? fig.bytes : null,
                            pages: new Set()
                        };
                        figuresByHash.set(fig.hash, entry);
                    }
                    entry.pages.add(p);
                    figures.push({ hash: fig.hash, x: fig.x, y: fig.y, w: fig.w, h: fig.h });
                }
            } catch (err) {
                console.warn('[X-Ray PDF] figure extraction failed on page', p, err);
            }
            try { page.cleanup(); } catch (_) { /* best-effort */ }
        }

        // Furniture pass: an identical image on many pages is a logo or
        // watermark, not a figure (the image analogue of repeating
        // header text). The document cap applies AFTER this pass, in
        // reading order — furniture must not eat the budget that real
        // figures on later pages need.
        const furniture = new Set();
        for (const [hash, entry] of figuresByHash) {
            if (entry.pages.size >= FIGURE_FURNITURE_PAGES) furniture.add(hash);
        }
        let keptFigures = 0;
        let figuresCapped = false;
        for (const page of pages) {
            page.figures = (page.figures || []).filter((f) => {
                if (furniture.has(f.hash)) return false;
                if (keptFigures >= FIGURE_MAX_COUNT) { figuresCapped = true; return false; }
                keptFigures += 1;
                return true;
            });
            for (const fig of page.figures) fig.ref = 'xray-figure:' + fig.hash;
        }
        const referenced = new Set();
        for (const page of pages) for (const f of page.figures) referenced.add(f.hash);

        let info = {};
        try { info = (await doc.getMetadata())?.info || {}; } catch (_) { /* optional */ }

        const { markdown, pageMap, warnings, stats } = buildDocumentFromPages(pages);
        if (!markdown.trim()) throw new Error('No text could be reconstructed from this PDF.');

        // Reconstruction succeeded — NOW archive the evidence: the
        // original bytes and the referenced figures, content-addressed.
        let archived = false;
        try {
            const res = await putSourceDocument({
                hash: sourceHash, bytes, mime: 'application/pdf', url: sourceUrl
            });
            archived = !!res.stored;
        } catch (err) {
            console.warn('[X-Ray PDF] source archive failed (continuing):', err);
        }
        let archivedFigures = 0;
        for (const [hash, entry] of figuresByHash) {
            if (!referenced.has(hash) || !entry.bytes) continue;
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

        // Self-diagnosis: if we saw candidate images but archived none,
        // the loss is in object resolution or PNG encoding (env-specific
        // pdf.js image shapes). Surface it loudly and stash the counts on
        // the record so `extraction.figures_diag` explains a silent miss.
        const figuresMissed = figureStats.seen > 0 && archivedFigures === 0;
        if (figuresMissed) {
            console.warn('[X-Ray PDF] figures seen but none captured:',
                `seen=${figureStats.seen} resolved=${figureStats.resolved} `
                + `decoded=${figureStats.decoded} archived=${archivedFigures}`);
        }

        // Scholarly identity from the URL shape (C2): a PDF has no meta
        // tags, but arxiv.org/pdf/... and doi.org links name the work —
        // the identity should not depend on capturing the abs page
        // instead of the document itself.
        const scholar = extractScholarlyMeta({ querySelectorAll: () => [] }, sourceUrl);

        // URL identity (original-as-identity, JOURNAL 2026-07-09): a PDF
        // fetched through an archive or an arXiv rendering variant keys
        // to the recovered original (arxiv.org/pdf/X → arxiv.org/abs/X),
        // with the fetched address kept as capture provenance. URL-only
        // resolution — a PDF has no archive DOM to consult; fail-open.
        const identity = resolveUrlIdentityFromUrl(sourceUrl);
        const identityFields = identity
            ? {
                archive_host: identity.archiveHost,
                ...(identity.original
                    ? { url: identity.original, capture_url: identity.captureUrl }
                    : {})
            }
            : {};

        let fileName = '';
        try {
            fileName = decodeURIComponent((sourceUrl.split('/').pop() || '')
                .replace(/[?#].*$/, '').replace(/\.pdf$/i, ''));
        } catch (_) {
            // Names with stray % sequences ("Q1 100% final.pdf") make
            // decodeURIComponent throw — after a successful extraction.
            fileName = (sourceUrl.split('/').pop() || '')
                .replace(/[?#].*$/, '').replace(/\.pdf$/i, '');
        }
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
            ...(scholar ? { scholar } : {}),
            ...identityFields,
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
    } finally {
        // pdf.js caches every page's operator list and decoded bitmaps
        // until the document is destroyed; without this, a large PDF's
        // full-resolution images stayed live for the tab's lifetime —
        // and the throw paths (scan refusal, empty text) leaked the
        // worker document entirely. Teardown is the LOADING TASK's job
        // in pdf.js 6.x — PDFDocumentProxy has no destroy() there.
        try { await loadingTask.destroy(); }
        catch (_) { /* teardown is best-effort */ }
    }
}
