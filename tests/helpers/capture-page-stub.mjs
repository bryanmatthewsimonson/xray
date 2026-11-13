// A LIVE page and its CLONE, hand-built, for driving the real
// ContentExtractor.extractArticle in node (there is no jsdom; CLAUDE.md
// "Commands").
//
// The page is declared ONCE as a tree (`h(...)`) and built twice:
//   - the LIVE twin is the user's tab. Every node reads normally, and
//     every write to it (a property set, a mutating method, a classList,
//     style or dataset change) is recorded in `writes`. Layout-only
//     reads (naturalWidth, offsetWidth, ...) come from `$live` and are
//     counted in `layoutReads`.
//   - the CLONE twin is what document.cloneNode(true) returns: plain
//     mutable nodes, never laid out (every layout read is 0).
// A pass left on `document` therefore writes to the live twin and shows
// up in `writes`.
//
// createElement on either document returns an element that records any
// innerHTML write in `parses`, tagged with the owning document ('live'
// or 'clone'). Its querySelectorAll('img[src]') stands in for the
// browser's parse of the one shape the noscript pass reads back, <img
// src alt>. innerHTML writes on tree nodes are recorded the same way.
//
// Selectors: a small matcher for what extractArticle and its metadata
// readers query: tag, .class, #id, [a], [a="v"], [a*="v"], :not(one
// compound), the descendant and "+" combinators, comma lists. Anything
// else THROWS, so a new query surfaces as a test failure, never as a
// silent empty match.

const MUTATORS = new Set([
    'setAttribute', 'removeAttribute', 'toggleAttribute', 'appendChild', 'removeChild',
    'replaceChild', 'insertBefore', 'replaceWith', 'replaceChildren', 'remove', 'append',
    'prepend', 'before', 'after', 'insertAdjacentHTML', 'insertAdjacentElement',
    'insertAdjacentText', 'setHTMLUnsafe', 'normalize', 'add', 'toggle', 'replace'
]);
const LAYOUT = ['naturalWidth', 'naturalHeight', 'offsetWidth', 'offsetHeight'];

/** Declare an element: h('img', { src, $key: 'hero', $live: { naturalWidth: 40 } }, ...kids). */
export function h(tag, attrs = {}, ...kids) {
    return { tag, attrs, kids };
}

// ------------------------------------------------------------ selectors
// Split at top level (outside quotes, brackets and parens): commas for
// selector lists; whitespace and "+" for compound steps ("+" kept as a token).
function splitTop(sel, isSep, keep = () => false) {
    const out = [];
    let depth = 0, quote = '', cur = '';
    const flush = () => { if (cur.trim()) out.push(cur.trim()); cur = ''; };
    for (const c of sel) {
        if (quote) { if (c === quote) quote = ''; cur += c; continue; }
        if (c === '"' || c === "'") { quote = c; cur += c; continue; }
        if (c === '[' || c === '(') depth++;
        if (c === ']' || c === ')') depth--;
        if (depth === 0 && keep(c)) { flush(); out.push(c); continue; }
        if (depth === 0 && isSep(c)) { flush(); continue; }
        cur += c;
    }
    flush();
    return out;
}

