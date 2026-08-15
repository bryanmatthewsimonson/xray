// coerceToSchema — normalize model output ONCE, on entry, and SAY what
// was changed (src/shared/schema-walker.js).
//
// The contract under test, stated once:
//   containers coerce · scalars drop · absent stays absent ·
//   unknown keys ride through · every change is reported.
//
// The reporting half is the load-bearing half. A silent fix is what made
// a wrong-typed `entities` list into an article that was permanently
// entity-blind behind a cache hit — the shape looked fine afterwards, so
// nothing ever re-ran.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { coerceToSchema, obj, arr, str, bool, int, nullableStr } from '../src/shared/schema-walker.js';
import { WRONG_TYPES, TRUTHY_WRONG } from './helpers/hostile.mjs';

// Shaped like the real map tool: a nested object, a list of objects, a
// list of strings, and scalars of every kind.
const SCHEMA = obj({
    position: obj({ summary: str(), side_label: nullableStr() }),
    key_assertions: arr(obj({ quote: str(), load_bearing: bool(), n: int() }, ['quote'])),
    entities: arr(obj({ ref: str(), name: str() }, ['name'])),
    open_questions: arr(str())
}, ['position']);

const GOOD = {
    position: { summary: 'argues X', side_label: null },
    key_assertions: [{ quote: 'q', load_bearing: true, n: 2 }],
    entities: [{ ref: 'E1', name: 'Alice' }],
    open_questions: ['why?']
};

test('a well-formed object passes through untouched and reports nothing', () => {
    const { value, coercions } = coerceToSchema(GOOD, SCHEMA);
    assert.deepEqual(value, GOOD);
    assert.deepEqual(coercions, []);
});

test('CONTAINERS coerce — a wrong-typed list becomes [], and says so', () => {
    // An ARRAY is excluded here on purpose: where an array is declared,
    // `[1, 2]` is the RIGHT container holding wrong rows. That is a
    // row-level drop, not a malformed answer — see the test below. The
    // two must stay distinguishable, because the map pass fails on one
    // and tolerates the other.
    const notAList = TRUTHY_WRONG.filter(([label]) => label !== 'array');
    for (const [label, bad] of notAList) {
        const { value, coercions } = coerceToSchema({ ...GOOD, entities: bad }, SCHEMA);
        assert.ok(Array.isArray(value.entities), `${label}: entities is a list`);
        assert.equal(value.entities.length, 0, `${label}: and an empty one`);
        const top = coercions.filter((c) => c.path.length === 1 && c.path[0] === 'entities');
        assert.equal(top.length, 1, `${label}: reported exactly once, at the top level`);
        assert.equal(top[0].expected, 'array');
    }
});

test('a right-typed list of WRONG ROWS is row-level, never top-level', () => {
    const { value, coercions } = coerceToSchema({ ...GOOD, entities: [1, 2] }, SCHEMA);
    assert.deepEqual(value.entities, [], 'the husks drop');
    assert.equal(coercions.filter((c) => c.path.length === 1).length, 0,
        'the ANSWER was not malformed — only its rows were');
    assert.equal(coercions.length, 2, 'and each dropped row is still reported');
});

test('SCALARS drop rather than defaulting — "" is never invented', () => {
    const { value, coercions } = coerceToSchema(
        { ...GOOD, position: { summary: 42, side_label: null } }, SCHEMA);
    assert.ok(!('summary' in value.position),
        'a number where a string was declared is REMOVED, not coerced to ""');
    assert.deepEqual(coercions[0].path, ['position', 'summary']);
    // And the validator can therefore still fail it, which is the point:
    // fabricating "" would have made a missing field look supplied.
});

test('ABSENT stays absent — nothing is fabricated to satisfy `required`', () => {
    const { value, coercions } = coerceToSchema({ key_assertions: [] }, SCHEMA);
    assert.ok(!('position' in value), 'a required-but-missing field is NOT invented');
    assert.deepEqual(coercions, [], 'and absence is not a coercion');
});

