// HTML islands — Phase 18 C1 (docs/COMPLEX_CONTENT_DESIGN.md §4).
//
// PURE module (no chrome; DOM only behind guards). Markdown cannot
// represent complex tables (rowspan/colspan, nested tables, captions,
// multi-row headers, block content in cells) or MathML — GFM silently
// mangles them. Instead of mangling, the extractor preserves such
// nodes as fenced, sanitized HTML "islands" inside the markdown:
//
//   <!--xr:island:table-->
//   <table>…</table>
//   <!--/xr:island-->
//
// Two invariants:
//
//   1. DETERMINISM — sanitizeIslandNode is a canonical serializer:
//      allowlisted tags only (unknown elements unwrap to their text),
//      allowlisted attributes in a fixed order, whitespace-collapsed
//      text, escaped everything. Same DOM in, same string out — so
//      the canonical article hash stays stable across captures.
//   2. NEVER TRUSTED AT RENDER — captured markdown round-trips
//      through relays, so the renderer (markdownToHtml) re-sanitizes
//      island bodies through this same allowlist before injecting
//      them. A fence in foreign markdown buys nothing.
//
// The classifier (isComplexTable) and sanitizer walk plain node
// interfaces (nodeType / tagName / childNodes / getAttribute /
// nodeValue) so tests exercise them with hand-built stubs — no jsdom.

// ------------------------------------------------------------------
// Profiles — the allowlists. Attribute order here IS the serialized
// attribute order (determinism).
// ------------------------------------------------------------------

const PROFILES = {
    table: {
        root: 'table',
        tags: {
            table: [], caption: [], colgroup: ['span'], col: ['span'],
            thead: [], tbody: [], tfoot: [], tr: [],
            th: ['colspan', 'rowspan', 'scope'], td: ['colspan', 'rowspan'],
            // Inline formatting worth keeping inside cells.
            a: ['href'], strong: [], b: [], em: [], i: [], code: [],
            sub: [], sup: [], br: []
        },
        void: new Set(['col', 'br'])
    },
    math: {
        root: 'math',
        tags: {
            math: ['display'], semantics: [], annotation: ['encoding'],
            'annotation-xml': ['encoding'],
            mrow: [], mi: ['mathvariant'], mo: ['form', 'stretchy'], mn: [],
            msup: [], msub: [], msubsup: [], mfrac: ['linethickness'],
            msqrt: [], mroot: [], mtext: [], mspace: ['width'],
            mover: ['accent'], munder: [], munderover: [],
            mtable: [], mtr: [], mtd: [], mstyle: ['displaystyle'],
            mpadded: [], mphantom: [], mfenced: ['open', 'close', 'separators']
        },
        void: new Set()
    }
};

export const ISLAND_PROFILES = Object.freeze(Object.keys(PROFILES));

// Structural containers whose whitespace-only text children are
// serialization noise (formatting between tags), not content.
const STRUCTURAL = new Set([
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'colgroup',
    'math', 'semantics', 'mrow', 'mtable', 'mtr', 'mstyle'
]);

// Active/metadata content is dropped OUTRIGHT — not even unwrapped —
// so a hostile island can't smuggle script text into the output.
const DROP = new Set([
    'script', 'style', 'iframe', 'object', 'embed', 'svg',
    'link', 'meta', 'noscript', 'template', 'form', 'input', 'button'
]);

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

function tagOf(node) {
    return String(node.tagName || node.nodeName || '').toLowerCase();
}

// href hygiene: relative/http(s)/mailto survive; javascript:/data:/
// anything else is dropped (attribute omitted, link text kept).
function safeHref(value) {
    const v = String(value || '').trim();
    if (!v) return null;
    if (/^(https?:|mailto:)/i.test(v)) return v;
    if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return null;   // any other scheme
    return v;                                          // relative
}

// ------------------------------------------------------------------
// Canonical sanitizing serializer
// ------------------------------------------------------------------

/**
 * Serialize `node` through the profile's allowlist. Unknown elements
 * UNWRAP (children processed, tags dropped) so cell content survives
 * publisher div-soup as plain text; unknown attributes are dropped;
 * text is whitespace-collapsed and escaped. Deterministic. Pure.
 *
 * @param {object} node     DOM-ish element (the island root)
 * @param {'table'|'math'} profile
 * @returns {string} canonical HTML, or '' if node is unusable
 */
export function sanitizeIslandNode(node, profile) {
    const p = PROFILES[profile];
    if (!p || !node || node.nodeType !== 1) return '';
    if (tagOf(node) !== p.root) return '';
    return serializeElement(node, p);
}

