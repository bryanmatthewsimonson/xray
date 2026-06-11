// Phase 13.1 — derived per-module findings schemas. The validators
// close the gap the scorer README's Limitations section admits (the
// prototype only extracts JSON; "validates each output" was
// aspirational).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MODULE_NAMES, SCOREABLE_MODULES, validateFindings } from '../src/shared/audit/findings-schemas.js';

function envelope(module, scored = true) {
    const base = { module, version: '1.0', auditor_caveats: ['Surface scan only; substantive claims not verified.'] };
    return scored ? { ...base, score: 80, confidence: 0.8, confidence_notes: 'clear structure' } : base;
}

const MINIMAL = {
    headline_body_fidelity: {
        headline: 'H', subhead: null,
        headline_implications: [], body_findings: [], structural_issues: []
    },
    asymmetric_language: {
        has_contrast_structure: false,
        parties_identified: [], language_applied: [], asymmetry_findings: []
    },
    number_hygiene: {
        numerical_claims: [],
        summary: { total_claims: 0, claims_failing_at_least_one_test: 0 }
    },
    source_quality: {
        sources: [], claim_to_source_map: [], single_sourced_contested_claims: [],
        primary_documents: [],
        summary: {
            total_sources: 0, named_count: 0, anonymous_count: 0,
            anonymous_justified_count: 0, expert_says_vague_count: 0,
            documents_cited: 0, documents_specifically_identified: 0
        }
    },
    internal_coherence: { contradictions: [], logical_gaps: [] },
    definitional_precision: { contested_terms: [], weasel_quantifiers: [], category_laundering: [] },
    omission: {
        topic_summary: 'Local zoning fight.',
        voices_directly_quoted: [], voices_paraphrased_only: [],
        voices_referenced_but_silent: [], natural_stakeholder_set: [],
        voices_expected_but_absent: [], speaks_for_instances: []
    },
    prediction_extraction: { predictions: [], summary: { total_predictions: 0 } }
};

function minimalPayload(module) {
    const scored = module !== 'prediction_extraction';
    return { ...envelope(module, scored), ...structuredClone(MINIMAL[module]) };
}

test('eight modules, seven scoreable', () => {
    assert.equal(MODULE_NAMES.length, 8);
    assert.equal(SCOREABLE_MODULES.length, 7);
    assert.ok(!SCOREABLE_MODULES.includes('prediction_extraction'));
});

test('every module: minimal conforming payload validates', () => {
    for (const module of MODULE_NAMES) {
        const { valid, errors } = validateFindings(module, minimalPayload(module));
        assert.ok(valid, `${module}: ${JSON.stringify(errors)}`);
    }
});

test('envelope: module mismatch, bad version, missing caveats all fail', () => {
    const p = minimalPayload('number_hygiene');
    assert.ok(!validateFindings('number_hygiene', { ...p, module: 'omission' }).valid);
    assert.ok(!validateFindings('number_hygiene', { ...p, version: 'v1' }).valid);
    const noCaveats = { ...p };
    delete noCaveats.auditor_caveats;
    assert.ok(!validateFindings('number_hygiene', noCaveats).valid,
        'a module that emits findings without caveats is broken (PHILOSOPHY §2)');
});

test('envelope: score/confidence required and range-checked on scoreable modules', () => {
    const p = minimalPayload('internal_coherence');
    assert.ok(!validateFindings('internal_coherence', { ...p, score: 101 }).valid);
    assert.ok(!validateFindings('internal_coherence', { ...p, score: -1 }).valid);
    assert.ok(!validateFindings('internal_coherence', { ...p, confidence: 1.5 }).valid);
    const noScore = { ...p };
    delete noScore.score;
    assert.ok(!validateFindings('internal_coherence', noScore).valid);
});

test('prediction_extraction: score/confidence are FORBIDDEN, not optional', () => {
    const p = minimalPayload('prediction_extraction');
    assert.ok(validateFindings('prediction_extraction', p).valid);
    assert.ok(!validateFindings('prediction_extraction', { ...p, score: 75 }).valid,
        'a scored prediction_extraction is malformed — predictions are not scored at extraction');
    assert.ok(!validateFindings('prediction_extraction', { ...p, confidence: 0.9 }).valid);
});

test('module 03: full claim item validates; broken items fail precisely', () => {
    const item = {
        id: 1, claim: 'Crime rose 30%', value: '30%', context: 'year over year',
        denominator_test: 'failed', base_rate_test: 'not_applicable',
        comparison_class_test: 'passed', additional_issues: [],
        evidence_quote: 'crime rose by 30 percent', notes: 'no denominator given'
    };
    const ok = minimalPayload('number_hygiene');
    ok.numerical_claims = [item];
    ok.summary = { total_claims: 1, claims_failing_at_least_one_test: 1, most_common_failure: 'denominator' };
    assert.ok(validateFindings('number_hygiene', ok).valid);

    const badEnum = structuredClone(ok);
    badEnum.numerical_claims[0].denominator_test = 'maybe';
    assert.ok(!validateFindings('number_hygiene', badEnum).valid);

    const emptyQuote = structuredClone(ok);
    emptyQuote.numerical_claims[0].evidence_quote = '';
    assert.ok(!validateFindings('number_hygiene', emptyQuote).valid,
        'evidence-bound: an empty evidence quote is invalid (P3)');

    const noQuote = structuredClone(ok);
    delete noQuote.numerical_claims[0].evidence_quote;
    assert.ok(!validateFindings('number_hygiene', noQuote).valid);

    // Descriptive enrichments are optional — their absence is benign.
    const lean = structuredClone(ok);
    delete lean.numerical_claims[0].id;
    delete lean.numerical_claims[0].context;
    delete lean.numerical_claims[0].notes;
    delete lean.summary.most_common_failure;
    assert.ok(validateFindings('number_hygiene', lean).valid,
        'a benign omission must not turn a paid run into a failed one');
});

