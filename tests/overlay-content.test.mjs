import { test, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// ---- chrome stub (storage.js reads chrome.* at import time) ----------------
const _store = new Map();
const _sent = [];
let _lookupImpl = async () => ({ ok: true, items: [] });
const _msgListeners = new Set();
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
        sendMessage: async (m) => { _sent.push(m); return _lookupImpl(m); },
        onMessage: {
            addListener: (f) => _msgListeners.add(f),
            removeListener: (f) => _msgListeners.delete(f)
        }
    }
};

const { startOverlay, collectSegments, captureSelection } = await import('../src/content/overlay.js');
const { Storage } = await import('../src/shared/storage.js');

// ---- minimal DOM stub ------------------------------------------------------
class TextNode {
    constructor(data) { this.nodeType = 3; this.data = data; this.parentNode = null; this.ownerDocument = null; }
    splitText(off) {
        const rest = new TextNode(this.data.slice(off));
        rest.ownerDocument = this.ownerDocument;
        this.data = this.data.slice(0, off);
        const p = this.parentNode;
        p.childNodes.splice(p.childNodes.indexOf(this) + 1, 0, rest);
        rest.parentNode = p;
        return rest;
    }
}
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
class El {
    constructor(tag, doc) {
        this.nodeType = 1; this.tagName = tag.toUpperCase(); this.childNodes = [];
        this.parentNode = null; this.attrs = {}; this.listeners = {}; this.ownerDocument = doc;
    }
    get firstChild() { return this.childNodes[0] || null; }
    getAttribute(n) { return n in this.attrs ? this.attrs[n] : null; }
    setAttribute(n, v) { this.attrs[n] = String(v); }
    get className() { return this.attrs.class || ''; }
    set className(v) { this.attrs.class = v; }
    get id() { return this.attrs.id || ''; }
    set id(v) { this.attrs.id = v; }
    _detach(n) { if (n.parentNode) n.parentNode.childNodes.splice(n.parentNode.childNodes.indexOf(n), 1); n.parentNode = null; }
    appendChild(n) { this._detach(n); this.childNodes.push(n); n.parentNode = this; return n; }
    insertBefore(n, ref) {
        this._detach(n);
        const i = ref ? this.childNodes.indexOf(ref) : this.childNodes.length;
        this.childNodes.splice(i, 0, n); n.parentNode = this; return n;
    }
    removeChild(n) { this._detach(n); return n; }
    replaceChildren(...ns) { for (const c of this.childNodes) c.parentNode = null; this.childNodes = []; ns.forEach((n) => this.appendChild(n)); }
    normalize() {
        const out = [];
        for (const c of this.childNodes) {
            if (c.nodeType === 3) {
                if (!c.data) { c.parentNode = null; continue; }
                const prev = out[out.length - 1];
                if (prev && prev.nodeType === 3) { prev.data += c.data; c.parentNode = null; continue; }
            } else c.normalize();
            out.push(c);
        }
        this.childNodes = out;
    }
    get textContent() { return this.childNodes.map((c) => (c.nodeType === 3 ? c.data : c.textContent)).join(''); }
    set textContent(v) { this.replaceChildren(new TextNode(v)); }
    get innerHTML() {
        return this.childNodes.map((c) => c.nodeType === 3 ? esc(c.data)
            : `<${c.tagName.toLowerCase()}${Object.entries(c.attrs).map(([k, v]) => ` ${k}="${v}"`).join('')}>${c.innerHTML}</${c.tagName.toLowerCase()}>`).join('');
    }
    addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }
    removeEventListener(t, f) { this.listeners[t] = (this.listeners[t] || []).filter((x) => x !== f); }
    dispatchEvent(ev) { for (const f of this.listeners[ev.type] || []) f(ev); return true; }
    click() { for (const f of this.listeners.click || []) f({ preventDefault() {}, stopPropagation() {} }); }
    getBoundingClientRect() { return { top: 1, left: 2, right: 3, bottom: 4, width: 1, height: 3 }; }
    querySelector(sel) {
        const test = sel === 'article' ? (e) => e.tagName === 'ARTICLE'
            : sel === '[role=main]' ? (e) => e.attrs.role === 'main' : () => false;
        const walk = (n) => {
            for (const c of n.childNodes) {
                if (c.nodeType !== 1) continue;
                if (test(c)) return c;
                const r = walk(c); if (r) return r;
            }
            return null;
        };
        return walk(this);
    }
}
function makeDoc() {
    const doc = new El('#document', null);
    doc.createElement = (t) => new El(t, doc);
    doc.createTextNode = (d) => { const t = new TextNode(d); t.ownerDocument = doc; return t; };
    doc.documentElement = doc.createElement('html');
    doc.head = doc.createElement('head');
    doc.body = doc.createElement('body');
    doc.documentElement.appendChild(doc.head);
    doc.documentElement.appendChild(doc.body);
    doc.appendChild(doc.documentElement);
    doc.ownerDocument = doc;
    return doc;
}
let doc, win, observers, selection;
class FakeMO {
    constructor(cb) { this.cb = cb; this.live = false; observers.push(this); }
    observe() { this.live = true; }
    disconnect() { this.live = false; }
    takeRecords() { return []; }
}
function all(root, pred, out = []) {
    for (const c of root.childNodes) { if (c.nodeType === 1) { if (pred(c)) out.push(c); all(c, pred, out); } }
    return out;
}
const marksOf = () => all(doc.body, (e) => /\bxr-ov-mark\b/.test(e.className));
const chipOf = () => all(doc.body, (e) => /\bxr-ov-chip\b/.test(e.className))[0];
const chipText = () => all(chipOf(), (e) => /xr-ov-chip-label/.test(e.className))[0].textContent;
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };

