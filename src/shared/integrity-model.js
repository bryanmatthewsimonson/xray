// IntegrityFinding model — Phase 15.4
// (docs/TRUTH_ADJUDICATION_DESIGN.md §3.4). The headline USE of the
// adjudication engine: link a subject's STATED commitment or value
// (the word) to their ENACTED action-facts (the deeds) and adjudicate
// the observable gap. The match is itself a VERDICT — standard of
// proof, verbatim evidence, mandatory caveats, append-only
// supersession — never a drawn edge.
//
// What is enforced here, by construction:
//   - Word side: a proposition whose integrityRole is 'word'
//     (stated-commitment/stated-value + subject_role 'stated').
//     Deed side: 'deed' (event/state-fact + 'enacted'). `ascribed`
//     and `unclassified` propositions are REJECTED from findings —
//     an ascribed claim is about the entity but is not theirs to be
//     held to (§3.1).
//   - Same entity both sides: every deed's claim must share an
//     `about` entity with the word's claim; the shared ids are
//     stored as the finding's `entity_ids`.
//   - The VALUE FIREWALL (§3.4): a stated-value is matched
//     consistent/contradicted against deeds — the value itself is
//     never ruled true/false (that is VerdictModel's firewall), and
//     the match vocabulary is per-word-class so a value can't be
//     "fulfilled" nor a promise "contradicted".
//   - INTENT IS NOT ADJUDICATED. There is no intent/motive field. A
//     gap_decomposition cause (lie/revision/incapacity/constraint/
//     misattribution) is recordable ONLY with a documented
//     explanation — non-empty note, evidence where it exists;
//     `constraint` demands a corroborated deed-side proposition ref
//     (evidence, not an excuse); `revision` may cite the 30055
//     revision/* edge or 30062 finding it composes (credit, not
//     penalty, when disclosed).
//   - Pattern, not instance: findings order on the matched deeds'
//     occurred_at (timelineForEntity), so an entity's integrity
//     record reads as a time series, not a gotcha.
//
// The id hashes (word | sorted deeds | supersedes) — same append-only
// chain semantics as VerdictModel: no update method, forks collapse
// idempotently, delete is chain-head-only. Wire (kind 30064) is 15.6.
//
// Storage: Storage.get('integrity_findings', {}) — the house
// single-key id→record map.

import { Storage } from './storage.js';
import { Crypto } from './crypto.js';
import { Utils } from './utils.js';
import { ClaimModel } from './claim-model.js';
import {
    TruthAdjudicationModel, cleanVerdictEvidence, cleanCaveats, cleanAdjudicator
} from './truth-adjudication-model.js';
import {
    integrityRole,
    INTEGRITY_MATCH_STATES, isValidMatchForWordClass, matchStatesForWordClass,
    GAP_MATCH_STATES, GAP_CAUSES, isValidGapCause,
    STANDARDS_OF_PROOF, isValidStandardOfProof, defaultStandardOfProof,
    isValidSuggestedBy
} from './truth-taxonomy.js';

const FINDINGS_KEY = 'integrity_findings';

// ------------------------------------------------------------------
// ID derivation
// ------------------------------------------------------------------

/**
 * Deterministic id from (word | sorted deeds | supersedes). Deed
 * order is not meaningful, so it is sorted out of the identity.
 */
export async function generateIntegrityFindingId(wordId, deedIds, supersedes) {
    const deeds = [...(deedIds || [])].sort().join(',');
    const hash = await Crypto.sha256(
        `${String(wordId || '').trim()}|${deeds}|${String(supersedes || '')}`);
    return `integrity_${hash.slice(0, 16)}`;
}

// ------------------------------------------------------------------
// Validation
// ------------------------------------------------------------------

async function resolveWordSide(wordPropositionId) {
    const id = String(wordPropositionId || '').trim();
    if (!id) throw new Error('word_proposition_id is required — the stated commitment or value');
    const word = await TruthAdjudicationModel.get(id);
    if (!word) throw new Error(`Word proposition not found: ${id}`);
    if (integrityRole(word) !== 'word') {
        throw new Error(`Proposition ${id} cannot sit on the word side — it needs `
            + `proposition_class stated-commitment/stated-value with subject_role 'stated'; `
            + `ascribed/unclassified propositions are excluded by construction (§3.1)`);
    }
    return word;
}

