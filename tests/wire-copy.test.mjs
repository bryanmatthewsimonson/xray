// R8 tests — wire-copy shared-text scan (founding-transcript
// integration; JOURNAL 2026-08-02). Pins: containment (not jaccard) is
// the threshold number so embedded wire copy in a longer piece still
// triggers; short texts are skipped and disclosed; groups are
// connected components (reprint chains group transitively); nothing in
// the output asserts identity — no merged ids, no origin keys.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
    shingleSet, pairOverlap, scanForSharedText, SHINGLE_SIZE
} = await import('../src/shared/wire-copy.js');

// Deterministic filler prose: `word<i>` tokens never collide across
// different ranges, so overlap comes only from shared ranges.
const words = (from, count) =>
    Array.from({ length: count }, (_, i) => `word${from + i}`).join(' ');

const WIRE = words(0, 400);            // the "wire story": 400 tokens

test('shingleSet: size, tokenization, punctuation/case folding', () => {
    const s = shingleSet('Alpha, beta! GAMMA delta epsilon zeta eta theta iota.', 8);
    assert.equal(s.size, 2, '9 tokens → 2 eight-token shingles');
    const s2 = shingleSet('alpha beta gamma delta epsilon zeta eta theta iota', 8);
    assert.deepEqual([...s].sort(), [...s2].sort(), 'punctuation and case fold away');
});

test('pairOverlap: identical, disjoint, containment vs jaccard asymmetry', () => {
    const a = shingleSet(WIRE);
    assert.equal(pairOverlap(a, a).containment, 1);
    const b = shingleSet(words(1000, 400));
    assert.equal(pairOverlap(a, b).shared, 0);
    // Wire story embedded in a piece 3× as long: containment of the
    // shorter text stays high while jaccard drops.
    const embedded = shingleSet(`${words(2000, 400)} ${WIRE} ${words(3000, 400)}`);
    const stats = pairOverlap(a, embedded);
    assert.ok(stats.containment > 0.9, `containment high (${stats.containment})`);
    assert.ok(stats.jaccard < 0.5, `jaccard diluted (${stats.jaccard})`);
});

test('scan: embedded reprint detected via containment; unrelated member stays out', () => {
    const members = [
        { articleHash: 'h1', url: 'https://wire.com/story', title: 'Wire original', text: WIRE },
        { articleHash: 'h2', url: 'https://outlet.com/long', title: 'Outlet reprint with framing',
          text: `${words(2000, 300)} ${WIRE} ${words(3000, 300)}` },
        { articleHash: 'h3', url: 'https://other.com/own', title: 'Independent reporting',
          text: words(5000, 500) }
    ];
    const scan = scanForSharedText(members);
    assert.equal(scan.pairs.length, 1);
    assert.deepEqual(
        [scan.pairs[0].a.articleHash, scan.pairs[0].b.articleHash].sort(),
        ['h1', 'h2']);
    assert.ok(scan.pairs[0].containment > 0.9);
    assert.equal(scan.groups.length, 1);
    assert.equal(scan.groups[0].size, 2);
    assert.equal(scan.scanned, 3);
});

test('scan: reprint chains group transitively (connected components)', () => {
    // h1↔h2 share range A; h2↔h3 share range B; h1 and h3 share nothing
    // directly — one group of three.
    const A = words(0, 300);
    const B = words(1000, 300);
    const members = [
        { articleHash: 'h1', title: 'ends A', text: `${A} ${words(2000, 150)}` },
        { articleHash: 'h2', title: 'middle', text: `${A} ${B}` },
        { articleHash: 'h3', title: 'ends B', text: `${B} ${words(3000, 150)}` }
    ];
    const scan = scanForSharedText(members);
    assert.equal(scan.groups.length, 1);
    assert.equal(scan.groups[0].size, 3);
    assert.ok(scan.pairs.length >= 2, 'ends pair through the middle');
});

test('scan: short texts are skipped and disclosed, never compared', () => {
    const members = [
        { articleHash: 'h1', title: 'blurb', text: words(0, 40) },
        { articleHash: 'h2', title: 'same blurb reprinted', text: words(0, 40) },
        { articleHash: 'h3', title: 'real length', text: words(1000, 400) }
    ];
    const scan = scanForSharedText(members);
    assert.equal(scan.scanned, 1);
    assert.equal(scan.skipped.length, 2);
    assert.ok(scan.skipped.every((s) => s.shingles < 100));
    assert.equal(scan.pairs.length, 0, 'skipped members never pair');
});

test('scan: output asserts nothing — no merges, no origin keys, thresholds visible', () => {
    const scan = scanForSharedText([
        { articleHash: 'h1', title: 'a', text: WIRE },
        { articleHash: 'h2', title: 'b', text: WIRE }
    ]);
    const flat = JSON.stringify(scan);
    for (const banned of ['origin_key', 'merged', 'independent', 'verdict']) {
        assert.ok(!flat.includes(banned), `output must not carry "${banned}"`);
    }
    assert.equal(scan.groups[0].members.length, 2, 'members listed, never collapsed');
    assert.equal(typeof SHINGLE_SIZE, 'number');
});
