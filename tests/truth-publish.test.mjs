// Truth publish-selection tests — Phase 15 publish wiring. Pure logic
// over plain fixture objects (no storage): which verdicts, verdict
// mirrors, and integrity findings are wire-ready. Load-bearing: chain
// heads only, claims-must-be-published gating, the defensive firewall,
// entity-keypair subject resolution, and the constraint-must-resolve
// rule (a finding never publishes with its discount stripped).

import { test } from 'node:test';
import assert from 'node:assert/strict';

// The import chain (assessment-publish → claim-ref → claim-model →
// storage) touches chrome.storage at module load; stub it first.
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
    selectVerdictsToPublish, selectVerdictMirrors,
    selectIntegrityFindingsToPublish,
    resolveEntitySubjectPubkey, wireEvidence
} = await import('../src/shared/truth-publish.js');

const PUB = 'a'.repeat(64);
const ENTITY_PUB = 'b'.repeat(64);
const C_PUB   = 'claim_' + '1'.repeat(16);
const C_WORD  = 'claim_' + '2'.repeat(16);
const C_DEED  = 'claim_' + '3'.repeat(16);
const C_BLOCK = 'claim_' + '4'.repeat(16);
const C_UNPUB = 'claim_' + '5'.repeat(16);
const canon = (ref) => ref;   // identity — fixtures use canonical local ids

const claims = {
    [C_PUB]:    { id: C_PUB, publishedPubkey: PUB, publishedEventId: 'ev-claim', source_url: 'https://example.com/a', about: ['entity_1'] },
    [C_WORD]:   { id: C_WORD, publishedPubkey: PUB, source_url: 'https://example.com/w', about: ['entity_1'] },
    [C_DEED]:   { id: C_DEED, publishedPubkey: PUB, source_url: 'https://example.com/d', about: ['entity_1'] },
    [C_BLOCK]:  { id: C_BLOCK, publishedPubkey: PUB, source_url: 'https://example.com/c', about: ['entity_1'] },
    [C_UNPUB]:  { id: C_UNPUB, source_url: 'https://example.com/u', about: ['entity_1'] }
};

const propositions = {
    prop_fact:   { id: 'prop_fact', claim_id: C_PUB, proposition_class: 'event-fact', subject_role: 'enacted', occurred_at: 1614729600, occurred_precision: 'day', resolution_criteria: { criteria: 'x' } },
    prop_unpub:  { id: 'prop_unpub', claim_id: C_UNPUB, proposition_class: 'event-fact', subject_role: 'enacted', resolution_criteria: { criteria: 'x' } },
    prop_value:  { id: 'prop_value', claim_id: C_PUB, proposition_class: 'stated-value', subject_role: 'stated', resolution_criteria: { criteria: 'x' } },
    prop_word:   { id: 'prop_word', claim_id: C_WORD, proposition_class: 'stated-commitment', subject_role: 'stated', occurred_at: 1600000000, occurred_precision: 'day', resolution_criteria: { criteria: 'x' } },
    prop_deed:   { id: 'prop_deed', claim_id: C_DEED, proposition_class: 'event-fact', subject_role: 'enacted', occurred_at: 1614729600, occurred_precision: 'day', resolution_criteria: { criteria: 'x' } },
    prop_block:  { id: 'prop_block', claim_id: C_BLOCK, proposition_class: 'state-fact', subject_role: 'enacted', resolution_criteria: { criteria: 'x' } },
    prop_deed_u: { id: 'prop_deed_u', claim_id: C_UNPUB, proposition_class: 'event-fact', subject_role: 'enacted', resolution_criteria: { criteria: 'x' } }
};

const entities = {
    entity_1: { id: 'entity_1', keypair: { pubkey: ENTITY_PUB } },
    entity_nokey: { id: 'entity_nokey' }
};

