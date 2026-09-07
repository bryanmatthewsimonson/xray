// Guard: the bundle list the browser smoke asserts before launching
// (tools/smoke/lib/browser.mjs `expectedBundles()`, read from the
// `configs` esbuild.config.mjs exports) is exactly the set the PRODUCT
// loads — manifest.json, the HTML shells, and runtime `getURL()`
// references — no more, no less. A parser that silently dropped a
// bundle let `assertBuilt` pass on an incomplete dist/ (review
// 2026-09-07, VER-5); reading the exported configs removes the parser,
// and this test removes the remaining way to drift: a new entry point
// nothing loads, or a loaded bundle nothing builds.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expectedBundles } from '../tools/smoke/lib/browser.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir, exts, acc = []) {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p, exts, acc);
        else if (exts.some((e) => name.endsWith(e))) acc.push(p);
    }
    return acc;
}
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^\s*\/\/[^\n]*$/gm, '');

/** Every dist/*.bundle.js the shipped product references. */
function loadedBundles() {
    const out = new Set();
    const texts = [readFileSync(join(REPO, 'manifest.json'), 'utf8')];
    for (const f of walk(join(REPO, 'src'), ['.js', '.html'])) texts.push(stripComments(readFileSync(f, 'utf8')));
    for (const t of texts) for (const m of t.matchAll(/dist\/([A-Za-z0-9_.-]+\.bundle\.js)/g)) out.add('dist/' + m[1]);
    return out;
}

test('sanity: the product references at least the background and content bundles', () => {
    const loaded = loadedBundles();
    assert.ok(loaded.has('dist/background.bundle.js'), 'manifest.json no longer names the background bundle');
    assert.ok(loaded.has('dist/content.bundle.js'), 'manifest.json no longer names the content bundle');
});

test('guard: expectedBundles() is exactly the set the product loads', async () => {
    const expected = await expectedBundles();
    assert.ok(expected.every((f) => f.startsWith('dist/') && f.endsWith('.bundle.js')),
        'an esbuild outfile is outside dist/ or not a *.bundle.js: ' + expected.join(', '));
    const loaded = loadedBundles();
    const unbuilt = [...loaded].filter((f) => !expected.includes(f)).sort();
    const unloaded = expected.filter((f) => !loaded.has(f)).sort();
    assert.deepEqual(unbuilt, [], 'the product loads bundles esbuild.config.mjs does not build: ' + unbuilt.join(', '));
    assert.deepEqual(unloaded, [], 'esbuild.config.mjs builds bundles nothing in the product loads: ' + unloaded.join(', '));
});
