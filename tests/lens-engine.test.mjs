// Phase 16.2/16.4 — lens engine + runLensPass
// (docs/MORAL_LENS_JURISDICTION_DESIGN.md §6, §7). The load-bearing
// guards: pre-flight refusals fire BEFORE any network call (fetch
// tripwire — testable without a key), the lens path performs ZERO
// durable storage writes, identity fields are stamped from the
// registry (never model-echoed), truncation is surfaced (never
// silent), and a model guardrail firing maps to a distinct refusal
// state. Same chrome.storage.local shim pattern as
// forensic-model.test.mjs, plus a storage.session area for the cache.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const _stateStore = new Map();
const _sessionStore = new Map();
// Recorders for the zero-durable-writes guard.
let localSetCalls = 0;
let sessionSetCalls = 0;

globalThis.chrome = {
    storage: {
        local: {
            get(keys, cb) {
                const out = {};
                for (const k of Array.isArray(keys) ? keys : [keys]) {
                    if (_stateStore.has(k)) out[k] = _stateStore.get(k);
                }
                cb(out);
            },
            set(obj, cb) {
                localSetCalls += 1;
                for (const [k, v] of Object.entries(obj)) _stateStore.set(k, v);
                cb && cb();
            },
            remove(keys, cb) {
                for (const k of Array.isArray(keys) ? keys : [keys]) _stateStore.delete(k);
                cb && cb();
            }
        },
        session: {
            get(keys, cb) {
                const out = {};
                for (const k of Array.isArray(keys) ? keys : [keys]) {
                    if (_sessionStore.has(k)) out[k] = _sessionStore.get(k);
                }
                cb(out);
            },
            set(obj, cb) {
                sessionSetCalls += 1;
                for (const [k, v] of Object.entries(obj)) _sessionStore.set(k, v);
                cb && cb();
            }
        }
    }
};

// Tripwire by default: any test that reaches the network without
// explicitly installing a mock is a failure.
globalThis.fetch = () => { throw new Error('TRIPWIRE: network reached — a gate failed'); };

const { JurisdictionModel } = await import('../src/shared/jurisdiction-model.js');
const {
    lensPreflightRefusal, assembleJurisdictionReading,
    assemblePanelComposition, assemblePanelComparison, assembleLensPanel,
    cacheLensRun, getCachedLensRun, LENS_SESSION_PREFIX
} = await import('../src/shared/lens-engine.js');
const { runLensPass, getLensConfig } = await import('../src/shared/llm-client.js');
const { validateJurisdictionReading, validateLensPanel } = await import('../src/shared/lens-schemas.js');
const { LENS_PROMPT_VERSION, LENS_TOOL_NAME } = await import('../src/shared/lens-prompt.js');

function resetState() {
    _stateStore.clear();
    _sessionStore.clear();
    localSetCalls = 0;
    sessionSetCalls = 0;
    globalThis.fetch = () => { throw new Error('TRIPWIRE: network reached — a gate failed'); };
}

const CLAIMS = [
    { id: 'c1', text: 'Men should step down from hierarchy.', type: 'normative' },
    { id: 'c2', text: 'The senator voted no on March 3.', type: 'factual' }
];

async function seedWorldview(over = {}) {
    return JurisdictionModel.create({
        jurisdiction_type: 'worldview',
        display_name: 'Christianity (multi-tradition)',
        internal_divisions: ['Catholic social teaching', 'Reformed'],
        corpus: [{
            citation: { work: 'Bible (NRSV)', edition: 'NRSV UE 2021', locator: 'Matthew 20:25-28', language: 'en' },
            excerpt: 'whoever wishes to be first among you must be your slave',
            admissibility: 'published-scripture'
        }],
        ...over
    });
}

function enableLens({ withKey = false } = {}) {
    _stateStore.set('xray:flags', JSON.stringify({ moralLens: true }));
    if (withKey) _stateStore.set('xray:llm:key', 'sk-test');
}

// Recorded fetch calls from the mock — {url, payload} per call, so
// tests can assert the endpoint, the call count, and what the request
// actually carried (the consent copy promises excerpts leave the
// device only inside a lens call).
let fetchCalls = [];

