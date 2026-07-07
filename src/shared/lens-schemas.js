// Lens-reading schemas + validators — Phase 16.2
// (docs/MORAL_LENS_JURISDICTION_DESIGN.md §7).
//
// PURE module: no network, no chrome, no DOM. Validates against the
// shared tiny-schema walker (schema-walker.js — factored out of
// audit/findings-schemas.js so the two families cannot fork it).
//
// Three layers:
//   1. MODEL_OUTPUT_SCHEMA — the shape the forced tool asks of the
//      model, per jurisdiction call. lens-prompt.js builds the tool
//      input_schema FROM this object, so the model is guided by the
//      exact shape the validator enforces (the findings-schemas
//      one-source-of-truth idiom).
//   2. validateLensToolInput — structural walk + the SEMANTIC contract
//      rules (schema-enforced, not stylistic): `disposition` and
//      `corpus_stance` are mutually exclusive by assertion type; an
//      empty `authorities_cited` is valid only for silent /
//      out-of-scope; a cited authority must exist in the loaded
//      corpus. Violations are parse-time rejections of that reading —
//      a downgrade, never a prompt hope.
//   3. validateJurisdictionReading / validateLensPanel — the assembled
//      §7 shapes, for the 16.4 fixture suites and anyone consuming a
//      cached panel.
//
// The jurisdiction-identity fields (display_name, is_living_person,
// authorities_loaded, corpus_provenance, internal_divisions) are NOT
// in the model schema — they are stamped code-side from the registry
// record (lens-engine.js), never model-echoed, so the guardrail bit
// cannot be hallucinated (§7).

import { str, quote, nullableStr, int, en, arr, obj, strArr, typeOf, walk } from './schema-walker.js';
import {
    JURISDICTION_TYPES, LENS_ASSERTION_TYPES, isValidLensAssertionType,
    DISPOSITIONS, isValidDisposition, UNCITED_DISPOSITIONS,
    CORPUS_STANCES, isValidCorpusStance,
    GROUNDING_LEVELS, isValidGroundingLevel,
    LENS_CONFIDENCES, isValidLensConfidence,
    COVERAGE_LEVELS, carriesDisposition
} from './lens-taxonomy.js';

// ------------------------------------------------------------------
// 1. The model-output schema (one jurisdiction per call)
// ------------------------------------------------------------------

const CITED_AUTHORITY_SCHEMA = obj({
    authority_id: quote({
        description: 'The authority_id of a loaded authority, exactly as given in the corpus block.'
    }),
    locator: str({
        description: 'Where in the cited work — section, page, verse. As precise as the loaded citation allows.'
    }),
    grounding: en(GROUNDING_LEVELS)
}, ['authority_id', 'grounding']);

// `disposition` / `corpus_stance` are both structurally optional here —
// which one is REQUIRED (and which is FORBIDDEN) depends on the claim's
// lens assertion type, enforced semantically in validateLensToolInput.
const MODEL_READING_SCHEMA = obj({
    claim_id: quote(),
    disposition: en(DISPOSITIONS),
    corpus_stance: en(CORPUS_STANCES),
    reasoning: quote({
        description: 'The reading, argued in the jurisdiction\'s own logic — a steelman, never a caricature.'
    }),
    authorities_cited: arr(CITED_AUTHORITY_SCHEMA),
    content_vs_framing: str({
        description: 'How the assertion\'s substance and its framing fare SEPARATELY under this jurisdiction.'
    }),
    confidence: en(LENS_CONFIDENCES),
    confidence_rationale: quote({
        description: 'Corpus coverage x tradition unity x inference load — fidelity of the reconstruction, never truth.'
    })
}, ['claim_id', 'reasoning', 'authorities_cited', 'confidence', 'confidence_rationale']);

export const MODEL_OUTPUT_SCHEMA = obj({
    readings: arr(MODEL_READING_SCHEMA),
    reconstruction_summary: quote({
        description: 'A short narrative of the whole reading, in the jurisdiction\'s voice.'
    }),
    thin_coverage_flags: strArr(),
    recommended_sources: strArr()
}, ['readings', 'reconstruction_summary']);

// ------------------------------------------------------------------
// 2. Parse-time validation of the tool output
// ------------------------------------------------------------------

function sanitizeStringArray(value) {
    if (!Array.isArray(value)) return [];
    return value.filter((v) => typeof v === 'string' && v.trim()).map((v) => v.trim());
}

