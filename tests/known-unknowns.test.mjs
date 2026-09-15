// R9 tests — the known-unknowns record (founding-transcript
// integration; JOURNAL 2026-08-02). Pins: the four unknown families
// extract from module-04 findings; mechanical run-mode caveats (the
// single-shot and opinion standing disclosures, absent-module notes,
// confidence normalizations) are filtered while article-level caveats
// survive; caps disclose overflow; members without unknowns stay out;
// coverage gaps pass through; and nothing in the output is a score.

import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

const { collectKnownUnknowns, MAX_ITEMS_PER_LIST } = await import('../src/shared/audit/known-unknowns.js');
const { STANDING_OPINION_CAVEAT } = await import('../src/shared/audit/assemble.js');
const { STANDING_SINGLE_SHOT_CAVEAT } = await import('../src/shared/audit/audit-prompt.js');

const row = (url, hashes, title) => ({ url, title: title || url, article_hashes: hashes });

const sqRun = (hash, findings, caveats = []) => ({
    articleHash: hash,
    moduleResults: [
        { module: 'source_quality', findings, auditor_caveats: caveats },
        { module: 'omission', findings: {}, auditor_caveats: caveats }
    ]
});

test('R9: the four families extract; clean members stay out', () => {
    const ku = collectKnownUnknowns({
        rows: [row('u1', ['h1']), row('u2', ['h2'])],
        runs: [
            sqRun('h1', {
                sources: [
                    { label: 'a source', type: 'anonymous_bare', evidence_quote: 'a source said' },
                    { label: 'Dr. Named', type: 'named_primary', evidence_quote: 'said Dr. Named' },
                    { label: 'experts', type: 'expert_says_vague', evidence_quote: 'experts say' }
                ],
                single_sourced_contested_claims: [
                    { claim: 'X ordered it', source_id: 0, source_type: 'anonymous_bare', evidence_quote: 'a source said X ordered it' }
                ],
                primary_documents: [
                    { document: 'the memo', linked_or_quoted: false, specific_enough_to_retrieve: false, evidence_quote: 'an internal memo' },
                    { document: 'the filing', linked_or_quoted: true, specific_enough_to_retrieve: true, evidence_quote: 'the court filing' }
                ]
            }),
            sqRun('h2', { sources: [{ label: 'On Record', type: 'named_primary', evidence_quote: 'q' }] })
        ]
    });
    assert.equal(ku.auditedCount, 2);
    assert.equal(ku.members.length, 1, 'the clean member stays out');
    const m = ku.members[0];
    assert.equal(m.anonymousBare.items.length, 1);
    assert.equal(m.singleSourced.items.length, 1);
    assert.equal(m.unretrievableDocs.items.length, 1, 'fully-retrievable doc excluded');
    assert.equal(m.vagueCount, 1);
    assert.deepEqual(ku.totals, { anonymousBare: 1, singleSourced: 1, unretrievableDocs: 1, vague: 1 });
});

test('R9: mechanical caveats filtered, article caveats kept and deduped', () => {
    const ku = collectKnownUnknowns({
        rows: [row('u1', ['h1'])],
        runs: [sqRun('h1', {}, [
            STANDING_SINGLE_SHOT_CAVEAT,
            STANDING_OPINION_CAVEAT,
            'module absent from model output',
            'confidence 3 was out of range and normalized into 0.0-1.0',
            'cannot verify the actual quality of anonymous sources from the article alone'
        ])]
    });
    assert.equal(ku.members.length, 1);
    assert.deepEqual(ku.members[0].caveats.items,
        ['cannot verify the actual quality of anonymous sources from the article alone'],
        'run-mode disclosures are not article unknowns; duplicates across modules collapse');
});

test('R9: caps disclose overflow; coverage gaps pass through; alias join', () => {
    const many = Array.from({ length: MAX_ITEMS_PER_LIST + 2 }, (_, i) => ({
        label: `anon ${i}`, type: 'anonymous_bare', evidence_quote: `q${i}`
    }));
    const ku = collectKnownUnknowns({
        rows: [row('u1', ['h1'])],
        runs: [{ ...sqRun('hX', { sources: many }), captureArticleHash: 'h1' }],
        coverageGaps: ['no dissenting virologist coverage', '', 42]
    });
    assert.equal(ku.members[0].anonymousBare.items.length, MAX_ITEMS_PER_LIST);
    assert.equal(ku.members[0].anonymousBare.overflow, 2);
    assert.deepEqual(ku.coverageGaps, ['no dissenting virologist coverage'],
        'non-string gaps dropped, capture alias joined');
});

test('R9: no score anywhere; empty input degrades', () => {
    const empty = collectKnownUnknowns({});
    assert.deepEqual(empty.members, []);
    assert.equal(empty.auditedCount, 0);
    const flat = JSON.stringify(collectKnownUnknowns({
        rows: [row('u1', ['h1'])],
        runs: [sqRun('h1', { sources: [{ label: 'a', type: 'anonymous_bare', evidence_quote: 'q' }] })]
    }));
    for (const banned of ['score', 'mean', 'average', 'fused']) {
        assert.ok(!flat.includes(banned), `output must not carry "${banned}"`);
    }
});