/** A canned Messages API success carrying one emit_lens_reading tool_use. */
function mockModelResponse(input, { stopReason = 'tool_use', model = 'claude-opus-4-8' } = {}) {
    fetchCalls = [];
    globalThis.fetch = async (url, opts) => {
        fetchCalls.push({ url, payload: JSON.parse((opts && opts.body) || '{}') });
        return {
            ok: true,
            json: async () => ({
                model, stop_reason: stopReason,
                content: input === null ? [] : [{ type: 'tool_use', name: LENS_TOOL_NAME, input }]
            })
        };
    };
}

function goodToolInput(authId) {
    return {
        readings: [
            { claim_id: 'c1', disposition: 'partially-endorses',
              reasoning: 'Servant leadership reads hierarchy as service.',
              authorities_cited: [{ authority_id: authId, locator: 'Matthew 20:26', grounding: 'direct-quote' }],
              content_vs_framing: 'substance endorsed; framing as demand rejected',
              confidence: 'medium', confidence_rationale: 'one shared text, divided tradition' },
            { claim_id: 'c2', corpus_stance: 'silent',
              reasoning: 'The loaded corpus does not speak to this vote.',
              authorities_cited: [], confidence: 'high', confidence_rationale: 'clear absence' }
        ],
        reconstruction_summary: 'A servant-leadership reading.',
        thin_coverage_flags: ['only one verse loaded'],
        recommended_sources: ['Rerum Novarum §§ 20-22']
    };
}

// --- gating + pre-flight refusals (all keyless; the tripwire proves no network) ---

test('lens gate: flag off refuses before anything else — no network', async () => {
    resetState();
    const r = await runLensPass({ jurisdictionId: 'x', articleText: 'a', claims: CLAIMS });
    assert.equal(r.ok, false);
    assert.match(r.error, /Moral lens is off/);
});

test('lens gate: getLensConfig reports the moralLens flag, never llmAssist', async () => {
    resetState();
    _stateStore.set('xray:flags', JSON.stringify({ llmAssist: true }));
    let cfg = await getLensConfig();
    assert.equal(cfg.enabled, false, 'llmAssist does not enable the lens — independent gates');
    enableLens();
    cfg = await getLensConfig();
    assert.equal(cfg.enabled, true);
    assert.equal(cfg.hasKey, false);
});

test('pre-flight: an ungrounded jurisdiction refuses pre-call, BEFORE the key gate', async () => {
    resetState();
    enableLens();   // no key on purpose — the refusal must not need one
    await JurisdictionModel.create({ jurisdiction_type: 'worldview', display_name: 'Empty Tradition' });
    const r = await runLensPass({ jurisdictionId: 'empty-tradition', articleText: 'a', claims: CLAIMS });
    assert.equal(r.ok, false);
    assert.equal(r.refused, true);
    assert.equal(r.code, 'not-grounded');
});

test('pre-flight: living persona without an admissible published corpus refuses (fail closed)', async () => {
    resetState();
    enableLens();
    // Social-only corpus + UNKNOWN living bit ⇒ treated as living ⇒ refused.
    await JurisdictionModel.create({
        jurisdiction_type: 'persona', display_name: 'Unknown Author',
        corpus: [{ citation: { work: 'x.com post', locator: 'status/1' },
                   excerpt: 'a tweet', admissibility: 'social-capture' }]
    });
    const r = await runLensPass({ jurisdictionId: 'unknown-author', articleText: 'a', claims: CLAIMS });
    assert.equal(r.refused, true);
    assert.equal(r.code, 'living-person-ungrounded');
    assert.match(r.error, /treated as living/);

    // The pure predicate, directly.
    const j = await JurisdictionModel.get('unknown-author');
    assert.equal(lensPreflightRefusal(j).code, 'living-person-ungrounded');
    assert.equal(lensPreflightRefusal(null).code, 'unknown-jurisdiction');
});

test('pre-flight: a grounded jurisdiction clears; the KEY gate then stops a keyless run', async () => {
    resetState();
    enableLens();   // still no key
    const j = await seedWorldview();
    assert.equal(lensPreflightRefusal(j), null);
    const r = await runLensPass({ jurisdictionId: j.id, articleText: 'a', claims: CLAIMS });
    assert.equal(r.ok, false);
    assert.equal(r.refused, undefined, 'a missing key is not a refusal state');
    assert.match(r.error, /No Anthropic API key/);
});

