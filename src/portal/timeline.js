// Portal timeline model (Phase 12.4, docs/PORTAL_DESIGN.md).
//
// Pure bucketing over event `created_at`: day buckets, rolling up to
// weeks when the corpus spans long enough that day bars would smear
// into noise. The view brushes a [start, end) range that lands in the
// Library filters (`after`/`before`), so the timeline and the list
// stay one filtering path.
//
// All bucket boundaries are UTC — deterministic in tests and stable
// across machines; the view layer is free to LABEL buckets in local
// time, but the math here never consults the host timezone.

const DAY = 86400;
const WEEK = 7 * DAY;

// Beyond this many day-buckets, roll up to weeks.
const DAY_BUCKET_CEILING = 180;

/** 'day' | 'week' for a corpus spanning `spanSeconds`. */
export function chooseBucket(spanSeconds) {
    return spanSeconds > DAY_BUCKET_CEILING * DAY ? 'week' : 'day';
}

/** Floor an epoch-seconds timestamp to its UTC bucket start. */
export function bucketStart(ts, bucket) {
    if (bucket === 'week') {
        // ISO-ish weeks anchored on Monday: epoch day 0 (1970-01-01)
        // was a Thursday — three days after a Monday — so (days + 3) % 7
        // is the Monday-based weekday index to subtract.
        const days = Math.floor(ts / DAY);
        const weekStartDay = days - ((days + 3) % 7);
        return weekStartDay * DAY;
    }
    return Math.floor(ts / DAY) * DAY;
}

/**
 * Bucket the items (any objects carrying `created_at` epoch seconds).
 * Returns a DENSE series — empty buckets included, so the view renders
 * gaps as gaps rather than splicing active days together.
 *
 * @param {Array<{created_at: number}>} items
 * @param {{bucket?: 'day'|'week'}} [opts]  omit to auto-choose
 * @returns {{bucket: string, buckets: Array<{start: number, end: number, count: number}>}}
 */
export function buildBuckets(items, { bucket } = {}) {
    const stamps = (Array.isArray(items) ? items : [])
        .map((i) => i && i.created_at)
        .filter((t) => Number.isFinite(t) && t > 0);
    if (stamps.length === 0) return { bucket: bucket || 'day', buckets: [] };

    const min = Math.min(...stamps);
    const max = Math.max(...stamps);
    const chosen = bucket || chooseBucket(max - min);
    const size = chosen === 'week' ? WEEK : DAY;

    const first = bucketStart(min, chosen);
    const counts = new Map();
    for (const t of stamps) {
        const start = bucketStart(t, chosen);
        counts.set(start, (counts.get(start) || 0) + 1);
    }

    const buckets = [];
    for (let start = first; start <= max; start += size) {
        buckets.push({ start, end: start + size, count: counts.get(start) || 0 });
    }
    return { bucket: chosen, buckets };
}

/**
 * Normalize a drag across bucket indices into the [after, before)
 * filter pair the Library consumes. Indices may arrive reversed
 * (right-to-left drag) and are clamped to the series.
 */
export function brushRange(buckets, indexA, indexB) {
    if (!Array.isArray(buckets) || buckets.length === 0) return null;
    let a = Math.max(0, Math.min(buckets.length - 1, Math.min(indexA, indexB)));
    let b = Math.max(0, Math.min(buckets.length - 1, Math.max(indexA, indexB)));
    return { after: buckets[a].start, before: buckets[b].end };
}
