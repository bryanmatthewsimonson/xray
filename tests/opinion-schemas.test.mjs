// R5/OP.2 tests — the opinion module family (docs/OPINION_MODULES_KICKOFF.md).
// Pins: RED LINE 2 is structural — no property name or enum value in
// any opinion schema may express a stance on the author's conclusion
// (the guard walks everything; the wrong field is inexpressible, not
// just absent); every module validates through the shared walker with
// the evidence discipline intact; the §8 weights are exactly the ruled
// numbers and sum to 1; the premise-verifiability ceiling matches the
// OQ.2 formula; and the news family is byte-untouched (MODULE_NAMES
// still the eight news modules).

import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

const {
    OPINION_PAYLOADS, OPINION_MODULE_NAMES, OPINION_RUN_MODULES,
    MODULE_NAMES, CURRENT_MODULE_VERSIONS, validateFindings
} = await import('../src/shared/audit/findings-schemas.js');
const {
    OPINION_MODULE_WEIGHTS, opinionKnowabilityCeiling, OPINION_CEILING_SOURCE
} = await import('../src/shared/audit/assemble.js');

// ------------------------------------------------------------------
// Red line 2 — structural
// ------------------------------------------------------------------

test('OP.2 red line 2: no stance-shaped property or enum anywhere in the family', () => {
    const keys = [];
    const enums = [];
    const walk = (schema) => {
        if (!schema || typeof schema !== 'object') return;
        if (Array.isArray(schema.enum)) enums.push(...schema.enum);
        if (schema.properties) {
            for (const [k, sub] of Object.entries(schema.properties)) {
                keys.push(k);
                walk(sub);
            }
        }
        if (schema.items) walk(schema.items);
    };
    for (const schema of Object.values(OPINION_PAYLOADS)) walk(schema);

    const forbiddenKey = /(^|_)(stance|agreement|agrees?|verdict|correctness)(_|$)/;
    for (const k of keys) {
        assert.ok(!forbiddenKey.test(k), `stance-shaped property name: ${k}`);
    }
    const forbiddenEnum = new Set(['agree', 'disagree', 'correct', 'incorrect',
        'right', 'wrong', 'true_conclusion', 'false_conclusion']);
    for (const v of enums) {
        assert.ok(!forbiddenEnum.has(String(v)), `stance-shaped enum value: ${v}`);
    }
    assert.ok(keys.includes('conclusion'),
        'identifying the conclusion is legitimate — judging it is what the guard forbids');
});

// ------------------------------------------------------------------
// Validation through the shared walker
// ------------------------------------------------------------------

const ENVELOPE = (module) => ({
    module, version: '1.0', score: 70, confidence: 0.8, auditor_caveats: []
});

const MINIMAL = {
    premise_accuracy: {
        premises: [{ premise: 'X causes Y', role: 'load_bearing', kind: 'factual',
            verifiable_in_principle: true, accuracy: 'supported', evidence_quote: 'X causes Y' }],
        summary: { total_premises: 1, load_bearing_count: 1, load_bearing_verifiable_count: 1,
            unsupported_load_bearing: 0, contradicted_load_bearing: 0 }
    },
    logical_validity: {
        argument_map: { conclusion: 'therefore Z' },
        fallacies: [{ type: 'false_dilemma', description: 'either A or ruin',
            evidence_quote: 'either A or ruin', severity: 'medium' }],
        valid_moves: [{ description: 'sound modus ponens', evidence_quote: 'if A then B; A' }]
    },
    steel_manning: {
        opposition_positions: [{ position: 'critics argue W', engaged: true,
            strongest_form_engaged: 'steel', evidence_quote: 'the strongest case for W' }],
        summary: { positions_identified: 1, steel_manned: 1, strawmanned: 0 }
    },
    fact_interpretation_separation: {
        boundary_findings: [{ type: 'smuggled_interpretation',
            evidence_quote: 'obviously this proves', severity: 'high' }],
        summary: { clear_count: 0, smuggled_count: 1 }
    },
    disclosure_transparency: {
        disclosures: [{ kind: 'prior_position', disclosed: true,
            evidence_quote: 'I have long argued' }],
        summary: { disclosed_count: 1, disclosure_present: true }
    },
    originality_synthesis: {
        assessment: { classification: 'fresh_angle', rationale: 'connects A to B newly' },
        examples: [{ point: 'the A-B link', evidence_quote: 'consider A beside B' }]
    }
};

test('OP.2 validation: every opinion module accepts a minimal conforming payload', () => {
    for (const name of OPINION_MODULE_NAMES) {
        const res = validateFindings(name, { ...ENVELOPE(name), ...MINIMAL[name] });
        assert.equal(res.valid, true, `${name}: ${JSON.stringify(res.errors || [])}`);
    }
});

test('OP.2 validation: evidence discipline holds — empty quote invalid (P3)', () => {
    const bad = validateFindings('logical_validity', {
        ...ENVELOPE('logical_validity'),
        ...MINIMAL.logical_validity,
        fallacies: [{ type: 'circular', description: 'x', evidence_quote: '', severity: 'low' }]
    });
    assert.equal(bad.valid, false);
});

// ------------------------------------------------------------------
// Weights, roster, ceiling, versions
// ------------------------------------------------------------------

test('OP.2 weights: exactly the §8 ruling, Σ=1.00, roster matches', () => {
    const w = OPINION_MODULE_WEIGHTS;
    assert.equal(w.premise_accuracy, 0.22);
    assert.equal(w.logical_validity, 0.18);
    assert.equal(w.steel_manning, 0.14);
    assert.equal(w.disclosure_transparency, 0.14);
    assert.equal(w.asymmetric_language, 0.10);
    assert.equal(w.fact_interpretation_separation, 0.09);
    assert.equal(w.definitional_precision, 0.09);
    assert.equal(w.originality_synthesis, 0.04);
    const sum = Object.values(w).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `Σ=${sum}`);
    assert.deepEqual(
        [...OPINION_RUN_MODULES].sort(),
        [...Object.keys(w), 'prediction_extraction'].sort(),
        'run roster = weighted modules + the unscored ledger feeder');
});

test('OP.2 ceiling: the OQ.2 formula, clamped, defaulting honestly', () => {
    const at = (lb, ver) => opinionKnowabilityCeiling({
        summary: { load_bearing_count: lb, load_bearing_verifiable_count: ver }
    });
    assert.equal(at(4, 4).ceiling, 95);
    assert.equal(at(4, 0).ceiling, 50);
    assert.equal(at(4, 2).ceiling, 73);
    assert.ok(at(4, 2).notes.includes('50%'));
    const dflt = opinionKnowabilityCeiling(null);
    assert.equal(dflt.ceiling, 90);
    assert.ok(dflt.notes.includes('unavailable'));
    assert.equal(OPINION_CEILING_SOURCE, 'heuristic:premise-accuracy/1.0');
});

test('OP.2 additive: the news family is untouched', () => {
    assert.equal(MODULE_NAMES.length, 8, 'MODULE_NAMES stays the eight news modules');
    assert.ok(!MODULE_NAMES.includes('premise_accuracy'));
    for (const m of OPINION_MODULE_NAMES) {
        assert.equal(CURRENT_MODULE_VERSIONS[m], '1.0', m);
    }
    assert.equal(CURRENT_MODULE_VERSIONS.source_quality, '1.1', 'R2 bump survives');
});