test('lens gate: malformed claims and empty article are refused without network', async () => {
    resetState();
    enableLens({ withKey: true });
    const j = await seedWorldview();
    let r = await runLensPass({ jurisdictionId: j.id, articleText: 'a', claims: [] });
    assert.match(r.error, /No claims selected/);
    r = await runLensPass({ jurisdictionId: j.id, articleText: 'a',
        claims: [{ id: 'c1', text: 't', type: 'interpretation' }] });
    assert.match(r.error, /Invalid lens assertion type/,
        'proposition classes are not lens types — typed code-side, validated here');
    r = await runLensPass({ jurisdictionId: j.id, articleText: '   ', claims: CLAIMS });
    assert.match(r.error, /No article text/);
});

// --- the full pass (mocked network) -------------------------------------------------

test('runLensPass: assembles the §7 object — identity stamped from the registry, zero durable writes', async () => {
    resetState();
    enableLens({ withKey: true });
    const j = await seedWorldview();
    const authId = j.corpus[0].authority_id;
    // The model tries to smuggle identity + extra keys; none of it survives.
    const input = goodToolInput(authId);
    input.display_name = 'Hallucinated Name';
    input.is_living_person = true;
    mockModelResponse(input);

    const writesBefore = localSetCalls;
    const r = await runLensPass({
        jurisdictionId: j.id, articleText: 'Body text.', articleTitle: 'T', claims: CLAIMS
    });
    assert.equal(r.ok, true);
    assert.equal(localSetCalls, writesBefore, 'the lens path performs ZERO durable storage writes');

    const reading = r.reading;
    assert.equal(reading.display_name, 'Christianity (multi-tradition)', 'identity from the registry, not the model');
    assert.equal(reading.is_living_person, false, 'guardrail bit cannot be hallucinated');
    assert.equal(reading.readings.length, 2);
    assert.equal(reading.grounding.grounded_count, 1);
    assert.equal(reading.grounding.inferred_count, 0);
    assert.deepEqual(reading.grounding.thin_representation_flags.length, 1,
        'multi-vocal tradition on a single work → §5.3 thin representation');
    assert.equal(reading.grounding.truncation_flags.length, 0);
    assert.equal(reading.authorities_loaded[0].coverage, 'high');

    assert.equal(validateJurisdictionReading(reading, { claims: CLAIMS }).valid, true);
    assert.deepEqual(r.provenance.prompt_version, LENS_PROMPT_VERSION);
    assert.match(r.target.content_hash, /^[0-9a-f]{64}$/);
    assert.equal(r.target.truncated, false);

    // Transport honesty: exactly ONE bounded call per jurisdiction, to
    // the Anthropic endpoint, carrying the forced tool + the corpus
    // excerpt and claim ids the prompt promises.
    assert.equal(fetchCalls.length, 1, 'one call per jurisdiction — never more');
    assert.equal(fetchCalls[0].url, 'https://api.anthropic.com/v1/messages');
    const payload = fetchCalls[0].payload;
    assert.equal(payload.tool_choice.name, 'emit_lens_reading');
    assert.match(payload.system, /whoever wishes to be first among you/, 'the stored excerpt rides the system prompt');
    assert.match(payload.messages[0].content, /claim_id: c1/, 'claim ids ride the user turn');
    assert.match(payload.messages[0].content, /Body text\./, 'the article text rides the user turn');
});

test('runLensPass: oversized input is truncated AND surfaced — never silent (§6)', async () => {
    resetState();
    enableLens({ withKey: true });
    const j = await seedWorldview();
    mockModelResponse(goodToolInput(j.corpus[0].authority_id));

    const r = await runLensPass({
        jurisdictionId: j.id,
        articleText: 'x'.repeat(120001),
        claims: CLAIMS
    });
    assert.equal(r.ok, true);
    assert.equal(r.target.truncated, true);
    assert.equal(r.reading.grounding.truncation_flags.length, 1);
    assert.match(r.reading.grounding.truncation_flags[0], /truncated to 120000 of 120001 characters/);
});

