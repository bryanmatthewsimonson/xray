# Claim dependency D.3 — the render slice — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the dependency edge authorable and the D.2 measurements visible: `depends-on` in the reader's link picker behind its authoring test, the cascade's copy in the trace expander, "Load-bearing (n)" on claim rows, shared-premise markers on hypothesis cards, dependency arrows in the case graph, chips on the case view's claim list, and the extract flag relabelled so "load-bearing" means the measured count. No verdict is read (D.4).

**Architecture:** Every string a surface shows comes from a pure, tested function (`traceLines`, a new `loadLabel`, the hypothesis-block model, the picker's help text constant); the DOM layers project them 1:1, as CF.2 and the hypothesis block already do. The copy guards that forbid likelihood / strength / scoreboard phrasing extend over the new lines. Picker exposure flips in `evidence-linker.js` by widening `EVIDENCE_RELATIONSHIPS`, the single constant the modal reads.

**Tech Stack:** plain ES modules, `node --test`; portal blocks tested at the model layer (no DOM in node).

**Spec:** `docs/CLAIM_DEPENDENCY_DESIGN.md` §2.1 (the authoring test), §3.1 (load as a measurement), §3.2 (the cascade; "only falsity propagates" said in one fixed sentence), §3.3 (shared premises), §5 (rendering and copy discipline), §6, §7 row D.3, §8 (the ⭐ copy is the open item).

## Global Constraints

- 4-space indentation; `Utils.log` only; `xr-*` CSS prefix; "X-Ray" hyphenated; no emoji added beyond the existing icon tables.
- The authoring test, verbatim (§2.1): *Could the source still be true if the target turned out to be false? If yes, the link is `supports`, not `depends-on`.*
- The asymmetry sentence, verbatim (§3.2) — one fixed line in the cascade copy: *The truth of a premise establishes nothing about its dependents; only falsity propagates.*
- Copy discipline (§5): no line reads "more/less likely", "stronger/weaker", "% chance"; permitted shapes are "would lose a necessary premise", "is undercut", "shares a premise with". The `tests/case-counterfactual.test.mjs` §4 copy guard and the `tests/hypothesis-block.test.mjs` no-scoreboard guard are the enforcers and must stay green.
- "Load-bearing (n dependents)" is a per-claim section size, never compared across claims (no bar, no sort by load) — §5.
- A shared-premise marker names the premise and the edges; it never discounts, weights or re-sorts the edges (§3.3).
- The case graph draws `depends-on` as a DIRECTED edge from dependent to premise, visually distinct from `supports`; nothing is recolored on a scale (§5).
- Structure guards: `src/reader/claim-extractor.js` and the portal files have DOM-count and line ceilings in `tests/structure-guards.test.mjs` — extract, never raise.
- `docs/SMOKE_TEST.md` is a process file: the PR cites JOURNAL 2026-11-06 (the D.1 entry) rather than adding a new one.

## Review Focus

1. A reader who picks `depends-on` must see the authoring test BEFORE saving, and switching back to `supports` must hide it — Task 1 pins the help text is keyed on the value and exported; the modal wiring is a smoke row (P-D.a).
2. A claim with dependents but no hypothesis edges must still show "Load-bearing (n)" and its tooltip must list the dependents' texts, not ids — Task 3 tests `loadLabel` and the tooltip builder.
3. A cascade whose undercut claims carry no hypothesis edges must render the undercut lines and the asymmetry sentence and nothing about hypotheses — Task 2.
4. The hypothesis card must show a shared premise only when two DISTINCT supporting claims rest on it, and the no-scoreboard guard must still pass with the new strings — Task 4.
5. A dependency between two claims from the SAME article must not draw a self-edge in the case graph (both endpoints map to one article node) — Task 5 asserts the edge is skipped, as contradictions already are.

---

### Task 1: The picker offers `depends-on` behind its authoring test

**Files:**
- Modify: `src/shared/evidence-linker.js:51` (`EVIDENCE_RELATIONSHIPS`) and the label block
- Modify: `src/reader/claim-extractor.js:511-525` (the rel-btn click handler) and `:631-634` (the rel row markup)
- Test: `tests/evidence-linker.test.mjs` (the `relationship enum is exhaustive` test at ~365 and the D.1 `NOT in the picker vocabulary yet` test)

**Interfaces:**
- Produces: `EVIDENCE_RELATIONSHIPS` = `[...CLAIM_RELATIONSHIPS, ...DEPENDENCY_RELATIONSHIPS]` (five values, `depends-on` last); `export const DEPENDENCY_AUTHORING_TEST` = the verbatim §2.1 sentence; `export const RELATIONSHIP_HELP = Object.freeze({ 'depends-on': DEPENDENCY_AUTHORING_TEST })` (other values have no help line).

- [ ] **Step 1: Rewrite the two pinning tests to the D.3 state**

```js
test('evidence: relationship picker enum — the Phase-11 four plus depends-on (D.3), nothing else', () => {
    assert.deepEqual(EVIDENCE_RELATIONSHIPS.slice().sort(),
        ['contradicts', 'depends-on', 'duplicates', 'supports', 'updates']);
    assert.equal(EVIDENCE_RELATIONSHIPS[EVIDENCE_RELATIONSHIPS.length - 1], 'depends-on', 'offered last: the rare, strict choice');
});
test('evidence: depends-on carries the authoring test as its help line; no other value has one', () => {
    assert.match(DEPENDENCY_AUTHORING_TEST, /Could the source still be true if the target turned out to be false\? If yes, the link is `supports`, not `depends-on`\./);
    assert.equal(RELATIONSHIP_HELP['depends-on'], DEPENDENCY_AUTHORING_TEST);
    for (const r of ['contradicts', 'supports', 'updates', 'duplicates']) assert.equal(RELATIONSHIP_HELP[r], undefined);
});
```

and change the D.1 test's `assert.equal(EVIDENCE_RELATIONSHIPS.includes('depends-on'), false, …)` to `true` with the message `'offered since D.3'`.

- [ ] **Step 2: Run and watch them fail**

Run: `node --test tests/evidence-linker.test.mjs`
Expected: FAIL — `DEPENDENCY_AUTHORING_TEST` not exported; the enum test's deepEqual differs.

- [ ] **Step 3: Implement.** In `evidence-linker.js` set `EVIDENCE_RELATIONSHIPS = Object.freeze([...CLAIM_RELATIONSHIPS, ...DEPENDENCY_RELATIONSHIPS])`, add the two exports, and rewrite the comment above `ALL_LINK_RELATIONSHIPS` (it says the picker waits for D.3). In `claim-extractor.js`: add `<div class="xr-link-modal__rel-help" hidden></div>` under `.xr-link-modal__rels`; in the click handler set its text to `RELATIONSHIP_HELP[rel] || ''` and its `hidden` to `!RELATIONSHIP_HELP[rel]`; run the same on initial render. Import the new names beside `EVIDENCE_RELATIONSHIPS`. Add a `.xr-link-modal__rel-help` rule in the reader stylesheet that styles `.xr-link-modal__rels` (small, muted, italic).

- [ ] **Step 4: Run the suite and the structure guard**

Run: `node --test tests/evidence-linker.test.mjs tests/structure-guards.test.mjs tests/assessment-taxonomy.test.mjs`
Expected: all PASS (the claim-extractor DOM ceiling is unchanged: the help element is in the HTML template, not a `document.*` call).

- [ ] **Step 5: Commit**

```bash
git add src/shared/evidence-linker.js src/reader/claim-extractor.js src/reader/*.css tests/evidence-linker.test.mjs
git commit -m "feat(reader): offer depends-on in the link picker behind its authoring test (D.3)"
```

---

### Task 2: The cascade's copy in `traceLines`

**Files:**
- Modify: `src/shared/case-counterfactual.js` (`traceLines`, ~line 285–350)
- Test: `tests/case-counterfactual.test.mjs` (replace the `traceLines ignores the cascade until D.3` test; extend the §4 copy guard's fixture if needed — it already iterates both modes over C1 with a cascade-reached edge)

**Interfaces:**
- Consumes: the `delta.dependencies` section from D.2 (`root, treatment, undercut, hypothesis_edges, knots, cycles`).
- Produces: `traceLines` emits, after the existing sections and before the honest-zero line, in this order: (a) one line per undercut set: `If this claim were false, N claim(s) would lose a necessary premise` (remove mode: `Removing this claim leaves N claim(s) without a necessary premise`), derivation = each dependent as `ref — “text”` with its chain `a → b → c` (claim texts from `claimsById`, ids otherwise); (b) when `hypothesis_edges.count > 0`: `N hypothesis attachment(s) rest on an undercut claim`, derivation = `“label” · role · via a → b`; (c) one line per `knots.derivation` row in the same wording as the one-hop knot lines, prefixed `With its dependents gone, `; (d) when `cycles.count > 0`: `Circular premise: N claim(s) depend on each other`, derivation = the refs; (e) the fixed asymmetry sentence, ALWAYS present when `undercut.count > 0`, derivation `null`. The honest-zero line changes to `No structural dependencies found — nothing else in the case graph rests on this claim, and nothing depends on it.` only when BOTH the one-hop sections and the cascade are empty.

- [ ] **Step 1: Write the failing tests** (replace the D.2 `traceLines ignores the cascade` test)

```js
test('traceLines: the cascade — undercut claims with chains, their hypothesis attachments, and the fixed asymmetry sentence', () => {
    const data = makeData();
    const edges = [{ hypothesis_id: 'h1', label: 'Zoonotic', ref: C5, role: 'supports', edge_id: 'e5' }];
    const lines = traceLines(traceClaimDependencies(data, C1, { mode: 'negate', hypothesisEdges: edges }), { claimsById: data.claimsById });
    const texts = lines.map((l) => l.text);
    assert.ok(texts.some((t) => /^If this claim were false, 2 claims would lose a necessary premise$/.test(t)));
    const cascade = lines.find((l) => /lose a necessary premise/.test(l.text));
    assert.match(cascade.derivation, new RegExp(`${C1} → ${C3} → ${C5}`), 'the chain is on the face');
    assert.match(cascade.derivation, /Claim claim_00000000000000c3/, 'claim text, not only the id');
    assert.ok(texts.some((t) => /^1 hypothesis attachment rests on an undercut claim$/.test(t)));
    assert.ok(texts.includes('The truth of a premise establishes nothing about its dependents; only falsity propagates.'));
    assert.ok(texts.some((t) => /^With its dependents gone, /.test(t)), 'the set-wide knot line');
    const remove = traceLines(traceClaimDependencies(data, C1, { mode: 'remove' }), { claimsById: data.claimsById }).map((l) => l.text);
    assert.ok(remove.some((t) => /^Removing this claim leaves 2 claims without a necessary premise$/.test(t)));
});
test('traceLines: a cycle through the claim renders as a circular premise, never as a count of anything else', () => {
    const data = makeData();
    data.links.dependencies.push(link('link_00000000000000d3', C1, C5, 'depends-on'));
    const texts = traceLines(traceClaimDependencies(data, C1, { mode: 'negate' }), { claimsById: data.claimsById }).map((l) => l.text);
    assert.ok(texts.some((t) => /^Circular premise: 3 claims depend on each other$/.test(t)));
});
test('traceLines: the asymmetry sentence appears only with a non-empty cascade; the honest zero names both directions', () => {
    const data = makeData();
    const c6 = traceLines(traceClaimDependencies(data, C6, { mode: 'negate' }), { claimsById: data.claimsById }).map((l) => l.text);
    assert.ok(!c6.some((t) => /only falsity propagates/.test(t)));
    assert.ok(c6.some((t) => /nothing depends on it\.$/.test(t)));
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `node --test tests/case-counterfactual.test.mjs`
Expected: FAIL on the three new tests; the §4 copy guard still passes (no cascade copy yet).

- [ ] **Step 3: Implement the five line groups in `traceLines`** per the Produces block. Add the asymmetry sentence as an exported constant `CASCADE_ASYMMETRY_LINE` so the UI explainer (Task 3) can reuse it.

- [ ] **Step 4: Run the file's suite, both §4 guards included**

Run: `node --test tests/case-counterfactual.test.mjs`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/case-counterfactual.js tests/case-counterfactual.test.mjs
git commit -m "feat(counterfactual): the cascade's trace copy — chains, attachments, circular premises, the asymmetry line (D.3)"
```

---

### Task 3: "Load-bearing (n)" on claim rows and the case view's chips

**Files:**
- Modify: `src/shared/case-dependencies.js` (add `loadLabel`, `loadTooltip`)
- Modify: `src/portal/evidence-block.js:180-205` (the per-claim chips, beside the trace expander)
- Modify: `src/portal/case-view.js:82` (`RELATED_RELATIONSHIPS`) and `:99-103` (`RELATED_PHRASE`)
- Test: `tests/case-dependencies.test.mjs`

**Interfaces:**
- Consumes: `claimLoad(dependencies, ref)` from D.2; `findDependencyCycles`.
- Produces: `loadLabel(load)` → `'Load-bearing (n dependent|dependents)'` or `''` when `load.count === 0`; `loadTooltip(load, claimsById)` → one line per dependent: `“text” (via a → b → c)` with texts from `claimsById` (ids when missing), joined by `\n`, prefixed by the line `Claims that cannot be true unless this one is:`. `RELATED_PHRASE['depends-on'] = { out: 'depends on', in: 'depended on by' }` and `'depends-on'` joins `RELATED_RELATIONSHIPS`.

- [ ] **Step 1: Write the failing tests**

```js
test('loadLabel / loadTooltip: a measured count with every dependent named by text and chain; empty when nothing depends', () => {
    const claimsById = { [B]: { text: 'B says.' }, [C]: { text: 'C says.' } };
    const load = claimLoad(deps(), A);
    assert.equal(loadLabel(load), 'Load-bearing (3 dependents)');
    assert.equal(loadLabel(claimLoad(deps(), Q)), '');
    const tip = loadTooltip(load, claimsById);
    assert.match(tip, /^Claims that cannot be true unless this one is:\n/);
    assert.match(tip, new RegExp(`“C says\\.” \\(via ${A} → ${B} → ${C}\\)`));
    assert.match(tip, new RegExp(`${D} \\(via ${A} → ${D}\\)`), 'an unresolved ref shows its id');
    assert.equal(loadLabel({ count: 1, derivation: [] }), 'Load-bearing (1 dependent)');
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `node --test tests/case-dependencies.test.mjs`
Expected: FAIL — `loadLabel` not exported.

- [ ] **Step 3: Implement** the two helpers (pure, exported). Then in `evidence-block.js`, for each claim with a `claim_id` and when `data.links.dependencies` is non-empty: compute `claimLoad`, and if `loadLabel` is non-empty append `el('span', 'xr-badge xr-badge--muted xr-badge--load', loadLabel(load))` with `title = loadTooltip(load, data.claimsById)`; if the claim sits in a `findDependencyCycles(data.links.dependencies)` component, append a `xr-badge--warn` chip `circular premise` with the component's refs as the title. Compute the cycles ONCE per block render, not per claim. In `case-view.js` add the phrase entry and the set member.

- [ ] **Step 4: Run the suites and the structure guards**

Run: `node --test tests/case-dependencies.test.mjs tests/structure-guards.test.mjs`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/case-dependencies.js src/portal/evidence-block.js src/portal/case-view.js tests/case-dependencies.test.mjs
git commit -m "feat(portal): Load-bearing (n) and circular-premise chips on claim rows; depends-on chips on the case view (D.3)"
```

---

### Task 4: Shared-premise markers on hypothesis cards

**Files:**
- Modify: `src/portal/hypothesis-block.js` (the model builder that produces `card.sections`, ~line 140–200; the DOM projection below it; the `AUTHORING_STRINGS` list if it enumerates every rendered string)
- Modify: `src/portal/case-view.js:292-305` (where the block receives `data` and `hypothesisEdges`)
- Test: `tests/hypothesis-block.test.mjs`

**Interfaces:**
- Consumes: `sharedPremises(data.links.dependencies, hypothesisEdges)` from D.2, with `hypothesisEdges` the join rows the case view already collects.
- Produces: the model's card gains `sharedPremises: Array<{ premiseText, premiseRef, edgeCount, chains: string[] }>` (chains rendered `a → b → c` by claim text where resolvable); the DOM projects each as a row `Shared premise (N supporting attachments rest on it): “text”` under a fixed explainer `Two arguments that rest on one premise are not independent. Named, never weighed.`; nothing else on the card changes.

- [ ] **Step 1: Write the failing test** (extend the file's fixture: two supporting edges on one hypothesis whose claims both depend on a third claim via `links.dependencies`)

```js
test('hypothesis-block: a premise two supporting attachments rest on is named on the card, with the fixed explainer, and the no-scoreboard guard still holds', () => {
    const model = buildHypothesisBlockModel(mapWithSharedPremise(), { sharedPremises: sharedPremisesFixture() });
    const card = model.cards.find((c) => c.title === 'Lab');
    assert.equal(card.sharedPremises.length, 1);
    assert.equal(card.sharedPremises[0].edgeCount, 2);
    assert.match(card.sharedPremises[0].premiseText, /Premise claim/);
    assert.equal(model.sharedPremiseExplainer, 'Two arguments that rest on one premise are not independent. Named, never weighed.');
    // every rendered string goes through the existing guard walk
    for (const s of collectStrings(model)) assert.doesNotMatch(s, /more likely|less likely|stronger|weaker|% chance|winner/i);
});
```

(Use the file's existing model-builder export name and its string-collecting helper; read the test file's head for both.)

- [ ] **Step 2: Run and watch it fail**

Run: `node --test tests/hypothesis-block.test.mjs`
Expected: FAIL — `sharedPremises` undefined on the card.

- [ ] **Step 3: Implement.** The model builder takes an optional `{ sharedPremises }` (the D.2 result object); group its rows by `hypothesis_id` onto the matching card; project in the DOM under the sections. The case view computes `sharedPremises(data.links.dependencies, hypothesisEdges)` beside its existing call and passes it in. Add the explainer string to `AUTHORING_STRINGS` if that list is the guard's corpus.

- [ ] **Step 4: Run the suite**

Run: `node --test tests/hypothesis-block.test.mjs tests/hypothesis-map.test.mjs`
Expected: all PASS, including the no-scoreboard guard and the "only role-adjacent count is each section's own size" test. The shared-premise count is an attachment count on one card, never cross-hypothesis; if that test's regex catches the row, reword the row rather than the test.

- [ ] **Step 5: Commit**

```bash
git add src/portal/hypothesis-block.js src/portal/case-view.js tests/hypothesis-block.test.mjs
git commit -m "feat(portal): shared-premise markers on hypothesis cards (D.3)"
```

---

### Task 5: Dependency arrows in the case graph

**Files:**
- Modify: `src/shared/case-graph.js:160-195` (after the contradiction edges; reuse `urlOfRef` and the ghost endpoint helper) and the `counts` object
- Modify: `src/portal/case-graph-view.js:40-70` (edge class + counts line + an SVG arrow marker)
- Modify: the portal stylesheet that defines `.xr-gedge--warn` (add `.xr-gedge--dependency`)
- Test: `tests/case-graph.test.mjs`

**Interfaces:**
- Consumes: `data.links.dependencies` rows.
- Produces: edges `{ id: 'dep:<from> <to>', from, to, kind: 'dependency', directed: true, note }` from the dependent's article node to the premise's article node (ghost nodes for off-corpus refs, as contradictions do); one edge per ordered node pair; a self-pair (both claims on one article) is skipped; `counts.dependencies` = the number of edges emitted. The view gives `kind === 'dependency'` the class `xr-gedge xr-gedge--dependency` with `marker-end` pointing at a `<marker id="xr-garrow">` defined once per SVG, and the counts line gains `· N dependency arrow(s)`.

- [ ] **Step 1: Write the failing tests** (the file's fixture builder: add a `links.dependencies` row between claims on two member articles, one to an off-corpus ref, and one between two claims of the same article)

```js
test('case-graph: depends-on links become directed article→article dependency edges; ghost for an off-corpus premise; same-article pairs skipped', () => {
    const g = buildCaseGraph(dataWithDependencies());
    const deps = g.edges.filter((e) => e.kind === 'dependency');
    assert.equal(deps.length, 2);
    assert.ok(deps.every((e) => e.directed === true));
    assert.ok(deps.some((e) => e.from === 'article:https://example.com/b' && e.to === 'article:https://example.com/a'), 'from the dependent to the premise');
    assert.ok(deps.some((e) => e.to.startsWith('ghost:')), 'off-corpus premise is a ghost node');
    assert.equal(g.counts.dependencies, 2);
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `node --test tests/case-graph.test.mjs`
Expected: FAIL — no dependency edges.

- [ ] **Step 3: Implement** in `case-graph.js`, then the view class, marker and counts line, then the stylesheet rule (a dashed-free, mid-weight stroke distinct from the warn edge).

- [ ] **Step 4: Run the suites**

Run: `node --test tests/case-graph.test.mjs tests/structure-guards.test.mjs`
Expected: all PASS; the determinism test still deep-equals.

- [ ] **Step 5: Commit**

```bash
git add src/shared/case-graph.js src/portal/case-graph-view.js src/portal/*.css tests/case-graph.test.mjs
git commit -m "feat(graph): directed dependency arrows in the case graph (D.3)"
```

---

### Task 6: The extract-flag relabel, the smoke rows, the ladder and changelog

**Files:**
- Modify: `src/reader/llm-review.js:301-307` (the star tooltip), `src/portal/synthesis-block.js:227-229` (the brief's list heading), `src/portal/inspector.js:108` (the count line)
- Modify: `docs/SMOKE_TEST.md` (a new section after Phase 26), `docs/CLAIM_DEPENDENCY_DESIGN.md` (§7 row D.3 shipped; §8 open item closed with the chosen copy), `CHANGELOG.md`

**Copy (the §8 open item, chosen here as an interpretive step):** the reader's star tooltip becomes `Argument-critical (the model's reading of this article): <why>`; the brief's heading becomes `Claims the brief turns on (N)`; the inspector line becomes `N brief-critical claim(s)`. The words "load-bearing" appear in the UI only on the measured `Load-bearing (n dependents)` chip.

- [ ] **Step 1: Apply the three copy changes** and grep `src/` for the string `Load-bearing:` and `load-bearing claim` to confirm no other UI string remains.

- [ ] **Step 2: Add the smoke section** `## Claim dependencies (D.1–D.3)` with rows: P-D.a the link modal shows the authoring test only when depends-on is picked and saves the link; P-D.b the claim row shows `Load-bearing (n dependents)` with the dependents in its tooltip; P-D.c Trace dependencies shows the cascade lines and the asymmetry sentence; P-D.d a hypothesis card names a shared premise; P-D.e the case graph draws an arrow from the dependent's article to the premise's; P-D.f the case view's claim list shows `→ depends on` / `← depended on by` chips; P-D.g a two-claim cycle shows `circular premise` on both rows.

- [ ] **Step 3: Run the gates**

Run: `npm run lint:js && npm run build && npm run check:budget && npm test`
Expected: all green.

- [ ] **Step 4: Edit the ladder row, §8, and the changelog; commit, push, open the PR** — `Verification layer: unit + guard + human-soak (the seven P-D smoke rows)`; `Wire format: none`; `Docs: docs/SMOKE_TEST.md (JOURNAL 2026-11-06), docs/CLAIM_DEPENDENCY_DESIGN.md, CHANGELOG.md`; interpretive steps: the relabel copy; the cascade rendering in both modes; `depends-on` offered last in the picker.

```bash
git add -A src docs CHANGELOG.md
git commit -m "feat(ui): relabel the extract flag, smoke rows and ladder for claim dependency D.3"
git push -u origin <branch>
```
