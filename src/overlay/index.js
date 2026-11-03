// Inline overlay — the card iframe's script (overlay-card.html →
// dist/overlay.bundle.js). Runs on the EXTENSION origin inside a frame
// the content script mounts on a third-party page. It is the only
// surface that renders note text, claim text and verdicts.
//
// THREAT MODEL. overlay-card.html is a web-accessible resource, so ANY
// page (or a third-party iframe) can embed it and post it messages —
// including the very page our content script mounted it on: page
// scripts share `window.parent` with our content script and can read
// the frame's src. So:
//
//   * The nonce in our URL hash (checked on every `show`) only filters
//     stray / crossed messages between mounts. It is NOT a secret: an
//     embedder that frames the card itself picks the nonce, and the
//     host page can read ours from the DOM. Do not over-trust it.
//   * The real protection is (1) the background answers
//     `xray:overlay:card` / `note:*` only for this frame bound to its
//     TAB's URL (background/overlay.js `senderAllowed`), so a hostile
//     embedder can only ever make us show its own page's items, inside
//     a cross-origin frame it cannot read; and (2) nothing is ever
//     saved or deleted because of a message — saving and deleting need
//     a trusted user click inside this frame (delete: two clicks).
//   * We render only items the background returned (and only ids we
//     asked for). Parent-supplied `draft` fields are prefill only:
//     type- and length-checked here, rendered escaped, and the
//     background's note:save validation is the gate.

import { renderCards, renderList, renderEditor } from './render.js';

export { renderCards, renderList, renderEditor } from './render.js';

export const NONCE_RE = /^[A-Za-z0-9_-]{16,64}$/;
const MODES = new Set(['cards', 'list', 'new-note']);
const MAX_ITEM_IDS = 500;
const MAX_ID_CHARS = 256;
const MAX_URL = 4096;
const MAX_QUOTE = 2000;
const MAX_SELECTORS = 8;
const MAX_SELECTOR_FIELD = 4096;
const NOTE_ID_RE = /^pn_[0-9a-f]{16}$/;
const KINDS = new Set(['claim', 'finding', 'extraction', 'note']);

function isIdList(v) {
    return Array.isArray(v) && v.length <= MAX_ITEM_IDS
        && v.every((i) => typeof i === 'string' && i.length > 0 && i.length <= MAX_ID_CHARS);
}

function sanitizeSelector(sel) {
    if (!sel || typeof sel !== 'object' || Array.isArray(sel)) return null;
    const out = {};
    for (const k of ['type', 'exact', 'prefix', 'suffix']) {
        if (typeof sel[k] === 'string' && sel[k].length <= MAX_SELECTOR_FIELD) out[k] = sel[k];
    }
    for (const k of ['start', 'end']) {
        if (typeof sel[k] === 'number' && Number.isFinite(sel[k])) out[k] = sel[k];
    }
    return Object.keys(out).length ? out : null;
}

/**
 * Parent-supplied draft → prefill. Only `quote`, `anchor` and `seconds`
 * survive, each type- and length-checked; anything else (a `text`, an
 * `id`) is dropped — the user types the note, and the parent can never
 * aim an edit at an existing note.
 */
export function sanitizeDraft(draft) {
    const out = {};
    if (!draft || typeof draft !== 'object' || Array.isArray(draft)) return out;
    if (typeof draft.quote === 'string' && draft.quote.length <= MAX_QUOTE) out.quote = draft.quote;
    if (typeof draft.seconds === 'number' && Number.isFinite(draft.seconds) && draft.seconds >= 0) {
        out.seconds = draft.seconds;
    }
    if (Array.isArray(draft.anchor)) {
        const sels = draft.anchor.slice(0, MAX_SELECTORS).map(sanitizeSelector).filter(Boolean);
        if (sels.length) out.anchor = sels;
    }
    return out;
}

