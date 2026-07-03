// Entity integrity record — Phase 15.5
// (docs/TRUTH_ADJUDICATION_DESIGN.md §3.5). DIMENSION-SEPARATED
// descriptive records are canonical; a single rollup is optional,
// lossy, and hard-gated by coverage.
//
// Everything here is DERIVED at read time from the stored models
// (the audit dossier's computed-on-open posture) — nothing is stored,
// nothing is a score. Each dimension returns its full derivation
// (the entries) next to its counts, so every number is recomputable
// by hand:
//
//   - commitments — the list of atomized stated-commitments with
//     their adjudicated matches (or `pending`). A count and a list.
//   - values      — the stated-value consistency record, same shape.
//   - calibration — Brier from RESOLVED predictions only, reusing
//     audit/calibration.js verbatim (the mean Brier is a measurement
//     with a published formula, not an estimated score). Predictions
//     with no recorded hedge or no resolving verdict are listed as
//     unscoreable, never silently dropped.
//   - corrections — retractions vs maneuvers: verdict/finding
//     supersessions, disclosed revision-gaps (credit), and — when the
//     caller supplies a forensic subject_ref — the composed 30062
//     findings.
//
// COVERAGE is published with every assembled record and CAPS it:
// default is `undetermined` ("sample, not census"), under which
// `optionalRollup` returns null — no aggregate without published
// coverage (§5.4). A declared coverage is itself a measurement
// (assessed count / universe estimate / method, all shown).

import { ClaimModel } from './claim-model.js';
import { TruthAdjudicationModel, VerdictModel } from './truth-adjudication-model.js';
import { IntegrityModel } from './integrity-model.js';
import { ForensicModel } from './forensic-model.js';
import { calibrationRateTable, calibrationV1 } from './audit/calibration.js';
import { isHighStandardOfProof } from './truth-taxonomy.js';

// ------------------------------------------------------------------
// Coverage
// ------------------------------------------------------------------

/** The default — and usual — honest state. Caps every aggregate. */
export function defaultCoverage() {
    return {
        status:   'undetermined',
        note:     'sample, not census — this record caps no aggregate because its denominator is unknown',
        fraction: null
    };
}

/**
 * A declared coverage MEASUREMENT: how much of the identifiable
 * commitment-universe was assessed, with the method on its face.
 * Throws rather than accepting a bare assertion — an undefended
 * denominator would be a back-door estimation (§6.3).
 */
export function declaredCoverage({ assessed_count, universe_estimate, method } = {}) {
    if (!Number.isInteger(assessed_count) || assessed_count < 0) {
        throw new Error('declaredCoverage: assessed_count must be a non-negative integer');
    }
    if (!Number.isInteger(universe_estimate) || universe_estimate < assessed_count || universe_estimate <= 0) {
        throw new Error('declaredCoverage: universe_estimate must be a positive integer ≥ assessed_count');
    }
    const methodNote = String(method || '').trim();
    if (!methodNote) {
        throw new Error('declaredCoverage: method is required — how the universe was bounded is part of the measurement');
    }
    return {
        status:            'declared',
        assessed_count,
        universe_estimate,
        method:            methodNote,
        fraction:          assessed_count / universe_estimate
    };
}

// ------------------------------------------------------------------
// Shared lookups
// ------------------------------------------------------------------

async function propositionsForEntity(entityId) {
    const out = [];
    for (const proposition of await TruthAdjudicationModel.list()) {
        const claim = await ClaimModel.get(proposition.claim_id);
        if (claim && Array.isArray(claim.about) && claim.about.includes(entityId)) {
            out.push(proposition);
        }
    }
    return out;
}

/**
 * One word-class dimension (commitments or values): every stated
 * word-proposition about the entity, each row carrying its ACTIVE
 * adjudicated matches — or `pending` when nobody has ruled. Counts
 * are per adjudication plus the pending words; a word with two
 * active findings (different deed sets) contributes two counted
 * adjudications, both listed. A count and a list, not a score.
 */
async function wordDimension(entityId, wordClass, dimension) {
    const words = (await propositionsForEntity(entityId)).filter(
        (p) => p.proposition_class === wordClass && p.subject_role === 'stated');
    const activeFindings = (await IntegrityModel.getForEntity(entityId))
        .filter((f) => !f.superseded_by);

    const entries = [];
    const counts = { pending: 0 };
    for (const word of words) {
        const matches = activeFindings
            .filter((f) => f.word_proposition_id === word.id)
            .map((f) => ({
                finding_id:        f.id,
                match:             f.match,
                standard_of_proof: f.standard_of_proof,
                deed_proposition_ids: f.deed_proposition_ids
            }));
        entries.push({ word_proposition_id: word.id, claim_id: word.claim_id, matches });
        if (matches.length === 0) {
            counts.pending += 1;
        } else {
            for (const m of matches) counts[m.match] = (counts[m.match] || 0) + 1;
        }
    }
    return { dimension, word_class: wordClass, entries, counts };
}

// ------------------------------------------------------------------
// The four canonical dimensions
// ------------------------------------------------------------------

export async function entityCommitmentRecord(entityId) {
    return wordDimension(entityId, 'stated-commitment', 'commitments');
}

export async function entityValueRecord(entityId) {
    return wordDimension(entityId, 'stated-value', 'values');
}

/**
 * Calibration from RESOLVED predictions only: a prediction
 * proposition resolves through its active verdict
 * (established-true/false → outcome true/false). Anything else —
 * no verdict, an honest non-resolution, or a prediction whose hedge
 * was never recorded — is listed unscoreable with its reason.
 */
