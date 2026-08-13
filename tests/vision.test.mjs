// AI vision — the "Describe images" pass: prompt/tool shape, image
// byte handling, the consent gates (which must refuse pre-network),
// the request wire shape, and the pure collect/upsert note merge.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sseResponse } from './helpers/sse.mjs';

await import('fake-indexeddb/auto');
// Stateful storage stub: the consent-gate tests (aiVision flag + API
// key) need get() to reflect what set() stored.
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
function resetStore() { for (const k of Object.keys(_store)) delete _store[k]; }

const {
    VISION_TOOL_NAME, VISION_MEDIA_TYPES, VISION_CONTENT_KINDS,
    MAX_VISION_RAW_BYTES, VISION_TARGET_DIMENSION, VISION_PROMPT_VERSION,
    buildVisionTool, buildVisionSystemPrompt, buildVisionUserContent
} = await import('../src/shared/vision-prompts.js');
const {
    sniffImageMediaType, needsReencode, visionScalePlan,
    bytesToBase64, decodeDataUrl, blockedImageUrl
} = await import('../src/shared/vision-image.js');
const { ContentExtractor } = await import('../src/shared/content-extractor.js');
const { runVisionPass, getVisionConfig, LLM_KEY_STORAGE } = await import('../src/shared/llm-client.js');
const {
    collectArticleImages, buildVisionNoteMarkdown, buildVisionNoteHtml,
    upsertVisionNoteMarkdown, upsertVisionNoteHtml, visionNoteKey
} = await import('../src/shared/vision-notes.js');

const MODEL = 'claude-opus-4-8';

// --- prompts & tool schema ---------------------------------------------------

test('buildVisionTool: forced-tool schema requires caption + transcription', () => {
    const tool = buildVisionTool();
    assert.equal(tool.name, VISION_TOOL_NAME);
    const s = tool.input_schema;
    assert.deepEqual(s.required, ['content_kind', 'caption', 'transcription']);
    assert.deepEqual(s.properties.content_kind.enum, VISION_CONTENT_KINDS.slice());
    assert.equal(s.properties.transcription_complete.type, 'boolean');
});

test('system prompt carries the honesty rules', () => {
    const p = buildVisionSystemPrompt();
    assert.match(p, /VERBATIM/);
    assert.match(p, /\[illegible\]/);
    assert.match(p, /No speculation/);
});

test('buildVisionUserContent: image block first, context lines after', () => {
    const content = buildVisionUserContent({
        imageBase64: 'AAAA', mediaType: 'image/png',
        alt: 'a chart', captionText: 'Fig 1', articleTitle: 'T', articleUrl: 'https://x.test/a'
    });
    assert.equal(content.length, 2);
    assert.deepEqual(content[0], {
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: 'AAAA' }
    });
    assert.equal(content[1].type, 'text');
    assert.match(content[1].text, /a chart/);
    assert.match(content[1].text, /Fig 1/);
    assert.match(content[1].text, /https:\/\/x\.test\/a/);
});

// --- image byte handling -----------------------------------------------------

function bytesOf(...vals) {
    const b = new Uint8Array(16);
    vals.forEach((v, i) => { b[i] = v; });
    return b;
}

test('sniffImageMediaType: magic numbers', () => {
    assert.equal(sniffImageMediaType(bytesOf(0xFF, 0xD8, 0xFF, 0xE0)), 'image/jpeg');
    assert.equal(sniffImageMediaType(bytesOf(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)), 'image/png');
    assert.equal(sniffImageMediaType(new Uint8Array([...'GIF89a'].map((c) => c.charCodeAt(0)).concat([0, 0, 0, 0, 0, 0]))), 'image/gif');
    const webp = bytesOf(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50);
    assert.equal(sniffImageMediaType(webp), 'image/webp');
    const avif = new Uint8Array(16);
    avif.set([0, 0, 0, 0x1C, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66]);
    assert.equal(sniffImageMediaType(avif), 'image/avif');
    assert.equal(sniffImageMediaType(bytesOf(0x42, 0x4D)), 'image/bmp');
    assert.equal(sniffImageMediaType(bytesOf(1, 2, 3, 4)), null, 'unknown bytes');
    assert.equal(sniffImageMediaType(new Uint8Array(4)), null, 'too short');
});

