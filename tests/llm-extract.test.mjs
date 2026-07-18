// LLM extraction assembly tests — Phase 18 C5
// (docs/COMPLEX_CONTENT_DESIGN.md §6).
//
// The dual-substrate honesty contract: in structure mode every span
// the model authored is a search key — it re-canonicalizes to the
// substrate's own bytes or it dies (dropped and counted). In
// transcription mode (scans) the model text IS the capture and the
// counts stay zero. The pageMap must keep the pdf-layout consumed
// shape so page anchors on claims survive a reconstructed body.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { assembleExtraction, extractionMethod } from '../src/shared/llm-extract.js';
import { pageOfOffset } from '../src/shared/pdf-layout.js';

// A substrate with the typographic hazards the grounding tiers absorb:
// an em-dash, straight ASCII quotes, mixed case, and a literal pipe.
const SUBSTRATE = [
    'Methods and Materials',
    'The trial enrolled 4,522 participants across nine sites — a "large cohort" by the standards of 2020.',
    'Results were mixed. Vaccine efficacy was 62% against infection.',
    'Efficacy by age group was reported in the appendix.',
    'Age 18-49: 71%. Age 50-64: 60%. Age 65+: 48%.',
    'Figure 2. Antibody titers over 180 days.',
    'Adverse events were rare | mild in most cases.'
].join('\n');

const STRUCTURE = { mode: 'structure' };
const TRANSCRIPTION = { mode: 'transcription' };

// ---------------------------------------------------------------------
// Structure mode — re-canonicalization
// ---------------------------------------------------------------------

test('structure: grounded paragraph re-canonicalizes to substrate bytes', () => {
    // The model "helpfully" curled the quotes and flattened the em-dash.
    const drifted = 'across nine sites - a “large cohort” by the standards of 2020.';
    const r = assembleExtraction([{ kind: 'paragraph', text: drifted }], SUBSTRATE, STRUCTURE);

    assert.equal(r.markdown, 'across nine sites — a "large cohort" by the standards of 2020.');
    assert.ok(SUBSTRATE.includes(r.markdown), 'output must be a literal substrate slice');
    assert.ok(!r.markdown.includes('“'), 'the model variant must not survive');
    assert.equal(r.unverified_spans, 0);
    assert.equal(r.total_spans, 1);
});

test('structure: fabricated paragraph is dropped and counted', () => {
    const r = assembleExtraction([
        { kind: 'paragraph', text: 'Results were mixed. Vaccine efficacy was 62% against infection.' },
        { kind: 'paragraph', text: 'The vaccine was proven completely safe for every conceivable group.' }
    ], SUBSTRATE, STRUCTURE);

    assert.equal(r.markdown, 'Results were mixed. Vaccine efficacy was 62% against infection.');
    assert.ok(!r.markdown.includes('completely safe'));
    assert.equal(r.unverified_spans, 1);
    assert.equal(r.total_spans, 2);
});

test('structure: everything fabricated yields empty markdown with counts intact', () => {
    const r = assembleExtraction([
        { kind: 'paragraph', text: 'Nothing in this sentence exists anywhere upstream.' },
        { kind: 'heading', text: 'Entirely Invented Section' }
    ], SUBSTRATE, STRUCTURE);

    assert.equal(r.markdown, '');
    assert.equal(r.unverified_spans, 2);
    assert.equal(r.total_spans, 2);
    assert.equal(r.pageMap, null);
});

// ---------------------------------------------------------------------
// Structure mode — tables
// ---------------------------------------------------------------------

test('structure: table cells re-canonicalize to substrate bytes', () => {
    // 'Age Group' only exists lowercase in the substrate — the
    // normalized tier must return the substrate's own casing.
    const r = assembleExtraction([{
        kind: 'table',
        cells: [['Age Group', 'Efficacy'], ['18-49', '71%'], ['50-64', '60%']]
    }], SUBSTRATE, STRUCTURE);

    const lines = r.markdown.split('\n');
    assert.equal(lines[0], '| age group | Efficacy |');
    assert.equal(lines[1], '| --- | --- |');
    assert.equal(lines[2], '| 18-49 | 71% |');
    assert.equal(lines[3], '| 50-64 | 60% |');
    assert.equal(r.unverified_spans, 0);
    assert.equal(r.total_spans, 1);
});

test('structure: one fabricated cell blanks and counts; table survives', () => {
    const r = assembleExtraction([{
        kind: 'table',
        cells: [['Age Group', 'Efficacy'], ['18-49', '71%'], ['50-64', 'ZZZ-fabricated-cell']]
    }], SUBSTRATE, STRUCTURE);

    assert.ok(r.markdown.includes('| 50-64 |  |'), 'failed cell blanks: ' + r.markdown);
    assert.ok(!r.markdown.includes('ZZZ'));
    assert.equal(r.unverified_spans, 1);
    assert.equal(r.total_spans, 1);
});

