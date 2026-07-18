// LLM extraction assist — the wiring I own (Phase 18 C5):
// the §6.3/§7 wire mirror on 30023, its read-back, the prompt/tool
// module, and runExtractPass's consent gates + span plumbing.
// The re-grounding engine itself is tested in tests/llm-extract.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// Stateful storage stub (the audit-llm pattern): consent-gate tests
// need get() to reflect what set() stored.
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

const { EventBuilder } = await import('../src/shared/event-builder.js');
const {
    EXTRACT_TOOL_NAME, EXTRACT_PROMPT_VERSION, MAX_EXTRACT_PAGES, MAX_EXTRACT_BYTES,
    buildExtractTool, buildExtractSystemPrompt, buildExtractUserContent
} = await import('../src/shared/llm-extract-prompts.js');
const { runExtractPass, LLM_KEY_STORAGE } = await import('../src/shared/llm-client.js');

const PUBKEY = '6daa7f3b0f5a4c8e9b2d1a7c3e5f80916d4b2a8c7e1f3059d8b6a4c2e0f19375';

// ------------------------------------------------------------------
// The wire mirror (§6.3/§7) — ADDITIVE tags, called out as a
// wire-format change in the PR. Consumers skip unknown tags.
// ------------------------------------------------------------------

test('wire: extraction method + source_hash mirror as additive 30023 tags', async () => {
    const ev = await EventBuilder.buildArticleEvent({
        url: 'https://example.com/paper.pdf',
        title: 'T',
        markdown: 'Body.',
        content: 'Body.',
        _contentIsMarkdown: true,
        contentType: 'pdf',
        extraction: {
            method: 'llm:claude-opus-4-8',
            source_hash: 'a'.repeat(64),
            page_count: 12,
            archived: true,
            unverified_spans: 3
        }
    }, [], PUBKEY);
    const em = ev.tags.find((t) => t[0] === 'extraction-method');
    const sh = ev.tags.find((t) => t[0] === 'source-hash');
    assert.deepEqual(em, ['extraction-method', 'llm:claude-opus-4-8']);
    assert.deepEqual(sh, ['source-hash', 'a'.repeat(64)]);
    assert.equal(ev.tags.some((t) => t[0] === 'unverified-spans'), false,
        'unverified_spans describes the reconstruction session, not the published text — local only');
});

test('wire: no extraction record, no tags — the common case is unchanged', async () => {
    const ev = await EventBuilder.buildArticleEvent({
        url: 'https://example.com/a', title: 'T', content: '<p>Body.</p>'
    }, [], PUBKEY);
    assert.equal(ev.tags.some((t) => t[0] === 'extraction-method'), false);
    assert.equal(ev.tags.some((t) => t[0] === 'source-hash'), false);
});

test('wire: read-back round-trips the two mirrored fields, and ONLY those', async () => {
    const ev = await EventBuilder.buildArticleEvent({
        url: 'https://example.com/paper.pdf', title: 'T',
        markdown: 'Body.', content: 'Body.', _contentIsMarkdown: true, contentType: 'pdf',
        extraction: { method: 'pdfjs-4.10+llm:m', source_hash: 'b'.repeat(64), page_count: 5, archived: true }
    }, [], PUBKEY);
    const back = EventBuilder.reconstructArticleFromEvent(ev);
    assert.equal(back.extraction.method, 'pdfjs-4.10+llm:m');
    assert.equal(back.extraction.source_hash, 'b'.repeat(64));
    assert.equal('page_count' in back.extraction, false,
        'a reconstructed extraction record is deliberately smaller than a local one');
});

test('wire: a non-extracted event reads back with NO extraction key', async () => {
    const ev = await EventBuilder.buildArticleEvent({
        url: 'https://example.com/a', title: 'T', content: '<p>Body.</p>'
    }, [], PUBKEY);
    const back = EventBuilder.reconstructArticleFromEvent(ev);
    assert.equal('extraction' in back, false);
});

test('wire: the transcription banner trigger survives a relay round trip', async () => {
    // The reader banners on /^llm:/ method — a relay copy of a
    // transcribed scan must still carry the marker.
    const ev = await EventBuilder.buildArticleEvent({
        url: 'https://example.com/scan.pdf', title: 'T',
        markdown: 'Transcribed.', content: 'Transcribed.', _contentIsMarkdown: true, contentType: 'pdf',
        extraction: { method: 'llm:claude-opus-4-8', source_hash: 'c'.repeat(64) }
    }, [], PUBKEY);
    const back = EventBuilder.reconstructArticleFromEvent(ev);
    assert.match(back.extraction.method, /^llm:/);
});

// ------------------------------------------------------------------
// The prompt/tool module
// ------------------------------------------------------------------

