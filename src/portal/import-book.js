// EPUB book import — Model B (book ingestion), slice 3. One capture per
// chapter, grouped under a book `thing` entity. Mirrors import-transcript.js:
// a synthetic per-chapter article, a precomputed markdown-canonical hash, and
// ArchiveCache.saveArticle — no reader tab or publish needed. The book entity
// is a `thing` (per the "cases as things" convention); chapters can be added
// to a real case later for synthesis.
//
// Metadata mapping (user spec): author → byline, book title → siteName
// (Publisher), release date → publishedAt, ISBN → the book entity's
// description. Inline images ride the reader's figure archive
// (`xray-figure:<sha256>`), archived here alongside the .epub bytes.

import { el } from './dom.js';
import { Utils } from '../shared/utils.js';
import { Crypto } from '../shared/crypto.js';
import { ContentExtractor } from '../shared/content-extractor.js';
import { EventBuilder } from '../shared/event-builder.js';
import { articleHash } from '../shared/audit/article-hash.js';
import { EntityModel, installEntityStorageBridge } from '../shared/entity-model.js';
import { LocalKeyManager } from '../shared/local-key-manager.js';
import { saveArticle, putSourceDocument } from '../shared/archive-cache.js';
import { parseEpub } from '../shared/epub-parse.js';

// A pathological EPUB (thousands of micro spine items) shouldn't spawn an
// unbounded write storm; cap and disclose.
const MAX_CHAPTERS = 500;

/** A one-line book identity for the entity's description: author, release
 * date, ISBN — whichever are present. Pure. */
export function buildBookDescription(meta) {
    const bits = [];
    if (meta && meta.author) bits.push(meta.author);
    if (meta && meta.date) bits.push(new Date(meta.date * 1000).toISOString().slice(0, 10));
    if (meta && meta.isbn) bits.push(`ISBN ${meta.isbn}`);
    return bits.join(' · ');
}

/**
 * Build ONE chapter capture article. `markdown` is the canonical substrate
 * (contentType 'epub' → hashableArticle treats it as markdown-canonical, so
 * publish ships the extracted markdown byte-for-byte); `content` is a derived
 * HTML rendering. Tagged `about` the book `thing` so it groups. Pure.
 */
export function buildChapterArticle({ chapter, meta, epubHash, bookEntityId, bookName, index }) {
    const markdown = String((chapter && chapter.markdown) || '');
    const idPart = encodeURIComponent(String((chapter && chapter.id) || index));
    return {
        url: `file:///imported/epub/${epubHash.slice(0, 16)}/${idPart}`,
        title: (chapter && chapter.title) || `Chapter ${index + 1}`,
        byline: (meta && meta.author) || '',
        siteName: (meta && meta.title) || '',              // Publisher = book title
        publishedAt: (meta && meta.date) || null,           // release date (unix s)
        markdown,
        content: ContentExtractor.markdownToHtml(markdown),
        contentType: 'epub',
        excerpt: markdown.replace(/\s+/g, ' ').trim().slice(0, 280),
        entities: [{ entity_id: bookEntityId, type: 'thing', name: bookName || 'Book', context: '' }],
        extraction: { method: 'epub', source_hash: epubHash, archived: true }
    };
}

/** The markdown-canonical article hash — identical to what the reader's
 * hashableArticle('epub') and the publish `x` tag compute, so the row hash,
 * the reader, and publish can never fork (mirrors computeTranscriptArticleHash). */
export async function chapterArticleHash(article) {
    const body = EventBuilder.assembleArticleBody({
        ...article, content: article.markdown, _contentIsMarkdown: true
    });
    return articleHash(body);
}

/**
 * Import an EPUB: create the book `thing` entity, archive the .epub bytes +
 * inline images, and write one capture per chapter. Idempotent by content —
 * the entity is keyed by type+name and each chapter URL by the epub hash +
 * spine id, so re-importing the same file updates rather than duplicates.
 *
 * @param {ArrayBuffer|Uint8Array} bytes
 * @param {{ onProgress?: (done:number,total:number)=>void }} [opts]
 * @returns {Promise<{ bookEntityId:string, title:string, chapters:number, images:number, capped:boolean }>}
 */
