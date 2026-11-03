// Inline overlay — the card iframe (src/overlay/), its parent-side mount
// (src/content/overlay-frame.js), and the side-panel fallback handler.
// The card is the ONLY surface that renders note text, claim text and
// verdicts, and it is web-accessible: every input is treated as hostile.

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

globalThis.chrome = globalThis.chrome || {
    storage: { local: { get: (k, cb) => cb({}), set: (o, cb) => cb && cb(), remove: (k, cb) => cb && cb() } },
    runtime: { getURL: (p) => p }
};

const {
    renderCards, renderList, renderEditor, REVIEW_LABELS, UNLOCATED_LABEL, NOTE_MAXLENGTH
} = await import('../src/overlay/render.js');
const { startCard, sanitizeDraft } = await import('../src/overlay/index.js');
const { mountFrame, positionFor, FALLBACK_MS } = await import('../src/content/overlay-frame.js');
const { handleOverlayMessage } = await import('../src/background/overlay.js');
const { MAX_NOTE_TEXT } = await import('../src/shared/page-notes.js');

const claim = (over = {}) => ({
    id: 'claim:c1', kind: 'claim', quote: 'q', seconds: null, judgmentKinds: [], reviewState: null,
    detail: { text: 'Claim text', assessments: [], verdicts: [] }, ...over
});
const extraction = (state, n = 1) => ({
    id: 'extraction:k' + n + state, kind: 'extraction', quote: '', reviewState: state,
    detail: { text: 'Row ' + state, why: '' }
});

// ---------------------------------------------------------------------------
// Pure renderers
// ---------------------------------------------------------------------------

test('escapes HTML in claim text', () => {
    const evil = '<img src=x onerror=alert(1)>"\'&';
    const html = renderCards([claim({
        quote: '<script>q</script>',
        detail: {
            text: evil,
            assessments: [{ stance: '<b>s</b>', labels: [{ label: '<i>l</i>' }], rationale: '<u>r</u>' }],
            verdicts: [{ verdict: '<x>v</x>', caveats: ['<c>'], standard_of_proof: '<p>' }]
        }
    })]);
    for (const raw of ['<img', '<script', '<b>', '<i>', '<u>', '<x>', '<c>', '<p>']) {
        assert.ok(!html.includes(raw), raw);
    }
    assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;&quot;&#39;&amp;'));
    assert.ok(html.includes('Assessment') && html.includes('Verdict'), 'judgment kinds are labelled rows');
});

test('escapes ids in attributes and ignores non-scalar values', () => {
    const html = renderCards([{
        id: 'note:"><script>', kind: 'note', quote: '', detail: { text: { toString: () => '<evil>' } }
    }]);
    assert.ok(!html.includes('"><script>'));
    assert.ok(!html.includes('<evil>'));
    assert.ok(!html.includes('[object Object]'));
});

test('unknown kinds and malformed items render nothing', () => {
    assert.equal(renderCards([{ id: 'x', kind: 'script' }, null, 5, { kind: 'claim' }]), '');
});

test('prototype keys are not kinds or review states', () => {
    for (const kind of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
        assert.equal(renderCards([{ id: 'x', kind, detail: {} }]), '', kind);
    }
    const html = renderCards([{ id: 'e', kind: 'extraction', reviewState: 'constructor', detail: { text: 't' } }]);
    assert.ok(html.includes('xr-ov-review-unreviewed'));
    assert.ok(html.includes('Review state: unreviewed model proposal'));
    assert.ok(!html.includes('constructor'));
    assert.ok(!html.includes('function'));
});

test('rejected hidden unless showRejected', () => {
    const items = [extraction('rejected'), extraction('accepted', 2)];
    const hidden = renderList(items);
    assert.ok(!hidden.includes('Row rejected'));
    assert.ok(hidden.includes('Row accepted'));
    assert.ok(hidden.includes('Show rejected (1)'), 'hidden, never silently dropped');
    const shown = renderList(items, { showRejected: true });
    assert.ok(shown.includes('Row rejected'));
    assert.ok(shown.includes('Hide rejected'));
    // Cards mode (a pin the user clicked) shows a rejected row.
    assert.ok(renderCards([extraction('rejected')]).includes('Row rejected'));
});

