// ESLint ratchet — pins scripts/eslint-ratchet.mjs and eslint.config.mjs
// against RESET_PLAN §7 R0 ("ESLint minimal (no-undef, no-unused-vars …)";
// VERI-07). Two halves:
//   1. the comparison logic on synthetic counts — a breach and a stale
//      entry are BOTH red (the structure-guards "list cannot rot" rule),
//      a parse error can never be baselined, --update only lowers;
//   2. the config's per-context globals, proven with ESLint's own
//      lintText on probe snippets — the undefined-identifier class
//      (audit E17: a ReferenceError to a deleted identifier passed CI)
//      is caught, and the extension/worker/MAIN-world/node contexts get
//      the globals they really have.
// The real-tree comparison runs in CI as `npm run lint:js`, not here.
//
// Provenance: INTERPRETATION (2026-09-25) — an agent artifact under
// RESET_PLAN R0; the maintainer has not ruled on it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import {
    countViolations, compareToBaseline, sortCounts, readBaseline, formatReport, RULES, BASELINE_PATH
} from '../scripts/eslint-ratchet.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const msg = (ruleId, line = 1, extra = {}) => ({ ruleId, line, column: 1, message: `${ruleId} probe`, ...extra });

test('sanity: the checked-in baseline parses and names only the two rules', () => {
    const files = readBaseline();
    assert.ok(Object.keys(files).length > 0, 'the baseline is empty — the tree has violations today');
    for (const [file, rules] of Object.entries(files)) {
        for (const [rule, n] of Object.entries(rules)) {
            assert.ok(RULES.includes(rule), `${file}: unknown rule ${rule}`);
            assert.ok(Number.isInteger(n) && n > 0, `${file} ${rule}: counts are positive integers (zero entries are deleted)`);
        }
    }
    const raw = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
    assert.match(raw['//'], /SHRINK-ONLY/);
});

test('countViolations: per-file, per-rule counts with repo-relative posix paths', () => {
    const results = [
        { filePath: join(ROOT, 'src/a.js'), messages: [msg('no-undef'), msg('no-undef', 2), msg('no-unused-vars')] },
        { filePath: join(ROOT, 'tests/b.test.mjs'), messages: [] }
    ];
    const { counts, fatal } = countViolations(results, ROOT);
    assert.deepEqual(counts, { 'src/a.js': { 'no-undef': 2, 'no-unused-vars': 1 } });
    assert.deepEqual(fatal, []);
});

test('countViolations: a parse error or a rule outside the two is fatal — never a count', () => {
    const results = [{
        filePath: join(ROOT, 'src/broken.js'),
        messages: [msg(null, 3, { fatal: true, message: 'Parsing error: Unexpected token' }), msg('no-console', 4)]
    }];
    const { counts, fatal } = countViolations(results, ROOT);
    assert.deepEqual(counts, {});
    assert.equal(fatal.length, 2);
    assert.match(fatal[0], /^src\/broken\.js:3:1 Parsing error/);
    assert.match(fatal[1], /unexpected rule no-console/);
});

test('compareToBaseline: equal is green', () => {
    const base = { 'src/a.js': { 'no-undef': 1 } };
    assert.deepEqual(compareToBaseline(base, { 'src/a.js': { 'no-undef': 1 } }), { breaches: [], stale: [] });
});

test('compareToBaseline: a count above its baseline is a breach', () => {
    const { breaches, stale } = compareToBaseline({ 'src/a.js': { 'no-undef': 1 } }, { 'src/a.js': { 'no-undef': 2 } });
    assert.deepEqual(breaches, [{ file: 'src/a.js', rule: 'no-undef', count: 2, baseline: 1 }]);
    assert.deepEqual(stale, []);
});

test('compareToBaseline: an unlisted file with any violation is a breach against zero', () => {
    const { breaches } = compareToBaseline({}, { 'src/new.js': { 'no-unused-vars': 1 } });
    assert.deepEqual(breaches, [{ file: 'src/new.js', rule: 'no-unused-vars', count: 1, baseline: 0 }]);
});

test('compareToBaseline: a new rule on a listed file is a breach even when the other rule dropped', () => {
    const { breaches, stale } = compareToBaseline(
        { 'src/a.js': { 'no-unused-vars': 2 } },
        { 'src/a.js': { 'no-undef': 1, 'no-unused-vars': 1 } }
    );
    assert.deepEqual(breaches.map((b) => b.rule), ['no-undef']);
    assert.deepEqual(stale.map((s) => s.rule), ['no-unused-vars']);
});

