// PR-body checks — pins scripts/pr-body-check.mjs and scripts/lanes.mjs
// against RESET_PLAN §8 (the PR body contract, the lanes table and its
// Cross-lane rule, the size cap, the `fix:` → tests/ gate) and
// continuous-improvement Standard 1's graduated check (a process-file PR
// adds a JOURNAL entry or cites one). Every rule is exercised both ways;
// the template itself is parsed as shipped (left blank it fails) and as
// filled in (it passes). Nothing here reads the network or git.
//
// House idiom: a POSITIVE sanity test proves the module, the CLI and the
// template are seen, then the rules are pinned one by one.
//
// Provenance: INTERPRETATION (2026-09-25) — an agent artifact under
// RESET_PLAN R0; the maintainer has not ruled on it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
    checkPr, formatReport, stripNonAsserted, findField, findSteps, citedJournalDates, normalizeFiles,
    parseFileList, isProcessFile, main, readJournalDates,
    VERIFICATION_LAYERS, WIRE_VALUES, SIZE_CAP, DEPENDABOT, PROCESS_FILES,
} from '../scripts/pr-body-check.mjs';
import { LANES, UNASSIGNED, PATTERNS, laneOf, srcLanes, globToRegExp } from '../scripts/lanes.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const rel = (abs) => relative(ROOT, abs).split(sep).join('/');
const SCRIPT = join(ROOT, 'scripts', 'pr-body-check.mjs');
const TEMPLATE = readFileSync(join(ROOT, '.github', 'pull_request_template.md'), 'utf8');
const JOURNAL = new Set(['2026-09-21', '2026-09-24']);

// A body that satisfies every always-on rule; tests vary one thing at a time.
const GOOD = [
    '## What', '', 'Does a thing.', '',
    'Verification layer: unit',
    'Docs: none',
    'Interpretive steps (0):',
].join('\n');
const run = (over = {}) => checkPr({ title: 'chore(x): a thing', body: GOOD, author: 'someone', files: ['scripts/x.mjs'], journalDates: JOURNAL, ...over });
const rules = (r) => r.failures.map((f) => f.rule);
const warns = (r) => r.warnings.map((w) => w.rule);
const withLine = (label, value) => GOOD.replace(new RegExp(`^${label}.*$`, 'm'), value);

function fillTemplate(t, { layer = 'unit', docs = 'none', steps = ['Kept X as Y — default: keep.'], extra = '' } = {}) {
    return t
        .replace(/^Verification layer:$/m, `Verification layer: ${layer}`)
        .replace(/^Docs:$/m, `Docs: ${docs}`)
        .replace(/^Interpretive steps \(n\):$/m, `Interpretive steps (${steps.length}):\n${steps.map((s) => `- ${s}`).join('\n')}${extra ? `\n\n${extra}` : ''}`);
}

// The same, with each answer written in place of the comment under its
// label — the layout the template invites.
function fillUnder(t, { layer = 'unit', docs = 'none' } = {}) {
    return t
        .replace(/^(Verification layer:\n)<!--[\s\S]*?-->/m, `$1${layer}`)
        .replace(/^(Docs:\n)<!--[\s\S]*?-->/m, `$1${docs}`)
        .replace(/^Interpretive steps \(n\):\n<!--[\s\S]*?-->/m, 'Interpretive steps (1):\n- Kept X as Y — default: keep.');
}

// ---------------------------------------------------------------- sanity

