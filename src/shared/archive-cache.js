// Archive cache — Phase 7 of the v4.2 parity push (issue #18).
//
// Local IndexedDB cache of captured articles, used for:
//
//   1. Skipping re-extraction when revisiting a URL you've already
//      captured — the reader can open from cache instantly.
//   2. Paywall bypass: if the current page extraction is truncated
//      (common on subscription sites with partial public previews),
//      fall back to the cached copy.
//   3. Cross-device reconstruction: when the local cache is empty but
//      a kind-30023 event exists on a relay for this URL, we
//      reconstruct the article via `event-builder.reconstructArticleFromEvent`
//      and cache the result.
//
// Storage shape:
//
//   DB name:  xray-archive
//   Stores:   articles (keyPath: urlHash), lru (keyPath: urlHash)
//
// Each article record:
//
//   {
//     urlHash:            <16-hex sha256(normalizedUrl) slice>,
//     url:                <normalized URL>,
//     article:            <the full article object the reader consumes>,
//     cachedAt:           <unix seconds — when we first stored it>,
//     lastAccessed:       <unix seconds — bumped on every get()>,
//     source:             'capture' | 'relay',
//     publishedToRelay:   boolean,
//     publishedEventId?:  <hex event id if source='capture' and we published it>
//   }
//
// Eviction: LRU by `lastAccessed`, `publishedToRelay:true` entries
// evicted before unpublished ones (relay is the backup). MVP uses a
// simple entry-count budget (default 500). Byte-budget eviction lands
// later if actual usage warrants it — IndexedDB's unlimitedStorage
// permission means we have headroom to be sloppy about this for now.

import { Utils } from './utils.js';
import { EventBuilder } from './event-builder.js';
import { articleHash as canonicalArticleHash } from './audit/article-hash.js';

const DB_NAME        = 'xray-archive';
const DB_VERSION     = 3;     // v2 (Phase 9a) metadata stores; v3 (Phase 18) source documents
const ARTICLES_STORE = 'articles';
const MAX_ENTRIES    = 500;  // cheap starting budget; revisit if needed

// Stealth-edit retention bound (13.4): displaced article versions kept
// per row. Bounded because article bodies are large and the row is
// LRU-evicted as a unit; three covers the realistic edit-detection
// window without letting a churn-heavy page balloon its row.
const MAX_PRIOR_VERSIONS = 3;

// Phase 9a metadata stores (XRAY_METADATA_SPEC.md §6, Implementation Plan §4).
// All keyed on `eventId` so we can dedupe across relays. `urlHash`
// indexes mirror the convention in `articles` for cross-store joins.
export const ANNOTATIONS_STORE = 'annotations';
export const FACTCHECKS_STORE  = 'factchecks';
export const RATINGS_STORE     = 'ratings';
export const HELPFULNESS_STORE = 'helpfulness';
export const TRUST_GRAPH_STORE = 'trust_graph';

// v3 (Phase 18 C3) — original source-document bytes (PDFs; later other
// non-HTML formats), keyed by sha256(bytes). The archive holds the
// EVIDENCE, not just our reading of it: a capture's `extraction`
// record points here via `source_hash`.
export const SOURCE_DOCS_STORE = 'source_documents';

// Bytes above this cap are not archived (hash-only provenance) — see
// COMPLEX_CONTENT_DESIGN.md §9 Q2.
export const SOURCE_DOC_MAX_BYTES = 50 * 1024 * 1024;

// Per-URL eviction caps for metadata. Once exceeded, oldest-first within
// the urlHash bucket. A global cap (5000 across all urlHashes) drives
// the second eviction pass.
export const ANNOTATIONS_PER_URL_CAP = 200;
export const ANNOTATIONS_GLOBAL_CAP  = 5000;

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

/**
 * Resolve the IndexedDB implementation. In a browser / extension
 * context, `indexedDB` lives on `window`/`self`. In tests, a shim
 * can be set on `globalThis.indexedDB` before import.
 */
function idb() {
    const target = globalThis.indexedDB || (typeof self !== 'undefined' && self.indexedDB);
    if (!target) throw new Error('archive-cache: no indexedDB in this context');
    return target;
}

/**
 * Promisify an IDBRequest.
 */
function req(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror   = () => reject(request.error);
    });
}

