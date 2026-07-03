#!/usr/bin/env node
// n=2 disagreeing-verdict demo — FLF Epistack entry (win plan §5.4b, §7.7).
//
// Compounding shown live at n=2: two authors rule on the SAME proposition
// (bound to the same claim coordinate) and DISAGREE. X-Ray renders both
// side by side and NEVER averages them (PHILOSOPHY.md P8: disagreement is
// data). This is the structural answer to "who decides" — the graph holds
// the disagreement instead of laundering it into a single number.
//
// It calls the SHIPPED read-time surface `verdictVariance` — the same
// function the portal uses — so the never-average property you see here is
// the one that ships. Runnable + self-verifying:
// `node demos/n2-disagreeing-verdict.mjs`.

// Loader-only shim: truth-adjudication-model.js pulls in storage.js, which
// binds chrome.storage.local at load. This demo never touches storage — the
// shim only lets the pure verdictVariance import resolve outside a browser.
globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

const { verdictVariance } = await import('../src/shared/truth-adjudication-model.js');

// Two authors, one proposition, opposite rulings — each with its own
// verbatim evidence and mandatory caveat. Bound to the same claim
// coordinate; deliberately no p-tag (a verdict attaches to the
// proposition, not a person).
const CLAIM_COORD = '30040:npub_alice_hex:egg-cvd-risk';

const verdictA = {
    proposition_id: 'prop_egg_cvd',
    verdict: 'contested',
    standard_of_proof: 'preponderance',
    adjudicator: { pubkey: 'author_A' },
    caveats: ['Three defensible cohorts reach opposite conclusions.'],
    tags: [['a', CLAIM_COORD]]
};
const verdictB = {
    proposition_id: 'prop_egg_cvd',
    verdict: 'insufficient-evidence',
    standard_of_proof: 'preponderance',
    adjudicator: { pubkey: 'author_B' },
    caveats: ['Umbrella review rates the whole body "critically low strength".'],
    tags: [['a', CLAIM_COORD]]
};

const fail = (msg) => { console.error(`\n✗ INVARIANT BROKEN: ${msg}`); process.exit(1); };

console.log('X-Ray — n=2 disagreeing-verdict demo\n');
console.log(`proposition   prop_egg_cvd   (claim ${CLAIM_COORD})\n`);
console.log(`  author_A  →  ${verdictA.verdict.padEnd(22)} "${verdictA.caveats[0]}"`);
console.log(`  author_B  →  ${verdictB.verdict.padEnd(22)} "${verdictB.caveats[0]}"`);

const variance = verdictVariance([verdictA, verdictB]);
console.log(`\nverdictVariance (the shipped read-time surface):`);
console.log(`  total          ${variance.total}`);
console.log(`  by_state       ${JSON.stringify(variance.by_state)}`);
console.log(`  states_present ${JSON.stringify(variance.states_present)}`);
console.log(`  unanimous      ${variance.unanimous}`);

// The invariants that make this "disagreement is data, never averaged":
if (variance.total !== 2) fail('both verdicts must be counted');
if (variance.unanimous !== false) fail('two different states must read as non-unanimous');
if (Object.keys(variance.by_state).length !== 2) fail('both states must survive, side by side');
for (const k of Object.keys(variance)) {
    if (typeof variance[k] === 'number' && k !== 'total') fail(`no fused agreement number may exist (found ${k})`);
}
if ('score' in variance || 'mean' in variance || 'consensus' in variance) fail('no averaged consensus field may exist');

console.log(`
Result: the two rulings coexist as a distribution — {contested: 1,
insufficient-evidence: 1}, not-unanimous — with NO merged score. A third
author's verdict on the same coordinate would extend the distribution, not
overwrite it. That is what compounding looks like when the substrate
refuses to average away the disagreement.
`);
console.log('✓ all invariants held');
