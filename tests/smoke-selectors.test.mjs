// Guard: the browser smoke scenarios (tools/smoke/*.mjs) select product
// elements by `data-xr` attributes, and every attribute value they can
// reference must be SET in src/ — as data-xr="…" in an HTML shell, as
// `dataset.xr = …` or `setAttribute('data-xr', …)` in a renderer. The
// MA.6 walk went stale within ten days of a heading rename (JOURNAL
// 2026-09-07) because it matched heading text; this pins the seam so a
// renamed heading cannot silently break the walk, and a deleted anchor
// fails here, in the unit suite, before CI spends a browser on it.
//
// The seam is src/shared/smoke-anchors.js: product code sets anchors
// from SMOKE_ANCHORS and scenarios build selectors from the same table.
// Three assertions, each with a positive sanity check first (house
// idiom): the table's values are all set in src/; every literal
// `[data-xr="…"]` a scenario still carries is set in src/; and no
// scenario spells a data-xr selector any other way (unquoted, template
// with an unknown key) — those the scanner cannot see, so they are
// banned rather than assumed.
//
// Comments are stripped on both sides before scanning: a commented-out
// anchor is neither a definition nor a reference (review 2026-09-07,
// VER-4 / CI-8). A consumer selector in src (`querySelector('[data-xr=…')`)
// is not a definition either — the definition forms are attribute-set
// forms only. A scenario reading `dataset.xr` or `getAttribute('data-xr')`
// without comparing to SMOKE_ANCHORS is banned for the same reason a
// literal in any other spelling is: the scanner cannot resolve it.
//
// The READY STAMP is guarded here too, because it is fail-open by
// construction: a shell that carried `data-xr-ready` statically, or a
// page that never called markReady, would restore exactly the
// green-on-an-inert-bundle the stamp exists to end. So: no HTML shell may
// carry the attribute, every discovered page's entry file calls
// `markReady('<dir>')` exactly once, and nothing else in src/ calls it.
// Provenance: INTERPRETATION (2026-09-07) — the data-xr convention is an
// agent choice under RESET_PLAN R0; the maintainer has not ruled on it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SMOKE_ANCHORS } from '../src/shared/smoke-anchors.js';
import { EXTENSION_PAGES } from '../tools/smoke/lib/browser.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir, exts, acc = []) {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p, exts, acc);
        else if (exts.some((e) => name.endsWith(e))) acc.push(p);
    }
    return acc;
}

