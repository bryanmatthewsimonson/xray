// Scholarly metadata extraction — Phase 18 C2
// (docs/COMPLEX_CONTENT_DESIGN.md §4.3).
//
// Publishers of papers embed rich, standardized metadata in meta tags
// (Highwire `citation_*`, Dublin Core, PRISM) that Readability ignores.
// This module reads them into a `scholar` record on the capture: DOI,
// arXiv id+version, journal, authors, publication date. Metadata only —
// the captured text is always what the page said.
//
// Runs generically for every capture (the comment-extractor pattern):
// on non-scholarly pages every probe misses and it returns null.
// Testable with a stub document ({querySelectorAll}, elements with
// getAttribute).

const DOI_RE = /\b(10\.\d{4,9}\/[^\s"'<>]+)/;
// Two id generations: new-style `2401.12345` (YYMM.NNNNN, 2007+) and
// old-style `hep-th/9901001` / `math.GT/0309136` (archive.subject/YYMMNNN,
// SEVEN digits — the earlier pattern demanded eight and never matched a
// pre-2007 paper's URL).
const ARXIV_ABS_RE = /arxiv\.org\/(?:abs|pdf)\/((?:[a-z-]+(?:\.[A-Z]{2})?\/\d{7})|\d{4}\.\d{4,5})(v\d+)?/i;

function metaContent(doc, names) {
    const metas = doc.querySelectorAll ? doc.querySelectorAll('meta') : [];
    const wanted = new Set(names.map((n) => n.toLowerCase()));
    for (const m of metas) {
        const name = String((m.getAttribute && (m.getAttribute('name') || m.getAttribute('property'))) || '').toLowerCase();
        if (!wanted.has(name)) continue;
        const content = m.getAttribute && m.getAttribute('content');
        if (content && content.trim()) return content.trim();
    }
    return '';
}

function metaContents(doc, name) {
    const metas = doc.querySelectorAll ? doc.querySelectorAll('meta') : [];
    const out = [];
    for (const m of metas) {
        const n = String((m.getAttribute && (m.getAttribute('name') || m.getAttribute('property'))) || '').toLowerCase();
        if (n !== name) continue;
        const content = m.getAttribute && m.getAttribute('content');
        if (content && content.trim()) out.push(content.trim());
    }
    return out;
}

function cleanDoi(raw) {
    const m = DOI_RE.exec(String(raw || ''));
    if (!m) return null;
    // Trailing punctuation from prose/URLs is never part of a DOI.
    return m[1].replace(/[).,;\]]+$/, '');
}

/**
 * Extract scholarly metadata from a document (and its URL).
 *
 * @param {Document|object} doc   real or stub document
 * @param {string} [url]          the page URL (arXiv/doi.org shapes)
 * @returns {object|null} { doi?, arxiv_id?, arxiv_version?, journal?,
 *                          authors?: string[], published? } or null
 */
export function extractScholarlyMeta(doc, url = '') {
    if (!doc) return null;
    const out = {};

    const doi = cleanDoi(
        metaContent(doc, ['citation_doi', 'dc.identifier', 'prism.doi', 'bepress_citation_doi'])
        || (String(url).includes('doi.org/') ? url : '')
    );
    if (doi) out.doi = doi;

    const arxivMeta = metaContent(doc, ['citation_arxiv_id']);
    const arxivFromUrl = ARXIV_ABS_RE.exec(String(url || ''));
    if (arxivMeta) {
        out.arxiv_id = arxivMeta.replace(/v\d+$/, '');
        const v = /v(\d+)$/.exec(arxivMeta);
        if (v) out.arxiv_version = Number(v[1]);
    } else if (arxivFromUrl) {
        out.arxiv_id = arxivFromUrl[1].replace(/\.pdf$/i, '');
        if (arxivFromUrl[2]) out.arxiv_version = Number(arxivFromUrl[2].slice(1));
    }

    const journal = metaContent(doc, ['citation_journal_title', 'prism.publicationname']);
    if (journal) out.journal = journal;

    const authors = metaContents(doc, 'citation_author');
    if (authors.length) out.authors = authors;

    const published = metaContent(doc, ['citation_publication_date', 'citation_date', 'dc.date', 'prism.publicationdate']);
    if (published) out.published = published;

    return Object.keys(out).length ? out : null;
}
