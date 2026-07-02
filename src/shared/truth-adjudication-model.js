// Adjudicable-proposition model — Phase 15.1
// (docs/TRUTH_ADJUDICATION_DESIGN.md §3.1; docs/PHASE_15_KICKOFF.md).
//
// A claim (30040) is high-volume and thin. It becomes ADJUDICABLE only
// when atomized into a proposition record that references the claim
// and carries the adjudicability fields:
//
//   - proposition_class    — event-fact | state-fact | prediction |
//                            stated-commitment | stated-value | interpretation
//   - resolution_criteria  — what evidence would settle it, in the SAME
//                            field vocabulary as banked 30058 prediction
//                            entries (criteria / horizon / horizon_iso /
//                            hedge_level / tractability)
//   - subject_role         — stated | enacted | ascribed, or the
//                            `unclassified` absence value (never defaulted
//                            to a substantive role)
//   - occurred_at + occurred_precision — the event-time of the deed or
//                            utterance, distinct from `created`; precision
//                            is mandatory alongside it (no false precision)
//
// This slice stops at adjudic-ABLE, not adjudic-ATED: there is no
// verdict field, no score, no wire kind, no flag. Verdicts are 15.3;
// the integrity application is 15.4; wire is 15.6. The firewall
// predicates (isTruthAdjudicable / isIntegrityEligible) live in
// truth-taxonomy.js and later slices key off them.
//
// The id hashes (claim_id | proposition_class), so create() is
// idempotent — re-atomizing the same claim under the same class returns
// the existing record. Both fields are therefore IMMUTABLE; a
// reclassification is delete + recreate, which is the point: it is a
// new adjudicability assertion, not an edit.
//
// Storage: Storage.get('adjudicable_propositions', {}) keyed by
// proposition id — the same single-key id→record map as
// 'article_claims' / 'behavioral_findings'.

import { Storage } from './storage.js';
import { Crypto } from './crypto.js';
import { Utils } from './utils.js';
import { ClaimModel } from './claim-model.js';
import {
    PROPOSITION_CLASSES, isValidPropositionClass,
    SUBJECT_ROLE_UNCLASSIFIED, isValidSubjectRole,
    OCCURRED_PRECISIONS, isValidOccurredPrecision,
    HEDGE_LEVELS, TRACTABILITIES, isValidSuggestedBy
} from './truth-taxonomy.js';

const PROPOSITIONS_KEY = 'adjudicable_propositions';

// The design's "already determinable" resolution path for facts, as a
// storable token (the house lowercase-hyphenated grammar).
export const HORIZON_ALREADY_DETERMINABLE = 'already-determinable';

// ------------------------------------------------------------------
// ID derivation
// ------------------------------------------------------------------

/**
 * Deterministic id from (claim_id | proposition_class) — one claim
 * atomizes to at most one proposition per class. LOCAL id only; wire
 * identity is a 15.6 concern.
 */
export async function generatePropositionId(claimId, propositionClass) {
    const hash = await Crypto.sha256(`${String(claimId || '').trim()}|${propositionClass}`);
    return `prop_${hash.slice(0, 16)}`;
}

// ------------------------------------------------------------------
// Validation
// ------------------------------------------------------------------

function assertValidClass(value) {
    if (!isValidPropositionClass(value)) {
        throw new Error(`Invalid proposition_class: ${value} (expected one of ${PROPOSITION_CLASSES.join(', ')})`);
    }
    return value;
}

function cleanSubjectRole(value) {
    // Absence = unclassified. Never default a substantive role — that
    // would manufacture a word/deed reading the author did not assert.
    if (value === undefined || value === null || value === '') return SUBJECT_ROLE_UNCLASSIFIED;
    if (!isValidSubjectRole(value)) throw new Error(`Invalid subject_role: ${value}`);
    return value;
}

function assertValidSuggestedBy(value) {
    const v = value === undefined || value === null ? 'user' : value;
    if (!isValidSuggestedBy(v)) {
        throw new Error(`Invalid suggested_by: ${v} (expected 'user' or 'llm:<model>')`);
    }
    return v;
}

/**
 * Normalize resolution_criteria in the 30058 prediction-entry
 * vocabulary. `criteria` is required for every class except
 * `interpretation` (which has no resolution path by construction — the
 * firewall); a `prediction` additionally requires a horizon; facts
 * default to "already-determinable".
 */
