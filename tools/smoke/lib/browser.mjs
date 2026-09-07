// Shared launcher for the browser smoke scenarios (tools/smoke/*.mjs).
//
// Loads the UNPACKED EXTENSION from the repo root into a real headless
// Chromium (`--headless=new` supports extensions; the headless_shell
// build does not) on a throwaway profile, finds the extension id from
// its service worker, and hands scenarios a context to drive. Every
// scenario that needs the real modules bundles a seed entry into dist/
// through `seedBundle()` — the same esbuild the product uses, so bare
// npm specifiers resolve exactly as in the shipped bundles and no
// storage shape is ever hand-written.
//
// Resolution order for the browser: XR_CHROME, else the Chromium the
// repo's pinned `playwright` devDependency knows about (installed by
// `npx playwright install chromium`; honours PLAYWRIGHT_BROWSERS_PATH).
// XR_PW may point at an alternative playwright package.
//
// Outputs (screenshots, JSON reports) go to XR_SMOKE_OUT, default
// tools/smoke/out/ (gitignored). Nothing here touches the network: the
// scenarios pin relays to a dead loopback port before anything is
// clickable, and this launcher never sets a relay at all.

import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const SMOKE_DIR = join(REPO, 'tools', 'smoke');
export const OUT = process.env.XR_SMOKE_OUT || join(SMOKE_DIR, 'out');

const require = createRequire(import.meta.url);

/** The five extension pages, by the path the manifest / shells use. */
export const EXTENSION_PAGES = Object.freeze([
    { id: 'options',   path: 'src/options/options.html' },
    { id: 'reader',    path: 'src/reader/index.html' },
    { id: 'sidepanel', path: 'src/sidepanel/index.html' },
    { id: 'portal',    path: 'src/portal/index.html' },
    { id: 'network',   path: 'src/network/index.html' }
]);

/**
 * Every bundle esbuild.config.mjs produces, read from the config's own
 * text (importing it would run the build). Drift-proof: a new entry
 * point shows up here without anyone editing this file.
 * @returns {string[]} repo-relative paths like 'dist/reader.bundle.js'
 */
export function expectedBundles() {
    const src = readFileSync(join(REPO, 'esbuild.config.mjs'), 'utf8');
    const out = new Set();
    const pageNames = (() => {
        const m = src.match(/\.\.\.\[([^\]]+)\]\.map\(/);
        return m ? [...m[1].matchAll(/['"]([a-z-]+)['"]/g)].map((x) => x[1]) : [];
    })();
    for (const m of src.matchAll(/outfile:\s*resolve\(root,\s*[`'"]dist\/([^`'"]+)[`'"]\)/g)) {
        const name = m[1];
        if (name.includes('${name}')) {
            for (const n of pageNames) out.add('dist/' + name.replace('${name}', n));
        } else {
            out.add('dist/' + name);
        }
    }
    return [...out];
}

/** Fail fast, with the fix, when dist/ is not a complete build. */
export function assertBuilt() {
    const expected = expectedBundles();
    const missing = expected.filter((f) => !existsSync(join(REPO, f)));
    if (!expected.length) throw new Error('could not read any outfile from esbuild.config.mjs');
    if (missing.length) {
        throw new Error(`dist/ is incomplete — run \`npm run build\` first. Missing: ${missing.join(', ')}`);
    }
    return expected;
}

export async function loadPlaywright() {
    const spec = process.env.XR_PW || 'playwright';
    try {
        return await import(spec);
    } catch (e) {
        throw new Error(`playwright is not installed (${e.message}). Run \`npm install\`.`);
    }
}

export function resolveChrome(pw) {
    const path = process.env.XR_CHROME || pw.chromium.executablePath();
    if (!path || !existsSync(path)) {
        throw new Error(`No Chromium at ${path || '(unresolved)'} — run \`npx playwright install chromium\`, `
            + 'or set XR_CHROME to a full Chromium binary. (The headless_shell build cannot load extensions.)');
    }
    if (/headless_shell/.test(path)) {
        throw new Error(`${path} is the headless_shell build, which cannot load extensions — set XR_CHROME to a full Chromium.`);
    }
    return path;
}

export function ensureOut() {
    mkdirSync(OUT, { recursive: true });
    return OUT;
}

export function newProfile() {
    return mkdtempSync(join(tmpdir(), 'xr-profile-'));
}

/**
 * Launch the unpacked extension on a fresh profile and resolve its id.
 * @returns {Promise<{ctx: import('playwright').BrowserContext, extId: string, profile: string}>}
 */
export async function launchExtension({ pw, chrome, profile = newProfile(), viewport = { width: 1400, height: 1100 } } = {}) {
    const ctx = await pw.chromium.launchPersistentContext(profile, {
        executablePath: chrome,
        args: ['--headless=new', '--no-sandbox',
               `--disable-extensions-except=${REPO}`, `--load-extension=${REPO}`],
        viewport
    });
    let [sw] = ctx.serviceWorkers();
    if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 20000 });
    const extId = new URL(sw.url()).host;
    return { ctx, extId, profile };
}

/** Attach error listeners and return the arrays they fill. */
export function watchErrors(page) {
    const pageErrors = [];
    const consoleErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String((e && e.message) || e)));
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    return { pageErrors, consoleErrors };
}

/**
 * Bundle a scenario's seed entry into dist/ so an extension page can
 * load it as a same-origin script (only files inside the package are
 * loadable). Removed on exit: web-ext lint scans dist/, and a leftover
 * bundle inflates the warning count for whoever lints next.
 * @param {string} entryFile  absolute path to the seed entry
 * @param {string} name       bundle basename inside dist/, e.g. '_smoke-seed.bundle.js'
 */
export function seedBundle(entryFile, name) {
    const outfile = join(REPO, 'dist', name);
    require('esbuild').buildSync({
        entryPoints: [entryFile], outfile,
        bundle: true, format: 'iife', platform: 'browser', target: 'chrome120', logLevel: 'silent'
    });
    const cleanup = () => { try { rmSync(outfile, { force: true }); } catch (_) { /* best effort */ } };
    process.on('exit', cleanup);
    return { outfile, urlPath: `dist/${name}`, cleanup };
}
