// entity-field-schemas.js — the typed per-entity-type field registries
// (Phase 19, docs/ENTITY_DOSSIER_DESIGN.md §3). Pure data tables +
// predicates in the truth-taxonomy.js style: frozen rows, isValid*
// helpers, exhaustive-enum pin tests in
// tests/entity-field-schemas.test.mjs.
//
// Semantics the table encodes (§3):
//   - unknown-by-default: the dossier renders EVERY row; an empty row
//     says "no captured source", never a blank guess;
//   - `multiple: false` + more than one concurrent value ⇒ contested
//     (never auto-resolved — entity-facts.js#factConflicts);
//   - `evolves: true` fields carry validity intervals and render as
//     history ("CEO 2019–2023", then "chair 2023–");
//   - `provenance: 'sourced'` fields MUST cite a captured quote (they
//     ride the claim model, 19.2); `'authored'` fields are the user's
//     own framing (case scope only in v1) and live on the entity
//     record, never presented as sourced facts;
//   - custom fields (`custom:<lowercase-token>`) are accepted wherever
//     a registry field is — the forensic custom-maneuver precedent.

export const FIELD_VALUE_TYPES = Object.freeze(['text', 'date', 'entity-ref', 'enum', 'number']);
export const FIELD_PROVENANCES = Object.freeze(['sourced', 'authored']);

export const CASE_STATUS_VALUES = Object.freeze(['open', 'active', 'dormant', 'closed']);

// Row shape: { field, label, value_type, multiple, evolves, provenance, enum_values? }
const row = (field, label, value_type, opts = {}) => Object.freeze({
    field,
    label,
    value_type,
    multiple:    opts.multiple === true,
    evolves:     opts.evolves === true,
    provenance:  opts.provenance || 'sourced',
    ...(opts.enum_values ? { enum_values: opts.enum_values } : {})
});

export const ENTITY_FIELD_SCHEMAS = Object.freeze({
    person: Object.freeze([
        row('birth_date',  'Born',        'date'),
        row('death_date',  'Died',        'date'),
        row('occupation',  'Occupation',  'text',       { multiple: true, evolves: true }),
        row('affiliation', 'Affiliation', 'entity-ref', { multiple: true, evolves: true }),
        row('role',        'Role',        'text',       { multiple: true, evolves: true }),
        row('religion',    'Religion',    'text',       { evolves: true }),
        row('residence',   'Residence',   'text',       { evolves: true }),
        row('nationality', 'Nationality', 'text',       { multiple: true, evolves: true }),
        row('education',   'Education',   'text',       { multiple: true })
    ]),
    organization: Object.freeze([
        row('founded',      'Founded',      'date'),
        row('dissolved',    'Dissolved',    'date'),
        row('headquarters', 'Headquarters', 'text',       { evolves: true }),
        row('leadership',   'Leadership',   'entity-ref', { multiple: true, evolves: true }),
        row('org_type',     'Type',         'text'),
        row('parent_org',   'Parent org',   'entity-ref', { evolves: true })
    ]),
    place: Object.freeze([
        row('located_in', 'Located in', 'text'),
        row('place_type', 'Type',       'text')
    ]),
    thing: Object.freeze([
        row('thing_type',   'Type',    'text'),
        row('creator',      'Creator', 'entity-ref', { multiple: true }),
        row('created_date', 'Created', 'date')
    ]),
    case: Object.freeze([
        row('scope_question', 'Scope question', 'text', { provenance: 'authored' }),
        row('status',         'Status',         'enum', { provenance: 'authored', evolves: true, enum_values: CASE_STATUS_VALUES }),
        row('opened',         'Opened',         'date', { provenance: 'authored' }),
        row('closed',         'Closed',         'date', { provenance: 'authored' })
    ])
});

// Custom fields: `custom:` + a lowercase token (the forensic
// custom-maneuver grammar, sans the namespace segment). Stored and
// treated as a sourced, single-valued text field.
const CUSTOM_FIELD_RE = /^custom:[a-z0-9][a-z0-9_-]{0,47}$/;

export function isCustomField(field) {
    return typeof field === 'string' && CUSTOM_FIELD_RE.test(field);
}

export function isValidFieldValueType(t) {
    return FIELD_VALUE_TYPES.includes(t);
}

/** The registry rows for an entity type ([] for unknown types). */
export function fieldsForType(type) {
    return ENTITY_FIELD_SCHEMAS[type] || [];
}

/**
 * The field definition governing `field` for entities of `type` —
 * a registry row, a synthesized def for a valid custom field, or
 * null when the field is neither.
 */
export function getFieldDef(type, field) {
    const hit = fieldsForType(type).find((r) => r.field === field);
    if (hit) return hit;
    if (isCustomField(field)) {
        return Object.freeze({
            field, label: field.slice('custom:'.length),
            value_type: 'text', multiple: false, evolves: false, provenance: 'sourced'
        });
    }
    return null;
}
