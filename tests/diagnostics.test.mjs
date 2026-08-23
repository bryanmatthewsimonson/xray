// The diagnostics buffer — the answer to "how do we be proactive about
// capturing the data we know we'll need to fix bugs" (maintainer,
// 2026-08-23, after a week in which every field bug arrived as a
// screenshot and a sentence).
//
// Design constraints, each carried by a test:
//  - ERRORS ONLY, always on. Utils.log stays debug-gated and is never
//    recorded — the buffer is evidence for failures, not surveillance
//    of use.
//  - Bounded ring. A storm of errors must not grow storage without
//    limit; the newest entries win.
//  - Best-effort everywhere. A diagnostics write that can throw turns
//    the logger into a new failure source — worse than no logging.
//  - LOCAL ONLY. Excluded from backups: a backup travels, and error
//    text can carry URLs the user never chose to export.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let storage = {};
globalThis.chrome = {
    runtime: { lastError: null },
    storage: {
        local: {
            get(keys, cb) {
                const out = {};
                for (const k of (Array.isArray(keys) ? keys : [keys])) if (k in storage) out[k] = storage[k];
                cb(out);
            },
            set(obj, cb) { Object.assign(storage, obj); cb && cb(); },
            remove(keys, cb) { for (const k of [].concat(keys)) delete storage[k]; cb && cb(); }
        }
    }
};

const {
    DIAGNOSTICS_STORAGE, MAX_DIAGNOSTIC_ENTRIES,
    recordDiagnostic, readDiagnostics, clearDiagnostics, formatDiagnostics, flushDiagnostics
} = await import('../src/shared/diagnostics.js');

const repoUrl = (p) => new URL(`../${p}`, import.meta.url);
const readRepo = (p) => readFileSync(repoUrl(p), 'utf8');

test('records an entry with time, context, and message', async () => {
    storage = {};
    recordDiagnostic('reader', 'archive save failed', { detail: 'boom' });
    await flushDiagnostics();
    const entries = await readDiagnostics();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].ctx, 'reader');
    assert.match(entries[0].msg, /archive save failed/);
    assert.match(entries[0].msg, /boom/, 'extra args ride along, stringified');
    assert.ok(Number.isFinite(entries[0].t));
});

test('the ring is bounded and the NEWEST entries win', async () => {
    storage = {};
    for (let i = 0; i < MAX_DIAGNOSTIC_ENTRIES + 25; i++) {
        recordDiagnostic('t', `e${i}`);
    }
    await flushDiagnostics();
    const entries = await readDiagnostics();
    assert.equal(entries.length, MAX_DIAGNOSTIC_ENTRIES);
    assert.match(entries[entries.length - 1].msg, new RegExp(`e${MAX_DIAGNOSTIC_ENTRIES + 24}$`));
    assert.ok(!entries.some((e) => e.msg === 'e0'), 'the oldest entries rolled off');
});

test('never throws — with no chrome, with a throwing store, with junk args', async () => {
    const saved = globalThis.chrome;
    try {
        globalThis.chrome = undefined;
        recordDiagnostic('x', 'no chrome at all');
        await flushDiagnostics();
        globalThis.chrome = { storage: { local: {
            get() { throw new Error('storage exploded'); },
            set() { throw new Error('storage exploded'); }
        } } };
        recordDiagnostic('x', 'throwing store');
        await flushDiagnostics();
        recordDiagnostic(null, undefined, { circular: null });
    } finally {
        globalThis.chrome = saved;
    }
    assert.ok(true, 'reaching here IS the assertion');
});

test('circular extras stringify safely', async () => {
    storage = {};
    const loop = {}; loop.self = loop;
    recordDiagnostic('t', 'with circular', loop);
    await flushDiagnostics();
    const entries = await readDiagnostics();
    assert.equal(entries.length, 1);
    assert.match(entries[0].msg, /with circular/);
});

test('clear empties the buffer', async () => {
    storage = {};
    recordDiagnostic('t', 'one');
    await flushDiagnostics();
    await clearDiagnostics();
    assert.deepEqual(await readDiagnostics(), []);
});