test('module 01: nullable evidence_quote is null-or-nonempty, never empty', () => {
    const p = minimalPayload('headline_body_fidelity');
    p.headline_implications = [{ id: 0, implication: 'X causes Y', type: 'causal', implied_strength: 'definite' }];
    p.body_findings = [{ implication_id: 0, support_status: 'unsupported', evidence_quote: null }];
    assert.ok(validateFindings('headline_body_fidelity', p).valid,
        'null evidence_quote is the unsupported-implication case');

    p.body_findings[0].evidence_quote = '';
    assert.ok(!validateFindings('headline_body_fidelity', p).valid,
        'empty string is not null — evidence-bound');
});

test('module 04: the ceiling-heuristic summary counts are load-bearing — all required', () => {
    const p = minimalPayload('source_quality');
    delete p.summary.documents_specifically_identified;
    assert.ok(!validateFindings('source_quality', p).valid);
});

test('module 08: prediction items pin the ledger enums', () => {
    const p = minimalPayload('prediction_extraction');
    p.predictions = [{
        id: 0, prediction: 'Rates will fall by December.',
        type: 'explicit', hedge_level: 'confident', attributed_to: 'named_source',
        attributed_source_name: 'Chair Powell', condition: null,
        resolution_horizon: 'by the end of the year',
        resolution_criteria: 'Fed funds target below current by Dec 31',
        tractability: 'publicly_resolvable',
        evidence_quote: 'rates will come down before December'
    }];
    p.summary.total_predictions = 1;
    assert.ok(validateFindings('prediction_extraction', p).valid);

    p.predictions[0].hedge_level = 'certain';
    assert.ok(!validateFindings('prediction_extraction', p).valid,
        'hedge enum is the calibration input — unknown values must fail');
});

// Populated canonical payloads for the modules the minimal test only
// exercises empty — built field-for-field from the vendored prompts'
// output specs. THE import-path make-or-break: a real paid run's
// output must validate, so a wrongly-required field or item-schema
// typo here fails loudly.
const POPULATED = {
    asymmetric_language: {
        has_contrast_structure: true,
        parties_identified: [
            { name: 'Sen. Alice Hale', role: 'bill sponsor' },
            { name: 'Gov. Tom Rusk', role: 'opponent' }
        ],
        language_applied: [
            { party: 'Sen. Alice Hale', verbs: ['stated', 'outlined'], adjectives: ['measured'], epithets_or_labels: [], sourcing_verbs: ['said'] },
            { party: 'Gov. Tom Rusk', verbs: ['lashed out', 'claimed'], adjectives: ['combative'], epithets_or_labels: ['hardliner'], sourcing_verbs: ['insisted'] }
        ],
        asymmetry_findings: [{
            dimension: 'sourcing_verbs',
            party_a: 'Sen. Alice Hale', party_a_term: 'said',
            party_b: 'Gov. Tom Rusk', party_b_term: 'insisted',
            evidence_quote_a: 'Hale said the bill would cap fees',
            evidence_quote_b: 'Rusk insisted the numbers were wrong',
            justified_by_underlying_facts: false,
            justification_notes: null,
            severity: 'medium'
        }]
    },
    source_quality: {
        sources: [
            { id: 1, label: 'Treasury spokesperson', type: 'named_primary', anonymity_justification: null, relationship_to_matter: 'official statement', evidence_quote: 'a Treasury spokesperson said' },
            { id: 2, label: 'people familiar with the matter', type: 'anonymous_bare', anonymity_justification: null, relationship_to_matter: 'unclear', evidence_quote: 'according to people familiar with the matter' }
        ],
        claim_to_source_map: [{
            claim: 'The department will revise the rule',
            source_ids: [1], is_contested: false, contested_reason: null,
            evidence_quote: 'will revise the rule, the spokesperson said'
        }],
        single_sourced_contested_claims: [{
            claim: 'Officials knew in March', source_id: 2, source_type: 'anonymous_bare',
            evidence_quote: 'officials knew as early as March'
        }],
        primary_documents: [{
            document: 'the draft rule', linked_or_quoted: false,
            specific_enough_to_retrieve: false, evidence_quote: 'a draft rule circulated last week'
        }],
        summary: {
            total_sources: 2, named_count: 1, anonymous_count: 1,
            anonymous_justified_count: 0, expert_says_vague_count: 0,
            documents_cited: 1, documents_specifically_identified: 0
        }
    },
    internal_coherence: {
        contradictions: [{
            type: 'numerical',
            claim_a: 'costs rose 12%', claim_b: 'costs nearly doubled',
            evidence_quote_a: 'rose 12 percent over the year',
            evidence_quote_b: 'costs nearly doubled in a year',
            is_dialectic_intent: false, severity: 'high',
            notes: 'same metric, same period'
        }],
        logical_gaps: [{
            description: 'conclusion assumes causation from a single correlation',
            evidence_quote: 'because enrollment fell, the policy failed',
            severity: 'medium'
        }]
    },
    definitional_precision: {
        contested_terms: [{
            term: 'misinformation', occurrences: 4,
            first_use_quote: 'a wave of misinformation',
            defined_in_text: false, definition_quote: null,
            definition_quality: 'absent',
            smuggled_assumption: 'that the contested claims are settled false',
            load_bearing: true, used_consistently: false,
            severity_if_undefined: 'high'
        }],
        weasel_quantifiers: [{
            term: 'many experts', evidence_quote: 'many experts agree',
            backed_by_evidence: false, severity: 'medium'
        }],
        category_laundering: [{
            category: 'assault-style weapons',
            evidence_quote: 'assault-style weapons were used',
            treatment: 'undefined category presented as settled',
            severity: 'medium'
        }]
    },
    omission: {
        topic_summary: 'School closure fight in the district.',
        voices_directly_quoted: [{
            name_or_role: 'union president', perspective_summary: 'opposes the closure',
            quote_density: 'high', evidence_quote: '"this will gut the district," she said'
        }],
        voices_paraphrased_only: [{
            name_or_role: 'district spokesperson', perspective_summary: 'cites budget pressure',
            evidence_quote: 'the district pointed to budget shortfalls'
        }],
        voices_referenced_but_silent: [{
            name_or_role: 'parents', absence_addressed: false, absence_explanation: null
        }],
        natural_stakeholder_set: ['teachers', 'parents', 'students', 'district officials'],
        voices_expected_but_absent: [{
            role: 'students', why_expected: 'directly affected by the closure',
            absence_addressed: false, severity: 'medium'
        }],
        speaks_for_instances: [{
            speaking_party: 'union president', spoken_for_party: 'teachers',
            evidence_quote: 'teachers want answers, she said', severity: 'low'
        }],
        quotation_balance_notes: 'union voices dominate direct quotation'
    }
};