async function resolveDeedSide(deedPropositionIds) {
    if (!Array.isArray(deedPropositionIds) || deedPropositionIds.length === 0) {
        throw new Error('deed_proposition_ids is required — at least one enacted action-fact');
    }
    const deeds = [];
    for (const raw of deedPropositionIds) {
        const id = String(raw || '').trim();
        const deed = await TruthAdjudicationModel.get(id);
        if (!deed) throw new Error(`Deed proposition not found: ${id}`);
        if (integrityRole(deed) !== 'deed') {
            throw new Error(`Proposition ${id} cannot sit on the deed side — it needs `
                + `proposition_class event-fact/state-fact with subject_role 'enacted'; `
                + `ascribed/unclassified propositions are excluded by construction (§3.1)`);
        }
        deeds.push(deed);
    }
    return deeds;
}

/**
 * The same-entity rule: an IntegrityFinding matches a subject's own
 * words against their own deeds, so every deed's claim must share at
 * least one `about` entity with the word's claim. Returns the shared
 * entity ids (the finding's subjects).
 */
async function resolveSharedEntities(word, deeds) {
    const wordClaim = await ClaimModel.get(word.claim_id);
    const wordAbout = new Set((wordClaim && wordClaim.about) || []);
    if (wordAbout.size === 0) {
        throw new Error('The word-side claim carries no about-entity — an integrity finding '
            + 'needs the same entity on both sides');
    }
    const shared = new Set();
    for (const deed of deeds) {
        const deedClaim = await ClaimModel.get(deed.claim_id);
        const deedAbout = (deedClaim && deedClaim.about) || [];
        const overlap = deedAbout.filter((e) => wordAbout.has(e));
        if (overlap.length === 0) {
            throw new Error(`Deed proposition ${deed.id} concerns no entity the word side concerns — `
                + 'words and deeds must be about the same entity');
        }
        overlap.forEach((e) => shared.add(e));
    }
    return [...shared];
}

// The per-match evidence-adequacy rule, mirroring the verdict rule:
// a substantive match cites the evidence that carries it; contested
// cites both readings; the honest states carry their why in caveats.
function assertMatchEvidenceAdequacy(match, evidenceFor, evidenceAgainst) {
    const substantive = ['fulfilled', 'broken', 'consistent', 'contradicted'];
    if (substantive.includes(match) && evidenceFor.length === 0) {
        throw new Error(`A ${match} match needs evidence_for — the match is a verdict, not a drawn edge`);
    }
    if (match === 'contested' && (evidenceFor.length === 0 || evidenceAgainst.length === 0)) {
        throw new Error('A contested match means credible evidence BOTH ways — cite both sides');
    }
}

/**
 * Gap decomposition (§3.4) — only on broken/contradicted, and only
 * DOCUMENTED: a cause with no explanation is an intent guess, which
 * this layer never records.
 */
async function cleanGap(input, match) {
    if (input === undefined || input === null) return null;
    if (!GAP_MATCH_STATES.includes(match)) {
        throw new Error(`gap_decomposition only attaches to a ${GAP_MATCH_STATES.join('/')} match (got ${match})`);
    }
    const given = input;
    if (!isValidGapCause(given.cause)) {
        throw new Error(`Invalid gap cause: ${given.cause} (expected one of ${GAP_CAUSES.join(', ')})`);
    }
    const note = String(given.note || '').trim();
    if (!note) {
        throw new Error('A gap cause must be documented — an undocumented cause is an intent '
            + 'inference, and intent is not adjudicated (§3.4)');
    }
    const evidence = cleanVerdictEvidence(given.evidence, 'gap.evidence');

    let constraintRef = null;
    if (given.cause === 'constraint') {
        constraintRef = String(given.constraint_ref || '').trim();
        if (!constraintRef) {
            throw new Error('A constraint cause needs constraint_ref — the constraint is evidence, '
                + 'not an excuse, and must clear the same corroboration bar (§3.4)');
        }
        const constraint = await TruthAdjudicationModel.get(constraintRef);
        if (!constraint) throw new Error(`Constraint proposition not found: ${constraintRef}`);
        if (integrityRole(constraint) !== 'deed') {
            throw new Error(`constraint_ref ${constraintRef} must be a corroborated action-fact `
                + `(an enacted event/state-fact proposition)`);
        }
    } else if (given.constraint_ref) {
        throw new Error('constraint_ref only accompanies a constraint cause');
    }

    // For a revision cause: the 30055 revision/* edge or 30062 finding
    // this composes (disclosed revision is credit; undisclosed reversal
    // is already a forensic walks-back/narrative-patch — composed in,
    // not re-invented). A reference, possibly foreign — not resolved.
    const revisionRef = given.revision_ref ? String(given.revision_ref) : null;

    return {
        cause:          given.cause,
        note,
        evidence,
        constraint_ref: constraintRef,
        revision_ref:   revisionRef
    };
}

