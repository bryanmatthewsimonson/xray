// Streaming reassembly + partial-JSON salvage (shared/llm-stream.js).
//
// The wire is the part with all the edge cases — chunk boundaries land
// anywhere, and a forced tool call arrives as a stream of JSON fragments
// that only means anything once concatenated. These are pure functions
// precisely so that can be tested without a server.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    createSseParser, createMessageAssembler, salvagePartialJson
} from '../src/shared/llm-stream.js';

/** Frame events the way the API does. */
function sse(events) {
    return events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
}

/** Feed a whole SSE body through an assembler in fixed-size chunks. */
function run(body, { chunk = 7, ...opts } = {}) {
    const parser = createSseParser();
    const asm = createMessageAssembler(opts);
    for (let i = 0; i < body.length; i += chunk) {
        for (const ev of parser.push(body.slice(i, i + chunk))) asm.handle(ev);
    }
    return asm.result();
}

const TOOL_EVENTS = (jsonPieces, stopReason = 'end_turn') => ([
    { type: 'message_start', message: { id: 'msg_1', role: 'assistant', model: 'claude-sonnet-5', usage: { input_tokens: 10 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: 'emit_corpus_extract', input: {} } },
    ...jsonPieces.map((partial_json) => ({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json } })),
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: stopReason }, usage: { output_tokens: 99 } },
    { type: 'message_stop' }
]);

// ---- SSE framing -----------------------------------------------------------

test('the parser reassembles events across arbitrary chunk boundaries', () => {
    const body = sse([
        { type: 'message_start', message: { id: 'msg_1', model: 'm' } },
        { type: 'message_stop' }
    ]);
    // One byte at a time is the worst case a network can hand us.
    const parser = createSseParser();
    const got = [];
    for (const ch of body) got.push(...parser.push(ch));
    assert.deepEqual(got.map((e) => e.type), ['message_start', 'message_stop']);
});

test('the parser ignores ping frames, comments, and non-data lines', () => {
    const parser = createSseParser();
    const got = parser.push(': keep-alive comment\nevent: ping\ndata: {"type":"ping"}\n\nid: 7\n');
    assert.deepEqual(got.map((e) => e.type), ['ping']);
});

test('one malformed data frame does not lose the rest of a paid response', () => {
    const parser = createSseParser();
    const got = parser.push('data: {not json\n\ndata: {"type":"message_stop"}\n\n');
    assert.deepEqual(got.map((e) => e.type), ['message_stop'], 'the good frame still lands');
});

// ---- Message shape ---------------------------------------------------------

test('a streamed tool call reassembles into the non-streaming response shape', () => {
    const extract = { position: { summary: 'S' }, key_assertions: [{ quote: 'q', text: 't', load_bearing: true }] };
    const json = JSON.stringify(extract);
    // Split the JSON at awkward points — mid-key and mid-string-value.
    const pieces = [json.slice(0, 5), json.slice(5, 23), json.slice(23)];
    const { message, error, salvaged } = run(sse(TOOL_EVENTS(pieces)));

    assert.equal(error, null);
    assert.equal(salvaged, false);
    assert.equal(message.id, 'msg_1');
    assert.equal(message.model, 'claude-sonnet-5');
    assert.equal(message.stop_reason, 'end_turn');
    assert.equal(message.usage.output_tokens, 99);
    assert.equal(message.content.length, 1);
    assert.equal(message.content[0].type, 'tool_use');
    assert.equal(message.content[0].name, 'emit_corpus_extract');
    assert.deepEqual(message.content[0].input, extract, 'the fragments concatenate back to the exact object');
});

test('text and thinking deltas accumulate; a refusal on message_start survives', () => {
    const { message } = run(sse([
        { type: 'message_start', message: { id: 'm', model: 'x', stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber' } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hm' } },
        { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'he' } },
        { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'llo' } },
        { type: 'message_stop' }
    ]));
    assert.equal(message.content[0].thinking, 'hm');
    assert.equal(message.content[1].text, 'hello');
    // refusalResult() reads exactly these two fields.
    assert.equal(message.stop_reason, 'refusal');
    assert.equal(message.stop_details.category, 'cyber');
});

