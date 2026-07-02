// IntegrityFinding model tests — Phase 15.4
// (docs/TRUTH_ADJUDICATION_DESIGN.md §3.4). Same chrome.storage.local
// shim as the other truth-layer tests. Load-bearing: the word/deed
// by-construction exclusions, the same-entity rule, the per-class
// match vocabulary (the value firewall), documented-only gap causes
// (intent never adjudicated), and constraint-as-evidence.

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

const { IntegrityModel, generateIntegrityFindingId } = await import('../src/shared/integrity-model.js');
const { TruthAdjudicationModel } = await import('../src/shared/truth-adjudication-model.js');
const { ClaimModel } = await import('../src/shared/claim-model.js');
const {
    INTEGRITY_MATCH_STATES, INTEGRITY_MATCH_LABELS, matchStatesForWordClass,
    isValidMatchState, isValidMatchForWordClass, GAP_CAUSES, GAP_CAUSE_LABELS, isValidGapCause
} = await import('../src/shared/truth-taxonomy.js');

function resetState() { _stateStore.clear(); }

const SEN = 'entity_senator1';

async function seedWord(cls = 'stated-commitment', over = {}) {
    const claim = await ClaimModel.create({
        text: cls === 'stated-value'
            ? 'I value fiscal restraint above all.'
            : 'I will vote against every new tax.',
        source_url: 'https://example.com/townhall',
        about: [SEN]
    });
    return await TruthAdjudicationModel.create({
        claim_id: claim.id,
        proposition_class: cls,
        resolution_criteria: { criteria: 'The recorded town-hall statement, verbatim.' },
        subject_role: 'stated',
        occurred_at: 1600000000, occurred_precision: 'day',
        ...over
    });
}

async function seedDeed(text, occurredAt = 1614729600, over = {}) {
    const claim = await ClaimModel.create({
        text,
        source_url: `https://example.com/${encodeURIComponent(text.slice(0, 24))}`,
        about: [SEN]
    });
    return await TruthAdjudicationModel.create({
        claim_id: claim.id,
        proposition_class: 'event-fact',
        resolution_criteria: { criteria: 'The official roll-call record.' },
        subject_role: 'enacted',
        occurred_at: occurredAt, occurred_precision: 'day',
        ...over
    });
}

function baseFinding(wordId, deedIds, over = {}) {
    return {
        word_proposition_id: wordId,
        deed_proposition_ids: deedIds,
        match: 'broken',
        evidence_for: [{
            quote: 'Roll-call 88: Yea on the sales-tax increase.',
            tier: 'tier-1',
            source_ref: { url: 'https://congress.example.gov/roll-call/88' }
        }],
        caveats: ['Single vote against a multi-year pledge — pattern needs more instances.'],
        ...over
    };
}

// --- taxonomy pins -----------------------------------------------------

test('integrity taxonomy: match states + per-class vocabulary (the value firewall)', () => {
    assert.deepEqual(INTEGRITY_MATCH_STATES.slice().sort(), [
        'broken', 'consistent', 'contested', 'contradicted',
        'fulfilled', 'insufficient', 'unrelated'
    ]);
    for (const m of INTEGRITY_MATCH_STATES) {
        assert.equal(isValidMatchState(m), true);
        assert.ok(INTEGRITY_MATCH_LABELS[m], `${m} has a display label`);
    }
    assert.deepEqual(matchStatesForWordClass('stated-commitment').sort(),
        ['broken', 'contested', 'fulfilled', 'insufficient', 'unrelated']);
    assert.deepEqual(matchStatesForWordClass('stated-value').sort(),
        ['consistent', 'contested', 'contradicted', 'insufficient', 'unrelated']);
    assert.deepEqual(matchStatesForWordClass('event-fact'), [], 'facts cannot sit on the word side');

    assert.equal(isValidMatchForWordClass('broken', 'stated-commitment'), true);
    assert.equal(isValidMatchForWordClass('contradicted', 'stated-commitment'), false,
        'a promise is broken, not contradicted');
    assert.equal(isValidMatchForWordClass('fulfilled', 'stated-value'), false,
        'a value is consistent, not fulfilled');

    assert.deepEqual(GAP_CAUSES.slice().sort(),
        ['constraint', 'incapacity', 'lie', 'misattribution', 'revision']);
    for (const c of GAP_CAUSES) {
        assert.equal(isValidGapCause(c), true);
        assert.ok(GAP_CAUSE_LABELS[c]);
    }
    assert.equal(isValidGapCause('malice'), false);
});

