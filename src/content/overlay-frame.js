// Inline overlay — parent side of the card iframe (content script,
// isolated world). Mounts ONE extension-origin iframe
// (src/overlay/overlay-card.html) next to the clicked pin and hands it
// the item ids to show. The content script never holds card content:
// the iframe fetches it itself from the background, which binds the
// request to this tab's URL.
//
// Handshake: the frame posts {xrOv:'ready', nonce}; we answer with
// {xrOv:'show', nonce, url, itemIds, mode, draft, unlocated}, posted
// ONLY to the frame's contentWindow with targetOrigin = the extension
// origin. Every incoming message must come from that contentWindow, on
// the extension origin, carrying this mount's nonce. The nonce lives in
// the iframe's URL hash, which the host page can read — it separates
// mounts, it does not authenticate us (see src/overlay/index.js).
//
// CSP fallback: a page whose `frame-src` blocks the extension frame
// never says `ready`. After FALLBACK_MS we remove the frame and ask the
// background to show the items in the side panel instead.

import { Utils } from '../shared/utils.js';

export const CARD_PATH = 'src/overlay/overlay-card.html';
export const FALLBACK_MS = 1500;
export const FRAME_WIDTH = 360;
export const FRAME_HEIGHT = 240;
const MARGIN = 8;
const GAP = 6;
const MIN_HEIGHT = 80;
const MAX_HEIGHT = 520;
const MAX_ITEM_IDS = 500;
const MODES = new Set(['cards', 'list', 'new-note']);

function num(v, d) {
    return typeof v === 'number' && Number.isFinite(v) ? v : d;
}

/**
 * Top-left for a card of `size` beside `rect`, inside `viewport`
 * (all in CSS px, viewport coordinates). Below the anchor when it
 * fits, else above it, else pinned to the top margin.
 */
export function positionFor(rect, size, viewport) {
    const r = rect && typeof rect === 'object' ? rect : {};
    const vw = num(viewport && viewport.width, 1024);
    const vh = num(viewport && viewport.height, 768);
    const w = num(size && size.width, FRAME_WIDTH);
    const h = num(size && size.height, FRAME_HEIGHT);
    const top = num(r.top, MARGIN);
    const bottom = num(r.bottom, top);
    const left = Math.max(MARGIN, Math.min(num(r.left, MARGIN), vw - w - MARGIN));
    let y = bottom + GAP;
    if (y + h > vh - MARGIN) {
        y = top - h - GAP;
        if (y < MARGIN) y = MARGIN;
    }
    return { left, top: y };
}

// scheme://host by hand: the WHATWG `origin` of a non-special scheme
// (chrome-extension:, moz-extension:) is "null" outside the browser.
function originOf(url) {
    try {
        const u = new URL(url);
        return u.host ? u.protocol + '//' + u.host : '';
    } catch (_) { return ''; }
}