test('compareToBaseline: a count below its baseline is STALE — as red as a breach', () => {
    const { breaches, stale } = compareToBaseline({ 'src/a.js': { 'no-undef': 3 } }, { 'src/a.js': { 'no-undef': 1 } });
    assert.deepEqual(breaches, []);
    assert.deepEqual(stale, [{ file: 'src/a.js', rule: 'no-undef', count: 1, baseline: 3 }]);
});

test('compareToBaseline: a baselined file that is now clean (or deleted) is stale', () => {
    const { stale } = compareToBaseline({ 'src/gone.js': { 'no-unused-vars': 1 } }, {});
    assert.deepEqual(stale, [{ file: 'src/gone.js', rule: 'no-unused-vars', count: 0, baseline: 1 }]);
});

test('sortCounts drops zero entries and orders keys — --update writes a stable diff', () => {
    const out = sortCounts({ 'z.js': { 'no-unused-vars': 1, 'no-undef': 2 }, 'a.js': { 'no-undef': 0 } });
    assert.deepEqual(Object.keys(out), ['z.js']);
    assert.deepEqual(Object.keys(out['z.js']), ['no-undef', 'no-unused-vars']);
});

test('formatReport names the file, rule, count and the remedy', () => {
    const text = formatReport({
        counts: { 'src/a.js': { 'no-undef': 2 } }, fatal: [],
        breaches: [{ file: 'src/a.js', rule: 'no-undef', count: 2, baseline: 1 }],
        stale: [{ file: 'src/b.js', rule: 'no-unused-vars', count: 0, baseline: 1 }]
    });
    assert.match(text, /BREACH src\/a\.js no-undef: 2 > baseline 1 .*never raise/);
    assert.match(text, /STALE {2}src\/b\.js no-unused-vars: 0 < baseline 1 .*--update/);
});

// ---------------------------------------------------------------- config

const eslint = new ESLint({ cwd: ROOT });
async function rulesHit(relPath, code) {
    const [r] = await eslint.lintText(code, { filePath: join(ROOT, relPath) });
    return r.messages.map((m) => `${m.ruleId}:${m.message.match(/'([^']+)'/)?.[1] || ''}`);
}

test('config: an undefined identifier in extension code is no-undef (the E17 class)', async () => {
    assert.deepEqual(await rulesHit('src/portal/__probe__.js', 'export function f() { return bandText; }\n'),
        ['no-undef:bandText']);
});

test('config: extension code sees browser + WebExtension globals', async () => {
    assert.deepEqual(await rulesHit('src/reader/__probe__.js',
        'export const a = [document.title, window.name, chrome.runtime.id, browser.runtime.id, __XRAY_BUILD_INFO__];\n'), []);
});

test('config: the service worker has no window/document, but has self + chrome', async () => {
    assert.deepEqual(await rulesHit('src/background/__probe__.js',
        'export const a = [self.registration, chrome.runtime.id, document.title];\n'), ['no-undef:document']);
});

test('config: MAIN-world page scripts get no extension API', async () => {
    assert.deepEqual(await rulesHit('src/page/__probe__.js',
        '(function () { window.postMessage(chrome.runtime.id, "*"); })();\n'), ['no-undef:chrome']);
});

test('config: node-side files see node globals and not the DOM', async () => {
    assert.deepEqual(await rulesHit('scripts/__probe__.mjs',
        'export const a = [process.argv, Buffer.from(""), document.title];\n'), ['no-undef:document']);
});

test('config: unused-vars options — dead bindings are caught, house idioms are not', async () => {
    const code = [
        "import { used, unusedImport } from './x.js';",
        'export function f(a, b) { try { return used(b); } catch (e) { return null; } }',
        'export function g(_ignored) { const { drop, ...rest } = {}; return rest; }',
        'const deadLocal = 1;',
        ''
    ].join('\n');
    assert.deepEqual(await rulesHit('src/shared/__probe__.js', code),
        ['no-unused-vars:unusedImport', 'no-unused-vars:deadLocal']);
});

test('config: only the two rules exist — style is not linted', async () => {
    const cfg = await eslint.calculateConfigForFile(join(ROOT, 'src/shared/__probe__.js'));
    const on = Object.entries(cfg.rules).filter(([, v]) => (Array.isArray(v) ? v[0] : v) !== 0 && (Array.isArray(v) ? v[0] : v) !== 'off');
    assert.deepEqual(on.map(([k]) => k).sort(), [...RULES].sort());
});
