// "Accept all open (N)" per article on the portal's claim-proposals
// block — field-found 2026-08-25: the corpus held 1931 open claim
// proposals across 28 articles, each behind a collapsed fold with ONLY
// per-row Accept inside. The reader's Suggest modal has had "Accept all
// valid (N)" since MA.4; the portal block reviewing the SAME layer had
// no batch path at all, which at corpus scale means no path.
//
// Source-level guards (the block is DOM-heavy; the minting path it
// shares with per-row Accept is what matters):

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const strip = (x) => x.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const SRC = strip(readFileSync(new URL('../src/portal/extraction-block.js', import.meta.url), 'utf8'));
const PAINT = SRC.slice(SRC.indexOf('function paintMember'));

test('the batch button exists, is scoped to ONE article, and names its count', () => {
    assert.match(PAINT, /Accept all open \(\$\{openUncovered\.length\}\)/,
        'the button must say how many it will mint, like the reader\'s "Accept all valid (N)"');
});

test('the batch accepts exactly the rows per-row Accept offers — never the covered fold', () => {
    // openCovered atoms already have an existing claim; batch-accepting
    // them would mint duplicates.
    const batch = /acceptAllBtn[\s\S]{0,1200}/.exec(PAINT);
    assert.ok(batch, 'the batch handler exists');
    assert.match(batch[0], /openUncovered/, 'the batch iterates the uncovered open rows');
    assert.ok(!/openCovered/.test(batch[0]), 'the covered fold must stay out of the batch');
});

test('batch and row accept share ONE minting path', () => {
    // The 2026-08 failure signature is two copies drifting. Exactly one
    // ClaimModel.create call site may exist in paintMember.
    const mints = (PAINT.match(/ClaimModel\.create/g) || []).length;
    assert.equal(mints, 1, `paintMember must mint through one shared path (found ${mints} call sites)`);
    assert.match(PAINT, /function acceptOne|const acceptOne/, 'the shared helper exists');
});

test('a mid-batch failure continues and is counted, and the batch never reloads the case', () => {
    const batch = /acceptAllBtn[\s\S]{0,1600}/.exec(PAINT)[0];
    assert.match(batch, /failed/, 'failures must be surfaced, not swallowed');
    assert.ok(!/onReloadCase/.test(PAINT), 'the block must never reload the case per accept (the forensic bug, same class)');
});

test('an atom triaged by its own row is never re-processed by the batch (double-mint guard)', () => {
    // acceptOne marks the row done; Dismiss marks before removing; the
    // batch skips marked rows. Without all three, a single-then-batch
    // sequence mints the same atom twice.
    assert.match(PAINT, /row\.dataset\.xrDone = '1';[\s\S]{0,220}replaceChildren/, 'accept marks done');
    assert.match(PAINT, /'dismissed'\);\s*\n\s*row\.dataset\.xrDone = '1';/, 'dismiss marks done');
    assert.match(PAINT, /row\.dataset\.xrDone\) continue/, 'the batch skips done rows');
});
