// AdjudicatedVerdict model tests — Phase 15.3
// (docs/TRUTH_ADJUDICATION_DESIGN.md §3.3). Same chrome.storage.local
// shim as truth-adjudication-model.test.mjs. The load-bearing tests
// are the firewall (no verdict on interpretation/stated-value), the
// evidence-adequacy rule, mandatory caveats, and append-only
// supersession — soften any of them and this is a different, worse
// system (§5).

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
    TruthAdjudicationModel, VerdictModel, generateVerdictId, verdictVariance
} = await import('../src/shared/truth-adjudication-model.js');
const { ClaimModel } = await import('../src/shared/claim-model.js');
const {
    VERDICT_STATES, VERDICT_STATE_LABELS, isValidVerdictState,
    STANDARDS_OF_PROOF, STANDARD_OF_PROOF_LABELS, isValidStandardOfProof,
    defaultStandardOfProof
} = await import('../src/shared/truth-taxonomy.js');

function resetState() { _stateStore.clear(); }

async function seedProposition(cls = 'event-fact', over = {}) {
    const claim = await ClaimModel.create({
        text: `Seed claim for ${cls}: the senator voted against the bill.`,
        source_url: 'https://example.com/article'
    });
    return await TruthAdjudicationModel.create({
        claim_id: claim.id,
        proposition_class: cls,
        resolution_criteria: cls === 'prediction'
            ? { criteria: 'BLS rate.', horizon: 'by 2028' }
            : { criteria: 'The official roll-call record.' },
        subject_role: cls === 'event-fact' ? 'enacted' : 'stated',
        ...over
    });
}

function evidenceFor() {
    return [{
        quote: 'Roll-call vote 71: Nay — Sen. Example.',
        tier: 'tier-1',
        source_ref: { url: 'https://congress.example.gov/roll-call/71' }
    }];
}

function evidenceAgainst() {
    return [{
        quote: 'The senator says she voted yes.',
        tier: 'tier-3',
        source_ref: { url: 'https://example.com/interview' }
    }];
}

function baseVerdict(propositionId, over = {}) {
    return {
        proposition_id: propositionId,
        verdict: 'established-true',
        evidence_for: evidenceFor(),
        caveats: ['Could not verify whether a later motion changed the recorded vote.'],
        method: 'manual record check',
        ...over
    };
}

// --- taxonomy pins -----------------------------------------------------

test('verdict taxonomy: states and standards are exhaustive; no score exists', () => {
    assert.deepEqual(VERDICT_STATES.slice().sort(), [
        'contested', 'established-false', 'established-true',
        'insufficient-evidence', 'unresolved'
    ]);
    for (const s of VERDICT_STATES) {
        assert.equal(isValidVerdictState(s), true);
        assert.ok(VERDICT_STATE_LABELS[s], `${s} has a display label`);
    }
    assert.equal(isValidVerdictState('mostly-true'), false, 'no graded truth states');
    assert.equal(isValidVerdictState(73), false, 'no numeric verdicts');

    assert.deepEqual(STANDARDS_OF_PROOF.slice(), [
        'preponderance', 'clear-and-convincing', 'beyond-reasonable-doubt'
    ]);
    for (const s of STANDARDS_OF_PROOF) {
        assert.equal(isValidStandardOfProof(s), true);
        assert.ok(STANDARD_OF_PROOF_LABELS[s]);
    }
    assert.equal(isValidStandardOfProof('vibes'), false);

    // The §6 default: reputationally-heavy utterances demand more.
    assert.equal(defaultStandardOfProof('event-fact'), 'preponderance');
    assert.equal(defaultStandardOfProof('state-fact'), 'preponderance');
    assert.equal(defaultStandardOfProof('prediction'), 'preponderance');
    assert.equal(defaultStandardOfProof('stated-commitment'), 'clear-and-convincing');
    assert.equal(defaultStandardOfProof('stated-value'), 'clear-and-convincing');
});

// --- create + the firewall ----------------------------------------------

test('verdict: create + get round-trip; declared standard defaults per class', async () => {
    resetState();
    const prop = await seedProposition('event-fact');
    const v = await VerdictModel.create(baseVerdict(prop.id));
    assert.match(v.id, /^verdict_[0-9a-f]{16}$/);
    assert.equal(v.verdict, 'established-true');
    assert.equal(v.standard_of_proof, 'preponderance', 'defaulted AND declared on the record');
    assert.equal(v.evidence_for[0].tier, 'tier-1');
    assert.equal(v.evidence_for[0].source_ref.url, 'https://congress.example.gov/roll-call/71');
    assert.equal(v.caveats.length, 1);
    assert.equal(v.supersedes, null);
    assert.equal(v.superseded_by, null);
    // No estimated anything.
    assert.equal('score' in v, false);
    assert.equal('confidence' in v, false);
    assert.equal('knowability' in v, false);
    assert.deepEqual(await VerdictModel.get(v.id), v);

    // Idempotent at the chain root.
    const again = await VerdictModel.create(baseVerdict(prop.id, { rationale: 'different' }));
    assert.equal(again.id, v.id);
    assert.equal(again.rationale, v.rationale);
});

