// Reference resolver — matches the sources an article CITES against
// the members a case corpus already HOLDS (founding-transcript
// integration R1; JOURNAL 2026-08-02).
//
// Four capture-time substrates name cited sources, and until now none
// of them was ever resolved against the corpus:
//
//   - article.links[]                (hyperlinks, content-extractor)
//   - article.references[]           (structured reference lists, scholar-refs)
//   - extraction record sources[]    (map-stage source_references, map-artifacts)
//   - module-04 primary_documents[]  (+ document/study-typed sources, audit)
//
// This module collects them into deduplicated candidates and resolves
// each against the corpus by DETERMINISTIC identity first (normalized
// URL, alias-healed URL, DOI) and token-overlap title similarity
// second. The similarity tier never asserts identity — it yields a
// 'suggested' status for a human to read, in the same spirit as the
// grounding index's mechanical-not-semantic discipline (P3/P11:
// identity is matched or offered, never guessed).
//
// Statuses:
//   resolved   — the cited source IS a corpus member (url/alias/doi)
//   suggested  — a member's title matches closely; human judgment call
//   capturable — not in the corpus, but it has an address (url or doi)
//                → feeds the import path ("call it out and ingest")
//   unknown    — prose-only mention; surfaces as a coverage gap
//
// Pure: no chrome, no network, no DOM, no storage. URL alias healing
// is injected as a resolve(url) function so the module never touches
// the alias store itself.

import { Utils } from './utils.js';

// A title-similarity match below this token-F1 is noise, not a
// suggestion. Mirrors the grounding index's fuzzy floor (0.8) — the
// two thresholds guard the same promise: mechanical matches only.
export const TITLE_MATCH_MIN = 0.8;

// Short titles match everything ("Breaking news"). Below this many
// tokens the title tier refuses to run — deterministic tiers only.
export const MIN_TITLE_TOKENS = 5;

// Audit source types that name a cited DOCUMENT rather than a person.
const DOCUMENT_SOURCE_TYPES = ['document_cited', 'study_cited'];

const DOI_RE = /\b10\.\d{4,9}\/[^\s"'<>)\],;]+/;

// ------------------------------------------------------------------
// Small pure helpers (exported for tests)
// ------------------------------------------------------------------

/** First DOI found in a string, lowercased with trailing punctuation
 *  shed — or null. Understands bare DOIs and doi.org URLs alike. */
export function extractDoi(value) {
    const m = String(value || '').match(DOI_RE);
    if (!m) return null;
    return m[0].replace(/[.,;:]+$/, '').toLowerCase();
}

function titleTokens(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean);
}

/** Set-based token F1 between two titles, 0..1. */
export function titleSimilarity(a, b) {
    const ta = titleTokens(a);
    const tb = titleTokens(b);
    if (ta.length === 0 || tb.length === 0) return 0;
    const sa = new Set(ta);
    const sb = new Set(tb);
    let overlap = 0;
    for (const t of sa) if (sb.has(t)) overlap += 1;
    return (2 * overlap) / (sa.size + sb.size);
}

function normIdent(s) {
    return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 160);
}

function looksLikeUrl(s) {
    return /^https?:\/\//i.test(String(s || '').trim());
}

function normalizeUrlSafe(url) {
    try {
        return Utils.normalizeUrl(String(url || ''));
    } catch (_) {
        return String(url || '');
    }
}

// ------------------------------------------------------------------
// Candidate collection
// ------------------------------------------------------------------

/**
 * Collect deduplicated reference candidates for ONE article from its
 * four substrates. Every input is optional; pass what exists.
 *
 * @param {object} inputs
 * @param {Array}  [inputs.links]          article.links rows {url, text, internal}
 * @param {Array}  [inputs.references]     article.references rows {raw, title, authors, year, doi, pmid, url}
 * @param {Array}  [inputs.mapSources]     extraction-record sources {quote, target_hint}
 * @param {Array}  [inputs.auditDocuments] module-04 primary_documents {document, linked_or_quoted, specific_enough_to_retrieve, evidence_quote}
 * @param {Array}  [inputs.auditSources]   module-04 sources {label, type, evidence_quote}
 * @returns {Array<{key, origins: string[], url: string|null, doi: string|null,
 *                  title: string|null, display: string, quote: string|null,
 *                  retrievable: boolean|null}>}
 */