/**
 * Promisify a transaction's completion. Distinct from the requests
 * inside it — used when the caller needs to wait for the whole batch
 * to flush before returning.
 */
function tx(transaction) {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onabort    = () => reject(transaction.error);
        transaction.onerror    = () => reject(transaction.error);
    });
}

/**
 * Open (or create) the archive DB. Idempotent — the same Promise is
 * returned across calls so we don't thrash open handles.
 */
let _dbPromise = null;
export function openArchiveDb() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise((resolve, reject) => {
        let open;
        try { open = idb().open(DB_NAME, DB_VERSION); }
        catch (err) { reject(err); return; }

        open.onupgradeneeded = (ev) => {
            const db = open.result;
            const oldVersion = ev.oldVersion || 0;

            // v1 — articles store (Phase 7).
            if (oldVersion < 1 && !db.objectStoreNames.contains(ARTICLES_STORE)) {
                const store = db.createObjectStore(ARTICLES_STORE, { keyPath: 'urlHash' });
                store.createIndex('lastAccessed',    'lastAccessed',    { unique: false });
                store.createIndex('publishedToRelay','publishedToRelay',{ unique: false });
                store.createIndex('cachedAt',        'cachedAt',        { unique: false });
            }

            // v2 — Phase 9a metadata stores. Each row's keyPath is
            // `eventId`; `urlHash` is the join key against `articles`.
            if (oldVersion < 2) {
                if (!db.objectStoreNames.contains(ANNOTATIONS_STORE)) {
                    const ann = db.createObjectStore(ANNOTATIONS_STORE, { keyPath: 'eventId' });
                    ann.createIndex('urlHash',    'urlHash',    { unique: false });
                    ann.createIndex('motivation', 'motivation', { unique: false });
                    ann.createIndex('author',     'author',     { unique: false });
                    ann.createIndex('createdAt',  'createdAt',  { unique: false });
                }
                if (!db.objectStoreNames.contains(FACTCHECKS_STORE)) {
                    const fc = db.createObjectStore(FACTCHECKS_STORE, { keyPath: 'eventId' });
                    fc.createIndex('urlHash',     'urlHash',     { unique: false });
                    fc.createIndex('ratingValue', 'ratingValue', { unique: false });
                    fc.createIndex('createdAt',   'createdAt',   { unique: false });
                }
                if (!db.objectStoreNames.contains(RATINGS_STORE)) {
                    const r = db.createObjectStore(RATINGS_STORE, { keyPath: 'eventId' });
                    r.createIndex('urlHash',    'urlHash',    { unique: false });
                    r.createIndex('createdAt',  'createdAt',  { unique: false });
                }
                if (!db.objectStoreNames.contains(HELPFULNESS_STORE)) {
                    const h = db.createObjectStore(HELPFULNESS_STORE, { keyPath: 'eventId' });
                    h.createIndex('targetEventId', 'targetEventId', { unique: false });
                    h.createIndex('voter',         'voter',         { unique: false });
                    h.createIndex('createdAt',     'createdAt',     { unique: false });
                }
                if (!db.objectStoreNames.contains(TRUST_GRAPH_STORE)) {
                    // Materialized graph for the local user. Single row,
                    // keyed on the local user's pubkey hex (so multi-
                    // identity profiles can host distinct graphs).
                    db.createObjectStore(TRUST_GRAPH_STORE, { keyPath: 'pubkey' });
                }
            }

            // v3 — Phase 18 C3: original source-document bytes, keyed by
            // sha256(bytes) so identical documents dedupe naturally.
            if (oldVersion < 3 && !db.objectStoreNames.contains(SOURCE_DOCS_STORE)) {
                const sd = db.createObjectStore(SOURCE_DOCS_STORE, { keyPath: 'hash' });
                sd.createIndex('url',       'url',       { unique: false });
                sd.createIndex('fetchedAt', 'fetchedAt', { unique: false });
            }
        };
        open.onsuccess = () => resolve(open.result);
        open.onerror   = () => reject(open.error);
    });
    return _dbPromise;
}

/**
 * For tests — reset the cached handle so a new `openArchiveDb()` will
 * re-open. Production callers should never need this.
 */
export function _resetForTests() {
    _dbPromise = null;
}