test('structure: majority-fabricated table drops whole and counts cells plus one', () => {
    const r = assembleExtraction([{
        kind: 'table',
        cells: [['18-49', 'ZZZ-invented-one', 'ZZZ-invented-two']]
    }], SUBSTRATE, STRUCTURE);

    assert.equal(r.markdown, '', 'a majority-fabricated table is not a reconstruction');
    assert.equal(r.unverified_spans, 3, 'two failed cells + one for the dropped table');
    assert.equal(r.total_spans, 1);
});

test('structure: table with no rows or no non-empty cell drops and counts once', () => {
    const empty = assembleExtraction([{ kind: 'table', cells: [] }], SUBSTRATE, STRUCTURE);
    assert.equal(empty.markdown, '');
    assert.equal(empty.unverified_spans, 1);
    assert.equal(empty.total_spans, 1);

    const blank = assembleExtraction([{ kind: 'table', cells: [['', '  '], ['']] }], SUBSTRATE, STRUCTURE);
    assert.equal(blank.markdown, '');
    assert.equal(blank.unverified_spans, 1);
    assert.equal(blank.total_spans, 1);
});

test('structure: pipes inside grounded cells are escaped in GFM', () => {
    const r = assembleExtraction([{
        kind: 'table',
        cells: [['Age 65+', 'Efficacy'], ['Adverse events', 'rare | mild']]
    }], SUBSTRATE, STRUCTURE);

    assert.ok(r.markdown.includes('| rare \\| mild |'), r.markdown);
    assert.equal(r.markdown.split('\n')[1], '| --- | --- |');
    assert.equal(r.unverified_spans, 0);
});

test('ragged table rows pad to the widest row', () => {
    const r = assembleExtraction([{
        kind: 'table',
        cells: [['a', 'b', 'c'], ['d']]
    }], null, TRANSCRIPTION);

    const lines = r.markdown.split('\n');
    assert.equal(lines[0], '| a | b | c |');
    assert.equal(lines[1], '| --- | --- | --- |');
    assert.equal(lines[2], '| d |  |  |');
});

// ---------------------------------------------------------------------
// Block rendering — headings, captions, order, separation
// ---------------------------------------------------------------------

test('headings clamp levels and default to 2', () => {
    const spans = [
        { kind: 'heading', text: 'Methods and Materials', level: 9 },
        { kind: 'heading', text: 'Methods and Materials', level: 0 },
        { kind: 'heading', text: 'Methods and Materials', level: -3 },
        { kind: 'heading', text: 'Methods and Materials' },
        { kind: 'heading', text: 'Methods and Materials', level: 'huge' }
    ];
    const r = assembleExtraction(spans, SUBSTRATE, STRUCTURE);
    const blocks = r.markdown.split('\n\n');
    assert.equal(blocks[0], '#### Methods and Materials');
    assert.equal(blocks[1], '# Methods and Materials');
    assert.equal(blocks[2], '# Methods and Materials');
    assert.equal(blocks[3], '## Methods and Materials');
    assert.equal(blocks[4], '## Methods and Materials');
});

test('captions italicize with substrate bytes', () => {
    const r = assembleExtraction([
        { kind: 'caption', text: 'Figure 2. Antibody titers over 180 days.' }
    ], SUBSTRATE, STRUCTURE);
    assert.equal(r.markdown, '*Figure 2. Antibody titers over 180 days.*');
});

test('span order is preserved and blocks are blank-line separated', () => {
    const r = assembleExtraction([
        { kind: 'caption', text: 'Figure 2. Antibody titers over 180 days.' },
        { kind: 'heading', text: 'Methods and Materials', level: 3 },
        { kind: 'paragraph', text: 'Results were mixed.' }
    ], SUBSTRATE, STRUCTURE);

    assert.equal(r.markdown, [
        '*Figure 2. Antibody titers over 180 days.*',
        '### Methods and Materials',
        'Results were mixed.'
    ].join('\n\n'));
});

test('grounded heading bytes spanning a substrate line break stay one heading line', () => {
    const substrate = 'Intro text.\nDeep Learning\nMethods for tables follow.';
    const r = assembleExtraction([
        { kind: 'heading', text: 'Deep Learning Methods', level: 2 }
    ], substrate, STRUCTURE);
    assert.equal(r.markdown, '## Deep Learning Methods');
    assert.equal(r.unverified_spans, 0);
});

