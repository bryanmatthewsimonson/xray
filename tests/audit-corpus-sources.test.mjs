// R2 tests — corpus-aware source quality (founding-transcript
// integration; JOURNAL 2026-08-02). Pins: the source pick is
// deterministic-identity-only (never title suggestions), self-excluded,
// deduped, capped; excerpts are sliced with the truncation disclosed;
// the prompt section carries the step-7 contract; the module-04 schema
// accepts corpus_source_checks as OPTIONAL (1.0 results still
// validate); and CURRENT_MODULE_VERSIONS moves source_quality alone to
// 1.1 while the ceiling heuristic's version literal stays 1.0.

import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

const {
    pickCorpusSources, buildCorpusSourceEntries, corpusSourcesChars,
    gatherCorpusSources, memberIndexFromRecords, corpusSourcesForRecord,
    MAX_CORPUS_SOURCES, MAX_SOURCE_EXCERPT_CHARS
} = await import('../src/shared/audit/corpus-sources.js');
const { buildCorpusSourcesSection } = await import('../src/shared/audit/audit-prompt.js');
const {
    CURRENT_MODULE_VERSIONS, validateFindings
} = await import('../src/shared/audit/findings-schemas.js');

const member = (n, extra = {}) => ({
    articleHash: String(n).repeat(64).slice(0, 64),
    url: `https://site${n}.com/a`,
    title: `Member ${n}`,
    doi: null,
    ...extra
});
const resolved = (n, match = 'url', extra = {}) => ({
    status: 'resolved', member: member(n), match, display: `cited ${n}`, ...extra
});

// ------------------------------------------------------------------
// Pick + entries
// ------------------------------------------------------------------

test('R2 pick: resolved-only, self-excluded, deduped, capped, doi-first', () => {
    const rows = [
        resolved(1, 'url'),
        resolved(2, 'doi'),
        { status: 'suggested', member: member(3), match: 'title', display: 'x' },
        { status: 'capturable', member: null, match: null, display: 'y' },
        resolved(1, 'alias'),                       // dup of member 1
        resolved(4, 'url'),
        resolved(5, 'url'),
        resolved(6, 'url'),
        { ...resolved(7, 'url'), member: { ...member(7), articleHash: 'SELF'.padEnd(64, 'f') } }
    ];
    const picked = pickCorpusSources(rows, { selfHash: 'SELF'.padEnd(64, 'f') });
    assert.equal(picked.length, MAX_CORPUS_SOURCES);
    assert.equal(picked[0].match, 'doi', 'doi identity ranks first');
    assert.ok(!picked.some((p) => p.member.articleHash === 'SELF'.padEnd(64, 'f')), 'self excluded');
    assert.ok(!picked.some((p) => p.status !== 'resolved'), 'suggestions never attach');
    const hashes = picked.map((p) => p.member.articleHash);
    assert.equal(new Set(hashes).size, hashes.length, 'deduped by member');
});

test('R2 entries: excerpt slicing discloses truncation; empty bodies skipped', () => {
    const long = 'x'.repeat(MAX_SOURCE_EXCERPT_CHARS + 500);
    const entries = buildCorpusSourceEntries(
        [resolved(1), resolved(2)],
        (m) => (m.url.includes('site1') ? long : '   '));
    assert.equal(entries.length, 1, 'blank body skipped');
    assert.equal(entries[0].excerpt.length, MAX_SOURCE_EXCERPT_CHARS);
    assert.equal(entries[0].truncated, true);
    assert.equal(corpusSourcesChars(entries), MAX_SOURCE_EXCERPT_CHARS);
});

// ------------------------------------------------------------------
// Prompt section
// ------------------------------------------------------------------

test('R2 section: empty → empty string; entries → step-7 contract on the face', () => {
    assert.equal(buildCorpusSourcesSection([]), '');
    assert.equal(buildCorpusSourcesSection(null), '');
    const section = buildCorpusSourcesSection([
        { cited_as: 'the Smith study', member_url: 'https://j.org/p', member_title: 'Effects',
          match: 'doi', excerpt: 'SOURCE BODY', truncated: true }
    ]);
    assert.ok(section.includes('CORPUS-HELD CITED SOURCES'));
    assert.ok(section.includes('the Smith study'));
    assert.ok(section.includes('matched by doi'));
    assert.ok(section.includes('excerpt TRUNCATED'));
    assert.ok(section.includes('cannot_determine'), 'the when-in-doubt rule rides along');
    assert.ok(section.includes('SOURCE BODY'));
});

// ------------------------------------------------------------------
// Gather (reader path, injected io)
// ------------------------------------------------------------------

const GATHER_IO = (over = {}) => ({
    resolveActiveCaseRef: async () => ({ caseId: 'entity_case1' }),
    memberUrlSets: async () => ({ tagUrls: ['https://journal.org/paper'], claimUrls: [] }),
    getArticle: async (url) => ({
        url, articleHash: 'b'.repeat(64),
        article: { title: 'The Paper', scholar: { doi: '10.1/x' } }
    }),
    getArticleExtraction: async () => null,
    loadAliasMap: async () => ({}),
    resolveWithMap: (_m, u) => u,
    normalizeUrl: (u) => u,
    assembleBody: () => 'The source body text.',
    ...over
});

