// Branch-hygiene test harness — the recording api, fake fetch, and fake
// git that tests/branch-hygiene.test.mjs drives scripts/branch-hygiene.mjs
// with. Nothing here touches the network or a real repo: the --apply path
// is exercised ONLY against these mocks (RESET_PLAN §7 R0 "Branch and PR
// triage per §9"; §9 "The rules going forward").
//
// Provenance: INTERPRETATION (2026-09-15) — an agent artifact under
// RESET_PLAN R0; the maintainer has not ruled on it.

import { WRITE_METHODS } from '../../scripts/branch-hygiene.mjs';

export function branch(name, sha, committedAt) {
    return { name, sha, committedAt };
}

/** An api whose every call is recorded; `shas` answers getBranchSha. */
export function recordingApi(overrides = {}, shas = {}) {
    const calls = [];
    const rec = (name, impl) => async (...args) => { calls.push([name, ...args]); return impl(...args); };
    const api = {
        createTag: rec('createTag', overrides.createTag ?? (() => ({ created: true }))),
        getBranchSha: rec('getBranchSha', overrides.getBranchSha ?? ((n) => shas[n] ?? null)),
        deleteBranch: rec('deleteBranch', overrides.deleteBranch ?? (() => true)),
        findIssue: rec('findIssue', overrides.findIssue ?? (() => null)),
        createIssue: rec('createIssue', overrides.createIssue ?? (() => ({ number: 101 }))),
        updateIssue: rec('updateIssue', overrides.updateIssue ?? ((n) => ({ number: n }))),
    };
    const names = () => calls.map((c) => c[0]);
    const writes = () => calls.filter((c) => WRITE_METHODS.includes(c[0]));
    return { api, calls, names, writes };
}

/** fetch double: handler(method, url, body) → {status, json?, headers?}. */
export function fakeFetch(handler) {
    const calls = [];
    const fetch = async (url, init = {}) => {
        const method = init.method ?? 'GET';
        const body = init.body ? JSON.parse(init.body) : null;
        calls.push({ method, url, body });
        const r = handler(method, url, body) ?? { status: 404 };
        const headers = Object.fromEntries(Object.entries(r.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
        return {
            status: r.status, ok: r.status >= 200 && r.status < 300,
            headers: { get: (k) => headers[k.toLowerCase()] ?? null },
            text: async () => (r.json === undefined ? '' : JSON.stringify(r.json)),
        };
    };
    return { fetch, calls, nonGets: () => calls.filter((c) => c.method !== 'GET') };
}

/** git double over a tiny remote: heads, main sha, tip dates, ancestors. */
export function fakeGit({ heads, mainSha, dates = {}, ancestors = new Set(), remoteUrl = 'https://github.com/o/r.git' }) {
    const ok = (stdout) => ({ status: 0, stdout, stderr: '' });
    const fail = (stderr, status = 128) => ({ status, stdout: '', stderr });
    return (args) => {
        const a = args.join(' ');
        if (a === 'remote get-url origin') return ok(`${remoteUrl}\n`);
        if (a === 'ls-remote --heads origin') return ok(heads.map((h) => `${h.sha}\trefs/heads/${h.name}\n`).join(''));
        if (a === 'rev-parse --verify origin/main') return mainSha ? ok(`${mainSha}\n`) : fail('fatal: Needed a single revision');
        if (args[0] === 'log') return dates[args[3]] ? ok(`${dates[args[3]]}\n`) : fail(`fatal: bad object ${args[3]}`);
        if (args[0] === 'merge-base') return ancestors.has(args[2]) ? ok('') : fail('', 1);
        return fail(`unexpected git ${a}`);
    };
}
