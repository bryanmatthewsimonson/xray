// PDF layout reconstruction — Phase 18 C4
// (docs/COMPLEX_CONTENT_DESIGN.md §5.3).
//
// PURE module: no pdf.js, no DOM, no chrome. Input is positioned text
// runs per page (mapped from pdf.js getTextContent by the reader's
// pdf-capture); output is markdown plus a PAGE MAP — character offsets
// into that markdown per page — so claims captured from a PDF can
// carry page-level provenance.
//
//   page:  { width, height, items: [{ str, x, y, w, h }] }
//          x/y are PDF user-space coords (origin bottom-left; y is the
//          run's baseline), w/h the run's advance width and font size.
//
// Reconstruction, in order:
//   1. lines      — cluster runs by baseline, order by x, insert
//                   spaces at real gaps.
//   2. furniture  — repeating headers/footers (same digit-stripped
//                   text in the top/bottom margins on ≥3 pages) and
//                   bare page numbers are dropped.
//   3. columns    — a page whose lines partition cleanly into left
//                   and right halves reads left column first; lines
//                   spanning both halves (title, abstract) split the
//                   page into bands, each ordered independently.
//                   Narrow gutters (LaTeX 10pt, IEEE 18pt) that the
//                   per-baseline gap split can't see are found
//                   structurally: a consistent x-band of gaps across
//                   many baselines is a gutter; per-line word gaps
//                   are not.
//   4. paragraphs — merged by baseline gaps and indent cues;
//                   line-break hyphens reflowed. Figures (C4.2) ride
//                   the same reading order as pseudo-lines, so a
//                   right-column figure lands in the right column's
//                   text, not at the top of the page.
//   5. headings   — unusually large, short lines become #/## heads.
//
// This intentionally targets the common one- and two-column text PDF
// (reports, filings, preprints). Pages it can't reconstruct still
// emit their text in y-order — degraded, never dropped.

const LINE_Y_TOLERANCE_FACTOR = 0.4;   // × run height, baseline clustering
const WORD_GAP_FACTOR         = 0.18;  // × run height, space insertion
const GUTTER_GAP_FACTOR       = 1.5;   // × run height, min column-gutter split
const GUTTER_GAP_MIN          = 18;    // pt — never split below this gap
const STRUCT_GUTTER_MIN       = 6;     // pt — a CONSISTENT gap this wide is a gutter
const STRUCT_GUTTER_SHARE     = 0.35;  // fraction of baselines that must show it
const STRUCT_BUCKET_PT        = 4;     // gutter-center bucketing granularity
const MARGIN_BAND             = 0.08;  // top/bottom fraction for furniture
const FURNITURE_MIN_PAGES     = 3;
const PAGE_NUMBER_SLACK       = 20;    // bare digits ≤ pages+slack can be page numbers
const PARA_GAP_FACTOR         = 1.55;  // × median line gap
const HEAD_H1_FACTOR          = 1.6;   // × median body size
const HEAD_H2_FACTOR          = 1.25;
const HEADING_MAX_WORDS       = 14;

// Extraction-quality heuristics (C4.1): reconstruction degrades rather
// than drops, but the USER must be told when it degraded — a shaky
// extraction silently presented as clean is a provenance failure.
const SPARSE_PAGE_CHARS = 50;   // page text below this ≈ no text layer
const SPARSE_TEXTY_PAGE = 200;  // …flagged only when SOME page proves a real text layer exists
const SHRED_MIN_LINES   = 20;   // shredded-text check needs enough lines
const SHRED_MEAN_CHARS  = 20;   // mean line length below this = runs didn't join

// ------------------------------------------------------------------
// Lines
// ------------------------------------------------------------------

