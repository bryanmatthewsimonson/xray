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
    assert.equal(pdfDocumentUrl('https://x.test/paper.PDF?dl=1#page=2'), 'https://x.test/paper.PDF?dl=1#page=2');
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
