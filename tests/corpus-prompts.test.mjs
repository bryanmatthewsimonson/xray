// Case-synthesis prompt/tool tests — Phase 20.4. Pure: no chrome.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const CP = await import('../src/shared/corpus-prompts.js');

test('corpus-prompts: tool names + versions pinned (map/overall split)', () => {
    assert.equal(CP.MAP_TOOL_NAME, 'emit_corpus_extract');
    assert.equal(CP.REDUCE_TOOL_NAME, 'emit_case_brief');
    assert.equal(CP.CORPUS_PROMPT_VERSION, 'corpus-v3');
    // Cache-preservation invariant: MAP_PROMPT_VERSION gates the map-extract
    // cache key, so it MUST stay 'corpus-v2' unless the MAP prompt changes —
    // bumping it orphans every cached extract. A reduce-only change bumps
    // CORPUS_PROMPT_VERSION (staleness) but NOT this.
    assert.equal(CP.MAP_PROMPT_VERSION, 'corpus-v2');
    assert.notEqual(CP.MAP_PROMPT_VERSION, CP.CORPUS_PROMPT_VERSION);
});

test('corpus-prompts: the reduce prompt asks for FULL holders + all major cruxes (breadth)', () => {
    const sys = CP.buildReduceSystemPrompt({ caseName: 'Origins', scopeQuestion: 'Where?' });
    assert.match(sys, /list EVERY member article/);
    assert.match(sys, /Enumerate ALL the major cruxes/);
    assert.match(sys, /do not limit cruxes to those with a claim in the index/);
});

test('corpus-prompts: the reduce prompt AFFIRMATIVELY asks for cross-article relationship proposals (27 S.1)', () => {
    const sys = CP.buildReduceSystemPrompt({ caseName: 'Origins', scopeQuestion: 'Where?' });
    assert.match(sys, /pairs of claims from DIFFERENT articles/);
    assert.match(sys, /Propose EVERY\s+such pair/);
    assert.match(sys, /`art`\s+key/);
    assert.match(sys, /nothing you propose is applied on its own/);
    // The 20.6 discipline stays: never guess an id.
    assert.match(sys, /OMIT it rather than guessing/);
    assert.match(sys, /NEVER output a verdict, score, probability/);
});

test('corpus-prompts: NEITHER tool schema carries a numeric score/confidence field (P2)', () => {
    const banned = /score|confidence|probability|rating|grade|likelihood/i;
    const scan = (tool) => {
        const json = JSON.stringify(tool.input_schema);
        // Property KEYS must not smuggle a fused number; a value-string
        // mentioning "confidence" in a description is fine, so check keys.
        const keys = json.match(/"[^"]+":/g) || [];
        for (const k of keys) {
            const name = k.slice(1, -2);
            assert.ok(!banned.test(name), `forbidden numeric key "${name}" in ${tool.name}`);
        }
    };
    scan(CP.buildMapTool());
    scan(CP.buildReduceTool());
});

test('corpus-prompts: reduce tool exposes the brief field list', () => {
    const props = CP.buildReduceTool().input_schema.properties;
    for (const f of ['summary', 'positions', 'cruxes', 'load_bearing', 'coverage_gaps', 'proposals']) {
        assert.ok(f in props, `brief field ${f}`);
    }
    // proposals enum is the three allowed kinds.
    const kindEnum = props.proposals.items.properties.kind.enum;
    assert.deepEqual([...kindEnum].sort(), ['claim', 'is_key', 'relationship']);
});

test('corpus-prompts: map tool requires position + quote-bearing assertions', () => {
    const schema = CP.buildMapTool().input_schema;
    assert.deepEqual(schema.required, ['position']);
    const ka = schema.properties.key_assertions.items;
    assert.deepEqual(ka.required, ['quote']);
    assert.equal(ka.properties.quote.description.includes('VERBATIM'), true);
});

test('corpus-prompts: reduce system prompt points at the claims index + forbids invented ids (20.6)', () => {
    const sys = CP.buildReduceSystemPrompt({ caseName: 'C' });
    assert.match(sys, /`claims` index/);
    assert.match(sys, /never invent, abbreviate, or shorthand a claim id/);
    assert.match(sys, /Never link a\s+claim to itself/);
});

test('corpus-prompts: user prompt slices the claims digest to budget', () => {
    const big = 'x'.repeat(CP.MAX_CLAIMS_DIGEST_CHARS + 5000);
    const out = CP.buildMapUserPrompt({ memberText: 'body', memberMeta: { title: 'T', url: 'u' }, claimsDigest: big });
    assert.ok(out.includes('body'));
    // digest appended but capped.
    assert.ok(out.length < CP.MAX_CLAIMS_DIGEST_CHARS + 6000);
});