// Assemble a line's text + extent from its x-sorted items. Shared by
// the baseline pass and the structural-gutter re-split.
function finalizeLine(line) {
    let text = '';
    let prev = null;
    for (const it of line.items) {
        if (prev) {
            const gap = it.x - (prev.x + prev.w);
            if (gap > Math.max(1, it.h * WORD_GAP_FACTOR) && !text.endsWith(' ')) text += ' ';
        }
        text += it.str;
        prev = it;
    }
    line.text = text.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    line.x0 = line.items[0].x;
    const last = line.items[line.items.length - 1];
    line.x1 = last.x + last.w;
    line.h = Math.max(...line.items.map((i) => i.h));
    return line;
}

function linesOfPage(page) {
    const items = (page.items || [])
        .filter((i) => i && typeof i.str === 'string' && i.str.trim() !== '')
        .map((i) => ({
            str: i.str, x: i.x, y: i.y,
            w: i.w || 0, h: i.h || 10
        }))
        .sort((a, b) => b.y - a.y || a.x - b.x);

    // 1. Cluster runs by baseline.
    const clusters = [];
    for (const item of items) {
        const tol = Math.max(2, item.h * LINE_Y_TOLERANCE_FACTOR);
        const cluster = clusters.length ? clusters[clusters.length - 1] : null;
        if (cluster && Math.abs(cluster.y - item.y) <= tol) {
            cluster.items.push(item);
        } else {
            clusters.push({ y: item.y, items: [item] });
        }
    }

    // 2. Split each baseline at gutter-sized x-gaps — two-column pages
    //    put BOTH columns' text on the same baseline, and merging them
    //    would interleave the columns line by line. (>= so a gap of
    //    exactly GUTTER_GAP_MIN — IEEE's 0.25in gutter is 18.0pt on
    //    the nose — still splits.)
    const lines = [];
    for (const cluster of clusters) {
        cluster.items.sort((a, b) => a.x - b.x);
        let segment = null;
        let prevIt = null;
        for (const it of cluster.items) {
            const gap = prevIt ? it.x - (prevIt.x + prevIt.w) : 0;
            const gutter = Math.max(GUTTER_GAP_MIN, it.h * GUTTER_GAP_FACTOR);
            if (!segment || gap >= gutter) {
                segment = { y: cluster.y, items: [it] };
                lines.push(segment);
            } else {
                segment.items.push(it);
            }
            prevIt = it;
        }
    }

    // 3. Text per line segment.
    for (const line of lines) finalizeLine(line);
    return lines.filter((l) => l.text !== '');
}

// ------------------------------------------------------------------
// Furniture (headers / footers / page numbers)
// ------------------------------------------------------------------

function furnitureSignature(text) {
    return text.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
}

function inMargin(line, page) {
    const top = page.height * (1 - MARGIN_BAND);
    const bottom = page.height * MARGIN_BAND;
    return line.y >= top || line.y <= bottom;
}

function markFurniture(pages, pageLines) {
    const counts = new Map();
    pageLines.forEach((lines, pi) => {
        const seen = new Set();
        for (const line of lines) {
            if (!inMargin(line, pages[pi])) continue;
            const sig = furnitureSignature(line.text);
            if (!sig || seen.has(sig)) continue;
            seen.add(sig);
            counts.set(sig, (counts.get(sig) || 0) + 1);
        }
    });
    const threshold = Math.max(FURNITURE_MIN_PAGES, Math.ceil(pages.length * 0.4));
    let dropped = 0;
    pageLines.forEach((lines, pi) => {
        for (const line of lines) {
            if (!inMargin(line, pages[pi])) continue;
            const repeating = (counts.get(furnitureSignature(line.text)) || 0) >= threshold;
            // A bare number is a page number only where page numbers are
            // possible: a multi-page document, and a value in page-number
            // range. A year dateline ("2024") or street number in the
            // margin of a 2-page letter is content, not furniture.
            // (Offset numbering — a report whose pages run 103–112 — is
            // caught by the repeating branch: digits are #-stripped in
            // the signature, so consecutive page numbers repeat.)
            const pageNumber = /^\d{1,4}$/.test(line.text)
                && pages.length >= FURNITURE_MIN_PAGES
                && Number(line.text) <= pages.length + PAGE_NUMBER_SLACK;
            if (repeating || pageNumber) { line.furniture = true; dropped += 1; }
        }
    });
    return dropped;
}

