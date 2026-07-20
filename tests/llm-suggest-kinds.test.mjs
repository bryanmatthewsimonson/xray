// LLM Suggest — per-kind defaults + scoping. Suggest IS the
// extraction pass (2026-07-20): entities/claims only. The judgment
// kinds are RETIRED here — relationships live in the cross-article
// links pass, findings in the FA.1 forensic pass, assessments in the
// assess modal — and facts are retired OUTRIGHT (2026-07-20, with the
// whole Phase 19 fact layer). These pins keep them all out.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// llm-prompts pulls entity-model transitively, which reads chrome.storage
// at module load — stub it before importing (as the other LLM tests do).
globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

const {
    SUGGEST_KINDS, SUGGEST_DEFAULT_KINDS, SUGGEST_KIND_LABELS,
    RETIRED_SUGGEST_KINDS, SUGGEST_VOCAB_MAX,
    normalizeSuggestKinds, categoryOfProposalKind, buildSystemPrompt,
    vocabularyFromRegistry
} = await import('../src/shared/llm-prompts.js');

test('Suggest is extraction-only: entities/claims selectable, everything else RETIRED', () => {
    assert.deepEqual([...SUGGEST_KINDS].sort(), ['claims', 'entities']);
    assert.deepEqual([...SUGGEST_DEFAULT_KINDS], ['entities', 'claims']);
    assert.deepEqual([...RETIRED_SUGGEST_KINDS].sort(), ['assessments', 'facts', 'findings', 'relationships']);
    for (const retired of RETIRED_SUGGEST_KINDS) {
        assert.ok(!SUGGEST_KINDS.includes(retired), `${retired} must stay retired`);
    }
});

test('normalizeSuggestKinds: absent → defaults, explicit → filtered — RETIRED kinds migrate away silently', () => {
    assert.deepEqual(normalizeSuggestKinds(undefined), ['entities', 'claims']);
    assert.deepEqual(normalizeSuggestKinds(null), ['entities', 'claims']);
    assert.deepEqual(normalizeSuggestKinds('all'), ['entities', 'claims'], 'non-array → defaults');
    assert.deepEqual(normalizeSuggestKinds([]), [], 'explicit empty is honored, not defaulted');
    // THE migration: a stored setting from before the retirements sheds
    // the retired kinds with no user action.
    assert.deepEqual(normalizeSuggestKinds(['claims', 'bogus', 'facts', 'findings', 'relationships', 'assessments']),
        ['claims']);
});

test('categoryOfProposalKind: extraction kinds map; retired proposal kinds fall to null (the filter gate)', () => {
    assert.equal(categoryOfProposalKind('entity'), 'entities');
    assert.equal(categoryOfProposalKind('claim'), 'claims');
    // A model that volunteers a retired kind anyway is filtered out.
    for (const k of ['fact', 'relationship', 'assessment', 'finding', 'baseline', 'revision', 'nope']) {
        assert.equal(categoryOfProposalKind(k), null, `${k} → null`);
    }
});

test('SUGGEST_KIND_LABELS covers every selectable kind', () => {
    assert.deepEqual(SUGGEST_KIND_LABELS.map((k) => k.kind).sort(), [...SUGGEST_KINDS].sort());
});

test('buildSystemPrompt is extraction-scoped — judgment rules can never enter the prompt', () => {
    const def = buildSystemPrompt({ tasks: ['entities', 'claims'] });
    assert.match(def, /ENTITIES/);
    assert.match(def, /CLAIMS/);
    assert.ok(!/ASSESSMENTS/.test(def), 'no assessment rules');
    assert.ok(!/MANEUVER GUIDE/.test(def), 'no forensic guide');
    // Even asked for explicitly, a retired task is filtered to nothing
    // beyond the shared rules — the prompt cannot regrow judgment.
    const asked = buildSystemPrompt({ tasks: ['findings', 'relationships', 'assessments'] });
    assert.ok(!/MANEUVER GUIDE/.test(asked));
    assert.ok(!/ASSESSMENTS/.test(asked));
    // Back-compat: the single-string task path still works, and 'all'
    // now means every EXTRACTION kind.
    assert.match(buildSystemPrompt({ task: 'entities' }), /ENTITIES/);
    const all = buildSystemPrompt({ task: 'all' });
    assert.match(all, /CLAIMS/);
    assert.ok(!/MANEUVER GUIDE/.test(all), "'all' is extraction-all, not judgment-all");
});