test('needsReencode: supported small images pass through, everything else re-encodes', () => {
    const ok = { mediaType: 'image/jpeg', byteLength: 1000, width: 800, height: 600 };
    assert.equal(needsReencode(ok), false);
    assert.equal(needsReencode({ ...ok, mediaType: 'image/avif' }), true, 'unsupported container');
    assert.equal(needsReencode({ ...ok, byteLength: MAX_VISION_RAW_BYTES + 1 }), true, 'over the raw cap');
    assert.equal(needsReencode({ ...ok, width: VISION_TARGET_DIMENSION + 1 }), true, 'over the model-visible size');
    assert.equal(needsReencode(null), true);
});

test('visionScalePlan: clamps the longest side, keeps aspect, never upscales', () => {
    assert.deepEqual(visionScalePlan(800, 600), { width: 800, height: 600 }, 'no upscale');
    const down = visionScalePlan(3136, 1568);
    assert.equal(down.width, VISION_TARGET_DIMENSION);
    assert.equal(down.height, 784);
    const tall = visionScalePlan(100, 15680);
    assert.equal(tall.height, VISION_TARGET_DIMENSION);
    assert.equal(tall.width, 10);
    assert.equal(visionScalePlan(0, 100), null, 'degenerate input');
});

test('bytesToBase64: chunked encode matches btoa', () => {
    const bytes = new Uint8Array(70000);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    assert.equal(bytesToBase64(bytes), btoa(binary));
});

test('decodeDataUrl: base64 data URLs only', () => {
    const d = decodeDataUrl('data:image/png;base64,' + btoa('abc'));
    assert.equal(d.mediaType, 'image/png');
    assert.deepEqual(Array.from(d.bytes), [97, 98, 99]);
    assert.equal(decodeDataUrl('data:image/svg+xml,<svg/>'), null, 'non-base64');
    assert.equal(decodeDataUrl('https://x.test/a.png'), null);
});

// --- consent gates fire BEFORE any network -----------------------------------

async function withFetchTrap(fn) {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => { calls += 1; throw new Error('network call past a consent gate'); };
    try { await fn(); } finally { globalThis.fetch = original; }
    assert.equal(calls, 0, 'no network call reached fetch');
}

function enableVision({ withKey = true } = {}) {
    resetStore();
    _store['xray:flags'] = JSON.stringify({ aiVision: true });
    if (withKey) _store[LLM_KEY_STORAGE] = 'sk-ant-test';
}

test('runVisionPass: flag off refuses pre-network', async () => {
    resetStore();
    _store[LLM_KEY_STORAGE] = 'sk-ant-test';
    await withFetchTrap(async () => {
        const res = await runVisionPass({ imageBase64: 'AAAA', mediaType: 'image/png' });
        assert.equal(res.ok, false);
        assert.match(res.error, /AI vision is off/);
    });
});

test('runVisionPass: llmAssist alone does NOT enable vision (independent consent)', async () => {
    resetStore();
    _store['xray:flags'] = JSON.stringify({ llmAssist: true });
    _store[LLM_KEY_STORAGE] = 'sk-ant-test';
    await withFetchTrap(async () => {
        const res = await runVisionPass({ imageBase64: 'AAAA', mediaType: 'image/png' });
        assert.equal(res.ok, false);
        assert.match(res.error, /AI vision is off/);
    });
});

test('runVisionPass: missing key refuses pre-network', async () => {
    enableVision({ withKey: false });
    await withFetchTrap(async () => {
        const res = await runVisionPass({ imageBase64: 'AAAA', mediaType: 'image/png' });
        assert.equal(res.ok, false);
        assert.match(res.error, /No Anthropic API key/);
    });
});

test('runVisionPass: unsupported media type refuses pre-network', async () => {
    enableVision();
    await withFetchTrap(async () => {
        const res = await runVisionPass({ imageBase64: 'AAAA', mediaType: 'image/avif' });
        assert.equal(res.ok, false);
        assert.match(res.error, /Unsupported image type/);
    });
});

test('getVisionConfig: reports the aiVision flag, never llmAssist', async () => {
    resetStore();
    _store['xray:flags'] = JSON.stringify({ llmAssist: true });
    let cfg = await getVisionConfig();
    assert.equal(cfg.enabled, false);
    assert.equal(cfg.hasKey, false);
    enableVision();
    cfg = await getVisionConfig();
    assert.equal(cfg.enabled, true);
    assert.equal(cfg.hasKey, true);
    assert.equal(typeof cfg.model, 'string');
});