function compileCompound(src) {
    const tests = [];
    let rest = src;
    const m0 = /^([a-zA-Z][\w-]*|\*)/.exec(rest);
    if (m0) {
        const tag = m0[1].toUpperCase();
        if (tag !== '*') tests.push((n) => n.tagName === tag);
        rest = rest.slice(m0[0].length);
    }
    while (rest) {
        let m;
        if ((m = /^\.([\w-]+)/.exec(rest))) {
            const cls = m[1];
            tests.push((n) => (n.getAttribute('class') || '').split(/\s+/).includes(cls));
        } else if ((m = /^#([\w-]+)/.exec(rest))) {
            const id = m[1];
            tests.push((n) => n.getAttribute('id') === id);
        } else if ((m = /^\[([\w-]+)\]/.exec(rest))) {
            const a = m[1];
            tests.push((n) => n.getAttribute(a) !== null);
        } else if ((m = /^\[([\w-]+)(\*?=)"([^"]*)"\]/.exec(rest))) {
            const [, a, op, v] = m;
            tests.push(op === '='
                ? (n) => n.getAttribute(a) === v
                : (n) => (n.getAttribute(a) || '').includes(v));
        } else if ((m = /^:not\(([^()]+)\)/.exec(rest))) {
            const inner = compileCompound(m[1].trim());
            tests.push((n) => !inner(n));
        } else {
            throw new Error(`capture-page-stub: unsupported selector syntax "${rest}" in "${src}"`);
        }
        rest = rest.slice(m[0].length);
    }
    return (n) => n.nodeType === 1 && tests.every((t) => t(n));
}

function compileSelector(sel) {
    return splitTop(sel, (c) => c === ',').map((alt) => {
        const tokens = splitTop(alt, (c) => /\s/.test(c), (c) => c === '+' || c === '>' || c === '~');
        const steps = [];
        for (let i = 0; i < tokens.length; i++) {
            if (tokens[i] === '+') continue;
            if (/[>~]/.test(tokens[i])) throw new Error(`capture-page-stub: unsupported combinator in "${sel}"`);
            steps.push({ test: compileCompound(tokens[i]), adjacent: tokens[i - 1] === '+' });
        }
        return steps;
    });
}

function prevElement(n) {
    const sibs = n.parentNode ? n.parentNode.childNodes : [];
    const i = sibs.indexOf(n);
    for (let j = i - 1; j >= 0; j--) if (sibs[j].nodeType === 1) return sibs[j];
    return null;
}

function matchesSteps(n, steps, i = steps.length - 1) {
    if (!steps[i].test(n)) return false;
    if (i === 0) return true;
    if (steps[i].adjacent) {
        const prev = prevElement(n);
        return !!prev && matchesSteps(prev, steps, i - 1);
    }
    for (let a = n.parentNode; a && a.nodeType === 1; a = a.parentNode) {
        if (matchesSteps(a, steps, i - 1)) return true;
    }
    return false;
}

function descendants(roots, out = []) {
    for (const r of roots) {
        if (r.nodeType !== 1) continue;
        out.push(r);
        descendants(r.childNodes, out);
    }
    return out;
}

function queryAll(roots, sel) {
    const alts = compileSelector(sel);
    return descendants(roots).filter((n) => alts.some((steps) => matchesSteps(n, steps)));
}

// ---------------------------------------------------------------- nodes
// node as callers see it (the Proxy on the live side) → its raw target
const targets = new WeakMap();

function recorder(name, target, writes) {
    return new Proxy(target, {
        get(t, k) {
            if (typeof k === 'string' && MUTATORS.has(k)) return () => { writes.push(`${name}.${k}()`); };
            return t[k];
        },
        set(_t, k) { writes.push(`${name}.${String(k)} =`); return true; },
        defineProperty(_t, k) { writes.push(`${name}.${String(k)} (define)`); return true; },
        deleteProperty(_t, k) { writes.push(`delete ${name}.${String(k)}`); return true; }
    });
}

function textNode(value) {
    const t = { nodeType: 3, nodeName: '#text', nodeValue: String(value), parentNode: null };
    Object.defineProperty(t, 'textContent', { get: () => t.nodeValue });
    return t;
}

function link(parent, child) {
    parent.childNodes.push(child);
    (targets.get(child) || child).parentNode = parent.self;
}

const camelToData = (k) => 'data-' + k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());

/**
 * One element; `ctx` = { side, writes, layoutReads, parses }. Returns its
 * raw target. A page node on the live side is a recorder; an element
 * the live document CREATES is detached (writing to it is not a tab
 * change), so it stays plain and only its parses are logged.
 */
