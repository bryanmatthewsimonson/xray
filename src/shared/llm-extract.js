// LLM extraction assembly — Phase 18 C5
// (docs/COMPLEX_CONTENT_DESIGN.md §6).
//
// PURE module: no chrome, no DOM, no network. Input is the ordered
// span list an LLM returned for a document (headings, paragraphs,
// captions, table reconstructions); output is markdown plus the same
// pageMap shape pdf-layout emits, so page anchors on claims keep
// working over a reconstructed body.
//
// Two modes, one honesty rule (§6.2):
//
//   structure     — a deterministic Tier-2 substrate exists. Every
//                   text span the model emitted is a SEARCH KEY, never
//                   trusted bytes: it is grounded against the
//                   substrate via quote-grounding, and either
//                   re-canonicalizes to the substrate's own characters
//                   or is dropped and counted in `unverified_spans`.
//                   Table STRUCTURE (rows/columns/header order) is the
//                   model's legitimate contribution, but every cell
//                   string re-grounds like any other span; a
//                   majority-fabricated table is not a reconstruction
//                   and drops whole. The stored capture never contains
//                   model-authored body text.
//   transcription — scans, no substrate. The transcription IS the
//                   capture (§6.2's scans clause): spans are kept as
//                   authored, and honesty comes from
//                   extraction.method = 'llm:<model>' plus the reader
//                   banner, not from grounding. `unverified_spans` is
//                   always 0 here — its presence is the structure-mode
//                   marker (§6.3) and the caller omits it.
//
// The pageMap matches pdf-layout's CONSUMED shape — entries
// { page, start, end } over the emitted markdown, textless pages
// absent, pages strictly ascending — so pageOfOffset / the reader's
// pdfPageOfQuote work unchanged. (The model supplies page HINTS, which
// may be sparse or confused; hints inherit forward, and a hint lower
// than the current page is ignored.)

import { createGroundingIndex } from './quote-grounding.js';

const KINDS = new Set(['heading', 'paragraph', 'caption', 'table']);

const HEADING_MIN = 1;
const HEADING_MAX = 4;
const HEADING_DEFAULT = 2;

// ------------------------------------------------------------------
// Span validation
// ------------------------------------------------------------------

/** 1-based page hint, or null when absent/junk. */
function validPage(page) {
    return (Number.isInteger(page) && page >= 1) ? page : null;
}

function clampLevel(level) {
    if (typeof level !== 'number' || !Number.isFinite(level)) return HEADING_DEFAULT;
    return Math.min(HEADING_MAX, Math.max(HEADING_MIN, Math.round(level)));
}

/**
 * Structural triage of one raw span. Junk — wrong kind, text spans
 * without usable text, table spans without a cells array — returns
 * null and is skipped silently (never a throw): a confused model
 * degrades the reconstruction, it doesn't crash the capture.
 */
function classifySpan(raw) {
    if (!raw || typeof raw !== 'object' || !KINDS.has(raw.kind)) return null;
    const page = validPage(raw.page);
    if (raw.kind === 'table') {
        if (!Array.isArray(raw.cells)) return null;
        return { kind: 'table', cells: raw.cells, page };
    }
    if (typeof raw.text !== 'string' || !raw.text.trim()) return null;
    return { kind: raw.kind, text: raw.text.trim(), level: raw.level, page };
}

// ------------------------------------------------------------------
// Emission helpers
// ------------------------------------------------------------------

// Grounded substrate bytes can span a source line break (whitespace
// runs are equivalent under grounding's normalization). Inside a
// heading, caption, or table cell a raw newline would break the
// markdown structure, so newline runs collapse to a single space
// there — a whitespace *rendering* adjustment, not authored text.
// Paragraph bytes are emitted untouched.
function singleLine(text) {
    return String(text).replace(/\s*\n\s*/g, ' ');
}

function gfmCell(text) {
    return singleLine(text).replace(/\|/g, '\\|');
}

// ------------------------------------------------------------------
// Short-key grounding hardening (adversarial-review fix)
// ------------------------------------------------------------------
//
// quote-grounding's exact/normalized tiers are SUBSTRING searches, and
// its short-quote guard only blocks the fuzzy tier. Demonstrated:
// ground('9') matched inside 'COVID-19', '201' inside '2017', '12'
// inside '12%' — so a fabricated numeric table could assemble entirely
// from sub-token shards and report zero unverified cells. Short keys
// therefore only count as grounded when the match is TOKEN-BOUNDED:
// both neighbors in the substrate are non-alphanumeric (or the string
// edge). Long keys keep plain substring semantics — a 40-char verbatim
// substring match is real evidence regardless of neighbors.
const SHORT_KEY_CHARS = 15;
const ALNUM_RE = /[\p{L}\p{N}]/u;