// --- Entity facts: RETIRED (2026-07-20, with the whole fact layer) -----------

test('facts: no longer selectable, no options row, no prompt rules — even when asked for', () => {
    assert.ok(!SUGGEST_KINDS.includes('facts'));
    assert.ok(!SUGGEST_KIND_LABELS.some((k) => k.kind === 'facts'), 'no options row');
    const asked = buildSystemPrompt({ tasks: ['facts'] });
    assert.ok(!/ENTITY FACTS/.test(asked), 'the fact rules cannot regrow');
    assert.ok(!/ENTITY FACTS/.test(buildSystemPrompt({ task: 'all' })), "'all' excludes facts");
});

// --- Case is the researcher's workspace, never a suggestion (CW.1) ----------

test('case-workspace: SUGGESTABLE_ENTITY_TYPES is ENTITY_TYPES minus case — and ENTITY_TYPES itself is untouched', async () => {
    const { SUGGESTABLE_ENTITY_TYPES, buildSuggestTool } = await import('../src/shared/llm-prompts.js');
    const { ENTITY_TYPES } = await import('../src/shared/entity-model.js');
    assert.deepEqual([...SUGGESTABLE_ENTITY_TYPES], ['person', 'organization', 'place', 'thing']);
    assert.ok(!SUGGESTABLE_ENTITY_TYPES.includes('case'), 'the model may not mint a workspace');
    // The wire vocabulary keeps `case` — it is parsed back from published
    // kind-0 `about` text (adopt-entity.js); only the SUGGEST surface narrows.
    assert.deepEqual([...ENTITY_TYPES], ['person', 'organization', 'place', 'thing', 'case']);
    // The tool schema offers only the suggestable subset.
    const tool = buildSuggestTool();
    const enumTypes = tool.input_schema.properties.proposals.items.properties.entity_type.enum;
    assert.deepEqual([...enumTypes], ['person', 'organization', 'place', 'thing']);
});

test('case-workspace: the entity rules define every type and forbid proposing a case', () => {
    const p = buildSystemPrompt({ tasks: ['entities'] });
    assert.ok(!/cases named in the text/.test(p), 'the old case-minting instruction is gone');
    assert.match(p, /A SCIENTIFIC PAPER is a thing/, 'paper→thing stated explicitly');
    assert.match(p, /LAWSUIT or COURT CASE is a thing/, 'lawsuit→thing stated explicitly');
    assert.match(p, /When in doubt, it is a thing/, 'the fallback rule rides');
    assert.match(p, /never propose one/, 'the workspace refusal is explicit');
    assert.match(p, /person: a named human being/, 'every suggestable type is defined');
});

// --- The active-case frame (28.3) -------------------------------------------

test('case frame: the active case names the extraction context without licensing invention', () => {
    const p = buildSystemPrompt({ tasks: ['entities'], caseName: 'Are eggs bad for you?', scopeQuestion: 'Do eggs raise CVD risk?' });
    assert.match(p, /ACTIVE CASE: "Are eggs bad for you\?"/);
    assert.match(p, /scope question: "Do eggs raise CVD risk\?"/);
    assert.match(p, /extract FAITHFULLY/, 'faithfulness rules over preference');
    assert.match(p, /never propose the case itself as an entity/, 'CW.1 restated where the frame tempts');
    // Absent frame → absent block, and no scope line without a scope.
    assert.ok(!/ACTIVE CASE/.test(buildSystemPrompt({ tasks: ['entities'] })), 'no frame without a case');
    const noScope = buildSystemPrompt({ tasks: ['entities'], caseName: 'X' });
    assert.ok(/ACTIVE CASE: "X"/.test(noScope) && !/scope question/.test(noScope), 'scope line only when a scope exists');
});