function normalizeCitations(list) {
    return list.map((c) => ({
        authority_id: c.authority_id,
        locator:      typeof c.locator === 'string' && c.locator.trim() ? c.locator.trim() : null,
        grounding:    c.grounding
    }));
}

/**
 * Validate one jurisdiction call's tool output against the §7 contract.
 *
 * @param {object} toolInput  the emit_lens_reading tool_use input
 * @param {object} ctx
 * @param {Array<{id:string, type:string}>} ctx.claims  the code-side
 *   claim set (ids + lens assertion types) — the source of truth for
 *   the disposition/corpus_stance exclusivity rule
 * @param {Iterable<string>} ctx.authorityIds  the authority_ids of the
 *   LOADED (admissible) corpus — anything else cited is a
 *   ground-in-corpus violation
 * @returns {{ok: boolean, errors: Array, readings: Array,
 *            rejected: Array<{claim_id: string|null, reason: string}>,
 *            reconstruction_summary: string,
 *            thin_coverage_flags: string[], recommended_sources: string[]}}
 */
export function validateLensToolInput(toolInput, ctx = {}) {
    const claims = Array.isArray(ctx.claims) ? ctx.claims : [];
    const typeById = new Map(claims.map((c) => [c.id, c.type]));
    const authorityIds = new Set(ctx.authorityIds || []);

    if (typeOf(toolInput) !== 'object') {
        return {
            ok: false, errors: [{ path: '$', message: `expected object, got ${typeOf(toolInput)}` }],
            readings: [], rejected: [], reconstruction_summary: '',
            thin_coverage_flags: [], recommended_sources: []
        };
    }

    // Structural pass over the envelope; per-reading problems become
    // per-reading rejections below rather than failing the whole call.
    const envelopeErrors = [];
    walk(toolInput.readings, arr({ type: 'object' }), '$.readings', envelopeErrors);
    if (!('readings' in toolInput)) envelopeErrors.push({ path: '$.readings', message: 'required field missing' });
    if (envelopeErrors.length > 0) {
        return {
            ok: false, errors: envelopeErrors,
            readings: [], rejected: [], reconstruction_summary: '',
            thin_coverage_flags: [], recommended_sources: []
        };
    }

    const readings = [];
    const rejected = [];
    const seen = new Set();

    for (const raw of toolInput.readings) {
        const claimId = (raw && typeof raw.claim_id === 'string') ? raw.claim_id : null;
        const reject = (reason) => rejected.push({ claim_id: claimId, reason });

        if (typeOf(raw) !== 'object') { reject('reading is not an object'); continue; }
        if (!claimId || !typeById.has(claimId)) {
            reject(`unknown claim id ${claimId === null ? '(missing)' : `"${claimId}"`} — not in the selected claim set`);
            continue;
        }
        if (seen.has(claimId)) {
            reject(`duplicate reading for claim "${claimId}" — the first reading was kept`);
            continue;
        }

        const lensType = typeById.get(claimId);
        const factual = !carriesDisposition(lensType);

        // The §3.2 firewall, mechanical: mutual exclusivity by type.
        if (factual) {
            if ('disposition' in raw && raw.disposition !== undefined && raw.disposition !== null) {
                reject(`a factual assertion never carries a disposition (§3.2) — "${claimId}" is deferred to the truth layer`);
                continue;
            }
            if (!isValidCorpusStance(raw.corpus_stance)) {
                reject(`a factual assertion carries corpus_stance (${CORPUS_STANCES.join(' | ')}) — got ${raw.corpus_stance}`);
                continue;
            }
        } else {
            if ('corpus_stance' in raw && raw.corpus_stance !== undefined && raw.corpus_stance !== null) {
                reject(`corpus_stance is reserved for factual assertions — a ${lensType} assertion carries a disposition`);
                continue;
            }
            if (!isValidDisposition(raw.disposition)) {
                reject(`missing or invalid disposition (expected one of ${DISPOSITIONS.join(', ')}) — got ${raw.disposition}`);
                continue;
            }
        }

        const reasoning = typeof raw.reasoning === 'string' ? raw.reasoning.trim() : '';
        if (!reasoning) { reject(`reading for "${claimId}" has no reasoning`); continue; }

        // Citations: every cited authority must be in the loaded corpus.
        const citedRaw = Array.isArray(raw.authorities_cited) ? raw.authorities_cited : null;
        if (citedRaw === null) { reject(`reading for "${claimId}" has no authorities_cited array`); continue; }
        let citationProblem = null;
        for (const c of citedRaw) {
            if (typeOf(c) !== 'object' || typeof c.authority_id !== 'string' || !c.authority_id.trim()) {
                citationProblem = 'a citation is missing its authority_id'; break;
            }
            if (!authorityIds.has(c.authority_id)) {
                citationProblem = `cites an authority not in the loaded corpus ("${c.authority_id}") — ground-in-corpus violation (A.1 principle 1)`;
                break;
            }
            if (!isValidGroundingLevel(c.grounding)) {
                citationProblem = `invalid grounding "${c.grounding}" (expected ${GROUNDING_LEVELS.join(' | ')})`;
                break;
            }
        }
        if (citationProblem) { reject(`reading for "${claimId}": ${citationProblem}`); continue; }

        // An uncited reading is only valid where there is nothing to
        // cite: silent / out-of-scope (or a silent corpus_stance).
        if (citedRaw.length === 0) {
            const uncitedOk = factual
                ? raw.corpus_stance === 'silent'
                : UNCITED_DISPOSITIONS.includes(raw.disposition);
            if (!uncitedOk) {
                reject(`reading for "${claimId}" cites no authorities — only ${UNCITED_DISPOSITIONS.join(' / ')}`
                    + ' (or a silent corpus_stance) may be uncited (§7)');
                continue;
            }
        }

        if (!isValidLensConfidence(raw.confidence)) {
            reject(`reading for "${claimId}" has an invalid confidence (expected ${LENS_CONFIDENCES.join(' | ')})`);
            continue;
        }
        const rationale = typeof raw.confidence_rationale === 'string' ? raw.confidence_rationale.trim() : '';
        if (!rationale) { reject(`reading for "${claimId}" has no confidence_rationale (§5.1)`); continue; }

        // Normalize to the whitelisted §7 fields — extras are dropped so
        // the assembled output carries only contract keys (the §5.2
        // word-reservation guard greps output keys).
        const normalized = {
            claim_id: claimId,
            reasoning,
            authorities_cited: normalizeCitations(citedRaw),
            confidence: raw.confidence,
            confidence_rationale: rationale
        };
        if (factual) {
            normalized.corpus_stance = raw.corpus_stance;
        } else {
            normalized.disposition = raw.disposition;
            normalized.content_vs_framing =
                (typeof raw.content_vs_framing === 'string' && raw.content_vs_framing.trim())
                    ? raw.content_vs_framing.trim() : null;
        }
        seen.add(claimId);
        readings.push(normalized);
    }

    return {
        ok: true,
        errors: [],
        readings,
        rejected,
        reconstruction_summary: typeof toolInput.reconstruction_summary === 'string'
            ? toolInput.reconstruction_summary.trim() : '',
        thin_coverage_flags: sanitizeStringArray(toolInput.thin_coverage_flags),
        recommended_sources: sanitizeStringArray(toolInput.recommended_sources)
    };
}

