// X-Ray — derived per-module findings schemas + validator (Phase 13,
// slice 13.1).
//
// The framework's schema/modules/*.json files were never recovered;
// both vendored READMEs state they are DERIVED from the prompt output
// specifications in docs/auditor-prototype/prompts/01–08, so this
// module derives them (docs/EPISTEMIC_AUDIT_DESIGN.md §"Derived
// findings schemas"). The vendored scorer only extracts JSON — its own
// Limitations section admits validation was aspirational; this closes
// that gap.
//
// Required-ness policy (the design note's worked module-03 example,
// applied uniformly): fields that drive scoring, identity, or
// downstream consumers — enum discriminators, scoring booleans, the
// claim/term/party text, every evidence quote — are required;
// descriptive enrichments (ids, notes, context) are typed but
// optional, so a benign omission doesn't turn a paid model run into a
// failed one. Exception, per the design note: module 04's summary
// block feeds the knowability-ceiling heuristic — all seven counts
// are required, their names load-bearing.
//
// Evidence-bound (P3): every mandated evidence quote is
// `minLength: 1` — a finding with an empty quote is invalid, not
// merely weak. Module 08 carries NO score/confidence (predictions are
// not scored at extraction); a scored prediction_extraction payload
// is malformed and rejected.
//
// The walker is hand-rolled — the repo takes no schema-library
// dependency; these shapes need only type/enum/const/required/range/
// minLength checks. Unknown extra fields are tolerated (models add
// color; tolerance here never weakens the required core). Since
// Phase 16.2 the walker + schema vocabulary live in
// ../schema-walker.js, shared with the lens-reading schemas
// (lens-schemas.js) — one walker, no fork; behavior is unchanged.

import {
    str, quote, nullableStr, nullableQuote, int, bool, en, arr, obj, strArr,
    typeOf, walk
} from '../schema-walker.js';

const SEVERITY = ['low', 'medium', 'high'];

// --- per-module payload schemas (beyond the shared envelope) ----------------
//
// Exported so the in-extension auditor's LLM tool schema
// (audit-prompt.js) is BUILT FROM these exact shapes — the model is
// guided by the same definitions the validator enforces, so a clean
// pass imports without failing. One source of truth, no drift.

