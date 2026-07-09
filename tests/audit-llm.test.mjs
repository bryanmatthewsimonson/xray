// In-extension epistemic auditor (the LLM execution path): the tool
// schema is built from the validator's PAYLOADS, the aggregate is
// computed in code (never taken from the model), and a clean pass
// assembles into an object importAuditJson accepts end to end.

import { test } from 'node:test';
import assert from 'node:assert/strict';

await import('fake-indexeddb/auto');
// Stateful storage stub: the consent-gate tests (llmAssist flag + API
// key) need get() to reflect what set() stored.
const _store = {};
globalThis.chrome = globalThis.chrome || {
    storage: { local: {
        get(keys, cb) {
            const out = {};
            const list = Array.isArray(keys) ? keys : (typeof keys === 'string' ? [keys] : Object.keys(_store));
            for (const k of list) { if (k in _store) out[k] = _store[k]; }
            cb(out);
        },
        set(obj, cb) { Object.assign(_store, obj); cb && cb(); },
        remove(keys, cb) { for (const k of (Array.isArray(keys) ? keys : [keys])) delete _store[k]; cb && cb(); }
    } }
};
function resetStore() { for (const k of Object.keys(_store)) delete _store[k]; }

const {
    buildAuditTool, assembleAudit, AUDIT_TOOL_NAME, STANDING_SINGLE_SHOT_CAVEAT, MODULE_WEIGHTS,
    buildSingleModuleTool, buildModuleSystemPrompt
} = await import('../src/shared/audit/audit-prompt.js');
const { extractToolInput, runAuditPass, runAuditModulePass, LLM_KEY_STORAGE } = await import('../src/shared/llm-client.js');
const { auditableSlice, MAX_AUDIT_INPUT_CHARS } = await import('../src/shared/audit/assemble.js');
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
    const audit = await assembleAudit({
        toolInput: { modules: fullModules() }, model: MODEL, markdown: MD,
        standingCaveat: STANDING_SINGLE_SHOT_CAVEAT
    });
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

test('round-trip: percentage-scale confidence is normalized, not rejected (regression)', async () => {
    // The single-shot model sometimes emits confidence as a 0-100 PERCENTAGE
    // instead of a 0.0-1.0 fraction. That used to poison the aggregate and make
    // importAuditJson hard-throw ("aggregate.overall_confidence must be a number
    // in [0, 1] (got 60)"), surfacing as the reader's "Audit import failed" toast.
    // assembleAudit now recovers the fraction and notes the degrade (P12).
    const mods = fullModules();
    for (const name of Object.keys(mods)) {
        if (name === 'prediction_extraction') continue;
        mods[name].confidence = mods[name].confidence * 100;   // 0.8 -> 80, 0.6 -> 60, …
    }
    const audit = await assembleAudit({
        toolInput: { modules: mods }, model: MODEL, markdown: MD,
        standingCaveat: STANDING_SINGLE_SHOT_CAVEAT
    });

    // Recovered into [0,1] in the findings the firewall validates (so the
    // module PASSES rather than failing) — and in the aggregate it feeds.
    for (const r of audit.module_results) {
        if (r.module === 'prediction_extraction') continue;
        assert.ok(r.findings.confidence >= 0 && r.findings.confidence <= 1,
            `${r.module} confidence normalized into [0,1]`);
    }
    assert.ok(audit.aggregate.overall_confidence >= 0 && audit.aggregate.overall_confidence <= 1);
    for (const c of audit.aggregate.module_contributions) {
        assert.ok(c.confidence >= 0 && c.confidence <= 1, `${c.module} contribution confidence in [0,1]`);
    }
    // Transparency: the normalization is surfaced as a caveat, not silent.
    const noted = audit.module_results.some((r) =>
        (r.findings.auditor_caveats || []).some((c) => /normalized into 0\.0-1\.0/.test(c)));
    assert.ok(noted, 'normalization recorded as an auditor caveat (P12)');

    // The whole point: it now IMPORTS cleanly (was a hard throw).
    const summary = await importAuditJson(audit, { localArticleHash: await articleHash(MD) });
    assert.equal(summary.modulesValid, 8, 'imports cleanly after normalization');
    assert.equal(summary.modulesFailed, 0);
});

// --- per-module ("thorough") path --------------------------------------------

test('buildSingleModuleTool + buildModuleSystemPrompt: one module, full methodology', () => {
    const tool = buildSingleModuleTool('source_quality');
    assert.equal(tool.name, 'emit_source_quality');
    // input_schema IS the module's findings schema (envelope + payload).
    assert.ok(tool.input_schema.required.includes('score'));
    assert.ok(tool.input_schema.required.includes('summary'));

    const sys = buildModuleSystemPrompt('source_quality', { title: 'A Story' });
    assert.match(sys, /Module 04/, 'carries the vendored methodology');
    assert.match(sys, /emit_source_quality/, 'points at its tool');

    // 08 must tell the model not to score (envelope forbids it).
    const pe = buildSingleModuleTool('prediction_extraction');
    assert.ok(!pe.input_schema.required.includes('score'));
    assert.match(buildModuleSystemPrompt('prediction_extraction', {}), /NOT scored/);
});

