// Reference-list parser tests — Phase 18 C2 tail
// (docs/COMPLEX_CONTENT_DESIGN.md §4.3). Stub-document pattern (see
// tests/scholar-meta.test.mjs) — no DOM, no jsdom.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseReferenceList, parseReferenceString, cleanDoi } from '../src/shared/scholar-refs.js';

// Stub element: textContent + getAttribute + querySelectorAll keyed by
// the exact selector string the module asks for.
function el(text, children = {}, attrs = {}) {
    return {
        textContent: text,
        getAttribute: (n) => (n in attrs ? attrs[n] : null),
        querySelectorAll: (sel) => children[sel] || []
    };
}

const NLM = 'Zhu N, Zhang D, Wang W, et al. A novel coronavirus from patients '
    + 'with pneumonia in China, 2019. N Engl J Med. 2020;382(8):727-733. '
    + 'doi: 10.1056/NEJMoa2001017. PMID: 31978945.';

test('parseReferenceString: year, DOI, PMID from an NLM-style citation', () => {
    const e = parseReferenceString('  Zhu N, Zhang D, Wang W, et al.\n  A novel coronavirus from patients '
        + 'with pneumonia in China, 2019.  N Engl J Med. 2020;382(8):727-733. '
        + 'doi: 10.1056/NEJMoa2001017. PMID: 31978945.');
    assert.equal(e.raw, NLM);                       // whitespace-collapsed
    assert.equal(e.year, 2020);                     // not 2019 (title year)
    assert.equal(e.doi, '10.1056/NEJMoa2001017');   // trailing period stripped
    assert.equal(e.pmid, '31978945');
    assert.equal(e.title, undefined);               // never guessed from prose
});

test('parseReferenceString: year in the title does not win over the cited year', () => {
    const e = parseReferenceString('Smith J. The 1918 influenza pandemic revisited. J Hist Med. 2004;12:1-10.');
    assert.equal(e.year, 2004);
});

test('parseReferenceString: APA parenthesized year', () => {
    const e = parseReferenceString('Smith, J. (2015). On widgets. Widget Press.');
    assert.equal(e.year, 2015);
});

test('parseReferenceString: unparseable segment yields { raw } alone — absent, not empty', () => {
    const e = parseReferenceString('World Health Organization. Weekly epidemiological update.');
    assert.deepEqual(e, { raw: 'World Health Organization. Weekly epidemiological update.' });
});

test('parseReferenceString: empty input yields { raw: "" } only', () => {
    assert.deepEqual(parseReferenceString(''), { raw: '' });
    assert.deepEqual(parseReferenceString(null), { raw: '' });
});

test('parseReferenceString: url extracted, trailing punctuation stripped, doi.org skipped', () => {
    const e = parseReferenceString('Dataset. Available: https://doi.org/10.5555/xyz123. Mirror: https://example.org/data).');
    assert.equal(e.doi, '10.5555/xyz123');
    assert.equal(e.url, 'https://example.org/data');
});

test('cleanDoi: extraction + trailing punctuation', () => {
    assert.equal(cleanDoi('see doi:10.1234/abc.567).'), '10.1234/abc.567');
    assert.equal(cleanDoi('no doi here'), null);
});

test('parseReferenceList: li items — string fields plus DOM-marked title and anchor ids', () => {
    const li1 = el(NLM, {
        // PMC wraps the WHOLE citation in <cite> — not a title.
        cite: [el(NLM)],
        a: [
            el('DOI link', {}, { href: 'https://doi.org/10.1056/NEJMoa2001017?utm_source=x' }),
            el('PubMed', {}, { href: 'https://pubmed.ncbi.nlm.nih.gov/31978945/' })
        ]
    });
    const li2 = el('Doe J. Widget dynamics in mice. J Widgetry. 2015;1:1-9.', {
        '.ref-title': [el('Widget dynamics in mice')]
    });
    const root = el('', { li: [li1, li2] });

    const { references, truncated } = parseReferenceList(root);
    assert.equal(truncated, false);
    assert.equal(references.length, 2);

    assert.equal(references[0].raw, NLM);
    assert.equal(references[0].title, undefined);   // whole-citation cite rejected
    assert.equal(references[0].doi, '10.1056/NEJMoa2001017');
    assert.equal(references[0].pmid, '31978945');
    assert.equal(references[0].year, 2020);

    assert.equal(references[1].title, 'Widget dynamics in mice');
    assert.equal(references[1].year, 2015);
});

test('parseReferenceList: anchors fill gaps the string missed; external url captured', () => {
    const li = el('Agency report, published online.', {
        a: [
            el('doi', {}, { href: 'https://doi.org/10.5555/rep2020' }),
            el('report', {}, { href: 'https://agency.example/report' }),
            el('local anchor', {}, { href: '#ref-5' })
        ]
    });
    const { references } = parseReferenceList(el('', { li: [li] }));
    assert.equal(references[0].doi, '10.5555/rep2020');
    assert.equal(references[0].url, 'https://agency.example/report');
});