// --- create + the by-construction gates ----------------------------------

test('integrity: create + round-trip; standard defaults clear-and-convincing; entities resolved', async () => {
    resetState();
    const word = await seedWord();
    const deed = await seedDeed('Roll-call 88: voted Yea on the sales-tax increase.');
    const f = await IntegrityModel.create(baseFinding(word.id, [deed.id]));

    assert.match(f.id, /^integrity_[0-9a-f]{16}$/);
    assert.equal(f.match, 'broken');
    assert.equal(f.standard_of_proof, 'clear-and-convincing',
        'word-side utterances are reputationally heavy — §6 default, declared on the record');
    assert.deepEqual(f.entity_ids, [SEN], 'the shared subject, derived from both sides');
    assert.deepEqual(f.deed_proposition_ids, [deed.id]);
    assert.equal(f.superseded_by, null);
    // No intent, no score.
    assert.equal('intent' in f, false);
    assert.equal('score' in f, false);
    assert.equal('confidence' in f, false);
    assert.deepEqual(await IntegrityModel.get(f.id), f);

    // Idempotent on (word, deeds, supersedes).
    const again = await IntegrityModel.create(baseFinding(word.id, [deed.id], { rationale: 'x' }));
    assert.equal(again.id, f.id);
});

test('integrity: word/deed sides are enforced by construction', async () => {
    resetState();
    const word = await seedWord();
    const deed = await seedDeed('Voted Yea on the tax.');

    // Deeds can't sit on the word side, words can't sit on the deed side.
    await assert.rejects(() => IntegrityModel.create(baseFinding(deed.id, [deed.id])),
        /cannot sit on the word side/);
    await assert.rejects(() => IntegrityModel.create(baseFinding(word.id, [word.id])),
        /cannot sit on the deed side/);

    // ascribed / unclassified are excluded even with the right class.
    const ascribed = await seedWord('stated-commitment', {
        subject_role: 'ascribed',
        claim_id: (await ClaimModel.create({
            text: 'Aides say he promised to oppose all taxes.',
            source_url: 'https://example.com/profile', about: [SEN]
        })).id
    });
    await assert.rejects(() => IntegrityModel.create(baseFinding(ascribed.id, [deed.id])),
        /excluded by construction/);

    const unclassifiedDeed = await seedDeed('Some other vote.', 1614729600, { subject_role: undefined });
    await assert.rejects(() => IntegrityModel.create(baseFinding(word.id, [unclassifiedDeed.id])),
        /cannot sit on the deed side/);

    await assert.rejects(() => IntegrityModel.create(baseFinding(word.id, [])),
        /at least one enacted action-fact/);
    await assert.rejects(() => IntegrityModel.create(baseFinding(word.id, ['prop_missing000000'])),
        /Deed proposition not found/);
});

test('integrity: words and deeds must concern the same entity', async () => {
    resetState();
    const word = await seedWord();
    // A deed about a DIFFERENT entity.
    const otherClaim = await ClaimModel.create({
        text: 'The governor signed the tax bill.',
        source_url: 'https://example.com/governor', about: ['entity_governor9']
    });
    const otherDeed = await TruthAdjudicationModel.create({
        claim_id: otherClaim.id, proposition_class: 'event-fact',
        resolution_criteria: { criteria: 'The signing record.' }, subject_role: 'enacted'
    });
    await assert.rejects(() => IntegrityModel.create(baseFinding(word.id, [otherDeed.id])),
        /same entity/);

    // A word claim with no about-entity at all.
    const bareClaim = await ClaimModel.create({
        text: 'I will never raise taxes, says someone.',
        source_url: 'https://example.com/bare'
    });
    const bareWord = await TruthAdjudicationModel.create({
        claim_id: bareClaim.id, proposition_class: 'stated-commitment',
        resolution_criteria: { criteria: 'The recording.' }, subject_role: 'stated'
    });
    const deed = await seedDeed('Voted Yea.');
    await assert.rejects(() => IntegrityModel.create(baseFinding(bareWord.id, [deed.id])),
        /no about-entity/);
});

