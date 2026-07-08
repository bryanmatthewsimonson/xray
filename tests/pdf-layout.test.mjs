// PDF layout-reconstruction tests — Phase 18 C4
// (docs/COMPLEX_CONTENT_DESIGN.md §5.3).
//
// Pure module over synthetic positioned runs — no pdf.js in tests.
// Fixtures mimic pdf.js getTextContent geometry: PDF user space,
// origin bottom-left, y = baseline, h = font size.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    buildDocumentFromPages, pageOfOffset, pageFragmentSelector, textDensity
} from '../src/shared/pdf-layout.js';
import { pdfDocumentUrl, looksLikePdfUrl } from '../src/shared/pdf-detect.js';
import { ContentExtractor } from '../src/shared/content-extractor.js';

const W = 612;
const H = 792;

// A run; width approximated from text length.
function run(str, x, y, h = 10) {
    return { str, x, y, w: str.length * h * 0.5, h };
}

function page(items) {
    return { width: W, height: H, items };
}

// ------------------------------------------------------------------
// Lines + paragraphs
// ------------------------------------------------------------------

test('single column: lines merge into paragraphs, big gaps split them', () => {
    const p = page([
        run('First paragraph line one', 72, 700),
        run('continues on line two.', 72, 686),
        // gap of 3 line-heights → new paragraph
        run('Second paragraph starts here', 72, 640),
        run('and also continues.', 72, 626)
    ]);
    const { markdown } = buildDocumentFromPages([p]);
    const paras = markdown.split('\n\n');
    assert.equal(paras.length, 2);
    assert.equal(paras[0], 'First paragraph line one continues on line two.');
    assert.equal(paras[1], 'Second paragraph starts here and also continues.');
});

test('split runs on one baseline join with sensible spacing', () => {
    const p = page([
        // Two runs, tiny gap (same word continues): no space inserted.
        { str: 'convo', x: 72, y: 700, w: 30, h: 10 },
        { str: 'cation', x: 102.5, y: 700, w: 30, h: 10 },
        // Real word gap (well under the column-gutter threshold): space.
        { str: 'next', x: 138, y: 700, w: 20, h: 10 }
    ]);
    const { markdown } = buildDocumentFromPages([p]);
    assert.equal(markdown, 'convocation next');
});

test('line-break hyphenation reflows', () => {
    const p = page([
        run('This word is convo-', 72, 700),
        run('luted but reflows.', 72, 686)
    ]);
    const { markdown } = buildDocumentFromPages([p]);
    assert.ok(markdown.includes('convoluted but reflows.'));
});

// ------------------------------------------------------------------
// Two-column reading order
// ------------------------------------------------------------------

test('two columns read left column first, then right', () => {
    const leftX = 72;
    const rightX = 330;
    const items = [];
    for (let i = 0; i < 6; i++) items.push(run(`L${i} left column text here`, leftX, 700 - i * 14));
    for (let i = 0; i < 6; i++) items.push(run(`R${i} right column text here`, rightX, 700 - i * 14));
    const { markdown } = buildDocumentFromPages([page(items)]);
    const l5 = markdown.indexOf('L5');
    const r0 = markdown.indexOf('R0');
    assert.ok(l5 >= 0 && r0 >= 0);
    assert.ok(l5 < r0, 'all left-column text precedes right-column text');
});

