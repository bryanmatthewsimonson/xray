// Constitution guards (docs/CONSTITUTION.md Art. 12 — machine
// enforcement). Mirrors the Phase-16 lens-guards idiom: a positive
// sanity assertion proving each scanner sees, then the negative
// assertion that enforces. A red guard here is, by Art. 12, either a
// bug or an unratified amendment — never a test to "fix".
//
//   - The 14 articles exist, in order, under the pinned version header.
//   - The load-bearing clauses are pinned verbatim (whitespace- and
//     markup-normalized): the §1 spine, the five license conditions,
//     the reconciliation sentence, the enforcement formula.
//   - Every P<n> cited from src/ comments resolves to a live P-heading
//     in PHILOSOPHY.md (the first guard that reads a governing doc).
//   - The Concord Schedule's cross-references resolve, two-sided.
//   - Version stamps agree (constitution log, PHILOSOPHY v1.1.0+,
//     CLAUDE.md pointer).
//   - The Art. 10 wire-kind schedule matches the code: retired/free
//     kinds unemitted, 30065 constant-reserved but never emitted.
//   - The never-merge firewall holds at the export surface (Art. 6).
//   - No operator identity is special-cased in src/ (Art. 8.6).
//   - The CASE_SYNTHESIS P5→P8 citation drift stays fixed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// truth-model touches chrome.storage at import time — stub first.
globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

const constitution = await readFile(new URL('../docs/CONSTITUTION.md', import.meta.url), 'utf8');
const philosophy = await readFile(new URL('../docs/PHILOSOPHY.md', import.meta.url), 'utf8');

// Markdown-tolerant normalization: strip blockquote markers and
// emphasis, collapse whitespace — so a re-wrap never breaks a pin but
// a reworded clause always does.
const normalize = (s) => s.replace(/[>*`]/g, '').replace(/\s+/g, ' ').trim();
const normConstitution = normalize(constitution);
const normPhilosophy = normalize(philosophy);

const SPINE = 'Verdicts are descriptive states. Quantities are measurements, never '
    + 'estimations. Every number shows its derivation from evidence, or it does not appear.';
const RECONCILIATION = 'The only lawful remedy for a lie is a durable, evidence-bound '
    + 'record beside it — never its removal.';
const ENFORCEMENT = 'is not a feature; it is a different, worse system';

async function* walkJs(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) yield* walkJs(p);
        else if (entry.name.endsWith('.js')) yield p;
    }
}

// ------------------------------------------------------------------
// Structure: articles + version header (Art. 12)
// ------------------------------------------------------------------

test('guard: the constitution carries the pinned version header', () => {
    assert.match(constitution, /^\*\*Document version:\*\* \d+\.\d+\.\d+$/m);
    assert.match(constitution, /^\*\*Status:\*\* Normative — supreme$/m);
});

test('guard: all fourteen articles exist, in order (Art. 12)', () => {
    const headings = [
        '## Preamble — mandate and honest limits',
        '## Article 1 — Definitions and scope',
        '## Article 2 — Supremacy and the organic statutes',
        '## Article 3 — The two missions and their mutual constraint',
        '## Article 4 — Universal principles',
        '## Article 5 — The form of judgment and the license of estimation',
        '## Article 6 — The never-merge firewall',
        '## Article 7 — Targets of criticism',
        '## Article 8 — Operator accountability',
        '## Article 9 — Discipline standards',
        '## Article 10 — The wire covenant',
        '## Article 11 — Governance',
        '## Article 12 — Red lines and enforcement',
        '## Article 13 — Amendment',
        '## Article 14 — Ratification and the Concord Schedule',
        '## Amendment log'
    ];
    let cursor = -1;
    for (const h of headings) {
        const at = constitution.indexOf(h);
        assert.ok(at > -1, `heading present: "${h}"`);
        assert.ok(at > cursor, `heading in order: "${h}"`);
        cursor = at;
    }
});

// ------------------------------------------------------------------
// The load-bearing clauses, pinned verbatim (Art. 12)
// ------------------------------------------------------------------

test('guard: the Art. 5 spine and license conditions are pinned verbatim', () => {
    assert.ok(normConstitution.includes(SPINE), 'the §1 spine is quoted in Art. 5');
    for (const label of ['Declared.', 'Derived in the open.', 'Spread-shown.',
        'Stakes-bounded.', 'Firewall-respecting.']) {
        assert.ok(normConstitution.includes(label), `license condition "${label}"`);
    }
    // The corrective sentence recording the aggregation reopening.
    assert.ok(normConstitution.includes('refusing them wholesale was itself a form of false precision'));
});

test('guard: the Art. 3 reconciliation clause is pinned verbatim', () => {
    assert.ok(normConstitution.includes(RECONCILIATION));
});

test('guard: the enforcement formula is pinned, two-sided with PHILOSOPHY §10', () => {
    assert.ok(normConstitution.includes(ENFORCEMENT), 'constitution side');
    assert.ok(normPhilosophy.includes(ENFORCEMENT), 'PHILOSOPHY §10 side');
});

// ------------------------------------------------------------------
// Citation integrity: every P<n> in src/ comments resolves (Art. 14)
// ------------------------------------------------------------------

test('guard: every P<n> cited from src/ exists as a PHILOSOPHY.md principle', async () => {
    const principles = new Set(
        [...philosophy.matchAll(/^### P(\d+) —/gm)].map((m) => Number(m[1]))
    );
    assert.equal(principles.size, 12, 'sanity: PHILOSOPHY.md carries exactly twelve principles');

    const srcRoot = fileURLToPath(new URL('../src', import.meta.url));
    const cited = new Map(); // n -> first "file:line" seen
    for await (const file of walkJs(srcRoot)) {
        const lines = (await readFile(file, 'utf8')).split('\n');
        lines.forEach((line, i) => {
            // Comment context only: full-line comments, block-comment
            // bodies, or the trailing part of a line after `//`.
            const at = line.indexOf('//');
            const comment = /^\s*(\/\*+|\*)/.test(line) ? line
                : at > -1 ? line.slice(at)
                : null;
            if (!comment) return;
            for (const m of comment.matchAll(/\bP(1[0-2]|[1-9])\b/g)) {
                const n = Number(m[1]);
                if (!cited.has(n)) cited.set(n, `${file}:${i + 1}`);
            }
        });
    }
    assert.ok(cited.has(8), 'sanity: the scan sees P8 (portal/inspector.js cites it)');
    assert.ok(cited.has(4), 'sanity: the scan sees P4 (shared/dossier-time.js cites it)');
    for (const [n, where] of cited) {
        assert.ok(principles.has(n),
            `P${n} cited at ${where} has no matching PHILOSOPHY.md heading`);
    }
});

