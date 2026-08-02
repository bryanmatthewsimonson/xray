// R1 tests — the reference resolver (founding-transcript integration;
// JOURNAL 2026-08-02). Candidates dedup across the four substrates on
// DOI > URL > title identity; resolution is deterministic-first
// (doi/url/alias), title similarity only ever SUGGESTS, and anything
// addressable-but-absent comes back capturable so the import path can
// ingest it. Pure module — no chrome, no storage, no network.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
    collectReferenceCandidates,
    resolveReferenceCandidates,
    summarizeReferenceResolution,
    extractDoi,
    titleSimilarity,
    TITLE_MATCH_MIN,
    MIN_TITLE_TOKENS
} = await import('../src/shared/reference-resolver.js');

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

test('extractDoi: bare, doi.org URL, trailing punctuation, absent', () => {
    assert.equal(extractDoi('see 10.1234/abc.DEF-5 for details'), '10.1234/abc.def-5');
    assert.equal(extractDoi('https://doi.org/10.1101/2020.09.01.278903'), '10.1101/2020.09.01.278903');
    assert.equal(extractDoi('(10.5555/xyz).'), '10.5555/xyz');
    assert.equal(extractDoi('no identifiers here'), null);
    assert.equal(extractDoi(''), null);
});

test('titleSimilarity: identical, case/punct-insensitive, disjoint, empty', () => {
    assert.equal(titleSimilarity('The Great Barrington Declaration', 'the great barrington declaration!'), 1);
    assert.equal(titleSimilarity('alpha beta', 'gamma delta'), 0);
    assert.equal(titleSimilarity('', 'anything'), 0);
    const partial = titleSimilarity('lockdown effects on transmission', 'lockdown effects on mortality');
    assert.ok(partial > 0 && partial < 1);
});

// ------------------------------------------------------------------
// Candidate collection
// ------------------------------------------------------------------

test('collect: internal links skipped, external kept, DOI parsed from link URL', () => {
    const out = collectReferenceCandidates({
        links: [
            { url: 'https://same-site.com/related', text: 'related', internal: true },
            { url: 'https://doi.org/10.1234/abc', text: 'the study', internal: false },
            { url: 'https://other.com/report', text: 'report', internal: false }
        ]
    });
    assert.equal(out.length, 2);
    const doiOne = out.find((c) => c.doi === '10.1234/abc');
    assert.ok(doiOne, 'doi extracted from doi.org link');
    assert.deepEqual(doiOne.origins, ['link']);
});

test('collect: same identity across substrates merges into one candidate', () => {
    const out = collectReferenceCandidates({
        links: [{ url: 'https://doi.org/10.1234/abc', text: 'study link', internal: false }],
        references: [{ raw: 'Smith 2020', title: 'Effects of X on Y', doi: '10.1234/ABC' }],
        auditDocuments: [{ document: 'the Smith study (10.1234/abc)', linked_or_quoted: true,
            specific_enough_to_retrieve: true, evidence_quote: 'according to the study' }]
    });
    assert.equal(out.length, 1, 'DOI identity unifies all three sightings');
    const c = out[0];
    assert.deepEqual([...c.origins].sort(), ['audit-document', 'link', 'reference-list']);
    assert.equal(c.doi, '10.1234/abc');
    assert.equal(c.title, 'Effects of X on Y', 'first non-null title wins');
    assert.equal(c.retrievable, true);
    assert.equal(c.quote, 'according to the study');
});

test('collect: map-source target_hint splits URL-ish vs prose; quote-only rows kept', () => {
    const out = collectReferenceCandidates({
        mapSources: [
            { quote: 'as the Times reported', target_hint: 'https://nytimes.com/2020/story' },
            { quote: 'a leaked memo shows', target_hint: 'internal CDC memo, May 2020' },
            { quote: 'officials pointed to modeling', target_hint: '' }
        ]
    });
    assert.equal(out.length, 3);
    assert.ok(out.find((c) => c.url === 'https://nytimes.com/2020/story'));
    const prose = out.find((c) => c.title === 'internal CDC memo, May 2020');
    assert.ok(prose && prose.url === null);
    const quoteOnly = out.find((c) => c.display === 'officials pointed to modeling');
    assert.ok(quoteOnly, 'quote-only source reference survives as an unknown-shaped candidate');
});

test('collect: audit sources — only document/study types become candidates', () => {
    const out = collectReferenceCandidates({
        auditSources: [
            { label: 'the leaked slide deck', type: 'document_cited', evidence_quote: 'a slide deck shows' },
            { label: 'Dr. A. Expert', type: 'named_primary', evidence_quote: 'Dr. Expert said' },
            { label: 'a 2019 modeling study', type: 'study_cited', evidence_quote: 'a study estimated' }
        ]
    });
    assert.equal(out.length, 2);
    assert.ok(out.every((c) => c.origins.includes('audit-document')));
});