test('a spanning line (title) stays before both columns', () => {
    const items = [
        // Wide title across both columns, larger font.
        { str: 'A Grand Unified Title', x: 100, y: 750, w: 400, h: 18 }
    ];
    for (let i = 0; i < 5; i++) items.push(run(`L${i} body text in left col`, 72, 700 - i * 14));
    for (let i = 0; i < 5; i++) items.push(run(`R${i} body text in right col`, 330, 700 - i * 14));
    const { markdown } = buildDocumentFromPages([page(items)]);
    assert.ok(markdown.indexOf('A Grand Unified Title') < markdown.indexOf('L0'));
    assert.ok(markdown.indexOf('L4') < markdown.indexOf('R0'));
    assert.match(markdown, /^# A Grand Unified Title/, 'oversized short line becomes a heading');
});

// ------------------------------------------------------------------
// Furniture
// ------------------------------------------------------------------

test('repeating headers/footers and page numbers drop', () => {
    const mk = (n) => page([
        run('The Journal of Examples', 72, 780),          // header (top margin)
        run(`Body text of page ${n} with words`, 72, 500),
        run(String(n), 300, 20)                            // bare page number
    ]);
    const { markdown, stats } = buildDocumentFromPages([mk(1), mk(2), mk(3), mk(4)]);
    assert.ok(!markdown.includes('The Journal of Examples'), 'repeating header dropped');
    assert.ok(markdown.includes('Body text of page 2'), 'body survives');
    assert.ok(!/^\d$/m.test(markdown), 'bare page numbers dropped');
    assert.ok(stats.furnitureDropped >= 8);
});

// ------------------------------------------------------------------
// Page map
// ------------------------------------------------------------------

test('pageMap offsets index the markdown; pageOfOffset resolves', () => {
    const pages = [
        page([run('Alpha page one text', 72, 700)]),
        page([run('Beta page two text', 72, 700)])
    ];
    const { markdown, pageMap } = buildDocumentFromPages(pages);
    assert.equal(pageMap.length, 2);
    const beta = markdown.indexOf('Beta');
    assert.equal(pageOfOffset(pageMap, 0), 1);
    assert.equal(pageOfOffset(pageMap, beta), 2);
    assert.equal(pageOfOffset(pageMap, -1), null);
    assert.equal(pageOfOffset(null, 5), null);
    assert.equal(markdown.slice(pageMap[1].start, pageMap[1].end), 'Beta page two text');
});

test('pageFragmentSelector shape', () => {
    assert.deepEqual(pageFragmentSelector(7), {
        type: 'FragmentSelector',
        conformsTo: 'http://tools.ietf.org/rfc/rfc3778',
        value: 'page=7'
    });
});

// ------------------------------------------------------------------
// Degenerate inputs + scan detection
// ------------------------------------------------------------------

test('empty/degenerate pages neither crash nor emit junk', () => {
    const { markdown, pageMap } = buildDocumentFromPages([page([]), page([run('x y z words', 72, 700)])]);
    assert.ok(markdown.includes('x y z words'));
    assert.equal(pageMap.length, 2);
    assert.equal(pageMap[0].start, pageMap[0].end, 'empty page spans zero chars');
    assert.deepEqual(buildDocumentFromPages([]).pageMap, []);
    assert.equal(buildDocumentFromPages(null).markdown, '');
});

test('textDensity: scans read near zero, text PDFs do not', () => {
    assert.equal(textDensity([page([]), page([])]), 0);
    assert.ok(textDensity([page([run('plenty of extractable text here', 72, 700)])]) > 8);
});

// ------------------------------------------------------------------
// PDF tab detection (C3)
// ------------------------------------------------------------------

test('pdfDocumentUrl: direct, wrapper, and non-PDF shapes', () => {
    assert.equal(pdfDocumentUrl('https://x.test/paper.pdf'), 'https://x.test/paper.pdf');
    // Query survives (it can name the document); the fragment is a
    // viewer instruction and is dropped — see the fragment test below.
    assert.equal(pdfDocumentUrl('https://x.test/paper.PDF?dl=1#page=2'), 'https://x.test/paper.PDF?dl=1');
    assert.equal(
        pdfDocumentUrl('chrome-extension://abc/viewer.html?file=' + encodeURIComponent('https://x.test/a.pdf')),
        'https://x.test/a.pdf');
    assert.equal(pdfDocumentUrl('https://x.test/article.html'), null);
    assert.equal(pdfDocumentUrl('file:///home/me/a.pdf'), null, 'non-http(s) not fetchable');
    assert.equal(
        pdfDocumentUrl('https://viewer.test/v?file=' + encodeURIComponent('file:///etc/passwd.pdf')),
        null, 'wrapper pointing at file: refused');
    assert.equal(pdfDocumentUrl('not a url'), null);
    assert.equal(looksLikePdfUrl('https://x.test/a.pdf?x=1'), true);
    assert.equal(looksLikePdfUrl('https://x.test/a.pdfx'), false);
});

// ------------------------------------------------------------------
// Extraction-quality warnings (C4.1)
// ------------------------------------------------------------------

test('warnings: a clean document produces none', () => {
    const pages = [1, 2, 3].map((n) => page([
        run(`Page ${n} has a healthy paragraph with plenty of words in it`, 72, 700),
        run('and a second line that merges into the same paragraph nicely', 72, 686),
        run('plus a third line to keep the density realistic here', 72, 672)
    ]));
    const { warnings } = buildDocumentFromPages(pages);
    assert.deepEqual(warnings, []);
});

test('warnings: sparse pages inside a texty document are flagged with page ranges', () => {
    const texty = (n) => page([run(
        'A substantial page with a long paragraph of body text that easily clears the sparse threshold because it has many characters. '.repeat(3),
        72, 700
    )]);
    const blank = page([]);
    const { warnings } = buildDocumentFromPages([texty(1), blank, blank, texty(4), blank]);
    const sparse = warnings.find((w) => w.code === 'sparse-pages');
    assert.ok(sparse, 'sparse-pages warning present');
    assert.deepEqual(sparse.pages, [2, 3, 5]);
    assert.match(sparse.message, /2–3, 5/);
    assert.match(sparse.message, /missing/i);
});

test('warnings: an all-scan document is NOT flagged sparse (the scan refusal path owns it)', () => {
    const { warnings } = buildDocumentFromPages([page([]), page([]), page([])]);
    assert.equal(warnings.find((w) => w.code === 'sparse-pages'), undefined);
});

test('warnings: shredded text (many tiny lines) is flagged', () => {
    // 24 lines of ~7 chars each: runs never joined into normal lines.
    const items = [];
    for (let i = 0; i < 24; i++) {
        items.push(run(`Frag ${i}`, 72, 700 - i * 14));
    }
    const { warnings } = buildDocumentFromPages([page(items)]);
    const shred = warnings.find((w) => w.code === 'shredded-text');
    assert.ok(shred, 'shredded-text warning present');
    assert.deepEqual(shred.pages, [1]);
    assert.match(shred.message, /verify quotes/i);
    // A normal texty page does not trip it.
    const clean = buildDocumentFromPages([page(
        Array.from({ length: 24 }, (_, i) =>
            run(`A perfectly ordinary body-text line number ${i} with plenty of characters in it`, 72, 700 - i * 14))
    )]);
    assert.equal(clean.warnings.find((w) => w.code === 'shredded-text'), undefined);
});

// ------------------------------------------------------------------
// Figures (C4.2) — placement + captions
// ------------------------------------------------------------------

test('figures: placed between paragraphs by vertical position', () => {
    const p = page([
        run('Paragraph above the figure with words', 72, 700),
        run('that continues on a second line', 72, 686),
        run('Paragraph below the figure with words', 72, 400),
        run('that also continues on a second line', 72, 386)
    ]);
    p.figures = [{ ref: 'xray-figure:' + 'a'.repeat(64), x: 72, y: 480, w: 300, h: 150 }];
    const { markdown } = buildDocumentFromPages([p]);
    const above = markdown.indexOf('above the figure');
    const img = markdown.indexOf('![Figure (page 1)](xray-figure:');
    const below = markdown.indexOf('below the figure');
    assert.ok(above >= 0 && img >= 0 && below >= 0);
    assert.ok(above < img && img < below, 'figure sits between the paragraphs');
});

test('figures: nearest caption line below becomes the alt text', () => {
    const p = page([
        run('Body paragraph with plenty of words here', 72, 700),
        run('Figure 2: Bayes factors by evidence tier', 72, 430)   // just below the figure
    ]);
    p.figures = [{ ref: 'xray-figure:' + 'b'.repeat(64), x: 72, y: 460, w: 300, h: 180 }];
    const { markdown } = buildDocumentFromPages([p]);
    assert.ok(markdown.includes('![Figure 2: Bayes factors by evidence tier](xray-figure:'));
});

test('figures: image-only page still emits, and pageMap covers it', () => {
    const p1 = page([run('Text page one with several words', 72, 700)]);
    const p2 = page([]);
    p2.figures = [{ ref: 'xray-figure:' + 'c'.repeat(64), x: 72, y: 300, w: 400, h: 300 }];
    const { markdown, pageMap } = buildDocumentFromPages([p1, p2]);
    const img = markdown.indexOf('![Figure (page 2)]');
    assert.ok(img >= 0);
    assert.ok(img >= pageMap[1].start && img < pageMap[1].end, 'figure offsets belong to page 2');
});

test('figures: an image-only page is NOT flagged sparse (its image was captured)', () => {
    const texty = page([run(
        'A substantial page with a long paragraph of body text that easily clears the sparse threshold because it has many characters. '.repeat(3),
        72, 700
    )]);
    const imageOnly = page([]);          // no text layer…
    imageOnly.figures = [{ ref: 'xray-figure:' + 'e'.repeat(64), x: 72, y: 300, w: 400, h: 300 }];  // …but a captured figure
    const blank = page([]);              // truly empty — still flagged
    const { warnings } = buildDocumentFromPages([texty, imageOnly, blank]);
    const sparse = warnings.find((w) => w.code === 'sparse-pages');
    assert.ok(sparse, 'sparse-pages warning present for the genuinely empty page');
    assert.deepEqual(sparse.pages, [3], 'page 2 (image-only) is excused; page 3 (blank) is flagged');
});

test('figures: alt text is bracket-safe and capped', () => {
    const p = page([
        run('Figure 1: ' + 'x[]'.repeat(80), 72, 430)
    ]);
    p.figures = [{ ref: 'xray-figure:' + 'd'.repeat(64), x: 72, y: 460, w: 300, h: 180 }];
    const { markdown } = buildDocumentFromPages([p]);
    const alt = /!\[([^\]]*)\]/.exec(markdown);
    assert.ok(alt, 'image emitted');
    assert.ok(!alt[1].includes('['), 'no brackets in alt');
    assert.ok(alt[1].length <= 140);
});

