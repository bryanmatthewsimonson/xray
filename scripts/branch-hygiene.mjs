#!/usr/bin/env node
// Branch hygiene — RESET_PLAN §7 R0 ("Branch and PR triage per §9") and
// §9 "The rules going forward": a branch whose tip is an ancestor of
// `main` is deleted (no tag — the commits are on main); a branch with no
// open PR and no commit for fourteen days is tagged
// `archive/<name>-<yyyymmdd>` and then deleted; a branch with an open PR
// is never touched; `main` is never touched; branch names are
// `<lane>/<topic>` (reported, never acted on); at most four open
// non-dependabot PRs (an issue when exceeded).
//
// DRY RUN is the default and is zero-write BY CONSTRUCTION: every write
// (tag, delete, issue) passes through the one gate function `assertApply`
// — once in the executor's wrapped api and once more in the GitHub
// adapter's request layer — and the gate throws unless --apply was given.
// The weekly `hygiene.yml` runs the dry run; a human dispatches --apply.
//
// The archive tag's date is the tip commit's RECORDED calendar date (the
// first ten characters of `git log -1 --format=%cI`, i.e. the committer's
// own offset — what `git log --date=short` shows and what RESET_PLAN §9
// names: `archive/feature-phase-9b-metadata-ui-20260529` for a tip
// committed 2026-05-29T22:28:53-07:00). A UTC conversion would say
// 20260530 there, so this is a deliberate deviation from "UTC" in favour
// of the plan's named tag. The GitHub API fallback (used only when the tip
// object is missing locally) returns UTC, so a fallback-dated tag can
// differ by a day near midnight; the report labels the date source.
//
// Provenance: INTERPRETATION (2026-09-15) — an agent artifact under
// RESET_PLAN R0; the maintainer has not ruled on it.
//
// Usage: node scripts/branch-hygiene.mjs --help

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

export const DEFAULTS = Object.freeze({ staleDays: 14, prCap: 4, protected: ['main'] });
export const LABELS = Object.freeze(['protected', 'open-pr', 'merged', 'stale', 'active']);
export const NAME_RULE = /^[a-z0-9-]+\/[A-Za-z0-9._\/-]+$/;
export const PR_CAP_MARKER = '<!-- branch-hygiene:pr-cap -->';
export const DEPENDABOT = 'dependabot[bot]';
export const WRITE_METHODS = Object.freeze(['createTag', 'deleteBranch', 'createIssue', 'updateIssue']);
const DAY_MS = 86_400_000;

export const USAGE = `Usage: node scripts/branch-hygiene.mjs [options]

Classifies every remote branch (protected / open-pr / merged / stale /
active), prints a Markdown report, and — ONLY with --apply — deletes merged
branches, archive-tags then deletes stale ones, and opens/updates the
PR-cap issue. Without --apply nothing is written (RESET_PLAN §9).

  --apply              execute the plan (default: dry run, zero writes)
  --stale-days N       tag+delete after N days without an open PR (default 14)
  --pr-cap N           max open non-dependabot PRs before an issue (default 4)
  --protected a,b      never-touched branches (default "main")
  --today YYYY-MM-DD   the reference date (midnight UTC; an ISO instant is
                       also accepted); default: the clock
  --json PATH          write the machine-readable report here
  --snapshot PATH      write the classifier's exact input (golden fixture)
  --open-prs PATH      offline open-PR list [{number, head, draft, author,
                       title, created_at}] instead of the GitHub API
  --repo owner/name    repo slug (default: $GITHUB_REPOSITORY, else parsed
                       from \`git remote get-url origin\`)
  --help               this text

Needs \`git\` with a FULL-history checkout (CI: actions/checkout with
fetch-depth: 0 — the ancestor test and tip dates read local objects) and
an up-to-date origin/main. GITHUB_TOKEN / GH_TOKEN authenticates the API
(required for --apply; GETs work unauthenticated on a public repo). The
report is also appended to $GITHUB_STEP_SUMMARY when set. Behind an
HTTPS_PROXY, run with NODE_USE_ENV_PROXY=1 (Node's fetch ignores it otherwise).

Exit codes: 0 clean; 1 a --apply action failed or was refused, or a
collection error; 2 usage error.`;

// ---------------------------------------------------------------- helpers

