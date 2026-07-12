// claim-candidates.js — the cross-article claim/quote candidate pool.
//
// One collector for every surface that lets the user CITE a captured
// artifact: the evidence-link modal (30055 edges), and the adjudicate/
// integrity modals' evidence rows (amendment §5.5a: evidence entries
// reference claims/quotes, never typed text). A claim doubles as the
// QUOTE artifact — `quote` is the verbatim article span and `source`
// is the speaker entity ("W.H.O.") — so candidates carry a resolved
// `speaker` for speaker-first display.
//
// Pool: every locally captured claim across ALL articles + assessed-
// foreign snapshots (coordinate + url/text live in claim_assessments)
// + any injected extras (e.g. the reader session's last-seen network
// claims). Deduped by canonical ref; `exclude` refs are dropped under
// any representation.

import { ClaimModel } from './claim-model.js';
import { AssessmentModel } from './assessment-model.js';
import { EntityModel } from './entity-model.js';
import { makeClaimRefCanonicalizer } from './claim-ref.js';

/**
 * The one search haystack for a candidate — every picker filters over
 * the same four fields (claim text, verbatim quote, speaker, url).
 */
export function candidateHay(cand) {
    const c = cand || {};
    return `${c.text || ''} ${c.quote || ''} ${c.speaker || ''} ${c.url || ''}`.toLowerCase();
}

/**
 * Tokenized query match: every whitespace-separated token must appear
 * somewhere in the hay, in any order and across any field — so
 * "masks W.H.O." finds a W.H.O. quote about masks. An empty query
 * matches everything.
 */
export function matchesCandidateQuery(hay, query) {
    const h = String(hay || '').toLowerCase();
    const tokens = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
    return tokens.every((t) => h.includes(t));
}

/**
 * @param {object} [opts]
 * @param {string[]} [opts.exclude] refs (local ids or coords) to drop
 * @param {object[]} [opts.extra]   injected candidates (network pool)
 * @returns {Promise<Array<{ref, text, quote, speaker, url, url_raw, origin, author_pubkey}>>}
 */
export async function collectClaimCandidates({ exclude = [], extra = [] } = {}) {
    const [allClaims, allAssessments, canon, entities] = await Promise.all([
        ClaimModel.getAll(),
        AssessmentModel.getAll(),
        makeClaimRefCanonicalizer(),
        EntityModel.getAll()
    ]);

    // The claim's `source` is an entity id, free text, or null — the
    // speaker display resolves ids to names and passes text through.
    const speakerOf = (source) => {
        if (!source) return '';
        if (/^entity_/.test(String(source))) {
            const e = entities[source];
            return (e && e.name) || '';
        }
        return String(source);
    };

    const pool = [];
    for (const c of Object.values(allClaims)) {
        pool.push({
            ref: c.id, text: c.text, quote: c.quote || '',
            speaker: speakerOf(c.source),
            url: c.source_url, url_raw: c.source_url,
            origin: 'local', author_pubkey: null
        });
    }
    for (const a of Object.values(allAssessments)) {
        const r = a.claim_ref || {};
        if (r.coord && !r.claim_id) {
            pool.push({
                ref: r.coord, text: r.text, quote: '',
                speaker: '',
                url: r.url, url_raw: r.url_raw || r.url,
                origin: 'assessed', author_pubkey: r.author_pubkey || null
            });
        }
    }
    for (const f of extra || []) {
        const ref = f.ref || f.coord;
        if (!ref) continue;
        pool.push({
            ref, text: f.text || '', quote: f.quote || '',
            speaker: f.speaker || '',
            url: f.url || '', url_raw: f.url_raw || f.url || '',
            origin: f.origin || 'network', author_pubkey: f.author_pubkey || null
        });
    }

    const excluded = new Set((exclude || []).filter(Boolean).map((r) => canon(r)));
    const out = new Map();
    for (const cand of pool) {
        const key = canon(cand.ref);
        if (excluded.has(key)) continue;
        if (!out.has(key)) out.set(key, cand);
    }
    return [...out.values()];
}