test('review-state labels exact', () => {
    assert.deepEqual({ ...REVIEW_LABELS }, {
        unreviewed: 'unreviewed model proposal', accepted: 'accepted', rejected: 'rejected'
    });
    assert.ok(renderCards([extraction('unreviewed')]).includes('unreviewed model proposal'));
    assert.ok(renderCards([extraction('accepted')]).includes('Review state: accepted'));
    assert.ok(renderList([extraction('rejected')], { showRejected: true }).includes('Review state: rejected'));
});

test('unlocated label exact', () => {
    assert.equal(UNLOCATED_LABEL, 'Could not be located on this page');
    assert.ok(renderList([claim({ unlocated: true })]).includes('Could not be located on this page'));
    assert.ok(!renderList([claim()]).includes('Could not be located'));
});

test('editor renders the quote as escaped text and caps length like page-notes', () => {
    const html = renderEditor({ quote: '<script>alert(1)</script>', seconds: 75 });
    assert.ok(!html.includes('<script>'));
    assert.ok(html.includes('&lt;script&gt;'));
    assert.ok(html.includes('1:15'));
    assert.equal(NOTE_MAXLENGTH, MAX_NOTE_TEXT);
    assert.ok(renderEditor({ text: '</textarea><b>' }).includes('&lt;/textarea&gt;&lt;b&gt;'));
});

test('note actions are omitted when actions:false (side panel)', () => {
    const note = { id: 'note:pn_0123456789abcdef', kind: 'note', detail: { text: 't' } };
    assert.ok(renderCards([note]).includes('data-xr-ov-action="delete"'));
    assert.ok(!renderList([note], { actions: false }).includes('data-xr-ov-action="delete"'));
});

// ---------------------------------------------------------------------------
// Card script (inside the iframe)
// ---------------------------------------------------------------------------

const NONCE = 'abcdefghijklmnop0123';

function makeCardEnv({ hash = '#' + NONCE, cardResponse, saveResponse, top, ancestorOrigins } = {}) {
    const posted = [];
    const sent = [];
    const listeners = {};
    const parent = { postMessage: (m, o) => posted.push({ m, o }) };
    const root = { innerHTML: '' };
    const textarea = { value: '' };
    const statusP = { textContent: '' };
    const doc = {
        documentElement: { scrollHeight: 200 },
        querySelector: (sel) => (sel === '.xr-ov-editor .xr-ov-status' ? statusP : null),
        getElementById: (id) => (id === 'xr-ov-root' ? root : id === 'xr-ov-note-text' ? textarea : null),
        addEventListener: (t, f) => { (listeners['doc:' + t] = listeners['doc:' + t] || []).push(f); }
    };
    const win = {
        location: ancestorOrigins ? { hash, ancestorOrigins } : { hash },
        parent,
        top: top === undefined ? parent : top,
        addEventListener: (t, f) => { (listeners[t] = listeners[t] || []).push(f); }
    };
    const chromeApi = {
        runtime: {
            sendMessage: async (m) => {
                sent.push(m);
                if (m.type === 'xray:overlay:card') return cardResponse ? cardResponse(m) : { ok: true, items: [] };
                if (m.type === 'xray:overlay:note:save') {
                    return saveResponse || { ok: true, note: { id: 'pn_00000000000000aa' } };
                }
                return { ok: true };
            }
        }
    };
    const fire = async (t, ev) => { for (const f of listeners[t] || []) await f(ev); };
    const click = async (action, id, trusted = true) => {
        const btn = {
            getAttribute: (n) => (n === 'data-xr-ov-action' ? action : n === 'data-xr-ov-id' ? id : null),
            textContent: ''
        };
        await fire('doc:click', { isTrusted: trusted, target: { closest: () => btn }, preventDefault() {} });
        return btn;
    };
    return { posted, sent, root, textarea, statusP, win, doc, chromeApi, fire, click, parent };
}

