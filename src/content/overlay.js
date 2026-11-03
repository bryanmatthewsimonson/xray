// Inline overlay — content-script side (isolated world, every tab, flag
// `inlineOverlay`). Receives LOCATING data only (LookupItems: ids, kinds,
// anchors, quotes) from the background and draws <mark> markers, pins and
// a chip. It never holds or renders note text, verdicts or assessments:
// the card UI is an extension iframe (overlay-frame.js) opened through
// the isolated-world `env.onOpen` callback. Every DOM edit is reversible
// (teardown restores the original text nodes) and every failure path
// degrades to "draw nothing" — this must never break the host page.

import { Utils } from '../shared/utils.js';
import { Storage } from '../shared/storage.js';
import {
    buildTextIndex, resolve, locate, ACCEPT_CONFIDENCE
} from '../shared/anchor-resolve.js';

export const URL_POLL_MS = 1000;
export const OBSERVER_DEBOUNCE_MS = 2000;
export const OBSERVER_GIVE_UP_MS = 30000;
export const MAX_READD = 3;
export const LOOKUP_RETRY_MS = 1000;
const SITE_OFF_KEY = 'overlay_site_off';
const CONTEXT_CHARS = 32;
const MAX_QUOTE = 2000;
const STYLE_ID = 'xr-ov-style';
const KINDS = new Set(['claim', 'extraction', 'finding', 'note']);
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);

const CSS = `
.xr-ov-mark{background:rgba(255,213,0,.32);border-radius:2px;color:inherit}
.xr-ov-claim,.xr-ov-extraction{background:rgba(255,213,0,.32)}
.xr-ov-finding{background:rgba(255,120,80,.28)}
.xr-ov-note{background:rgba(90,170,255,.28)}
.xr-ov-pin{display:inline-block;margin:0 2px;padding:0 5px;font:600 10px/16px system-ui,sans-serif;color:#fff;background:#3b3b8f;border-radius:8px;cursor:pointer;vertical-align:super;user-select:none}
.xr-ov-chip{position:fixed;right:12px;bottom:12px;z-index:2147483000;font:12px/1.4 system-ui,sans-serif;color:#fff}
.xr-ov-chip-label{all:unset;display:block;padding:5px 10px;background:#3b3b8f;color:#fff;border-radius:12px;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.35)}
.xr-ov-menu{display:none;margin-bottom:4px;background:#fff;color:#111;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,.35);overflow:hidden}
.xr-ov-chip-open .xr-ov-menu{display:block}
.xr-ov-chip{display:flex;flex-direction:column-reverse;align-items:flex-end}
.xr-ov-menu button{all:unset;display:block;padding:6px 12px;cursor:pointer;white-space:nowrap}
.xr-ov-menu button:hover{background:#eee}
`;

// ------------------------------------------------------------------
// DOM helpers (kept to a small, stub-able surface)
// ------------------------------------------------------------------

function classesOf(el) {
    return String((el.getAttribute && el.getAttribute('class')) || el.className || '')
        .split(/\s+/).filter(Boolean);
}

function hasClass(el, name) {
    return el.nodeType === 1 && classesOf(el).includes(name);
}

/** X-Ray's own chrome: any xr-ov-* node EXCEPT marks (which wrap page text). */
function isOverlayUi(el) {
    if (!el || el.nodeType !== 1) return false;
    const cls = classesOf(el);
    return cls.some((c) => c.startsWith('xr-ov-')) && !cls.includes('xr-ov-mark');
}

function insideOverlayUi(node) {
    for (let n = node; n; n = n.parentNode) if (isOverlayUi(n)) return true;
    return false;
}

function isInside(node, ancestor) {
    for (let n = node; n; n = n.parentNode) if (n === ancestor) return true;
    return false;
}

function isHidden(el) {
    if (el.getAttribute('aria-hidden') === 'true') return true;
    if (el.getAttribute('hidden') != null) return true;
    const style = el.getAttribute('style');
    return !!style && /display\s*:\s*none|visibility\s*:\s*hidden/i.test(style);
}

