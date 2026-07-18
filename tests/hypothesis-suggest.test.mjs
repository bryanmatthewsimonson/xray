// Hypothesis-edge suggestion firewall tests — Phase 26 H.4
// (docs/HYPOTHESIS_MAP_DESIGN.md §3). The load-bearing invariants:
// the tool schema has NO numeric slot and no score-shaped key
// (machine-checked, the corpus-prompts.test.mjs discipline), the
// system prompt carries the both-sides requirement and the
// never-pick-a-winner rule, quotes ground against the referenced
// claim's own record (drops disclosed), ids must resolve against the
// same set the digest was built from, and the both-sides post-check
// discloses unopposed hypotheses.

import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

const {
    validateHypothesisEdges, groundEdgeQuotes, filterEdgeProposals, unopposedHypotheses
} = await import('../src/shared/hypothesis-suggest.js');
const {
    HYPOTHESIS_EDGE_TOOL_NAME, HYPOTHESIS_EDGE_PROMPT_VERSION,
    buildHypothesisEdgeTool, buildHypothesisEdgeSystemPrompt, buildHypothesisEdgeUserPrompt
} = await import('../src/shared/corpus-prompts.js');

const CLAIMS = {
    claim_00000000000000c1: {
        id: 'claim_00000000000000c1',
        text: 'The first cluster centered on the market.',
        quote: 'the outbreak began at the market'
    },
    claim_00000000000000c2: {
        id: 'claim_00000000000000c2',
        text: 'The database went offline in September.',
        quote: null
    }
};
const HYPS = [
    { id: 'hyp_00000000000000ab', label: 'Zoonotic', statement: 'Animal spillover.' },
    { id: 'seed:lab origin', label: 'Lab origin', statement: 'Lab origin' }
];

const edge = (over = {}) => ({
    hypothesis_id: 'hyp_00000000000000ab',
    claim_ref: 'claim_00000000000000c1',
    role: 'supports',
    quote: 'The first cluster centered on the market.',
    why: 'places the origin at the market',
    ...over
});

// ------------------------------------------------------------------
// Prompt + tool contract
// ------------------------------------------------------------------

test('hypothesis-suggest: tool name and prompt version pinned exactly', () => {
    assert.equal(HYPOTHESIS_EDGE_TOOL_NAME, 'propose_hypothesis_edges');
    assert.equal(HYPOTHESIS_EDGE_PROMPT_VERSION, 'hyp-edges-v1');
    assert.equal(buildHypothesisEdgeTool().name, HYPOTHESIS_EDGE_TOOL_NAME);
});

test('hypothesis-suggest: the tool schema has NO numeric slot and no score-shaped key (design §3.2)', () => {
    const schema = buildHypothesisEdgeTool().input_schema;
    const bannedKeys = /score|confidence|probability|rating|grade|likelihood|weight|strength/i;
    const types = [];
    const keys = [];
    const walk = (node) => {
        if (Array.isArray(node)) { node.forEach(walk); return; }
        if (node && typeof node === 'object') {
            if (typeof node.type === 'string') types.push(node.type);
            for (const [k, v] of Object.entries(node.properties || {})) { keys.push(k); walk(v); }
            walk(node.items);
        }
    };
    walk(schema);
    assert.ok(keys.length >= 5, 'sanity: the walker saw the schema keys');
    for (const k of keys) assert.doesNotMatch(k, bannedKeys, `score-shaped key "${k}"`);
    for (const t of types) {
        assert.ok(t !== 'number' && t !== 'integer', `numeric slot of type "${t}"`);
    }
});

test('hypothesis-suggest: the system prompt carries both-sides and never-pick (positive half)', () => {
    const sys = buildHypothesisEdgeSystemPrompt({ caseName: 'Origins', scopeQuestion: 'Where?' });
    assert.match(sys, /BOTH sides/);
    assert.match(sys, /NEVER declare which hypothesis is right/);
    assert.match(sys, /support one hypothesis and undermine another/);
    assert.match(sys, /VERBATIM/);
    assert.match(sys, /Never invent, abbreviate, or shorthand an id/);
});

test('hypothesis-suggest: the user prompt lists hypotheses as id — label: statement', () => {
    const p = buildHypothesisEdgeUserPrompt({ dossierDigest: '{"claims":[]}', hypotheses: HYPS });
    assert.match(p, /hyp_00000000000000ab — Zoonotic: Animal spillover\./);
    assert.match(p, /seed:lab origin — Lab origin\n/);
    assert.match(p, /DOSSIER DIGEST/);
});

