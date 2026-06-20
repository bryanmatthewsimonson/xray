// LLM-assist proposal-layer tests — Phase 14.5
// (docs/PHASE_14_5_LLM_ASSIST_KICKOFF.md).
//
// Pure validators + quote→anchor resolution + the create()-input
// mapping, plus an end-to-end "mock client" pass: a canned proposal set
// (no network) is funnelled through the real capture models, proving
// every accepted artifact lands tagged `suggested_by: 'llm:<model>'`,
// and that the no-verdict / counter-note discipline holds for findings.
//
// Same chrome.storage.local shim pattern as forensic-model.test.mjs.

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

const P = await import('../src/shared/llm-proposals.js');
const { buildSuggestTool, buildSystemPrompt, resolveModel, DEFAULT_LLM_MODEL } =
    await import('../src/shared/llm-prompts.js');
const { extractProposals } = await import('../src/shared/llm-client.js');
const { EntityModel } = await import('../src/shared/entity-model.js');
const { ClaimModel } = await import('../src/shared/claim-model.js');
const { AssessmentModel } = await import('../src/shared/assessment-model.js');
const { EvidenceLinker } = await import('../src/shared/evidence-linker.js');
const { ForensicModel, ForensicBaseline } = await import('../src/shared/forensic-model.js');

function reset() { _stateStore.clear(); }

const MODEL = 'claude-opus-4-8';
const SUGGESTED_BY = `llm:${MODEL}`;
const URL = 'https://example.com/article';

// An article body that contains every quote verbatim, so anchoring
// resolves. The mock "LLM response" quotes from exactly this text.
const ARTICLE_TEXT = [
    'Jacob Hansen spoke at length about the controversy.',
    '"I care about the truth, not what the church says," he insisted.',
    'Later he added, "It does not matter whether it happened — it bears good fruit."',
    'The Church declined to comment.'
].join('\n');

// The canned tool output — this stands in for a live API call.
function mockProposals() {
    return [
        { kind: 'entity', ref: 'E1', name: 'Jacob Hansen', entity_type: 'person' },
        { kind: 'entity', ref: 'E2', name: 'The Church', entity_type: 'organization' },
        {
            kind: 'claim', ref: 'C1',
            text: 'Hansen cares about truth over institutional approval.',
            quote: '"I care about the truth, not what the church says," he insisted.',
            about: ['E1', 'E2'], is_key: true
        },
        {
            kind: 'claim', ref: 'C2',
            text: 'Whether the event happened does not matter, only its fruits.',
            quote: 'It does not matter whether it happened — it bears good fruit.',
            about: ['E1']
        },
        {
            kind: 'assessment', claim_ref: 'C2', stance: -1,
            labels: [{ label: 'misleading', quote: 'it bears good fruit' }],
            rationale: 'Swaps a truth question for a utility one.'
        },
        {
            kind: 'relationship', source_claim_ref: 'C1', target_claim_ref: 'C2',
            relationship: 'contradicts', note: 'Truth-first vs utility-first.'
        },
        {
            kind: 'revision', source_claim_ref: 'C1', target_claim_ref: 'C2',
            relationship: 'walks-back', note: 'Retreats from the truth framing.'
        },
        {
            kind: 'finding', subject_ref: 'E1', role: 'apologist',
            maneuver: 'defense/usefulness-pivot', basis: 'quoted',
            note: 'Shifts is-it-true to is-it-useful.',
            counter_note: 'He may be conceding utility alongside, not instead of, the truth claim.',
            anchors: [{ quote: 'It does not matter whether it happened — it bears good fruit.' }]
        },
        {
            kind: 'baseline', subject_ref: 'E1',
            note: 'Speaks in measured, rhetorical register throughout.'
        }
    ];
}

// ---------------------------------------------------------------------
// normalizeProposals
// ---------------------------------------------------------------------

test('normalizeProposals: groups by kind, tracks refs + labels', () => {
    const n = P.normalizeProposals(mockProposals());
    assert.equal(n.byKind.entity.length, 2);
    assert.equal(n.byKind.claim.length, 2);
    assert.equal(n.byKind.finding.length, 1);
    assert.ok(n.entityRefs.has('E1') && n.entityRefs.has('E2'));
    assert.ok(n.claimRefs.has('C1') && n.claimRefs.has('C2'));
    assert.equal(n.entityLabelByRef.E1, 'Jacob Hansen');
    // Stable pids assigned in order.
    assert.equal(n.byKind.entity[0].pid, 'p0');
});

test('normalizeProposals: drops unknown kinds', () => {
    const n = P.normalizeProposals([{ kind: 'wormhole', ref: 'X' }, { kind: 'entity', name: 'A', entity_type: 'person' }]);
    assert.equal(n.all.length, 1);
    assert.equal(n.byKind.entity.length, 1);
});