function verdict(id, over = {}) {
    return {
        id, proposition_id: 'prop_fact', verdict: 'established-true',
        standard_of_proof: 'preponderance',
        evidence_for: [{ quote: 'q', tier: 'tier-1', claim_ref: null, source_ref: { url: 'https://example.com/a', url_raw: 'https://example.com/a?utm=1' }, note: '' }],
        evidence_against: [], caveats: ['c'], supersedes: null, superseded_by: null,
        created: 100, updated: 100, ...over
    };
}

function finding(id, over = {}) {
    return {
        id, word_proposition_id: 'prop_word', deed_proposition_ids: ['prop_deed'],
        entity_ids: ['entity_1'], match: 'broken', standard_of_proof: 'clear-and-convincing',
        evidence_for: [{ quote: 'q', tier: null, claim_ref: null, source_ref: null, note: '' }],
        evidence_against: [], caveats: ['c'], gap: null,
        supersedes: null, superseded_by: null, created: 100, updated: 100, ...over
    };
}

// ---------------------------------------------------------------------

test('publish: verdict selection — heads, staleness, published-claim gate, firewall', () => {
    const verdicts = {
        v_ready:      verdict('v_ready'),
        v_fresh:      verdict('v_fresh', { publishedAt: 200 }),                        // not stale
        v_stale_pub:  verdict('v_stale_pub', { publishedAt: 50, updated: 100 }),       // republishes
        v_superseded: verdict('v_superseded', { superseded_by: 'v_head' }),
        v_head:       verdict('v_head', { supersedes: 'v_superseded', created: 150 }),
        v_unpub:      verdict('v_unpub', { proposition_id: 'prop_unpub' }),            // claim unpublished
        v_value:      verdict('v_value', { proposition_id: 'prop_value' }),            // firewall, defensive
        v_orphan:     verdict('v_orphan', { proposition_id: 'prop_missing' })
    };
    const sel = selectVerdictsToPublish({ verdicts, propositions, claims, canon });
    assert.deepEqual(sel.map((s) => s.verdict.id).sort(),
        ['v_head', 'v_ready', 'v_stale_pub']);
    const ready = sel.find((s) => s.verdict.id === 'v_ready');
    assert.equal(ready.coord, `30040:${PUB}:${C_PUB}`);
    assert.equal(ready.url, 'https://example.com/a');
    assert.equal(ready.supersedesEventId, null);
});

test('publish: a superseding head threads its predecessor\'s published event id', () => {
    const verdicts = {
        v_old: verdict('v_old', { superseded_by: 'v_new', publishedAt: 90, publishedEventId: 'ev-old' }),
        v_new: verdict('v_new', { supersedes: 'v_old', created: 150 })
    };
    const sel = selectVerdictsToPublish({ verdicts, propositions, claims, canon });
    assert.deepEqual(sel.map((s) => s.verdict.id), ['v_new'], 'the superseded ruling never re-emits');
    assert.equal(sel[0].supersedesEventId, 'ev-old');

    // Predecessor never published (local-only supersession) → null, still publishes.
    const verdicts2 = {
        v_old: verdict('v_old', { superseded_by: 'v_new' }),
        v_new: verdict('v_new', { supersedes: 'v_old', created: 150 })
    };
    assert.equal(selectVerdictsToPublish({ verdicts: verdicts2, propositions, claims, canon })[0].supersedesEventId, null);
});

test('publish: mirror selection is keyed on mirroredAt', () => {
    const verdicts = {
        v_unmirrored: verdict('v_unmirrored', { publishedAt: 200 }),   // published + fresh, mirror still due
        v_mirrored:   verdict('v_mirrored', { mirroredAt: 150 }),
        v_superseded: verdict('v_superseded', { superseded_by: 'v_x' }),
        v_unpub:      verdict('v_unpub', { proposition_id: 'prop_unpub' })
    };
    const sel = selectVerdictMirrors({ verdicts, propositions, claims, canon });
    assert.deepEqual(sel.map((s) => s.verdict.id), ['v_unmirrored']);
    assert.equal(sel[0].coord, `30040:${PUB}:${C_PUB}`);
});

