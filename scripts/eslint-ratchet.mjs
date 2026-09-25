#!/usr/bin/env node
// ESLint ratchet — RESET_PLAN §7 R0 ("ESLint minimal"; VERI-07).
//
// Runs eslint.config.mjs (no-undef + no-unused-vars, nothing else) over
// the tree and compares per-file, per-rule counts to the checked-in
// baseline in scripts/eslint-baseline.json. The baseline is SHRINK-ONLY,
// the structure-guards convention (tests/structure-guards.test.mjs):
//
//   - a file above its baseline, or an unlisted file with any violation,
//     is RED (a new breach);
//   - a file BELOW its baseline is ALSO red (a stale entry — the count
//     dropped, so lower the baseline in the same PR; the list may not
//     rot into slack a later breach could hide in);
//   - a parse error is always red (it cannot be baselined).
//
// `--update` rewrites the baseline to today's counts, and refuses when
// any count went UP — it can only lower. Never hand-raise an entry:
// fix the code instead. Every `no-undef` entry is a potential
// ReferenceError; each one in the first baseline was classified when
// it landed (JOURNAL 2026-09-25).
//
// Usage:
//   npm run lint:js                  # check (CI runs this)
//   npm run lint:js -- --update      # lower the baseline after a fix

import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const BASELINE_PATH = resolve(ROOT, 'scripts', 'eslint-baseline.json');
export const RULES = Object.freeze(['no-undef', 'no-unused-vars']);
const NOTE = 'SHRINK-ONLY per-file, per-rule ESLint counts (scripts/eslint-ratchet.mjs). '
    + 'Never raise an entry; after a fix run `npm run lint:js -- --update` to lower it.';

/**
 * ESLint results → per-file, per-rule counts plus the problems that
 * can never be baselined (parse errors, rules outside RULES).
 * @param {Array<{filePath: string, messages: Array}>} results
 * @param {string} root
 * @returns {{counts: Object<string, Object<string, number>>, fatal: string[]}}
 */
export function countViolations(results, root) {
    const counts = {};
    const fatal = [];
    for (const r of results) {
        const file = relative(root, r.filePath).split(sep).join('/');
        for (const m of r.messages) {
            const where = `${file}:${m.line || 0}:${m.column || 0}`;
            if (m.fatal || !m.ruleId) { fatal.push(`${where} ${m.message}`); continue; }
            if (!RULES.includes(m.ruleId)) { fatal.push(`${where} unexpected rule ${m.ruleId}: ${m.message}`); continue; }
            counts[file] = counts[file] || {};
            counts[file][m.ruleId] = (counts[file][m.ruleId] || 0) + 1;
        }
    }
    return { counts: sortCounts(counts), fatal };
}

/** Stable key order (files, then rules) so --update writes a reviewable diff. */
export function sortCounts(counts) {
    const out = {};
    for (const f of Object.keys(counts).sort()) {
        const rules = {};
        for (const r of Object.keys(counts[f]).sort()) if (counts[f][r] > 0) rules[r] = counts[f][r];
        if (Object.keys(rules).length) out[f] = rules;
    }
    return out;
}

/**
 * Compare today's counts to the baseline, both ways.
 * @returns {{breaches: Array, stale: Array}} each item {file, rule, count, baseline}
 */
export function compareToBaseline(baseline, counts) {
    const breaches = [];
    const stale = [];
    const files = new Set([...Object.keys(baseline), ...Object.keys(counts)]);
    for (const file of [...files].sort()) {
        const base = baseline[file] || {};
        const now = counts[file] || {};
        for (const rule of [...new Set([...Object.keys(base), ...Object.keys(now)])].sort()) {
            const b = base[rule] || 0;
            const c = now[rule] || 0;
            if (c > b) breaches.push({ file, rule, count: c, baseline: b });
            else if (c < b) stale.push({ file, rule, count: c, baseline: b });
        }
    }
    return { breaches, stale };
}

export function readBaseline(path = BASELINE_PATH) {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    const { files } = raw;
    if (!files || typeof files !== 'object') throw new Error(`${path}: no "files" object`);
    return files;
}

export function formatReport({ counts, fatal, breaches, stale }) {
    const lines = [];
    const totals = {};
    for (const rules of Object.values(counts)) for (const [r, n] of Object.entries(rules)) totals[r] = (totals[r] || 0) + n;
    lines.push(`eslint ratchet: ${RULES.map((r) => `${r} ${totals[r] || 0}`).join(', ')} across ${Object.keys(counts).length} file(s)`);
    for (const f of fatal) lines.push(`  FATAL  ${f} — a parse error or an unexpected rule cannot be baselined`);
    for (const b of breaches) {
        lines.push(`  BREACH ${b.file} ${b.rule}: ${b.count} > baseline ${b.baseline} — fix the new violation(s); never raise the baseline`);
    }
    for (const s of stale) {
        lines.push(`  STALE  ${s.file} ${s.rule}: ${s.count} < baseline ${s.baseline} — the count dropped; lower the baseline in this PR (npm run lint:js -- --update)`);
    }
    return lines.join('\n');
}

async function lintTree() {
    const { ESLint } = await import('eslint');
    const eslint = new ESLint({ cwd: ROOT });
    return eslint.lintFiles(['.']);
}

async function main(argv) {
    const update = argv.includes('--update');
    const results = await lintTree();
    const { counts, fatal } = countViolations(results, ROOT);
    const baseline = readBaseline();
    const { breaches, stale } = compareToBaseline(baseline, counts);
    console.log(formatReport({ counts, fatal, breaches, stale }));
    if (fatal.length || breaches.length) {
        if (update) console.error('eslint ratchet: --update refused — it only ever LOWERS the baseline');
        return 1;
    }
    if (update) {
        writeFileSync(BASELINE_PATH, JSON.stringify({ '//': NOTE, files: counts }, null, 2) + '\n');
        console.log(`eslint ratchet: baseline rewritten (${stale.length} entr${stale.length === 1 ? 'y' : 'ies'} lowered)`);
        return 0;
    }
    if (stale.length) return 1;
    console.log('eslint ratchet: OK — every file at its baseline');
    return 0;
}

const isMain = (() => {
    try { return realpathSync(resolve(process.argv[1] || '')) === realpathSync(fileURLToPath(import.meta.url)); }
    catch (_) { return false; }
})();
if (isMain) {
    main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (err) => {
        console.error('eslint ratchet failed:', err);
        process.exitCode = 1;
    });
}
