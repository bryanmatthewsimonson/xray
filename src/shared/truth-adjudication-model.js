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
// The PROPOSITION record stops at adjudic-ABLE: it carries no verdict
// field and no score. The adjudic-ATED layer is the separate
// AdjudicatedVerdict record below (Phase 15.3, §3.3) — single-author,
// append-only, superseded-never-overwritten — which consumes the
// truth-taxonomy.js firewall predicates (isTruthAdjudicable /
// isIntegrityEligible). The integrity application is 15.4; wire is
// 15.6. No wire kind or flag exists in this file.
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
import { normalize as normalizeUrl } from './metadata/url-normalizer.js';
import {
    PROPOSITION_CLASSES, isValidPropositionClass,
    SUBJECT_ROLE_UNCLASSIFIED, isValidSubjectRole,
    OCCURRED_PRECISIONS, isValidOccurredPrecision,
    HEDGE_LEVELS, TRACTABILITIES, isValidSuggestedBy,
    EVIDENCE_TIERS, isValidEvidenceTier,
    VERDICT_STATES, isValidVerdictState,
    STANDARDS_OF_PROOF, isValidStandardOfProof, defaultStandardOfProof,
    PRECEDENT_WEIGHTS, isValidPrecedentWeight,
    isTruthAdjudicable
} from './truth-taxonomy.js';

const PROPOSITIONS_KEY = 'adjudicable_propositions';
const VERDICTS_KEY = 'adjudicated_verdicts';

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

// ==================================================================
// AdjudicatedVerdict — Phase 15.3 (docs/TRUTH_ADJUDICATION_DESIGN.md
// §3.3). One author's ruling on one truth-adjudicable proposition:
// a DESCRIPTIVE STATE on a declared standard of proof, with verbatim
// two-sided evidence and MANDATORY caveats.
//
// Discipline, enforced here rather than documented:
//   - The firewall: create() refuses a verdict on any proposition
//     that isTruthAdjudicable rejects (interpretation / stated-value).
//   - Evidence adequacy per state: established-true cites evidence
//     FOR; established-false cites evidence AGAINST; contested cites
//     BOTH; unresolved / insufficient-evidence may cite either or
//     none — their caveats carry the why.
//   - Append-only supersession (P9): there is NO update method. A
//     change of ruling is a NEW verdict with `supersedes`; the old
//     record is stamped `superseded_by` (a pointer, like a publish
//     mark) and never edited. Chains are linear — a verdict that is
//     already superseded cannot be superseded again.
//   - No estimated score exists to store. Agreement/variance across
//     MANY authors' verdicts is computed at read time
//     (verdictVariance below) and never collapsed to a number.
//
// The id hashes (proposition_id | supersedes), so the root verdict of
// a chain is idempotent and each superseding step keys off its
// predecessor. Wire identity (kind 30063, keyed (author, proposition))
// is a 15.6 concern; local ids never hit the wire.
//
// Storage: Storage.get('adjudicated_verdicts', {}) — the same
// single-key id→record map as 'adjudicable_propositions'.
// ==================================================================

/** Deterministic verdict id from (proposition_id | supersedes). */
export async function generateVerdictId(propositionId, supersedes) {
    const hash = await Crypto.sha256(`${String(propositionId || '').trim()}|${String(supersedes || '')}`);
    return `verdict_${hash.slice(0, 16)}`;
}

/**
 * Verbatim evidence entries, one side at a time. Each entry needs a
 * non-empty quote (evidence-bound, no exceptions); `tier` (§3.2),
 * `claim_ref`, and `source_ref` are optional but validated/normalized
 * when present, so the verdict ships citable derivation. Exported for
 * integrity-model.js — a §3.4 match "is a verdict, not a drawn edge",
 * so it carries evidence under exactly this discipline.
 */
export function cleanVerdictEvidence(entries, side) {
    if (entries === undefined || entries === null) return [];
    if (!Array.isArray(entries)) {
        throw new Error(`${side} must be an array of evidence entries`);
    }
    return entries.map((entry, i) => {
        const rec = entry || {};
        const quote = String(rec.quote || '').trim();
        if (!quote) {
            throw new Error(`${side}[${i}] needs a verbatim quote — evidence-bound, no exceptions`);
        }
        const tier = rec.tier === undefined || rec.tier === null ? null : rec.tier;
        if (tier !== null && !isValidEvidenceTier(tier)) {
            throw new Error(`${side}[${i}]: invalid evidence tier ${tier} (expected one of ${EVIDENCE_TIERS.join(', ')})`);
        }
        const src = rec.source_ref || {};
        const rawUrl = src.url ? String(src.url) : '';
        const source_ref = (src.url || src.coord || src.event_id || src.title) ? {
            url:      rawUrl ? normalizeUrl(rawUrl) : '',
            url_raw:  src.url_raw || rawUrl,
            title:    src.title || null,
            coord:    src.coord || null,
            event_id: src.event_id || null
        } : null;
        return {
            quote,
            tier,
            claim_ref: rec.claim_ref ? String(rec.claim_ref) : null,
            source_ref,
            note: rec.note ? String(rec.note) : ''
        };
    });
}

