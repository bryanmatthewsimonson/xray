#!/usr/bin/env node
// Provenance expiry — RESET_PLAN §4.4 item 3. A guard test that rests on
// an agent's reading, not on a ruling, carries
//
//   // Provenance: INTERPRETATION (<date>) — expires <date+90d>
//
// and a guard only part of which rests on a ruling carries the split form
//
//   // Provenance: R-NNN (<the ruled part>); the rest: INTERPRETATION (<date>) — expires <date+90d>
//
// This script lists every such line whose expiry date has come. A line
// with no "expires" date expires 90 days after its own date. It scans
// tests/*.test.mjs only (--dir <path> scans another directory, for
// tests); INTERPRETATION lines in scripts/, src/ and tests/tools/ are not
// scanned and do not expire. A line whose date cannot be read is listed
// as unreadable, and the scan goes on.
//
// It warns; it never fails. It exits 0 whatever it finds, because "a
// build that goes red on a calendar date with no diff is an unexplained
// red build for a maintainer who does not code" (RESET_PLAN §4.4 item 3).
//
// With --issue (the weekly .github/workflows/provenance-expiry.yml) it
// opens one issue, or updates the open one, asking to renew each expired
// guard (get an R-id) or remove it. The open issue is found by the marker
// on the first line of its body, across every page of open issues, and
// only among issues github-actions[bot] opened (the workflow's own
// token), so a marker planted in anyone else's issue is ignored. If the
// open issues cannot be listed, it opens nothing. When nothing has
// expired, it rewrites an open marked issue's body to say so and opens
// nothing; it never closes an issue (closing stays a human act). Without
// --issue it only prints. --today YYYY-MM-DD sets the date (for tests).
//
// Provenance: R-022

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DAYS = 90;
export const ISSUE_TITLE = 'Expired INTERPRETATION guards: renew (get an R-id) or remove';
export const MARKER = '<!-- xray:provenance-expiry -->';
export const BOT_LOGIN = 'github-actions[bot]';
const LINE = /Provenance:.*\bINTERPRETATION \((\d{4}-\d{2}-\d{2})\)/;
const EXPIRES = /expires (\d{4}-\d{2}-\d{2})/;
const LABEL_MAX = 80;

const unreadable = (isoDate) => Number.isNaN(Date.parse(`${isoDate}T00:00:00Z`));

/** ISO date plus whole days, in UTC. */
export function addDays(isoDate, days) {
    return new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}

/**
 * What a provenance line covers: '(whole file)' when it sits in the
 * file's header comment, before any code; else the next non-comment
 * line — a test's title when that line is a test(...) call, otherwise
 * the line itself, trimmed.
 */