test('figures: a caption with double quotes cannot break the alt attribute', () => {
    const p = page([
        run('Body paragraph with plenty of words to anchor', 72, 700),
        run('Figure 3: The "smoking gun" chart of case counts', 72, 430)
    ]);
    p.figures = [{ ref: 'xray-figure:' + 'f'.repeat(64), x: 72, y: 460, w: 300, h: 180 }];
    const { markdown } = buildDocumentFromPages([p]);
    const alt = /!\[([^\]]*)\]/.exec(markdown);
    assert.ok(alt, 'image emitted');
    assert.ok(!alt[1].includes('"'), 'no double quotes survive into the alt');
    assert.match(alt[1], /smoking gun/, 'caption text otherwise preserved');
    // …and the rendered HTML attribute stays well-formed.
    const html = ContentExtractor.markdownToHtml(markdown);
    const img = /<img src="xray-figure:f+" alt="([^"]*)">/.exec(html);
    assert.ok(img, 'img tag with an intact alt attribute');
    assert.match(img[1], /smoking gun/);
});

// ------------------------------------------------------------------
// Bug-fix regressions (PR #108 follow-up)
// ------------------------------------------------------------------

test('hyphen reflow: compound hyphens survive, soft breaks drop', () => {
    const p = page([
        run('the state-of-the-', 72, 700),
        run('art method is long-', 72, 686),
        run('term and convo-', 72, 672),
        run('luted overall', 72, 658)
    ]);
    const { markdown } = buildDocumentFromPages([p]);
    assert.ok(markdown.includes('state-of-the-art'), markdown);
    // "long-" + "term": the pre-hyphen word carries no earlier hyphen —
    // ambiguous even for humans; the soft-break rule applies.
    assert.ok(markdown.includes('longterm') || markdown.includes('long-term'));
    assert.ok(markdown.includes('convoluted'), markdown);
});