function makeElement(tag, attrs, ctx, { detached = false } = {}) {
    const TAG = String(tag).toUpperCase();
    const t = {
        nodeType: 1, nodeName: TAG, tagName: TAG, owner: ctx.side,
        attrs: {}, childNodes: [], parentNode: null, style: {}, replaced: [],
        getAttribute: (a) => (a in t.attrs ? t.attrs[a] : null),
        hasAttribute: (a) => a in t.attrs,
        setAttribute: (a, v) => { t.attrs[a] = String(v); },
        appendChild: (c) => { link(t, c); return c; },
        replaceChild: (nw, old) => {
            t.replaced.push({ nw, old });
            const i = t.childNodes.indexOf(old);
            if (i >= 0) {
                t.childNodes[i] = nw;
                (targets.get(old) || old).parentNode = null;
                (targets.get(nw) || nw).parentNode = t.self;
            }
            return old;
        },
        querySelectorAll: (sel) => queryAll(t.childNodes, sel),
        querySelector: (sel) => queryAll(t.childNodes, sel)[0] || null,
        insertAdjacentHTML: (_pos, html) => { ctx.parses.push({ owner: ctx.side, tag: TAG, html: String(html), node: t }); }
    };
    for (const [k, v] of Object.entries(attrs)) {
        if (!k.startsWith('$')) t.attrs[k] = String(v);
    }
    const classes = () => (t.attrs.class || '').split(/\s+/).filter(Boolean);
    t.classList = {
        add: (c) => { if (!classes().includes(c)) t.attrs.class = [...classes(), c].join(' '); },
        remove: (c) => { t.attrs.class = classes().filter((x) => x !== c).join(' '); },
        contains: (c) => classes().includes(c)
    };
    t.dataset = new Proxy({}, {
        get: (_o, k) => (typeof k === 'string' ? (t.attrs[camelToData(k)] ?? undefined) : undefined),
        set: (_o, k, v) => { t.attrs[camelToData(String(k))] = String(v); return true; }
    });
    for (const a of ['src', 'srcset', 'alt', 'href', 'cite']) {
        Object.defineProperty(t, a, {
            get: () => t.attrs[a] ?? '', set: (v) => { t.attrs[a] = String(v); }, enumerable: true
        });
    }
    Object.defineProperty(t, 'className', {
        get: () => t.attrs.class ?? '', set: (v) => { t.attrs.class = String(v); }, enumerable: true
    });
    Object.defineProperty(t, 'parentElement', {
        get: () => (t.parentNode && t.parentNode.nodeType === 1 ? t.parentNode : null)
    });
    Object.defineProperty(t, 'textContent', {
        get: () => t.childNodes.map((c) => c.textContent).join(''),
        set: (v) => { t.childNodes = []; link(t, textNode(v)); }
    });
    const lastParse = () => ctx.parses.filter((x) => x.node === t).pop();
    for (const k of ['innerHTML', 'outerHTML']) {
        Object.defineProperty(t, k, {
            get: () => (lastParse() || { html: '' }).html,
            set: (v) => { ctx.parses.push({ owner: ctx.side, tag: TAG, html: String(v), node: t }); }
        });
    }
    for (const k of LAYOUT) {
        const value = (ctx.side === 'live' && attrs.$live && attrs.$live[k]) || 0;
        Object.defineProperty(t, k, {
            get: () => { if (ctx.side === 'live') ctx.layoutReads.push(`${attrs.$key || TAG}.${k}`); return value; }
        });
    }
    if (ctx.side === 'live' && !detached) {
        const name = attrs.$key || TAG.toLowerCase();
        t.classList = recorder(`${name}.classList`, t.classList, ctx.writes);
        t.style = recorder(`${name}.style`, t.style, ctx.writes);
        t.dataset = recorder(`${name}.dataset`, t.dataset, ctx.writes);
        t.self = recorder(name, t, ctx.writes);
    } else {
        t.self = t;
    }
    targets.set(t.self, t);
    return t;
}

function build(spec, ctx, keyed) {
    if (typeof spec === 'string') return textNode(spec);
    const t = makeElement(spec.tag, spec.attrs, ctx);
    if (spec.attrs.$key) keyed[spec.attrs.$key] = t.self;
    for (const kid of spec.kids) link(t, build(kid, ctx, keyed));
    return t.self;
}