/** A `show` payload, validated, or null. */
function parseShow(data) {
    if (typeof data.url !== 'string' || !data.url || data.url.length > MAX_URL) return null;
    if (!isIdList(data.itemIds)) return null;
    if (!MODES.has(data.mode)) return null;
    const unlocated = isIdList(data.unlocated) ? data.unlocated : [];
    return {
        url: data.url,
        itemIds: data.itemIds.slice(),
        mode: data.mode,
        draft: data.mode === 'new-note' ? sanitizeDraft(data.draft) : null,
        unlocated: new Set(unlocated)
    };
}

export function startCard(env = {}) {
    const win = env.window || (typeof window !== 'undefined' ? window : null);
    const doc = env.document || (win && win.document);
    const chromeApi = env.chrome || (typeof chrome !== 'undefined' ? chrome : null);
    if (!win || !doc || !chromeApi || !chromeApi.runtime) return { stop() {} };

    const nonce = String((win.location && win.location.hash) || '').replace(/^#/, '');
    if (!NONCE_RE.test(nonce)) return { stop() {} };   // not mounted by us: stay inert

    const root = doc.getElementById('xr-ov-root');
    let ctx = null;            // the one accepted `show`
    let items = [];            // ONLY what the background returned for ctx
    let editing = null;        // the editor's draft
    let showRejected = false;
    let armedDelete = null;    // item id awaiting the confirming click
    let busy = false;

    const post = (msg) => {
        // '*' because the embedder's origin is unknown to us; the payloads
        // carry no content (nonce + sizes + signals only).
        try { win.parent.postMessage({ ...msg, nonce }, '*'); } catch (_) { /* detached */ }
    };

    function reportSize() {
        try {
            const h = doc.documentElement && doc.documentElement.scrollHeight;
            if (typeof h === 'number' && h > 0) post({ xrOv: 'size', height: h });
        } catch (_) { /* ignore */ }
    }

    function paint(html) {
        if (root) root.innerHTML = html;
        reportSize();
    }

    function status(text) {
        paint(`<p class="xr-ov-status">${text}</p>`);
    }

    function renderItems() {
        const opts = { showRejected };
        paint(ctx.mode === 'list' ? renderList(items, opts) : renderCards(items, opts));
    }

    function renderEditing() {
        paint(renderEditor(editing));
    }

    async function load() {
        status('Loading…');
        let resp = null;
        try {
            resp = await chromeApi.runtime.sendMessage({ type: 'xray:overlay:card', url: ctx.url, itemIds: ctx.itemIds });
        } catch (_) { resp = null; }
        if (!resp || !resp.ok || !Array.isArray(resp.items)) {
            status('Could not load X-Ray notes for this page.');
            return;
        }
        const want = new Set(ctx.itemIds);
        items = resp.items
            .filter((it) => it && typeof it === 'object' && typeof it.id === 'string'
                && want.has(it.id) && KINDS.has(it.kind))
            .map((it) => ({ ...it, unlocated: ctx.unlocated.has(it.id) }));
        renderItems();
    }

    function onShow(data) {
        if (ctx) return;                    // one show per mount
        const parsed = parseShow(data);
        if (!parsed) return;
        ctx = parsed;
        if (ctx.mode === 'new-note') {
            editing = { ...ctx.draft };
            renderEditing();
        } else {
            load();
        }
    }

    function onMessage(ev) {
        if (!ev || ev.source !== win.parent) return;
        const data = ev.data;
        if (!data || typeof data !== 'object' || data.nonce !== nonce) return;
        if (data.xrOv === 'show') onShow(data);
    }

    function noteIdOf(itemId) {
        const raw = typeof itemId === 'string' && itemId.startsWith('note:') ? itemId.slice(5) : '';
        return NOTE_ID_RE.test(raw) ? raw : null;
    }

    async function save() {
        if (busy || !ctx) return;
        const box = doc.getElementById('xr-ov-note-text');
        const text = box && typeof box.value === 'string' ? box.value : '';
        if (!text.trim()) return;
        const note = { text };
        if (editing.id) note.id = editing.id;
        if (editing.quote !== undefined) note.quote = editing.quote;
        if (editing.seconds !== undefined) note.seconds = editing.seconds;
        if (editing.anchor !== undefined) note.anchor = editing.anchor;
        busy = true;
        let resp = null;
        try {
            resp = await chromeApi.runtime.sendMessage({ type: 'xray:overlay:note:save', url: ctx.url, note });
        } catch (_) { resp = null; }
        busy = false;
        if (!resp || !resp.ok || !resp.note || typeof resp.note.id !== 'string') {
            status('Could not save the note.');
            return;
        }
        post({ xrOv: 'changed' });
        const newId = 'note:' + resp.note.id;
        if (!ctx.itemIds.includes(newId)) ctx.itemIds.push(newId);
        if (ctx.mode === 'new-note') ctx.mode = 'cards';
        editing = null;
        await load();
    }

    async function remove(itemId, btn) {
        const id = noteIdOf(itemId);
        if (!id || busy || !ctx) return;
        if (armedDelete !== itemId) {
            armedDelete = itemId;
            if (btn) btn.textContent = 'Confirm delete';
            return;
        }
        armedDelete = null;
        busy = true;
        let resp = null;
        try {
            resp = await chromeApi.runtime.sendMessage({ type: 'xray:overlay:note:delete', url: ctx.url, id });
        } catch (_) { resp = null; }
        busy = false;
        if (!resp || !resp.ok) {
            status('Could not delete the note.');
            return;
        }
        post({ xrOv: 'changed' });
        ctx.itemIds = ctx.itemIds.filter((i) => i !== itemId);
        items = items.filter((it) => it.id !== itemId);
        renderItems();
    }

    function edit(itemId) {
        const it = items.find((i) => i.id === itemId && i.kind === 'note');
        const id = noteIdOf(itemId);
        if (!it || !id) return;
        // Prefill from the BACKGROUND's record, not from the parent.
        const d = it.detail || {};
        const n = d.note && typeof d.note === 'object' ? d.note : {};
        editing = sanitizeDraft({ quote: n.quote, seconds: n.seconds, anchor: n.anchor });
        editing.id = id;
        editing.text = typeof d.text === 'string' ? d.text : '';
        renderEditing();
    }

    function onClick(ev) {
        // Only a real user click acts. A message can never save or delete.
        if (!ev || ev.isTrusted !== true) return;
        const target = ev.target && typeof ev.target.closest === 'function'
            ? ev.target.closest('[data-xr-ov-action]') : null;
        if (!target) return;
        const action = target.getAttribute('data-xr-ov-action');
        const id = target.getAttribute('data-xr-ov-id');
        if (action !== 'delete') armedDelete = null;
        switch (action) {
            case 'close': post({ xrOv: 'close' }); break;
            case 'toggle-rejected': showRejected = !showRejected; renderItems(); break;
            case 'edit': edit(id); break;
            case 'delete': return remove(id, target);
            case 'save': return save();
            case 'cancel':
                if (!ctx || ctx.mode === 'new-note') post({ xrOv: 'close' });
                else { editing = null; renderItems(); }
                break;
            default: break;
        }
        return undefined;
    }

    function onKey(ev) {
        if (ev && ev.key === 'Escape') post({ xrOv: 'close' });
    }

    function onSubmit(ev) {
        try { ev.preventDefault(); } catch (_) { /* ignore */ }
    }

    win.addEventListener('message', onMessage);
    doc.addEventListener('click', onClick);
    doc.addEventListener('keydown', onKey);
    doc.addEventListener('submit', onSubmit);
    post({ xrOv: 'ready' });

    return {
        stop() {
            try { win.removeEventListener('message', onMessage); } catch (_) { /* ignore */ }
        }
    };
}

// Boot only inside the real card page (the module is also imported by
// tests and by the side panel's renderer re-use).
if (typeof document !== 'undefined' && typeof location !== 'undefined'
    && /\/src\/overlay\/overlay-card\.html$/.test(location.pathname)) {
    startCard();
}