function page(...paras) {
    const art = doc.createElement('article');
    for (const p of paras) { const el = doc.createElement('p'); el.appendChild(doc.createTextNode(p)); art.appendChild(el); }
    doc.body.appendChild(art);
    return art;
}
const claim = (id, exact) => ({ id, kind: 'claim', anchor: [{ type: 'TextQuoteSelector', exact }], quote: exact, seconds: null, judgmentKinds: [], reviewState: null });
const lookupReturns = (items) => { _lookupImpl = async () => ({ ok: true, items }); };
let handles = [];
const start = (extra = {}) => { const h = startOverlay({ window: win, document: doc, chrome: globalThis.chrome, ...extra }); handles.push(h); return h; };

beforeEach(() => {
    mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    _store.clear(); _sent.length = 0; _msgListeners.clear(); handles = [];
    _lookupImpl = async () => ({ ok: true, items: [] });
    doc = makeDoc(); observers = []; selection = null;
    win = {
        location: { href: 'https://example.com/a', hostname: 'example.com' },
        document: doc, MutationObserver: FakeMO, CustomEvent: globalThis.CustomEvent,
        getSelection: () => selection
    };
});
afterEach(() => { handles.forEach((h) => h.teardown()); mock.timers.reset(); });

test('marks wrap resolved ranges and carry data-xr-ov', async () => {
    page('Alpha beta gamma delta.', 'Second paragraph.');
    lookupReturns([claim('c1', 'beta gamma')]);
    start(); await flush();
    const marks = marksOf();
    assert.equal(marks.length, 1);
    assert.equal(marks[0].textContent, 'beta gamma');
    assert.equal(marks[0].getAttribute('data-xr-ov'), 'c1');
    assert.match(marks[0].className, /xr-ov-claim/);
    const pins = all(doc.body, (e) => e.className === 'xr-ov-pin');
    assert.equal(pins.length, 1);
    assert.equal(pins[0].getAttribute('data-xr-ov-ids'), 'c1');
    assert.ok(doc.head.childNodes.some((n) => n.id === 'xr-ov-style'));
    assert.equal(_sent[0].type, 'xray:overlay:lookup');
    assert.equal(_sent[0].url, 'https://example.com/a');
});

