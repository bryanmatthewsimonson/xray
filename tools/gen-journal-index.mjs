// X-Ray — the JOURNAL index generator and stray-entry mover.
//
// docs/journal/YYYY-MM.md hold the entries: one file per month, oldest
// first, a new entry APPENDED AT THE BOTTOM of the current month's
// file. docs/JOURNAL.md — the path every existing citation names — is
// the GENERATED index: newest first, one line per entry, linking into
// the monthly file by GitHub heading anchor. Hand edits to the index
// die at the next regen.
//
//   npm run docs:journal              # heal strays + regenerate; exit 0
//   npm run docs:journal -- --check   # write nothing; exit 1 on drift or
//                                     # a stray (the CI-facing mode)
//
// Why (docs/RESET_PLAN.md §7 R0, "Split the JOURNAL now, not in R6"):
// the single newest-first file was the one file thirty of the
// forty-five open-PR pairs conflicted on — every PR prepends at the
// same line. Per-month files, append-at-bottom and `merge=union` let
// two concurrent entries merge cleanly; the index is regenerated,
// never merged by hand.
//
// SELF-HEALING, RE-RUNNABLE. A PR that pre-dates the split prepends
// its entry into docs/JOURNAL.md; the union merge keeps those lines
// (with whatever old-layout context the merge drags along). Every run
// first MOVES each such stray — an entry heading in the index with its
// body up to the next `## ` heading, either index marker, the GENERATED
// line, a conflict marker, or EOF — into its month's file (created with
// the header when absent; appended at the bottom), then regenerates
// the index from the monthly files. Index bullet lines the merge may
// have swept into a stray's body are dropped (they are regenerated
// anyway). The FIRST run was the migration itself: the whole old file
// was strays. Strays move oldest-first (date ascending; within a date,
// later in the index = older, since the index is newest-first), which
// is what made the migration reproduce the oldest-first layout without
// a hand edit.
//
// THE GENERATOR NEVER DISCARDS TEXT. Every line of the index is one of:
// index residue (the GENERATED line, the markers, the preamble of this
// or the pre-split layout, a month heading, a bullet — all regenerated),
// a stray (moved), a stray identical to its already-migrated entry
// (a duplicate; skipped and counted), or a conflict marker (a boundary;
// dropped). Anything else — a `## ` line that is not `## YYYY-MM-DD —
// title` with a calendar date (hyphen-minus for the em dash, a
// one-digit day, month 13, a CRLF tail), a heading with a leading
// space, prose typed into the index — is UNRECOGNISED: the run lists
// every such line, writes nothing, and exits 1; so does a stray whose
// heading already exists in its month with a DIFFERENT body (an
// amendment the mover cannot apply — the entry in the monthly file is
// the one to edit). `--check` reports the same. A refusal is loud on
// purpose: the alternative was a contributor's entry silently gone.
//
// CONFLICT MARKERS ARE BOUNDARIES. A branch that pre-dates the split
// merging main gets a real conflict in docs/JOURNAL.md (git reads the
// merge attribute from the checked-out side, which has no union rule
// yet). Do not hand-resolve: run the generator on the conflicted file.
// `<<<<<<<`, `=======` and `>>>>>>>` end a stray's body and vanish;
// both sides' text is kept and sorted out by the rules above (a diff3
// `|||||||` base section is dropped — it is the ancestor neither side
// kept). A `=======` outside a conflict is ordinary text.
//
// ENTRY TEXT IS BYTE-PRESERVED: the heading line through the last line
// before the next `## ` heading, trailing whitespace on lines kept,
// with ONE normalisation — the trailing blank lines between entries
// become exactly one blank line (an entry's stored text ends on its
// last non-blank line; a file joins entries with one blank line).
//
// ORDER INSIDE A FILE IS NOT ENFORCED. Append-at-bottom is the
// convention, but a union merge of two concurrent appends can land
// them out of order and that is not a defect: the index sorts by date
// (newest first), then by file position (later = newer). What IS
// enforced, here and in tests/journal-index.test.mjs: every `## `
// heading is a well-formed entry heading with a calendar date, its
// date's month equals the file name, and no heading repeats across
// all files.
//
// SLUGS follow GitHub's heading-anchor rule: lowercase; drop every
// character that is not a letter, mark, decimal digit, connector
// punctuation (`_` — GitHub keeps it), space or hyphen (so the em dash
// and `§` go, and "2026-09-15 — R0" becomes "2026-09-15--r0"); spaces
// become hyphens; a repeated slug within one file gets -1, -2, ….
// Applied to the FULL heading text after "## ", trimmed. Only the
// entry headings take part in de-duplication: the monthly file's H1
// starts with "x-ray" and no entry slug can collide with it.
//
// Limits, stated: a `## ` line inside a fenced code block would be
// read as a heading (none exists today; the guard makes it loud, not
// silent); a genuine body line shaped exactly like an index bullet
// (`- **YYYY-MM-DD** — [..](journal/YYYY-MM.md#..`) is dropped from a
// stray; a future edit to INDEX_PREAMBLE must add the old lines to
// LEGACY_PREAMBLE or a union merge across the edit refuses on them.
//
// Deliberately timestamp-free and Math.random-free: any stamp would
// make the drift guard fail on every run.

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, basename } from 'node:path';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

