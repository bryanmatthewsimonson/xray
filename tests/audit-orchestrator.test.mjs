// Thorough-audit orchestration (run-orchestrator.js): the reader-side
// scheduler behind the per-module message topology — bounded
// concurrency, one auto-retry on retryable failures, resume subsets —
// and the end-to-end chain orchestrate → assembleAudit →
// importAuditJson over the same firewall the file importer uses.

import { test } from 'node:test';
import assert from 'node:assert/strict';

await import('fake-indexeddb/auto');
globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

const { orchestrateModuleRuns } = await import('../src/shared/audit/run-orchestrator.js');
const { assembleAudit } = await import('../src/shared/audit/assemble.js');
const { MODULE_NAMES } = await import('../src/shared/audit/findings-schemas.js');
const { articleHash } = await import('../src/shared/audit/article-hash.js');
const { importAuditJson } = await import('../src/shared/audit/import.js');
const { AuditRunModel, PredictionModel } = await import('../src/shared/audit/audit-model.js');
const { clear } = await import('../src/shared/audit/audit-cache.js');

const MODEL = 'claude-opus-4-8';
const noWait = () => Promise.resolve();

function okResponse(name) {
    return { ok: true, module: name, findings: { score: 80, confidence: 0.8, auditor_caveats: [] }, model: MODEL };
}

test.beforeEach(async () => { await clear(); });

// --- scheduling --------------------------------------------------------------

test('bounded pool: in-flight calls never exceed the concurrency cap', async () => {
    let active = 0;
    let highWater = 0;
    const send = async (name) => {
        active += 1;
        highWater = Math.max(highWater, active);
        await new Promise((r) => setTimeout(r, 5));
        active -= 1;
        return okResponse(name);
    };
    const { modules, failures } = await orchestrateModuleRuns({
        moduleNames: MODULE_NAMES.slice(), send, concurrency: 3, wait: noWait
    });
    assert.equal(Object.keys(modules).length, MODULE_NAMES.length);
    assert.equal(failures.length, 0);
    assert.ok(highWater <= 3, `high-water ${highWater} must respect the cap`);
    assert.ok(highWater >= 2, 'the pool actually runs modules in parallel');
});

test('resume subset: only the passed module names run', async () => {
    const called = [];
    const send = async (name) => { called.push(name); return okResponse(name); };
    const missing = ['omission', 'number_hygiene'];
    const { modules } = await orchestrateModuleRuns({ moduleNames: missing, send, wait: noWait });
    assert.deepEqual(called.sort(), missing.slice().sort());
    assert.deepEqual(Object.keys(modules).sort(), missing.slice().sort());
});

test('empty module list resolves to an empty result, no calls', async () => {
    let calls = 0;
    const res = await orchestrateModuleRuns({ moduleNames: [], send: async () => { calls += 1; }, wait: noWait });
    assert.deepEqual(res, { modules: {}, failures: [], model: null });
    assert.equal(calls, 0);
});

test('model is captured from the responses', async () => {
    const { model } = await orchestrateModuleRuns({
        moduleNames: ['omission'], send: async (n) => okResponse(n), wait: noWait
    });
    assert.equal(model, MODEL);
});

// --- retry policy ------------------------------------------------------------

test('429 is retried exactly once, with the configured delay', async () => {
    const attempts = [];
    const waits = [];
    const send = async (name) => {
        attempts.push(name);
        return attempts.length === 1
            ? { ok: false, module: name, error: 'rate limited', status: 429 }
            : okResponse(name);
    };
    const phases = [];
    const { modules, failures } = await orchestrateModuleRuns({
        moduleNames: ['omission'], send, retryDelayMs: 15000,
        wait: (ms) => { waits.push(ms); return Promise.resolve(); },
        onProgress: (p) => phases.push(p.phase)
    });
    assert.equal(attempts.length, 2, 'one retry, not a loop');
    assert.deepEqual(waits, [15000], 'backs off by retryDelayMs before the retry');
    assert.equal(failures.length, 0);
    assert.ok(modules.omission, 'the retried module lands');
    assert.deepEqual(phases, ['start', 'retry', 'done']);
});

test('5xx and timeout are retryable; a second failure is terminal', async () => {
    for (const first of [{ status: 503 }, { timeout: true }]) {
        let n = 0;
        const send = async (name) => { n += 1; return { ok: false, module: name, error: 'boom', ...first }; };
        const { modules, failures } = await orchestrateModuleRuns({
            moduleNames: ['omission'], send, wait: noWait
        });
        assert.equal(n, 2, `retried once for ${JSON.stringify(first)}`);
        assert.equal(Object.keys(modules).length, 0);
        assert.equal(failures.length, 1);
        assert.equal(failures[0].module, 'omission');
    }
});

