#!/usr/bin/env node
// Bundle-size budget — RESET_PLAN §7 R0 / §8 gate order (VERI-07:
// "nothing stops the next 400 KB").
//
// Every bundle the exported esbuild `configs` build has a byte ceiling
// in scripts/bundle-budget.json, and so does their sum. Red when a
// bundle or the total exceeds its ceiling, when a built bundle has no
// budget, or when a budget names a bundle nothing builds.
//
// Headroom (JOURNAL 2026-09-25): +5% per bundle over the 2026-09-25
// size, +3% on the total. Over the month before (9c1ddc1, 2026-08-25,
// rebuilt with today's node_modules) the fastest-growing bundle grew
// 2.5% (background) and the total 0.8%, so a legitimate
// bump is needed every couple of months at that pace — while one
// accidental inclusion (a dependency pulled into the wrong bundle, a
// big literal) of more than ~5% is red on the PR that does it.
// Unlike the ESLint ratchet, a ceiling MAY be raised — in the PR that
// needs it, with the reason in the PR body.
//
// Usage: npm run build && node scripts/check-bundle-budget.mjs   (npm run check:budget)

import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const BUDGET_PATH = join(ROOT, 'scripts', 'bundle-budget.json');

const kb = (n) => `${(n / 1024).toFixed(1)} KiB`;

/**
 * @param {{sizes: Object<string, number>, budget: {bundles: Object<string, {ceiling: number}>, total: {ceiling: number}}}} a
 *        sizes: every built bundle → bytes
 * @returns {{errors: string[], rows: Array<{bundle: string, size: number, ceiling: number}>, total: number}}
 */
export function checkBudget({ sizes, budget }) {
    const errors = [];
    const rows = [];
    const budgeted = budget.bundles || {};
    let total = 0;
    for (const bundle of Object.keys(sizes).sort()) {
        const size = sizes[bundle];
        total += size;
        const entry = budgeted[bundle];
        if (!entry || !Number.isFinite(entry.ceiling)) {
            errors.push(`${bundle}: ${size} bytes (${kb(size)}) has no budget — add it to scripts/bundle-budget.json`);
            continue;
        }
        rows.push({ bundle, size, ceiling: entry.ceiling });
        if (size > entry.ceiling) {
            errors.push(`${bundle}: ${size} bytes (${kb(size)}) exceeds its ceiling ${entry.ceiling} (${kb(entry.ceiling)}) by ${size - entry.ceiling} bytes`);
        }
    }
    for (const bundle of Object.keys(budgeted).sort()) {
        if (!(bundle in sizes)) errors.push(`${bundle}: budgeted, but esbuild.config.mjs builds no such bundle — delete the entry`);
    }
    const cap = budget.total && budget.total.ceiling;
    if (!Number.isFinite(cap)) errors.push('scripts/bundle-budget.json has no total ceiling');
    else if (total > cap) errors.push(`total of all bundles: ${total} bytes (${kb(total)}) exceeds the total ceiling ${cap} (${kb(cap)}) by ${total - cap} bytes`);
    return { errors, rows, total };
}

async function main() {
    const { configs } = await import(pathToFileURL(join(ROOT, 'esbuild.config.mjs')).href);
    const bundles = configs.map((c) => relative(ROOT, c.outfile).split(sep).join('/'));
    const missing = bundles.filter((b) => !existsSync(join(ROOT, b)));
    if (missing.length) {
        console.error(`bundle budget: not built — run \`npm run build\` first. Missing: ${missing.join(', ')}`);
        return 1;
    }
    const sizes = Object.fromEntries(bundles.map((b) => [b, statSync(join(ROOT, b)).size]));
    const budget = JSON.parse(readFileSync(BUDGET_PATH, 'utf8'));
    const { errors, rows, total } = checkBudget({ sizes, budget });
    for (const r of rows) {
        const pct = ((r.ceiling - r.size) / r.size * 100).toFixed(1);
        const note = r.size > r.ceiling ? 'OVER' : `+${pct}% left`;
        console.log(`  ${r.bundle.padEnd(32)} ${kb(r.size).padStart(12)} / ${kb(r.ceiling).padStart(12)}  (${note})`);
    }
    console.log(`  ${'total'.padEnd(32)} ${kb(total).padStart(12)} / ${kb(budget.total.ceiling).padStart(12)}`);
    for (const e of errors) console.error(`bundle budget: ${e}`);
    if (errors.length) return 1;
    console.log('bundle budget: OK');
    return 0;
}

const isMain = (() => {
    try { return realpathSync(resolve(process.argv[1] || '')) === realpathSync(fileURLToPath(import.meta.url)); }
    catch (_) { return false; }
})();
if (isMain) {
    main().then((code) => { process.exitCode = code; }, (err) => {
        console.error('bundle budget check failed:', err);
        process.exitCode = 1;
    });
}