// ------------------------------------------------------------------
// Resolution
// ------------------------------------------------------------------

const MEMBERS = [
    { articleHash: 'h1', url: 'https://nytimes.com/2020/story', title: 'How the outbreak spread through the region' },
    { articleHash: 'h2', url: 'https://journal.org/paper', title: 'Effects of X on Y transmission in dense settings', doi: '10.1234/abc' },
    { articleHash: 'h3', url: 'https://gov.example/report', title: 'Annual epidemiological surveillance report 2020' }
];

test('resolve: DOI beats URL; normalized URL matches; alias healing matches', () => {
    const rows = resolveReferenceCandidates(
        [
            { key: 'doi:10.1234/abc', origins: ['reference-list'], url: 'https://elsewhere.com/mirror', doi: '10.1234/abc', title: null, display: 'the paper' },
            { key: 'url:a', origins: ['link'], url: 'https://nytimes.com/2020/story?utm_source=tw', doi: null, title: null, display: 'story' },
            { key: 'url:b', origins: ['link'], url: 'https://archive.example/xyz', doi: null, title: null, display: 'archived' }
        ],
        MEMBERS,
        { resolve: (u) => (u.includes('archive.example') ? 'https://gov.example/report' : u) }
    );
    assert.equal(rows[0].status, 'resolved');
    assert.equal(rows[0].match, 'doi');
    assert.equal(rows[0].member.articleHash, 'h2');
    assert.equal(rows[1].status, 'resolved', 'tracking params normalized away');
    assert.equal(rows[1].match, 'url');
    assert.equal(rows[2].status, 'resolved');
    assert.equal(rows[2].match, 'alias');
    assert.equal(rows[2].member.articleHash, 'h3');
});

test('resolve: title tier only SUGGESTS, respects floors, never asserts', () => {
    const close = resolveReferenceCandidates(
        [{ key: 't:x', origins: ['audit-document'], url: null, doi: null,
            title: 'effects of X on Y transmission in dense settings (2020)', display: 'the study' }],
        MEMBERS
    );
    assert.equal(close[0].status, 'suggested');
    assert.equal(close[0].match, 'title');
    assert.ok(close[0].score >= TITLE_MATCH_MIN);
    assert.equal(close[0].member.articleHash, 'h2');

    const short = resolveReferenceCandidates(
        [{ key: 't:y', origins: ['audit-document'], url: null, doi: null,
            title: 'surveillance report', display: 'report' }],
        MEMBERS
    );
    assert.equal(short[0].status, 'unknown',
        `below MIN_TITLE_TOKENS (${MIN_TITLE_TOKENS}) the title tier refuses to run`);

    const far = resolveReferenceCandidates(
        [{ key: 't:z', origins: ['map-source'], url: null, doi: null,
            title: 'completely unrelated policy analysis of municipal budgets', display: 'x' }],
        MEMBERS
    );
    assert.equal(far[0].status, 'unknown');
    assert.equal(far[0].member, null);
});

test('resolve: unresolved-but-addressable is capturable (url, or doi → doi.org)', () => {
    const rows = resolveReferenceCandidates(
        [
            { key: 'url:c', origins: ['link'], url: 'https://not-captured.com/piece', doi: null, title: null, display: 'piece' },
            { key: 'doi:10.9/z', origins: ['reference-list'], url: null, doi: '10.9/z', title: null, display: 'paper z' },
            { key: 't:memo', origins: ['map-source'], url: null, doi: null, title: 'internal CDC memo, May 2020', display: 'memo' }
        ],
        MEMBERS
    );
    assert.equal(rows[0].status, 'capturable');
    assert.equal(rows[0].captureUrl, 'https://not-captured.com/piece');
    assert.equal(rows[1].status, 'capturable');
    assert.equal(rows[1].captureUrl, 'https://doi.org/10.9/z');
    assert.equal(rows[2].status, 'unknown');
    assert.equal(rows[2].captureUrl, null);
});

test('summary: counts by status and origin, never a score', () => {
    const rows = resolveReferenceCandidates(
        [
            { key: 'a', origins: ['link'], url: 'https://nytimes.com/2020/story', doi: null, title: null, display: 's' },
            { key: 'b', origins: ['link', 'map-source'], url: 'https://not-captured.com/x', doi: null, title: null, display: 'x' },
            { key: 'c', origins: ['audit-document'], url: null, doi: null, title: 'internal memo', display: 'm' }
        ],
        MEMBERS
    );
    const sum = summarizeReferenceResolution(rows);
    assert.equal(sum.total, 3);
    assert.equal(sum.resolved, 1);
    assert.equal(sum.capturable, 1);
    assert.equal(sum.unknown, 1);
    assert.deepEqual(sum.byOrigin, { link: 2, 'map-source': 1, 'audit-document': 1 });
    assert.ok(!('mean' in sum) && !('score' in sum), 'distributions only');
});
