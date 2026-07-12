// dossier-time.js — shared honest-precision date handling for the
// dossier layers (case dossier, entity facts).
//
// The house rule (PHILOSOPHY P4, the Phase-15 `occurred_precision`
// pattern): a date is always a {timestamp, precision} pair with
// precision ∈ year|month|day|exact — a year-precision value never
// fabricates a month or a day, and comparisons respect the band.

export const DATE_PRECISIONS = Object.freeze(['year', 'month', 'day', 'exact']);

export function isValidDatePrecision(p) {
    return DATE_PRECISIONS.includes(p);
}

/** Parse an article metadata date string without reading the clock.
 *  Date-only strings get honest band precision — never a fake exact
 *  timestamp (P4). Returns { at, precision } or null. */
export function parseMetaDate(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return { at: Math.floor(value), precision: 'exact' };
    }
    const s = String(value || '').trim();
    if (!s) return null;
    let precision = 'exact';
    if (/^\d{4}$/.test(s)) precision = 'year';
    else if (/^\d{4}-\d{2}$/.test(s)) precision = 'month';
    else if (/^\d{4}-\d{2}-\d{2}$/.test(s)) precision = 'day';
    const parsed = Date.parse(precision === 'year' ? `${s}-01-01` : precision === 'month' ? `${s}-01` : s);
    if (Number.isNaN(parsed)) return null;
    return { at: Math.floor(parsed / 1000), precision };
}

/** The inverse of parseMetaDate: render {at, precision} as an ISO
 *  string TRUNCATED to its honest band — '1962', '1962-03',
 *  '1962-03-15', or full ISO for exact. Emitting a full timestamp for
 *  a year-precision value would fabricate a month and day on the wire
 *  (P4); parseMetaDate reads every band back symmetrically. */
export function bandISO(at, precision) {
    const iso = new Date(at * 1000).toISOString();
    switch (precision) {
        case 'year':  return iso.slice(0, 4);
        case 'month': return iso.slice(0, 7);
        case 'day':   return iso.slice(0, 10);
        default:      return iso.replace(/\.\d{3}Z$/, 'Z');
    }
}

// The [start, end) band a {at, precision} pair honestly covers, in
// epoch seconds. UTC calendar math — the same convention parseMetaDate
// stores under.
function precisionBand(at, precision) {
    const d = new Date(at * 1000);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    const day = d.getUTCDate();
    switch (precision) {
        case 'year':  return [Date.UTC(y, 0, 1) / 1000, Date.UTC(y + 1, 0, 1) / 1000];
        case 'month': return [Date.UTC(y, m, 1) / 1000, Date.UTC(y, m + 1, 1) / 1000];
        case 'day':   return [Date.UTC(y, m, day) / 1000, Date.UTC(y, m, day + 1) / 1000];
        default:      return [at, at + 1];
    }
}

/**
 * Do two honest-precision dates AGREE? They agree when their bands
 * overlap — "1962" and "1962-03-15" are compatible statements of the
 * same date; "1962" and "1963" are not. The conservative rule keeps
 * conflict detection from manufacturing disputes out of precision
 * differences (facts layer, design §4).
 */
export function sameDateWithinPrecision(aAt, aPrecision, bAt, bPrecision) {
    if (!Number.isFinite(aAt) || !Number.isFinite(bAt)) return false;
    const [aStart, aEnd] = precisionBand(aAt, isValidDatePrecision(aPrecision) ? aPrecision : 'exact');
    const [bStart, bEnd] = precisionBand(bAt, isValidDatePrecision(bPrecision) ? bPrecision : 'exact');
    return aStart < bEnd && bStart < aEnd;
}
