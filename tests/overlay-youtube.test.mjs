import { test, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// ---- chrome stub (storage.js reads chrome.* at import time) ----------------
const _store = new Map();
const _sent = [];
let _items = [];
globalThis.chrome = {
    storage: {
        local: {
            get(keys, cb) {
                const out = {};
                for (const k of Array.isArray(keys) ? keys : [keys]) if (_store.has(k)) out[k] = _store.get(k);
                cb(out);
            },
            set(obj, cb) { for (const [k, v] of Object.entries(obj)) _store.set(k, v); cb && cb(); },
            remove(keys, cb) { for (const k of Array.isArray(keys) ? keys : [keys]) _store.delete(k); cb && cb(); }
        }
    },
    runtime: {
        getURL: (p) => p,
        sendMessage: async (m) => { _sent.push(m); return { ok: true, items: _items }; },
        onMessage: { addListener() {}, removeListener() {} }
    }
};

const { mountYouTube, isWatchPage, videoSeconds, AUTO_CLOSE_MS, PLAYER_WAIT_MS } =
    await import('../src/content/overlay-youtube.js');
const { startOverlay } = await import('../src/content/overlay.js');
const { stripOverlayNodes, OVERLAY_REMOVE_SELECTOR } = await import('../src/shared/overlay-strip.js');

// ---- hand-built stubs ------------------------------------------------------
class El {
    constructor(tag) {
        this.nodeType = 1; this.tagName = tag.toUpperCase(); this.childNodes = [];
        this.parentNode = null; this.attrs = {}; this.listeners = {}; this.style = {};
    }
    getAttribute(n) { return n in this.attrs ? this.attrs[n] : null; }
    setAttribute(n, v) { this.attrs[n] = String(v); }
    get className() { return this.attrs.class || ''; }
    set className(v) { this.attrs.class = v; }
    get id() { return this.attrs.id || ''; }
    set id(v) { this.attrs.id = v; }
    appendChild(n) {
        if (n.parentNode) n.parentNode.removeChild(n);
        this.childNodes.push(n); n.parentNode = this; return n;
    }
    removeChild(n) {
        const i = this.childNodes.indexOf(n);
        if (i >= 0) this.childNodes.splice(i, 1);
        n.parentNode = null; return n;
    }
    insertBefore(n, ref) { this.appendChild(n); return n; }
    get textContent() { return this.childNodes.map((c) => (c.nodeType === 3 ? c.data : c.textContent)).join(''); }
    set textContent(v) { this.childNodes = [{ nodeType: 3, data: String(v), parentNode: this }]; }
    addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }
    removeEventListener(t, f) { this.listeners[t] = (this.listeners[t] || []).filter((x) => x !== f); }
    dispatchEvent(ev) { for (const f of (this.listeners[ev.type] || []).slice()) f(ev); return true; }
    click() { this.dispatchEvent({ type: 'click', preventDefault() {}, stopPropagation() {} }); }
    getBoundingClientRect() { return { top: 100, left: 50, right: 850, bottom: 550, width: 800, height: 450 }; }
}
function makeDoc() {
    const doc = new El('#document');
    doc.registry = {};
    doc.querySelector = (sel) => doc.registry[sel] || null;
    doc.createElement = (t) => new El(t);
    doc.createTextNode = (d) => ({ nodeType: 3, data: d, parentNode: null });
    doc.documentElement = new El('html');
    doc.head = new El('head');
    doc.body = new El('body');
    doc.documentElement.appendChild(doc.head);
    doc.documentElement.appendChild(doc.body);
    return doc;
}
function makeVideo(duration = 600) {
    const v = new El('video');
    v.currentTime = 0; v.duration = duration;
    return v;
}
const timeTo = (video, t) => { video.currentTime = t; video.dispatchEvent({ type: 'timeupdate' }); };
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };

let doc, video, bar, opens, closes, handles;
const item = (id, seconds) => ({ id, kind: 'note', anchor: [], quote: '', seconds, judgmentKinds: [], reviewState: null });
const mount = (items, extra = {}) => {
    const h = mountYouTube({
        document: doc,
        onOpen: (d) => { opens.push(d); extra.onOpenHook && extra.onOpenHook(d); },
        onClose: () => closes.push(1)
    }, items);
    handles.push(h);
    return h;
};
const ticks = () => (bar.childNodes[0] ? bar.childNodes[0].childNodes : []);

beforeEach(() => {
    mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    doc = makeDoc(); video = makeVideo(600); bar = new El('div');
    doc.registry['video.html5-main-video'] = video;
    doc.registry['.ytp-progress-bar-container'] = bar;
    opens = []; closes = []; handles = []; _store.clear(); _sent.length = 0; _items = [];
});
afterEach(() => { handles.forEach((h) => h.teardown()); mock.timers.reset(); });