test('formatDiagnostics leads with the build, timestamps in ISO, one line per entry', () => {
    const text = formatDiagnostics(
        [{ t: 1755900000000, ctx: 'reader', msg: 'it broke' }],
        { version: '0.8.0', commit: 'abc1234' }
    );
    assert.match(text, /^X-Ray diagnostics/m);
    assert.match(text, /0\.8\.0/);
    assert.match(text, /abc1234/);
    assert.match(text, /\d{4}-\d{2}-\d{2}T.*\[reader\] it broke/);
    assert.match(formatDiagnostics([], {}), /No errors recorded/);
});

// ------------------------------------------------------------------
// The seams (the session's standing lesson: a recorder nobody feeds and
// a buffer nobody can read are both decoration)
// ------------------------------------------------------------------

test('Utils.error FEEDS the buffer — every existing error call site becomes evidence', () => {
    const utils = readRepo('src/shared/utils.js');
    assert.match(utils, /recordDiagnostic\(/, 'Utils.error must record, not only console.error');
    // And log() must NOT record — errors only, by design.
    const logLine = utils.split('\n').find((l) => l.trim().startsWith('log:'));
    assert.ok(logLine && !logLine.includes('recordDiagnostic'),
        'Utils.log is debug console output, never recorded');
});

test('the Options page can READ the buffer out — copy and clear affordances exist', () => {
    const html = readRepo('src/options/options.html');
    const js = readRepo('src/options/index.js');
    assert.match(html, /id="diagnostics-copy"/, 'a Copy diagnostics button exists');
    assert.match(html, /id="diagnostics-clear"/, 'a Clear button exists');
    assert.match(js, /formatDiagnostics\(/, 'copy composes the formatted report');
    assert.match(js, /clearDiagnostics\(/);
    // Self-verification without contriving a failure (field-found
    // 2026-08-23: the suggested error-trigger was unreachable because
    // the DC.1 picker routes a keyless engine to Settings instead of
    // letting it fail).
    assert.match(html, /id="diagnostics-test"/, 'a self-test button exists');
    assert.match(js, /recordDiagnostic\('options', 'diagnostics self-test/,
        'the self-test records a real entry through the real path');
});

test('the buffer never travels: excluded from backups', async () => {
    const backup = readRepo('src/shared/backup.js');
    assert.match(backup, /DIAGNOSTICS_STORAGE|xray:diagnostics/,
        'backup.js must name the diagnostics key in its exclusions');
    const { EXCLUDED } = await import('../src/shared/backup.js')
        .then((m) => ({ EXCLUDED: null }))
        .catch(() => ({ EXCLUDED: null }));
    // Structural check is the greppable one above; the module-level
    // exclusion list is not exported, which is fine — the grep pins it.
});

test('the reader ERROR SURFACES feed the ring — banners and error toasts', () => {
    // Field-found 2026-08-23 by the ring's first real use: a failed
    // Substack transcription showed an error banner while Copy
    // diagnostics came back empty. The recorder existed; the surfaces a
    // user actually SEES failures on did not feed it — the seam lesson,
    // fourth appearance.
    const reader = readRepo('src/reader/index.js');
    const toastFn = /function toast\(message[\s\S]*?\n}/.exec(reader);
    assert.ok(toastFn, 'toast moved');
    assert.match(toastFn[0], /type === 'error'[\s\S]*?Utils\.error\(/,
        'an error-toned toast must record');
    const banner = /function renderTranscribeBanner\([\s\S]*?\n}/.exec(reader);
    assert.ok(banner, 'renderTranscribeBanner moved');
    assert.match(banner[0], /tone === 'error'[\s\S]*?Utils\.error\(/,
        'an error banner must record');
    assert.ok(!/tone === 'warning'[\s\S]{0,80}Utils\.error/.test(banner[0]),
        'warnings are disclosures, not failures — unrecorded by design');
});