// ------------------------------------------------------------------
// 3. The assembled §7 shapes (code-side output; fixture suites)
// ------------------------------------------------------------------

const ASSEMBLED_READING_SCHEMA = obj({
    claim_id:             quote(),
    disposition:          en(DISPOSITIONS),
    corpus_stance:        en(CORPUS_STANCES),
    reasoning:            quote(),
    authorities_cited:    arr(obj({
        authority_id: quote(),
        locator:      nullableStr(),
        grounding:    en(GROUNDING_LEVELS)
    }, ['authority_id', 'grounding'])),
    content_vs_framing:   nullableStr(),
    confidence:           en(LENS_CONFIDENCES),
    confidence_rationale: quote()
}, ['claim_id', 'reasoning', 'authorities_cited', 'confidence', 'confidence_rationale']);

const GROUNDING_REPORT_SCHEMA = obj({
    grounded_count:            int({ minimum: 0 }),
    inferred_count:            int({ minimum: 0 }),
    thin_coverage_flags:       strArr(),
    thin_representation_flags: strArr(),
    recommended_sources:       strArr(),
    truncation_flags:          strArr(),
    rejected_readings:         arr(obj({
        claim_id: nullableStr(),
        reason:   quote()
    }, ['reason']))
}, ['grounded_count', 'inferred_count', 'thin_coverage_flags',
    'thin_representation_flags', 'recommended_sources', 'truncation_flags',
    'rejected_readings']);