export function collectReferenceCandidates({
    links = [],
    references = [],
    mapSources = [],
    auditDocuments = [],
    auditSources = []
} = {}) {
    const byKey = new Map();

    // Identity precedence: DOI beats URL beats title-ident. A later
    // sighting of the same identity merges its origin + fills gaps.
    const keyFor = (c) => {
        if (c.doi) return `doi:${c.doi}`;
        if (c.url) return `url:${normalizeUrlSafe(c.url)}`;
        return `t:${normIdent(c.title || c.display)}`;
    };

    const add = (c) => {
        if (!c.url && !c.doi && !normIdent(c.title || c.display)) return;
        const key = keyFor(c);
        const prior = byKey.get(key);
        if (!prior) {
            byKey.set(key, { key, origins: [c.origin], url: c.url || null, doi: c.doi || null,
                title: c.title || null, display: c.display, quote: c.quote || null,
                retrievable: c.retrievable === undefined ? null : c.retrievable });
            return;
        }
        if (!prior.origins.includes(c.origin)) prior.origins.push(c.origin);
        prior.url = prior.url || c.url || null;
        prior.doi = prior.doi || c.doi || null;
        prior.title = prior.title || c.title || null;
        prior.quote = prior.quote || c.quote || null;
        if (prior.retrievable === null && c.retrievable !== undefined) prior.retrievable = c.retrievable;
    };

    for (const l of links) {
        if (!l || !l.url || l.internal) continue;
        add({ origin: 'link', url: l.url, doi: extractDoi(l.url),
            title: null, display: l.text || l.url });
    }

    for (const r of references) {
        if (!r) continue;
        const doi = (r.doi && String(r.doi).toLowerCase()) || extractDoi(r.url) || extractDoi(r.raw);
        add({ origin: 'reference-list', url: r.url || null, doi,
            title: r.title || null, display: r.title || r.raw || r.url || '' });
    }

    for (const s of mapSources) {
        if (!s || !(s.target_hint || s.quote)) continue;
        const hint = String(s.target_hint || '').trim();
        add({
            origin: 'map-source',
            url: looksLikeUrl(hint) ? hint : null,
            doi: extractDoi(hint),
            title: looksLikeUrl(hint) ? null : (hint || null),
            display: hint || s.quote,
            quote: s.quote || null
        });
    }

    for (const d of auditDocuments) {
        if (!d || !d.document) continue;
        add({
            origin: 'audit-document',
            url: null,
            doi: extractDoi(d.document),
            title: d.document,
            display: d.document,
            quote: d.evidence_quote || null,
            retrievable: d.specific_enough_to_retrieve === true
        });
    }

    for (const s of auditSources) {
        if (!s || !DOCUMENT_SOURCE_TYPES.includes(s.type) || !s.label) continue;
        add({
            origin: 'audit-document',
            url: null,
            doi: extractDoi(s.label),
            title: s.label,
            display: s.label,
            quote: s.evidence_quote || null
        });
    }

    return [...byKey.values()];
}

// ------------------------------------------------------------------
// Resolution against the corpus
// ------------------------------------------------------------------

/**
 * Resolve candidates against corpus members.
 *
 * @param {Array} candidates  collectReferenceCandidates output
 * @param {Array} members     [{articleHash, url, title, doi}] — caller
 *                            assembles from archive rows (doi from
 *                            article.scholar, when present)
 * @param {object} [opts]
 * @param {function} [opts.resolve]  url → terminal url (alias healing);
 *                                   identity when omitted
 * @returns {Array<candidate & {status, member: object|null,
 *                              match: 'doi'|'url'|'alias'|'title'|null,
 *                              score: number|null, captureUrl: string|null}>}
 */
export function resolveReferenceCandidates(candidates, members, { resolve } = {}) {
    const heal = typeof resolve === 'function' ? resolve : (u) => u;

    const byDoi = new Map();
    const byUrl = new Map();
    const titled = [];
    for (const m of members || []) {
        if (!m) continue;
        if (m.doi) byDoi.set(String(m.doi).toLowerCase(), m);
        if (m.url) {
            const norm = normalizeUrlSafe(m.url);
            byUrl.set(norm, m);
            const healed = heal(norm);
            if (healed && healed !== norm && !byUrl.has(healed)) byUrl.set(healed, m);
        }
        if (m.title && titleTokens(m.title).length >= MIN_TITLE_TOKENS) titled.push(m);
    }

    return (candidates || []).map((c) => {
        // Tier 1 — DOI, the strongest identity.
        if (c.doi && byDoi.has(c.doi)) {
            return { ...c, status: 'resolved', member: byDoi.get(c.doi), match: 'doi', score: 1, captureUrl: null };
        }
        // Tier 2 — normalized URL, then alias-healed URL.
        if (c.url) {
            const norm = normalizeUrlSafe(c.url);
            if (byUrl.has(norm)) {
                return { ...c, status: 'resolved', member: byUrl.get(norm), match: 'url', score: 1, captureUrl: null };
            }
            const healed = heal(norm);
            if (healed !== norm && byUrl.has(healed)) {
                return { ...c, status: 'resolved', member: byUrl.get(healed), match: 'alias', score: 1, captureUrl: null };
            }
        }
        // Tier 3 — title similarity. Offered, never asserted.
        if (c.title && titleTokens(c.title).length >= MIN_TITLE_TOKENS) {
            let best = null;
            let bestScore = 0;
            for (const m of titled) {
                const score = titleSimilarity(c.title, m.title);
                if (score > bestScore) { best = m; bestScore = score; }
            }
            if (best && bestScore >= TITLE_MATCH_MIN) {
                return { ...c, status: 'suggested', member: best, match: 'title',
                    score: Math.round(bestScore * 100) / 100, captureUrl: null };
            }
        }
        // Unresolved: addressable → capturable; prose-only → unknown.
        // The capture URL is NORMALIZED so the same source cited with
        // and without tracking params dedups to one import row (and
        // lands on the archive's own join key).
        const captureUrl = c.url
            ? normalizeUrlSafe(c.url)
            : (c.doi ? `https://doi.org/${c.doi}` : null);
        return { ...c, status: captureUrl ? 'capturable' : 'unknown',
            member: null, match: null, score: null, captureUrl };
    });
}

/** Distribution summary for a set of resolved rows (one article or a
 *  whole corpus — counts only, never a score). */
export function summarizeReferenceResolution(rows) {
    const out = { total: 0, resolved: 0, suggested: 0, capturable: 0, unknown: 0, byOrigin: {} };
    for (const r of rows || []) {
        if (!r) continue;
        out.total += 1;
        if (r.status in out) out[r.status] += 1;
        for (const o of r.origins || []) out.byOrigin[o] = (out.byOrigin[o] || 0) + 1;
    }
    return out;
}
