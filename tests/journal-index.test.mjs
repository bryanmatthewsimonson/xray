// Guards for the split JOURNAL — docs/journal/YYYY-MM.md hold the
// entries (oldest first, append at the bottom); docs/JOURNAL.md is the
// GENERATED index at the old path so every existing citation still
// resolves. Pinned here: the parser sees the corpus; the index matches
// a fresh render byte-for-byte; no entry is stranded in the index (a
// stale PR's union-merged prepend); every monthly file is well-formed
// (entry headings only, month equals file name, no duplicate heading
// repo-wide, header intact); every textual JOURNAL citation names a
// date that has an entry; the GitHub slug rule the links depend on;
// the two union merge rules; the stray mover.
//
// Why: docs/RESET_PLAN.md §7 R0, "Split the JOURNAL now, not in R6" —
// `docs/journal/YYYY-MM.md`, append-at-bottom, `merge=union`, a
// generated index at the old path so every existing citation still
// resolves; the JOURNAL was the one file thirty of the forty-five
// open-PR pairs conflicted on. A generated file nobody regenerates
// lies (tests/discipline-docs.test.mjs learned that), so the regen is
// machine-enforced, never remembered.
//
// Provenance: INTERPRETATION (2026-09-21) — an agent artifact under
// RESET_PLAN R0; the maintainer has not ruled on it.
//
// Idiom: a POSITIVE sanity test proves the parser and the citation
// scanner see, then the guards enforce. Order INSIDE a monthly file is
// deliberately not guarded: a union merge of two concurrent appends
// can land them out of order, and the index sorts by date anyway.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative, sep } from 'node:path';

import {
    parseEntries, listHeadings, slugify, renderIndex, monthlyFileFor, extractStrays,
    collectEntries, readJournalDir, GENERATED_LINE, INDEX_START, INDEX_END, ENTRY_HEADING_RE, MONTH_FILE_RE,
} from '../tools/gen-journal-index.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const INDEX = join(ROOT, 'docs', 'JOURNAL.md');
const rel = (abs) => relative(ROOT, abs).split(sep).join('/');

const monthly = readJournalDir(ROOT);                       // [{ file, text }], sorted
const byFile = monthly.map(({ file, text }) => ({ file, entries: parseEntries(text) }));
const all = byFile.flatMap((f) => f.entries);
const datesWithEntries = new Set(all.map((e) => e.date));
const indexText = existsSync(INDEX) ? readFileSync(INDEX, 'utf8') : '';

// ---------------------------------------------------------------- sanity

