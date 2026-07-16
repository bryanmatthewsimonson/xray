// Hypothesis map storage — Phase 26 H.1 (docs/HYPOTHESIS_MAP_DESIGN.md
// §2). Two chrome.storage.local maps:
//
//   - `case_hypotheses`  — competing answers to a case's scope question
//   - `hypothesis_edges` — claim→hypothesis attachments, each carrying
//                          a role: `supports` or `undermines`
//
// The EvidenceLinker pattern, deliberately in a SEPARATE store:
// `undermines` is not in CLAIM_RELATIONSHIPS and must not leak into
// the claim↔claim link vocabulary. Edges take CANONICAL claim refs
// (claim-ref.js); matchers canonicalize both the stored side and the
// query side at read time. Provenance rides in `suggested_by`
// ('user' | 'llm:<model>' | 'nostr:<pubkey>', the repo-wide seam) —
// the design doc's `provenance` field, under the established name.
//
// Constitution guards (§2, §6): NO weight / score / probability /
// confidence / strength field exists on a hypothesis or an edge — a
// grep test pins this. A claim may support one hypothesis and
// undermine another; nothing here nets that out. NO wire kind: no
// publishedAt / publishedEventId fields until H.5 is a decision.
//
// A hypothesis label is IDENTITY: the id hashes (case_id | normalized
// label), mirroring claim-id derivation, so a brief-seeded hypothesis
// and its later persisted promotion converge on the same record. The
// statement and note are editable; the label and case are not — to
// reframe an answer, delete and re-create.
//
// Cascade posture: deleting a CLAIM removes its edges (the reader's
// claim-delete flow calls deleteForClaim, alongside
// EvidenceLinker.deleteForClaim). Deleting a CASE entity deliberately
// does NOT cascade — the sidepanel's entity delete preserves dependent
// data (claims keep their `about` refs, briefs stay), and case ids are
// name-derived, so re-creating the case reattaches its map.
// `deleteForCase` is the explicit clear-the-map seam for the H.3 UI.

import { Storage } from './storage.js';
import { Crypto } from './crypto.js';
import { Utils } from './utils.js';
import { ClaimModel } from './claim-model.js';
import { normalize as normalizeUrl } from './metadata/url-normalizer.js';
import { isValidSuggestedBy } from './assessment-taxonomy.js';
import {
    isLocalClaimId, parseClaimCoord, assertValidClaimRef,
    canonicalizeClaimRef, makeClaimRefCanonicalizer
} from './claim-ref.js';

// ------------------------------------------------------------------
// Enums
// ------------------------------------------------------------------

export const HYPOTHESIS_EDGE_ROLES = Object.freeze(['supports', 'undermines']);

export const HYPOTHESIS_EDGE_ROLE_LABELS = {
    supports:   'Supports',
    undermines: 'Undermines'
};

export const HYPOTHESIS_EDGE_ROLE_ICONS = {
    supports:   '↗',
    undermines: '↯'
};

// ------------------------------------------------------------------
// ID derivation
// ------------------------------------------------------------------