test('populated canonical payloads validate for every list-heavy module', () => {
    for (const [module, payload] of Object.entries(POPULATED)) {
        const full = { ...envelope(module, true), ...structuredClone(payload) };
        const { valid, errors } = validateFindings(module, full);
        assert.ok(valid, `${module}: a real run's output must pass — ${JSON.stringify(errors)}`);
    }
});

test('the scorer-export WRAPPER level is rejected — importers must validate findings, not the wrapper', () => {
    // scorer.js wraps payloads as ModuleResult: {module, module_version,
    // auditor, run_at, score, confidence, findings, ...}. Validating
    // the wrapper instead of wrapper.findings is the easy importer bug
    // (module_version vs version) — it must FAIL, loudly.
    const wrapper = {
        module: 'omission', module_version: '1.0',
        auditor: { kind: 'model', id: 'anthropic/claude-sonnet-4-6' },
        run_at: '2026-06-11T20:14:00Z', score: 70, confidence: 0.8,
        findings: { ...envelope('omission', true), ...structuredClone(MINIMAL.omission) },
        evidence_quotes: [], auditor_caveats: []
    };
    assert.ok(!validateFindings('omission', wrapper).valid);
    assert.ok(validateFindings('omission', wrapper.findings).valid,
        'the wrapped findings themselves are the validatable unit');
});

test('the scorer failed-run shape is rejected, never mistaken for findings', () => {
    // runModule's error path emits findings: {error: "..."} — that is a
    // failed run (stored with score null, excluded from aggregation),
    // not a validatable payload.
    assert.ok(!validateFindings('omission', { error: 'API call failed: 529' }).valid);
});

test('unknown extra fields are tolerated; unknown modules are not', () => {
    const p = { ...minimalPayload('omission'), model_color_commentary: 'extra' };
    assert.ok(validateFindings('omission', p).valid);
    assert.ok(!validateFindings('sentiment_analysis', p).valid);
});

test('auditor-kind parity: validation is auditor-blind by construction (RQ3)', () => {
    // Identity rides event tags, never findings JSON — so a payload a
    // human author produced under the guided checklist validates by
    // exactly the same rules. Nothing here can special-case the kind.
    const p = minimalPayload('definitional_precision');
    const asHuman = { ...p, auditor: { kind: 'human', id: 'a'.repeat(64) } };
    const asModel = { ...p, auditor: { kind: 'model', id: 'anthropic/claude-sonnet-4-6' } };
    assert.deepEqual(validateFindings('definitional_precision', asHuman),
        validateFindings('definitional_precision', asModel));
    assert.ok(validateFindings('definitional_precision', asHuman).valid);
});
