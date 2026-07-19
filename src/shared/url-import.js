// URL-list import — Phase 28.1 (corpus intake automation).
//
// Batch-capture a pasted list of URLs into the archive without a tab
// per page: fetch each URL from the extension page (the reader's
// remote-PDF precedent — `host_permissions: <all_urls>` makes the
// cross-origin fetch legal; `credentials: 'include'` so a logged-in
// paywall cookie rides along), extract with the SAME Readability path
// a live capture uses (ContentExtractor.extractFromHtmlString — the
// arXiv ar5iv-adopt seam), archive via saveArticle with the canonical
// precomputed hash (the transcript-import direct-save-first idiom),
// and tag into the case (addArticlesToCase).
//
// Honesty rules:
//   - a thin extraction (Readability text under the config minimum) is
//     imported AND flagged 'thin' — a paywalled abstract is a real,
//     useful capture (the eggs worksheet's paywall-reconstruction
//     tier), but the caller must see it wasn't the full text;
//   - a non-HTML response (a PDF) is skipped with status 'pdf' — the
//     reader's ?pdf= path owns PDF capture (page-map provenance);
//   - an already-archived URL is not re-fetched ('already-archived');
//     it is still (re-)tagged into the case so re-running a worksheet
//     is idempotent;
//   - failures carry the error message; the batch continues.
//
// No LLM anywhere in this module (28.2 layers suggestion on top).
// The batch runner reuses orchestrateModuleRuns (bounded concurrency,
// one retry on transport failure) with URLs as the unit list.

import { CONFIG } from './config.js';
import { ContentExtractor } from './content-extractor.js';
import { EventBuilder } from './event-builder.js';
import { articleHash as canonicalArticleHash } from './audit/article-hash.js';
import { saveArticle, hasArticle } from './archive-cache.js';
import { addArticlesToCase } from './case-membership.js';
import { orchestrateModuleRuns } from './audit/run-orchestrator.js';

const FETCH_TIMEOUT_MS = 30000;

// ------------------------------------------------------------------
// URL-list parsing (pure)
// ------------------------------------------------------------------

// Match http(s) URLs inside markdown autolinks `<url>`, inline links
// `[t](url)`, or bare text. Trailing punctuation that is prose, not
// URL — `.,;:!?` and any unbalanced `)` — is trimmed.
const URL_RE = /https?:\/\/[^\s<>"')\]]+(?:\([^\s<>"')\]]*\)[^\s<>"')\]]*)*/g;

/**
 * Extract an ordered, deduped list of http(s) URLs from pasted text —
 * plain lines, a markdown worksheet, bullets, autolinks. Dedupe is on
 * the fragment-stripped URL (a #fragment is a view, not an identity —
 * the PDF/transcript treatment).
 *
 * @param {string} text
 * @returns {string[]}
 */
