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
// tools/smoke/out/ (gitignored).
//
// Egress is KILLED AT THE BROWSER LEVEL: every launch routes all
// non-loopback traffic through a proxy on a dead loopback port, so no
// request — the product's or Chromium's own — leaves the machine.
// Loopback bypasses the proxy (Chromium's implicit rule), which is why
// the scenarios' `ws://127.0.0.1:1` relay pin still behaves as an
// unreachable relay rather than a proxied one. The pin is defence in
// depth; the proxy is the control (docs/THREAT_MODEL.md, 2026-09-07).

import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const SMOKE_DIR = join(REPO, 'tools', 'smoke');
export const OUT = process.env.XR_SMOKE_OUT || join(SMOKE_DIR, 'out');

/** Dead loopback port every launch proxies through — nothing listens on port 1. */
export const DEAD_PROXY = 'http://127.0.0.1:1';

const require = createRequire(import.meta.url);

/**
 * The extension pages, discovered from the tree: every HTML shell under
 * src/<dir>/ that loads a dist bundle. The id is the directory name —
 * the same string the page passes to `markReady()` (src/shared/
 * smoke-anchors.js) — so a new surface joins the `pages` scenario by
 * existing, and a shell that stops loading a bundle drops out of it.
 * @type {ReadonlyArray<{id: string, path: string}>}
 */
export const EXTENSION_PAGES = Object.freeze(discoverPages());

function discoverPages() {
    const src = join(REPO, 'src');
    const pages = [];
    for (const dir of readdirSync(src).sort()) {
        const abs = join(src, dir);
        if (!statSync(abs).isDirectory()) continue;
        for (const name of readdirSync(abs).sort()) {
            if (!name.endsWith('.html')) continue;
            const html = readFileSync(join(abs, name), 'utf8');
            if (!/dist\/[\w.-]+\.bundle\.js/.test(html)) continue;
            pages.push({ id: dir, path: `src/${dir}/${name}` });
        }
    }
    if (!pages.length) throw new Error('no extension page shell found under src/ — nothing loads a dist bundle');
    return pages;
}

/**
 * Every bundle esbuild.config.mjs produces, read from the config's own
 * exported `configs` (importing it builds nothing — it runs the build
 * only as the entry script). tests/smoke-bundles.test.mjs pins this
 * list to what the product actually loads.
 * @returns {Promise<string[]>} repo-relative paths like 'dist/reader.bundle.js'
 */
export async function expectedBundles() {
    const { configs } = await import(pathToFileURL(join(REPO, 'esbuild.config.mjs')).href);
    const out = (configs || []).map((c) => relative(REPO, c.outfile).split(sep).join('/'));
    if (!out.length) throw new Error('esbuild.config.mjs exports no build configs');
    return out;
}

/** Fail fast, with the fix, when dist/ is not a complete build. */
export async function assertBuilt() {
    const expected = await expectedBundles();
    const missing = expected.filter((f) => !existsSync(join(REPO, f)));
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
 * `close()` closes the browser AND deletes the profile — it holds a
 * generated signing key in the walk scenarios (XR_SMOKE_KEEP_PROFILE=1
 * keeps it for debugging).
 * @returns {Promise<{ctx: import('playwright').BrowserContext, extId: string, profile: string, close: () => Promise<void>}>}
 */
export async function launchExtension({ pw, chrome, profile = newProfile(), viewport = { width: 1400, height: 1100 } } = {}) {
    const ctx = await pw.chromium.launchPersistentContext(profile, {
        executablePath: chrome,
        args: ['--headless=new', '--no-sandbox',
               `--proxy-server=${DEAD_PROXY}`,
               `--disable-extensions-except=${REPO}`, `--load-extension=${REPO}`],
        viewport
    });
    const close = async () => {
        await ctx.close().catch(() => { /* already gone */ });
        if (!process.env.XR_SMOKE_KEEP_PROFILE) {
            try { rmSync(profile, { recursive: true, force: true }); } catch (_) { /* best effort */ }
        }
    };
    let sw;
    try {
        [sw] = ctx.serviceWorkers();
        if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 20000 });
    } catch (e) {
        await close();
        throw new Error(`the background service worker did not start within 20 s (${String(e.message).split('\n')[0]})`);
    }
    const extId = new URL(sw.url()).host;
    return { ctx, extId, profile, close };
}

/** Attach error listeners and return the arrays they fill. */
export function watchErrors(page) {
    const pageErrors = [];
    const consoleErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String((e && e.message) || e)));
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    return { pageErrors, consoleErrors };
}

const SEED_PREFIX = '_smoke-';

/**
 * Remove every seed bundle from dist/. Called before a seed is built and
 * by the runner after every scenario, so a scenario killed mid-run (a
 * SIGKILL runs no exit hook) still leaves dist/ clean for web-ext.
 */
export function sweepSeeds() {
    const dist = join(REPO, 'dist');
    if (!existsSync(dist)) return;
    for (const f of readdirSync(dist)) {
        if (f.startsWith(SEED_PREFIX)) {
            try { rmSync(join(dist, f), { force: true }); } catch (_) { /* best effort */ }
        }
    }
}

/**
 * Bundle a scenario's seed entry into dist/ so an extension page can
 * load it as a same-origin script (only files inside the package are
 * loadable). Removed on exit and by the runner's sweep: web-ext lint
 * scans dist/, and a leftover bundle inflates the warning count for
 * whoever lints next (package.json's webExt.ignoreFiles also excludes
 * the prefix from the zip).
 * @param {string} entryFile  absolute path to the seed entry
 * @param {string} name       bundle basename inside dist/, e.g. '_smoke-seed.bundle.js'
 */
export function seedBundle(entryFile, name) {
    if (!name.startsWith(SEED_PREFIX)) throw new Error(`seed bundle names must start with ${SEED_PREFIX}: ${name}`);
    sweepSeeds();
    const outfile = join(REPO, 'dist', name);
    require('esbuild').buildSync({
        entryPoints: [entryFile], outfile,
        bundle: true, format: 'iife', platform: 'browser', target: 'chrome120', logLevel: 'silent'
    });
    const cleanup = () => { try { rmSync(outfile, { force: true }); } catch (_) { /* best effort */ } };
    process.on('exit', cleanup);
    return { outfile, urlPath: `dist/${name}`, cleanup };
}