export const INDEX_PATH = 'docs/JOURNAL.md';
export const JOURNAL_DIR = 'docs/journal';
export const GENERATED_LINE =
    '<!-- GENERATED by tools/gen-journal-index.mjs from docs/journal/*.md — do not edit; run `npm run docs:journal` -->';
export const INDEX_START = '<!-- journal-index:start -->';
export const INDEX_END = '<!-- journal-index:end -->';
// Calendar-shaped (month 01–12, day 01–31); isEntryHeading adds the
// days-in-month check the regex cannot (2026-02-30 passes it).
export const ENTRY_HEADING_RE = /^## (\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])) — (.+)$/;
export const MONTH_FILE_RE = /^(\d{4}-(?:0[1-9]|1[0-2]))\.md$/;
const MONTH_HEADING_RE = /^## \d{4}-(?:0[1-9]|1[0-2])$/;
const TAGS_RE = /^\*\*Tags:\*\*\s*(.*?)\s*$/;
const INDEX_BULLET_RE = /^- \*\*\d{4}-\d{2}-\d{2}\*\* — \[.*\]\(journal\/\d{4}-\d{2}\.md#/;
const STOP_LINES = new Set([INDEX_START, INDEX_END, GENERATED_LINE]);
const SHOWN_LIMIT = 20;

const isBlank = (line) => /^[ \t]*$/.test(line);

export function isCalendarDate(date) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (!m) return false;
    const y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1) return false;
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    return d <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
}

// `## YYYY-MM-DD — title` on a calendar date → { date, title }; else null.
export function parseEntryHeading(line) {
    const m = ENTRY_HEADING_RE.exec(line);
    return m && isCalendarDate(m[1]) ? { date: m[1], title: m[2].trim() } : null;
}

export const isEntryHeading = (line) => parseEntryHeading(line) !== null;

// The hand-editable header of a monthly file: title, pointer, rule,
// `---` (the blank line keeps the rule a rule, not a setext underline).
export function monthlyHeader(month) {
    return [
        `# X-Ray — Engineering Journal — ${month}`,
        'Index: ../JOURNAL.md (generated — run `npm run docs:journal`).',
        "New entries go at the BOTTOM of the current month's file; the index is regenerated, never edited.",
        '',
        '---',
        '',
    ].join('\n');
}

export function monthlyFileFor(date) {
    if (!isCalendarDate(date)) throw new Error(`not a calendar YYYY-MM-DD date: ${date}`);
    return `${JOURNAL_DIR}/${date.slice(0, 7)}.md`;
}

