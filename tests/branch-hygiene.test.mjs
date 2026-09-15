// Branch hygiene — pins scripts/branch-hygiene.mjs against RESET_PLAN §7
// R0 ("Branch and PR triage per §9") and §9 "The 65 merged branches" /
// "The rules going forward": one label per branch in priority order
// (protected → open-pr → merged → stale → active), the archive tag name
// (`archive/feature-phase-9b-metadata-ui-20260529`), the fourteen-day
// boundary, the `<lane>/<topic>` name rule (reported, never acted on),
// the four-PR cap with dependabot excluded, the tag-BEFORE-delete
// executor with its refusals, and — above all — that a run without
// --apply performs zero writes by construction. The --apply path runs
// ONLY against the mocks in tests/tools/hygiene-harness.mjs; nothing
// here touches GitHub or a real repo. The golden snapshot
// tests/fixtures/hygiene/branches-2026-09-15.json is the classifier's
// exact input on 2026-09-15 (82 heads; regenerate with --snapshot).
//
// House idiom: a POSITIVE sanity test proves the module and CLI are seen,
// then the guards enforce. Every date is injected — no test reads the clock.
//
// Provenance: INTERPRETATION (2026-09-15) — an agent artifact under
// RESET_PLAN R0; the maintainer has not ruled on it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import * as H from './tools/hygiene-harness.mjs';
import {
    classify, plan, execute, assertApply, gateWrites, githubApi, collect, prCapStatus, prCapIssue,
    archiveTagFor, checkName, parseLinkNext, parseRepoSlug, toInstant, renderReport, main, parseCli,
    DEFAULTS, PR_CAP_MARKER, WRITE_METHODS,
} from '../scripts/branch-hygiene.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(ROOT, 'scripts', 'branch-hygiene.mjs');
const FIXTURE = join(ROOT, 'tests', 'fixtures', 'hygiene', 'branches-2026-09-15.json');
const TODAY = '2026-09-15';
const OLD = '2026-05-29T22:28:53-07:00';
const RECENT = '2026-09-14T12:00:00Z';
const NEVER = () => false;
const ALWAYS = () => true;
const cls = (branches, extra = {}) => classify({ branches, isAncestor: NEVER, today: TODAY, ...extra });
const one = (b, extra) => cls([b], extra).branches[0];
const del = (branch, sha, label, tag) => ({ type: 'delete', branch, sha, label, ...(tag ? { tag } : {}) });
const tag = (branch, sha, t) => ({ type: 'tag', branch, sha, tag: t });

// ---------------------------------------------------------------- sanity

test('sanity: the module exports the pure functions and the CLI answers --help with exit 0', () => {
    for (const f of [classify, plan, execute, assertApply, gateWrites, githubApi, collect, main]) assert.equal(typeof f, 'function');
    assert.deepEqual(DEFAULTS, { staleDays: 14, prCap: 4, protected: ['main'] });
    const help = spawnSync(process.execPath, [SCRIPT, '--help'], { encoding: 'utf8' });
    assert.equal(help.status, 0);
    assert.match(help.stdout, /^Usage: node scripts\/branch-hygiene\.mjs/);
    assert.match(help.stdout, /--apply/);
    assert.match(help.stdout, /fetch-depth: 0/);
    const bad = spawnSync(process.execPath, [SCRIPT, '--bogus'], { encoding: 'utf8' });
    assert.equal(bad.status, 2);
    assert.equal(spawnSync(process.execPath, [SCRIPT, '--today', 'nope'], { encoding: 'utf8' }).status, 2);
});

// ---------------------------------------------------------------- each rule, minimal

test('rule: a protected branch is labelled protected and never planned against', () => {
    const r = one(H.branch('main', 'm', OLD), { isAncestor: ALWAYS });
    assert.equal(r.label, 'protected');
    assert.deepEqual(plan({ branches: [r] }), []);
});

test('rule: an open-PR head is labelled open-pr even when old', () => {
    assert.equal(one(H.branch('feat/x', 'a', OLD), { openPrHeads: ['feat/x'] }).label, 'open-pr');
});

test('rule: an ancestor of main is merged — delete, no tag', () => {
    const r = one(H.branch('feat/x', 'a', RECENT), { isAncestor: ALWAYS });
    assert.equal(r.label, 'merged');
    assert.equal(r.tag, undefined);
    assert.deepEqual(plan({ branches: [r] }), [del('feat/x', 'a', 'merged')]);
});

