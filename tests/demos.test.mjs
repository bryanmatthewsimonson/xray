// Demo scripts — FLF Epistack entry (win plan §5.4). The three demos are
// self-verifying (they exit non-zero if their invariant breaks); this
// runs each as a subprocess so `npm test` gates them like everything else.
// No relay access needed — relay-replay runs its offline --self-test.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const run = (script, args = []) =>
    execFileSync('node', [join('demos', script), ...args], { cwd: root, encoding: 'utf8' });

test('content-address-tamper demo holds its invariants', () => {
    const out = run('content-address-tamper.mjs');
    assert.match(out, /all invariants held/);
    assert.match(out, /NO LONGER BINDS/);       // the tamper broke the binding
    assert.match(out, /UNCHANGED/);             // benign reformatting did not
});

test('n2-disagreeing-verdict demo never averages the disagreement', () => {
    const out = run('n2-disagreeing-verdict.mjs');
    assert.match(out, /all invariants held/);
    assert.match(out, /unanimous\s+false/);
});

test('relay-replay demo passes its offline self-test', () => {
    const out = run('relay-replay.mjs', ['--self-test']);
    assert.match(out, /self-test passed/);
});