// GitHub's heading anchor. Ruby's \p{Word} = letters, marks, decimal
// digits, connector punctuation; GitHub strips everything else except
// space and hyphen, then turns spaces into hyphens.
export function slugify(heading) {
    return heading.trim().toLowerCase()
        .replace(/[^\p{L}\p{M}\p{Nd}\p{Pc} -]/gu, '')
        .replace(/ /g, '-');
}

// Every `## ` line, well-formed or not — the guards want the bad ones.
export function listHeadings(text) {
    const out = [];
    text.split('\n').forEach((line, i) => {
        if (line.startsWith('## ')) out.push({ line: i + 1, text: line, wellFormed: isEntryHeading(line) });
    });
    return out;
}

function makeEntry(h, line, lineNo) {
    return { line: lineNo, date: h.date, month: h.date.slice(0, 7), heading: line.slice(3).trim(), title: h.title, tags: null, text: '' };
}

function finish(entry, lines, start, end) {
    let last = end;
    while (last > start + 1 && isBlank(lines[last - 1])) last--;
    entry.text = lines.slice(start, last).join('\n');
    for (let i = start + 1; i < last; i++) {
        const t = TAGS_RE.exec(lines[i]);
        if (t) { entry.tags = t[1] || null; break; }
    }
    return entry;
}

// Entries of a monthly file (or any text): heading → line before the
// next `## ` line, trailing blank lines dropped. A malformed `## ` line
// ends the entry before it and starts none.
export function parseEntries(text) {
    const lines = text.split('\n');
    const entries = [];
    let cur = null, start = -1;
    for (let i = 0; i < lines.length; i++) {
        if (!lines[i].startsWith('## ')) continue;
        if (cur) entries.push(finish(cur, lines, start, i));
        cur = null;
        const h = parseEntryHeading(lines[i]);
        if (h) { cur = makeEntry(h, lines[i], i + 1); start = i; }
    }
    if (cur) entries.push(finish(cur, lines, start, lines.length));
    return entries;
}

// The pre-split header of docs/JOURNAL.md, byte-identical across every
// revision of the old file. A union merge with a pre-split branch can
// drag any of these lines along; they are residue, not text to keep.
export const LEGACY_PREAMBLE = [
    '# X-Ray — Engineering Journal',
    '',
    'Chronological log of significant bugs, fixes, design decisions, and',
    'external changes that shape the architecture. Newer entries first.',
    '',
    '**When to add an entry:**',
    '',
    '- A bug whose root cause is non-obvious from the commit diff alone.',
    '- A design decision that future-you or a new contributor might',
    '  reasonably second-guess.',
    '- An external change we had to work around (a platform API shift,',
    '  a protocol-level deprecation, a browser API behaviour change).',
    "- A recurring pattern we've noticed that informs ongoing strategy.",
    '',
    '**Format:** `## YYYY-MM-DD — short title`, tagged with one of',
    '`bug`, `design`, `external`, `pattern`, or a combination. Keep entries',
    'tight — a paragraph or two of context, a concrete link to the commit',
    'or files, and the "so-what" for future readers.',
    '',
    '---',
];

export const INDEX_PREAMBLE = [
    '# X-Ray — Engineering Journal',
    '',
    'Chronological log of significant bugs, fixes, design decisions, and',
    'external changes that shape the architecture. The entries live in',
    '`docs/journal/YYYY-MM.md` — one file per month, oldest first; a new',
    "entry is APPENDED AT THE BOTTOM of the current month's file (a new",
    "month starts by copying the previous file's four header lines). This",
    'file is the generated index, newest first: `npm run docs:journal`',
    'regenerates it (and moves an entry mistakenly added here into its',
    'month), and `tests/journal-index.test.mjs` fails the suite when it is',
    'stale. Never edit it by hand.',
    '',
    '**When to add an entry:**',
    '',
    '- A bug whose root cause is non-obvious from the commit diff alone.',
    '- A design decision that future-you or a new contributor might',
    '  reasonably second-guess.',
    '- An external change we had to work around (a platform API shift,',
    '  a protocol-level deprecation, a browser API behaviour change).',
    "- A recurring pattern we've noticed that informs ongoing strategy.",
    '',
    '**Format:** `## YYYY-MM-DD — short title`, tagged with one of',
    '`bug`, `design`, `external`, `pattern`, or a combination. Keep entries',
    'tight — a paragraph or two of context, a concrete link to the commit',
    'or files, and the "so-what" for future readers.',
    '',
    '**How to cite:** "JOURNAL YYYY-MM-DD" keeps meaning the entry of that',
    'date, wherever it now lives — find it below, or with',
    '`grep -rn "^## YYYY-MM-DD" docs/journal/`. Each line below links to',
    "the entry's heading anchor in its monthly file.",
    '',
    '---',
    '',
];