test('rule: no open PR and a tip older than staleDays is stale — tag then delete', () => {
    const r = one(H.branch('feat/x', 'a', OLD));
    assert.equal(r.label, 'stale');
    assert.equal(r.tag, 'archive/feat-x-20260529');
    assert.deepEqual(plan({ branches: [r] }), [tag('feat/x', 'a', 'archive/feat-x-20260529'), del('feat/x', 'a', 'stale', 'archive/feat-x-20260529')]);
});

test('rule: a recent tip with no PR is active — kept, no action', () => {
    const r = one(H.branch('feat/x', 'a', RECENT));
    assert.equal(r.label, 'active');
    assert.deepEqual(plan({ branches: [r] }), []);
});

test('rule: a branch with no tip date is kept (active) with a note, never tagged from nothing', () => {
    const r = one(H.branch('feat/x', 'a', null));
    assert.equal(r.label, 'active');
    assert.match(r.note, /no tip date/);
});

// ---------------------------------------------------------------- priority order

test('priority: open-pr beats merged and stale — §9 "never touches a branch with an open PR"', () => {
    const r = one(H.branch('feat/x', 'a', OLD), { isAncestor: ALWAYS, openPrHeads: ['feat/x'] });
    assert.equal(r.label, 'open-pr');
    assert.deepEqual(plan({ branches: [r] }), []);
});

test('priority: protected beats all — even with an open PR, an ancestor tip, and an old date', () => {
    const r = one(H.branch('main', 'm', OLD), { isAncestor: ALWAYS, openPrHeads: ['main'] });
    assert.equal(r.label, 'protected');
});

test('priority: merged beats stale — an old ancestor is deleted without a tag', () => {
    const r = one(H.branch('feat/x', 'a', OLD), { isAncestor: ALWAYS });
    assert.equal(r.label, 'merged');
    assert.equal(r.tag, undefined);
});

test('counts carry every label, zero-filled', () => {
    const c = cls([H.branch('main', 'm', OLD), H.branch('feat/a', 'a', OLD)], { isAncestor: ALWAYS }).counts;
    assert.deepEqual(c, { protected: 1, 'open-pr': 0, merged: 1, stale: 0, active: 0 });
});

// ---------------------------------------------------------------- stale boundary

test('stale boundary: exactly N days old is active; N days + 1 s is stale', () => {
    assert.equal(toInstant(TODAY), Date.parse('2026-09-15T00:00:00Z'));
    assert.equal(one(H.branch('feat/x', 'a', '2026-09-01T00:00:00Z')).label, 'active');
    assert.equal(one(H.branch('feat/x', 'a', '2026-08-31T23:59:59Z')).label, 'stale');
    assert.equal(one(H.branch('feat/x', 'a', '2026-09-08T00:00:00Z'), { staleDays: 7 }).label, 'active');
    assert.equal(one(H.branch('feat/x', 'a', '2026-09-07T23:59:59Z'), { staleDays: 7 }).label, 'stale');
    assert.throws(() => toInstant('not a date'), /unparseable/);
});

// ---------------------------------------------------------------- tag name

test('tag name: slashes become dashes and the date is the tip commit\'s RECORDED calendar date (§9\'s named tag)', () => {
    assert.equal(archiveTagFor('feature/phase-9b-metadata-ui', OLD), 'archive/feature-phase-9b-metadata-ui-20260529');
    // A UTC conversion would say 20260530 for a -07:00 tip at 22:28 — the plan names 20260529.
    assert.equal(new Date(OLD).toISOString().slice(0, 10), '2026-05-30');
    assert.equal(archiveTagFor('docs/a/b', '2026-01-02T03:04:05Z'), 'archive/docs-a-b-20260102');
    assert.throws(() => archiveTagFor('feat/x', null), /archive date/);
});

// ---------------------------------------------------------------- name rule

test('name rule: "hotfix" and "Feature/x" violate, "docs/a/b" is ok, protected is exempt, violations are never acted on', () => {
    assert.equal(checkName('hotfix'), false);
    assert.equal(checkName('Feature/x'), false);
    assert.equal(checkName('docs/a/b'), true);
    assert.equal(checkName('feat/phase-9b.v2'), true);
    const c = cls([H.branch('main', 'm', RECENT), H.branch('hotfix', 'h', RECENT), H.branch('Feature/x', 'f', RECENT), H.branch('docs/a/b', 'd', RECENT)]);
    assert.deepEqual(c.violations, ['Feature/x', 'hotfix']);
    assert.equal(c.branches.find((b) => b.name === 'main').nameOk, true);
    assert.deepEqual(plan({ branches: c.branches }), []);
});

