// The map pass's ONE-round shape-repair retry — field-found 2026-08-25.
//
// The maintainer's diagnostics showed six Suggest failures in ~30
// minutes: "$.position required field missing", "$.key_assertions
// expected array, got string", "$.entities expected array, got string".
// Tool input schemas are advisory to the model, and the pass took the
// first answer or failed — so the error said "Try Suggest again" while
// the same content produced the same wrong shape on every retry. The
// human was the retry loop.
//
// Now: a complete-but-invalid extract earns ONE repair turn — the
// assistant's own tool_use is echoed back with an is_error tool_result
// naming the exact violations, and the model is asked to call the tool
// again correctly. One round only; a still-wrong second answer fails
// with the honest message. Truncated (salvaged/max_tokens) payloads are
// NEVER retried — that is cause 1 (the output ceiling), and a retry
// would pay full price for the same cut.

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

const { runCorpusMapPass, LLM_KEY_STORAGE } = await import('../src/shared/llm-client.js');

const GOOD = { position: { summary: 'argues X' }, key_assertions: [], entities: [] };
const BAD_MISSING_POSITION = { key_assertions: [{ quote: 'q', text: 't', load_bearing: false }] };
const BAD_STRING_ENTITIES = { position: { summary: 's' }, entities: 'E1: Alice (person)' };

let sentPayloads = [];
let responses = [];
globalThis.fetch = async (_url, init) => {
    sentPayloads.push(JSON.parse(init.body));
    const next = responses.shift() || {};
    return sseResponse({
        stop_reason: next.stop_reason || 'tool_use', model: 'claude-test',
        content: next.content || [], usage: { input_tokens: 1, output_tokens: 1 }
    });
};

function arm(queue) {
    for (const k of Object.keys(_store)) delete _store[k];
    _store[LLM_KEY_STORAGE] = 'sk-test-key';
    _store['xray:flags'] = { llmAssist: true };
    sentPayloads = [];
    responses = queue;
}
const toolUse = (input, id = 'tu_1') => ({ type: 'tool_use', id, name: 'emit_corpus_extract', input });

test('a valid extract makes ONE call — no retry tax on the happy path', async () => {
    arm([{ content: [toolUse(GOOD)] }]);
    const res = await runCorpusMapPass({ member_id: 'm', memberText: 'BODY' });
    assert.equal(res.ok, true);
    assert.equal(sentPayloads.length, 1);
});

test('missing position → one repair turn carrying the exact violation, then success', async () => {
    arm([
        { content: [toolUse(BAD_MISSING_POSITION, 'tu_9')] },
        { content: [toolUse(GOOD)] }
    ]);
    const res = await runCorpusMapPass({ member_id: 'm', memberText: 'BODY' });
    assert.equal(res.ok, true, `expected the repaired second answer to serve (got: ${res.error || 'ok'})`);
    assert.equal(sentPayloads.length, 2);

    const retry = sentPayloads[1];
    // The conversation carries the model's OWN wrong answer…
    const assistantTurn = retry.messages.find((m) => m.role === 'assistant');
    assert.ok(assistantTurn, 'the retry must echo the assistant turn');
    // …and an is_error tool_result naming the violation, tied by id.
    const resultTurn = retry.messages[retry.messages.length - 1];
    const block = resultTurn.content.find((b) => b.type === 'tool_result');
    assert.ok(block, 'the retry must speak through a tool_result');
    assert.equal(block.tool_use_id, 'tu_9');
    assert.equal(block.is_error, true);
    assert.match(String(block.content), /\$\.position/, 'the model must be told WHICH field');
    // The tool stays forced so the second answer is structured too.
    assert.equal(retry.tool_choice && retry.tool_choice.name, 'emit_corpus_extract');
});

test('string entities → repaired on the second answer; still-wrong twice fails honestly with NO third call', async () => {
    arm([
        { content: [toolUse(BAD_STRING_ENTITIES)] },
        { content: [toolUse(BAD_STRING_ENTITIES)] }
    ]);
    const res = await runCorpusMapPass({ member_id: 'm', memberText: 'BODY' });
    assert.equal(res.ok, false);
    assert.equal(sentPayloads.length, 2, 'ONE repair round, never a loop');
    assert.match(res.error, /entities/, 'the failure still names the field');
});

test('a truncated (max_tokens) payload is NEVER retried — that is the output ceiling, not a shape error', async () => {
    arm([{ stop_reason: 'max_tokens', content: [toolUse(BAD_MISSING_POSITION)] }]);
    const res = await runCorpusMapPass({ member_id: 'm', memberText: 'BODY' });
    assert.equal(sentPayloads.length, 1, 'no retry on a cut-off answer');
    assert.equal(res.ok, true, 'salvage semantics unchanged — partial rides to the caller');
    assert.equal(res.partial, true);
});

test('the double-encoded shape still repairs LOSSLESSLY with no second call', async () => {
    // The 2026-08-22 shape: the JSON text of an array where the array
    // should be. That repair is free — it must not become a paid retry.
    const doubleEncoded = { position: { summary: 's' }, entities: '[{"ref":"E1","name":"Alice","type":"person","mention":"Alice"}]' };
    arm([{ content: [toolUse(doubleEncoded)] }]);
    const res = await runCorpusMapPass({ member_id: 'm', memberText: 'BODY' });
    assert.equal(res.ok, true);
    assert.equal(sentPayloads.length, 1, 'lossless repair must stay free');
});