const flush = () => new Promise((r) => setImmediate(r));

test('card: posts ready with its own nonce; an invalid hash leaves it inert', () => {
    const env = makeCardEnv();
    startCard({ window: env.win, document: env.doc, chrome: env.chromeApi });
    assert.deepEqual(env.posted[0].m, { xrOv: 'ready', nonce: NONCE });
    const bad = makeCardEnv({ hash: '#short' });
    startCard({ window: bad.win, document: bad.doc, chrome: bad.chromeApi });
    assert.equal(bad.posted.length, 0);
});

test('card: stays inert when its parent is not the top window (nested embedder)', async () => {
    const env = makeCardEnv({ top: { other: true } });
    startCard({ window: env.win, document: env.doc, chrome: env.chromeApi });
    assert.equal(env.posted.length, 0, 'no ready');
    await env.fire('message', {
        source: env.parent,
        data: { xrOv: 'show', nonce: NONCE, url: 'https://victim.example/', itemIds: ['claim:c1'], mode: 'cards' }
    });
    await flush();
    assert.ok(!env.sent.some((m) => m.type === 'xray:overlay:card'), 'never asks for card content');
    assert.equal(env.sent.length, 0);
});

test('card: stays inert when ancestorOrigins shows more than one ancestor', async () => {
    const env = makeCardEnv({ ancestorOrigins: { length: 2 } });
    startCard({ window: env.win, document: env.doc, chrome: env.chromeApi });
    await env.fire('message', {
        source: env.parent,
        data: { xrOv: 'show', nonce: NONCE, url: 'https://victim.example/', itemIds: ['claim:c1'], mode: 'cards' }
    });
    await flush();
    assert.equal(env.posted.length, 0);
    assert.equal(env.sent.length, 0);
    // Exactly one ancestor (the top page) is the normal case.
    const ok = makeCardEnv({ ancestorOrigins: { length: 1 } });
    startCard({ window: ok.win, document: ok.doc, chrome: ok.chromeApi });
    assert.equal(ok.posted[0].m.xrOv, 'ready');
});

test('card: a failed save keeps the editor and the typed text', async () => {
    const env = makeCardEnv({ saveResponse: { ok: false, error: 'bad request' } });
    startCard({ window: env.win, document: env.doc, chrome: env.chromeApi });
    await env.fire('message', {
        source: env.parent,
        data: { xrOv: 'show', nonce: NONCE, url: 'https://a.example/', itemIds: [], mode: 'new-note', draft: { quote: 'q' } }
    });
    await flush();
    const editorHtml = env.root.innerHTML;
    env.textarea.value = 'typed by the user';
    await env.click('save', null, true);
    await flush();
    assert.equal(env.root.innerHTML, editorHtml, 'editor not repainted');
    assert.equal(env.textarea.value, 'typed by the user');
    assert.match(env.statusP.textContent, /Could not save/);
    assert.ok(!env.posted.some((p) => p.m.xrOv === 'changed'));
});

test('card: ignores show with a wrong nonce or from a non-parent source', async () => {
    const env = makeCardEnv();
    startCard({ window: env.win, document: env.doc, chrome: env.chromeApi });
    const data = { xrOv: 'show', nonce: 'zzzzzzzzzzzzzzzzzzzz', url: 'https://a.example/', itemIds: ['claim:c1'], mode: 'cards' };
    await env.fire('message', { source: env.parent, data });
    await env.fire('message', { source: {}, data: { ...data, nonce: NONCE } });
    await flush();
    assert.equal(env.sent.length, 0);
});

