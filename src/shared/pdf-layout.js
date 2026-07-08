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
const SUPERSUB_SIZE_RATIO     = 0.8;   // size mismatch that marks a sub/superscript
const SUPERSUB_OVERLAP        = 0.4;   // × smaller height, min vertical band overlap
const WORD_GAP_FACTOR         = 0.18;  // × run height, space insertion
const GUTTER_GAP_FACTOR       = 1.5;   // × run height, min column-gutter split
const GUTTER_GAP_MIN          = 18;    // pt — never split below this gap
const STRUCT_GUTTER_MIN       = 6;     // pt — a CONSISTENT gap this wide is a gutter
const STRUCT_GUTTER_SHARE     = 0.35;  // fraction of baselines that must show it
const STRUCT_BUCKET_PT        = 4;     // gutter-center bucketing granularity
const MARGIN_BAND             = 0.08;  // top/bottom fraction for furniture
const FURNITURE_MIN_PAGES     = 3;
const FURNITURE_Y_BAND        = 6;     // pt — repeats must sit at a consistent y
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
            // Scale the space threshold by the SMALLER of the adjacent
            // runs: sizing it off the right run alone swallowed a real
            // word gap in front of a taller run (inline size changes).
            const ref = Math.min(prev.h || 10, it.h || 10);
            if (gap > Math.max(1, ref * WORD_GAP_FACTOR) && !text.endsWith(' ')) text += ' ';
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

    // 1. Cluster runs by baseline. The plain tolerance (scaled by the
    //    RUN's own height) catches same-size runs; sub/superscripts sit
    //    a few points off the baseline with a much smaller height, so
    //    their tolerance missed and the "2" of H2O / mc2 became its own
    //    line (reordering the quote text). They are recognized by the
    //    size MISMATCH plus vertical band overlap — two stacked
    //    same-size lines under tight leading overlap slightly but never
    //    mismatch, so they still split.
    const clusters = [];
    for (const item of items) {
        const cluster = clusters.length ? clusters[clusters.length - 1] : null;
        let merge = false;
        if (cluster) {
            const tol = Math.max(2, item.h * LINE_Y_TOLERANCE_FACTOR);
            if (Math.abs(cluster.y - item.y) <= tol) {
                merge = true;
            } else {
                const small = Math.min(item.h, cluster.hMax);
                const large = Math.max(item.h, cluster.hMax);
                const overlap = Math.min(cluster.bandHi, item.y + item.h)
                    - Math.max(cluster.bandLo, item.y);
                merge = small < large * SUPERSUB_SIZE_RATIO
                    && overlap >= small * SUPERSUB_OVERLAP;
            }
        }
        if (merge) {
            cluster.items.push(item);
            cluster.bandLo = Math.min(cluster.bandLo, item.y);
            cluster.bandHi = Math.max(cluster.bandHi, item.y + item.h);
            // Anchor the cluster's baseline on its dominant (tallest)
            // run — a superscript that arrives first must not become
            // the whole line's baseline.
            if (item.h > cluster.hMax) { cluster.hMax = item.h; cluster.y = item.y; }
        } else {
            clusters.push({
                y: item.y, hMax: item.h,
                bandLo: item.y, bandHi: item.y + item.h,
                items: [item]
            });
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

// Signature key scoped to the margin side, so a running head and a
// same-text footer are tracked (and y-checked) independently.
function marginKey(line, page) {
    const side = line.y >= page.height * (1 - MARGIN_BAND) ? 'top' : 'bottom';
    return side + '|' + furnitureSignature(line.text);
}

function markFurniture(pages, pageLines) {
    const counts = new Map();   // side|sig → { n, yMin, yMax }
    pageLines.forEach((lines, pi) => {
        const seen = new Set();
        for (const line of lines) {
            if (!inMargin(line, pages[pi])) continue;
            const key = marginKey(line, pages[pi]);
            if (key.endsWith('|') || seen.has(key)) continue;
            seen.add(key);
            let entry = counts.get(key);
            if (!entry) { entry = { n: 0, yMin: line.y, yMax: line.y }; counts.set(key, entry); }
            entry.n += 1;
            entry.yMin = Math.min(entry.yMin, line.y);
            entry.yMax = Math.max(entry.yMax, line.y);
        }
    });
    const threshold = Math.max(FURNITURE_MIN_PAGES, Math.ceil(pages.length * 0.4));
    let dropped = 0;
    pageLines.forEach((lines, pi) => {
        for (const line of lines) {
            if (!inMargin(line, pages[pi])) continue;
            // Real headers/footers repeat at a FIXED position; margin
            // content that merely repeats modulo digits (a brief's
            // "N Ibid., at M." footnote line) wanders with the stack
            // height — the y-band check keeps it as content.
            const entry = counts.get(marginKey(line, pages[pi]));
            const repeating = !!entry && entry.n >= threshold
                && (entry.yMax - entry.yMin) <= FURNITURE_Y_BAND;
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

// Baseline → number of line-segments at that y (a table row's cells,
// split apart at their inter-column gaps by linesOfPage). Figures are
// not cells.
function baselineSegmentCounts(body) {
    const byY = new Map();
    for (const l of body) {
        if (l.figure) continue;
        const key = Math.round(l.y / 3);
        byY.set(key, (byY.get(key) || 0) + 1);
    }
    return byY;
}

// Does the page contain an aligned GRID (a table)? Signalled by a
// baseline carrying 3+ segments — two-column PROSE is exactly two
// columns and never reaches three, so this can't be confused with it.
// A table otherwise gets column-band read, which reads every label
// top-to-bottom and then the value columns as a diagonal, destroying
// the row↔value links a reader needs to quote a cell. Fires when the
// page is grid-dominant OR carries a contiguous run of ≥4 grid rows (an
// embedded table on an otherwise prose page — the mean-length dilution
// the extraction warning would also miss).
function hasGrid(body) {
    const byY = baselineSegmentCounts(body);
    if (byY.size < 3) return false;
    const keys = [...byY.keys()].sort((a, b) => b - a);   // top to bottom
    const gridRows = keys.filter((k) => byY.get(k) >= 3).length;
    if (gridRows >= byY.size * 0.5) return true;
    let run = 0;
    for (const k of keys) {
        run = byY.get(k) >= 3 ? run + 1 : 0;
        if (run >= 4) return true;
    }
    return false;
}

// Collapse a grid page's multi-cell baselines back into rows: order
// each row's cells left-to-right and join them (middle dot, so column
// boundaries survive into the markdown and a quote of one cell still
// grounds). Single-segment baselines are prose around the table and
// pass through untouched. Each row is its own block (row: true).
function mergeGridRows(body) {
    const groups = new Map();
    const singles = [];
    for (const l of body) {
        if (l.figure) { singles.push(l); continue; }
        const key = Math.round(l.y / 3);
        let g = groups.get(key);
        if (!g) { g = { y: l.y, cells: [] }; groups.set(key, g); }
        g.cells.push(l);
    }
    const out = [...singles];
    for (const g of groups.values()) {
        if (g.cells.length >= 2) {
            g.cells.sort((a, b) => (a.x0 || 0) - (b.x0 || 0));
            out.push({
                row: true,
                y: g.y,
                x0: g.cells[0].x0,
                x1: g.cells[g.cells.length - 1].x1,
                h: Math.max(...g.cells.map((c) => c.h || 10)),
                text: g.cells.map((c) => c.text).filter(Boolean).join(' · ')
            });
        } else {
            out.push(g.cells[0]);   // prose line — unchanged
        }
    }
    return out.sort((a, b) => b.y - a.y);
}

function orderPageLines(lines, page) {
    const W = page.width || 612;
    let body = lines.filter((l) => !l.furniture);

    // Aligned grid (table): read it row-by-row before the two-column
    // logic can column-band it into a scrambled diagonal. Checked FIRST
    // — on a mixed prose+table page detectTwoCol itself misfires (a
    // value column reads as a right column), so gating on it would let
    // the table scramble. Genuine two-column PROSE never reaches three
    // segments on a baseline, so hasGrid can't confuse the two.
    if (hasGrid(body)) return mergeGridRows(body);

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
            const split = body.flatMap((l) => (l.figure ? [l] : splitLineAtGutter(l, gx)));
            // Adopt the split ONLY if the halves then classify as two
            // columns. An off-center gutter the column classifier can't
            // resolve (sidebars near 0.3–0.45W) otherwise left the page
            // as shredded half-lines in y-order — strictly worse than
            // the interleave it started with.
            if (detectTwoCol(split, W)) body = split;
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
        // Grid rows (a reconstructed table row) are their own block too —
        // merging consecutive rows would re-scramble the table.
        if (line.row) {
            paras.push({ heading: 0, row: true, text: line.text, yTop: line.y });
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
        } else if (/[\p{L}\d]-$/u.test(current.text) && /^[\p{Ll}\p{Lu}\d]/u.test(line.text)) {
            // Reflow a line-break hyphenation — but keep the hyphen when
            // it is (probably) lexical. Hyphenation only ever breaks a
            // word between LETTERS (syllables), so a digit on either
            // side is a compound or range ("COVID-" + "19", "3-" +
            // "year", "1914-" + "1918"); an uppercase continuation is a
            // name compound ("Navier-" + "Stokes" — previously space-
            // joined into "Navier- Stokes"); and a word already carrying
            // another hyphen keeps its last one ("state-of-the-" +
            // "art"). Only the bare lowercase letter-letter soft break
            // drops it: "convo-" + "luted" → "convoluted".
            const lastWord = current.text.slice(0, -1).split(/\s+/).pop() || '';
            const digitTouch = /\d-$/.test(current.text) || /^\d/.test(line.text);
            const upperCont = /^\p{Lu}/u.test(line.text);
            if (digitTouch || upperCont || lastWord.includes('-')) {
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
    // markdown nor the HTML attribute can be broken by a caption — and
    // free of inline-markdown metacharacters (` * _): markdownToHtml's
    // code/emphasis passes run over the whole document, so a stray
    // backtick in a caption could open a code span that swallows the
    // image markup entirely.
    const clean = raw
        .replace(/"/g, "'")
        .replace(/[[\]\n`*_]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return clean.length > ALT_MAX ? clean.slice(0, ALT_MAX - 1) + '…' : clean;
}

// The size that formats MOST of a line's text (char-weighted median of
// its runs' heights). line.h is the MAX run height, which let a single
// oversized glyph — a dropcap, an inline symbol — promote an ordinary
// body line to a heading.
function dominantSize(line) {
    const items = line.items || [];
    if (!items.length) return line.h || 0;
    const sorted = [...items].sort((a, b) => (a.h || 0) - (b.h || 0));
    const total = sorted.reduce((s, i) => s + i.str.length, 0);
    let acc = 0;
    for (const it of sorted) {
        acc += it.str.length;
        if (acc * 2 >= total) return it.h || 0;
    }
    return line.h || 0;
}

function headingLevel(line, bodySize) {
    if (!bodySize) return 0;
    const words = line.text.split(/\s+/).length;
    if (words > HEADING_MAX_WORDS) return 0;
    const size = dominantSize(line);
    if (size >= bodySize * HEAD_H1_FACTOR) return 1;
    if (size >= bodySize * HEAD_H2_FACTOR) return 2;
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
            // Pre-furniture count: a page whose only text is a running
            // header still HAS a working text layer — the sparse-pages
            // warning must not call its content "missing".
            rawChars: pageLines[pi].reduce((s, l) => s + l.text.length, 0),
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
            .filter((p) => (p.rawChars ?? p.chars) < SPARSE_PAGE_CHARS && !(p.figures > 0))
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