// The per-state adequacy rule: no verdict the reader cannot re-derive
// (§5.5). The permanently-honest states carry their why in caveats
// instead of manufactured citations.
function assertEvidenceAdequacy(verdict, evidenceFor, evidenceAgainst) {
    if (verdict === 'established-true' && evidenceFor.length === 0) {
        throw new Error('An established-true verdict needs evidence_for — no verdict the reader cannot re-derive');
    }
    if (verdict === 'established-false' && evidenceAgainst.length === 0) {
        throw new Error('An established-false verdict needs evidence_against — no verdict the reader cannot re-derive');
    }
    if (verdict === 'contested' && (evidenceFor.length === 0 || evidenceAgainst.length === 0)) {
        throw new Error('A contested verdict means credible evidence BOTH ways — cite both sides');
    }
}

/** Mandatory caveats — shared by verdicts (§3.3) and matches (§3.4). */
export function cleanCaveats(input) {
    const arr = Array.isArray(input) ? input : (input ? [input] : []);
    const out = arr.map((c) => String(c || '').trim()).filter(Boolean);
    if (out.length === 0) {
        throw new Error('A verdict needs caveats — what it could not determine is part of the ruling (§3.3)');
    }
    return out;
}

/**
 * Precedent citations (§3.6) — the field that makes the record
 * precedent-ready from the first verdict, while the stare-decisis
 * implementation stays deferred. Each entry: `ref` (a prior verdict/
 * finding — a local id or a 30063/30064 coordinate) + `weight`
 * (binding | persuasive; defaults persuasive — an unweighted citation
 * must not inflate itself). Shared by verdicts and matches.
 */
export function cleanPrecedents(input) {
    if (input === undefined || input === null) return [];
    if (!Array.isArray(input)) throw new Error('precedents must be an array of {ref, weight}');
    return input.map((entry, i) => {
        const rec = entry || {};
        const ref = String(rec.ref || '').trim();
        if (!ref) throw new Error(`precedents[${i}] needs a ref (a prior verdict/finding id or coordinate)`);
        const weight = rec.weight === undefined || rec.weight === null ? 'persuasive' : rec.weight;
        if (!isValidPrecedentWeight(weight)) {
            throw new Error(`precedents[${i}]: invalid weight ${rec.weight} (expected ${PRECEDENT_WEIGHTS.join(' | ')})`);
        }
        return { ref, weight, note: rec.note ? String(rec.note) : '' };
    });
}

/**
 * Right-of-reply references (§2, defamation row) — subject-authored
 * response EVENT IDS referenced from the ruling so the reply travels
 * with it. Emittable in v1; the dedicated reply UI is deferred.
 */
export function cleanReplyRefs(input) {
    if (input === undefined || input === null) return [];
    if (!Array.isArray(input)) throw new Error('reply_refs must be an array of 64-hex event ids');
    return input.map((raw, i) => {
        const id = String(raw || '').trim().toLowerCase();
        if (!/^[0-9a-f]{64}$/.test(id)) {
            throw new Error(`reply_refs[${i}] must be a 64-hex event id (got ${raw})`);
        }
        return id;
    });
}

/**
 * Adjudicator exposure disclosure (§2, political-capture row:
 * "adjudicator exposure published") — the author's relevant
 * financial/political/relational interests, traveling WITH the
 * ruling. Free text, optional; never inferred.
 */
export function cleanExposure(input) {
    return String(input || '').trim();
}

/** Adjudicator identity — shared by verdicts and matches. */
export function cleanAdjudicator(input) {
    if (input === undefined || input === null) return null;
    const rec = input;
    const label = String(rec.label || '').trim();
    const pubkey = (typeof rec.pubkey === 'string' && /^[0-9a-f]{64}$/.test(rec.pubkey)) ? rec.pubkey : null;
    if (!label && !pubkey) return null;
    return { label: label || null, pubkey };
}