test('card: renders only the items the background returned and requested', async () => {
    const env = makeCardEnv({
        cardResponse: () => ({
            ok: true,
            items: [claim(), claim({ id: 'claim:sneaky', detail: { text: 'NOT ASKED' } })]
        })
    });
    startCard({ window: env.win, document: env.doc, chrome: env.chromeApi });
    await env.fire('message', {
        source: env.parent,
        data: { xrOv: 'show', nonce: NONCE, url: 'https://a.example/', itemIds: ['claim:c1'], mode: 'list', unlocated: ['claim:c1'] }
    });
    await flush();
    assert.deepEqual(env.sent[0], { type: 'xray:overlay:card', url: 'https://a.example/', itemIds: ['claim:c1'] });
    assert.ok(env.root.innerHTML.includes('Claim text'));
    assert.ok(!env.root.innerHTML.includes('NOT ASKED'));
    assert.ok(env.root.innerHTML.includes(UNLOCATED_LABEL));
});

test('card: malformed show payloads are refused', async () => {
    const env = makeCardEnv();
    startCard({ window: env.win, document: env.doc, chrome: env.chromeApi });
    const base = { xrOv: 'show', nonce: NONCE, url: 'https://a.example/', itemIds: [], mode: 'cards' };
    for (const bad of [
        { ...base, itemIds: 'x' },
        { ...base, itemIds: [1] },
        { ...base, itemIds: new Array(501).fill('a') },
        { ...base, mode: 'evil' },
        { ...base, url: 5 },
        { ...base, url: 'x'.repeat(5000) }
    ]) {
        await env.fire('message', { source: env.parent, data: bad });
    }
    await flush();
    assert.equal(env.sent.length, 0);
});

test('card: a draft never auto-saves; save needs a trusted click and sends sanitized prefill', async () => {
    const env = makeCardEnv();
    startCard({ window: env.win, document: env.doc, chrome: env.chromeApi });
    await env.fire('message', {
        source: env.parent,
        data: {
            xrOv: 'show', nonce: NONCE, url: 'https://a.example/', itemIds: [], mode: 'new-note',
            draft: {
                quote: '<b>q</b>', seconds: 12,
                anchor: [{ type: 'TextQuoteSelector', exact: 'q', prefix: 'p', suffix: 's', evil: 'x' }],
                text: 'parent-supplied text must not prefill'
            }
        }
    });
    await flush();
    assert.equal(env.sent.length, 0, 'no message on show');
    assert.ok(env.root.innerHTML.includes('&lt;b&gt;q&lt;/b&gt;'));
    assert.ok(!env.root.innerHTML.includes('parent-supplied'));
    env.textarea.value = 'my note';
    await env.click('save', null, false);           // synthetic: ignored
    await flush();
    assert.equal(env.sent.length, 0);
    await env.click('save', null, true);
    await flush();
    const save = env.sent.find((m) => m.type === 'xray:overlay:note:save');
    assert.ok(save);
    assert.deepEqual(save.note, {
        text: 'my note', quote: '<b>q</b>', seconds: 12,
        anchor: [{ type: 'TextQuoteSelector', exact: 'q', prefix: 'p', suffix: 's' }]
    });
    assert.ok(env.posted.some((p) => p.m.xrOv === 'changed'));
});

test('card: delete needs two trusted clicks', async () => {
    const id = 'note:pn_0123456789abcdef';
    const env = makeCardEnv({
        cardResponse: () => ({ ok: true, items: [{ id, kind: 'note', detail: { text: 't' } }] })
    });
    startCard({ window: env.win, document: env.doc, chrome: env.chromeApi });
    await env.fire('message', {
        source: env.parent,
        data: { xrOv: 'show', nonce: NONCE, url: 'https://a.example/', itemIds: [id], mode: 'cards' }
    });
    await flush();
    await env.click('delete', id, true);
    await flush();
    assert.ok(!env.sent.some((m) => m.type === 'xray:overlay:note:delete'), 'first click only arms');
    await env.click('delete', id, true);
    await flush();
    const del = env.sent.find((m) => m.type === 'xray:overlay:note:delete');
    assert.deepEqual(del, { type: 'xray:overlay:note:delete', url: 'https://a.example/', id: 'pn_0123456789abcdef' });
});

