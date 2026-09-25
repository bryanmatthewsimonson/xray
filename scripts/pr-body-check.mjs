#!/usr/bin/env node
// PR-body checks — RESET_PLAN §8's "PR body contract" and the last step
// of its CI gate list ("PR-body checks (a `fix:` PR needs a `tests/`
// diff or a `no-test rationale:`)"), plus the lane rule ("a PR's src/
// paths must fall in one lane or its body carries `Cross-lane:
// <reason>`") and continuous-improvement Standard 1's graduated check
// (a process-file PR cites the friction it relieves in the JOURNAL).
//
// The rules, each reported as one line naming the rule and the fix:
//   verification-layer  `Verification layer: unit | guard | machine-smoke
//                       | human-soak | none-because <reason>` — always.
//   wire-format         `Wire format: none | additive | breaking | new-kind
//                       | retirement` — when a wire-lane src/ file changed.
//   docs                `Docs: none | <files>` — always.
//   interpretive-steps  `Interpretive steps (n):` with an integer n and
//                       exactly n list items under it — always (0 is fine).
//   cross-lane          `Cross-lane: <reason>` — when the changed src/
//                       paths fall in more than one lane (scripts/lanes.mjs).
//   fix-needs-test      a `fix:`/`fix(…):` title needs a tests/ diff or a
//                       `no-test rationale: <why>` line.
//   journal-presence    a PR touching a process file (PROCESS_FILES) adds
//                       or changes a docs/journal/YYYY-MM.md entry, or its
//                       body cites an existing `JOURNAL YYYY-MM-DD`.
// WARNINGS, never failures: size-cap (> 400 changed src/ lines — §8 exempts
// pure git mv / re-export PRs, which a line count cannot tell apart), a
// malformed `Wire format:` value where none is required, and an
// interpretive step with no recommended default.
//
// HTML comments and fenced code blocks are stripped before parsing, so
// the template's own guidance (and a quoted example) never satisfies a
// check. Dependabot PRs are skipped. Labels are the contract's literals,
// matched at line start through list markers, heading hashes and bold.
//
// Provenance: INTERPRETATION (2026-09-25) — an agent artifact under
// RESET_PLAN R0; the maintainer has not ruled on it. Not a required
// check: making it one is a branch-protection setting only the
// maintainer can change.
//
// Usage: node scripts/pr-body-check.mjs --help

import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { srcLanes, laneOf, isSrc, globToRegExp } from './lanes.mjs';
import { parseEntries, MONTH_FILE_RE } from '../tools/gen-journal-index.mjs';

export const VERIFICATION_LAYERS = Object.freeze(['unit', 'guard', 'machine-smoke', 'human-soak']);
export const WIRE_VALUES = Object.freeze(['none', 'additive', 'breaking', 'new-kind', 'retirement']);
export const SIZE_CAP = 400;
export const DEPENDABOT = 'dependabot[bot]';

// Process files: a change to one of these is a process change, which
// continuous-improvement Standard 1 says must cite the friction it
// relieves. Its graduated check names the first three verbatim; the rest
// are the files that state the process itself.
export const PROCESS_FILES = Object.freeze([
    { glob: '.github/**', why: 'CI, the PR template, Dependabot and CODEOWNERS configure the process (S1 names .github/workflows/**)' },
    { glob: '.claude/skills/**', why: 'the dev-process disciplines (S1 names it)' },
    { glob: 'docs/SMOKE_TEST.md', why: 'the manual verification checklist (S1 names it)' },
    { glob: 'CONTRIBUTING.md', why: 'the contribution and release process' },
    { glob: 'CLAUDE.md', why: 'the conventions every agent session follows' },
]);

const JOURNAL_FILE_RE = /^docs\/journal\/\d{4}-(?:0[1-9]|1[0-2])\.md$/;
const FIX_TITLE_RE = /^fix(?:\([^)]*\))?!?:/i;
const CITE_RE = /\bJOURNAL(?:\.md)?`?,?\s*(?:entr(?:y|ies)\s+(?:of\s+)?)?\(?\s*(\d{4}-\d{2}-\d{2})/g;

export const USAGE = `Usage: node scripts/pr-body-check.mjs [options]