test('runLensPass: a model guardrail firing is a DISTINCT refusal state, never generic', async () => {
    resetState();
    enableLens({ withKey: true });
    const j = await seedWorldview();
    mockModelResponse(null, { stopReason: 'refusal' });
    const r = await runLensPass({ jurisdictionId: j.id, articleText: 'a', claims: CLAIMS });
    assert.equal(r.ok, false);
    assert.equal(r.refused, true);
    assert.equal(r.code, 'model-refusal');
    assert.doesNotMatch(r.error, /Try again\.?$/, 'never the generic "Try again"');
});

test('runLensPass: output-cap truncation and missing tool output get their own errors', async () => {
    resetState();
    enableLens({ withKey: true });
    const j = await seedWorldview();
    mockModelResponse(goodToolInput(j.corpus[0].authority_id), { stopReason: 'max_tokens' });
    let r = await runLensPass({ jurisdictionId: j.id, articleText: 'a', claims: CLAIMS });
    assert.match(r.error, /output limit/);
    mockModelResponse(null);
    r = await runLensPass({ jurisdictionId: j.id, articleText: 'a', claims: CLAIMS });
    assert.match(r.error, /did not return a structured reading/);
});

test('assembly: a claim the model skipped surfaces in rejected_readings', async () => {
    resetState();
    const j = await seedWorldview();
    const input = goodToolInput(j.corpus[0].authority_id);
    input.readings = [input.readings[0]];   // drop c2
    const { reading } = assembleJurisdictionReading({ jurisdiction: j, toolInput: input, claims: CLAIMS });
    assert.equal(reading.readings.length, 1);
    assert.deepEqual(reading.grounding.rejected_readings, [
        { claim_id: 'c2', reason: 'no reading returned by the model for this claim' }
    ]);
});

// --- panel assembly (§5.3, code-side) -----------------------------------------------

function readingStub(name, dispositionByClaim) {
    return {
        id: name.toLowerCase(), type: 'worldview', display_name: name, is_living_person: false,
        authorities_loaded: [], corpus_provenance: { curated_by: null, candidate_pool: null, selection_basis: null },
        internal_divisions: [],
        readings: Object.entries(dispositionByClaim).map(([claim_id, disposition]) => ({
            claim_id, disposition,
            reasoning: 'r', authorities_cited: [{ authority_id: 'a', locator: null, grounding: 'paraphrase' }],
            content_vs_framing: null, confidence: 'low', confidence_rationale: 'x'
        })),
        reconstruction_summary: '',
        grounding: { grounded_count: 0, inferred_count: 0, thin_coverage_flags: [],
            thin_representation_flags: [], recommended_sources: [], truncation_flags: [], rejected_readings: [] }
    };
}

test('panel: empaneled discloses the DECLARED selection — failed/refused lenses included (§5.3)', () => {
    const comp = assemblePanelComposition({
        jurisdictionReadings: [readingStub('Hostile Lens', { c1: 'rejects' })],
        failures: [
            { displayName: 'Sympathetic Lens', type: 'persona', refused: true, code: 'living-person-ungrounded' },
            { displayName: 'Broken Lens', type: 'worldview', refused: false },
            { displayName: 'Declined Lens', type: 'worldview', refused: true, code: 'model-refusal' }
        ],
        selectionBasis: ''
    });
    assert.deepEqual(comp.empaneled, [
        'Hostile Lens (worldview)',
        'Sympathetic Lens (persona) — refused pre-flight, no reading',
        'Broken Lens (worldview) — failed, no reading',
        'Declined Lens (worldview) — declined by the model, no reading'
    ], 'a lens that produced no reading is disclosed, never dropped from the record');
});

