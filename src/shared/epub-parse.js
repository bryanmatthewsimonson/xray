// EPUB parsing — Phase (book ingestion). Turns an .epub (a ZIP of XHTML +
// an OPF manifest + a nav/ncx TOC) into a book's metadata plus one markdown
// "chapter" per spine item, with inline images content-addressed for the
// reader's figure archive (`xray-figure:<sha256>`, hydrated by
// hydrateFigureImages). No new dependency: the ZIP is inflated with the
// platform DecompressionStream, XML/XHTML with DOMParser, HTML→markdown with
// the existing ContentExtractor (Turndown). Runs in an extension PAGE (needs
// DOMParser + DecompressionStream); the ZIP reader is import-safe/testable on
// its own.
//
// Model B (docs/ROADMAP book ingestion): each spine item becomes ONE capture
// grouped under a `book` entity. This module is the pure parse half; the
// portal import flow (import-book.js) creates the entity, archives bytes, and
// writes one saveArticle per chapter.

import { Crypto } from './crypto.js';
import { ContentExtractor } from './content-extractor.js';

// ------------------------------------------------------------------
// ZIP reader — central-directory + DecompressionStream (no dependency)
// ------------------------------------------------------------------

const EOCD_SIG = 0x06054b50;   // End Of Central Directory
const CDH_SIG = 0x02014b50;    // Central Directory file Header
const LFH_SIG = 0x04034b50;    // Local File Header