// ------------------------------------------------------------------
// Concord Schedule cross-references (Art. 14)
// ------------------------------------------------------------------

test('guard: the Concord Schedule cross-references resolve, two-sided', async () => {
    const truth = await readFile(new URL('../docs/TRUTH_ADJUDICATION_DESIGN.md', import.meta.url), 'utf8');
    const dossier = await readFile(new URL('../docs/CASE_DOSSIER_DESIGN.md', import.meta.url), 'utf8');
    const lens = await readFile(new URL('../docs/MORAL_LENS_JURISDICTION_DESIGN.md', import.meta.url), 'utf8');

    assert.ok(truth.includes('## §1.'), 'TRUTH_ADJUDICATION §1 heading');
    assert.ok(truth.includes('## §5.'), 'TRUTH_ADJUDICATION §5 heading');
    // The spine quote pinned on BOTH sides — an edit to either doc
    // fails CI and forces a conscious concord amendment.
    assert.ok(normalize(truth).includes(SPINE), 'spine in TRUTH_ADJUDICATION §1');
    assert.ok(normConstitution.includes(SPINE), 'spine in CONSTITUTION Art. 5');
    assert.ok(truth.includes('organic statute'), 'TRUTH_ADJUDICATION concord status line');

    assert.ok(dossier.includes('No case-level score, ever'), 'CASE_DOSSIER §2 principle');
    assert.ok(lens.includes('### 5.1'), 'MORAL_LENS §5.1 heading');
});

// ------------------------------------------------------------------
// Version stamps (Art. 13/14)
// ------------------------------------------------------------------

test('guard: version stamps are consistent across the concord', async () => {
    const headerVersion = constitution.match(/^\*\*Document version:\*\* (\d+\.\d+\.\d+)$/m)[1];
    assert.ok(constitution.includes(`**v${headerVersion} —`),
        'the header version has a matching Amendment log entry');

    const philVersion = philosophy.match(/^\*\*Document version:\*\* (\d+\.\d+\.\d+)$/m)[1];
    const [maj, min] = philVersion.split('.').map(Number);
    assert.ok(maj > 1 || (maj === 1 && min >= 1),
        `PHILOSOPHY.md is v1.1.0+ (concord amendment applied), got ${philVersion}`);
    assert.ok(philosophy.includes('organic statute of the X-Ray Epistemic Auditor'),
        'PHILOSOPHY.md self-describes as the audit-family organic statute');
    assert.ok(philosophy.includes('docs/CONSTITUTION.md'),
        'PHILOSOPHY.md names the constitution');

    const claudeMd = await readFile(new URL('../CLAUDE.md', import.meta.url), 'utf8');
    assert.ok(claudeMd.includes('docs/CONSTITUTION.md'),
        'CLAUDE.md points contributors at the constitution');
});

// ------------------------------------------------------------------
// The wire covenant (Art. 10): retired/free/reserved kinds vs code
// ------------------------------------------------------------------