test('verdict: THE FIREWALL — no verdict on interpretation or stated-value', async () => {
    resetState();
    const interpretation = await seedProposition('interpretation', {
        resolution_criteria: undefined
    });
    await assert.rejects(() => VerdictModel.create(baseVerdict(interpretation.id)),
        /not adjudicable as true\/false/);

    const value = await seedProposition('stated-value');
    await assert.rejects(() => VerdictModel.create(baseVerdict(value.id)),
        /not adjudicable as true\/false/);

    // The adjudicable classes all pass the gate.
    for (const cls of ['event-fact', 'state-fact', 'prediction', 'stated-commitment']) {
        const p = await seedProposition(cls);
        const v = await VerdictModel.create(baseVerdict(p.id));
        assert.equal(v.proposition_id, p.id);
    }

    await assert.rejects(() => VerdictModel.create(baseVerdict('prop_missing')),
        /Proposition not found/);
});

test('verdict: evidence adequacy per state; caveats are mandatory', async () => {
    resetState();
    const prop = await seedProposition('event-fact');

    await assert.rejects(() => VerdictModel.create(baseVerdict(prop.id, { evidence_for: [] })),
        /needs evidence_for/);
    await assert.rejects(() => VerdictModel.create(baseVerdict(prop.id, {
        verdict: 'established-false', evidence_for: [], evidence_against: []
    })), /needs evidence_against/);
    await assert.rejects(() => VerdictModel.create(baseVerdict(prop.id, {
        verdict: 'contested', evidence_against: []
    })), /BOTH ways/);

    await assert.rejects(() => VerdictModel.create(baseVerdict(prop.id, { caveats: [] })),
        /caveats/);
    await assert.rejects(() => VerdictModel.create(baseVerdict(prop.id, { caveats: ['   '] })),
        /caveats/);

    await assert.rejects(() => VerdictModel.create(baseVerdict(prop.id, {
        evidence_for: [{ quote: '' }]
    })), /verbatim quote/);
    await assert.rejects(() => VerdictModel.create(baseVerdict(prop.id, {
        evidence_for: [{ quote: 'x', tier: 'gold' }]
    })), /invalid evidence tier/);
    await assert.rejects(() => VerdictModel.create(baseVerdict(prop.id, { verdict: 'probably' })),
        /Invalid verdict/);
    await assert.rejects(() => VerdictModel.create(baseVerdict(prop.id, { standard_of_proof: 'gut-feel' })),
        /Invalid standard_of_proof/);

    // insufficient-evidence needs no citations — the caveat carries why.
    const honest = await VerdictModel.create(baseVerdict(prop.id, {
        verdict: 'insufficient-evidence',
        evidence_for: [],
        caveats: ['The only source is a single anonymous account; no primary record exists.']
    }));
    assert.equal(honest.verdict, 'insufficient-evidence');
});

// --- supersession (P9: append-only, never overwritten) -------------------

test('verdict: supersession chains linearly; no update method exists', async () => {
    resetState();
    const prop = await seedProposition('event-fact');
    const v1 = await VerdictModel.create(baseVerdict(prop.id, { verdict: 'insufficient-evidence', evidence_for: [] }));
    assert.equal(typeof VerdictModel.update, 'undefined', 'append-only: a change of ruling is a NEW verdict');

    const v2 = await VerdictModel.create(baseVerdict(prop.id, {
        supersedes: v1.id,
        caveats: ['Roll-call record located; earlier ruling superseded on new evidence.']
    }));
    assert.notEqual(v2.id, v1.id);
    assert.equal(v2.supersedes, v1.id);

    const v1After = await VerdictModel.get(v1.id);
    assert.equal(v1After.superseded_by, v2.id, 'pointer stamped');
    assert.equal(v1After.verdict, 'insufficient-evidence', 'old ruling never edited');

    // Linear BY CONSTRUCTION: the id keys the chain position
    // (proposition | supersedes), so a fork attempt collapses onto the
    // existing successor — idempotent return, existing ruling untouched.
    const fork = await VerdictModel.create(baseVerdict(prop.id, {
        verdict: 'established-false',
        evidence_for: [], evidence_against: evidenceAgainst(),
        supersedes: v1.id
    }));
    assert.equal(fork.id, v2.id, 'no second successor can exist');
    assert.equal(fork.verdict, v2.verdict, 'the existing ruling wins — nothing overwritten');
    assert.equal((await VerdictModel.getForProposition(prop.id)).length, 2);

    await assert.rejects(() => VerdictModel.create(baseVerdict(prop.id, { supersedes: 'verdict_missing0000' })),
        /missing verdict/);
    const other = await seedProposition('state-fact');
    await assert.rejects(() => VerdictModel.create(baseVerdict(other.id, { supersedes: v2.id })),
        /same proposition/);

    // The active ruling is the chain head; the chain reads oldest-first.
    const active = await VerdictModel.getActiveForProposition(prop.id);
    assert.equal(active.id, v2.id);
    const chain = await VerdictModel.getForProposition(prop.id);
    assert.deepEqual(chain.map((v) => v.id), [v1.id, v2.id]);
});