export const PAYLOADS = {
    headline_body_fidelity: obj({
        headline: quote(),
        subhead: nullableStr(),
        headline_implications: arr(obj({
            id: int({ minimum: 0 }),
            implication: quote(),
            type: en(['factual', 'causal', 'evaluative', 'predictive']),
            implied_strength: en(['definite', 'likely', 'hedged'])
        }, ['implication', 'type', 'implied_strength'])),
        body_findings: arr(obj({
            implication_id: int({ minimum: 0 }),
            support_status: en(['supported', 'partially_supported', 'unsupported', 'contradicted']),
            evidence_quote: nullableQuote(),   // null permitted when support is absent
            notes: str()
        }, ['implication_id', 'support_status'])),
        structural_issues: arr(obj({
            type: en(['buried_qualification', 'inverted_emphasis', 'clickbait_framing',
                      'actor_switching', 'modality_drift', 'other']),
            description: quote(),
            evidence_quote: quote(),
            severity: en(SEVERITY)
        }, ['type', 'description', 'evidence_quote', 'severity']))
    }, ['headline', 'subhead', 'headline_implications', 'body_findings', 'structural_issues']),

    asymmetric_language: obj({
        has_contrast_structure: bool(),
        parties_identified: arr(obj({
            name: str(),
            role: str()
        }, ['name', 'role'])),
        language_applied: arr(obj({
            party: str(),
            verbs: strArr(),
            adjectives: strArr(),
            epithets_or_labels: strArr(),
            sourcing_verbs: strArr()
        }, ['party'])),
        asymmetry_findings: arr(obj({
            dimension: en(['action_verbs', 'motivation_attribution', 'epithets',
                           'sourcing_verbs', 'voice_agency', 'quantitative_framing']),
            party_a: str(),
            party_a_term: str(),
            party_b: str(),
            party_b_term: str(),
            evidence_quote_a: quote(),
            evidence_quote_b: quote(),
            justified_by_underlying_facts: bool(),
            justification_notes: nullableStr(),
            severity: en(SEVERITY)
        }, ['dimension', 'party_a', 'party_a_term', 'party_b', 'party_b_term',
            'evidence_quote_a', 'evidence_quote_b', 'justified_by_underlying_facts',
            'severity']))
    }, ['has_contrast_structure', 'parties_identified', 'language_applied', 'asymmetry_findings']),

    // Pinned to the design note's worked example, exactly.
    number_hygiene: obj({
        numerical_claims: arr(obj({
            id: int(),
            claim: str(),
            value: str(),
            context: str(),
            denominator_test: en(['passed', 'failed', 'not_applicable']),
            base_rate_test: en(['passed', 'failed', 'not_applicable']),
            comparison_class_test: en(['passed', 'failed', 'not_applicable']),
            additional_issues: strArr(),
            evidence_quote: quote(),
            notes: str()
        }, ['claim', 'value', 'denominator_test', 'base_rate_test',
            'comparison_class_test', 'evidence_quote'])),
        summary: obj({
            total_claims: int({ minimum: 0 }),
            claims_failing_at_least_one_test: int({ minimum: 0 }),
            most_common_failure: en(['denominator', 'base_rate', 'comparison_class', 'none'])
        }, ['total_claims', 'claims_failing_at_least_one_test'])
    }, ['numerical_claims', 'summary']),

    source_quality: obj({
        sources: arr(obj({
            id: int(),
            label: str(),
            type: en(['named_primary', 'named_secondary', 'anonymous_justified',
                      'anonymous_bare', 'document_cited', 'study_cited', 'expert_says_vague']),
            anonymity_justification: nullableStr(),
            relationship_to_matter: str(),
            evidence_quote: quote()
        }, ['id', 'label', 'type', 'evidence_quote'])),
        claim_to_source_map: arr(obj({
            claim: str(),
            source_ids: arr(int()),
            is_contested: bool(),
            contested_reason: nullableStr(),
            evidence_quote: quote()
        }, ['claim', 'source_ids', 'is_contested', 'evidence_quote'])),
        single_sourced_contested_claims: arr(obj({
            claim: str(),
            source_id: int(),
            source_type: en(['named_primary', 'named_secondary', 'anonymous_justified',
                             'anonymous_bare', 'document_cited', 'study_cited', 'expert_says_vague']),
            evidence_quote: quote()
        }, ['claim', 'source_id', 'source_type', 'evidence_quote'])),
        primary_documents: arr(obj({
            document: str(),
            linked_or_quoted: bool(),
            specific_enough_to_retrieve: bool(),
            evidence_quote: quote()
        }, ['document', 'linked_or_quoted', 'specific_enough_to_retrieve', 'evidence_quote'])),
        // v1.1 (corpus-aware source quality, R2): the article's
        // characterization of cited sources the corpus already holds,
        // judged against the source's own excerpt. OPTIONAL — absent on
        // every 1.0 result and on runs with no resolvable citations
        // (the walker skips undeclared-absent properties by design).
        corpus_source_checks: arr(obj({
            cited_as: str(),
            member_url: str(),
            characterization: en(['accurate', 'partially_accurate',
                                  'mischaracterized', 'cannot_determine']),
            note: str(),
            evidence_quote: quote(),
            source_quote: nullableStr()
        }, ['cited_as', 'member_url', 'characterization', 'evidence_quote'])),
        // Load-bearing for the knowability-ceiling heuristic: all seven
        // counts required, names pinned (scorer.js aggregate()).
        summary: obj({
            total_sources: int({ minimum: 0 }),
            named_count: int({ minimum: 0 }),
            anonymous_count: int({ minimum: 0 }),
            anonymous_justified_count: int({ minimum: 0 }),
            expert_says_vague_count: int({ minimum: 0 }),
            documents_cited: int({ minimum: 0 }),
            documents_specifically_identified: int({ minimum: 0 })
        }, ['total_sources', 'named_count', 'anonymous_count', 'anonymous_justified_count',
            'expert_says_vague_count', 'documents_cited', 'documents_specifically_identified'])
    }, ['sources', 'claim_to_source_map', 'single_sourced_contested_claims',
        'primary_documents', 'summary']),

    internal_coherence: obj({
        contradictions: arr(obj({
            type: en(['factual', 'numerical', 'causal', 'tonal', 'modality',
                      'quote_paraphrase', 'caption_text', 'lead_body']),
            claim_a: str(),
            claim_b: str(),
            evidence_quote_a: quote(),
            evidence_quote_b: quote(),
            is_dialectic_intent: bool(),
            severity: en(SEVERITY),
            notes: str()
        }, ['type', 'claim_a', 'claim_b', 'evidence_quote_a', 'evidence_quote_b',
            'is_dialectic_intent', 'severity'])),
        logical_gaps: arr(obj({
            description: str(),
            evidence_quote: quote(),
            severity: en(SEVERITY)
        }, ['description', 'evidence_quote', 'severity']))
    }, ['contradictions', 'logical_gaps']),

    definitional_precision: obj({
        contested_terms: arr(obj({
            term: str(),
            occurrences: int(),
            first_use_quote: quote(),
            defined_in_text: bool(),
            definition_quote: nullableStr(),
            definition_quality: en(['explicit', 'contextual', 'absent']),
            smuggled_assumption: nullableStr(),
            load_bearing: bool(),
            used_consistently: bool(),
            severity_if_undefined: en(SEVERITY)
        }, ['term', 'first_use_quote', 'defined_in_text', 'definition_quality',
            'load_bearing', 'used_consistently', 'severity_if_undefined'])),
        weasel_quantifiers: arr(obj({
            term: str(),
            evidence_quote: quote(),
            backed_by_evidence: bool(),
            severity: en(SEVERITY)
        }, ['term', 'evidence_quote', 'backed_by_evidence', 'severity'])),
        category_laundering: arr(obj({
            category: str(),
            evidence_quote: quote(),
            treatment: str(),
            severity: en(SEVERITY)
        }, ['category', 'evidence_quote', 'severity']))
    }, ['contested_terms', 'weasel_quantifiers', 'category_laundering']),

    omission: obj({
        topic_summary: str(),
        voices_directly_quoted: arr(obj({
            name_or_role: str(),
            perspective_summary: str(),
            quote_density: en(['high', 'medium', 'low']),
            evidence_quote: quote()
        }, ['name_or_role', 'perspective_summary', 'quote_density', 'evidence_quote'])),
        voices_paraphrased_only: arr(obj({
            name_or_role: str(),
            perspective_summary: str(),
            evidence_quote: quote()
        }, ['name_or_role', 'perspective_summary', 'evidence_quote'])),
        voices_referenced_but_silent: arr(obj({
            name_or_role: str(),
            absence_addressed: bool(),
            absence_explanation: nullableStr()
        }, ['name_or_role', 'absence_addressed'])),
        natural_stakeholder_set: strArr(),
        voices_expected_but_absent: arr(obj({
            role: str(),
            why_expected: str(),
            absence_addressed: bool(),
            severity: en(SEVERITY)
        }, ['role', 'why_expected', 'absence_addressed', 'severity'])),
        speaks_for_instances: arr(obj({
            speaking_party: str(),
            spoken_for_party: str(),
            evidence_quote: quote(),
            severity: en(SEVERITY)
        }, ['speaking_party', 'spoken_for_party', 'evidence_quote', 'severity'])),
        quotation_balance_notes: str()
    }, ['topic_summary', 'voices_directly_quoted', 'voices_paraphrased_only',
        'voices_referenced_but_silent', 'natural_stakeholder_set',
        'voices_expected_but_absent', 'speaks_for_instances']),

    prediction_extraction: obj({
        predictions: arr(obj({
            id: int({ minimum: 0 }),
            prediction: quote(),
            type: en(['explicit', 'implicit', 'conditional', 'negative', 'counterfactual']),
            hedge_level: en(['confident', 'hedged', 'speculative']),
            attributed_to: en(['article_voice', 'named_source', 'vague_attribution']),
            attributed_source_name: nullableStr(),
            condition: nullableStr(),
            resolution_horizon: str(),
            resolution_criteria: str(),
            tractability: en(['publicly_resolvable', 'requires_private_info', 'ambiguous']),
            evidence_quote: quote()
        }, ['prediction', 'type', 'hedge_level', 'attributed_to',
            'resolution_horizon', 'resolution_criteria', 'tractability',
            'evidence_quote'])),
        summary: obj({
            total_predictions: int({ minimum: 0 }),
            explicit_count: int({ minimum: 0 }),
            implicit_count: int({ minimum: 0 }),
            confident_count: int({ minimum: 0 }),
            hedged_count: int({ minimum: 0 }),
            speculative_count: int({ minimum: 0 }),
            publicly_resolvable_count: int({ minimum: 0 })
        }, ['total_predictions'])
    }, ['predictions', 'summary'])
};

