// Entity integrity record tests — Phase 15.5
// (docs/TRUTH_ADJUDICATION_DESIGN.md §3.5). Load-bearing: dimensions
// stay separated (no fused score key exists anywhere), every count
// ships its entry list, unscoreable predictions are listed rather
// than dropped, and the rollup is HARD-GATED by declared coverage.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const _stateStore = new Map();
globalThis.chrome = {
    storage: {
        local: {
            get(keys, cb) {
                const out = {};
                for (const k of Array.isArray(keys) ? keys : [keys]) {
                    if (_stateStore.has(k)) out[k] = _stateStore.get(k);
                }
                cb(out);
            },
            set(obj, cb) {
                for (const [k, v] of Object.entries(obj)) _stateStore.set(k, v);
                cb && cb();
            },
            remove(keys, cb) {
                for (const k of Array.isArray(keys) ? keys : [keys]) _stateStore.delete(k);
                cb && cb();
            }
        }
    }
};

const {
    entityIntegrityRecord, entityCommitmentRecord, entityValueRecord,
    entityCalibrationRecord, entityCorrectionRecord,
    defaultCoverage, declaredCoverage, optionalRollup
} = await import('../src/shared/truth-entity-record.js');
const { TruthAdjudicationModel, VerdictModel } = await import('../src/shared/truth-adjudication-model.js');
const { IntegrityModel } = await import('../src/shared/integrity-model.js');
const { ClaimModel } = await import('../src/shared/claim-model.js');
const { ForensicModel } = await import('../src/shared/forensic-model.js');

function resetState() { _stateStore.clear(); }

const SEN = 'entity_senator1';

async function seedProp(text, cls, over = {}) {
    const claim = await ClaimModel.create({
        text, source_url: `https://example.com/${encodeURIComponent(text.slice(0, 24))}`,
        about: [SEN]
    });
    return await TruthAdjudicationModel.create({
        claim_id: claim.id,
        proposition_class: cls,
        resolution_criteria: cls === 'prediction'
            ? { criteria: 'Public record.', horizon: 'by 2028', ...(over.rc || {}) }
            : { criteria: 'Public record.' },
        subject_role: (cls === 'stated-commitment' || cls === 'stated-value') ? 'stated' : 'enacted',
        ...over.fields
    });
}

function findingEvidence() {
    return [{ quote: 'Roll-call 88: Yea.', tier: 'tier-1' }];
}

/** The shared fixture: 3 commitments, 1 value, 3 predictions, 1 deed. */
async function seedFixture() {
    resetState();
    const deed = await seedProp('Voted Yea on the sales-tax increase.', 'event-fact');

    const kept = await seedProp('I will publish my tax returns.', 'stated-commitment');
    const brokenC = await seedProp('I will vote against every new tax.', 'stated-commitment');
    const pending = await seedProp('I will hold monthly town halls.', 'stated-commitment');
    const value = await seedProp('I value fiscal restraint above all.', 'stated-value');

    const fKept = await IntegrityModel.create({
        word_proposition_id: kept.id, deed_proposition_ids: [deed.id],
        match: 'fulfilled', evidence_for: findingEvidence(),
        caveats: ['Returns published for 3 of 4 pledged years.']
    });
    const fBroken = await IntegrityModel.create({
        word_proposition_id: brokenC.id, deed_proposition_ids: [deed.id],
        match: 'broken', evidence_for: findingEvidence(),
        caveats: ['Single vote against a multi-year pledge.'],
        gap: { cause: 'revision', note: 'He publicly disclosed the reversal, citing the deficit report.' }
    });
    const fValue = await IntegrityModel.create({
        word_proposition_id: value.id, deed_proposition_ids: [deed.id],
        match: 'contradicted', evidence_for: findingEvidence(),
        caveats: ['One data point.']
    });

    // Predictions: resolved-with-hedge, resolved-without-hedge, unresolved.
    const predA = await seedProp('Unemployment will fall below 4% by 2027.', 'prediction',
        { rc: { hedge_level: 'confident' } });
    const predB = await seedProp('The bill will pass the senate.', 'prediction');
    const predC = await seedProp('Turnout will exceed 60%.', 'prediction',
        { rc: { hedge_level: 'speculative' } });

    // predA resolves true through a SUPERSEDED chain (v1 unresolved → v2 true).
    const vA1 = await VerdictModel.create({
        proposition_id: predA.id, verdict: 'unresolved',
        caveats: ['Awaiting the December BLS release.']
    });
    await VerdictModel.create({
        proposition_id: predA.id, supersedes: vA1.id, verdict: 'established-true',
        evidence_for: [{ quote: 'BLS November: 3.9%.', tier: 'tier-1' }],
        caveats: ['Seasonal adjustment revision pending.']
    });
    await VerdictModel.create({
        proposition_id: predB.id, verdict: 'established-true',
        evidence_for: [{ quote: 'Senate journal: passed 52-48.', tier: 'tier-1' }],
        caveats: ['House action still open.']
    });
    // predC: no verdict at all.

    return { deed, kept, brokenC, pending, value, fKept, fBroken, fValue, predA, predB, predC };
}

