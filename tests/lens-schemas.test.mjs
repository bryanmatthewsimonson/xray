// Phase 16.2/16.4 — lens-reading schema validators
// (docs/MORAL_LENS_JURISDICTION_DESIGN.md §7). Fixture-driven suites
// over the model-output contract and the assembled §7 shapes. The
// load-bearing rules are the CONTRACT rules, not style: disposition /
// corpus_stance mutual exclusivity by assertion type, the
// uncited-only-when-silent rule, and ground-in-corpus citation checks —
// all parse-time rejections, never prompt hopes.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    validateLensToolInput, validateJurisdictionReading, validateLensPanel,
    MODEL_OUTPUT_SCHEMA
} from '../src/shared/lens-schemas.js';

const CLAIMS = [
    { id: 'c1', text: 'Men should step down from hierarchy.', type: 'normative' },
    { id: 'c2', text: 'The senator voted no on March 3.', type: 'factual' },
    { id: 'c3', text: 'The title frames dissent as betrayal.', type: 'framing' }
];
const AUTH_IDS = ['auth_aaaaaaaaaaaaaaaa', 'auth_bbbbbbbbbbbbbbbb'];

function goodReading(over = {}) {
    return {
        claim_id: 'c1',
        disposition: 'partially-endorses',
        reasoning: 'Servant leadership reads hierarchy as service, not rank.',
        authorities_cited: [{ authority_id: AUTH_IDS[0], locator: 'Matthew 20:26', grounding: 'direct-quote' }],
        content_vs_framing: 'substance endorsed; the framing as a demand is rejected',
        confidence: 'medium',
        confidence_rationale: 'one shared text, divided tradition',
        ...over
    };
}

function goodFactualReading(over = {}) {
    return {
        claim_id: 'c2',
        corpus_stance: 'silent',
        reasoning: 'The loaded corpus does not speak to this vote.',
        authorities_cited: [],
        confidence: 'high',
        confidence_rationale: 'clear absence of coverage',
        ...over
    };
}

function toolInput(readings, over = {}) {
    return {
        readings,
        reconstruction_summary: 'A servant-leadership reading of the piece.',
        thin_coverage_flags: [],
        recommended_sources: [],
        ...over
    };
}

const CTX = { claims: CLAIMS, authorityIds: AUTH_IDS };

// --- happy path -----------------------------------------------------------------

test('lens-schemas: a conformant tool output validates, normalized to whitelisted keys', () => {
    const input = toolInput([goodReading(), goodFactualReading()]);
    input.readings[0].free_color_field = 'model chatter';
    const v = validateLensToolInput(input, CTX);
    assert.equal(v.ok, true);
    assert.equal(v.readings.length, 2);
    assert.equal(v.rejected.length, 0);
    assert.deepEqual(Object.keys(v.readings[0]).sort(), [
        'authorities_cited', 'claim_id', 'confidence', 'confidence_rationale',
        'content_vs_framing', 'disposition', 'reasoning'
    ], 'extras dropped — assembled output carries only contract keys');
    assert.deepEqual(Object.keys(v.readings[1]).sort(), [
        'authorities_cited', 'claim_id', 'confidence', 'confidence_rationale',
        'corpus_stance', 'reasoning'
    ]);
});

// --- the §3.2 firewall, mechanical ------------------------------------------------

test('lens-schemas: a factual claim with a disposition is REJECTED (§3.2)', () => {
    const v = validateLensToolInput(toolInput([
        goodFactualReading({ disposition: 'rejects', corpus_stance: undefined })
    ]), CTX);
    assert.equal(v.readings.length, 0);
    assert.equal(v.rejected.length, 1);
    assert.match(v.rejected[0].reason, /never carries a disposition/);
});

test('lens-schemas: a non-factual claim with corpus_stance is REJECTED', () => {
    const v = validateLensToolInput(toolInput([
        goodReading({ corpus_stance: 'asserts', disposition: undefined })
    ]), CTX);
    assert.equal(v.readings.length, 0);
    assert.match(v.rejected[0].reason, /reserved for factual assertions/);
});

test('lens-schemas: missing/invalid disposition or corpus_stance is REJECTED', () => {
    let v = validateLensToolInput(toolInput([goodReading({ disposition: 'approves' })]), CTX);
    assert.match(v.rejected[0].reason, /invalid disposition/);
    v = validateLensToolInput(toolInput([goodFactualReading({ corpus_stance: 'affirms' })]), CTX);
    assert.match(v.rejected[0].reason, /corpus_stance/);
});

// --- citations (ground-in-corpus) -------------------------------------------------