test('a mid-stream error frame is reported, never returned as an empty success', () => {
    const { error } = run(sse([
        { type: 'message_start', message: { id: 'm', model: 'x' } },
        { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }
    ]));
    assert.equal(error, 'Overloaded');
});

test('an unparseable tool call DROPS its block — an empty input would read as an empty extract', () => {
    const { message, salvaged } = run(sse(TOOL_EVENTS(['{"key_assertions": [{"quo'])), { salvage: false });
    assert.equal(salvaged, false);
    assert.equal(message.content.length, 0, 'no block at all, so extractToolInput() returns null');
});

// ---- Salvage ---------------------------------------------------------------

test('salvagePartialJson: complete JSON passes through unsalvaged', () => {
    const r = salvagePartialJson('{"a":[1,2]}');
    assert.equal(r.ok, true);
    assert.equal(r.salvaged, false);
    assert.deepEqual(r.value, { a: [1, 2] });
});

test('salvagePartialJson: keeps every COMPLETE element, drops the partial one', () => {
    const cut = '{"position":{"summary":"S"},"key_assertions":[{"quote":"a","load_bearing":true},'
              + '{"quote":"b","load_bearing":false},{"quote":"c-unfinis';
    const r = salvagePartialJson(cut);
    assert.equal(r.ok, true);
    assert.equal(r.salvaged, true);
    assert.equal(r.value.position.summary, 'S');
    assert.equal(r.value.key_assertions.length, 2, 'the incomplete third atom is dropped, not repaired');
    assert.deepEqual(r.value.key_assertions.map((a) => a.quote), ['a', 'b']);
});

test('salvagePartialJson: braces and brackets inside strings do not confuse the scan', () => {
    const cut = '{"key_assertions":[{"quote":"he said [not] a {real} brace","load_bearing":true},{"quote":"x';
    const r = salvagePartialJson(cut);
    assert.equal(r.ok, true);
    assert.equal(r.value.key_assertions.length, 1);
    assert.equal(r.value.key_assertions[0].quote, 'he said [not] a {real} brace');
});

test('salvagePartialJson: an escaped quote inside a string does not end it', () => {
    const cut = '{"key_assertions":[{"quote":"she said \\"stop\\" firmly","load_bearing":false},{"quo';
    const r = salvagePartialJson(cut);
    assert.equal(r.ok, true);
    assert.equal(r.value.key_assertions[0].quote, 'she said "stop" firmly');
});

test('salvagePartialJson: refuses when nothing complete exists yet', () => {
    assert.equal(salvagePartialJson('{"key_assertions":[{"quote":"only-partial').ok, false);
    assert.equal(salvagePartialJson('').ok, false);
    assert.equal(salvagePartialJson(null).ok, false);
});

test('a truncated map call salvages to its complete atoms and flags it', () => {
    const cut = '{"position":{"summary":"S"},"key_assertions":[{"quote":"a","text":"A","load_bearing":true},{"quote":"b-cut';
    const { message, salvaged } = run(sse(TOOL_EVENTS([cut], 'max_tokens')), { salvage: true });
    assert.equal(salvaged, true, 'the caller must be told the extract is short');
    assert.equal(message.stop_reason, 'max_tokens');
    assert.equal(message.content[0].input.key_assertions.length, 1);
});

test('salvage is OFF by default — a partial audit must not read as a complete one', () => {
    const cut = '{"modules":[{"name":"one","score":80},{"name":"tw';
    const { message, salvaged } = run(sse(TOOL_EVENTS([cut], 'max_tokens')));
    assert.equal(salvaged, false);
    assert.equal(message.content.length, 0);
});

test('onProgress observes the stream without being able to break it', () => {
    const seen = [];
    const body = sse(TOOL_EVENTS(['{"key_assertions":[]}']));
    run(body, {
        onProgress: (p) => { seen.push(p.type); throw new Error('a broken progress sink'); }
    });
    assert.ok(seen.includes('start') && seen.includes('delta'), 'progress fired');
    // Reaching here at all is the assertion: the throw was contained.
});