// ------------------------------------------------------------------
// Columns
// ------------------------------------------------------------------

function detectTwoCol(body, W) {
    const spanning = (l) => l.x0 < W * 0.45 && l.x1 > W * 0.60;
    const nonSpan = body.filter((l) => !spanning(l));
    const left = nonSpan.filter((l) => l.x0 < W * 0.45).length;
    const right = nonSpan.length - left;
    return nonSpan.length >= 6
        && left >= nonSpan.length * 0.3 && right >= nonSpan.length * 0.3;
}

/**
 * A structural gutter: an x-band in the middle of the page where a
 * gap of ≥ STRUCT_GUTTER_MIN pt recurs at a CONSISTENT position across
 * many baselines. Word gaps in justified text can be that wide, but
 * their positions vary line to line; a real column gutter does not.
 * Returns the gutter's x center, or null.
 */
function structuralGutterX(lines, W) {
    const buckets = new Map();
    let baselines = 0;
    for (const line of lines) {
        baselines += 1;
        let prev = null;
        for (const it of line.items || []) {
            if (prev) {
                const gapStart = prev.x + prev.w;
                const gap = it.x - gapStart;
                if (gap >= STRUCT_GUTTER_MIN && gapStart > W * 0.3 && it.x < W * 0.7) {
                    const key = Math.round(((gapStart + it.x) / 2) / STRUCT_BUCKET_PT);
                    buckets.set(key, (buckets.get(key) || 0) + 1);
                }
            }
            prev = it;
        }
    }
    if (baselines < 6) return null;
    let bestKey = null;
    let bestCount = 0;
    for (const [key, count] of buckets) {
        // Adjacent buckets merge so ragged column edges still line up.
        const c = count + (buckets.get(key - 1) || 0) + (buckets.get(key + 1) || 0);
        if (c > bestCount) { bestCount = c; bestKey = key; }
    }
    if (bestKey === null || bestCount < Math.max(4, baselines * STRUCT_GUTTER_SHARE)) return null;
    return bestKey * STRUCT_BUCKET_PT;
}

// Split a line at the structural gutter — but only when its items
// actually leave a gutter-sized gap there. A genuinely spanning line
// (title, abstract) has text ACROSS the band and stays whole, which
// is what makes it a band separator downstream.
function splitLineAtGutter(line, gx) {
    const items = line.items || [];
    if (items.length < 2) return [line];
    const leftItems = items.filter((it) => (it.x + (it.w || 0) / 2) < gx);
    const rightItems = items.filter((it) => (it.x + (it.w || 0) / 2) >= gx);
    if (!leftItems.length || !rightItems.length) return [line];
    const lastLeft = leftItems[leftItems.length - 1];
    const gap = rightItems[0].x - (lastLeft.x + (lastLeft.w || 0));
    if (gap < STRUCT_GUTTER_MIN) return [line];
    return [
        finalizeLine({ y: line.y, items: leftItems }),
        finalizeLine({ y: line.y, items: rightItems })
    ];
}

function orderPageLines(lines, page) {
    const W = page.width || 612;
    let body = lines.filter((l) => !l.furniture);

    // Narrow-gutter rescue: LaTeX's default \columnsep is 10pt and
    // IEEE's gutter 18pt — below or at the naive per-baseline split
    // threshold, so both columns' text survives as full-width lines
    // and would interleave sentence by sentence. If the page doesn't
    // already read as two columns, look for a structural gutter and
    // re-split the straddling lines at it.
    if (!detectTwoCol(body, W)) {
        const textBody = body.filter((l) => !l.figure);
        const gx = structuralGutterX(textBody, W);
        if (gx !== null) {
            body = body.flatMap((l) => (l.figure ? [l] : splitLineAtGutter(l, gx)));
        }
    }
    if (!detectTwoCol(body, W)) return body;   // one column: already in y-order

    const spanning = (l) => l.x0 < W * 0.45 && l.x1 > W * 0.60;
    const side = (l) => (l.x0 < W * 0.45 ? 'left' : 'right');

    // Bands: spanning lines cut the page; inside a band, read the left
    // column top-to-bottom, then the right.
    const out = [];
    let band = [];
    const flush = () => {
        if (!band.length) return;
        out.push(...band.filter((l) => side(l) === 'left'));
        out.push(...band.filter((l) => side(l) === 'right'));
        band = [];
    };
    for (const line of body) {
        if (spanning(line)) { flush(); out.push(line); }
        else band.push(line);
    }
    flush();
    return out;
}