export function toInstant(today) {
    if (today instanceof Date) return today.getTime();
    if (typeof today === 'number') return today;
    if (typeof today !== 'string') throw new Error('today must be a Date, epoch ms, or ISO string');
    const ms = /^\d{4}-\d{2}-\d{2}$/.test(today) ? Date.parse(`${today}T00:00:00Z`) : Date.parse(today);
    if (Number.isNaN(ms)) throw new Error(`unparseable date: ${today}`);
    return ms;
}

export function archiveTagFor(name, committedAt) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(committedAt ?? ''));
    if (!m) throw new Error(`cannot derive an archive date for ${name} from ${committedAt}`);
    return `archive/${name.replace(/\//g, '-')}-${m[1]}${m[2]}${m[3]}`;
}

export function checkName(name) {
    return NAME_RULE.test(name);
}

export function parseRepoSlug(remoteUrl) {
    const m = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(String(remoteUrl ?? '').trim());
    return m ? `${m[1]}/${m[2]}` : null;
}

/** THE gate. Every write, in the executor and in the adapter, calls this. */
export function assertApply(opts, what) {
    if (!opts || opts.apply !== true) {
        throw new Error(`branch-hygiene: refusing ${what} — this is a DRY RUN (re-run with --apply)`);
    }
}

/** Wraps an api so its write methods pass the gate; reads pass through. */
export function gateWrites(api, opts) {
    const gated = {};
    for (const [k, v] of Object.entries(api)) {
        if (typeof v !== 'function') continue;
        gated[k] = WRITE_METHODS.includes(k)
            ? (...args) => { assertApply(opts, k); return api[k](...args); }
            : (...args) => api[k](...args);
    }
    return gated;
}

// ---------------------------------------------------------------- classify

/**
 * ONE label per branch, in priority order: protected → open-pr → merged →
 * stale → active. `isAncestor(sha, name)` answers "is this tip reachable
 * from origin/main". A tip exactly staleDays old is active (strictly older
 * is stale). The name rule is checked separately and never acted on;
 * protected branches are exempt from it.
 */
export function classify({ branches, openPrHeads = [], protectedBranches = DEFAULTS.protected,
                           isAncestor, today, staleDays = DEFAULTS.staleDays }) {
    if (typeof isAncestor !== 'function') throw new Error('classify needs isAncestor(sha, name)');
    const now = toInstant(today);
    const open = new Set(openPrHeads);
    const prot = new Set(protectedBranches);
    const counts = Object.fromEntries(LABELS.map((l) => [l, 0]));
    const records = branches.map((b) => {
        const rec = { name: b.name, sha: b.sha, committedAt: b.committedAt ?? null, label: 'active',
                      nameOk: prot.has(b.name) || checkName(b.name) };
        if (b.committedAtSource) rec.committedAtSource = b.committedAtSource;
        const tip = Number.isNaN(Date.parse(rec.committedAt ?? '')) ? null : Date.parse(rec.committedAt);
        if (prot.has(b.name)) rec.label = 'protected';
        else if (open.has(b.name)) rec.label = 'open-pr';
        else if (isAncestor(b.sha, b.name) === true) rec.label = 'merged';
        else if (tip === null) rec.note = 'no tip date — kept';
        else if (now - tip > staleDays * DAY_MS) { rec.label = 'stale'; rec.tag = archiveTagFor(b.name, rec.committedAt); }
        counts[rec.label] += 1;
        return rec;
    });
    const violations = records.filter((r) => !r.nameOk).map((r) => r.name).sort();
    return { branches: records, counts, violations };
}

export function prCapStatus(openPrs, cap = DEFAULTS.prCap) {
    const prs = (openPrs ?? [])
        .filter((p) => p.author !== DEPENDABOT)
        .map((p) => ({ number: p.number, head: p.head, draft: !!p.draft, author: p.author, title: p.title }))
        .sort((a, b) => a.number - b.number);
    return { count: prs.length, cap, exceeded: prs.length > cap, prs };
}

