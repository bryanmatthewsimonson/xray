// arXiv enrich handler — Phase 18 C2
// (docs/COMPLEX_CONTENT_DESIGN.md §4.3).
//
// The problem: capturing an arxiv.org/abs/ page yields only the
// ABSTRACT — Readability faithfully extracts what the page shows, and
// the abs page shows a summary. ar5iv (ar5iv.labs.arxiv.org/html/<id>)
// serves a full-text HTML rendition of the same paper. This handler
// upgrades the capture to full text when it can, with honest
// provenance when it does.
//
// HONESTY NOTE — provenance matters here: the ar5iv rendition is a
// MACHINE CONVERSION of the paper's LaTeX source (LaTeXML), NOT the
// arXiv PDF of record. Figures, tables, and occasionally equations can
// render differently or drop out. That is exactly why an adopted
// capture records the ar5iv URL in `capture_url` (what was actually
// fetched) while `article.url` stays the /abs/ address — the
// original-as-identity pattern. url-identity.js already canonicalizes
// ar5iv hosts (ar5iv.org, ar5iv.labs.arxiv.org) back to
// arxiv.org/abs/<id>, so the abs page IS the stable citable identity
// for every rendition of the paper.
//
// Contract (src/shared/platforms/index.js): enrich(article) → article,
// fail-open — any internal failure returns the article UNCHANGED, with
// no partial writes. Pure module: no chrome.*, no window/document —
// the caller injects url/fetchHtml/extract. In the extension the
// orchestrator backs `fetchHtml` with a background fetch message
// (content scripts cannot cross-origin fetch under MV3) and `extract`
// with the existing Readability pipeline.
//
// arXiv id + version are NOT re-derived here: scholar-meta.js already
// extracted `arxiv_id` / `arxiv_version` into `article.scholar` on
// every capture. This handler only reads them. The `references` /
// `scholar` structures are LOCAL capture records — no wire change
// (§7 of the design doc); event-builder is untouched.

// Same two id generations as scholar-meta.js: new-style `2401.12345`
// and old-style `math.GT/0309136` (subject classes 2–12 letters,
// possibly hyphenated, SEVEN digits). Anchored to the whole /abs/
// path so listing pages and malformed ids don't match.
const ABS_PATH_RE = /^\/abs\/((?:[a-z-]+(?:\.[a-z-]{2,12})?\/\d{7})|\d{4}\.\d{4,5})(v\d+)?\/?$/i;

// Adoption thresholds: the abs page is short (title + authors +
// abstract — typically well under 2,500 chars), a paper body is not.
// "Meaningfully longer" = at least double the current capture AND an
// absolute floor, so a broken/empty ar5iv page can never displace a
// real abstract capture.
const MIN_FULLTEXT_CHARS = 2000;
const FULLTEXT_RATIO = 2;

/**
 * True when `url` is an arXiv abstract page — arxiv.org/abs/<id>,
 * www. tolerated, query/fragment ignored. /pdf/ and /html/ pages,
 * ar5iv hosts, and listing pages are NOT abs pages.
 *
 * @param {string} url
 * @returns {boolean}
 */
