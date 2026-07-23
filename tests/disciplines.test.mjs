// Discipline-standards guards (docs/DISCIPLINES.md §0, §1;
// CONSTITUTION Art. 9). Mirrors the constitution-guards idiom:
// positive sanity first, then the enforcing assertion.
//
//   - The §1 index parses: fifteen disciplines, unique ids, a valid
//     status vocabulary, and every codified-in path existing on disk.
//   - Every discipline section carries the §0 template: The question /
//     First principles / Standards / Failure mode / Status — derived,
//     not decreed.
//   - Every failure mode names a countervailing standard ("Countered
//     by") — no discipline exempts itself.
//   - Every src/shared file with a "You are " prompt site carries a
//     registered Standards header (new prompt sites self-register or
//     the suite fails).
//   - The named gap stays honest: accounting is the one full gap
//     until its standards are built.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const doc = await readFile(new URL('../docs/DISCIPLINES.md', import.meta.url), 'utf8');
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

// ---- index parsing -------------------------------------------------

function parseIndex(text) {
    const rows = [];
    for (const line of text.split('\n')) {
        const m = line.match(/^\| (§\d+) \| (.+?) \| `([a-z-]+)` \| (.+?) \| (codified|partial|gap) \|$/);
        if (!m) continue;
        const codifiedIn = m[4].match(/`([^`]+)`/);
        rows.push({
            section: m[1], discipline: m[2], id: m[3],
            codifiedIn: codifiedIn ? codifiedIn[1] : m[4].trim(),
            status: m[5]
        });
    }
    return rows;
}

const index = parseIndex(doc);
const ids = new Set(index.map((r) => r.id));

test('guard: the index parses — fifteen disciplines, unique ids, valid statuses (§1)', () => {
    assert.equal(index.length, 15, 'fifteen index rows');
    assert.equal(ids.size, 15, 'ids are unique');
    assert.ok(ids.has('journalism-audit') && ids.has('operator'), 'sanity: known ids present');
});

test('guard: every codified-in document exists on disk (§1)', async () => {
    let checked = 0;
    for (const row of index) {
        if (row.codifiedIn === 'this document') continue;
        const s = await stat(join(repoRoot, row.codifiedIn)).catch(() => null);
        assert.ok(s, `${row.id}'s statute exists: ${row.codifiedIn}`);
        checked += 1;
    }
    assert.ok(checked >= 6, `sanity: the codified statutes were checked (${checked})`);
});

test('guard: the gap list stays honest — accounting is the one full gap (§1, §17)', () => {
    const gaps = index.filter((r) => r.status === 'gap').map((r) => r.id);
    assert.deepEqual(gaps, ['accounting'],
        'the only "gap" row is forensic accounting until its standards are built');
});

// ---- section template (§0) -----------------------------------------

function sectionFor(row) {
    const start = doc.indexOf(`## ${row.section}. `);
    assert.ok(start > -1, `section heading for ${row.id} (${row.section})`);
    const next = doc.indexOf('\n## ', start + 1);
    return doc.slice(start, next === -1 ? doc.length : next);
}

test('guard: every discipline section carries the full template — derived, not decreed (§0)', () => {
    const fields = ['**The question.**', '**First principles.**', '**Standards.**',
        '**Failure mode.**', '**Status.**'];
    for (const row of index) {
        // Whitespace-tolerant: a re-wrap never breaks the pin, a
        // missing field always does.
        const flat = sectionFor(row).replace(/\s+/g, ' ');
        for (const f of fields) {
            assert.ok(flat.includes(f), `${row.id} carries ${f}`);
        }
        assert.ok(flat.includes(`(\`${row.id}\`)`), `${row.id}'s heading names its id`);
    }
});

test('guard: every failure mode names its countervailing standard (§0)', () => {
    for (const row of index) {
        const flat = sectionFor(row).replace(/\s+/g, ' ');
        const failure = flat.split('**Failure mode.**')[1];
        assert.ok(failure, `${row.id} has a failure-mode field`);
        assert.ok(/countered by/i.test(failure),
            `${row.id}'s failure mode says what counters it — no discipline exempts itself`);
    }
});

// ---- prompt sites self-register ------------------------------------

async function* walkJs(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) yield* walkJs(p);
        else if (entry.name.endsWith('.js')) yield p;
    }
}

test('guard: every "You are" prompt file carries a registered Standards header', async () => {
    const sharedRoot = join(repoRoot, 'src', 'shared');
    let promptFiles = 0;
    for await (const file of walkJs(sharedRoot)) {
        const text = await readFile(file, 'utf8');
        if (!/You are /.test(text)) continue;
        promptFiles += 1;
        const header = text.match(/^\/\/ Standards: ([a-z-]+) — docs\/DISCIPLINES\.md §\d+\./m);
        assert.ok(header, `${file} has a Standards header (docs/DISCIPLINES.md §0)`);
        assert.ok(ids.has(header[1]), `${file}'s discipline "${header[1]}" is an index id`);
    }
    assert.ok(promptFiles >= 8, `sanity: the scan sees the prompt files (${promptFiles})`);
});

// ---- the operator discipline stays gateless (CONSTITUTION Art. 8) --

test('guard: the operator discipline is accountability, never a gate', () => {
    const flat = sectionFor(index.find((r) => r.id === 'operator')).replace(/\s+/g, ' ');
    assert.ok(/never as pre-publication gates/.test(flat),
        'the no-gate boundary is stated');
    assert.ok(/advisory, never blocking/.test(flat),
        'safeguards are advisory, never blocking');
    assert.ok(flat.includes('moral lens'),
        'the designated self-examination instrument is the moral lens');
});