// --- wire shape + response handling ------------------------------------------

function stubFetch(response) {
    const calls = [];
    globalThis.fetch = async (url, init) => {
        calls.push({ url, init });
        return response;
    };
    return calls;
}

function toolResponse(input, extra = {}) {
    return sseResponse({
        model: MODEL, stop_reason: 'tool_use',
        content: [{ type: 'tool_use', name: VISION_TOOL_NAME, input }],
        usage: { input_tokens: 10, output_tokens: 20 },
        ...extra
    });
}

test('runVisionPass: request carries the image block and the forced tool', async () => {
    enableVision();
    const original = globalThis.fetch;
    const calls = stubFetch(toolResponse({
        content_kind: 'photo', caption: 'A dog on a beach.',
        transcription: '', transcription_complete: true
    }));
    let res;
    try {
        res = await runVisionPass({
            imageBase64: 'QUJD', mediaType: 'image/jpeg',
            alt: 'dog', articleTitle: 'T', articleUrl: 'https://x.test/a'
        });
    } finally { globalThis.fetch = original; }

    assert.equal(res.ok, true);
    assert.equal(res.model, MODEL);
    assert.equal(res.result.caption, 'A dog on a beach.');
    assert.equal(res.result.transcription, '');
    assert.equal(res.result.transcription_complete, true);

    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /api\.anthropic\.com\/v1\/messages/);
    assert.equal(calls[0].init.headers['x-api-key'], 'sk-ant-test');
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.tool_choice.name, VISION_TOOL_NAME);
    assert.equal(body.tools.length, 1);
    const blocks = body.messages[0].content;
    assert.equal(blocks[0].type, 'image');
    assert.equal(blocks[0].source.media_type, 'image/jpeg');
    assert.equal(blocks[0].source.data, 'QUJD');
    assert.ok(VISION_MEDIA_TYPES.includes(blocks[0].source.media_type));
});

test('runVisionPass: model refusal is its own state', async () => {
    enableVision();
    const original = globalThis.fetch;
    stubFetch(sseResponse({ model: MODEL, stop_reason: 'refusal', content: [] }));
    let res;
    try { res = await runVisionPass({ imageBase64: 'AAAA', mediaType: 'image/png' }); }
    finally { globalThis.fetch = original; }
    assert.equal(res.ok, false);
    assert.equal(res.refused, true);
    assert.match(res.error, /model-side guardrail/);
});

test('runVisionPass: max_tokens and malformed output are distinct errors', async () => {
    enableVision();
    const original = globalThis.fetch;
    try {
        stubFetch(sseResponse({ model: MODEL, stop_reason: 'max_tokens', content: [] }));
        let res = await runVisionPass({ imageBase64: 'AAAA', mediaType: 'image/png' });
        assert.equal(res.ok, false);
        assert.match(res.error, /output limit/);

        stubFetch(toolResponse({ content_kind: 'photo', caption: '', transcription: '' }));
        res = await runVisionPass({ imageBase64: 'AAAA', mediaType: 'image/png' });
        assert.equal(res.ok, false);
        assert.match(res.error, /did not return a structured image description/);
    } finally { globalThis.fetch = original; }
});

test('runVisionPass: transcription result survives verbatim', async () => {
    enableVision();
    const original = globalThis.fetch;
    stubFetch(toolResponse({
        content_kind: 'text-page', caption: 'A scanned magazine page.',
        transcription: 'THE HERALD\nStorm floods valley towns.',
        transcription_complete: false
    }));
    let res;
    try { res = await runVisionPass({ imageBase64: 'AAAA', mediaType: 'image/png' }); }
    finally { globalThis.fetch = original; }
    assert.equal(res.ok, true);
    assert.equal(res.result.content_kind, 'text-page');
    assert.equal(res.result.transcription, 'THE HERALD\nStorm floods valley towns.');
    assert.equal(res.result.transcription_complete, false);
});

// --- collection --------------------------------------------------------------

