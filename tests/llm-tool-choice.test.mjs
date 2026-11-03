// Tool choice per model. Every X-Ray pass makes the model answer
// through one tool, and until 2026-09 each pass FORCED it
// (`tool_choice: {type: 'tool'}`). Claude Fable 5.1, Opus 5.5 and
// Sonnet 5.5 reject a forced tool with a 400, so the roster now says,
// model by model, whether a pass may force; every other id gets `auto`
// plus a system line naming the tool, and one follow-up turn when a
// reply ends in prose without it.
//
// What makes this file fail: a pass that builds its own `tool_choice`
// again (the seam table sends every exported pass to a model that
// rejects forcing), a roster line with no `force_tool` answer, a
// follow-up that loses the signature of the thinking block it echoes,
// or a follow-up that repeats.
//
// [INTERPRETATION: Claude, 2026-09-29 — default: the three models reject forced tool_choice, as Anthropic's migration notes say; ask: does the live walk on each model confirm it?]
// Provenance: INTERPRETATION (2026-09-29) — expires 2026-12-28

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sseResponse } from './helpers/sse.mjs';

// The prompt module's import chain reaches storage.js, which needs a
// `chrome` at load time; the seam tests below read their key, model and
// flags from the same stub.
await import('fake-indexeddb/auto');
const _store = {};
globalThis.chrome = globalThis.chrome || {
    storage: {
        local: {
            get(keys, cb) {
                const out = {};
                const list = Array.isArray(keys) ? keys : (typeof keys === 'string' ? [keys] : Object.keys(_store));
                for (const k of list) { if (k in _store) out[k] = _store[k]; }
                cb(out);
            },
            set(obj, cb) { Object.assign(_store, obj); cb && cb(); },
            remove(keys, cb) { for (const k of (Array.isArray(keys) ? keys : [keys])) delete _store[k]; cb && cb(); }
        },
        session: {
            get(_keys, cb) { cb({}); },
            set(_obj, cb) { cb && cb(); }
        }
    }
};

const {
    LLM_MODELS, modelForcesTool, withToolChoice, toolNudgeText
} = await import('../src/shared/llm-prompts.js');

const NEW_GENERATION = ['claude-fable-5-1', 'claude-opus-5-5', 'claude-sonnet-5-5'];

// ---- the roster -------------------------------------------------------------

test('every roster line answers force_tool — a new model cannot inherit a guess', () => {
    for (const m of LLM_MODELS) {
        assert.equal(typeof m.force_tool, 'boolean', `${m.id} must say whether a pass may force its tool`);
    }
});

test('the models that reject a forced tool are never forced', () => {
    for (const id of NEW_GENERATION) {
        assert.ok(LLM_MODELS.some((m) => m.id === id), `${id} is offered`);
        assert.equal(modelForcesTool(id), false, id);
    }
});

test('an id the roster does not list gets auto — the choice every model accepts', () => {
    assert.equal(modelForcesTool('claude-from-the-future'), false);
    assert.equal(modelForcesTool(undefined), false);
});

// ---- withToolChoice ---------------------------------------------------------

const BASE = Object.freeze({
    model: 'claude-sonnet-5',
    max_tokens: 1000,
    system: 'SYSTEM PROMPT',
    tools: [{ name: 'emit_thing', input_schema: { type: 'object' } }],
    messages: [{ role: 'user', content: 'BODY' }]
});

test('a model that accepts forcing gets the request every pass sent before', () => {
    const out = withToolChoice(BASE, 'emit_thing');
    assert.deepEqual(out.tool_choice, { type: 'tool', name: 'emit_thing' });
    assert.equal(out.system, 'SYSTEM PROMPT', 'no steering line on the forced path');
    assert.deepEqual(out.messages, BASE.messages);
    assert.equal(BASE.tool_choice, undefined, 'the input payload is not mutated');
});

test('a model that rejects forcing gets auto, one call at most, and a system line naming the tool', () => {
    const out = withToolChoice({ ...BASE, model: 'claude-opus-5-5' }, 'emit_thing');
    assert.deepEqual(out.tool_choice, { type: 'auto', disable_parallel_tool_use: true },
        'auto never guarantees one call; at most one keeps extractToolInput from dropping a second');
    assert.ok(out.system.startsWith('SYSTEM PROMPT\n\n'), 'the pass prompt comes first, unchanged');
    assert.match(out.system.slice('SYSTEM PROMPT'.length), /emit_thing/);
    assert.deepEqual(out.messages, BASE.messages, 'the user turn is untouched');
});

