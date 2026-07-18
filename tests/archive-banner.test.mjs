// Archive-banner decision (reader/archive-banner.js).
//
// Reported from daily use: *"Major bugs are experienced daily by me in
// the content comparisons... very misleading banners so frequent that I
// ignore them."* The banner was ~100% false, and structurally so — not
// a tuning problem.
//
// `shouldOfferArchive` compared raw HTML strings. The capture side is
// Readability innerHTML (wrapped in <div id="readability-page-1">); the
// relay side is markdownToHtml(markdown). For any multi-paragraph
// article — i.e. every real one — the two cannot match: markdownToHtml
// joins paragraphs with "\n\n" while Readability emits "</p><p>" with
// no separator, so neither the equality guard nor the containment guard
// can fire. With 'always' (the default) probing unconditionally, the
// banner fired on every published article, every visit, forever.
//
// (Precisely: containment is not unreachable in *principle* — a
// single-paragraph body IS a clean substring of its Readability
// wrapper, and then the old guard did suppress. The flood came from
// real, multi-paragraph articles. The fixture below is built from the
// actual markdownToHtml output so the claim is the true one.)
//
// The canonical 13.4 hash is the sound test and was already correct on
// both sides. These tests pin the failure mode (so nobody "fixes" the
// banner by tuning a threshold again) and the hash gate that closes it.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { shouldOfferArchive, describeMetric } =
    await import('../src/reader/archive-banner.js');

const HASH_A = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
const HASH_B = 'ffffffff11111111222222223333333344444444555555556666666677777777';

// Same two-paragraph article, two substrates. RELAY_HTML is verbatim
// ContentExtractor.markdownToHtml('...\n\n...') output; CAPTURE_HTML is
// the Readability shape of the same prose.
const CAPTURE_HTML = '<div id="readability-page-1"><div><p>The reporting rests on unnamed sources.</p><p>A second paragraph follows.</p></div></div>';
const RELAY_HTML   = '<p>The reporting rests on unnamed sources.</p>\n\n<p>A second paragraph follows.</p>';

// --- the root cause, pinned ---------------------------------------------------

test('THE BUG: same article, two substrates — the body guards cannot fire', () => {
    // The whole disease. Both guards are false for identical content,
    // so pre-fix the 'always' path offered a banner for an article
    // that had not changed at all.
    assert.notEqual(CAPTURE_HTML, RELAY_HTML, 'equality guard cannot fire');
    assert.equal(CAPTURE_HTML.includes(RELAY_HTML), false,
        'containment cannot fire: markdownToHtml separates paragraphs with \\n\\n, Readability does not');
    assert.equal(shouldOfferArchive(CAPTURE_HTML, RELAY_HTML, 'always'), true,
        'without hashes this still offers — the pre-fix behavior, preserved as a fallback');
});

test('THE FIX: equal hashes suppress the banner even though the bodies differ', () => {
    assert.equal(shouldOfferArchive(CAPTURE_HTML, RELAY_HTML, 'always', HASH_A, HASH_A), false,
        'same canonical content ⇒ nothing to offer');
});

test('the hash gate suppresses in every mode', () => {
    for (const mode of ['always', 'richer']) {
        assert.equal(shouldOfferArchive('short', 'x'.repeat(5000), mode, HASH_A, HASH_A), false,
            `${mode}: a hash match wins over the length heuristic`);
    }
});

// --- the gate only ever suppresses --------------------------------------------

test('differing hashes do NOT force a banner — the mode still decides', () => {
    // 'richer' must stay conservative: a real difference that is not
    // meaningfully fuller is still not worth interrupting for.
    assert.equal(shouldOfferArchive('x'.repeat(2000), 'y'.repeat(2100), 'richer', HASH_A, HASH_B), false,
        'richer: not 1.3× longer ⇒ no banner, hashes notwithstanding');
    assert.equal(shouldOfferArchive('x'.repeat(500), 'y'.repeat(5000), 'richer', HASH_A, HASH_B), true,
        'richer: genuinely fuller ⇒ banner');
    assert.equal(shouldOfferArchive(CAPTURE_HTML, RELAY_HTML, 'always', HASH_A, HASH_B), true,
        'always: a real difference ⇒ banner');
});

