// The portal's one archived-article opener (field-found 2026-08-23:
// imported book chapters were unreachable — the artifacts rows rendered
// the instruction "open this article in the reader" as plain text with
// no affordance, and the dossier's chapter list was equally inert).
//
// The seam lesson applies here in advance: the helper alone proving
// green is exactly how priorSubmission shipped consumed-by-nothing, so
// the LAST tests grep that every portal surface naming an archived
// article actually routes through this opener.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

const { openArchivedInReader } = await import('../src/portal/open-archived.js');

const repoUrl = (p) => new URL(`../${p}`, import.meta.url);
const readRepo = (p) => readFileSync(repoUrl(p), 'utf8');

test('opens the archived record writable, with its hash, via xray:reader:open', async () => {
    const sent = [];
    const out = await openArchivedInReader('file:///imported/epub/abc123/ch02', {
        getArticle: async (u) => ({ article: { url: u, title: 'Ch 2', markdown: '# md' }, articleHash: 'h'.repeat(64) }),
        sendMessage: async (msg) => { sent.push(msg); return { ok: true }; },
        newId: () => 'fixed-id'
    });
    assert.equal(out.ok, true);
    assert.equal(sent.length, 1);
    const [msg] = sent;
    assert.equal(msg.type, 'xray:reader:open');
    assert.equal(msg.id, 'fixed-id');
    assert.equal(msg.readOnly, false, 'writable — claims and tags must save back');
    assert.equal(msg.article._articleHash, 'h'.repeat(64), 'the row hash rides along so the reader never re-derives it');
    assert.equal(msg.article.title, 'Ch 2');
});

test('a missing archive record is a clear refusal, not a silent no-op', async () => {
    const out = await openArchivedInReader('file:///imported/epub/abc123/gone', {
        getArticle: async () => null,
        sendMessage: async () => { throw new Error('must not be called'); }
    });
    assert.equal(out.ok, false);
    assert.match(out.error, /No local archive record/);
});

test('a dead service worker surfaces as an error, never a hang', async () => {
    const out = await openArchivedInReader('https://x/a', {
        getArticle: async () => ({ article: { url: 'https://x/a' }, articleHash: 'h'.repeat(64) }),
        sendMessage: async () => undefined   // dropped channel
    });
    assert.equal(out.ok, false);
    assert.match(out.error, /service worker/i);
});

// ------------------------------------------------------------------
// The seams — every surface that names an archived article opens it
// ------------------------------------------------------------------

test('the portal artifacts list routes through the opener, not through prose', () => {
    const src = readRepo('src/portal/index.js');
    assert.match(src, /from '\.\/open-archived\.js'/, 'portal/index.js must import the opener');
    assert.match(src, /openArchivedInReader\(/, 'the artifacts rows must call it');
    assert.ok(!/— open this article in the reader and Publish to emit it/.test(src),
        'the instruction-as-plain-text row is the bug — the row must DO it, not describe it');
});

test('the entity dossier captured-content list opens chapters too', () => {
    const src = readRepo('src/portal/entity-dossier-view.js');
    assert.match(src, /openArchivedInReader|onOpenArticle/,
        'the dossier chapter lines must be clickable into the reader');
});

test('case-view uses the SHARED opener rather than its private copy', () => {
    const src = readRepo('src/portal/case-view.js');
    assert.match(src, /from '\.\/open-archived\.js'/);
    assert.ok(!/chrome\.runtime\.sendMessage\(\{ type: 'xray:reader:open'/.test(src),
        'the private opener must be gone — one opener, one behavior');
});