// ------------------------------------------------------------------
// Data tolerance — field bug 2026-08-30 (maintainer diagnostics, three
// occurrences): "Known-unknowns block failed (f.primary_documents ||
// []).filter is not a function". A stored module-04 finding carried a
// STRING in primary_documents; `|| []` admits any truthy value, so the
// portal block threw and removed itself. Stored malformed records must
// render degraded, never crash the block.
// ------------------------------------------------------------------

// The hostile fixture: every list-typed finding field in a wrong-but-
// truthy shape, beside ONE well-formed unknown that must survive.
const HOSTILE_FINDINGS = {
    primary_documents: 'an internal memo the reporter never saw',      // the observed crash
    single_sourced_contested_claims: 7,
    sources: [
        { label: 'a source', type: 'anonymous_bare', evidence_quote: 'a source said' },
        'a bare string in the sources list',
        null,
        42,
        { label: 9, type: 'anonymous_bare', evidence_quote: { nested: true } }   // wrong scalar types
    ]
};

test('tolerance: primary_documents as a string renders degraded instead of throwing (the 2026-08-30 crash)', () => {
    let ku;
    assert.doesNotThrow(() => {
        ku = collectKnownUnknowns({
            rows: [row('u1', ['h1'], 'Hostile member')],
            runs: [sqRun('h1', HOSTILE_FINDINGS)]
        });
    });
    assert.equal(ku.auditedCount, 1);
    assert.equal(ku.members.length, 1, 'the member still renders its well-formed unknowns');
    const m = ku.members[0];
    assert.equal(m.unretrievableDocs.items.length, 0, 'a string primary_documents reads as no documents, not as characters');
    assert.equal(m.singleSourced.items.length, 0, 'a numeric list reads as empty');
    assert.equal(m.anonymousBare.items.length, 2, 'well-formed and wrong-scalar rows both survive; non-object rows drop');
    assert.deepEqual(m.anonymousBare.items[0], { label: 'a source', quote: 'a source said' });
    assert.deepEqual(m.anonymousBare.items[1], { label: '', quote: '' },
        'non-string scalars degrade to empty strings — the renderer slices these');
    assert.deepEqual(ku.totals, { anonymousBare: 2, singleSourced: 0, unretrievableDocs: 0, vague: 0 });
});

test('tolerance: every stored list slot — moduleResults, findings, auditor_caveats, coverage_gaps, runs, rows', () => {
    const hostileRuns = [
        // findings payload is a string; caveats is a string (iterable — must NOT become per-character caveats)
        { articleHash: 'h1', moduleResults: [
            { module: 'source_quality', findings: 'not an object', auditor_caveats: 'one caveat as a string' },
            { module: 'omission', findings: {}, auditor_caveats: { not: 'a list' } },
            'a string where a module result should be',
            null
        ] },
        // moduleResults is an object, not an array
        { articleHash: 'h2', moduleResults: { module: 'source_quality', findings: {} } },
        // a run that is not an object at all
        'garbage run',
        null,
        // a healthy run beside the hostile ones
        sqRun('h3', { sources: [{ label: 'x', type: 'expert_says_vague', evidence_quote: 'experts say' }] },
            ['cannot verify anonymous sources from the article alone'])
    ];
    let ku;
    assert.doesNotThrow(() => {
        ku = collectKnownUnknowns({
            rows: [row('u1', ['h1']), row('u2', ['h2']), row('u3', ['h3']), 'not a row', null],
            runs: hostileRuns,
            coverageGaps: 'a single gap as a string'
        });
    });
    assert.equal(ku.auditedCount, 3, 'all three joined; malformed rows and runs skipped');
    assert.equal(ku.members.length, 1, 'only the healthy member carries unknowns');
    assert.equal(ku.members[0].url, 'u3');
    assert.equal(ku.members[0].vagueCount, 1);
    assert.deepEqual(ku.members[0].caveats.items, ['cannot verify anonymous sources from the article alone']);
    assert.deepEqual(ku.coverageGaps, [], 'a string coverage_gaps reads as no gaps, not as characters');

    // Non-array container inputs never throw either.
    assert.doesNotThrow(() => collectKnownUnknowns({ rows: 'rows', runs: { h1: {} }, coverageGaps: 5 }));
    assert.deepEqual(collectKnownUnknowns({ rows: 'rows', runs: { h1: {} }, coverageGaps: 5 }).members, []);
});

test('tolerance: the well-formed shape is byte-identical to before (no behavior drift)', () => {
    const before = collectKnownUnknowns({
        rows: [row('u1', ['h1'], 'T')],
        runs: [sqRun('h1', {
            sources: [{ label: 'a source', type: 'anonymous_bare', evidence_quote: 'q' }],
            single_sourced_contested_claims: [{ claim: 'C', source_id: 0, source_type: 'anonymous_bare', evidence_quote: 'q2' }],
            primary_documents: [{ document: 'the memo', linked_or_quoted: false, specific_enough_to_retrieve: true, evidence_quote: 'q3' }]
        })]
    });
    assert.deepEqual(before.members[0].unretrievableDocs.items,
        [{ document: 'the memo', linked: false, retrievable: true, quote: 'q3' }]);
    assert.deepEqual(before.members[0].singleSourced.items,
        [{ claim: 'C', sourceType: 'anonymous_bare', quote: 'q2' }]);
    assert.deepEqual(before.members[0].anonymousBare.items, [{ label: 'a source', quote: 'q' }]);
    assert.equal(before.members[0].title, 'T');
});