test('a missing hash degrades to the prior behavior, never to a wrong suppression', () => {
    // Older cache rows and pre-13.4 events carry no hash. Falling back
    // is honest; suppressing on a half-known comparison would hide a
    // real difference.
    assert.equal(shouldOfferArchive(CAPTURE_HTML, RELAY_HTML, 'always', HASH_A, null), true);
    assert.equal(shouldOfferArchive(CAPTURE_HTML, RELAY_HTML, 'always', null, HASH_A), true);
    assert.equal(shouldOfferArchive(CAPTURE_HTML, RELAY_HTML, 'always', null, null), true);
    assert.equal(shouldOfferArchive(CAPTURE_HTML, RELAY_HTML, 'always', '', ''), true,
        'empty strings are not a match');
});

// --- prior behavior, unchanged ------------------------------------------------

test('no archive body is never an offer', () => {
    assert.equal(shouldOfferArchive('anything', '', 'always'), false);
    assert.equal(shouldOfferArchive('anything', null, 'always'), false);
    assert.equal(shouldOfferArchive('anything', '', 'always', HASH_A, HASH_B), false);
});

test('cache path: byte-identical bodies still suppress without hashes', () => {
    // The local-cache path CAN byte-match (same substrate both sides),
    // which is why this guard was reachable there and the flood was
    // worst on the relay path.
    assert.equal(shouldOfferArchive(CAPTURE_HTML, CAPTURE_HTML, 'always'), false);
});

test('an archive strictly contained in the current body suppresses', () => {
    assert.equal(shouldOfferArchive('<p>full body here</p>', 'full body', 'always'), false,
        'the current capture is a superset — the archive can only lose information');
});

test('the single-paragraph case: containment DOES fire, which is why the flood looked erratic', () => {
    // A one-paragraph body has no "\n\n" to introduce, so the relay HTML
    // is a clean substring of its Readability wrapper and the old guard
    // suppressed correctly. Short pieces behaved; real articles did not.
    // Pinned so the distinction is not mistaken for a regression later.
    const oneParaCapture = '<div id="readability-page-1"><div><p>Only one paragraph.</p></div></div>';
    const oneParaRelay   = '<p>Only one paragraph.</p>';
    assert.equal(oneParaCapture.includes(oneParaRelay), true);
    assert.equal(shouldOfferArchive(oneParaCapture, oneParaRelay, 'always'), false);
});

test('richer keeps the 1.3×/1000-char threshold exactly', () => {
    assert.equal(shouldOfferArchive('x'.repeat(1000), 'y'.repeat(1300), 'richer'), false,
        'exactly 1.3× is not > 1.3×');
    assert.equal(shouldOfferArchive('x'.repeat(1000), 'y'.repeat(1301), 'richer'), true);
    assert.equal(shouldOfferArchive('x'.repeat(500), 'y'.repeat(1000), 'richer'), false,
        '2× longer but not >1000 chars');
});

// --- describeMetric -----------------------------------------------------------

test('describeMetric reports the size difference the user can act on', () => {
    assert.equal(describeMetric('x'.repeat(1000), 'y'.repeat(3000)), 'Archive is 3.0× longer');
    assert.equal(describeMetric('x'.repeat(1000), 'y'.repeat(1100)), 'Archive is 100 chars longer');
    assert.equal(describeMetric('x'.repeat(1000), 'y'.repeat(900)), 'Archive is 100 chars shorter');
    assert.equal(describeMetric('x'.repeat(1000), 'y'.repeat(1000)), 'Archive differs from current capture');
});
