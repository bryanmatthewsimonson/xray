// College-of-personas guards (docs/PERSONAS.md §1, §21, §24;
// CONSTITUTION Art. 9). Mirrors the constitution-guards idiom:
// positive sanity first, then the enforcing assertion.
//
//   - The §1 roster parses: eighteen offices, unique slugs.
//   - The check-graph closes: every checker is a roster slug (plus
//     `network`, the one extra-collegial checker); every office has a
//     checker AND checks someone; no self-edges; the graph is
//     connected — no clique checks only each other.
//   - Every non-"not yet" seat path exists on disk.
//   - Every src/shared file with a "You are " prompt site carries a
//     registered Office header (new prompt sites self-register or the
//     suite fails).
//   - The five wire judgment families map to distinct owning offices
//     (never-merge as separation of powers, §22).
//   - The operator-binding offices exist and say so.
//   - Every office section carries the full §2 template.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const doc = await readFile(new URL('../docs/PERSONAS.md', import.meta.url), 'utf8');
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

// ---- roster parsing ------------------------------------------------

function parseRoster(text) {
    const rows = [];
    for (const line of text.split('\n')) {
        const m = line.match(/^\| (§\d+) \| (.+?) \| `([a-z]+)` \| (.+?) \| (.+?) \| (.+?) \| (.+?) \|$/);
        if (!m) continue;
        const checkedBy = [...m[6].matchAll(/`([a-z]+)`/g)].map((x) => x[1]);
        const seatMatch = m[7].match(/`([^`]+)`/);
        rows.push({
            section: m[1], office: m[2], slug: m[3],
            checkedBy, seat: seatMatch ? seatMatch[1] : m[7].trim()
        });
    }
    return rows;
}

const roster = parseRoster(doc);
const slugs = new Set(roster.map((r) => r.slug));

test('guard: the roster parses — eighteen offices, unique slugs (§1)', () => {
    assert.equal(roster.length, 18, 'eighteen roster rows');
    assert.equal(slugs.size, 18, 'slugs are unique');
    assert.ok(slugs.has('editor') && slugs.has('juror'), 'sanity: known slugs present');
});

// ---- the check-graph (§21) -----------------------------------------

test('guard: the check-graph closes — no office unchecked, none idle, none self-checking, all connected (§21)', () => {
    const checkers = new Set();
    for (const row of roster) {
        assert.ok(row.checkedBy.length >= 1, `${row.slug} has at least one checker`);
        for (const c of row.checkedBy) {
            assert.notEqual(c, row.slug, `${row.slug} does not check itself`);
            assert.ok(slugs.has(c) || c === 'network',
                `${row.slug}'s checker "${c}" is a roster slug (or the network)`);
            if (c !== 'network') checkers.add(c);
        }
    }
    // Sanity: the designed heavy checker is seen as one.
    assert.ok(checkers.has('juror'), 'sanity: the Juror checks others');
    for (const slug of slugs) {
        assert.ok(checkers.has(slug), `${slug} checks at least one other office`);
    }
    // Connectivity: BFS over the undirected check edges.
    const adj = new Map([...slugs].map((s) => [s, new Set()]));
    for (const row of roster) {
        for (const c of row.checkedBy) {
            if (c === 'network') continue;
            adj.get(row.slug).add(c);
            adj.get(c).add(row.slug);
        }
    }
    const seen = new Set(['editor']);
    const queue = ['editor'];
    while (queue.length) {
        for (const next of adj.get(queue.shift())) {
            if (!seen.has(next)) { seen.add(next); queue.push(next); }
        }
    }
    assert.equal(seen.size, 18, 'the check-graph is connected — no isolated clique');
});

// ---- seats exist on disk (§1) --------------------------------------

