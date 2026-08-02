// R4a tests — cross-coverage language (founding-transcript
// integration; JOURNAL 2026-08-02). Pins: the join honors the
// captureArticleHash alias; parties/terms present in only ONE member
// are dropped (cross-coverage means cross); both sides of an asymmetry
// finding accrue to their own party; severities histogram; example
// caps disclose overflow; and the outputs carry distributions only —
// no mean, no score, nothing fused.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
    crossCoverageAsymmetry, definitionalDrift,
    MAX_EXAMPLES_PER_DIMENSION
} = await import('../src/shared/audit/cross-coverage.js');

const row = (url, hashes, title) => ({ url, title: title || `T ${url}`, article_hashes: hashes });

const asymRun = (hash, findings, extra = {}) => ({
    articleHash: hash,
    moduleResults: [{ module: 'asymmetric_language', findings: { asymmetry_findings: findings } }],
    ...extra
});
const asym = (a, b, over = {}) => ({
    dimension: 'sourcing_verbs', severity: 'high',
    party_a: a, party_a_term: 'claimed', evidence_quote_a: `${a} claimed X.`,
    party_b: b, party_b_term: 'explained', evidence_quote_b: `${b} explained Y.`,
    ...over
});

test('R4a asymmetry: cross-member accrual, both sides, alias join, single-member drop', () => {
    const out = crossCoverageAsymmetry({
        rows: [row('u1', ['h1']), row('u2', ['h2']), row('u3', ['h3'])],
        runs: [
            asymRun('h1', [asym('Dr. Smith', 'The Agency')]),
            asymRun('hX', [asym('dr. smith', 'The Agency')], { captureArticleHash: 'h2' }),
            asymRun('h3', [asym('Someone Else', 'Another Org')])
        ]
    });
    assert.equal(out.memberCount, 3);
    const smith = out.parties.find((p) => p.name === 'dr. smith');
    assert.ok(smith, 'name-normalized grouping across members (incl. alias-joined run)');
    assert.equal(smith.memberCount, 2);
    assert.equal(smith.findingCount, 2);
    assert.equal(smith.dimensions[0].dimension, 'sourcing_verbs');
    assert.equal(smith.dimensions[0].severities.high, 2);
    const agency = out.parties.find((p) => p.name === 'the agency');
    assert.ok(agency, 'party_b side accrues too');
    assert.ok(!out.parties.some((p) => p.name === 'someone else'),
        'single-member party dropped — cross-coverage means cross');
});

test('R4a asymmetry: example cap discloses overflow', () => {
    const many = Array.from({ length: MAX_EXAMPLES_PER_DIMENSION + 3 },
        (_, i) => asym('P', `Q${i}`));
    const out = crossCoverageAsymmetry({
        rows: [row('u1', ['h1']), row('u2', ['h2'])],
        runs: [asymRun('h1', many), asymRun('h2', [asym('P', 'Q')])]
    });
    const p = out.parties.find((x) => x.name === 'p');
    const d = p.dimensions[0];
    assert.equal(d.examples.length, MAX_EXAMPLES_PER_DIMENSION);
    assert.equal(d.overflow, d.count - MAX_EXAMPLES_PER_DIMENSION);
});

const termRun = (hash, terms) => ({
    articleHash: hash,
    moduleResults: [{ module: 'definitional_precision', findings: { contested_terms: terms } }]
});

test('R4a drift: quality histogram across members, absent-first ordering, single-member drop', () => {
    const out = definitionalDrift({
        rows: [row('u1', ['h1']), row('u2', ['h2']), row('u3', ['h3'])],
        runs: [
            termRun('h1', [
                { term: 'Extremism', load_bearing: true, defined_in_text: false,
                  definition_quality: 'absent', severity_if_undefined: 'high',
                  first_use_quote: 'rising extremism' },
                { term: 'lockdown', defined_in_text: true, definition_quality: 'explicit' }
            ]),
            termRun('h2', [
                { term: 'extremism', load_bearing: true, defined_in_text: true,
                  definition_quality: 'explicit', first_use_quote: 'extremism, defined as…' },
                { term: 'lockdown', defined_in_text: false, definition_quality: 'contextual' }
            ]),
            termRun('h3', [{ term: 'onlyonce', defined_in_text: false, definition_quality: 'absent' }])
        ]
    });
    const ext = out.terms.find((t) => t.term.toLowerCase() === 'extremism');
    assert.ok(ext);
    assert.equal(ext.memberCount, 2);
    assert.equal(ext.loadBearingCount, 2);
    assert.deepEqual(ext.quality, { explicit: 1, contextual: 0, absent: 1 },
        'the drift IS the finding: defined in one outlet, absent in another');
    assert.ok(!out.terms.some((t) => t.term === 'onlyonce'), 'single-member term dropped');
});

test('R4a: outputs are distributions only — no fused number anywhere', () => {
    const out = {
        a: crossCoverageAsymmetry({ rows: [row('u1', ['h1']), row('u2', ['h2'])],
            runs: [asymRun('h1', [asym('P', 'Q')]), asymRun('h2', [asym('P', 'Q')])] }),
        d: definitionalDrift({ rows: [], runs: [] })
    };
    const flat = JSON.stringify(out);
    for (const banned of ['mean', 'average', 'avg', 'fused', 'corpus_score']) {
        assert.ok(!flat.includes(banned), `output must not carry "${banned}"`);
    }
    assert.deepEqual(out.d, { terms: [], memberCount: 0 }, 'empty input degrades cleanly');
});
