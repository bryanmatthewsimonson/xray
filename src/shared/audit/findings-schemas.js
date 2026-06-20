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
// color; tolerance here never weakens the required core).

const SEVERITY = ['low', 'medium', 'high'];

// --- tiny schema vocabulary -------------------------------------------------
// type: 'string'|'number'|'integer'|'boolean'|'object'|'array', or an
// array of those plus 'null'; const; enum; minimum/maximum (numbers);
// minLength (strings — applied only when the value IS a string, so
// ['string','null'] fields stay nullable); pattern; items; properties;
// required.

function str(extra = {}) { return { type: 'string', ...extra }; }
function quote() { return { type: 'string', minLength: 1 }; }
function nullableStr(extra = {}) { return { type: ['string', 'null'], ...extra }; }
function nullableQuote() { return { type: ['string', 'null'], minLength: 1 }; }
function int(extra = {}) { return { type: 'integer', ...extra }; }
function bool() { return { type: 'boolean' }; }
function en(values) { return { type: 'string', enum: values }; }
function arr(items) { return { type: 'array', items }; }
function obj(properties, required = []) { return { type: 'object', properties, required }; }
function strArr() { return arr(str()); }

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
export const CURRENT_MODULE_VERSIONS = Object.freeze(
    Object.fromEntries(MODULE_NAMES.map((m) => [m, '1.0'])));

// prediction_extraction does not score (the ledger does, later).
export const SCOREABLE_MODULES = Object.freeze(
    MODULE_NAMES.filter((m) => m !== 'prediction_extraction')
);

const SEMVER_PATTERN = /^\d+\.\d+(\.\d+)?$/;

// --- walker ------------------------------------------------------------------

function typeOf(value) {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value;
}

function typeMatches(value, type) {
    const t = typeOf(value);
    if (type === 'integer') return t === 'number' && Number.isInteger(value);
    if (type === 'number') return t === 'number' && Number.isFinite(value);
    return t === type;
}

function walk(value, schema, path, errors) {
    const types = Array.isArray(schema.type) ? schema.type : (schema.type ? [schema.type] : null);
    if (types && !types.some((t) => typeMatches(value, t))) {
        errors.push({ path, message: `expected ${types.join('|')}, got ${typeOf(value)}` });
        return;
    }
    if (value === null) return;   // nullable and null — nothing further to check

    if ('const' in schema && value !== schema.const) {
        errors.push({ path, message: `expected "${schema.const}", got "${value}"` });
    }
    if (schema.enum && !schema.enum.includes(value)) {
        errors.push({ path, message: `"${value}" not in [${schema.enum.join(', ')}]` });
    }
    if (typeof value === 'string') {
        if (schema.minLength !== undefined && value.length < schema.minLength) {
            errors.push({ path, message: `shorter than minLength ${schema.minLength}` });
        }
        if (schema.pattern && !schema.pattern.test(value)) {
            errors.push({ path, message: `does not match ${schema.pattern}` });
        }
    }
    if (typeof value === 'number') {
        if (schema.minimum !== undefined && value < schema.minimum) {
            errors.push({ path, message: `below minimum ${schema.minimum}` });
        }
        if (schema.maximum !== undefined && value > schema.maximum) {
            errors.push({ path, message: `above maximum ${schema.maximum}` });
        }
    }
    if (Array.isArray(value) && schema.items) {
        value.forEach((item, i) => walk(item, schema.items, `${path}[${i}]`, errors));
    }
    if (typeOf(value) === 'object' && schema.properties) {
        for (const key of schema.required || []) {
            if (!(key in value)) {
                errors.push({ path: `${path}.${key}`, message: 'required field missing' });
            }
        }
        for (const [key, sub] of Object.entries(schema.properties)) {
            if (key in value) walk(value[key], sub, `${path}.${key}`, errors);
        }
        // Unknown extra fields are tolerated by design.
    }
}

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
    const schema = PAYLOADS[moduleName];
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
