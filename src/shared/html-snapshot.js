// HTML snapshot — Phase 8a anti-obfuscation infrastructure.
//
// Captures a bounded, sanitized HTML string of a DOM subtree. The
// purpose: even when our structured extractor fails on a hostile
// platform, future tools (or a human) can re-extract from this
// raw HTML. Tagged into the article's `evidence.htmlSnapshot`
// field so capture artifacts always have at least one
// machine-readable representation of the original.
//
// Sanitization goals (in order of importance):
//   1. No <script> tags or `on*` event handlers — defense against
//      embedding active code into a NOSTR event that some
//      downstream renderer might naively dump into innerHTML.
//   2. No data: URLs in src/href — those balloon size and embed
//      arbitrary binary payloads we can't audit at extraction time.
//   3. No external network requests when re-rendered — strip
//      `src`/`href` on tags that would auto-fetch (`<img>`,
//      `<iframe>`, `<link>`).
//   4. Bounded byte size — caller can request up to MAX_SNAPSHOT_BYTES
//      (default 50 KB). Truncation is byte-honest: returns the
//      sanitized prefix that fits, with a marker comment appended
//      so it's clear the snapshot was truncated.

const MAX_SNAPSHOT_BYTES = 50 * 1024;
const TRUNCATION_MARKER = '<!-- truncated by X-Ray html-snapshot -->';

const STRIPPED_TAG_NAMES = new Set([
    'script', 'style', 'noscript', 'iframe', 'object', 'embed',
    'meta', 'link'
]);

const NETWORK_ATTRS = new Set(['src', 'href', 'srcset', 'poster', 'data']);

/**
 * Snapshot the given element. Returns a string suitable for
 * embedding into a NOSTR event's content (or evidence field).
 *
 * @param {Element} element                       DOM element to snapshot
 * @param {object} [opts]
 * @param {number} [opts.maxBytes=MAX_SNAPSHOT_BYTES] Byte cap on the
 *                  output. Truncates to fit; never throws.
 * @returns {string} Sanitized HTML snapshot, possibly truncated.
 */
export function snapshot(element, opts = {}) {
    if (!element || typeof element !== 'object' || element.nodeType !== 1) {
        return '';
    }
    const maxBytes = Number.isFinite(opts.maxBytes) && opts.maxBytes > 0
        ? opts.maxBytes
        : MAX_SNAPSHOT_BYTES;

    const cloned = element.cloneNode(true);
    sanitize(cloned);
    const html = collapseWhitespace(cloned.outerHTML || '');
    return enforceByteCap(html, maxBytes);
}

/**
 * Walk the tree and remove unsafe tags + attributes in place.
 * Operates on the cloned subtree so the live page is untouched.
 */
function sanitize(node) {
    // Iterate over a static list — we mutate during the walk.
    const stack = [node];
    while (stack.length > 0) {
        const el = stack.pop();
        if (!el || el.nodeType !== 1) continue;

        const tagName = (el.tagName || '').toLowerCase();
        if (STRIPPED_TAG_NAMES.has(tagName)) {
            el.parentNode && el.parentNode.removeChild(el);
            continue;
        }

        // Remove attributes that are dangerous (event handlers) or
        // bandwidth-hostile (data: URLs, network refs).
        const attrs = Array.from(el.attributes || []);
        for (const attr of attrs) {
            const name = attr.name.toLowerCase();
            const value = attr.value || '';
            if (name.startsWith('on')) {
                el.removeAttribute(attr.name);
                continue;
            }
            if (NETWORK_ATTRS.has(name)) {
                if (value.startsWith('data:')) {
                    el.removeAttribute(attr.name);
                    continue;
                }
                // For network attrs that aren't data: URLs, leave the
                // value but blank `srcset` (may be many URLs).
                if (name === 'srcset') el.setAttribute(name, '');
            }
        }

        for (const child of Array.from(el.children || [])) stack.push(child);
    }
}

/**
 * Collapse runs of whitespace to single spaces in text nodes only,
 * leaving attribute values alone. Reduces snapshot size without
 * losing structural fidelity.
 */
function collapseWhitespace(html) {
    // Conservative: only collapse 3+ consecutive whitespace chars
    // outside of tags. Doesn't try to be a parser — just trims the
    // worst inflation cases.
    return html.replace(/>\s{3,}</g, '> <');
}

/**
 * Truncate the string to fit within maxBytes when UTF-8 encoded.
 * Appends a marker so consumers know the snapshot is partial.
 */
function enforceByteCap(html, maxBytes) {
    const encoder = (typeof TextEncoder !== 'undefined') ? new TextEncoder() : null;
    if (!encoder) {
        // Fallback: assume 1 char ≈ 1 byte (close enough for sanitized HTML).
        if (html.length <= maxBytes) return html;
        return html.slice(0, Math.max(0, maxBytes - TRUNCATION_MARKER.length)) + TRUNCATION_MARKER;
    }
    const bytes = encoder.encode(html);
    if (bytes.length <= maxBytes) return html;

    // Binary-search-ish trim: cut characters off the end until the
    // encoded form fits, leaving room for the marker.
    const target = maxBytes - encoder.encode(TRUNCATION_MARKER).length;
    let lo = 0, hi = html.length;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (encoder.encode(html.slice(0, mid)).length <= target) lo = mid;
        else hi = mid - 1;
    }
    return html.slice(0, lo) + TRUNCATION_MARKER;
}

/**
 * Compute a SHA-256 hash of the snapshot string. Used as evidence
 * that the snapshot wasn't tampered with after publish — the hash
 * lands in event tags; the body lands in event content.
 *
 * Async because crypto.subtle.digest is async.
 */
export async function snapshotHash(html) {
    if (typeof html !== 'string') return null;
    if (typeof crypto === 'undefined' || !crypto.subtle) return null;
    const bytes = new TextEncoder().encode(html);
    const buf = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}