const RESIDUE_LINES = new Set([...INDEX_PREAMBLE, ...LEGACY_PREAMBLE, ...STOP_LINES]);

// A line the regen reproduces (or replaced): safe to drop from the index.
export function isIndexResidue(line) {
    return isBlank(line) || RESIDUE_LINES.has(line) || INDEX_BULLET_RE.test(line) || MONTH_HEADING_RE.test(line);
}

// Conflict markers → null (a boundary; keeps line numbers aligned).
// States: text → `<<<<<<< ` ours → [`||||||| ` base →] `=======` theirs
// → `>>>>>>> ` text. Base lines are dropped (nulled). Unbalanced
// markers are reported, never guessed at.
function markConflicts(lines) {
    const out = [];
    let state = 'text', markers = 0, dropped = 0, opened = 0;
    for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        if (state === 'text' && l.startsWith('<<<<<<< ')) { state = 'ours'; opened = i + 1; markers++; out.push(null); continue; }
        if (state === 'ours' && /^\|{7}( |$)/.test(l)) { state = 'base'; markers++; out.push(null); continue; }
        if ((state === 'ours' || state === 'base') && l === '=======') { state = 'theirs'; markers++; out.push(null); continue; }
        if (state === 'theirs' && l.startsWith('>>>>>>> ')) { state = 'text'; markers++; out.push(null); continue; }
        if (state === 'base') { dropped++; out.push(null); continue; }
        out.push(l);
    }
    const unbalanced = state === 'text' ? null : `conflict marker opened at line ${opened} is never closed`;
    return { lines: out, markers, dropped, unbalanced };
}

// Strays in the index: each entry heading with its body up to the next
// `## ` line, either marker, the GENERATED line, a conflict marker, or
// EOF. `rest` is the index text with the stray blocks (and the
// conflict markers) cut out; `foreign` lists the lines of `rest` that
// are neither residue nor blank — text a regen would discard.
export function extractStrays(indexText) {
    const conflicts = markConflicts(indexText.split('\n'));
    const lines = conflicts.lines;
    const strays = [], kept = [];
    let i = 0;
    while (i < lines.length) {
        if (lines[i] === null) { i++; continue; }
        const h = parseEntryHeading(lines[i]);
        if (!h) { kept.push({ line: i + 1, text: lines[i] }); i++; continue; }
        let j = i + 1;
        while (j < lines.length && lines[j] !== null && !lines[j].startsWith('## ') && !STOP_LINES.has(lines[j])) j++;
        const body = [lines[i], ...lines.slice(i + 1, j).filter((l) => !INDEX_BULLET_RE.test(l))];
        strays.push(finish(makeEntry(h, lines[i], i + 1), body, 0, body.length));
        i = j;
    }
    return {
        strays,
        rest: kept.map((k) => k.text).join('\n'),
        foreign: kept.filter((k) => !isIndexResidue(k.text)),
        markers: conflicts.markers,
        droppedBase: conflicts.dropped,
        unbalanced: conflicts.unbalanced,
    };
}

// The same entry twice? Runs of blank lines collapse first: a swept-in
// index bullet removed from a stray's body can leave a double blank.
function sameEntry(a, b) {
    const norm = (t) => t.replace(/\n(?:[ \t]*\n)+/g, '\n\n');
    return norm(a) === norm(b);
}