// ---------------------------------------------------------------------
// Transcription mode — the scans clause
// ---------------------------------------------------------------------

test('transcription: model text kept verbatim, even text that would never ground', () => {
    const spans = [
        { kind: 'heading', text: 'Handwritten Ledger — 1987', level: 1 },
        { kind: 'paragraph', text: 'This “transcribed” sentence exists nowhere else.' },
        { kind: 'table', cells: [['Col', 'Val'], ['ZZZ-only-in-the-scan', '42']] }
    ];
    const r = assembleExtraction(spans, SUBSTRATE, TRANSCRIPTION);

    assert.ok(r.markdown.includes('# Handwritten Ledger — 1987'));
    assert.ok(r.markdown.includes('This “transcribed” sentence exists nowhere else.'),
        'curly quotes and all — the transcription IS the capture');
    assert.ok(r.markdown.includes('| ZZZ-only-in-the-scan | 42 |'));
    assert.equal(r.unverified_spans, 0, 'the count is the structure-mode marker; always 0 here');
    assert.equal(r.total_spans, 3);
});

test('transcription: substrateText is ignored', () => {
    // Text that WOULD re-canonicalize in structure mode stays as authored.
    const drifted = 'across nine sites - a “large cohort” by the standards of 2020.';
    const r = assembleExtraction([{ kind: 'paragraph', text: drifted }], SUBSTRATE, TRANSCRIPTION);
    assert.equal(r.markdown, drifted);
});

// ---------------------------------------------------------------------
// Page map
// ---------------------------------------------------------------------

test('pageMap: hints inherit forward, leading blocks take the first seen page', () => {
    const r = assembleExtraction([
        { kind: 'paragraph', text: 'Alpha block one.' },                  // before any hint
        { kind: 'paragraph', text: 'Beta block two.', page: 2 },
        { kind: 'paragraph', text: 'Gamma block three.' },                // inherits 2
        { kind: 'paragraph', text: 'Delta block four.', page: 4 },
        { kind: 'paragraph', text: 'Epsilon block five.', page: 3 },      // lower hint — ignored
        { kind: 'paragraph', text: 'Zeta block six.', page: 6 }
    ], null, TRANSCRIPTION);

    assert.ok(Array.isArray(r.pageMap));
    assert.deepEqual(r.pageMap.map((e) => e.page), [2, 4, 6], 'strictly ascending');

    // Offsets point at emitted block starts.
    for (const entry of r.pageMap) {
        assert.equal(typeof entry.start, 'number');
    }
    assert.equal(r.markdown.slice(r.pageMap[0].start, r.pageMap[0].start + 10), 'Alpha bloc');
    assert.equal(r.markdown.slice(r.pageMap[1].start, r.pageMap[1].start + 10), 'Delta bloc');
    assert.equal(r.markdown.slice(r.pageMap[2].start, r.pageMap[2].start + 10), 'Zeta block');
});

test('pageMap: consumed shape works with pdf-layout pageOfOffset', () => {
    const r = assembleExtraction([
        { kind: 'paragraph', text: 'Alpha block one.', page: 1 },
        { kind: 'paragraph', text: 'Beta block two.', page: 2 },
        { kind: 'paragraph', text: 'Gamma block three.' }                 // inherits 2
    ], null, TRANSCRIPTION);

    const gammaAt = r.markdown.indexOf('Gamma');
    assert.equal(pageOfOffset(r.pageMap, 0), 1);
    assert.equal(pageOfOffset(r.pageMap, r.markdown.indexOf('Beta')), 2);
    assert.equal(pageOfOffset(r.pageMap, gammaAt), 2);
    assert.equal(pageOfOffset(r.pageMap, r.markdown.length - 1), 2);
});

test('pageMap: a dropped span\'s page hint still advances the page', () => {
    const r = assembleExtraction([
        { kind: 'paragraph', text: 'Results were mixed.', page: 1 },
        { kind: 'paragraph', text: 'Fabricated bridge sentence.', page: 2 },  // drops, hint survives
        { kind: 'paragraph', text: 'Age 18-49: 71%.' }
    ], SUBSTRATE, STRUCTURE);

    assert.equal(r.unverified_spans, 1);
    assert.deepEqual(r.pageMap.map((e) => e.page), [1, 2]);
    assert.equal(r.markdown.slice(r.pageMap[1].start, r.pageMap[1].start + 3), 'Age');
});

test('pageMap: null when no span carries a page hint', () => {
    const r = assembleExtraction([
        { kind: 'paragraph', text: 'Alpha block one.' },
        { kind: 'paragraph', text: 'Beta block two.' }
    ], null, TRANSCRIPTION);
    assert.equal(r.pageMap, null);
});