test('panel: multi-work single-strand corpus for a multi-vocal tradition is thin representation (§5.3)', async () => {
    resetState();
    const j = await JurisdictionModel.create({
        jurisdiction_type: 'worldview',
        display_name: 'One-Strand Tradition',
        internal_divisions: ['Strand A', 'Strand B'],
        corpus: [{
            citation: { work: 'Work One', locator: 'p. 1', tradition: 'Strand A' },
            excerpt: 'x', admissibility: 'published-book'
        }, {
            citation: { work: 'Work Two', locator: 'p. 2', tradition: 'Strand A' },
            excerpt: 'y', admissibility: 'published-book'
        }]
    });
    const { reading } = assembleJurisdictionReading({
        jurisdiction: j,
        toolInput: { readings: [], reconstruction_summary: 's' },
        claims: CLAIMS
    });
    assert.equal(reading.grounding.thin_representation_flags.length, 1);
    assert.match(reading.grounding.thin_representation_flags[0], /one strand/);
});

test('panel: an all-hostile panel gets the §5.3 symmetry flag; a mixed one does not', () => {
    const hostileOnly = assemblePanelComposition({
        jurisdictionReadings: [readingStub('A', { c1: 'rejects' }), readingStub('B', { c1: 'rejects' })],
        selectionBasis: ''
    });
    assert.equal(hostileOnly.symmetry_flags.length, 1);
    assert.match(hostileOnly.symmetry_flags[0], /one-sided/);
    assert.equal(hostileOnly.selection_basis, 'not stated (self-attested by the curator — §5.3)');

    const mixed = assemblePanelComposition({
        jurisdictionReadings: [readingStub('A', { c1: 'rejects' }), readingStub('B', { c1: 'endorses' })],
        selectionBasis: 'lenses the article invokes'
    });
    assert.equal(mixed.symmetry_flags.length, 0);
    assert.equal(mixed.selection_basis, 'lenses the article invokes');
    assert.deepEqual(mixed.empaneled, ['A (worldview)', 'B (worldview)']);
});

test('panel: agreements and divergences computed from dispositions alone', () => {
    const cmp = assemblePanelComparison({
        jurisdictionReadings: [
            readingStub('A', { c1: 'rejects', c2: 'endorses' }),
            readingStub('B', { c1: 'rejects', c2: 'reframes' })
        ],
        claims: [{ id: 'c1', text: 'claim one' }, { id: 'c2', text: 'claim two' }]
    });
    assert.equal(cmp.agreements.length, 1);
    assert.match(cmp.agreements[0], /"claim one" as rejects/);
    assert.deepEqual(cmp.divergences, [{ claim_id: 'c2', split: 'A: endorses; B: reframes' }]);
});

test('panel: assembleLensPanel produces a §7-valid panel', () => {
    const panel = assembleLensPanel({
        target: { title: 'T', url: null, content_hash: 'a'.repeat(64),
            claims: [{ id: 'c1', text: 'claim one', type: 'normative' }] },
        jurisdictionReadings: [readingStub('A', { c1: 'rejects' })],
        selectionBasis: '',
        provenance: { model: 'm', prompt_version: LENS_PROMPT_VERSION, run_at: '2026-07-07T00:00:00Z' }
    });
    assert.equal(validateLensPanel(panel).valid, true);
});

// --- session cache (derived view — session ONLY, no local fallback) ------------------

test('cache: round-trips through storage.session and never touches storage.local', async () => {
    resetState();
    const before = localSetCalls;
    assert.equal(await cacheLensRun('cap-1', { panel: { x: 1 } }), true);
    assert.deepEqual(await getCachedLensRun('cap-1'), { panel: { x: 1 } });
    assert.equal(await getCachedLensRun('cap-2'), null);
    assert.equal(localSetCalls, before, 'zero durable writes');
    assert.equal(sessionSetCalls, 1);
    assert.ok(_sessionStore.has(LENS_SESSION_PREFIX + 'cap-1'));
});

test('cache: with NO session area it declines — it must not fall back to local', async () => {
    resetState();
    const savedSession = globalThis.chrome.storage.session;
    delete globalThis.chrome.storage.session;
    try {
        const before = localSetCalls;
        assert.equal(await cacheLensRun('cap-1', { panel: {} }), false);
        assert.equal(await getCachedLensRun('cap-1'), null);
        assert.equal(localSetCalls, before,
            'the house session||local fallback is deliberately NOT used here');
    } finally {
        globalThis.chrome.storage.session = savedSession;
    }
});