// ---------------------------------------------------------------------

test('record: commitment + value dimensions are counts AND lists, pending included', async () => {
    const fx = await seedFixture();

    const commitments = await entityCommitmentRecord(SEN);
    assert.equal(commitments.dimension, 'commitments');
    assert.equal(commitments.entries.length, 3);
    assert.deepEqual(commitments.counts, { pending: 1, fulfilled: 1, broken: 1 });
    const brokenRow = commitments.entries.find((e) => e.word_proposition_id === fx.brokenC.id);
    assert.equal(brokenRow.matches[0].finding_id, fx.fBroken.id, 'derivation: the finding is listed');
    assert.equal(brokenRow.matches[0].standard_of_proof, 'clear-and-convincing');
    const pendingRow = commitments.entries.find((e) => e.word_proposition_id === fx.pending.id);
    assert.deepEqual(pendingRow.matches, [], 'pending = listed, unadjudicated');

    const values = await entityValueRecord(SEN);
    assert.deepEqual(values.counts, { pending: 0, contradicted: 1 });
    assert.equal(values.word_class, 'stated-value');

    assert.deepEqual(await entityCommitmentRecord('entity_nobody'),
        { dimension: 'commitments', word_class: 'stated-commitment', entries: [], counts: { pending: 0 } });
});

test('record: calibration scores RESOLVED predictions only; unscoreable are listed with reasons', async () => {
    const fx = await seedFixture();
    const calibration = await entityCalibrationRecord(SEN);

    assert.equal(calibration.resolutions.length, 1, 'only predA is resolved WITH a recorded hedge');
    assert.deepEqual(
        calibration.unscoreable.sort((a, b) => a.reason.localeCompare(b.reason)),
        [
            { proposition_id: fx.predB.id, reason: 'no-hedge-recorded' },
            { proposition_id: fx.predC.id, reason: 'unresolved' }
        ]);
    const scored = calibration.resolutions[0];
    assert.equal(scored.proposition_id, fx.predA.id);
    assert.equal(scored.hedge_level, 'confident');
    assert.equal(scored.outcome, 'true', 'resolved through the ACTIVE (superseding) verdict');
    assert.equal(calibration.rate_table.confident.resolved, 1);
    assert.equal(calibration.rate_table.confident.rate, 1);
    assert.equal(calibration.summary.mean_brier, 0.01, '(0.9 − 1)² — a measurement, formula published');
    assert.equal(calibration.summary.multiplier, null, 'never activated in v1');
});

test('record: corrections count supersessions + disclosed revisions; forensic composes on request', async () => {
    const fx = await seedFixture();

    const corrections = await entityCorrectionRecord(SEN);
    assert.equal(corrections.verdict_supersessions.count, 1, 'the superseded predA ruling');
    assert.equal(corrections.finding_supersessions.count, 0);
    assert.deepEqual(corrections.disclosed_revisions.ids, [fx.fBroken.id],
        'the documented revision-gap is credit-side data, listed by id');
    assert.equal(corrections.forensic, null, 'no subject_ref, no forensic bridge');

    // Supersede a finding, and compose a forensic subject.
    await IntegrityModel.create({
        word_proposition_id: fx.brokenC.id, deed_proposition_ids: [fx.deed.id],
        supersedes: fx.fBroken.id, match: 'contested',
        evidence_for: findingEvidence(),
        evidence_against: [{ quote: 'The amended pledge exempted court-ordered levies.' }],
        caveats: ['Pledge scope disputed.']
    });
    await ForensicModel.create({
        subject_ref: { label: 'Senator Example' }, role: 'other',
        maneuver: 'defense/ad-hoc-patch',
        anchors: [{ quote: 'That pledge never covered levies.', source_ref: { url: 'https://example.com/x' } }],
        counter_note: 'The exemption may genuinely predate the vote.'
    });

    const after = await entityCorrectionRecord(SEN, { label: 'Senator Example' });
    assert.equal(after.finding_supersessions.count, 1);
    assert.equal(after.forensic.count, 1, '30062 composed in, not re-invented');
});