function cleanResolutionCriteria(input, propositionClass) {
    const rc = input || {};

    const criteria = String(rc.criteria || '').trim();
    if (!criteria && propositionClass !== 'interpretation') {
        throw new Error('resolution_criteria.criteria is required — what evidence would settle it');
    }

    let horizon = String(rc.horizon || '').trim();
    if (propositionClass === 'prediction' && !horizon) {
        throw new Error('A prediction proposition requires a resolution horizon');
    }
    if (!horizon && (propositionClass === 'event-fact' || propositionClass === 'state-fact')) {
        horizon = HORIZON_ALREADY_DETERMINABLE;
    }

    const horizonIso = rc.horizon_iso ? String(rc.horizon_iso) : null;
    if (horizonIso !== null && !/^\d{4}-\d{2}-\d{2}$/.test(horizonIso)) {
        throw new Error(`horizon_iso must be YYYY-MM-DD or null (got ${horizonIso})`);
    }

    // hedge_level: null = "not recorded" (an unhedged fact proposition
    // has no hedge to record; inventing one would be an estimation).
    const hedge = rc.hedge_level === undefined || rc.hedge_level === null ? null : rc.hedge_level;
    if (hedge !== null && !HEDGE_LEVELS.includes(hedge)) {
        throw new Error(`Invalid hedge_level: ${hedge} (expected one of ${HEDGE_LEVELS.join(', ')})`);
    }

    // tractability defaults to 'ambiguous' — the same honest
    // don't-know default PredictionModel uses.
    const tractability = rc.tractability === undefined || rc.tractability === null
        ? 'ambiguous' : rc.tractability;
    if (!TRACTABILITIES.includes(tractability)) {
        throw new Error(`Invalid tractability: ${tractability} (expected one of ${TRACTABILITIES.join(', ')})`);
    }

    return { criteria, horizon, horizon_iso: horizonIso, hedge_level: hedge, tractability };
}

/**
 * The no-false-precision pairing: occurred_at (Unix seconds) demands
 * an explicit occurred_precision, and precision without a time is
 * meaningless. Returns {occurred_at: null, occurred_precision: null}
 * when no event-time is asserted.
 */
function cleanOccurred(occurredAt, occurredPrecision) {
    const hasAt = occurredAt !== undefined && occurredAt !== null;
    const hasPrecision = occurredPrecision !== undefined && occurredPrecision !== null;
    if (!hasAt) {
        if (hasPrecision) {
            throw new Error('occurred_precision without occurred_at is meaningless — omit both or supply both');
        }
        return { occurred_at: null, occurred_precision: null };
    }
    const at = Number(occurredAt);
    if (!Number.isInteger(at)) {
        throw new Error(`occurred_at must be Unix seconds (integer, got ${occurredAt})`);
    }
    if (!isValidOccurredPrecision(occurredPrecision)) {
        throw new Error(`occurred_at requires occurred_precision (${OCCURRED_PRECISIONS.join(' | ')}) — no false precision`);
    }
    return { occurred_at: at, occurred_precision: occurredPrecision };
}

// ------------------------------------------------------------------
// Read-time backfill (the normalizeClaim idiom) — defensive defaults
// for records written by earlier/foreign code paths. Non-destructive.
// ------------------------------------------------------------------

function normalizeProposition(record) {
    if (!record) return record;
    const rc = record.resolution_criteria || {};
    return {
        ...record,
        subject_role: isValidSubjectRole(record.subject_role)
            ? record.subject_role : SUBJECT_ROLE_UNCLASSIFIED,
        resolution_criteria: {
            criteria:     rc.criteria || '',
            horizon:      rc.horizon || '',
            horizon_iso:  rc.horizon_iso || null,
            hedge_level:  rc.hedge_level || null,
            tractability: rc.tractability || 'ambiguous'
        },
        occurred_at:        record.occurred_at != null ? record.occurred_at : null,
        occurred_precision: record.occurred_precision != null ? record.occurred_precision : null
    };
}

// ------------------------------------------------------------------
// CRUD
// ------------------------------------------------------------------

