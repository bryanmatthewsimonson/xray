// Guard: docs/discipline-standards.html is GENERATED from .claude/skills/**
// and must not drift from it.
//
// The dev-process skills were themselves seeded with a stale claim that
// three docs carried for weeks (JOURNAL 2026-08-02, "The Phase 16/19
// walks were done; only the docs said otherwise"). A generated doc that
// nobody regenerates is the same defect with a longer fuse — so the
// regen is machine-enforced rather than remembered.
//
// The comparison is byte-exact, which is safe only because
// .gitattributes pins `*.html text eol=lf`: without it a
// core.autocrlf=true checkout (the Windows default, and set here)
// would smudge the committed file to CRLF while the renderer emits
// LF, so this guard would fail on one platform and pass on the other.
// Do not relax that rule without normalizing line endings here.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { renderDisciplineDocs } from '../tools/gen-discipline-docs.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const OUT = join(ROOT, 'docs', 'discipline-standards.html');

test('guard: the generated discipline doc matches the skills it renders', () => {
    assert.ok(existsSync(OUT),
        'docs/discipline-standards.html is missing — run `npm run docs:disciplines`');

    const committed = readFileSync(OUT, 'utf8');
    const fresh = renderDisciplineDocs();

    assert.equal(committed, fresh,
        'docs/discipline-standards.html is stale — a SKILL.md or the skills ' +
        'README changed without a regen. Run `npm run docs:disciplines` and ' +
        'commit the result.');
});

test('guard: every discipline renders its standards into the doc', () => {
    const html = renderDisciplineDocs();

    // One statute list per discipline; a parser regression that split a
    // list on its blank lines would restart numbering at 1 and show up
    // here as extra lists.
    const lists = html.match(/<ol class="statute">/g) || [];
    assert.equal(lists.length, 8, 'one numbered standards list per discipline');

    for (const id of ['product-manager', 'architect', 'continuous-improvement', 'automator',
        'ecosystem-pm', 'verification-engineer', 'security-threat-modeler', 'schema-evolution']) {
        assert.match(html, new RegExp(`id="${id}"`), `${id} has a section`);
    }

    // Every discipline names its failure mode beside the standards —
    // the docs/DISCIPLINES.md §0 rule that no discipline exempts itself.
    const failures = html.match(/block--failure/g) || [];
    assert.ok(failures.length >= 8, 'every discipline renders a failure mode');

    // Unrendered markdown would mean the block renderer silently gave up.
    // Checked over rendered content only — the file header and CSS
    // legitimately contain characters that look like markdown (the
    // header cites a `skills/**` glob).
    const body = html.slice(html.indexOf('<div class="wrap">'));
    assert.doesNotMatch(body, /\*\*/, 'no unrendered bold markers');
    assert.doesNotMatch(body, /^\| /m, 'no unrendered table rows');
});
