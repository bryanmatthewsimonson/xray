import { test } from 'node:test';
import assert from 'node:assert/strict';
// storage.js reads chrome.* at import time; the handler's default io is never used here.
globalThis.chrome = { storage: { local: { get() {}, set() {}, remove() {} } }, runtime: { getURL: (p) => p } };
const { handleOverlayMessage } = await import('../src/background/overlay.js');
const { Utils } = await import('../src/shared/utils.js');

const EXT = 'chrome-extension://abc/';
const CARD = EXT + 'src/overlay/overlay-card.html';
const URL1 = 'https://example.com/a';
const NOTE_ID = 'pn_0123456789abcdef';
const BANNED = ['text', 'content', 'body', 'note', 'verdict', 'assessment', 'stance', 'labels'];

function makeIo({ flag = true, siteOff = [], archived } = {}) {
    const store = archived || {
        [Utils.normalizeUrl(URL1)]: { articleHash: 'h1', markdown: 'Alpha beta gamma delta.' }
    };
    const reads = [];
    const savedNotes = [];
    return {
        reads, savedNotes,
        getURL: (p) => EXT + p,
        loadFlags: async () => {},
        isEnabled: (f) => f === 'inlineOverlay' && flag,
        readSiteOff: async () => siteOff,
        getArticle: async (u) => { reads.push('article'); return store[Utils.normalizeUrl(u)] || null; },
        getArticleExtraction: async () => { reads.push('extraction'); return null; },
        getClaims: async (u) => {
            reads.push('claims');
            return Utils.normalizeUrl(u) === Utils.normalizeUrl(URL1)
                ? [{ id: 'c1', text: 'SECRET claim', quote: 'beta gamma', anchor: [{ type: 'TextQuoteSelector', exact: 'beta gamma' }] }]
                : [];
        },
        getAssessments: async () => { reads.push('assessments'); return [{ stance: 'disputes' }]; },
        getVerdicts: async () => { reads.push('verdicts'); return [{ verdict: 'false' }]; },
        getFindings: async () => { reads.push('findings'); return []; },
        notes: {
            forUrl: async () => {
                reads.push('notes');
                return [{ id: NOTE_ID, url: Utils.normalizeUrl(URL1), quote: 'delta', text: 'SECRET note' }];
            },
            save: async (n) => { savedNotes.push(n); return { id: n.id || 'pn_aaaaaaaaaaaaaaaa', ...n }; },
            remove: async () => {}
        }
    };
}

const iframeSender = (tabUrl = URL1) => ({ url: CARD + '?x=1', tab: { id: 1, url: tabUrl } });
const pageSender = { url: URL1, tab: { id: 1, url: URL1 } };
const panelSender = { url: EXT + 'src/sidepanel/index.html' };
const lookup = (io, url = URL1) => handleOverlayMessage({ type: 'xray:overlay:lookup', url }, pageSender, io);

test('lookup: unarchived -> [] and no model reads', async () => {
    const io = makeIo({ archived: {} });
    assert.deepEqual(await lookup(io), { ok: true, items: [] });
    assert.deepEqual(io.reads, ['article']);
});

test('lookup: flag off -> [] and nothing read', async () => {
    const io = makeIo({ flag: false });
    assert.deepEqual(await lookup(io), { ok: true, items: [] });
    assert.deepEqual(io.reads, []);
});

test('lookup: site switched off -> []', async () => {
    const io = makeIo({ siteOff: ['example.com'] });
    assert.deepEqual(await lookup(io), { ok: true, items: [] });
    assert.deepEqual(io.reads, []);
});

test('lookup: matches archived URL across utm params and youtu.be form', async () => {
    const r = await lookup(makeIo(), URL1 + '?utm_source=x');
    assert.ok(r.items.some((i) => i.id === 'claim:c1'));

    const yt = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
    const io2 = makeIo({ archived: { [Utils.normalizeUrl(yt)]: { articleHash: 'h', markdown: 'x' } } });
    const r2 = await lookup(io2, 'https://youtu.be/dQw4w9WgXcQ');
    assert.equal(r2.ok, true);
    assert.ok(io2.reads.includes('claims'), 'youtu.be form reached the archived article');
});

test('lookup: response passes the overlay guard', async () => {
    const r = await lookup(makeIo());
    assert.ok(r.items.length >= 2);
    assert.ok(!JSON.stringify(r).includes('SECRET'));
    for (const it of r.items) {
        assert.equal('detail' in it, false);
        for (const k of Object.keys(it)) assert.ok(!BANNED.includes(k), k);
    }
});

test('card: refused from a content-script sender (sender.url is the page)', async () => {
    const r = await handleOverlayMessage({ type: 'xray:overlay:card', url: URL1, itemIds: ['claim:c1'] }, pageSender, makeIo());
    assert.deepEqual(r, { ok: false, error: 'forbidden' });
});

