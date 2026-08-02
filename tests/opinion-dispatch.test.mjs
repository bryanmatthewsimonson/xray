// R5/OP.3 tests — family dispatch and family-aware assembly
// (docs/OPINION_MODULES_KICKOFF.md §8). Pins: auditFamilyFor routes
// declared-analysis and suggested-analysis to the opinion family and
// honors the OQ.4 override (declared reporting wins, family news);
// assembleAudit(family:'opinion') iterates the opinion roster, applies
// the OQ.3 weights, and derives the OQ.2 premise-verifiability ceiling
// with its provenance tag; the news path is regression-pinned; and an
// opinion audit round-trips the import firewall.

import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};
await import('fake-indexeddb/auto');

const {
    auditFamilyFor, assembleAudit, OPINION_CEILING_SOURCE
} = await import('../src/shared/audit/assemble.js');
const { OPINION_RUN_MODULES, MODULE_NAMES } = await import('../src/shared/audit/findings-schemas.js');
const { importAuditJson } = await import('../src/shared/audit/import.js');

test('OP.3 dispatch: declared and suggested analysis → opinion; OQ.4 override → news', () => {
    assert.equal(auditFamilyFor({ source_type: 'analysis' }), 'opinion');
    assert.equal(auditFamilyFor({ structuredData: { type: 'OpinionPiece' } }), 'opinion');
    assert.equal(auditFamilyFor({ source_type: 'reporting' }), 'news');
    assert.equal(auditFamilyFor({ source_type: 'reporting', structuredData: { type: 'OpinionPiece' } }),
        'news', 'the OQ.4 forced case: declared type wins; the caveat rides separately');
    assert.equal(auditFamilyFor(null), 'news');
});

const OPINION_MODULES_FIXTURE = () => ({
    premise_accuracy: {
        score: 80, confidence: 0.8, auditor_caveats: [],
        premises: [{ premise: 'P', role: 'load_bearing', kind: 'factual',
            verifiable_in_principle: true, accuracy: 'supported', evidence_quote: 'P is so' }],
        summary: { total_premises: 4, load_bearing_count: 4, load_bearing_verifiable_count: 2,
            unsupported_load_bearing: 0, contradicted_load_bearing: 0 }
    },
    logical_validity: { score: 75, confidence: 0.8, auditor_caveats: [],
        argument_map: { conclusion: 'C' }, fallacies: [], valid_moves: [] },
    steel_manning: { score: 70, confidence: 0.8, auditor_caveats: [],
        opposition_positions: [], summary: { positions_identified: 0, steel_manned: 0, strawmanned: 0 } },
    fact_interpretation_separation: { score: 72, confidence: 0.8, auditor_caveats: [],
        boundary_findings: [], summary: { clear_count: 1, smuggled_count: 0 } },
    disclosure_transparency: { score: 68, confidence: 0.8, auditor_caveats: [],
        disclosures: [], summary: { disclosed_count: 0, disclosure_present: false } },
    originality_synthesis: { score: 60, confidence: 0.8, auditor_caveats: [],
        assessment: { classification: 'fresh_angle', rationale: 'r' }, examples: [] },
    asymmetric_language: { score: 77, confidence: 0.8, auditor_caveats: [],
        has_contrast_structure: false, parties_identified: [], language_applied: [], asymmetry_findings: [] },
    definitional_precision: { score: 74, confidence: 0.8, auditor_caveats: [],
        contested_terms: [], weasel_quantifiers: [], category_laundering: [] },
    prediction_extraction: { auditor_caveats: [], predictions: [], summary: { total_predictions: 0 } }
});

test('OP.3 assembly: opinion roster, OQ.3 weights, OQ.2 ceiling + provenance', async () => {
    const audit = await assembleAudit({
        toolInput: { modules: OPINION_MODULES_FIXTURE() },
        model: 'test-model',
        markdown: 'An opinion piece body long enough to hash.',
        family: 'opinion'
    });
    assert.deepEqual(
        audit.module_results.map((r) => r.module).sort(),
        [...OPINION_RUN_MODULES].sort(),
        'the opinion roster, exactly — no news-only modules');
    const agg = audit.aggregate;
    const w = Object.fromEntries(agg.module_contributions.map((c) => [c.module, c.weight]));
    assert.equal(w.premise_accuracy, 0.22);
    assert.equal(w.asymmetric_language, 0.10);
    assert.equal(agg.knowability_ceiling, 73, 'OQ.2: round(50 + 45×(2/4))');
    assert.equal(agg.ceiling_source, OPINION_CEILING_SOURCE);
    assert.ok(agg.knowability_notes.includes('50%'));
});

test('OP.3 regression: news family untouched — eight modules, sourcing ceiling', async () => {
    const modules = Object.fromEntries(MODULE_NAMES.map((m) => [m,
        m === 'prediction_extraction'
            ? { auditor_caveats: [], predictions: [], summary: { total_predictions: 0 } }
            : { score: 70, confidence: 0.8, auditor_caveats: [] }]));
    const audit = await assembleAudit({
        toolInput: { modules },
        model: 'test-model',
        markdown: 'A news body long enough to hash.'
    });
    assert.deepEqual(audit.module_results.map((r) => r.module).sort(), [...MODULE_NAMES].sort());
    assert.equal(audit.aggregate.ceiling_source, 'heuristic:source-quality/1.0');
});

test('OP.3 firewall: an opinion audit round-trips importAuditJson', async () => {
    const audit = await assembleAudit({
        toolInput: { modules: OPINION_MODULES_FIXTURE() },
        model: 'test-model',
        markdown: 'An opinion piece body long enough to hash.',
        family: 'opinion'
    });
    const summary = await importAuditJson(audit, { source: 'background' });
    assert.equal(summary.modulesFailed, 0,
        'every opinion module clears validation at the firewall');
    assert.ok(summary.modulesValid >= OPINION_RUN_MODULES.length - 1,
        'scored opinion modules all import');
});
