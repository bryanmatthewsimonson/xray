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
