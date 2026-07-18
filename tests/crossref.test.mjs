// Crossref DOI-enrichment tests — Phase 18 C2
// (docs/COMPLEX_CONTENT_DESIGN.md §4.3). Pure module: no fetch, no
// chrome.*, no DOM — the fixture is a hand-built Crossref works
// response in the documented shape.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { crossrefRequestFor, mapCrossrefWork, applyCrossref } from '../src/shared/crossref.js';

// A realistic /works/<doi> response, per the documented Crossref
// shape: envelope { status, message-type, message }, message.title[],
// author[{family,given}], issued['date-parts'], container-title[].
const WORKS_RESPONSE = {
    status: 'ok',
    'message-type': 'work',
    'message-version': '1.0.0',
    message: {
        DOI: '10.1234/abc.567',
        type: 'journal-article',
        title: ['A Canonical Paper Title'],
        author: [
            { given: 'Ada', family: 'Lovelace', sequence: 'first', affiliation: [] },
            { given: 'Charles', family: 'Babbage', sequence: 'additional', affiliation: [] }
        ],
        'container-title': ['Journal of Examples'],
        publisher: 'Example University Press',
        'published-print': { 'date-parts': [[2026, 1, 15]] },
        issued: { 'date-parts': [[2025, 11]] }
    }
};

test('crossrefRequestFor: valid DOI -> percent-encoded works URL', () => {
    const req = crossrefRequestFor('10.1234/abc.567');
    assert.deepEqual(req, { url: 'https://api.crossref.org/works/10.1234%2Fabc.567' });

    // Characters that would break or truncate a raw URL get encoded.
    const hashy = crossrefRequestFor('10.1234/a#b(2026)');
    assert.ok(hashy.url.includes('%23'), 'hash is percent-encoded');
    assert.ok(hashy.url.startsWith('https://api.crossref.org/works/'), 'fixed base');

    // Surrounding whitespace is trimmed, not fatal.
    assert.ok(crossrefRequestFor('  10.1234/abc.567\n'));
});

test('crossrefRequestFor: junk -> null, never a URL from arbitrary input', () => {
    for (const junk of [
        null, undefined, 42, {}, '',
        'not a doi',
        '10.12/short-prefix',                 // registrant prefix needs 4-9 digits
        '10.1234/',                           // no suffix
        '10.1234/abc def',                    // interior whitespace
        '10.1234/abc"quote',                  // quotes
        "10.1234/abc'quote",
        '10.1234/<script>alert(1)</script>',  // angle brackets
        'https://doi.org/10.1234/abc.567'     // a URL is not a bare DOI
    ]) {
        assert.equal(crossrefRequestFor(junk), null, `rejects ${JSON.stringify(junk)}`);
    }
});

test('mapCrossrefWork: realistic works response maps fully', () => {
    const patch = mapCrossrefWork(WORKS_RESPONSE);
    assert.deepEqual(patch, {
        title: 'A Canonical Paper Title',
        authors: ['Ada Lovelace', 'Charles Babbage'],
        published: '2026-01-15',               // published-print wins over issued
        journal: 'Journal of Examples',
        publisher: 'Example University Press',
        type: 'journal-article'
    });

    // The bare message object (no envelope) is accepted too.
    assert.deepEqual(mapCrossrefWork(WORKS_RESPONSE.message), patch);
});

test('mapCrossrefWork: date-parts precision — year only, year+month', () => {
    const yearOnly = mapCrossrefWork({ message: { issued: { 'date-parts': [[2019]] } } });
    assert.deepEqual(yearOnly, { published: '2019' });

    const yearMonth = mapCrossrefWork({ message: { issued: { 'date-parts': [[2019, 3]] } } });
    assert.deepEqual(yearMonth, { published: '2019-03' });

    // published (online) is preferred over issued when print is absent.
    const online = mapCrossrefWork({
        message: {
            published: { 'date-parts': [[2020, 6, 2]] },
            issued: { 'date-parts': [[2020]] }
        }
    });
    assert.equal(online.published, '2020-06-02');
});