test('guard: the Art. 10 kind schedule matches the code — retired and free kinds unemitted', async () => {
    const srcRoot = fileURLToPath(new URL('../src', import.meta.url));
    const emitted = new Set();   // `kind: N` / `.kind = N` sites
    const constants = new Set(); // KIND_X / X_KIND declarations
    for await (const file of walkJs(srcRoot)) {
        const text = await readFile(file, 'utf8');
        for (const m of text.matchAll(/\bkind\s*[:=]\s*(\d{1,5})\b/g)) emitted.add(Number(m[1]));
        for (const m of text.matchAll(/\b(?:[A-Z][A-Z0-9_]*_)?KIND(?:_[A-Z0-9][A-Z0-9_]*)?\s*=\s*(\d{1,5})\b/g)) {
            constants.add(Number(m[1]));
        }
    }
    const anywhere = new Set([...emitted, ...constants]);
    assert.ok(anywhere.has(30023), 'sanity: the scan sees the article kind');
    assert.ok(anywhere.has(30063), 'sanity: the scan sees the verdict kind');
    assert.ok(anywhere.has(30040), 'sanity: the scan sees suffix-style constants (CLAIM_KIND)');

    assert.equal(anywhere.has(30066), false, '30066 stays FREE (Art. 10; the lens has no wire kind)');
    assert.equal(anywhere.has(30067), false, '30067 stays RETIRED (fact sheets — never reuse)');
    assert.equal(anywhere.has(30043), false, '30043 stays RETIRED (evidence — never reuse)');
    // 30065 is reserved: pinned as a constant, never at an emission site.
    assert.ok(constants.has(30065), 'sanity: KIND_PRECEDENT_RESERVED still pins 30065');
    assert.equal(emitted.has(30065), false, '30065 stays RESERVED — no builder emits it');
});

// ------------------------------------------------------------------
// The never-merge firewall at the export surface (Art. 6)
// ------------------------------------------------------------------

test('guard: the never-merge firewall holds at the export surface', async () => {
    const truthBuilders = await import('../src/shared/truth-builders.js');
    const truthModel = await import('../src/shared/truth-adjudication-model.js');
    const auditBuilders = await import('../src/shared/audit/builders.js');

    // Sanity: each family exports its own vocabulary…
    assert.ok(Object.keys(truthBuilders).some((k) => /verdict/i.test(k)),
        'sanity: truth-builders speaks verdict');
    assert.ok(Object.keys(auditBuilders).some((k) => /audit/i.test(k)),
        'sanity: audit builders speak audit');
    // …and never the other family's. The truth family carries no
    // score; the audit family renders no verdict.
    for (const [name, mod] of [['truth-builders', truthBuilders], ['truth-adjudication-model', truthModel]]) {
        for (const key of Object.keys(mod)) {
            assert.doesNotMatch(key, /score|rating|percent/i, `${name} export "${key}"`);
        }
    }
    for (const key of Object.keys(auditBuilders)) {
        assert.doesNotMatch(key, /verdict|ruling/i, `audit builders export "${key}"`);
    }
});

// ------------------------------------------------------------------
// No operator special-casing in code (Art. 8.6)
// ------------------------------------------------------------------

test('guard: no operator identity is hard-coded in src/ (Art. 8.6)', async () => {
    const NPUB = /npub1[023456789acdefghjklmnpqrstuvwxyz]{58}/;
    const HEX_IDENTITY = /\b[A-Za-z_$]*(?:PUBKEY|NPUB|OPERATOR|MAINTAINER)[A-Za-z_$]*\s*=\s*['"][0-9a-fA-F]{64}['"]/;
    // Sanity: both patterns actually match what they claim to.
    assert.match('npub1' + 'q'.repeat(58), NPUB);
    assert.match(`const OPERATOR_PUBKEY = '${'a'.repeat(64)}'`, HEX_IDENTITY);

    const srcRoot = fileURLToPath(new URL('../src', import.meta.url));
    for await (const file of walkJs(srcRoot)) {
        const text = await readFile(file, 'utf8');
        assert.doesNotMatch(text, NPUB, `${file}: a full npub literal in source`);
        assert.doesNotMatch(text, HEX_IDENTITY, `${file}: a hard-coded identity constant`);
    }
});

// ------------------------------------------------------------------
// Regression pin: the CASE_SYNTHESIS citation drift stays fixed
// ------------------------------------------------------------------

test('guard: CASE_SYNTHESIS cites P8 for disagreement-is-data (drift fixed 2026-07-22)', async () => {
    const doc = await readFile(new URL('../docs/CASE_SYNTHESIS_DESIGN.md', import.meta.url), 'utf8');
    assert.ok(doc.includes('**Disagreement is data** (P8'), 'the corrected citation');
    assert.equal(doc.includes('(P5): positions'), false, 'the drifted citation is gone');
});

// Deferred guard (recorded per the lens-guards idiom): when the first
// Art. 5 estimation surface ships, add a functional guard asserting its
// stored/wire record carries the machine-readable estimate label and
// method-disclosure fields (Art. 5.2 conditions 1–2).