// A cell with no letters (numbers, %, punctuation) can ground
// ANYWHERE a similar figure appears — a vacuous match. Such cells ride
// along in a surviving table but can never make it credible: a table
// needs at least one grounded SUBSTANTIVE cell (real words) to
// survive. Row/column association is never machine-checkable against
// a scrambled substrate — that residue is handled by DISCLOSURE (the
// caller's structure-mode banner), not by pretending to verify it.
const NUMERIC_LIKE_RE = /^[\s\d.,;%()\-–—+±:/·*]*$/u;

function boundaryAnchored(g, substrate) {
    const before = g.start > 0 ? substrate[g.start - 1] : '';
    const after = g.end < substrate.length ? substrate[g.end] : '';
    return !(before && ALNUM_RE.test(before)) && !(after && ALNUM_RE.test(after));
}

/**
 * Ground one search key with the short-key hardening applied.
 * Returns the grounding result, or null for "treat as missing".
 */
function groundKey(index, key, substrate) {
    const g = index.ground(key);
    if (g.status === 'missing') return null;
    if (key.length < SHORT_KEY_CHARS && !boundaryAnchored(g, substrate)) return null;
    return g;
}

/**
 * One table span → GFM text (or a drop). Returns
 * { text: string|null, unverified: number } where `unverified` is the
 * count of failed cells plus one more if the table itself dropped.
 * With no grounding index (transcription mode) cells pass verbatim.
 */
function buildTable(cells, index, substrate) {
    const rows = cells
        .filter((row) => Array.isArray(row))
        .map((row) => row.map((cell) => (typeof cell === 'string' ? cell.trim() : '')));
    if (rows.length === 0) return { text: null, unverified: 1 };

    let nonEmpty = 0;
    let failed = 0;
    let substantive = 0;   // grounded cells with real words in them
    const grounded = rows.map((row) => row.map((cell) => {
        if (!cell) return '';
        nonEmpty += 1;
        if (!index) return cell;
        const g = groundKey(index, cell, substrate);
        if (!g) { failed += 1; return ''; }
        if (!NUMERIC_LIKE_RE.test(cell)) substantive += 1;
        return g.exact;
    }));

    // Three ways a table fails to be a reconstruction, each dropping it
    // whole (one more unverified span on top of the per-cell counts):
    // no content, a majority of fabricated cells, or — the demonstrated
    // attack — zero grounded SUBSTANTIVE cells, i.e. every surviving
    // cell is a number-shaped string that would match almost anywhere.
    // A table the substrate cannot vouch one real word for is the
    // model's table, not the document's.
    if (nonEmpty === 0 || failed * 2 > nonEmpty || (index && substantive === 0)) {
        return { text: null, unverified: failed + 1 };
    }

    const width = Math.max(...grounded.map((row) => row.length));
    const padded = grounded.map((row) => {
        const out = row.slice();
        while (out.length < width) out.push('');
        return out;
    });
    const line = (row) => '| ' + row.map(gfmCell).join(' | ') + ' |';
    const lines = [
        line(padded[0]),
        '| ' + new Array(width).fill('---').join(' | ') + ' |',
        ...padded.slice(1).map(line)
    ];
    return { text: lines.join('\n'), unverified: failed };
}

// ------------------------------------------------------------------
// Page map
// ------------------------------------------------------------------

/**
 * pdf-layout-shaped page map over the emitted blocks. `pages[i]` is
 * each block's resolved page (non-decreasing; null only when no span
 * in the document carried a page hint, in which case the map is null).
 * One entry per page at its first block; `end` closes at the last
 * block of that page so pageOfOffset's [start, end) test works.
 */
function buildPageMap(blocks, offsets, pages, firstSeenPage) {
    if (firstSeenPage === null || blocks.length === 0) return null;
    const map = [];
    for (let i = 0; i < blocks.length; i++) {
        const page = pages[i] === null ? firstSeenPage : pages[i];
        const end = offsets[i] + blocks[i].length;
        if (map.length === 0 || page > map[map.length - 1].page) {
            map.push({ page, start: offsets[i], end });
        } else {
            map[map.length - 1].end = end;
        }
    }
    return map;
}

// ------------------------------------------------------------------
// Entry points
// ------------------------------------------------------------------

