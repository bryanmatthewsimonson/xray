// The forensic review's Accept must not destroy the review — field-found
// 2026-08-25 (maintainer, mid-casework): "hitting Accept on any of the
// suggested items Accepts only that one item, then scrolls you to the
// bottom of the page and selects a different entity before you can
// interact with any other of the findings, resulting in wasted LLM
// calls."
//
// Cause: the Accept handler called callbacks.onReloadCase() PER ITEM,
// re-rendering the whole dashboard — which threw away the in-memory
// proposal list (paid for by the Analyze call) and reset the subject
// picker. The house pattern is synthesis-review.js: accept IN PLACE
// (the row becomes a ✓ line), reload never — the paid list survives
// until the human is done with it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const strip = (x) => x.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const SRC = strip(readFileSync(new URL('../src/portal/forensic-corpus-block.js', import.meta.url), 'utf8'));

test('Accept persists and marks IN PLACE — it never reloads the case view', () => {
    // Isolate renderReview's accept handler region.
    const i = SRC.indexOf('function renderReview');
    assert.ok(i > 0);
    const review = SRC.slice(i);
    assert.ok(!/onReloadCase/.test(review),
        'a per-item reload destroys the remaining paid proposals and resets the subject picker');
    assert.match(review, /ForensicModel\.create/, 'accept must still persist the finding');
    assert.match(review, /✓/, 'the accepted row must be marked in place, the synthesis-review pattern');
});

test('the review keeps a running note instead of a reload', () => {
    const i = SRC.indexOf('function renderReview');
    const review = SRC.slice(i);
    assert.match(review, /Refresh/, 'the human is told how to fold accepts into the dossier when THEY are done');
});
