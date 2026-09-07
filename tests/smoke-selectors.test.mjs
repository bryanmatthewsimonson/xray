// Guard: the browser smoke scenarios (tools/smoke/*.mjs) select product
// elements by `data-xr` attributes, and every attribute value they
// reference must exist in src/ — set either as data-xr="…" in an HTML
// shell or as `dataset.xr = '…'` in a renderer. The MA.6 walk went
// stale within ten days of a heading rename (JOURNAL 2026-09-07) because
// it matched heading text; this pins the seam so a renamed heading
// cannot silently break the walk, and a deleted anchor fails here, in
// the unit suite, before CI spends a browser on it.
//
// House idiom: a positive sanity assertion proving the scanner sees,
// then the negative assertion that enforces.
// Provenance: INTERPRETATION (2026-09-07) — the data-xr convention is an
// agent choice under RESET_PLAN R0; the maintainer has not ruled on it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir, exts, acc = []) {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p, exts, acc);
        else if (exts.some((e) => name.endsWith(e))) acc.push(p);
    }
    return acc;
}

const smokeFiles = walk(join(REPO, 'tools', 'smoke'), ['.mjs']).filter((p) => !p.includes(`${join('smoke', 'out')}`));
const srcFiles = walk(join(REPO, 'src'), ['.js', '.html']);

function referencedSelectors() {
    const out = new Map();   // value → first file that references it
    for (const f of smokeFiles) {
        const text = readFileSync(f, 'utf8');
        for (const m of text.matchAll(/\[data-xr=(?:\\?["'])([a-z0-9-]+)(?:\\?["'])\]/g)) {
            if (!out.has(m[1])) out.set(m[1], f);
        }
    }
    return out;
}

function definedSelectors() {
    const out = new Set();
    for (const f of srcFiles) {
        const text = readFileSync(f, 'utf8');
        for (const m of text.matchAll(/data-xr=["']([a-z0-9-]+)["']/g)) out.add(m[1]);
        for (const m of text.matchAll(/dataset\.xr\s*=\s*["']([a-z0-9-]+)["']/g)) out.add(m[1]);
    }
    return out;
}

test('sanity: the scanner sees at least one data-xr selector in the smoke scripts and one anchor in src', () => {
    const refs = referencedSelectors();
    const defs = definedSelectors();
    assert.ok(refs.size >= 1, 'no [data-xr=…] selector found in tools/smoke — the scanner is blind');
    assert.ok(defs.size >= 1, 'no data-xr anchor found in src — the scanner is blind');
});

test('guard: every data-xr selector a smoke scenario uses exists in src', () => {
    const refs = referencedSelectors();
    const defs = definedSelectors();
    const missing = [...refs].filter(([value]) => !defs.has(value));
    assert.deepEqual(missing, [],
        'smoke scenarios reference data-xr anchors that src/ no longer sets: '
        + missing.map(([v, f]) => `${v} (${f.replace(REPO + '/', '')})`).join(', '));
});