test('sanity: the parser sees the corpus and the index has its markers', () => {
    assert.ok(monthly.length >= 5, `expected monthly files under docs/journal/, saw ${monthly.length}`);
    assert.ok(all.length >= 246, `parser sees ${all.length} entries; the corpus had 246 at the split`);
    assert.ok(all.every((e) => e.text.startsWith('## ') && e.text.split('\n').length >= 2), 'every entry has a heading and a body');
    assert.ok(all.filter((e) => e.tags).length >= 150, 'the parser reads **Tags:** lines');

    const lines = indexText.split('\n');
    assert.equal(lines[0], GENERATED_LINE, 'docs/JOURNAL.md starts with the GENERATED marker');
    assert.equal(lines.filter((l) => l === INDEX_START).length, 1, 'one start marker');
    assert.equal(lines.filter((l) => l === INDEX_END).length, 1, 'one end marker');
    assert.ok(lines.indexOf(INDEX_START) < lines.indexOf(INDEX_END), 'start before end');
    assert.ok(lines.filter((l) => /^- \*\*\d{4}-\d{2}-\d{2}\*\* — \[/.test(l)).length >= 246, 'one index line per entry');
});

// ---------------------------------------------------------------- drift

test('guard: docs/JOURNAL.md equals a fresh render of the monthly files, byte for byte', () => {
    assert.equal(indexText, renderIndex(byFile), 'docs/JOURNAL.md is stale — run npm run docs:journal');
});

test('guard: no stray entry in docs/JOURNAL.md, and no index line is an entry heading', () => {
    const { strays } = extractStrays(indexText);
    assert.deepEqual(strays.map((s) => `${s.line}: ${s.heading}`), [],
        'an entry landed in the index (a union merge kept a stale PR\'s prepend) — run npm run docs:journal to move it');
    assert.deepEqual(indexText.split('\n').filter((l) => ENTRY_HEADING_RE.test(l)), []);
});

// ---------------------------------------------------------------- monthly files

test('guard: every monthly file is well-formed — entry headings only, month matches the file, header intact', () => {
    for (const { file, text } of monthly) {
        const month = MONTH_FILE_RE.exec(file.split('/').pop())[1];
        const bad = listHeadings(text).filter((h) => !h.wellFormed).map((h) => `${file}:${h.line}: ${h.text}`);
        assert.deepEqual(bad, [], 'every `## ` line is `## YYYY-MM-DD — title`');
        const entries = parseEntries(text);
        assert.ok(entries.length >= 1, `${file} has at least one entry`);
        for (const e of entries) assert.equal(e.month, month, `${file}:${e.line}: ${e.date} belongs in ${monthlyFileFor(e.date)}`);

        const head = text.split('\n').slice(0, entries[0].line - 1);
        assert.equal(head[0], `# X-Ray — Engineering Journal — ${month}`, `${file}: title line`);
        assert.match(head.join('\n'), /\.\.\/JOURNAL\.md/, `${file}: header points at the index`);
        assert.match(head.join('\n'), /npm run docs:journal/, `${file}: header names the regen`);
        assert.match(head.join('\n'), /BOTTOM/, `${file}: header states append-at-bottom`);
        assert.equal(head.filter((l) => l.trim()).pop(), '---', `${file}: a --- rule closes the header`);
    }
    // Every .md under docs/journal/ is a monthly file — nothing else lives there.
    const others = readdirSync(join(ROOT, 'docs', 'journal')).filter((f) => f.endsWith('.md') && !MONTH_FILE_RE.test(f));
    assert.deepEqual(others, []);
});

test('guard: no duplicate entry heading across all monthly files (and collectEntries agrees)', () => {
    const seen = new Map(), dups = [];
    for (const e of all) {
        if (seen.has(e.heading)) dups.push(`${e.heading} (${seen.get(e.heading)} and again)`);
        seen.set(e.heading, e.date);
    }
    assert.deepEqual(dups, []);
    assert.doesNotThrow(() => collectEntries(monthly));
});

// ---------------------------------------------------------------- citation currency

// Known-broken citations, shrink-only: { date, where, reason }. Empty
// today (every cited date has an entry). The assertion is set-equal
// BOTH WAYS, so a cite that starts resolving must leave the list and a
// new broken cite is red — the list cannot rot in either direction.
const KNOWN_BROKEN_CITES = [];

const CITE_RE = /\bJOURNAL(?:\.md)?`?,?(?:\s+entr(?:y|ies)\s+of)?\s*\(?\s*(\d{4}-\d{2}-\d{2})/g;
const MORE_RE = /(?:,?\s+(?:and|or)\s+|,\s+)(\d{4}-\d{2}-\d{2})/y;

function citedDates(text) {
    const dates = [];
    for (const m of text.matchAll(CITE_RE)) {
        dates.push(m[1]);
        MORE_RE.lastIndex = m.index + m[0].length;
        for (let n; (n = MORE_RE.exec(text));) dates.push(n[1]);
    }
    return dates;
}

function walk(dir, keep, out = []) {
    for (const name of readdirSync(dir).sort()) {
        const p = join(dir, name);
        if (name === 'node_modules' || name === '.git') continue;
        if (statSync(p).isDirectory()) walk(p, keep, out);
        else if (keep(rel(p))) out.push(p);
    }
    return out;
}

const CITE_FILES = [
    ...walk(join(ROOT, 'docs'), (p) => p.endsWith('.md')),
    join(ROOT, 'CLAUDE.md'), join(ROOT, 'CONTRIBUTING.md'),
    ...walk(join(ROOT, '.claude', 'skills'), (p) => p.endsWith('.md')),
    ...walk(join(ROOT, 'tests'), (p) => /^tests\/[^/]+\.mjs$/.test(p)),
    ...walk(join(ROOT, 'src'), (p) => p.endsWith('.js')),
];

test('sanity: the citation scanner sees the textual JOURNAL cites', () => {
    assert.deepEqual(citedDates('see JOURNAL 2026-07-10 and 2026-07-25; docs/JOURNAL.md 2026-08-02 (JOURNAL.md`, 2026-08-16); the JOURNAL entry of 2026-07-17, 2026-07-19, 2026-07-20.'),
        ['2026-07-10', '2026-07-25', '2026-08-02', '2026-08-16', '2026-07-17', '2026-07-19', '2026-07-20']);
    assert.deepEqual(citedDates('JOURNAL 2026-08-16, three entries; a 2026-08-02 date with no JOURNAL before it'), ['2026-08-16']);
    const total = CITE_FILES.reduce((n, f) => n + citedDates(readFileSync(f, 'utf8')).length, 0);
    assert.ok(total >= 150, `scanner sees ${total} cites across ${CITE_FILES.length} files (expected ≥ 150)`);
});

test('guard: every JOURNAL YYYY-MM-DD citation names a date that has an entry (allowlist shrink-only)', () => {
    const broken = new Map();
    for (const f of CITE_FILES) {
        for (const d of citedDates(readFileSync(f, 'utf8'))) {
            if (!datesWithEntries.has(d)) broken.set(d, [...(broken.get(d) || []), rel(f)]);
        }
    }
    const listed = KNOWN_BROKEN_CITES.map((k) => k.date).sort();
    assert.deepEqual([...broken.keys()].sort(), listed,
        `broken JOURNAL cites (date → files) must EQUAL the shrink-only allowlist: ${JSON.stringify([...broken])} — ` +
        'restore the entry, fix the cite, or (a resolved date) remove it from KNOWN_BROKEN_CITES');
});

