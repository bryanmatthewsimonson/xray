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
