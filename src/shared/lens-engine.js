// Lens-reading engine — Phase 16.2
// (docs/MORAL_LENS_JURISDICTION_DESIGN.md §5.3, §6, §7).
//
// The code-side half of a lens pass: the pre-flight refusals (enforced
// BEFORE any network call, testable without a key), the assembly of
// the model's validated tool output into the §7 per-jurisdiction
// object (identity fields stamped from the registry record — the
// inject-never-ask idiom, so the guardrail bit cannot be
// hallucinated), the code-side panel composition/comparison (§5.3: the
// model is never asked to characterize its own panel), and the
// session cache.
//
// A lens run is a DERIVED VIEW: session-cached per capture id in
// chrome.storage.session, never durably written — no
// chrome.storage.local, no IndexedDB, no relay pool. The cache helpers
// below deliberately DO NOT use the house `storage.session ||
// storage.local` fallback: falling back would durably write a derived
// view and break the zero-durable-writes guarantee (guard-tested in
// 16.4). No session area simply means no cache.

import { treatAsLiving, admissibleAuthorities } from './jurisdiction-model.js';
import { validateLensToolInput } from './lens-schemas.js';

// ------------------------------------------------------------------
// Pre-flight refusals (§7 hard stops — code, pre-call)
// ------------------------------------------------------------------

/**
 * The two code-enforced hard stops, checked before any network call:
 *
 *   - `living-person-ungrounded` — a persona treated as living (an
 *     explicit true OR an absent/unknown bit, which fails closed)
 *     whose ADMISSIBLE corpus (editorially published only, §9 Q1) is
 *     empty. Published positions only; nothing published loaded means
 *     nothing to read.
 *   - `not-grounded` — any jurisdiction with no admissible corpus. A
 *     reading without a corpus would be the model's own background
 *     knowledge of the tradition, which is inadmissible (A.1
 *     principle 1).
 *
 * @returns {{code: string, message: string} | null} null = clear to call
 */
export function lensPreflightRefusal(jurisdiction) {
    if (!jurisdiction) {
        return { code: 'unknown-jurisdiction', message: 'Jurisdiction not found in the registry.' };
    }
    const admissible = admissibleAuthorities(jurisdiction);
    if (admissible.length > 0) return null;

    const name = jurisdiction.display_name || jurisdiction.id || '(unnamed)';
    if (treatAsLiving(jurisdiction)) {
        const unknownBit = jurisdiction.is_living_person !== true;
        return {
            code: 'living-person-ungrounded',
            message: `"${name}" is a living person${unknownBit ? ' (living status unknown — treated as living, fails closed)' : ''}`
                + ' with no admissible published corpus. Published positions only: load a published book,'
                + ' bylined essay/article, or published transcript — social captures are inadmissible for living personas.'
        };
    }
    return {
        code: 'not-grounded',
        message: `Jurisdiction "${name}" is not grounded — no authorities loaded.`
            + ' Add authorities to its corpus before running a reading; the model\'s background'
            + ' knowledge of a tradition is inadmissible.'
    };
}

// ------------------------------------------------------------------
// Assembly: validated tool output → the §7 per-jurisdiction object
// ------------------------------------------------------------------

function formatCitation(citation) {
    const c = citation || {};
    const bits = [c.work];
    if (c.edition) bits.push(c.edition);
    if (c.isbn) bits.push(`ISBN ${c.isbn}`);
    bits.push(c.locator);
    return bits.filter(Boolean).join(', ');
}

// Deterministic per-authority coverage from citation frequency: the
// fraction of the target claims whose reading cites this authority.
// ≥ half → high; any → medium; none → low. A code-side computation —
// the model is not asked to grade its own sources.
function coverageLevel(citedCount, claimCount) {
    if (citedCount <= 0) return 'low';
    if (claimCount > 0 && citedCount / claimCount >= 0.5) return 'high';
    return 'medium';
}

// A reading's strongest grounding across its citations. direct-quote
// and paraphrase both count as grounded; inference-only readings are
// inferred; uncited readings (silent / out-of-scope) are neither.
function readingGroundedness(reading) {
    const cited = reading.authorities_cited || [];
    if (cited.length === 0) return null;
    return cited.some((c) => c.grounding === 'direct-quote' || c.grounding === 'paraphrase')
        ? 'grounded' : 'inferred';
}

/**
 * Assemble one jurisdiction's §7 object from the model's raw tool
 * output. Everything identity-shaped is stamped from the registry
 * record; the grounding report's counts and the thin-representation
 * flags are computed here, deterministically.
 *
 * @param {object} params
 * @param {object} params.jurisdiction  the registry record
 * @param {object} params.toolInput     the raw emit_lens_reading input
 * @param {Array<{id, text, type}>} params.claims  the code-side target set
 * @param {string[]} [params.truncationFlags]  input-truncation notices
 *   from the transport layer (surfaced, never silent — §6)
 * @returns {{reading: object, rejectedCount: number}}
 */
