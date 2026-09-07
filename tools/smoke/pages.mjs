// Smoke scenario `pages` — the cheapest observer of the layer no unit
// test executes: every extension page loads in a real Chromium with the
// real bundles, runs its init to the ready stamp, and throws nothing.
//
//   node tools/smoke/pages.mjs
//
// Checks, in order:
//   1. dist/ holds every bundle esbuild.config.mjs produces, none stale;
//   2. the service worker (background bundle) starts — that is how the
//      extension id is found at all;
//   3. the observers can see, and the egress kill holds: on about:blank
//      a canary uncaught exception and a canary `[X-Ray]` console.error
//      must both be caught, and a navigation to a public https origin
//      must fail with a proxy error — or the run stops at exit 2. A
//      listener that cannot see is a green gate that observes nothing;
//      an egress kill nobody observes is a comment;
//   4. every extension page (discovered from the shells in src/) loads
//      AND stamps itself ready (`<html data-xr-ready="<page>">`, the
//      last act of its init — src/shared/smoke-anchors.js) within
//      READY_MS, with zero uncaught exceptions through load, init and a
//      short settle after the stamp, and no console.error the product
//      itself emitted (`[X-Ray` — the Utils.error prefix) or failed
//      local resource (`net::ERR_`). Any other console.error is
//      reported, not failed on.
//
// Coverage window, stated: load → ready stamp → SETTLE_MS. An inert
// bundle, a mis-referenced <script src>, or an init that throws or never
// reaches the stamp is red; a failure after the settle is not observed
// here, and neither is the service worker's own console. Two pages stamp
// from their early-exit state on purpose: the reader with no `?id` is
// its URL-entry landing, the network page with its flag off is its
// flag-off notice — both are rendered states, and the deeper paths are
// the walks' job.
//
// No storage is seeded, no relay is configured: this is the
// never-configured, first-install state. Egress is killed at the
// browser level by the launcher (lib/browser.mjs) and re-verified in
// step 3, so the unpinned state can never reach a relay.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    EXTENSION_PAGES, assertBuilt, ensureOut, launchExtension, loadPlaywright,
    resolveChrome, watchErrors
} from './lib/browser.mjs';
import { READY_KEY } from '../../src/shared/smoke-anchors.js';