test('card: refused when tab url differs from message url', async () => {
    const r = await handleOverlayMessage({ type: 'xray:overlay:card', url: URL1, itemIds: [] }, iframeSender('https://evil.example/'), makeIo());
    assert.deepEqual(r, { ok: false, error: 'forbidden' });
});

test('card: refused from another extension page that has a tab', async () => {
    const s = { url: EXT + 'src/reader/index.html', tab: { id: 2, url: URL1 } };
    const r = await handleOverlayMessage({ type: 'xray:overlay:card', url: URL1, itemIds: [] }, s, makeIo());
    assert.equal(r.error, 'forbidden');
});

test('card: allowed from our iframe on the matching tab (full detail, only requested ids)', async () => {
    const r = await handleOverlayMessage(
        { type: 'xray:overlay:card', url: URL1, itemIds: ['claim:c1'] },
        iframeSender(URL1 + '?utm_medium=y'), makeIo());
    assert.equal(r.ok, true);
    assert.deepEqual(r.items.map((i) => i.id), ['claim:c1']);
    assert.equal(r.items[0].detail.text, 'SECRET claim');
});

test('card: allowed from a tabless extension page (side panel)', async () => {
    const r = await handleOverlayMessage(
        { type: 'xray:overlay:card', url: URL1, itemIds: ['note:' + NOTE_ID] }, panelSender, makeIo());
    assert.equal(r.ok, true);
    assert.equal(r.items.length, 1);
});

test('card: tabless sender outside the extension origin is refused', async () => {
    const r = await handleOverlayMessage({ type: 'xray:overlay:card', url: URL1, itemIds: [] }, { url: 'https://evil.example/' }, makeIo());
    assert.equal(r.error, 'forbidden');
});

test('note:save: refused from a page-embedded card on a different tab url', async () => {
    const io = makeIo();
    const r = await handleOverlayMessage({ type: 'xray:overlay:note:save', url: URL1, note: { text: 'hi' } }, iframeSender('https://other.example/'), io);
    assert.equal(r.error, 'forbidden');
    assert.equal(io.savedNotes.length, 0);
});

test('note:save: allowed from the iframe; anchor is sanitized', async () => {
    const io = makeIo();
    const r = await handleOverlayMessage({
        type: 'xray:overlay:note:save', url: URL1,
        note: { text: 'hi', quote: 'q', seconds: 12, anchor: [{ type: 'TextQuoteSelector', exact: 'q', evil: 'X' }, 5] }
    }, iframeSender(), io);
    assert.equal(r.ok, true);
    assert.deepEqual(io.savedNotes[0].anchor, [{ type: 'TextQuoteSelector', exact: 'q' }]);
    assert.equal(io.savedNotes[0].url, URL1);
});

test('note:save: invalid payloads -> bad request', async () => {
    const bad = [
        { text: 'hi', id: 'constructor' },
        { text: 'hi', id: '__proto__' },
        { text: 'hi', id: 'pn_XYZ' },
        { text: 'hi', seconds: -1 },
        { text: 'hi', seconds: NaN },
        { text: 'hi', seconds: '3' },
        { text: 'hi', quote: 'x'.repeat(2001) },
        { text: 'hi', quote: 5 },
        { text: '' },
        { text: 5 },
        null, [], 'str'
    ];
    for (const note of bad) {
        const io = makeIo();
        const r = await handleOverlayMessage({ type: 'xray:overlay:note:save', url: URL1, note }, iframeSender(), io);
        assert.deepEqual(r, { ok: false, error: 'bad request' }, JSON.stringify(note));
        assert.equal(io.savedNotes.length, 0);
    }
});

test('note:delete: this page\'s id ok; foreign or invalid id -> bad request', async () => {
    const del = (id) => handleOverlayMessage({ type: 'xray:overlay:note:delete', url: URL1, id }, iframeSender(), makeIo());
    assert.deepEqual(await del(NOTE_ID), { ok: true });
    assert.equal((await del('pn_ffffffffffffffff')).error, 'bad request');
    assert.equal((await del('constructor')).error, 'bad request');
});

test('malformed payload (itemIds not array of strings, url not string) -> bad request', async () => {
    const io = makeIo();
    for (const itemIds of ['claim:c1', [1], null, undefined]) {
        const r = await handleOverlayMessage({ type: 'xray:overlay:card', url: URL1, itemIds }, iframeSender(), io);
        assert.deepEqual(r, { ok: false, error: 'bad request' });
    }
    for (const url of [undefined, 5, '', {}]) {
        assert.equal((await handleOverlayMessage({ type: 'xray:overlay:lookup', url }, pageSender, io)).error, 'bad request');
        const r = await handleOverlayMessage({ type: 'xray:overlay:card', url, itemIds: [] }, iframeSender(), io);
        assert.equal(r.error, 'bad request');
    }
});