export function assembleJurisdictionReading({ jurisdiction, toolInput, claims, truncationFlags = [] }) {
    const admissible = admissibleAuthorities(jurisdiction);
    const validated = validateLensToolInput(toolInput, {
        claims,
        authorityIds: admissible.map((a) => a.authority_id)
    });

    const readings = validated.ok ? validated.readings : [];
    const rejected = validated.ok ? validated.rejected.slice() : [];
    if (!validated.ok) {
        rejected.push({
            claim_id: null,
            reason: `structurally unusable model output: ${validated.errors.map((e) => `${e.path} ${e.message}`).join('; ')}`
        });
    }

    // A claim the model returned no (surviving) reading for is a
    // visible gap, not a silent one.
    const covered = new Set(readings.map((r) => r.claim_id));
    const mentioned = new Set(rejected.map((r) => r.claim_id).filter(Boolean));
    for (const c of claims) {
        if (!covered.has(c.id) && !mentioned.has(c.id)) {
            rejected.push({ claim_id: c.id, reason: 'no reading returned by the model for this claim' });
        }
    }

    // Grounding counts — computed, never model-echoed.
    let groundedCount = 0;
    let inferredCount = 0;
    for (const r of readings) {
        const g = readingGroundedness(r);
        if (g === 'grounded') groundedCount += 1;
        else if (g === 'inferred') inferredCount += 1;
    }

    // Per-authority coverage from citation frequency.
    const citedBy = new Map();
    for (const r of readings) {
        const seen = new Set();
        for (const c of (r.authorities_cited || [])) {
            if (seen.has(c.authority_id)) continue;
            seen.add(c.authority_id);
            citedBy.set(c.authority_id, (citedBy.get(c.authority_id) || 0) + 1);
        }
    }

    // §5.3 thin representation — distinct from thin COVERAGE: a corpus
    // can address every claim and still misrepresent the tradition it
    // speaks for. Deterministic v1 rule: a declared multi-vocal
    // worldview whose admissible corpus draws on a single work.
    const thinRepresentation = [];
    const divisions = Array.isArray(jurisdiction.internal_divisions) ? jurisdiction.internal_divisions : [];
    if (jurisdiction.jurisdiction_type === 'worldview' && divisions.length >= 2) {
        const works = new Set(admissible.map((a) => (a.citation && a.citation.work) || ''));
        if (works.size <= 1) {
            thinRepresentation.push(
                `single-work corpus for a multi-vocal tradition (${divisions.length} internal divisions declared) — §5.3 thin representation`);
        }
    }

    const reading = {
        id: jurisdiction.id,
        type: jurisdiction.jurisdiction_type,
        display_name: jurisdiction.display_name,
        // The EFFECTIVE guardrail bit: a persona with an unknown bit is
        // treated as living (fails closed), and that is what is
        // disclosed. Stamped from the registry — never model-echoed.
        is_living_person: jurisdiction.jurisdiction_type === 'persona'
            ? treatAsLiving(jurisdiction) : false,
        authorities_loaded: admissible.map((a) => ({
            authority_id: a.authority_id,
            citation: formatCitation(a.citation),
            language: (a.citation && a.citation.language) || null,
            coverage: coverageLevel(citedBy.get(a.authority_id) || 0, claims.length)
        })),
        corpus_provenance: {
            curated_by:      (jurisdiction.corpus_provenance && jurisdiction.corpus_provenance.curated_by) || null,
            candidate_pool:  (jurisdiction.corpus_provenance && jurisdiction.corpus_provenance.candidate_pool) || null,
            selection_basis: (jurisdiction.corpus_provenance && jurisdiction.corpus_provenance.selection_basis) || null
        },
        internal_divisions: divisions.slice(),
        readings,
        reconstruction_summary: validated.reconstruction_summary,
        grounding: {
            grounded_count: groundedCount,
            inferred_count: inferredCount,
            thin_coverage_flags: validated.thin_coverage_flags,
            thin_representation_flags: thinRepresentation,
            recommended_sources: validated.recommended_sources,
            truncation_flags: truncationFlags.slice(),
            rejected_readings: rejected
        }
    };

    return { reading, rejectedCount: rejected.length };
}

// ------------------------------------------------------------------
// Panel assembly (§5.3 — code-side, from the user's declared
// selection and the per-jurisdiction results)
// ------------------------------------------------------------------

function truncateText(s, n) {
    const str = String(s || '');
    return str.length > n ? `${str.slice(0, n - 1)}…` : str;
}