// ---------------------------------------------------------------- PR cap

test('PR cap: dependabot[bot] excluded, drafts included, exceeded only when count > cap; the issue carries the marker', () => {
    const prs = [
        { number: 4, head: 'a/b', draft: true, author: 'x', title: 'draft one' },
        { number: 2, head: 'dependabot/npm_and_yarn/x', draft: false, author: 'dependabot[bot]', title: 'bump' },
        { number: 3, head: 'c/d', draft: false, author: 'y', title: 'ready' },
        { number: 5, head: 'dependabot/uv/y', draft: false, author: 'dependabot[bot]', title: 'bump' },
    ];
    const s = prCapStatus(prs, 1);
    assert.equal(s.count, 2);
    assert.equal(s.exceeded, true);
    assert.deepEqual(s.prs.map((p) => p.number), [3, 4]);
    assert.equal(prCapStatus(prs, 2).exceeded, false);
    const issue = prCapIssue(s);
    assert.equal(issue.title, 'Branch hygiene: 2 open non-dependabot PRs exceeds the cap of 1');
    assert.ok(issue.body.startsWith(PR_CAP_MARKER));
    assert.match(issue.body, /#4 `a\/b` \(draft\)/);
    const withIssue = plan({ branches: [], prCap: s });
    assert.equal(withIssue.length, 1);
    assert.equal(withIssue[0].type, 'issue');
    assert.deepEqual(plan({ branches: [], prCap: prCapStatus(prs, 2) }), []);
});

test('plan order: every tag first, then deletes, then the issue', () => {
    const c = cls([H.branch('feat/m', 'm1', RECENT), H.branch('feat/s', 's1', OLD)], { isAncestor: (sha) => sha === 'm1' });
    const types = plan({ branches: c.branches, prCap: { exceeded: true, count: 5, cap: 4, prs: [] } }).map((a) => a.type);
    assert.deepEqual(types, ['tag', 'delete', 'delete', 'issue']);
});

// ---------------------------------------------------------------- executor

test('executor: tag lands BEFORE the delete, and the delete re-reads the sha first', async () => {
    const { api, names } = H.recordingApi({}, { 'feat/s': 's1' });
    const r = await execute([tag('feat/s', 's1', 'archive/feat-s-20260529'), del('feat/s', 's1', 'stale', 'archive/feat-s-20260529')], api, { apply: true });
    assert.deepEqual(r.map((x) => x.status), ['ok', 'ok']);
    assert.deepEqual(names(), ['createTag', 'getBranchSha', 'deleteBranch']);
});

test('executor: a tag already at the same sha counts as success; at another sha the delete is refused', async () => {
    const same = H.recordingApi({ createTag: () => ({ created: false, existingSha: 's1' }) }, { 'feat/s': 's1' });
    const a = [tag('feat/s', 's1', 't'), del('feat/s', 's1', 'stale', 't')];
    assert.deepEqual((await execute(a, same.api, { apply: true })).map((x) => x.status), ['ok', 'ok']);
    const other = H.recordingApi({ createTag: () => ({ created: false, existingSha: 'zzz' }) }, { 'feat/s': 's1' });
    const r = await execute(a, other.api, { apply: true });
    assert.deepEqual(r.map((x) => x.status), ['refused', 'refused']);
    assert.match(r[0].reason, /already exists at zzz/);
    assert.match(r[1].reason, /tag not confirmed/);
    assert.equal(other.names().includes('deleteBranch'), false);
});

test('executor: a tag creation failure marks the tag failed and refuses the delete', async () => {
    const { api, names } = H.recordingApi({ createTag: () => { throw new Error('HTTP 500'); } }, { 'feat/s': 's1' });
    const r = await execute([tag('feat/s', 's1', 't'), del('feat/s', 's1', 'stale', 't')], api, { apply: true });
    assert.deepEqual(r.map((x) => x.status), ['failed', 'refused']);
    assert.equal(names().includes('deleteBranch'), false);
});

test('executor: a branch whose sha moved since the plan is skipped, never deleted; an already-gone one is skipped too', async () => {
    const { api, names } = H.recordingApi({}, { 'feat/m': 'NEW', 'feat/g': null });
    const r = await execute([del('feat/m', 'm1', 'merged'), del('feat/g', 'g1', 'merged')], api, { apply: true });
    assert.equal(r[0].status, 'skipped');
    assert.match(r[0].reason, /moved, skipped/);
    assert.equal(r[1].status, 'skipped');
    assert.equal(names().includes('deleteBranch'), false);
});

test('executor: refuses protected and open-pr deletes even when handed such an action (defense in depth)', async () => {
    const { api, calls } = H.recordingApi({}, { main: 'm', 'feat/pr': 'p', 'feat/q': 'q' });
    const r = await execute([del('main', 'm', 'protected'), del('feat/pr', 'p', 'merged'), del('feat/q', 'q', 'open-pr')], api, { apply: true, openPrHeads: ['feat/pr'] });
    assert.deepEqual(r.map((x) => x.status), ['refused', 'refused', 'refused']);
    assert.match(r[0].reason, /protected/);
    assert.match(r[1].reason, /open PR/);
    assert.equal(calls.length, 0);
});

test('executor: the PR-cap issue is deduped by marker — update the existing one, else create', async () => {
    const issue = { type: 'issue', ...prCapIssue(prCapStatus([{ number: 1, head: 'a/b', author: 'x', title: 't' }], 0)) };
    const found = H.recordingApi({ findIssue: (m) => (m === PR_CAP_MARKER ? { number: 7 } : null) });
    const r1 = await execute([issue], found.api, { apply: true });
    assert.equal(r1[0].status, 'ok');
    assert.equal(r1[0].number, 7);
    assert.deepEqual(found.names(), ['findIssue', 'updateIssue']);
    const fresh = H.recordingApi();
    const r2 = await execute([issue], fresh.api, { apply: true });
    assert.equal(r2[0].number, 101);
    assert.deepEqual(fresh.names(), ['findIssue', 'createIssue']);
});

// ---------------------------------------------------------------- dry run: zero writes by construction

test('dry run: without --apply the gate throws on every write and the executor makes zero api calls', async () => {
    assert.throws(() => assertApply({ apply: false }, 'createTag'), /DRY RUN/);
    assert.throws(() => assertApply(undefined, 'createTag'), /DRY RUN/);
    assert.doesNotThrow(() => assertApply({ apply: true }, 'createTag'));
    const { api, calls, writes } = H.recordingApi({}, { 'feat/s': 's1', 'feat/m': 'm1' });
    const gated = gateWrites(api, { apply: false });
    for (const w of WRITE_METHODS) assert.throws(() => gated[w]('x', 'y', 'z'), /DRY RUN/, w);
    assert.equal(await gated.getBranchSha('feat/s'), 's1');
    assert.equal(writes().length, 0);
    calls.length = 0;
    const c = cls([H.branch('feat/m', 'm1', RECENT), H.branch('feat/s', 's1', OLD)], { isAncestor: (sha) => sha === 'm1' });
    const actions = plan({ branches: c.branches, prCap: prCapStatus([{ number: 1, head: 'a/b', author: 'x', title: 't' }], 0) });
    assert.equal(actions.length, 4);
    const r = await execute(actions, api, {});
    assert.deepEqual(r.map((x) => x.status), ['dry-run', 'dry-run', 'dry-run', 'dry-run']);
    assert.equal(calls.length, 0);
});

test('dry run: the GitHub adapter refuses every non-GET without apply — the request never reaches fetch', async () => {
    const { fetch, calls } = H.fakeFetch(() => ({ status: 201, json: {} }));
    const api = githubApi({ repo: 'o/r', token: 't', fetch, apply: false });
    await assert.rejects(api.createTag('archive/x-20260101', 'abc'), /DRY RUN/);
    await assert.rejects(api.deleteBranch('feat/x'), /DRY RUN/);
    await assert.rejects(api.createIssue('t', 'b'), /DRY RUN/);
    await assert.rejects(api.updateIssue(1, 't', 'b'), /DRY RUN/);
    assert.equal(calls.length, 0);
});

// ---------------------------------------------------------------- adapter (fake fetch only)

test('adapter: open PRs paginate via the Link header, keep same-repo heads only, and normalize the shape', async () => {
    const pr = (number, ref, full_name, login, draft = false) => ({ number, title: `t${number}`, draft, created_at: '2026-09-01T00:00:00Z', user: { login }, head: { ref, repo: { full_name } } });
    const { fetch } = H.fakeFetch((m, url) => {
        if (url.includes('page=2')) return { status: 200, json: [pr(3, 'c/d', 'o/r', 'dependabot[bot]')] };
        if (url.includes('/pulls?')) return { status: 200, json: [pr(1, 'a/b', 'o/r', 'x', true), pr(2, 'a/b', 'someone/r', 'y')], headers: { Link: '<https://api.github.com/repos/o/r/pulls?state=open&per_page=100&page=2>; rel="next"' } };
        return { status: 404 };
    });
    const prs = await githubApi({ repo: 'o/r', token: 't', fetch }).listOpenPrs();
    assert.deepEqual(prs.map((p) => [p.number, p.head, p.author, p.draft]), [[1, 'a/b', 'x', true], [3, 'c/d', 'dependabot[bot]', false]]);
    assert.equal(parseLinkNext('<https://x/a?page=2>; rel="next", <https://x/a?page=9>; rel="last"'), 'https://x/a?page=2');
    assert.equal(parseLinkNext('<https://x/a?page=1>; rel="prev"'), null);
});

test('adapter (apply, fake fetch): createTag reports an existing tag\'s sha on 422; getBranchSha maps 404 to null; a failed GET throws', async () => {
    const seen = [];
    const { fetch, nonGets } = H.fakeFetch((m, url) => {
        seen.push(`${m} ${url}`);
        if (m === 'POST' && url.endsWith('/git/refs')) return { status: 422, json: { message: 'Reference already exists' } };
        if (url.endsWith('/git/ref/tags/archive/x-20260101')) return { status: 200, json: { object: { sha: 'other' } } };
        if (url.endsWith('/git/ref/heads/feat/gone')) return { status: 404 };
        if (url.endsWith('/branches/feat/x')) return { status: 500 };
        return { status: 404 };
    });
    const api = githubApi({ repo: 'o/r', token: 't', fetch, apply: true });
    assert.deepEqual(await api.createTag('archive/x-20260101', 'abc'), { created: false, existingSha: 'other' });
    assert.equal(nonGets()[0].body.ref, 'refs/tags/archive/x-20260101');
    assert.equal(await api.getBranchSha('feat/gone'), null);
    await assert.rejects(api.branchCommitDate('feat/x'), /HTTP 500/);
    assert.equal(seen[0], 'POST https://api.github.com/repos/o/r/git/refs');
});

// ---------------------------------------------------------------- collect

test('collect: an unobtainable open-PR list ABORTS — never classify against an empty list', async () => {
    const git = H.fakeGit({ heads: [{ name: 'main', sha: 'm' }], mainSha: 'm', dates: { m: RECENT }, ancestors: new Set(['m']) });
    const github = { listOpenPrs: async () => { throw new Error('HTTP 401'); }, branchCommitDate: async () => RECENT };
    await assert.rejects(collect({ repo: 'o/r', git, github }), /HTTP 401/);
    const ok = await collect({ repo: 'o/r', git, github, openPrs: [] });
    assert.equal(ok.mainSha, 'm');
    assert.deepEqual(ok.branches[0], { name: 'main', sha: 'm', committedAt: RECENT, committedAtSource: 'git', ancestorOfMain: true });
});

test('collect: a tip missing locally takes its date from the API (noted); ancestry follows merge-base; no origin/main is fatal', async () => {
    const git = H.fakeGit({ heads: [{ name: 'main', sha: 'm' }, { name: 'feat/a', sha: 'a' }, { name: 'feat/b', sha: 'b' }], mainSha: 'm', dates: { m: RECENT, a: OLD }, ancestors: new Set(['m', 'a']) });
    const github = { listOpenPrs: async () => [], branchCommitDate: async (name) => (name === 'feat/b' ? '2026-09-10T00:00:00Z' : null) };
    const d = await collect({ repo: 'o/r', git, github });
    const b = Object.fromEntries(d.branches.map((x) => [x.name, x]));
    assert.equal(b['feat/a'].ancestorOfMain, true);
    assert.equal(b['feat/b'].ancestorOfMain, false);
    assert.equal(b['feat/b'].committedAtSource, 'api');
    assert.equal(b['feat/b'].committedAt, '2026-09-10T00:00:00Z');
    assert.match(d.notes[0], /feat\/b: tip b missing locally/);
    await assert.rejects(collect({ repo: 'o/r', git: H.fakeGit({ heads: [], mainSha: null }), github, openPrs: [] }), /origin\/main is not available/);
    assert.equal(parseRepoSlug('git@github.com:o/r.git'), 'o/r');
    assert.equal(parseRepoSlug('https://github.com/o/r'), 'o/r');
});

// ---------------------------------------------------------------- end to end (offline, injected deps)

test('main: an offline dry run exits 0, ends with the DRY RUN trailer, writes the JSON shape, and never sends a non-GET', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'xray-hygiene-'));
    const prsPath = join(dir, 'prs.json');
    const jsonPath = join(dir, 'out.json');
    writeFileSync(prsPath, JSON.stringify([{ number: 9, head: 'feat/pr', draft: false, author: 'x', title: 'open', created_at: RECENT }]));
    const git = H.fakeGit({ heads: [{ name: 'main', sha: 'm' }, { name: 'feat/pr', sha: 'p' }, { name: 'feat/old', sha: 'o' }, { name: 'feat/done', sha: 'd' }],
                            mainSha: 'm', dates: { m: RECENT, p: OLD, o: OLD, d: RECENT }, ancestors: new Set(['m', 'd']) });
    const { fetch, calls } = H.fakeFetch(() => ({ status: 500 }));
    let out = '';
    const code = await main(['--open-prs', prsPath, '--today', TODAY, '--json', jsonPath, '--repo', 'o/r', '--pr-cap', '0'],
                            { git, fetch, env: {}, stdout: (s) => { out += s; }, stderr: () => {}, now: () => { throw new Error('clock read'); } });
    assert.equal(code, 0);
    assert.match(out, /DRY RUN — nothing changed \(re-run with --apply\)\n$/);
    assert.match(out, /`feat\/old` → `archive\/feat-old-20260529`/);
    assert.equal(calls.length, 0);
    const doc = JSON.parse(readFileSync(jsonPath, 'utf8'));
    assert.deepEqual(Object.keys(doc), ['generatedAt', 'repo', 'mainSha', 'counts', 'branches', 'violations', 'prCap', 'actions', 'notes']);
    assert.deepEqual(doc.counts, { protected: 1, 'open-pr': 1, merged: 1, stale: 1, active: 0 });
    assert.deepEqual(doc.prCap, { count: 1, cap: 0, exceeded: true, prs: [{ number: 9, head: 'feat/pr', draft: false, author: 'x', title: 'open' }] });
    assert.deepEqual(doc.actions.map((a) => a.type), ['tag', 'delete', 'delete', 'issue']);
    assert.equal(doc.results, undefined);
    assert.equal(await main(['--apply', '--repo', 'o/r'], { git, fetch, env: {}, stdout: () => {}, stderr: () => {} }), 2, '--apply without a token is a usage error');
});