test('pageMap: junk page hints (zero, negative, fractional) are ignored', () => {
    const r = assembleExtraction([
        { kind: 'paragraph', text: 'Alpha block one.', page: 0 },
        { kind: 'paragraph', text: 'Beta block two.', page: -2 },
        { kind: 'paragraph', text: 'Gamma block three.', page: 1.5 }
    ], null, TRANSCRIPTION);
    assert.equal(r.pageMap, null);
});

// ---------------------------------------------------------------------
// Degradation — never a throw
// ---------------------------------------------------------------------

test('null/absent spans yield the empty result', () => {
    for (const spans of [null, undefined, 'not-an-array', 42]) {
        const r = assembleExtraction(spans, SUBSTRATE, STRUCTURE);
        assert.deepEqual(r, { markdown: '', pageMap: null, unverified_spans: 0, total_spans: 0, table_count: 0 });
    }
});

// ------------------------------------------------------------------
// Adversarial-review regressions: the sub-token grounding attack.
// The review DEMONSTRATED a reversed mortality table (2020→7, 2021→41
// against a document saying the opposite) passing as "all verified":
// short numeric cells grounded INSIDE larger tokens ('9' in 'COVID-19',
// '201' in '2017', '12' in '12%'). These pin the two defenses: token
// boundaries for short keys, and the substantive-cell requirement.
// ------------------------------------------------------------------

test('REGRESSION: short keys no longer ground inside larger tokens', () => {
    const substrate = 'The 2017 study of COVID-19 found a 12% rise.';
    // '201' sits inside '2017'; '9' inside 'COVID-19' (hyphen-adjacent
    // but digit-adjacent on the left? '1' is left of '9' — no boundary);
    // '12' inside '12%' — '%' IS a boundary, but the left neighbor is a
    // space so '12' anchors legitimately there. Test the true shards:
    const r = assembleExtraction([
        { kind: 'paragraph', text: '201' },
        { kind: 'paragraph', text: '9' }
    ], substrate, STRUCTURE);
    assert.equal(r.markdown, '', 'sub-token shards must not verify');
    assert.equal(r.unverified_spans, 2);
});

test('REGRESSION: a numeric table with no grounded substantive cell drops whole', () => {
    // The demonstrated attack: fabricated labels fail, but every number
    // grounds vacuously somewhere. Zero grounded REAL WORDS = the
    // model\'s table, not the document\'s.
    const substrate = 'In 2020 there were 41 deaths recorded; 2021 saw 7 more. Efficacy was not assessed.';
    const r = assembleExtraction([{
        kind: 'table',
        cells: [['Age band', 'Rate'], ['2020', '41'], ['2021', '7']]
    }], substrate, STRUCTURE);
    assert.equal(r.markdown, '', 'no substantive cell grounded — dropped');
    assert.ok(r.unverified_spans >= 3, 'the failed labels and the drop are counted');
    assert.equal(r.table_count, 0);
});

test('REGRESSION: a table with grounded word cells still survives, numbers riding along', () => {
    const substrate = 'Deaths by year. In 2020 there were 41 deaths; in 2021 there were 7 deaths.';
    const r = assembleExtraction([{
        kind: 'table',
        cells: [['Year', 'Deaths'], ['2020', '41'], ['2021', '7']]
    }], substrate, STRUCTURE);
    // 'Deaths' grounds as a real word (boundary-anchored) → the table
    // survives; the disclosure duty transfers to the caller via
    // table_count.
    assert.ok(r.markdown.includes('| 2020 | 41 |'));
    assert.equal(r.table_count, 1);
});

test('REGRESSION: table_count reports emitted tables for the caller\'s disclosure duty', () => {
    const substrate = 'Deaths by year were tabulated. In 2020 there were 41 deaths.';
    const withTable = assembleExtraction([
        { kind: 'paragraph', text: 'Deaths by year were tabulated.' },
        { kind: 'table', cells: [['Year', 'Deaths by year'], ['2020', '41']] }
    ], substrate, STRUCTURE);
    assert.equal(withTable.table_count, 1);
    const withoutTable = assembleExtraction([
        { kind: 'paragraph', text: 'Deaths by year were tabulated.' }
    ], substrate, STRUCTURE);
    assert.equal(withoutTable.table_count, 0);
});

