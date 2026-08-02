// R5/OP.4 tests — the corpus runner audits each member under its own
// family, and the derived corpus surfaces consume opinion payloads.
// Pins: planCorpusAudit stamps family + the OQ.4 forced flag per
// member; an opinion run's asymmetric-language findings join the
// cross-coverage view exactly like a news run's (the joins are
// payload-driven, not family-gated); and known-unknowns tolerates
// runs with no source_quality module (opinion members contribute
// caveats only, never phantom unknowns).

import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

const { planCorpusAudit } = await import('../src/shared/audit/corpus-audit.js');
const { crossCoverageAsymmetry } = await import('../src/shared/audit/cross-coverage.js');
const { collectKnownUnknowns } = await import('../src/shared/audit/known-unknowns.js');

const rec = (url, body, articleOver = {}) => ({
    url, articleHash: null,
    article: { title: url, content: body, ...articleOver }
});

test('OP.4 plan: family + forcedOpinion stamped per member', async () => {
    const plan = await planCorpusAudit({
        records: [
            rec('https://a.com/news', 'Body text one.', { structuredData: { type: 'NewsArticle' } }),
            rec('https://b.com/oped', 'Body text two.', { structuredData: { type: 'OpinionPiece' } }),
            rec('https://c.com/forced', 'Body text three.', {
                source_type: 'reporting', structuredData: { type: 'OpinionPiece' } })
        ],
        runs: []
    });
    const by = Object.fromEntries(plan.pending.map((m) => [m.url, m]));
    assert.equal(by['https://a.com/news'].family, 'news');
    assert.equal(by['https://a.com/news'].forcedOpinion, false);
    assert.equal(by['https://b.com/oped'].family, 'opinion');
    assert.equal(by['https://b.com/oped'].forcedOpinion, false);
    assert.equal(by['https://c.com/forced'].family, 'news',
        'OQ.4: the declared type routes the family');
    assert.equal(by['https://c.com/forced'].forcedOpinion, true,
        '…and the forced flag keeps the caveat on it');
});

const row = (url, hashes) => ({ url, title: url, article_hashes: hashes });
const asymFinding = {
    dimension: 'sourcing_verbs', severity: 'high',
    party_a: 'Dr. Smith', party_a_term: 'claimed', evidence_quote_a: 'Smith claimed X.',
    party_b: 'The Agency', party_b_term: 'explained', evidence_quote_b: 'The Agency explained Y.'
};

test('OP.4 joins: an opinion run\'s asymmetry findings join cross-coverage like news', () => {
    const out = crossCoverageAsymmetry({
        rows: [row('u1', ['h1']), row('u2', ['h2'])],
        runs: [
            {   // a NEWS run
                articleHash: 'h1',
                moduleResults: [{ module: 'asymmetric_language', findings: { asymmetry_findings: [asymFinding] } }]
            },
            {   // an OPINION run — same module, different roster around it
                articleHash: 'h2',
                moduleResults: [
                    { module: 'premise_accuracy', findings: { premises: [], summary: {} } },
                    { module: 'asymmetric_language', findings: { asymmetry_findings: [asymFinding] } }
                ]
            }
        ]
    });
    const smith = out.parties.find((p) => p.name === 'dr. smith');
    assert.ok(smith, 'party present');
    assert.equal(smith.memberCount, 2, 'both families feed the same cross-coverage view');
});

test('OP.4 joins: known-unknowns tolerates opinion runs (no module 04 → caveats only)', () => {
    const ku = collectKnownUnknowns({
        rows: [row('u1', ['h1'])],
        runs: [{
            articleHash: 'h1',
            moduleResults: [
                { module: 'premise_accuracy', findings: {}, auditor_caveats: ['discourse familiarity limited'] },
                { module: 'logical_validity', findings: {}, auditor_caveats: [] }
            ]
        }]
    });
    assert.equal(ku.members.length, 1);
    assert.deepEqual(ku.totals, { anonymousBare: 0, singleSourced: 0, unretrievableDocs: 0, vague: 0 },
        'no phantom source-quality unknowns from a roster that has no module 04');
    assert.deepEqual(ku.members[0].caveats.items, ['discourse familiarity limited']);
});
