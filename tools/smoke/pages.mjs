// Smoke scenario `pages` — the cheapest observer of the layer no unit
// test executes: every extension page loads in a real Chromium with the
// real bundles and throws nothing.
//
//   node tools/smoke/pages.mjs
//
// Checks, in order:
//   1. dist/ holds every bundle esbuild.config.mjs produces;
//   2. the service worker (background bundle) starts — that is how the
//      extension id is found at all;
//   3. each of the five extension pages loads and settles with ZERO
//      uncaught exceptions (`pageerror`). console.error lines are
//      reported, not failed on: a page reporting "no article is open"
//      is behaving, not broken.
// Screenshots and a JSON report land in the output dir (CI artifact).
//
// No storage is seeded, no relay is configured, no network is touched:
// this is the never-configured, first-install state of the extension.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    EXTENSION_PAGES, assertBuilt, ensureOut, launchExtension, loadPlaywright,
    resolveChrome, watchErrors
} from './lib/browser.mjs';

const SETTLE_MS = 1500;
const findings = [];
const ok = (s) => console.log('  ✓ ' + s);
const fail = (s) => { findings.push(s); console.log('  ✗ ' + s); };

const t0 = Date.now();
const out = ensureOut();
const report = { scenario: 'pages', bundles: [], pages: [], findings, ms: 0 };

console.log('[1] bundles');
try {
    report.bundles = assertBuilt();
    ok(`${report.bundles.length} bundles present in dist/`);
} catch (e) {
    fail(e.message);
    finish(2);
}

console.log('[2] service worker');
const pw = await loadPlaywright();
const chrome = resolveChrome(pw);
const { ctx, extId } = await launchExtension({ pw, chrome });
ok(`extension ${extId} — background bundle started`);

console.log('[3] extension pages');
for (const { id, path } of EXTENSION_PAGES) {
    const page = await ctx.newPage();
    const errs = watchErrors(page);
    const url = `chrome-extension://${extId}/${path}`;
    const t = Date.now();
    let loadError = null;
    try {
        await page.goto(url, { waitUntil: 'load', timeout: 20000 });
        await page.waitForTimeout(SETTLE_MS);
    } catch (e) {
        loadError = String((e && e.message) || e).split('\n')[0];
    }
    const text = await page.evaluate(() => (document.body && document.body.innerText || '').trim().length)
        .catch(() => -1);
    const shot = join(out, `pages-${id}.png`);
    await page.screenshot({ path: shot, fullPage: false }).catch(() => {});
    const row = { id, url: path, ms: Date.now() - t, loadError, bodyChars: text,
                  pageErrors: errs.pageErrors, consoleErrors: errs.consoleErrors };
    report.pages.push(row);
    if (loadError) fail(`${id}: did not load — ${loadError}`);
    else if (errs.pageErrors.length) fail(`${id}: ${errs.pageErrors.length} uncaught error(s) — ${errs.pageErrors[0]}`);
    else if (text <= 0) fail(`${id}: loaded with an empty body`);
    else ok(`${id}: loaded, ${text} chars, ${errs.consoleErrors.length} console error(s), ${row.ms} ms`);
    for (const c of errs.consoleErrors.slice(0, 3)) console.log('    console.error: ' + c.slice(0, 160));
    await page.close();
}

await ctx.close();
finish(findings.length ? 1 : 0);

function finish(code) {
    report.ms = Date.now() - t0;
    writeFileSync(join(out, 'pages.json'), JSON.stringify(report, null, 2));
    console.log(findings.length
        ? `\nFINDINGS (${findings.length}):\n` + findings.map((f) => ' - ' + f).join('\n')
        : `\nNO FINDINGS — every page loaded clean (${report.ms} ms)`);
    process.exit(code);
}
