// R1 tests — the references block's pure view-model seam
// (founding-transcript integration; JOURNAL 2026-08-02). The DOM layer
// is a 1:1 projection of `buildReferencesModel`, so these tests walk
// the model: candidates from all four substrates, cross-member
// resolution, self-citation guard, capturable/unknown dedup with
// cited-by accrual, and the distributions-only summary.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// Standard idiom: the module graph reaches Utils → CONFIG → chrome.
globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

const { buildReferencesModel } = await import('../src/portal/references-block.js');

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);

const UNITS = [
    { article_hash: HASH_A, url: 'https://outlet-one.com/story', title: 'How the outbreak spread through the region' },
    { article_hash: HASH_B, url: 'https://journal.org/paper', title: 'Effects of X on Y transmission in dense settings' },
    { article_hash: HASH_C, url: 'https://outlet-two.com/analysis', title: 'What the modeling actually showed officials' }
];

function makeArchive() {
    return new Map([
        ['https://outlet-one.com/story', { url: 'https://outlet-one.com/story', article: {
            links: [
                { url: 'https://journal.org/paper', text: 'the study', internal: false },
                { url: 'https://not-captured.com/memo', text: 'leaked memo', internal: false },
                { url: 'https://outlet-one.com/related', text: 'related', internal: true }
            ]
        } }],
        ['https://journal.org/paper', { url: 'https://journal.org/paper', article: {
            scholar: { doi: '10.1234/ABC' },
            references: [{ raw: 'Prior work', title: 'Annual surveillance methods', doi: '10.9/prior' }]
        } }],
        ['https://outlet-two.com/analysis', { url: 'https://outlet-two.com/analysis', article: {
            links: [{ url: 'https://not-captured.com/memo?utm_source=share', text: 'the memo', internal: false }]
        } }]
    ]);
}

test('R1 model: cross-member url resolution, capturable dedup + cited-by accrual', () => {
    const model = buildReferencesModel({
        units: UNITS, archiveByUrl: makeArchive(), auditRuns: [], extractionByHash: new Map()
    });
    // outlet-one links journal.org/paper, a member → resolved.
    assert.equal(model.resolved.length, 1);
    assert.equal(model.resolved[0].member.articleHash, HASH_B);
    assert.equal(model.resolved[0].match, 'url');
    // Both outlets cite the same uncaptured memo (one with tracking
    // params) → ONE capturable row, cited by 2 members.
    const memo = model.capturable.find((c) => c.captureUrl.includes('not-captured.com'));
    assert.ok(memo);
    assert.equal(memo.citedBy.length, 2);
    // journal's own reference list yields a DOI-addressable capturable.
    const prior = model.capturable.find((c) => c.captureUrl === 'https://doi.org/10.9/prior');
    assert.ok(prior, 'doi-only reference becomes capturable via doi.org');
    assert.equal(model.summary.capturable, 2);
    assert.equal(model.summary.resolved, 1);
});

test('R1 model: DOI resolution across members; self-citation guarded', () => {
    const archive = makeArchive();
    // outlet-two's audit found the study as a cited document w/ DOI —
    // resolves to the journal member by DOI even with no link.
    const runs = [{
        articleHash: HASH_C,
        moduleResults: [{ module: 'source_quality', findings: {
            primary_documents: [{ document: 'the Effects study (doi:10.1234/abc)',
                linked_or_quoted: false, specific_enough_to_retrieve: true,
                evidence_quote: 'a study estimated' }],
            sources: []
        } }]
    }, {
        // the journal member's own scholar DOI appearing in its own
        // audit must NOT resolve to itself.
        articleHash: HASH_B,
        moduleResults: [{ module: 'source_quality', findings: {
            primary_documents: [{ document: 'this study (10.1234/abc)',
                linked_or_quoted: true, specific_enough_to_retrieve: true,
                evidence_quote: 'we estimate' }],
            sources: []
        } }]
    }];
    const model = buildReferencesModel({
        units: UNITS, archiveByUrl: archive, auditRuns: runs, extractionByHash: new Map()
    });
    const doiResolved = model.resolved.filter((r) => r.match === 'doi');
    assert.equal(doiResolved.length, 1, 'outlet-two resolves; journal self-citation skipped');
    assert.equal(doiResolved[0].member.articleHash, HASH_B);
    assert.equal(doiResolved[0].citedBy, 'What the modeling actually showed officials');
});

test('R1 model: map-source hints — url resolves via alias healing, prose goes unknown', () => {
    const extraction = new Map([[HASH_A, { sources: [
        { quote: 'as the archived analysis noted', target_hint: 'https://archive.example/xyz' },
        { quote: 'a leaked internal memo shows', target_hint: 'internal agency memo, May 2020' }
    ] }]]);
    const model = buildReferencesModel({
        units: UNITS,
        archiveByUrl: makeArchive(),
        auditRuns: [],
        extractionByHash: extraction,
        heal: (u) => (u.includes('archive.example') ? 'https://outlet-two.com/analysis' : u)
    });
    const aliasResolved = model.resolved.find((r) => r.match === 'alias');
    assert.ok(aliasResolved, 'archive-hosted hint heals to a member url');
    assert.equal(aliasResolved.member.articleHash, HASH_C);
    const memoMention = model.unknown.find((u) => u.display.includes('internal agency memo'));
    assert.ok(memoMention, 'prose-only mention lands in unknown (coverage gap)');
    assert.deepEqual(memoMention.origins, ['map-source']);
});

test('R1 model: title similarity is suggested, never resolved; summary is counts only', () => {
    const extraction = new Map([[HASH_A, { sources: [
        { quote: 'per the transmission study', target_hint: 'Effects of X on Y transmission in dense settings (preprint)' }
    ] }]]);
    const model = buildReferencesModel({
        units: UNITS, archiveByUrl: makeArchive(), auditRuns: [], extractionByHash: extraction
    });
    const sug = model.suggested.find((s) => s.member && s.member.articleHash === HASH_B);
    assert.ok(sug, 'close title yields a suggestion');
    assert.equal(sug.match, 'title');
    assert.ok(sug.score >= 0.8);
    assert.ok(!model.resolved.some((r) => r.match === 'title'), 'title tier never asserts resolved');

    const flat = JSON.stringify(model.summary);
    for (const banned of ['mean', 'average', 'score"', 'fused']) {
        assert.ok(!flat.includes(banned), `summary must not carry "${banned}"`);
    }
});

test('R1 model: empty corpus → empty model, zero total', () => {
    const model = buildReferencesModel({ units: [], archiveByUrl: new Map() });
    assert.equal(model.summary.total, 0);
    assert.deepEqual(model.resolved, []);
    assert.deepEqual(model.capturable, []);
});