test('UNKNOWN keys ride through — models add colour and the walker tolerates it', () => {
    const { value } = coerceToSchema({ ...GOOD, editorial_note: 'extra', depth: { a: 1 } }, SCHEMA);
    assert.equal(value.editorial_note, 'extra');
    assert.deepEqual(value.depth, { a: 1 });
});

test('a wrong-typed ROW inside a good list drops, and the good rows survive', () => {
    const { value } = coerceToSchema({
        ...GOOD,
        entities: [{ ref: 'E1', name: 'Alice' }, 'a string row', 42, null, { ref: 'E2', name: 'Bob' }]
    }, SCHEMA);
    assert.deepEqual(value.entities.map((e) => e.name), ['Alice', 'Bob'],
        'a bad row must never take the good ones with it');
});

test('a wrong-typed row FIELD drops without dropping the row', () => {
    const { value } = coerceToSchema({
        ...GOOD, key_assertions: [{ quote: 'q', load_bearing: 'yes', n: 'three' }]
    }, SCHEMA);
    assert.equal(value.key_assertions.length, 1, 'the row survives');
    assert.equal(value.key_assertions[0].quote, 'q');
    assert.ok(!('load_bearing' in value.key_assertions[0]), 'the string "yes" is not a boolean');
    assert.ok(!('n' in value.key_assertions[0]), 'the string "three" is not an integer');
});

test('null is preserved where declared nullable, coerced where not', () => {
    const { value: keptNull } = coerceToSchema(
        { ...GOOD, position: { summary: 's', side_label: null } }, SCHEMA);
    assert.equal(keptNull.position.side_label, null, 'nullable means null is a real answer');

    // A declared object/array arriving null is a container hole.
    const { value, coercions } = coerceToSchema({ ...GOOD, position: null }, SCHEMA);
    assert.deepEqual(value.position, {});
    assert.equal(coercions.some((c) => c.got === 'null'), true, 'and it is reported');
});

test('TOP-LEVEL vs nested is distinguishable — the caller decides what is fatal', () => {
    // This distinction is what lets the map pass refuse a malformed
    // response while tolerating per-row junk, as it always has.
    const { coercions } = coerceToSchema({
        position: { summary: 5 },                    // nested — row-level colour
        key_assertions: 'not a list',                // TOP-LEVEL — the answer is malformed
        entities: [{ ref: 1, name: 'A' }]            // nested
    }, SCHEMA);
    const top = coercions.filter((c) => c.path.length === 1);
    assert.deepEqual(top.map((c) => c.path[0]), ['key_assertions']);
    assert.ok(coercions.length > top.length, 'nested coercions are reported too, just not as top-level');
});

test('the coercer is TOTAL — no input throws, at any position', () => {
    for (const [label, bad] of WRONG_TYPES) {
        assert.doesNotThrow(() => coerceToSchema(bad, SCHEMA), `whole input as ${label}`);
        for (const field of ['position', 'key_assertions', 'entities', 'open_questions']) {
            assert.doesNotThrow(() => coerceToSchema({ ...GOOD, [field]: bad }, SCHEMA),
                `${field} as ${label}`);
        }
    }
    // Including degenerate schemas — a caller may pass anything.
    assert.doesNotThrow(() => coerceToSchema(GOOD, null));
    assert.doesNotThrow(() => coerceToSchema(GOOD, {}));
    assert.doesNotThrow(() => coerceToSchema(undefined, SCHEMA));
});

test('coercion is IDEMPOTENT — running it twice changes nothing further', () => {
    const once = coerceToSchema({ ...GOOD, entities: 'bad', position: { summary: 5 } }, SCHEMA);
    const twice = coerceToSchema(once.value, SCHEMA);
    assert.deepEqual(twice.value, once.value);
    assert.deepEqual(twice.coercions, [], 'a normalized value needs no further fixing');
});