/**
 * Canonical url → 16-hex hash used as the primary key. Matches the
 * shape documented in `docs/ROADMAP.md` Phase 7 section so relay-side
 * filters can compute the same hash from a URL and correlate with
 * local cache entries.
 */
export async function urlHash(url) {
    const normalized = Utils.normalizeUrl(url);
    const full = await Utils.sha256(normalized);
    return full.slice(0, 16);
}

// ------------------------------------------------------------------
// CRUD
// ------------------------------------------------------------------

/**
 * Upsert an article into the cache. Stamps `cachedAt` on first insert
 * only; `lastAccessed` is refreshed every call. Also runs eviction
 * if the store grew past the entry budget.
 *
 * @param {{
 *   article:          object,
 *   source?:          'capture' | 'relay',
 *   publishedToRelay?: boolean,
 *   publishedEventId?: string | null
 * }} params
 */
export async function saveArticle({ article, source = 'capture', publishedToRelay = false, publishedEventId = null }) {
    if (!article || !article.url) throw new Error('saveArticle: article.url is required');
    const db = await openArchiveDb();
    const url = Utils.normalizeUrl(article.url);
    const hash = await urlHash(url);
    const now = Math.floor(Date.now() / 1000);

    // Phase 13.4 — the canonical article hash (the audit anchor, the
    // `x` tag value). Relay-reconstructed articles carry the hash the
    // publisher computed (`_articleHash`; recomputing after a
    // markdown→HTML→markdown round trip would not byte-match);
    // captures compute it from the same body assembly the publish
    // path uses, so local and published hashes agree. Best-effort —
    // a hash failure must never block archiving, and a failed hash
    // stays null rather than inheriting the prior row's (the hash
    // labels THIS article body; inheriting would mislabel new
    // content with old identity). Computed BEFORE the store
    // transaction opens (an awaited digest would let an IndexedDB
    // transaction auto-commit under it).
    let contentHash = article._articleHash || null;
    if (!contentHash) {
        try {
            contentHash = await canonicalArticleHash(EventBuilder.assembleArticleBody(article));
        } catch (err) {
            Utils.error('archive-cache: article hash failed', err);
        }
    }

    const transaction = db.transaction(ARTICLES_STORE, 'readwrite');
    const store       = transaction.objectStore(ARTICLES_STORE);
    const existing    = await req(store.get(hash));

    // Stealth-edit retention (13.4): this row is the only LOCAL copy
    // of the text prior audits anchor to, and put() replaces it. When
    // a re-capture's hash differs from the stored one, snapshot the
    // displaced version (bounded) so "capturing both versions is its
    // own diagnostic" stays true locally — the design's promise, and
    // the reader banner's.
    let priorVersions = (existing && Array.isArray(existing.priorVersions))
        ? existing.priorVersions : [];
    if (existing && existing.articleHash && contentHash
            && existing.articleHash !== contentHash) {
        priorVersions = [...priorVersions, {
            article:     existing.article,
            articleHash: existing.articleHash,
            cachedAt:    existing.cachedAt,
            source:      existing.source,
            displacedAt: now
        }].slice(-MAX_PRIOR_VERSIONS);
    }

    const record = {
        urlHash:          hash,
        url,
        article,
        articleHash:      contentHash,
        priorVersions,
        cachedAt:         existing ? existing.cachedAt : now,
        lastAccessed:     now,
        source,
        publishedToRelay: publishedToRelay || (existing && existing.publishedToRelay) || false,
        publishedEventId: publishedEventId || (existing && existing.publishedEventId) || null
    };
    store.put(record);
    await tx(transaction);

    // Eviction runs on a fresh transaction so a slow LRU pass doesn't
    // stretch the primary write's duration. The source-document pruner
    // rides along: nothing else ever deletes from that store.
    evictIfNeeded().catch((err) => Utils.error('archive-cache: eviction failed', err));
    pruneSourceOrphans().catch((err) => Utils.error('archive-cache: source prune failed', err));

    return record;
}

/**
 * Retrieve an article from the cache. Returns null if not found.
 * Bumps `lastAccessed` on hit as a side effect (async and fire-and-
 * forget so the caller doesn't have to wait on the write).
 */
