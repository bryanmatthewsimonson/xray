// Newer models from the user's own Anthropic account. The Options
// picker lists, beside the built-in roster, the models the saved key
// can call that are newer than the roster (Anthropic's Models API), and
// every pass can run on one: the worker resolves the stored choice
// against the discovered list and clamps output to the ceiling the API
// reported for that model (JOURNAL 2026-09-29).
//
// What makes this file fail: a listed model the filter should drop
// (older than the roster, already in it, a malformed id) reaching the
// picker or the wire; a discovered choice replaced by the default while
// it is still listed; a failed refresh wiping the list the worker
// resolves against; an output ceiling guessed when the API gave one.
//
// [INTERPRETATION: Claude, 2026-09-29 — default: offer models created after ROSTER_AS_OF that the roster does not name, newest first, at most ten; ask: is "newer than the roster" the right cut, or should every listed model show?]
// Provenance: INTERPRETATION (2026-09-29) — expires 2026-12-28

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sseResponse } from './helpers/sse.mjs';

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
    },
    runtime: { getURL: (p = '') => `chrome-extension://xray-test/${p}` }
};

const {
    ROSTER_AS_OF, LLM_DISCOVERED_MODELS_STORAGE, LLM_MODEL_STORAGE, LLM_KEY_STORAGE,
    SAFE_OUTPUT_CEILING, DEFAULT_LLM_MODEL,
    newerThanRoster, resolveModel, modelOutputCeiling
} = await import('../src/shared/llm-prompts.js');
const client = await import('../src/shared/llm-client.js');
const { pickerEntries, NEWER_GROUP_LABEL } = await import('../src/options/llm-models.js');
const { LLM_MODELS } = await import('../src/shared/llm-prompts.js');

const DAY = 86400000;
const after = (days) => new Date(Date.parse(ROSTER_AS_OF) + days * DAY).toISOString();
/** One entry the way GET /v1/models lists it. */
const listed = (id, days, extra = {}) => ({
    type: 'model', id, display_name: `Claude ${id.slice(7)}`, created_at: after(days), max_tokens: 128000, ...extra
});

// ---- the filter -------------------------------------------------------------

test('a model created after the roster and missing from it is offered, in the roster\'s shape', () => {
    assert.deepEqual(newerThanRoster([listed('claude-opus-6', 10)]), [
        { id: 'claude-opus-6', label: 'Claude opus-6', created_at: after(10), max_output: 128000 }
    ]);
});

test('models the roster names, older models and malformed ids stay out', () => {
    const out = newerThanRoster([
        listed('claude-opus-5-5', 30),              // the roster already offers it
        listed('claude-opus-4-6', -300),            // older: left out of the roster on purpose
        listed('gpt-9', 5),                         // not a Claude id
        listed('claude-<b>x</b>', 5),               // rides back to Anthropic as `model`
        listed('', 5),
        { id: 'claude-no-date-1', display_name: 'x' },
        listed('claude-fine-1', 1)
    ]);
    assert.deepEqual(out.map((m) => m.id), ['claude-fine-1']);
});

test('newest first, at most ten, each id once', () => {
    const many = Array.from({ length: 12 }, (_, i) => listed(`claude-m-${i + 1}`, i + 1));
    const out = newerThanRoster([...many, listed('claude-m-12', 12)]);
    assert.equal(out.length, 10);
    assert.equal(out[0].id, 'claude-m-12');
    assert.equal(new Set(out.map((m) => m.id)).size, out.length);
});

test('a bad name falls back to the id; a bad max_tokens is left out', () => {
    const [bad] = newerThanRoster([listed('claude-a-1', 3, { display_name: 42, max_tokens: -5 })]);
    assert.equal(bad.label, 'claude-a-1');
    assert.equal('max_output' in bad, false, 'no ceiling is better than a wrong one: the safe floor applies');
    const [long] = newerThanRoster([listed('claude-b-1', 3, { display_name: 'x'.repeat(500) })]);
    assert.ok(long.label.length <= 80);
});