test('collectArticleImages (markdown): dedupes, keeps order, reads captions', () => {
    const md = [
        'Intro.',
        '',
        '![First scan](https://x.test/scan1.jpg)',
        '*Page one of the article*',
        '',
        '![](https://x.test/photo.png "A title")',
        '',
        '[![linked](https://x.test/scan1.jpg)](https://x.test/full)',
        '',
        '<img src="https://x.test/small.gif" alt="badge" width="40">',
        '',
        '![figure](xray-figure:' + 'a'.repeat(64) + ')',
        '',
        '<img src="blob:chrome-extension://abc/def">'
    ].join('\n');
    const images = collectArticleImages(md, { isHtml: false });
    assert.deepEqual(images.map((i) => i.ref), [
        'https://x.test/scan1.jpg',
        'https://x.test/photo.png',
        'https://x.test/small.gif',
        'xray-figure:' + 'a'.repeat(64)
    ]);
    assert.equal(images[0].alt, 'First scan');
    assert.equal(images[0].captionText, 'Page one of the article');
    assert.equal(images[2].alt, 'badge');
});

test('collectArticleImages (html): figure hash wins over blob src, figcaption read', () => {
    const html = [
        '<p>Intro</p>',
        '<figure><img src="https://x.test/a.jpg" alt="A"><figcaption>The <em>real</em> caption</figcaption></figure>',
        '<p><img src="blob:xyz" data-xray-figure="' + 'b'.repeat(64) + '" alt="fig"></p>',
        '<p><img src="blob:naked"></p>',
        '<p><img alt="srcless"></p>'
    ].join('\n');
    const images = collectArticleImages(html, { isHtml: true });
    assert.deepEqual(images.map((i) => i.ref), [
        'https://x.test/a.jpg',
        'xray-figure:' + 'b'.repeat(64)
    ]);
    assert.equal(images[0].captionText, 'The real caption');
    assert.equal(images[1].alt, 'fig');
});

// --- note builders -----------------------------------------------------------

test('buildVisionNoteMarkdown: caption + transcription with model provenance', () => {
    const md = buildVisionNoteMarkdown({
        caption: 'A crowd outside a courthouse.',
        transcription: 'DAILY HERALD\nVerdict due today',
        transcription_complete: true, model: MODEL
    });
    assert.equal(md, [
        `*Image description (AI — ${MODEL}): A crowd outside a courthouse.*`,
        '',
        `**Text in image (AI transcription — ${MODEL}):**`,
        '',
        '> DAILY HERALD',
        '> Verdict due today'
    ].join('\n'));
});

test('buildVisionNoteMarkdown: incomplete transcription is labeled', () => {
    const md = buildVisionNoteMarkdown({
        transcription: 'partial', transcription_complete: false, model: MODEL
    });
    assert.match(md, /may be incomplete — claude-opus-4-8/);
    assert.doesNotMatch(md, /Image description/);
});

test('buildVisionNoteHtml: keyed blocks, escaped content', () => {
    const ref = 'https://x.test/a"b.jpg';
    const html = buildVisionNoteHtml({
        caption: 'Uses <tags> & "quotes".',
        transcription: 'line < 1\nline 2',
        transcription_complete: true, model: MODEL
    }, ref);
    const key = visionNoteKey(ref);
    assert.ok(html.includes(`data-xray-vision="${key}"`));
    assert.match(html, /Uses &lt;tags&gt; &amp; &quot;quotes&quot;\./);
    assert.match(html, /line &lt; 1<br>line 2/);
    assert.match(html, /class="xr-vision-note"/);
});

// --- markdown upsert ---------------------------------------------------------

const SCAN_MD = [
    '# Archived article',
    '',
    '![Page 1](https://x.test/p1.jpg)',
    '',
    'Some visible text.',
    ''
].join('\n');

test('upsertVisionNoteMarkdown: inserts after the image', () => {
    const out = upsertVisionNoteMarkdown(SCAN_MD, 'https://x.test/p1.jpg', {
        caption: 'A scanned page.', model: MODEL
    });
    const lines = out.split('\n');
    const imgAt = lines.indexOf('![Page 1](https://x.test/p1.jpg)');
    assert.ok(imgAt !== -1);
    assert.equal(lines[imgAt + 1], '');
    assert.equal(lines[imgAt + 2], `*Image description (AI — ${MODEL}): A scanned page.*`);
    assert.ok(out.includes('Some visible text.'));
});