Checks a pull request's title and body against RESET_PLAN §8's PR body
contract and prints one line per failure (rule + fix), then warnings.

  --event PATH       a GitHub event payload (default: $GITHUB_EVENT_PATH)
                     or a bare pull-request object ({title, body, user})
  --title TEXT       override the title
  --body-file PATH   override the body with this file's text
  --author LOGIN     override the author login
  --files PATH       changed files: a JSON array (paths, or GitHub API file
                     objects with filename/additions/deletions), or text —
                     one path per line, or \`git diff --numstat\` lines
  --base REV         with --head: changed files from
  --head REV           \`git diff --numstat --no-renames REV REV\`
  --journal-dir DIR  where the monthly JOURNAL files live (default
                     docs/journal) — a cited JOURNAL date must exist there
  --help             this text

In CI (.github/workflows/pr-body.yml) the checkout is the PR's merge
commit and the files are \`--base HEAD^1 --head HEAD\`.

Exit codes: 0 no failures (warnings allowed) or a skipped Dependabot PR;
1 at least one failure; 2 usage or input error.`;

// ---------------------------------------------------------------- parsing

/**
 * CRLF → LF, then blank out HTML comments (an unterminated one runs to
 * the end, as GitHub renders it) and fenced code blocks. Line breaks are
 * kept, so a line number in a message is the body's own line number.
 */
