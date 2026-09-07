// X-Ray build pipeline.
//
// Produces ten bundles under `dist/`:
//
//   dist/content.bundle.js          — content script (IIFE; runs in every tab)
//   dist/background.bundle.js       — MV3 service worker (ESM per manifest)
//   dist/options.bundle.js          — extension options page (single settings hub)
//   dist/sidepanel.bundle.js        — chrome.sidePanel target (entity browser)
//   dist/reader.bundle.js           — extension-page reader view
//   dist/portal.bundle.js           — "My Archive" data portal (Phase 12)
//   dist/network.bundle.js          — the Network client (Phase 25)
//   dist/api-interceptor.bundle.js  — MAIN-world fetch/XHR hook (Phase 8a)
//   dist/pdf-engine.bundle.js       — pdf.js extractor (ESM, lazily imported by the reader)
//   dist/pdf.worker.bundle.js       — pdf.js worker (IIFE)
//
// `configs` is exported: tools/smoke/lib/browser.mjs reads it to know
// which bundles must exist, and tests/smoke-bundles.test.mjs pins that
// list to what manifest.json and the HTML shells actually load. The
// build runs only when this file is the entry script (`npm run build`).
//
// The toolbar-icon click captures the active tab into the reader — no
// popup surface, so no popup bundle. HTML and CSS files stay in `src/`
// and reference the built bundles via relative paths like
// `../../dist/options.bundle.js`. The manifest keeps its references to
// `src/.../*.html` files unchanged.

import * as esbuild from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { readFileSync, cpSync, realpathSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = __dirname;

// Build stamp — injected as the __XRAY_BUILD_INFO__ define so every
// surface can show WHICH build is actually loaded (version alone is
// ambiguous across feature branches; see shared/build-info.js). Best
// effort: a missing git (e.g. a release tarball) degrades to the
// version + timestamp. NOTE: in --watch mode the stamp is computed
// once at watch start, not per incremental rebuild.
function buildStamp() {
    const git = (cmd) => {
        try { return execSync(cmd, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
        catch (_) { return ''; }
    };
    let version = '';
    try { version = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8')).version || ''; }
    catch (_) { /* stays '' */ }
    const dirty = git('git status --porcelain') ? '+dirty' : '';
    return {
        version,
        branch:  git('git rev-parse --abbrev-ref HEAD'),
        commit:  git('git rev-parse --short HEAD') + dirty,
        builtAt: new Date().toISOString()
    };
}

const shared = {
    bundle: true,
    sourcemap: true,
    target: ['es2022'],
    logLevel: 'info',
    legalComments: 'linked',
    define: {
        __XRAY_BUILD_INFO__: JSON.stringify(JSON.stringify(buildStamp()))
    }
};

/** @type {esbuild.BuildOptions[]} */
export const configs = [
    // --- content script (isolated world, IIFE) ---
    {
        ...shared,
        entryPoints: [resolve(root, 'src/content/index.js')],
        outfile: resolve(root, 'dist/content.bundle.js'),
        format: 'iife',
        platform: 'browser'
    },

    // --- background service worker (ESM module service worker) ---
    {
        ...shared,
        entryPoints: [resolve(root, 'src/background/index.js')],
        outfile: resolve(root, 'dist/background.bundle.js'),
        format: 'esm',
        platform: 'browser',
        // Service workers don't have a window; most DOM globals are absent.
        // The relay client uses WebSocket + crypto.subtle, both of which exist
        // in worker scope, so no extra shimming is needed.
        conditions: ['worker', 'browser']
    },

    // --- extension pages (each is its own IIFE bundle, loaded by its HTML shell) ---
    ...['options', 'sidepanel', 'reader', 'portal', 'network'].map((name) => ({
        ...shared,
        entryPoints: [resolve(root, `src/${name}/index.js`)],
        outfile: resolve(root, `dist/${name}.bundle.js`),
        format: 'iife',
        platform: 'browser'
    })),

    // --- MAIN-world api-interceptor (Phase 8a) ---
    // Injected on demand by platform handlers via
    // chrome.scripting.executeScript({ world: 'MAIN', files: [...] }).
    // Standalone IIFE because it runs in the page's globals — no
    // shared imports allowed; the file's IIFE is the entire module.
    {
        ...shared,
        entryPoints: [resolve(root, 'src/page/api-interceptor.js')],
        outfile: resolve(root, 'dist/api-interceptor.bundle.js'),
        format: 'iife',
        platform: 'browser'
    },

    // --- pdf.js engine + worker (Phase 18 C4) ---
    // The engine is ESM so the reader can dynamic-import it lazily
    // (only when a PDF is captured); the worker bundles pdf.js's own
    // worker as a classic-worker-compatible IIFE.
    {
        ...shared,
        entryPoints: [resolve(root, 'src/reader/pdf-engine.js')],
        outfile: resolve(root, 'dist/pdf-engine.bundle.js'),
        format: 'esm',
        platform: 'browser'
    },
    {
        ...shared,
        entryPoints: [resolve(root, 'src/reader/pdf-worker-entry.js')],
        outfile: resolve(root, 'dist/pdf.worker.bundle.js'),
        format: 'iife',
        platform: 'browser'
    }
];

const watch = process.argv.includes('--watch');

// pdf.js runtime assets (Phase 18): predefined CMaps (CJK text
// extraction), standard font metrics, wasm decoders (JBIG2 / JPEG2000
// / ICC), and ICC profiles — copied verbatim next to the bundles.
// pdf-capture hands their extension URLs to getDocument; without them
// a CJK PDF extracts zero text (and is falsely refused as a scan) and
// JBIG2/JPX figures can never decode (even pdf.js's no-wasm fallback
// resolves relative to wasmUrl).
function copyPdfAssets() {
    const src = resolve(root, 'node_modules/pdfjs-dist');
    for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
        cpSync(resolve(src, dir), resolve(root, 'dist', dir), { recursive: true });
    }
}

async function build() {
    copyPdfAssets();
    if (watch) {
        const contexts = await Promise.all(configs.map((c) => esbuild.context(c)));
        await Promise.all(contexts.map((c) => c.watch()));
        console.log('[xray] watching…');
        // keep alive
        await new Promise(() => {});
    } else {
        await Promise.all(configs.map((c) => esbuild.build(c)));
        console.log('[xray] build complete');
    }
}

// Build only when run as a script. An importer (the browser smoke, the
// unit suite) gets `configs` and no build — it does pay for the build
// stamp above (three git calls, ~100 ms). Both sides are realpath'd:
// Node resolves the ESM main through symlinks, argv[1] is as typed, and
// a checkout under a symlinked directory must still build.
const isMain = (() => {
    if (!process.argv[1]) return false;
    try {
        return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]));
    } catch (_) { return false; }
})();
if (isMain) {
    build().catch((err) => {
        console.error('[xray] build failed:', err);
        process.exit(1);
    });
}
