// X-Ray build pipeline.
//
// Produces six bundles under `dist/`:
//
//   dist/content.bundle.js     — content script (IIFE; runs in every tab)
//   dist/background.bundle.js  — MV3 service worker (ESM per manifest)
//   dist/popup.bundle.js       — toolbar popup page
//   dist/options.bundle.js     — extension options page
//   dist/sidepanel.bundle.js   — chrome.sidePanel target (shell for now)
//   dist/reader.bundle.js      — extension-page reader view (shell for now)
//
// HTML and CSS files stay in `src/` and reference the built bundles via
// relative paths like `../../dist/popup.bundle.js`. The manifest keeps its
// references to `src/.../*.html` files unchanged.

import * as esbuild from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = __dirname;

const shared = {
    bundle: true,
    sourcemap: true,
    target: ['es2022'],
    logLevel: 'info',
    legalComments: 'linked'
};

/** @type {esbuild.BuildOptions[]} */
const configs = [
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
    ...['popup', 'options', 'sidepanel', 'reader'].map((name) => ({
        ...shared,
        entryPoints: [resolve(root, `src/${name}/index.js`)],
        outfile: resolve(root, `dist/${name}.bundle.js`),
        format: 'iife',
        platform: 'browser'
    }))
];

const watch = process.argv.includes('--watch');

async function build() {
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

build().catch((err) => {
    console.error('[xray] build failed:', err);
    process.exit(1);
});