const READY_MS = 15000;
const SETTLE_MS = 500;
const FAIL_CONSOLE = /^\[X-Ray|net::ERR_/;
const CANARY = 'xr-smoke-canary';
const EGRESS_PROBE = 'https://example.com/';

const findings = [];
const ok = (s) => console.log('  ✓ ' + s);
const fail = (s) => { findings.push(s); console.log('  ✗ ' + s); };
const firstLine = (e) => String((e && e.message) || e).split('\n')[0];

const t0 = Date.now();
const out = ensureOut();
const report = { scenario: 'pages', bundles: [], observers: null, pages: [], findings, ms: 0 };
let close = async () => {};

console.log('[1] bundles');
try {
    report.bundles = await assertBuilt();
    ok(`${report.bundles.length} bundles present in dist/`);
} catch (e) {
    fail(e.message);
    await finish(2);
}

console.log('[2] service worker');
let ctx, extId;
try {
    const pw = await loadPlaywright();
    const chrome = resolveChrome(pw);
    ({ ctx, extId, close } = await launchExtension({ pw, chrome }));
    ok(`extension ${extId} — background bundle started`);
} catch (e) {
    fail(`launch: ${firstLine(e)}`);
    await finish(2);
}

console.log('[3] observers and the egress kill');
{
    const canary = await ctx.newPage();
    const errs = watchErrors(canary);
    await canary.goto('about:blank');
    // Two-argument form on purpose: that is Utils.error's shape, and the
    // `[X-Ray` rule below must match what Playwright joins it into.
    await canary.evaluate((tag) => {
        setTimeout(() => { throw new Error(tag); }, 0);
        console.error('[X-Ray]', tag);
    }, CANARY);
    await canary.waitForTimeout(300);
    const sawThrow = errs.pageErrors.some((e) => e.includes(CANARY));
    const sawConsole = errs.consoleErrors.some((e) => FAIL_CONSOLE.test(e) && e.includes(CANARY));
    let egress = 'unexpected: navigation succeeded';
    try {
        const res = await canary.goto(EGRESS_PROBE, { timeout: 15000 });
        if (res) egress = `unexpected: HTTP ${res.status()}`;
    } catch (e) {
        egress = firstLine(e);
    }
    const egressKilled = /net::ERR_PROXY/.test(egress);
    report.observers = { sawThrow, sawConsole, egress, egressKilled };
    await canary.close();
    if (!sawThrow) fail('observer: the pageerror listener did not see the canary exception');
    if (!sawConsole) fail('observer: the console listener did not see the canary [X-Ray] console.error');
    if (!egressKilled) fail(`egress: ${EGRESS_PROBE} did not fail with a proxy error — ${egress}`);
    if (findings.length) await finish(2);
    ok(`both observers see their canary; ${EGRESS_PROBE} refused by the dead proxy`);
}

console.log('[4] extension pages');
for (const { id, path } of EXTENSION_PAGES) {
    const page = await ctx.newPage();
    const errs = watchErrors(page);
    const url = `chrome-extension://${extId}/${path}`;
    const t = Date.now();
    let loadError = null;
    let ready = false;
    let readyMs = null;
    try {
        await page.goto(url, { waitUntil: 'load', timeout: 20000 });
    } catch (e) {
        loadError = firstLine(e);
    }
    if (!loadError) {
        try {
            await page.waitForFunction(
                ({ key, id: want }) => document.documentElement.dataset[key] === want,
                { key: READY_KEY, id }, { timeout: READY_MS });
            ready = true;
            readyMs = Date.now() - t;
            await page.waitForTimeout(SETTLE_MS);
        } catch (_) { /* reported below */ }
    }
    const text = await page.evaluate(() => (document.body && document.body.innerText || '').trim().length)
        .catch(() => -1);
    const shot = join(out, `pages-${id}.png`);
    await page.screenshot({ path: shot, fullPage: false }).catch(() => {});
    const productErrors = errs.consoleErrors.filter((c) => FAIL_CONSOLE.test(c));
    const row = { id, url: path, ms: Date.now() - t, loadError, ready, readyMs, bodyChars: text,
                  pageErrors: errs.pageErrors, consoleErrors: errs.consoleErrors, productErrors };
    report.pages.push(row);
    if (loadError) fail(`${id}: did not load — ${loadError}`);
    else if (errs.pageErrors.length) fail(`${id}: ${errs.pageErrors.length} uncaught error(s) — ${errs.pageErrors[0].split('\n')[0]}`);
    else if (!ready) fail(`${id}: no ready stamp within ${READY_MS} ms — the bundle is inert, init threw, or init never reached markReady`);
    else if (productErrors.length) fail(`${id}: ${productErrors.length} product console.error(s) — ${productErrors[0].split('\n')[0].slice(0, 160)}`);
    else if (text <= 0) fail(`${id}: ready with an empty body`);
    else ok(`${id}: ready in ${readyMs} ms, ${text} chars, ${errs.consoleErrors.length} console error(s)`);
    for (const c of errs.consoleErrors.slice(0, 3)) console.log('    console.error: ' + c.slice(0, 160));
    await page.close();
}

await finish(findings.length ? 1 : 0);

async function finish(code) {
    await close();
    report.ms = Date.now() - t0;
    writeFileSync(join(out, 'pages.json'), JSON.stringify(report, null, 2));
    console.log(findings.length
        ? `\nFINDINGS (${findings.length}):\n` + findings.map((f) => ' - ' + f).join('\n')
        : `\nNO FINDINGS — every page loaded, reached its ready stamp, and threw nothing (${report.ms} ms)`);
    process.exit(code);
}