test('hyphen reflow: digit ranges keep the hyphen, no space injected', () => {
    const p = page([
        run('the war of 1914-', 72, 700),
        run('1918 reshaped Europe', 72, 686)
    ]);
    const { markdown } = buildDocumentFromPages([p]);
    assert.ok(markdown.includes('1914-1918'), markdown);
});

test('hyphen reflow: non-ASCII continuations reflow too', () => {
    const p = page([
        run('a na-', 72, 700),
        run('ïve reading', 72, 686)
    ]);
    const { markdown } = buildDocumentFromPages([p]);
    assert.ok(markdown.includes('naïve'), markdown);
});

test('narrow-gutter two-column page (LaTeX 10pt) reads columns, not baselines', () => {
    // Both columns' text shares each baseline; the 10pt gutter is far
    // below the naive split threshold — only the structural pass sees it.
    const items = [];
    for (let i = 0; i < 8; i++) {
        const y = 700 - i * 14;
        items.push({ str: `left${i} alpha beta`, x: 72, y, w: 223, h: 10 });
        items.push({ str: `right${i} gamma delta`, x: 305, y, w: 235, h: 10 });
    }
    const { markdown } = buildDocumentFromPages([page(items)]);
    assert.ok(markdown.indexOf('left7') < markdown.indexOf('right0'),
        'left column must finish before the right column starts:\n' + markdown);
    assert.ok(!/left0[^\n]*right0/.test(markdown.split('\n\n')[0] || '') || markdown.indexOf('left7') < markdown.indexOf('right0'));
});

