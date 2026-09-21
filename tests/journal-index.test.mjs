// Guards for the split JOURNAL — docs/journal/YYYY-MM.md hold the
// entries (oldest first, append at the bottom); docs/JOURNAL.md is the
// GENERATED index at the old path so every existing citation still
// resolves. Pinned here: the parser sees the corpus; the index matches
// a fresh render byte-for-byte; no entry is stranded in the index (a
// stale PR's union-merged prepend) and no unrecognised text sits in it;
// every monthly file is well-formed (entry headings only, calendar
// dates, month equals file name, no duplicate heading repo-wide,
// header intact); every textual JOURNAL citation names a date that
// has an entry; the GitHub slug rule the links depend on; the two
// union merge rules; the stray mover — and that it NEVER DISCARDS
// TEXT: unrecognised lines refuse the write and are listed, a stray
// that amends an existing entry is refused with both line numbers,
// identical duplicates are summarised, conflict markers are
// boundaries so a conflicted index heals in one run; the post-merge
// regen workflow's shape (two regenerated indexes union in merge
// order on main; the generator sorts).
//
// Why: docs/RESET_PLAN.md §7 R0, "Split the JOURNAL now, not in R6" —
// `docs/journal/YYYY-MM.md`, append-at-bottom, `merge=union`, a
// generated index at the old path so every existing citation still
// resolves; the JOURNAL was the one file thirty of the forty-five
// open-PR pairs conflicted on. A generated file nobody regenerates
// lies (tests/discipline-docs.test.mjs learned that), so the regen is
// machine-enforced, never remembered. The never-discard pins came from
// the adversarial verification of the split (JOURNAL 2026-09-21): the
// first build deleted a malformed-heading stray with exit 0.
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
import { readFileSync, readdirSync, existsSync, statSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';

import {
    parseEntries, listHeadings, slugify, renderIndex, monthlyFileFor, extractStrays, collectEntries, readJournalDir,
    isEntryHeading, isCalendarDate, isIndexResidue, monthlyHeader, run,
    GENERATED_LINE, INDEX_START, INDEX_END, INDEX_PREAMBLE, LEGACY_PREAMBLE, ENTRY_HEADING_RE, MONTH_FILE_RE,
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

test('guard: no stray entry and no unrecognised text in docs/JOURNAL.md; no index line is an entry heading', () => {
    const { strays, foreign, markers } = extractStrays(indexText);
    assert.deepEqual(strays.map((s) => `${s.line}: ${s.heading}`), [],
        'an entry landed in the index (a union merge kept a stale PR\'s prepend) — run npm run docs:journal to move it');
    assert.deepEqual(foreign.map((f) => `${f.line}: ${f.text}`), [],
        'unrecognised text in the index — a regen would discard it; fix the heading or move the text (npm run docs:journal lists it)');
    assert.equal(markers, 0, 'conflict markers in the index — run npm run docs:journal, never hand-resolve');
    assert.deepEqual(indexText.split('\n').filter((l) => isEntryHeading(l)), []);
});

// ---------------------------------------------------------------- monthly files

test('guard: every monthly file is well-formed — entry headings only, month matches the file, header intact', () => {
    for (const { file, text } of monthly) {
        const month = MONTH_FILE_RE.exec(file.split('/').pop())[1];
        const bad = listHeadings(text).filter((h) => !h.wellFormed).map((h) => `${file}:${h.line}: ${h.text}`);
        assert.deepEqual(bad, [], 'every `## ` line is `## YYYY-MM-DD — title` on a calendar date');
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

// ---------------------------------------------------------------- headings and slugs

test('pin: an entry heading is `## YYYY-MM-DD — title` on a CALENDAR date — the regex shape and the days-in-month check', () => {
    // positive: the corpus, and the shapes the regex alone accepts
    assert.ok(all.every((e) => isEntryHeading(`## ${e.heading}`)), 'every corpus heading is an entry heading');
    assert.ok(isEntryHeading('## 2024-02-29 — leap day'));
    assert.ok(isEntryHeading('## 2026-12-31 — year end'));
    assert.ok(ENTRY_HEADING_RE.test('## 2026-02-30 — regex-shaped'), 'the regex cannot see the calendar');
    // negative: the shapes the first build let through or silently dropped
    for (const [line, why] of [
        ['## 2026-02-30 — impossible day', 'February 30'],
        ['## 2026-13-45 — bogus month', 'month 13'],
        ['## 2026-04-31 — April 31', 'April has 30 days'],
        ['## 2025-02-29 — not a leap year', '2025-02-29'],
        ['## 2026-09-20 - hyphen-minus', 'hyphen-minus for the em dash'],
        ['## 2026-9-1 — one-digit day', 'one-digit month and day'],
        [' ## 2026-09-21 — leading space', 'leading space'],
        ['## 2026-09-21 — CRLF tail\r', 'a carriage return'],
        ['## 2026-09 — a month heading', 'no day'],
        ['## 2026-09', 'the index month heading'],
    ]) assert.equal(isEntryHeading(line), false, `not an entry heading: ${why}`);
    assert.equal(isCalendarDate('2026-02-28'), true);
    assert.equal(isCalendarDate('2100-02-29'), false, '2100 is not a leap year');
    assert.equal(isCalendarDate('2000-02-29'), true, '2000 is');
    assert.ok(MONTH_FILE_RE.test('2026-12.md') && !MONTH_FILE_RE.test('2026-13.md') && !MONTH_FILE_RE.test('2026-00.md'));
    assert.throws(() => monthlyFileFor('2026-13-45'));
    assert.throws(() => monthlyFileFor('2026-02-30'));
    assert.throws(() => collectEntries([{ file: 'docs/journal/2026-02.md', text: monthlyHeader('2026-02') + '## 2026-02-30 — x\n\nbody\n' }]), /not an entry heading/);
    assert.throws(() => readJournalDir(lab({ '2026-13.md': monthlyHeader('2026-13') + '## 2026-12-01 — x\n\nb\n' }).root), /not a YYYY-MM\.md monthly file/);
});

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

// A throwaway repo root: docs/journal/<name> from `monthly`, docs/JOURNAL.md
// from `index`. `snap()` is the byte state of every file it holds, so a
// refusal can be proved to have written nothing.
function lab(monthlyFiles, index) {
    const root = mkdtempSync(join(tmpdir(), 'xray-journal-'));
    mkdirSync(join(root, 'docs', 'journal'), { recursive: true });
    for (const [name, text] of Object.entries(monthlyFiles)) writeFileSync(join(root, 'docs', 'journal', name), text);
    if (index != null) writeFileSync(join(root, 'docs', 'JOURNAL.md'), index);
    const logs = [];
    const read = (p) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : null);
    const snap = () => JSON.stringify(['docs/JOURNAL.md', ...readdirSync(join(root, 'docs', 'journal')).sort().map((f) => `docs/journal/${f}`)].map((p) => [p, read(p)]));
    return { root, logs, log: (s) => logs.push(s), read, snap, done: () => rmSync(root, { recursive: true, force: true }) };
}

const EXISTING = '## 2026-09-05 — Existing entry\n\n**Tags:** bug\nbody v1\n\n---';   // ends on a rule, like the old-era entries
const BASE_09 = `${monthlyHeader('2026-09')}${EXISTING}\n`;
const cleanIndexFor = (files) => renderIndex(collectEntries(Object.entries(files).map(([name, text]) => ({ file: `docs/journal/${name}`, text }))));
const CLEAN = cleanIndexFor({ '2026-09.md': BASE_09 });

test('mover: a stray entry prepended to the index comes out whole and leaves the index untouched', () => {
    const stray = ['## 2026-09-20 — A stale PR\'s entry', '', '**Tags:** bug', '', 'Body line one.  ', '', '- a list', 'last line'].join('\n');
    const index = renderIndex(byFile);
    const { strays, rest, foreign } = extractStrays(stray + '\n\n\n' + index);
    assert.equal(strays.length, 1);
    assert.equal(strays[0].text, stray, 'the entry, its body, its trailing spaces — trailing blank lines dropped');
    assert.equal(strays[0].date, '2026-09-20');
    assert.equal(strays[0].tags, 'bug');
    assert.equal(rest, index, 'the index part is untouched');
    assert.deepEqual(foreign, [], 'a well-formed stray is not unrecognised text');
    assert.deepEqual(extractStrays(index).strays, []);

    // A stray inside the block stops at the next `## YYYY-MM` heading; a
    // swept-in index bullet is dropped from its body.
    const [before, after] = index.split(`\n## ${all[0].month}\n`);
    const inside = `${before}\n## ${all[0].month}\n\n${stray}\n- **2026-09-05** — [x](journal/2026-09.md#y) · bug\n${after}`;
    const r = extractStrays(inside);
    assert.deepEqual(r.strays.map((s) => s.text), [stray]);
    assert.ok(!r.rest.includes(stray.split('\n')[0]));
});

test('pin: index residue is every line a regen reproduces or replaced — both preambles, markers, bullets, month headings, blanks', () => {
    for (const l of [...INDEX_PREAMBLE, ...LEGACY_PREAMBLE, GENERATED_LINE, INDEX_START, INDEX_END, '', '  ', '## 2026-09',
        '- **2026-09-05** — [x](journal/2026-09.md#y) · bug']) assert.ok(isIndexResidue(l), `residue: ${JSON.stringify(l)}`);
    assert.ok(LEGACY_PREAMBLE.includes('external changes that shape the architecture. Newer entries first.'), 'the one pre-split line the new preamble lacks');
    for (const l of ['## 2026-13', '## 2026-09-20 - hyphen', 'Someone typed this here.', '# X-Ray — Engineering Journal — 2026-09', '\r', 'body\r'])
        assert.equal(isIndexResidue(l), false, `not residue: ${JSON.stringify(l)}`);
});

test('mover: unrecognised text refuses the write, lists every line with its number, and --check says the same', () => {
    const strays = [
        '## 2026-09-20 - hyphen not em dash', '', 'body A', '',
        '## 2026-9-1 — one-digit day', '', 'body B', '',
        ' ## 2026-09-21 — leading space', '', 'body C', '',
        '## 2026-13-45 — bogus month', '', 'body D', '',
        '## 2026-09-20 — CRLF entry\r', '\r', 'body E\r', '',
    ].join('\n') + '\n';
    const L = lab({ '2026-09.md': BASE_09 }, strays + CLEAN);
    try {
        const before = L.snap();
        assert.equal(run({ root: L.root, log: L.log }), 1, 'refused');
        assert.equal(L.snap(), before, 'NOTHING written — not the index, not a monthly file');
        const listed = L.logs.filter((l) => l.startsWith('text  docs/JOURNAL.md:')).map((l) => l.slice('text  docs/JOURNAL.md:'.length));
        assert.deepEqual(listed, [
            '1: ## 2026-09-20 - hyphen not em dash', '3: body A', '5: ## 2026-9-1 — one-digit day', '7: body B',
            '9:  ## 2026-09-21 — leading space', '11: body C', '13: ## 2026-13-45 — bogus month', '15: body D',
            '17: ## 2026-09-20 — CRLF entry\\r', '18: \\r', '19: body E\\r',
        ], 'every unrecognised line, by index line number, carriage returns made visible');
        const refusal = L.logs.find((l) => l.startsWith('refused: '));
        assert.match(refusal, /11 unrecognised line\(s\) in docs\/JOURNAL\.md would be discarded/);
        assert.match(refusal, /## YYYY-MM-DD — title/);
        assert.match(refusal, /CRLF/);
        assert.ok(L.logs.includes('nothing written'));

        L.logs.length = 0;
        assert.equal(run({ root: L.root, check: true, log: L.log }), 1);
        assert.equal(L.snap(), before);
        assert.equal(L.logs.filter((l) => l.startsWith('text  docs/JOURNAL.md:')).length, 11, '--check lists the same lines');
        assert.ok(L.logs.some((l) => /^check: 11 unrecognised line/.test(l)));
    } finally { L.done(); }
});

test('mover: prose typed into the index is refused too; a clean index runs to exit 0 and rewrites nothing', () => {
    const L = lab({ '2026-09.md': BASE_09 }, CLEAN.replace(INDEX_START, `${INDEX_START}\nSomeone typed this here.`));
    try {
        const before = L.snap();
        assert.equal(run({ root: L.root, log: L.log }), 1);
        assert.equal(L.snap(), before);
        assert.ok(L.logs.some((l) => /^text  docs\/JOURNAL\.md:\d+: Someone typed this here\.$/.test(l)));
    } finally { L.done(); }
    const C = lab({ '2026-09.md': BASE_09 }, CLEAN);
    try {
        const before = C.snap();
        assert.equal(run({ root: C.root, log: C.log }), 0);
        assert.equal(C.snap(), before, 'a clean tree is byte-stable across a run');
        assert.equal(run({ root: C.root, check: true, log: C.log }), 0);
    } finally { C.done(); }
});

test('mover: a stray that AMENDS an existing entry is refused with both line numbers; identical duplicates are dropped and summarised', () => {
    const amend = '## 2026-09-05 — Existing entry\n\n**Tags:** bug\nbody v2 — EDITED by a stale PR\n\n---\n\n';
    const A = lab({ '2026-09.md': BASE_09 }, amend + CLEAN);
    try {
        const before = A.snap();
        assert.equal(run({ root: A.root, log: A.log }), 1, 'an amendment the mover cannot apply blocks the write');
        assert.equal(A.snap(), before, 'nothing written: the v2 text is still in the index, v1 still in the month');
        const skip = A.logs.find((l) => l.startsWith('skip  '));
        assert.match(skip, /^skip {2}docs\/JOURNAL\.md:1 — docs\/journal\/2026-09\.md:6 has this heading with a DIFFERENT body \(amendment NOT applied\): 2026-09-05 — Existing entry$/);
        assert.ok(A.logs.some((l) => l === 'refused: docs/JOURNAL.md:1 amends docs/journal/2026-09.md:6 — edit the entry in its monthly file, then delete the copy from docs/JOURNAL.md'));
        A.logs.length = 0;
        assert.equal(run({ root: A.root, check: true, log: A.log }), 1, '--check fails on it too');
        assert.ok(A.logs.some((l) => l.startsWith('check: docs/JOURNAL.md:1 amends docs/journal/2026-09.md:6')));
    } finally { A.done(); }

    // 246 identical skips would bury one amendment: identical duplicates
    // are one summary line, and a new stray beside them still moves.
    const dup = '## 2026-09-20 — New one\n\nbody\n\n' + EXISTING + '\n\n';
    const D = lab({ '2026-09.md': BASE_09 }, dup + CLEAN);
    try {
        assert.equal(run({ root: D.root, log: D.log }), 0);
        assert.deepEqual(D.logs.filter((l) => /^(move|skip) /.test(l)), [
            'move  docs/JOURNAL.md:1 → docs/journal/2026-09.md: 2026-09-20 — New one',
            'skip  1 already-migrated entry in docs/JOURNAL.md (identical to the monthly file)',
        ]);
        assert.ok(D.logs.at(-1).endsWith('1 stray(s) moved, 1 duplicate(s) dropped)'));
        assert.equal(D.read('docs/journal/2026-09.md'), `${BASE_09}\n## 2026-09-20 — New one\n\nbody\n`, 'appended at the bottom, once');
        assert.equal(D.read('docs/JOURNAL.md'), cleanIndexFor({ '2026-09.md': D.read('docs/journal/2026-09.md') }));
        assert.equal(run({ root: D.root, check: true, log: D.log }), 0);
    } finally { D.done(); }

    // A double blank left where a swept-in bullet was removed is not an amendment.
    const holed = EXISTING.replace('\nbody v1\n', '\nbody v1\n\n\n') + '\n\n';
    const H = lab({ '2026-09.md': BASE_09 }, holed + CLEAN);
    try {
        assert.equal(run({ root: H.root, log: H.log }), 0);
        assert.ok(H.logs.some((l) => l.startsWith('skip  1 already-migrated')));
    } finally { H.done(); }
});

test('mover: conflict markers are boundaries — a conflicted index (the pre-split branch merging main) heals in ONE run', () => {
    // The shape git produces: the preambles merge cleanly up to the Format
    // block; HEAD (pre-split) holds `---`, the stray and the old entries;
    // theirs holds the "How to cite" block, the markers and the bullets.
    const stray = '## 2026-09-20 — stale-sim entry\n\n**Tags:** bug\n\nOne body line of the stale PR.';
    const [head, tail] = CLEAN.split('**How to cite:**');
    const conflicted = `${head}<<<<<<< HEAD\n---\n\n${stray}\n\n${EXISTING}\n=======\n**How to cite:**${tail}>>>>>>> main\n`;
    const L = lab({ '2026-09.md': BASE_09 }, conflicted);
    try {
        assert.equal(run({ root: L.root, log: L.log }), 0, 'heals');
        assert.ok(L.logs.includes('note  3 conflict marker line(s) in docs/JOURNAL.md taken as boundaries'));
        assert.deepEqual(L.logs.filter((l) => /^(move|skip) /.test(l)), [
            `move  docs/JOURNAL.md:${head.split('\n').length + 3} → docs/journal/2026-09.md: 2026-09-20 — stale-sim entry`,
            'skip  1 already-migrated entry in docs/JOURNAL.md (identical to the monthly file)',
        ], 'the old entry is a duplicate even though the "How to cite" block followed it in the file — the marker ended its body');
        const month = L.read('docs/journal/2026-09.md');
        assert.equal(month, `${BASE_09}\n${stray}\n`);
        assert.equal(L.read('docs/JOURNAL.md'), cleanIndexFor({ '2026-09.md': month }));
        assert.ok(!/^(<{7} |={7}$|>{7} )/m.test(L.read('docs/JOURNAL.md') + month), 'no marker survives anywhere');
        assert.equal(run({ root: L.root, check: true, log: L.log }), 0);
    } finally { L.done(); }

    // diff3 style: the base section is the ancestor neither side kept —
    // dropped, and its differing body is NOT reported as an amendment.
    const diff3 = `${head}<<<<<<< HEAD\n---\n\n${stray}\n\n${EXISTING}\n||||||| merged common ancestors\n---\n\n## 2026-09-05 — Existing entry\n\nOLD base body\n=======\n**How to cite:**${tail}>>>>>>> main\n`;
    const D = lab({ '2026-09.md': BASE_09 }, diff3);
    try {
        assert.equal(run({ root: D.root, log: D.log }), 0);
        assert.ok(D.logs.includes('note  4 conflict marker line(s) in docs/JOURNAL.md taken as boundaries; 5 diff3 base line(s) dropped'));
        assert.equal(D.read('docs/journal/2026-09.md'), `${BASE_09}\n${stray}\n`);
        assert.ok(!D.read('docs/JOURNAL.md').includes('OLD base body'));
    } finally { D.done(); }

    // An unbalanced marker is nobody's text to guess at: refused, nothing written.
    const U = lab({ '2026-09.md': BASE_09 }, `<<<<<<< HEAD\n${stray}\n\n${CLEAN}`);
    try {
        const before = U.snap();
        assert.equal(run({ root: U.root, log: U.log }), 1);
        assert.equal(U.snap(), before);
        assert.ok(U.logs.includes('refused: docs/JOURNAL.md: conflict marker opened at line 1 is never closed'));
    } finally { U.done(); }

    // A `=======` outside a conflict is ordinary text: kept in a moving stray.
    const E = lab({ '2026-09.md': BASE_09 }, `${stray}\n=======\n\n${CLEAN}`);
    try {
        assert.equal(run({ root: E.root, log: E.log }), 0);
        assert.ok(E.read('docs/journal/2026-09.md').endsWith(`${stray}\n=======\n`));
    } finally { E.done(); }
});

// ---------------------------------------------------------------- the post-merge regen

test('pin: the journal-index workflow regenerates on a push to main and commits when the index changed', () => {
    const y = readFileSync(join(ROOT, '.github', 'workflows', 'journal-index.yml'), 'utf8');
    assert.match(y, /^on:\n  push:\n    branches: \[main\]\n    paths:\n(?:      - .*\n)*      - docs\/journal\/\*\*\n/m, 'fires on a push to main that touched the monthly files');
    assert.match(y, /^      - docs\/JOURNAL\.md$/m, '… or the index');
    assert.match(y, /^      - tools\/gen-journal-index\.mjs$/m, '… or the generator');
    assert.match(y, /^permissions:\n  contents: write/m, 'may push the regen commit');
    assert.match(y, /run: npm run docs:journal$/m, 'runs the generator itself — never --check: it must heal, not report');
    assert.match(y, /run: node --test tests\/journal-index\.test\.mjs$/m, 'the journal guards run on the tree it is about to commit');
    assert.match(y, /git diff --quiet -- docs\/JOURNAL\.md docs\/journal/, 'commits only when the index or a monthly file changed');
    assert.match(y, /git add docs\/JOURNAL\.md docs\/journal$/m, 'stages both — a moved stray changes a monthly file too');
    assert.match(y, /git push$/m, 'pushes to main');
    assert.doesNotMatch(y, /^\s*run: .*npm (ci|install)/m, 'zero dependencies — no install step to rot (the comment may say so; a run: line may not)');
    for (const uses of y.match(/uses: .*/g)) assert.match(uses, /@[0-9a-f]{40} # v/, `${uses}: pinned to a full commit SHA, like ci.yml`);
});