export const MODULE_NAMES = Object.freeze(Object.keys(PAYLOADS));

// The methodology versions the vendored prompts currently declare —
// the staleness reference: a stored result whose module_version is
// older gets a "re-audit under vX.Y" offer (never auto-recompute;
// old results stay valid under their recorded version, P9/§8). Bump
// alongside the prompt when a methodology changes.
// --- the OPINION module family (R5/OP.2; docs/OPINION_MODULES_KICKOFF.md) ---
//
// Opinion is graded on ARGUMENT, never conclusion (PHILOSOPHY §3.2,
// red line 2). Additive: OPINION_PAYLOADS is a second family beside
// PAYLOADS — MODULE_NAMES and every news consumer are untouched (the
// corpus-v7 lesson). Two news modules are REUSED unchanged on opinion
// artifacts per the §8 rulings: asymmetric_language (OQ.5) and
// definitional_precision; prediction_extraction runs too (unscored).
//
// RED LINE 2, structural: no field in these schemas may express a
// stance on the author's conclusion. tests/opinion-schemas.test.mjs
// walks every property name and enum value and fails on anything
// stance-shaped — the wrong field is inexpressible, not just absent.

export const OPINION_PAYLOADS = {
    premise_accuracy: obj({
        premises: arr(obj({
            id: int(),
            premise: str(),
            role: en(['load_bearing', 'supporting', 'incidental']),
            kind: en(['factual', 'interpretive', 'predictive', 'normative']),
            verifiable_in_principle: bool(),
            accuracy: en(['supported', 'unsupported', 'contradicted', 'not_checkable']),
            evidence_quote: quote(),
            notes: str()
        }, ['premise', 'role', 'kind', 'verifiable_in_principle', 'accuracy', 'evidence_quote'])),
        // Load-bearing for the opinion knowability ceiling
        // (heuristic:premise-accuracy/1.0) — names pinned.
        summary: obj({
            total_premises: int({ minimum: 0 }),
            load_bearing_count: int({ minimum: 0 }),
            load_bearing_verifiable_count: int({ minimum: 0 }),
            unsupported_load_bearing: int({ minimum: 0 }),
            contradicted_load_bearing: int({ minimum: 0 })
        }, ['total_premises', 'load_bearing_count', 'load_bearing_verifiable_count',
            'unsupported_load_bearing', 'contradicted_load_bearing'])
    }, ['premises', 'summary']),

    logical_validity: obj({
        argument_map: obj({
            conclusion: str(),
            premises_summary: str()
        }, ['conclusion']),
        fallacies: arr(obj({
            type: en(['ad_hominem', 'false_dilemma', 'circular', 'slippery_slope',
                      'appeal_to_authority', 'appeal_to_consequences', 'whataboutism',
                      'non_sequitur', 'hasty_generalization', 'motte_and_bailey', 'other']),
            description: str(),
            evidence_quote: quote(),
            severity: en(SEVERITY)
        }, ['type', 'description', 'evidence_quote', 'severity'])),
        valid_moves: arr(obj({
            description: str(),
            evidence_quote: quote()
        }, ['description', 'evidence_quote']))
    }, ['argument_map', 'fallacies', 'valid_moves']),

    steel_manning: obj({
        opposition_positions: arr(obj({
            position: str(),
            engaged: bool(),
            strongest_form_engaged: en(['steel', 'representative', 'weakened', 'strawman', 'absent']),
            evidence_quote: nullableQuote(),
            notes: str()
        }, ['position', 'engaged', 'strongest_form_engaged'])),
        summary: obj({
            positions_identified: int({ minimum: 0 }),
            steel_manned: int({ minimum: 0 }),
            strawmanned: int({ minimum: 0 })
        }, ['positions_identified', 'steel_manned', 'strawmanned'])
    }, ['opposition_positions', 'summary']),

    fact_interpretation_separation: obj({
        boundary_findings: arr(obj({
            type: en(['clear_signal', 'smuggled_interpretation',
                      'interpretation_stated_as_fact', 'fact_hedged_as_opinion']),
            evidence_quote: quote(),
            severity: en(SEVERITY),
            notes: str()
        }, ['type', 'evidence_quote', 'severity'])),
        summary: obj({
            clear_count: int({ minimum: 0 }),
            smuggled_count: int({ minimum: 0 })
        }, ['clear_count', 'smuggled_count'])
    }, ['boundary_findings', 'summary']),

    disclosure_transparency: obj({
        disclosures: arr(obj({
            kind: en(['prior_position', 'conflict_financial', 'conflict_relational',
                      'methodology', 'uncertainty']),
            disclosed: bool(),
            evidence_quote: nullableQuote(),
            notes: str()
        }, ['kind', 'disclosed'])),
        // The outsider can only assess what the TEXT discloses (§2) —
        // suspicion of undisclosed conflicts from outside knowledge
        // belongs in caveats, never in findings.
        summary: obj({
            disclosed_count: int({ minimum: 0 }),
            disclosure_present: bool()
        }, ['disclosed_count', 'disclosure_present'])
    }, ['disclosures', 'summary']),

    originality_synthesis: obj({
        assessment: obj({
            classification: en(['novel_synthesis', 'fresh_angle',
                                'competent_restatement', 'talking_points']),
            rationale: str()
        }, ['classification', 'rationale']),
        examples: arr(obj({
            point: str(),
            evidence_quote: quote()
        }, ['point', 'evidence_quote']))
    }, ['assessment', 'examples'])
};

