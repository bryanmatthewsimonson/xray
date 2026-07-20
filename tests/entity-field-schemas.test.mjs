// Entity field schema tests — the AUTHORED registry only.
// (2026-07-20: the Phase 19 sourced fact fields are RETIRED with the
// whole fact layer — the pins here now guarantee the registry stays
// authored-only, and that the case fields the whole case layer leans
// on survive unchanged.)

import { test } from 'node:test';
import assert from 'node:assert/strict';

// chrome.storage stub before the entity-model import (ENTITY_TYPES pin).
const _stateStore = new Map();
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
            set(obj, cb) { for (const [k, v] of Object.entries(obj)) _stateStore.set(k, v); cb && cb(); },
            remove(keys, cb) { for (const k of Array.isArray(keys) ? keys : [keys]) _stateStore.delete(k); cb && cb(); }
        }
    }
};

const {
    ENTITY_FIELD_SCHEMAS, FIELD_VALUE_TYPES,
    CASE_STATUS_VALUES, fieldsForType, getFieldDef,
    isValidFieldValueType
} = await import('../src/shared/entity-field-schemas.js');

// A compact pinnable projection of a row.
const pin = (r) => [r.field, r.value_type, r.multiple, r.evolves, r.provenance];

test('schemas: the registry is AUTHORED-ONLY — the sourced fact fields stay retired', () => {
    assert.deepEqual(Object.keys(ENTITY_FIELD_SCHEMAS), ['case'],
        'only the case carries registry fields; biography-by-schema is gone');
    for (const type of ['person', 'organization', 'place', 'thing']) {
        assert.deepEqual(fieldsForType(type), [], `${type} has no typed fields`);
    }
    for (const rows of Object.values(ENTITY_FIELD_SCHEMAS)) {
        for (const r of rows) {
            assert.equal(r.provenance, 'authored', `${r.field} must be authored`);
        }
    }
});

test('schemas: case registry pinned exactly — the case layer leans on these', () => {
    assert.deepEqual(fieldsForType('case').map(pin), [
        ['scope_question', 'text', false, false, 'authored'],
        ['status',         'enum', false, true,  'authored'],
        ['opened',         'date', false, false, 'authored'],
        ['closed',         'date', false, false, 'authored']
    ]);
    assert.deepEqual(getFieldDef('case', 'status').enum_values, CASE_STATUS_VALUES);
    assert.deepEqual([...CASE_STATUS_VALUES], ['open', 'active', 'dormant', 'closed']);
});

test('schemas: value-type enum pinned; rows use only it', () => {
    assert.deepEqual([...FIELD_VALUE_TYPES], ['text', 'date', 'enum']);
    for (const rows of Object.values(ENTITY_FIELD_SCHEMAS)) {
        for (const r of rows) {
            assert.ok(isValidFieldValueType(r.value_type), `${r.field}: ${r.value_type}`);
            if (r.value_type === 'enum') assert.ok(Array.isArray(r.enum_values) && r.enum_values.length > 0);
        }
    }
});

test('schemas: getFieldDef — registry rows only, no custom grammar, no cross-type leaks', () => {
    assert.equal(getFieldDef('case', 'scope_question').label, 'Scope question');
    assert.equal(getFieldDef('case', 'not-a-field'), null);
    assert.equal(getFieldDef('person', 'scope_question'), null, 'fields do not leak across types');
    assert.equal(getFieldDef('person', 'custom:blood-type'), null,
        'the custom-field grammar retired with the fact layer');
});

test('schemas: tables are frozen — mutation throws or is inert', () => {
    assert.throws(() => { ENTITY_FIELD_SCHEMAS.case = []; }, TypeError);
    assert.throws(() => { fieldsForType('case')[0].label = 'x'; }, TypeError);
});
