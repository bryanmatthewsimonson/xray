// The corpus-pass consent gates — UA.1's assistGate/corpusGate split,
// observed at the SEAM (runCorpusMapPass / runCorpusReducePass with a
// stubbed fetch). The failure modes these pin: reverting the map pass
// to corpusGate would break Suggest's claim half for every
// default-config (caseSynthesis-off) user while the suite stayed
// green; dropping the llmAssist check would erode the SW-side spend
// consent. (This file began as tests/llm-suggest-slim.test.mjs; the
// slim-mode suggest tests retired in UA.3 with runSuggestionPass.)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sseResponse } from './helpers/sse.mjs';

await import('fake-indexeddb/auto');
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

const { runCorpusMapPass, runCorpusReducePass, LLM_KEY_STORAGE } =
    await import('../src/shared/llm-client.js');

let sentPayloads = [];
let cannedContent = [];
globalThis.fetch = async (_url, init) => {
    sentPayloads.push(JSON.parse(init.body));
    return sseResponse({
        stop_reason: 'tool_use', model: 'claude-test',
        content: cannedContent, usage: { input_tokens: 1, output_tokens: 1 }
    });
};

function arm({ flags }) {
    for (const k of Object.keys(_store)) delete _store[k];
    _store[LLM_KEY_STORAGE] = 'sk-test-key';
    _store['xray:flags'] = flags || { llmAssist: true };
    sentPayloads = [];
}

test('GUARD: the map pass gates on llmAssist + key WITHOUT caseSynthesis — Suggest works for default-config users', async () => {
    arm({ flags: { llmAssist: true, caseSynthesis: false } });
    cannedContent = [{ type: 'tool_use', name: 'emit_corpus_extract', input: { position: { summary: 's' } } }];
    const res = await runCorpusMapPass({ member_id: 'm1', memberText: 'BODY', memberMeta: { title: 'T', url: 'u' } });
    assert.equal(res.ok, true, `the map must run under llmAssist alone (got: ${res.error || 'ok'})`);
    assert.equal(sentPayloads.length, 1);
});

// ---- normalization at the entry point (the 2026-08-13 class) ----------
//
// Model output enters here and nowhere else. These pin the split the whole
// design rests on: containers are made total so nothing downstream throws,
// but a MALFORMED ANSWER is refused rather than quietly normalized into a
// valid-looking empty one — because a valid-looking empty extract gets
// CACHED under a content-only key and re-served forever.

test('a wrong-typed TOP-LEVEL field is refused, not silently emptied', async () => {
    arm({ flags: { llmAssist: true } });
    cannedContent = [{ type: 'tool_use', name: 'emit_corpus_extract', input: {
        position: { summary: 's' },
        entities: { E1: { name: 'Alice' } }        // object where a list was declared
    } }];
    const res = await runCorpusMapPass({ member_id: 'm1', memberText: 'BODY' });
    assert.equal(res.ok, false, 'the pass must FAIL — coercing to [] would cache an entity-blind article');
    assert.match(res.error, /malformed extract/);
    assert.match(res.error, /entities/, 'and it names the field that was wrong');
    assert.match(res.error, /Nothing was cached/);
});

test('wrong-typed ROWS are tolerated — per-row leniency survives, the good rows land', async () => {
    arm({ flags: { llmAssist: true } });
    cannedContent = [{ type: 'tool_use', name: 'emit_corpus_extract', input: {
        position: { summary: 's' },
        entities: [{ ref: 'E1', name: 'Alice', type: 'person', mention: 'Alice' }, 'junk', null, 7],
        key_assertions: [{ quote: 'q', load_bearing: true }]
    } }];
    const res = await runCorpusMapPass({ member_id: 'm1', memberText: 'BODY' });
    assert.equal(res.ok, true, 'a bad ROW is not a malformed ANSWER');
    assert.equal(res.extract.entities.length, 1);
    assert.equal(res.extract.entities[0].name, 'Alice');
});

test('a wrong-typed row FIELD is dropped, never handed on as the wrong type', async () => {
    arm({ flags: { llmAssist: true } });
    cannedContent = [{ type: 'tool_use', name: 'emit_corpus_extract', input: {
        position: { summary: 's' },
        key_assertions: [{ quote: 'q', load_bearing: 'yes', about: 'not-a-list' }]
    } }];
    const res = await runCorpusMapPass({ member_id: 'm1', memberText: 'BODY' });
    assert.equal(res.ok, true);
    const atom = res.extract.key_assertions[0];
    assert.equal(atom.quote, 'q');
    assert.ok(!('load_bearing' in atom), 'the string "yes" never reaches a consumer as a boolean');
    assert.deepEqual(atom.about, [], 'and a wrong-typed list becomes a list');
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
