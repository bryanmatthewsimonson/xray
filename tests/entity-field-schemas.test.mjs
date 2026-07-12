// Entity field schema tests — Phase 19.1 (ENTITY_DOSSIER_DESIGN §3).
// Exhaustive pins in the truth-taxonomy style: a field added, renamed,
// or re-typed must fail HERE first, loudly — the registries are the
// contract every later slice (fact validation, dossier rendering,
// kind-0/30067 publishing) builds on.

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
    ENTITY_FIELD_SCHEMAS, FIELD_VALUE_TYPES, FIELD_PROVENANCES,
    CASE_STATUS_VALUES, fieldsForType, getFieldDef, isCustomField,
    isValidFieldValueType
} = await import('../src/shared/entity-field-schemas.js');
const { ENTITY_TYPES } = await import('../src/shared/entity-model.js');

// A compact pinnable projection of a row.
const pin = (r) => [r.field, r.value_type, r.multiple, r.evolves, r.provenance];

test('schemas: every entity type has a registry — no type falls through', () => {
    assert.deepEqual(Object.keys(ENTITY_FIELD_SCHEMAS).sort(), [...ENTITY_TYPES].sort());
});

test('schemas: person registry pinned exactly', () => {
    assert.deepEqual(fieldsForType('person').map(pin), [
        ['birth_date',  'date',       false, false, 'sourced'],
        ['death_date',  'date',       false, false, 'sourced'],
        ['occupation',  'text',       true,  true,  'sourced'],
        ['affiliation', 'entity-ref', true,  true,  'sourced'],
        ['role',        'text',       true,  true,  'sourced'],
        ['religion',    'text',       false, true,  'sourced'],
        ['residence',   'text',       false, true,  'sourced'],
        ['nationality', 'text',       true,  true,  'sourced'],
        ['education',   'text',       true,  false, 'sourced']
    ]);
});

test('schemas: organization registry pinned exactly', () => {
    assert.deepEqual(fieldsForType('organization').map(pin), [
        ['founded',      'date',       false, false, 'sourced'],
        ['dissolved',    'date',       false, false, 'sourced'],
        ['headquarters', 'text',       false, true,  'sourced'],
        ['leadership',   'entity-ref', true,  true,  'sourced'],
        ['org_type',     'text',       false, false, 'sourced'],
        ['parent_org',   'entity-ref', false, true,  'sourced']
    ]);
});

test('schemas: place + thing registries pinned exactly', () => {
    assert.deepEqual(fieldsForType('place').map(pin), [
        ['located_in', 'text', false, false, 'sourced'],
        ['place_type', 'text', false, false, 'sourced']
    ]);
    assert.deepEqual(fieldsForType('thing').map(pin), [
        ['thing_type',   'text',       false, false, 'sourced'],
        ['creator',      'entity-ref', true,  false, 'sourced'],
        ['created_date', 'date',       false, false, 'sourced']
    ]);
});

test('schemas: case registry pinned exactly — the ONLY authored fields in v1', () => {
    assert.deepEqual(fieldsForType('case').map(pin), [
        ['scope_question', 'text', false, false, 'authored'],
        ['status',         'enum', false, true,  'authored'],
        ['opened',         'date', false, false, 'authored'],
        ['closed',         'date', false, false, 'authored']
    ]);
    assert.deepEqual(getFieldDef('case', 'status').enum_values, CASE_STATUS_VALUES);
    assert.deepEqual([...CASE_STATUS_VALUES], ['open', 'active', 'dormant', 'closed']);

    // Authored provenance appears NOWHERE else — biography is sourced,
    // no exceptions (design §2.2).
    for (const type of Object.keys(ENTITY_FIELD_SCHEMAS)) {
        if (type === 'case') continue;
        for (const r of fieldsForType(type)) {
            assert.equal(r.provenance, 'sourced', `${type}.${r.field} must be sourced`);
        }
    }
});

test('schemas: value-type and provenance enums pinned; rows use only them', () => {
    assert.deepEqual([...FIELD_VALUE_TYPES], ['text', 'date', 'entity-ref', 'enum', 'number']);
    assert.deepEqual([...FIELD_PROVENANCES], ['sourced', 'authored']);
    for (const rows of Object.values(ENTITY_FIELD_SCHEMAS)) {
        for (const r of rows) {
            assert.ok(isValidFieldValueType(r.value_type), `${r.field}: ${r.value_type}`);
            assert.ok(FIELD_PROVENANCES.includes(r.provenance), `${r.field}: ${r.provenance}`);
            if (r.value_type === 'enum') assert.ok(Array.isArray(r.enum_values) && r.enum_values.length > 0);
        }
    }
});

test('schemas: custom fields — token grammar + synthesized def', () => {
    assert.ok(isCustomField('custom:blood-type'));
    assert.ok(isCustomField('custom:x'));
    assert.equal(isCustomField('custom:'), false, 'empty token rejected');
    assert.equal(isCustomField('custom:Blood-Type'), false, 'uppercase rejected');
    assert.equal(isCustomField('custom:has space'), false);
    assert.equal(isCustomField('blood-type'), false, 'prefix required');
    assert.equal(isCustomField(`custom:${'a'.repeat(49)}`), false, 'token capped at 48');

    const def = getFieldDef('person', 'custom:blood-type');
    assert.deepEqual(pin(def), ['custom:blood-type', 'text', false, false, 'sourced']);
    assert.equal(def.label, 'blood-type');
    assert.equal(getFieldDef('person', 'not-a-field'), null, 'unknown non-custom field → null');
    assert.equal(getFieldDef('person', 'founded'), null, 'fields do not leak across types');
});

test('schemas: tables are frozen — mutation throws or is inert', () => {
    assert.throws(() => { ENTITY_FIELD_SCHEMAS.person = []; }, TypeError);
    assert.throws(() => { fieldsForType('person')[0].label = 'x'; }, TypeError);
});