// ------------------------------------------------------------------
// Paragraphs + headings
// ------------------------------------------------------------------

function median(values) {
    if (!values.length) return 0;
    const s = [...values].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
}

function paragraphsOfPage(orderedLines, bodySize) {
    const gaps = [];
    for (let i = 1; i < orderedLines.length; i++) {
        const g = orderedLines[i - 1].y - orderedLines[i].y;
        if (g > 0) gaps.push(g);
    }
    const medGap = median(gaps) || 14;

    const paras = [];
    let current = null;
    let prev = null;
    for (const line of orderedLines) {
        // Figures (C4.2) are always their own block — never merged or
        // hyphen-joined into a text paragraph.
        if (line.figure) {
            paras.push({ heading: 0, figure: true, text: line.text, yTop: line.y });
            current = null;
            prev = line;
            continue;
        }
        const heading = headingLevel(line, bodySize);
        const gap = prev ? prev.y - line.y : 0;
        const newBlock = !current
            || heading > 0
            || (current.heading > 0)
            || gap <= 0                                   // column/band jump
            || gap > medGap * PARA_GAP_FACTOR;
        if (newBlock) {
            current = { heading, text: line.text, yTop: line.y };
            paras.push(current);
        } else if (/[\p{L}\d]-$/u.test(current.text) && /^[\p{Ll}\d]/u.test(line.text)) {
            // Reflow a line-break hyphenation — but keep the hyphen when
            // it is (probably) lexical: the broken word already carries
            // another hyphen ("state-of-the-" + "art" → "state-of-the-
            // art"), or both sides are digits ("1914-" + "1918"). A bare
            // soft break drops it: "convo-" + "luted" → "convoluted".
            const lastWord = current.text.slice(0, -1).split(/\s+/).pop() || '';
            const digitJoin = /\d-$/.test(current.text) && /^\d/.test(line.text);
            if (digitJoin || lastWord.includes('-')) {
                current.text += line.text;
            } else {
                current.text = current.text.slice(0, -1) + line.text;
            }
        } else {
            current.text += ' ' + line.text;
        }
        prev = line;
    }
    return paras;
}

// ------------------------------------------------------------------
// Figures (C4.2) — pseudo-lines in the reading order
// ------------------------------------------------------------------

const CAPTION_RE = /^(fig(ure)?\.?|table|chart|exhibit)\b/i;
const CAPTION_BELOW_PT = 60;   // caption search window below the figure
const ALT_MAX = 140;

/**
 * A page's figures (from pdf-capture: {ref, x, y, w, h}) as pseudo-
 * lines that flow through the SAME ordering machinery as text: a
 * column figure sorts into its column's band by its top edge, and a
 * full-width figure acts as a band separator — exactly like a
 * spanning title. (The previous merge assumed paragraphs stayed
 * y-descending, which two-column reordering breaks: a right-column
 * figure landed before all left-column text.)
 */
function figureLines(page, lines, pageNo) {
    return (page && Array.isArray(page.figures) ? page.figures : [])
        .filter((f) => f && f.ref)
        .map((f) => ({
            figure: true,
            text: `![${figureAlt(f, lines, pageNo)}](${f.ref})`,
            y: f.y + f.h,               // top edge — sorts above lower text
            x0: f.x,
            x1: f.x + f.w,
            h: 0
        }));
}

