// Ruling-ID guard — RESET_PLAN §4.4 item 2: "A guard asserts every R-
// id cited anywhere in the tree exists." It fails the build.
//
// A ruling id is R- followed by exactly three digits, not joined to a
// letter, digit, underscore or hyphen before it, or to a letter or digit
// after it. So the plan's track names (R0 to R7) and the placeholders
// "R-id", "R-NNN" and "R-…" are never read as ids.
//
// A ruling exists when it is the first cell of a ledger table row in
// docs/RULINGS.md, or a "### R-NNN —" heading there.
//
// The expiry of INTERPRETATION guards is a separate check that only
// warns (scripts/provenance-expiry.mjs).
//
// Provenance: R-022

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const LEDGER = 'docs/RULINGS.md';

const RULING_ID = /(?<![A-Za-z0-9_-])R-(\d{3})(?![A-Za-z0-9])/g;
const DEFINED = /^(?:\|\s*R-(\d{3})\s*\||###\s+R-(\d{3})\s+—)/gm;

// The tree is the files git tracks or would track (.gitignore
// respected), so agent worktrees under .claude/worktrees/, scratch/ and
// .notes/ are never read. package-lock.json is generated. Outside a git
// checkout the scan walks the directory instead, skipping git
// internals, installed and built output, local environments and the
// paths below.
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'web-ext-artifacts', '_metadata', '.venv', '__pycache__']);
const SKIP_PATHS = new Set(['tools/smoke/out', 'package-lock.json', '.claude/worktrees', 'scratch', '.notes']);
const TEXT = new Set(['.md', '.mjs', '.js', '.cjs', '.json', '.html', '.css', '.yml', '.yaml', '.txt', '.py', '.toml']);

function* walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const abs = join(dir, entry.name);
        const rel = relative(ROOT, abs).split(sep).join('/');
        if (SKIP_PATHS.has(rel)) continue;
        if (entry.isDirectory()) {
            if (!SKIP_DIRS.has(entry.name)) yield* walk(abs);
        } else if (entry.isFile() && TEXT.has(extname(entry.name))) {
            yield rel;
        }
    }
}

const skipped = (rel) => [...SKIP_PATHS].some((p) => rel === p || rel.startsWith(`${p}/`));

/** The text files git tracks or would track, relative to ROOT. */
function* treeFiles() {
    let listed;
    try {
        listed = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
            cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore']
        }).split('\0').filter(Boolean);
    } catch {
        yield* walk(ROOT);   // not a git checkout
        return;
    }
    for (const rel of listed) {
        if (!TEXT.has(extname(rel)) || skipped(rel)) continue;
        // A tracked file deleted but not yet staged is listed, and gone.
        if (statSync(join(ROOT, rel), { throwIfNoEntry: false })?.isFile()) yield rel;
    }
}

test('guard: every ruling id cited in the tree exists in docs/RULINGS.md', () => {
    // Built from parts, so this file cites no ruling itself.
    const id = (digits) => 'R' + '-' + digits;
    const found = (s) => [...s.matchAll(RULING_ID)].map((m) => m[1]);
    assert.deepEqual(found(`(${id('004')}) and ${id('012')}.`), ['004', '012'], 'sanity: ids are seen');
    assert.deepEqual(found('R0 R1 R7 R-id R-ids R-NNN R-… PR-123 R-YYYYMMDD-n R-1 R-0001'), [],
        'track names and placeholders are not ids');

    const ledger = readFileSync(join(ROOT, LEDGER), 'utf8');
    const defined = new Set([...ledger.matchAll(DEFINED)].map((m) => m[1] ?? m[2]));
    assert.ok(defined.size > 0, `sanity: ${LEDGER} defines at least one ruling`);

    const missing = [];
    let citedOutsideLedger = 0;
    for (const rel of treeFiles()) {
        readFileSync(join(ROOT, rel), 'utf8').split('\n').forEach((line, i) => {
            for (const m of line.matchAll(RULING_ID)) {
                if (rel !== LEDGER) citedOutsideLedger += 1;
                if (!defined.has(m[1])) missing.push(`${rel}:${i + 1} cites ${m[0]}`);
            }
        });
    }
    assert.ok(citedOutsideLedger > 0, 'sanity: the scan sees ruling ids cited outside the ledger');
    assert.deepEqual(missing, [], `every cited ruling id has a row in ${LEDGER}`);
});
