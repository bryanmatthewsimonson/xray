// Quote-grounding tests — Phase 14.5 provenance hardening.
//
// The absolute-provenance contract: every non-missing result's `exact`
// is literally articleText.slice(start, end) — the article's own bytes
// — no matter how the model's quote drifted. A quote that cannot be
// located above the fuzzy threshold is a hard 'missing', never a
// fabricated anchor.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    createGroundingIndex, groundQuote, normalizeWithMap, isGroundingIndex,
    MIN_FUZZY_TOKENS, FUZZY_MIN_SCORE
} from '../src/shared/quote-grounding.js';

// An article with the typographic hazards Opus normalizes away:
// curly quotes, an em-dash, an ellipsis, a non-breaking space, and a
// deliberate typo ("recieved") a model loves to fix.
const ARTICLE = [
    'Mayor Elena Vargas spoke at the “Downtown Renewal” hearing on Tuesday.',
    'She said: ‘We never recieved the audit — not in March, not ever…’ and sat down.',
    'The city council voted 7–2 to reopen the inquiry.',
    'Critics called the vote “a fig leaf for a broken process.”',
    'The mayor’s office declined to comment on the vote.'
].join('\n');

function assertGrounded(result, article = ARTICLE) {
    assert.notEqual(result.status, 'missing');
    assert.equal(result.exact, article.slice(result.start, result.end),
        'exact must be the article\'s own bytes');
    assert.ok(result.end > result.start);
}

// ---------------------------------------------------------------------
// Tier 1 — exact
// ---------------------------------------------------------------------

test('exact: a verbatim copy grounds with score 1', () => {
    const r = groundQuote('voted 7–2 to reopen the inquiry', ARTICLE);
    assert.equal(r.status, 'exact');
    assert.equal(r.score, 1);
    assertGrounded(r);
});

test('exact: leading/trailing whitespace on the quote is tolerated', () => {
    const r = groundQuote('  Critics called the vote “a fig leaf for a broken process.”\n', ARTICLE);
    assert.equal(r.status, 'exact');
    assertGrounded(r);
});

// ---------------------------------------------------------------------
// Tier 2 — normalized (typographic drift)
// ---------------------------------------------------------------------

test('normalized: straight quotes match curly quotes, span is raw bytes', () => {
    const r = groundQuote('the "Downtown Renewal" hearing', ARTICLE);
    assert.equal(r.status, 'normalized');
    assert.equal(r.score, 1);
    assertGrounded(r);
    assert.equal(r.exact, 'the “Downtown Renewal” hearing');
});

test('normalized: hyphen matches en-dash', () => {
    const r = groundQuote('voted 7-2 to reopen', ARTICLE);
    assert.equal(r.status, 'normalized');
    assertGrounded(r);
    assert.ok(r.exact.includes('7–2'));
});

test('normalized: em-dash and ellipsis drift', () => {
    const r = groundQuote("'We never recieved the audit - not in March, not ever...'", ARTICLE);
    assert.equal(r.status, 'normalized');
    assertGrounded(r);
    assert.ok(r.exact.startsWith('‘We never'));
    assert.ok(r.exact.endsWith('ever…’'));
});

test('normalized: NBSP and collapsed whitespace', () => {
    const r = groundQuote('The city council voted', ARTICLE);
    assert.equal(r.status, 'normalized');
    assertGrounded(r);
    assert.ok(r.exact.includes('city council'));
});

test('normalized: case drift', () => {
    const r = groundQuote('mayor elena vargas SPOKE at the “Downtown Renewal” hearing', ARTICLE);
    assert.equal(r.status, 'normalized');
    assertGrounded(r);
});

test('normalized: a quote spanning a newline matches with a single space', () => {
    const r = groundQuote('and sat down. The city', ARTICLE);
    assert.equal(r.status, 'normalized');
    assertGrounded(r);
});

// ---------------------------------------------------------------------
// Tier 3 — fuzzy (wording drift), guarded
// ---------------------------------------------------------------------

test('fuzzy: the model "fixing" a typo still grounds to the raw span', () => {
    const r = groundQuote('We never received the audit — not in March, not ever', ARTICLE);
    assert.equal(r.status, 'fuzzy');
    assert.ok(r.score >= FUZZY_MIN_SCORE);
    assertGrounded(r);
    assert.ok(r.exact.includes('recieved'), 'span must carry the article\'s own typo');
});

test('fuzzy: a dropped word still grounds', () => {
    // Article: "Mayor Elena Vargas spoke at the “Downtown Renewal” hearing on Tuesday."
    const r = groundQuote('Mayor Elena Vargas spoke at the hearing on Tuesday', ARTICLE);
    assert.equal(r.status, 'fuzzy');
    assertGrounded(r);
});

test('fuzzy: a paraphrase does NOT ground', () => {
    const r = groundQuote('The mayor claimed the audit paperwork had gone missing for months', ARTICLE);
    assert.equal(r.status, 'missing');
});

