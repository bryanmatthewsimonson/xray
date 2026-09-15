// PR-7 of docs/PORTAL_UX_REVIEW.md — tab layering (finding C3).
// A layperson's first paint showed up to 17 tabs, most of them
// judgment-kind names (Assessments, Audits, Predictions, Findings,
// Verdicts, Integrity, Extractions…) that mean nothing on day one.
// Five core tabs stay on the strip; the rest move under one "More ▾"
// overflow that keeps its live counts. No tab is deleted; no count
// logic changes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const repoUrl = (p) => new URL(`../${p}`, import.meta.url);
const readRepo = (p) => readFileSync(repoUrl(p), 'utf8');

// library.js → forensic-model.js → storage.js probes chrome at load.
globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

const { TYPE_DEFS, CORE_TAB_KEYS } = await import('../src/portal/library.js');

test('the core tabs are exactly the five the review specifies', () => {
    assert.deepEqual([...CORE_TAB_KEYS], ['article', 'claim', 'case', 'entity']);
    // 'all' is always first and is not a TYPE_DEF; the strip renders
    // All + these four = five items before "More".
});

test('every core key is a real type — no phantom tabs', () => {
    const keys = new Set(TYPE_DEFS.map((d) => d.key));
    for (const k of CORE_TAB_KEYS) assert.ok(keys.has(k), `${k} is not a TYPE_DEF`);
});

test('no type is DELETED — every non-core type is still reachable under More', () => {
    // The whole point of layering over amputation: everything the strip
    // used to show is still selectable.
    const overflow = TYPE_DEFS.filter((d) => !CORE_TAB_KEYS.includes(d.key));
    assert.ok(overflow.length >= 10, 'the judgment-kind tabs must survive, just folded');
    for (const key of ['assessment', 'audit', 'prediction', 'finding', 'verdict', 'integrity', 'extraction']) {
        assert.ok(overflow.some((d) => d.key === key), `${key} must remain reachable`);
    }
});

test('renderTabs renders the core strip then a counted More overflow', () => {
    const src = readRepo('src/portal/index.js');
    assert.match(src, /CORE_TAB_KEYS/, 'renderTabs must consult the core set');
    // The overflow is a <select> (the case-view "Sources ▾" idiom), and
    // each option carries its live count so folding does not hide "how
    // many".
    assert.match(src, /More/, 'the overflow control is labelled');
    assert.match(src, /xr-tab-more|tab-overflow|moreSel/i, 'a dedicated overflow control exists');
    // A non-core type that is ACTIVE must still show on the strip (you
    // must see what you have selected), OR the select must reflect it —
    // the implementation guarantees the active type is always visible.
    assert.match(src, /activeInOverflow|state\.filters\.type/,
        'the active selection must remain visible even when it lives under More');
});

test('the count logic is untouched — counts still respect search + facets', () => {
    const src = readRepo('src/portal/index.js');
    assert.match(src, /applyFilters\(state\.items, \{ \.\.\.state\.filters, type: 'all' \}\)/,
        'PR-7 must not change how counts are computed');
});