test('overlapping items nest marks and share one pin per end position', async () => {
    page('Alpha beta gamma delta.');
    lookupReturns([claim('c1', 'beta gamma'), claim('e1', 'beta gamma')]);
    start(); await flush();
    assert.equal(marksOf().length, 2);
    const pins = all(doc.body, (e) => e.className === 'xr-ov-pin');
    assert.equal(pins.length, 1);
    assert.equal(pins[0].getAttribute('data-xr-ov-ids'), 'c1,e1');
});

test('pin click and Show all dispatch xr-ov:open', async () => {
    page('Alpha beta gamma delta.');
    lookupReturns([claim('c1', 'beta gamma')]);
    const events = [];
    let domEvents = 0;
    doc.addEventListener('xr-ov:open', () => domEvents++);
    start({ onOpen: (d) => events.push(d) }); await flush();
    all(doc.body, (e) => e.className === 'xr-ov-pin')[0].click();
    all(doc.body, (e) => e.className === 'xr-ov-show-all')[0].click();
    assert.deepEqual(events.map((e) => [e.mode, e.itemIds]), [['cards', ['c1']], ['list', ['c1']]]);
    assert.ok(events[0].rect && 'top' in events[0].rect);
    assert.equal(domEvents, 0, 'no page-visible DOM event is dispatched');
});

test('teardown fully restores the original text nodes (innerHTML identical)', async () => {
    page('Alpha beta gamma delta.', 'Second paragraph.');
    const before = doc.body.innerHTML;
    lookupReturns([claim('c1', 'beta gamma'), claim('c2', 'Second')]);
    const h = start(); await flush();
    assert.notEqual(doc.body.innerHTML, before);
    h.teardown();
    assert.equal(doc.body.innerHTML, before);
    assert.equal(doc.body.querySelector('article').childNodes[0].childNodes.length, 1);
    assert.equal(doc.head.childNodes.length, 0);
    assert.equal(_msgListeners.size, 0);
});

test('URL change -> teardown then relookup', async () => {
    page('Alpha beta gamma delta.');
    lookupReturns([claim('c1', 'beta gamma')]);
    start(); await flush();
    assert.equal(marksOf().length, 1);
    win.location.href = 'https://example.com/b';
    lookupReturns([claim('c9', 'delta')]);
    mock.timers.tick(1000); await flush();
    assert.equal(_sent.length, 2);
    assert.equal(_sent[1].url, 'https://example.com/b');
    const marks = marksOf();
    assert.deepEqual(marks.map((m) => m.getAttribute('data-xr-ov')), ['c9']);
    assert.equal(all(doc.body, (e) => e.className === 'xr-ov-chip').length, 1);
});

test('unresolved items are counted in the chip', async () => {
    page('Alpha beta gamma delta.');
    lookupReturns([claim('c1', 'beta gamma'), claim('c2', 'not on this page at all')]);
    start(); await flush();
    assert.equal(chipText(), 'X-Ray: 2 notes · 1 not located');
});

test('chip omits "not located" when zero', async () => {
    page('Alpha beta gamma delta.');
    lookupReturns([claim('c1', 'beta gamma')]);
    start(); await flush();
    assert.equal(chipText(), 'X-Ray: 1 notes');
});

test('over 2 MB -> chip only, no marks', async () => {
    page('lorem ipsum dolor '.repeat(125000));
    lookupReturns([claim('c1', 'lorem ipsum dolor')]);
    start(); await flush();
    assert.equal(marksOf().length, 0);
    assert.equal(chipText(), 'X-Ray: 1 notes · 1 not located');
});

