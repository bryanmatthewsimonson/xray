// Tiny DOM helpers shared by the portal views (Phase 12.5).
//
// Everything is createElement/textContent — the portal builds no
// dynamic innerHTML anywhere (escaping stays a non-issue and web-ext's
// UNSAFE_VAR_ASSIGNMENT warnings don't multiply).

export const SVG_NS = 'http://www.w3.org/2000/svg';

export function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
}

export function svgEl(tag, attrs) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, String(v));
    return node;
}

export function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
}

/**
 * Is `node` on screen as far as the portal can tell: in the document AND
 * under no `hidden` ancestor. Connection alone is not enough — leaving a
 * case view for the library only hides `#xr-view`, so the view the user
 * left stays connected while nobody can see it. (A closed <details> is
 * NOT hidden here: its content is one click away.) The render-only LLM
 * job surfaces release their job record only onto a shown panel.
 */
export function isShown(node) {
    return !!node && node.isConnected === true && !node.closest('[hidden]');
}

export function truncate(s, n) {
    const str = String(s || '').trim();
    return str.length > n ? str.slice(0, n - 1) + '…' : str;
}

export function shortKey(pubkey) {
    return pubkey.slice(0, 8) + '…' + pubkey.slice(-4);
}
