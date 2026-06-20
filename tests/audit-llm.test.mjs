// In-extension epistemic auditor (the LLM execution path): the tool
// schema is built from the validator's PAYLOADS, the aggregate is
// computed in code (never taken from the model), and a clean pass
// assembles into an object importAuditJson accepts end to end.

import { test } from 'node:test';
import assert from 'node:assert/strict';

await import('fake-indexeddb/auto');
globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

const {
    buildAuditTool, assembleAudit, AUDIT_TOOL_NAME, STANDING_SINGLE_SHOT_CAVEAT, MODULE_WEIGHTS
} = await import('../src/shared/audit/audit-prompt.js');
const { extractToolInput } = await import('../src/shared/llm-client.js');
const { MODULE_NAMES, SCOREABLE_MODULES, validateFindings } = await import('../src/shared/audit/findings-schemas.js');
const { articleHash, normalizeForHash } = await import('../src/shared/audit/article-hash.js');
const { importAuditJson } = await import('../src/shared/audit/import.js');
const { AuditRunModel, PredictionModel } = await import('../src/shared/audit/audit-model.js');
const { clear } = await import('../src/shared/audit/audit-cache.js');

const MD = '# A Story\n\nThe minister said the program would end by December. Critics disagreed.';

// A minimal-but-schema-valid findings object per module — exactly the
// shape buildAuditTool guides the model toward (envelope score/confidence
// + payload). module/version are injected by assembleAudit, NOT here.
function fullModules() {
    return {
        headline_body_fidelity: {
            score: 80, confidence: 0.8, auditor_caveats: [],
            headline: 'A Story', subhead: null,
            headline_implications: [], body_findings: [], structural_issues: []
        },
        asymmetric_language: {
            score: 85, confidence: 0.7, auditor_caveats: [],
            has_contrast_structure: false, parties_identified: [],
            language_applied: [], asymmetry_findings: []
        },
        number_hygiene: {
            score: 90, confidence: 0.9, auditor_caveats: [],
            numerical_claims: [],
            summary: { total_claims: 0, claims_failing_at_least_one_test: 0 }
        },
        source_quality: {
            score: 70, confidence: 0.6, auditor_caveats: [],
            sources: [], claim_to_source_map: [], single_sourced_contested_claims: [],
            primary_documents: [],
            // Drives the knowability-ceiling heuristic: 3/4 named, 0 bare
            // anonymous, all documents specifically identified.
            summary: {
                total_sources: 4, named_count: 3, anonymous_count: 1,
                anonymous_justified_count: 1, expert_says_vague_count: 0,
                documents_cited: 2, documents_specifically_identified: 2
            }
        },
        internal_coherence: {
            score: 75, confidence: 0.8, auditor_caveats: [],
            contradictions: [], logical_gaps: []
        },
        definitional_precision: {
            score: 65, confidence: 0.7, auditor_caveats: [],
            contested_terms: [], weasel_quantifiers: [], category_laundering: []
        },
        omission: {
            score: 60, confidence: 0.65, auditor_caveats: [],
            topic_summary: 'A program ending.', voices_directly_quoted: [],
            voices_paraphrased_only: [], voices_referenced_but_silent: [],
            natural_stakeholder_set: [], voices_expected_but_absent: [],
            speaks_for_instances: []
        },
        prediction_extraction: {
            auditor_caveats: ['Horizon approximate.'],
            predictions: [{
                prediction: 'The program will end by December.',
                type: 'explicit', hedge_level: 'confident',
                attributed_to: 'named_source', attributed_source_name: 'the minister',
                resolution_horizon: 'by December',
                resolution_criteria: 'program shut down by Dec 31',
                tractability: 'publicly_resolvable',
                evidence_quote: 'would end by December'
            }],
            summary: { total_predictions: 1 }
        }
    };
}

const MODEL = 'claude-opus-4-8';

test.beforeEach(async () => { await clear(); });

// --- tool schema is derived from the validator's shapes ---------------------

test('buildAuditTool: one schema per module, derived from PAYLOADS', () => {
    const tool = buildAuditTool();
    assert.equal(tool.name, AUDIT_TOOL_NAME);
    const mods = tool.input_schema.properties.modules;
    assert.deepEqual(mods.required, MODULE_NAMES.slice(), 'all eight modules required');

    for (const name of SCOREABLE_MODULES) {
        const s = mods.properties[name];
        assert.ok(s.required.includes('score'), `${name} requires score`);
        assert.ok(s.required.includes('confidence'), `${name} requires confidence`);
        assert.ok(s.required.includes('auditor_caveats'), `${name} requires auditor_caveats`);
    }
    // 08 is unscored — score/confidence must be neither asked nor present.
    const pe = mods.properties.prediction_extraction;
    assert.ok(!pe.required.includes('score'));
    assert.ok(!pe.properties.score, 'prediction_extraction has no score property');
    assert.ok(pe.required.includes('auditor_caveats'));
});

// --- assembly produces import-clean canonical output ------------------------

test('assembleAudit: every module validates against its findings schema', async () => {
    const audit = await assembleAudit({ toolInput: { modules: fullModules() }, model: MODEL, markdown: MD });
    assert.equal(audit.module_results.length, 8);
    for (const r of audit.module_results) {
        const { valid, errors } = validateFindings(r.module, r.findings);
        assert.ok(valid, `${r.module} should validate: ${JSON.stringify(errors)}`);
        // Wrapper score/version match findings (import's tamper check).
        assert.equal(r.module_version, r.findings.version);
        if (r.module !== 'prediction_extraction') {
            assert.equal(r.score, r.findings.score);
            assert.equal(r.confidence, r.findings.confidence);
        }
        // The standing single-shot caveat rides on every module (P12).
        assert.ok(r.findings.auditor_caveats.includes(STANDING_SINGLE_SHOT_CAVEAT));
        assert.equal(r.auditor.kind, 'model');
        assert.equal(r.auditor.id, `anthropic/${MODEL}`);
    }
});