test('sanitizeDraft validates types and lengths', () => {
    assert.deepEqual(sanitizeDraft(null), {});
    assert.deepEqual(sanitizeDraft({ quote: 5, seconds: -1, anchor: 'x' }), {});
    assert.deepEqual(sanitizeDraft({ quote: 'x'.repeat(2001) }), {});
    assert.deepEqual(sanitizeDraft({ seconds: Infinity }), {});
    assert.equal(sanitizeDraft({ anchor: new Array(20).fill({ exact: 'a' }) }).anchor.length, 8);
});

// ---------------------------------------------------------------------------
// Parent side: mountFrame (content script)
// ---------------------------------------------------------------------------

const EXT_ORIGIN = 'chrome-extension://abc';

function makeFrameEnv() {
    const listeners = {};
    const sent = [];
    const notices = [];
    let frame = null;
    const contentWindow = { posted: [], postMessage(m, o) { this.posted.push({ m, o }); } };
    const doc = {
        createElement: (tag) => {
            frame = {
                tagName: tag.toUpperCase(), attrs: {}, style: {}, contentWindow, parentNode: null,
                setAttribute(n, v) { this.attrs[n] = String(v); },
                set className(v) { this.attrs.class = v; }, get className() { return this.attrs.class; }
            };
            return frame;
        },
        documentElement: {
            appendChild: (n) => { n.parentNode = doc.documentElement; },
            removeChild: (n) => { n.parentNode = null; }
        },
        addEventListener: () => {}, removeEventListener: () => {}
    };
    const win = {
        innerWidth: 1000, innerHeight: 800,
        location: { href: 'https://a.example/post' },
        addEventListener: (t, f) => { (listeners[t] = listeners[t] || []).push(f); },
        removeEventListener: (t, f) => { listeners[t] = (listeners[t] || []).filter((g) => g !== f); },
        crypto: { getRandomValues: (a) => { for (let i = 0; i < a.length; i++) a[i] = i * 7 + 3; return a; } }
    };
    const chromeApi = {
        runtime: {
            id: 'abc',
            getURL: (p) => EXT_ORIGIN + '/' + p,
            sendMessage: async (m) => { sent.push(m); return { ok: true, opened: false }; }
        }
    };
    const fire = (t, ev) => { for (const f of listeners[t] || []) f(ev); };
    return {
        win, doc, chromeApi, sent, notices, contentWindow, fire,
        get frame() { return frame; },
        env: { window: win, document: doc, chrome: chromeApi, notify: (m) => notices.push(m) }
    };
}

const RECT = { top: 100, left: 50, right: 150, bottom: 120, width: 100, height: 20 };