// --- Vocabulary injection (Phase 28) ----------------------------------------

test('vocabulary: known entities ride the prompt as naming vocabulary with the no-minting guard', () => {
    const p = buildSystemPrompt({ tasks: ['entities'], entityVocabulary: [
        { name: 'Bob Smith', type: 'person' }, { name: 'WHO', type: 'organization' }
    ] });
    assert.match(p, /KNOWN ENTITIES/);
    assert.match(p, /Bob Smith \(person\)/);
    assert.match(p, /WHO \(organization\)/);
    assert.match(p, /reuse the EXACT name/, 'the merge instruction rides');
    assert.match(p, /vocabulary, NOT a quota/, 'the list is never a quota');
    assert.match(p, /never propose a listed\s+entity that this text does not itself mention/,
        'CW.1-style no-minting restated for the vocabulary');
    assert.match(p, /proposing a NEW entity/, 'the list must not suppress new entities');
    // Absent / empty → no block.
    assert.ok(!/KNOWN ENTITIES/.test(buildSystemPrompt({ tasks: ['entities'] })));
    assert.ok(!/KNOWN ENTITIES/.test(buildSystemPrompt({ tasks: ['entities'], entityVocabulary: [] })));
});

test('vocabulary: case-typed entries can never reach the prompt, and the cap holds', () => {
    const many = Array.from({ length: SUGGEST_VOCAB_MAX + 15 },
        (_, i) => ({ name: `Vocab${i}`, type: 'person' }));
    const p = buildSystemPrompt({ tasks: ['entities'], entityVocabulary: [
        { name: 'Egg Investigation', type: 'case' }, ...many
    ] });
    assert.ok(!/Egg Investigation/.test(p), 'the workspace itself is never vocabulary');
    const listed = (p.match(/Vocab\d+ \(person\)/g) || []).length;
    assert.equal(listed, SUGGEST_VOCAB_MAX, 'defense-in-depth cap in the prompt builder');
});

test('vocabularyFromRegistry: registry dict → capped, recency-ordered, case-free {name,type} list', () => {
    const records = {
        a: { id: 'a', name: '  Bob   Smith ', type: 'person', updated: 300 },
        b: { id: 'b', name: 'WHO', type: 'organization', created: 100 },
        c: { id: 'c', name: 'Egg Investigation', type: 'case', updated: 999 },
        d: { id: 'd', name: '   ', type: 'person', updated: 500 },
        e: { id: 'e', name: 'Framingham Study', type: 'thing', updated: 200 }
    };
    assert.deepEqual(vocabularyFromRegistry(records), [
        { name: 'Bob Smith', type: 'person' },
        { name: 'Framingham Study', type: 'thing' },
        { name: 'WHO', type: 'organization' }
    ], 'whitespace collapsed, case excluded, blank names dropped, recency order');
    // The cap keeps the MOST RECENT names — the live vocabulary.
    const big = {};
    for (let i = 0; i < SUGGEST_VOCAB_MAX + 20; i++) {
        big[`e${i}`] = { id: `e${i}`, name: `E${i}`, type: 'thing', updated: i };
    }
    const capped = vocabularyFromRegistry(big);
    assert.equal(capped.length, SUGGEST_VOCAB_MAX);
    assert.equal(capped[0].name, `E${SUGGEST_VOCAB_MAX + 19}`);
    // Degenerate inputs are calm.
    assert.deepEqual(vocabularyFromRegistry(null), []);
    assert.deepEqual(vocabularyFromRegistry({}), []);
});