test('page removing marks re-adds at most 3 times', async () => {
    const art = page('Alpha beta gamma delta.');
    lookupReturns([claim('c1', 'beta gamma')]);
    start(); await flush();
    const p = art.childNodes[0];
    const wipe = () => {
        p.replaceChildren(doc.createTextNode('Alpha beta gamma delta.'));
        observers.filter((o) => o.live).forEach((o) => o.cb([]));
        mock.timers.tick(2000);
    };
    for (let i = 1; i <= 3; i++) { wipe(); assert.equal(marksOf().length, 1, 're-add ' + i); }
    wipe();
    assert.equal(marksOf().length, 0, 'fourth wipe is not re-added');
    assert.equal(_sent.length, 1, 're-adds reuse the cached lookup');
});

test('observer gives up after 30 s', async () => {
    page('Alpha beta gamma delta.');
    lookupReturns([claim('c1', 'beta gamma')]);
    start(); await flush();
    assert.ok(observers.some((o) => o.live));
    mock.timers.tick(30000);
    assert.ok(observers.every((o) => !o.live));
});

test('captureSelection builds a quote selector with context and ignores xr-ov UI', () => {
    const art = page('Alpha beta gamma delta.');
    const text = art.childNodes[0].childNodes[0];
    const range = (sc, so, ec, eo) => ({
        collapsed: false, startContainer: sc, startOffset: so, endContainer: ec, endOffset: eo,
        commonAncestorContainer: sc.parentNode
    });
    const sel = (r) => ({ rangeCount: 1, getRangeAt: () => r });
    const got = captureSelection(sel(range(text, 6, text, 16)));
    assert.equal(got.quote, 'beta gamma');
    assert.deepEqual(got.anchor, [{ type: 'TextQuoteSelector', exact: 'beta gamma', prefix: 'Alpha ', suffix: ' delta.' }]);

    const chip = doc.createElement('div'); chip.className = 'xr-ov-chip';
    const t2 = doc.createTextNode('X-Ray: 1 notes'); chip.appendChild(t2); doc.body.appendChild(chip);
    assert.equal(captureSelection(sel(range(t2, 0, t2, 5))), null);
    assert.equal(captureSelection(null), null);
});

test('collectSegments skips script/style/hidden and xr-ov UI but keeps mark text', () => {
    const art = page('Visible text');
    const s = doc.createElement('script'); s.appendChild(doc.createTextNode('evil()')); art.appendChild(s);
    const h = doc.createElement('div'); h.setAttribute('aria-hidden', 'true'); h.appendChild(doc.createTextNode('hidden')); art.appendChild(h);
    const pin = doc.createElement('span'); pin.className = 'xr-ov-pin'; pin.appendChild(doc.createTextNode('X-Ray')); art.appendChild(pin);
    const m = doc.createElement('mark'); m.className = 'xr-ov-mark xr-ov-claim'; m.appendChild(doc.createTextNode(' marked')); art.appendChild(m);
    assert.deepEqual(collectSegments(art).map((x) => x.text), ['Visible text', ' marked']);
});

test('site in overlay_site_off -> no lookup sent', async () => {
    page('Alpha beta gamma delta.');
    await Storage.set('overlay_site_off', ['example.com']);
    lookupReturns([claim('c1', 'beta gamma')]);
    start(); await flush();
    assert.equal(_sent.length, 0);
    assert.equal(marksOf().length, 0);
});

test('Hide on this site writes the hostname and tears down', async () => {
    page('Alpha beta gamma delta.');
    lookupReturns([claim('c1', 'beta gamma')]);
    start(); await flush();
    all(doc.body, (e) => e.className === 'xr-ov-hide-site')[0].click();
    await flush();
    assert.deepEqual(await Storage.get('overlay_site_off', []), ['example.com']);
    assert.equal(marksOf().length, 0);
    assert.equal(chipOf(), undefined);
});

test('lookup retries once after 1000 ms on failure, then gives up', async () => {
    page('Alpha beta gamma delta.');
    _lookupImpl = async () => { throw new Error('sw asleep'); };
    start(); await flush();
    assert.equal(_sent.length, 1);
    mock.timers.tick(1000); await flush();
    assert.equal(_sent.length, 2);
    mock.timers.tick(5000); await flush();
    assert.equal(_sent.length, 2);
    assert.equal(chipOf(), undefined);
});