test('frame: src is the card URL with a per-mount nonce in the hash', () => {
    const t = makeFrameEnv();
    const f = mountFrame(t.env);
    f.open({ itemIds: ['claim:c1'], rect: RECT, mode: 'cards' });
    assert.equal(t.frame.attrs.class, 'xr-ov-frame');
    const src = t.frame.src || t.frame.attrs.src;
    assert.match(src, /^chrome-extension:\/\/abc\/src\/overlay\/overlay-card\.html#[A-Za-z0-9_-]{16,64}$/);
    f.close();
});

test('posts show only after ready with matching nonce', () => {
    const t = makeFrameEnv();
    const f = mountFrame(t.env);
    f.open({ itemIds: ['claim:c1'], rect: RECT, mode: 'list', unlocatedIds: ['claim:c1'] });
    const nonce = (t.frame.src || t.frame.attrs.src).split('#')[1];
    assert.equal(t.contentWindow.posted.length, 0, 'nothing before ready');
    t.fire('message', { source: t.contentWindow, origin: EXT_ORIGIN, data: { xrOv: 'ready', nonce: 'wrong-wrong-wrong-1' } });
    assert.equal(t.contentWindow.posted.length, 0, 'wrong nonce ignored');
    t.fire('message', { source: t.contentWindow, origin: EXT_ORIGIN, data: { xrOv: 'ready', nonce } });
    assert.equal(t.contentWindow.posted.length, 1);
    const { m, o } = t.contentWindow.posted[0];
    assert.equal(o, EXT_ORIGIN, 'targetOrigin is the extension origin, never *');
    assert.deepEqual(m, {
        xrOv: 'show', nonce, url: 'https://a.example/post', itemIds: ['claim:c1'],
        mode: 'list', draft: null, unlocated: ['claim:c1']
    });
    // A second ready does not re-send.
    t.fire('message', { source: t.contentWindow, origin: EXT_ORIGIN, data: { xrOv: 'ready', nonce } });
    assert.equal(t.contentWindow.posted.length, 1);
    f.close();
});

test('ignores messages from other origins', () => {
    const t = makeFrameEnv();
    const f = mountFrame(t.env);
    f.open({ itemIds: [], rect: RECT, mode: 'cards' });
    const nonce = (t.frame.src || t.frame.attrs.src).split('#')[1];
    t.fire('message', { source: t.contentWindow, origin: 'https://evil.example', data: { xrOv: 'ready', nonce } });
    t.fire('message', { source: {}, origin: EXT_ORIGIN, data: { xrOv: 'ready', nonce } });   // page window
    assert.equal(t.contentWindow.posted.length, 0);
    t.fire('message', { source: {}, origin: EXT_ORIGIN, data: { xrOv: 'close', nonce } });
    assert.ok(t.frame.parentNode, 'forged close ignored');
    t.fire('message', { source: t.contentWindow, origin: EXT_ORIGIN, data: { xrOv: 'close', nonce } });
    assert.equal(t.frame.parentNode, null);
});

test('no ready in 1500 ms → openInSidePanel sent', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
        assert.equal(FALLBACK_MS, 1500);
        const t = makeFrameEnv();
        const f = mountFrame(t.env);
        f.open({ itemIds: ['claim:c1', 'note:pn_0123456789abcdef'], rect: RECT, mode: 'cards' });
        mock.timers.tick(1499);
        assert.equal(t.sent.length, 0);
        mock.timers.tick(1);
        assert.deepEqual(t.sent[0], {
            type: 'xray:overlay:openInSidePanel', url: 'https://a.example/post',
            itemIds: ['claim:c1', 'note:pn_0123456789abcdef']
        });
        assert.equal(t.frame.parentNode, null, 'the dead frame is removed');
        await flush();
        assert.equal(t.notices.length, 1, 'tells the user when the panel could not open itself');
        f.close();
    } finally {
        mock.timers.reset();
    }
});

test('new-note CSP fallback: toast only, no side-panel focus written', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
        const t = makeFrameEnv();
        const f = mountFrame(t.env);
        f.open({ itemIds: [], rect: RECT, mode: 'new-note', draft: { quote: 'q' } });
        mock.timers.tick(1500);
        await flush();
        assert.equal(t.sent.length, 0, 'no openInSidePanel');
        assert.equal(t.notices.length, 1);
        assert.equal(t.frame.parentNode, null);
        f.close();
    } finally {
        mock.timers.reset();
    }
});

test('frame: only the card src origin is accepted', () => {
    const t = makeFrameEnv();
    const f = mountFrame(t.env);
    f.open({ itemIds: [], rect: RECT, mode: 'cards' });
    const nonce = (t.frame.src || t.frame.attrs.src).split('#')[1];
    t.fire('message', { source: t.contentWindow, origin: 'chrome-extension://other', data: { xrOv: 'ready', nonce } });
    assert.equal(t.contentWindow.posted.length, 0);
    f.close();
});

test('ready in time cancels the fallback', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
        const t = makeFrameEnv();
        const f = mountFrame(t.env);
        f.open({ itemIds: ['claim:c1'], rect: RECT, mode: 'cards' });
        const nonce = (t.frame.src || t.frame.attrs.src).split('#')[1];
        mock.timers.tick(500);
        t.fire('message', { source: t.contentWindow, origin: EXT_ORIGIN, data: { xrOv: 'ready', nonce } });
        mock.timers.tick(5000);
        assert.equal(t.sent.length, 0);
        f.close();
    } finally {
        mock.timers.reset();
    }
});