test('REGRESSION: extractionMethod is idempotent over re-reconstruction', () => {
    assert.equal(
        extractionMethod('pdfjs-4.10+llm:claude-a', 'claude-b', 'structure'),
        'pdfjs-4.10+llm:claude-b',
        'a second pass composes over the deterministic base, never chains');
    assert.equal(
        extractionMethod('pdfjs-4.10+llm:a+llm:b', 'c', 'structure'),
        'pdfjs-4.10+llm:c',
        'even an already-malformed chain collapses');
    assert.equal(
        extractionMethod('llm:claude-a', 'claude-b', 'structure'),
        'llm:claude-b',
        'a pure-llm base has no deterministic base to compose over');
});

test('REGRESSION: long verbatim spans still ground as substrings (no over-hardening)', () => {
    const substrate = 'prefix text The committee reached no verdict on the matter suffix text';
    const r = assembleExtraction([
        { kind: 'paragraph', text: 'The committee reached no verdict on the matter' }
    ], substrate, STRUCTURE);
    assert.equal(r.markdown, 'The committee reached no verdict on the matter');
    assert.equal(r.unverified_spans, 0);
});

test('junk spans are skipped silently in both modes', () => {
    const junk = [
        null,
        42,
        'paragraph',
        { kind: 'blockquote', text: 'wrong kind' },
        { kind: 'paragraph' },                       // no text
        { kind: 'paragraph', text: 7 },              // non-string text
        { kind: 'heading', text: '   ' },            // blank text
        { kind: 'table' },                           // no cells
        { kind: 'table', cells: 'nope' }             // non-array cells
    ];
    for (const opts of [STRUCTURE, TRANSCRIPTION]) {
        const r = assembleExtraction(junk, SUBSTRATE, opts);
        assert.equal(r.markdown, '');
        assert.equal(r.unverified_spans, 0);
        assert.equal(r.total_spans, 0);
        assert.equal(r.pageMap, null);
    }
});

test('junk spans between real ones do not break assembly or counts', () => {
    const r = assembleExtraction([
        { kind: 'paragraph', text: 'Results were mixed.' },
        { kind: 'blockquote', text: 'skipped' },
        null,
        { kind: 'paragraph', text: 'Age 18-49: 71%.' }
    ], SUBSTRATE, STRUCTURE);
    assert.equal(r.markdown, 'Results were mixed.\n\nAge 18-49: 71%.');
    assert.equal(r.total_spans, 2);
    assert.equal(r.unverified_spans, 0);
});

test('structure mode with empty/null substrate drops everything, counts correct', () => {
    const spans = [
        { kind: 'paragraph', text: 'Any text at all.' },
        { kind: 'heading', text: 'Any heading.' },
        { kind: 'table', cells: [['a', 'b']] }       // both cells fail + table drop
    ];
    for (const substrate of ['', null, undefined]) {
        const r = assembleExtraction(spans, substrate, STRUCTURE);
        assert.equal(r.markdown, '');
        assert.equal(r.unverified_spans, 2 + 3, 'two text spans + two cells + one table');
        assert.equal(r.total_spans, 3);
    }
});

test('missing opts defaults to structure mode (the safe direction)', () => {
    // Without a substrate, defaulting to structure means fabrications
    // drop instead of being silently stored as the capture.
    const r = assembleExtraction([{ kind: 'paragraph', text: 'Unverifiable claim.' }], '', undefined);
    assert.equal(r.markdown, '');
    assert.equal(r.unverified_spans, 1);
    assert.equal(r.total_spans, 1);
});

// ---------------------------------------------------------------------
// extractionMethod
// ---------------------------------------------------------------------

test('extractionMethod: structure composes base+llm, transcription is llm alone', () => {
    assert.equal(extractionMethod('pdfjs-4.10', 'claude-opus-4-8', 'structure'),
        'pdfjs-4.10+llm:claude-opus-4-8');
    assert.equal(extractionMethod('pdfjs-4.10', 'claude-opus-4-8', 'transcription'),
        'llm:claude-opus-4-8');
});

test('extractionMethod: defensive on junk inputs', () => {
    assert.equal(extractionMethod(null, 'm', 'structure'), 'llm:m',
        'structure without a base method must not fabricate a composition');
    assert.equal(extractionMethod('', 'm', 'structure'), 'llm:m');
    assert.equal(extractionMethod('   ', 'm', 'structure'), 'llm:m');
    assert.equal(extractionMethod('base', null, 'structure'), 'base+llm:unknown');
    assert.equal(extractionMethod('base', '  ', 'structure'), 'base+llm:unknown');
    assert.equal(extractionMethod(null, null, 'transcription'), 'llm:unknown');
    assert.equal(extractionMethod('base', 'm', undefined), 'llm:m',
        'an unknown mode never claims a deterministic base');
    assert.equal(extractionMethod('base', 'm', 'transcription'), 'llm:m');
});
