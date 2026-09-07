// The browser smoke runner — `npm run smoke`.
//
//   node tools/smoke/run.mjs [--only=pages,ma6] [--advisory=ma6]
//
// Runs each scenario in its own process with a hard timeout, so a hung
// browser cannot eat the CI budget, and writes tools/smoke/out/summary.json
// (XR_SMOKE_OUT overrides the directory). The exit code is 1 when any
// REQUIRED scenario fails or times out; scenarios named in --advisory
// are run and reported but never fail the run. Which scenarios are
// advisory is decided by the caller (the CI workflow), never by a date
// in this file.
//
// Budget: the whole run must fit in BUDGET_MS wall clock; exceeding it
// is itself a finding, because a slow gate is a gate people stop
// running.

import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertBuilt, ensureOut, SMOKE_DIR } from './lib/browser.mjs';

const SCENARIOS = [
    { id: 'pages', file: 'pages.mjs',    timeoutMs: 120_000 },
    { id: 'ma6',   file: 'ma6-walk.mjs', timeoutMs: 240_000 }
];
const BUDGET_MS = 300_000;

const argv = process.argv.slice(2);
const flag = (name) => {
    const a = argv.find((x) => x.startsWith(`--${name}=`));
    return a ? a.slice(name.length + 3).split(',').map((s) => s.trim()).filter(Boolean) : null;
};
const only = flag('only');
const advisory = new Set(flag('advisory') || []);

const unknown = [...(only || []), ...advisory].filter((id) => !SCENARIOS.some((s) => s.id === id));
if (unknown.length) {
    console.error(`unknown scenario(s): ${unknown.join(', ')} — known: ${SCENARIOS.map((s) => s.id).join(', ')}`);
    process.exit(2);
}

try {
    assertBuilt();
} catch (e) {
    console.error(e.message);
    process.exit(2);
}

const out = ensureOut();
const t0 = Date.now();
const results = [];

for (const s of SCENARIOS) {
    if (only && !only.includes(s.id)) continue;
    const isAdvisory = advisory.has(s.id);
    console.log(`\n=== smoke: ${s.id}${isAdvisory ? ' (advisory)' : ''} ===`);
    const t = Date.now();
    const r = spawnSync(process.execPath, [join(SMOKE_DIR, s.file)], {
        stdio: 'inherit', timeout: s.timeoutMs, env: { ...process.env, XR_SMOKE_OUT: out }
    });
    const ms = Date.now() - t;
    const timedOut = r.error && r.error.code === 'ETIMEDOUT';
    const status = timedOut ? 'timeout' : (r.status === 0 ? 'pass' : 'fail');
    results.push({ id: s.id, status, ms, advisory: isAdvisory, exitCode: r.status });
    console.log(`=== ${s.id}: ${status.toUpperCase()} in ${ms} ms${isAdvisory ? ' (advisory — does not gate)' : ''} ===`);
}

const total = Date.now() - t0;
const overBudget = total > BUDGET_MS;
const gating = results.filter((r) => !r.advisory && r.status !== 'pass');
const summary = { results, totalMs: total, budgetMs: BUDGET_MS, overBudget, gatingFailures: gating.map((r) => r.id) };
writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2));

console.log('\nsmoke summary');
for (const r of results) {
    console.log(`  ${r.status.padEnd(7)} ${r.id.padEnd(6)} ${String(r.ms).padStart(7)} ms${r.advisory ? '  advisory' : ''}`);
}
console.log(`  total ${total} ms (budget ${BUDGET_MS} ms)${overBudget ? '  OVER BUDGET' : ''}`);
if (overBudget) console.log('  finding: the smoke run exceeded its wall-clock budget — trim a scenario or raise the budget on the record');

process.exit(gating.length || overBudget ? 1 : 0);
