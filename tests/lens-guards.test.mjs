// Phase 16.4 — the machine-checked deferrals and word reservations
// (docs/MORAL_LENS_JURISDICTION_DESIGN.md §5.2, §6, §9 Q4):
//
//   - "Verdict" is reserved for Phase 15: /verdict|ruling|opinion/i
//     (plus Court/Integrity per §5.2) appears in NO Phase 16 exported
//     symbol, storage key, or §7 output key.
//   - Kind 30066 stays FREE: no builder in src/ emits it, and the lens
//     modules export no wire builders at all.
//   - LENS_PROMPT_VERSION and the §5.1 fidelity note are pinned
//     side-by-side, exactly (the "bump alongside the prompt" idiom).
//   - moralLens defaults OFF.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// jurisdiction-model/lens-engine (and llm-client transitively) touch
// chrome.storage at import time — stub before the dynamic imports.
globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

const lensTaxonomy = await import('../src/shared/lens-taxonomy.js');
const lensSchemas = await import('../src/shared/lens-schemas.js');
const lensPrompt = await import('../src/shared/lens-prompt.js');
const jurisdictionModel = await import('../src/shared/jurisdiction-model.js');
const lensEngine = await import('../src/shared/lens-engine.js');
const { FLAGS_DEFAULTS } = await import('../src/shared/metadata/feature-flags.js');

const RESERVED = /verdict|ruling|opinion|court|integrity/i;

// ------------------------------------------------------------------
// §5.2 word reservation — export names + storage keys
// ------------------------------------------------------------------

test('guard: no Phase 16 module exports a reserved word (§5.2)', () => {
    const modules = {
        'lens-taxonomy': lensTaxonomy,
        'lens-schemas': lensSchemas,
        'lens-prompt': lensPrompt,
        'jurisdiction-model': jurisdictionModel,
        'lens-engine': lensEngine
    };
    for (const [name, mod] of Object.entries(modules)) {
        for (const key of Object.keys(mod)) {
            assert.doesNotMatch(key, RESERVED, `${name} export "${key}"`);
        }
    }
});

test('guard: Phase 16 storage keys carry no reserved word (§5.2)', () => {
    // The registry key + the session-cache prefix, pinned as literals.
    assert.equal(lensEngine.LENS_SESSION_PREFIX, 'xray:lensread:');
    assert.doesNotMatch('lens_jurisdictions', RESERVED);
    assert.doesNotMatch(lensEngine.LENS_SESSION_PREFIX, RESERVED);
});

// ------------------------------------------------------------------
// §5.2 word reservation — the parsed §7 output keys
// ------------------------------------------------------------------

function collectKeys(node, out = new Set()) {
    if (node === null || typeof node !== 'object') return out;
    if (Array.isArray(node)) { node.forEach((v) => collectKeys(v, out)); return out; }
    for (const [k, v] of Object.entries(node)) {
        out.add(k);
        collectKeys(v, out);
    }
    return out;
}

test('guard: assembled §7 output keys carry no reserved word — model extras cannot smuggle one in', () => {
    const jurisdiction = {
        id: 'j', jurisdiction_type: 'worldview', display_name: 'J',
        is_living_person: null, internal_divisions: ['a', 'b'],
        corpus: [{
            authority_id: 'auth_x', citation: { work: 'W', edition: null, isbn: null, locator: 'L', tradition: null, language: null },
            excerpt: 'e', admissibility: 'published-book', claim_id: null, anchor: null
        }],
        corpus_provenance: { curated_by: null, candidate_pool: null, selection_basis: null }
    };
    const toolInput = {
        readings: [{
            claim_id: 'c1', disposition: 'silent', reasoning: 'r', authorities_cited: [],
            confidence: 'low', confidence_rationale: 'x',
            // A model trying to smuggle reserved vocabulary into the
            // output — the normalization whitelist must drop it.
            verdict: 'guilty', court_opinion: 'overruled'
        }],
        reconstruction_summary: 's',
        ruling_summary: 'also dropped'
    };
    const { reading } = lensEngine.assembleJurisdictionReading({
        jurisdiction, toolInput,
        claims: [{ id: 'c1', text: 't', type: 'normative' }],
        truncationFlags: []
    });
    const panel = lensEngine.assembleLensPanel({
        target: { title: null, url: null, content_hash: 'a'.repeat(64), claims: [{ id: 'c1', text: 't', type: 'normative' }] },
        jurisdictionReadings: [reading],
        selectionBasis: '',
        provenance: { model: 'm', prompt_version: lensPrompt.LENS_PROMPT_VERSION, run_at: 'now' }
    });
    for (const key of collectKeys(panel)) {
        assert.doesNotMatch(key, RESERVED, `output key "${key}"`);
    }
});

