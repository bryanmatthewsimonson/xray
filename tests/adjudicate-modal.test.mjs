// Adjudicate-modal helper tests — Phase 15.8. The modal itself is DOM
// (untested here, like assess-modal/forensic-modal — house rule: no
// jsdom); these pin the PURE exports the badges and form mapping ride
// on, plus the claim-keyed lookup over real stored records.

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
    adjudicationBadgeData, renderAdjudicationBadges, adjudicationsByClaimId,
    dateInputToOccurredAt, linesToList, PROPOSITION_CLASS_ICONS,
    evidenceEntryToRecord
} = await import('../src/shared/adjudicate-modal.js');
const { TruthAdjudicationModel, VerdictModel } = await import('../src/shared/truth-adjudication-model.js');
const { ClaimModel } = await import('../src/shared/claim-model.js');
const { PROPOSITION_CLASSES } = await import('../src/shared/truth-taxonomy.js');

function resetState() { _stateStore.clear(); }

test('badges: badge data separates ruled / unruled / firewalled', () => {
    const props = [
        { id: 'p1', proposition_class: 'event-fact' },
        { id: 'p2', proposition_class: 'stated-value' },
        { id: 'p3', proposition_class: 'prediction' }
    ];
    const active = new Map([
        ['p1', { verdict: 'established-true', publishedAt: 123 }]
    ]);
    const data = adjudicationBadgeData(props, active);
    assert.equal(data.length, 3);

    const ruled = data.find((d) => d.propositionId === 'p1');
    assert.equal(ruled.state, 'established-true');
    assert.equal(ruled.stateLabel, 'Established true');
    assert.equal(ruled.adjudicable, true);
    assert.equal(ruled.published, true);

    const firewalled = data.find((d) => d.propositionId === 'p2');
    assert.equal(firewalled.adjudicable, false, 'stated-value can never carry a ruling');
    assert.equal(firewalled.state, null);

    const unruled = data.find((d) => d.propositionId === 'p3');
    assert.equal(unruled.adjudicable, true);
    assert.equal(unruled.state, null);
    assert.equal(unruled.published, false);

    assert.deepEqual(adjudicationBadgeData([], active), []);
    for (const c of PROPOSITION_CLASSES) {
        assert.ok(PROPOSITION_CLASS_ICONS[c], `${c} has a badge icon`);
    }
});

test('badges: HTML strip reflects the data (no-DOM safe)', () => {
    const html = renderAdjudicationBadges(
        [{ id: 'p1', proposition_class: 'event-fact' },
         { id: 'p2', proposition_class: 'interpretation' }],
        new Map([['p1', { verdict: 'contested' }]]));
    assert.match(html, /Contested/);
    assert.match(html, /not truth-adjudicable/);
    assert.match(html, /xr-adjudicate-badge--contested/);
    assert.match(html, /xr-adjudicate-badge--firewalled/);
    assert.equal(renderAdjudicationBadges([], new Map()), '');
});

test('lookup: adjudicationsByClaimId keys by claim and carries only ACTIVE verdicts', async () => {
    resetState();
    const claim = await ClaimModel.create({
        text: 'The senator voted against the bill.', source_url: 'https://example.com/a'
    });
    const prop = await TruthAdjudicationModel.create({
        claim_id: claim.id, proposition_class: 'event-fact',
        resolution_criteria: { criteria: 'Roll-call record.' }, subject_role: 'enacted'
    });
    const v1 = await VerdictModel.create({
        proposition_id: prop.id, verdict: 'unresolved', caveats: ['awaiting record']
    });
    const v2 = await VerdictModel.create({
        proposition_id: prop.id, supersedes: v1.id, verdict: 'established-true',
        evidence_for: [{ quote: 'Roll-call 71: Nay.' }], caveats: ['single record']
    });

    const map = await adjudicationsByClaimId();
    const entry = map.get(claim.id);
    assert.ok(entry);
    assert.equal(entry.propositions.length, 1);
    assert.equal(entry.activeVerdictByPropId.get(prop.id).id, v2.id,
        'the chain head, not the superseded ruling');
    assert.equal(map.get('claim_nonexistent0'), undefined);
});

test('form mapping: date input → occurred_at; caveat lines', () => {
    assert.equal(dateInputToOccurredAt('2021-03-03'), Date.UTC(2021, 2, 3) / 1000);
    assert.equal(dateInputToOccurredAt(''), null);
    assert.equal(dateInputToOccurredAt('yesterday'), null);
    assert.equal(dateInputToOccurredAt('2021-3-3'), null, 'strict format only');

    assert.deepEqual(linesToList('a\n\n  b  \nc\n'), ['a', 'b', 'c']);
    assert.deepEqual(linesToList(''), []);
    assert.deepEqual(linesToList(null), []);
});

// ── Grounded evidence rows (amendment 2026-07-12) ─────────────────────

test('evidenceEntryToRecord: linked claim and typed URL become refs; ungrounded stays quote-only', () => {
    assert.deepEqual(
        evidenceEntryToRecord({ quote: 'q', tier: 'tier-1', claim_ref: 'claim_0000000000000ab1', source_url: '' }),
        { quote: 'q', tier: 'tier-1', claim_ref: 'claim_0000000000000ab1' },
        'linked claim travels as claim_ref');
    assert.deepEqual(
        evidenceEntryToRecord({ quote: 'q', tier: null, claim_ref: null, source_url: '  https://src.example/a?x=1  ' }),
        { quote: 'q', tier: null, source_ref: { url: 'https://src.example/a?x=1', url_raw: 'https://src.example/a?x=1' } },
        'typed URL becomes source_ref, trimmed, verbatim in url_raw');
    assert.deepEqual(
        evidenceEntryToRecord({ quote: 'q', tier: 'tier-2', claim_ref: null, source_url: '' }),
        { quote: 'q', tier: 'tier-2' },
        'ungrounded row saves as before — no manufactured refs');
});

test('evidenceEntryToRecord output round-trips the model validator with refs intact', async () => {
    const { cleanVerdictEvidence } = await import('../src/shared/truth-adjudication-model.js');
    const cleaned = cleanVerdictEvidence([
        evidenceEntryToRecord({ quote: 'grounded', tier: 'tier-1', claim_ref: 'claim_0000000000000ab1', source_url: 'https://src.example/a' })
    ], 'evidence_for');
    assert.equal(cleaned[0].claim_ref, 'claim_0000000000000ab1');
    assert.equal(cleaned[0].source_ref.url_raw, 'https://src.example/a');
});
