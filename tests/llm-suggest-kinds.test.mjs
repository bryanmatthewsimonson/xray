// LLM Suggest — per-kind defaults + scoping. Default ON is the
// extraction kinds (entities, claims); the judgment kinds
// (relationships, assessments, findings) are opt-in.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// llm-prompts pulls entity-model transitively, which reads chrome.storage
// at module load — stub it before importing (as the other LLM tests do).
globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

const {
    SUGGEST_KINDS, SUGGEST_DEFAULT_KINDS, SUGGEST_KIND_LABELS,
    normalizeSuggestKinds, categoryOfProposalKind, buildSystemPrompt
} = await import('../src/shared/llm-prompts.js');

test('default ON = entities + claims only (extraction, not judgment)', () => {
    assert.deepEqual([...SUGGEST_DEFAULT_KINDS], ['entities', 'claims']);
    for (const judgment of ['relationships', 'assessments', 'findings']) {
        assert.ok(!SUGGEST_DEFAULT_KINDS.includes(judgment), `${judgment} must be opt-in`);
        assert.ok(SUGGEST_KINDS.includes(judgment), `${judgment} is still a selectable kind`);
    }
});

test('normalizeSuggestKinds: absent → defaults, explicit → filtered (empty allowed)', () => {
    assert.deepEqual(normalizeSuggestKinds(undefined), ['entities', 'claims']);
    assert.deepEqual(normalizeSuggestKinds(null), ['entities', 'claims']);
    assert.deepEqual(normalizeSuggestKinds('all'), ['entities', 'claims'], 'non-array → defaults');
    assert.deepEqual(normalizeSuggestKinds([]), [], 'explicit empty is honored, not defaulted');
    assert.deepEqual(normalizeSuggestKinds(['claims', 'bogus', 'findings']), ['claims', 'findings']);
});

test('categoryOfProposalKind: forensic kinds collapse to findings', () => {
    assert.equal(categoryOfProposalKind('entity'), 'entities');
    assert.equal(categoryOfProposalKind('claim'), 'claims');
    assert.equal(categoryOfProposalKind('relationship'), 'relationships');
    assert.equal(categoryOfProposalKind('assessment'), 'assessments');
    for (const k of ['finding', 'baseline', 'revision']) {
        assert.equal(categoryOfProposalKind(k), 'findings', `${k} → findings`);
    }
    assert.equal(categoryOfProposalKind('nope'), null);
});

test('SUGGEST_KIND_LABELS covers every selectable kind', () => {
    assert.deepEqual(SUGGEST_KIND_LABELS.map((k) => k.kind).sort(), [...SUGGEST_KINDS].sort());
});

test('buildSystemPrompt scopes to tasks: default omits assessments + the maneuver guide', () => {
    const def = buildSystemPrompt({ tasks: ['entities', 'claims'] });
    assert.match(def, /ENTITIES/);
    assert.match(def, /CLAIMS/);
    assert.ok(!/ASSESSMENTS/.test(def), 'no assessment rules when not enabled');
    assert.ok(!/MANEUVER GUIDE/.test(def), 'no heavy forensic guide when findings off');

    const withFindings = buildSystemPrompt({ tasks: ['findings'] });
    assert.match(withFindings, /MANEUVER GUIDE/, 'findings pulls in the guide');

    // Back-compat: the single-string task path still works.
    assert.match(buildSystemPrompt({ task: 'entities' }), /ENTITIES/);
    assert.match(buildSystemPrompt({ task: 'all' }), /MANEUVER GUIDE/);
});

// --- Entity facts category (Phase 19.6) --------------------------------------

test('facts: a selectable category, DEFAULT OFF, mapped from kind=fact', () => {
    assert.ok(SUGGEST_KINDS.includes('facts'), 'facts is selectable');
    assert.ok(!SUGGEST_DEFAULT_KINDS.includes('facts'),
        'facts is OPT-IN — external-knowledge risk makes it a judgment-class default');
    assert.equal(categoryOfProposalKind('fact'), 'facts');
    assert.ok(SUGGEST_KIND_LABELS.some((k) => k.kind === 'facts'), 'options row exists');
});

test('facts: the prompt rules carry the design-verbatim extraction ban', () => {
    const p = buildSystemPrompt({ tasks: ['facts'] });
    assert.match(p, /ENTITY FACTS/);
    assert.match(p, /never supply a value from your own knowledge of the entity/,
        'the §19.6 rule rides verbatim');
    assert.match(p, /only what this article's text asserts/);
    // And it stays OUT of the default scope.
    assert.ok(!/ENTITY FACTS/.test(buildSystemPrompt({ tasks: ['entities', 'claims'] })));
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