test('fuzzy: short quotes never fuzzy-match', () => {
    // 3 tokens < MIN_FUZZY_TOKENS; would otherwise be findable-ish.
    assert.ok(MIN_FUZZY_TOKENS > 3);
    const r = groundQuote('mayor spoke Tuesday', ARTICLE);
    assert.equal(r.status, 'missing');
});

test('fuzzy: score reflects drift and stays ≤ 1', () => {
    const r = groundQuote('We never received the audit — not in March, not ever', ARTICLE);
    assert.ok(r.score > 0 && r.score <= 1);
});

// ---------------------------------------------------------------------
// Hard misses
// ---------------------------------------------------------------------

test('missing: fabricated text, empty quote, empty article', () => {
    assert.equal(groundQuote('entirely invented sentence about penguins on the moon', ARTICLE).status, 'missing');
    assert.equal(groundQuote('', ARTICLE).status, 'missing');
    assert.equal(groundQuote('   ', ARTICLE).status, 'missing');
    assert.equal(groundQuote('anything at all in this quote', '').status, 'missing');
});

test('missing result carries no span', () => {
    const r = groundQuote('no such text anywhere in the article', ARTICLE);
    assert.equal(r.start, -1);
    assert.equal(r.end, -1);
    assert.equal(r.exact, '');
});

// ---------------------------------------------------------------------
// The index: memoization + duck typing
// ---------------------------------------------------------------------

test('createGroundingIndex memoizes and exposes the raw text', () => {
    const index = createGroundingIndex(ARTICLE);
    assert.equal(index.text, ARTICLE);
    const a = index.ground('voted 7–2 to reopen the inquiry');
    const b = index.ground('voted 7–2 to reopen the inquiry');
    assert.equal(a, b, 'same quote → same (memoized) result object');
    assert.ok(isGroundingIndex(index));
    assert.ok(!isGroundingIndex(ARTICLE));
    assert.ok(!isGroundingIndex(null));
});

// ---------------------------------------------------------------------
// normalizeWithMap invariants
// ---------------------------------------------------------------------

test('normalizeWithMap: map arrays parallel the normalized string', () => {
    const { norm, rawStart, rawEnd } = normalizeWithMap('a  “b”­—c…');
    assert.equal(rawStart.length, norm.length);
    assert.equal(rawEnd.length, norm.length);
    assert.equal(norm, 'a "b"-c...');
});

test('normalizeWithMap: soft hyphen and zero-width chars vanish', () => {
    const { norm } = normalizeWithMap('re­port zero​width');
    assert.equal(norm, 'report zerowidth');
});

test('normalizeWithMap: leading/trailing whitespace dropped, runs collapsed', () => {
    const { norm } = normalizeWithMap('  a \n\t b  ');
    assert.equal(norm, 'a b');
});

test('normalizeWithMap: astral chars keep the map aligned (per code unit)', () => {
    // Each emoji is 2 UTF-16 units; the map must carry 2 entries or
    // every offset after it shifts (regression: spans came back
    // off-by-N after emoji/CJK-ext characters).
    const art = 'Intro 🎉👍 café naïve… Then the mayor said “we never lied” at the hearing. End.';
    const { norm, rawStart } = normalizeWithMap(art);
    assert.equal(rawStart.length, norm.length);
    const r = groundQuote('the mayor said "we never lied" at the hearing', art);
    assert.equal(r.status, 'normalized');
    assert.equal(r.exact, 'the mayor said “we never lied” at the hearing');
    assert.equal(art.slice(r.start, r.end), r.exact);
    // Boundary drift: curly quotes as the first AND last characters.
    const r2 = groundQuote('"we never lied"', art);
    assert.equal(r2.exact, '“we never lied”');
});

// ---------------------------------------------------------------------
// Multi-occurrence + scale smoke
// ---------------------------------------------------------------------

test('multi-occurrence: first occurrence wins, span is still real bytes', () => {
    const article = 'The vote failed. Later, the vote failed again.';
    const r = groundQuote('vote failed', article);
    assert.equal(r.status, 'exact');
    assertGrounded(r, article);
    assert.equal(r.start, article.indexOf('vote failed'));
});

test('scale smoke: a long article grounds quickly and correctly', () => {
    const filler = 'Paragraph about something unrelated to the quote, padded with words. ';
    const needle = 'the auditor’s report was “never delivered” to the council — allegedly…';
    const article = filler.repeat(400) + needle + filler.repeat(400);
    const index = createGroundingIndex(article);
    const r = index.ground('the auditor\'s report was "never delivered" to the council - allegedly...');
    assert.equal(r.status, 'normalized');
    assert.equal(r.exact, needle);
    // A fuzzy pass over the same long article stays sane too.
    const f = index.ground('the auditor’s report was never delivered to the council allegedly today');
    assert.notEqual(f.status, 'exact');
});
