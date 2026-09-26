// scripts/provenance-expiry.mjs — the warn-only expiry check (RESET_PLAN
// §4.4 item 3). Pins: a provenance line expires on its own "expires"
// date, else 90 days after its date, including the split form whose
// ruled part names an R-id; an unreadable date is listed, not fatal; the
// script exits 0 even when guards have expired, because it warns and
// never fails the gate; and --issue opens at most one issue, never when
// the open issues cannot be listed, and rewrites only an issue the
// workflow's own bot opened.
//
// Provenance: R-022

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BOT_LOGIN, MARKER, addDays, expired, findInterpretations, upsertIssue } from '../scripts/provenance-expiry.mjs';

const SCRIPT = fileURLToPath(new URL('../scripts/provenance-expiry.mjs', import.meta.url));
// Built from parts, so the script's own scan never reads these fixtures
// as provenance lines of this file.
const P = 'Provenance: ' + 'INTERPRETATION';

test('expiry: an "expires" date wins; otherwise the date plus 90 days', () => {
    const found = findInterpretations({
        'tests/a.test.mjs': `// ${P} (2026-09-26) — expires 2026-10-01\n`,
        'tests/b.test.mjs': `x\n// ${P} (2026-09-08) — an agent artifact under\n`,
        'tests/c.test.mjs': '// no provenance here\n',
        'tests/d.test.mjs': `// Provenance: ${'R'}-${'020'} (x); the rest: ${P} (2026-09-26) — expires 2026-12-25\n`
    });
    assert.deepEqual(found, [
        { path: 'tests/a.test.mjs', line: 1, date: '2026-09-26', expires: '2026-10-01', label: '(whole file)' },
        { path: 'tests/b.test.mjs', line: 2, date: '2026-09-08', expires: '2026-12-07', label: '(end of file)' },
        { path: 'tests/d.test.mjs', line: 1, date: '2026-09-26', expires: '2026-12-25', label: '(whole file)' }
    ]);
    assert.equal(addDays('2026-09-26', 90), '2026-12-25');
    assert.deepEqual(expired(found, '2026-12-06').map((x) => x.path), ['tests/a.test.mjs']);
    assert.deepEqual(expired(found, '2026-12-07').map((x) => x.path), ['tests/a.test.mjs', 'tests/b.test.mjs']);
});

test('expiry: each line is labelled with the test it covers; an unreadable date is listed and the scan goes on', () => {
    const found = findInterpretations({
        'tests/e.test.mjs': [
            "import { test } from 'node:test';",
            `// ${P} (2026-13-45) — expires 2027-01-01`,
            "test('first', () => {});",
            `// ${P} (2026-09-26) — expires 2026-12-25`,
            "test('the guard\\'s title', () => {});",
            ''
        ].join('\n')
    });
    assert.deepEqual(found, [
        { path: 'tests/e.test.mjs', line: 2, date: '2026-13-45', label: 'first', unreadable: true },
        { path: 'tests/e.test.mjs', line: 4, date: '2026-09-26', expires: '2026-12-25', label: "the guard's title" }
    ]);
    assert.deepEqual(expired(found, '2099-01-01').map((x) => x.line), [4], 'an unreadable line is never "expired"');
});

test('expiry: never red — exit 0 with an expired guard, and no network without --issue', () => {
    const dir = mkdtempSync(join(tmpdir(), 'xray-provenance-'));
    try {
        writeFileSync(join(dir, 'x.test.mjs'), `// ${P} (2026-01-01) — expires 2026-04-01\n`);
        const r = spawnSync(process.execPath, [SCRIPT, '--today', '2099-01-01', '--dir', dir],
            { encoding: 'utf8', env: { ...process.env, GITHUB_TOKEN: '' } });
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout, /::warning file=[^\n]*x\.test\.mjs,line=1::INTERPRETATION since 2026-01-01, expired 2026-04-01/);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('issue: a failed listing opens nothing; the bot\'s marked open issue is updated; anyone else\'s is ignored; otherwise one is opened', async () => {
    const env = { GITHUB_REPOSITORY: 'o/r', GITHUB_TOKEN: 't' };
    const log = () => {};
    const stub = (pages) => {
        const calls = [];
        const fetchImpl = async (url, init = {}) => {
            calls.push(`${init.method ?? 'GET'} ${url}`);
            if ((init.method ?? 'GET') !== 'GET') return { ok: true, status: 200 };
            const page = pages.shift();
            if (!page) return { ok: false, status: 502 };
            return { ok: true, status: 200, json: async () => page.items, headers: { get: () => page.link ?? null } };
        };
        return { calls, fetchImpl };
    };

    const failed = stub([]);
    assert.equal(await upsertIssue('body', { env, log, fetchImpl: failed.fetchImpl }), 'list-failed');
    assert.ok(!failed.calls.some((c) => c.startsWith('POST')), 'no issue opened when the listing fails');

    const marked = stub([
        { items: [{ number: 1, body: 'unrelated' }], link: '<https://api.github.com/next>; rel="next"' },
        { items: [{ number: 7, body: `${MARKER}\nold list`, user: { login: BOT_LOGIN } }] }
    ]);
    assert.equal(await upsertIssue('body', { env, log, fetchImpl: marked.fetchImpl }), 'updated');
    assert.equal(marked.calls.at(-1), 'PATCH https://api.github.com/repos/o/r/issues/7', 'found on the second page');

    const planted = stub([{ items: [{ number: 3, body: `${MARKER}\nplanted`, user: { login: 'someone' } }] }]);
    assert.equal(await upsertIssue('body', { env, log, fetchImpl: planted.fetchImpl }), 'opened');
    assert.ok(!planted.calls.some((c) => c.startsWith('PATCH')), 'a marked issue someone else opened is never rewritten');
    assert.equal(planted.calls.at(-1), 'POST https://api.github.com/repos/o/r/issues');

    const none = stub([{ items: [] }]);
    assert.equal(await upsertIssue('body', { env, log, fetchImpl: none.fetchImpl }), 'opened');
    assert.equal(none.calls.at(-1), 'POST https://api.github.com/repos/o/r/issues');

    const quiet = stub([{ items: [] }]);
    assert.equal(await upsertIssue('body', { env, log, fetchImpl: quiet.fetchImpl, onlyIfOpen: true }), 'none');
    assert.ok(!quiet.calls.some((c) => c.startsWith('POST')), 'nothing expired: no issue is opened');
});