export function labelFor(lines, index) {
    if (lines.slice(0, index).every((l) => /^\s*(?:\/\/.*)?$/.test(l))) return '(whole file)';
    for (let j = index + 1; j < lines.length; j++) {
        const t = lines[j].trim();
        if (!t || t.startsWith('//')) continue;
        const m = /^test\(\s*(['"`])((?:\\.|(?!\1).)*)\1/.exec(t);
        const text = m ? m[2].replace(/\\(.)/g, '$1') : t;
        return text.length > LABEL_MAX ? `${text.slice(0, LABEL_MAX - 1)}…` : text;
    }
    return '(end of file)';
}

/** Every INTERPRETATION provenance line in a { path: text } map. */
export function findInterpretations(files) {
    const out = [];
    for (const [path, text] of Object.entries(files)) {
        const lines = text.split('\n');
        lines.forEach((line, i) => {
            const m = line.match(LINE);
            if (!m) return;
            const e = line.match(EXPIRES);
            const label = labelFor(lines, i);
            if (unreadable(m[1]) || (e && unreadable(e[1]))) {
                out.push({ path, line: i + 1, date: m[1], label, unreadable: true });
                return;
            }
            out.push({ path, line: i + 1, date: m[1], expires: e ? e[1] : addDays(m[1], DAYS), label });
        });
    }
    return out;
}

/** The readable entries whose expiry date is on or before `today`. */
export function expired(entries, today) {
    return entries.filter((x) => !x.unreadable && x.expires <= today);
}

export function issueBody(list, today) {
    return [
        MARKER,
        `These guard tests rest on an agent's reading (INTERPRETATION), and their 90 days are up (checked ${today}).`,
        'For each one: renew it (record a ruling in docs/RULINGS.md and cite its R-id), or remove it.',
        '',
        ...list.map((x) => `- \`${x.path}:${x.line}\` (${x.label}): INTERPRETATION since ${x.date}, expired ${x.expires}`)
    ].join('\n');
}

export function clearedBody(today) {
    return [MARKER, `No INTERPRETATION guard has expired (checked ${today}).`].join('\n');
}

export function parseLinkNext(header) {
    for (const part of String(header ?? '').split(',')) {
        const m = /<([^>]+)>\s*;\s*rel="next"/.exec(part);
        if (m) return m[1];
    }
    return null;
}

function readTests(dir) {
    const files = {};
    for (const name of readdirSync(dir).filter((n) => n.endsWith('.test.mjs')).sort()) {
        const abs = join(dir, name);
        const rel = relative(ROOT, abs);
        files[rel.startsWith('..') ? abs : rel.split(sep).join('/')] = readFileSync(abs, 'utf8');
    }
    return files;
}

/**
 * Open the expiry issue, or update the open one (found by MARKER across
 * every page of open issues, among those BOT_LOGIN opened). With
 * onlyIfOpen, update an open one and
 * never open a new one. Lists nothing, opens nothing, when the open
 * issues cannot be listed. Returns what it did.
 */
export async function upsertIssue(body, { onlyIfOpen = false, fetchImpl = globalThis.fetch, env = process.env, log = console.log } = {}) {
    const repo = env.GITHUB_REPOSITORY;
    const token = env.GITHUB_TOKEN;
    if (!repo || !token) {
        log('::warning::--issue needs GITHUB_REPOSITORY and GITHUB_TOKEN; no issue opened');
        return 'skipped';
    }
    const api = `https://api.github.com/repos/${repo}/issues`;
    const headers = {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'xray-provenance-expiry'
    };
    let mine = null;
    for (let url = `${api}?state=open&per_page=100`; url && !mine;) {
        const res = await fetchImpl(url, { headers });
        if (!res.ok) {
            log(`::warning::could not list issues: HTTP ${res.status}; no issue opened`);
            return 'list-failed';
        }
        const page = await res.json();
        mine = (Array.isArray(page) ? page : [])
            .find((i) => !i.pull_request && i.user?.login === BOT_LOGIN && String(i.body ?? '').includes(MARKER)) ?? null;
        url = parseLinkNext(res.headers?.get?.('link'));
    }
    if (!mine && onlyIfOpen) return 'none';
    const res = mine
        ? await fetchImpl(`${api}/${mine.number}`, { method: 'PATCH', headers, body: JSON.stringify({ body }) })
        : await fetchImpl(api, { method: 'POST', headers, body: JSON.stringify({ title: ISSUE_TITLE, body }) });
    if (!res.ok) log(`::warning::could not ${mine ? 'update' : 'open'} the expiry issue: HTTP ${res.status}`);
    return mine ? 'updated' : 'opened';
}

export async function main(argv, deps = {}) {
    const log = deps.log ?? console.log;
    const opt = (name) => { const at = argv.indexOf(name); return at > -1 ? argv[at + 1] : null; };
    const today = opt('--today') ?? new Date().toISOString().slice(0, 10);
    const found = findInterpretations(readTests(opt('--dir') ?? join(ROOT, 'tests')));
    for (const x of found.filter((y) => y.unreadable)) {
        log(`::warning file=${x.path},line=${x.line}::unreadable provenance date`);
    }
    const list = expired(found, today);
    if (!list.length) {
        log(`provenance expiry: no INTERPRETATION guard has expired (${today})`);
        if (argv.includes('--issue')) await upsertIssue(clearedBody(today), { ...deps, onlyIfOpen: true });
        return;
    }
    for (const x of list) {
        log(`::warning file=${x.path},line=${x.line}::INTERPRETATION since ${x.date}, expired ${x.expires}: renew (get an R-id) or remove`);
    }
    if (argv.includes('--issue')) await upsertIssue(issueBody(list, today), deps);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main(process.argv.slice(2))
        .catch((e) => console.log(`::warning::provenance expiry: ${e.message}`))
        .finally(() => { process.exitCode = 0; });
}