test('prompts: tool schema forces the span contract', () => {
    const tool = buildExtractTool();
    assert.equal(tool.name, EXTRACT_TOOL_NAME);
    assert.deepEqual(tool.input_schema.required, ['spans']);
    const span = tool.input_schema.properties.spans.items;
    assert.deepEqual(span.properties.kind.enum, ['heading', 'paragraph', 'caption', 'table']);
    assert.ok(span.properties.cells, 'tables carry rows of cell strings');
    assert.ok(span.properties.page, 'page hints feed the pageMap');
});

test('prompts: the two modes differ where the honesty model differs', () => {
    const structure = buildExtractSystemPrompt('structure');
    const transcription = buildExtractSystemPrompt('transcription');
    assert.notEqual(structure, transcription);
    assert.match(structure, /matched back against the deterministic text/i,
        'structure mode tells the model paraphrase = discarded');
    assert.match(transcription, /\[illegible\]/,
        'transcription mode prefers honest gaps over guesses');
    for (const p of [structure, transcription]) {
        assert.match(p, /VERBATIM/i, 'both modes demand verbatim copying');
    }
});

test('prompts: user content is a document block plus one instruction', () => {
    const content = buildExtractUserContent('QkFTRTY0');
    assert.equal(content[0].type, 'document');
    assert.equal(content[0].source.media_type, 'application/pdf');
    assert.equal(content[0].source.data, 'QkFTRTY0');
    assert.equal(content[1].type, 'text');
});

test('prompts: the RAW-byte cap leaves room for base64 inflation inside the 32MB request', () => {
    assert.equal(MAX_EXTRACT_PAGES, 100);
    // The request carries the bytes base64-encoded (×4/3) plus JSON and
    // prompt overhead. A "30MB with headroom" raw cap produced a ~40MB
    // request and a guaranteed post-consent API rejection — the cap must
    // bound the ENCODED size (adversarial-review regression).
    const encoded = Math.ceil(MAX_EXTRACT_BYTES / 3) * 4;
    assert.ok(encoded + 1024 * 1024 < 32 * 1024 * 1024,
        `base64(${MAX_EXTRACT_BYTES}) = ${encoded} must fit the 32MB request with >=1MB overhead room`);
    assert.equal(typeof EXTRACT_PROMPT_VERSION, 'string');
});

// ------------------------------------------------------------------
// runExtractPass — consent gates + span plumbing (mocked fetch)
// ------------------------------------------------------------------

function resetStore() { for (const k of Object.keys(_store)) delete _store[k]; }

test('extract pass: refused with llmAssist off, and with no key', async () => {
    resetStore();
    _store['xray:flags'] = JSON.stringify({ llmAssist: false });
    let res = await runExtractPass({ pdfBase64: 'QQ==', mode: 'structure' });
    assert.equal(res.ok, false);
    assert.match(res.error, /LLM assist is off/);

    _store['xray:flags'] = JSON.stringify({ llmAssist: true });
    res = await runExtractPass({ pdfBase64: 'QQ==', mode: 'structure' });
    assert.equal(res.ok, false);
    assert.match(res.error, /No Anthropic API key/);
});

test('extract pass: returns the forced tool\'s spans; never trusts a missing tool block', async () => {
    resetStore();
    _store['xray:flags'] = JSON.stringify({ llmAssist: true });
    _store[LLM_KEY_STORAGE] = 'sk-test-key';

    const originalFetch = globalThis.fetch;
    try {
        // Happy path: a tool_use block with spans.
        globalThis.fetch = async () => ({
            ok: true,
            json: async () => ({
                model: 'claude-test',
                stop_reason: 'tool_use',
                content: [{ type: 'tool_use', name: EXTRACT_TOOL_NAME,
                    input: { spans: [{ kind: 'paragraph', text: 'Hello.', page: 1 }] } }]
            })
        });
        let res = await runExtractPass({ pdfBase64: 'QQ==', mode: 'transcription' });
        assert.equal(res.ok, true);
        assert.equal(res.spans.length, 1);
        assert.equal(res.model, 'claude-test');

        // No tool block → a clear failure, never a silent empty success.
        globalThis.fetch = async () => ({
            ok: true,
            json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'I refuse.' }] })
        });
        res = await runExtractPass({ pdfBase64: 'QQ==', mode: 'structure' });
        assert.equal(res.ok, false);
        assert.match(res.error, /did not return structured spans/);

        // max_tokens → the honest too-long error.
        globalThis.fetch = async () => ({
            ok: true,
            json: async () => ({ stop_reason: 'max_tokens', content: [] })
        });
        res = await runExtractPass({ pdfBase64: 'QQ==', mode: 'structure' });
        assert.equal(res.ok, false);
        assert.match(res.error, /too long/);
    } finally {
        globalThis.fetch = originalFetch;
        resetStore();
    }
});

test('extract pass: no bytes, no call', async () => {
    resetStore();
    _store['xray:flags'] = JSON.stringify({ llmAssist: true });
    _store[LLM_KEY_STORAGE] = 'sk-test-key';
    const res = await runExtractPass({ mode: 'structure' });
    assert.equal(res.ok, false);
    assert.match(res.error, /No document bytes/);
    resetStore();
});
