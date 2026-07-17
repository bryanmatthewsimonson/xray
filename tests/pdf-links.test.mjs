// PDF outbound-link extraction tests — Phase 27.
//
// extractPdfLinks is the PDF analog of
// ContentExtractor.extractOutboundLinks and MUST emit the identical
// shape, because deriveLinkEdges and the capture frontier consume both
// without knowing which produced them. These pin that equivalence: the
// same dedupe-through-normalize, the same cap + honest `truncated`
// marker, the same repeat-links-still-count rule, and the same
// hostname-sans-www `internal` approximation.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { extractPdfLinks } = await import('../src/shared/pdf-layout.js');

// A text run, in the viewport-mapped y-down space the caller produces:
// (x, y) is the START of the BASELINE, so glyphs occupy [y - h, y].
const run = (str, x, y, w = 40, h = 10) => ({ str, x, y, w, h });
// A link annotation rect in that same space, as EXPLICIT CORNERS
// (y0 = top). This helper takes a run-style baseline origin and boxes
// the glyphs above it, so a rect built with the same (x, y) as a run
// covers that run — which is what a real PDF link rect does.
const annot = (url, x, y, w = 40, h = 10) =>
    ({ url, x0: x, y0: y - h, x1: x + w, y1: y });

test('pdf-links: URI annotations become links in the HTML extractor\'s shape', () => {
    const { links, truncated } = extractPdfLinks([{
        items: [run('Worobey et al. 2022', 100, 200)],
        annots: [annot('https://www.science.org/doi/10.1126/science.abp8715', 100, 200)]
    }], 'https://zenodo.org/records/4067919/files/paper.pdf', 'zenodo.org');
    assert.equal(truncated, false);
    assert.equal(links.length, 1);
    assert.deepEqual(Object.keys(links[0]).sort(), ['count', 'internal', 'text', 'url']);
    assert.equal(links[0].url, 'https://www.science.org/doi/10.1126/science.abp8715');
    assert.equal(links[0].count, 1);
    assert.equal(links[0].internal, false);
    assert.equal(links[0].text, 'Worobey et al. 2022', 'anchor text recovered from the covered runs');
});

test('pdf-links: internal is hostname-sans-www equality with the PDF\'s own host', () => {
    const { links } = extractPdfLinks([{
        items: [],
        annots: [annot('https://www.zenodo.org/records/1', 0, 0), annot('https://nature.com/x', 0, 50)]
    }], 'https://zenodo.org/files/p.pdf', 'zenodo.org');
    assert.equal(links.find((l) => l.url.includes('zenodo')).internal, true, 'www. stripped both sides');
    assert.equal(links.find((l) => l.url.includes('nature')).internal, false);
});

test('pdf-links: repeats dedupe through normalize and still count', () => {
    // Same target, once bare and once with a tracking param: ONE link,
    // count 2 — the HTML extractor's exact rule.
    const { links } = extractPdfLinks([{
        items: [],
        annots: [
            annot('https://example.com/a', 0, 0),
            annot('https://example.com/a?utm_source=pdf', 0, 20)
        ]
    }], 'https://host/p.pdf', 'host');
    assert.equal(links.length, 1);
    assert.equal(links[0].count, 2);
});

test('pdf-links: non-http targets and internal GoTo destinations are skipped', () => {
    const { links } = extractPdfLinks([{
        items: [],
        annots: [
            { x: 0, y: 0, w: 10, h: 10 },                       // GoTo — no url
            annot('mailto:a@b.c', 0, 20),
            annot('javascript:alert(1)', 0, 40),
            annot('https://ok.example/x', 0, 60)
        ]
    }], 'https://host/p.pdf', 'host');
    assert.deepEqual(links.map((l) => l.url), ['https://ok.example/x']);
});

test('pdf-links: the cap truncates honestly, and a capped repeat still counts', () => {
    const annots = [];
    for (let i = 0; i < 5; i++) annots.push(annot(`https://e.com/${i}`, 0, i * 20));
    annots.push(annot('https://e.com/0', 0, 200));   // repeat of a KEPT target
    const { links, truncated } = extractPdfLinks([{ items: [], annots }], 'https://h/p.pdf', 'h', { cap: 3 });
    assert.equal(links.length, 3);
    assert.equal(truncated, true, 'over-cap is disclosed, never silent');
    assert.equal(links[0].count, 2, 'a repeat of a kept target still counts past the cap');
});

test('pdf-links: links are collected across every page', () => {
    const { links } = extractPdfLinks([
        { items: [], annots: [annot('https://a.example/1', 0, 0)] },
        { items: [], annots: [annot('https://b.example/2', 0, 0)] }
    ], 'https://h/p.pdf', 'h');
    assert.deepEqual(links.map((l) => l.url).sort(), ['https://a.example/1', 'https://b.example/2']);
});

test('pdf-links: anchor text takes only runs the rect COVERS, not neighbours', () => {
    const { links } = extractPdfLinks([{
        items: [
            run('see', 0, 100, 20),          // left of the rect
            run('Pekar', 100, 100, 40),      // inside
            run('elsewhere', 400, 100, 60)   // far right
        ],
        annots: [annot('https://x.example/p', 95, 100, 50, 10)]
    }], 'https://h/p.pdf', 'h');
    assert.equal(links[0].text, 'Pekar');
});

test('pdf-links: no annotations / absent annots / non-array input degrade to empty', () => {
    assert.deepEqual(extractPdfLinks([{ items: [], annots: [] }], 'https://h/p.pdf', 'h'),
        { links: [], truncated: false });
    assert.deepEqual(extractPdfLinks([{ items: [] }], 'https://h/p.pdf', 'h'),
        { links: [], truncated: false }, 'a page with no annots key is not a crash');
    assert.deepEqual(extractPdfLinks(null, 'https://h/p.pdf', 'h'),
        { links: [], truncated: false });
});

test('pdf-links: a local import (no own host) marks everything external', () => {
    // file:///imported/... captures have no hostname — nothing can be
    // "internal" to them, and that must not throw.
    const { links } = extractPdfLinks([{
        items: [], annots: [annot('https://nature.com/x', 0, 0)]
    }], 'file:///imported/abc/paper.pdf', '');
    assert.equal(links[0].internal, false);
});