// ---------------------------------------------------------------------
// validateProposal — accepts
// ---------------------------------------------------------------------

test('validateProposal: every kind in the canned set is valid', () => {
    const n = P.normalizeProposals(mockProposals());
    const ctx = { claimRefs: n.claimRefs, entityRefs: n.entityRefs, entityLabelByRef: n.entityLabelByRef };
    for (const item of n.all) {
        const v = P.validateProposal(item, ctx);
        assert.ok(v.ok, `${item.kind} ${item.pid} should be valid: ${v.reason || ''}`);
    }
});

// ---------------------------------------------------------------------
// validateProposal — rejects (the firewall)
// ---------------------------------------------------------------------

test('validateProposal: rejects a bad entity type', () => {
    const v = P.validateProposal({ kind: 'entity', name: 'X', entity_type: 'alien' });
    assert.equal(v.ok, false);
    assert.match(v.reason, /type/i);
});

test('validateProposal: rejects an empty claim', () => {
    const v = P.validateProposal({ kind: 'claim', text: '   ' });
    assert.equal(v.ok, false);
});

test('validateProposal: rejects an assessment with no stance and no labels', () => {
    const ctx = { claimRefs: new Set(['C1']) };
    const v = P.validateProposal({ kind: 'assessment', claim_ref: 'C1', stance: null, labels: [] }, ctx);
    assert.equal(v.ok, false);
});

test('validateProposal: rejects an assessment pointing at an unknown claim', () => {
    const v = P.validateProposal({ kind: 'assessment', claim_ref: 'CZ', stance: 1 }, { claimRefs: new Set(['C1']) });
    assert.equal(v.ok, false);
    assert.match(v.reason, /unknown claim/i);
});

test('validateProposal: rejects a relationship with a bad type or missing endpoint', () => {
    const ctx = { claimRefs: new Set(['C1', 'C2']) };
    assert.equal(P.validateProposal({ kind: 'relationship', relationship: 'rhymes-with', source_claim_ref: 'C1', target_claim_ref: 'C2' }, ctx).ok, false);
    assert.equal(P.validateProposal({ kind: 'relationship', relationship: 'contradicts', source_claim_ref: 'C1', target_claim_ref: 'CZ' }, ctx).ok, false);
    assert.equal(P.validateProposal({ kind: 'relationship', relationship: 'contradicts', source_claim_ref: 'C1', target_claim_ref: 'C1' }, ctx).ok, false);
});

test('validateProposal: a finding WITHOUT a counter-note is rejected', () => {
    const v = P.validateProposal({
        kind: 'finding', subject_label: 'X', role: 'critic',
        maneuver: 'darvo/deny', basis: 'quoted',
        anchors: [{ quote: 'something said' }], counter_note: ''
    });
    assert.equal(v.ok, false);
    assert.match(v.reason, /counter/i);
});

test('validateProposal: a finding WITHOUT a quoted anchor is rejected', () => {
    const v = P.validateProposal({
        kind: 'finding', subject_label: 'X', role: 'critic',
        maneuver: 'darvo/deny', basis: 'structural-inference',
        anchors: [{ quote: '' }], counter_note: 'maybe innocent'
    });
    assert.equal(v.ok, false);
    assert.match(v.reason, /anchor|quote/i);
});

test('validateProposal: a finding with a bad maneuver / role is rejected', () => {
    assert.equal(P.validateProposal({ kind: 'finding', subject_label: 'X', role: 'apologist', maneuver: 'Bad Maneuver!', basis: 'quoted', anchors: [{ quote: 'q' }], counter_note: 'c' }).ok, false);
    assert.equal(P.validateProposal({ kind: 'finding', subject_label: 'X', role: 'wizard', maneuver: 'darvo/deny', basis: 'quoted', anchors: [{ quote: 'q' }], counter_note: 'c' }).ok, false);
});

// ---------------------------------------------------------------------
// quote → anchor
// ---------------------------------------------------------------------

test('resolveQuoteToSelectors: verbatim match yields a prefix/suffix TextQuoteSelector', () => {
    const r = P.resolveQuoteToSelectors('I care about the truth', ARTICLE_TEXT);
    assert.equal(r.found, true);
    const tqs = r.selectors.find((s) => s.type === 'TextQuoteSelector');
    assert.ok(tqs && tqs.exact === 'I care about the truth');
    assert.ok(tqs.prefix && tqs.suffix); // surrounding context captured
});

test('resolveQuoteToSelectors: a miss still yields a quote-only selector', () => {
    const r = P.resolveQuoteToSelectors('this phrase is absent', ARTICLE_TEXT);
    assert.equal(r.found, false);
    const tqs = r.selectors.find((s) => s.type === 'TextQuoteSelector');
    assert.ok(tqs && tqs.exact === 'this phrase is absent');
    assert.ok(!tqs.prefix && !tqs.suffix);
});

