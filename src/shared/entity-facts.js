// entity-facts.js — the fact layer's validation + conflict machinery
// (Phase 19, docs/ENTITY_DOSSIER_DESIGN.md §4). A fact is a CLAIM with
// a structured `fact` field — not a parallel store — so the entire
// provenance contract (verbatim quote, article hash, anchor, source
// url, suggested_by) and the whole judgment pipeline (assessments,
// adjudication, contradicts links, case membership) ride along free.
//
// This module is pure over passed data except FactDismissals, the one
// storage surface (the `entity_fact_dismissals` key — listed in
// WORKSPACE_CLEAR_KEYS). Claim-model wiring and the additive 30040
// fact tags land in slice 19.2.

import { Storage } from './storage.js';
import { getFieldDef, isCustomField } from './entity-field-schemas.js';
import { isValidDatePrecision, sameDateWithinPrecision } from './dossier-time.js';

const VALUE_MAX = 500;

function isEntityId(s) {
    return typeof s === 'string' && /^entity_[0-9a-f]{16}$/.test(s);
}

// A {value, precision} date slot: value is epoch seconds, precision a
// DATE_PRECISIONS member. Both-or-neither.
function cleanDateSlot(value, precision, label) {
    if (value === undefined || value === null) return { value: null, precision: null };
    if (!Number.isFinite(value)) throw new Error(`${label} must be epoch seconds`);
    const p = precision || 'exact';
    if (!isValidDatePrecision(p)) throw new Error(`${label}_precision invalid: ${p}`);
    return { value: Math.floor(value), precision: p };
}

/**
 * Validate a fact layer for a claim. `about` is the claim's entity
 * list (the subject MUST be among them — a fact about W.H.O. is a
 * claim about W.H.O.); `entityType` is the subject's type, which picks
 * the field registry. Throws on any violation; returns the normalized
 * fact record. Authored-provenance fields are REJECTED here — they
 * never ride claims (claims require a source; the user's own case
 * framing lives on the entity record instead).
 */
export function cleanFact(fact, { about = [], entityType } = {}) {
    const f = fact || {};
    if (!isEntityId(f.entity_id)) {
        throw new Error('fact.entity_id must be an entity id');
    }
    if (!(about || []).includes(f.entity_id)) {
        throw new Error('fact.entity_id must be in the claim\'s about list — a fact about X is a claim about X');
    }

    const def = getFieldDef(entityType, f.field);
    if (!def) {
        throw new Error(`fact.field "${f.field}" is not in the ${entityType} registry (or custom:<token>)`);
    }
    if (def.provenance === 'authored') {
        throw new Error(`"${f.field}" is an authored field — it lives on the entity record, never on a claim`);
    }

    const value = String(f.value || '').trim();
    if (!value) throw new Error('fact.value is required');
    if (value.length > VALUE_MAX) throw new Error(`fact.value exceeds ${VALUE_MAX} chars`);
    if (def.value_type === 'enum' && !(def.enum_values || []).includes(value)) {
        throw new Error(`fact.value "${value}" is not one of ${(def.enum_values || []).join(', ')}`);
    }

    let value_ref = null;
    if (def.value_type === 'entity-ref') {
        if (!isEntityId(f.value_ref)) {
            throw new Error(`"${f.field}" is an entity-ref field — fact.value_ref must be an entity id`);
        }
        value_ref = f.value_ref;
    } else if (f.value_ref) {
        throw new Error(`"${f.field}" is not an entity-ref field — fact.value_ref must be absent`);
    }

    const from = cleanDateSlot(f.valid_from, f.valid_from_precision, 'valid_from');
    const to   = cleanDateSlot(f.valid_to, f.valid_to_precision, 'valid_to');
    const obs  = cleanDateSlot(f.observed_at, f.observed_precision, 'observed_at');

    return {
        entity_id: f.entity_id,
        field:     f.field,
        value,
        value_ref,
        valid_from:           from.value,
        valid_from_precision: from.precision,
        valid_to:             to.value,
        valid_to_precision:   to.precision,
        observed_at:          obs.value,
        observed_precision:   obs.precision
    };
}

export function isFactClaim(claim) {
    return !!(claim && claim.fact && typeof claim.fact === 'object'
        && claim.fact.entity_id && claim.fact.field);
}

/** Group fact-carrying claims by their fact field, insertion-ordered. */
export function groupFactsByField(factClaims) {
    const out = new Map();
    for (const c of factClaims || []) {
        if (!isFactClaim(c)) continue;
        const key = c.fact.field;
        if (!out.has(key)) out.set(key, []);
        out.get(key).push(c);
    }
    return out;
}

