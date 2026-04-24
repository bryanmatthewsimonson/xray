// Element-cropped screenshot — Phase 8a anti-obfuscation infra.
//
// Three-step capture:
//   1. Content script measures the target element (rect + DPR) and
//      ensures it's in the viewport (scroll-into-view if needed).
//   2. Sends an `xray:screenshot:capture` message to the background
//      service worker, which is the only context with permission to
//      call `chrome.tabs.captureVisibleTab`.
//   3. Background captures the visible tab, decodes the dataURL,
//      crops it on an OffscreenCanvas to the requested rect, returns
//      a fresh PNG dataURL.
//
// Why split the work across content + background:
//   - `chrome.tabs.captureVisibleTab` is not available to content
//     scripts — it requires the extension API context.
//   - The crop math has to happen somewhere with Canvas, which we
//     have in either context, but doing it in the background lets us
//     return a single small dataURL instead of shipping the full
//     viewport bytes back to the content script just to throw most
//     of them away.

// Resolved lazily so importing this module in environments without
// chrome.* (e.g. Node tests for `computeCropBox`) doesn't throw at
// load time.
function browserApi() {
    if (typeof browser !== 'undefined' && browser.runtime) return browser;
    if (typeof chrome !== 'undefined' && chrome.runtime) return chrome;
    throw new Error('No browser/chrome runtime available');
}

/**
 * Capture a screenshot of `element` cropped to its bounding box.
 * Returns a `data:image/png;base64,...` URL on success, or null
 * if the capture failed (permission denied, off-screen element,
 * etc.).
 *
 * Caller is responsible for deciding what to do with the result —
 * embed in an event, hash + tag, upload to Blossom, etc.
 *
 * @param {Element} element            DOM element to crop to
 * @param {object}  [opts]
 * @param {boolean} [opts.scrollIntoView=true]
 *                  Scroll the element into view before capturing if
 *                  it's not currently in the viewport.
 * @returns {Promise<string|null>}     PNG dataURL, or null on failure
 */
export async function capturePostScreenshot(element, opts = {}) {
    if (!element || typeof element !== 'object' || element.nodeType !== 1) {
        return null;
    }
    const scrollIntoView = opts.scrollIntoView !== false;

    if (scrollIntoView) {
        // `block: 'center'` keeps the post in the visible band even
        // on tall viewports — better odds the entire post is captured.
        try { element.scrollIntoView({ block: 'center', inline: 'nearest' }); }
        catch (_) { /* no-op for elements that don't support it */ }
        // One animation frame for the scroll to settle.
        await new Promise((r) => requestAnimationFrame(r));
    }

    const rect = element.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    if (rect.width <= 0 || rect.height <= 0) {
        console.warn('[X-Ray screenshot] target has zero size, skipping:', rect);
        return null;
    }
    console.log('[X-Ray screenshot] capturing', element.tagName, 'rect:', rect, 'dpr:', dpr);

    try {
        const resp = await browserApi().runtime.sendMessage({
            type: 'xray:screenshot:capture',
            rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
            dpr
        });
        if (!resp || !resp.ok) {
            console.warn('[X-Ray screenshot] SW handler returned failure:', resp);
            return null;
        }
        console.log('[X-Ray screenshot] success — dataUrl length:', (resp.dataUrl || '').length);
        return resp.dataUrl || null;
    } catch (err) {
        console.warn('[X-Ray screenshot] capture failed:', err);
        return null;
    }
}

/**
 * Background-side handler. Wire this up in src/background/index.js
 * inside the existing `chrome.runtime.onMessage` listener. Returns
 * `true` to keep the message channel open for the async response.
 *
 * Wiring example:
 *   case 'xray:screenshot:capture':
 *     handleScreenshotCapture(msg, sender)
 *       .then((res) => sendResponse(res))
 *       .catch((err) => sendResponse({ ok: false, error: err.message }));
 *     return true;
 */
export async function handleScreenshotCapture(msg, sender) {
    const tabId    = sender && sender.tab && sender.tab.id;
    const windowId = sender && sender.tab && sender.tab.windowId;
    if (!tabId || !windowId) {
        return { ok: false, error: 'no tab context' };
    }

    let dataUrl;
    try {
        dataUrl = await captureVisibleTab(windowId);
    } catch (err) {
        return { ok: false, error: 'captureVisibleTab failed: ' + (err.message || err) };
    }
    if (!dataUrl) return { ok: false, error: 'captureVisibleTab returned empty' };

    const cropped = await cropDataUrl(dataUrl, msg.rect, msg.dpr);
    return cropped
        ? { ok: true, dataUrl: cropped }
        : { ok: false, error: 'crop failed' };
}

function captureVisibleTab(windowId) {
    return new Promise((resolve, reject) => {
        try {
            browserApi().tabs.captureVisibleTab(windowId, { format: 'png' }, (dataUrl) => {
                const err = browserApi().runtime.lastError;
                if (err) reject(new Error(err.message)); else resolve(dataUrl);
            });
        } catch (err) { reject(err); }
    });
}

/**
 * Crop a viewport dataURL to the given rect. Pure function suitable
 * for unit testing the rect-math via `computeCropBox`. Wraps that
 * with the OffscreenCanvas decode + draw + encode round-trip.
 */
async function cropDataUrl(dataUrl, rect, dpr) {
    if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') {
        return null;
    }
    const blob = await (await fetch(dataUrl)).blob();
    const bitmap = await createImageBitmap(blob);
    const box = computeCropBox(rect, dpr || 1, bitmap.width, bitmap.height);
    if (!box) return null;
    const canvas = new OffscreenCanvas(box.width, box.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, box.x, box.y, box.width, box.height,
                          0, 0, box.width, box.height);
    const out = await canvas.convertToBlob({ type: 'image/png' });
    return await blobToDataUrl(out);
}

/**
 * Translate a CSS-pixel rect (from getBoundingClientRect) into a
 * bitmap-pixel crop box, clamped to the bitmap dimensions. Pure
 * function — exported so tests can pin its math without spinning
 * up Canvas.
 */
export function computeCropBox(rect, dpr, bitmapWidth, bitmapHeight) {
    if (!rect || dpr <= 0 || bitmapWidth <= 0 || bitmapHeight <= 0) return null;
    const x = Math.max(0, Math.round(rect.x * dpr));
    const y = Math.max(0, Math.round(rect.y * dpr));
    const wantedW = Math.round(rect.width  * dpr);
    const wantedH = Math.round(rect.height * dpr);
    const width  = Math.max(0, Math.min(wantedW, bitmapWidth  - x));
    const height = Math.max(0, Math.min(wantedH, bitmapHeight - y));
    if (width === 0 || height === 0) return null;
    return { x, y, width, height };
}

function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload  = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

/**
 * SHA-256 of a dataURL's payload bytes (not the whole `data:...`
 * string). Lets the caller publish the hash as evidence the
 * screenshot wasn't substituted post-hoc.
 */
export async function dataUrlHash(dataUrl) {
    if (typeof dataUrl !== 'string') return null;
    const m = dataUrl.match(/^data:[^;]+;base64,(.*)$/);
    if (!m) return null;
    const bin = atob(m[1]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    if (typeof crypto === 'undefined' || !crypto.subtle) return null;
    const buf = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}
