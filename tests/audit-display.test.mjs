// Phase 13.7 — the shared display helpers: the ONE enforcement point
// for the score-display rules across reader and portal.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    auditBand, scoreChipHtml, prettyModule, auditCardChipHtml, escapeAuditHtml
} from '../src/shared/audit/display.js';

test('bands are the framework rubric — boundaries exact, no green near 50', () => {
    assert.equal(auditBand(100).key, 'exemplary');
    assert.equal(auditBand(90).key, 'exemplary');
    assert.equal(auditBand(89.9).key, 'solid');
    assert.equal(auditBand(75).key, 'solid');
    assert.equal(auditBand(74.9).key, 'acceptable');
    assert.equal(auditBand(60).key, 'acceptable');
    assert.equal(auditBand(59.9).key, 'significant');
    assert.equal(auditBand(50).key, 'significant',
        '50 is a meaningfully concerning article — never the midpoint of anything');
    assert.equal(auditBand(40).key, 'significant');
    assert.equal(auditBand(39.9).key, 'severe');
    assert.equal(auditBand(20).key, 'severe');
    assert.equal(auditBand(19.9).key, 'catastrophic');
    assert.equal(auditBand(0).key, 'catastrophic');
});

test('scoreChipHtml: the no-naked-numbers ladder', () => {
    assert.match(scoreChipHtml(null, null), /failed/);
    assert.match(scoreChipHtml(95, undefined), /needs human review · no confidence recorded/,
        'unknown confidence must not render cleaner than 0.59');
    assert.ok(!scoreChipHtml(95, undefined).includes('95'), 'no number leaks through the review chip');
    assert.match(scoreChipHtml(95, 0.59), /needs human review/);
    assert.ok(!scoreChipHtml(95, 0.59).includes('95'));
    assert.match(scoreChipHtml(95, 0.6), /95 · conf 0\.6/);
    assert.match(scoreChipHtml(0, 0.9), /0 · conf 0\.9/, 'zero is a score, not a missing value');
});

test('auditCardChipHtml: compact chip, same rules', () => {
    assert.equal(auditCardChipHtml(null), null);
    assert.equal(auditCardChipHtml({ overall_confidence: 0.9 }), null, 'no score, no chip');
    assert.match(auditCardChipHtml({ final_score: 80, overall_confidence: 0.5 }), /audit: review/);
    assert.match(auditCardChipHtml({ final_score: 80 }), /audit: review/, 'unknown confidence = review');
    const chip = auditCardChipHtml({ final_score: 80, overall_confidence: 0.8 });
    assert.match(chip, /audit 80 · 0\.8/);
    assert.match(chip, /band-solid/);
});

test('escapeAuditHtml escapes attribute-context characters too', () => {
    assert.equal(escapeAuditHtml('<img src=x onerror="a">\'&'),
        '&lt;img src=x onerror=&quot;a&quot;&gt;&#39;&amp;');
    assert.equal(prettyModule('headline_body_fidelity'), 'headline body fidelity');
});
