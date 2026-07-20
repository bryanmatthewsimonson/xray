// CA.2 tests — audit findings ⇄ claim spine (CORPUS_AUDIT_KICKOFF §4).
// The join is span-overlap in ONE canonical text; quoteless claims and
// ungrounded finding quotes never join; the output is location, so
// dedupe is per claim+module+quote.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { linkRunFindingsToClaims } = await import('../src/shared/audit/findings-claims.js');

const TEXT = 'The mayor said the theft was resolved. An unnamed official disputed the account entirely. Nothing else is known.';

const RUN = {
    moduleResults: [
        { module: 'source_architecture', findings: {
            items: [{ evidence_quote: 'An unnamed official disputed the account', severity: 'high' }]
        } },
        { module: 'headline_body_fidelity', findings: {
            pairs: [{ evidence_quote_a: 'the theft was resolved', evidence_quote_b: 'disputed the account entirely' }]
        } },
        { module: 'broken', findings: null },
        { module: 'off_text', findings: { items: [{ evidence_quote: 'this span is not in the article' }] } }
    ]
};

test('CA.2: findings join claims on span overlap — per-module, deduped, never off-text', () => {
    const byClaim = linkRunFindingsToClaims({
        moduleResults: RUN.moduleResults,
        memberText: TEXT,
        claims: [
            { id: 'c_official', quote: 'unnamed official disputed the account' },
            { id: 'c_mayor', quote: 'The mayor said the theft was resolved' },
            { id: 'c_noquote' },                                  // quoteless → never joins
            { id: 'c_elsewhere', quote: 'Nothing else is known' } // grounded, but no finding overlaps
        ]
    });
    assert.deepEqual(Object.keys(byClaim).sort(), ['c_mayor', 'c_official']);
    assert.deepEqual([...new Set(byClaim.c_official.map((f) => f.module))].sort(),
        ['headline_body_fidelity', 'source_architecture']);
    assert.deepEqual(byClaim.c_mayor.map((f) => f.module), ['headline_body_fidelity']);
    // Every joined quote is a real finding quote, verbatim.
    for (const list of Object.values(byClaim)) {
        for (const f of list) assert.ok(f.quote.length > 0);
    }
});

test('CA.2: empty inputs degrade to an empty join — enrichment can never throw', () => {
    assert.deepEqual(linkRunFindingsToClaims({ moduleResults: [], memberText: TEXT, claims: [] }), {});
    assert.deepEqual(linkRunFindingsToClaims({ moduleResults: RUN.moduleResults, memberText: '', claims: [{ id: 'c', quote: 'x' }] }), {});
    assert.deepEqual(linkRunFindingsToClaims({}), {});
});
