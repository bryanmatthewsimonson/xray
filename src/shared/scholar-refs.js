// Reference-list parsing — Phase 18 C2 tail
// (docs/COMPLEX_CONTENT_DESIGN.md §4.3).
//
// Parses a reference-list DOM subtree into structured entries destined
// for the LOCAL capture record (`article.references` — §7: "local
// capture record"; explicitly NO wire change, event-builder untouched).
//
// Pure module: callers inject the list root (a real element or a stub
// — objects exposing querySelectorAll / getAttribute / textContent).
// No chrome.*, no window/document globals.
//
// HONESTY RULE: wrong structure is worse than no structure. Fields are
// emitted only when they confidently parse; a segment that doesn't
// parse yields { raw } alone. Absent fields are ABSENT, never ''.
// Titles are never guessed from prose — only DOM-marked title nodes
// count (.ref-title, or an italic/cite node that plausibly spans a
// title and not the whole citation).

const MAX_REFERENCES = 200;

// Same DOI shape as platforms/scholar-meta.js (kept in lockstep).
const DOI_RE = /\b(10\.\d{4,9}\/[^\s"'<>]+)/;
// Global variant for stripping every DOI span out of year-matching text.
const DOI_ALL_RE = /\b10\.\d{4,9}\/[^\s"'<>]+/g;
const PMID_RE = /\bPMID:?\s*(\d{1,9})\b/i;
// Publication year in citation position — right after a sentence /
// journal / publisher separator ("J Exp Med. 2015;" / "(2015)") — so
// a year inside the title ("The 1918 influenza…") isn't mistaken for
// the publication year. Falls back to the first bare year token.
const YEAR_CITED_RE = /[.;(]\s*((?:19|20)\d{2})\b/;
const YEAR_ANY_RE = /\b((?:19|20)\d{2})\b/;
const URL_RE = /\bhttps?:\/\/[^\s"'<>]+/gi;
// Trailing punctuation from prose is never part of a DOI or URL.
const TRAILING_PUNCT_RE = /[).,;\]]+$/;

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

/** Extract and clean a DOI from arbitrary text. Null when absent. */
export function cleanDoi(raw) {
    const text = String(raw || '');
    const m = DOI_RE.exec(text);
    if (!m) return null;
    // SICI-style DOIs (older Wiley/Cancer journals) contain literal '<'
    // — '10.1002/1097-0142(19960815)78:4<747::AID-CNCR9>3.0.CO;2-D' —
    // which DOI_RE cannot cross. A truncated DOI is a wrong, non-resolving
    // identifier presented as real; the honest answer is no DOI at all.
    // (scholar-meta.js's private copy still truncates — its inputs are
    // meta-tag values; noted there when these unify.)
    if (text[m.index + m[0].length] === '<') return null;
    return m[1].replace(TRAILING_PUNCT_RE, '');
}

/**
 * Best-effort structure from ONE citation string. Regex-only — never
 * guesses a title (that needs DOM marking, see parseReferenceList).
 *
 * @param {string} raw
 * @returns {{ raw: string, year?: number, doi?: string, pmid?: string,
 *             url?: string }}
 */
export function parseReferenceString(raw) {
    const text = collapse(raw);
    const entry = { raw: text };
    if (!text) return entry;

    const doi = cleanDoi(text);
    if (doi) entry.doi = doi;

    const pmid = PMID_RE.exec(text);
    if (pmid) entry.pmid = pmid[1];

    // Year-match against text with DOI/URL spans removed: an Elsevier
    // DOI ('10.1016/j.vaccine.2015.03.022') puts a dot-preceded year
    // token inside the identifier, and the citation-position regex
    // preferred it over the true year whenever the visible year lacked
    // a [.;(] separator ('Nature 2021;384').
    const yearText = text.replace(DOI_ALL_RE, ' ').replace(URL_RE, ' ');
    const year = YEAR_CITED_RE.exec(yearText) || YEAR_ANY_RE.exec(yearText);
    if (year) entry.year = Number(year[1]);

    // First URL that isn't the DOI's own resolver address.
    URL_RE.lastIndex = 0;
    let u;
    while ((u = URL_RE.exec(text))) {
        const cleaned = u[0].replace(TRAILING_PUNCT_RE, '');
        if (!/doi\.org\//i.test(cleaned)) {
            entry.url = cleaned;
            break;
        }
    }

    return entry;
}

// Title markers, most-trusted first. `.ref-title` is an explicit
// publisher marking; i/em/cite are conventions that ALSO wrap journal
// names, species names, and (PMC) whole citations, so they only count
// when the text is title-shaped and a strict subset of the citation.
const TITLE_SELECTORS = ['.ref-title', 'i', 'em', 'cite'];

function plausibleTitle(t, raw) {
    if (t.length < 15 || t.split(' ').length < 3) return false;
    // Spans (nearly) the whole citation → a wrapper, not a title.
    if (t.length >= raw.length * 0.8) return false;
    // Carries citation plumbing → full-citation text, not a title.
    if (DOI_RE.test(t) || PMID_RE.test(t)) return false;
    // Sits in the JOURNAL slot → a journal name, not a title. APA-style
    // lists italicize journal names ('… Journal of Widget Studies,
    // 12(3), 45-67'), and those pass every guard above. The journal is
    // the segment the year/volume follows directly; a real title is
    // followed by the journal, never by the year.
    const at = raw.indexOf(t);
    if (at >= 0 && /^[.,]?\s*\(?(?:19|20)\d{2}|^[.,]?\s*\d{1,4}\s*\(/.test(raw.slice(at + t.length))) {
        return false;
    }
    return true;
}

function markedTitle(item, raw) {
    for (const sel of TITLE_SELECTORS) {
        for (const node of qsa(item, sel)) {
            const t = collapse(node.textContent);
            if (!t) continue;
            if (sel === '.ref-title') return t;
            if (plausibleTitle(t, raw)) return t;
        }
    }
    return null;
}

// Authors only when the DOM marks them — prose-splitting a citation
// head is guesswork and the honesty rule forbids it.
const AUTHOR_SELECTORS = ['.ref-authors', '.citation-authors', '.authors'];
// A bare-initials comma part ("Smith, J.") means the commas separate
// surname from initials, not author from author — ambiguous, bail.
const INITIALS_RE = /^[A-Z][A-Z.]{0,2}$/;
const FILLER_RE = /^(?:et al\.?|and|&)$/i;

function markedAuthors(item) {
    for (const sel of AUTHOR_SELECTORS) {
        for (const node of qsa(item, sel)) {
            const t = collapse(node.textContent).replace(/[.;,\s]+$/, '');
            if (!t) continue;
            const bySemicolon = t.includes(';');
            const parts = t.split(bySemicolon ? ';' : ',')
                .map((p) => collapse(p).replace(/\.$/, ''))
                // 'and Charles Babbage' as a comma part is a conjunction
                // rider, not an author named "and …" — strip the joiner.
                .map((p) => p.replace(/^(?:and|&)\s+/i, ''))
                .filter((p) => p && !FILLER_RE.test(p));
            if (!parts.length) continue;
            if (!bySemicolon && parts.some((p) => INITIALS_RE.test(p))) continue;
            // Comma-split ambiguity, the fuller shape: 'Lovelace, Ada'
            // is one inverted name, not two authors. A single-token
            // part ('Lovelace') can only come from that inversion —
            // real comma-separated author lists carry full names. Bail
            // (absent) rather than mis-split; the honesty rule.
            if (!bySemicolon && parts.some((p) => !p.includes(' '))) continue;
            return parts;
        }
    }
    return null;
}

function fillFromAnchors(item, entry) {
    for (const a of qsa(item, 'a')) {
        const href = (a.getAttribute && a.getAttribute('href')) || '';
        if (!href) continue;
        if (!entry.doi && /doi\.org\//i.test(href)) {
            const d = cleanDoi(href.split(/[?#]/)[0]);
            if (d) entry.doi = d;
            continue;
        }
        const pm = /(?:pubmed\.ncbi\.nlm\.nih\.gov|ncbi\.nlm\.nih\.gov\/pubmed)\/(\d{1,9})/i.exec(href);
        if (pm) {
            if (!entry.pmid) entry.pmid = pm[1];
            continue;
        }
        // Citation-service chrome is not the referenced work's address.
        // Modern PMC decorates every reference with [DOI] [PubMed]
        // [PMC free article] [Google Scholar] anchors — without the
        // scholar.google exclusion, the Scholar *search link* landed in
        // entry.url on essentially every reference.
        if (!entry.url && /^https?:\/\//i.test(href)
                && !/doi\.org\//i.test(href) && !/ncbi\.nlm\.nih\.gov/i.test(href)
                && !/scholar\.google\./i.test(href) && !/google\.[a-z.]+\/scholar/i.test(href)) {
            entry.url = href;
        }
    }
}

/**
 * Parse a reference-list subtree into structured entries.
 *
 * Accepts the usual list shapes: an ol/ul (or a section containing
 * one) whose items are <li>, and PMC's legacy .ref-cit-blk blocks.
 *
 * @param {Element|object} listEl  injected list root (real or stub)
 * @returns {{ references: Array<{ raw: string, title?: string,
 *             authors?: string[], year?: number, doi?: string,
 *             pmid?: string, url?: string }>, truncated: boolean }}
 */
export function parseReferenceList(listEl) {
    let items = qsa(listEl, 'li');
    if (!items.length) items = qsa(listEl, '.ref-cit-blk');

    // querySelectorAll('li') is a DEEP search: a list nested inside a
    // reference item returns both the outer item (whose textContent
    // concatenates every nested citation — corrupt) and each inner one
    // (again — double-counted). Keep only LEAF items: an item that
    // contains another collected item is a container, not a citation.
    // Stub documents without .contains are unaffected (fail-open).
    if (items.length > 1 && items.some((it) => it && typeof it.contains === 'function')) {
        items = items.filter((it) =>
            !(it && typeof it.contains === 'function'
                && items.some((other) => other !== it && it.contains(other))));
    }

    const truncated = items.length > MAX_REFERENCES;
    const references = [];
    for (const item of items.slice(0, MAX_REFERENCES)) {
        const raw = collapse(item && item.textContent);
        if (!raw) continue;
        const entry = parseReferenceString(raw);
        const title = markedTitle(item, raw);
        if (title) entry.title = title;
        const authors = markedAuthors(item);
        if (authors) entry.authors = authors;
        fillFromAnchors(item, entry);
        references.push(entry);
    }
    return { references, truncated };
}