test('resolveQuoteToSelectors: empty quote yields no selectors', () => {
    assert.deepEqual(P.resolveQuoteToSelectors('', ARTICLE_TEXT), { selectors: [], found: false });
});

// ---------------------------------------------------------------------
// No verdict / no intent — by construction
// ---------------------------------------------------------------------

test('tool schema + finding mapping carry no intent/score/confidence field', () => {
    const tool = buildSuggestTool();
    const props = Object.keys(tool.input_schema.properties.proposals.items.properties);
    for (const banned of ['intent', 'score', 'confidence', 'lying', 'verdict']) {
        assert.ok(!props.includes(banned), `schema must not expose "${banned}"`);
    }
    const input = P.buildFindingInput(
        { role: 'apologist', maneuver: 'darvo/deny', counter_note: 'c', anchors: [{ quote: 'q' }] },
        { articleText: ARTICLE_TEXT, sourceRef: { url: URL }, suggestedBy: SUGGESTED_BY, subjectLabel: 'X' }
    );
    for (const banned of ['intent', 'score', 'confidence', 'lying', 'verdict', 'stance']) {
        assert.ok(!(banned in input), `finding input must not carry "${banned}"`);
    }
});

// ---------------------------------------------------------------------
// extractProposals (llm-client, pure)
// ---------------------------------------------------------------------

test('extractProposals: pulls the propose_capture tool input', () => {
    const data = {
        content: [
            { type: 'text', text: 'here you go' },
            { type: 'tool_use', name: 'propose_capture', input: { proposals: [{ kind: 'entity', name: 'A', entity_type: 'person' }] } }
        ]
    };
    const out = extractProposals(data);
    assert.equal(out.length, 1);
    assert.equal(out[0].name, 'A');
});

test('extractProposals: null when no tool call present', () => {
    assert.equal(extractProposals({ content: [{ type: 'text', text: 'no tool' }] }), null);
});

// ---------------------------------------------------------------------
// prompt invariants
// ---------------------------------------------------------------------

test('system prompt embeds the maneuver guide, label taxonomy, and no-verdict discipline', () => {
    const sys = buildSystemPrompt({ task: 'all', url: URL, title: 'Test' });
    assert.match(sys, /defense\/usefulness-pivot/);          // a maneuver from the guide
    assert.match(sys, /counter-indicators/);                  // falsifiability discipline
    assert.match(sys, /misleading/);                          // an assessment label
    assert.match(sys, /never a fact verdict|never a verdict|PERSONAL/i);
    assert.match(sys, /VERBATIM/);                            // anchoring instruction
});

test('resolveModel defaults unknown ids to the latest capable model', () => {
    assert.equal(resolveModel('totally-made-up'), DEFAULT_LLM_MODEL);
    assert.equal(resolveModel('claude-sonnet-4-6'), 'claude-sonnet-4-6');
});

test('llmAssist flag defaults OFF', async () => {
    const { FLAGS_DEFAULTS } = await import('../src/shared/metadata/feature-flags.js');
    assert.equal(FLAGS_DEFAULTS.llmAssist, false);
});

test('system prompt scopes by task: findings-only embeds the guide; entities-only does not', () => {
    const findings = buildSystemPrompt({ task: 'findings' });
    assert.match(findings, /MANEUVER GUIDE/);
    const entities = buildSystemPrompt({ task: 'entities' });
    assert.doesNotMatch(entities, /MANEUVER GUIDE/);
    assert.match(entities, /people \/ organizations/i);
});

test('tool schema exposes every artifact kind', () => {
    const tool = buildSuggestTool();
    const kinds = tool.input_schema.properties.proposals.items.properties.kind.enum;
    for (const k of ['entity', 'claim', 'assessment', 'relationship', 'finding', 'baseline', 'revision']) {
        assert.ok(kinds.includes(k), `schema kind enum must include ${k}`);
    }
});

// ---------------------------------------------------------------------
// End-to-end "mock client" pass through the REAL models
// ---------------------------------------------------------------------