test('report: the apply rendering ends with the tally and marks the refused results', async () => {
    const c = cls([H.branch('feat/s', 's1', OLD)]);
    const actions = plan({ branches: c.branches });
    const { api } = H.recordingApi({ createTag: () => ({ created: false, existingSha: 'zzz' }) }, { 'feat/s': 's1' });
    const results = await execute(actions, api, { apply: true });
    const md = renderReport({ repo: 'o/r', mainSha: 'abcdef0123', today: TODAY, staleDays: 14, classification: c, prCap: prCapStatus([], 4), actions, results, apply: true });
    assert.match(md, /^# Branch hygiene — 2026-09-15 \(APPLY\)/);
    assert.match(md, /APPLY — 2 refused\n$/);
    assert.doesNotMatch(md, /DRY RUN — nothing changed/);
    assert.ok(results.some((r) => r.status === 'refused'));
});

// ---------------------------------------------------------------- golden snapshot

test('golden: the 2026-09-15 snapshot classifies to 1 protected / 15 open-pr / 65 merged / 1 stale / 0 active with the §9 tag', () => {
    const snap = JSON.parse(readFileSync(FIXTURE, 'utf8'));
    assert.equal(snap.today, '2026-09-15');
    assert.deepEqual(snap.protected, ['main']);
    assert.equal(snap.openPrHeads.length, 15);
    assert.equal(snap.branches.length, 82);
    const bySha = new Map(snap.branches.map((b) => [b.sha, b.ancestorOfMain]));
    const c = classify({ branches: snap.branches, openPrHeads: snap.openPrHeads, protectedBranches: snap.protected,
                         isAncestor: (sha) => bySha.get(sha) === true, today: snap.today });
    assert.deepEqual(c.counts, { protected: 1, 'open-pr': 15, merged: 65, stale: 1, active: 0 });
    const stale = c.branches.filter((b) => b.label === 'stale');
    assert.deepEqual(stale.map((b) => [b.name, b.tag]), [['feature/phase-9b-metadata-ui', 'archive/feature-phase-9b-metadata-ui-20260529']]);
    assert.deepEqual(c.violations, ['direct-cloud-dc2', 'direct-cloud-transcribe', 'worktree-transcribe-anywhere']);
    assert.deepEqual(c.branches.filter((b) => b.label === 'open-pr').map((b) => b.name).sort(), [...snap.openPrHeads].sort(),
        'the open-pr set is exactly the open-PR heads (an open head that is also an ancestor stays open-pr)');
    const actions = plan({ branches: c.branches });
    assert.equal(actions.filter((a) => a.type === 'tag').length, 1);
    assert.equal(actions.filter((a) => a.type === 'delete').length, 66);
    assert.equal(actions.some((a) => a.branch === 'main' || snap.openPrHeads.includes(a.branch)), false);
});

// ---------------------------------------------------------------- verifier round (2026-09-15)

test('F1: --protected ADDS to the defaults, never replaces them, and the executor refuses main unconditionally', async () => {
    assert.deepEqual(parseCli(['--protected', 'release']).protected, ['main', 'release']);
    assert.deepEqual(parseCli(['--protected', '']).protected, ['main'], 'an empty --protected cannot expose main');
    assert.deepEqual(parseCli(['--protected', 'main']).protected, ['main']);
    const { api, writes } = H.recordingApi({}, { main: 'm' });
    const results = await execute([{ type: 'delete', branch: 'main', sha: 'm', label: 'merged' }], api, { apply: true, protectedBranches: [] });
    assert.equal(results[0].status, 'refused');
    assert.equal(results[0].reason, 'protected branch');
    assert.equal(writes().length, 0);
});

test('F2: main --apply — a refused tag (exists at another sha) makes the exit code 1 and never sends a DELETE', async () => {
    const git = H.fakeGit({ heads: [{ name: 'main', sha: 'm' }, { name: 'feat/old', sha: 'o' }], mainSha: 'm', dates: { m: OLD, o: OLD }, ancestors: new Set(['m']) });
    const { fetch, nonGets } = H.fakeFetch((method, url) => {
        if (url.includes('/pulls?')) return { status: 200, json: [] };
        if (method === 'POST' && url.endsWith('/git/refs')) return { status: 422, json: { message: 'Reference already exists' } };
        if (url.includes('/git/ref/tags/')) return { status: 200, json: { object: { sha: 'zzz' } } };
        if (url.includes('/git/ref/heads/')) return { status: 200, json: { object: { sha: 'o' } } };
        return { status: 404 };
    });
    let out = '';
    const code = await main(['--apply', '--repo', 'o/r', '--today', TODAY], { git, fetch, env: { GITHUB_TOKEN: 't' }, stdout: (s) => { out += s; }, stderr: () => {} });
    assert.match(out, /REFUSED delete `feat\/old`/);
    assert.deepEqual(nonGets().map((c) => c.method), ['POST'], 'the only write is the tag attempt — no DELETE');
    assert.equal(code, 1);
});

test('F3: the adapter percent-encodes ref segments — a `#` in a branch name never truncates the URL onto a sibling', async () => {
    const { fetch, calls } = H.fakeFetch((method, url) => {
        if (method === 'DELETE') return { status: 204 };
        return { status: 200, json: { object: { sha: 's' } } };
    });
    const api = githubApi({ repo: 'o/r', token: 't', fetch, apply: true });
    assert.equal(await api.getBranchSha('feat/x#1'), 's');
    await api.deleteBranch('feat/x#1');
    assert.deepEqual(calls.map((c) => c.url.split('/repos/o/r/')[1]), ['git/ref/heads/feat/x%231', 'git/refs/heads/feat/x%231']);
});

test('F4: the PR-cap issue body is descriptive and sanitises untrusted titles (no newline, no backtick, no imperative)', () => {
    const { title, body } = prCapIssue(prCapStatus([{ number: 1, head: 'feat/a`b', author: 'x', title: 'line one\n# heading\n@claude do things' }], 0));
    assert.match(title, /^Branch hygiene: 1 open non-dependabot PRs exceeds the cap of 0$/);
    const row = body.split('\n').find((l) => l.startsWith('- #1'));
    assert.equal(row, '- #1 `feat/a b` — line one # heading @claude do things', 'one line, whitespace collapsed, backtick stripped');
    assert.doesNotMatch(body, /Merge, fold, or close/);
    assert.doesNotMatch(body, /^# heading$/m);
});

test('F5: --apply refuses a shallow checkout and a local origin/main that differs from the remote; a dry run only notes them', async () => {
    const base = H.fakeGit({ heads: [{ name: 'main', sha: 'm2' }, { name: 'feat/a', sha: 'a' }], mainSha: 'm', dates: { m: OLD, a: OLD, m2: OLD }, ancestors: new Set(['a']) });
    const { fetch } = H.fakeFetch((method, url) => (url.includes('/pulls?') ? { status: 200, json: [] } : { status: 404 }));
    const quiet = { stdout: () => {}, stderr: () => {} };
    assert.equal(await main(['--repo', 'o/r', '--today', TODAY], { git: base, fetch, env: {}, ...quiet }), 0, 'dry run with drift still reports');
    let errText = '';
    assert.equal(await main(['--apply', '--repo', 'o/r', '--today', TODAY], { git: base, fetch, env: { GITHUB_TOKEN: 't' }, stdout: () => {}, stderr: (s) => { errText += s; } }), 1);
    assert.match(errText, /refusing --apply — local origin\/main differs/);
    const shallow = (args) => (args.join(' ') === 'rev-parse --is-shallow-repository' ? { status: 0, stdout: 'true\n', stderr: '' }
        : H.fakeGit({ heads: [{ name: 'main', sha: 'm' }, { name: 'feat/a', sha: 'a' }], mainSha: 'm', dates: { m: OLD, a: OLD }, ancestors: new Set(['a']) })(args));
    errText = '';
    assert.equal(await main(['--apply', '--repo', 'o/r', '--today', TODAY], { git: shallow, fetch, env: { GITHUB_TOKEN: 't' }, stdout: () => {}, stderr: (s) => { errText += s; } }), 1);
    assert.match(errText, /refusing --apply — shallow checkout/);
});

test('F6: usage errors exit 2 (--stale-days abc); an unknown merge-base answer is NOT merged; a failed ls-remote exits 1', async () => {
    const quiet = { stdout: () => {}, stderr: () => {} };
    assert.equal(await main(['--stale-days', 'abc'], { git: () => ({ status: 1, stdout: '', stderr: '' }), env: {}, ...quiet }), 2);
    const heads = [{ name: 'main', sha: 'm' }, { name: 'feat/a', sha: 'a' }];
    const base = H.fakeGit({ heads, mainSha: 'm', dates: { m: OLD, a: OLD }, ancestors: new Set(['a']) });
    const broken = (args) => (args[0] === 'merge-base' ? { status: 128, stdout: '', stderr: 'fatal: bad object' } : base(args));
    const data = await collect({ repo: 'o/r', git: broken, github: { listOpenPrs: async () => [] } });
    assert.equal(data.branches.find((b) => b.name === 'feat/a').ancestorOfMain, false);
    assert.ok(data.notes.some((n) => /ancestry unknown/.test(n)));
    const noRemote = (args) => (args.join(' ') === 'ls-remote --heads origin' ? { status: 128, stdout: '', stderr: 'fatal: could not read from remote' } : base(args));
    assert.equal(await main(['--repo', 'o/r', '--today', TODAY], { git: noRemote, fetch: async () => ({ status: 500, ok: false, headers: { get: () => null }, text: async () => '' }), env: {}, ...quiet }), 1);
});

test('F8: an empty argv element (an unquoted empty shell expansion) is ignored, not a usage error', async () => {
    assert.equal(await main(['', '--help', ''], { stdout: () => {}, stderr: () => {} }), 0);
});