function makeNonce(win) {
    const bytes = new Uint8Array(16);
    const c = (win && win.crypto) || (typeof crypto !== 'undefined' ? crypto : null);
    if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function idList(v) {
    return Array.isArray(v) ? v.filter((i) => typeof i === 'string').slice(0, MAX_ITEM_IDS) : [];
}

export function mountFrame(env = {}) {
    const win = env.window || (typeof window !== 'undefined' ? window : null);
    const doc = env.document || (win && win.document);
    const chromeApi = env.chrome || (typeof chrome !== 'undefined' ? chrome : null);
    const notify = typeof env.notify === 'function' ? env.notify : () => {};
    const onChanged = typeof env.onChanged === 'function' ? env.onChanged : () => {};
    if (!win || !doc || !chromeApi || !chromeApi.runtime) return { open() {}, close() {} };

    let frame = null;
    let nonce = null;
    let pending = null;      // the show payload awaiting `ready`
    let timer = null;
    let height = FRAME_HEIGHT;
    let anchorRect = null;

    // The origin of the URL we set as src. Together with the SOURCE
    // check (our own iframe's contentWindow) it binds the channel.
    function cardOrigin() {
        try { return originOf(chromeApi.runtime.getURL(CARD_PATH)); } catch (_) { return ''; }
    }

    function place() {
        if (!frame) return;
        const vp = { width: num(win.innerWidth, 1024), height: num(win.innerHeight, 768) };
        const h = Math.max(MIN_HEIGHT, Math.min(height, MAX_HEIGHT, vp.height - 2 * MARGIN));
        const pos = positionFor(anchorRect, { width: FRAME_WIDTH, height: h }, vp);
        const s = frame.style;
        s.left = pos.left + 'px';
        s.top = pos.top + 'px';
        s.width = FRAME_WIDTH + 'px';
        s.height = h + 'px';
    }

    function close() {
        if (timer) { clearTimeout(timer); timer = null; }
        try { win.removeEventListener('message', onMessage); } catch (_) { /* ignore */ }
        try { doc.removeEventListener('mousedown', onOutside, true); } catch (_) { /* ignore */ }
        try { doc.removeEventListener('keydown', onKey, true); } catch (_) { /* ignore */ }
        if (frame && frame.parentNode) {
            try { frame.parentNode.removeChild(frame); } catch (_) { /* page moved it */ }
        }
        frame = null;
        nonce = null;
        pending = null;
    }

    function onOutside(ev) {
        // Clicks inside the iframe never reach the page document.
        if (frame && ev && ev.target !== frame) close();
    }

    function onKey(ev) {
        if (ev && ev.key === 'Escape') close();
    }

    function onMessage(ev) {
        if (!frame || !ev || ev.source !== frame.contentWindow) return;
        const origin = cardOrigin();
        if (!origin || ev.origin !== origin) return;
        const data = ev.data;
        if (!data || typeof data !== 'object' || data.nonce !== nonce) return;
        switch (data.xrOv) {
            case 'ready':
                if (!pending) return;           // once per mount
                if (timer) { clearTimeout(timer); timer = null; }
                try { frame.contentWindow.postMessage(pending, ev.origin); } catch (err) {
                    Utils.error('overlay: card handshake failed', err);
                }
                pending = null;
                break;
            case 'size':
                if (typeof data.height === 'number' && Number.isFinite(data.height)) {
                    height = data.height;
                    place();
                }
                break;
            case 'close':
                close();
                break;
            case 'changed':
                try { onChanged(); } catch (err) { Utils.error('overlay: refresh failed', err); }
                break;
            default:
                break;
        }
    }

    async function fallback(itemIds, mode) {
        close();
        if (mode === 'new-note') {
            // The side panel is read-only: pointing it at an empty item
            // list would only clobber a useful focus. Say so instead.
            notify('X-Ray cannot open its note editor on this page: the page blocks the X-Ray card.');
            return;
        }
        let resp = null;
        try {
            resp = await chromeApi.runtime.sendMessage({
                type: 'xray:overlay:openInSidePanel', url: win.location.href, itemIds
            });
        } catch (_) { resp = null; }
        if (!resp || !resp.ok || !resp.opened) {
            notify('X-Ray could not show its card on this page. Open the X-Ray side panel to see it.');
        }
    }

    function open(detail) {
        close();
        const d = detail && typeof detail === 'object' ? detail : {};
        const mode = MODES.has(d.mode) ? d.mode : 'cards';
        const itemIds = idList(d.itemIds);
        anchorRect = d.rect || null;
        height = FRAME_HEIGHT;
        nonce = makeNonce(win);
        pending = {
            xrOv: 'show', nonce, url: win.location.href, itemIds, mode,
            draft: mode === 'new-note' && d.draft && typeof d.draft === 'object' ? d.draft : null,
            unlocated: idList(d.unlocatedIds)
        };
        try {
            frame = doc.createElement('iframe');
            frame.className = 'xr-ov-frame';
            frame.setAttribute('title', 'X-Ray notes');
            frame.setAttribute('aria-label', 'X-Ray notes');
            const s = frame.style;
            s.position = 'fixed';
            s.zIndex = '2147483001';
            s.border = '0';
            s.borderRadius = '8px';
            s.boxShadow = '0 4px 16px rgba(0,0,0,.35)';
            s.background = 'transparent';
            s.colorScheme = 'normal';
            place();
            win.addEventListener('message', onMessage);
            frame.src = chromeApi.runtime.getURL(CARD_PATH) + '#' + nonce;
            // Outside <body>: the marker MutationObserver watches the article
            // root / body, and the frame is not page content.
            (doc.documentElement || doc.body).appendChild(frame);
            doc.addEventListener('mousedown', onOutside, true);
            doc.addEventListener('keydown', onKey, true);
        } catch (err) {
            Utils.error('overlay: frame mount failed', err);
            close();
            return;
        }
        timer = setTimeout(() => {
            timer = null;
            if (pending) fallback(itemIds, mode);
        }, FALLBACK_MS);
    }

    return { open, close };
}