test('normalizing is idempotent, so the stored list re-reads as itself', () => {
    const once = newerThanRoster([listed('claude-opus-6', 10), listed('claude-sonnet-6', 12, { max_tokens: 64000 })]);
    assert.deepEqual(newerThanRoster(once), once);
    assert.deepEqual(newerThanRoster(undefined), []);
    assert.deepEqual(newerThanRoster('nope'), []);
});

test('resolveModel keeps a discovered choice only while it is listed', () => {
    const d = newerThanRoster([listed('claude-opus-6', 10)]);
    assert.equal(resolveModel('claude-opus-6', d), 'claude-opus-6');
    assert.equal(resolveModel('claude-opus-6', []), DEFAULT_LLM_MODEL);
    assert.equal(resolveModel('claude-opus-6'), DEFAULT_LLM_MODEL);
});

test('a discovered model\'s output ceiling is the one the API reported', () => {
    const d = newerThanRoster([
        listed('claude-opus-6', 10, { max_tokens: 20000 }),
        listed('claude-sonnet-6', 11, { max_tokens: undefined })
    ]);
    assert.equal(modelOutputCeiling('claude-opus-6', d), 20000);
    assert.equal(modelOutputCeiling('claude-sonnet-6', d), SAFE_OUTPUT_CEILING);
    assert.equal(modelOutputCeiling('claude-haiku-4-5', d), 64000, 'the roster still answers for its own models');
});

// ---- the refresh (the worker's Models API call) -----------------------------

let calls = [];
let modelsReply = null;   // { status, body } | Error | { unreadable: true }
const passRequests = [];
globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).startsWith('https://api.anthropic.com/v1/models')) {
        if (modelsReply instanceof Error) throw modelsReply;
        return {
            ok: modelsReply.status >= 200 && modelsReply.status < 300,
            status: modelsReply.status,
            json: async () => { if (modelsReply.unreadable) throw new SyntaxError('bad json'); return modelsReply.body; },
            text: async () => JSON.stringify(modelsReply.body || {})
        };
    }
    const body = JSON.parse(init.body);
    passRequests.push(body);
    return sseResponse({
        model: body.model, stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 },
        content: [{ type: 'tool_use', id: 'tu_1', name: body.tools[0].name, input: { ops: [] } }]
    });
};

function arm({ key = 'sk-test-key', model, stored } = {}) {
    for (const k of Object.keys(_store)) delete _store[k];
    if (key) _store[LLM_KEY_STORAGE] = key;
    if (model) _store[LLM_MODEL_STORAGE] = model;
    if (stored) _store[LLM_DISCOVERED_MODELS_STORAGE] = stored;
    _store['xray:flags'] = { llmAssist: true };
    calls = [];
    passRequests.length = 0;
}

const STORED_OPUS_6 = Object.freeze({
    fetched_at: '2026-10-01T00:00:00.000Z',
    models: newerThanRoster([listed('claude-opus-6', 10, { max_tokens: 20000 })])
});

test('a refresh asks the Models API with the saved key and stores only the newer models', async () => {
    arm();
    modelsReply = { status: 200, body: { data: [
        listed('claude-opus-6', 10), listed('claude-opus-5-5', 30), listed('claude-3-haiku-20240307', -900)
    ], has_more: false } };
    const res = await client.refreshDiscoveredModels();
    assert.equal(res.ok, true, res.error);
    assert.deepEqual(res.models.map((m) => m.id), ['claude-opus-6']);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.anthropic.com/v1/models?limit=1000');
    assert.equal(calls[0].init.method || 'GET', 'GET');
    assert.equal(calls[0].init.headers['x-api-key'], 'sk-test-key');
    assert.equal(calls[0].init.headers['anthropic-version'], '2023-06-01');

    const stored = _store[LLM_DISCOVERED_MODELS_STORAGE];
    assert.deepEqual(stored.models, res.models);
    assert.ok(!Number.isNaN(Date.parse(stored.fetched_at)));
    assert.doesNotMatch(JSON.stringify(res), /sk-test-key/, 'the page never sees the key');
});