export const VerdictModel = {
    get: async (id) => {
        if (!id) return null;
        const all = await Storage.get(VERDICTS_KEY, {});
        return all[id] || null;
    },

    /** Every verdict, oldest first. */
    list: async () => {
        const all = await Storage.get(VERDICTS_KEY, {});
        const out = Object.values(all);
        out.sort((a, b) => (a.created || 0) - (b.created || 0));
        return out;
    },

    /** The full supersession chain for a proposition, oldest first. */
    getForProposition: async (propositionId) => {
        if (!propositionId) return [];
        const all = await Storage.get(VERDICTS_KEY, {});
        const out = Object.values(all).filter((v) => v.proposition_id === propositionId);
        out.sort((a, b) => (a.created || 0) - (b.created || 0));
        return out;
    },

    /** The chain head — the one ruling not yet superseded (or null). */
    getActiveForProposition: async (propositionId) => {
        const chain = await VerdictModel.getForProposition(propositionId);
        return chain.find((v) => !v.superseded_by) || null;
    },

    /**
     * Rule on a proposition. Required: `proposition_id` (must exist
     * AND pass the truth-adjudicability firewall), `verdict`
     * (descriptive state), `caveats` (non-empty), and evidence
     * adequate to the state. `standard_of_proof` defaults per
     * proposition class (declared on the record either way).
     * `supersedes` chains a new ruling onto an un-superseded
     * predecessor for the same proposition. Idempotent on
     * (proposition_id, supersedes).
     */
    create: async (fields) => {
        const given = fields || {};

        const propositionId = String(given.proposition_id || '').trim();
        if (!propositionId) throw new Error('proposition_id is required — a verdict rules on a proposition');
        const proposition = await TruthAdjudicationModel.get(propositionId);
        if (!proposition) throw new Error(`Proposition not found: ${propositionId}`);
        if (!isTruthAdjudicable(proposition)) {
            throw new Error(`Proposition class '${proposition.proposition_class}' is not adjudicable as true/false — `
                + 'the interpretation/value firewall (§3.1); only the reasoning or the word-deed gap is assessable');
        }

        const verdict = given.verdict;
        if (!isValidVerdictState(verdict)) {
            throw new Error(`Invalid verdict: ${verdict} (expected one of ${VERDICT_STATES.join(', ')})`);
        }
        const standard = given.standard_of_proof === undefined || given.standard_of_proof === null
            ? defaultStandardOfProof(proposition.proposition_class)
            : given.standard_of_proof;
        if (!isValidStandardOfProof(standard)) {
            throw new Error(`Invalid standard_of_proof: ${standard} (expected one of ${STANDARDS_OF_PROOF.join(', ')})`);
        }

        const evidenceFor = cleanVerdictEvidence(given.evidence_for, 'evidence_for');
        const evidenceAgainst = cleanVerdictEvidence(given.evidence_against, 'evidence_against');
        assertEvidenceAdequacy(verdict, evidenceFor, evidenceAgainst);
        const caveats = cleanCaveats(given.caveats);

        const supersedes = given.supersedes ? String(given.supersedes) : null;
        const all = await Storage.get(VERDICTS_KEY, {});
        const id = await generateVerdictId(propositionId, supersedes);
        if (all[id]) return all[id];   // idempotent per chain position

        if (supersedes) {
            const prev = all[supersedes];
            if (!prev) throw new Error(`Cannot supersede a missing verdict: ${supersedes}`);
            if (prev.proposition_id !== propositionId) {
                throw new Error('A superseding verdict must rule on the same proposition as its predecessor');
            }
            if (prev.superseded_by) {
                throw new Error(`Verdict ${supersedes} is already superseded by ${prev.superseded_by} — chains are linear, supersede the head`);
            }
        }

        const suggestedBy = given.suggested_by === undefined || given.suggested_by === null
            ? 'user' : given.suggested_by;
        if (!isValidSuggestedBy(suggestedBy)) {
            throw new Error(`Invalid suggested_by: ${suggestedBy} (expected 'user' or 'llm:<model>')`);
        }

        const now = Math.floor(Date.now() / 1000);
        const record = {
            id,
            proposition_id:    propositionId,
            verdict,
            standard_of_proof: standard,
            evidence_for:      evidenceFor,
            evidence_against:  evidenceAgainst,
            caveats,
            method:            String(given.method || '').trim(),
            adjudicator:       cleanAdjudicator(given.adjudicator),
            exposure:          cleanExposure(given.exposure),
            precedents:        cleanPrecedents(given.precedents),
            reply_refs:        cleanReplyRefs(given.reply_refs),
            rationale:         String(given.rationale || ''),
            supersedes,
            superseded_by:     null,
            suggested_by:      suggestedBy,
            created:           now,
            updated:           now
        };
        all[id] = record;
        if (supersedes) {
            // A pointer stamp on the predecessor (like a publish mark)
            // — its ruling, evidence, and caveats are never edited.
            all[supersedes] = { ...all[supersedes], superseded_by: id };
        }
        await Storage.set(VERDICTS_KEY, all);
        Utils.log('Adjudicated verdict:', id, verdict, 'on', propositionId);
        return record;
    },

    // Deliberately NO update(): a verdict is append-only (P9). A
    // changed ruling, sharper caveats, or new evidence is a
    // superseding verdict; the history stays legible.

    /**
     * Record a successful kind-30063 publish. A publish stamp is not
     * an edit — `updated` is untouched, so post-publish supersessions
     * correctly re-emit. `publishedPubkey` + `publishedDTag` let the
     * portal rebuild the 30063 coordinate for reconciliation, and the
     * event id is what a superseding ruling threads into its wire
     * `e supersedes` marker.
     */
    markPublished: async (id, eventId, pubkey, dTag) => {
        const all = await Storage.get(VERDICTS_KEY, {});
        const record = all[id];
        if (!record) return null;
        record.publishedAt = Math.floor(Date.now() / 1000);
        if (eventId) record.publishedEventId = eventId;
        if (pubkey)  record.publishedPubkey = pubkey;
        if (dTag)    record.publishedDTag = dTag;
        all[id] = record;
        await Storage.set(VERDICTS_KEY, all);
        return record;
    },

    /**
     * Record a successful kind-1985 verdict-mirror publish. Tracked
     * separately from `publishedAt` (kind 1985 is non-replaceable), so
     * a rejected mirror retries while its 30063 stays published.
     */
    markMirrored: async (id) => {
        const all = await Storage.get(VERDICTS_KEY, {});
        const record = all[id];
        if (!record) return null;
        record.mirroredAt = Math.floor(Date.now() / 1000);
        all[id] = record;
        await Storage.set(VERDICTS_KEY, all);
        return record;
    },

    /**
     * Delete — chain head only, so history never silently loses an
     * interior ruling. Deleting the head re-opens its predecessor
     * (clears the pointer stamp).
     */
    delete: async (id) => {
        const all = await Storage.get(VERDICTS_KEY, {});
        const record = all[id];
        if (!record) return false;
        if (record.superseded_by) {
            throw new Error(`Verdict ${id} is superseded by ${record.superseded_by} — delete the chain head first`);
        }
        if (record.supersedes && all[record.supersedes]) {
            all[record.supersedes] = { ...all[record.supersedes], superseded_by: null };
        }
        delete all[id];
        await Storage.set(VERDICTS_KEY, all);
        return true;
    }
};