test('a non-retryable failure (4xx gate refusal) is never retried', async () => {
    let n = 0;
    const send = async (name) => { n += 1; return { ok: false, module: name, error: 'bad request', status: 400 }; };
    const { failures } = await orchestrateModuleRuns({ moduleNames: ['omission'], send, wait: noWait });
    assert.equal(n, 1, 'one attempt only');
    assert.equal(failures.length, 1);
    assert.equal(failures[0].error, 'bad request');
    assert.equal(failures[0].status, 400);
});

test('a THROWN send (dead message channel) is a retryable transport failure', async () => {
    let n = 0;
    const send = async (name) => {
        n += 1;
        if (n === 1) throw new Error('The message port closed before a response was received.');
        return okResponse(name);
    };
    const { modules, failures } = await orchestrateModuleRuns({ moduleNames: ['omission'], send, wait: noWait });
    assert.equal(n, 2, 'the throw is retried, not fatal');
    assert.equal(failures.length, 0);
    assert.ok(modules.omission, 'one lost channel costs one attempt, never the run');
});

test('partial failure: completed modules land, failed ones are listed — the run survives', async () => {
    const send = async (name) => name === 'omission'
        ? { ok: false, module: name, error: 'model refused', status: 400 }
        : okResponse(name);
    const names = ['headline_body_fidelity', 'omission', 'number_hygiene'];
    const { modules, failures } = await orchestrateModuleRuns({ moduleNames: names, send, wait: noWait });
    assert.deepEqual(Object.keys(modules).sort(), ['headline_body_fidelity', 'number_hygiene']);
    assert.equal(failures.length, 1);
    assert.equal(failures[0].module, 'omission');
});

// --- end to end: orchestrate → assemble → the import firewall ----------------

const MD = '# A Story\n\nThe minister said the program would end by December. Critics disagreed.';

// The same minimal-but-schema-valid per-module findings the audit-llm
// round-trip uses — exactly what runAuditModulePass returns per module.
const FINDINGS = {
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

test('end to end: orchestrated modules assemble and import through the firewall', async () => {
    // The reader's exact chain: per-module responses → merged modules →
    // assembleAudit (standingCaveat null — thorough carries no
    // single-shot caveat) → importAuditJson keyed to the sliced text.
    const send = async (name) => ({ ok: true, module: name, findings: FINDINGS[name], model: MODEL });
    const { modules, failures, model } = await orchestrateModuleRuns({
        moduleNames: MODULE_NAMES.slice(), send, wait: noWait
    });
    assert.equal(failures.length, 0);

    const audit = await assembleAudit({
        toolInput: { modules }, model, markdown: MD,
        metadata: { url: 'https://example.com/story', headline: 'A Story' },
        standingCaveat: null
    });
    const localHash = await articleHash(MD);
    const summary = await importAuditJson(audit, { localArticleHash: localHash, source: 'background' });

    assert.equal(summary.modulesValid, 8, 'all eight orchestrated modules pass the firewall');
    assert.equal(summary.modulesFailed, 0);
    assert.equal(summary.predictionsImported, 1);

    const runs = await AuditRunModel.getByArticleHash(localHash);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].source, 'background', 'in-extension provenance, not cli-import');
    assert.equal(typeof runs[0].aggregate.final_score, 'number');

    const preds = await PredictionModel.getByArticleHash(localHash);
    assert.equal(preds.length, 1);
});

test('end to end: a resumed run (draft + missing subset) assembles identically', async () => {
    // Simulate the resume path: five modules came from the draft, three
    // are re-run — the merged set must assemble and import exactly like
    // a single-session run.
    const draftNames = MODULE_NAMES.slice(0, 5);
    const missing = MODULE_NAMES.slice(5);
    const existing = {};
    for (const n of draftNames) existing[n] = FINDINGS[n];

    const send = async (name) => ({ ok: true, module: name, findings: FINDINGS[name], model: MODEL });
    const { modules, failures } = await orchestrateModuleRuns({ moduleNames: missing, send, wait: noWait });
    assert.equal(failures.length, 0);
    assert.deepEqual(Object.keys(modules).sort(), missing.slice().sort());

    const merged = { ...existing, ...modules };
    const audit = await assembleAudit({ toolInput: { modules: merged }, model: MODEL, markdown: MD, standingCaveat: null });
    const localHash = await articleHash(MD);
    const summary = await importAuditJson(audit, { localArticleHash: localHash, source: 'background' });
    assert.equal(summary.modulesValid, 8);
    assert.equal(summary.modulesFailed, 0);
});