/** Inflate a raw-deflate span (ZIP method 8) via the platform stream. */
async function inflateRaw(bytes) {
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Read a ZIP archive's central directory and return a lazy reader. Handles
 * the two methods an EPUB uses — stored (0) and deflate (8) — and rejects
 * anything else. ZIP64 is not supported (EPUBs never need it). Names are
 * decoded UTF-8. Returns `{ names, has(name), read(name) → Promise<Uint8Array> }`.
 */
export async function readZipEntries(buf) {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const dec = new TextDecoder('utf-8');

    // Find the EOCD by scanning backward (its 22-byte record ends the file,
    // plus an optional comment we bound at 64KB).
    let eocd = -1;
    const min = Math.max(0, bytes.length - 22 - 0xffff);
    for (let i = bytes.length - 22; i >= min; i--) {
        if (dv.getUint32(i, true) === EOCD_SIG) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Not a ZIP/EPUB (no end-of-central-directory record).');

    const total = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);   // central directory offset

    const entries = new Map();
    for (let n = 0; n < total; n++) {
        if (p + 46 > bytes.length || dv.getUint32(p, true) !== CDH_SIG) break;
        const method = dv.getUint16(p + 10, true);
        const compSize = dv.getUint32(p + 20, true);
        const nameLen = dv.getUint16(p + 28, true);
        const extraLen = dv.getUint16(p + 30, true);
        const commentLen = dv.getUint16(p + 32, true);
        const lfhOff = dv.getUint32(p + 42, true);
        const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
        entries.set(name, { method, compSize, lfhOff });
        p += 46 + nameLen + extraLen + commentLen;
    }

    const read = async (name) => {
        const e = entries.get(name);
        if (!e) throw new Error(`ZIP entry not found: ${name}`);
        // The local header's name/extra lengths can differ from the central
        // directory's, so re-read them here to locate the data.
        if (dv.getUint32(e.lfhOff, true) !== LFH_SIG) throw new Error(`Bad local header for ${name}`);
        const lNameLen = dv.getUint16(e.lfhOff + 26, true);
        const lExtraLen = dv.getUint16(e.lfhOff + 28, true);
        const start = e.lfhOff + 30 + lNameLen + lExtraLen;
        const raw = bytes.subarray(start, start + e.compSize);
        if (e.method === 0) return raw.slice();            // stored
        if (e.method === 8) return inflateRaw(raw);          // deflate
        throw new Error(`Unsupported ZIP compression method ${e.method} for ${name}`);
    };

    return {
        names: [...entries.keys()],
        has: (name) => entries.has(name),
        read
    };
}

// ------------------------------------------------------------------
// Small path + XML helpers
// ------------------------------------------------------------------

/** Resolve an OPF-relative href against the OPF's own directory; drops any
 * `#fragment`. Normalizes `..`/`.` segments. Returns a ZIP entry path. */
export function resolveHref(baseDir, href) {
    const clean = String(href || '').split('#')[0].trim();
    if (!clean) return '';
    const stack = baseDir ? baseDir.split('/').filter(Boolean) : [];
    for (const seg of clean.split('/')) {
        if (seg === '' || seg === '.') continue;
        if (seg === '..') stack.pop();
        else stack.push(seg);
    }
    return stack.join('/');
}

/** The directory portion of a ZIP path ('OEBPS/content.opf' → 'OEBPS'). */
function dirOf(path) {
    const i = String(path || '').lastIndexOf('/');
    return i < 0 ? '' : path.slice(0, i);
}

function decodeText(bytes) {
    return new TextDecoder('utf-8').decode(bytes);
}

function parseXml(str, mime = 'application/xml') {
    const doc = new DOMParser().parseFromString(str, mime);
    // A namespaced/broken doc yields a <parsererror>; treat as fatal for the
    // container/OPF, tolerable for a single chapter (handled by the caller).
    return doc;
}

/** First non-empty text of any element matching one of the local names
 * (namespace-agnostic — dc:title vs title). */
function firstText(root, ...localNames) {
    for (const ln of localNames) {
        const els = root.getElementsByTagName(ln);
        for (const el of els) {
            const t = (el.textContent || '').trim();
            if (t) return t;
        }
        // Try the un-prefixed local name too (DOMParser keeps the prefix in tagName).
        const bare = root.querySelectorAll(`*|${ln}`);
        for (const el of bare) {
            const t = (el.textContent || '').trim();
            if (t) return t;
        }
    }
    return '';
}

// ------------------------------------------------------------------
// EPUB structure
// ------------------------------------------------------------------

/** META-INF/container.xml → the OPF (package document) path. */
async function findOpfPath(zip) {
    if (!zip.has('META-INF/container.xml')) {
        throw new Error('Not an EPUB (missing META-INF/container.xml).');
    }
    const doc = parseXml(decodeText(await zip.read('META-INF/container.xml')));
    const rootfile = doc.getElementsByTagName('rootfile')[0];
    const full = rootfile && rootfile.getAttribute('full-path');
    if (!full) throw new Error('EPUB container names no OPF rootfile.');
    return full;
}

/** Parse the OPF: metadata + manifest (id→item) + spine (ordered idrefs). */
function parseOpf(opfDoc, opfDir) {
    const metaEl = opfDoc.getElementsByTagName('metadata')[0] || opfDoc;
    const title = firstText(metaEl, 'title') || 'Untitled book';
    const author = firstText(metaEl, 'creator');
    const publisher = firstText(metaEl, 'publisher');
    const language = firstText(metaEl, 'language');
    const dateRaw = firstText(metaEl, 'date');

    // ISBN: a dc:identifier whose scheme/text looks like an ISBN, else any
    // identifier that parses as one.
    let isbn = '';
    for (const idEl of metaEl.getElementsByTagName('identifier')) {
        const scheme = (idEl.getAttribute('opf:scheme') || idEl.getAttribute('scheme') || '').toUpperCase();
        const val = (idEl.textContent || '').trim();
        const digits = val.replace(/[^0-9Xx]/g, '');
        if (scheme === 'ISBN' || /isbn/i.test(val) || digits.length === 13 || digits.length === 10) {
            isbn = digits || val;
            if (scheme === 'ISBN') break;
        }
    }

    // Manifest: id → { href (resolved), type, properties }.
    const manifest = new Map();
    let navHref = '';
    let coverId = '';
    for (const item of opfDoc.getElementsByTagName('item')) {
        const id = item.getAttribute('id');
        const href = item.getAttribute('href');
        if (!id || !href) continue;
        const props = (item.getAttribute('properties') || '').split(/\s+/);
        const entry = {
            href: resolveHref(opfDir, href),
            type: item.getAttribute('media-type') || '',
            properties: props
        };
        manifest.set(id, entry);
        if (props.includes('nav')) navHref = entry.href;
        if (props.includes('cover-image')) coverId = id;
    }
    // EPUB2 cover: <meta name="cover" content="itemId">
    if (!coverId) {
        for (const m of opfDoc.getElementsByTagName('meta')) {
            if ((m.getAttribute('name') || '') === 'cover') { coverId = m.getAttribute('content') || ''; break; }
        }
    }

    // Spine order + the EPUB2 ncx id.
    const spineEl = opfDoc.getElementsByTagName('spine')[0];
    const spine = [];
    let ncxHref = '';
    if (spineEl) {
        const tocId = spineEl.getAttribute('toc');
        if (tocId && manifest.has(tocId)) ncxHref = manifest.get(tocId).href;
        for (const ir of spineEl.getElementsByTagName('itemref')) {
            const idref = ir.getAttribute('idref');
            const linear = (ir.getAttribute('linear') || 'yes').toLowerCase();
            if (idref && manifest.has(idref)) spine.push({ idref, linear: linear !== 'no' });
        }
    }

    return {
        meta: { title, author, publisher, language, dateRaw, isbn },
        manifest, spine, navHref, ncxHref, coverId
    };
}

/** Build a href→title map from the EPUB3 nav or the EPUB2 ncx. Keys are
 * fragment-stripped, OPF-relative resolved paths. */
async function parseToc(zip, opfDir, navHref, ncxHref) {
    const map = new Map();
    const add = (href, title) => {
        const path = resolveHref(dirOf(navHref || ncxHref) || opfDir, href);
        if (path && title && !map.has(path)) map.set(path, title.trim());
    };
    try {
        if (navHref && zip.has(navHref)) {
            const doc = parseXml(decodeText(await zip.read(navHref)), 'application/xhtml+xml');
            // Prefer the toc nav; fall back to any nav.
            const navs = [...doc.getElementsByTagName('nav')];
            const toc = navs.find((n) => (n.getAttribute('epub:type') || n.getAttribute('type') || '').includes('toc')) || navs[0];
            for (const a of (toc ? toc.getElementsByTagName('a') : [])) {
                add(a.getAttribute('href'), a.textContent || '');
            }
        } else if (ncxHref && zip.has(ncxHref)) {
            const doc = parseXml(decodeText(await zip.read(ncxHref)));
            for (const np of doc.getElementsByTagName('navPoint')) {
                const label = np.getElementsByTagName('text')[0];
                const content = np.getElementsByTagName('content')[0];
                add(content && content.getAttribute('src'), label && label.textContent);
            }
        }
    } catch (_) { /* a broken TOC costs titles, never the import */ }
    return map;
}

const IMG_MIME = {
    'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png',
    'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg'
};

/** Turn one chapter's XHTML into markdown, content-addressing its <img>s to
 * `xray-figure:<sha256>` and collecting their bytes for the byte archive.
 * `chapterPath` locates the XHTML so image hrefs resolve relative to it. */
async function chapterToMarkdown(zip, chapterPath, xhtml, images) {
    let doc;
    try { doc = parseXml(xhtml, 'application/xhtml+xml'); }
    catch (_) { doc = parseXml(xhtml, 'text/html'); }
    if (!doc || !doc.body) {
        // XHTML parsed as XML has no .body; re-parse as HTML for a body.
        doc = new DOMParser().parseFromString(xhtml, 'text/html');
    }
    const body = doc.body || doc.documentElement;
    const chapDir = dirOf(chapterPath);

    for (const img of [...body.querySelectorAll('img, image')]) {
        // SVG <image> uses xlink:href; <img> uses src.
        const raw = img.getAttribute('src') || img.getAttribute('xlink:href') || img.getAttribute('href');
        if (!raw) { img.remove(); continue; }
        const path = resolveHref(chapDir, raw);
        try {
            if (!zip.has(path)) { img.remove(); continue; }
            const bytes = await zip.read(path);
            const hash = await Crypto.sha256(bytes);
            const ext = path.split('.').pop().toLowerCase();
            const mime = Object.keys(IMG_MIME).find((m) => IMG_MIME[m] === (ext === 'jpeg' ? 'jpg' : ext)) || 'image/jpeg';
            images.set(hash, { bytes, mime });
            img.setAttribute('src', `xray-figure:${hash}`);
            img.setAttribute('data-xray-figure', hash);
        } catch (_) { img.remove(); }
    }

    const html = body.innerHTML || '';
    const md = ContentExtractor.htmlToMarkdown(html) || '';
    return md.trim();
}

/** A spine item that is front/back-matter navigation or a bare cover page,
 * not reading content — skipped so a book isn't buried in empty chapters. */
function isSkippableTitle(title) {
    return /^(cover|title\s*page|copyright|table of contents|contents|nav)$/i.test((title || '').trim());
}

/**
 * Parse an EPUB into `{ meta, chapters, images, coverHash }`.
 *   meta:     { title, author, publisher, language, isbn, date }  (date = unix seconds | null)
 *   chapters: [{ id, path, title, markdown }]  in spine (reading) order
 *   images:   Map<sha256, { bytes, mime }>     the byte archive to persist
 *   coverHash: sha256 of the cover image, or ''
 *
 * @param {ArrayBuffer|Uint8Array} buf  the .epub bytes
 */
export async function parseEpub(buf) {
    const zip = await readZipEntries(buf);
    const opfPath = await findOpfPath(zip);
    const opfDir = dirOf(opfPath);
    const opfDoc = parseXml(decodeText(await zip.read(opfPath)));
    const { meta, manifest, spine, navHref, ncxHref, coverId } = parseOpf(opfDoc, opfDir);
    const toc = await parseToc(zip, opfDir, navHref, ncxHref);

    const images = new Map();

    // Cover image (if declared) archived up front so the book has a cover.
    let coverHash = '';
    if (coverId && manifest.has(coverId)) {
        const cover = manifest.get(coverId);
        try {
            if (zip.has(cover.href)) {
                const bytes = await zip.read(cover.href);
                coverHash = await Crypto.sha256(bytes);
                images.set(coverHash, { bytes, mime: cover.type || 'image/jpeg' });
            }
        } catch (_) { /* no cover, no problem */ }
    }

    const chapters = [];
    let n = 0;
    for (const { idref, linear } of spine) {
        const item = manifest.get(idref);
        if (!item || !/xhtml|html/i.test(item.type)) continue;
        n += 1;
        const path = item.href;
        const tocTitle = toc.get(path) || '';
        if (!linear && isSkippableTitle(tocTitle)) continue;   // non-linear front matter
        let markdown = '';
        try { markdown = await chapterToMarkdown(zip, path, decodeText(await zip.read(path)), images); }
        catch (_) { markdown = ''; }
        if (!markdown) continue;                                // empty spine item (cover/nav shell)
        // Title precedence: TOC label → the doc's first heading (already in
        // the markdown as `# …`) → a numbered fallback.
        let title = tocTitle;
        if (!title) {
            const h = markdown.match(/^#{1,3}\s+(.+)$/m);
            title = h ? h[1].trim() : '';
        }
        if (!title) title = `Chapter ${n}`;
        if (isSkippableTitle(title) && markdown.replace(/\s+/g, '').length < 200) continue;
        chapters.push({ id: idref, path, title, markdown });
    }

    return {
        meta: {
            title: meta.title,
            author: meta.author,
            publisher: meta.publisher,
            language: meta.language,
            isbn: meta.isbn,
            date: parseEpubDate(meta.dateRaw)
        },
        chapters,
        images,
        coverHash
    };
}

/** dc:date → unix seconds, or null. EPUB dates are usually ISO-8601 (often
 * year-only or YYYY-MM-DD). */
export function parseEpubDate(raw) {
    const s = String(raw || '').trim();
    if (!s) return null;
    // A bare year needs a month/day to Date.parse reliably across engines.
    const norm = /^\d{4}$/.test(s) ? `${s}-01-01` : s;
    const t = Date.parse(norm);
    return Number.isFinite(t) ? Math.floor(t / 1000) : null;
}
