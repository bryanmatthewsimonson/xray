// entity-field-schemas.js — the per-entity-type AUTHORED field
// registry. Pure data tables + predicates in the truth-taxonomy.js
// style: frozen rows, exhaustive-enum pin tests in
// tests/entity-field-schemas.test.mjs.
//
// RETIREMENT NOTE (2026-07-20): Phase 19's sourced (claim-riding) fact
// fields — birth_date, headquarters, thing_type, custom:* and the rest
// — are REMOVED with the fact layer; the typed data model proved too
// stringent to be useful. What remains is the AUTHORED registry: the
// user's own framing fields on the entity record (case scope/status/
// dates in v1), validated by EntityModel.cleanAuthoredFields. These
// are load-bearing for the whole case layer (scope questions feed the
// suggest frame and every corpus prompt) and are NOT facts — they are
// never presented as sourced biography.

export const FIELD_VALUE_TYPES = Object.freeze(['text', 'date', 'enum']);

export const CASE_STATUS_VALUES = Object.freeze(['open', 'active', 'dormant', 'closed']);

// Row shape: { field, label, value_type, multiple, evolves, provenance, enum_values? }
const row = (field, label, value_type, opts = {}) => Object.freeze({
    field,
    label,
    value_type,
    multiple:    opts.multiple === true,
    evolves:     opts.evolves === true,
    provenance:  opts.provenance || 'authored',
    ...(opts.enum_values ? { enum_values: opts.enum_values } : {})
});

export const ENTITY_FIELD_SCHEMAS = Object.freeze({
    case: Object.freeze([
        row('scope_question', 'Scope question', 'text', { provenance: 'authored' }),
        row('status',         'Status',         'enum', { provenance: 'authored', evolves: true, enum_values: CASE_STATUS_VALUES }),
        row('opened',         'Opened',         'date', { provenance: 'authored' }),
        row('closed',         'Closed',         'date', { provenance: 'authored' })
    ])
});

export function isValidFieldValueType(t) {
    return FIELD_VALUE_TYPES.includes(t);
}

/** The registry rows for an entity type ([] for unknown types). */
export function fieldsForType(type) {
    return ENTITY_FIELD_SCHEMAS[type] || [];
}

/**
 * The field definition governing `field` for entities of `type` —
 * a registry row, or null.
 */
export function getFieldDef(type, field) {
    return fieldsForType(type).find((r) => r.field === field) || null;
}