test('assembleAudit: hash binds to the audited text', async () => {
    const audit = await assembleAudit({ toolInput: { modules: fullModules() }, model: MODEL, markdown: MD });
    assert.equal(audit.article.hash, await articleHash(MD));
    assert.equal(audit.article.body_markdown, normalizeForHash(MD));
});

test('assembleAudit: aggregate is computed in code, not the model', async () => {
    const audit = await assembleAudit({ toolInput: { modules: fullModules() }, model: MODEL, markdown: MD });
    const agg = audit.aggregate;

    // Ceiling from the source_quality summary heuristic:
    // round(60 + 25*0.75 + 10*1 + 5*0.25 - 15*0) = 90.
    assert.equal(agg.knowability_ceiling, 90);
    assert.equal(agg.ceiling_source, 'heuristic:source-quality/1.0');

    // Weighted over the seven scoreable modules:
    // 80*.15+85*.15+90*.10+70*.20+75*.10+65*.10+60*.20 = 73.75 → 73.8.
    assert.equal(agg.raw_weighted_score, 73.8);
    assert.equal(agg.final_score, 73.8, 'below the ceiling, so no cap');
    assert.equal(agg.ceiling_binding, false);

    // Confidence stacks: min(confidences) × success fraction = 0.6 × 1.
    assert.equal(agg.overall_confidence, 0.6);

    assert.equal(agg.module_contributions.length, SCOREABLE_MODULES.length);
    assert.ok(agg.top_strengths.includes('number_hygiene: 90'));
    assert.ok(agg.top_strengths.includes('asymmetric_language: 85'));
    // Pipeline weights are the documented public constants.
    assert.equal(MODULE_WEIGHTS.source_quality, 0.20);
});

test('assembleAudit: ceiling binds when the raw score exceeds it', async () => {
    const mods = fullModules();
    // All-anonymous-bare sourcing → a low ceiling that caps a high raw.
    mods.source_quality.summary = {
        total_sources: 4, named_count: 0, anonymous_count: 4,
        anonymous_justified_count: 0, expert_says_vague_count: 0,
        documents_cited: 0, documents_specifically_identified: 0
    };
    for (const m of SCOREABLE_MODULES) mods[m].score = 95;
    const { aggregate: agg } = await assembleAudit({ toolInput: { modules: mods }, model: MODEL, markdown: MD });
    // ceiling = round(60 + 0 + 10*1(docs default) + 0 - 15*1) = 55.
    assert.equal(agg.knowability_ceiling, 55);
    assert.equal(agg.raw_weighted_score, 95);
    assert.equal(agg.final_score, 55, 'capped at the ceiling');
    assert.equal(agg.ceiling_binding, true);
});

// --- the round-trip: assemble → importAuditJson (the real firewall) ---------

test('round-trip: a clean pass imports end to end', async () => {
    const audit = await assembleAudit({ toolInput: { modules: fullModules() }, model: MODEL, markdown: MD });
    const localHash = await articleHash(MD);
    const summary = await importAuditJson(audit, { localArticleHash: localHash });

    assert.equal(summary.modulesValid, 8, 'all eight modules pass the firewall');
    assert.equal(summary.modulesFailed, 0);
    assert.equal(summary.predictionsImported, 1);
    assert.equal(summary.articleHash, localHash);

    const runs = await AuditRunModel.getByArticleHash(localHash);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].aggregate.final_score, 73.8);
    assert.equal(runs[0].aggregate.ceiling_source, 'heuristic:source-quality/1.0');

    const preds = await PredictionModel.getByArticleHash(localHash);
    assert.equal(preds.length, 1);
    assert.equal(preds[0].attributed_source_name, 'the minister');
});

test('round-trip: a capture-hash mismatch is rejected at the door', async () => {
    const audit = await assembleAudit({ toolInput: { modules: fullModules() }, model: MODEL, markdown: MD });
    await assert.rejects(
        () => importAuditJson(audit, { localArticleHash: 'f'.repeat(64) }),
        /scored different text|does not match/
    );
});

test('assembleAudit: an absent module imports as a failed result, not a rejection', async () => {
    const mods = fullModules();
    delete mods.omission;
    const audit = await assembleAudit({ toolInput: { modules: mods }, model: MODEL, markdown: MD });
    const omission = audit.module_results.find((r) => r.module === 'omission');
    assert.equal(omission.score, null);
    assert.equal(omission._error, true);

    const summary = await importAuditJson(audit, { localArticleHash: await articleHash(MD) });
    assert.equal(summary.modulesFailed >= 1, true);
    assert.equal(summary.modulesValid, 7, 'the rest still import');
});

// --- tool-output extraction --------------------------------------------------

test('extractToolInput: pulls the forced tool input, null when absent', () => {
    const data = { content: [
        { type: 'text', text: 'ignored' },
        { type: 'tool_use', name: AUDIT_TOOL_NAME, input: { modules: { x: 1 } } }
    ] };
    assert.deepEqual(extractToolInput(data, AUDIT_TOOL_NAME), { modules: { x: 1 } });
    assert.equal(extractToolInput({ content: [{ type: 'text', text: 'hi' }] }, AUDIT_TOOL_NAME), null);
    assert.equal(extractToolInput({}, AUDIT_TOOL_NAME), null);
});