function figureAlt(fig, lines, pageNo) {
    let best = null;
    for (const line of lines || []) {
        if (line.furniture || line.figure || !CAPTION_RE.test(line.text)) continue;
        const below = fig.y - line.y;                  // PDF y-up: caption sits below
        if (below < 0 || below > CAPTION_BELOW_PT) continue;
        if (!best || below < best.below) best = { below, text: line.text };
    }
    const raw = best ? best.text : `Figure (page ${pageNo})`;
    // Alt text lives inside ![…] and is later interpolated into an
    // alt="…" attribute by markdownToHtml (which doesn't escape quotes).
    // Keep it bracket-, newline-, and double-quote-free so neither the
    // markdown nor the HTML attribute can be broken by a caption.
    const clean = raw
        .replace(/"/g, "'")
        .replace(/[[\]\n]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return clean.length > ALT_MAX ? clean.slice(0, ALT_MAX - 1) + '…' : clean;
}

function headingLevel(line, bodySize) {
    if (!bodySize) return 0;
    const words = line.text.split(/\s+/).length;
    if (words > HEADING_MAX_WORDS) return 0;
    if (line.h >= bodySize * HEAD_H1_FACTOR) return 1;
    if (line.h >= bodySize * HEAD_H2_FACTOR) return 2;
    return 0;
}

// ------------------------------------------------------------------
// Entry point
// ------------------------------------------------------------------

/**
 * Reconstruct markdown + page map from positioned text runs.
 *
 * @param {Array<{width:number,height:number,items:Array}>} pages
 * @returns {{markdown: string, pageMap: Array<{page:number,start:number,end:number}>,
 *            stats: {chars:number, furnitureDropped:number}}}
 */
export function buildDocumentFromPages(pages) {
    const list = Array.isArray(pages) ? pages : [];
    const pageLines = list.map((p) => linesOfPage(p));
    const furnitureDropped = markFurniture(list, pageLines);

    // Body font size across the document (median run height of
    // non-furniture lines) — the headings baseline.
    const sizes = [];
    for (const lines of pageLines) {
        for (const l of lines) if (!l.furniture) sizes.push(l.h);
    }
    const bodySize = median(sizes);

    let markdown = '';
    const pageMap = [];
    const pageStats = [];
    list.forEach((page, pi) => {
        const figs = figureLines(page, pageLines[pi], pi + 1);
        const combined = figs.length
            ? [...pageLines[pi], ...figs].sort((a, b) => b.y - a.y || (a.x0 || 0) - (b.x0 || 0))
            : pageLines[pi];
        const ordered = orderPageLines(combined, page);
        const paras = paragraphsOfPage(ordered, bodySize);
        let start = markdown.length;      // empty pages span zero chars
        let emitted = false;
        for (const block of paras) {
            const text = block.text.trim();
            if (!text) continue;
            const prefix = block.heading === 1 ? '# ' : block.heading === 2 ? '## ' : '';
            if (markdown) markdown += '\n\n';
            if (!emitted) { start = markdown.length; emitted = true; }
            markdown += prefix + text;
        }
        pageMap.push({ page: pi + 1, start: emitted ? start : markdown.length, end: markdown.length });
        pageStats.push({
            page: pi + 1,
            chars: ordered.reduce((s, l) => s + (l.figure ? 0 : l.text.length), 0),
            lines: ordered.filter((l) => !l.figure).length,
            paras: paras.length,
            figures: (page && Array.isArray(page.figures)) ? page.figures.length : 0
        });
    });

    return {
        markdown, pageMap,
        warnings: extractionWarnings(pageStats),
        stats: { chars: markdown.length, furnitureDropped }
    };
}

/**
 * Extraction-quality warnings (C4.1) — the honesty layer over "degrade,
 * never drop". Each warning: { code, pages: number[], message }.
 *
 *   sparse-pages   pages with (near-)no text layer AND no captured
 *                  figure, in a document that provably HAS a text layer
 *                  elsewhere (≥1 texty page) — likely scanned/image
 *                  pages whose content is MISSING from the capture. A
 *                  page whose only content is an image we archived
 *                  (C4.2) is captured, so it is not flagged. All-scan
 *                  documents are not flagged here: the scan-refusal
 *                  path owns those.
 *   shredded-text  many lines with a tiny mean length — text runs
 *                  didn't join into normal lines (glyph-per-run PDFs,
 *                  forms, aggressive gutter splits); reconstruction is
 *                  unreliable. (Poetry/lyrics trip this legitimately —
 *                  it is a verify-me flag, not a verdict.)
 */
export function extractionWarnings(pageStats) {
    const warnings = [];
    const list = Array.isArray(pageStats) ? pageStats : [];
    if (list.length === 0) return warnings;

    const hasTextyPage = list.some((p) => p.chars >= SPARSE_TEXTY_PAGE);
    if (hasTextyPage) {
        // A page with (near-)no text layer is only "missing content" if it
        // also has no captured figure (C4.2). An image-only page whose
        // image we archived is captured — just not as text — so don't
        // flag it as missing.
        const sparse = list
            .filter((p) => p.chars < SPARSE_PAGE_CHARS && !(p.figures > 0))
            .map((p) => p.page);
        if (sparse.length) {
            warnings.push({
                code: 'sparse-pages',
                pages: sparse,
                message: `Page${sparse.length > 1 ? 's' : ''} ${formatPageList(sparse)} `
                    + `${sparse.length > 1 ? 'have' : 'has'} little or no text layer (possibly scanned `
                    + 'images) — that content is missing from this capture.'
            });
        }
    }

    const shredded = list
        .filter((p) => p.lines >= SHRED_MIN_LINES && (p.chars / p.lines) < SHRED_MEAN_CHARS)
        .map((p) => p.page);
    if (shredded.length) {
        warnings.push({
            code: 'shredded-text',
            pages: shredded,
            message: `Text extracted as short fragments on page${shredded.length > 1 ? 's' : ''} `
                + `${formatPageList(shredded)} — line/paragraph reconstruction may be unreliable; `
                + 'verify quotes against the archived original.'
        });
    }
    return warnings;
}

/** Compact page-list formatting: [1,2,3,7] → "1–3, 7". */
function formatPageList(pages) {
    const out = [];
    let start = null;
    let prev = null;
    for (const p of pages) {
        if (start === null) { start = prev = p; continue; }
        if (p === prev + 1) { prev = p; continue; }
        out.push(start === prev ? `${start}` : `${start}–${prev}`);
        start = prev = p;
    }
    if (start !== null) out.push(start === prev ? `${start}` : `${start}–${prev}`);
    return out.join(', ');
}

/**
 * 1-based page containing markdown offset `offset`, or null. Pages
 * that emitted no text own no offsets — a blank scan cover must not
 * claim the first character of the document.
 */
export function pageOfOffset(pageMap, offset) {
    if (!Array.isArray(pageMap) || !Number.isFinite(offset) || offset < 0) return null;
    for (const entry of pageMap) {
        if (entry.end <= entry.start) continue;   // textless page
        if (offset >= entry.start && offset < entry.end) return entry.page;
    }
    return null;
}

/**
 * W3C FragmentSelector for a PDF page (RFC 3778 fragment scheme) —
 * appended to claim anchors captured from PDFs. Resolvers that don't
 * know the type skip it (the Phase 14.5 pattern).
 */
export function pageFragmentSelector(page) {
    return {
        type: 'FragmentSelector',
        conformsTo: 'http://tools.ietf.org/rfc/rfc3778',
        value: `page=${page}`
    };
}

/**
 * Scan detector: characters of text layer per page, averaged. A
 * near-zero density means the PDF is images (no text layer) — the
 * deterministic path can't capture it.
 */
export function textDensity(pages) {
    const list = Array.isArray(pages) ? pages : [];
    if (!list.length) return 0;
    let chars = 0;
    for (const p of list) {
        for (const i of (p.items || [])) chars += String(i.str || '').trim().length;
    }
    return chars / list.length;
}