test('upsertVisionNoteMarkdown: re-run replaces, never stacks', () => {
    let out = upsertVisionNoteMarkdown(SCAN_MD, 'https://x.test/p1.jpg', {
        caption: 'First try.', transcription: 'OLD TEXT\nMORE', model: MODEL
    });
    out = upsertVisionNoteMarkdown(out, 'https://x.test/p1.jpg', {
        caption: 'Second try.', model: MODEL
    });
    assert.doesNotMatch(out, /First try/);
    assert.doesNotMatch(out, /OLD TEXT/);
    assert.equal((out.match(/Image description \(AI/g) || []).length, 1);
    assert.ok(out.includes('Second try.'));
    assert.ok(out.includes('Some visible text.'));
});

test('upsertVisionNoteMarkdown: lands after a human caption line', () => {
    const md = '![Page 1](https://x.test/p1.jpg)\n*Photo: Jane Doe*\n\nBody text.\n';
    const out = upsertVisionNoteMarkdown(md, 'https://x.test/p1.jpg', {
        caption: 'A page.', model: MODEL
    });
    const capAt = out.indexOf('*Photo: Jane Doe*');
    const noteAt = out.indexOf('*Image description');
    const bodyAt = out.indexOf('Body text.');
    assert.ok(capAt < noteAt && noteAt < bodyAt, 'caption, then note, then body');
});

test('upsertVisionNoteMarkdown: only the first occurrence gets the note', () => {
    const md = '![a](https://x.test/p.jpg)\n\nMiddle.\n\n![a](https://x.test/p.jpg)\n';
    const out = upsertVisionNoteMarkdown(md, 'https://x.test/p.jpg', {
        caption: 'Once.', model: MODEL
    });
    assert.equal((out.match(/Image description \(AI/g) || []).length, 1);
    assert.ok(out.indexOf('Image description') < out.indexOf('Middle.'));
});

test('upsertVisionNoteMarkdown: unknown ref and empty note are no-ops', () => {
    assert.equal(upsertVisionNoteMarkdown(SCAN_MD, 'https://x.test/nope.jpg', {
        caption: 'X.', model: MODEL
    }), SCAN_MD);
    assert.equal(upsertVisionNoteMarkdown(SCAN_MD, 'https://x.test/p1.jpg', {
        model: MODEL
    }), SCAN_MD);
});

test('upsertVisionNoteMarkdown: transcription block renders as blockquote', () => {
    const out = upsertVisionNoteMarkdown(SCAN_MD, 'https://x.test/p1.jpg', {
        transcription: 'THE HERALD\nStorm floods valley', model: MODEL
    });
    assert.ok(out.includes(`**Text in image (AI transcription — ${MODEL}):**`));
    assert.ok(out.includes('> THE HERALD\n> Storm floods valley'));
});

// --- html upsert -------------------------------------------------------------

test('upsertVisionNoteHtml: inserts after the enclosing paragraph', () => {
    const html = '<p>Intro</p><p><img src="https://x.test/a.jpg" alt="A"></p><p>Next</p>';
    const out = upsertVisionNoteHtml(html, 'https://x.test/a.jpg', {
        caption: 'A photo.', model: MODEL
    });
    const noteAt = out.indexOf('xr-vision-note');
    assert.ok(noteAt !== -1);
    assert.ok(out.indexOf('<p>Next</p>') > noteAt, 'note before the next paragraph');
    assert.ok(out.indexOf('</p>\n<p class="xr-vision-note"') !== -1, 'after the image paragraph close');
});

test('upsertVisionNoteHtml: inserts after the enclosing figure', () => {
    const html = '<figure><img src="https://x.test/a.jpg"><figcaption>Cap</figcaption></figure><p>Next</p>';
    const out = upsertVisionNoteHtml(html, 'https://x.test/a.jpg', {
        caption: 'A photo.', model: MODEL
    });
    assert.ok(out.indexOf('</figure>\n<p class="xr-vision-note"') !== -1);
});

test('upsertVisionNoteHtml: re-run replaces the keyed block', () => {
    const html = '<p><img src="https://x.test/a.jpg"></p>';
    let out = upsertVisionNoteHtml(html, 'https://x.test/a.jpg', {
        caption: 'First.', transcription: 'OLD', model: MODEL
    });
    out = upsertVisionNoteHtml(out, 'https://x.test/a.jpg', {
        caption: 'Second.', model: MODEL
    });
    assert.doesNotMatch(out, /First\./);
    assert.doesNotMatch(out, /OLD/);
    assert.equal((out.match(/data-xray-vision=/g) || []).length, 1);
    assert.ok(out.includes('Second.'));
});

test('upsertVisionNoteHtml: figure refs match on data-xray-figure', () => {
    const hash = 'c'.repeat(64);
    const html = `<p><img src="blob:gone" data-xray-figure="${hash}"></p><p>Next</p>`;
    const out = upsertVisionNoteHtml(html, 'xray-figure:' + hash, {
        caption: 'An archived figure.', model: MODEL
    });
    assert.ok(out.includes('An archived figure.'));
    assert.ok(out.indexOf('xr-vision-note') < out.indexOf('<p>Next</p>'));
});

test('upsertVisionNoteHtml: bare image gets the note right after the tag', () => {
    const html = '<img src="https://x.test/a.jpg">';
    const out = upsertVisionNoteHtml(html, 'https://x.test/a.jpg', {
        caption: 'Bare.', model: MODEL
    });
    assert.ok(out.startsWith('<img src="https://x.test/a.jpg">\n<p class="xr-vision-note"'));
});

// --- review-hardening regressions --------------------------------------------

test('upsertVisionNoteMarkdown re-run: an article blockquote after the note survives', () => {
    const md = '![scan](https://x.test/p.jpg)\n\n> A pull quote the article itself contains\n\nBody text.\n';
    let out = upsertVisionNoteMarkdown(md, 'https://x.test/p.jpg', {
        transcription: 'FIRST TEXT', model: MODEL
    });
    out = upsertVisionNoteMarkdown(out, 'https://x.test/p.jpg', {
        transcription: 'SECOND TEXT', model: MODEL
    });
    assert.ok(out.includes('> A pull quote the article itself contains'), 'article pull quote intact');
    assert.doesNotMatch(out, /FIRST TEXT/);
    assert.ok(out.includes('> SECOND TEXT'));
    assert.ok(out.includes('Body text.'));
});

test('upsertVisionNoteMarkdown re-run: consecutive article blockquotes all survive', () => {
    const md = '![scan](https://x.test/p.jpg)\n\n> Tweet embed one\n\n> Tweet embed two\n\nEnd.\n';
    let out = upsertVisionNoteMarkdown(md, 'https://x.test/p.jpg', {
        caption: 'A scan.', transcription: 'OCR', model: MODEL
    });
    out = upsertVisionNoteMarkdown(out, 'https://x.test/p.jpg', {
        caption: 'A scan again.', transcription: 'OCR2', model: MODEL
    });
    assert.ok(out.includes('> Tweet embed one'));
    assert.ok(out.includes('> Tweet embed two'));
    assert.doesNotMatch(out, /\bOCR\b(?!2)/);
});

test('markdown images: parenthesized URLs and single-quoted titles round-trip', () => {
    const parenUrl = 'https://upload.wikimedia.org/wiki/Dr._Strangelove_(1964).jpg';
    const md = `![Poster](${parenUrl})\n\nBody.\n\n![t](https://x.test/t.jpg 'my title')\n`;
    const images = collectArticleImages(md, { isHtml: false });
    assert.deepEqual(images.map((i) => i.ref), [parenUrl, 'https://x.test/t.jpg']);
    const out = upsertVisionNoteMarkdown(md, parenUrl, { caption: 'A poster.', model: MODEL });
    assert.ok(out.indexOf('Image description') !== -1);
    assert.ok(out.indexOf('Image description') < out.indexOf('Body.'));
});

test('upsertVisionNoteHtml: div-wrapped image never adopts the next paragraph', () => {
    const html = '<div><img src="https://x.test/a.jpg"></div><p>Totally unrelated paragraph.</p><p>More.</p>';
    const out = upsertVisionNoteHtml(html, 'https://x.test/a.jpg', {
        caption: 'In a div.', model: MODEL
    });
    const noteAt = out.indexOf('xr-vision-note');
    assert.ok(noteAt !== -1);
    assert.ok(noteAt < out.indexOf('Totally unrelated paragraph.'),
        'note sits with its image, not after someone else\'s paragraph');
});

test('upsertVisionNoteHtml: p-wrapped image before an image-less figure keeps its own close', () => {
    const html = '<p><img src="https://x.test/a.jpg"></p><figure><figcaption>Other</figcaption></figure><p>End.</p>';
    const out = upsertVisionNoteHtml(html, 'https://x.test/a.jpg', {
        caption: 'Own paragraph.', model: MODEL
    });
    assert.ok(out.indexOf('</p>\n<p class="xr-vision-note"') !== -1);
    assert.ok(out.indexOf('xr-vision-note') < out.indexOf('<figure>'));
});

test('upsertVisionNoteHtml: attribute-less round-tripped note is replaced, not stacked', () => {
    // A markdown-tab round trip drops the data-xray-vision key.
    const html = '<p><img src="https://x.test/a.jpg"></p>\n'
        + `<p><em>Image description (AI — ${MODEL}): Old caption.</em></p>\n`
        + `<p><strong>Text in image (AI transcription — ${MODEL}):</strong></p><blockquote><p>OLD OCR</p></blockquote>\n`
        + '<p>Body.</p>';
    const out = upsertVisionNoteHtml(html, 'https://x.test/a.jpg', {
        caption: 'New caption.', model: MODEL
    });
    assert.doesNotMatch(out, /Old caption/);
    assert.doesNotMatch(out, /OLD OCR/);
    assert.ok(out.includes('New caption.'));
    assert.ok(out.includes('<p>Body.</p>'));
    assert.equal((out.match(/Image description \(AI/g) || []).length, 1);
});

test('blockedImageUrl: refuses local/private/link-local, allows public hosts', () => {
    assert.equal(blockedImageUrl('https://cdn.example.com/img.jpg'), null);
    assert.equal(blockedImageUrl('http://8.8.8.8/x.png'), null);
    assert.ok(blockedImageUrl('http://localhost/x.png'));
    assert.ok(blockedImageUrl('http://127.0.0.1:8080/x.png'));
    assert.ok(blockedImageUrl('http://10.1.2.3/x.png'));
    assert.ok(blockedImageUrl('http://172.20.0.1/x.png'));
    assert.ok(blockedImageUrl('http://192.168.1.1/admin.png'));
    assert.ok(blockedImageUrl('http://169.254.169.254/latest/meta-data'));
    assert.ok(blockedImageUrl('http://100.64.0.1/x.png'));
    assert.ok(blockedImageUrl('http://0.0.0.0/x.png'));
    assert.ok(blockedImageUrl('http://[::1]/x.png'));
    assert.ok(blockedImageUrl('http://[fe80::1]/x.png'));
    assert.ok(blockedImageUrl('http://[fd00::1]/x.png'));
    assert.ok(blockedImageUrl('http://[::ffff:127.0.0.1]/x.png'));
    assert.ok(blockedImageUrl('http://printer.local/x.png'));
    assert.ok(blockedImageUrl('ftp://example.com/x.png'));
    assert.ok(blockedImageUrl('not a url'));
});

test('markdownToHtml: model-authored note text cannot break out of attributes', () => {
    // The verified exploit shape: a quote in the image target used to
    // land unescaped in src, forming an onerror attribute.
    const out = ContentExtractor.markdownToHtml('![a](x"onerror=alert(document.domain))');
    assert.doesNotMatch(out, /"onerror/, 'no attribute breakout');
    assert.ok(!out.includes('src="x"'), 'quote is escaped inside the attribute');
});

test('markdownToHtml: javascript:/data:text targets are rejected, safe ones kept', () => {
    assert.doesNotMatch(
        ContentExtractor.markdownToHtml('[click](javascript:alert(1))'), /<a /,
        'javascript: link degrades to bare text');
    assert.doesNotMatch(
        ContentExtractor.markdownToHtml('[click](java\nscript:alert(1))'), /javascript:/i);
    assert.match(
        ContentExtractor.markdownToHtml('[ok](https://x.test/a)'), /<a href="https:\/\/x\.test\/a">/);
    assert.match(
        ContentExtractor.markdownToHtml('![f](xray-figure:abc123)'), /<img src="xray-figure:abc123"/,
        'figure refs still render');
});

test('runVisionPass result carries the pinned prompt version', async () => {
    assert.equal(VISION_PROMPT_VERSION, 'vision-v1');
    enableVision();
    const original = globalThis.fetch;
    stubFetch(toolResponse({
        content_kind: 'photo', caption: 'A dog.', transcription: '', transcription_complete: true
    }));
    let res;
    try { res = await runVisionPass({ imageBase64: 'AAAA', mediaType: 'image/png' }); }
    finally { globalThis.fetch = original; }
    assert.equal(res.ok, true);
    assert.equal(res.prompt_version, 'vision-v1');
});
