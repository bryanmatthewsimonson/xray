// Adjudicable-proposition model tests — Phase 15.1
// (docs/TRUTH_ADJUDICATION_DESIGN.md §3.1). Same chrome.storage.local
// shim pattern as forensic-model.test.mjs. The referenced claims are
// real ClaimModel records — the missing-claim rejection is the
// atomization gate's first tooth.

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
    TruthAdjudicationModel, generatePropositionId, HORIZON_ALREADY_DETERMINABLE
} = await import('../src/shared/truth-adjudication-model.js');
const { ClaimModel } = await import('../src/shared/claim-model.js');

function resetState() { _stateStore.clear(); }

async function seedClaim(text = 'The senator voted against the bill on March 3.') {
    return await ClaimModel.create({
        text,
        source_url: 'https://example.com/article',
        about: ['entity_abc123']
    });
}

function baseProposition(claimId, over = {}) {
    return {
        claim_id: claimId,
        proposition_class: 'event-fact',
        resolution_criteria: {
            criteria: 'The official roll-call record for the March 3 vote.'
        },
        subject_role: 'enacted',
        occurred_at: 1614729600,
        occurred_precision: 'day',
        ...over
    };
}

// ---------------------------------------------------------------------

test('proposition: deterministic id — one claim, one class, one record', async () => {
    const a = await generatePropositionId('claim_1234567890abcdef', 'event-fact');
    const b = await generatePropositionId('claim_1234567890abcdef', 'prediction');
    const c = await generatePropositionId('claim_feedfacefeedface', 'event-fact');
    assert.match(a, /^prop_[0-9a-f]{16}$/);
    assert.notEqual(a, b, 'different classes derive different ids');
    assert.notEqual(a, c, 'different claims derive different ids');
    assert.equal(a, await generatePropositionId('claim_1234567890abcdef', 'event-fact'), 'stable');
});

test('proposition: create + get round-trip; no verdict/score field exists', async () => {
    resetState();
    const claim = await seedClaim();
    const p = await TruthAdjudicationModel.create(baseProposition(claim.id));
    assert.match(p.id, /^prop_[0-9a-f]{16}$/);
    assert.equal(p.claim_id, claim.id);
    assert.equal(p.proposition_class, 'event-fact');
    assert.equal(p.subject_role, 'enacted');
    assert.equal(p.resolution_criteria.criteria,
        'The official roll-call record for the March 3 vote.');
    assert.equal(p.resolution_criteria.horizon, HORIZON_ALREADY_DETERMINABLE,
        'facts default to already-determinable');
    assert.equal(p.resolution_criteria.hedge_level, null, 'no hedge recorded ⇒ null, never invented');
    assert.equal(p.resolution_criteria.tractability, 'ambiguous', 'the honest don\'t-know default');
    assert.equal(p.occurred_at, 1614729600);
    assert.equal(p.occurred_precision, 'day');
    assert.equal(p.suggested_by, 'user');

    // 15.1 stops at adjudic-ABLE: no verdict state, no score, no stance.
    assert.equal('verdict' in p, false);
    assert.equal('score' in p, false);
    assert.equal('stance' in p, false);
    assert.equal('confidence' in p, false);

    const got = await TruthAdjudicationModel.get(p.id);
    assert.deepEqual(got, p);
});

test('proposition: idempotent on (claim_id, proposition_class)', async () => {
    resetState();
    const claim = await seedClaim();
    const a = await TruthAdjudicationModel.create(baseProposition(claim.id));
    const b = await TruthAdjudicationModel.create(baseProposition(claim.id, {
        resolution_criteria: { criteria: 'different criteria, same claim + class' }
    }));
    assert.equal(a.id, b.id, 'same claim + class ⇒ same record');
    assert.equal(b.resolution_criteria.criteria, a.resolution_criteria.criteria,
        'idempotent create returns the existing record unchanged');
    assert.equal((await TruthAdjudicationModel.list()).length, 1);
});

test('proposition: the atomization gate — a missing claim is rejected, not stored', async () => {
    resetState();
    await assert.rejects(
        () => TruthAdjudicationModel.create(baseProposition('claim_doesnotexist00')),
        /Claim not found/);
    await assert.rejects(
        () => TruthAdjudicationModel.create(baseProposition('')),
        /claim_id is required/);
    assert.equal((await TruthAdjudicationModel.list()).length, 0, 'nothing silently stored');
});

