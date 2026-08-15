// X-Ray — the tiny hand-rolled schema vocabulary + walker, factored out
// of audit/findings-schemas.js (Phase 16.2) so the audit findings
// schemas and the lens-reading schemas (lens-schemas.js) validate
// against ONE walker instead of forking it. Pure module: no network,
// no chrome, no DOM. Behavior is unchanged from the Phase 13.1
// original — the audit tests pin it.
//
// The repo takes no schema-library dependency; these shapes need only
// type/enum/const/required/range/minLength checks. Unknown extra
// fields are tolerated (models add color; tolerance here never weakens
// the required core).
//
// Schema vocabulary:
//   type: 'string'|'number'|'integer'|'boolean'|'object'|'array', or an
//   array of those plus 'null'; const; enum; minimum/maximum (numbers);
//   minLength (strings — applied only when the value IS a string, so
//   ['string','null'] fields stay nullable); pattern; items; properties;
//   required.

// --- schema builder helpers --------------------------------------------------

export function str(extra = {}) { return { type: 'string', ...extra }; }
export function quote(extra = {}) { return { type: 'string', minLength: 1, ...extra }; }
export function nullableStr(extra = {}) { return { type: ['string', 'null'], ...extra }; }
export function nullableQuote(extra = {}) { return { type: ['string', 'null'], minLength: 1, ...extra }; }
export function int(extra = {}) { return { type: 'integer', ...extra }; }
export function bool() { return { type: 'boolean' }; }
export function en(values) { return { type: 'string', enum: values }; }
export function arr(items) { return { type: 'array', items }; }
export function obj(properties, required = []) { return { type: 'object', properties, required }; }
export function strArr() { return arr(str()); }

// --- walker ------------------------------------------------------------------

export function typeOf(value) {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value;
}

function typeMatches(value, type) {
    const t = typeOf(value);
    if (type === 'integer') return t === 'number' && Number.isInteger(value);
    if (type === 'number') return t === 'number' && Number.isFinite(value);
    return t === type;
}

/**
 * Validate `value` against `schema`, appending `{path, message}` rows
 * to `errors`. Depth-first; a type mismatch stops descent at that node.
 */
export function walk(value, schema, path, errors) {
    const types = Array.isArray(schema.type) ? schema.type : (schema.type ? [schema.type] : null);
    if (types && !types.some((t) => typeMatches(value, t))) {
        errors.push({ path, message: `expected ${types.join('|')}, got ${typeOf(value)}` });
        return;
    }
    if (value === null) return;   // nullable and null — nothing further to check

    if ('const' in schema && value !== schema.const) {
        errors.push({ path, message: `expected "${schema.const}", got "${value}"` });
    }
    if (schema.enum && !schema.enum.includes(value)) {
        errors.push({ path, message: `"${value}" not in [${schema.enum.join(', ')}]` });
    }
    if (typeof value === 'string') {
        if (schema.minLength !== undefined && value.length < schema.minLength) {
            errors.push({ path, message: `shorter than minLength ${schema.minLength}` });
        }
        if (schema.pattern && !schema.pattern.test(value)) {
            errors.push({ path, message: `does not match ${schema.pattern}` });
        }
    }
    if (typeof value === 'number') {
        if (schema.minimum !== undefined && value < schema.minimum) {
            errors.push({ path, message: `below minimum ${schema.minimum}` });
        }
        if (schema.maximum !== undefined && value > schema.maximum) {
            errors.push({ path, message: `above maximum ${schema.maximum}` });
        }
    }
    if (Array.isArray(value) && schema.items) {
        value.forEach((item, i) => walk(item, schema.items, `${path}[${i}]`, errors));
    }
    if (typeOf(value) === 'object' && schema.properties) {
        for (const key of schema.required || []) {
            if (!(key in value)) {
                errors.push({ path: `${path}.${key}`, message: 'required field missing' });
            }
        }
        for (const [key, sub] of Object.entries(schema.properties)) {
            if (key in value) walk(value[key], sub, `${path}.${key}`, errors);
        }
        // Unknown extra fields are tolerated by design.
    }
}