// ---------------------------------------------------------------- slugs

test('pin: slugify is GitHub\'s heading-anchor rule', () => {
    assert.equal(slugify('2026-09-15 — R0 triage: every §9 disposition re-verified on the net, the hygiene script, and the one correction (#376)'),
        '2026-09-15--r0-triage-every-9-disposition-re-verified-on-the-net-the-hygiene-script-and-the-one-correction-376');
    assert.equal(slugify("2026-09-05 — `(x || []).filter` is not an array guard: the known-unknowns block's stored-string crash"),
        '2026-09-05--x--filter-is-not-an-array-guard-the-known-unknowns-blocks-stored-string-crash');
    assert.equal(slugify('2026-08-12 — UA.1: one reading per article (corpus-v8), and is_key loses its article-pass writer'),
        '2026-08-12--ua1-one-reading-per-article-corpus-v8-and-is_key-loses-its-article-pass-writer');
    assert.equal(slugify('2026-07-12 — The `[hidden]`-vs-author-`display` footgun '), '2026-07-12--the-hidden-vs-author-display-footgun');
    assert.equal(slugify('2026-06-01 — Ünïcode façade'), '2026-06-01--ünïcode-façade');
});

test('pin: repeated slugs within one file get -1, -2; the index sorts newest first by date then position', () => {
    const text = [
        '## 2026-09-01 — Foo bar', '', '**Tags:** design', 'a', '',
        '## 2026-09-01 — Foo, bar', '', 'b', '',
        '## 2026-09-02 — Foo. bar!', '', 'c', '',
        '## 2026-09-01 — Foo (bar)', '', 'd', '',
    ].join('\n');
    const index = renderIndex([{ file: 'docs/journal/2026-09.md', entries: parseEntries(text) }]);
    const bullets = index.split('\n').filter((l) => l.startsWith('- **'));
    assert.deepEqual(bullets, [
        '- **2026-09-02** — [Foo. bar!](journal/2026-09.md#2026-09-02--foo-bar)',
        '- **2026-09-01** — [Foo (bar)](journal/2026-09.md#2026-09-01--foo-bar-2)',
        '- **2026-09-01** — [Foo, bar](journal/2026-09.md#2026-09-01--foo-bar-1)',
        '- **2026-09-01** — [Foo bar](journal/2026-09.md#2026-09-01--foo-bar) · design',
    ]);
    assert.ok(index.startsWith(GENERATED_LINE + '\n'));
    assert.ok(index.endsWith(`\n${INDEX_END}\n`));
    assert.ok(index.includes(`${INDEX_START}\n\n## 2026-09\n\n- `));
    assert.equal(monthlyFileFor('2026-09-21'), 'docs/journal/2026-09.md');
    assert.throws(() => monthlyFileFor('2026-9-1'));
});

// ---------------------------------------------------------------- merge rules

test('guard: .gitattributes carries union merge for the monthly files and the index', () => {
    const rules = readFileSync(join(ROOT, '.gitattributes'), 'utf8').split('\n').map((l) => l.trim().replace(/\s+/g, ' '));
    assert.ok(rules.includes('docs/journal/*.md merge=union'), 'docs/journal/*.md merge=union');
    assert.ok(rules.includes('docs/JOURNAL.md merge=union'), 'docs/JOURNAL.md merge=union');
});

// ---------------------------------------------------------------- the mover

test('mover: a stray entry prepended to the index comes out whole and leaves the index untouched', () => {
    const stray = ['## 2026-09-20 — A stale PR\'s entry', '', '**Tags:** bug', '', 'Body line one.  ', '', '- a list', 'last line'].join('\n');
    const index = renderIndex(byFile);
    const { strays, rest } = extractStrays(stray + '\n\n\n' + index);
    assert.equal(strays.length, 1);
    assert.equal(strays[0].text, stray, 'the entry, its body, its trailing spaces — trailing blank lines dropped');
    assert.equal(strays[0].date, '2026-09-20');
    assert.equal(strays[0].tags, 'bug');
    assert.equal(rest, index, 'the index part is untouched');
    assert.deepEqual(extractStrays(index).strays, []);

    // A stray inside the block stops at the next `## YYYY-MM` heading; a
    // swept-in index bullet is dropped from its body.
    const [before, after] = index.split(`\n## ${all[0].month}\n`);
    const inside = `${before}\n## ${all[0].month}\n\n${stray}\n- **2026-09-05** — [x](journal/2026-09.md#y) · bug\n${after}`;
    const r = extractStrays(inside);
    assert.deepEqual(r.strays.map((s) => s.text), [stray]);
    assert.ok(!r.rest.includes(stray.split('\n')[0]));
});