test('lens-schemas: an uncited reading is valid ONLY as silent / out-of-scope (§7)', () => {
    let v = validateLensToolInput(toolInput([
        goodReading({ authorities_cited: [] })
    ]), CTX);
    assert.equal(v.readings.length, 0);
    assert.match(v.rejected[0].reason, /cites no authorities/);

    v = validateLensToolInput(toolInput([
        goodReading({ disposition: 'silent', authorities_cited: [] }),
        goodReading({ claim_id: 'c3', disposition: 'out-of-scope', authorities_cited: [] })
    ]), CTX);
    assert.equal(v.readings.length, 2, 'silent and out-of-scope may be uncited');

    // Factual: asserts/denies must cite; silent may not.
    v = validateLensToolInput(toolInput([
        goodFactualReading({ corpus_stance: 'asserts', authorities_cited: [] })
    ]), CTX);
    assert.equal(v.readings.length, 0, 'an uncited "asserts" is a guess, not a description');
});

test('lens-schemas: citing an authority outside the loaded corpus is REJECTED', () => {
    const v = validateLensToolInput(toolInput([
        goodReading({ authorities_cited: [{ authority_id: 'auth_hallucinated00', grounding: 'paraphrase' }] })
    ]), CTX);
    assert.equal(v.readings.length, 0);
    assert.match(v.rejected[0].reason, /not in the loaded corpus/);
});

test('lens-schemas: invalid grounding level is REJECTED', () => {
    const v = validateLensToolInput(toolInput([
        goodReading({ authorities_cited: [{ authority_id: AUTH_IDS[0], grounding: 'vibes' }] })
    ]), CTX);
    assert.match(v.rejected[0].reason, /invalid grounding/);
});

// --- identity/dedup rules ----------------------------------------------------------

test('lens-schemas: unknown claim ids and duplicates are REJECTED (first kept)', () => {
    const v = validateLensToolInput(toolInput([
        goodReading(),
        goodReading({ disposition: 'rejects' }),                 // duplicate c1
        goodReading({ claim_id: 'c99' })                          // unknown
    ]), CTX);
    assert.equal(v.readings.length, 1);
    assert.equal(v.readings[0].disposition, 'partially-endorses', 'first reading kept');
    assert.equal(v.rejected.length, 2);
    assert.match(v.rejected[0].reason, /duplicate reading/);
    assert.match(v.rejected[1].reason, /unknown claim id/);
});

test('lens-schemas: missing reasoning / confidence / rationale are REJECTED (§5.1)', () => {
    let v = validateLensToolInput(toolInput([goodReading({ reasoning: '  ' })]), CTX);
    assert.match(v.rejected[0].reason, /no reasoning/);
    v = validateLensToolInput(toolInput([goodReading({ confidence: 0.7 })]), CTX);
    assert.match(v.rejected[0].reason, /invalid confidence/, 'no numeric confidence — not a score');
    v = validateLensToolInput(toolInput([goodReading({ confidence_rationale: '' })]), CTX);
    assert.match(v.rejected[0].reason, /confidence_rationale/);
});

test('lens-schemas: structurally unusable output fails whole (readings not an array)', () => {
    const v = validateLensToolInput({ reconstruction_summary: 'x' }, CTX);
    assert.equal(v.ok, false);
    assert.ok(v.errors.length > 0);
    const v2 = validateLensToolInput('not an object', CTX);
    assert.equal(v2.ok, false);
});

// --- assembled §7 shapes ------------------------------------------------------------

function assembledJurisdiction(over = {}) {
    return {
        id: 'christianity',
        type: 'worldview',
        display_name: 'Christianity (multi-tradition)',
        is_living_person: false,
        authorities_loaded: [{
            authority_id: AUTH_IDS[0],
            citation: 'Bible (NRSV), NRSV Updated Edition, 2021, Matthew 20:25-28',
            language: 'en', coverage: 'high'
        }],
        corpus_provenance: { curated_by: null, candidate_pool: null, selection_basis: null },
        internal_divisions: ['Catholic social teaching', 'Reformed'],
        readings: [goodReadingNormalized(), goodFactualNormalized()],
        reconstruction_summary: 'A servant-leadership reading.',
        grounding: {
            grounded_count: 1, inferred_count: 0,
            thin_coverage_flags: [], thin_representation_flags: [],
            recommended_sources: [], truncation_flags: [], rejected_readings: []
        },
        ...over
    };
}

function goodReadingNormalized() {
    return {
        claim_id: 'c1', disposition: 'partially-endorses',
        reasoning: 'Servant leadership reads hierarchy as service.',
        authorities_cited: [{ authority_id: AUTH_IDS[0], locator: 'Matthew 20:26', grounding: 'direct-quote' }],
        content_vs_framing: 'substance endorsed; framing rejected',
        confidence: 'medium', confidence_rationale: 'one shared text'
    };
}