function serializeElement(node, p) {
    const tag = tagOf(node);
    if (DROP.has(tag)) return '';
    const allowedAttrs = p.tags[tag];
    if (allowedAttrs === undefined) {
        // Unknown element — unwrap.
        return serializeChildren(node, p, false);
    }
    let attrs = '';
    for (const name of allowedAttrs) {
        if (typeof node.getAttribute !== 'function') break;
        let value = node.getAttribute(name);
        if (value === null || value === undefined || value === '') continue;
        if (tag === 'a' && name === 'href') {
            value = safeHref(value);
            if (value === null) continue;
        }
        attrs += ` ${name}="${escapeHtml(value)}"`;
    }
    if (p.void.has(tag)) return `<${tag}${attrs}/>`;
    // Boundary whitespace inside an element is rendering-noise; trim it
    // so publisher formatting can't wobble the canonical string.
    const inner = serializeChildren(node, p, STRUCTURAL.has(tag)).replace(/^ +| +$/g, '');
    return `<${tag}${attrs}>${inner}</${tag}>`;
}

function serializeChildren(node, p, dropWhitespaceText) {
    let out = '';
    for (const child of node.childNodes || []) {
        if (child.nodeType === 3) {
            const collapsed = String(child.nodeValue || '').replace(/\s+/g, ' ');
            if (dropWhitespaceText && collapsed.trim() === '') continue;
            out += escapeHtml(collapsed);
        } else if (child.nodeType === 1) {
            out += serializeElement(child, p);
        }
        // comments / other node types: dropped
    }
    return out;
}

// ------------------------------------------------------------------
// Complex-table classifier
// ------------------------------------------------------------------

const BLOCK_IN_CELL = new Set([
    'p', 'ul', 'ol', 'blockquote', 'pre', 'table', 'br',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6'
]);

/**
 * Is `table` beyond what GFM pipe tables can represent? True for:
 * nested tables, captions, colspan/rowspan > 1, multi-row headers,
 * block content inside cells. Simple grids return false and take the
 * normal GFM path. Pure; walks childNodes only.
 *
 * @param {object} table  DOM-ish <table> element
 * @returns {boolean}
 */
export function isComplexTable(table) {
    if (!table || table.nodeType !== 1 || tagOf(table) !== 'table') return false;
    let complex = false;

    const visit = (node, inCell) => {
        if (complex || !node || node.nodeType !== 1) return;
        const tag = tagOf(node);
        if (node !== table) {
            if (tag === 'table') { complex = true; return; }
            if (tag === 'caption') { complex = true; return; }
            if (tag === 'td' || tag === 'th') {
                if (spanOf(node, 'colspan') > 1 || spanOf(node, 'rowspan') > 1) {
                    complex = true; return;
                }
                inCell = true;
            } else if (inCell && BLOCK_IN_CELL.has(tag)) {
                complex = true; return;
            }
            if (tag === 'thead' && rowCount(node) > 1) { complex = true; return; }
        }
        for (const child of node.childNodes || []) visit(child, inCell);
    };
    visit(table, false);
    return complex;
}

function spanOf(cell, attr) {
    if (typeof cell.getAttribute !== 'function') return 1;
    const n = parseInt(cell.getAttribute(attr) || '1', 10);
    return Number.isFinite(n) ? n : 1;
}

function rowCount(node) {
    let n = 0;
    for (const child of node.childNodes || []) {
        if (child.nodeType === 1 && tagOf(child) === 'tr') n += 1;
    }
    return n;
}

// ------------------------------------------------------------------
// Fences
// ------------------------------------------------------------------

/** Wrap sanitized island HTML in its markdown fence. */
export function wrapIsland(html, profile) {
    return `<!--xr:island:${profile}-->\n${html}\n<!--/xr:island-->`;
}

/** Fresh fence-matching regex (fresh so /g lastIndex never leaks). */
export function islandPattern() {
    return /<!--xr:island:(table|math)-->\n?([\s\S]*?)\n?<!--\/xr:island-->/g;
}

/**
 * Re-sanitize an island body at RENDER time (the body may come from
 * foreign markdown — the fence is not a trust boundary). Parses with
 * DOMParser where available; returns null when it can't produce a
 * safe island (caller escapes the body as plain text instead).
 *
 * @param {string} html
 * @param {'table'|'math'} profile
 * @returns {string|null}
 */
export function sanitizeIslandString(html, profile) {
    const p = PROFILES[profile];
    if (!p) return null;
    if (typeof DOMParser === 'undefined') return null;
    try {
        const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
        const el = doc && doc.body ? doc.body.querySelector(p.root) : null;
        const out = el ? sanitizeIslandNode(el, profile) : '';
        return out || null;
    } catch (_) {
        return null;
    }
}
