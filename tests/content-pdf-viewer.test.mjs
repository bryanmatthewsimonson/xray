// Content-script capture inside a PDF viewer that hosts content
// scripts (Phase 18 C3 follow-up, found in the field on Edge).
//
// The PDF routing design assumed browsers never inject content scripts
// into their PDF viewers — true for Chrome and Firefox, FALSE for
// Edge's viewer. There the xray:capture sendMessage SUCCEEDS, so the
// background's sendMessage-failure fallback (the entire PDF route)
// never fired: Readability ran against the viewer's chrome and the
// user got "Could not extract an article from this page." instead of
// the PDF reader. The guard: a document served as application/pdf IS
// the PDF — hand off to the background's xray:pdf:open route.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const sent = [];
globalThis.chrome = {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } },
    runtime: { sendMessage: async (m) => { sent.push(m); return { ok: true }; } }
};
globalThis.document = { contentType: 'application/pdf', querySelector: () => null };
globalThis.location = { href: 'https://arxiv.org/pdf/1906.11238#page=7' };

const { UI } = await import('../src/content/ui.js');

test('capture inside a PDF viewer hands off to the background PDF route', async () => {
    await UI.openReader();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].type, 'xray:pdf:open');
    assert.equal(sent[0].url, 'https://arxiv.org/pdf/1906.11238#page=7');
});

test('capture on a Drive PDF preview routes the DOCUMENT to the PDF pipeline', async () => {
    sent.length = 0;
    globalThis.document = {
        contentType: 'text/html',
        title: 'will_decision.pdf - Google Drive',
        querySelector: () => null
    };
    globalThis.location = { href: 'https://drive.google.com/file/d/1YhmkYB32RpGsXvQTsX4xZ0Yul1wiwh8Z/view' };
    await UI.openReader();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].type, 'xray:pdf:open');
    assert.equal(sent[0].url,
        'https://drive.google.com/uc?export=download&id=1YhmkYB32RpGsXvQTsX4xZ0Yul1wiwh8Z');
});