// --- coercion -----------------------------------------------------------------
//
// WHY THIS EXISTS. `walk` answers "is this the right shape?"; this answers
// "make it a shape nothing will throw on." Both are needed, and conflating
// them is what produced the 2026-08-13 class: decorationTolerantView
// normalized a COPY for validation and handed the RAW value onward, so
// "validated" said nothing about what consumers received.
//
// The contract, deliberately narrow:
//   - CONTAINERS are coerced. A non-array where an array is declared
//     becomes []; a non-object where an object is declared becomes {}.
//     This is what makes downstream `.map` / `for...of` total.
//   - SCALARS are DROPPED, never defaulted. A number where a string is
//     declared is removed, not turned into "" — an absent field reads as
//     absent, and every consumer already handles that. Coercing it to ""
//     would invent a value the model never sent.
//   - ABSENT stays absent. Nothing is fabricated to satisfy `required`;
//     that is the validator's business, and it must still be able to fail.
//   - UNKNOWN keys ride through untouched (models add color, and the
//     walker tolerates them by design).
//
// Every change is REPORTED. That is the load-bearing part: a silent fix
// is how a wrong-typed `entities` list became an article that is
// permanently entity-blind behind a cache hit. The caller decides whether
// a given coercion is a shrug or a re-run — see llm-client's map pass,
// which treats a TOP-LEVEL container coercion as a malformed response.
//
// @returns {{value: any, coercions: Array<{path: Array<string>, expected: string, got: string}>}}
export function coerceToSchema(value, schema, path = []) {
    const coercions = [];
    const note = (expected, got) => coercions.push({ path, expected, got });

    if (!schema || typeof schema !== 'object') return { value, coercions };
    const types = Array.isArray(schema.type) ? schema.type : (schema.type ? [schema.type] : null);
    if (!types) return { value, coercions };          // untyped node — leave it alone

    if (value === null) {
        if (types.includes('null')) return { value: null, coercions };
        // A declared object/array that arrived null is a container hole:
        // coerce so consumers are total, and say so.
        if (types.includes('object')) { note('object', 'null'); return { value: {}, coercions }; }
        if (types.includes('array')) { note('array', 'null'); return { value: [], coercions }; }
        return { value: undefined, coercions };
    }

    if (types.includes('array')) {
        if (!Array.isArray(value)) {
            note('array', typeOf(value));
            return { value: [], coercions };
        }
        if (!schema.items) return { value, coercions };
        const out = [];
        value.forEach((item, i) => {
            const itemPath = [...path, String(i)];
            const r = coerceToSchema(item, schema.items, itemPath);
            coercions.push(...r.coercions);
            // A row that was ITSELF the wrong type is dropped, not kept as
            // an empty husk. A string where an object was declared is not
            // "a row with no fields" — it is not a row, and leaving {} in
            // place would inflate every count taken over the list while
            // contributing nothing. A row whose FIELD coerced (a deeper
            // path) is kept: that is per-row leniency, which this layer
            // has always had.
            const wasItself = r.coercions.some((c) => c.path.length === itemPath.length
                && c.path.every((seg, k) => seg === itemPath[k]));
            if (r.value !== undefined && !wasItself) out.push(r.value);
        });
        return { value: out, coercions };
    }

    if (types.includes('object')) {
        if (typeOf(value) !== 'object') {
            note('object', typeOf(value));
            return { value: {}, coercions };
        }
        const out = { ...value };
        for (const [key, sub] of Object.entries(schema.properties || {})) {
            if (!(key in out)) continue;               // absent stays absent
            const r = coerceToSchema(out[key], sub, [...path, key]);
            coercions.push(...r.coercions);
            if (r.value === undefined) delete out[key];
            else out[key] = r.value;
        }
        return { value: out, coercions };
    }

    // Scalar: keep it if the declared type matches, otherwise drop it.
    if (types.some((t) => typeMatches(value, t))) return { value, coercions };
    note(types.join('|'), typeOf(value));
    return { value: undefined, coercions };
}
