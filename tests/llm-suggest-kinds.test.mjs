// LLM Suggest — per-kind defaults + scoping. Suggest IS the
// extraction pass (2026-07-20): entities/claims only, and since UA.3
// the kinds preference gates what the reader DERIVES from the article
// extract (the standalone prompt surface retired with
// runSuggestionPass). The judgment kinds are RETIRED — relationships
// live in the cross-article links pass, findings in the FA.1 forensic
// pass, assessments in the assess modal — and facts are retired
// OUTRIGHT (2026-07-20). These pins keep them all out.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// llm-prompts pulls entity-model transitively, which reads chrome.storage
// at module load — stub it before importing (as the other LLM tests do).
globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

const {
    SUGGEST_KINDS, SUGGEST_DEFAULT_KINDS, SUGGEST_KIND_LABELS,
    RETIRED_SUGGEST_KINDS, normalizeSuggestKinds
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


test('SUGGEST_KIND_LABELS covers every selectable kind', () => {
    assert.deepEqual(SUGGEST_KIND_LABELS.map((k) => k.kind).sort(), [...SUGGEST_KINDS].sort());
});



// --- Case is the researcher's workspace, never a suggestion (CW.1) ----------

test('case-workspace: SUGGESTABLE_ENTITY_TYPES is ENTITY_TYPES minus case — and ENTITY_TYPES itself is untouched', async () => {
    const { SUGGESTABLE_ENTITY_TYPES } = await import('../src/shared/llm-prompts.js');
    const { ENTITY_TYPES } = await import('../src/shared/entity-model.js');
    assert.deepEqual([...SUGGESTABLE_ENTITY_TYPES], ['person', 'organization', 'place', 'thing']);
    assert.ok(!SUGGESTABLE_ENTITY_TYPES.includes('case'), 'the model may not mint a workspace');
    // The wire vocabulary keeps `case` — it is parsed back from published
    // kind-0 `about` text (adopt-entity.js); only the extraction surface
    // narrows. (The map tool's own enum is pinned by the drift guard
    // below — the suggest tool retired in UA.3.)
    assert.deepEqual([...ENTITY_TYPES], ['person', 'organization', 'place', 'thing', 'case']);
});



// --- Vocabulary injection: RETIRED (UA.2); prompt surface: RETIRED (UA.3) ----

test('UA.3: the standalone suggest prompt surface is gone from llm-prompts', async () => {
    const mod = await import('../src/shared/llm-prompts.js');
    for (const gone of ['buildSuggestTool', 'buildSystemPrompt', 'buildUserPrompt',
                        'vocabularyFromRegistry', 'SUGGEST_VOCAB_MAX',
                        'SUGGEST_CLAIM_INDEX_MAX', 'categoryOfProposalKind']) {
        assert.equal(mod[gone], undefined, `${gone} retired`);
    }
    // What survives: the config surface the extract-driven flow reads.
    for (const kept of ['LLM_MODELS', 'resolveModel', 'LLM_KEY_STORAGE',
                        'LLM_SUGGEST_KINDS_STORAGE', 'normalizeSuggestKinds',
                        'SUGGESTABLE_ENTITY_TYPES', 'SUGGEST_KIND_LABELS']) {
        assert.notEqual(mod[kept], undefined, `${kept} survives`);
    }
});


test('map entity types stay wire-consistent: the v9 enum is ENTITY_TYPES minus case (drift guard)', async () => {
    // corpus-prompts INLINES the list to stay chrome-free at module
    // load; this pin is what keeps the inline copy honest.
    const { ENTITY_TYPES } = await import('../src/shared/entity-model.js');
    const CP = await import('../src/shared/corpus-prompts.js');
    const enumTypes = CP.buildMapTool().input_schema.properties.entities.items.properties.type.enum;
    assert.deepEqual([...enumTypes], ENTITY_TYPES.filter((t) => t !== 'case'));
});