test('title honesty: numbered-label + whole-citation cite is NOT a title; short italics are NOT titles', () => {
    // "1. " label makes the cite text a strict subset of raw — the
    // 0.8-of-raw + citation-plumbing guards must still reject it.
    const li1 = el('1. ' + NLM, { cite: [el(NLM)] });
    // Italicized journal name / species name — too short / too few words.
    const li2 = el('Doe J. On E. coli. Nature. 2001;410:1-2.', {
        i: [el('E. coli'), el('Nature')]
    });
    const { references } = parseReferenceList(el('', { li: [li1, li2] }));
    assert.equal(references[0].title, undefined);
    assert.equal(references[1].title, undefined);
});

test('title: a plausible italic title (subset of the citation, no plumbing) is accepted', () => {
    const raw = 'Doe J. A grand unified theory of widgets. Widget Press; 2010.';
    const li = el(raw, { i: [el('A grand unified theory of widgets')] });
    const { references } = parseReferenceList(el('', { li: [li] }));
    assert.equal(references[0].title, 'A grand unified theory of widgets');
});

test('authors: only DOM-marked; Vancouver comma list splits, et al dropped', () => {
    const li = el('Smith J, Jones B, et al. A paper. J. 2020;1:1.', {
        '.ref-authors': [el('Smith J, Jones B, et al.')]
    });
    const { references } = parseReferenceList(el('', { li: [li] }));
    assert.deepEqual(references[0].authors, ['Smith J', 'Jones B']);
});

test('authors: ambiguous "Surname, I." comma shape is rejected; unmarked prose never parsed', () => {
    const marked = el('Smith, J. A paper. 2020.', { '.ref-authors': [el('Smith, J.')] });
    const unmarked = el('Smith J, Jones B. A paper. J. 2020;1:1.');
    const { references } = parseReferenceList(el('', { li: [marked, unmarked] }));
    assert.equal(references[0].authors, undefined);
    assert.equal(references[1].authors, undefined);
});

test('parseReferenceList: .ref-cit-blk fallback when there are no li items', () => {
    const blocks = [
        el('Doe J. Legacy citation. J Old. 1999;1:1. PMID: 10500123.'),
        el('Roe R. Another one. J Old. 2001;2:2.')
    ];
    const root = el('', { '.ref-cit-blk': blocks });
    const { references, truncated } = parseReferenceList(root);
    assert.equal(truncated, false);
    assert.equal(references.length, 2);
    assert.equal(references[0].pmid, '10500123');
    assert.equal(references[0].year, 1999);
});

test('parseReferenceList: cap at 200 with an honest truncated flag', () => {
    const items = [];
    for (let i = 0; i < 205; i++) {
        items.push(el(`Doe J. Paper number ${i}. J Rep. 2020;1:${i}.`));
    }
    const { references, truncated } = parseReferenceList(el('', { li: items }));
    assert.equal(references.length, 200);
    assert.equal(truncated, true);
});

test('parseReferenceList: empty items skipped; junk items keep { raw } alone', () => {
    const { references } = parseReferenceList(el('', {
        li: [el('   \n  '), el('An unstructured note without any ids or dates')]
    }));
    assert.equal(references.length, 1);
    assert.deepEqual(references[0], { raw: 'An unstructured note without any ids or dates' });
});

test('parseReferenceList: null / selector-less / listless roots yield empty, not throw', () => {
    assert.deepEqual(parseReferenceList(null), { references: [], truncated: false });
    assert.deepEqual(parseReferenceList({}), { references: [], truncated: false });
    assert.deepEqual(parseReferenceList(el('some prose, no list items')), { references: [], truncated: false });
});

// ------------------------------------------------------------------
// Adversarial-review regressions (Phase 18 C2 verify pass). Each of
// these was a defect DEMONSTRATED against the first cut — the fixtures
// are the repros. Do not simplify them.
// ------------------------------------------------------------------

test('REGRESSION: a Google Scholar lookup anchor never becomes entry.url', () => {
    // Modern PMC decorates every reference with [DOI] [PubMed]
    // [PMC free article] [Google Scholar]; the Scholar SEARCH link was
    // landing in entry.url on essentially every reference.
    const anchor = (href) => el('link', {}, { href });
    const item = el('Zhu N, et al. A novel coronavirus. N Engl J Med. 2020;382:727.', {
        a: [
            anchor('https://scholar.google.com/scholar_lookup?journal=N+Engl+J+Med'),
            anchor('https://www.google.de/scholar?q=whatever'),
            anchor('https://publisher.example/article/727')
        ]
    });
    const { references } = parseReferenceList(el('', { li: [item] }));
    assert.equal(references[0].url, 'https://publisher.example/article/727',
        'citation-service chrome is not the referenced work\'s address');
});

test('REGRESSION: a year inside an Elsevier-style DOI does not beat the cited year', () => {
    const e = parseReferenceString(
        'Zhang X, et al. Widget results. Nature 2021;384:1-9. doi: 10.1016/j.vaccine.2015.03.022');
    assert.equal(e.year, 2021, 'the .2015 inside the DOI is an identifier, not a year');
    assert.equal(e.doi, '10.1016/j.vaccine.2015.03.022');
});