export const OPINION_MODULE_NAMES = Object.freeze(Object.keys(OPINION_PAYLOADS));

// The full opinion RUN roster: six new + two reused (§8 OQ.5) + the
// unscored ledger feeder. Order is display order.
export const OPINION_RUN_MODULES = Object.freeze([
    ...OPINION_MODULE_NAMES,
    'asymmetric_language', 'definitional_precision', 'prediction_extraction'
]);

export const CURRENT_MODULE_VERSIONS = Object.freeze({
    ...Object.fromEntries(MODULE_NAMES.map((m) => [m, '1.0'])),
    // 1.1 (2026-08-02, R2): corpus-aware source quality — the prompt
    // gained methodology step 7 (corpus-held cited-source checks) and
    // the optional corpus_source_checks[] payload. The knowability
    // ceiling heuristic is UNCHANGED (same seven summary counts), so
    // ceiling_source stays heuristic:source-quality/1.0.
    source_quality: '1.1',
    // Opinion family (R5/OP.2) — all launch at 1.0.
    ...Object.fromEntries(OPINION_MODULE_NAMES.map((m) => [m, '1.0']))
});

// prediction_extraction does not score (the ledger does, later).
export const SCOREABLE_MODULES = Object.freeze(
    MODULE_NAMES.filter((m) => m !== 'prediction_extraction')
);