test('per-module assembly carries NO single-shot caveat, still round-trips', async () => {
    const audit = await assembleAudit({
        toolInput: { modules: fullModules() }, model: MODEL, markdown: MD,
        standingCaveat: null
    });
    for (const r of audit.module_results) {
        assert.ok(!r.findings.auditor_caveats.includes(STANDING_SINGLE_SHOT_CAVEAT),
            `${r.module} should not carry the single-shot caveat in thorough mode`);
    }
    // The model's own per-module caveat survives.
    const pe = audit.module_results.find((r) => r.module === 'prediction_extraction');
    assert.ok(pe.findings.auditor_caveats.includes('Horizon approximate.'));

    const summary = await importAuditJson(audit, { localArticleHash: await articleHash(MD) });
    assert.equal(summary.modulesValid, 8);
    assert.equal(summary.modulesFailed, 0);
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

// --- consent gates fire BEFORE any network -----------------------------------

// Every gate test runs with fetch booby-trapped: a gate that leaks a
// network call is a broken consent gate, not a flaky test.
async function withFetchTrap(fn) {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => { calls += 1; throw new Error('network call past a consent gate'); };
    try { await fn(); } finally { globalThis.fetch = original; }
    assert.equal(calls, 0, 'no network call reached fetch');
}

test('runAuditModulePass: flag off refuses pre-network', async () => {
    resetStore();
    await withFetchTrap(async () => {
        const res = await runAuditModulePass({ module: 'omission', markdown: MD });
        assert.equal(res.ok, false);
        assert.match(res.error, /LLM assist is off/);
    });
});

test('runAuditModulePass: flag on but keyless refuses pre-network', async () => {
    resetStore();
    _store['xray:flags'] = JSON.stringify({ llmAssist: true });
    await withFetchTrap(async () => {
        const res = await runAuditModulePass({ module: 'omission', markdown: MD });
        assert.equal(res.ok, false);
        assert.match(res.error, /No Anthropic API key/);
    });
    resetStore();
});

test('runAuditModulePass: unknown module and empty text refuse pre-network', async () => {
    resetStore();
    _store['xray:flags'] = JSON.stringify({ llmAssist: true });
    _store[LLM_KEY_STORAGE] = 'sk-test-not-a-real-key';
    await withFetchTrap(async () => {
        const bad = await runAuditModulePass({ module: 'no_such_module', markdown: MD });
        assert.equal(bad.ok, false);
        assert.match(bad.error, /Unknown audit module: no_such_module/);

        const empty = await runAuditModulePass({ module: 'omission', markdown: '   ' });
        assert.equal(empty.ok, false);
        assert.equal(empty.module, 'omission');
        assert.match(empty.error, /No article text/);
    });
    resetStore();
});

test('runAuditPass: mode per_module is refused with the migration pointer (stale caller guard)', async () => {
    resetStore();
    _store['xray:flags'] = JSON.stringify({ llmAssist: true });
    _store[LLM_KEY_STORAGE] = 'sk-test-not-a-real-key';
    await withFetchTrap(async () => {
        const res = await runAuditPass({ mode: 'per_module', markdown: MD });
        assert.equal(res.ok, false);
        assert.match(res.error, /xray:audit:module/,
            'points the stale caller at the per-module topology');
    });
    resetStore();
});

// --- the auditable slice (the shared truncation bound) -----------------------

test('auditableSlice: under and at the limit pass through untouched', () => {
    const short = auditableSlice('abc');
    assert.deepEqual(short, { text: 'abc', truncated: false, totalChars: 3 });

    const exact = auditableSlice('x'.repeat(MAX_AUDIT_INPUT_CHARS));
    assert.equal(exact.truncated, false);
    assert.equal(exact.text.length, MAX_AUDIT_INPUT_CHARS);

    assert.deepEqual(auditableSlice(''), { text: '', truncated: false, totalChars: 0 });
    assert.deepEqual(auditableSlice(null), { text: '', truncated: false, totalChars: 0 });
});

test('auditableSlice: over the limit truncates honestly', () => {
    const over = auditableSlice('y'.repeat(MAX_AUDIT_INPUT_CHARS + 7));
    assert.equal(over.truncated, true);
    assert.equal(over.text.length, MAX_AUDIT_INPUT_CHARS, 'scored text is exactly the bound');
    assert.equal(over.totalChars, MAX_AUDIT_INPUT_CHARS + 7, 'the full length is reported for the disclosure');
});

// --- the audit-prompt shim re-exports the SAME assembly ----------------------

test('audit-prompt re-exports are identical to the lean assemble module', async () => {
    // The reader imports assemble.js directly (keeping the 38KB module
    // prompts out of its bundle); everything else still imports through
    // audit-prompt.js. Both must be the SAME functions, not copies.
    const prompt = await import('../src/shared/audit/audit-prompt.js');
    const lean = await import('../src/shared/audit/assemble.js');
    assert.equal(prompt.assembleAudit, lean.assembleAudit);
    assert.equal(prompt.collectEvidenceQuotes, lean.collectEvidenceQuotes);
    assert.equal(prompt.MODULE_WEIGHTS, lean.MODULE_WEIGHTS);
    assert.equal(prompt.auditableSlice, lean.auditableSlice);
    assert.equal(prompt.MAX_AUDIT_INPUT_CHARS, lean.MAX_AUDIT_INPUT_CHARS);
});