test('REGRESSION: the year fallback fires when no [.;(] separator precedes it', () => {
    // 'Nature 2021;384' — the year follows a SPACE, so the
    // citation-position regex misses and the bare-token fallback must
    // answer. This branch had zero coverage.
    const e = parseReferenceString('Zhang X, et al. Widget results. Nature 2021;384:1-9');
    assert.equal(e.year, 2021);
});

test('REGRESSION: a SICI DOI is omitted, never truncated at the "<"', () => {
    const e = parseReferenceString(
        'Smith A. Older paper. Cancer. 1996;78:747. doi:10.1002/1097-0142(19960815)78:4<747::AID-CNCR9>3.0.CO;2-D');
    assert.equal(e.doi, undefined,
        'a truncated DOI is a wrong identifier presented as real — absent is the honest answer');
    assert.equal(e.year, 1996);
});

test('REGRESSION: an italicized JOURNAL name is not adopted as the title', () => {
    // APA style italicizes journal names; the journal is the segment
    // the year/volume follows directly, and it was passing every guard.
    const raw = 'Doe J. Short title. American Journal of Epidemiology. 2015;1:1.';
    const item = el(raw, { i: [el('American Journal of Epidemiology')] });
    const { references } = parseReferenceList(el('', { li: [item] }));
    assert.equal(references[0].title, undefined);
    // …and a genuine italicized TITLE (followed by the journal, not
    // the year) still lands.
    const raw2 = 'Doe J. On widgets and their discontents. J Widget Stud. 2015;1:1.';
    const item2 = el(raw2, { i: [el('On widgets and their discontents')] });
    const r2 = parseReferenceList(el('', { li: [item2] }));
    assert.equal(r2.references[0].title, 'On widgets and their discontents');
});

test('REGRESSION: the 0.8 whole-citation guard holds without DOI/PMID masking it', () => {
    // Every earlier fixture also carried a DOI/PMID, so the plumbing
    // guard rejected the wrapper regardless and the length guard was
    // never actually load-bearing under test.
    const raw = 'Huang C, Wang Y. Clinical features of patients. Lancet. 2020;395:497-506.';
    const item = el(raw, { cite: [el(raw)] });   // <cite> wraps the WHOLE citation
    const { references } = parseReferenceList(el('', { li: [item] }));
    assert.equal(references[0].title, undefined,
        'a node spanning (nearly) the whole citation is a wrapper, not a title');
});

test('REGRESSION: inverted "Surname, Given" author lists bail instead of mis-splitting', () => {
    const item = (authors) =>
        el('Some citation. J Test. 2001;1:1.', { '.ref-authors': [el(authors)] });
    // 'Lovelace, Ada, and Charles Babbage' → ['Lovelace','Ada','and Charles Babbage'] pre-fix.
    const a = parseReferenceList(el('', { li: [item('Lovelace, Ada, and Charles Babbage')] }));
    assert.equal(a.references[0].authors, undefined, 'ambiguous inversion — absent, not mis-split');
    const b = parseReferenceList(el('', { li: [item('Lovelace, Ada.')] }));
    assert.equal(b.references[0].authors, undefined);
    // Full names separated by commas are unambiguous and still parse.
    const c = parseReferenceList(el('', { li: [item('Ada Lovelace, Charles Babbage')] }));
    assert.deepEqual(c.references[0].authors, ['Ada Lovelace', 'Charles Babbage']);
});

test('REGRESSION: semicolon-separated author lists split on the semicolon', () => {
    // The one shape where 'Surname, I.' IS safely splittable — the
    // semicolons disambiguate. This branch had zero coverage.
    const item = el('Some citation. J Test. 2001;1:1.', {
        '.ref-authors': [el('Smith, J.; Jones, B.; Kim, C.')]
    });
    const { references } = parseReferenceList(el('', { li: [item] }));
    assert.deepEqual(references[0].authors, ['Smith, J', 'Jones, B', 'Kim, C']);
});

test('REGRESSION: a list nested inside a reference item is not double-counted', () => {
    // Real querySelectorAll('li') is a DEEP search: the outer item's
    // textContent concatenates the nested citations (corrupt) and the
    // inner items repeat (double-count). Leaf items only.
    const inner = el('Roe R. Inner citation. J In. 2001;2:2.');
    inner.contains = () => false;
    const outer = el('Doe J. Outer citation. J Out. 1999;1:1. Roe R. Inner citation. J In. 2001;2:2.');
    outer.contains = (n) => n === inner;
    const { references } = parseReferenceList({
        querySelectorAll: (sel) => (sel === 'li' ? [outer, inner] : [])
    });
    assert.equal(references.length, 1);
    assert.equal(references[0].raw, 'Roe R. Inner citation. J In. 2001;2:2.',
        'the container entry (concatenated nested text) is dropped, the leaf kept');
});
