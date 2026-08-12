// Case-synthesis prompt/tool tests — Phase 20.4. Pure: no chrome.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const CP = await import('../src/shared/corpus-prompts.js');

test('corpus-prompts: tool names + versions pinned (map/overall split)', () => {
    assert.equal(CP.MAP_TOOL_NAME, 'emit_corpus_extract');
    assert.equal(CP.REDUCE_TOOL_NAME, 'emit_case_brief');
    // Cache-preservation invariant: MAP_PROMPT_VERSION gates the map-extract
    // cache key — bumping it orphans every cached extract, so it moves only
    // on a real MAP input change. corpus-v4 was one (the claims digest left
    // the map input); corpus-v7 was one too (the CASE FRAME left — the
    // case-free, pay-once extract, MA.5); corpus-v8 (UA.1 — comprehensive
    // atomization with text + load_bearing) and corpus-v9 (UA.2 — entities
    // + about refs join the extract) were output-contract changes, so the
    // whole map re-pays once each. A reduce-only change bumps
    // CORPUS_PROMPT_VERSION (staleness) but NOT this. The versions have
    // stayed converged since v7; they may diverge again.
    assert.equal(CP.MAP_PROMPT_VERSION, 'corpus-v9');
    assert.equal(CP.CORPUS_PROMPT_VERSION, 'corpus-v9');
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
    // corpus-v8 (UA.1): every atom carries a verbatim quote, an authored
    // paraphrase, and an explicit load-bearing flag — the tool demands
    // all three (the validator stays lenient so one omission can't
    // invalidate a whole paid extract).
    assert.deepEqual(ka.required, ['quote', 'text', 'load_bearing']);
    assert.equal(ka.properties.quote.description.includes('VERBATIM'), true);
    assert.equal(ka.properties.load_bearing.type, 'boolean');
});

test('corpus-prompts: the v8 map prompt demands comprehensive atomization with selective flags (UA.1)', () => {
    const sys = CP.buildMapSystemPrompt();
    assert.match(sys, /ATOMIZE COMPREHENSIVELY/);
    assert.match(sys, /every discrete assertion/);
    // Guard rail 5's prompt half: selectivity must stay meaningful.
    assert.match(sys, /true ONLY where the article's position\s+rests/);
    assert.match(sys, /Do NOT adjudicate/);
});

test('corpus-prompts: the v9 map extracts entities with verbatim mentions and no workspace type (UA.2)', () => {
    const schema = CP.buildMapTool().input_schema;
    const ent = schema.properties.entities.items;
    assert.deepEqual(ent.required, ['ref', 'name', 'type', 'mention']);
    assert.match(ent.properties.mention.description, /VERBATIM/);
    // The workspace can never be minted from an article (CW.1) — and
    // the enum stays wire-consistent with the registry's types.
    assert.deepEqual([...ent.properties.type.enum], ['person', 'organization', 'place', 'thing']);
    assert.ok(!ent.properties.type.enum.includes('case'));
    // Atoms link to entities natively (the about refs).
    const ka = schema.properties.key_assertions.items;
    assert.equal(ka.properties.about.type, 'array');
    // The prompt half: entity rules + the workspace refusal.
    const sys = CP.buildMapSystemPrompt();
    // Deliberately version-label-free prompt text: a "(corpus-vN)" tag
    // inside the prompt goes stale on every bump (and editing it then
    // IS a prompt change) — the version lives in the constants only.
    assert.ok(!/corpus-v\d/.test(sys), 'no version labels inside the live prompt text');
    assert.match(sys, /ENTITIES: list the people/);
    assert.match(sys, /`mention` is REQUIRED/);
    assert.match(sys, /never propose one/);
});

test('corpus-prompts: reduce system prompt points at the claims index + forbids invented ids (20.6)', () => {
    const sys = CP.buildReduceSystemPrompt({ caseName: 'C' });
    assert.match(sys, /`claims` index/);
    assert.match(sys, /never invent, abbreviate, or shorthand a claim id/);
    assert.match(sys, /Never link a\s+claim to itself/);
});

test('corpus-prompts: the map input is claims-blind (corpus-v4 — the stable-cache pin)', () => {
    // The claims digest must NEVER re-enter the map input: its absence
    // is what makes the extract cache key stable from capture (the
    // Pre-analyze economics). Linking is local (linkAssertionsToClaims).
    const out = CP.buildMapUserPrompt({ memberText: 'body', memberMeta: { title: 'T', url: 'u' } });
    assert.ok(out.includes('body'));
    assert.ok(!/EXISTING CLAIMS/.test(out), 'no claims digest section');
    const schemaJson = JSON.stringify(CP.buildMapTool().input_schema);
    assert.ok(!schemaJson.includes('claim_ref'), 'the map tool no longer asks the model for claim links');
    assert.ok(!/claim_ref/.test(CP.buildMapSystemPrompt()), 'no claim-linking rule in the system prompt');
});

test('corpus-prompts: the map input is CASE-blind too (corpus-v7 — the pay-once pin, MA.5)', () => {
    // The case frame must never re-enter the map input: its absence is
    // what makes one extract serve every case and entity page. Relating
    // the article to a case's question is the REDUCE's job — that
    // prompt still takes the frame.
    const sys = CP.buildMapSystemPrompt();
    assert.equal(CP.buildMapSystemPrompt.length, 0, 'the map system prompt takes NO frame');
    assert.ok(!/case corpus|The case:|question it investigates/.test(sys),
        'no case framing in the map system prompt');
    assert.match(sys, /its own central\s*\n?\s*question/, 'position is article-intrinsic');
    assert.match(sys, /VERBATIM/, 'the grounding contract survives the reframe');
    const user = CP.buildMapUserPrompt({ memberText: 'body', memberMeta: { title: 'T', url: 'u' } });
    assert.ok(!/case/i.test(user), 'no case text in the map user prompt');
    // The reduce, by contrast, IS case-framed — the frame moved, it did
    // not disappear.
    assert.match(CP.buildReduceSystemPrompt({ caseName: 'Origins', scopeQuestion: 'Where?' }),
        /"Origins"/);
});