function goodFactualNormalized() {
    return {
        claim_id: 'c2', corpus_stance: 'silent',
        reasoning: 'The loaded corpus does not speak to this.',
        authorities_cited: [], confidence: 'high', confidence_rationale: 'clear absence'
    };
}

function assembledPanel(over = {}) {
    return {
        provenance: { model: 'claude-opus-4-8', prompt_version: '1.0', run_at: '2026-07-07T00:00:00.000Z' },
        target: { title: 'T', url: null, content_hash: 'a'.repeat(64), claims: CLAIMS },
        jurisdictions: [assembledJurisdiction()],
        panel_composition: {
            empaneled: ['Christianity (multi-tradition) (worldview)'],
            selection_basis: 'not stated (self-attested by the curator — §5.3)',
            symmetry_flags: []
        },
        panel_comparison: { agreements: [], divergences: [] },
        ...over
    };
}

test('lens-schemas: a conformant assembled jurisdiction reading validates', () => {
    const v = validateJurisdictionReading(assembledJurisdiction(), { claims: CLAIMS });
    assert.deepEqual(v, { valid: true, errors: [] });
});

test('lens-schemas: assembled shape enforces the grounding report and identity fields', () => {
    let v = validateJurisdictionReading(assembledJurisdiction({ grounding: undefined }));
    assert.equal(v.valid, false);
    v = validateJurisdictionReading(assembledJurisdiction({ is_living_person: 'unknown' }));
    assert.equal(v.valid, false, 'the stamped guardrail bit is a boolean, never a string');
});

test('lens-schemas: exclusivity survives caching — re-checked on assembled shapes (§3.2)', () => {
    const bad = assembledJurisdiction();
    bad.readings[1].disposition = 'rejects';   // factual claim c2 given a disposition
    const v = validateJurisdictionReading(bad, { claims: CLAIMS });
    assert.equal(v.valid, false);
    assert.match(v.errors[0].message, /never carries a disposition/);
});

test('lens-schemas: a conformant full panel validates; missing disclosure fails', () => {
    assert.equal(validateLensPanel(assembledPanel()).valid, true);
    const noComposition = assembledPanel({ panel_composition: undefined });
    assert.equal(validateLensPanel(noComposition).valid, false,
        'panel_composition is the P5 symmetry obligation — not optional');
});

test('lens-schemas: MODEL_OUTPUT_SCHEMA is JSON-serializable (it ships as the tool input_schema)', () => {
    const roundTrip = JSON.parse(JSON.stringify(MODEL_OUTPUT_SCHEMA));
    assert.deepEqual(roundTrip, MODEL_OUTPUT_SCHEMA, 'no RegExp/function nodes — the API gets exactly this');
    // The authored field guidance must actually reach the API — quote()
    // once dropped its extras silently.
    const reading = MODEL_OUTPUT_SCHEMA.properties.readings.items;
    assert.ok(reading.properties.authorities_cited.items.properties.authority_id.description,
        'authority_id carries its corpus-block guidance');
    assert.ok(reading.properties.reasoning.description, 'reasoning carries its steelman guidance');
    assert.ok(reading.properties.confidence_rationale.description);
    assert.ok(MODEL_OUTPUT_SCHEMA.properties.reconstruction_summary.description);
    assert.ok(MODEL_OUTPUT_SCHEMA.properties.thin_coverage_flags.description,
        'the model is told what thin_coverage_flags is for (§7 hard-stop row 4)');
});

test('lens-schemas: exclusivity re-check covers the reverse direction on assembled shapes', () => {
    const smuggled = assembledJurisdiction();
    smuggled.readings[0] = {
        ...goodReadingNormalized(),
        corpus_stance: 'asserts'                 // corpus_stance on a normative claim
    };
    const v = validateJurisdictionReading(smuggled, { claims: CLAIMS });
    assert.equal(v.valid, false);
    assert.match(v.errors[0].message, /reserved for factual assertions/);
});

test('lens-schemas: panel-level exclusivity re-check rejects a smuggled cached violation', () => {
    const panel = assembledPanel();
    panel.jurisdictions[0].readings[1] = {
        ...goodFactualNormalized(),
        disposition: 'rejects'                   // factual claim c2 given a disposition, panel-deep
    };
    delete panel.jurisdictions[0].readings[1].corpus_stance;
    const v = validateLensPanel(panel);
    assert.equal(v.valid, false, 'a cached panel cannot smuggle a firewall violation');
    assert.match(v.errors.map((e) => e.message).join(' '), /never carries a disposition/);
});
