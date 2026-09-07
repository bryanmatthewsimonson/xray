// The browser smoke runner — `npm run smoke`.
//
//   node tools/smoke/run.mjs [--only=pages,ma6] [--advisory=ma6]
//
// Runs each scenario in its own PROCESS GROUP with a hard timeout: on
// expiry the group gets SIGTERM (Playwright closes the browser if it
// can) and, GRACE_MS later, SIGKILL — a hung Chromium cannot outlive its
// scenario, because the kill lands on the whole group, not on the node
// child alone. Seed bundles in dist/ are swept after every scenario
// whatever way it ended. Writes tools/smoke/out/summary.json
// (XR_SMOKE_OUT overrides the directory).
//
// Exit code 1 when any REQUIRED scenario fails or times out, when the
// run exceeds BUDGET_MS, or when any output file carries key material
// (the artifact scan — outputs upload as a public CI artifact).
// Scenarios named in --advisory are run and reported but never fail the
// run; which scenarios are advisory is the caller's call (the CI
// workflow), never a date in this file. Exit 2 is a usage or setup
// error: unknown flag, empty selection, dist/ not built.
//
// Budget: the whole run — advisory time included — must fit BUDGET_MS
// wall clock; the per-scenario timeouts are sized so that even every
// scenario timing out fits, so an advisory timeout can never fail the
// run through the budget line. Exceeding the budget is itself a
// finding, because a slow gate is a gate people stop running.

import { spawn } from 'node:child_process';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertBuilt, ensureOut, SMOKE_DIR, sweepSeeds } from './lib/browser.mjs';

const SCENARIOS = [
    { id: 'pages', file: 'pages.mjs',    timeoutMs: 90_000 },
    { id: 'ma6',   file: 'ma6-walk.mjs', timeoutMs: 180_000 }
];
const BUDGET_MS = 300_000;
const GRACE_MS = 5_000;

const usage = (msg) => {
    console.error(`${msg}\nusage: node tools/smoke/run.mjs [--only=pages,ma6] [--advisory=ma6]\n`
        + `known scenarios: ${SCENARIOS.map((s) => s.id).join(', ')}`);
    process.exit(2);
};

const timeoutSum = SCENARIOS.reduce((a, s) => a + s.timeoutMs, 0);
if (timeoutSum > BUDGET_MS) usage(`scenario timeouts sum to ${timeoutSum} ms, over the ${BUDGET_MS} ms budget — resize one on the record`);

const flags = new Map();
for (const a of process.argv.slice(2)) {
    const m = /^--(only|advisory)=(.*)$/.exec(a);
    if (!m) usage(`unrecognised argument: ${a}`);
    const ids = m[2].split(',').map((s) => s.trim()).filter(Boolean);
    if (!ids.length) usage(`--${m[1]}= names no scenario`);
    const unknown = ids.filter((id) => !SCENARIOS.some((s) => s.id === id));
    if (unknown.length) usage(`unknown scenario(s): ${unknown.join(', ')}`);
    flags.set(m[1], ids);
}
const only = flags.get('only') || null;
const advisory = new Set(flags.get('advisory') || []);

try {
    await assertBuilt();
} catch (e) {
    console.error(e.message);
    process.exit(2);
}

const out = ensureOut();
const t0 = Date.now();
const results = [];
let current = null;   // pid of the running scenario's process group

const killGroup = (pid, sig) => { try { process.kill(-pid, sig); } catch (_) { /* already gone */ } };
for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
        if (current) killGroup(current, 'SIGKILL');
        sweepSeeds();
        process.exit(130);
    });
}

function runScenario(s) {
    return new Promise((resolve) => {
        const child = spawn(process.execPath, [join(SMOKE_DIR, s.file)], {
            stdio: 'inherit', detached: true, env: { ...process.env, XR_SMOKE_OUT: out }
        });
        current = child.pid;
        let timedOut = false;
        let killer = null;
        const timer = setTimeout(() => {
            timedOut = true;
            console.log(`=== ${s.id}: no exit after ${s.timeoutMs} ms — SIGTERM to the process group, SIGKILL in ${GRACE_MS} ms ===`);
            killGroup(child.pid, 'SIGTERM');
            killer = setTimeout(() => killGroup(child.pid, 'SIGKILL'), GRACE_MS);
        }, s.timeoutMs);
        const done = (r) => {
            clearTimeout(timer);
            if (killer) clearTimeout(killer);
            killGroup(child.pid, 'SIGKILL');   // stragglers (an orphaned Chromium) die with the scenario
            current = null;
            sweepSeeds();
            resolve(r);
        };
        child.on('error', (err) => done({ status: null, signal: null, timedOut, error: err }));
        child.on('exit', (code, signal) => done({ status: code, signal, timedOut, error: null }));
    });
}

for (const s of SCENARIOS) {
    if (only && !only.includes(s.id)) continue;
    const isAdvisory = advisory.has(s.id);
    console.log(`\n=== smoke: ${s.id}${isAdvisory ? ' (advisory)' : ''} ===`);
    const t = Date.now();
    const r = await runScenario(s);
    const ms = Date.now() - t;
    const status = r.timedOut ? 'timeout' : (r.status === 0 ? 'pass' : 'fail');
    if (r.error) console.log(`  error: ${r.error.message}`);
    if (r.signal && !r.timedOut) console.log(`  killed by ${r.signal}`);
    results.push({ id: s.id, status, ms, advisory: isAdvisory, exitCode: r.status, signal: r.signal || null });
    console.log(`=== ${s.id}: ${status.toUpperCase()} in ${ms} ms${isAdvisory ? ' (advisory — does not gate)' : ''} ===`);
}
if (!results.length) usage('no scenario selected');

// Outputs upload as a CI artifact anyone can download: no key material,
// ever. Seeds are fiction and the walk's identity is generated per run,
// so a hit here is a scenario bug — and a gating one.
function scanArtifacts(dir) {
    const hits = [];
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) { hits.push(...scanArtifacts(p)); continue; }
        if (/\.(png|jpe?g|webp)$/i.test(name)) continue;
        const text = readFileSync(p, 'utf8');
        if (/nsec1[a-z0-9]{58}/.test(text) || /\b(privateKey|privkey|private_key)\b/.test(text)) hits.push(p);
    }
    return hits;
}
const artifactLeaks = scanArtifacts(out);

const total = Date.now() - t0;
const overBudget = total > BUDGET_MS;
const gating = results.filter((r) => !r.advisory && r.status !== 'pass');
const summary = { results, totalMs: total, budgetMs: BUDGET_MS, overBudget,
                  gatingFailures: gating.map((r) => r.id), artifactLeaks };
writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2));

console.log('\nsmoke summary');
for (const r of results) {
    console.log(`  ${r.status.padEnd(7)} ${r.id.padEnd(6)} ${String(r.ms).padStart(7)} ms${r.advisory ? '  advisory' : ''}`);
}
console.log(`  total ${total} ms (budget ${BUDGET_MS} ms)${overBudget ? '  OVER BUDGET' : ''}`);
if (overBudget) console.log('  finding: the smoke run exceeded its wall-clock budget — trim a scenario or raise the budget on the record');
if (artifactLeaks.length) console.log(`  finding: key material in output files — ${artifactLeaks.join(', ')}`);

process.exit(gating.length || overBudget || artifactLeaks.length ? 1 : 0);