test('R2 gather: link to a member resolves into an attached excerpt', async () => {
    const out = await gatherCorpusSources({
        article: { url: 'https://outlet.com/story',
            links: [{ url: 'https://journal.org/paper', text: 'the study', internal: false }] },
        selfHash: 'a'.repeat(64),
        io: GATHER_IO()
    });
    assert.equal(out.memberCount, 1);
    assert.equal(out.entries.length, 1);
    assert.equal(out.entries[0].member_url, 'https://journal.org/paper');
    assert.equal(out.entries[0].excerpt, 'The source body text.');
});

test('R2 gather: no active case / io failure → empty, never throws', async () => {
    const none = await gatherCorpusSources({
        article: { links: [] }, io: GATHER_IO({ resolveActiveCaseRef: async () => null })
    });
    assert.deepEqual(none, { entries: [], memberCount: 0 });
    const boom = await gatherCorpusSources({
        article: { links: [] },
        io: GATHER_IO({ memberUrlSets: async () => { throw new Error('boom'); } })
    });
    assert.deepEqual(boom, { entries: [], memberCount: 0 });
});

// ------------------------------------------------------------------
// Record path (portal runner)
// ------------------------------------------------------------------

test('R2 record path: sibling resolution with self-exclusion', () => {
    const recs = [
        { url: 'https://a.com/1', articleHash: 'a'.repeat(64),
          article: { title: 'A', links: [{ url: 'https://b.com/2', text: 'cites B', internal: false }] } },
        { url: 'https://b.com/2', articleHash: 'b'.repeat(64),
          article: { title: 'B' } }
    ];
    const { members, recByHash } = memberIndexFromRecords(recs, (u) => u);
    assert.equal(members.length, 2);
    const entries = corpusSourcesForRecord(recs[0], {
        members, recByHash, aliasMap: {}, resolveWithMapFn: (_m, u) => u,
        extraction: null, assembleBody: (a) => `body of ${a.title}`, normalizeUrl: (u) => u
    });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].member_url, 'https://b.com/2');
    assert.equal(entries[0].excerpt, 'body of B');
    const selfEntries = corpusSourcesForRecord(recs[1], {
        members, recByHash, aliasMap: {}, resolveWithMapFn: (_m, u) => u,
        extraction: null, assembleBody: (a) => `body of ${a.title}`, normalizeUrl: (u) => u
    });
    assert.equal(selfEntries.length, 0, 'B cites nothing; nothing self-attaches');
});

// ------------------------------------------------------------------
// Schema + version
// ------------------------------------------------------------------

const SQ_BASE = () => ({
    module: 'source_quality', version: '1.1',
    sources: [], claim_to_source_map: [], single_sourced_contested_claims: [],
    primary_documents: [],
    summary: { total_sources: 0, named_count: 0, anonymous_count: 0,
        anonymous_justified_count: 0, expert_says_vague_count: 0,
        documents_cited: 0, documents_specifically_identified: 0 },
    score: 70, confidence: 0.8, auditor_caveats: []
});

test('R2 versions: source_quality is 1.1, every other module stays 1.0', () => {
    assert.equal(CURRENT_MODULE_VERSIONS.source_quality, '1.1');
    for (const [m, v] of Object.entries(CURRENT_MODULE_VERSIONS)) {
        if (m !== 'source_quality') assert.equal(v, '1.0', m);
    }
});

test('R2 schema: corpus_source_checks optional — 1.0-shaped results still validate', () => {
    const without = validateFindings('source_quality', SQ_BASE());
    assert.equal(without.valid, true, JSON.stringify(without.errors || []));
    const withChecks = validateFindings('source_quality', {
        ...SQ_BASE(),
        corpus_source_checks: [{
            cited_as: 'the Smith study', member_url: 'https://j.org/p',
            characterization: 'partially_accurate',
            note: 'drops the stated confidence interval',
            evidence_quote: 'the study proved X',
            source_quote: 'X is plausible (CI wide)'
        }]
    });
    assert.equal(withChecks.valid, true, JSON.stringify(withChecks.errors || []));
});

test('R2 schema: bad characterization enum and empty evidence_quote fail', () => {
    const badEnum = validateFindings('source_quality', {
        ...SQ_BASE(),
        corpus_source_checks: [{
            cited_as: 'x', member_url: 'u', characterization: 'true',
            evidence_quote: 'q'
        }]
    });
    assert.equal(badEnum.valid, false);
    const emptyQuote = validateFindings('source_quality', {
        ...SQ_BASE(),
        corpus_source_checks: [{
            cited_as: 'x', member_url: 'u', characterization: 'accurate',
            evidence_quote: ''
        }]
    });
    assert.equal(emptyQuote.valid, false, 'evidence-bound: empty quote is invalid (P3)');
});