/**
 * Assemble a capture body from an LLM span list.
 *
 * @param {Array<{kind: string, text?: string, level?: number,
 *                cells?: string[][], page?: number}>} spans
 * @param {string|null} substrateText Tier-2 deterministic text
 *   (structure mode); ignored in transcription mode.
 * @param {{mode: 'structure'|'transcription'}} opts Anything other
 *   than an explicit 'transcription' runs structure mode — the safe
 *   default: without a substrate everything drops rather than
 *   silently storing unverified model text.
 * @returns {{markdown: string,
 *            pageMap: Array<{page: number, start: number, end: number}>|null,
 *            unverified_spans: number, total_spans: number}}
 *   Empty markdown (with counts intact) signals a failed
 *   reconstruction to the caller.
 */
export function assembleExtraction(spans, substrateText, opts) {
    const transcription = !!opts && opts.mode === 'transcription';
    const list = Array.isArray(spans) ? spans : [];
    const substrate = transcription ? '' : String(substrateText || '');
    const index = transcription ? null : createGroundingIndex(substrate);

    let totalSpans = 0;
    let unverified = 0;
    let tableCount = 0;
    let currentPage = null;      // advances over SPANS (dropped ones too)
    let firstSeenPage = null;
    const blocks = [];           // emitted block texts, in span order
    const blockPages = [];       // resolved page per emitted block (null = before first hint)

    for (const raw of list) {
        const span = classifySpan(raw);
        if (!span) continue;     // junk — silently skipped, both modes
        totalSpans += 1;

        // Page tracking happens even for spans that go on to drop: a
        // fabricated span's page hint is still positional evidence for
        // the spans after it. Hints only move forward — a hint lower
        // than the current page is model confusion and is ignored.
        if (span.page !== null) {
            if (firstSeenPage === null) firstSeenPage = span.page;
            if (currentPage === null || span.page > currentPage) currentPage = span.page;
        }

        let text;
        if (span.kind === 'table') {
            const table = buildTable(span.cells, index, substrate);
            unverified += table.unverified;
            if (table.text === null) continue;
            text = table.text;
            tableCount += 1;
        } else {
            let bytes = span.text;
            if (index) {
                const g = groundKey(index, bytes, substrate);
                if (!g) { unverified += 1; continue; }
                bytes = g.exact;   // the substrate's own characters
            }
            if (span.kind === 'heading') {
                text = '#'.repeat(clampLevel(span.level)) + ' ' + singleLine(bytes);
            } else if (span.kind === 'caption') {
                text = '*' + singleLine(bytes) + '*';
            } else {
                text = bytes;
            }
        }
        blocks.push(text);
        blockPages.push(currentPage);
    }

    let markdown = '';
    const offsets = [];
    for (const block of blocks) {
        if (markdown) markdown += '\n\n';
        offsets.push(markdown.length);
        markdown += block;
    }

    return {
        markdown,
        pageMap: buildPageMap(blocks, offsets, blockPages, firstSeenPage),
        unverified_spans: transcription ? 0 : unverified,
        total_spans: totalSpans,
        // Emitted tables. Callers MUST disclose when this is non-zero
        // on the structure path: cell TEXT re-grounds to substrate
        // bytes, but row/column ASSOCIATION is the model's reading and
        // cannot be machine-checked against a scrambled substrate —
        // "all spans verified" would be a false claim over a table.
        table_count: tableCount
    };
}

/**
 * The §6.3 provenance method string.
 *
 *   structure:     '<baseMethod>+llm:<model>'  (e.g. 'pdfjs-4.10+llm:claude-opus-4-8')
 *   transcription: 'llm:<model>'
 *
 * Defensive: a missing model becomes 'unknown'; structure mode
 * without a real base method (the caller lied — there is no
 * deterministic substrate to credit) falls back to plain
 * 'llm:<model>' rather than fabricating a composition.
 *
 * @param {string} baseMethod
 * @param {string} model
 * @param {'structure'|'transcription'} mode
 * @returns {string}
 */
export function extractionMethod(baseMethod, model, mode) {
    const m = (typeof model === 'string' && model.trim()) ? model.trim() : 'unknown';
    if (mode === 'structure' && typeof baseMethod === 'string' && baseMethod.trim()) {
        // Idempotent over re-runs: a second reconstruction composes over
        // the DETERMINISTIC base, not over the previous composition —
        // 'pdfjs-4.10+llm:a' re-run with model b is 'pdfjs-4.10+llm:b',
        // never 'pdfjs-4.10+llm:a+llm:b' (a malformed §6.3 method that
        // would publish on the wire).
        const base = baseMethod.trim().replace(/(\+llm:[^+]+)+$/, '');
        // A base that is ITSELF a transcription ('llm:…') offers no
        // deterministic layer to credit — composing over it would claim
        // one. Falls through to plain 'llm:<model>'.
        if (base && !/^llm:/.test(base)) return base + '+llm:' + m;
    }
    return 'llm:' + m;
}