function pickRoot(doc) {
    return doc.querySelector('article') || doc.querySelector('[role=main]') || doc.body;
}

/**
 * Visible text nodes under `root` in document order. Skips script / style /
 * noscript, hidden subtrees and X-Ray's own UI (the page-text <mark>
 * wrappers are NOT skipped, so re-indexing a marked page still works).
 */
export function collectSegments(root) {
    const out = [];
    const walk = (node) => {
        const kids = node.childNodes || [];
        for (let i = 0; i < kids.length; i++) {
            const k = kids[i];
            if (k.nodeType === 3) {
                if (k.data) out.push({ ref: k, text: k.data });
            } else if (k.nodeType === 1) {
                if (SKIP_TAGS.has(String(k.tagName).toUpperCase())) continue;
                if (isOverlayUi(k) || isHidden(k)) continue;
                walk(k);
            }
        }
    };
    if (root) walk(root);
    return out;
}

// ------------------------------------------------------------------
// Selection capture
// ------------------------------------------------------------------

/** First/last collected text node inside `node` (for element boundaries). */
function boundaryEntry(index, container, offset, isStart) {
    if (container.nodeType === 3) {
        return { entry: index.map.find((e) => e.ref === container), offset };
    }
    const kids = container.childNodes || [];
    if (isStart) {
        // Content from child[offset] onward; if none, the start is the next node.
        const entries = index.map.filter((e) => isInside(e.ref, container));
        const child = kids[offset];
        const pick = child ? entries.find((e) => isInside(e.ref, child)) : null;
        const entry = pick || null;
        return { entry, offset: 0 };
    }
    const entries = index.map.filter((e) => isInside(e.ref, container));
    let pick = null;
    for (let i = Math.min(offset, kids.length) - 1; i >= 0 && !pick; i--) {
        for (let j = entries.length - 1; j >= 0; j--) {
            if (isInside(entries[j].ref, kids[i])) { pick = entries[j]; break; }
        }
    }
    return { entry: pick, offset: pick ? pick.ref.data.length : 0 };
}

/** Raw offset in an index entry -> normalized char position (first >= offset). */
function normPos(entry, rawOffset) {
    const ri = entry.rawIdx;
    for (let i = 0; i < ri.length; i++) if (ri[i] >= rawOffset) return entry.start + i;
    return entry.end;
}

/**
 * Build a TextQuoteSelector (32-char prefix/suffix) from a DOM selection.
 * Returns null when there is nothing to anchor or the selection touches
 * X-Ray's own UI.
 */
export function captureSelection(selection) {
    try {
        if (!selection || !selection.rangeCount) return null;
        const range = selection.getRangeAt(0);
        if (!range || range.collapsed) return null;
        const sc = range.startContainer;
        const ec = range.endContainer;
        if (insideOverlayUi(sc) || insideOverlayUi(ec)) return null;
        if (range.commonAncestorContainer && insideOverlayUi(range.commonAncestorContainer)) return null;
        const doc = sc.ownerDocument || (typeof document !== 'undefined' ? document : null);
        if (!doc) return null;
        const index = buildTextIndex(collectSegments(pickRoot(doc)));
        const s = boundaryEntry(index, sc, range.startOffset, true);
        const e = boundaryEntry(index, ec, range.endOffset, false);
        if (!s.entry || !e.entry) return null;
        const start = normPos(s.entry, s.offset);
        let end = normPos(e.entry, e.offset);
        if (e.offset >= e.entry.ref.data.length) end = e.entry.end;
        // Trim whitespace the normalized text carries at the edges.
        let a = start;
        while (a < end && index.text[a] === ' ') a++;
        while (end > a && index.text[end - 1] === ' ') end--;
        if (end - a > MAX_QUOTE) end = a + MAX_QUOTE;
        const quote = index.text.slice(a, end);
        if (!quote) return null;
        return {
            anchor: [{
                type: 'TextQuoteSelector',
                exact: quote,
                prefix: index.text.slice(Math.max(0, a - CONTEXT_CHARS), a),
                suffix: index.text.slice(end, end + CONTEXT_CHARS)
            }],
            quote
        };
    } catch (err) {
        Utils.error('overlay: captureSelection failed', err);
        return null;
    }
}