// Mirror the reader's dependency-ordered accept, calling the real models.
async function acceptAll(proposals) {
    const n = P.normalizeProposals(proposals);
    const entityIdByRef = {};
    const claimIdByRef = {};
    const created = { entity: [], claim: [], assessment: [], relationship: [], revision: [], finding: [], baseline: [] };

    for (const p of n.byKind.entity) {
        const e = await EntityModel.create(P.buildEntityInput(p, { suggestedBy: SUGGESTED_BY }));
        if (p.ref) entityIdByRef[p.ref] = e.id;
        created.entity.push(e);
    }
    for (const p of n.byKind.claim) {
        const c = await ClaimModel.create(P.buildClaimInput(p, { entityIdByRef, articleText: ARTICLE_TEXT, sourceUrl: URL, suggestedBy: SUGGESTED_BY }));
        if (p.ref) claimIdByRef[p.ref] = c.id;
        created.claim.push(c);
    }
    for (const p of n.byKind.assessment) {
        created.assessment.push(await AssessmentModel.create(P.buildAssessmentInput(p, { claimIdByRef, articleText: ARTICLE_TEXT, suggestedBy: SUGGESTED_BY })));
    }
    for (const p of n.byKind.relationship) {
        created.relationship.push(await EvidenceLinker.create(P.buildLinkInput(p, { claimIdByRef, suggestedBy: SUGGESTED_BY })));
    }
    for (const p of n.byKind.revision) {
        created.revision.push(await EvidenceLinker.create(P.buildLinkInput(p, { claimIdByRef, suggestedBy: SUGGESTED_BY })));
    }
    for (const p of n.byKind.finding) {
        const label = P.subjectLabelOf(p, { entityLabelByRef: n.entityLabelByRef });
        created.finding.push(await ForensicModel.create(P.buildFindingInput(p, { articleText: ARTICLE_TEXT, sourceRef: { url: URL, title: 'Test' }, suggestedBy: SUGGESTED_BY, subjectLabel: label })));
    }
    for (const p of n.byKind.baseline) {
        const label = P.subjectLabelOf(p, { entityLabelByRef: n.entityLabelByRef });
        created.baseline.push(await ForensicBaseline.create(P.buildBaselineInput(p, { sourceRef: { url: URL }, subjectLabel: label })));
    }
    return { created, entityIdByRef, claimIdByRef };
}

test('end-to-end: a canned pass creates every artifact tagged llm:<model>', async () => {
    reset();
    const { created, entityIdByRef, claimIdByRef } = await acceptAll(mockProposals());

    assert.equal(created.entity.length, 2);
    assert.equal(created.claim.length, 2);
    assert.equal(created.entity[0].suggested_by, SUGGESTED_BY);

    // Claims carry resolved about-entities + a real anchor.
    const c1 = created.claim[0];
    assert.equal(c1.suggested_by, SUGGESTED_BY);
    assert.deepEqual(c1.about.sort(), [entityIdByRef.E1, entityIdByRef.E2].sort());
    assert.ok(Array.isArray(c1.anchor) && c1.anchor.some((s) => s.type === 'TextQuoteSelector'));
    assert.equal(c1.is_key, true);

    // Assessment, relationship, revision all tagged + linked.
    assert.equal(created.assessment[0].suggested_by, SUGGESTED_BY);
    assert.equal(created.assessment[0].stance, -1);
    assert.equal(created.assessment[0].labels[0].label, 'misleading');
    assert.equal(created.relationship[0].relationship, 'contradicts');
    assert.equal(created.relationship[0].suggested_by, SUGGESTED_BY);
    assert.equal(created.revision[0].relationship, 'walks-back');

    // Finding: tagged, counter-note present, ≥1 quoted anchor, NO verdict fields.
    const f = created.finding[0];
    assert.equal(f.suggested_by, SUGGESTED_BY);
    assert.ok(f.counter_note.length > 0);
    assert.ok(f.anchors.length >= 1 && f.anchors[0].quote.length > 0);
    assert.equal(f.subject_ref.label, 'Jacob Hansen');
    for (const banned of ['intent', 'score', 'confidence', 'lying', 'verdict', 'stance']) {
        assert.ok(!(banned in f), `stored finding must not carry "${banned}"`);
    }

    // Baseline created, no score.
    assert.ok(created.baseline[0].note.length > 0);
    assert.ok(!('score' in created.baseline[0]));

    // Sanity: the claim ids the linker stored match what we created.
    assert.ok(claimIdByRef.C1 && claimIdByRef.C2);
});

test('end-to-end: a counter-note-less finding is rejected by the model firewall too', async () => {
    reset();
    const bad = P.buildFindingInput(
        { role: 'apologist', maneuver: 'darvo/deny', counter_note: '', anchors: [{ quote: 'x' }] },
        { articleText: ARTICLE_TEXT, sourceRef: { url: URL }, suggestedBy: SUGGESTED_BY, subjectLabel: 'X' }
    );
    await assert.rejects(() => ForensicModel.create(bad), /counter_note/);
});

test('end-to-end: a finding with no quoted anchor is rejected by the model firewall', async () => {
    reset();
    const bad = P.buildFindingInput(
        { role: 'apologist', maneuver: 'darvo/deny', counter_note: 'maybe ok', anchors: [] },
        { articleText: ARTICLE_TEXT, sourceRef: { url: URL }, suggestedBy: SUGGESTED_BY, subjectLabel: 'X' }
    );
    await assert.rejects(() => ForensicModel.create(bad), /anchor/);
});
