// Side panel: the inline overlay's CSP fallback (flag inlineOverlay).
// When a page's CSP blocks the card iframe, the background stores
// {url, itemIds} (ids only) under this session key and opens the panel.
// The panel fetches the content through the same xray:overlay:card
// handler (it accepts this tabless page) and renders it read-only.

import { Utils } from '../shared/utils.js';
import { loadFlags, isEnabled } from '../shared/metadata/feature-flags.js';
import { renderList as renderOverlayList, esc as escOverlay } from '../overlay/render.js';

const $ = (sel, root = document) => root.querySelector(sel);

const OVERLAY_FOCUS_KEY = 'overlay_sidepanel_focus';
const overlayFocus = { focus: null, items: [], showRejected: false };

function paintOverlayFocus() {
    const box = $('#xr-ov-focus');
    if (!box) return;
    const f = overlayFocus.focus;
    if (!f) { box.hidden = true; box.innerHTML = ''; return; }
    box.innerHTML = '<div class="xr-ov-focus-head">'
        + `<strong title="${escOverlay(f.url)}">X-Ray notes for this page</strong>`
        + '<button type="button" class="xr-ov-btn" data-xr-ov-action="dismiss">Dismiss</button>'
        + '</div>'
        + renderOverlayList(overlayFocus.items, { showRejected: overlayFocus.showRejected, actions: false });
    box.hidden = false;
}

async function showOverlayFocus() {
    const area = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session;
    if (!area || !isEnabled('inlineOverlay')) return;
    let focus = null;
    try { focus = (await area.get(OVERLAY_FOCUS_KEY))[OVERLAY_FOCUS_KEY] || null; } catch (_) { focus = null; }
    if (!focus || typeof focus.url !== 'string' || !Array.isArray(focus.itemIds)) {
        overlayFocus.focus = null;
        paintOverlayFocus();
        return;
    }
    let resp = null;
    try {
        resp = await chrome.runtime.sendMessage({ type: 'xray:overlay:card', url: focus.url, itemIds: focus.itemIds });
    } catch (_) { resp = null; }
    const want = new Set(focus.itemIds);
    overlayFocus.focus = focus;
    overlayFocus.items = resp && resp.ok && Array.isArray(resp.items)
        ? resp.items.filter((it) => it && want.has(it.id))
        : [];
    paintOverlayFocus();
}

function wireOverlay() {
    const box = $('#xr-ov-focus');
    if (!box) return;
    box.addEventListener('click', (ev) => {
        const btn = ev.target && ev.target.closest && ev.target.closest('[data-xr-ov-action]');
        if (!btn) return;
        const action = btn.getAttribute('data-xr-ov-action');
        if (action === 'toggle-rejected') {
            overlayFocus.showRejected = !overlayFocus.showRejected;
            paintOverlayFocus();
        } else if (action === 'dismiss') {
            overlayFocus.focus = null;
            paintOverlayFocus();
            try { chrome.storage.session.remove(OVERLAY_FOCUS_KEY); } catch (_) { /* ignore */ }
        }
    });
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'session' && OVERLAY_FOCUS_KEY in changes) {
            showOverlayFocus().catch(() => { /* panel keeps its other views */ });
        }
    });
    loadFlags().then(showOverlayFocus).catch(() => { /* stays hidden */ });
}


/** Wire the fallback view; failure leaves the panel's other views intact. */
export function wireOverlayFocus() {
    try { wireOverlay(); } catch (err) {
        Utils.error('[X-Ray Sidepanel] overlay fallback unavailable:', err);
    }
}