test('sanity: the module exports, the CLI answers --help, and the template carries the four §8 lines', () => {
    for (const f of [checkPr, formatReport, stripNonAsserted, findField, findSteps, main, laneOf, srcLanes]) assert.equal(typeof f, 'function');
    assert.deepEqual([...VERIFICATION_LAYERS], ['unit', 'guard', 'machine-smoke', 'human-soak']);
    assert.deepEqual([...WIRE_VALUES], ['none', 'additive', 'breaking', 'new-kind', 'retirement']);
    assert.equal(SIZE_CAP, 400);
    const help = spawnSync(process.execPath, [SCRIPT, '--help'], { encoding: 'utf8' });
    assert.equal(help.status, 0);
    assert.match(help.stdout, /^Usage: node scripts\/pr-body-check\.mjs/);
    assert.equal(spawnSync(process.execPath, [SCRIPT, '--bogus'], { encoding: 'utf8' }).status, 2);
    assert.equal(spawnSync(process.execPath, [SCRIPT, '--base', 'HEAD'], { encoding: 'utf8' }).status, 2, '--base without --head');
    const visible = stripNonAsserted(TEMPLATE);
    for (const line of ['Verification layer:', 'Wire format:', 'Docs:', 'Interpretive steps (n):']) {
        assert.ok(visible.split('\n').includes(line), `the template shows "${line}" on its own line`);
    }
    assert.ok(!/Firefox/.test(visible), 'the Firefox checkbox is gone until Firefox parity is a stated goal');
    assert.match(visible, /^## What$/m);
    assert.match(visible, /^## Why$/m);
    assert.match(TEMPLATE, /^Cross-lane: /m, 'the optional Cross-lane line is offered (inside a comment)');
    assert.ok(!/^Cross-lane:/m.test(visible), 'but not as a visible, pre-satisfied line');
    assert.deepEqual(rules(run()), [], 'the minimal good body passes');
});

// ---------------------------------------------------------------- the template

test('template: left blank it FAILS (layer, docs, steps) — its own guidance satisfies nothing', () => {
    const r = checkPr({ title: 'chore: x', body: TEMPLATE, author: 'someone', files: ['scripts/x.mjs'], journalDates: JOURNAL });
    assert.deepEqual(rules(r).sort(), ['docs', 'interpretive-steps', 'verification-layer']);
    // With a wire-lane file changed, the empty Wire format line fails too.
    const w = checkPr({ title: 'chore: x', body: TEMPLATE, author: 'someone', files: ['src/shared/event-builder.js'], journalDates: JOURNAL });
    assert.ok(rules(w).includes('wire-format'));
});

test('template: filled in correctly it PASSES, including the wire, cross-lane and process-file cases', () => {
    assert.deepEqual(rules(checkPr({ title: 'chore: x', body: fillTemplate(TEMPLATE), author: 'a', files: ['scripts/x.mjs'], journalDates: JOURNAL })), []);
    const wire = fillTemplate(TEMPLATE).replace(/^Wire format:$/m, 'Wire format: additive — old events still parse; old clients ignore the new tag.');
    assert.deepEqual(rules(checkPr({ title: 'feat: x', body: wire, author: 'a', files: ['src/shared/event-builder.js', 'tests/x.test.mjs'], journalDates: JOURNAL })), []);
    const cross = fillTemplate(TEMPLATE, { extra: 'Cross-lane: the reader calls the new builder argument.' });
    assert.deepEqual(rules(checkPr({ title: 'feat: x', body: cross, author: 'a', files: ['src/reader/index.js', 'src/portal/index.js'], journalDates: JOURNAL })), []);
    const proc = fillTemplate(TEMPLATE).replace('Closes #', 'Relieves the friction in JOURNAL 2026-09-21.\n\nCloses #');
    assert.deepEqual(rules(checkPr({ title: 'ci: x', body: proc, author: 'a', files: ['.github/workflows/ci.yml'], journalDates: JOURNAL })), []);
    const fixed = fillTemplate(TEMPLATE).replace('## How I tested', '## How I tested\n\nno-test rationale: a CSS colour; nothing a test can see.');
    assert.deepEqual(rules(checkPr({ title: 'fix(reader): x', body: fixed, author: 'a', files: ['src/reader/index.css'], journalDates: JOURNAL })), []);
});

test('template: answers written UNDER the labels (in place of the comment, or below it) PASS; an off-menu one still fails', () => {
    const chk = (body, files = ['scripts/x.mjs']) => rules(checkPr({ title: 'chore: x', body, author: 'a', files, journalDates: JOURNAL }));
    assert.deepEqual(chk(fillUnder(TEMPLATE)), [], 'values on the line under the label');
    assert.deepEqual(chk(fillUnder(TEMPLATE).replace(/^Docs:$/m, '**Docs:**').replace(/^Verification layer:$/m, '**Verification layer:**')), [], 'bold labels');
    assert.deepEqual(chk(fillUnder(TEMPLATE, { layer: '- unit + guard', docs: '- docs/SMOKE_TEST.md\n- docs/NIP_DRAFT.md' })), [], 'as list items');
    const below = fillTemplate(TEMPLATE).replace(/^Docs: none$/m, 'Docs:').replace(/^(Docs:\n<!--[\s\S]*?-->)/m, '$1\n\ndocs/SMOKE_TEST.md');
    assert.deepEqual(chk(below), [], 'the comment kept, the answer under it');
    const wire = fillUnder(TEMPLATE).replace(/^(Wire format:\n)<!--[\s\S]*?-->/m, '$1additive — old events still parse.');
    assert.deepEqual(chk(wire, ['src/shared/event-builder.js']), []);
    assert.deepEqual(chk(fillUnder(TEMPLATE, { layer: 'manual' })), ['verification-layer'], 'the value under the label is still checked');
    assert.deepEqual(chk(fillUnder(TEMPLATE, { docs: '<files>' })), ['docs']);
    // An empty label never borrows the next label, a heading, or a checkbox.
    assert.deepEqual(findField(['Docs:', '', 'Interpretive steps (0):'], { re: 'Docs' }).value, '');
    assert.deepEqual(findField(['Docs:', '## How I tested', 'none'], { re: 'Docs' }).value, '');
    assert.deepEqual(findField(['no-test rationale:', '', '- [ ] Chrome'], { re: 'no-test rationale' }).value, '');
});

// ---------------------------------------------------------------- stripping

test('stripping: HTML comments (even unterminated) and fenced code never satisfy a check; CRLF bodies parse', () => {
    const commented = `<!--\n${GOOD}\n-->`;
    assert.deepEqual(rules(run({ body: commented })).sort(), ['docs', 'interpretive-steps', 'verification-layer']);
    assert.deepEqual(rules(run({ body: `## What\n<!-- open comment, never closed\n${GOOD}` })).sort(), ['docs', 'interpretive-steps', 'verification-layer']);
    assert.deepEqual(rules(run({ body: `\`\`\`md\n${GOOD}\n\`\`\`` })).sort(), ['docs', 'interpretive-steps', 'verification-layer']);
    assert.deepEqual(rules(run({ body: `~~~\n${GOOD}\n~~~\n\n${GOOD}` })), [], 'text after a closed fence is read');
    assert.deepEqual(rules(run({ body: GOOD.replace(/\n/g, '\r\n') })), [], 'CRLF');
    assert.equal(stripNonAsserted('a <!-- b --> c'), 'a  c');
    // Line numbers survive stripping: a message's "(line N)" is the body's own line.
    const shifted = '<!--\none\ntwo\n-->\n```\nx\n```\nVerification layer: nope';
    assert.equal(stripNonAsserted(shifted).split('\n').length, shifted.split('\n').length);
    assert.match(run({ body: shifted }).failures.find((f) => f.rule === 'verification-layer').message, /\(line 8\)/);
    // A `<!--` inside inline code or a fence is text, as GitHub shows it;
    // a fence inside a comment is comment; a one-line ``` x ``` is a span.
    for (const pre of ['Mentions `<!--` here.', 'And ``a <!-- b`` too.', '```\n<!-- never closed\n```', '<!--\n```\n-->', '``` x ```']) {
        assert.deepEqual(rules(run({ body: `${pre}\n${GOOD}` })), [], pre);
    }
    assert.equal(stripNonAsserted('a `<!--` b'), 'a `<!--` b');
    assert.deepEqual(rules(run({ body: `an unmatched \` then <!-- a real comment\n${GOOD}` })).sort(), ['docs', 'interpretive-steps', 'verification-layer']);
    // A JOURNAL citation inside a comment is not a citation.
    const r = run({ files: ['CLAUDE.md'], body: `${GOOD}\n<!-- JOURNAL 2026-09-21 -->` });
    assert.deepEqual(rules(r), ['journal-presence']);
});

// ---------------------------------------------------------------- (a) Verification layer

test('(a) verification-layer: every allowed value, combinations, none-because with a reason, and the markdown dressings pass', () => {
    for (const v of [...VERIFICATION_LAYERS, 'unit + guard', 'unit, machine-smoke', 'human-soak — the popup', 'none-because docs only', 'none because a comment-only diff', '`unit`']) {
        assert.deepEqual(rules(run({ body: withLine('Verification layer', `Verification layer: ${v}`) })), [], v);
    }
    for (const line of ['**Verification layer:** unit', '**Verification layer: unit**', '- Verification layer: guard', '### Verification layer: unit', '## Verification layer:\n\nmachine-smoke']) {
        assert.deepEqual(rules(run({ body: withLine('Verification layer', line) })), [], line);
    }
});

test('(a) verification-layer: missing, empty, a bare none, none-because with no reason, an unknown layer, the menu, or the wrong case all FAIL', () => {
    for (const line of ['', 'Verification layer:', 'Verification layer: none', 'Verification layer: none-because', 'Verification layer: none-because <…>',
        'Verification layer: units', 'Verification layer: manual', 'Verification layer: unit | guard | machine-smoke', 'verification layer: unit',
        'Verification layer: none-because TBD', 'Verification layer: none-because ?']) {
        assert.deepEqual(rules(run({ body: withLine('Verification layer', line) })), ['verification-layer'], JSON.stringify(line));
    }
});

// ---------------------------------------------------------------- (b) Wire format

test('(b) wire-format: REQUIRED when a wire-lane src/ file changed — missing, empty, off-menu or menu FAIL; each allowed value passes', () => {
    const files = ['src/shared/extraction-publish.js', 'tests/x.test.mjs'];
    for (const body of [GOOD, `${GOOD}\nWire format:`, `${GOOD}\n**Wire format: no kind or tag-layout change**`, `${GOOD}\nWire format: none | additive`]) {
        const r = run({ body, files });
        assert.deepEqual(rules(r), ['wire-format'], body);
        assert.match(r.failures[0].message, /extraction-publish\.js/, 'names the file that made it required');
    }
    for (const v of [...WIRE_VALUES, 'additive + retirement', 'none — no tag moved']) {
        assert.deepEqual(rules(run({ body: `${GOOD}\nWire format: ${v}`, files })), [], v);
    }
    assert.deepEqual(rules(run({ body: `${GOOD}\n## Wire format:\n\nnone. Old events parse.`, files })), [], 'ecosystem-pm\'s section form');
    for (const f of ['src/shared/event-builder.js', 'src/shared/identity/account-publish.js', 'src/shared/metadata/builders.js', 'src/shared/wire-copy.js']) {
        assert.deepEqual(rules(run({ files: [f] })), ['wire-format'], f);
    }
});

test('(b) wire-format: NOT required elsewhere — absent passes; a malformed value is only a warning; docs/NIP_DRAFT.md does not trigger it', () => {
    assert.deepEqual(rules(run({ files: ['src/shared/platforms/instagram.js', 'tests/x.test.mjs'] })), []);
    const r = run({ body: `${GOOD}\n**Wire format: no kind or tag-layout change**`, files: ['src/shared/platforms/instagram.js'] });
    assert.deepEqual(rules(r), []);
    assert.deepEqual(warns(r), ['wire-format']);
    assert.deepEqual(rules(run({ files: ['docs/NIP_DRAFT.md'] })), [], 'the wire lane names NIP_DRAFT, but only builders/publishers require the line');
});

// ---------------------------------------------------------------- (c) Docs

test('(c) docs: "none" or a file list passes; missing, empty, a placeholder, the menu, or a lower-case commit subject FAILS', () => {
    for (const v of ['Docs: none', 'Docs: docs/SMOKE_TEST.md, docs/NIP_DRAFT.md', '- **Docs:** CONTRIBUTING.md']) {
        assert.deepEqual(rules(run({ body: withLine('Docs', v) })), [], v);
    }
    for (const v of ['', 'Docs:', 'Docs: <files>', 'Docs: none | <files>', 'docs: tidy the README', 'Docs: TBD', 'Docs: todo.']) {
        assert.deepEqual(rules(run({ body: withLine('Docs', v) })), ['docs'], JSON.stringify(v));
    }
});

// ---------------------------------------------------------------- (d) Interpretive steps

test('(d) interpretive-steps: (0) alone, and (n) with exactly n list items (bullets or numbers; nested/continuation lines not counted) pass', () => {
    const cases = [
        'Interpretive steps (0):',
        'Interpretive steps (0): none',
        'Interpretive steps (2):\n- A — default: a.\n- B — default: b.',
        'Interpretive steps (2):\n\n1. A — default: a.\n2. B — default: b.\n\nMore prose after the list.',
        'Interpretive steps (2):\n- A — default: a,\n  wrapped onto a second line.\n  - a nested aside\n- B — default: b.',
        '## Interpretive steps (1)\n\n* A — default: a.',
        '**Interpretive steps (1):**\nSome intro sentence.\n\n- A — default: a.',
    ];
    for (const c of cases) assert.deepEqual(rules(run({ body: withLine('Interpretive steps', c) })), [], c);
    const st = findSteps('Interpretive steps (2):\n- a default\n- b default\n\n## How I tested\n- [ ] Chrome'.split('\n'));
    assert.equal(st.items.length, 2, 'the next heading ends the list');
});

test('(d) interpretive-steps: missing, "(n)", no count, or a count that disagrees with the list FAILS; a step with no default warns', () => {
    for (const c of ['', 'Interpretive steps (n):', 'Interpretive steps: 2', 'Interpretive steps (two):',
        'Interpretive steps (2):\n- A — default: a.', 'Interpretive steps (1):\n- A — default: a.\n- B — default: b.',
        'Interpretive steps (1): A — default: a.', 'Interpretive steps (0):\n- A — default: a.',
        'Interpretive steps (2):\n- A — default: a.\n\nA paragraph ends the list.\n\n- B — default: b.']) {
        assert.deepEqual(rules(run({ body: withLine('Interpretive steps', c) })), ['interpretive-steps'], JSON.stringify(c));
    }
    const r = run({ body: withLine('Interpretive steps', 'Interpretive steps (1):\n- Chose the obvious thing.') });
    assert.deepEqual(rules(r), []);
    assert.deepEqual(warns(r), ['interpretive-steps']);
});

// ---------------------------------------------------------------- (e) Cross-lane

test('(e) cross-lane: src/ paths in two lanes need "Cross-lane: <reason>"; one lane, non-src paths and unassigned files do not', () => {
    const two = ['src/reader/index.js', 'src/portal/index.js'];
    const r = run({ files: two });
    assert.deepEqual(rules(r), ['cross-lane']);
    assert.match(r.failures[0].message, /portal/);
    assert.match(r.failures[0].message, /reader/);
    assert.deepEqual(rules(run({ files: two, body: `${GOOD}\nCross-lane: the portal renders the reader's new field.` })), []);
    assert.deepEqual(rules(run({ files: two, body: `${GOOD}\nCross-lane: <reason>` })), ['cross-lane'], 'a placeholder is not a reason');
    assert.deepEqual(rules(run({ files: two, body: `${GOOD}\nCross-lane: TBD` })), ['cross-lane'], 'nor is TBD');
    assert.deepEqual(rules(run({ files: two, body: `${GOOD}\nCross-lane:\nthe portal renders the reader's new field.` })), [], 'the reason on the next line');
    assert.deepEqual(rules(run({ files: ['src/reader/index.js', 'src/reader/pdf-engine.js', 'src/shared/claim-model.js'] })), [], 'one lane');
    assert.deepEqual(rules(run({ files: ['src/reader/index.js', 'scripts/x.mjs', 'tests/x.test.mjs', 'docs/NIP_DRAFT.md'] })), [], 'only src/ counts');
    const u = run({ files: ['src/reader/index.js', 'src/shared/utils.js'] });
    assert.deepEqual(rules(u), [], 'an UNASSIGNED file is reported, never guessed into a lane');
    assert.ok(u.notes.some((n) => /src\/shared\/utils\.js/.test(n)));
});

// ---------------------------------------------------------------- (f) fix: needs a test

test('(f) fix-needs-test: a fix: / fix(scope): title needs a tests/ change or a no-test rationale; other types are exempt', () => {
    for (const title of ['fix: x', 'fix(portal): x', 'Fix(reader)!: x']) {
        assert.deepEqual(rules(run({ title, files: ['src/reader/index.js'] })), ['fix-needs-test'], title);
        assert.deepEqual(rules(run({ title, files: ['src/reader/index.js', 'tests/reader.test.mjs'] })), [], `${title} + tests/`);
        assert.deepEqual(rules(run({ title, files: ['src/reader/index.js'], body: `${GOOD}\nno-test rationale: a colour only a person can judge.` })), []);
        assert.deepEqual(rules(run({ title, files: ['src/reader/index.js'], body: `${GOOD}\n- No-test rationale: copy change.` })), []);
        assert.deepEqual(rules(run({ title, files: ['src/reader/index.js'], body: `${GOOD}\nno-test rationale:` })), ['fix-needs-test'], 'empty');
        assert.deepEqual(rules(run({ title, files: ['src/reader/index.js'], body: `${GOOD}\nno-test rationale: tbd` })), ['fix-needs-test'], 'TBD');
        assert.deepEqual(rules(run({ title, files: ['src/reader/index.js'], body: `${GOOD}\nno-test rationale:\n\n- [ ] Chrome` })), ['fix-needs-test'], 'a checkbox is not a rationale');
        assert.deepEqual(rules(run({ title, files: ['src/reader/index.js'], body: `${GOOD}\nno-test rationale:\na colour only a person can judge.` })), [], 'the rationale on the next line');
    }
    for (const title of ['feat: x', 'chore(deps): x', 'docs: fix typo', 'prefix: x']) {
        assert.deepEqual(rules(run({ title, files: ['src/reader/index.js'] })), [], title);
    }
});

// ---------------------------------------------------------------- (g) JOURNAL presence

test('(g) journal-presence: every process-file glob needs a docs/journal/ change or a cited, EXISTING JOURNAL entry', () => {
    const touched = ['.github/workflows/ci.yml', '.github/pull_request_template.md', '.github/dependabot.yml', '.claude/skills/automator/SKILL.md',
        'docs/SMOKE_TEST.md', 'CONTRIBUTING.md', 'CLAUDE.md'];
    for (const f of touched) {
        assert.ok(isProcessFile(f), f);
        assert.deepEqual(rules(run({ files: [f] })), ['journal-presence'], f);
        assert.deepEqual(rules(run({ files: [f, 'docs/journal/2026-09.md', 'docs/JOURNAL.md'] })), [], `${f} + an entry`);
        assert.deepEqual(rules(run({ files: [f], body: `${GOOD}\nSee JOURNAL 2026-09-21.` })), [], `${f} + a cite`);
    }
    assert.equal(PROCESS_FILES.length, 5);
    for (const f of ['README.md', 'docs/ROADMAP.md', 'scripts/x.mjs', 'tools/smoke/run.mjs', 'tests/structure-guards.test.mjs', 'package.json']) {
        assert.ok(!isProcessFile(f), f);
    }
    const idx = run({ files: ['CLAUDE.md', 'docs/JOURNAL.md'] });
    assert.deepEqual(rules(idx), ['journal-presence'], 'the generated index alone is not an entry');
    // Built at run time: tests/journal-index.test.mjs scans this file's
    // source for textual JOURNAL cites, and this one must not resolve.
    const bogus = `JOURNAL ${['2026', '02', '30'].join('-')}`;
    const bad = run({ files: ['CLAUDE.md'], body: `${GOOD}\nSee ${bogus}.` });
    assert.deepEqual(rules(bad), ['journal-presence']);
    assert.match(bad.failures[0].message, /2026-02-30: no entry on that date/);
    assert.deepEqual(rules(run({ files: ['CLAUDE.md'], body: `${GOOD}\nSee ${bogus}.`, journalDates: null })), [], 'no journal set given: any well-formed date');
    assert.deepEqual(rules(run({ files: [{ filename: 'CLAUDE.md' }, { filename: 'docs/journal/2026-08.md', status: 'removed' }] })), ['journal-presence'], 'deleting a month is not an entry');
    assert.deepEqual(rules(run({ files: [{ filename: 'CLAUDE.md', additions: 1, deletions: 0 }, { filename: 'docs/journal/2026-09.md', status: 'modified', additions: 0, deletions: 4 }] })), ['journal-presence'], 'nor is trimming one');
    // The CI path: git diff --numstat carries no status, only line counts.
    const ns = (text) => rules(run({ files: parseFileList(text) }));
    assert.deepEqual(ns('0\t500\tdocs/journal/2026-01.md\n3\t0\tCLAUDE.md'), ['journal-presence'], 'numstat: a month deleted');
    assert.deepEqual(ns('0\t2\tdocs/journal/2026-09.md\n3\t0\tCLAUDE.md'), ['journal-presence'], 'numstat: lines only removed');
    assert.deepEqual(ns('9\t0\tdocs/journal/2026-09.md\n3\t0\tCLAUDE.md'), [], 'numstat: an entry added');
    assert.deepEqual(ns('1\t1\tdocs/journal/2026-09.md\n3\t0\tCLAUDE.md'), [], 'numstat: an entry changed');
    assert.deepEqual(citedJournalDates('docs/JOURNAL.md 2026-09-07; the JOURNAL entry of 2026-09-21; JOURNAL (2026-09-24)'), ['2026-09-07', '2026-09-21', '2026-09-24']);
});

// ---------------------------------------------------------------- skip + size cap + report

test('dependabot: a Dependabot PR is skipped whatever its body; the CLI exits 0', () => {
    const r = checkPr({ title: 'chore(deps-dev): bump x', body: '', author: DEPENDABOT, files: ['.github/workflows/ci.yml', 'src/shared/event-builder.js'] });
    assert.ok(r.skipped);
    assert.deepEqual(r.failures, []);
    assert.match(formatReport(r), /skipped/);
    assert.ok(run({ author: 'dependabot' }).skipped === null, 'only the bot login is skipped');
});

test('size-cap: more than 400 changed src/ lines is a WARNING, never a failure; non-src lines do not count', () => {
    const f = (path, a, d) => ({ filename: path, additions: a, deletions: d });
    const over = run({ files: [f('src/reader/index.js', 300, 101), f('tests/x.test.mjs', 900, 0)] });
    assert.deepEqual(rules(over), []);
    assert.deepEqual(warns(over), ['size-cap']);
    assert.match(over.warnings[0].message, /401 changed src\/ lines/);
    assert.deepEqual(warns(run({ files: [f('src/reader/index.js', 300, 100), f('docs/x.md', 5000, 0)] })), []);
    assert.ok(run({ files: ['src/reader/index.js'] }).notes.some((n) => /size cap was not measured/.test(n)));
    // numstat text, binary rows, and a GitHub rename (both paths count)
    assert.deepEqual(parseFileList('12\t3\tsrc/a.js\n-\t-\tsrc/b.png'), [
        { path: 'src/a.js', additions: 12, deletions: 3, status: undefined }, { path: 'src/b.png', additions: 0, deletions: 0, status: undefined }]);
    assert.deepEqual(normalizeFiles([{ filename: 'src/portal/x.js', previous_filename: 'src/reader/x.js', additions: 0, deletions: 0 }]).map((x) => x.path),
        ['src/portal/x.js', 'src/reader/x.js']);
});

test('report: one line per failure naming the rule and the fix, then warnings and notes', () => {
    const r = checkPr({ title: 'fix: x', body: '', author: 'a', files: [{ filename: 'src/shared/event-builder.js', additions: 500, deletions: 0 }, { filename: 'CLAUDE.md', additions: 1, deletions: 0 }], journalDates: JOURNAL });
    assert.deepEqual(rules(r).sort(), ['docs', 'fix-needs-test', 'interpretive-steps', 'journal-presence', 'verification-layer', 'wire-format']);
    const lines = formatReport(r).trim().split('\n');
    const failLines = lines.filter((l) => l.startsWith('FAIL '));
    assert.equal(failLines.length, r.failures.length);
    for (const l of failLines) assert.match(l, /^FAIL [a-z-]+: .+ — fix: .+/);
    assert.ok(lines.some((l) => /^WARN size-cap: /.test(l)));
});

// ---------------------------------------------------------------- CLI

test('CLI: reads an event payload and a file list, exits 1 on failure and 0 on pass, and escapes annotations', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pr-body-'));
    const ev = join(dir, 'event.json');
    const files = join(dir, 'files.json');
    writeFileSync(files, JSON.stringify([{ filename: 'scripts/x.mjs', additions: 3, deletions: 1 }]));
    writeFileSync(ev, JSON.stringify({ pull_request: { title: 'chore: x', body: GOOD, user: { login: 'a' } } }));
    const out = [];
    assert.equal(main(['--event', ev, '--files', files], { env: {}, stdout: (s) => out.push(s), stderr: () => {} }), 0);
    const hostile = 'Verification layer: nope%0A::warning::pwned\n::set-output name=x::y';
    writeFileSync(ev, JSON.stringify({ title: 'chore: x', body: hostile, user: { login: 'a' } }));   // a bare PR object works too
    const out2 = [];
    assert.equal(main(['--event', ev, '--files', files], { env: { GITHUB_ACTIONS: 'true' }, stdout: (s) => out2.push(s), stderr: () => {} }), 1);
    const text = out2.join('');
    assert.match(text, /^::error title=PR body verification-layer::/m);
    assert.match(text, /nope%250A::warning::pwned/, 'a %-sequence in PR text is escaped, so the runner cannot decode it into a new line');
    for (const l of text.split('\n')) assert.ok(!/^::(?:set-output|warning::pwned)/.test(l), 'body text never starts a workflow-command line');
    // The runner reads the legacy `##[cmd]` form ANYWHERE in a line: no
    // PR-controlled text (a value, a step count, a file path) carries one out.
    writeFileSync(ev, JSON.stringify({ title: 'chore: x', body: 'Verification layer: ##[warning]a\nDocs: none\nInterpretive steps (##[error]b):', user: { login: 'a' } }));
    writeFileSync(files, JSON.stringify([{ filename: 'src/##[add-mask]c.js', additions: 1, deletions: 0 }]));
    const out3 = [];
    assert.equal(main(['--event', ev, '--files', files], { env: { GITHUB_ACTIONS: 'true' }, stdout: (s) => out3.push(s), stderr: () => {} }), 1);
    assert.match(out3.join(''), /##\\\[warning\]a/, 'quoted, but inert');
    assert.ok(!/##\[/.test(out3.join('')), 'no legacy workflow command survives');
    const git = (args) => ({ status: 0, stdout: '4\t0\tsrc/reader/index.js\n', stderr: '', args });
    assert.equal(main(['--event', ev, '--base', 'HEAD^1', '--head', 'HEAD'], { env: {}, stdout: () => {}, stderr: () => {}, git }), 1);
    // End to end on the CI path: a journal month only trimmed is no entry.
    writeFileSync(ev, JSON.stringify({ title: 'chore: x', body: GOOD, user: { login: 'a' } }));
    const trim = () => ({ status: 0, stdout: '0\t40\tdocs/journal/2026-08.md\n2\t0\tCLAUDE.md\n', stderr: '' });
    const out4 = [];
    assert.equal(main(['--event', ev, '--base', 'HEAD^1', '--head', 'HEAD'], { env: {}, stdout: (s) => out4.push(s), stderr: () => {}, git: trim }), 1);
    assert.match(out4.join(''), /^FAIL journal-presence: /m);
    assert.equal(main([], { env: {}, stdout: () => {}, stderr: () => {} }), 2, 'nothing to check is a usage error');
    const dates = readJournalDates(join(ROOT, 'docs', 'journal'));
    assert.ok(dates.has('2026-09-21') && dates.size >= 50, `the real JOURNAL dates are read (${dates.size})`);
});

// ---------------------------------------------------------------- the workflow

test('workflow: its own file, the right triggers, read-only, and the PR title/body are never interpolated into a script', () => {
    const wf = readFileSync(join(ROOT, '.github', 'workflows', 'pr-body.yml'), 'utf8');
    assert.match(wf, /types: \[opened, edited, synchronize, reopened, ready_for_review\]/);
    assert.match(wf, /^permissions:\n {2}contents: read$/m);
    assert.ok(!/pull_request_target/.test(wf.replace(/^\s*#.*$/gm, '')), 'never pull_request_target');
    const code = wf.replace(/^\s*#.*$/gm, '');
    const exprs = [...code.matchAll(/\$\{\{\s*([^}]*?)\s*\}\}/g)].map((m) => m[1]);
    assert.deepEqual([...new Set(exprs)], ['github.event.pull_request.number'], 'the only expression is the PR number (the concurrency key): no PR text is ever interpolated');
    assert.equal(code.match(/^\s*permissions:/gm).length, 1, 'one permissions block — no job-level override');
    assert.ok(!/\bwrite\b|write-all|read-all/.test(code), 'no write scope anywhere');
    assert.match(wf, /node scripts\/pr-body-check\.mjs --base HEAD\^1 --head HEAD/);
    assert.match(wf, /fetch-depth: 2/);
    assert.ok(!/pr-body-check/.test(readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8')), 'not a ci.yml step');
});

// ---------------------------------------------------------------- lanes

function walk(dir, out = []) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.name.startsWith('.') && dir !== ROOT) continue;
        if (['node_modules', '.git', 'dist', 'web-ext-artifacts', 'out'].includes(e.name)) continue;
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p, out);
        else out.push(rel(p));
    }
    return out;
}
const SRC_FILES = walk(join(ROOT, 'src')).sort();

test('lanes: every src/ file maps to exactly one lane or is listed UNASSIGNED — set-equal both ways, no ties', () => {
    assert.ok(SRC_FILES.length >= 250, `the walk sees ${SRC_FILES.length} src/ files`);
    assert.deepEqual(LANES.map((l) => l.lane), ['bus', 'capture', 'identity', 'wire', 'store', 'reader', 'portal', 'surfaces', 'llm', 'toolchain'], 'the §8 rows, in order');
    const unassigned = [], conflicts = [];
    for (const f of SRC_FILES) {
        const r = laneOf(f);
        if (r.conflict) conflicts.push(`${f}: ${r.conflict.join(' vs ')}`);
        else if (!r.lane) unassigned.push(f);
    }
    assert.deepEqual(conflicts, [], 'two lanes tie at the top rank');
    assert.deepEqual(unassigned, [...UNASSIGNED].sort(),
        'a src/ file no §8 row names must be listed in UNASSIGNED (and a listed file that gained a lane must leave the list)');
});

test('lanes: every table entry still names something in the tree (the table cannot rot)', () => {
    const all = [...walk(ROOT)];
    const dead = PATTERNS.filter((p) => !all.some((f) => p.re.test(f))).map((p) => `${p.lane}: ${p.glob}`);
    assert.deepEqual(dead, []);
});

test('lanes: the precedence rules — exact > every *-publish.js > name glob > directory glob — on the contested paths', () => {
    const expect = {
        'src/shared/llm-jobs.js': 'bus', 'src/background/llm-jobs.js': 'bus',             // exact beats llm-*.js
        'src/shared/corpus-prompts.js': 'llm', 'src/shared/case-bundle.js': 'store',       // exact beats corpus-*/case-*
        'src/shared/corpus-publish.js': 'wire', 'src/shared/entity-page-publish.js': 'wire',
        'src/shared/follow-publish.js': 'wire', 'src/shared/identity/account-publish.js': 'wire',
        'src/reader/pdf-engine.js': 'reader', 'src/reader/llm-review.js': 'reader', 'src/reader/lens-section.js': 'reader',
        'src/shared/pdf-layout.js': 'capture', 'src/shared/claim-model.js': 'reader', 'src/shared/audit/corpus-audit.js': 'portal',
        'src/page/nip07-bridge.js': 'identity', 'src/page/api-interceptor.js': 'capture',
        'tests/structure-guards.test.mjs': 'toolchain', 'rules/csp-strip.json': 'capture',
    };
    for (const [p, lane] of Object.entries(expect)) assert.equal(laneOf(p).lane, lane, p);
    assert.equal(laneOf('src/shared/utils.js').lane, null);
    assert.ok(globToRegExp('src/**/*-publish.js').test('src/shared/x-publish.js'));
    assert.ok(globToRegExp('src/**/*-publish.js').test('src/x-publish.js'), '**/ spans zero segments');
    assert.ok(!globToRegExp('src/shared/claim-*.js').test('src/shared/sub/claim-x.js'), '* stays in one segment');
    const s = srcLanes(['src/reader/a.js', 'src/portal/b.js', 'src/shared/utils.js', 'CLAUDE.md']);
    assert.deepEqual([...s.lanes.keys()].sort(), ['portal', 'reader']);
    assert.deepEqual(s.unassigned, ['src/shared/utils.js']);
});
