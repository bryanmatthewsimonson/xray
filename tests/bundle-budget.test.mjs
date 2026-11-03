// Bundle-size budget — pins scripts/check-bundle-budget.mjs and
// scripts/bundle-budget.json against RESET_PLAN §7 R0 ("a bundle-size
// budget"; VERI-07 "nothing stops the next 400 KB"). The comparison on
// synthetic sizes (over a bundle ceiling, over the total, an unbudgeted
// bundle, a budget for a bundle nothing builds), and the checked-in
// budget against the exported esbuild `configs` — every built bundle
// budgeted, nothing else. The real sizes are checked in CI after the
// build (`npm run check:budget`), not here: `npm test` does not build.
//
// Provenance: INTERPRETATION (2026-09-25) — an agent artifact under
// RESET_PLAN R0; the maintainer has not ruled on it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { relative, resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configs } from '../esbuild.config.mjs';
import { checkBudget, BUDGET_PATH } from '../scripts/check-bundle-budget.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUDGET = { bundles: { 'dist/a.bundle.js': { ceiling: 100 }, 'dist/b.bundle.js': { ceiling: 50 } }, total: { ceiling: 140 } };

test('checkBudget: at or under every ceiling is green', () => {
    const r = checkBudget({ sizes: { 'dist/a.bundle.js': 100, 'dist/b.bundle.js': 40 }, budget: BUDGET });
    assert.deepEqual(r.errors, []);
    assert.equal(r.total, 140);
});

test('checkBudget: one byte over a bundle ceiling is red, naming the bundle, its size and its ceiling', () => {
    const r = checkBudget({ sizes: { 'dist/a.bundle.js': 101, 'dist/b.bundle.js': 10 }, budget: BUDGET });
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0], /^dist\/a\.bundle\.js: 101 bytes \(0\.1 KiB\) exceeds its ceiling 100 \(0\.1 KiB\) by 1 bytes$/);
});

test('checkBudget: the total is its own ceiling — every bundle under, the sum over, is red', () => {
    const r = checkBudget({ sizes: { 'dist/a.bundle.js': 95, 'dist/b.bundle.js': 50 }, budget: BUDGET });
    assert.deepEqual(r.errors, ['total of all bundles: 145 bytes (0.1 KiB) exceeds the total ceiling 140 (0.1 KiB) by 5 bytes']);
});

test('checkBudget: a built bundle with no budget is red; a budget for a bundle nothing builds is red', () => {
    const r = checkBudget({ sizes: { 'dist/a.bundle.js': 1, 'dist/new.bundle.js': 1 }, budget: BUDGET });
    assert.ok(r.errors.some((e) => /^dist\/new\.bundle\.js: .* has no budget/.test(e)), r.errors.join('\n'));
    assert.ok(r.errors.some((e) => /^dist\/b\.bundle\.js: budgeted, but .* builds no such bundle/.test(e)), r.errors.join('\n'));
});

test('checkBudget: a budget file without a total ceiling is red', () => {
    const r = checkBudget({ sizes: { 'dist/a.bundle.js': 1, 'dist/b.bundle.js': 1 }, budget: { bundles: BUDGET.bundles } });
    assert.deepEqual(r.errors, ['scripts/bundle-budget.json has no total ceiling']);
});

test('the checked-in budget covers exactly the bundles esbuild.config.mjs builds, with sane ceilings', () => {
    const budget = JSON.parse(readFileSync(BUDGET_PATH, 'utf8'));
    const built = configs.map((c) => relative(ROOT, c.outfile).split(sep).join('/')).sort();
    assert.ok(built.length >= 2, 'sanity: the exported configs are seen');
    assert.deepEqual(Object.keys(budget.bundles).sort(), built);
    let measured = 0;
    for (const [b, { measured: m, ceiling }] of Object.entries(budget.bundles)) {
        assert.ok(Number.isInteger(ceiling) && Number.isInteger(m) && m > 0, `${b}: integer byte counts`);
        assert.ok(ceiling >= m, `${b}: a ceiling below its own measurement`);
        measured += m;
    }
    assert.equal(budget.total.measured, measured, 'total.measured is the sum of the per-bundle measurements');
    assert.ok(budget.total.ceiling >= measured, 'the total ceiling is below the measured total');
    assert.ok(budget.total.ceiling <= Object.values(budget.bundles).reduce((a, b) => a + b.ceiling, 0),
        'a total ceiling above the sum of the bundle ceilings could never fire');
});