// Type-aware value equality: dates agree within their precision
// bands (a year-precision statement and a day-precision statement of
// the same year are compatible, not a dispute); entity-refs compare
// by id; text compares case/whitespace-normalized.
function valuesAgree(def, a, b) {
    if (def && def.value_type === 'date') {
        const da = parseFactDate(a);
        const db = parseFactDate(b);
        if (da && db) {
            return sameDateWithinPrecision(da.at, da.precision, db.at, db.precision);
        }
        // Unparseable date text falls through to text comparison.
    }
    if (def && def.value_type === 'entity-ref') {
        return (a.fact.value_ref || '') === (b.fact.value_ref || '');
    }
    const norm = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
    return norm(a.fact.value) === norm(b.fact.value);
}

// A date fact's display value parses through the same honest-band
// grammar as article metadata dates ("1962", "1962-03", "1962-03-15",
// or a full timestamp).
function parseFactDate(claim) {
    const s = String(claim.fact.value || '').trim();
    if (!s) return null;
    let precision = 'exact';
    if (/^\d{4}$/.test(s)) precision = 'year';
    else if (/^\d{4}-\d{2}$/.test(s)) precision = 'month';
    else if (/^\d{4}-\d{2}-\d{2}$/.test(s)) precision = 'day';
    const parsed = Date.parse(precision === 'year' ? `${s}-01-01` : precision === 'month' ? `${s}-01` : s);
    if (Number.isNaN(parsed)) return null;
    return { at: Math.floor(parsed / 1000), precision };
}

// Two validity intervals "overlap" unless both are known and disjoint
// — unknown validity is treated as overlapping (conservative: a
// conflict the user can dismiss beats a silently hidden dispute).
function validityOverlaps(a, b) {
    const af = a.fact.valid_from, at = a.fact.valid_to;
    const bf = b.fact.valid_from, bt = b.fact.valid_to;
    if (at !== null && at !== undefined && bf !== null && bf !== undefined && at < bf) return false;
    if (bt !== null && bt !== undefined && af !== null && af !== undefined && bt < af) return false;
    return true;
}

/** Order-independent dismissal key for a conflict pair. */
export function dismissalKey(idA, idB) {
    return [String(idA), String(idB)].sort().join('|');
}

/**
 * Detect conflicts among fact claims for ONE entity: same field +
 * `multiple: false` + overlapping-or-unknown validity + values that
 * disagree after type-aware normalization. Returns conflict objects
 * naming BOTH claims — deliberately no winner field: conflicts render
 * side by side with their evidence and never auto-resolve (design
 * §2.3). Pairs in `dismissals` (keyed by dismissalKey) are skipped —
 * "dual nationality is fine".
 *
 * @param {object[]} factClaims claims for one entity (fact layer set)
 * @param {{entityType?: string, dismissals?: object}} [opts]
 */
export function factConflicts(factClaims, { entityType, dismissals = {} } = {}) {
    const conflicts = [];
    for (const [field, group] of groupFactsByField(factClaims)) {
        if (group.length < 2) continue;
        const def = getFieldDef(entityType, field);
        if (def && def.multiple) continue;          // many concurrent values are fine
        if (!def && isCustomField(field)) { /* custom = single-valued text */ }
        for (let i = 0; i < group.length; i++) {
            for (let j = i + 1; j < group.length; j++) {
                const a = group[i], b = group[j];
                if (valuesAgree(def, a, b)) continue;
                if (!validityOverlaps(a, b)) continue;
                const key = dismissalKey(a.id, b.id);
                if (dismissals[key]) continue;
                conflicts.push({
                    field,
                    entity_id: a.fact.entity_id,
                    claim_ids: [a.id, b.id],
                    values:    [a.fact.value, b.fact.value],
                    dismissal_key: key
                });
            }
        }
    }
    return conflicts;
}

// ------------------------------------------------------------------
// Conflict dismissals — the one stored surface. "These two values
// coexist" is a user judgment worth remembering, keyed by the pair.
// ------------------------------------------------------------------

const DISMISSALS_KEY = 'entity_fact_dismissals';

export const FactDismissals = {
    getAll: async () => await Storage.get(DISMISSALS_KEY, {}),

    dismiss: async (idA, idB, note = '') => {
        const all = await Storage.get(DISMISSALS_KEY, {});
        const key = dismissalKey(idA, idB);
        all[key] = { dismissed_at: Math.floor(Date.now() / 1000), note: String(note || '') };
        await Storage.set(DISMISSALS_KEY, all);
        return all[key];
    },

    undismiss: async (idA, idB) => {
        const all = await Storage.get(DISMISSALS_KEY, {});
        const key = dismissalKey(idA, idB);
        if (!all[key]) return false;
        delete all[key];
        await Storage.set(DISMISSALS_KEY, all);
        return true;
    }
};