// ------------------------------------------------------------------
// Lifecycle
// ------------------------------------------------------------------

function hostOf(url) {
    try { return new URL(url).hostname.toLowerCase(); } catch (_) { return ''; }
}

function rectOf(el) {
    try {
        const r = el.getBoundingClientRect();
        return { top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    } catch (_) {
        return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
    }
}

export function startOverlay(env = {}) {
    const win = env.window || (typeof window !== 'undefined' ? window : null);
    const doc = env.document || (win && win.document);
    const chromeApi = env.chrome || (typeof chrome !== 'undefined' ? chrome : null);
    const onOpen = typeof env.onOpen === 'function' ? env.onOpen : () => {};
    const getVideoSeconds = typeof env.getVideoSeconds === 'function' ? env.getVideoSeconds : () => null;
    if (!win || !doc || !chromeApi || !chromeApi.runtime) return { teardown() {} };

    let dead = false;
    let gen = 0;               // invalidates in-flight lookups
    let items = [];            // cached LookupItems for the current URL
    const noHash = (u) => String(u).split('#')[0];
    let currentUrl = win.location.href;
    // Split bookkeeping so teardown can put page-owned text nodes back
    // exactly (no normalize(): it would merge/delete page text nodes).
    let splitLog = new Map();  // original node -> {data, tails:[{node, s}]}
    const origOf = new Map();  // tail node -> original node
    let marks = [];            // mark elements we created
    let pins = [];
    let chip = null;
    let styleEl = null;
    let observer = null;
    let observerTimer = null;
    let giveUpTimer = null;
    let urlTimer = null;
    let reAdds = 0;
    let unresolved = 0;
    let unresolvedIds = [];    // ids the list card marks "not located"
    let busy = false;          // true while WE mutate the DOM

    // -- hand-off to the card UI ----------------------------------
    // An isolated-world callback, NOT a DOM event: page scripts can both
    // listen to and forge DOM events.
    function fireOpen(detail) {
        try { onOpen(detail); } catch (err) { Utils.error('overlay: onOpen failed', err); }
    }

    // -- marker removal -------------------------------------------
    function removeMarkers() {
        try {
            const parents = new Set();
            for (const m of marks) {
                const p = m.parentNode;
                if (!p) continue;
                while (m.firstChild) p.insertBefore(m.firstChild, m);
                p.removeChild(m);
                parents.add(p);
            }
            for (const pin of pins) if (pin.parentNode) { parents.add(pin.parentNode); pin.parentNode.removeChild(pin); }
            for (const [orig, rec] of splitLog) {
                rec.tails.sort((a, b) => a.s - b.s);
                for (const t of rec.tails) {
                    if (!t.node.parentNode) continue;
                    orig.data += t.node.data;
                    t.node.parentNode.removeChild(t.node);
                }
            }
        } catch (err) { Utils.error('overlay: removeMarkers failed', err); }
        marks = [];
        pins = [];
        splitLog = new Map();
        origOf.clear();
    }

    /** Run our own DOM edits without the observer treating them as page changes. */
    function guarded(fn) {
        busy = true;
        try { fn(); } finally {
            busy = false;
            if (observer) { try { observer.takeRecords(); } catch (_) { /* ignore */ } }
        }
    }

    function removeChip() {
        if (chip && chip.parentNode) chip.parentNode.removeChild(chip);
        chip = null;
    }

    function ensureStyle() {
        if (styleEl && styleEl.parentNode) return;
        styleEl = doc.createElement('style');
        styleEl.id = STYLE_ID;
        styleEl.textContent = CSS;
        (doc.head || doc.documentElement).appendChild(styleEl);
    }

    // -- placement --------------------------------------------------
    /** Wrap original-coordinate [s,e) of one text node, splitting as needed. */
    function splitAt(node, off, s) {
        const orig = origOf.get(node) || node;
        if (!splitLog.has(orig)) splitLog.set(orig, { tails: [] });
        const tail = node.splitText(off);
        origOf.set(tail, orig);
        splitLog.get(orig).tails.push({ node: tail, s });
        return tail;
    }

    function wrapPiece(frags, s, e, makeMark) {
        const made = [];
        for (const f of frags.slice()) {
            if (f.e <= s || f.s >= e) continue;
            const ss = Math.max(s, f.s);
            const ee = Math.min(e, f.e);
            if (ee <= ss) continue;
            let node = f.node;
            const at = frags.indexOf(f);
            const repl = [];
            if (ss > f.s) {
                const tail = splitAt(node, ss - f.s, ss);
                repl.push({ node, s: f.s, e: ss });
                node = tail;
            }
            let rest = null;
            if (ee < f.e) rest = splitAt(node, ee - ss, ee);
            const mid = { node, s: ss, e: ee };
            repl.push(mid);
            if (rest) repl.push({ node: rest, s: ee, e: f.e });
            frags.splice(at, 1, ...repl);
            const mark = makeMark();
            node.parentNode.insertBefore(mark, node);
            mark.appendChild(node);
            made.push({ mark, frag: mid });
        }
        return made;
    }

    function place() {
        removeMarkers();
        const segs = collectSegments(pickRoot(doc));
        const index = buildTextIndex(segs);
        const fragsByRef = new Map();
        const fragsOf = (ref) => {
            if (!fragsByRef.has(ref)) fragsByRef.set(ref, [{ node: ref, s: 0, e: ref.data.length }]);
            return fragsByRef.get(ref);
        };
        // Resolve EVERYTHING against the pristine index first: wrapping
        // splits text nodes and would invalidate later offsets.
        const planned = [];
        unresolved = 0;
        unresolvedIds = [];
        for (const it of items) {
            let loc = null;
            if (!index.oversize) {
                try {
                    const r = resolve(index, it);
                    if (r.range && r.confidence >= ACCEPT_CONFIDENCE) loc = locate(index, r.range.start, r.range.end);
                } catch (_) { loc = null; }
            }
            if (!loc) { unresolved++; unresolvedIds.push(it.id); continue; }
            planned.push({ it, loc });
        }
        const pinGroups = new Map(); // key (ref+endOffset) -> {outerMark, ids}
        for (const { it, loc } of planned) {
            const si = index.map.findIndex((e) => e.ref === loc.startRef);
            const ei = index.map.findIndex((e) => e.ref === loc.endRef);
            if (si < 0 || ei < 0 || ei < si) { unresolved++; unresolvedIds.push(it.id); continue; }
            let lastMark = null;
            const lastKey = { ref: loc.endRef, end: loc.endOffset };
            for (let i = si; i <= ei; i++) {
                const ref = index.map[i].ref;
                const from = i === si ? loc.startOffset : 0;
                const fr = fragsOf(ref);
                const to = i === ei ? loc.endOffset : fr[fr.length - 1].e;
                const made = wrapPiece(fragsOf(ref), from, to, () => {
                    const m = doc.createElement('mark');
                    m.className = 'xr-ov-mark xr-ov-' + it.kind;
                    m.setAttribute('data-xr-ov', it.id);
                    return m;
                });
                for (const x of made) {
                    marks.push(x.mark);
                    lastMark = x.mark;
                }
            }
            if (!lastMark) { unresolved++; unresolvedIds.push(it.id); continue; }
            // Pins group items that end on the same text position.
            let key = null;
            for (const [k, g] of pinGroups) {
                if (k.ref === lastKey.ref && k.end === lastKey.end) { key = k; break; }
            }
            if (key) pinGroups.get(key).ids.push(it.id);
            else pinGroups.set(lastKey, { lastMark, ids: [it.id] });
        }
        for (const g of pinGroups.values()) {
            let outer = g.lastMark;
            while (outer.parentNode && hasClass(outer.parentNode, 'xr-ov-mark')) outer = outer.parentNode;
            const pin = doc.createElement('span');
            pin.className = 'xr-ov-pin';
            pin.setAttribute('data-xr-ov-ids', g.ids.join(','));
            pin.textContent = g.ids.length > 1 ? 'X-Ray ' + g.ids.length : 'X-Ray';
            pin.addEventListener('click', (ev) => {
                try { ev.preventDefault(); ev.stopPropagation(); } catch (_) { /* synthetic */ }
                fireOpen({ itemIds: g.ids.slice(), rect: rectOf(pin), mode: 'cards' });
            });
            outer.parentNode.insertBefore(pin, outer.nextSibling);
            pins.push(pin);
        }
    }

    function buildChip() {
        removeChip();
        if (!items.length) return;
        const text = 'X-Ray: ' + items.length + ' notes' + (unresolved ? ' · ' + unresolved + ' not located' : '');
        chip = doc.createElement('div');
        chip.className = 'xr-ov-chip';
        const label = doc.createElement('button');
        label.className = 'xr-ov-chip-label';
        label.textContent = text;
        const menu = doc.createElement('div');
        menu.className = 'xr-ov-menu';
        const showAll = doc.createElement('button');
        showAll.className = 'xr-ov-show-all';
        showAll.textContent = 'Show all';
        const hide = doc.createElement('button');
        hide.className = 'xr-ov-hide-site';
        hide.textContent = 'Hide on this site';
        menu.appendChild(showAll);
        menu.appendChild(hide);
        chip.appendChild(menu);
        chip.appendChild(label);
        label.addEventListener('click', () => {
            const open = hasClass(chip, 'xr-ov-chip-open');
            chip.className = 'xr-ov-chip' + (open ? '' : ' xr-ov-chip-open');
        });
        showAll.addEventListener('click', () => {
            chip.className = 'xr-ov-chip';
            fireOpen({
                itemIds: items.map((i) => i.id), rect: rectOf(chip), mode: 'list',
                unlocatedIds: unresolvedIds.slice()
            });
        });
        hide.addEventListener('click', async () => {
            try {
                const host = String(win.location.hostname || hostOf(win.location.href)).toLowerCase();
                const off = await Storage.get(SITE_OFF_KEY, []);
                const list = Array.isArray(off) ? off : [];
                if (host && !list.includes(host)) list.push(host);
                await Storage.set(SITE_OFF_KEY, list);
            } catch (err) { Utils.error('overlay: hide-on-site failed', err); }
            teardown();
        });
        doc.body.appendChild(chip);
    }

    // -- lookup ---------------------------------------------------
    async function lookupOnce(url) {
        try {
            const resp = await chromeApi.runtime.sendMessage({ type: 'xray:overlay:lookup', url });
            if (resp && resp.ok && Array.isArray(resp.items)) return resp.items;
        } catch (_) { /* fall through to null */ }
        return null;
    }

    async function lookup(url) {
        let got = await lookupOnce(url);
        if (got) return got;
        await new Promise((r) => setTimeout(r, LOOKUP_RETRY_MS));
        if (dead) return null;
        got = await lookupOnce(url);
        return got;
    }

    async function isSiteOff(url) {
        try {
            const off = await Storage.get(SITE_OFF_KEY, []);
            return Array.isArray(off) && off.includes(hostOf(url));
        } catch (_) { return false; }
    }

    function stopObserver() {
        if (observer) { try { observer.disconnect(); } catch (_) { /* ignore */ } observer = null; }
        if (observerTimer) { clearTimeout(observerTimer); observerTimer = null; }
        if (giveUpTimer) { clearTimeout(giveUpTimer); giveUpTimer = null; }
    }

    function startObserver() {
        stopObserver();
        const MO = win.MutationObserver || (typeof MutationObserver !== 'undefined' ? MutationObserver : null);
        if (!MO) return;
        observer = new MO(() => {
            if (dead || busy) return;
            if (observerTimer) clearTimeout(observerTimer);
            observerTimer = setTimeout(onQuiet, OBSERVER_DEBOUNCE_MS);
        });
        observer.observe(pickRoot(doc) || doc.body, { childList: true, subtree: true, characterData: true });
        giveUpTimer = setTimeout(stopObserver, OBSERVER_GIVE_UP_MS);
    }

    function marksLost() {
        return marks.some((m) => !isInside(m, doc.body));
    }

    function onQuiet() {
        observerTimer = null;
        if (dead || !items.length) return;
        // Re-add markers the page's framework wiped, or place items whose
        // text only just arrived. Capped so a hostile page can't loop us.
        if ((marksLost() || unresolved > 0) && reAdds < MAX_READD) {
            reAdds++;
            try { guarded(() => { place(); buildChip(); }); } catch (err) { Utils.error('overlay: re-add failed', err); }
        }
    }

    async function apply() {
        const myGen = ++gen;
        stopObserver();
        guarded(() => { removeMarkers(); removeChip(); });
        items = [];
        reAdds = 0;
        unresolved = 0;
        unresolvedIds = [];
        currentUrl = win.location.href;
        if (await isSiteOff(currentUrl)) return;
        const got = await lookup(currentUrl);
        if (dead || myGen !== gen || !got) return;
        items = got.filter((it) => it && KINDS.has(it.kind) && typeof it.id === 'string');
        if (!items.length) return;
        try {
            guarded(() => { ensureStyle(); place(); buildChip(); });
            startObserver();
        } catch (err) {
            Utils.error('overlay: apply failed', err);
            guarded(() => { removeMarkers(); removeChip(); });
        }
    }

    // -- note command ---------------------------------------------
    function onMessage(message) {
        if (!message || message.type !== 'xray:overlay:addNote') return undefined;
        try {
            const sel = typeof win.getSelection === 'function' ? win.getSelection() : null;
            const cap = captureSelection(sel);
            if (cap) {
                let rect = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
                try { rect = rectOf(sel.getRangeAt(0)); } catch (_) { /* default */ }
                fireOpen({ itemIds: [], rect, mode: 'new-note', draft: cap });
                return undefined;
            }
            const seconds = getVideoSeconds();
            if (typeof seconds === 'number' && isFinite(seconds)) {
                fireOpen({ itemIds: [], rect: rectOf(doc.body), mode: 'new-note', draft: { seconds } });
            }
        } catch (err) { Utils.error('overlay: addNote failed', err); }
        return undefined;
    }

    function teardown() {
        if (dead) return;
        dead = true;
        gen++;
        stopObserver();
        if (urlTimer) { clearInterval(urlTimer); urlTimer = null; }
        try { chromeApi.runtime.onMessage.removeListener(onMessage); } catch (_) { /* ignore */ }
        guarded(() => { removeMarkers(); removeChip(); });
        if (styleEl && styleEl.parentNode) styleEl.parentNode.removeChild(styleEl);
        styleEl = null;
    }

    try { chromeApi.runtime.onMessage.addListener(onMessage); } catch (_) { /* ignore */ }
    urlTimer = setInterval(() => {
        if (dead) return;
        if (noHash(win.location.href) !== noHash(currentUrl)) {
            apply().catch((err) => Utils.error('overlay: relookup failed', err));
        }
    }, URL_POLL_MS);
    apply().catch((err) => Utils.error('overlay: start failed', err));

    /** Re-look-up and redraw (after the card saved or deleted a note). */
    function refresh() {
        if (dead) return;
        apply().catch((err) => Utils.error('overlay: refresh failed', err));
    }

    return { teardown, refresh };
}