export async function importEpub(bytes, { onProgress } = {}) {
    // Self-init the entity infra so this works from any extension page.
    try { installEntityStorageBridge(); } catch (_) { /* idempotent */ }
    try { await LocalKeyManager.init(); } catch (err) { Utils.error('book import: key init', err); }

    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const parsed = await parseEpub(u8);
    if (!parsed.chapters.length) throw new Error('No readable chapters were found in this EPUB.');
    const epubHash = await Crypto.sha256(u8);

    const title = (parsed.meta.title || 'Untitled book').slice(0, 200);
    const bookEntity = await EntityModel.create({
        name: title, type: 'thing', description: buildBookDescription(parsed.meta)
    });

    // Inline images (referenced by chapter bodies via xray-figure:<hash>) and
    // the cover. The prune grace protects these until the chapter rows land.
    let images = 0;
    for (const [hash, img] of parsed.images) {
        try {
            await putSourceDocument({ hash, bytes: img.bytes, mime: img.mime || 'image/jpeg', url: `epub-figure:${hash}` });
            images += 1;
        } catch (err) { Utils.error('book import: image archive', err); }
    }
    // The .epub itself, kept alive by each chapter's extraction.source_hash.
    try {
        await putSourceDocument({
            hash: epubHash, bytes: u8, mime: 'application/epub+zip',
            url: `file:///imported/epub/${epubHash.slice(0, 16)}/book.epub`
        });
    } catch (err) { Utils.error('book import: epub archive', err); }

    const capped = parsed.chapters.length > MAX_CHAPTERS;
    const chapters = capped ? parsed.chapters.slice(0, MAX_CHAPTERS) : parsed.chapters;
    let saved = 0;
    for (let i = 0; i < chapters.length; i++) {
        const article = buildChapterArticle({
            chapter: chapters[i], meta: parsed.meta, epubHash,
            bookEntityId: bookEntity.id, bookName: title, index: i
        });
        try {
            article._articleHash = await chapterArticleHash(article);
            await saveArticle({ article, source: 'capture' });
            saved += 1;
        } catch (err) { Utils.error('book import: chapter save', err); }
        if (onProgress) { try { onProgress(i + 1, chapters.length); } catch (_) { /* display only */ } }
    }

    return { bookEntityId: bookEntity.id, title, chapters: saved, images, capped };
}

/**
 * Mount the "Import book (EPUB)…" panel: a file picker, a progress line, and a
 * result that links to the new book's dossier. Toggle-closed by the caller.
 */
export function mountBookImport(host, { onDone } = {}) {
    host.replaceChildren();
    const card = el('div', 'xr-bookimport');
    card.appendChild(el('h3', 'xr-bookimport__title', '📖 Import a book (EPUB)'));
    card.appendChild(el('p', 'xr-bookimport__note',
        'Each chapter becomes a capture, grouped under a book. Author, title, and '
        + 'release date are read from the EPUB.'));

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.epub,application/epub+zip';
    input.className = 'xr-bookimport__file';

    const go = el('button', 'xr-portal__btn xr-portal__btn--primary', 'Import');
    go.type = 'button';
    go.disabled = true;
    input.addEventListener('change', () => { go.disabled = !(input.files && input.files[0]); });

    const status = el('div', 'xr-bookimport__status');
    const row = el('div', 'xr-bookimport__row');
    row.append(input, go);
    card.append(row, status);
    host.appendChild(card);

    go.addEventListener('click', async () => {
        const file = input.files && input.files[0];
        if (!file) return;
        go.disabled = true;
        input.disabled = true;
        status.textContent = 'Reading the EPUB…';
        try {
            const buf = await file.arrayBuffer();
            const res = await importEpub(buf, {
                onProgress: (done, total) => { status.textContent = `Importing ${done}/${total} chapters…`; }
            });
            status.replaceChildren();
            const done = el('div', 'xr-bookimport__done',
                `Imported “${res.title}” — ${res.chapters} chapter${res.chapters === 1 ? '' : 's'}`
                + (res.images ? `, ${res.images} image${res.images === 1 ? '' : 's'}` : '')
                + (res.capped ? ` (capped at ${MAX_CHAPTERS})` : '') + '.');
            const open = el('a', 'xr-bookimport__open', 'Open the book →');
            open.href = `#dossier=${res.bookEntityId}`;
            open.addEventListener('click', () => {
                // The dossier deep-link is parsed at boot; reload into it.
                location.hash = `dossier=${res.bookEntityId}`;
                location.reload();
            });
            done.appendChild(document.createTextNode(' '));
            done.appendChild(open);
            status.appendChild(done);
            if (onDone) { try { onDone(res); } catch (_) { /* refresh is best-effort */ } }
        } catch (err) {
            Utils.error('book import failed', err);
            status.textContent = `Import failed: ${(err && err.message) || 'unknown error'}`;
            go.disabled = false;
            input.disabled = false;
        }
    });
}
