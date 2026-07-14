// Case-synthesis pure-layer tests — Phase 20.4. Validators, grounding,
// proposal filtering, and input-hash determinism. A chrome stub is
// needed because case-synthesis → case-dossier → models probe storage
// at import (the functions under test don't touch it).

import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

const CS = await import('../src/shared/case-synthesis.js');
const { createGroundingIndex } = await import('../src/shared/quote-grounding.js');
const { orchestrateModuleRuns } = await import('../src/shared/audit/run-orchestrator.js');

test('case-synthesis: validateCorpusExtract accepts a good extract, rejects a bad one', () => {
    const good = { position: { summary: 'argues X', side_label: 'X' },
        key_assertions: [{ quote: 'a verbatim span', claim_ref: null, why_load_bearing: 'core' }] };
    assert.equal(CS.validateCorpusExtract(good).ok, true);
    const bad = { position: { summary: 5 } };  // summary must be string
    assert.equal(CS.validateCorpusExtract(bad).ok, false);
    const noPos = { key_assertions: [] };      // position required
    assert.equal(CS.validateCorpusExtract(noPos).ok, false);
});

test('case-synthesis: validateCaseBrief enforces shape + proposal enum', () => {
    const good = { summary: 's', positions: [{ label: 'A' }], cruxes: [], load_bearing: [],
        coverage_gaps: [], proposals: [{ kind: 'is_key', claim_id: 'c1' }] };
    assert.equal(CS.validateCaseBrief(good).ok, true);
    const badKind = { summary: 's', proposals: [{ kind: 'delete_everything' }] };
    assert.equal(CS.validateCaseBrief(badKind).ok, false);
    const noSummary = { positions: [] };
    assert.equal(CS.validateCaseBrief(noSummary).ok, false);
});

test('case-synthesis: groundCaseBrief drops ungrounded quotes, keeps grounded with the member span', () => {
    const text = 'The lab reported the sequence on 2019-12-30, according to the log.';
    const idx = { A: createGroundingIndex(text) };
    const brief = {
        summary: 's',
        cruxes: [{ question: 'q', sides: [], evidence_refs: [
            { article_hash: 'A', quote: 'reported the sequence on 2019-12-30' },   // grounded
            { article_hash: 'A', quote: 'a fabricated span not present' }           // dropped
        ], what_would_resolve: '' }],
        load_bearing: [{ article_hash: 'A', quote: 'according to the log', why: 'w' }],
        coverage_gaps: [], proposals: []
    };
    const { brief: out, checked, dropped } = CS.groundCaseBrief(brief, idx);
    assert.equal(checked, 3);
    assert.equal(dropped, 1);
    assert.equal(out.cruxes[0].evidence_refs.length, 1);
    assert.ok(text.includes(out.cruxes[0].evidence_refs[0].quote));
    assert.equal(out.load_bearing.length, 1);
});

test('case-synthesis: filterProposals accepts resolvable refs, rejects the rest with reasons', () => {
    const claimsById = { c1: { id: 'c1', text: 'x' }, c2: { id: 'c2', text: 'y' } };
    const memberHashes = new Set(['A']);
    const brief = { proposals: [
        { kind: 'relationship', source_claim_id: 'c1', target_claim_id: 'c2', relationship: 'contradicts' },
        { kind: 'relationship', source_claim_id: 'c1', target_claim_id: 'zzz', relationship: 'contradicts' },
        { kind: 'relationship', source_claim_id: 'c1', target_claim_id: 'c2', relationship: 'invents' },
        { kind: 'is_key', claim_id: 'c1' },
        { kind: 'is_key', claim_id: 'nope' },
        { kind: 'claim', article_hash: 'A', text: 'new', quote: 'grounded' },
        { kind: 'claim', article_hash: 'B', text: 'new', quote: 'grounded' }
    ] };
    const { acceptable, rejected } = CS.filterProposals(brief, { claimsById, memberHashes });
    assert.equal(acceptable.length, 3, 'valid relationship + is_key + member claim');
    assert.equal(rejected.length, 4);
    assert.ok(rejected.every((r) => typeof r.reason === 'string'));
});

test('case-synthesis: corpusInputHash is order-insensitive but sensitive to membership + prompt', async () => {
    const a = [{ article_hash: 'h1' }, { article_hash: 'h2' }];
    const aRev = [{ article_hash: 'h2' }, { article_hash: 'h1' }];
    const h1 = await CS.corpusInputHash(a, ['c1', 'c2'], 'corpus-v1');
    const h1rev = await CS.corpusInputHash(aRev, ['c2', 'c1'], 'corpus-v1');
    assert.equal(h1, h1rev, 'order-insensitive');
    const h2 = await CS.corpusInputHash([{ article_hash: 'h1' }], ['c1', 'c2'], 'corpus-v1');
    assert.notEqual(h1, h2, 'membership change flips it');
    const h3 = await CS.corpusInputHash(a, ['c1', 'c2'], 'corpus-v2');
    assert.notEqual(h1, h3, 'prompt-version change flips it');
});

test('case-synthesis: orchestrateModuleRuns drives the map with injected send (retry + failure)', async () => {
    const attempts = {};
    const { modules, failures } = await orchestrateModuleRuns({
        moduleNames: ['A', 'B', 'C'],
        concurrency: 2,
        retryDelayMs: 0,
        wait: () => Promise.resolve(),
        send: async (id) => {
            attempts[id] = (attempts[id] || 0) + 1;
            if (id === 'A') return { ok: true, findings: { position: { summary: 'a' } }, model: 'm' };
            if (id === 'B') return attempts[id] === 1
                ? { ok: false, status: 429 }                       // retryable, succeeds on retry
                : { ok: true, findings: { position: { summary: 'b' } }, model: 'm' };
            return { ok: false, error: 'hard fail' };              // C never succeeds
        }
    });
    assert.deepEqual(Object.keys(modules).sort(), ['A', 'B']);
    assert.equal(attempts.B, 2, 'B retried once');
    assert.equal(failures.length, 1);
    assert.equal(failures[0].module, 'C');
});
