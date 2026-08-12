// The entity resolution ladder — UA.2
// (docs/UNIFIED_ARTICLE_PASS_KICKOFF.md §2/§3 rail 3).
//
// Naming consistency used to ride the suggest PROMPT as registry
// vocabulary; that poisons nothing here — the ladder runs at ACCEPT
// time, against the live registry, and the article extract's cache key
// stays registry-free. It answers one question per proposed entity:
// "which existing records might this be?", as RANKED CANDIDATES a
// human ratifies per item.
//
// NEVER-MERGE (CONSTITUTION Art. 6) shapes the rungs:
//
//   IDENTITY rungs — behave as today (creating the same name+type
//   already merges via the deterministic id hash):
//     'exact'  — hash(type + normalized name) is an existing record
//     'alias'  — that record is an alias; the candidate is its
//                canonical root (the E3 rule: attach to the root,
//                never re-silt)
//
//   NEAR-NAME rungs — only ever produce candidates; a human click
//   stands between candidate and link:
//     'token-subset'    — name tokens fully contain / are contained
//                         ("Mayor Elena Vargas" ↔ "Elena Vargas")
//     'surname-initial' — persons only: same surname, one side's
//                         given name is the other's initial
//                         ("J. Smith" ↔ "John Smith")
//
// NO similarity scores — a candidate carries its rung label, never a
// number (guard-tested); no rung ever auto-merges. The nickname table
// (kickoff open question 3) is deliberately SKIPPED: dedupe-review
// backstops, and a miss costs one human click, not correctness.
//
// Pure over a registry snapshot; async only for the id hash.

import { generateEntityId, canonicalIdOf } from './entity-model.js';
import { nameTokens, findEntityMatches } from './llm-proposals.js';

export const RESOLUTION_RUNGS = Object.freeze(['exact', 'alias', 'token-subset', 'surname-initial']);
export const MAX_ENTITY_CANDIDATES = 3;

/** Identity-class rungs resolve what the registry would merge anyway. */
export function isIdentityRung(rung) {
    return rung === 'exact' || rung === 'alias';
}

/** Lowercased whitespace tokens with trailing dots stripped ("J." → "j"). */
function looseTokens(name) {
    return String(name || '').toLowerCase().split(/\s+/)
        .map((t) => t.replace(/[.]+$/, '').replace(/[^\p{L}\p{N}'-]/gu, ''))
        .filter(Boolean);
}

/** "J" ↔ "john": one side is a single letter equal to the other's first. */
function initialMatch(a, b) {
    if (a === b) return true;
    if (a.length === 1) return b.startsWith(a);
    if (b.length === 1) return a.startsWith(b);
    return false;
}

/** Same surname + given-name/initial agreement, either direction. */
function surnameInitialMatch(proposedName, candidateName) {
    const p = looseTokens(proposedName);
    const c = looseTokens(candidateName);
    if (p.length < 2 || c.length < 2) return false;
    const pLast = p[p.length - 1];
    const cLast = c[c.length - 1];
    if (pLast !== cLast || pLast.length < 2) return false;
    // One side must actually be abbreviated — full-name agreement is
    // the token-subset rung's business, not this one's.
    if (p[0].length > 1 && c[0].length > 1) return false;
    return initialMatch(p[0], c[0]);
}

/**
 * Rank the registry records a proposed {name, type} might already be.
 *
 * @param {{name: string, type: string}} proposal
 * @param {object} recordsById  the entity registry snapshot (id → record)
 * @returns {Promise<Array<{id, name, type, rung}>>}  rung-ordered, capped
 *          at MAX_ENTITY_CANDIDATES, one entry per canonical root,
 *          NO numeric fields (guard-tested)
 */
export async function rankEntityCandidates({ name, type } = {}, recordsById = {}) {
    const all = recordsById || {};
    if (!String(name || '').trim() || !type) return [];
    const out = [];
    const seen = new Set();
    const push = (rec, rung) => {
        if (!rec || !rec.id) return;
        const root = all[canonicalIdOf(rec.id, all)] || rec;
        if (root.type !== type || seen.has(root.id)) return;
        seen.add(root.id);
        out.push({ id: root.id, name: root.name, type: root.type, rung });
    };

    // IDENTITY: the id this registry would mint for the proposal. An
    // existing record there — the entity itself, or an alias record
    // riding under this very name — is what create() would merge with.
    const exactRec = all[await generateEntityId(type, name)];
    if (exactRec) push(exactRec, exactRec.canonical_id ? 'alias' : 'exact');

    // NEAR-NAME: token containment (findEntityMatches already resolves
    // alias hits to their canonical root and orders exact-token-equal
    // first, shortest name next).
    for (const rec of findEntityMatches(name, type, Object.values(all))) {
        push(rec, 'token-subset');
    }

    // NEAR-NAME, persons only: abbreviated given name + same surname.
    if (type === 'person') {
        const rows = Object.values(all)
            .filter((e) => e && e.id && e.type === 'person' && e.name
                && surnameInitialMatch(name, e.name))
            .sort((a, b) => String(a.name).length - String(b.name).length
                || String(a.name).localeCompare(String(b.name)));
        for (const rec of rows) push(rec, 'surname-initial');
    }

    return out.slice(0, MAX_ENTITY_CANDIDATES);
}

/**
 * The modal's pre-selected choice for a candidate list (rail 3's
 * affordance policy):
 *   - identity-class top candidate → pre-select it (the registry
 *     would merge that create anyway; the Accept ratifies);
 *   - a SINGLE token-subset candidate → pre-select it (the pre-UA.2
 *     single-token-match behavior, EXACTLY — that rung is the old
 *     findEntityMatches affordance);
 *   - anything else — multiple candidates, or a lone
 *     surname-initial — → 'new'. surname-initial is a NEW rung with
 *     no pre-UA.2 precedent, and "Accept all entities" ratifies a
 *     pre-selection without a per-item click, so a lone initial
 *     match pre-linking would widen the auto-link surface past what
 *     rail 3 licenses. It ranks in the dropdown; the human picks it.
 */
export function defaultEntityChoice(candidates) {
    const list = Array.isArray(candidates) ? candidates : [];
    if (list.length === 0) return 'new';
    if (isIdentityRung(list[0].rung)) return list[0].id;
    if (list.length === 1 && list[0].rung === 'token-subset') return list[0].id;
    return 'new';
}

/** Human-readable rung wording for the dedupe chip / option tooltips. */
export function rungLabel(rung) {
    switch (rung) {
        case 'exact': return 'same name and type as an existing entity';
        case 'alias': return 'an existing entity\'s recorded alias';
        case 'token-subset': return 'name overlaps an existing entity of the same type';
        case 'surname-initial': return 'initial + surname match an existing person';
        default: return 'possible existing entity';
    }
}

// The registry provides `nameTokens` transitively; re-exported so the
// modal needs one import for the whole affordance.
export { nameTokens };
