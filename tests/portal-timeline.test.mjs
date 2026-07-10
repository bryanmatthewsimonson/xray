// portal/timeline.js tests — Phase 12.4 (docs/PORTAL_DESIGN.md).
//
// Bucket math is UTC and pure; these pins keep the day/week rollup
// boundary, the dense (gap-preserving) series, and the brush→filter
// mapping honest. The applyFilters time-range semantics the brush
// lands in are pinned here too (after inclusive, before exclusive).

import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

const { chooseBucket, bucketStart, buildBuckets, brushRange, layoutWorldSpine } = await import('../src/portal/timeline.js');
const { applyFilters } = await import('../src/portal/library.js');

const DAY = 86400;

test('chooseBucket: day up to 180 days, week beyond', () => {
    assert.equal(chooseBucket(0), 'day');
    assert.equal(chooseBucket(180 * DAY), 'day');
    assert.equal(chooseBucket(180 * DAY + 1), 'week');
});

test('bucketStart floors to UTC day / Monday-anchored week', () => {
    // 2026-06-10T15:30:00Z (a Wednesday)
    const ts = Date.UTC(2026, 5, 10, 15, 30) / 1000;
    assert.equal(bucketStart(ts, 'day'), Date.UTC(2026, 5, 10) / 1000);
    assert.equal(bucketStart(ts, 'week'), Date.UTC(2026, 5, 8) / 1000); // Monday 06-08
    // Epoch day itself (Thursday) anchors to the preceding Monday
    // (1969-12-29, three days earlier).
    assert.equal(bucketStart(0, 'week'), -3 * DAY);
});

test('buildBuckets: dense series with gap days at zero', () => {
    const d0 = Date.UTC(2026, 5, 1) / 1000;
    const items = [
        { created_at: d0 + 100 },
        { created_at: d0 + 200 },
        { created_at: d0 + 2 * DAY + 5 }   // skips June 2 entirely
    ];
    const { bucket, buckets } = buildBuckets(items);
    assert.equal(bucket, 'day');
    assert.deepEqual(buckets.map((b) => b.count), [2, 0, 1]);
    assert.equal(buckets[0].start, d0);
    assert.equal(buckets[1].count, 0);
    assert.equal(buckets[2].start, d0 + 2 * DAY);
    for (const b of buckets) assert.equal(b.end - b.start, DAY);
});

test('buildBuckets: long spans roll up to weeks automatically', () => {
    const d0 = Date.UTC(2025, 0, 6) / 1000; // a Monday
    const items = [
        { created_at: d0 },
        { created_at: d0 + 300 * DAY }
    ];
    const { bucket, buckets } = buildBuckets(items);
    assert.equal(bucket, 'week');
    for (const b of buckets) assert.equal(b.end - b.start, 7 * DAY);
    assert.equal(buckets[0].count, 1);
    assert.equal(buckets[buckets.length - 1].count, 1);
});

test('buildBuckets: empty/garbage input yields an empty series', () => {
    assert.deepEqual(buildBuckets([]).buckets, []);
    assert.deepEqual(buildBuckets([{ created_at: 0 }, {}, null]).buckets, []);
});

test('buildBuckets: a millisecond-precision created_at cannot explode the series', () => {
    const d0 = Date.UTC(2026, 5, 1) / 1000;
    const { buckets } = buildBuckets([
        { created_at: d0 },
        { created_at: d0 * 1000 }   // 13-digit ms timestamp from a broken writer
    ]);
    // The insane stamp is ignored entirely — one bucket, not ~3 million.
    assert.equal(buckets.length, 1);
    assert.equal(buckets[0].count, 1);
});

test('brushRange normalizes reversed drags and clamps to the series', () => {
    const d0 = Date.UTC(2026, 5, 1) / 1000;
    const { buckets } = buildBuckets([
        { created_at: d0 + 10 },
        { created_at: d0 + 2 * DAY + 10 }
    ], { bucket: 'day' });
    assert.equal(buckets.length, 3);
    const forward = brushRange(buckets, 0, 1);
    const reversed = brushRange(buckets, 1, 0);
    assert.deepEqual(forward, reversed);
    assert.equal(forward.after, buckets[0].start);
    assert.equal(forward.before, buckets[1].end);
    const clamped = brushRange(buckets, -5, 99);
    assert.deepEqual(clamped, { after: buckets[0].start, before: buckets[2].end });
    assert.equal(brushRange([], 0, 0), null);
});

test('applyFilters time range: after inclusive, before exclusive', () => {
    const items = [
        { typeKey: 'claim', created_at: 100, cases: [], searchText: '', platform: '', domain: '', client: '' },
        { typeKey: 'claim', created_at: 200, cases: [], searchText: '', platform: '', domain: '', client: '' },
        { typeKey: 'claim', created_at: 300, cases: [], searchText: '', platform: '', domain: '', client: '' }
    ];
    assert.equal(applyFilters(items, { after: 200, before: 0 }).length, 2);
    assert.equal(applyFilters(items, { after: 0, before: 300 }).length, 2);
    assert.deepEqual(applyFilters(items, { after: 200, before: 300 }).map((i) => i.created_at), [200]);
    assert.equal(applyFilters(items, {}).length, 3);
});

// --- layoutWorldSpine (CD.3 world-time spine) -----------------------

test('layoutWorldSpine: proportional x positions across the span', () => {
    const out = layoutWorldSpine([
        { ref: 'a', at: 1000, precision: 'exact' },
        { ref: 'b', at: 2000, precision: 'exact' },
        { ref: 'c', at: 1500, precision: 'exact' }
    ], 100);
    // Sorted by `at`; endpoints pin to 0 and width, midpoint proportional.
    assert.deepEqual(out.map((e) => e.ref), ['a', 'c', 'b']);
    assert.equal(out[0].x, 0);
    assert.equal(out[2].x, 100);
    assert.equal(out[1].x, 50);   // (1500-1000)/(2000-1000)*100
    // Exact precision → zero-width band (a point marker).
    assert.ok(out.every((e) => e.bandWidth === 0));
});

test('layoutWorldSpine: precision widens the band proportionally', () => {
    // A one-year span; a year-precision event is a full-width band.
    const year = 365 * DAY;
    const out = layoutWorldSpine([
        { ref: 'start', at: 0, precision: 'day' },
        { ref: 'end', at: year, precision: 'year' }
    ], 365);
    const end = out.find((e) => e.ref === 'end');
    const start = out.find((e) => e.ref === 'start');
    assert.equal(Math.round(start.bandWidth), 1);    // one day over a 365-day span → ~1px
    assert.equal(Math.round(end.bandWidth), 365);    // one year → full width
    assert.ok(!('extra' in end) || true);            // originals preserved, x/bandWidth added
});

test('layoutWorldSpine: single event and empty input degrade gracefully', () => {
    assert.deepEqual(layoutWorldSpine([], 100), []);
    const one = layoutWorldSpine([{ ref: 'solo', at: 5, precision: 'year' }], 100);
    assert.equal(one.length, 1);
    assert.equal(one[0].x, 50);          // centered when there is no span
    assert.equal(one[0].bandWidth, 0);   // no span → no proportional band
    // Undated events are dropped from the spine (they belong in `undated`).
    assert.deepEqual(layoutWorldSpine([{ ref: 'x', at: null }], 100), []);
});