test('record: assembled — dimensions separated, coverage on its face, no fused score', async () => {
    await seedFixture();
    const record = await entityIntegrityRecord(SEN);

    assert.equal(record.entity_id, SEN);
    assert.equal(record.coverage.status, 'undetermined', 'the default and usual value');
    assert.deepEqual(
        Object.keys(record).sort(),
        ['calibration', 'commitments', 'corrections', 'coverage', 'entity_id', 'values']);
    // The Goodhart surface this design refuses to build:
    assert.equal('score' in record, false);
    assert.equal('rollup' in record, false, 'the rollup is a separate, gated call');
    assert.equal('integrity_score' in record, false);
});

test('rollup: hard-gated by declared coverage; a ratio with its limit on its face', async () => {
    await seedFixture();

    const undetermined = await entityIntegrityRecord(SEN);
    assert.equal(optionalRollup(undetermined), null,
        'no aggregate without published coverage (§5.4)');
    assert.equal(optionalRollup(null), null);

    const coverage = declaredCoverage({
        assessed_count: 3, universe_estimate: 12,
        method: 'all pledges in the 2024 platform document'
    });
    const declared = await entityIntegrityRecord(SEN, { coverage });
    const rollup = optionalRollup(declared);
    assert.equal(rollup.kept, 1);
    assert.equal(rollup.resolved, 2, 'fulfilled + broken only — contested/insufficient/pending are not outcomes');
    assert.equal(rollup.below_standard_excluded, 0, 'fixture matches default clear-and-convincing');
    assert.match(rollup.text, /1 of 2 resolved high-standard commitments kept/);
    assert.match(rollup.text, /3\/12/, 'the coverage cap travels in the sentence');
    assert.match(rollup.text, /2024 platform document/, 'the method too');
    assert.equal('percentage' in rollup, false);
    assert.equal('score' in rollup, false);

    // The STANDARD gate (§6 "coverage- and standard-gated"): a
    // preponderance-grade match is excluded from the ratio and
    // reported, never silently dropped.
    const weakClaim = await ClaimModel.create({
        text: 'I will fix the potholes.', source_url: 'https://example.com/potholes', about: [SEN]
    });
    const weakWord = await TruthAdjudicationModel.create({
        claim_id: weakClaim.id, proposition_class: 'stated-commitment',
        resolution_criteria: { criteria: 'City works records.' }, subject_role: 'stated'
    });
    const deedClaim = await ClaimModel.create({
        text: 'Potholes on Main St repaired.', source_url: 'https://example.com/works', about: [SEN]
    });
    const weakDeed = await TruthAdjudicationModel.create({
        claim_id: deedClaim.id, proposition_class: 'event-fact',
        resolution_criteria: { criteria: 'City works records.' }, subject_role: 'enacted'
    });
    await IntegrityModel.create({
        word_proposition_id: weakWord.id, deed_proposition_ids: [weakDeed.id],
        match: 'fulfilled', standard_of_proof: 'preponderance',
        evidence_for: [{ quote: 'Works log 2025-04-01.' }],
        caveats: ['Single municipal record.']
    });
    const withWeak = optionalRollup(await entityIntegrityRecord(SEN, { coverage }));
    assert.equal(withWeak.kept, 1, 'the preponderance fulfilled does NOT count');
    assert.equal(withWeak.resolved, 2);
    assert.equal(withWeak.below_standard_excluded, 1);
    assert.match(withWeak.text, /1 below-standard excluded/);

    // Coverage is a measurement — undefended inputs are rejected.
    assert.throws(() => declaredCoverage({ assessed_count: -1, universe_estimate: 5, method: 'x' }),
        /non-negative integer/);
    assert.throws(() => declaredCoverage({ assessed_count: 6, universe_estimate: 5, method: 'x' }),
        /universe_estimate/);
    assert.throws(() => declaredCoverage({ assessed_count: 3, universe_estimate: 12, method: '  ' }),
        /method is required/);
    assert.equal(defaultCoverage().status, 'undetermined');
});