export function prCapIssue(prCap) {
    const title = `Branch hygiene: ${prCap.count} open non-dependabot PRs exceeds the cap of ${prCap.cap}`;
    // PR titles and heads are untrusted text: collapse whitespace (a newline
    // would inject a heading or a mention) and strip backticks; the body is
    // descriptive, never an instruction (verifier finding F4).
    const clean = (t) => String(t ?? '').replace(/[`\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
    const rows = prCap.prs.map((p) => `- #${p.number} \`${clean(p.head)}\`${p.draft ? ' (draft)' : ''} — ${clean(p.title)}`);
    const body = [PR_CAP_MARKER, '',
        `RESET_PLAN §9 sets a cap of ${prCap.cap} open non-dependabot pull requests (drafts count; \`${DEPENDABOT}\` is excluded).`,
        `The count is ${prCap.count}. This issue is refreshed in place by \`scripts/branch-hygiene.mjs --apply\`;`,
        'a person closes it once the count is at or under the cap. The open pull requests at the last run:', '',
        ...rows, ''].join('\n');
    return { title, body, marker: PR_CAP_MARKER };
}

// ---------------------------------------------------------------- plan / execute

/** Ordered actions: every tag FIRST, then the deletes, then the issue. */
export function plan({ branches, prCap }) {
    const tags = [];
    const deletes = [];
    for (const b of branches) {
        if (b.label === 'stale') {
            tags.push({ type: 'tag', branch: b.name, tag: b.tag, sha: b.sha });
            deletes.push({ type: 'delete', branch: b.name, sha: b.sha, tag: b.tag, label: b.label });
        } else if (b.label === 'merged') {
            deletes.push({ type: 'delete', branch: b.name, sha: b.sha, label: b.label });
        }
    }
    const actions = [...tags, ...deletes];
    if (prCap?.exceeded) actions.push({ type: 'issue', ...prCapIssue(prCap) });
    return actions;
}

function refusal(action, { protectedBranches, openPrHeads }) {
    if (action.label === 'protected' || protectedBranches.includes(action.branch)
        || DEFAULTS.protected.includes(action.branch)) return 'protected branch';
    if (action.label === 'open-pr' || openPrHeads.includes(action.branch)) return 'branch has an open PR';
    return null;
}

/**
 * Runs the plan against an api {createTag(tag, sha) → {created} |
 * {created:false, existingSha}, getBranchSha(name) → sha|null,
 * deleteBranch(name), findIssue(marker) → {number}|null,
 * createIssue(title, body) → {number}, updateIssue(number, title, body)}.
 * Statuses: dry-run | ok | refused | skipped | failed. Refusals are
 * evaluated even in a dry run (defense in depth); writes never are.
 */
export async function execute(actions, api, opts = {}) {
    const apply = opts.apply === true;
    const guards = { protectedBranches: opts.protectedBranches ?? DEFAULTS.protected, openPrHeads: opts.openPrHeads ?? [] };
    const gated = gateWrites(api, { apply });
    const tagOk = new Map();
    const results = [];
    for (const a of actions) {
        try {
            if (a.type === 'tag') results.push(await runTag(a, gated, apply, tagOk));
            else if (a.type === 'delete') results.push(await runDelete(a, gated, apply, tagOk, guards));
            else if (a.type === 'issue') results.push(await runIssue(a, gated, apply));
            else results.push({ ...a, status: 'refused', reason: `unknown action type ${a.type}` });
        } catch (e) {
            results.push({ ...a, status: 'failed', reason: e?.message ?? String(e) });
        }
    }
    return results;
}

async function runTag(a, api, apply, tagOk) {
    if (!apply) return { ...a, status: 'dry-run' };
    const r = await api.createTag(a.tag, a.sha);
    if (r?.created === true) { tagOk.set(a.branch, true); return { ...a, status: 'ok', detail: 'tag created' }; }
    if (r?.existingSha === a.sha) { tagOk.set(a.branch, true); return { ...a, status: 'ok', detail: 'tag already existed at this sha' }; }
    return { ...a, status: 'refused', reason: `tag already exists at ${r?.existingSha ?? 'an unknown sha'}` };
}

async function runDelete(a, api, apply, tagOk, guards) {
    const why = refusal(a, guards);
    if (why) return { ...a, status: 'refused', reason: why };
    if (!apply) return { ...a, status: 'dry-run' };
    if (a.tag && tagOk.get(a.branch) !== true) return { ...a, status: 'refused', reason: 'archive tag not confirmed — not deleted' };
    const current = await api.getBranchSha(a.branch);
    if (current === null || current === undefined) return { ...a, status: 'skipped', reason: 'already gone' };
    if (current !== a.sha) return { ...a, status: 'skipped', reason: `moved, skipped (now ${current})` };
    await api.deleteBranch(a.branch);
    return { ...a, status: 'ok', detail: 'deleted' };
}

async function runIssue(a, api, apply) {
    if (!apply) return { ...a, status: 'dry-run' };
    const existing = await api.findIssue(a.marker);
    if (existing) {
        await api.updateIssue(existing.number, a.title, a.body);
        return { ...a, status: 'ok', detail: `updated issue #${existing.number}`, number: existing.number };
    }
    const created = await api.createIssue(a.title, a.body);
    return { ...a, status: 'ok', detail: `opened issue #${created?.number ?? '?'}`, number: created?.number };
}

// ---------------------------------------------------------------- data sources

export function gitRunner(cwd = process.cwd()) {
    return (args) => {
        const r = spawnSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
    };
}

export function parseLinkNext(header) {
    for (const part of String(header ?? '').split(',')) {
        const m = /<([^>]+)>\s*;\s*rel="next"/.exec(part);
        if (m) return m[1];
    }
    return null;
}

/** GitHub REST adapter. Non-GET requests pass the gate too (second layer). */
export function githubApi({ repo, token, fetch = globalThis.fetch, apiBase = 'https://api.github.com', apply = false }) {
    if (!repo) throw new Error('githubApi needs a repo slug');
    const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'xray-branch-hygiene' };
    if (token) headers.Authorization = `Bearer ${token}`;
    // A git-legal `#` or `?` in a branch name would otherwise truncate the
    // URL onto a sibling ref (verifier finding F3): encode every segment.
    const enc = (name) => String(name).split('/').map(encodeURIComponent).join('/');
    async function request(method, path, body) {
        if (method !== 'GET') assertApply({ apply }, `${method} ${path}`);
        const url = path.startsWith('http') ? path : `${apiBase}/repos/${repo}/${path}`;
        const res = await fetch(url, { method, headers: body ? { ...headers, 'Content-Type': 'application/json' } : headers,
                                       body: body ? JSON.stringify(body) : undefined });
        const text = await res.text();
        const json = text ? safeJson(text) : null;
        return { status: res.status, ok: res.ok, json, link: res.headers?.get?.('link') ?? null };
    }
    async function paginate(path) {
        const out = [];
        let next = path;
        while (next) {
            const r = await request('GET', next);
            if (!r.ok) throw new Error(`GET ${next} → HTTP ${r.status}`);
            out.push(...(Array.isArray(r.json) ? r.json : []));
            next = parseLinkNext(r.link);
        }
        return out;
    }
    return {
        async listOpenPrs() {
            const raw = await paginate('pulls?state=open&per_page=100');
            return raw
                .filter((p) => (p.head?.repo?.full_name ?? '').toLowerCase() === repo.toLowerCase())
                .map((p) => ({ number: p.number, head: p.head.ref, draft: !!p.draft, author: p.user?.login ?? '',
                               title: p.title ?? '', created_at: p.created_at ?? null }));
        },
        async branchCommitDate(name) {
            const r = await request('GET', `branches/${enc(name)}`);
            if (!r.ok) throw new Error(`GET branches/${name} → HTTP ${r.status}`);
            return r.json?.commit?.commit?.committer?.date ?? null;
        },
        async getBranchSha(name) {
            const r = await request('GET', `git/ref/heads/${enc(name)}`);
            if (r.status === 404) return null;
            if (!r.ok) throw new Error(`GET git/ref/heads/${name} → HTTP ${r.status}`);
            return r.json?.object?.sha ?? null;
        },
        async createTag(tag, sha) {
            const r = await request('POST', 'git/refs', { ref: `refs/tags/${tag}`, sha });
            if (r.ok) return { created: true };
            if (r.status === 422) {
                const cur = await request('GET', `git/ref/tags/${enc(tag)}`);
                if (cur.ok) return { created: false, existingSha: cur.json?.object?.sha ?? null };
            }
            throw new Error(`POST git/refs (${tag}) → HTTP ${r.status} ${r.json?.message ?? ''}`.trim());
        },
        async deleteBranch(name) {
            const r = await request('DELETE', `git/refs/heads/${enc(name)}`);
            if (!r.ok) throw new Error(`DELETE git/refs/heads/${name} → HTTP ${r.status}`);
            return true;
        },
        async findIssue(marker) {
            const issues = await paginate('issues?state=open&per_page=100');
            const hit = issues.find((i) => !i.pull_request && String(i.body ?? '').includes(marker));
            return hit ? { number: hit.number, title: hit.title } : null;
        },
        async createIssue(title, body) {
            const r = await request('POST', 'issues', { title, body });
            if (!r.ok) throw new Error(`POST issues → HTTP ${r.status}`);
            return { number: r.json?.number };
        },
        async updateIssue(number, title, body) {
            const r = await request('PATCH', `issues/${number}`, { title, body });
            if (!r.ok) throw new Error(`PATCH issues/${number} → HTTP ${r.status}`);
            return { number };
        },
    };
}

function safeJson(text) { try { return JSON.parse(text); } catch { return null; } }

/**
 * Gathers the classifier's input: remote heads, tip dates (git, else the
 * API), ancestry against local origin/main, and the open-PR list (offline
 * file or API). An open-PR list that cannot be obtained ABORTS — a branch
 * with an open PR must never be classified from an empty list.
 */
export async function collect({ repo, git, github, openPrs = null }) {
    const notes = [];
    const ls = git(['ls-remote', '--heads', 'origin']);
    if (ls.status !== 0) throw new Error(`git ls-remote failed: ${ls.stderr.trim()}`);
    const heads = ls.stdout.split('\n').filter((l) => l.trim()).map((line) => {
        const [sha, ref] = line.trim().split(/\s+/);
        return { name: ref.replace(/^refs\/heads\//, ''), sha };
    });
    const mainRef = git(['rev-parse', '--verify', 'origin/main']);
    if (mainRef.status !== 0) throw new Error('origin/main is not available locally — fetch first (CI: actions/checkout fetch-depth: 0)');
    const mainSha = mainRef.stdout.trim();
    const remoteMain = heads.find((h) => h.name === 'main');
    const mainDrift = !!(remoteMain && remoteMain.sha !== mainSha);
    if (mainDrift) {
        notes.push(`local origin/main (${mainSha.slice(0, 7)}) differs from the remote's main (${remoteMain.sha.slice(0, 7)}) — run git fetch (fatal under --apply: a rewound remote main would over-count merged)`);
    }
    const shallowProbe = git(['rev-parse', '--is-shallow-repository']);
    const shallow = shallowProbe.status === 0 && shallowProbe.stdout.trim() === 'true';
    if (shallow) notes.push('shallow checkout — the ancestor test is unreliable (fatal under --apply; CI: actions/checkout fetch-depth: 0)');
    const branches = [];
    for (const h of heads) {
        let committedAt = null;
        let committedAtSource = 'git';
        const log = git(['log', '-1', '--format=%cI', h.sha, '--']);
        if (log.status === 0 && log.stdout.trim()) {
            committedAt = log.stdout.trim();
        } else {
            committedAtSource = 'api';
            committedAt = await github.branchCommitDate(h.name);
            notes.push(`${h.name}: tip ${h.sha.slice(0, 7)} missing locally — date from the GitHub API (UTC)`);
        }
        const mb = git(['merge-base', '--is-ancestor', h.sha, mainSha]);
        let ancestorOfMain = mb.status === 0;
        if (mb.status !== 0 && mb.status !== 1) {
            ancestorOfMain = false;
            notes.push(`${h.name}: ancestry unknown (git merge-base exit ${mb.status}) — treated as not merged`);
        }
        branches.push({ name: h.name, sha: h.sha, committedAt, committedAtSource, ancestorOfMain });
    }
    const prs = openPrs ?? await github.listOpenPrs();
    if (!Array.isArray(prs)) throw new Error('open-PR list is not an array — refusing to classify');
    return { repo, mainSha, branches, openPrs: prs, notes, mainDrift, shallow };
}

// ---------------------------------------------------------------- report

const DISPOSITION = { protected: 'never touched', 'open-pr': 'never touched', merged: 'delete (no tag)', stale: 'tag, then delete', active: 'keep' };

export function renderReport({ repo, mainSha, today, staleDays, classification, prCap, actions, results = null, apply = false, notes = [], openPrs = [] }) {
    const { branches, counts, violations } = classification;
    const prByHead = new Map(openPrs.map((p) => [p.head, p.number]));
    const day = (r) => (r.committedAt ? String(r.committedAt).slice(0, 10) : 'no date');
    const L = [];
    L.push(`# Branch hygiene — ${String(today).slice(0, 10)} (${apply ? 'APPLY' : 'DRY RUN'})`, '');
    L.push(`- repo \`${repo}\` · main \`${mainSha.slice(0, 7)}\` · ${branches.length} remote branches`);
    L.push(`- rules: delete merged (ancestor of main); tag \`archive/<name>-<yyyymmdd>\` then delete after ${staleDays} days without an open PR; at most ${prCap.cap} open non-dependabot PRs`, '');
    L.push('| label | count | disposition |', '|---|---|---|');
    for (const l of LABELS) L.push(`| ${l} | ${counts[l]} | ${DISPOSITION[l]} |`);
    L.push('');
    const section = (label, title, fmt) => {
        const rows = branches.filter((b) => b.label === label);
        L.push(`## ${title} (${rows.length})`);
        for (const b of rows) L.push(`- ${fmt(b)}`);
        L.push('');
    };
    section('protected', 'Protected', (b) => `\`${b.name}\``);
    section('open-pr', 'Open PR — kept', (b) => `\`${b.name}\`${prByHead.has(b.name) ? ` #${prByHead.get(b.name)}` : ''}`);
    section('merged', 'Merged — delete', (b) => `\`${b.name}\` (tip ${day(b)})`);
    section('stale', 'Stale — tag, then delete', (b) => `\`${b.name}\` → \`${b.tag}\` (tip ${day(b)}${b.committedAtSource === 'api' ? ', API date' : ''})`);
    section('active', 'Active — keep', (b) => `\`${b.name}\` (tip ${day(b)}${b.note ? `; ${b.note}` : ''})`);
    L.push(`## Name violations (${violations.length}) — reported only, never acted on`);
    for (const v of violations) L.push(`- \`${v}\` is not \`<lane>/<topic>\``);
    L.push('', '## PR cap');
    const list = prCap.prs.map((p) => `#${p.number}${p.draft ? ' (draft)' : ''}`).join(', ');
    L.push(prCap.exceeded
        ? `- ${prCap.count} open non-dependabot PRs exceeds the cap of ${prCap.cap}: ${list} — ${apply ? 'issue opened/updated' : 'with --apply an issue is opened or updated'}`
        : `- ${prCap.count} open non-dependabot PRs, cap ${prCap.cap} — ok`);
    if (notes.length) { L.push('', `## Notes (${notes.length})`); for (const n of notes) L.push(`- ${n}`); }
    const n = (t) => actions.filter((a) => a.type === t).length;
    L.push('', `## Actions (${actions.length}): ${n('tag')} tag, ${n('delete')} delete, ${n('issue')} issue`);
    if (results) {
        const tally = {};
        for (const r of results) tally[r.status] = (tally[r.status] ?? 0) + 1;
        for (const r of results) L.push(`- ${r.status.toUpperCase()} ${r.type} \`${r.branch ?? r.title}\`${r.tag && r.type === 'tag' ? ` → \`${r.tag}\`` : ''}${r.detail ? ` — ${r.detail}` : ''}${r.reason ? ` — ${r.reason}` : ''}`);
        L.push('', `APPLY — ${Object.entries(tally).map(([k, v]) => `${v} ${k}`).join(', ')}`);
    } else {
        L.push('', 'DRY RUN — nothing changed (re-run with --apply)');
    }
    return `${L.join('\n')}\n`;
}

// ---------------------------------------------------------------- CLI

const OPTIONS = {
    apply: { type: 'boolean', default: false },
    'stale-days': { type: 'string' },
    'pr-cap': { type: 'string' },
    protected: { type: 'string' },
    today: { type: 'string' },
    json: { type: 'string' },
    snapshot: { type: 'string' },
    'open-prs': { type: 'string' },
    repo: { type: 'string' },
    help: { type: 'boolean', default: false, short: 'h' },
};

class UsageError extends Error {}

function positiveInt(raw, flag, fallback) {
    if (raw === undefined) return fallback;
    if (!/^\d+$/.test(raw)) throw new UsageError(`${flag} needs a non-negative integer, got "${raw}"`);
    return Number(raw);
}

export function parseCli(argv) {
    let values;
    try {
        ({ values } = parseArgs({ args: argv, options: OPTIONS, strict: true, allowPositionals: false }));
    } catch (e) {
        throw new UsageError(e.message);
    }
    if (values.today !== undefined) {
        try { toInstant(values.today); } catch (e) { throw new UsageError(`--today: ${e.message}`); }
    }
    return {
        help: values.help, apply: values.apply,
        staleDays: positiveInt(values['stale-days'], '--stale-days', DEFAULTS.staleDays),
        prCap: positiveInt(values['pr-cap'], '--pr-cap', DEFAULTS.prCap),
        // --protected ADDS to the defaults, never replaces them: the ancestry
        // base (main) can never be deletable by a flag (verifier finding F1).
        protected: [...new Set([...DEFAULTS.protected,
            ...(values.protected === undefined ? [] : values.protected.split(',').map((s) => s.trim()).filter(Boolean))])],
        today: values.today, json: values.json, snapshot: values.snapshot, openPrs: values['open-prs'], repo: values.repo,
    };
}

/** deps: { git, env, now, fetch, stdout, stderr } — all injectable. */
export async function main(argv, deps = {}) {
    const env = deps.env ?? process.env;
    const out = deps.stdout ?? ((s) => process.stdout.write(s));
    const err = deps.stderr ?? ((s) => process.stderr.write(s));
    let opts;
    try {
        opts = parseCli(argv.filter((a) => a !== ''));   // an unquoted empty expansion is not an argument
    } catch (e) {
        err(`${e.message}\n\n${USAGE}\n`);
        return 2;
    }
    if (opts.help) { out(`${USAGE}\n`); return 0; }
    const git = deps.git ?? gitRunner();
    const token = env.GITHUB_TOKEN || env.GH_TOKEN || '';
    if (opts.apply && !token) { err(`--apply needs GITHUB_TOKEN or GH_TOKEN\n\n${USAGE}\n`); return 2; }
    const repo = opts.repo ?? env.GITHUB_REPOSITORY ?? parseRepoSlug(git(['remote', 'get-url', 'origin']).stdout);
    if (!repo) { err(`cannot determine the repo slug — pass --repo owner/name\n\n${USAGE}\n`); return 2; }
    const todayInstant = opts.today !== undefined ? toInstant(opts.today) : (deps.now ?? (() => new Date()))().getTime();
    const todayIso = new Date(todayInstant).toISOString();
    const github = githubApi({ repo, token, fetch: deps.fetch ?? globalThis.fetch, apply: opts.apply });
    let offlinePrs = null;
    if (opts.openPrs) {
        try { offlinePrs = JSON.parse(readFileSync(opts.openPrs, 'utf8')); } catch (e) { err(`--open-prs: ${e.message}\n`); return 2; }
    }
    let data;
    try {
        data = await collect({ repo, git, github, openPrs: offlinePrs });
    } catch (e) {
        err(`branch-hygiene: ${e.message}\n`);
        return 1;
    }
    if (opts.apply && (data.shallow || data.mainDrift)) {
        err(`branch-hygiene: refusing --apply — ${data.shallow ? 'shallow checkout' : 'local origin/main differs from the remote'}; fetch the full history first\n`);
        return 1;
    }
    const openPrHeads = data.openPrs.map((p) => p.head);
    const bySha = new Map(data.branches.map((b) => [b.sha, b.ancestorOfMain]));
    const classification = classify({ branches: data.branches, openPrHeads, protectedBranches: opts.protected,
                                      isAncestor: (sha) => bySha.get(sha) === true, today: todayInstant, staleDays: opts.staleDays });
    const prCap = prCapStatus(data.openPrs, opts.prCap);
    const actions = plan({ branches: classification.branches, prCap });
    let results = null;
    if (opts.apply) {
        results = await execute(actions, github, { apply: true, protectedBranches: opts.protected, openPrHeads });
    }
    const report = renderReport({ repo, mainSha: data.mainSha, today: todayIso, staleDays: opts.staleDays, classification, prCap,
                                  actions, results, apply: opts.apply, notes: data.notes, openPrs: data.openPrs });
    out(report);
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, report);
    if (opts.snapshot) {
        writeFileSync(opts.snapshot, `${JSON.stringify({ today: todayIso.slice(0, 10), protected: opts.protected, openPrHeads,
            branches: data.branches.map((b) => ({ name: b.name, sha: b.sha, committedAt: b.committedAt, ancestorOfMain: b.ancestorOfMain })) }, null, 2)}\n`);
    }
    if (opts.json) {
        const doc = { generatedAt: todayIso, repo, mainSha: data.mainSha, counts: classification.counts, branches: classification.branches,
                      violations: classification.violations, prCap, actions, notes: data.notes };
        if (results) doc.results = results;
        writeFileSync(opts.json, `${JSON.stringify(doc, null, 2)}\n`);
    }
    if (results && results.some((r) => r.status === 'failed' || r.status === 'refused')) return 1;
    return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => { console.error(e); process.exitCode = 1; });
}
