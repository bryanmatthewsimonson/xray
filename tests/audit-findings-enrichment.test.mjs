// R3 tests — enriched claim↔finding join (founding-transcript
// integration; JOURNAL 2026-08-02). Pins: collectEvidenceFindings
// preserves finding context (kind = the findings array, severity when
// present, module 06's severity_if_undefined spelling); the join rows
// now carry {module, quote, kind, severity}; contested-term
// first_use_quote spans join (previously invisible); and the wire-side
// collectEvidenceQuotes index is byte-identical to before — the
// enrichment is read-side only.

import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

const { collectEvidenceFindings, collectEvidenceQuotes } = await import('../src/shared/audit/assemble.js');
const { linkRunFindingsToClaims } = await import('../src/shared/audit/findings-claims.js');

const TEXT = 'The mayor said the budget tripled overnight. '
    + 'Critics call the plan reckless extremism. '
    + 'Officials explained their reasoning at length.';

test('R3 collector: kind + severity preserved; a/b quotes; severity_if_undefined', () => {
    const rows = collectEvidenceFindings({
        module: 'asymmetric_language', version: '1.0',
        asymmetry_findings: [{
            dimension: 'sourcing_verbs', severity: 'high',
            evidence_quote_a: 'Critics call the plan reckless extremism.',
            evidence_quote_b: 'Officials explained their reasoning at length.'
        }],
        contested_terms: [{
            term: 'extremism', severity_if_undefined: 'medium',
            first_use_quote: 'Critics call the plan reckless extremism.'
        }]
    });
    const a = rows.find((r) => r.quote.startsWith('Critics') && r.kind === 'asymmetry_findings');
    const b = rows.find((r) => r.quote.startsWith('Officials'));
    const t = rows.find((r) => r.kind === 'contested_terms');
    assert.ok(a && a.severity === 'high');
    assert.ok(b && b.kind === 'asymmetry_findings' && b.severity === 'high');
    assert.ok(t && t.severity === 'medium', 'severity_if_undefined recognized');
});

test('R3 collector: wire-side collectEvidenceQuotes is unchanged (no first_use_quote)', () => {
    const findings = {
        contested_terms: [{ term: 'x', first_use_quote: 'a located span', severity_if_undefined: 'low' }],
        weasel_quantifiers: [{ term: 'many', evidence_quote: 'many believe', severity: 'low' }]
    };
    const flat = collectEvidenceQuotes(findings);
    assert.deepEqual(flat, [{ quote: 'many believe' }],
        'the 30056 evidence_quotes index shape and coverage stay byte-identical');
    const rich = collectEvidenceFindings(findings);
    assert.equal(rich.length, 2, 'read-side walk sees the contested term too');
});

test('R3 join: rows carry module/kind/severity; contested terms now join', () => {
    const byClaim = linkRunFindingsToClaims({
        moduleResults: [{
            module: 'definitional_precision',
            findings: {
                contested_terms: [{
                    term: 'extremism', severity_if_undefined: 'high',
                    first_use_quote: 'Critics call the plan reckless extremism.'
                }]
            }
        }],
        memberText: TEXT,
        claims: [{ id: 'c1', quote: 'Critics call the plan reckless extremism.' }]
    });
    assert.ok(byClaim.c1 && byClaim.c1.length === 1);
    assert.deepEqual(byClaim.c1[0], {
        module: 'definitional_precision',
        quote: 'Critics call the plan reckless extremism.',
        kind: 'contested_terms',
        severity: 'high'
    });
});