test('integrity: match vocabulary is per word class; adequacy per match', async () => {
    resetState();
    const commitment = await seedWord('stated-commitment');
    const value = await seedWord('stated-value');
    const deed = await seedDeed('Voted Yea on the tax.');

    await assert.rejects(() => IntegrityModel.create(baseFinding(commitment.id, [deed.id], { match: 'contradicted' })),
        /Invalid match 'contradicted' for a stated-commitment/);
    await assert.rejects(() => IntegrityModel.create(baseFinding(value.id, [deed.id], { match: 'fulfilled' })),
        /Invalid match 'fulfilled' for a stated-value/);
    const consistent = await IntegrityModel.create(baseFinding(value.id, [deed.id], {
        match: 'contradicted',
        caveats: ['One data point; the stated value may bind only future votes.']
    }));
    assert.equal(consistent.match, 'contradicted', 'the value firewall: the GAP is ruled, not the value');

    await assert.rejects(() => IntegrityModel.create(baseFinding(commitment.id, [deed.id], {
        match: 'broken', evidence_for: []
    })), /needs evidence_for/);
    await assert.rejects(() => IntegrityModel.create(baseFinding(commitment.id, [deed.id], {
        match: 'contested', evidence_against: []
    })), /BOTH ways/);
    await assert.rejects(() => IntegrityModel.create(baseFinding(commitment.id, [deed.id], { caveats: [] })),
        /caveats/);

    const honest = await IntegrityModel.create(baseFinding(commitment.id, [deed.id], {
        match: 'insufficient', evidence_for: [],
        caveats: ['The pledge wording is ambiguous about local levies.']
    }));
    assert.equal(honest.match, 'insufficient');
});

// --- the gap decomposition (intent never adjudicated) ---------------------

test('integrity: gap causes must be documented; constraint is evidence, not excuse', async () => {
    resetState();
    const word = await seedWord();
    const deed = await seedDeed('Voted Yea on the tax.');
    const committeeBlock = await seedDeed('The repeal bill died in committee, 2021-03-01.', 1614556800);

    // Gap only on broken/contradicted.
    await assert.rejects(() => IntegrityModel.create(baseFinding(word.id, [deed.id], {
        match: 'fulfilled',
        gap: { cause: 'revision', note: 'n/a' }
    })), /only attaches to a broken\/contradicted match/);

    // Undocumented cause = intent inference = rejected.
    await assert.rejects(() => IntegrityModel.create(baseFinding(word.id, [deed.id], {
        gap: { cause: 'lie', note: '' }
    })), /must be documented/);
    await assert.rejects(() => IntegrityModel.create(baseFinding(word.id, [deed.id], {
        gap: { cause: 'malice', note: 'x' }
    })), /Invalid gap cause/);

    // constraint demands a corroborated action-fact ref.
    await assert.rejects(() => IntegrityModel.create(baseFinding(word.id, [deed.id], {
        gap: { cause: 'constraint', note: 'The repeal was blocked.' }
    })), /needs constraint_ref/);
    await assert.rejects(() => IntegrityModel.create(baseFinding(word.id, [deed.id], {
        gap: { cause: 'constraint', note: 'Blocked.', constraint_ref: 'prop_missing000000' }
    })), /Constraint proposition not found/);
    await assert.rejects(() => IntegrityModel.create(baseFinding(word.id, [deed.id], {
        gap: { cause: 'constraint', note: 'Blocked.', constraint_ref: word.id }
    })), /must be a corroborated action-fact/);
    await assert.rejects(() => IntegrityModel.create(baseFinding(word.id, [deed.id], {
        gap: { cause: 'revision', note: 'He announced the change.', constraint_ref: committeeBlock.id }
    })), /only accompanies a constraint cause/);

    const withConstraint = await IntegrityModel.create(baseFinding(word.id, [deed.id], {
        gap: {
            cause: 'constraint',
            note: 'The pledged repeal was blocked in committee before the vote.',
            constraint_ref: committeeBlock.id,
            evidence: [{ quote: 'Committee journal: motion tabled 9-4.', tier: 'tier-1' }]
        }
    }));
    assert.equal(withConstraint.gap.cause, 'constraint');
    assert.equal(withConstraint.gap.constraint_ref, committeeBlock.id);
    assert.equal(withConstraint.gap.evidence.length, 1);

    // Documented revision carries its composing edge ref (credit, not penalty).
    const revised = await IntegrityModel.create(baseFinding(word.id, [deed.id, committeeBlock.id], {
        gap: {
            cause: 'revision',
            note: 'He publicly disclosed the reversal citing the new deficit report.',
            revision_ref: 'link_1234567890abcdef'
        }
    }));
    assert.equal(revised.gap.revision_ref, 'link_1234567890abcdef');
});

