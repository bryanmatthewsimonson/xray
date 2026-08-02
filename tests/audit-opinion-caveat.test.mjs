// R5-interim tests — the standing opinion caveat (founding-transcript
// integration; JOURNAL 2026-08-02). Until PHILOSOPHY §3.2's opinion
// modules exist, an audit of an opinion/analysis artifact must say on
// its face that it ran the news methodology. Pins: detection (declared
// source_type wins, capture suggestion falls back), assembleAudit's
// standingCaveat list handling (order, dedup, absent-module path), and
// the no-caveat path for reporting. No methodology version change —
// the single-shot-caveat precedent.

import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

const {
    assembleAudit, opinionStandingCaveat, STANDING_OPINION_CAVEAT, MODULE_WEIGHTS
} = await import('../src/shared/audit/assemble.js');
const { MODULE_NAMES } = await import('../src/shared/audit/findings-schemas.js');

// ------------------------------------------------------------------
// Detection
// ------------------------------------------------------------------

test('R5: declared source_type analysis → caveat; reporting/reference → null', () => {
    assert.equal(opinionStandingCaveat({ source_type: 'analysis' }), STANDING_OPINION_CAVEAT);
    assert.equal(opinionStandingCaveat({ source_type: 'reporting' }), null);
    assert.equal(opinionStandingCaveat({ source_type: 'reference' }), null);
    assert.equal(opinionStandingCaveat(null), null);
    assert.equal(opinionStandingCaveat({}), null);
});

test('R5: capture-time suggestion falls back when source_type unset', () => {
    assert.equal(
        opinionStandingCaveat({ structuredData: { type: 'OpinionPiece' } }),
        STANDING_OPINION_CAVEAT);
    assert.equal(
        opinionStandingCaveat({ contentSchemaType: 'AnalysisNewsArticle' }),
        STANDING_OPINION_CAVEAT);
    assert.equal(
        opinionStandingCaveat({ structuredData: { type: 'NewsArticle' } }),
        null);
    // Declared type BEATS the suggestion — a user override to reporting
    // silences the caveat even on an OpinionPiece page.
    assert.equal(
        opinionStandingCaveat({ source_type: 'reporting', structuredData: { type: 'OpinionPiece' } }),
        null);
});

// ------------------------------------------------------------------
// assembleAudit standingCaveat list handling
// ------------------------------------------------------------------

const MODULE_FIXTURE = () => Object.fromEntries(MODULE_NAMES.map((name) => [name, {
    score: 70, confidence: 0.8, auditor_caveats: ['model-supplied caveat']
}]));

test('R5: array standingCaveat lands on every module, in order, before model caveats', async () => {
    const audit = await assembleAudit({
        toolInput: { modules: MODULE_FIXTURE() },
        model: 'test-model',
        markdown: 'Body text long enough to hash.',
        standingCaveat: ['first standing', STANDING_OPINION_CAVEAT]
    });
    for (const mr of audit.module_results) {
        assert.deepEqual(
            mr.auditor_caveats.slice(0, 2),
            ['first standing', STANDING_OPINION_CAVEAT],
            `${mr.module}: standing caveats lead, in order`);
        assert.ok(mr.auditor_caveats.includes('model-supplied caveat'));
    }
});

test('R5: single-string standingCaveat still works (regression)', async () => {
    const audit = await assembleAudit({
        toolInput: { modules: MODULE_FIXTURE() },
        model: 'test-model',
        markdown: 'Body text long enough to hash.',
        standingCaveat: 'solo caveat'
    });
    for (const mr of audit.module_results) {
        assert.equal(mr.auditor_caveats[0], 'solo caveat');
    }
});

test('R5: null standingCaveat adds nothing (thorough-on-reporting path)', async () => {
    const audit = await assembleAudit({
        toolInput: { modules: MODULE_FIXTURE() },
        model: 'test-model',
        markdown: 'Body text long enough to hash.',
        standingCaveat: null
    });
    for (const mr of audit.module_results) {
        assert.deepEqual(mr.auditor_caveats, ['model-supplied caveat']);
    }
});

test('R5: absent-module failure rows carry the standing list too', async () => {
    const modules = MODULE_FIXTURE();
    delete modules.omission;
    const audit = await assembleAudit({
        toolInput: { modules },
        model: 'test-model',
        markdown: 'Body text long enough to hash.',
        standingCaveat: [STANDING_OPINION_CAVEAT]
    });
    const absent = audit.module_results.find((r) => r.module === 'omission');
    assert.ok(absent._error);
    assert.deepEqual(absent.auditor_caveats,
        [STANDING_OPINION_CAVEAT, 'module absent from model output']);
});

test('R5: caveat dedup — a standing caveat already present is not doubled', async () => {
    const modules = MODULE_FIXTURE();
    modules.source_quality.auditor_caveats = [STANDING_OPINION_CAVEAT, 'other'];
    const audit = await assembleAudit({
        toolInput: { modules },
        model: 'test-model',
        markdown: 'Body text long enough to hash.',
        standingCaveat: [STANDING_OPINION_CAVEAT]
    });
    const sq = audit.module_results.find((r) => r.module === 'source_quality');
    assert.equal(
        sq.auditor_caveats.filter((c) => c === STANDING_OPINION_CAVEAT).length, 1);
    assert.ok(Object.keys(MODULE_WEIGHTS).length >= 7, 'weights untouched by this feature');
});