/** Label normalization for identity: trim, collapse spaces, lowercase. */
export function normalizeHypothesisLabel(label) {
    return String(label || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export async function generateHypothesisId(caseId, label) {
    const key = `${String(caseId || '').trim()}|hypothesis|${normalizeHypothesisLabel(label)}`;
    const hash = await Crypto.sha256(key);
    return `hyp_${hash.slice(0, 16)}`;
}

/**
 * Deterministic edge id from (hypothesis, canonical ref, role) — the
 * role is in the hash, so a supports and an undermines attachment of
 * the same claim to the same hypothesis are distinct records (the map
 * renders that tension; it never resolves it).
 */
export async function generateHypothesisEdgeId(hypothesisId, claimRef, role) {
    const key = `${String(hypothesisId || '')}|${String(claimRef || '')}|${String(role || '')}`;
    const hash = await Crypto.sha256(key);
    return `hedge_${hash.slice(0, 16)}`;
}

// ------------------------------------------------------------------
// Validation
// ------------------------------------------------------------------

function assertValidRole(role) {
    if (!HYPOTHESIS_EDGE_ROLES.includes(role)) {
        throw new Error(`Invalid edge role: ${role} (expected one of ${HYPOTHESIS_EDGE_ROLES.join(', ')})`);
    }
}

function assertValidSuggestedBy(value) {
    const v = value === undefined || value === null ? 'user' : value;
    if (!isValidSuggestedBy(v)) {
        throw new Error(`Invalid suggested_by: ${v} (expected 'user', 'llm:<model>' or 'nostr:<pubkey>')`);
    }
    return v;
}

function assertCaseId(caseId) {
    const trimmed = String(caseId || '').trim();
    if (!trimmed) throw new Error('case_id is required');
    return trimmed;
}

/**
 * Endpoint snapshot for the edged claim — caller-supplied for foreign
 * refs, auto-filled from the claim registry for local ones (the
 * evidence-linker resolveSnapshot pattern). Null when neither source
 * has it; renderers must tolerate that.
 */
async function resolveClaimSnapshot(ref, given) {
    if (given && (given.url || given.text)) {
        const coord = parseClaimCoord(ref);
        const rawUrl = given.url ? String(given.url) : '';
        return {
            url:           rawUrl ? normalizeUrl(rawUrl) : '',
            url_raw:       given.url_raw || rawUrl,
            text:          String(given.text || ''),
            author_pubkey: given.author_pubkey || (coord ? coord.pubkey : null)
        };
    }
    if (isLocalClaimId(ref)) {
        const claim = await ClaimModel.get(ref);
        if (claim) {
            return {
                url:           normalizeUrl(claim.source_url),
                url_raw:       claim.source_url || '',
                text:          claim.text,
                author_pubkey: claim.publishedPubkey || null
            };
        }
    }
    return null;
}

// ------------------------------------------------------------------
// CRUD — hypotheses
// ------------------------------------------------------------------

export const HypothesisModel = {
    get: async (id) => {
        if (!id) return null;
        const all = await Storage.get('case_hypotheses', {});
        return all[id] || null;
    },

    getAll: async () => Storage.get('case_hypotheses', {}),

    /** Hypotheses for one case, oldest-first then id (presentation order is NOT rank). */
    getForCase: async (caseId) => {
        const all = await Storage.get('case_hypotheses', {});
        return Object.values(all)
            .filter((h) => h.case_id === caseId)
            .sort((a, b) => (a.created || 0) - (b.created || 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    },

    /**
     * Create a hypothesis. Idempotent on (case_id, normalized label) —
     * the id derivation — so promoting a brief-seeded hypothesis twice,
     * or re-accepting an LLM suggestion, lands on one record.
     */
    create: async ({ case_id, label, statement, note, suggested_by }) => {
        const caseId = assertCaseId(case_id);
        const cleanLabel = String(label || '').trim();
        if (!cleanLabel) throw new Error('hypothesis label is required');

        const id = await generateHypothesisId(caseId, cleanLabel);
        const all = await Storage.get('case_hypotheses', {});
        if (all[id]) return all[id];

        const now = Math.floor(Date.now() / 1000);
        const record = {
            id,
            case_id:      caseId,
            label:        cleanLabel,
            statement:    String(statement || '').trim(),
            note:         note || '',
            suggested_by: assertValidSuggestedBy(suggested_by),
            created:      now,
            updated:      now
        };
        all[id] = record;
        await Storage.set('case_hypotheses', all);
        Utils.log('Created hypothesis:', id, cleanLabel);
        return record;
    },

    /**
     * Patch a hypothesis. `label` and `case_id` are IMMUTABLE — they
     * derive the id. Editable in place: `statement`, `note`.
     */
    update: async (id, updates) => {
        const all = await Storage.get('case_hypotheses', {});
        const record = all[id];
        if (!record) throw new Error(`Hypothesis not found: ${id}`);
        const patched = { ...record };
        if ('statement' in updates) patched.statement = String(updates.statement || '').trim();
        if ('note' in updates) patched.note = updates.note || '';
        patched.updated = Math.floor(Date.now() / 1000);
        all[id] = patched;
        await Storage.set('case_hypotheses', all);
        return patched;
    },

    /**
     * Delete a hypothesis AND its edges. Dependents FIRST (the
     * confirmDeleteClaim order): a death between the two writes then
     * leaves a hypothesis with no edges — visible and re-deletable —
     * never invisible orphaned edges.
     */
    delete: async (id) => {
        const all = await Storage.get('case_hypotheses', {});
        if (!all[id]) return false;
        const edges = await Storage.get('hypothesis_edges', {});
        let touched = false;
        for (const [eid, edge] of Object.entries(edges)) {
            if (edge.hypothesis_id === id) { delete edges[eid]; touched = true; }
        }
        if (touched) await Storage.set('hypothesis_edges', edges);
        delete all[id];
        await Storage.set('case_hypotheses', all);
        return true;
    },

    /**
     * Remove every hypothesis (and edge) for a case — the explicit
     * clear-the-map seam (H.3 UI). Edges first, same rationale as
     * delete.
     */
    deleteForCase: async (caseId) => {
        const all = await Storage.get('case_hypotheses', {});
        const doomed = new Set(
            Object.values(all).filter((h) => h.case_id === caseId).map((h) => h.id));
        if (doomed.size === 0) return 0;
        const edges = await Storage.get('hypothesis_edges', {});
        let touched = false;
        for (const [eid, edge] of Object.entries(edges)) {
            if (doomed.has(edge.hypothesis_id)) { delete edges[eid]; touched = true; }
        }
        if (touched) await Storage.set('hypothesis_edges', edges);
        for (const id of doomed) delete all[id];
        await Storage.set('case_hypotheses', all);
        return doomed.size;
    }
};

// ------------------------------------------------------------------
// CRUD — edges
// ------------------------------------------------------------------

export const HypothesisEdgeModel = {
    get: async (id) => {
        if (!id) return null;
        const all = await Storage.get('hypothesis_edges', {});
        return all[id] || null;
    },

    getAll: async () => Storage.get('hypothesis_edges', {}),

    /** Edges on one hypothesis, oldest-first then id. */
    getForHypothesis: async (hypothesisId) => {
        const all = await Storage.get('hypothesis_edges', {});
        return Object.values(all)
            .filter((e) => e.hypothesis_id === hypothesisId)
            .sort((a, b) => (a.created || 0) - (b.created || 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    },

    /** Edges for one case, via its hypotheses. */
    getForCase: async (caseId) => {
        const hyps = await HypothesisModel.getForCase(caseId);
        const ids = new Set(hyps.map((h) => h.id));
        const all = await Storage.get('hypothesis_edges', {});
        return Object.values(all)
            .filter((e) => ids.has(e.hypothesis_id))
            .sort((a, b) => (a.created || 0) - (b.created || 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    },

    /**
     * Every edge referencing the claim, by either representation —
     * stored refs are canonicalized too, so drifted refs still match.
     */
    getForClaim: async (ref) => {
        if (!ref) return [];
        const canonical = await canonicalizeClaimRef(ref);
        const canon = await makeClaimRefCanonicalizer();
        const all = await Storage.get('hypothesis_edges', {});
        return Object.values(all)
            .filter((e) => canon(e.claim_ref) === canonical)
            .sort((a, b) => (a.created || 0) - (b.created || 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    },

    /**
     * Attach a claim to a hypothesis. Idempotent on the canonical
     * (hypothesis, ref, role) triple, with the drift-tolerant dedupe
     * pass. `quote` / `article_hash` carry the grounded span when the
     * edge came from synthesis (design §2) — optional, verbatim.
     */
    create: async ({ hypothesis_id, claim_ref, role, note, suggested_by,
                     quote, article_hash, claim_snapshot }) => {
        const hyp = await HypothesisModel.get(hypothesis_id);
        if (!hyp) throw new Error(`Hypothesis not found: ${hypothesis_id}`);
        assertValidClaimRef(claim_ref, 'claim_ref');
        assertValidRole(role);

        const ref = await canonicalizeClaimRef(claim_ref, 'claim_ref');
        const id = await generateHypothesisEdgeId(hypothesis_id, ref, role);
        const all = await Storage.get('hypothesis_edges', {});
        if (all[id]) return all[id];
        // Drift dedupe: a stored ref whose canonicality has since
        // changed derives a different id for the same logical edge.
        {
            const canon = await makeClaimRefCanonicalizer();
            for (const edge of Object.values(all)) {
                if (edge.hypothesis_id === hypothesis_id
                        && edge.role === role
                        && canon(edge.claim_ref) === ref) {
                    return edge;
                }
            }
        }

        const now = Math.floor(Date.now() / 1000);
        const record = {
            id,
            hypothesis_id,
            claim_ref:      ref,
            role,
            note:           note || '',
            suggested_by:   assertValidSuggestedBy(suggested_by),
            quote:          quote ? String(quote) : null,
            article_hash:   article_hash || null,
            claim_snapshot: await resolveClaimSnapshot(ref, claim_snapshot),
            created:        now,
            updated:        now
        };
        all[id] = record;
        await Storage.set('hypothesis_edges', all);
        Utils.log('Created hypothesis edge:', id, role);
        return record;
    },

    /**
     * Patch an edge. Hypothesis / ref / role are IMMUTABLE — they
     * derive the id. Editable in place: `note`.
     */
    update: async (id, updates) => {
        const all = await Storage.get('hypothesis_edges', {});
        const record = all[id];
        if (!record) throw new Error(`Hypothesis edge not found: ${id}`);
        const patched = { ...record };
        if ('note' in updates) patched.note = updates.note || '';
        patched.updated = Math.floor(Date.now() / 1000);
        all[id] = patched;
        await Storage.set('hypothesis_edges', all);
        return patched;
    },

    delete: async (id) => {
        const all = await Storage.get('hypothesis_edges', {});
        if (!all[id]) return false;
        delete all[id];
        await Storage.set('hypothesis_edges', all);
        return true;
    },

    /**
     * Delete every edge referencing the claim (either representation) —
     * for the claim-delete flow, alongside EvidenceLinker.deleteForClaim.
     * Returns the number removed.
     */
    deleteForClaim: async (ref) => {
        if (!ref) return 0;
        const canonical = await canonicalizeClaimRef(ref);
        const canon = await makeClaimRefCanonicalizer();
        const all = await Storage.get('hypothesis_edges', {});
        let removed = 0;
        for (const [id, edge] of Object.entries(all)) {
            if (canon(edge.claim_ref) === canonical) {
                delete all[id];
                removed++;
            }
        }
        if (removed > 0) await Storage.set('hypothesis_edges', all);
        return removed;
    }
};