export async function getArticle(url) {
    const db = await openArchiveDb();
    const hash = await urlHash(url);
    const readTx = db.transaction(ARTICLES_STORE, 'readonly');
    const record = await req(readTx.objectStore(ARTICLES_STORE).get(hash));
    if (!record) return null;

    // Bump lastAccessed in a second transaction so reads stay cheap.
    (async () => {
        try {
            const bumpTx = db.transaction(ARTICLES_STORE, 'readwrite');
            const bumped = { ...record, lastAccessed: Math.floor(Date.now() / 1000) };
            bumpTx.objectStore(ARTICLES_STORE).put(bumped);
            await tx(bumpTx);
        } catch (_) { /* best-effort */ }
    })();

    return record;
}

/**
 * Is this URL in the cache? Avoids loading the full article payload
 * when all the caller needs is a boolean (e.g. the FAB badge).
 */
export async function hasArticle(url) {
    const db = await openArchiveDb();
    const hash = await urlHash(url);
    const readTx = db.transaction(ARTICLES_STORE, 'readonly');
    const result = await req(readTx.objectStore(ARTICLES_STORE).getKey(hash));
    return result !== undefined;
}

export async function deleteArticle(url) {
    const db = await openArchiveDb();
    const hash = await urlHash(url);
    const transaction = db.transaction(ARTICLES_STORE, 'readwrite');
    transaction.objectStore(ARTICLES_STORE).delete(hash);
    await tx(transaction);
    return true;
}

/**
 * List all records — mostly for diagnostics and an eventual
 * "archive browser" surface. Callers should NOT use this for bulk
 * lookups; fetch by hash instead.
 */
export async function listArticles() {
    const db = await openArchiveDb();
    const readTx = db.transaction(ARTICLES_STORE, 'readonly');
    return await req(readTx.objectStore(ARTICLES_STORE).getAll());
}

/**
 * Clear every entry. Used by the settings "reset" flow and by tests.
 */
export async function clear() {
    const db = await openArchiveDb();
    const transaction = db.transaction(ARTICLES_STORE, 'readwrite');
    transaction.objectStore(ARTICLES_STORE).clear();
    await tx(transaction);
}

export async function count() {
    const db = await openArchiveDb();
    const readTx = db.transaction(ARTICLES_STORE, 'readonly');
    return await req(readTx.objectStore(ARTICLES_STORE).count());
}

// ------------------------------------------------------------------
// Eviction
// ------------------------------------------------------------------

/**
 * Keep the archive under `MAX_ENTRIES` total records. Eviction order
 * is: published-to-relay entries (relay is the durable backup) by
 * LRU, then unpublished entries by LRU. Published-first because
 * losing a published entry is recoverable — we can re-fetch from the
 * relay; losing an unpublished capture is not.
 *
 * Exposed as `evictIfNeeded` so tests can trigger it explicitly.
 */
export async function evictIfNeeded(max = MAX_ENTRIES) {
    const db = await openArchiveDb();
    const c = await count();
    if (c <= max) return 0;

    // Fetch everything — fine at 500–1000 entries. For a real
    // byte-budgeted eviction we'd stream via cursor; this is
    // the MVP.
    const all = await listArticles();
    all.sort((a, b) => {
        // Prefer evicting published (safer to lose) over unpublished.
        const pubA = a.publishedToRelay ? 1 : 0;
        const pubB = b.publishedToRelay ? 1 : 0;
        if (pubA !== pubB) return pubB - pubA;           // published first
        return (a.lastAccessed || 0) - (b.lastAccessed || 0); // LRU within tier
    });

    const toEvict = all.slice(0, c - max);
    const transaction = db.transaction(ARTICLES_STORE, 'readwrite');
    const store = transaction.objectStore(ARTICLES_STORE);
    for (const rec of toEvict) store.delete(rec.urlHash);
    await tx(transaction);
    return toEvict.length;
}

// ------------------------------------------------------------------
// Source documents (v3 — Phase 18 C3)
// ------------------------------------------------------------------

/**
 * Archive a source document's original bytes, keyed by sha256(bytes).
 * Idempotent: an existing row for the hash is left untouched (the
 * bytes are the identity). Oversized documents (> SOURCE_DOC_MAX_BYTES)
 * are NOT stored — the caller keeps hash-only provenance.
 *
 * @param {{hash: string, bytes: ArrayBuffer, mime?: string, url?: string}} doc
 * @returns {Promise<{stored: boolean, reason?: string}>}
 */
