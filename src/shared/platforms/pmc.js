// PubMed Central enrich handler — Phase 18 C2 tail
// (docs/COMPLEX_CONTENT_DESIGN.md §4.3).
//
// PMC serves unusually clean scholarly HTML: citation_* metas, a
// structured reference list, and labeled figures. Readability gets the
// body; this handler layers PMC-specific structure on top:
//
//   article.pmc        = { pmcid, pmid?, doi?, figures? }
//   article.references = parsed reference entries (+ the honest
//                        article.references_truncated flag at the cap)
//
// `references` is a LOCAL capture record only (§7: "local capture
// record") — explicitly NO wire change; event-builder is untouched.
//
// Pure module: doc and url are INJECTED (no window/document/chrome
// globals) so the content-script wiring closes over the real DOM and
// tests pass stubs. Fail-open everywhere — any internal failure
// returns the article unchanged (the enrich contract). Reads
// article.scholar when present and only fills gaps from PMC-specific
// metas like citation_pmid. NOTE: the scholar-meta pass must run
// BEFORE handler dispatch for that read to see anything — the
// platforms/index.js hoist (Phase 18 C2 tail) guarantees it; without
// it this self-heals by reading the same metas directly.

import { parseReferenceList, cleanDoi } from '../scholar-refs.js';

const MAX_FIGURES = 40;

// Both PMC hosts: the 2024+ pmc.ncbi.nlm.nih.gov/articles/PMC<digits>/
// and the legacy www.ncbi.nlm.nih.gov/pmc/articles/PMC<digits>/.
const PMC_URL_RE = /^https?:\/\/(?:pmc\.ncbi\.nlm\.nih\.gov\/articles|www\.ncbi\.nlm\.nih\.gov\/pmc\/articles)\/PMC\d+(?:[/?#]|$)/i;

const PMCID_RE = /\bPMC(\d+)\b/i;

// Reference-list roots across PMC generations; first hit wins.
const REF_ROOT_SELECTORS = [
    'section.ref-list',
    'div.ref-list',
    'ol.ref-list',
    'ul.ref-list',
    '#ref-list',
    'section[id^="ref-list"]',
    'section.references',
    '#references'
];

/** Pure URL test for a PMC article page (both hosts). */
export function isPmcPage(url) {
    return PMC_URL_RE.test(String(url || ''));
}

function collapse(text) {
    return String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
}

function qsa(el, selector) {
    if (!el || typeof el.querySelectorAll !== 'function') return [];
    try {
        const nodes = el.querySelectorAll(selector);
        return nodes ? Array.from(nodes) : [];
    } catch (_) {
        return [];
    }
}

function metaContent(doc, names) {
    const wanted = new Set(names.map((n) => n.toLowerCase()));
    for (const m of qsa(doc, 'meta')) {
        const name = String((m.getAttribute && (m.getAttribute('name') || m.getAttribute('property'))) || '').toLowerCase();
        if (!wanted.has(name)) continue;
        const content = m.getAttribute && m.getAttribute('content');
        if (content && content.trim()) return content.trim();
    }
    return '';
}

function pmcidFrom(text) {
    const m = PMCID_RE.exec(String(text || ''));
    return m ? 'PMC' + m[1] : null;
}

function first(el, selectors) {
    for (const sel of selectors) {
        const nodes = qsa(el, sel);
        if (nodes.length) return nodes[0];
    }
    return null;
}

function applyIds(article, doc, url) {
    const scholar = article.scholar || {};
    const pmcid = pmcidFrom(url) || pmcidFrom(metaContent(doc, ['og:url']));
    const pmid = metaContent(doc, ['citation_pmid']);
    // scholar-meta already extracted citation_doi when present — read
    // its key first, only fall back to the meta for the gap case.
    const doi = scholar.doi || cleanDoi(metaContent(doc, ['citation_doi']));
    if (!pmcid && !pmid && !doi) return;
    const pmc = article.pmc || (article.pmc = {});
    if (pmcid && !pmc.pmcid) pmc.pmcid = pmcid;
    if (pmid && !pmc.pmid) pmc.pmid = pmid;
    if (doi && !pmc.doi) pmc.doi = doi;
}

function findRefRoot(doc) {
    for (const sel of REF_ROOT_SELECTORS) {
        const nodes = qsa(doc, sel);
        if (nodes.length) return nodes[0];
    }
    // Legacy PMC: bare .ref-cit-blk blocks with no single list root —
    // hand parseReferenceList a synthetic root over those items.
    const blocks = qsa(doc, '.ref-cit-blk');
    if (blocks.length) {
        return { querySelectorAll: (sel) => (sel === '.ref-cit-blk' ? blocks : []) };
    }
    return null;
}

function applyReferences(article, doc) {
    if (article.references != null) return;     // another extractor won
    const root = findRefRoot(doc);
    if (!root) return;
    const { references, truncated } = parseReferenceList(root);
    if (!references.length) return;              // absent, not empty
    article.references = references;
    if (truncated) article.references_truncated = true;
}

function applyFigures(article, doc) {
    const figures = [];
    for (const fig of qsa(doc, 'figure, .fig')) {
        if (figures.length >= MAX_FIGURES) break;
        const captionNode = first(fig, ['figcaption', '.caption']);
        const caption = captionNode ? collapse(captionNode.textContent) : '';
        if (!caption) continue;                  // text only, or nothing
        const labelNode = first(fig, ['.label', '.fig-label', '.obj_head', 'label']);
        const label = labelNode ? collapse(labelNode.textContent) : '';
        const entry = {};
        if (label && label !== caption) entry.label = label;
        entry.caption = caption;
        figures.push(entry);
    }
    if (!figures.length) return;                 // absent, not empty
    const pmc = article.pmc || (article.pmc = {});
    pmc.figures = figures;
}

/**
 * Layer PMC-specific structure onto a Readability-extracted article.
 * article.platform stays whatever it is. Never throws; always returns
 * the same article object.
 *
 * @param {object} article
 * @param {Document|object|null} doc  injected document (real or stub)
 * @param {string} [url]              injected page URL
 * @returns {object} the same article
 */
export function enrichArticle(article, doc, url = '') {
    if (!article) return article;
    try { applyIds(article, doc, url); } catch (_) { /* fail-open */ }
    try { applyReferences(article, doc); } catch (_) { /* fail-open */ }
    try { applyFigures(article, doc); } catch (_) { /* fail-open */ }
    return article;
}