// Created elements (createElement, either document) stand in for the
// browser's parse of the one shape the noscript pass reads back out:
// <img src alt>.
function createdElement(tag, ctx) {
    const t = makeElement(tag, {}, ctx, { detached: true });
    const query = t.querySelectorAll;
    t.querySelectorAll = (sel) => {
        if (sel !== 'img[src]') return query(sel);
        return [...t.innerHTML.matchAll(/<img\b[^>]*>/gi)].map((m) => {
            const attr = (a) => (new RegExp(`\\s${a}="([^"]*)"`, 'i').exec(m[0]) || [])[1] || '';
            return { src: attr('src'), alt: attr('alt') };
        });
    };
    return t.self;
}

function makeDoc(specs, ctx, keyed) {
    const roots = specs.map((s) => build(s, ctx, keyed));
    const doc = {
        created: [],
        querySelectorAll: (sel) => queryAll(roots, sel),
        querySelector: (sel) => queryAll(roots, sel)[0] || null,
        createElement: (tag) => { doc.created.push(String(tag).toLowerCase()); return createdElement(tag, ctx); },
        createTextNode: (v) => textNode(v)
    };
    return doc;
}

/**
 * Build the pair. Returns { live, clone, liveDoc, live$, clone$, writes,
 * layoutReads, parses, errors } — live$/clone$ map each `$key` to its
 * node, liveDoc is the live document's raw target (liveDoc.created lists
 * the tags the LIVE document created), errors collects what the
 * extractor passed to console.error.
 * The live document is a recorder too (a write to it is a tab change),
 * carries a documentElement (lang), and its cloneNode() returns the
 * clone. The clone has no documentElement, so the REAL Readability
 * refuses it (the catch → extractSimple path).
 */
export function mirrorPage(specs, { lang = 'en' } = {}) {
    const writes = [], layoutReads = [], parses = [];
    const live$ = {}, clone$ = {};
    const cloneDoc = makeDoc(specs, { side: 'clone', writes, layoutReads, parses }, clone$);
    const liveTarget = makeDoc(specs, { side: 'live', writes, layoutReads, parses }, live$);
    liveTarget.cloneCalls = 0;
    liveTarget.cloneNode = () => { liveTarget.cloneCalls++; return cloneDoc; };
    liveTarget.documentElement = recorder('html', { lang }, writes);
    liveTarget.title = 'Story';
    const live = recorder('document', liveTarget, writes);
    return { live, clone: cloneDoc, liveDoc: liveTarget, live$, clone$, writes, layoutReads, parses, errors: [] };
}

/**
 * Run extractArticle against the pair with `window` pointing at `url`.
 * `parse` (optional) replaces ContentExtractor._parseArticle for the run;
 * extractSimple is replaced by a sentinel so the catch path is visible.
 * console.log is silenced; console.error lands in page.errors (the catch
 * path logs the error it swallowed there). Both are restored.
 */
export function runCapture(ContentExtractor, page, { url = 'https://news.example/story', parse } = {}) {
    const saved = {
        document: globalThis.document, window: globalThis.window,
        parse: ContentExtractor._parseArticle, simple: ContentExtractor.extractSimple,
        log: console.log, error: console.error
    };
    const u = new URL(url);
    globalThis.document = page.live;
    globalThis.window = { location: { href: u.href, protocol: u.protocol, hostname: u.hostname } };
    if (parse) ContentExtractor._parseArticle = parse;
    ContentExtractor.extractSimple = () => 'fell-back';
    console.log = () => {};
    console.error = (...args) => { page.errors.push(args); };
    try {
        return ContentExtractor.extractArticle();
    } finally {
        globalThis.document = saved.document;
        globalThis.window = saved.window;
        ContentExtractor._parseArticle = saved.parse;
        ContentExtractor.extractSimple = saved.simple;
        console.log = saved.log;
        console.error = saved.error;
    }
}