// A stray was written in docs/JOURNAL.md, so its relative repo-path
// links point from docs/; docs/journal/ is one directory deeper. Every
// such link gains one `../` on the way in — the rewrite the migration
// applied to the 246 originals — so a moved entry's links still
// resolve, and an original-depth copy (a branch from before the split
// merging main) compares EQUAL to the monthly file instead of reading
// as an amendment. Found by the first real merge, not by a simulation.
export const REPO_PATH_LINK_RE = /\]\((\.\.?\/[^)\s]*|[\w.-]+\.md(?:#[^)\s]*)?)\)/g;
export function rebaseLinks(text) {
    return text.replace(REPO_PATH_LINK_RE, (m, target) => `](../${target.startsWith('./') ? target.slice(2) : target})`);
}

const show = (text) => (text.length > 100 ? `${text.slice(0, 97)}...` : text).replace(/\r/g, '\\r');

// `entriesByFile`: [{ file, entries }] (or a Map file → entries) in
// file order — `file` is the repo-relative path; the link uses its
// basename. Rows sort newest first: date descending, then file
// position descending (later in the file = newer).
export function renderIndex(entriesByFile) {
    const files = entriesByFile instanceof Map
        ? [...entriesByFile].map(([file, entries]) => ({ file, entries }))
        : entriesByFile;
    const rows = [];
    for (const { file, entries } of files) {
        const name = basename(file), seen = new Map();
        entries.forEach((e, pos) => {
            const base = slugify(e.heading), n = seen.get(base) || 0;
            seen.set(base, n + 1);
            rows.push({ ...e, pos, link: `journal/${name}#${n ? `${base}-${n}` : base}` });
        });
    }
    rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.pos - a.pos));
    const out = [GENERATED_LINE, ...INDEX_PREAMBLE, INDEX_START];
    let month = null;
    for (const r of rows) {
        if (r.month !== month) { month = r.month; out.push('', `## ${month}`, ''); }
        out.push(`- **${r.date}** — [${r.title}](${r.link})${r.tags ? ` · ${r.tags}` : ''}`);
    }
    out.push('', INDEX_END, '');
    return out.join('\n');
}

// Strip trailing blank lines, end with exactly one newline.
function endWithOneNewline(text) {
    const lines = text.split('\n');
    while (lines.length && isBlank(lines[lines.length - 1])) lines.pop();
    return lines.join('\n') + '\n';
}

export function readJournalDir(root = ROOT) {
    const dir = join(root, JOURNAL_DIR);
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter((f) => f.endsWith('.md')).sort().map((f) => {
        if (!MONTH_FILE_RE.test(f)) throw new Error(`${JOURNAL_DIR}/${f}: not a YYYY-MM.md monthly file`);
        return { file: `${JOURNAL_DIR}/${f}`, text: readFileSync(join(dir, f), 'utf8') };
    });
}

// Validates and groups; throws on the shapes the guards forbid.
export function collectEntries(files) {
    const seen = new Map(), byFile = [];
    for (const { file, text } of files) {
        const month = basename(file).slice(0, 7);
        for (const h of listHeadings(text)) {
            if (!h.wellFormed) throw new Error(`${file}:${h.line}: not an entry heading (## YYYY-MM-DD — title, a calendar date): ${h.text}`);
        }
        const entries = parseEntries(text);
        for (const e of entries) {
            if (e.month !== month) throw new Error(`${file}:${e.line}: entry dated ${e.date} belongs in ${monthlyFileFor(e.date)}`);
            if (seen.has(e.heading)) throw new Error(`${file}:${e.line}: duplicate heading (also ${seen.get(e.heading)}): ${e.heading}`);
            seen.set(e.heading, `${file}:${e.line}`);
        }
        byFile.push({ file, entries });
    }
    return byFile;
}