// ------------------------------------------------------------------
// Validate
// ------------------------------------------------------------------

test('hypothesis-suggest: validation accepts the contract and rejects malformed input', () => {
    assert.equal(validateHypothesisEdges({ edges: [edge()] }).ok, true);
    assert.equal(validateHypothesisEdges({ edges: [] }).ok, true);
    assert.equal(validateHypothesisEdges({}).ok, false);
    assert.equal(validateHypothesisEdges({ edges: [edge({ role: 'contradicts' })] }).ok, false);
    assert.equal(validateHypothesisEdges({ edges: [edge({ quote: '' })] }).ok, false);
    assert.equal(validateHypothesisEdges({ edges: [{ hypothesis_id: 'h', claim_ref: 'c', role: 'supports' }] }).ok, false,
        'quote is required — an ungroundable edge cannot even enter');
});

// ------------------------------------------------------------------
// Ground
// ------------------------------------------------------------------

test('hypothesis-suggest: quotes ground against the claim\'s own text+quote; drops disclosed', () => {
    const res = groundEdgeQuotes([
        edge(),                                                            // exact from text
        edge({ claim_ref: 'claim_00000000000000c1', role: 'undermines',
               quote: 'the outbreak began at the market' }),               // exact from extraction quote
        edge({ quote: 'A paraphrase that appears nowhere at all.' }),      // drops
        edge({ claim_ref: 'claim_unknown0000000x' })                       // unknown → filter's job
    ], CLAIMS);
    assert.equal(res.checked, 3, 'unknown claim is not counted as a quote check');
    assert.equal(res.dropped, 1);
    assert.equal(res.edges.length, 3);
    assert.equal(res.edges[0].quote, 'The first cluster centered on the market.',
        'the claim\'s own span replaces the model\'s copy');
});

test('hypothesis-suggest: a quote straddling the text/quote boundary DROPS — no stitched span persists', () => {
    // Spans the end of claim.text and the start of claim.quote: a
    // single concatenated grounding index would match this (normalized
    // tier collapses the join) and store a "verbatim" span that appears
    // in NEITHER field. Separate indexes must drop it.
    const res = groundEdgeQuotes([
        edge({ quote: 'centered on the market. the outbreak began at the market' })
    ], CLAIMS);
    assert.equal(res.dropped, 1);
    assert.equal(res.edges.length, 0);
});

// ------------------------------------------------------------------
// Filter + both-sides
// ------------------------------------------------------------------

test('hypothesis-suggest: filter resolves every id, rejects with reasons, dedupes silently', () => {
    const existing = [{ hypothesis_id: 'hyp_00000000000000ab', ref: 'claim_00000000000000c2', role: 'supports' }];
    const { acceptable, rejected } = filterEdgeProposals([
        edge(),                                                        // ok
        edge(),                                                        // batch dup — silent
        edge({ hypothesis_id: 'seed:lab origin', role: 'undermines' }),// ok (seed target)
        edge({ hypothesis_id: 'hyp_invented000000' }),                 // unknown hypothesis
        edge({ claim_ref: 'claim_invented00000x' }),                   // unknown claim
        edge({ claim_ref: 'claim_00000000000000c2' })                  // already attached
    ], { hypotheses: HYPS, claimsById: CLAIMS, existingEdges: existing });
    assert.equal(acceptable.length, 2);
    assert.equal(rejected.length, 3);
    for (const r of rejected) assert.equal(typeof r.reason, 'string');
    assert.match(rejected.find((r) => r.hypothesis_id === 'hyp_invented000000').reason, /unknown hypothesis/);
    assert.match(rejected.find((r) => r.claim_ref === 'claim_invented00000x').reason, /unknown claim/);
    assert.match(rejected.find((r) => r.claim_ref === 'claim_00000000000000c2').reason, /already attached/);
});

test('hypothesis-suggest: unopposed hypotheses are disclosed — proposal or existing scrutiny both count', () => {
    const acceptable = [edge({ hypothesis_id: 'hyp_00000000000000ab', role: 'undermines' })];
    const existing = [];
    const un = unopposedHypotheses(HYPS, acceptable, existing);
    assert.deepEqual(un, [{ id: 'seed:lab origin', label: 'Lab origin' }]);
    const unViaExisting = unopposedHypotheses(HYPS, [], [
        { hypothesis_id: 'seed:lab origin', ref: 'claim_00000000000000c1', role: 'undermines' }
    ]);
    assert.deepEqual(unViaExisting.map((u) => u.label), ['Zoonotic']);
    assert.deepEqual(unopposedHypotheses([], [], []), []);
});