test('with no key saved there is no network call', async () => {
    arm({ key: null });
    const res = await client.refreshDiscoveredModels();
    assert.equal(res.ok, false);
    assert.equal(calls.length, 0);
});

test('a rejected key, a network failure or an unreadable reply leaves the stored list as it was', async () => {
    for (const reply of [
        { status: 401, body: { error: { message: 'invalid x-api-key' } } },
        new TypeError('Failed to fetch'),
        { status: 200, unreadable: true }
    ]) {
        arm({ stored: STORED_OPUS_6 });
        modelsReply = reply;
        const res = await client.refreshDiscoveredModels();
        assert.equal(res.ok, false);
        assert.equal(typeof res.error, 'string');
        assert.deepEqual(_store[LLM_DISCOVERED_MODELS_STORAGE], STORED_OPUS_6);
    }
});

// ---- a pass on a discovered model -------------------------------------------

test('a pass runs on a discovered model, on auto tool choice and the API\'s output ceiling', async () => {
    arm({ model: 'claude-opus-6', stored: STORED_OPUS_6 });
    const res = await client.runEntityAuditPass({ digest: 'DIGEST' });
    assert.equal(res.ok, true, res.error);
    const req = passRequests[0];
    assert.equal(req.model, 'claude-opus-6');
    assert.deepEqual(req.tool_choice, { type: 'auto', disable_parallel_tool_use: true },
        'a model X-Ray has not vetted is never sent a forced tool');
    assert.equal(req.max_tokens, 20000, 'clamped to the ceiling the Models API reported');
});

test('a discovered choice no longer listed falls back to the default model', async () => {
    arm({ model: 'claude-opus-6', stored: { fetched_at: '2026-10-02T00:00:00.000Z', models: [] } });
    await client.runEntityAuditPass({ digest: 'DIGEST' });
    assert.equal(passRequests[0].model, DEFAULT_LLM_MODEL);
});

// ---- the picker ---------------------------------------------------------------

test('the picker lists the roster, then the newer models in their own group', () => {
    const entries = pickerEntries(newerThanRoster([listed('claude-opus-6', 10), listed('claude-sonnet-6', 11)]));
    assert.deepEqual(entries.slice(0, LLM_MODELS.length),
        LLM_MODELS.map((m) => ({ group: null, id: m.id, label: m.label })));
    assert.deepEqual(entries.slice(LLM_MODELS.length), [
        { group: NEWER_GROUP_LABEL, id: 'claude-sonnet-6', label: 'Claude sonnet-6' },
        { group: NEWER_GROUP_LABEL, id: 'claude-opus-6', label: 'Claude opus-6' }
    ]);
    assert.match(NEWER_GROUP_LABEL, /not yet verified/);
    assert.equal(pickerEntries([]).length, LLM_MODELS.length, 'no group at all when nothing newer is listed');
});

// ---- the worker's door ----------------------------------------------------------

test('the worker answers the model list for extension pages only', async () => {
    const { respondLlmModels } = await import('../src/background/llm-models.js');
    let refreshed = 0;
    const refresh = async () => { refreshed += 1; return { ok: true, models: [] }; };

    // A content script's sender carries the web page's URL; a look-alike
    // origin and a missing sender are refused the same way, at once.
    for (const sender of [
        { url: 'https://evil.example/page', tab: { id: 3 } },
        { url: 'chrome-extension://xray-test.evil/options.html' },
        { tab: { id: 3 } },
        undefined
    ]) {
        let answer = null;
        const pending = respondLlmModels((r) => { answer = r; }, sender, { refresh });
        assert.equal(pending, false, 'refused synchronously');
        assert.equal(answer && answer.ok, false);
    }
    assert.equal(refreshed, 0, 'no refused sender reaches the Models API');

    let answer = null;
    const pending = respondLlmModels((r) => { answer = r; },
        { url: 'chrome-extension://xray-test/src/options/options.html' }, { refresh });
    assert.equal(pending, true);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(answer, { ok: true, models: [] });
    assert.equal(refreshed, 1);
});