test('IEEE 18.0pt gutter splits at the boundary (>=, not >)', () => {
    const items = [];
    for (let i = 0; i < 8; i++) {
        const y = 700 - i * 14;
        // left ends at x=294, right starts at 312: gap exactly 18.0
        items.push({ str: `left${i} words here`, x: 72, y, w: 222, h: 12 });
        items.push({ str: `right${i} words here`, x: 312, y, w: 222, h: 12 });
    }
    const { markdown } = buildDocumentFromPages([page(items)]);
    assert.ok(markdown.indexOf('left7') < markdown.indexOf('right0'),
        'columns interleaved:\n' + markdown);
});

test('a spanning title stays whole above a narrow-gutter split', () => {
    const items = [{ str: 'A Grand Unified Title', x: 150, y: 730, w: 300, h: 18 }];
    for (let i = 0; i < 8; i++) {
        const y = 700 - i * 14;
        items.push({ str: `left${i} alpha beta`, x: 72, y, w: 223, h: 10 });
        items.push({ str: `right${i} gamma delta`, x: 305, y, w: 235, h: 10 });
    }
    const { markdown } = buildDocumentFromPages([page(items)]);
    assert.ok(markdown.includes('A Grand Unified Title'), markdown);
    assert.ok(markdown.indexOf('A Grand Unified Title') < markdown.indexOf('left0'));
});

test('figure at the top of the right column lands in the right column', () => {
    const items = [];
    for (let i = 0; i < 6; i++) {
        const y = 700 - i * 14;
        items.push({ str: `left${i} alpha beta gamma`, x: 72, y, w: 200, h: 10 });
    }
    for (let i = 0; i < 3; i++) {
        const y = 560 - i * 14;   // right column text below its figure
        items.push({ str: `right${i} delta epsilon`, x: 340, y, w: 200, h: 10 });
    }
    const p = { width: W, height: H, items,
        figures: [{ ref: 'xray-figure:' + 'a'.repeat(64), x: 340, y: 580, w: 180, h: 110 }] };
    const { markdown } = buildDocumentFromPages([p]);
    const figAt = markdown.indexOf('xray-figure:');
    assert.ok(figAt > markdown.indexOf('left5'),
        'figure must not precede the left column:\n' + markdown);
    assert.ok(figAt < markdown.indexOf('right0'),
        'figure heads its own (right) column:\n' + markdown);
});

test('pageOfOffset: a textless leading page owns no offsets', () => {
    const empty = page([]);
    const texty = page([run('Real content starts here', 72, 700)]);
    const { markdown, pageMap } = buildDocumentFromPages([empty, texty]);
    assert.ok(markdown.startsWith('Real content'));
    assert.equal(pageOfOffset(pageMap, 0), 2);
});

test('furniture: a margin year in a short document is content, not a page number', () => {
    const mk = () => page([
        run('2024', 300, 30),               // bottom margin, 2-page doc
        run('Body text for the letter', 72, 700)
    ]);
    const { markdown } = buildDocumentFromPages([mk(), mk()]);
    assert.ok(markdown.includes('2024'), markdown);
});

test('furniture: real page numbers in a long document still drop', () => {
    const pages = [1, 2, 3, 4].map((n) => page([
        run(String(n), 300, 30),
        run(`Body of page ${n} with words`, 72, 700)
    ]));
    const { markdown } = buildDocumentFromPages(pages);
    assert.ok(!/^\d$/m.test(markdown), markdown);
});

test('pdfDocumentUrl: a direct .pdf URL wins over its own file=/src= params', () => {
    assert.equal(
        pdfDocumentUrl('https://host.test/real.pdf?file=https%3A%2F%2Fother.test%2Fdecoy.pdf'),
        'https://host.test/real.pdf?file=https%3A%2F%2Fother.test%2Fdecoy.pdf');
    assert.equal(
        pdfDocumentUrl('https://host.test/real.pdf?src=/other/decoy.pdf'),
        'https://host.test/real.pdf?src=/other/decoy.pdf');
});