export function stripNonAsserted(body) {
    const text = String(body ?? '').replace(/\r\n?/g, '\n')
        .replace(/<!--[\s\S]*?(?:-->|$)/g, (c) => c.replace(/[^\n]/g, ''));
    const out = [];
    let fence = null;
    for (const line of text.split('\n')) {
        const m = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
        if (fence) {
            if (m && m[1][0] === fence[0] && m[1].length >= fence.length && /^\s{0,3}[`~]+\s*$/.test(line)) fence = null;
            out.push('');
            continue;
        }
        if (m) fence = m[1];
        out.push(fence ? '' : line);
    }
    return out.join('\n');
}

const LEAD = String.raw`^\s{0,3}(?:(?:[-*+]|\d+[.)])\s+)?(#{1,6}\s+)?(?:\*\*|__)?`;
// The labels are the contract's literals and match case-SENSITIVELY
// (only "no-test rationale" may open a sentence capitalised): a
// lower-case "docs:" line is a commit subject quoted in the body, not
// the Docs field, and "Wire format:" is ecosystem-pm's canonical literal.
const LABELS = Object.freeze({
    verification: { text: 'Verification layer', re: 'Verification layer' },
    wire: { text: 'Wire format', re: 'Wire format' },
    docs: { text: 'Docs', re: 'Docs' },
    crossLane: { text: 'Cross-lane', re: 'Cross-lane' },
    noTest: { text: 'no-test rationale', re: '[Nn]o-test rationale' },
});
const labelRe = (label) => new RegExp(`${LEAD}${label.re}(?:\\*\\*|__)?\\s*:(.*)$`);
const STEPS_RE = new RegExp(`${LEAD}Interpretive steps\\s*\\(([^)]*)\\)(?:\\*\\*|__)?\\s*:?(.*)$`);
const STEPS_LOOSE_RE = new RegExp(`${LEAD}Interpretive steps\\b`);
const HEADING_RE = /^\s{0,3}#{1,6}\s/;
const ITEM_RE = /^(\s*)(?:[-*+]|\d+[.)])\s+\S/;
const FIELD_RES = [...Object.values(LABELS).map(labelRe), STEPS_LOOSE_RE];
const isFieldLine = (line) => FIELD_RES.some((re) => re.test(line));
const indentOf = (line) => /^\s*/.exec(line)[0].length;

/** A field's value with markup gone: backticks and bold markers removed, trimmed. */
export function cleanValue(v) {
    return String(v ?? '').replace(/`/g, '').replace(/\*\*|__/g, '').trim();
}

/** First line carrying `label:` → { value, line } (1-based line), or null. A bare heading takes the next text line as its value. */
export function findField(lines, label) {
    const re = labelRe(label);
    for (let i = 0; i < lines.length; i++) {
        const m = re.exec(lines[i]);
        if (!m) continue;
        let value = cleanValue(m[2]);
        if (!value && m[1]) {
            for (let j = i + 1; j < lines.length; j++) {
                if (!lines[j].trim()) continue;
                if (!HEADING_RE.test(lines[j]) && !isFieldLine(lines[j])) value = cleanValue(lines[j]);
                break;
            }
        }
        return { value, line: i + 1 };
    }
    return null;
}

/** `Interpretive steps (n):` and the list under it → { raw, n, items, line } or { loose: true, line } or null. */
export function findSteps(lines) {
    let at = -1, m = null;
    for (let i = 0; i < lines.length; i++) {
        m = STEPS_RE.exec(lines[i]);
        if (m) { at = i; break; }
        if (STEPS_LOOSE_RE.test(lines[i])) return { loose: true, line: i + 1 };
    }
    if (at < 0) return null;
    const raw = m[2].trim();
    const n = /^\d+$/.test(raw) ? Number(raw) : null;
    const items = [];
    let first = null;          // indentation of the first item
    let prevBlank = false;
    for (let i = at + 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) { prevBlank = true; continue; }
        if (HEADING_RE.test(line) || isFieldLine(line)) break;
        const item = ITEM_RE.exec(line);
        if (item && (first === null || item[1].length <= first + 1)) {
            if (first === null) first = item[1].length;
            items.push(line.trim().replace(/^(?:[-*+]|\d+[.)])\s+/, ''));
        } else if (first !== null && prevBlank && indentOf(line) < first + 2) {
            break;             // a paragraph after the list: the list is over
        }                      // else: intro text before the list, or a continuation / nested line
        prevBlank = false;
    }
    return { raw, n, items, line: at + 1 };
}

/** Every `JOURNAL YYYY-MM-DD` date cited in the text. */
export function citedJournalDates(text) {
    return [...String(text).matchAll(CITE_RE)].map((x) => x[1]);
}

const MENU_RE = /\s\|\s/;
const isPlaceholder = (s) => /^<[^>]*>$/.test(s) || /^(?:…|\.\.\.)$/.test(s);
const quote = (s) => `"${String(s).replace(/[\u0000-\u001f\u007f`"]/g, ' ').slice(0, 80)}${String(s).length > 80 ? '…' : ''}"`;

/** Leading run of allowed tokens joined by + , / & or "and" → { tokens, rest }. */
export function leadingTokens(value, allowed) {
    const tokens = [];
    let rest = value;
    for (;;) {
        const t = /^\s*([a-z][a-z-]*)/i.exec(rest);
        if (!t || !allowed.includes(t[1].toLowerCase())) break;
        tokens.push(t[1].toLowerCase());
        rest = rest.slice(t[0].length);
        const sep = /^\s*(?:\+|,|\/|&|\band\b)\s*/i.exec(rest);
        if (!sep) break;
        rest = rest.slice(sep[0].length);
    }
    return { tokens, rest };
}

// ---------------------------------------------------------------- files

/** Paths/objects → [{ path, additions, deletions }]; a GitHub rename lists both paths. */
export function normalizeFiles(files) {
    const out = [];
    for (const f of files || []) {
        if (typeof f === 'string') { if (f.trim()) out.push({ path: f.trim(), additions: null, deletions: null }); continue; }
        if (!f || typeof f !== 'object') continue;
        const path = f.path ?? f.filename;
        if (!path) continue;
        const num = (x) => (Number.isFinite(Number(x)) && x !== null && x !== '' ? Number(x) : null);
        out.push({ path, additions: num(f.additions), deletions: num(f.deletions), status: f.status });
        if (f.previous_filename && f.previous_filename !== path) out.push({ path: f.previous_filename, additions: 0, deletions: 0, status: 'removed' });
    }
    return out;
}

/** Text → files: `git diff --numstat` lines ("12\t3\tpath", "-\t-\tbinary"), or one path per line. */
export function parseFileList(text) {
    const t = String(text).trim();
    if (!t) return [];
    if (t.startsWith('[')) return normalizeFiles(JSON.parse(t));
    return normalizeFiles(t.split('\n').map((line) => {
        const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line);
        return m ? { path: m[3], additions: m[1] === '-' ? 0 : m[1], deletions: m[2] === '-' ? 0 : m[2] } : line;
    }));
}

const PROCESS_RES = PROCESS_FILES.map((p) => ({ ...p, re: globToRegExp(p.glob) }));
export const isProcessFile = (path) => PROCESS_RES.some((p) => p.re.test(path));
export const isJournalFile = (path) => JOURNAL_FILE_RE.test(path);

// ---------------------------------------------------------------- the check

/**
 * @param {{ title?: string, body?: string, author?: string, files?: Array,
 *           journalDates?: Set<string>|string[]|null }} pr
 *   files: paths or { path|filename, additions, deletions, status };
 *   journalDates: the dates that have a JOURNAL entry — null accepts any
 *   well-formed cited date (the CLI always passes the real set).
 * @returns {{ skipped: string|null, failures: {rule,message,fix}[], warnings: {rule,message,fix}[], notes: string[] }}
 */
export function checkPr({ title = '', body = '', author = '', files = [], journalDates = null } = {}) {
    const result = { skipped: null, failures: [], warnings: [], notes: [] };
    if (author === DEPENDABOT) { result.skipped = `author is ${DEPENDABOT} — the PR body contract does not apply`; return result; }
    const fail = (rule, message, fix) => result.failures.push({ rule, message, fix });
    const warn = (rule, message, fix) => result.warnings.push({ rule, message, fix });

    const lines = stripNonAsserted(body).split('\n');
    const changed = normalizeFiles(files);
    const paths = [...new Set(changed.map((f) => f.path))];

    // (a) Verification layer — always.
    const layerMenu = `${VERIFICATION_LAYERS.join(' | ')} | none-because <reason>`;
    const vl = findField(lines, LABELS.verification);
    if (!vl) {
        fail('verification-layer', 'no "Verification layer:" line', `add a line "Verification layer: X", X one of ${layerMenu} — the layer that can observe this change's principal risk`);
    } else if (!vl.value) {
        fail('verification-layer', `"Verification layer:" is empty (line ${vl.line})`, `fill it with one of ${layerMenu}`);
    } else if (MENU_RE.test(vl.value)) {
        fail('verification-layer', `"Verification layer:" still lists the menu (line ${vl.line})`, `keep only the layer(s) that apply: ${layerMenu}`);
    } else {
        const nb = /^none[- ]because\b[\s:—–-]*(.*)$/i.exec(vl.value);
        if (nb) {
            const reason = nb[1].trim();
            if (!reason || isPlaceholder(reason)) fail('verification-layer', `"none-because" has no reason (line ${vl.line})`, 'write why no layer can observe this change after "none-because"');
        } else if (!leadingTokens(vl.value, VERIFICATION_LAYERS).tokens.length) {
            fail('verification-layer', `"Verification layer:" value ${quote(vl.value)} is not an allowed layer (line ${vl.line})`, `start it with one of ${layerMenu} (combine with "+")`);
        }
    }

    // (b) Wire format — required when a wire-lane src/ file changed.
    const wireFiles = paths.filter((p) => isSrc(p) && laneOf(p).lane === 'wire');
    const wireMenu = WIRE_VALUES.join(' | ');
    const wf = findField(lines, LABELS.wire);
    const wfProblem = !wf || !wf.value ? null
        : MENU_RE.test(wf.value) ? `"Wire format:" still lists the menu (line ${wf.line})`
        : !leadingTokens(wf.value, WIRE_VALUES).tokens.length ? `"Wire format:" value ${quote(wf.value)} is not one of ${wireMenu} (line ${wf.line})`
        : null;
    if (wireFiles.length) {
        const why = `wire-lane file(s) changed: ${wireFiles.slice(0, 5).join(', ')}${wireFiles.length > 5 ? ', …' : ''}`;
        if (!wf || !wf.value) fail('wire-format', `no "Wire format:" value — ${why}`, `add a line "Wire format: X", X one of ${wireMenu}, and say whether published events still parse and older clients degrade gracefully (ecosystem-pm)`);
        else if (wfProblem) fail('wire-format', `${wfProblem} — ${why}`, `start it with one of ${wireMenu}`);
    } else if (wfProblem) {
        warn('wire-format', `${wfProblem}; not required here (no wire-lane file changed)`, `use one of ${wireMenu}, or drop the line`);
    }

    // (c) Docs — always.
    const docs = findField(lines, LABELS.docs);
    if (!docs) fail('docs', 'no "Docs:" line', 'add "Docs: none" or "Docs: <the docs this PR changes>"');
    else if (!docs.value || isPlaceholder(docs.value) || MENU_RE.test(docs.value)) fail('docs', `"Docs:" is empty or still the placeholder (line ${docs.line})`, 'write "none" or the doc files this PR changes');

    // (d) Interpretive steps (n) — always; may be 0.
    const st = findSteps(lines);
    if (!st) {
        fail('interpretive-steps', 'no "Interpretive steps (n):" line', 'add "Interpretive steps (n):" with n the number of judgement calls, then one list item each with its recommended default ("(0):" is a complete answer)');
    } else if (st.loose) {
        fail('interpretive-steps', `"Interpretive steps" has no "(n)" count (line ${st.line})`, 'write it as "Interpretive steps (n):" with an integer n');
    } else if (st.n === null) {
        fail('interpretive-steps', `"Interpretive steps (${st.raw})" — the count is not an integer (line ${st.line})`, 'replace the placeholder with the number of steps, e.g. "Interpretive steps (2):"');
    } else if (st.items.length !== st.n) {
        fail('interpretive-steps', `"Interpretive steps (${st.n}):" lists ${st.items.length} step line(s) (line ${st.line})`, `make the count match: one list item ("- …") per step under the line, or set n to ${st.items.length}`);
    } else {
        st.items.forEach((s, i) => {
            if (!/\bdefault\b/i.test(s)) warn('interpretive-steps', `step ${i + 1} names no recommended default: ${quote(s)}`, 'end the step with "— default: <what you recommend>"');
        });
    }

    // (e) Cross-lane — when src/ paths span more than one lane.
    const sl = srcLanes(paths);
    if (sl.lanes.size) result.notes.push(`src/ lanes touched: ${[...sl.lanes].map(([l, ps]) => `${l} (${ps.length})`).join(', ')}`);
    if (sl.unassigned.length) result.notes.push(`src/ files no lane names (scripts/lanes.mjs UNASSIGNED — not counted for cross-lane): ${sl.unassigned.join(', ')}`);
    for (const c of sl.conflicts) result.notes.push(`lane table conflict for ${c.path}: ${c.lanes.join(' vs ')} — fix scripts/lanes.mjs`);
    if (sl.lanes.size > 1) {
        const cl = findField(lines, LABELS.crossLane);
        const lanes = [...sl.lanes.keys()].join(', ');
        if (!cl || !cl.value || isPlaceholder(cl.value)) fail('cross-lane', `src/ changes span ${sl.lanes.size} lanes (${lanes}) and there is no "Cross-lane: <reason>"`, 'split the PR by lane, or add "Cross-lane: <why these lanes must change together>"');
    }

    // (f) A fix: title needs a tests/ diff or a no-test rationale.
    if (FIX_TITLE_RE.test(title.trim()) && !paths.some((p) => p.startsWith('tests/'))) {
        const nt = findField(lines, LABELS.noTest);
        if (!nt || !nt.value || isPlaceholder(nt.value)) fail('fix-needs-test', 'a fix: PR with no tests/ change and no "no-test rationale:" line', 'add the test that would have caught the bug, or a line "no-test rationale: <why no test can observe it>"');
    }

    // (g) JOURNAL presence for process-file PRs.
    const processFiles = paths.filter(isProcessFile);
    if (processFiles.length) {
        const journalDiff = changed.some((f) => isJournalFile(f.path) && f.status !== 'removed');
        const cites = citedJournalDates(lines.join('\n'));
        const known = journalDates ? new Set(journalDates) : null;
        const good = cites.filter((d) => !known || known.has(d));
        if (!journalDiff && !good.length) {
            const bad = cites.filter((d) => known && !known.has(d));
            fail('journal-presence', `process file(s) changed (${processFiles.slice(0, 4).join(', ')}${processFiles.length > 4 ? ', …' : ''}) with no docs/journal/YYYY-MM.md change and no cited JOURNAL entry${bad.length ? ` (cited ${bad.join(', ')}: no entry on that date)` : ''}`,
                'add an entry at the bottom of docs/journal/YYYY-MM.md naming the friction this relieves (then npm run docs:journal), or cite an existing one as "JOURNAL YYYY-MM-DD"');
        }
    }

    // Size cap — a warning only.
    const srcChanged = changed.filter((f) => isSrc(f.path));
    if (srcChanged.some((f) => f.additions === null || f.deletions === null)) {
        if (srcChanged.length) result.notes.push('src/ line counts unknown (a bare path list) — the size cap was not measured');
    } else {
        const total = srcChanged.reduce((n, f) => n + f.additions + f.deletions, 0);
        if (total > SIZE_CAP) warn('size-cap', `${total} changed src/ lines (cap ${SIZE_CAP}, RESET_PLAN §8)`, 'split the PR — unless it is a pure git mv / re-export PR, which §8 exempts; say so in the body');
    }
    return result;
}

/** One line per failure (rule + fix), then warnings and notes. */
export function formatReport(result) {
    if (result.skipped) return `pr-body-check: skipped — ${result.skipped}\n`;
    const out = [`pr-body-check: ${result.failures.length} failure(s), ${result.warnings.length} warning(s) — RESET_PLAN §8 PR body contract (.github/pull_request_template.md)`];
    for (const f of result.failures) out.push(`FAIL ${f.rule}: ${f.message} — fix: ${f.fix}`);
    for (const w of result.warnings) out.push(`WARN ${w.rule}: ${w.message} — fix: ${w.fix}`);
    for (const n of result.notes) out.push(`NOTE ${n}`);
    return `${out.join('\n')}\n`;
}

// Workflow-command escaping: the message may quote PR-controlled text.
const escData = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

// ---------------------------------------------------------------- CLI

class UsageError extends Error {}

const OPTIONS = {
    help: { type: 'boolean', default: false },
    event: { type: 'string' },
    title: { type: 'string' },
    'body-file': { type: 'string' },
    author: { type: 'string' },
    files: { type: 'string' },
    base: { type: 'string' },
    head: { type: 'string' },
    'journal-dir': { type: 'string' },
};

export function parseCli(argv) {
    let values;
    try {
        ({ values } = parseArgs({ args: argv, options: OPTIONS, strict: true, allowPositionals: false }));
    } catch (e) {
        throw new UsageError(e.message);
    }
    if ((values.base === undefined) !== (values.head === undefined)) throw new UsageError('--base and --head go together');
    if (values.files !== undefined && values.base !== undefined) throw new UsageError('give --files or --base/--head, not both');
    return values;
}

/** Dates that have an entry in the monthly JOURNAL files under dir. */
export function readJournalDates(dir) {
    if (!existsSync(dir)) return new Set();
    const dates = new Set();
    for (const f of readdirSync(dir)) {
        if (!MONTH_FILE_RE.test(f)) continue;
        for (const e of parseEntries(readFileSync(join(dir, f), 'utf8'))) dates.add(e.date);
    }
    return dates;
}

function gitNumstat(base, head, git) {
    const r = git(['diff', '--numstat', '--no-renames', base, head]);
    if (r.status !== 0) throw new Error(`git diff ${base} ${head} failed: ${(r.stderr || '').trim()}`);
    return parseFileList(r.stdout);
}

/** deps: { env, stdout, stderr, git, readFile } — all injectable. */
export function main(argv, deps = {}) {
    const env = deps.env ?? process.env;
    const out = deps.stdout ?? ((s) => process.stdout.write(s));
    const err = deps.stderr ?? ((s) => process.stderr.write(s));
    const readFile = deps.readFile ?? ((p) => readFileSync(p, 'utf8'));
    const git = deps.git ?? ((args) => spawnSync('git', args, { encoding: 'utf8' }));
    let opts;
    try {
        opts = parseCli(argv);
    } catch (e) {
        err(`${e.message}\n\n${USAGE}\n`);
        return 2;
    }
    if (opts.help) { out(`${USAGE}\n`); return 0; }

    let pr = {};
    const eventPath = opts.event ?? env.GITHUB_EVENT_PATH;
    try {
        if (eventPath) {
            const ev = JSON.parse(readFile(eventPath));
            pr = ev.pull_request ?? ev;
        }
        const title = opts.title ?? pr.title ?? '';
        const body = opts['body-file'] !== undefined ? readFile(opts['body-file']) : (pr.body ?? '');
        const author = opts.author ?? pr.user?.login ?? '';
        if (!eventPath && opts.title === undefined && opts['body-file'] === undefined) throw new UsageError('no PR to check: pass --event (or set GITHUB_EVENT_PATH), or --title/--body-file');
        let files = [];
        if (opts.files !== undefined) files = parseFileList(readFile(opts.files));
        else if (opts.base !== undefined) files = gitNumstat(opts.base, opts.head, git);
        const journalDates = readJournalDates(opts['journal-dir'] ?? join('docs', 'journal'));
        const result = checkPr({ title, body, author, files, journalDates });
        const report = formatReport(result);
        out(report);
        if (env.GITHUB_ACTIONS === 'true') {
            for (const f of result.failures) out(`::error title=PR body ${f.rule}::${escData(`${f.message} — fix: ${f.fix}`)}\n`);
            for (const w of result.warnings) out(`::warning title=PR body ${w.rule}::${escData(`${w.message} — fix: ${w.fix}`)}\n`);
        }
        if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `### PR body check\n\n\`\`\`\n${report.replace(/`/g, "'")}\`\`\`\n`);
        return result.failures.length ? 1 : 0;
    } catch (e) {
        err(`pr-body-check: ${e.message}\n`);
        return 2;
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.exitCode = main(process.argv.slice(2));
}