test('tick position = seconds/duration, with an id-only data attribute and a plain label', () => {
    mount([item('a', 150), item('b', 300)]);
    assert.equal(bar.childNodes.length, 1);
    assert.equal(bar.childNodes[0].className, 'xr-ov-yt-strip');
    const t = ticks();
    assert.deepEqual(t.map((x) => x.className), ['xr-ov-yt-tick', 'xr-ov-yt-tick']);
    assert.deepEqual(t.map((x) => x.style.left), ['25%', '50%']);
    assert.deepEqual(t.map((x) => x.getAttribute('data-xr-ov-ids')), ['a', 'b']);
    assert.equal(t[0].getAttribute('aria-label'), 'X-Ray note at 2:30');
    assert.equal(t[0].textContent, '');
});

test('items at the same second share one tick', () => {
    mount([item('a', 60), item('b', 60)]);
    assert.equal(ticks().length, 1);
    assert.equal(ticks()[0].getAttribute('data-xr-ov-ids'), 'a,b');
});

test('click seeks the video to the item seconds', () => {
    mount([item('a', 150)]);
    ticks()[0].click();
    assert.equal(video.currentTime, 150);
});

test('auto-pop fires once per crossing and re-arms when playback leaves the window', () => {
    mount([item('a', 100)]);
    timeTo(video, 98);
    assert.equal(opens.length, 0);
    timeTo(video, 99);                       // enters [s-1, s+1]
    assert.equal(opens.length, 1);
    assert.deepEqual(opens[0].itemIds, ['a']);
    assert.equal(opens[0].mode, 'cards');
    assert.equal(typeof opens[0].rect.top, 'number');
    timeTo(video, 99.5); timeTo(video, 100); timeTo(video, 101);
    assert.equal(opens.length, 1);           // still inside: no repeat
    timeTo(video, 102);                      // left the window
    timeTo(video, 100);                      // seeked back: second crossing
    assert.equal(opens.length, 2);
});

test('auto-close after 8000 ms, but not while hovered', () => {
    const frame = new El('iframe');
    mount([item('a', 100)], { onOpenHook: () => { doc.registry['.xr-ov-frame'] = frame; } });
    timeTo(video, 100);
    mock.timers.tick(AUTO_CLOSE_MS - 1);
    assert.equal(closes.length, 0);
    mock.timers.tick(1);
    assert.equal(closes.length, 1);

    // Hovered: the timer is held until the pointer leaves.
    timeTo(video, 300); timeTo(video, 100);          // re-arm and re-cross
    assert.equal(opens.length, 2);
    frame.dispatchEvent({ type: 'mouseenter' });
    mock.timers.tick(AUTO_CLOSE_MS * 3);
    assert.equal(closes.length, 1);
    frame.dispatchEvent({ type: 'mouseleave' });
    mock.timers.tick(AUTO_CLOSE_MS);
    assert.equal(closes.length, 2);
});

test('auto-close leaves a different card (opened since) alone', () => {
    const frame = new El('iframe');
    mount([item('a', 100)], { onOpenHook: () => { doc.registry['.xr-ov-frame'] = frame; } });
    timeTo(video, 100);
    doc.registry['.xr-ov-frame'] = new El('iframe');   // user opened a pin card
    mock.timers.tick(AUTO_CLOSE_MS);
    assert.equal(closes.length, 0);
});

test('seconds past the duration are not ticked and report as unlocated', async () => {
    const h = mount([item('in', 100), item('past', 601)]);
    assert.equal(ticks().length, 1);
    assert.deepEqual(await h.ready, { located: ['in'], unlocated: ['past'] });
});

test('no player within 10 s: no strip, every item unlocated', async () => {
    doc.registry = {};
    const h = mount([item('a', 100)]);
    assert.equal(bar.childNodes.length, 0);
    mock.timers.tick(PLAYER_WAIT_MS);
    assert.deepEqual(await h.ready, { located: [], unlocated: ['a'] });
    assert.equal(bar.childNodes.length, 0);
});

test('player arriving late (duration at 3 s) still gets ticks', async () => {
    video.duration = NaN;
    const h = mount([item('a', 100)]);
    assert.equal(bar.childNodes.length, 0);
    mock.timers.tick(3000);
    video.duration = 600;
    mock.timers.tick(250);
    assert.equal(ticks().length, 1);
    assert.deepEqual((await h.ready).located, ['a']);
});

test('teardown removes the strip and the timeupdate listener', () => {
    const h = mount([item('a', 100)]);
    h.teardown();
    assert.equal(bar.childNodes.length, 0);
    timeTo(video, 100);
    assert.equal(opens.length, 0);
});

test('currentSeconds reads the video; videoSeconds is null without a player', () => {
    const h = mount([item('a', 100)]);
    video.currentTime = 42.5;
    assert.equal(h.currentSeconds(), 42.5);
    assert.equal(videoSeconds(doc), 42.5);
    assert.equal(videoSeconds(makeDoc()), null);
});

test('isWatchPage accepts only youtube.com/watch', () => {
    assert.equal(isWatchPage('https://www.youtube.com/watch?v=abc'), true);
    assert.equal(isWatchPage('https://www.youtube.com/shorts/abc'), false);
    assert.equal(isWatchPage('https://example.com/watch'), false);
    assert.equal(isWatchPage('nope'), false);
});