test('publish: integrity selection — subject keypair, all-sides-published, ordering', () => {
    const findings = {
        f_ready:     finding('f_ready'),
        f_nokey:     finding('f_nokey', { entity_ids: ['entity_nokey'] }),
        f_missing:   finding('f_missing', { entity_ids: ['entity_gone'] }),
        f_deed_unp:  finding('f_deed_unp', { deed_proposition_ids: ['prop_deed', 'prop_deed_u'] }),
        f_fresh:     finding('f_fresh', { publishedAt: 200 }),
        f_superseded: finding('f_superseded', { superseded_by: 'f_ready' })
    };
    const sel = selectIntegrityFindingsToPublish({ findings, propositions, claims, entities, canon });
    assert.deepEqual(sel.map((s) => s.finding.id), ['f_ready']);
    const s = sel[0];
    assert.equal(s.subjectPubkey, ENTITY_PUB, 'resolved through the tagged entity keypair');
    assert.deepEqual(s.word, {
        coord: `30040:${PUB}:${C_WORD}`, class: 'stated-commitment',
        occurredAt: 1600000000, occurredPrecision: 'day'
    });
    assert.equal(s.deeds.length, 1);
    assert.equal(s.deeds[0].coord, `30040:${PUB}:${C_DEED}`);
    assert.equal(s.sourceUrl, 'https://example.com/w');

    assert.equal(resolveEntitySubjectPubkey(['entity_nokey', 'entity_1'], entities), ENTITY_PUB,
        'first KEYED entity wins');
    assert.equal(resolveEntitySubjectPubkey([], entities), null);
});

test('publish: a constraint gap must resolve or the finding waits', () => {
    const gapped = (constraintRef) => finding('f_gap', {
        match: 'broken',
        gap: { cause: 'constraint', note: 'Blocked in committee.', constraint_ref: constraintRef, revision_ref: null, evidence: [] }
    });
    const okSel = selectIntegrityFindingsToPublish({
        findings: { f_gap: gapped('prop_block') }, propositions, claims, entities, canon
    });
    assert.equal(okSel.length, 1);
    assert.equal(okSel[0].constraintCoord, `30040:${PUB}:${C_BLOCK}`);

    const waitSel = selectIntegrityFindingsToPublish({
        findings: { f_gap: gapped('prop_deed_u') }, propositions, claims, entities, canon
    });
    assert.equal(waitSel.length, 0,
        'an unpublished constraint holds the finding — never publish with the discount stripped');
});

test('publish: revision refs pass through only as 30055 coordinates', () => {
    const withRef = (revisionRef) => finding('f_rev', {
        gap: { cause: 'revision', note: 'Disclosed reversal.', constraint_ref: null, revision_ref: revisionRef, evidence: [] }
    });
    const coordRef = `30055:${PUB}:link_abc`;
    const coordSel = selectIntegrityFindingsToPublish({
        findings: { f_rev: withRef(coordRef) }, propositions, claims, entities, canon
    });
    assert.equal(coordSel[0].revisionCoord, coordRef);

    const localSel = selectIntegrityFindingsToPublish({
        findings: { f_rev: withRef('link_1234567890abcdef') }, propositions, claims, entities, canon
    });
    assert.equal(localSel.length, 1, 'the finding still publishes');
    assert.equal(localSel[0].revisionCoord, '', 'a local link id never hits the wire');
});

test('publish: wireEvidence maps local entries to the builder shape', () => {
    const mapped = wireEvidence([
        { quote: 'q1', tier: 'tier-1', claim_ref: `30040:${PUB}:claim_x`, source_ref: { url: 'https://n', url_raw: 'https://n?utm=1' }, note: '' },
        { quote: 'q2', tier: null, claim_ref: 'claim_local000000', source_ref: null, note: '' }
    ]);
    assert.deepEqual(mapped, [
        { quote: 'q1', tier: 'tier-1', url: 'https://n?utm=1', coord: `30040:${PUB}:claim_x` },
        { quote: 'q2', tier: null, url: '', coord: '' }
    ]);
    assert.deepEqual(wireEvidence(null), []);
});