export const TruthAdjudicationModel = {
    get: async (id) => {
        if (!id) return null;
        const all = await Storage.get(PROPOSITIONS_KEY, {});
        return all[id] ? normalizeProposition(all[id]) : null;
    },

    /** Every proposition, as an array sorted by creation time. */
    list: async () => {
        const all = await Storage.get(PROPOSITIONS_KEY, {});
        const out = Object.values(all).map(normalizeProposition);
        out.sort((a, b) => (a.created || 0) - (b.created || 0));
        return out;
    },

    /** Every proposition atomized from one claim. */
    getByClaim: async (claimId) => {
        if (!claimId) return [];
        const all = await Storage.get(PROPOSITIONS_KEY, {});
        const out = Object.values(all)
            .filter((p) => p.claim_id === claimId)
            .map(normalizeProposition);
        out.sort((a, b) => (a.created || 0) - (b.created || 0));
        return out;
    },

    /**
     * Atomize a claim into an adjudicable proposition. Required:
     * `claim_id` (must reference an EXISTING claim — a proposition
     * over a missing claim is rejected, not stored) and
     * `proposition_class`. `resolution_criteria.criteria` is required
     * except for `interpretation`; a `prediction` requires a horizon.
     * Optional: `subject_role` (absence = 'unclassified'),
     * `occurred_at` + `occurred_precision` (paired), `suggested_by`.
     * Idempotent on (claim_id, proposition_class).
     */
    create: async (fields) => {
        const given = fields || {};

        const claimId = String(given.claim_id || '').trim();
        if (!claimId) throw new Error('claim_id is required — a proposition atomizes an existing claim');
        const claim = await ClaimModel.get(claimId);
        if (!claim) throw new Error(`Claim not found: ${claimId} — cannot atomize a missing claim`);

        const propositionClass = assertValidClass(given.proposition_class);
        const resolutionCriteria = cleanResolutionCriteria(given.resolution_criteria, propositionClass);
        const subjectRole = cleanSubjectRole(given.subject_role);
        const occurred = cleanOccurred(given.occurred_at, given.occurred_precision);
        const suggestedBy = assertValidSuggestedBy(given.suggested_by);

        const id = await generatePropositionId(claimId, propositionClass);
        const all = await Storage.get(PROPOSITIONS_KEY, {});
        if (all[id]) return normalizeProposition(all[id]);   // idempotent

        const now = Math.floor(Date.now() / 1000);
        const record = {
            id,
            claim_id:            claimId,
            proposition_class:   propositionClass,
            resolution_criteria: resolutionCriteria,
            subject_role:        subjectRole,
            occurred_at:         occurred.occurred_at,
            occurred_precision:  occurred.occurred_precision,
            suggested_by:        suggestedBy,
            created:             now,
            updated:             now
        };
        all[id] = record;
        await Storage.set(PROPOSITIONS_KEY, all);
        Utils.log('Created adjudicable proposition:', id, propositionClass, 'over', claimId);
        return record;
    },

    /**
     * Patch a proposition. `claim_id` / `proposition_class` are
     * IMMUTABLE (they derive the id — reclassification is delete +
     * recreate). Patchable: resolution_criteria (revalidated against
     * the record's class), subject_role, occurred_at +
     * occurred_precision (as a pair; pass occurred_at: null to clear
     * both), suggested_by.
     */
    update: async (id, updates) => {
        const all = await Storage.get(PROPOSITIONS_KEY, {});
        const record = all[id];
        if (!record) throw new Error(`Proposition not found: ${id}`);
        const given = updates || {};

        if ('claim_id' in given || 'proposition_class' in given) {
            throw new Error('claim_id and proposition_class are immutable — delete and recreate to reclassify');
        }

        const patched = normalizeProposition(record);
        if ('resolution_criteria' in given) {
            patched.resolution_criteria =
                cleanResolutionCriteria(given.resolution_criteria, record.proposition_class);
        }
        if ('subject_role' in given) {
            patched.subject_role = cleanSubjectRole(given.subject_role);
        }
        if ('occurred_at' in given || 'occurred_precision' in given) {
            const nextAt = 'occurred_at' in given ? given.occurred_at : patched.occurred_at;
            // Clearing the event-time clears its precision with it.
            const nextPrecision = 'occurred_precision' in given
                ? given.occurred_precision
                : (nextAt === null || nextAt === undefined ? null : patched.occurred_precision);
            const occurred = cleanOccurred(nextAt, nextPrecision);
            patched.occurred_at = occurred.occurred_at;
            patched.occurred_precision = occurred.occurred_precision;
        }
        if ('suggested_by' in given) {
            patched.suggested_by = assertValidSuggestedBy(given.suggested_by);
        }

        patched.updated = Math.floor(Date.now() / 1000);
        all[id] = patched;
        await Storage.set(PROPOSITIONS_KEY, all);
        return patched;
    },

    delete: async (id) => {
        const all = await Storage.get(PROPOSITIONS_KEY, {});
        if (!all[id]) return false;
        delete all[id];
        await Storage.set(PROPOSITIONS_KEY, all);
        return true;
    }
};