test('mapCrossrefWork: authors — family-only and organizational names', () => {
    const patch = mapCrossrefWork({
        message: {
            author: [
                { family: 'Plato' },
                { name: 'CERN Collaboration' },
                { affiliation: [] },            // neither name nor family: skipped
                'junk-entry'
            ]
        }
    });
    assert.deepEqual(patch, { authors: ['Plato', 'CERN Collaboration'] });
});

test('mapCrossrefWork: junk and partial input never throws', () => {
    for (const junk of [null, undefined, 'string', 42, [], { message: null },
        { message: 'nope' }, { message: [] }, {}]) {
        assert.equal(mapCrossrefWork(junk), null, `null for ${JSON.stringify(junk)}`);
    }

    // Partial message -> partial patch, absent fields absent.
    const partial = mapCrossrefWork({ message: { title: ['Only A Title'] } });
    assert.deepEqual(partial, { title: 'Only A Title' });

    // Wrong-typed fields are ignored, not fatal.
    const wrongTypes = mapCrossrefWork({
        message: {
            title: 'not-an-array',
            author: { family: 'not-an-array' },
            issued: { 'date-parts': 'nope' },
            'container-title': [42],
            publisher: ['not-a-string'],
            type: 'journal-article'
        }
    });
    assert.deepEqual(wrongTypes, { type: 'journal-article' });

    // Nothing mappable at all -> null, not {}.
    assert.equal(mapCrossrefWork({ message: { title: [] } }), null);
});

test('applyCrossref: fill-only-missing — the page always wins', () => {
    const scholar = {
        doi: '10.1234/abc.567',
        title: 'The Title As The Page Said It',
        authors: ['Page Author']
    };
    const patch = mapCrossrefWork(WORKS_RESPONSE);
    const out = applyCrossref(scholar, patch);

    assert.equal(out, scholar, 'same record back (mutated in place)');
    assert.equal(out.title, 'The Title As The Page Said It', 'page-provided title survives');
    assert.deepEqual(out.authors, ['Page Author'], 'page-provided authors survive');
    assert.equal(out.journal, 'Journal of Examples', 'missing journal filled');
    assert.equal(out.published, '2026-01-15', 'missing date filled');
    assert.equal(out.publisher, 'Example University Press');
    assert.equal(out.type, 'journal-article');
    assert.equal(out.crossref, true, 'provenance flag set when anything filled');
    assert.equal(out.doi, '10.1234/abc.567', 'doi untouched');
});

test('applyCrossref: empty-ish page fields count as missing', () => {
    const scholar = { doi: '10.1234/abc.567', journal: '  ', authors: [] };
    applyCrossref(scholar, { journal: 'Journal of Examples', authors: ['Ada Lovelace'] });
    assert.equal(scholar.journal, 'Journal of Examples');
    assert.deepEqual(scholar.authors, ['Ada Lovelace']);
    assert.equal(scholar.crossref, true);
});

test('applyCrossref: nothing filled -> no crossref flag; null patch -> unchanged', () => {
    const full = { doi: '10.1234/abc.567', title: 'T', authors: ['A'], published: '2026', journal: 'J', publisher: 'P', type: 'journal-article' };
    const before = { ...full };
    applyCrossref(full, { title: 'Other', journal: 'Other J' });
    assert.deepEqual(full, before, 'fully-provided record untouched');
    assert.equal(full.crossref, undefined, 'no provenance flag when nothing filled');

    const scholar = { doi: '10.1234/abc.567' };
    assert.equal(applyCrossref(scholar, null), scholar);
    assert.deepEqual(scholar, { doi: '10.1234/abc.567' });

    // Defensive: a falsy scholar record comes back as-is (the lookup
    // should never have run without one).
    assert.equal(applyCrossref(null, { title: 'T' }), null);
});