const ASSEMBLED_JURISDICTION_SCHEMA = obj({
    id:                 quote(),
    type:               en(JURISDICTION_TYPES),
    display_name:       quote(),
    is_living_person:   { type: 'boolean' },
    authorities_loaded: arr(obj({
        authority_id: quote(),
        citation:     quote(),
        language:     nullableStr(),
        coverage:     en(COVERAGE_LEVELS)
    }, ['authority_id', 'citation', 'coverage'])),
    corpus_provenance:  obj({
        curated_by:      nullableStr(),
        candidate_pool:  nullableStr(),
        selection_basis: nullableStr()
    }, ['curated_by', 'candidate_pool', 'selection_basis']),
    internal_divisions: strArr(),
    readings:           arr(ASSEMBLED_READING_SCHEMA),
    reconstruction_summary: str(),
    grounding:          GROUNDING_REPORT_SCHEMA
}, ['id', 'type', 'display_name', 'is_living_person', 'authorities_loaded',
    'corpus_provenance', 'internal_divisions', 'readings',
    'reconstruction_summary', 'grounding']);

const LENS_PANEL_SCHEMA = obj({
    provenance: obj({
        model:          quote(),
        prompt_version: quote(),
        run_at:         quote()
    }, ['model', 'prompt_version', 'run_at']),
    target: obj({
        title:        nullableStr(),
        url:          nullableStr(),
        content_hash: quote(),
        claims:       arr(obj({
            id:   quote(),
            text: quote(),
            type: en(LENS_ASSERTION_TYPES)
        }, ['id', 'text', 'type']))
    }, ['title', 'url', 'content_hash', 'claims']),
    jurisdictions: arr(ASSEMBLED_JURISDICTION_SCHEMA),
    panel_composition: obj({
        empaneled:       strArr(),
        selection_basis: quote(),
        symmetry_flags:  strArr()
    }, ['empaneled', 'selection_basis', 'symmetry_flags']),
    panel_comparison: obj({
        agreements:  strArr(),
        divergences: arr(obj({
            claim_id: quote(),
            split:    quote()
        }, ['claim_id', 'split']))
    }, ['agreements', 'divergences'])
}, ['provenance', 'target', 'jurisdictions', 'panel_composition', 'panel_comparison']);

/**
 * Semantic re-check of one assembled reading against the claim types
 * in `target.claims` — the mutual-exclusivity rule survives caching.
 */
function checkReadingExclusivity(reading, typeById, path, errors) {
    const lensType = typeById.get(reading.claim_id);
    if (lensType === undefined) {
        errors.push({ path, message: `reading references a claim not in target.claims: "${reading.claim_id}"` });
        return;
    }
    if (isValidLensAssertionType(lensType) && !carriesDisposition(lensType)) {
        if ('disposition' in reading) {
            errors.push({ path, message: 'a factual assertion never carries a disposition (§3.2)' });
        }
        if (!('corpus_stance' in reading)) {
            errors.push({ path: `${path}.corpus_stance`, message: 'required field missing' });
        }
    } else {
        if ('corpus_stance' in reading) {
            errors.push({ path, message: 'corpus_stance is reserved for factual assertions' });
        }
        if (!('disposition' in reading)) {
            errors.push({ path: `${path}.disposition`, message: 'required field missing' });
        }
    }
}

/**
 * Validate one assembled per-jurisdiction reading (the §7 object a
 * single xray:lens:read round trip yields). Pass `claims` to also
 * enforce the exclusivity rule; without it only structure is checked.
 *
 * @returns {{valid: boolean, errors: Array<{path, message}>}}
 */
export function validateJurisdictionReading(assembled, { claims } = {}) {
    const errors = [];
    walk(assembled, ASSEMBLED_JURISDICTION_SCHEMA, '$', errors);
    if (errors.length === 0 && Array.isArray(claims)) {
        const typeById = new Map(claims.map((c) => [c.id, c.type]));
        (assembled.readings || []).forEach((r, i) =>
            checkReadingExclusivity(r, typeById, `$.readings[${i}]`, errors));
    }
    return { valid: errors.length === 0, errors };
}

/**
 * Validate a full assembled §7 panel (provenance + target +
 * jurisdictions + panel_composition + panel_comparison).
 *
 * @returns {{valid: boolean, errors: Array<{path, message}>}}
 */
export function validateLensPanel(panel) {
    const errors = [];
    walk(panel, LENS_PANEL_SCHEMA, '$', errors);
    if (errors.length === 0) {
        const typeById = new Map((panel.target.claims || []).map((c) => [c.id, c.type]));
        panel.jurisdictions.forEach((j, ji) =>
            (j.readings || []).forEach((r, ri) =>
                checkReadingExclusivity(r, typeById, `$.jurisdictions[${ji}].readings[${ri}]`, errors)));
    }
    return { valid: errors.length === 0, errors };
}
