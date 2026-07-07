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
export function quote() { return { type: 'string', minLength: 1 }; }
export function nullableStr(extra = {}) { return { type: ['string', 'null'], ...extra }; }
export function nullableQuote() { return { type: ['string', 'null'], minLength: 1 }; }
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