export async function putSourceDocument({ hash, bytes, mime = '', url = '' }) {
    if (!hash || !bytes) return { stored: false, reason: 'missing hash or bytes' };
    const size = bytes.byteLength || 0;
    if (size > SOURCE_DOC_MAX_BYTES) return { stored: false, reason: 'too large' };
    const db = await openArchiveDb();
    const existing = await req(
        db.transaction(SOURCE_DOCS_STORE).objectStore(SOURCE_DOCS_STORE).get(hash)
    );
    if (existing) return { stored: true };
    const transaction = db.transaction(SOURCE_DOCS_STORE, 'readwrite');
    transaction.objectStore(SOURCE_DOCS_STORE).put({
        hash,
        bytes,
        mime,
        url,
        size,
        fetchedAt: Math.floor(Date.now() / 1000)
    });
    await tx(transaction);
    return { stored: true };
}

/**
 * Delete source-document rows no capture references (Phase 18
 * hygiene): the store had no eviction path at all, so failed or
 * abandoned captures accumulated PDF bytes and figure PNGs forever.
 * Referenced = an article row whose `extraction.source_hash` names
 * the document, a figure the article's body cites (`xray-figure:` in
 * its markdown/content — figures dedupe by content hash ACROSS
 * documents, so a row's `pdf-figure:` parent url names only the first
 * PDF that stored it; when that parent's article goes, the shared
 * figure must survive for the others), or a figure row
 * (url `pdf-figure:<sourceHash>`) whose parent document is
 * referenced. Rows younger than PRUNE_MIN_AGE_S are kept
 * unconditionally — during a capture the bytes land moments before
 * the article row does, and the pruner must never race a capture
 * running in another tab.
 *
 * @returns {Promise<number>} rows deleted
 */
const PRUNE_MIN_AGE_S = 30 * 60;
const FIGURE_REF_RE = /xray-figure:([0-9a-f]{64})/g;
export async function pruneSourceOrphans() {
    const articles = await listArticles();
    const referenced = new Set();
    const addArticleRefs = (article) => {
        if (!article || typeof article !== 'object') return;
        const hash = article.extraction && article.extraction.source_hash;
        if (hash) referenced.add(hash);
        for (const body of [article.markdown, article.content]) {
            if (typeof body !== 'string' || !body) continue;
            for (const m of body.matchAll(FIGURE_REF_RE)) referenced.add(m[1]);
        }
    };
    for (const rec of articles) {
        addArticleRefs(rec && rec.article);
        // Displaced versions (13.4 stealth-edit retention) are still
        // local evidence — their source bytes/figures stay archived
        // for as long as the row retains the snapshot.
        for (const pv of (rec && Array.isArray(rec.priorVersions) ? rec.priorVersions : [])) {
            addArticleRefs(pv && pv.article);
        }
    }
    const db = await openArchiveDb();
    const cutoff = Math.floor(Date.now() / 1000) - PRUNE_MIN_AGE_S;
    const transaction = db.transaction(SOURCE_DOCS_STORE, 'readwrite');
    const store = transaction.objectStore(SOURCE_DOCS_STORE);
    let pruned = 0;
    await new Promise((resolve, reject) => {
        // Cursor, not getAll: rows carry up-to-50MB byte payloads and
        // must be materialized one at a time.
        const cur = store.openCursor();
        cur.onsuccess = () => {
            const cursor = cur.result;
            if (!cursor) return resolve();
            const row = cursor.value || {};
            const parent = String(row.url || '').startsWith('pdf-figure:')
                ? String(row.url).slice('pdf-figure:'.length)
                : null;
            const keep = (row.fetchedAt || 0) > cutoff
                || referenced.has(row.hash)
                || (parent !== null && referenced.has(parent));
            if (!keep) { cursor.delete(); pruned += 1; }
            cursor.continue();
        };
        cur.onerror = () => reject(cur.error);
    });
    await tx(transaction);
    return pruned;
}

/** Fetch an archived source document by its bytes hash, or null. */
export async function getSourceDocument(hash) {
    if (!hash) return null;
    const db = await openArchiveDb();
    const row = await req(
        db.transaction(SOURCE_DOCS_STORE).objectStore(SOURCE_DOCS_STORE).get(hash)
    );
    return row || null;
}
