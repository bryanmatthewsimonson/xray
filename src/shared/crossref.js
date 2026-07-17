// Crossref DOI enrichment — Phase 18 C2
// (docs/COMPLEX_CONTENT_DESIGN.md §4.3, "DOI enrichment").
//
// When a DOI is detected on a capture (scholar-meta.js), a background
// Crossref lookup fills canonical title/authors/date. Metadata only;
// the captured text is always what the page said.
//
// This module is the pure half: it builds the request shape and maps
// the response. The fetch itself lives in the background (wired via an
// xray:scholar:crossref message — see the wiring notes in the PR). No
// chrome.*, no network, no DOM; callers inject the parsed JSON.

// The registrant-prefix shape every real DOI has: `10.<4-9 digits>/`
// plus a suffix. The suffix may not contain whitespace, quotes, or
// angle brackets — this value feeds a background fetch and must never
// build a URL from arbitrary input, so anything off-shape is rejected
// outright rather than "cleaned".
const DOI_SHAPE_RE = /^10\.\d{4,9}\/[^\s"'<>]+$/;

const CROSSREF_WORKS_BASE = 'https://api.crossref.org/works/';

// The scholar-record fields a Crossref patch is allowed to carry /
// fill. Field names match scholar-meta.js where they overlap
// (journal / authors / published); title / publisher / type are
// Crossref-only additions to the local capture record.
const PATCH_FIELDS = ['title', 'authors', 'published', 'journal', 'publisher', 'type'];

/**
 * Build the Crossref works request for a DOI.
 *
 * @param {string} doi  a bare DOI, e.g. "10.1234/abc.567"
 * @returns {{url: string}|null} the request shape, or null when the
 *          input is not a plausibly-shaped DOI (never a URL built
 *          from junk).
 */
export function crossrefRequestFor(doi) {
    if (typeof doi !== 'string') return null;
    const trimmed = doi.trim();
    if (!DOI_SHAPE_RE.test(trimmed)) return null;
    return { url: CROSSREF_WORKS_BASE + encodeURIComponent(trimmed) };
}

function firstNonEmptyString(value) {
    if (!Array.isArray(value)) return null;
    const first = value[0];
    if (typeof first !== 'string') return null;
    const trimmed = first.trim();
    return trimmed || null;
}

function mapAuthors(list) {
    if (!Array.isArray(list)) return null;
    const out = [];
    for (const a of list) {
        if (!a || typeof a !== 'object') continue;
        const given = typeof a.given === 'string' ? a.given.trim() : '';
        const family = typeof a.family === 'string' ? a.family.trim() : '';
        const personal = [given, family].filter(Boolean).join(' ');
        if (personal) {
            out.push(personal);
        } else if (typeof a.name === 'string' && a.name.trim()) {
            // Organizational authors ("literal" names) carry `name`
            // instead of family/given.
            out.push(a.name.trim());
        }
    }
    return out.length ? out : null;
}

// published-print, then published, then issued — the print date is the
// canonical publication date when Crossref has one; `issued` is the
// earliest-known date and always present on real works.
const DATE_KEYS = ['published-print', 'published', 'issued'];

function mapDateParts(msg) {
    for (const key of DATE_KEYS) {
        const field = msg[key];
        const dateParts = field && typeof field === 'object' ? field['date-parts'] : null;
        if (!Array.isArray(dateParts) || !Array.isArray(dateParts[0])) continue;
        const [y, m, d] = dateParts[0];
        if (!Number.isInteger(y) || y <= 0) continue;
        let out = String(y).padStart(4, '0');
        if (Number.isInteger(m) && m >= 1 && m <= 12) {
            out += '-' + String(m).padStart(2, '0');
            if (Number.isInteger(d) && d >= 1 && d <= 31) {
                out += '-' + String(d).padStart(2, '0');
            }
        }
        return out;
    }
    return null;
}

function pickMessage(json) {
    if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
    const msg = json.message && typeof json.message === 'object' && !Array.isArray(json.message)
        ? json.message
        : json;
    return msg;
}

/**
 * Map a Crossref works response to a scholar patch.
 *
 * Accepts either the full response envelope ({ message: {...} }) or
 * the message object itself. Every access is null-safe: junk or
 * partial input yields null (or a partial patch), never a throw.
 *
 * @param {object} json  parsed Crossref response
 * @returns {object|null} { title?, authors?: string[], published?,
 *          journal?, publisher?, type? } — absent fields absent —
 *          or null when nothing mappable was found.
 */
export function mapCrossrefWork(json) {
    try {
        const msg = pickMessage(json);
        if (!msg) return null;
        const out = {};

        const title = firstNonEmptyString(msg.title);
        if (title) out.title = title;

        const authors = mapAuthors(msg.author);
        if (authors) out.authors = authors;

        const published = mapDateParts(msg);
        if (published) out.published = published;

        const journal = firstNonEmptyString(msg['container-title']);
        if (journal) out.journal = journal;

        if (typeof msg.publisher === 'string' && msg.publisher.trim()) {
            out.publisher = msg.publisher.trim();
        }
        if (typeof msg.type === 'string' && msg.type.trim()) {
            out.type = msg.type.trim();
        }

        return Object.keys(out).length ? out : null;
    } catch (_) {
        return null;
    }
}

function isMissing(value) {
    if (value === undefined || value === null) return true;
    if (typeof value === 'string') return value.trim() === '';
    if (Array.isArray(value)) return value.length === 0;
    return false;
}

/**
 * Apply a Crossref patch to a scholar record, FILL-ONLY-MISSING.
 *
 * Never overwrites a field the page itself provided — "Metadata only;
 * the captured text is always what the page said" (§4.3) is the
 * contract. Crossref supplies canon where the page was silent, never
 * a correction to what the page said.
 *
 * Sets `scholar.crossref = true` when anything was filled, so the
 * provenance of every field stays inspectable.
 *
 * @param {object} scholar  the capture's scholar record (mutated)
 * @param {object|null} patch  from mapCrossrefWork
 * @returns {object} the scholar record (unchanged when there was
 *          nothing to fill)
 */
export function applyCrossref(scholar, patch) {
    if (!scholar || typeof scholar !== 'object') return scholar;
    if (!patch || typeof patch !== 'object') return scholar;
    let filled = false;
    for (const key of PATCH_FIELDS) {
        if (isMissing(patch[key])) continue;
        if (!isMissing(scholar[key])) continue;   // the page wins, always
        scholar[key] = patch[key];
        filled = true;
    }
    if (filled) scholar.crossref = true;
    return scholar;
}
