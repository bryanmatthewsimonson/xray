// UA.1 — the slim (supplied-claims) suggest mode and the map-pass
// consent-gate split, observed at the SEAM (runSuggestionPass /
// runCorpusMapPass with a stubbed fetch), not just in the pure prompt
// builders. The failure modes these pin: a one-token regression
// filtering on enabledKinds instead of effectiveKinds would let a
// model-volunteered claim re-enter the modal (double extraction); and
// reverting the map pass to corpusGate would break Suggest's claim
// half for every default-config (caseSynthesis-off) user while the
// suite stayed green.

import { test } from 'node:test';
import assert from 'node:assert/strict';

await import('fake-indexeddb/auto');
// Stateful storage stub (the audit-llm.test.mjs idiom): the consent
// gates need get() to reflect what the test stored.
const _store = {};
globalThis.chrome = globalThis.chrome || {
    storage: { local: {
        get(keys, cb) {
            const out = {};
            const list = Array.isArray(keys) ? keys : (typeof keys === 'string' ? [keys] : Object.keys(_store));
            for (const k of list) { if (k in _store) out[k] = _store[k]; }
            cb(out);
        },
        set(obj, cb) { Object.assign(_store, obj); cb && cb(); },
        remove(keys, cb) { for (const k of (Array.isArray(keys) ? keys : [keys])) delete _store[k]; cb && cb(); }
    } }
};

const { runSuggestionPass, runCorpusMapPass, runCorpusReducePass, LLM_KEY_STORAGE } =
    await import('../src/shared/llm-client.js');
const { LLM_SUGGEST_KINDS_STORAGE } = await import('../src/shared/llm-prompts.js');

// fetch stub: capture each payload, answer with a canned tool_use.
let sentPayloads = [];
let cannedContent = [];
globalThis.fetch = async (_url, init) => {
    sentPayloads.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({
        stop_reason: 'tool_use', model: 'claude-test',
        content: cannedContent, usage: { input_tokens: 1, output_tokens: 1 }
    }) };
};

function arm({ kinds, flags }) {
    for (const k of Object.keys(_store)) delete _store[k];
    _store[LLM_KEY_STORAGE] = 'sk-test-key';
    _store['xray:flags'] = flags || { llmAssist: true };
    if (kinds) _store[LLM_SUGGEST_KINDS_STORAGE] = kinds;
    sentPayloads = [];
}

test('slim mode: supplied index removes the claims category and discards volunteered claims', async () => {
    arm({ kinds: ['entities', 'claims'] });
    cannedContent = [{ type: 'tool_use', name: 'propose_capture', input: { proposals: [
        { kind: 'entity', ref: 'E1', name: 'Alice', entity_type: 'person', mention: 'Alice', claim_refs: ['C1'] },
        { kind: 'claim', ref: 'CX', text: 'a re-extracted claim', quote: 'q' }
    ] } }];
    const res = await runSuggestionPass({
        articleText: 'BODY', claimIndex: [{ ref: 'C1', text: 'the supplied claim' }]
    });
    assert.equal(res.ok, true);
    assert.equal(sentPayloads.length, 1);
    const payload = sentPayloads[0];
    assert.match(payload.system, /CLAIMS ARE ALREADY EXTRACTED/);
    assert.ok(!/CLAIMS \(atomized assertions/.test(payload.system), 'the claim-authoring rules must not ride');
    assert.match(payload.messages[0].content, /SUPPLIED CLAIM INDEX/);
    assert.match(payload.messages[0].content, /C1 — the supplied claim/);
    // The volunteered claim is filtered; the entity (with claim_refs) survives.
    assert.deepEqual(res.proposals.map((p) => p.kind), ['entity']);
    assert.deepEqual(res.proposals[0].claim_refs, ['C1']);
});

test('slim mode: an EMPTY supplied index still slims — it must not re-arm claim extraction', async () => {
    arm({ kinds: ['entities', 'claims'] });
    cannedContent = [{ type: 'tool_use', name: 'propose_capture', input: { proposals: [
        { kind: 'claim', ref: 'CX', text: 're-extracted', quote: 'q' }
    ] } }];
    const res = await runSuggestionPass({ articleText: 'BODY', claimIndex: [] });
    assert.equal(res.ok, true);
    assert.match(sentPayloads[0].system, /CLAIMS ARE ALREADY EXTRACTED/);
    assert.match(sentPayloads[0].messages[0].content, /found no claims/);
    assert.deepEqual(res.proposals, [], 'the re-extracted claim is discarded');
});

test('slim mode: claims-only config + supplied index short-circuits with ZERO network calls', async () => {
    arm({ kinds: ['claims'] });
    const res = await runSuggestionPass({ articleText: 'BODY', claimIndex: [{ ref: 'C1', text: 't' }] });
    assert.deepEqual(res, { ok: true, model: null, proposals: [] });
    assert.equal(sentPayloads.length, 0);
});

test('legacy mode: no claimIndex → the full pre-UA.1 pass, claims and all', async () => {
    arm({ kinds: ['entities', 'claims'] });
    cannedContent = [{ type: 'tool_use', name: 'propose_capture', input: { proposals: [
        { kind: 'claim', ref: 'C1', text: 'a claim', quote: 'q' }
    ] } }];
    const res = await runSuggestionPass({ articleText: 'BODY' });
    assert.equal(res.ok, true);
    assert.match(sentPayloads[0].system, /CLAIMS \(atomized assertions/);
    assert.ok(!/SUPPLIED CLAIM INDEX/.test(sentPayloads[0].messages[0].content));
    assert.deepEqual(res.proposals.map((p) => p.kind), ['claim'], 'claims still flow on the legacy path');
});

// ---- the consent-gate split (UA.1) -----------------------------------------

test('GUARD: the map pass gates on llmAssist + key WITHOUT caseSynthesis — Suggest works for default-config users', async () => {
    arm({ flags: { llmAssist: true, caseSynthesis: false } });
    cannedContent = [{ type: 'tool_use', name: 'emit_corpus_extract', input: { position: { summary: 's' } } }];
    const res = await runCorpusMapPass({ member_id: 'm1', memberText: 'BODY', memberMeta: { title: 'T', url: 'u' } });
    assert.equal(res.ok, true, `the map must run under llmAssist alone (got: ${res.error || 'ok'})`);
    assert.equal(sentPayloads.length, 1);
});

test('GUARD: the reduce keeps the FULL corpusGate — caseSynthesis off refuses before any network call', async () => {
    arm({ flags: { llmAssist: true, caseSynthesis: false } });
    const res = await runCorpusReducePass({ dossierDigest: 'd', extracts: [{ article_hash: 'h', extract: {} }] });
    assert.equal(res.ok, false);
    assert.match(res.error, /Case synthesis is off/);
    assert.equal(sentPayloads.length, 0);
});

test('GUARD: llmAssist off refuses the map pass — the spend consent still holds', async () => {
    arm({ flags: { llmAssist: false, caseSynthesis: true } });
    const res = await runCorpusMapPass({ member_id: 'm1', memberText: 'BODY' });
    assert.equal(res.ok, false);
    assert.match(res.error, /LLM assist is off/);
    assert.equal(sentPayloads.length, 0);
});