/**
 * The P5 symmetry disclosure. `selectionBasis` is the user's own
 * declared basis — read as SELF-ATTESTED by the curator, never an
 * independent check (§5.3). The symmetry flag uses a deterministic
 * proxy: a panel where every jurisdiction's dispositions run
 * predominantly against the target (more rejects than endorses) is
 * flagged as possibly one-sided.
 */
export function assemblePanelComposition({ jurisdictionReadings = [], selectionBasis = '' } = {}) {
    const empaneled = jurisdictionReadings.map((j) => `${j.display_name} (${j.type})`);

    const symmetryFlags = [];
    const withDispositions = jurisdictionReadings.filter((j) =>
        (j.readings || []).some((r) => r.disposition));
    if (withDispositions.length > 0) {
        const allHostile = withDispositions.every((j) => {
            const ds = (j.readings || []).map((r) => r.disposition).filter(Boolean);
            const rejects = ds.filter((d) => d === 'rejects').length;
            const endorses = ds.filter((d) => d === 'endorses' || d === 'partially-endorses').length;
            return rejects > endorses;
        });
        if (allHostile) {
            symmetryFlags.push(
                'no empaneled jurisdiction read the target sympathetically — the panel may be one-sided;'
                + ' consider loading a lens a fair observer would expect to be sympathetic (§5.3)');
        }
    }

    return {
        empaneled,
        selection_basis: String(selectionBasis || '').trim()
            || 'not stated (self-attested by the curator — §5.3)',
        symmetry_flags: symmetryFlags
    };
}

/**
 * Cross-jurisdiction agreements/divergences, computed from the
 * dispositions alone — no model call. Only claims with disposition
 * readings from two or more jurisdictions can agree or diverge.
 */
export function assemblePanelComparison({ jurisdictionReadings = [], claims = [] } = {}) {
    const agreements = [];
    const divergences = [];
    const textById = new Map(claims.map((c) => [c.id, c.text]));

    for (const claim of claims) {
        const positions = [];
        for (const j of jurisdictionReadings) {
            const r = (j.readings || []).find((x) => x.claim_id === claim.id);
            if (r && r.disposition) positions.push({ name: j.display_name, disposition: r.disposition });
        }
        if (positions.length < 2) continue;
        const first = positions[0].disposition;
        if (positions.every((p) => p.disposition === first)) {
            agreements.push(
                `all empaneled jurisdictions read "${truncateText(textById.get(claim.id), 80)}" as ${first}`);
        } else {
            divergences.push({
                claim_id: claim.id,
                split: positions.map((p) => `${p.name}: ${p.disposition}`).join('; ')
            });
        }
    }
    return { agreements, divergences };
}

/**
 * The full §7 panel object from incremental per-jurisdiction results.
 * `provenance` comes from the transport layer (last successful call
 * wins — model + LENS_PROMPT_VERSION + run_at).
 */
export function assembleLensPanel({ target, jurisdictionReadings = [], selectionBasis = '', provenance }) {
    return {
        provenance,
        target,
        jurisdictions: jurisdictionReadings,
        panel_composition: assemblePanelComposition({ jurisdictionReadings, selectionBasis }),
        panel_comparison: assemblePanelComparison({ jurisdictionReadings, claims: (target && target.claims) || [] })
    };
}

// ------------------------------------------------------------------
// Session cache — per capture id, chrome.storage.session ONLY
// ------------------------------------------------------------------

export const LENS_SESSION_PREFIX = 'xray:lensread:';

// NO storage.local fallback, deliberately (see module header): the
// derived view must never be durably written. Firefox ≥128 (the
// manifest floor) and Chrome both ship storage.session.
function sessionArea() {
    if (typeof browser !== 'undefined' && browser.storage && browser.storage.session) {
        return browser.storage.session;
    }
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session) {
        return chrome.storage.session;
    }
    return null;
}

/**
 * Cache a lens run for this capture id (the reader re-renders it
 * without a new API call within the browser session). Returns false —
 * harmlessly — where no session storage exists.
 */
export function cacheLensRun(captureId, run) {
    return new Promise((resolve) => {
        const area = sessionArea();
        if (!area || !captureId) return resolve(false);
        try {
            area.set({ [LENS_SESSION_PREFIX + captureId]: run }, () => resolve(true));
        } catch (_) { resolve(false); }
    });
}

/** Read a cached lens run for this capture id, or null. */
export function getCachedLensRun(captureId) {
    return new Promise((resolve) => {
        const area = sessionArea();
        if (!area || !captureId) return resolve(null);
        try {
            const key = LENS_SESSION_PREFIX + captureId;
            area.get([key], (res) => resolve((res && res[key]) || null));
        } catch (_) { resolve(null); }
    });
}
