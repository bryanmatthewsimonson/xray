// A minimal extension-page harness for driving REAL page code in node:
// a DOM stub (enough for portal/dom.js `el` and the review renderers the
// LLM-job consumers paint through) and a `chrome` stub whose
// runtime.sendMessage speaks the xray:llm:job:* protocol over the REAL
// runner (tests/helpers/llm-job-stub.mjs) — so a consumer test observes
// the whole seam: block → chrome.runtime → runner → pass → back →
// render/persist → ack, not a helper beside it.
//
// Deliberately small. Nodes carry plain properties (className,
// textContent, disabled, hidden, value…) plus the handful of methods the
// consumers call; `isConnected` walks parents to the stub's body, so a
// block the "case view" dropped reads as detached exactly as it would in
// a browser, and `closest('[hidden]')` finds a hidden ancestor, so a view
// the portal merely HID (the library showing) reads as connected but not
// shown. Mirrors the one-off stubs in known-unknowns-block.test.mjs and
// portal-case-people.test.mjs.

import { createJobStub } from './llm-job-stub.mjs';

/** Install `document` + `Option` globals; returns the body to mount under. */
export function installDomStub() {
    let body = null;
    const doc = {};
    const mk = (tag) => {
        const listeners = {};
        const node = {
            tagName: String(tag).toUpperCase(),
            className: '', textContent: '', title: '', type: '', value: '', placeholder: '',
            href: '', target: '', rel: '',
            disabled: false, hidden: false, open: false, checked: false,
            children: [], parentElement: null, dataset: {}, style: {},
            ownerDocument: doc,
            get isConnected() {
                let n = node;
                while (n.parentElement) n = n.parentElement;
                return n === body;
            },
            get childElementCount() { return node.children.length; },
            get firstChild() { return node.children[0] || null; },
            appendChild(c) {
                if (c.parentElement) c.parentElement.removeChild(c);
                c.parentElement = node;
                node.children.push(c);
                return c;
            },
            append(...cs) { for (const c of cs) node.appendChild(c); },
            removeChild(c) {
                node.children = node.children.filter((x) => x !== c);
                c.parentElement = null;
                return c;
            },
            remove() { if (node.parentElement) node.parentElement.removeChild(node); },
            replaceChildren(...cs) {
                for (const c of [...node.children]) node.removeChild(c);
                for (const c of cs) node.appendChild(c);
            },
            setAttribute(k, v) { node[k] = String(v); },
            getAttribute(k) { return k in node ? node[k] : null; },
            /** Only `[hidden]` — the one ancestor query the consumers make. */
            closest(sel) {
                if (sel !== '[hidden]') throw new Error(`page-stub closest() supports only [hidden], not ${sel}`);
                for (let n = node; n; n = n.parentElement) if (n.hidden) return n;
                return null;
            },
            addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
            /** Test seam: run every `type` listener and await them all. */
            dispatch(type) {
                return Promise.all((listeners[type] || []).map((fn) =>
                    fn({ type, target: node, preventDefault() {}, stopPropagation() {} })));
            }
        };
        return node;
    };
    doc.createElement = mk;
    doc.createElementNS = (_ns, tag) => mk(tag);
    body = mk('body');
    doc.body = body;
    globalThis.document = doc;
    globalThis.Option = function Option(text, value) {
        const o = mk('option');
        o.textContent = String(text);
        o.value = String(value);
        return o;
    };
    return { document: doc, body };
}

/** Depth-first walk. */
export function walkNodes(node, out = []) {
    out.push(node);
    for (const c of node.children || []) walkNodes(c, out);
    return out;
}

/** Every text a node tree shows, flattened. */
export function textOf(node) {
    return walkNodes(node).map((n) => n.textContent || '').join(' ');
}

/** The first node whose own textContent equals `text` (e.g. a button label). */
export function byText(root, text) {
    return walkNodes(root).find((n) => n.textContent === text) || null;
}