test('a block-array system gets the line as one more text block', () => {
    const system = [{ type: 'text', text: 'SYSTEM PROMPT' }];
    const out = withToolChoice({ ...BASE, model: 'claude-opus-5-5', system }, 'emit_thing');
    assert.equal(out.system.length, 2);
    assert.deepEqual(out.system[0], system[0]);
    assert.equal(out.system[1].type, 'text');
    assert.match(out.system[1].text, /emit_thing/);
});

test('the follow-up turn names the tool', () => {
    assert.match(toolNudgeText('emit_thing'), /emit_thing/);
});

// ---- the seam: every pass, as it goes over the wire -------------------------

const client = await import('../src/shared/llm-client.js');
const { LLM_KEY_STORAGE, LLM_MODEL_STORAGE } = client;
const { MODULE_NAMES } = await import('../src/shared/audit/findings-schemas.js');
const { VISION_MEDIA_TYPES } = await import('../src/shared/vision-prompts.js');
const { JurisdictionModel } = await import('../src/shared/jurisdiction-model.js');

// Each queued reply is a Messages response, a function of the request
// body that returns one, or { httpStatus } for an HTTP error. With the
// queue empty the stub answers with the requested tool and an empty input.
let requests = [];
let replies = [];
const toolReply = (body, input) => ({
    stop_reason: 'tool_use',
    content: [{ type: 'tool_use', id: `tu_${requests.length}`, name: body.tools[0].name, input }]
});
globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    requests.push(body);
    let next = replies.length ? replies.shift() : (b) => toolReply(b, {});
    if (typeof next === 'function') next = next(body);
    if (next.httpStatus) {
        return { ok: false, status: next.httpStatus, text: async () => '{"error":{"message":"boom"}}' };
    }
    return sseResponse({ model: 'claude-test', usage: { input_tokens: 1, output_tokens: 1 }, ...next });
};

function arm(model, queue = []) {
    for (const k of Object.keys(_store)) delete _store[k];
    _store[LLM_KEY_STORAGE] = 'sk-test-key';
    _store[LLM_MODEL_STORAGE] = model;
    _store['xray:flags'] = { llmAssist: true, caseSynthesis: true, aiVision: true, moralLens: true };
    requests = [];
    replies = queue;
}

const systemText = (s) => (Array.isArray(s) ? s.map((b) => b.text).join('\n\n') : String(s || ''));

// One call per exported pass, each with the smallest request its own
// gates accept.
const PASSES = {
    runEntityAuditPass:    () => client.runEntityAuditPass({ digest: 'DIGEST' }),
    runForensicCorpusPass: () => client.runForensicCorpusPass({ bundle: 'BUNDLE' }),
    runAuditPass:          () => client.runAuditPass({ markdown: 'BODY' }),
    runAuditModulePass:    () => client.runAuditModulePass({ module: MODULE_NAMES[0], markdown: 'BODY' }),
    runCorpusMapPass:      () => client.runCorpusMapPass({ member_id: 'm', memberText: 'BODY' }),
    runCorpusReducePass:   () => client.runCorpusReducePass({ dossierDigest: 'd', extracts: [{ article_hash: 'h', extract: {} }] }),
    runEntityPagePass:     () => client.runEntityPagePass({ entityDigest: 'd', extracts: [{ article_hash: 'h', extract: {} }] }),
    runHypothesisEdgePass: () => client.runHypothesisEdgePass({ dossierDigest: 'd', hypotheses: [{ id: 'H1', label: 'H' }] }),
    runClaimLinksPass:     () => client.runClaimLinksPass({ claims: [{ id: 'c1', text: 'a' }, { id: 'c2', text: 'b' }] }),
    runVisionPass:         () => client.runVisionPass({ imageBase64: 'AAAA', mediaType: VISION_MEDIA_TYPES[0] }),
    runLensPass:           async () => {
        const j = await JurisdictionModel.create({
            jurisdiction_type: 'worldview',
            display_name: 'Christianity (multi-tradition)',
            internal_divisions: ['Catholic social teaching', 'Reformed'],
            corpus: [{
                citation: { work: 'Bible (NRSV)', edition: 'NRSV UE 2021', locator: 'Matthew 20:25-28', language: 'en' },
                excerpt: 'whoever wishes to be first among you must be your slave',
                admissibility: 'published-scripture'
            }]
        });
        return client.runLensPass({
            jurisdictionId: j.id, articleText: 'BODY',
            claims: [{ id: 'c1', text: 'Men should step down from hierarchy.', type: 'normative' }]
        });
    },
    runExtractPass:        () => client.runExtractPass({ pdfBase64: 'JVBERi0=', mode: 'structure' })
};

test('the seam table covers every pass the client exports', () => {
    const exported = Object.keys(client).filter((k) => /^run\w*Pass$/.test(k)).sort();
    assert.deepEqual(Object.keys(PASSES).sort(), exported,
        'a new pass joins this table, so its request is checked on both kinds of model');
});

