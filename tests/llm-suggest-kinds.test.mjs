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
    RETIRED_SUGGEST_KINDS, SUGGEST_CLAIM_INDEX_MAX,
    normalizeSuggestKinds, categoryOfProposalKind, buildSystemPrompt,
    buildUserPrompt
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

// --- Vocabulary injection: RETIRED (UA.2) -----------------------------------

test('vocabulary retirement (UA.2): the registry never rides a prompt again', async () => {
    // Prompt-time vocabulary would poison the article pass's
    // content-only cache key; naming consistency lives in the
    // accept-time resolution ladder (shared/entity-resolution.js).
    const mod = await import('../src/shared/llm-prompts.js');
    assert.equal(mod.vocabularyFromRegistry, undefined, 'the assembler is gone');
    assert.equal(mod.SUGGEST_VOCAB_MAX, undefined, 'the cap constant is gone');
    assert.ok(!/KNOWN ENTITIES/.test(buildSystemPrompt({ tasks: ['entities'] })),
        'no vocabulary block in the prompt');
});

test('map entity types stay wire-consistent: the v9 enum is ENTITY_TYPES minus case (drift guard)', async () => {
    // corpus-prompts INLINES the list to stay chrome-free at module
    // load; this pin is what keeps the inline copy honest.
    const { ENTITY_TYPES } = await import('../src/shared/entity-model.js');
    const CP = await import('../src/shared/corpus-prompts.js');
    const enumTypes = CP.buildMapTool().input_schema.properties.entities.items.properties.type.enum;
    assert.deepEqual([...enumTypes], ENTITY_TYPES.filter((t) => t !== 'case'));
});

// ---- UA.1: the slim (supplied-claims) suggest mode -------------------------

test('supplied claims: the claims rules are REPLACED by the no-reproposal block (UA.1)', () => {
    const slim = buildSystemPrompt({ tasks: ['entities'], suppliedClaims: true });
    assert.match(slim, /CLAIMS ARE ALREADY EXTRACTED/);
    assert.match(slim, /Do NOT propose kind=claim items/);
    assert.match(slim, /claim_refs/);
    assert.ok(!/CLAIMS \(atomized assertions/.test(slim), 'the claim-authoring rules must not co-exist');
    // Without the flag, nothing about supplied claims leaks in.
    const full = buildSystemPrompt({ tasks: ['entities', 'claims'] });
    assert.ok(!/ALREADY EXTRACTED/.test(full));
    assert.match(full, /CLAIMS \(atomized assertions/);
});

test('supplied claims: the user turn carries the capped ref—text index (UA.1)', () => {
    const idx = [
        { ref: 'C1', text: 'First   claim\ntext.' },
        { ref: 'C2', text: 'x'.repeat(500) }
    ];
    const p = buildUserPrompt({ articleText: 'BODY', claimIndex: idx });
    assert.match(p, /SUPPLIED CLAIM INDEX/);
    assert.match(p, /C1 — First claim text\./, 'whitespace collapses; the text rides after the ref');
    assert.ok(p.includes(`C2 — ${'x'.repeat(200)}`), 'per-entry text caps at 200 chars');
    assert.ok(!p.includes('x'.repeat(201)));
    // The index caps as a whole; the tail goes unlinked rather than unbounded.
    const big = Array.from({ length: SUGGEST_CLAIM_INDEX_MAX + 50 },
        (_, i) => ({ ref: `C${i + 1}`, text: `claim ${i + 1}` }));
    const capped = buildUserPrompt({ articleText: 'B', claimIndex: big });
    assert.ok(capped.includes(`C${SUGGEST_CLAIM_INDEX_MAX} — `));
    assert.ok(!capped.includes(`C${SUGGEST_CLAIM_INDEX_MAX + 1} — `));
    // PRESENCE semantics: null/undefined → the pre-UA.1 user turn; an
    // EMPTY array is a supplied-but-claimless pass and still renders
    // the block (so slim mode never silently re-arms claim extraction).
    assert.ok(!buildUserPrompt({ articleText: 'BODY' }).includes('SUPPLIED CLAIM INDEX'));
    const empty = buildUserPrompt({ articleText: 'BODY', claimIndex: [] });
    assert.match(empty, /SUPPLIED CLAIM INDEX/);
    assert.match(empty, /found no claims/);
});