// ------------------------------------------------------------------
// Kind 30066 stays free (§9 Q4 — machine-checked deferral)
// ------------------------------------------------------------------

async function* walkJs(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) yield* walkJs(p);
        else if (entry.name.endsWith('.js')) yield p;
    }
}

test('guard: no builder in src/ emits kind 30066, and no constant reserves it', async () => {
    const srcRoot = fileURLToPath(new URL('../src', import.meta.url));
    const emitted = new Set();
    for await (const file of walkJs(srcRoot)) {
        const text = await readFile(file, 'utf8');
        for (const m of text.matchAll(/\bkind\s*:\s*(\d{1,5})\b/g)) emitted.add(Number(m[1]));
        for (const m of text.matchAll(/\bKIND_[A-Z_]+\s*=\s*(\d{1,5})\b/g)) emitted.add(Number(m[1]));
    }
    assert.ok(emitted.has(30023), 'sanity: the scan sees the article kind');
    assert.ok(emitted.has(30063), 'sanity: the scan sees the Phase 15 kinds');
    assert.equal(emitted.has(30066), false,
        'kind 30066 is left FREE — a shareable lens-reading is a separately-designed act (§9 Q4)');
});

test('guard: lens modules export no wire builders (no lens event exists to build)', () => {
    for (const mod of [lensTaxonomy, lensSchemas, lensPrompt, jurisdictionModel, lensEngine]) {
        for (const [key, value] of Object.entries(mod)) {
            if (typeof value !== 'function') continue;
            assert.doesNotMatch(key, /^build\w*Event$/,
                `"${key}" looks like a wire builder — lens readings have no wire kind`);
        }
    }
});

// ------------------------------------------------------------------
// Pins: flag default, prompt version, the §5.1 fidelity note
// ------------------------------------------------------------------

test('guard: moralLens defaults OFF, independent of llmAssist', () => {
    assert.equal(FLAGS_DEFAULTS.moralLens, false,
        'the lens surface is opt-in; the key is a second consent gate on top');
    assert.equal(FLAGS_DEFAULTS.llmAssist, false);
});

test('guard: LENS_PROMPT_VERSION and the §5.1 fidelity note are pinned exactly, side by side', () => {
    // Bump the version alongside any meaningful prompt change.
    assert.equal(lensPrompt.LENS_PROMPT_VERSION, '1.0');
    assert.equal(lensPrompt.LENS_TOOL_NAME, 'emit_lens_reading');
    // The note every confidence chip carries (§5.1): fidelity, not
    // truth. Pinned so it cannot silently disappear from the surface.
    assert.equal(lensTaxonomy.LENS_CONFIDENCE_FIDELITY_NOTE,
        'Confidence measures the fidelity of this perspectival reconstruction — '
        + 'how directly the loaded corpus addresses the assertion, how unified the '
        + 'tradition is, and how much inference was required. It never measures '
        + 'whether the assertion is true, and never how strongly the jurisdiction feels.');
});

test('guard: the prompt states the firewall and the quoting discipline', () => {
    const sys = lensPrompt.buildLensSystemPrompt({
        jurisdiction: { id: 'j', jurisdiction_type: 'worldview', display_name: 'J', internal_divisions: [] },
        authorities: [{ authority_id: 'auth_x', citation: { work: 'W', locator: 'L' }, excerpt: 'e', admissibility: 'published-book' }],
        living: false
    });
    assert.match(sys, /never pronounce a fact true or false/i);
    assert.match(sys, /background knowledge .* is inadmissible/i);
    assert.match(sys, /AT MOST the stored excerpt/);
    assert.match(sys, /steelman/i);
    // The living guardrail paragraph appears exactly when living=true.
    assert.doesNotMatch(sys, /LIVING-PERSON GUARDRAIL/);
    const livingSys = lensPrompt.buildLensSystemPrompt({
        jurisdiction: { id: 'p', jurisdiction_type: 'persona', display_name: 'P', internal_divisions: [] },
        authorities: [{ authority_id: 'auth_y', citation: { work: 'W', locator: 'L' }, excerpt: 'e', admissibility: 'published-essay' }],
        living: true
    });
    assert.match(livingSys, /LIVING-PERSON GUARDRAIL/);
    assert.match(livingSys, /PUBLISHED POSITIONS ONLY/);
});