test('positionFor clamps the card to the viewport', () => {
    const vp = { width: 1000, height: 800 };
    const size = { width: 360, height: 300 };
    assert.deepEqual(positionFor({ top: 100, bottom: 120, left: 50 }, size, vp), { left: 50, top: 126 });
    // Too far right → clamped inside.
    assert.equal(positionFor({ top: 100, bottom: 120, left: 900 }, size, vp).left, 1000 - 360 - 8);
    // No room below → flips above.
    assert.equal(positionFor({ top: 700, bottom: 720, left: 0 }, size, vp).top, 700 - 300 - 6);
    // No room either way → pinned to the top margin.
    assert.equal(positionFor({ top: 50, bottom: 760, left: 0 }, size, vp).top, 8);
    // Garbage rect → sane defaults.
    const g = positionFor(null, size, vp);
    assert.ok(g.left >= 8 && g.top >= 8);
});

// ---------------------------------------------------------------------------
// Background: xray:overlay:openInSidePanel
// ---------------------------------------------------------------------------

function sidePanelIo({ flag = true } = {}) {
    const writes = [];
    const opened = [];
    return {
        writes, opened,
        loadFlags: async () => {},
        isEnabled: (f) => f === 'inlineOverlay' && flag,
        getURL: (p) => EXT_ORIGIN + '/' + p,
        writeSidePanelFocus: async (v) => { writes.push(v); },
        openSidePanel: async (tab) => { opened.push(tab.id); return true; }
    };
}

const tabSender = (url) => ({ url, tab: { id: 7, windowId: 1, url } });

test('openInSidePanel: stores {url, itemIds} only and opens the panel for the tab', async () => {
    const io = sidePanelIo();
    const r = await handleOverlayMessage(
        { type: 'xray:overlay:openInSidePanel', url: 'https://a.example/post', itemIds: ['claim:c1'], text: 'SECRET' },
        tabSender('https://a.example/post?utm_source=x'), io);
    assert.deepEqual(r, { ok: true, opened: true });
    assert.deepEqual(io.writes, [{ url: 'https://a.example/post', itemIds: ['claim:c1'] }]);
    assert.deepEqual(io.opened, [7]);
});

test('openInSidePanel: refused when the url is not the sender tab url, or tabless', async () => {
    const io = sidePanelIo();
    const msg = { type: 'xray:overlay:openInSidePanel', url: 'https://other.example/', itemIds: [] };
    assert.equal((await handleOverlayMessage(msg, tabSender('https://a.example/post'), io)).error, 'forbidden');
    assert.equal((await handleOverlayMessage(msg, { url: EXT_ORIGIN + '/src/sidepanel/index.html' }, io)).error, 'forbidden');
    assert.equal(io.writes.length, 0);
});

test('openInSidePanel: itemIds must be an array of at most 500 strings', async () => {
    const io = sidePanelIo();
    const url = 'https://a.example/post';
    for (const itemIds of ['x', [1], new Array(501).fill('a'), ['x'.repeat(300)], undefined]) {
        const r = await handleOverlayMessage({ type: 'xray:overlay:openInSidePanel', url, itemIds }, tabSender(url), io);
        assert.equal(r.ok, false);
    }
    assert.equal(io.writes.length, 0);
    const ok = await handleOverlayMessage(
        { type: 'xray:overlay:openInSidePanel', url, itemIds: new Array(500).fill('a') }, tabSender(url), io);
    assert.equal(ok.ok, true);
});

test('openInSidePanel: refused while the inlineOverlay flag is off', async () => {
    const io = sidePanelIo({ flag: false });
    const url = 'https://a.example/post';
    const r = await handleOverlayMessage({ type: 'xray:overlay:openInSidePanel', url, itemIds: [] }, tabSender(url), io);
    assert.equal(r.ok, false);
    assert.equal(io.writes.length, 0);
    assert.equal(io.opened.length, 0);
});