test('pdfDocumentUrl: file=/src= unwraps only for viewer-shaped shells', () => {
    // Not a viewer: an arbitrary page carrying a pdf-ish param.
    assert.equal(pdfDocumentUrl('https://host.test/search?file=https%3A%2F%2Fother.test%2Fdoc.pdf'), null);
    // Viewer shells: pdf.js-style viewer.html and extension viewers.
    assert.equal(
        pdfDocumentUrl('https://host.test/pdfjs/web/viewer.html?file=https%3A%2F%2Fdocs.test%2Fpaper.pdf'),
        'https://docs.test/paper.pdf');
    assert.equal(
        pdfDocumentUrl('chrome-extension://abcdef/content/viewer.html?file=https%3A%2F%2Fdocs.test%2Fpaper.pdf'),
        'https://docs.test/paper.pdf');
});

// ------------------------------------------------------------------
// Post-#111 fixes: hyphen boundaries, sub/superscripts, dropcaps,
// furniture position-consistency, honest sparse counting, gutters
// the column classifier cannot resolve.
// ------------------------------------------------------------------

test('hyphen reflow: letter-digit boundaries keep the lexical hyphen', () => {
    const p = page([
        run('patients with COVID-', 72, 700),
        run('19 were admitted over a 3-', 72, 686),
        run('year horizon', 72, 672)
    ]);
    const { markdown } = buildDocumentFromPages([p]);
    assert.ok(markdown.includes('COVID-19'), markdown);
    assert.ok(markdown.includes('3-year'), markdown);
});

test('hyphen reflow: uppercase continuation joins the compound, no phantom space', () => {
    const p = page([
        run('solutions of the Navier-', 72, 700),
        run('Stokes equations', 72, 686)
    ]);
    const { markdown } = buildDocumentFromPages([p]);
    assert.equal(markdown, 'solutions of the Navier-Stokes equations');
});

test('sub/superscripts stay inline on their visual line', () => {
    const p = page([
        { str: 'the H', x: 72, y: 700, w: 30, h: 12 },
        { str: '2', x: 102, y: 697, w: 5, h: 6 },       // subscript, below baseline
        { str: 'O molecule is small', x: 107, y: 700, w: 120, h: 12 },
        { str: 'and the E=mc', x: 72, y: 680, w: 80, h: 12 },
        { str: '2', x: 152, y: 685, w: 5, h: 6 },       // superscript, above baseline
        { str: 'equation holds', x: 160, y: 680, w: 90, h: 12 }
    ]);
    const { markdown } = buildDocumentFromPages([p]);
    assert.equal(markdown, 'the H2O molecule is small and the E=mc2 equation holds');
});

test('a dropcap does not promote its body line to a heading', () => {
    const p = page([
        { str: 'T', x: 72, y: 700, w: 20, h: 30 },
        { str: 'he committee met in ordinary session to consider', x: 92, y: 700, w: 300, h: 12 },
        run('the annual budget for the following year in detail', 72, 680, 12),
        run('and further ordinary paragraph text follows here now', 72, 660, 12),
        run('plus more body text to give the page a median size', 72, 640, 12)
    ]);
    const { markdown } = buildDocumentFromPages([p]);
    assert.ok(!markdown.startsWith('#'), markdown);
    assert.ok(markdown.startsWith('The committee met'), markdown);
});