test('addNote command: selection -> draft; no selection -> seconds; neither -> nothing', async () => {
    const art = page('Alpha beta gamma delta.');
    const text = art.childNodes[0].childNodes[0];
    const events = [];
    let secs = null;
    start({ getVideoSeconds: () => secs, onOpen: (d) => events.push(d) }); await flush();
    const fire = () => _msgListeners.forEach((f) => f({ type: 'xray:overlay:addNote' }));
    fire();
    assert.equal(events.length, 0);
    secs = 42; fire();
    assert.deepEqual(events[0].draft, { seconds: 42 });
    assert.equal(events[0].mode, 'new-note');
    selection = {
        rangeCount: 1,
        getRangeAt: () => ({ collapsed: false, startContainer: text, startOffset: 6, endContainer: text, endOffset: 16, commonAncestorContainer: text.parentNode, getBoundingClientRect: () => ({ top: 9, left: 9, right: 9, bottom: 9, width: 0, height: 0 }) })
    };
    fire();
    assert.equal(events[1].draft.quote, 'beta gamma');
    assert.equal(events[1].rect.top, 9);
    _msgListeners.forEach((f) => f({ type: 'other' }));
    assert.equal(events.length, 2);
});

test('multi-node item is fully marked after an earlier item split its first node', async () => {
    const art = doc.createElement('article');
    const p = doc.createElement('p');
    const em = doc.createElement('em');
    em.appendChild(doc.createTextNode('delta'));
    p.appendChild(doc.createTextNode('Alpha beta gamma '));
    p.appendChild(em);
    art.appendChild(p); doc.body.appendChild(art);
    lookupReturns([claim('c1', 'Alpha'), claim('c2', 'gamma delta')]);
    start(); await flush();
    const c2 = marksOf().filter((m) => m.getAttribute('data-xr-ov') === 'c2').map((m) => m.textContent).join('|');
    assert.equal(c2, 'gamma |delta');
});

test('teardown restores page-owned text nodes exactly (adjacent + empty nodes survive)', async () => {
    const art = doc.createElement('article');
    const p = doc.createElement('p');
    const a = doc.createTextNode('Hello, ');
    const e = doc.createTextNode('');
    const b = doc.createTextNode('world and more text here.');
    p.appendChild(a); p.appendChild(e); p.appendChild(b);
    art.appendChild(p); doc.body.appendChild(art);
    const before = doc.body.innerHTML;
    lookupReturns([claim('c1', 'Hello, world and'), claim('c2', 'more')]);
    const h = start(); await flush();
    assert.ok(marksOf().length >= 2);
    h.teardown();
    assert.equal(doc.body.innerHTML, before);
    assert.deepEqual(p.childNodes, [a, e, b]);
    assert.deepEqual([a.data, e.data, b.data], ['Hello, ', '', 'world and more text here.']);
});

test('hash-only navigation does not relookup; path change does', async () => {
    page('Alpha beta gamma delta.');
    lookupReturns([claim('c1', 'beta gamma')]);
    start(); await flush();
    win.location.href = 'https://example.com/a#footnote-1';
    mock.timers.tick(1000); await flush();
    assert.equal(_sent.length, 1);
    assert.equal(marksOf().length, 1);
    win.location.href = 'https://example.com/b#x';
    mock.timers.tick(1000); await flush();
    assert.equal(_sent.length, 2);
});

test('unknown item kinds are skipped, never put in a className', async () => {
    page('Alpha beta gamma delta.');
    lookupReturns([{ ...claim('x1', 'beta'), kind: 'claim" onclick="x' }, claim('c1', 'gamma')]);
    start(); await flush();
    assert.deepEqual(marksOf().map((m) => m.getAttribute('data-xr-ov')), ['c1']);
    assert.equal(chipText(), 'X-Ray: 1 notes');
});