for (const [name, run] of Object.entries(PASSES)) {
    test(`${name}: a model that rejects forcing gets auto, at most one call, and a line naming the tool`, async () => {
        arm('claude-opus-5-5');
        await run();
        const first = requests[0];
        assert.ok(first, `${name} sent no request`);
        assert.equal(first.model, 'claude-opus-5-5');
        assert.equal(first.tools.length, 1);
        assert.deepEqual(first.tool_choice, { type: 'auto', disable_parallel_tool_use: true });
        assert.match(systemText(first.system), new RegExp(`calling the ${first.tools[0].name} tool`));
    });

    test(`${name}: a model that accepts forcing gets its tool forced and no extra line`, async () => {
        arm('claude-sonnet-5');
        await run();
        const first = requests[0];
        assert.ok(first, `${name} sent no request`);
        assert.deepEqual(first.tool_choice, { type: 'tool', name: first.tools[0].name });
        assert.doesNotMatch(systemText(first.system), /X-Ray reads only that tool's input/);
    });
}

// ---- the follow-up turn -----------------------------------------------------

// What Opus 5.5 sends when it answers in prose: a thinking block (its
// text omitted by default, its signature present) and then text.
const PROSE = {
    stop_reason: 'end_turn',
    content: [
        { type: 'thinking', thinking: '', signature: 'SIG-1' },
        { type: 'text', text: 'Here is what I found in the registry.' }
    ]
};
const auditOnce = () => client.runEntityAuditPass({ digest: 'DIGEST' });

test('an auto reply that skips the tool gets ONE follow-up turn, and the pass succeeds', async () => {
    arm('claude-opus-5-5', [PROSE, (b) => toolReply(b, { ops: [] })]);
    const res = await auditOnce();
    assert.equal(res.ok, true, `expected the follow-up answer to serve (got: ${res.error || 'ok'})`);
    assert.equal(requests.length, 2);

    const [first, second] = requests;
    // Thinking blocks are bound to the exact conversation that produced
    // them, so the follow-up keeps everything before them byte-identical.
    assert.equal(second.system, first.system);
    assert.deepEqual(second.tools, first.tools);
    assert.deepEqual(second.tool_choice, first.tool_choice);
    assert.deepEqual(second.messages[0], first.messages[0]);
    assert.deepEqual(second.messages.map((m) => m.role), ['user', 'assistant', 'user']);

    const echoed = second.messages[1].content;
    assert.deepEqual(echoed.map((b) => b.type), ['thinking', 'text'], 'the whole reply goes back');
    assert.equal(echoed[0].signature, 'SIG-1', 'an unsigned thinking block would be rejected');
    assert.match(second.messages[2].content, new RegExp(first.tools[0].name));
});

test('a second reply without the tool fails honestly — never a third call', async () => {
    arm('claude-opus-5-5', [PROSE, PROSE]);
    const res = await auditOnce();
    assert.equal(res.ok, false);
    assert.match(res.error, /did not return a structured op list/);
    assert.equal(requests.length, 2);
});

test('a cut-off or refused reply is reported as it is, with no follow-up', async () => {
    arm('claude-opus-5-5', [{ stop_reason: 'max_tokens', content: [{ type: 'text', text: 'partial' }] }]);
    let res = await auditOnce();
    assert.match(res.error, /output limit/);
    assert.equal(requests.length, 1);

    arm('claude-opus-5-5', [{ stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber' }, content: [] }]);
    res = await auditOnce();
    assert.equal(res.refused, true);
    assert.equal(requests.length, 1);
});

test('a model that accepts forcing is never sent a follow-up', async () => {
    arm('claude-sonnet-5', [PROSE]);
    const res = await auditOnce();
    assert.equal(res.ok, false);
    assert.equal(requests.length, 1);
});

// Failure results travel: the job runner persists them and the reader
// shows them. The request's messages carry the article (or the image,
// or the PDF), so they must never ride along.
test('a failed call carries none of the request back out', async () => {
    arm('claude-opus-5-5', [{ httpStatus: 500 }]);
    let res = await auditOnce();
    assert.equal(res.ok, false);
    assert.equal('messages' in res, false);
    assert.doesNotMatch(JSON.stringify(res), /DIGEST/);

    arm('claude-opus-5-5', [PROSE, { httpStatus: 500 }]);
    res = await auditOnce();
    assert.equal(res.ok, false);
    assert.equal(requests.length, 2);
    assert.equal('messages' in res, false);
    assert.doesNotMatch(JSON.stringify(res), /DIGEST/);
});