// ------------------------------------------------------------------
// CRUD
// ------------------------------------------------------------------

export const IntegrityModel = {
    get: async (id) => {
        if (!id) return null;
        const all = await Storage.get(FINDINGS_KEY, {});
        return all[id] || null;
    },

    /** Every finding, oldest first. */
    list: async () => {
        const all = await Storage.get(FINDINGS_KEY, {});
        const out = Object.values(all);
        out.sort((a, b) => (a.created || 0) - (b.created || 0));
        return out;
    },

    /** The supersession chain for one word proposition, oldest first. */
    getForWordProposition: async (wordPropositionId) => {
        if (!wordPropositionId) return [];
        const all = await Storage.get(FINDINGS_KEY, {});
        const out = Object.values(all).filter((f) => f.word_proposition_id === wordPropositionId);
        out.sort((a, b) => (a.created || 0) - (b.created || 0));
        return out;
    },

    /** Every finding whose subjects include the entity. */
    getForEntity: async (entityId) => {
        if (!entityId) return [];
        const all = await Storage.get(FINDINGS_KEY, {});
        const out = Object.values(all).filter(
            (f) => Array.isArray(f.entity_ids) && f.entity_ids.includes(entityId));
        out.sort((a, b) => (a.created || 0) - (b.created || 0));
        return out;
    },

    /**
     * Adjudicate a word-deed match. Required: `word_proposition_id`
     * (a stated commitment/value), `deed_proposition_ids` (enacted
     * action-facts about the same entity), `match` (valid FOR the
     * word class), evidence adequate to the match, and `caveats`.
     * Optional: `gap` (broken/contradicted only, documented),
     * `standard_of_proof` (defaults per word class — reputationally
     * heavy, so clear-and-convincing), `supersedes` (append-only
     * chain). Idempotent on (word, deeds, supersedes).
     */
    create: async (fields) => {
        const given = fields || {};

        const word = await resolveWordSide(given.word_proposition_id);
        const deeds = await resolveDeedSide(given.deed_proposition_ids);
        const entityIds = await resolveSharedEntities(word, deeds);

        const match = given.match;
        if (!isValidMatchForWordClass(match, word.proposition_class)) {
            throw new Error(`Invalid match '${match}' for a ${word.proposition_class} — expected one of `
                + `${matchStatesForWordClass(word.proposition_class).join(', ')} `
                + `(of ${INTEGRITY_MATCH_STATES.join(', ')})`);
        }

        const standard = given.standard_of_proof === undefined || given.standard_of_proof === null
            ? defaultStandardOfProof(word.proposition_class)
            : given.standard_of_proof;
        if (!isValidStandardOfProof(standard)) {
            throw new Error(`Invalid standard_of_proof: ${standard} (expected one of ${STANDARDS_OF_PROOF.join(', ')})`);
        }

        const evidenceFor = cleanVerdictEvidence(given.evidence_for, 'evidence_for');
        const evidenceAgainst = cleanVerdictEvidence(given.evidence_against, 'evidence_against');
        assertMatchEvidenceAdequacy(match, evidenceFor, evidenceAgainst);
        const caveats = cleanCaveats(given.caveats);
        const gap = await cleanGap(given.gap, match);

        const suggestedBy = given.suggested_by === undefined || given.suggested_by === null
            ? 'user' : given.suggested_by;
        if (!isValidSuggestedBy(suggestedBy)) {
            throw new Error(`Invalid suggested_by: ${suggestedBy} (expected 'user' or 'llm:<model>')`);
        }

        const deedIds = deeds.map((d) => d.id);
        const supersedes = given.supersedes ? String(given.supersedes) : null;
        const all = await Storage.get(FINDINGS_KEY, {});
        const id = await generateIntegrityFindingId(word.id, deedIds, supersedes);
        if (all[id]) return all[id];   // idempotent per chain position

        if (supersedes) {
            const prev = all[supersedes];
            if (!prev) throw new Error(`Cannot supersede a missing finding: ${supersedes}`);
            if (prev.word_proposition_id !== word.id) {
                throw new Error('A superseding finding must match the same word proposition as its predecessor');
            }
            if (prev.superseded_by) {
                throw new Error(`Finding ${supersedes} is already superseded by ${prev.superseded_by}`);
            }
        }

        const now = Math.floor(Date.now() / 1000);
        const record = {
            id,
            word_proposition_id:  word.id,
            deed_proposition_ids: deedIds.slice().sort(),
            entity_ids:           entityIds,
            match,
            standard_of_proof:    standard,
            evidence_for:         evidenceFor,
            evidence_against:     evidenceAgainst,
            caveats,
            gap,
            method:               String(given.method || '').trim(),
            adjudicator:          cleanAdjudicator(given.adjudicator),
            rationale:            String(given.rationale || ''),
            supersedes,
            superseded_by:        null,
            suggested_by:         suggestedBy,
            created:              now,
            updated:              now
        };
        all[id] = record;
        if (supersedes) {
            all[supersedes] = { ...all[supersedes], superseded_by: id };
        }
        await Storage.set(FINDINGS_KEY, all);
        Utils.log('Adjudicated integrity match:', id, match, 'on', word.id);
        return record;
    },

    // Deliberately NO update(): the match is a verdict (§3.4) and
    // verdicts are append-only — a changed match is a superseding
    // finding.

    /**
     * Record a successful kind-30064 publish. Not an edit — `updated`
     * is untouched. There is no markMirrored here: a 30064 has NO
     * kind-1985 mirror, by design (see truth-builders.js).
     */
    markPublished: async (id, eventId, pubkey, dTag) => {
        const all = await Storage.get(FINDINGS_KEY, {});
        const record = all[id];
        if (!record) return null;
        record.publishedAt = Math.floor(Date.now() / 1000);
        if (eventId) record.publishedEventId = eventId;
        if (pubkey)  record.publishedPubkey = pubkey;
        if (dTag)    record.publishedDTag = dTag;
        all[id] = record;
        await Storage.set(FINDINGS_KEY, all);
        return record;
    },

    /** Delete — chain head only; re-opens the predecessor. */
    delete: async (id) => {
        const all = await Storage.get(FINDINGS_KEY, {});
        const record = all[id];
        if (!record) return false;
        if (record.superseded_by) {
            throw new Error(`Finding ${id} is superseded by ${record.superseded_by} — delete the chain head first`);
        }
        if (record.supersedes && all[record.supersedes]) {
            all[record.supersedes] = { ...all[record.supersedes], superseded_by: null };
        }
        delete all[id];
        await Storage.set(FINDINGS_KEY, all);
        return true;
    },

    /**
     * The pattern-not-instance read (§3.4): an entity's ACTIVE
     * findings (chain heads) ordered on their matched deeds'
     * event-time — the integrity record as a time series. Each entry
     * carries the finding plus the earliest deed `occurred_at` /
     * `occurred_precision` it matched (null occurred_at sorts last:
     * an undated deed can't claim a place in the timeline).
     */
    timelineForEntity: async (entityId) => {
        const findings = (await IntegrityModel.getForEntity(entityId))
            .filter((f) => !f.superseded_by);
        const out = [];
        for (const finding of findings) {
            let occurredAt = null;
            let occurredPrecision = null;
            for (const deedId of finding.deed_proposition_ids) {
                const deed = await TruthAdjudicationModel.get(deedId);
                if (deed && deed.occurred_at !== null
                    && (occurredAt === null || deed.occurred_at < occurredAt)) {
                    occurredAt = deed.occurred_at;
                    occurredPrecision = deed.occurred_precision;
                }
            }
            out.push({ finding, occurred_at: occurredAt, occurred_precision: occurredPrecision });
        }
        out.sort((a, b) => {
            if (a.occurred_at === null && b.occurred_at === null) {
                return (a.finding.created || 0) - (b.finding.created || 0);
            }
            if (a.occurred_at === null) return 1;
            if (b.occurred_at === null) return -1;
            return a.occurred_at - b.occurred_at;
        });
        return out;
    }
};