// Returns the exit code. Writes only when nothing blocks; `--check`
// writes nothing and reports what a run would refuse or change.
export function run({ check = false, root = ROOT, log = console.log } = {}) {
    const indexAbs = join(root, INDEX_PATH);
    const indexText = existsSync(indexAbs) ? readFileSync(indexAbs, 'utf8') : '';
    const blocking = [];

    const { strays, foreign, markers, droppedBase, unbalanced } = extractStrays(indexText);
    if (markers) log(`note  ${markers} conflict marker line(s) in ${INDEX_PATH} taken as boundaries${droppedBase ? `; ${droppedBase} diff3 base line(s) dropped` : ''}`);
    if (unbalanced) blocking.push(`${INDEX_PATH}: ${unbalanced}`);

    // (a) unrecognised text: refuse rather than discard.
    for (const f of foreign.slice(0, SHOWN_LIMIT)) log(`text  ${INDEX_PATH}:${f.line}: ${show(f.text)}`);
    if (foreign.length > SHOWN_LIMIT) log(`text  … and ${foreign.length - SHOWN_LIMIT} more`);
    if (foreign.length) {
        const crlf = foreign.some((f) => f.text.includes('\r'));
        blocking.push(`${foreign.length} unrecognised line(s) in ${INDEX_PATH} would be discarded by a regen — ` +
            'fix the heading to `## YYYY-MM-DD — title` (a calendar date, an em dash, no leading space) or move the text by hand' +
            (crlf ? '; a line ending in \\r is CRLF — the repo pins LF for *.md' : ''));
    }

    // (b) place strays, oldest first, in memory.
    strays.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : b.line - a.line));
    const monthly = new Map(readJournalDir(root).map(({ file, text }) => [file, text]));
    const touched = new Set();
    let identical = 0;
    for (const s of strays) {
        const rel = monthlyFileFor(s.date);
        const text = monthly.get(rel) ?? monthlyHeader(s.month);
        const moved = rebaseLinks(s.text);
        const existing = parseEntries(text).find((e) => e.heading === s.heading);
        if (existing) {
            if (sameEntry(existing.text, moved)) { identical++; continue; }
            log(`skip  ${INDEX_PATH}:${s.line} — ${rel}:${existing.line} has this heading with a DIFFERENT body (amendment NOT applied): ${s.heading}`);
            blocking.push(`${INDEX_PATH}:${s.line} amends ${rel}:${existing.line} — edit the entry in its monthly file, then delete the copy from ${INDEX_PATH}`);
            continue;
        }
        monthly.set(rel, endWithOneNewline(text) + '\n' + moved + '\n');
        touched.add(rel);
        log(`move  ${INDEX_PATH}:${s.line} → ${rel}: ${s.heading}`);
    }
    if (identical) log(`skip  ${identical} already-migrated entr${identical === 1 ? 'y' : 'ies'} in ${INDEX_PATH} (identical to the monthly file)`);

    // (c) render from the monthly files as they would be after the move.
    const files = [...monthly].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([file, text]) => ({ file, text }));
    const rendered = renderIndex(collectEntries(files));

    if (check) {
        const problems = [...blocking];
        if (strays.length) problems.push(`${strays.length} stray entr${strays.length === 1 ? 'y' : 'ies'} in ${INDEX_PATH}`);
        if (rendered !== indexText) problems.push(`${INDEX_PATH} is stale — run npm run docs:journal`);
        for (const p of problems) log(`check: ${p}`);
        return problems.length ? 1 : 0;
    }
    if (blocking.length) {
        for (const p of blocking) log(`refused: ${p}`);
        log('nothing written');
        return 1;
    }
    mkdirSync(join(root, JOURNAL_DIR), { recursive: true });
    for (const rel of touched) writeFileSync(join(root, rel), monthly.get(rel), 'utf8');
    writeFileSync(indexAbs, rendered, 'utf8');
    log(`wrote ${INDEX_PATH} (${rendered.split('\n').length} lines; ${strays.length - identical} stray(s) moved, ${identical} duplicate(s) dropped)`);
    return 0;
}

// CLI: `npm run docs:journal [-- --check]`
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    const check = process.argv.includes('--check');
    try {
        process.exitCode = run({ check });
    } catch (err) {
        console.error(`gen-journal-index: ${err.message}`);
        process.exitCode = 2;
    }
}