export function isArxivAbsPage(url) {
    let u;
    try { u = new URL(String(url || '')); } catch (_) { return false; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    if (host !== 'arxiv.org') return false;
    return ABS_PATH_RE.test(u.pathname);
}

/**
 * Build the ar5iv full-text rendition URL for an arXiv id.
 * Old-style ids (`math/0309136`, `math.GT/0309136`) are preserved
 * verbatim — the embedded `/` is part of the id, never encoded.
 *
 * @param {string} id             bare arXiv id (no version suffix)
 * @param {number|string} [version]  version number → `v<N>` suffix
 * @returns {string}
 */
export function ar5ivUrlFor(id, version) {
    const v = version ? `v${version}` : '';
    return `https://ar5iv.labs.arxiv.org/html/${id}${v}`;
}

/**
 * Upgrade an abstract-only /abs/ capture to the ar5iv full text.
 *
 * All effects are injected — the module stays pure and testable:
 *
 * @param {object} article  the Readability-extracted capture
 * @param {object} deps
 * @param {object} [deps.doc]     accepted for handler-contract symmetry; unused
 * @param {string} [deps.url]     the page URL (falls back to article.url)
 * @param {(url: string) => Promise<string|null>} deps.fetchHtml
 *        cross-origin HTML fetch (backed by a background message)
 * @param {(html: string, baseUrl: string) => {content, textContent, title, links?}|null} deps.extract
 *        the Readability pipeline over a fetched HTML string; `links`
 *        (the outbound-link extraction over the same DOM) is optional
 *        but wire-relevant — see the adopt block
 * @returns {Promise<object>} the same article — enriched on the adopt
 *        path, byte-identical on every failure path
 */
export async function enrichArticle(article, { url, fetchHtml, extract } = {}) {
    if (!article) return article;
    try {
        const pageUrl = url || article.url || '';
        // Never touch a non-abs page: /pdf/ tabs render in the browser
        // viewer (no content script), everything else isn't ours.
        if (!isArxivAbsPage(pageUrl)) return article;

        // scholar-meta.js already extracted the id/version — read, don't
        // re-derive. No id means nothing to fetch.
        const scholar = article.scholar;
        const id = scholar && scholar.arxiv_id;
        if (!id) return article;
        if (typeof fetchHtml !== 'function' || typeof extract !== 'function') return article;

        const ar5ivUrl = ar5ivUrlFor(id, scholar.arxiv_version);
        const html = await fetchHtml(ar5ivUrl);
        if (!html || typeof html !== 'string') return article;

        const extracted = await extract(html, ar5ivUrl);
        if (!extracted || !extracted.content || !extracted.textContent) return article;

        // Only adopt a MEANINGFULLY longer body — the ar5iv page for a
        // withdrawn/unconverted paper is itself stub-short, and must
        // never displace a real abstract capture.
        const curLen = String(article.textContent || '').length;
        const newLen = String(extracted.textContent).length;
        if (newLen < MIN_FULLTEXT_CHARS || newLen < FULLTEXT_RATIO * curLen) return article;

        // Adopt — a single write block after every check has passed, so
        // no failure path can leave a partially-upgraded article.
        // Identity stays the /abs/ URL (article.url untouched);
        // capture_url records exactly what was fetched, because the
        // ar5iv text is a machine conversion of the LaTeX source and
        // can differ from the PDF of record.
        article.content = extracted.content;
        article.textContent = extracted.textContent;
        article.capture_url = ar5ivUrl;
        article.scholar = { ...scholar, rendition: 'ar5iv' };
        // Everything DERIVED from the old body re-derives with it —
        // these are wire-bound values, not cosmetics: event-builder
        // publishes wordCount as the 30023 `word_count` tag and
        // article.links as `link` tags. Left alone, a full-text paper
        // would ship the abstract's ~50-word count and the abs page's
        // outbound links (same formulas as content-extractor.js).
        article.wordCount = String(extracted.textContent)
            .split(/\s+/).filter((w) => w.length > 0).length;
        article.readingTimeMinutes = Math.ceil(article.wordCount / 225);
        if (Array.isArray(extracted.links)) {
            article.links = extracted.links;
            // Set-when-true only, the capture convention
            // (content-extractor.js:183); a stale true must not survive
            // the swap either.
            if (extracted.links_truncated) article.links_truncated = true;
            else delete article.links_truncated;
        } else {
            // No link extraction over the adopted body → the old links
            // describe a body we no longer ship. Null is the established
            // "not captured" value ("not captured" is not "zero links").
            article.links = null;
            delete article.links_truncated;
        }
        return article;
    } catch (_) {
        // Fail-open: enrichment is best-effort; the abstract capture
        // still makes it to the reader.
        return article;
    }
}
