# Claim dependency D.4 — the live per-adjudicator badge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a verdict on a premise is `established-false`, every transitive dependent shows a "premise adjudicated false by <author> under <standard>" marker, one per verdict, beside the full distribution of other verdicts on that premise, plus an inconsistency marker when the dependent itself is adjudicated true. No verdict is recomputed, no majority, no consensus (R-026).

**Architecture:** One pure function in `src/shared/case-dependencies.js` joins a claim's transitive premises (`premisesOf`) to every verdict in view on those premises: local chain heads from `data.verdicts.byProposition` and relay verdicts from `data.wire.verdicts` (both carry `proposition_id`; local rows carry `standard_of_proof` + `adjudicator`, wire rows `standardOfProof` + `pubkey`). It returns per-adjudicator rows and the per-premise distribution (`verdictVariance`), and two string helpers produce every label and tooltip. The evidence block and the hypothesis card edge rows project them 1:1; a guard test walks every string for consensus / majority / likelihood phrasing.

**Tech Stack:** plain ES modules, `node --test`.

**Spec:** `docs/CLAIM_DEPENDENCY_DESIGN.md` §3.4 (and R-026 in `docs/RULINGS.md`), §6 red lines 3 and 3a, §7 row D.4.

## Global Constraints

- The marker reads `premise adjudicated false by <author> under <standard>`; it never reads "premise is false". Author: the local verdict's `adjudicator.label`, else `adjudicator.pubkey` shortened, else `you (this X-Ray)`; a wire verdict's `pubkey` shortened to its first 12 hex + `…`. Standard: `STANDARD_OF_PROOF_LABELS`.
- One marker per `established-false` verdict (never merged), and the tooltip lists EVERY verdict on that premise by state with its authors and standards. Banned anywhere in these strings: `consensus`, `majority`, `most adjudicators`, `agree`, `outvoted`, `wins`, `more likely`, `less likely`, `probab`, `confidence`, `score`.
- The dependent's own verdict is never changed, hidden or restyled. When the dependent's own chain head is `established-true` and a premise has an `established-false` verdict, a third marker reads `claim adjudicated true, premise adjudicated false — an inconsistency, not a correction`.
- Only chain HEADS count locally (`!superseded_by`); wire rows are taken as given (the collector's contract already says they must carry local proposition ids).
- `data.wire.verdicts` is an empty default on the case dashboard today; the function must work with it empty and with it filled, and no code in this slice fetches relays.
- 4-space indentation, `Utils.log` only, `xr-*` classes. `docs/SMOKE_TEST.md` is a process file: the PR cites JOURNAL 2026-11-06.

## Review Focus

1. A premise with one `established-false` local head and two wire `established-true` verdicts must yield ONE marker and a tooltip naming all three with authors and standards — Task 1 tests it.
2. A superseded local verdict (`superseded_by` set) must not produce a marker even if it was `established-false` — Task 1.
3. A premise reached only through a chain of two must still produce a marker, with the chain in the tooltip — Task 1.
4. The dependent's own `established-false` head must NOT produce an inconsistency marker (only `established-true` does) — Task 1.
5. A claim with no premises, or premises with no verdicts, must produce nothing and never throw on missing `wire` or `verdicts` keys — Task 1.

---

### Task 1: The pure join and its strings

**Files:**
- Modify: `src/shared/case-dependencies.js` (append)
- Test: `tests/case-dependencies.test.mjs` (append)

**Interfaces:**
- Consumes: `premisesOf(dependencies, ref)` (D.2), `verdictVariance` from `truth-adjudication-model.js`, `STANDARD_OF_PROOF_LABELS` + `VERDICT_STATE_LABELS` from `truth-taxonomy.js`.
- Produces:
  - `premiseVerdictMarkers(data, ref)` → `{ count, derivation: Array<Row>, inconsistency: boolean, own_state: string|null }` where `Row = { premise_ref, chain: string[], proposition_id, proposition_class, verdict_id, source: 'local'|'wire', author: string, author_pubkey: string|null, standard: string, distribution: { total, by_state, by_standard, states_present, unanimous, authors_by_state: { [state]: Array<{ author, standard, source, id }> } }, derivation: string[] }` — one row per `established-false` verdict on any transitive premise, sorted by premise_ref then verdict id; `derivation` = the dependency link ids of the chain. `inconsistency` is true when `own_state === 'established-true'` and `count > 0`.
  - `premiseMarkerLabel(row)` → `premise adjudicated false by <author> under <standard label>`.
  - `premiseMarkerTooltip(row, claimsById)` → line 1 `Premise: “<text>” (via a → b)`; then one line per state present: `<state label> ×N — <author> (<standard label>)[, …]`; last line fixed: `One adjudicator's verdict, shown beside the others. No verdict on this claim is recomputed.`
  - `export const PREMISE_INCONSISTENCY_LABEL = 'claim adjudicated true, premise adjudicated false — an inconsistency, not a correction'`.

- [ ] **Step 1: Write the failing tests** — a fixture `verdictData()`: claims A (premise), B depends on A, C depends on B; propositions `p_a` on A, `p_c` on C; local chains: `p_a` has `v1` (`established-false`, `beyond-reasonable-doubt`, `adjudicator: { label: 'Dr Ferran' }`) superseding `v0` (`established-true`, superseded_by v1); `p_c` head `established-true`; wire verdicts on `p_a`: two `established-true` from pubkeys `'1'.repeat(64)` (`preponderance`) and `'2'.repeat(64)` (`clear-and-convincing`).

```js
test('premiseVerdictMarkers: one marker per established-false verdict on a transitive premise, with the whole distribution beside it', () => {
    const r = premiseVerdictMarkers(verdictData(), C);
    assert.equal(r.count, 1);
    const row = r.derivation[0];
    assert.equal(row.premise_ref, A);
    assert.deepEqual(row.chain, [C, B, A]);
    assert.equal(row.author, 'Dr Ferran');
    assert.equal(row.standard, 'beyond-reasonable-doubt');
    assert.equal(row.source, 'local');
    assert.deepEqual(row.distribution.by_state, { 'established-false': 1, 'established-true': 2 });
    assert.deepEqual(row.distribution.authors_by_state['established-true'].map((a) => a.author), ['111111111111…', '222222222222…']);
    assert.equal(r.own_state, 'established-true');
    assert.equal(r.inconsistency, true);
});
test('premiseVerdictMarkers: a superseded verdict never produces a marker; no premises or no verdicts produce nothing; missing keys do not throw', () => { … });
test('premiseVerdictMarkers: the dependent\'s own established-false head is not an inconsistency', () => { … });
test('premiseMarkerLabel / premiseMarkerTooltip: who and by what standard, every state listed, the fixed closing line', () => {
    const row = premiseVerdictMarkers(verdictData(), C).derivation[0];
    assert.equal(premiseMarkerLabel(row), 'premise adjudicated false by Dr Ferran under Beyond reasonable doubt');
    const tip = premiseMarkerTooltip(row, { [A]: { text: 'A says.' } });
    assert.match(tip, /^Premise: “A says\.” \(via .* → .*\)\n/);
    assert.match(tip, /Established false ×1 — Dr Ferran \(Beyond reasonable doubt\)/);
    assert.match(tip, /Established true ×2 — 111111111111… \(Preponderance of the evidence\), 222222222222… \(Clear and convincing\)/);
    assert.ok(tip.endsWith('One adjudicator\'s verdict, shown beside the others. No verdict on this claim is recomputed.'));
});
test('premise markers: no consensus / majority / likelihood phrasing in any string', () => {
    const banned = /consensus|majority|most adjudicators|\bagree|outvoted|\bwins?\b|more likely|less likely|probab|confidence|score/i;
    for (const s of [premiseMarkerLabel(row), premiseMarkerTooltip(row, {}), PREMISE_INCONSISTENCY_LABEL]) assert.doesNotMatch(s, banned);
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `node --test tests/case-dependencies.test.mjs`
Expected: FAIL — `premiseVerdictMarkers` not exported.

- [ ] **Step 3: Implement** the function and the two helpers plus the constant, with a header comment citing §3.4 and R-026 and the Art. 6 reading ("a derived view over one family's record; no number produced, no state written").

- [ ] **Step 4: Run the file's suite**

Run: `node --test tests/case-dependencies.test.mjs`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/case-dependencies.js tests/case-dependencies.test.mjs
git commit -m "feat(deps): per-adjudicator premise-verdict markers with the full distribution beside each (D.4)"
```

---

### Task 2: Markers on the case dashboard's claim rows

**Files:**
- Modify: `src/portal/evidence-block.js` (beside the D.3 load chip)

**Interfaces:**
- Consumes: Task 1's three exports.
- Produces: per claim row, one `xr-badge xr-badge--warn xr-badge--premise` chip per marker row with `title = premiseMarkerTooltip(row, data.claimsById)`; when `inconsistency`, one `xr-badge xr-badge--warn` chip with `PREMISE_INCONSISTENCY_LABEL`. Nothing else on the row changes; the load chip and the trace expander stay.

- [ ] **Step 1: Implement** (no node-testable seam beyond Task 1's; the row is covered by smoke P-D.i–k). Compute `premiseVerdictMarkers(data, c.claim_id)` inside the existing `dependencyLinks.length > 0` branch.

- [ ] **Step 2: Build and run the structure guards**

Run: `npm run build && node --test tests/structure-guards.test.mjs`
Expected: green.

- [ ] **Step 3: Commit**

```bash
git add src/portal/evidence-block.js
git commit -m "feat(portal): premise-adjudicated-false and inconsistency markers on claim rows (D.4)"
```

---

### Task 3: Markers on hypothesis-card edge rows

**Files:**
- Modify: `src/portal/hypothesis-block.js` (the model's edge rows gain `premiseMarkers: Array<{ label, tooltip }>` and `inconsistency: string|null`; the DOM projects them after the verdict chips)
- Test: `tests/hypothesis-block.test.mjs`

**Interfaces:**
- Consumes: Task 1's exports; the model builder's existing `{ dependencies, claimsById }` second argument gains `verdicts` and `wire` (pass `data.verdicts` and `data.wire` from the block's own call, which already has `data`).
- Produces: `edge.premiseMarkers` and `edge.inconsistency` on every edge row; the no-scoreboard guard walks them.

- [ ] **Step 1: Write the failing test** — extend `sharedPremiseModel()`'s data with a proposition on c3 whose head is `established-false` (adjudicator label `Dr Ferran`, `preponderance`), pass `{ dependencies, claimsById, verdicts: data.verdicts, wire: data.wire }`, and assert the supporting edge from c1 carries one `premiseMarkers` entry whose label is `premise adjudicated false by Dr Ferran under Preponderance of the evidence`, and that `allStrings(model)` passes the no-scoreboard regex plus the Task 1 banned regex.

- [ ] **Step 2: Run and watch it fail**; **Step 3: Implement**; **Step 4: Run** `node --test tests/hypothesis-block.test.mjs` — all PASS; **Step 5: Commit** `feat(portal): premise-verdict markers on hypothesis edge rows (D.4)`.

---

### Task 4: Smoke rows, ladder, changelog, PR

**Files:**
- Modify: `docs/SMOKE_TEST.md` (rows P-D.i–k appended to the Claim dependencies section), `docs/CLAIM_DEPENDENCY_DESIGN.md` (§7 row D.4 shipped; §3.4 gains one sentence: relay verdicts reach the markers only when the collector is handed them — `collectCaseDossierData`'s `wire` option — which the case dashboard does not do yet), `CHANGELOG.md`

- [ ] **Step 1: Smoke rows** — P-D.i: adjudicate the premise `established-false` (Dr Ferran, beyond reasonable doubt) → the dependent's row shows "premise adjudicated false by Dr Ferran under Beyond reasonable doubt"; the tooltip lists the premise, every state with authors, and ends with the fixed line. P-D.j: adjudicate the dependent `established-true` → a second chip "claim adjudicated true, premise adjudicated false — an inconsistency, not a correction"; the dependent's own verdict chip is unchanged. P-D.k: supersede the premise's verdict with `established-true` → both chips disappear; nothing else on the row changes.

- [ ] **Step 2: Run the gates** `npm run lint:js && npm run build && npm run check:budget && npm test` — green.

- [ ] **Step 3: Commit, push, open the PR** — `Verification layer: unit + guard + human-soak (P-D.i–k)`; `Wire format: none`; `Docs: docs/SMOKE_TEST.md (JOURNAL 2026-11-06), docs/CLAIM_DEPENDENCY_DESIGN.md, CHANGELOG.md`; interpretive steps: wire verdicts read only from the collector's existing `wire` option (no fetch here); markers on the case dashboard and hypothesis cards only (the reader's claim card has no dossier — a later slice); wire-verdict supersession not resolved client-side (rows taken as the collector gives them).