// --- supersession + timeline ---------------------------------------------

test('integrity: append-only supersession; delete is head-only', async () => {
    resetState();
    const word = await seedWord();
    const deed = await seedDeed('Voted Yea on the tax.');
    const f1 = await IntegrityModel.create(baseFinding(word.id, [deed.id]));
    assert.equal(typeof IntegrityModel.update, 'undefined');

    const f2 = await IntegrityModel.create(baseFinding(word.id, [deed.id], {
        supersedes: f1.id,
        match: 'contested',
        evidence_against: [{ quote: 'The amended pledge exempted court-ordered levies.' }],
        caveats: ['Pledge scope disputed; awaiting the original recording.']
    }));
    assert.equal(f2.supersedes, f1.id);
    assert.equal((await IntegrityModel.get(f1.id)).superseded_by, f2.id);
    assert.equal((await IntegrityModel.get(f1.id)).match, 'broken', 'history unedited');

    await assert.rejects(() => IntegrityModel.delete(f1.id), /chain head/);
    assert.equal(await IntegrityModel.delete(f2.id), true);
    assert.equal((await IntegrityModel.get(f1.id)).superseded_by, null, 're-opened');

    const idA = await generateIntegrityFindingId('w', ['d2', 'd1'], null);
    const idB = await generateIntegrityFindingId('w', ['d1', 'd2'], null);
    assert.equal(idA, idB, 'deed order is not identity');
});

test('integrity: timelineForEntity orders on the deeds\' occurred_at (pattern, not instance)', async () => {
    resetState();
    const word = await seedWord();
    const early = await seedDeed('Voted Yea, 2021-03-03.', 1614729600);
    const late = await seedDeed('Voted Yea again, 2022-06-01.', 1654041600);
    const undated = await seedDeed('Undated attributed vote.', null,
        { occurred_at: null, occurred_precision: null });

    const fLate = await IntegrityModel.create(baseFinding(word.id, [late.id]));
    const fEarly = await IntegrityModel.create(baseFinding(word.id, [early.id, late.id]));
    const fUndated = await IntegrityModel.create(baseFinding(word.id, [undated.id]));

    const timeline = await IntegrityModel.timelineForEntity(SEN);
    assert.deepEqual(timeline.map((t) => t.finding.id), [fEarly.id, fLate.id, fUndated.id],
        'multi-deed findings sit at their EARLIEST deed; undated sorts last');
    assert.equal(timeline[0].occurred_at, 1614729600);
    assert.equal(timeline[0].occurred_precision, 'day');
    assert.equal(timeline[2].occurred_at, null);

    // Superseded findings drop out of the timeline (chain heads only).
    const f2 = await IntegrityModel.create(baseFinding(word.id, [late.id], {
        supersedes: fLate.id, match: 'unrelated', evidence_for: [],
        caveats: ['The 2022 vote was on an unrelated fee, not a tax.']
    }));
    const after = await IntegrityModel.timelineForEntity(SEN);
    assert.equal(after.find((t) => t.finding.id === fLate.id), undefined);
    assert.ok(after.find((t) => t.finding.id === f2.id));

    assert.deepEqual(await IntegrityModel.timelineForEntity('entity_nobody'), []);
    assert.equal((await IntegrityModel.getForEntity(SEN)).length, 4);
    assert.equal((await IntegrityModel.getForWordProposition(word.id)).length, 4);
});