/** Drop `// …` and `/* … *\/` comments (and HTML comments) — good enough for a scanner. */
function stripComments(text) {
    return text
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/^\s*\/\/[^\n]*$/gm, '')
        .replace(/(^|[^:'"`\\])\/\/[^\n]*$/gm, '$1');
}

const smokeFiles = walk(join(REPO, 'tools', 'smoke'), ['.mjs', '.js'])
    .filter((p) => !p.includes(`${join('smoke', 'out')}`));
const srcFiles = walk(join(REPO, 'src'), ['.js', '.html']);
const rel = (p) => p.replace(REPO + '/', '');

const ANCHOR_KEYS = new Set(Object.keys(SMOKE_ANCHORS));
const ANCHOR_VALUES = new Set(Object.values(SMOKE_ANCHORS));

/** Literal selectors a scenario carries, plus every other `data-xr=` spelling it uses. */
function scanScenarios() {
    const literal = new Map();   // value → first file
    const tableRefs = new Map(); // SMOKE_ANCHORS key → first file
    const other = [];            // spellings the scanner cannot resolve
    for (const f of smokeFiles) {
        const text = stripComments(readFileSync(f, 'utf8'));
        for (const m of text.matchAll(/data-xr=([^\]\s,)]*)/g)) {
            const spelled = m[1];
            let mm;
            if ((mm = /^\\?["']([a-z0-9-]+)\\?["']$/.exec(spelled))) {
                if (!literal.has(mm[1])) literal.set(mm[1], f);
            } else if ((mm = /^"\$\{SMOKE_ANCHORS\.([A-Za-z0-9_]+)\}"$/.exec(spelled))) {
                if (!tableRefs.has(mm[1])) tableRefs.set(mm[1], f);
            } else {
                other.push(`${spelled} (${rel(f)})`);
            }
        }
        // Property and getAttribute reads that the selector scan cannot see.
        for (const line of text.split('\n')) {
            if (!/\bdataset\.xr\b|getAttribute\(\s*["']data-xr["']\s*\)/.test(line)) continue;
            if (/SMOKE_ANCHORS\./.test(line)) continue;
            other.push(`${line.trim().slice(0, 60)} (${rel(f)})`);
        }
    }
    return { literal, tableRefs, other };
}

/** Values src/ SETS as a data-xr attribute (never a consumer selector). */
function definedValues() {
    const out = new Set();
    for (const f of srcFiles) {
        const text = stripComments(readFileSync(f, 'utf8'));
        for (const m of text.matchAll(/(?<!\[)data-xr=["']([a-z0-9-]+)["']/g)) out.add(m[1]);
        for (const m of text.matchAll(/dataset\.xr\s*=\s*["']([a-z0-9-]+)["']/g)) out.add(m[1]);
        for (const m of text.matchAll(/dataset\.xr\s*=\s*SMOKE_ANCHORS\.([A-Za-z0-9_]+)/g)) {
            if (SMOKE_ANCHORS[m[1]]) out.add(SMOKE_ANCHORS[m[1]]);
        }
        for (const m of text.matchAll(/setAttribute\(\s*["']data-xr["']\s*,\s*["']([a-z0-9-]+)["']\s*\)/g)) out.add(m[1]);
        for (const m of text.matchAll(/setAttribute\(\s*["']data-xr["']\s*,\s*SMOKE_ANCHORS\.([A-Za-z0-9_]+)\s*\)/g)) {
            if (SMOKE_ANCHORS[m[1]]) out.add(SMOKE_ANCHORS[m[1]]);
        }
    }
    return out;
}

test('sanity: the scanners see — a table reference in a scenario, a definition in src, and comments are stripped', () => {
    const { tableRefs, literal } = scanScenarios();
    const defs = definedValues();
    assert.ok(tableRefs.size + literal.size >= 1, 'no data-xr selector found in tools/smoke — the scanner is blind');
    assert.ok(defs.size >= 1, 'no data-xr definition found in src — the scanner is blind');
    assert.ok(ANCHOR_VALUES.size >= 1, 'SMOKE_ANCHORS is empty');
    assert.equal(stripComments('x = 1; // dataset.xr = "ghost"\n/* data-xr="ghost2" */\n<!-- data-xr="ghost3" -->'),
        'x = 1; \n\n', 'comment stripping does not remove the commented forms');
});

test('guard: every SMOKE_ANCHORS value is set somewhere in src/', () => {
    const defs = definedValues();
    const missing = [...ANCHOR_VALUES].filter((v) => !defs.has(v));
    assert.deepEqual(missing, [],
        'src/shared/smoke-anchors.js lists anchors that no renderer or shell sets: ' + missing.join(', '));
});

test('guard: every data-xr selector a scenario spells resolves — literals exist in src/, table keys exist in the table', () => {
    const { literal, tableRefs, other } = scanScenarios();
    const defs = definedValues();
    const missingLiteral = [...literal].filter(([v]) => !defs.has(v));
    assert.deepEqual(missingLiteral, [],
        'smoke scenarios reference data-xr values that src/ no longer sets: '
        + missingLiteral.map(([v, f]) => `${v} (${rel(f)})`).join(', '));
    const badKeys = [...tableRefs].filter(([k]) => !ANCHOR_KEYS.has(k));
    assert.deepEqual(badKeys, [],
        'smoke scenarios reference SMOKE_ANCHORS keys the table does not have: '
        + badKeys.map(([k, f]) => `${k} (${rel(f)})`).join(', '));
    assert.deepEqual(other, [],
        'smoke scenarios spell data-xr selectors in a form this guard cannot resolve — use a quoted literal '
        + 'or `[data-xr="${SMOKE_ANCHORS.<key>}"]`: ' + other.join(', '));
});

test('guard: the ready stamp is set by code only — no shell carries it, every page calls markReady once, nothing else does', () => {
    const shells = srcFiles.filter((f) => f.endsWith('.html'))
        .filter((f) => /data-xr-ready/.test(stripComments(readFileSync(f, 'utf8'))));
    assert.deepEqual(shells.map(rel), [], 'an HTML shell carries data-xr-ready statically — the stamp must be the last act of init, set by code');

    assert.ok(EXTENSION_PAGES.length >= 1, 'no extension page discovered — the scanner is blind');
    const wrong = [];
    for (const { id } of EXTENSION_PAGES) {
        const entry = join(REPO, 'src', id, 'index.js');
        const text = stripComments(readFileSync(entry, 'utf8'));
        const calls = [...text.matchAll(/\bmarkReady\(\s*['"]([a-z0-9-]+)['"]\s*\)/g)].map((m) => m[1]);
        if (calls.length !== 1 || calls[0] !== id) wrong.push(`${id}: markReady calls ${JSON.stringify(calls)}`);
    }
    assert.deepEqual(wrong, [], 'each page entry must call markReady(\'<dir>\') exactly once: ' + wrong.join('; '));

    const allowed = new Set([...EXTENSION_PAGES.map(({ id }) => join(REPO, 'src', id, 'index.js')), join(REPO, 'src', 'shared', 'smoke-anchors.js')]);
    const strays = srcFiles.filter((f) => !allowed.has(f) && /\bmarkReady\b|data-xr-ready|dataset\.xrReady/.test(stripComments(readFileSync(f, 'utf8'))));
    assert.deepEqual(strays.map(rel), [], 'the ready stamp is touched outside the page entries: ' + strays.map(rel).join(', '));
});