test('ticks and strip are in the capture-strip selector', () => {
    assert.match(OVERLAY_REMOVE_SELECTOR, /\.xr-ov-yt-strip/);
    assert.match(OVERLAY_REMOVE_SELECTOR, /\.xr-ov-yt-tick/);
    assert.equal(typeof stripOverlayNodes, 'function');
});

// ---- integration through startOverlay --------------------------------------
function overlayWin(href) {
    const body = doc.body;
    const p = new El('p'); p.appendChild(doc.createTextNode('Nothing here matches.')); body.appendChild(p);
    return {
        location: { href, hostname: 'www.youtube.com' },
        document: doc, getSelection: () => null
    };
}
const chipText = () => {
    const find = (n) => {
        for (const c of n.childNodes || []) {
            if (c.nodeType === 1 && /xr-ov-chip-label/.test(c.className)) return c.textContent;
            const r = c.nodeType === 1 ? find(c) : null; if (r) return r;
        }
        return null;
    };
    return find(doc.body);
};
const startOv = (win, extra = {}) => {
    const h = startOverlay({ window: win, document: doc, chrome: globalThis.chrome, ...extra });
    handles.push(h); return h;
};

test('youtube: located ticks leave the chip; past-duration items stay "not located" (ids in the list)', async () => {
    const win = overlayWin('https://www.youtube.com/watch?v=abc');
    _items = [
        { ...item('a', 100), anchor: [{ type: 'TextQuoteSelector', exact: 'absent quote one' }] },
        { ...item('b', 900), anchor: [{ type: 'TextQuoteSelector', exact: 'absent quote two' }] }
    ];
    startOv(win, { onOpen: (d) => opens.push(d) });
    await flush();
    assert.equal(ticks().length, 1);
    assert.equal(chipText(), 'X-Ray: 2 notes · 1 not located');
    const chip = doc.body.childNodes.find((c) => /xr-ov-chip/.test(c.className));
    const menu = chip.childNodes.find((c) => /xr-ov-menu/.test(c.className));
    menu.childNodes.find((c) => /show-all/.test(c.className)).click();
    assert.deepEqual(opens.at(-1).unlocatedIds, ['b']);
});

test('youtube: ticks cleared on yt-navigate-finish before relookup', async () => {
    const win = overlayWin('https://www.youtube.com/watch?v=abc');
    _items = [{ ...item('a', 100), anchor: [{ type: 'TextQuoteSelector', exact: 'absent' }] }];
    startOv(win);
    await flush();
    assert.equal(ticks().length, 1);
    assert.equal(_sent.length, 1);

    let resolveLookup;
    chrome.runtime.sendMessage = async (m) => { _sent.push(m); await new Promise((r) => { resolveLookup = r; }); return { ok: true, items: [] }; };
    win.location.href = 'https://www.youtube.com/watch?v=def';
    doc.dispatchEvent({ type: 'yt-navigate-finish' });
    assert.equal(bar.childNodes.length, 0, 'strip removed synchronously, before the lookup resolves');
    await flush();
    assert.equal(_sent.length, 2);
    assert.equal(_sent[1].url, 'https://www.youtube.com/watch?v=def');
    resolveLookup();
    await flush();
    assert.equal(bar.childNodes.length, 0);
    // restore the shared stub for later tests
    chrome.runtime.sendMessage = async (m) => { _sent.push(m); return { ok: true, items: _items }; };
});

test('youtube: overlay teardown removes the ticks; non-watch pages get none', async () => {
    const win = overlayWin('https://www.youtube.com/watch?v=abc');
    _items = [{ ...item('a', 100), anchor: [{ type: 'TextQuoteSelector', exact: 'absent' }] }];
    const h = startOv(win);
    await flush();
    assert.equal(ticks().length, 1);
    h.teardown();
    assert.equal(bar.childNodes.length, 0);

    doc = makeDoc(); video = makeVideo(); bar = new El('div');
    doc.registry['video.html5-main-video'] = video;
    doc.registry['.ytp-progress-bar-container'] = bar;
    const win2 = overlayWin('https://www.youtube.com/results?search_query=x');
    startOv(win2);
    await flush();
    assert.equal(bar.childNodes.length, 0);
});

test('youtube: new-note command with no selection uses the injected video-seconds hook', async () => {
    const win = overlayWin('https://www.youtube.com/watch?v=abc');
    const listeners = new Set();
    const api = { ...globalThis.chrome, runtime: { ...globalThis.chrome.runtime, onMessage: { addListener: (f) => listeners.add(f), removeListener: (f) => listeners.delete(f) } } };
    const h = startOverlay({ window: win, document: doc, chrome: api, onOpen: (d) => opens.push(d), getVideoSeconds: () => videoSeconds(doc) });
    handles.push(h);
    await flush();
    video.currentTime = 73;
    for (const f of listeners) f({ type: 'xray:overlay:addNote' });
    assert.equal(opens.at(-1).mode, 'new-note');
    assert.deepEqual(opens.at(-1).draft, { seconds: 73 });
});