// A WHOLE line that reads as bare host/path — "pubmed.ncbi.nlm.nih.gov/
// 32132002/". Anchored to the full line so prose can never match (any
// space fails); the hostname needs at least one dot and an alphabetic
// TLD-ish final label.
const BARE_URL_LINE_RE = /^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:\/[^\s<>"']*)?$/i;

export function parseUrlList(text) {
    const seen = new Set();
    const out = [];
    const push = (raw) => {
        let url = raw.replace(/[.,;:!?]+$/, '');
        try {
            const u = new URL(url);
            if (u.protocol !== 'http:' && u.protocol !== 'https:') return;
            u.hash = '';
            url = u.toString();
        } catch (_) { return; }
        if (seen.has(url)) return;
        seen.add(url);
        out.push(url);
    };
    for (const raw of String(text || '').match(URL_RE) || []) push(raw);
    // Scheme-less fallback, LINE-scoped and conservative: a whole line
    // that is nothing but host/path is unambiguous paste intent (the
    // address bar accepts it; the import box should too — pasting a
    // worksheet of bare "pubmed.ncbi.nlm.nih.gov/…" lines used to
    // yield 0 URLs and a silently disabled Import button). Prose never
    // matches the anchored shape; lines already carrying a scheme were
    // handled by URL_RE above (dedupe absorbs any overlap).
    for (const line of String(text || '').split(/\r?\n/)) {
        const t = line.trim().replace(/^[-*+]\s+/, '');   // tolerate list bullets
        if (!t || /https?:\/\//i.test(t)) continue;
        if (!BARE_URL_LINE_RE.test(t.replace(/[.,;:!?]+$/, ''))) continue;
        push('https://' + t);
    }
    return out;
}

// ------------------------------------------------------------------
// Metadata + article assembly (DOM-dependent pieces kept thin)
// ------------------------------------------------------------------

/**
 * Pick byline / published / siteName / description from a parsed
 * document. Pure over anything exposing querySelector, so tests drive
 * it with a stub. Missing fields are '' — never fabricated (P4).
 */
export function pickDocMeta(doc) {
    const attr = (sel, name) => {
        try {
            const n = doc.querySelector(sel);
            const v = n && (name === 'text' ? n.textContent : n.getAttribute(name));
            return v ? String(v).trim() : '';
        } catch (_) { return ''; }
    };
    return {
        byline: attr('meta[name="author"]', 'content')
            || attr('meta[property="article:author"]', 'content')
            || attr('meta[name="citation_author"]', 'content'),
        publishedTime: attr('meta[property="article:published_time"]', 'content')
            || attr('meta[name="citation_publication_date"]', 'content')
            || attr('meta[name="date"]', 'content')
            || attr('time[datetime]', 'datetime'),
        siteName: attr('meta[property="og:site_name"]', 'content'),
        description: attr('meta[property="og:description"]', 'content')
            || attr('meta[name="description"]', 'content')
    };
}

/**
 * Build a capture-shaped article object from fetched HTML. Uses the
 * live-capture contract: `content` is Readability HTML (markdown
 * happens downstream in assembleArticleBody, exactly once), `links`
 * are the outbound citations of the EXTRACTED body, contentType
 * 'article' / platform null (the generic-detection labels). Returns
 * `{ article, thin, text }` or null when Readability finds no
 * article — `text` is the extracted body text (the 28.2 suggest
 * substrate; close to what the reader's rendered body yields, and
 * quote grounding tolerates the residual whitespace differences).
 *
 * DOM-dependent (DOMParser) — the portal page provides it; tests
 * inject a stub `extract` into importUrlList instead.
 */
export function extractWebArticle({ html, url }) {
    const extracted = ContentExtractor.extractFromHtmlString(html, url);
    if (!extracted) return null;

    let meta = { byline: '', publishedTime: '', siteName: '', description: '' };
    let lang = '';
    try {
        const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
        meta = pickDocMeta(doc);
        lang = (doc.documentElement && doc.documentElement.getAttribute('lang')) || '';
    } catch (_) { /* meta stays empty — never fabricated */ }

    let siteName = meta.siteName;
    if (!siteName) { try { siteName = new URL(url).hostname.replace(/^www\./, ''); } catch (_) { siteName = ''; } }

    const text = extracted.textContent || '';
    const minChars = (CONFIG.extraction && CONFIG.extraction.min_content_length) || 200;
    const article = {
        url,
        title: extracted.title || url,
        byline: meta.byline,
        siteName,
        ...(meta.publishedTime ? { publishedTime: meta.publishedTime } : {}),
        ...(lang ? { lang } : {}),
        excerpt: (meta.description || text).replace(/\s+/g, ' ').trim().slice(0, 200),
        wordCount: text.split(/\s+/).filter(Boolean).length,
        content: extracted.content,
        ...(Array.isArray(extracted.links) ? { links: extracted.links } : {}),
        ...(extracted.links_truncated ? { links_truncated: true } : {}),
        contentType: 'article',
        platform: null,
        entities: [],
        // Provenance marker: this record came from a headless list
        // import, not a live tab (cachedAt records when).
        imported: { via: 'url-import' }
    };
    return { article, thin: text.length < minChars, text };
}

/** The ONE hash recipe for an imported web article — identical to the
 *  reader's ordinary-capture hash (assembleArticleBody over the HTML
 *  content, htmlToMarkdown inside, run exactly once). */
export async function computeWebArticleHash(article) {
    return await canonicalArticleHash(EventBuilder.assembleArticleBody(article));
}

// ------------------------------------------------------------------
// Fetch (injectable)
// ------------------------------------------------------------------

async function defaultFetcher(url) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
    try {
        const resp = await fetch(url, {
            credentials: 'include', redirect: 'follow', signal: ctl.signal
        });
        if (!resp.ok) return { ok: false, status: resp.status, error: `HTTP ${resp.status}` };
        const contentType = (resp.headers.get('content-type') || '').toLowerCase();
        if (contentType.includes('application/pdf')) {
            return { ok: false, pdf: true, error: 'PDF response' };
        }
        const html = await resp.text();
        return { ok: true, html, finalUrl: resp.url || url };
    } catch (err) {
        return { ok: false, error: (err && err.name === 'AbortError') ? 'timeout' : ((err && err.message) || 'fetch failed') };
    } finally {
        clearTimeout(timer);
    }
}

// ------------------------------------------------------------------
// The batch import
// ------------------------------------------------------------------

/**
 * Import a URL list into the archive (and optionally a case).
 *
 * options:
 *   caseEntityId — when set, every imported/already-archived URL is
 *                  tagged into the case (the transcript-import mount)
 *   fetcher      — injectable fetch (tests); default extension fetch
 *   extract      — injectable extractor (tests); default extractWebArticle
 *   concurrency  — bounded pool width (default 2 — polite to origins)
 *   onProgress   — orchestrator progress callback, plus per-row
 *                  results as they land via onResult(row)
 *   onImported   — async callback fired ONLY for imported/thin rows,
 *                  with { row, article, text } — the 28.2 seam (the
 *                  suggest pass needs the article + its extracted
 *                  text; rows alone don't carry them). Awaited inside
 *                  the worker, so its work shares the pool bound; a
 *                  throw marks the row's `post` error but never fails
 *                  the import (the archive row already exists).
 *
 * Resolves to rows in INPUT order:
 *   { url, status: 'imported'|'thin'|'already-archived'|'pdf'|'failed',
 *     title?, articleHash?, finalUrl?, error? }
 *
 * A 'pdf' row is a skip, not a failure — the reader's ?pdf= path owns
 * PDF capture. URLs whose fetch redirected keep the REQUESTED url as
 * identity when already archived, else the FINAL url (an honest
 * record of what was actually captured; the url-alias layer joins the
 * two).
 */
export async function importUrlList(urls, {
    caseEntityId = null,
    fetcher = defaultFetcher,
    extract = extractWebArticle,
    concurrency = 2,
    retryDelayMs = 15000,
    onProgress = () => {},
    onResult = () => {},
    onImported = null
} = {}) {
    const list = Array.isArray(urls) ? urls.filter(Boolean) : [];
    const rowByUrl = new Map();

    const importOne = async (url) => {
        if (await hasArticle(url)) {
            if (caseEntityId) await addArticlesToCase(caseEntityId, [url]);
            return { url, status: 'already-archived' };
        }
        const fetched = await fetcher(url);
        if (!fetched.ok) {
            if (fetched.pdf) return { url, status: 'pdf', error: 'PDF — open via the reader (Open a PDF by URL)' };
            // Throw transport-shaped failures (no HTTP status) so the
            // orchestrator's one-retry covers transient network errors;
            // HTTP failures carry their status (429/5xx retry there).
            if (!fetched.status) throw new Error(fetched.error || 'fetch failed');
            return { url, status: 'failed', error: fetched.error, httpStatus: fetched.status };
        }
        const finalUrl = fetched.finalUrl || url;
        const result = extract({ html: fetched.html, url: finalUrl });
        if (!result || !result.article) {
            return { url, status: 'failed', error: 'no article content found (Readability)' };
        }
        const { article, thin, text } = result;
        article._articleHash = await computeWebArticleHash(article);
        await saveArticle({ article, source: 'capture' });
        if (caseEntityId) await addArticlesToCase(caseEntityId, [article.url]);
        const row = {
            url, status: thin ? 'thin' : 'imported',
            title: article.title, articleHash: article._articleHash,
            ...(finalUrl !== url ? { finalUrl } : {})
        };
        if (typeof onImported === 'function') {
            // Post-import work (28.2 suggest) rides the same worker slot;
            // its failure marks the row but never un-imports the article.
            try { await onImported({ row, article, text: text || '' }); }
            catch (err) { row.post = (err && err.message) || 'post-import step failed'; }
        }
        return row;
    };

    await orchestrateModuleRuns({
        moduleNames: list,
        concurrency,
        retryDelayMs,
        onProgress,
        send: async (url) => {
            const row = await importOne(url);
            rowByUrl.set(url, row);
            onResult(row);
            // `findings` makes ok-rows count in the orchestrator's
            // progress; httpStatus rides as `status` so a 429/5xx page
            // gets the one retry (a retried row re-runs importOne and
            // overwrites its slot — the display keys by url).
            return {
                ok: row.status !== 'failed', module: url, findings: row,
                error: row.error, ...(row.httpStatus ? { status: row.httpStatus } : {})
            };
        }
    });

    return list.map((url) => rowByUrl.get(url)
        || { url, status: 'failed', error: 'failed after retry' });
}
