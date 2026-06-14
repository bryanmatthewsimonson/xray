// X-Ray — beat vocabulary, version beats-v1 (Phase 13, slice 13.1).
//
// The beat taxonomy is METHODOLOGY: versioned like the module prompts
// (PHILOSOPHY.md P12), because fragmented beats silently shrink dossier
// sample sizes and distort the §4 shrinkage math on reputation-bearing
// rollups. Rules (RQ8, docs/EPISTEMIC_AUDIT_DESIGN.md §Beats):
//
//   - Dossier beat subjects MUST be canonical slugs from this list.
//   - Free-form `t` tags ride events but never mint beats: the dossier
//     builder normalizes via the alias map and surfaces unmapped tags
//     in a review list instead of creating subjects from them.
//   - Flat, single-level for v1 — hierarchy is a v2 problem.
//
// The same vocabulary is published verbatim as the JSON artifact
// `beats-v1.json` beside this file (the third-party-consumable form);
// tests/audit-beats.test.mjs asserts the two never drift. This module
// is the single source of truth for code.

export const BEATS_VERSION = 'beats-v1';

// Canonical kebab-case slugs (maintainer-curated starter list, RQ8).
export const BEATS = Object.freeze([
    'monetary-policy',
    'bitcoin',
    'banking',
    'fiscal-policy',
    'free-speech',
    'religion',
    'media-criticism',
    'family-law',
    'mens-issues',
    'immigration',
    'drug-policy',
    'housing-policy',
    'civil-asset-forfeiture',
    'occupational-licensing',
    'education-policy',
    'courts-legal',
    'elections',
    'foreign-policy',
    'national-security',
    'tech-policy',
    'ai',
    'public-health',
    'crime-justice',
    'labor-economics'
]);

// Alias → canonical slug. Deliberate non-alias: `crypto` does NOT map
// to `bitcoin` — they are not the same beat (RQ8, verbatim).
export const BEAT_ALIASES = Object.freeze({
    'fed': 'monetary-policy',
    'federal-reserve': 'monetary-policy',
    'm2': 'monetary-policy',
    'btc': 'bitcoin',
    'lds': 'religion',
    'mormon': 'religion'
});

const BEAT_SET = new Set(BEATS);

/**
 * True when `slug` is a canonical beats-v1 slug (exact match — callers
 * normalize first).
 */
export function isCanonicalBeat(slug) {
    return BEAT_SET.has(slug);
}

/**
 * Normalize a free-form `t` tag toward the canonical vocabulary.
 * Lowercases, trims, and collapses inner whitespace/underscores to
 * hyphens before lookup. Returns the canonical slug, or null when the
 * tag maps to nothing — null means "review list", never "new beat".
 *
 * @param {string} tag - free-form topic tag
 * @returns {string|null} canonical slug or null
 */
export function normalizeBeat(tag) {
    const cleaned = String(tag ?? '')
        .trim()
        .toLowerCase()
        .replace(/[\s_]+/g, '-');
    if (!cleaned) return null;
    if (BEAT_SET.has(cleaned)) return cleaned;
    if (Object.prototype.hasOwnProperty.call(BEAT_ALIASES, cleaned)) {
        return BEAT_ALIASES[cleaned];
    }
    return null;
}