const SEMVER_PATTERN = /^\d+\.\d+(\.\d+)?$/;

// --- public API ---------------------------------------------------------------

/**
 * Validate one module's findings payload (the parsed content JSON of a
 * 30056, or one module object out of a scorer export) against its
 * derived schema — envelope first, payload second.
 *
 * Auditor identity never appears in findings JSON (it rides event
 * tags), so validation is auditor-kind-agnostic by construction: a
 * human-authored payload validates identically to a model's (RQ3).
 *
 * @param {string} moduleName - one of MODULE_NAMES
 * @param {object} payload - the findings object
 * @returns {{valid: boolean, errors: Array<{path: string, message: string}>}}
 */
export function validateFindings(moduleName, payload) {
    const errors = [];
    // One validator, both families (R5/OP.2): the opinion payloads ride
    // the same walker, envelope, and evidence discipline.
    const schema = PAYLOADS[moduleName] || OPINION_PAYLOADS[moduleName];
    if (!schema) {
        return { valid: false, errors: [{ path: '$', message: `unknown module "${moduleName}"` }] };
    }
    if (typeOf(payload) !== 'object') {
        return { valid: false, errors: [{ path: '$', message: `expected object, got ${typeOf(payload)}` }] };
    }

    // Envelope: module / version / auditor_caveats on everything.
    walk(payload.module, { type: 'string', const: moduleName }, '$.module', errors);
    if (!('module' in payload)) errors.push({ path: '$.module', message: 'required field missing' });
    if (!('version' in payload)) {
        errors.push({ path: '$.version', message: 'required field missing' });
    } else {
        walk(payload.version, { type: 'string', pattern: SEMVER_PATTERN }, '$.version', errors);
    }
    if (!('auditor_caveats' in payload)) {
        errors.push({ path: '$.auditor_caveats', message: 'required field missing' });
    } else {
        walk(payload.auditor_caveats, arr(str()), '$.auditor_caveats', errors);
    }

    // Envelope: score/confidence — required 01–07, FORBIDDEN on 08.
    if (moduleName === 'prediction_extraction') {
        if ('score' in payload) {
            errors.push({ path: '$.score', message: 'prediction_extraction is not scored — score is forbidden' });
        }
        if ('confidence' in payload) {
            errors.push({ path: '$.confidence', message: 'prediction_extraction is not scored — confidence is forbidden' });
        }
    } else {
        if (!('score' in payload)) {
            errors.push({ path: '$.score', message: 'required field missing' });
        } else {
            walk(payload.score, { type: 'number', minimum: 0, maximum: 100 }, '$.score', errors);
        }
        if (!('confidence' in payload)) {
            errors.push({ path: '$.confidence', message: 'required field missing' });
        } else {
            walk(payload.confidence, { type: 'number', minimum: 0, maximum: 1 }, '$.confidence', errors);
        }
        if ('confidence_notes' in payload) {
            walk(payload.confidence_notes, str(), '$.confidence_notes', errors);
        }
    }

    // Payload.
    walk(payload, { type: 'object', properties: schema.properties, required: schema.required }, '$', errors);

    return { valid: errors.length === 0, errors };
}