test('guard: every non-"not yet" seat path exists on disk (§1)', async () => {
    let checked = 0;
    for (const row of roster) {
        if (row.seat === 'not yet') continue;
        const p = join(repoRoot, row.seat.replace(/\/$/, ''));
        const s = await stat(p).catch(() => null);
        assert.ok(s, `${row.slug}'s seat exists: ${row.seat}`);
        checked += 1;
    }
    assert.ok(checked >= 14, `sanity: most offices have live seats (${checked})`);
    const notYet = roster.filter((r) => r.seat === 'not yet').map((r) => r.slug).sort();
    assert.deepEqual(notYet, ['accountant', 'confessor', 'peacemaker'],
        'the not-yet offices are exactly the seeded ones');
});

// ---- prompt sites self-register (§24) ------------------------------

async function* walkJs(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) yield* walkJs(p);
        else if (entry.name.endsWith('.js')) yield p;
    }
}

test('guard: every "You are" prompt file carries a registered Office header (§24)', async () => {
    const sharedRoot = join(repoRoot, 'src', 'shared');
    let promptFiles = 0;
    for await (const file of walkJs(sharedRoot)) {
        const text = await readFile(file, 'utf8');
        if (!/You are /.test(text)) continue;
        promptFiles += 1;
        const header = text.match(/^\/\/ Office: .*?\(([a-z]+)\).*?docs\/PERSONAS\.md §\d+/m);
        assert.ok(header, `${file} has an Office header (docs/PERSONAS.md §24)`);
        assert.ok(slugs.has(header[1]), `${file}'s office "${header[1]}" is a roster slug`);
    }
    assert.ok(promptFiles >= 8, `sanity: the scan sees the prompt files (${promptFiles})`);
});

// ---- never-merge as separation of powers (§22) ---------------------

test('guard: the five wire judgment families map to distinct owners (§22)', () => {
    const pins = [
        ['Assessment (30054)', 'juror'],
        ['Epistemic audit (30056–30061)', 'editor'],
        ['Forensic finding (30062)', 'detective'],
        ['Verdict / integrity (30063/30064)', 'judge'],
        ['Lens reading (no wire kind)', 'translator']
    ];
    const owners = new Set();
    for (const [family, owner] of pins) {
        const row = doc.split('\n').find((l) => l.startsWith(`| ${family} |`));
        assert.ok(row, `§22 row for ${family}`);
        assert.ok(row.includes(`\`${owner}\``), `${family} is owned by ${owner}`);
        owners.add(owner);
    }
    assert.equal(owners.size, 5, 'five families, five distinct owners');
});

// ---- the operator-binding offices (§23; CONSTITUTION Art. 8) -------

test('guard: the operator-binding offices exist and say so (§23)', () => {
    for (const slug of ['confessor', 'peacemaker', 'ombudsman']) {
        const row = roster.find((r) => r.slug === slug);
        assert.ok(row, `${slug} is in the roster`);
        const section = sectionFor(row);
        assert.ok(/binds the operator/.test(section),
            `${slug}'s section states it binds the operator`);
    }
    // The covenant's flags are named (seeds, default off).
    assert.ok(doc.includes('`plankProtocol`'), 'the plank-check flag is named');
    assert.ok(doc.includes('`respectGate`'), 'the respect-gate flag is named');
});

// ---- template completeness (§2) ------------------------------------

function sectionFor(row) {
    const start = doc.indexOf(`## ${row.section}. The Office of`);
    assert.ok(start > -1, `section heading for ${row.slug} (${row.section})`);
    const next = doc.indexOf('\n## ', start + 1);
    return doc.slice(start, next === -1 ? doc.length : next);
}

test('guard: every office section carries the full template (§2)', () => {
    const fields = ['**The Question.**', '**Charge.**', '**Traditions & exemplars.**',
        '**Non-negotiables.**', '**Occupational disease.**', '**Checked by:**',
        '**Seat in X-Ray.**'];
    for (const row of roster) {
        const section = sectionFor(row);
        // Whitespace-tolerant: a re-wrap never breaks the pin, a
        // missing field always does.
        const flat = section.replace(/\s+/g, ' ');
        for (const f of fields) {
            assert.ok(flat.includes(f), `${row.slug} carries ${f}`);
        }
        assert.ok(flat.includes(`(\`${row.slug}\`)`), `${row.slug}'s heading names its slug`);
    }
});
