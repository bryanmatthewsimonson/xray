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
    evidenceEntryToRecord, candidateLabel
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

test('evidenceEntryToRecord: the record derives from the cited candidate, not typed text', () => {
    const rec = evidenceEntryToRecord({
        claim_ref: 'claim_0000000000000ab1', tier: 'tier-1', note: '  matches the deed  ',
        candidate: {
            ref: 'claim_0000000000000ab1', text: 'WHO said masks work',
            quote: 'masks are effective at reducing transmission',
            speaker: 'W.H.O.', url: 'https://who.example/brief',
            url_raw: 'https://who.example/brief?utm=x', origin: 'local'
        }
    });
    assert.deepEqual(rec, {
        quote: 'masks are effective at reducing transmission',
        tier: 'tier-1',
        note: 'matches the deed',
        claim_ref: 'claim_0000000000000ab1',
        source_ref: { url: 'https://who.example/brief?utm=x', url_raw: 'https://who.example/brief?utm=x' }
    }, 'quote snapshots the linked claim quote; source_ref prefers the raw url; note trims');
});

test('evidenceEntryToRecord: quote falls back to claim text; no url → no source_ref', () => {
    const rec = evidenceEntryToRecord({
        claim_ref: '30040:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:c1',
        tier: null, note: '',
        candidate: { ref: '30040:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:c1', text: 'a counter-claim', quote: '', speaker: '', url: '', url_raw: '', origin: 'assessed' }
    });
    assert.equal(rec.quote, 'a counter-claim', 'text stands in when the artifact has no verbatim quote');
    assert.equal(rec.claim_ref, '30040:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:c1');
    assert.equal('source_ref' in rec, false, 'no manufactured source_ref');
});

test('evidenceEntryToRecord output round-trips the model validator with refs intact', async () => {
    const { cleanVerdictEvidence } = await import('../src/shared/truth-adjudication-model.js');
    const cleaned = cleanVerdictEvidence([
        evidenceEntryToRecord({
            claim_ref: 'claim_0000000000000ab1', tier: 'tier-1', note: 'independent lab log',
            candidate: { ref: 'claim_0000000000000ab1', text: 't', quote: 'grounded', speaker: 'W.H.O.', url: 'https://src.example/a', url_raw: 'https://src.example/a', origin: 'local' }
        })
    ], 'evidence_for');
    assert.equal(cleaned[0].quote, 'grounded');
    assert.equal(cleaned[0].claim_ref, 'claim_0000000000000ab1');
    assert.equal(cleaned[0].source_ref.url_raw, 'https://src.example/a');
    assert.equal(cleaned[0].note, 'independent lab log');
});

test('candidateLabel renders speaker-first for quotes with a speaker', () => {
    assert.equal(
        candidateLabel({ speaker: 'W.H.O.', quote: 'masks work', text: 'ignored' }),
        'W.H.O. — “masks work”');
    assert.equal(candidateLabel({ speaker: '', quote: '', text: 'plain claim text' }),
        'plain claim text', 'no speaker → plain text; quote falls back to text');
});