test('proposition: unknown class / role / precision are rejected with clear errors', async () => {
    resetState();
    const claim = await seedClaim();
    await assert.rejects(
        () => TruthAdjudicationModel.create(baseProposition(claim.id, { proposition_class: 'vibes' })),
        /Invalid proposition_class/);
    await assert.rejects(
        () => TruthAdjudicationModel.create(baseProposition(claim.id, { subject_role: 'accused' })),
        /Invalid subject_role/);
    await assert.rejects(
        () => TruthAdjudicationModel.create(baseProposition(claim.id, { occurred_precision: 'decade' })),
        /occurred_precision/);
});

test('proposition: a prediction requires a horizon', async () => {
    resetState();
    const claim = await seedClaim('Unemployment will fall below 4% by 2027.');
    await assert.rejects(
        () => TruthAdjudicationModel.create(baseProposition(claim.id, {
            proposition_class: 'prediction',
            resolution_criteria: { criteria: 'BLS unemployment rate, any month before 2028.' },
            occurred_at: null, occurred_precision: null
        })),
        /requires a resolution horizon/);

    const ok = await TruthAdjudicationModel.create(baseProposition(claim.id, {
        proposition_class: 'prediction',
        resolution_criteria: {
            criteria: 'BLS unemployment rate, any month before 2028.',
            horizon: 'by 2027-12-31',
            horizon_iso: '2027-12-31',
            hedge_level: 'confident'
        },
        subject_role: 'stated',
        occurred_at: null, occurred_precision: null
    }));
    assert.equal(ok.resolution_criteria.horizon, 'by 2027-12-31');
    assert.equal(ok.resolution_criteria.horizon_iso, '2027-12-31');
    assert.equal(ok.resolution_criteria.hedge_level, 'confident');
});

test('proposition: criteria are required except for interpretation (the firewall class)', async () => {
    resetState();
    const claim = await seedClaim('The bill is a betrayal of the working class.');
    await assert.rejects(
        () => TruthAdjudicationModel.create(baseProposition(claim.id, {
            resolution_criteria: {}
        })),
        /criteria is required/);

    // An interpretation is recordable — the classification documents
    // WHY it is firewalled — with no resolution path required.
    const p = await TruthAdjudicationModel.create({
        claim_id: claim.id,
        proposition_class: 'interpretation'
    });
    assert.equal(p.proposition_class, 'interpretation');
    assert.equal(p.resolution_criteria.criteria, '');
    assert.equal(p.subject_role, 'unclassified', 'absence = unclassified, never defaulted');
});

test('proposition: bad hedge / tractability / horizon_iso are rejected', async () => {
    resetState();
    const claim = await seedClaim();
    await assert.rejects(
        () => TruthAdjudicationModel.create(baseProposition(claim.id, {
            resolution_criteria: { criteria: 'x', hedge_level: 'certain' }
        })),
        /Invalid hedge_level/);
    await assert.rejects(
        () => TruthAdjudicationModel.create(baseProposition(claim.id, {
            resolution_criteria: { criteria: 'x', tractability: 'easy' }
        })),
        /Invalid tractability/);
    await assert.rejects(
        () => TruthAdjudicationModel.create(baseProposition(claim.id, {
            resolution_criteria: { criteria: 'x', horizon_iso: '2027' }
        })),
        /horizon_iso/);
});

test('proposition: no false precision — occurred_at and occurred_precision travel together', async () => {
    resetState();
    const claim = await seedClaim();
    await assert.rejects(
        () => TruthAdjudicationModel.create(baseProposition(claim.id, {
            occurred_at: 1614729600, occurred_precision: null
        })),
        /no false precision/);
    await assert.rejects(
        () => TruthAdjudicationModel.create(baseProposition(claim.id, {
            occurred_at: null, occurred_precision: 'year'
        })),
        /occurred_precision without occurred_at/);
    await assert.rejects(
        () => TruthAdjudicationModel.create(baseProposition(claim.id, {
            occurred_at: 'March 1987'
        })),
        /Unix seconds/);

    const p = await TruthAdjudicationModel.create(baseProposition(claim.id, {
        occurred_at: null, occurred_precision: null
    }));
    assert.equal(p.occurred_at, null);
    assert.equal(p.occurred_precision, null);
});

test('proposition: invalid suggested_by is rejected; llm provenance is kept honest', async () => {
    resetState();
    const claim = await seedClaim();
    await assert.rejects(
        () => TruthAdjudicationModel.create(baseProposition(claim.id, { suggested_by: 'bot' })),
        /Invalid suggested_by/);
    const p = await TruthAdjudicationModel.create(
        baseProposition(claim.id, { suggested_by: 'llm:claude-x' }));
    assert.equal(p.suggested_by, 'llm:claude-x');
});