/**
 * The read-time agreement/variance SURFACE (§3.3) — what a reader
 * holding many authors' verdicts on one proposition derives. Pure and
 * derivational: per-state counts, standards represented, and the
 * verdicts themselves — NEVER collapsed to a consensus number (P8:
 * disagreement is data). No event asserts any of this; a future
 * aggregation layer weights it, this client only surfaces it.
 *
 * @param {object[]} verdicts - verdict-shaped records (local or parsed)
 * @returns {{total: number, by_state: object, by_standard: object,
 *            states_present: string[], unanimous: boolean}}
 */
export function verdictVariance(verdicts) {
    const list = (verdicts || []).filter((v) => v && isValidVerdictState(v.verdict));
    const byState = {};
    const byStandard = {};
    for (const v of list) {
        byState[v.verdict] = (byState[v.verdict] || 0) + 1;
        // Accept both spellings: local records carry standard_of_proof,
        // parsed wire events carry standardOfProof — this surface is
        // exactly where the two populations meet.
        const standard = v.standard_of_proof || v.standardOfProof;
        if (standard) {
            byStandard[standard] = (byStandard[standard] || 0) + 1;
        }
    }
    const statesPresent = VERDICT_STATES.filter((s) => byState[s]);
    return {
        total:          list.length,
        by_state:       byState,
        by_standard:    byStandard,
        states_present: statesPresent,
        unanimous:      list.length > 0 && statesPresent.length === 1
    };
}
