// CA.3 tests — the corpus epistemics rollup (CORPUS_AUDIT_KICKOFF §4).
// The join honors the captureArticleHash alias, and ordering puts the
// weak end first.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { corpusAuditRollup } = await import('../src/shared/audit/corpus-rollup.js');

const run = (hash, score, extra = {}) => ({
    articleHash: hash,
    aggregate: { final_score: score, overall_confidence: 0.8, knowability_ceiling: 90,
                 ceiling_binding: false, top_concerns: ['a'], ...extra.aggregate },
    moduleResults: extra.moduleResults || [
        { module: 'source_architecture', score: score - 5 },
        { module: 'headline_body_fidelity', score: score + 5 }
    ],
    ...extra
});
const row = (url, hashes) => ({ url, title: `T ${url}`, article_hashes: hashes });

test('CA.3: rollup — alias join, lowest-first order, module ranges, honest coverage', () => {
    const roll = corpusAuditRollup({
        rows: [
            row('https://x/a', ['h1']),
            row('https://x/b', ['h2']),
            row('https://x/c', ['h3']),          // audited via alias
            row('https://x/d', ['h4'])           // unaudited
        ],
        runs: [
            run('h1', 70),
            run('h2', 40, { aggregate: { final_score: 40, ceiling_binding: true, knowability_ceiling: 45, overall_confidence: 0.6, top_concerns: [] } }),
            run('hX', 55, { captureArticleHash: 'h3' })
        ]
    });
    assert.equal(roll.audited, 3);
    assert.equal(roll.unaudited, 1);
    assert.deepEqual(roll.members.map((m) => m.score), [40, 55, 70], 'weak end first');
    assert.deepEqual(roll.scoreRange, { min: 40, max: 70, scores: [40, 55, 70] });
    assert.equal(roll.ceilingBound, 1);
    const src = roll.modules.find((m) => m.module === 'source_architecture');
    assert.deepEqual({ min: src.min, max: src.max, n: src.n }, { min: 35, max: 65, n: 3 });
    // Weakest-minimum module first.
    assert.equal(roll.modules[0].module, 'source_architecture');
});

test('CA.3: empty input degrades to an honest zero, not a fabricated range', () => {
    const empty = corpusAuditRollup({ rows: [], runs: [] });
    assert.deepEqual({ audited: empty.audited, unaudited: empty.unaudited, scoreRange: empty.scoreRange },
        { audited: 0, unaudited: 0, scoreRange: null });
});