test('real headings still promote (dominant size, not max glyph)', () => {
    const p = page([
        { str: 'Section Title', x: 72, y: 700, w: 140, h: 20 },
        run('Ordinary body text follows the heading here', 72, 670, 10),
        run('and continues with more ordinary body text', 72, 656, 10),
        run('plus a third line of ordinary body content', 72, 642, 10)
    ]);
    const { markdown } = buildDocumentFromPages([p]);
    assert.match(markdown, /^# Section Title/);
});

test('furniture: margin content repeating modulo digits at VARYING y is kept', () => {
    const pages = [1, 2, 3, 4, 5].map((n) => page([
        run(`Body paragraph text of page ${n} discussing the case`, 72, 690),
        // fixed-position footer — real furniture
        run(`CASE NO. 23-cv-0${n}`, 72, 24, 9),
        // last footnote line — wanders with the stack height
        run(`${n + 10} Ibid., at ${300 + n}.`, 72, 40 + (n % 3) * 8, 9)
    ]));
    const { markdown } = buildDocumentFromPages(pages);
    assert.ok(!markdown.includes('CASE NO.'), markdown);
    assert.ok(markdown.includes('Ibid., at 301.'), markdown);
});

test('warnings: a page whose only text was dropped as furniture is not "missing"', () => {
    const furn = (p) => [
        run('ACME QUARTERLY REPORT — CONFIDENTIAL DRAFT', 72, 770, 9),
        run('© 2025 Acme Corporation. All rights reserved worldwide.', 72, 20, 9)
    ];
    const texty = (n) => page([
        ...Array.from({ length: 20 }, (_, i) =>
            run('A long line of perfectly ordinary body text for the page', 72, 700 - i * 16, 12)),
        ...furn(n)
    ]);
    const { warnings } = buildDocumentFromPages([texty(1), texty(2), texty(3), page(furn(4))]);
    assert.equal(warnings.find((w) => w.code === 'sparse-pages'), undefined,
        'a header/footer-only page has a working text layer — nothing is missing');
});

test('an off-center gutter the classifier cannot resolve does not shred lines', () => {
    // A consistent NARROW gap at ~0.32W recurs across baselines (so the
    // structural-gutter pass finds it and would split), but both halves
    // start left of the 45% column boundary — the two-column pass
    // cannot reorder them. The page must fall back to whole lines in
    // y-order, not split halves.
    const lines = Array.from({ length: 8 }, (_, i) => [
        { str: `left snippet ${i}`, x: 72, y: 700 - i * 14, w: 120, h: 10 },
        { str: `right long content column text ${i}`, x: 200, y: 700 - i * 14, w: 260, h: 10 }
    ]).flat();
    const { markdown } = buildDocumentFromPages([page(lines)]);
    for (let i = 0; i < 8; i++) {
        assert.ok(markdown.includes(`left snippet ${i} right long content column text ${i}`),
            `line ${i} stayed whole: ${markdown}`);
    }
});

test('pdfDocumentUrl: fragments are dropped — #page=3 is not identity', () => {
    assert.equal(
        pdfDocumentUrl('https://docs.test/paper.pdf#page=3'),
        'https://docs.test/paper.pdf');
    assert.equal(
        pdfDocumentUrl('https://docs.test/paper.pdf?rev=2#page=3&zoom=200'),
        'https://docs.test/paper.pdf?rev=2');
    assert.equal(
        pdfDocumentUrl('https://host.test/pdfjs/web/viewer.html?file=https%3A%2F%2Fdocs.test%2Fpaper.pdf%23page%3D7'),
        'https://docs.test/paper.pdf');
});

test('markdownToHtml: ordered lists keep their start number (filing paragraphs)', () => {
    const html = ContentExtractor.markdownToHtml('14. The defendant knew\n\n15. Internal emails show');
    assert.match(html, /<ol start="14">/);
    assert.match(html, /<ol start="15">/);
    // …and the reader round trip preserves the numbers instead of
    // renumbering every numbered paragraph to "1."
    const rt = ContentExtractor.htmlToMarkdown(html);
    assert.match(rt, /^14\.\s+The defendant knew/m);
    assert.match(rt, /^15\.\s+Internal emails show/m);
});

test('figure alt: markdown metacharacters are neutralized', () => {
    const p = page([
        run('Figure 3: the `raw` data with *stars* and under_scores', 100, 240, 10)
    ]);
    p.figures = [{ ref: 'xray-figure:' + 'a'.repeat(64), x: 100, y: 250, w: 200, h: 150 }];
    const { markdown } = buildDocumentFromPages([p]);
    const alt = /!\[([^\]]*)\]/.exec(markdown)[1];
    assert.ok(!/[`*_[\]"]/.test(alt), `alt must carry no markdown metachars: ${alt}`);
    assert.match(alt, /Figure 3: the raw data/);
});

test('googleDrivePdfUrl: Drive PDF previews map to the direct-download URL', async () => {
    const { googleDrivePdfUrl } = await import('../src/shared/pdf-detect.js');
    assert.equal(
        googleDrivePdfUrl('https://drive.google.com/file/d/1YhmkYB32RpGsXvQTsX4xZ0Yul1wiwh8Z/view',
            'will_decision.pdf - Google Drive'),
        'https://drive.google.com/uc?export=download&id=1YhmkYB32RpGsXvQTsX4xZ0Yul1wiwh8Z');
    assert.equal(
        googleDrivePdfUrl('https://drive.google.com/open?id=abc_123-XYZ', 'report.pdf'),
        'https://drive.google.com/uc?export=download&id=abc_123-XYZ');
    // Drive previews many types — only .pdf-titled tabs route.
    assert.equal(googleDrivePdfUrl('https://drive.google.com/file/d/abc/view', 'holiday.mp4 - Google Drive'), null);
    // Not Drive / not a file link.
    assert.equal(googleDrivePdfUrl('https://docs.google.com/document/d/abc/edit', 'x.pdf'), null);
    assert.equal(googleDrivePdfUrl('https://drive.google.com/drive/my-drive', 'x.pdf'), null);
});

// ------------------------------------------------------------------
// Tables (aligned grids) — reconstruct row-by-row, not column-band.
// ------------------------------------------------------------------

function tableRow(cells, y) {
    // cells: [[str, x], …] — each cell a separate run at the same baseline.
    return cells.map(([str, x]) => ({ str, x, y, w: str.length * 5, h: 11 }));
}

test('a 3-column table reconstructs row-by-row with row↔value links intact', () => {
    const rows = [
        [['evidence', 100], ['Bayes', 360], ['log-odds', 470]],
        [['prior', 100], ['0.30225', 360], ['-1.2', 470]],
        [['location of first SSE', 100], ['13.48', 360], ['2.6', 470]],
        [['12 nucleotide insert', 100], ['50', 360], ['3.91', 470]],
        [['CGGCGG', 100], ['10.68376', 360], ['2.37', 470]],
        [['total', 100], ['234015', 360], ['12.36314', 470]]
    ];
    const items = [];
    let y = 700;
    for (const r of rows) { items.push(...tableRow(r, y)); y -= 16; }
    const { markdown } = buildDocumentFromPages([page(items)]);
    // Each row's cells stay on one line, left-to-right — NOT the
    // pre-fix column-band read that put every label in one paragraph
    // and the numbers in a scrambled diagonal.
    assert.match(markdown, /prior · 0\.30225 · -1\.2/);
    assert.match(markdown, /12 nucleotide insert · 50 · 3\.91/);
    assert.match(markdown, /total · 234015 · 12\.36314/);
    // The label column is NOT collapsed into one run.
    assert.ok(!/evidence prior location/.test(markdown), 'labels not column-banded');
});

test('a table embedded in prose: the table gridifies, the prose still flows', () => {
    const items = [];
    let y = 720;
    for (let i = 0; i < 4; i++) { items.push({ str: `Intro prose sentence ${i} runs the full column width here`, x: 72, y, w: 440, h: 11 }); y -= 15; }
    y -= 20;
    const rows = [
        [['evidence', 100], ['Bayes', 360], ['log-odds', 470]],
        [['prior', 100], ['0.30225', 360], ['-1.2', 470]],
        [['FCS', 100], ['2', 360], ['0.69', 470]],
        [['12 nucleotide insert', 100], ['50', 360], ['3.91', 470]],
        [['total', 100], ['234015', 360], ['12.36314', 470]]
    ];
    for (const r of rows) { items.push(...tableRow(r, y)); y -= 16; }
    y -= 20;
    for (let i = 0; i < 4; i++) { items.push({ str: `Trailing prose line ${i} discusses the positive log-odds terms`, x: 72, y, w: 440, h: 11 }); y -= 15; }
    const { markdown } = buildDocumentFromPages([page(items)]);
    const flat = markdown.replace(/\n/g, ' ');
    assert.match(flat, /Intro prose sentence 0.*sentence 3/, 'intro prose merges into a paragraph');
    assert.match(markdown, /12 nucleotide insert · 50 · 3\.91/, 'table row stays intact');
    assert.match(flat, /Trailing prose line 0.*line 3/, 'trailing prose merges into a paragraph');
});

test('two-column prose with SHARED baselines is not mistaken for a table', () => {
    const items = [];
    let y = 720;
    for (let i = 0; i < 12; i++) {
        items.push({ str: `Left column sentence ${i} continues with several ordinary words`, x: 60, y, w: 220, h: 10 });
        items.push({ str: `Right column sentence ${i} also continues with several words`, x: 320, y, w: 220, h: 10 });
        y -= 14;
    }
    const { markdown } = buildDocumentFromPages([page(items)]);
    assert.ok(!markdown.includes(' · '), 'not dot-joined as a table');
    assert.ok(markdown.indexOf('Left column sentence 11') < markdown.indexOf('Right column sentence 0'),
        'columns read left-then-right, not interleaved row-by-row');
});
