// Case timeline — CD.3 pure helpers (docs/CASE_DOSSIER_DESIGN.md §3.3).
// precisionBand / publicationOf / caseTimeline / detectGaps over hand-
// built CD.1-shaped dossiers + portal library items. UTC-deterministic.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// case-timeline-block → case-dossier.js → storage.js probes chrome at load.
globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

const { precisionBand, publicationOf, caseTimeline, detectGaps } =
    await import('../src/portal/case-timeline-block.js');

const S = (y, m = 0, d = 1, h = 0) => Date.UTC(y, m, d, h) / 1000;
const DAY = 86400;

// ------------------------------------------------------------------
// precisionBand — the no-false-precision rule made geometric
// ------------------------------------------------------------------

test('precisionBand: a year spans the whole UTC year', () => {
    const b = precisionBand(S(2020, 5, 15, 12), 'year');
    assert.equal(b.start, S(2020, 0, 1));
    assert.equal(b.end, S(2021, 0, 1));
});

test('precisionBand: month and day span their UTC unit; exact is a point', () => {
    const month = precisionBand(S(2020, 5, 15, 12), 'month');
    assert.equal(month.start, S(2020, 5, 1));
    assert.equal(month.end, S(2020, 6, 1));

    const day = precisionBand(S(2020, 5, 15, 12), 'day');
    assert.equal(day.start, S(2020, 5, 15));
    assert.equal(day.end, S(2020, 5, 16));

    const at = S(2020, 5, 15, 12);
    const exact = precisionBand(at, 'exact');
    assert.equal(exact.start, at);
    assert.equal(exact.end, at);
});

// ------------------------------------------------------------------
// publicationOf
// ------------------------------------------------------------------

test('publicationOf reads the 30023 published_at tag; null otherwise', () => {
    const art = { kind: 30023, event: { tags: [['published_at', String(S(2019, 0, 1))]] } };
    assert.equal(publicationOf(art), S(2019, 0, 1));
    assert.equal(publicationOf({ kind: 30040, event: { tags: [['published_at', '123']] } }), null);
    assert.equal(publicationOf({ kind: 30023, event: { tags: [] } }), null);
});

// ------------------------------------------------------------------
// caseTimeline — the four-axis merge
// ------------------------------------------------------------------

function dossierWithTimeline() {
    return {
        timeline: [
            { axis: 'world', kind: 'proposition', at: S(2020, 5, 15), precision: 'year', ref: 'p1', label: 'state-fact' },
            { axis: 'judgment', kind: 'verdict', at: S(2021, 0, 1), precision: null, ref: 'v1', label: 'established-true' }
        ],
        propositions: []
    };
}

test('caseTimeline bands world events, points judgment, and joins pub/capture from items', () => {
    const items = [
        { id: 'a1', kind: 30023, url: 'https://u1', created_at: S(2021, 6, 1),
          title: 'A', event: { tags: [['published_at', String(S(2019, 0, 1))]] } }
    ];
    const { events, span, axis_counts } = caseTimeline(dossierWithTimeline(), items);

    const world = events.find((e) => e.axis === 'world');
    assert.equal(world.start, S(2020, 0, 1));       // year band, not the raw ts
    assert.equal(world.end, S(2021, 0, 1));

    const judgment = events.find((e) => e.axis === 'judgment');
    assert.equal(judgment.start, judgment.end);     // a point

    assert.equal(axis_counts.publication, 1);
    assert.equal(axis_counts.capture, 1);
    assert.equal(axis_counts.world, 1);
    assert.equal(axis_counts.judgment, 1);
    // span covers the earliest band start (2019 publication) to latest end.
    assert.equal(span.start, S(2019, 0, 1));
});

test('caseTimeline is deterministic and stable-ordered', () => {
    const items = [
        { id: 'a1', kind: 30023, url: 'https://u1', created_at: S(2021, 6, 1),
          title: 'A', event: { tags: [['published_at', String(S(2019, 0, 1))]] } }
    ];
    const a = caseTimeline(dossierWithTimeline(), items);
    const b = caseTimeline(dossierWithTimeline(), items);
    assert.equal(JSON.stringify(a), JSON.stringify(b));
    for (let i = 1; i < a.events.length; i++) {
        assert.ok(a.events[i - 1].start <= a.events[i].start);
    }
});

// ------------------------------------------------------------------
// detectGaps — the cross-axis callouts
// ------------------------------------------------------------------

test('detectGaps flags published-before-occurred', () => {
    const dossier = {
        timeline: [],
        propositions: [{
            proposition: { id: 'p1', occurred_at: S(2019, 0, 1), occurred_precision: 'day' },
            claim: { source_url: 'https://u1' },
            superseded_count: 0
        }]
    };
    const items = [{ id: 'a1', kind: 30023, url: 'https://u1', created_at: S(2018, 6, 1),
        title: 'A', event: { tags: [['published_at', String(S(2018, 0, 1))]] } }];
    const gaps = detectGaps(dossier, items);
    assert.ok(gaps.some((g) => g.type === 'published-before-occurred' && g.ref === 'p1'));
});

test('detectGaps flags story-changed-after-event on a superseded dated proposition', () => {
    const dossier = {
        timeline: [],
        propositions: [{
            proposition: { id: 'p1', occurred_at: S(2019, 0, 1), occurred_precision: 'day' },
            claim: { source_url: 'https://u1' },
            superseded_count: 1
        }]
    };
    const gaps = detectGaps(dossier, []);
    assert.ok(gaps.some((g) => g.type === 'story-changed-after-event' && g.ref === 'p1'));
});

test('detectGaps flags capture-long-after-publication beyond the 30-day window', () => {
    const dossier = { timeline: [], propositions: [] };
    const pub = S(2018, 0, 1);
    const items = [{ id: 'a1', kind: 30023, url: 'https://u1', created_at: pub + 60 * DAY,
        title: 'A', event: { tags: [['published_at', String(pub)]] } }];
    const gaps = detectGaps(dossier, items);
    const g = gaps.find((x) => x.type === 'capture-long-after-publication');
    assert.ok(g);
    assert.equal(g.ref, 'https://u1');

    // Within the window → no gap.
    const near = [{ id: 'a2', kind: 30023, url: 'https://u2', created_at: pub + 5 * DAY,
        title: 'B', event: { tags: [['published_at', String(pub)]] } }];
    assert.equal(detectGaps({ timeline: [], propositions: [] }, near)
        .filter((x) => x.type === 'capture-long-after-publication').length, 0);
});

test('detectGaps returns nothing when the joins have no data', () => {
    assert.deepEqual(detectGaps({ timeline: [], propositions: [] }, []), []);
});
