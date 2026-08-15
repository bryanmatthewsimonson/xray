// The HOSTILE FIXTURE SET — one shared source of malformed model output.
//
// WHY IT EXISTS. On 2026-08-13 two audits found 38 confirmed defects of a
// single class: code that reads model or peer output as if its shape were
// guaranteed. The suite had ~2,540 tests at the time and not one of them
// fed a malformed response — every fixture was well-formed, so the tests
// pinned INTENT (what the code does with good input) and never the
// BOUNDARY. That is why the class survived review by the person who wrote
// it: a boundary assumption looks correct in every example you think of.
//
// The guards fix the 38. This fixes the 39th. Any consumer of
// model-produced or peer-imported data should be run against WRONG_TYPES,
// and the rule is one line: it may reject, it may drop, it may report —
// it may not throw, and it may not invent.
//
// The tools are not `strict: true`, so every one of these is a response
// the API will hand us with a 200.

/**
 * Every wrong type a JSON field can arrive as, labelled.
 *
 * `undefined` is included deliberately: "absent" is a distinct case from
 * "present but wrong", and code that conflates them tends to be the code
 * that fabricates a default. `null` likewise — a model writing
 * `"entities": null` is reporting that it found none, which is a real
 * answer and must not be treated as damage.
 */
export const WRONG_TYPES = Object.freeze([
    ['object',        { a: 1 }],
    ['empty object',  {}],
    ['array',         [1, 2]],
    ['string',        'not what was declared'],
    ['empty string',  ''],
    ['number',        7],
    ['zero',          0],
    ['boolean',       true],
    ['null',          null],
    ['absent',        undefined]
]);

/** The subset that is TRUTHY — the ones `(x || [])` fails to rescue. */
export const TRUTHY_WRONG = Object.freeze(
    WRONG_TYPES.filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== 0 && v !== false));

/**
 * Rows that can appear INSIDE an otherwise well-formed list. Distinct
 * from a wrong-typed list: the list is fine, the members are not — and
 * several passes read local rows (`x.key`, `q.caseName`) without guarding
 * them, so a single null row threw.
 */
export const WRONG_ROWS = Object.freeze([null, undefined, 'a string row', 42, true, [], {}]);

/**
 * Build every variant of `base` with `field` replaced by each wrong type.
 * @returns {Array<[string, object]>} [label, object] pairs
 */
export function withWrongTypes(base, field, types = WRONG_TYPES) {
    return types.map(([label, value]) => {
        const copy = { ...base };
        if (value === undefined) delete copy[field];
        else copy[field] = value;
        return [`${field} as ${label}`, copy];
    });
}

/**
 * Assert a function survives every wrong type for a field.
 *
 * `fn` receives the mutated object. The contract asserted is exactly the
 * one above: no throw. What the function DOES with the bad input is the
 * caller's business to assert separately — this only pins that a
 * malformed response can never take the process down.
 */
export function assertTotal(assert, base, field, fn, types = WRONG_TYPES) {
    for (const [label, obj] of withWrongTypes(base, field, types)) {
        assert.doesNotThrow(() => fn(obj), `${label}: must not throw`);
    }
}