test('verdict: delete is head-only and re-opens the predecessor', async () => {
    resetState();
    const prop = await seedProposition('event-fact');
    const v1 = await VerdictModel.create(baseVerdict(prop.id, { verdict: 'unresolved', evidence_for: [] }));
    const v2 = await VerdictModel.create(baseVerdict(prop.id, { supersedes: v1.id }));

    await assert.rejects(() => VerdictModel.delete(v1.id), /delete the chain head first/);

    assert.equal(await VerdictModel.delete(v2.id), true);
    const reopened = await VerdictModel.get(v1.id);
    assert.equal(reopened.superseded_by, null, 'predecessor re-opened');
    assert.equal((await VerdictModel.getActiveForProposition(prop.id)).id, v1.id);
    assert.equal(await VerdictModel.delete('verdict_nope'), false);
});

test('verdict: deterministic ids key the chain position', async () => {
    const root = await generateVerdictId('prop_abc', null);
    const step = await generateVerdictId('prop_abc', 'verdict_prev');
    assert.match(root, /^verdict_[0-9a-f]{16}$/);
    assert.notEqual(root, step);
    assert.equal(root, await generateVerdictId('prop_abc', null), 'stable');
});

// --- the read-time variance surface --------------------------------------

test('variance: measured, listed, never collapsed to a number', () => {
    const result = verdictVariance([
        { verdict: 'established-true', standard_of_proof: 'preponderance' },
        { verdict: 'established-true', standard_of_proof: 'clear-and-convincing' },
        { verdict: 'contested', standard_of_proof: 'preponderance' },
        { verdict: 'not-a-state' },   // malformed input is ignored, not counted
        null
    ]);
    assert.equal(result.total, 3);
    assert.deepEqual(result.by_state, { 'established-true': 2, 'contested': 1 });
    assert.deepEqual(result.by_standard, { 'preponderance': 2, 'clear-and-convincing': 1 });
    assert.deepEqual(result.states_present, ['established-true', 'contested']);
    assert.equal(result.unanimous, false);
    // The surface carries NO consensus/average/score field.
    assert.equal('consensus' in result, false);
    assert.equal('score' in result, false);
    assert.equal('mean' in result, false);

    const agree = verdictVariance([
        { verdict: 'established-false' }, { verdict: 'established-false' }
    ]);
    assert.equal(agree.unanimous, true);
    assert.equal(verdictVariance([]).total, 0);
    assert.equal(verdictVariance([]).unanimous, false);
});

test('verdict: citations — precedents, reply refs, exposure (Slice A conformance)', async () => {
    resetState();
    const prop = await seedProposition('event-fact');
    const first = await VerdictModel.create(baseVerdict(prop.id));
    const second = await seedProposition('state-fact');
    const cited = await VerdictModel.create(baseVerdict(second.id, {
        precedents: [{ ref: first.id, weight: 'binding' }, { ref: `30063:${'a'.repeat(64)}:verdict_x` }],
        reply_refs: ['d'.repeat(64)],
        exposure: 'Former staffer for the subject.'
    }));
    assert.equal(cited.precedents.length, 2);
    assert.equal(cited.precedents[0].weight, 'binding');
    assert.equal(cited.precedents[1].weight, 'persuasive', 'unweighted defaults DOWN');
    assert.deepEqual(cited.reply_refs, ['d'.repeat(64)]);
    assert.equal(cited.exposure, 'Former staffer for the subject.');

    await assert.rejects(() => VerdictModel.create(baseVerdict(second.id, {
        supersedes: cited.id, precedents: [{ ref: '', weight: 'binding' }]
    })), /needs a ref/);
    await assert.rejects(() => VerdictModel.create(baseVerdict(second.id, {
        supersedes: cited.id, precedents: [{ ref: first.id, weight: 'decisive' }]
    })), /invalid weight/);
    await assert.rejects(() => VerdictModel.create(baseVerdict(second.id, {
        supersedes: cited.id, reply_refs: ['short']
    })), /64-hex event id/);
});

test('variance: accepts both local and parsed-wire standard spellings', () => {
    const result = verdictVariance([
        { verdict: 'established-true', standard_of_proof: 'preponderance' },   // local record
        { verdict: 'established-true', standardOfProof: 'preponderance' }      // parsed 30063
    ]);
    assert.equal(result.total, 2);
    assert.deepEqual(result.by_standard, { preponderance: 2 },
        'the read-back population counts identically to the local one');
});