/**
 * Install ONE `chrome` stub per test file (modules may capture it at
 * import): storage.local over an in-memory object (callback AND promise
 * style), and runtime.sendMessage routing
 *   - the gating snapshots (xray:llm:config / xray:llm:corpus-config) to
 *     `harness.config`, and
 *   - xray:llm:job:* to the REAL runner the last `startWorker()` built.
 * `startWorker(passes)` builds a fresh runner — an empty registry, as a
 * restarted worker has — over the SAME job store unless given another,
 * so a test can stage "the worker died and came back".
 * `dropNext(type, n)` makes the next n messages of `type` fail the way a
 * torn-down worker does: the callback fires with NO response while
 * chrome.runtime.lastError is set.
 *
 * @param {object} [opts]
 * @param {object} [opts.config]   the gating snapshot
 * @param {object} [opts.runner]   extra createLlmJobRunner options
 */
export function installChromeStub({ config = { ok: true, enabled: true, hasKey: true, model: 'claude-test' }, runner } = {}) {
    const store = {};
    const snapshot = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
    const local = {
        store,
        get(keys, cb) {
            const list = keys === null || keys === undefined ? Object.keys(store)
                : (Array.isArray(keys) ? keys : (typeof keys === 'string' ? [keys] : Object.keys(keys)));
            const out = {};
            for (const k of list) if (k in store) out[k] = snapshot(store[k]);
            if (cb) cb(out);
            return Promise.resolve(out);
        },
        set(obj, cb) {
            for (const [k, v] of Object.entries(obj)) store[k] = snapshot(v);
            if (cb) cb();
            return Promise.resolve();
        },
        remove(keys, cb) {
            for (const k of (Array.isArray(keys) ? keys : [keys])) delete store[k];
            if (cb) cb();
            return Promise.resolve();
        }
    };
    const drops = {};
    const sent = [];
    const harness = {
        config, sent, store,
        jobs: null, jobArea: undefined,
        startWorker(passes, { area = harness.jobArea } = {}) {
            harness.jobs = createJobStub({ passes, ...(area ? { area } : {}), ...(runner ? { runner } : {}) });
            harness.jobArea = harness.jobs.area;
            return harness.jobs;
        },
        dropNext(type, n = 1) { drops[type] = (drops[type] || 0) + n; },
        /** Job-layer messages sent so far, by op (start/status/find/ack). */
        jobOps(op) { return sent.filter((m) => m && m.type === `xray:llm:job:${op}`); },
        /** Forget sent messages and drops (a fresh test, same stub). */
        reset() { sent.length = 0; for (const k of Object.keys(drops)) delete drops[k]; }
    };
    const chromeStub = {
        storage: { local, session: local, onChanged: { addListener() {}, removeListener() {} } },
        runtime: {
            lastError: undefined,
            sendMessage(msg, cb) {
                sent.push(msg);
                const type = msg && msg.type;
                if (drops[type] > 0) {
                    drops[type] -= 1;
                    setTimeout(() => {
                        chromeStub.runtime.lastError = { message: 'The message port closed before a response was received.' };
                        try { if (cb) cb(undefined); } finally { chromeStub.runtime.lastError = undefined; }
                    }, 0);
                    return;
                }
                let answer;
                if (type === 'xray:llm:config' || type === 'xray:llm:corpus-config') answer = Promise.resolve(harness.config);
                else if (harness.jobs) answer = harness.jobs.sendMessage(msg);
                else answer = Promise.resolve({ ok: false, error: `no worker started for ${type}` });
                answer.then((resp) => { if (cb) cb(resp); });
                return undefined;
            },
            getURL: (p) => `chrome-extension://stub/${p}`
        }
    };
    harness.chrome = chromeStub;
    globalThis.chrome = chromeStub;
    return harness;
}

/** Poll until `pred()` is truthy (the blocks settle through async IIFEs). */
export async function until(pred, { tries = 400, ms = 5 } = {}) {
    for (let i = 0; i < tries; i++) {
        if (await pred()) return true;
        await new Promise((r) => setTimeout(r, ms));
    }
    return false;
}
