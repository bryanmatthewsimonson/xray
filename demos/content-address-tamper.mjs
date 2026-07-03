#!/usr/bin/env node
// Content-addressing tamper demo — FLF Epistack entry (win plan §5.4a, §7.1).
//
// Shows the property no incumbent has: an X-Ray verdict is bound to the
// EXACT reviewed bytes by the canonical article hash (the `x` tag, Phase
// 13.4). Edit the source and the hash changes, so the prior verdict
// visibly no longer binds — while benign reformatting (trailing spaces,
// CRLF) leaves the hash, and the binding, intact.
//
// Runnable + self-verifying: `node demos/content-address-tamper.mjs`
// prints the narrative and exits non-zero if the invariant breaks.
//
// It uses the SAME hash the extension publishes — imported straight from
// src/, no reimplementation — so what you see here is what binds on the
// wire.

import { articleHash, normalizeForHash } from '../src/shared/audit/article-hash.js';

const SOURCE = `# Eggs and cardiovascular disease

A pooled analysis of six US cohorts (29,615 adults) reported that each
half-egg per day was associated with a 6% higher cardiovascular-disease
risk and 8% higher all-cause mortality.
`;

// A verdict binds to the exact reviewed bytes via its \`x\` tag.
function verdictBoundTo(xHash) {
    return {
        kind: 30063,
        verdict: 'contested',
        standard_of_proof: 'preponderance',
        tags: [['x', xHash]],
        caveats: ['Overlapping cohorts limit independence.']
    };
}

function short(h) { return `${h.slice(0, 12)}…${h.slice(-8)}`; }
function bindsTo(verdict, xHash) { return verdict.tags.some((t) => t[0] === 'x' && t[1] === xHash); }

const fail = (msg) => { console.error(`\n✗ INVARIANT BROKEN: ${msg}`); process.exit(1); };

console.log('X-Ray — content-addressing tamper demo\n');

// 1. The original source, hashed, with a verdict bound to it.
const original = await articleHash(SOURCE);
const verdict = verdictBoundTo(original);
console.log(`original x-hash   ${short(original)}`);
console.log(`verdict binds to  x=${short(verdict.tags[0][1])}  →  ${bindsTo(verdict, original) ? 'BINDS ✓' : 'no'}`);
if (!bindsTo(verdict, original)) fail('the verdict should bind to the original bytes');

// 2. Benign reformatting — trailing spaces + CRLF — must NOT change the hash.
const reformatted = SOURCE.replace(/\n/g, '  \r\n');   // trailing spaces + CRLF everywhere
const reformattedHash = await articleHash(reformatted);
console.log(`\nreformatted (trailing spaces + CRLF)`);
console.log(`  x-hash          ${short(reformattedHash)}  →  ${reformattedHash === original ? 'UNCHANGED ✓' : 'changed'}`);
if (reformattedHash !== original) fail('benign reformatting must not change the content address');
if (!bindsTo(verdict, reformattedHash)) fail('the verdict must still bind after benign reformatting');

// 3. A one-character content edit — "6%" → "9%" — MUST change the hash,
//    so the prior verdict no longer binds to the tampered bytes.
const tampered = SOURCE.replace('6% higher cardiovascular', '9% higher cardiovascular');
const tamperedHash = await articleHash(tampered);
console.log(`\ntampered ("6%" → "9%")`);
console.log(`  x-hash          ${short(tamperedHash)}  →  ${tamperedHash !== original ? 'CHANGED ✓' : 'unchanged'}`);
console.log(`  prior verdict   binds to tampered bytes?  →  ${bindsTo(verdict, tamperedHash) ? 'BINDS' : 'NO LONGER BINDS ✓'}`);
if (tamperedHash === original) fail('a content edit must change the content address');
if (bindsTo(verdict, tamperedHash)) fail('the prior verdict must NOT bind to tampered bytes');

// The normalization is the load-bearing part: it is what makes the hash
// stable across captures yet sensitive to content.
if (normalizeForHash(reformatted) !== normalizeForHash(SOURCE)) fail('normalization should erase benign reformatting');
if (normalizeForHash(tampered) === normalizeForHash(SOURCE)) fail('normalization must preserve content edits');

console.log(`
Result: the verdict is welded to the reviewed bytes. Edit the source and
the binding breaks in the open (the x-hash no longer matches); reformat it
and the binding holds. Community Notes decays with a post id; fact-checkers
bind to mutable URLs; Ground News rates a publication name — none survives
the edit this demo just made.
`);
console.log('✓ all invariants held');