test('proposition: update patches mutable fields; claim_id + class are immutable', async () => {
    resetState();
    const claim = await seedClaim();
    const p = await TruthAdjudicationModel.create(baseProposition(claim.id));

    const patched = await TruthAdjudicationModel.update(p.id, {
        subject_role: 'unclassified',
        resolution_criteria: { criteria: 'sharper criteria', tractability: 'publicly_resolvable' }
    });
    assert.equal(patched.subject_role, 'unclassified');
    assert.equal(patched.resolution_criteria.criteria, 'sharper criteria');
    assert.equal(patched.resolution_criteria.tractability, 'publicly_resolvable');
    assert.ok(patched.updated >= p.updated);

    await assert.rejects(
        () => TruthAdjudicationModel.update(p.id, { proposition_class: 'prediction' }),
        /immutable/);
    await assert.rejects(
        () => TruthAdjudicationModel.update(p.id, { claim_id: 'claim_other' }),
        /immutable/);
    await assert.rejects(
        () => TruthAdjudicationModel.update('prop_nope', { subject_role: 'stated' }),
        /not found/);

    // Clearing the event-time clears its precision with it.
    const cleared = await TruthAdjudicationModel.update(p.id, { occurred_at: null });
    assert.equal(cleared.occurred_at, null);
    assert.equal(cleared.occurred_precision, null);
    // ...and the pairing is still enforced on update.
    await assert.rejects(
        () => TruthAdjudicationModel.update(p.id, { occurred_at: 1614729600 }),
        /no false precision/);
});

test('proposition: update revalidates criteria against the record\'s own class', async () => {
    resetState();
    const claim = await seedClaim('Unemployment will fall below 4% by 2027.');
    const p = await TruthAdjudicationModel.create(baseProposition(claim.id, {
        proposition_class: 'prediction',
        resolution_criteria: { criteria: 'BLS rate.', horizon: 'by 2028' },
        subject_role: 'stated',
        occurred_at: null, occurred_precision: null
    }));
    await assert.rejects(
        () => TruthAdjudicationModel.update(p.id, {
            resolution_criteria: { criteria: 'BLS rate.' }   // horizon dropped
        }),
        /requires a resolution horizon/);
});

test('proposition: list + getByClaim + delete', async () => {
    resetState();
    const claimA = await seedClaim('Claim A text.');
    const claimB = await seedClaim('Claim B text.');
    const p1 = await TruthAdjudicationModel.create(baseProposition(claimA.id));
    const p2 = await TruthAdjudicationModel.create(baseProposition(claimA.id, {
        proposition_class: 'state-fact'
    }));
    const p3 = await TruthAdjudicationModel.create(baseProposition(claimB.id));

    assert.equal((await TruthAdjudicationModel.list()).length, 3);
    const forA = await TruthAdjudicationModel.getByClaim(claimA.id);
    assert.deepEqual(forA.map((p) => p.id).sort(), [p1.id, p2.id].sort());
    assert.deepEqual((await TruthAdjudicationModel.getByClaim(claimB.id)).map((p) => p.id), [p3.id]);
    assert.deepEqual(await TruthAdjudicationModel.getByClaim('claim_none'), []);

    assert.equal(await TruthAdjudicationModel.delete(p1.id), true);
    assert.equal(await TruthAdjudicationModel.get(p1.id), null);
    assert.equal(await TruthAdjudicationModel.delete(p1.id), false);
    assert.equal((await TruthAdjudicationModel.list()).length, 2);
});

test('proposition: firewall predicates compose with real records', async () => {
    resetState();
    const claim = await seedClaim('I will always put constituents first.');
    const { isTruthAdjudicable, isIntegrityEligible, integrityRole } =
        await import('../src/shared/truth-taxonomy.js');

    const value = await TruthAdjudicationModel.create({
        claim_id: claim.id,
        proposition_class: 'stated-value',
        resolution_criteria: { criteria: 'The recorded town-hall statement, verbatim.' },
        subject_role: 'stated'
    });
    assert.equal(isTruthAdjudicable(value), false, 'a value is never policed as true/false');
    assert.equal(isIntegrityEligible(value), true, 'but its word-deed gap is measurable');
    assert.equal(integrityRole(value), 'word');

    const ascribed = await TruthAdjudicationModel.create({
        claim_id: claim.id,
        proposition_class: 'event-fact',
        resolution_criteria: { criteria: 'Any primary record.' },
        subject_role: 'ascribed'
    });
    assert.equal(isTruthAdjudicable(ascribed), true, 'an ascribed fact can still be true/false');
    assert.equal(isIntegrityEligible(ascribed), false,
        'but it is not theirs to be held to — excluded by construction');
});
