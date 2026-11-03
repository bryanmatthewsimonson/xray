// Licensed estimates — a shape check for CONSTITUTION Art. 5.2.
//
// isLicensedEstimate(obj) is true when obj carries the four fields
// RESET_PLAN §4.2 names: `estimate: true` (condition 1, Declared), a
// `method` (condition 2), a `spread` (condition 3), and `n`, the count
// of its inputs (the "fused" definition, CONSTITUTION Art. 1).
//
// It checks shape only. It does not check how the number is used
// (condition 4), whether it mixes judgment families (condition 5), or
// whether its inputs are shown.
//
// Nothing calls it yet. The first licensed number wires it in, in its
// own PR; this module changes no shipped behaviour.
//
// Provenance: R-019

/**
 * True when `obj` carries `estimate: true`, a non-empty `method`
 * string, a non-null `spread`, and a whole-number `n` of at least 1.
 * @param {unknown} obj
 * @returns {boolean}
 */
export function isLicensedEstimate(obj) {
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return false;
    if (obj.estimate !== true) return false;
    if (typeof obj.method !== 'string' || obj.method.trim() === '') return false;
    if (obj.spread === undefined || obj.spread === null) return false;
    return Number.isInteger(obj.n) && obj.n >= 1;
}
