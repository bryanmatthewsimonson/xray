// Inline overlay: remove X-Ray's own overlay nodes from a CLONED DOM
// subtree before it is captured. Shared by the article extractor
// (content-extractor.js) and the evidentiary HTML snapshots
// (html-snapshot.js, FB / IG / TikTok). The markers must never reach a
// capture: pin text ("X-Ray") would change the canonical article hash,
// and the card iframe has no place in evidence.
//
// Pins, the chip, the injected style and the card iframe are removed;
// <mark> wrappers are unwrapped so the page text is identical to a page
// the overlay never touched. Never call this on the live page — the
// content script's own teardown restores the live DOM exactly.

export const OVERLAY_REMOVE_SELECTOR = '.xr-ov-pin, .xr-ov-chip, #xr-ov-style, .xr-ov-frame';

export function stripOverlayNodes(root) {
    try {
        if (!root || typeof root.querySelectorAll !== 'function') return;
        Array.prototype.forEach.call(root.querySelectorAll(OVERLAY_REMOVE_SELECTOR), (n) => {
            if (n.parentNode) n.parentNode.removeChild(n);
        });
        Array.prototype.forEach.call(root.querySelectorAll('.xr-ov-mark'), (m) => {
            const parent = m.parentNode;
            if (!parent) return;
            while (m.firstChild) parent.insertBefore(m.firstChild, m);
            parent.removeChild(m);
        });
    } catch (_) { /* never block a capture on overlay cleanup */ }
}