export async function entityCalibrationRecord(entityId) {
    const predictions = (await propositionsForEntity(entityId))
        .filter((p) => p.proposition_class === 'prediction');

    const resolutions = [];
    const unscoreable = [];
    for (const prediction of predictions) {
        const verdict = await VerdictModel.getActiveForProposition(prediction.id);
        const resolved = verdict
            && (verdict.verdict === 'established-true' || verdict.verdict === 'established-false');
        if (!resolved) {
            unscoreable.push({ proposition_id: prediction.id, reason: 'unresolved' });
            continue;
        }
        const hedge = prediction.resolution_criteria && prediction.resolution_criteria.hedge_level;
        if (!hedge) {
            // No hedge was recorded at atomization; inventing one to
            // make the Brier computable would be an estimation.
            unscoreable.push({ proposition_id: prediction.id, reason: 'no-hedge-recorded' });
            continue;
        }
        resolutions.push({
            proposition_id: prediction.id,
            verdict_id:     verdict.id,
            hedge_level:    hedge,
            outcome:        verdict.verdict === 'established-true' ? 'true' : 'false'
        });
    }
    return {
        dimension:   'calibration',
        resolutions,
        unscoreable,
        rate_table:  calibrationRateTable(resolutions),
        summary:     calibrationV1(resolutions)
    };
}

/**
 * Correction behavior: how the record was maintained. Supersessions
 * are the retraction/refinement trail (P9 keeps them all);
 * disclosed revision-gaps are CREDIT, not penalty. Pass a forensic
 * `subjectRef` ({identity_id|pubkey|account|label}) to compose the
 * 30062 maneuver findings against the same subject — entity ids and
 * forensic subject refs are different keyspaces, so the bridge is
 * the caller's to assert.
 */
export async function entityCorrectionRecord(entityId, subjectRef = null) {
    const propositionIds = new Set((await propositionsForEntity(entityId)).map((p) => p.id));
    const supersededVerdicts = (await VerdictModel.list())
        .filter((v) => propositionIds.has(v.proposition_id) && v.superseded_by)
        .map((v) => v.id);

    const findings = await IntegrityModel.getForEntity(entityId);
    const supersededFindings = findings.filter((f) => f.superseded_by).map((f) => f.id);
    const disclosedRevisions = findings
        .filter((f) => !f.superseded_by && f.gap && f.gap.cause === 'revision')
        .map((f) => f.id);

    let forensic = null;
    if (subjectRef) {
        const forensicFindings = await ForensicModel.getForSubject(subjectRef);
        forensic = {
            count:       forensicFindings.length,
            finding_ids: forensicFindings.map((f) => f.id)
        };
    }
    return {
        dimension:             'corrections',
        verdict_supersessions: { count: supersededVerdicts.length, ids: supersededVerdicts },
        finding_supersessions: { count: supersededFindings.length, ids: supersededFindings },
        disclosed_revisions:   { count: disclosedRevisions.length, ids: disclosedRevisions },
        forensic
    };
}

// ------------------------------------------------------------------
// Assembly + the coverage-gated rollup
// ------------------------------------------------------------------

/**
 * The assembled record: the four dimensions side by side, coverage
 * on its face. There is deliberately no combined number here — the
 * dimensions are canonical and orthogonal (§3.5); fusing them is the
 * Goodhart surface this design refuses to build.
 */
export async function entityIntegrityRecord(entityId, { coverage, subjectRef } = {}) {
    return {
        entity_id:   entityId,
        coverage:    coverage || defaultCoverage(),
        commitments: await entityCommitmentRecord(entityId),
        values:      await entityValueRecord(entityId),
        calibration: await entityCalibrationRecord(entityId),
        corrections: await entityCorrectionRecord(entityId, subjectRef || null)
    };
}

/**
 * The OPTIONAL single rollup (§3.5): a transparent, lossy ratio of
 * measured commitment outcomes — "9 of 12 resolved high-standard
 * commitments kept" — gated TWICE (§6 decided defaults: "coverage-
 * and standard-gated"): undetermined coverage ⇒ null, no aggregate
 * without a published denominator (§5.4); and only matches ruled at a
 * HIGH standard (clear-and-convincing / beyond-reasonable-doubt)
 * count — preponderance-grade matches are excluded and REPORTED, not
 * silently dropped. Only fulfilled and broken are "resolved"
 * (contested/insufficient/pending are not outcomes); the output is
 * counts and a sentence with both limits on its face — never a
 * normalized 0-100 anything.
 */
export function optionalRollup(record) {
    if (!record || !record.coverage || record.coverage.status !== 'declared') return null;
    const entries = (record.commitments && record.commitments.entries) || [];
    let kept = 0;
    let resolved = 0;
    let belowStandard = 0;
    for (const entry of entries) {
        for (const m of entry.matches || []) {
            if (m.match !== 'fulfilled' && m.match !== 'broken') continue;
            if (!isHighStandardOfProof(m.standard_of_proof)) { belowStandard += 1; continue; }
            resolved += 1;
            if (m.match === 'fulfilled') kept += 1;
        }
    }
    const cov = record.coverage;
    return {
        kept,
        resolved,
        below_standard_excluded: belowStandard,
        coverage: cov,
        text: `${kept} of ${resolved} resolved high-standard commitments kept`
            + (belowStandard > 0 ? ` (${belowStandard} below-standard excluded)` : '')
            + ` — coverage ${cov.assessed_count}/${cov.universe_estimate} of the identified universe (${cov.method})`
    };
}
