# Claim dependency D.2 — the pure walks (load, cascade, shared premises, cycles) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the dependency graph computable: the dossier collector carries `depends-on` links, and a pure module answers "what transitively depends on this claim", "what is undercut if it is false", "which premises two arguments share", and "where is the reasoning circular" — as counts with derivations, wired into the existing counterfactual's output and its guard tests. No rendering yet (D.3), no verdict reading (D.4).

**Architecture:** A new pure sibling `src/shared/claim-dependencies.js` holds the graph walks over `data.links.dependencies` (a new family the collector in `case-dossier.js` fills from every `depends-on` link with an orbit endpoint, id-sorted, endpoints pre-canonicalized). `traceClaimDependencies` in `case-counterfactual.js` gains a `dependencies` section built from those walks, and `dataWithout` drops dependency links touching the removed claim. The CF.1 guard (banned keys nowhere, every numeric beside a derivation) extends over the new section automatically because it walks the whole output.

**Tech Stack:** plain ES modules, `node --test`; `fake-indexeddb`-backed storage stubs already used by `tests/case-dossier.test.mjs`.

**Spec:** `docs/CLAIM_DEPENDENCY_DESIGN.md` §2.3, §3 (3.1–3.3), §6, §7 row D.2. Read it from `main` (merged as PR #432).

## Global Constraints

- 4-space indentation; `Utils.log` only, no bare `console`.
- Direction: a link `{ source_ref, target_ref, relationship: 'depends-on' }` means **source depends on target**. "Dependents of X" are the sources whose chain of targets reaches X.
- Every numeric in any output object sits beside a `derivation` array; the key set never contains `probability`, `likelihood`, `confidence`, `score`, `weight`, `strength` (spec §2.4; the CF.1 guard in `tests/case-counterfactual.test.mjs` enforces it over the whole `traceClaimDependencies` output).
- Only falsity propagates: there is no "assume true" mode anywhere (spec §3.2, §6 red line 1).
- A cascade never writes or counts a state on a hypothesis; it lists the hypothesis-map edges that undercut claims carry, as neutral rows (spec §6 red line 2).
- Cycles are stored and reported, never thrown on; every walk uses a visited set and terminates on any graph (spec §2.3).
- Determinism: outputs sort by claim ref, then by link id; same inputs deep-equal.
- `case-counterfactual.js` is 338 lines; the walks go in the sibling module, not inline, so neither file grows past what one reading holds.

## Review Focus

1. A self-referential or two-node cycle (A depends on B, B depends on A) must terminate and appear in `cycles`, and asking for A's dependents must list B exactly once (Task 2 and Task 4 test it).
2. A diamond (C depends on A and on B; both A and B depend on R) must list C once under R's dependents with ONE chain (the first in sorted order) and name both link ids in its derivation (Task 2).
3. A `depends-on` link whose endpoints are both outside the orbit must not enter `links.dependencies` (Task 1), and a dependent outside the orbit reached through an orbit chain must still be listed (Task 2: walks run over the whole `dependencies` family, which the collector already filtered to orbit-touching links).
4. A hypothesis with two supporting edges from claims that share a premise only through different chain lengths (B→A directly, D→C→A) must report A once as shared with both edge ids (Task 3).
5. Removing a claim must drop its dependency links from `dataWithout` so the knot and support diffs see the same graph the cascade saw (Task 4 asserts `links.dependencies` length after removal).

---

### Task 1: The collector carries `depends-on` links

**Files:**
- Modify: `src/shared/case-dossier.js:143-172` (the link loop and the sort/return) and `:205` (the `links` envelope)
- Test: `tests/case-dossier.test.mjs` (after the `links.related` test at ~line 334; reuse `seedOrbit()` and `injected()`)

**Interfaces:**
- Produces: `collectCaseDossierData(...)` returns `links.dependencies: Array<link>` — every stored link with `relationship === 'depends-on'` and at least one orbit endpoint, each with `source_ref`/`target_ref` pre-canonicalized, sorted by `id` ascending. `related` is unchanged (still supports/updates/duplicates only).

- [ ] **Step 1: Write the failing test**

```js
test('case-dossier: links.dependencies carries every orbit depends-on link, id-sorted, noise excluded (claim dependency D.2)', async () => {
    resetState();
    const { kase, claims } = await seedOrbit();          // use whatever seedOrbit returns; two orbit claim ids are needed
    const [a, b] = claims;
    await EvidenceLinker.create({ source_claim_id: b.id, target_claim_id: a.id, relationship: 'depends-on' });
    // noise: a depends-on link between two out-of-orbit ids
    await EvidenceLinker.create({ source_claim_id: 'claim_1111111111111111', target_claim_id: 'claim_2222222222222222', relationship: 'depends-on' });
    const data = await collectCaseDossierData(kase.id, injected());
    assert.equal(data.links.dependencies.length, 1);
    assert.equal(data.links.dependencies[0].relationship, 'depends-on');
    assert.equal(data.links.dependencies[0].source_ref, b.id);
    assert.equal(data.links.dependencies[0].target_ref, a.id);
    assert.ok(!data.links.related.some((l) => l.relationship === 'depends-on'), 'related stays supports/updates/duplicates');
});
```

(If `seedOrbit()` does not return the claim records, read its body and pick two orbit claim ids the way the `related` test's neighbors do.)

- [ ] **Step 2: Run and watch it fail**

Run: `node --test tests/case-dossier.test.mjs`
Expected: FAIL — `data.links.dependencies` is undefined.

- [ ] **Step 3: Implement.** In the link loop add a `dependencies` array filled when `link.relationship === 'depends-on'` and either endpoint is in `orbitClaimIds`; sort it with `byIdAsc`; add `dependencies` to the returned `links` object. Update the header comment that lists the link families.

- [ ] **Step 4: Run the file's suite**

Run: `node --test tests/case-dossier.test.mjs`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/case-dossier.js tests/case-dossier.test.mjs
git commit -m "feat(dossier): collect depends-on links as links.dependencies (D.2)"
```

---

### Task 2: Dependents, load and cycles — the walks

**Files:**
- Create: `src/shared/claim-dependencies.js`
- Test: `tests/claim-dependencies.test.mjs` (new)

**Interfaces:**
- Consumes: `links.dependencies` rows from Task 1 (`{ id, source_ref, target_ref, relationship: 'depends-on' }`).
- Produces (all pure, synchronous):
  - `dependentsOf(dependencies, ref)` → `{ count, derivation: Array<{ ref, chain: string[], derivation: string[] }> }` — every claim that transitively depends on `ref`. `chain` runs from `ref` to the dependent (`[ref, …, dependent]`), one chain per dependent (the first found in sorted BFS order); `derivation` is the link ids along that chain. Sorted by `ref`. `ref` itself is never listed.
  - `premisesOf(dependencies, ref)` → same shape, the other direction: every claim `ref` transitively depends on.
  - `claimLoad(dependencies, ref)` → `{ count, derivation }` identical to `dependentsOf` (named for the §3.1 surface; one implementation).
  - `findDependencyCycles(dependencies)` → `{ count, derivation: Array<{ refs: string[], derivation: string[] }> }` — each strongly connected component of size ≥ 2, `refs` sorted, `derivation` the link ids inside it, components sorted by their first ref.

- [ ] **Step 1: Write the failing tests** — a fixture `deps()` of links: `B→A`, `C→B`, `D→A`, `X→Y`, `Y→X` (a cycle), `Q→Z` (outside everything), using `link(id, source, target)` as in `tests/case-counterfactual.test.mjs:37`.

```js
test('dependentsOf: transitive closure with one chain per dependent, sorted by ref', () => {
    const r = dependentsOf(deps(), A);
    assert.deepEqual(r.derivation.map((d) => d.ref), [B, C, D]);
    assert.deepEqual(r.derivation.find((d) => d.ref === C).chain, [A, B, C]);
    assert.deepEqual(r.derivation.find((d) => d.ref === C).derivation, ['link_ba', 'link_cb']);
    assert.equal(r.count, 3);
});
test('dependentsOf: a diamond lists the dependent once with one chain and both link ids where they meet', () => { /* R←A, R←B, C→A, C→B */ });
test('dependentsOf: a cycle terminates and lists each member once', () => {
    const r = dependentsOf(deps(), X);
    assert.deepEqual(r.derivation.map((d) => d.ref), [Y]);
});
test('premisesOf: the reverse walk', () => {
    assert.deepEqual(premisesOf(deps(), C).derivation.map((d) => d.ref), [A, B]);
});
test('claimLoad: equals dependentsOf', () => { assert.deepEqual(claimLoad(deps(), A), dependentsOf(deps(), A)); });
test('findDependencyCycles: SCCs of size >= 2 only, refs sorted, link ids on the face', () => {
    const r = findDependencyCycles(deps());
    assert.equal(r.count, 1);
    assert.deepEqual(r.derivation[0].refs, [X, Y].sort());
    assert.deepEqual(r.derivation[0].derivation.sort(), ['link_xy', 'link_yx']);
});
test('walks: an unknown ref yields count 0, never throws', () => { assert.equal(dependentsOf(deps(), 'claim_nope').count, 0); });
test('walks: deterministic — same inputs deepEqual, input order irrelevant', () => { /* shuffle deps(), compare */ });
```

- [ ] **Step 2: Run and watch them fail**

Run: `node --test tests/claim-dependencies.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/shared/claim-dependencies.js`** with the four exports above. Header comment: cite spec §2.3 and §3, state "source depends on target", "only falsity propagates — there is no upward walk", and the no-numeric-without-derivation rule. BFS from `ref` over an adjacency map built once per call (`target → [links]` for dependents, `source → [links]` for premises), visited set, neighbors visited in sorted link-id order so the first chain is deterministic. Cycles: Tarjan's SCC over the same adjacency; keep components of size ≥ 2.

- [ ] **Step 4: Run the file's suite**

Run: `node --test tests/claim-dependencies.test.mjs`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/claim-dependencies.js tests/claim-dependencies.test.mjs
git commit -m "feat(deps): pure dependents / premises / load / cycle walks over depends-on links (D.2)"
```

---

### Task 3: Shared premises (independence, made structural)

**Files:**
- Modify: `src/shared/claim-dependencies.js`
- Test: `tests/claim-dependencies.test.mjs`

**Interfaces:**
- Consumes: Task 2's `premisesOf`; hypothesis join rows `[{ hypothesis_id, label, ref, role, edge_id }]` as `collectHypothesisEdgeJoins` returns them (`src/shared/hypothesis-map.js:351`).
- Produces: `sharedPremises(dependencies, hypothesisEdges)` → `{ count, derivation: Array<{ hypothesis_id, label, premise_ref, edges: Array<{ edge_id, claim_ref, chain: string[] }>, derivation: string[] }> }` — for each hypothesis, each claim that two or more of its `supports` edges' claims transitively depend on (a supporting claim's own premises; the supporting claim itself is not its own premise). `derivation` = the link ids of every chain. Sorted by `hypothesis_id`, then `premise_ref`. `undermines` edges are ignored (the rule is about correlated support).

- [ ] **Step 1: Write the failing tests** — hypothesis `H1` with supports edges from `B` and `D` (both depend on `A` in the Task 2 fixture: one direct, one via `C`? make `D→C`, `C→B`, `B→A` so chain lengths differ) and an undermines edge from `C`; hypothesis `H2` with one supports edge.

```js
test('sharedPremises: two supporting edges that both rest on A report A once with both edges and their chains', () => {
    const r = sharedPremises(deps2(), edges());
    assert.equal(r.count, 1);
    const row = r.derivation[0];
    assert.equal(row.hypothesis_id, 'H1');
    assert.equal(row.premise_ref, A);
    assert.deepEqual(row.edges.map((e) => e.edge_id).sort(), ['e_b', 'e_d']);
    assert.ok(row.edges.every((e) => e.chain[0] === e.claim_ref && e.chain.at(-1) === A));
});
test('sharedPremises: undermines edges and single-edge hypotheses contribute nothing', () => { /* H2 absent; C's undermines edge not counted */ });
test('sharedPremises: a supporting claim is never its own premise', () => { /* two edges from B and B-dup: no row for B */ });
```

- [ ] **Step 2: Run and watch them fail**

Run: `node --test tests/claim-dependencies.test.mjs`
Expected: FAIL — `sharedPremises` is not exported.

- [ ] **Step 3: Implement `sharedPremises`.** Group edges by hypothesis; for each `supports` edge compute `premisesOf(dependencies, edge.ref)`; invert into `premise_ref → [{edge_id, claim_ref, chain}]`; keep entries with ≥ 2 distinct edge ids.

- [ ] **Step 4: Run the file's suite**

Run: `node --test tests/claim-dependencies.test.mjs`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/claim-dependencies.js tests/claim-dependencies.test.mjs
git commit -m "feat(deps): shared premises across a hypothesis's supporting edges (D.2)"
```

---

### Task 4: The cascade joins the counterfactual

**Files:**
- Modify: `src/shared/case-counterfactual.js` — `dataWithout` (~line 48–66), `diffHypotheses` (~line 206), `traceClaimDependencies` (~line 315–338); header comment
- Test: `tests/case-counterfactual.test.mjs` (extend `makeData` with a `dependencies` family and add tests; the §4 guard tests at ~line 279 and 296 walk the whole output and must stay green)

**Interfaces:**
- Consumes: Task 2's `dependentsOf`, `findDependencyCycles`; Task 3's `sharedPremises`.
- Produces: `traceClaimDependencies(data, ref, options)` output gains
  ```
  dependencies: {
      treatment: 'premise-removed' | 'premise-negated',   // by mode
      undercut: { count, derivation: [{ ref, chain, derivation }] },          // dependentsOf
      hypothesis_edges: { count, derivation: [{ hypothesis_id, label, claim_ref, role, edge_id, via: chain }] },
      cycles: { count, derivation: [{ refs, derivation }] }                   // only cycles containing ref or an undercut claim
  }
  ```
  and `dataWithout` also filters `links.dependencies` by `touches`.

- [ ] **Step 1: Extend `makeData`** with `links.dependencies: [link('link_00000000000000d1', C3, C1, 'depends-on'), link('link_00000000000000d2', C5, C3, 'depends-on')]` (C3 depends on C1, C5 depends on C3) and add the tests:

```js
test('case-counterfactual: the cascade lists every transitive dependent with its chain, in both modes', () => {
    for (const mode of COUNTERFACTUAL_MODES) {
        const d = traceClaimDependencies(makeData(), C1, { mode });
        assert.deepEqual(d.dependencies.undercut.derivation.map((u) => u.ref), [C3, C5]);
        assert.deepEqual(d.dependencies.undercut.derivation[1].chain, [C1, C3, C5]);
        assert.equal(d.dependencies.treatment, mode === 'negate' ? 'premise-negated' : 'premise-removed');
    }
});
test('case-counterfactual: hypothesis edges carried by undercut claims are listed with their chain, never counted onto the hypothesis', () => {
    const edges = [{ hypothesis_id: 'h1', label: 'Zoonotic', ref: C5, role: 'supports', edge_id: 'e5' }];
    const d = traceClaimDependencies(makeData(), C1, { mode: 'negate', hypothesisEdges: edges });
    assert.equal(d.dependencies.hypothesis_edges.count, 1);
    assert.deepEqual(d.dependencies.hypothesis_edges.derivation[0].via, [C1, C3, C5]);
    assert.ok(!('supports_remaining' in d.dependencies.hypothesis_edges.derivation[0]));
});
test('case-counterfactual: remove drops the claim\'s dependency links from the graph the other diffs see', () => {
    // C3 depends on C1; after removing C1 no dependency touches C1 — assert through a second trace on C3 over dataWithout-equivalent data: the simplest observable is that tracing C3 after removing C1 reports C5 only.
});
test('case-counterfactual: a claim with no dependents reports count 0 and an empty cycles list', () => { /* C6 */ });
```

- [ ] **Step 2: Run and watch them fail**

Run: `node --test tests/case-counterfactual.test.mjs`
Expected: FAIL — `d.dependencies` is undefined.

- [ ] **Step 3: Implement.** Import the three walks; in `traceClaimDependencies` compute `undercut = dependentsOf(deps, ref)`, join `options.hypothesisEdges` whose `ref` is in the undercut set (attach `via` = that dependent's chain), and `cycles = findDependencyCycles(deps)` filtered to components containing `ref` or any undercut ref; `treatment` by mode. In `dataWithout` add `dependencies: (…).filter((l) => !touches(l, ref))`. Extend the header comment (dependency cascade, spec §3.2; only falsity propagates). Leave `traceLines` untouched — the copy is D.3.

- [ ] **Step 4: Run the file's suite, including the two §4 guards**

Run: `node --test tests/case-counterfactual.test.mjs`
Expected: all PASS; the guard tests now walk the `dependencies` section too.

- [ ] **Step 5: Commit**

```bash
git add src/shared/case-counterfactual.js tests/case-counterfactual.test.mjs
git commit -m "feat(counterfactual): dependency cascade — undercut claims, their hypothesis edges, cycles (D.2)"
```

---

### Task 5: Whole-tree gates, design ladder rows, PR

**Files:**
- Modify: `docs/CLAIM_DEPENDENCY_DESIGN.md` §7 table — D.1 row "shipped (PR #433)" with the note that `depends-on` lives in `DEPENDENCY_RELATIONSHIPS`, D.2 row "shipped (PR #n)"
- Modify: `CHANGELOG.md` Unreleased → Added: one line for the walks (local-only, no wire change)

- [ ] **Step 1: Run the gates**

Run: `npm run lint:js && npm run build && npm run check:budget && npm test`
Expected: all green.

- [ ] **Step 2: Edit the ladder rows and the changelog line.** The D.1 row correction is the docs follow-up promised in PR #433's interpretive steps.

- [ ] **Step 3: Commit, push, open the PR** — `Verification layer: unit + guard`; `Wire format: none` (no wire-lane file changes; `case-dossier.js`, `case-counterfactual.js`, `claim-dependencies.js` are not wire); `Docs: docs/CLAIM_DEPENDENCY_DESIGN.md, CHANGELOG.md`; `Interpretive steps (1): the cascade reports in BOTH modes with a treatment stamp (premise-removed / premise-negated) rather than negate-only, because a removed premise leaves a dependent equally without a necessary condition — default: both modes.`

```bash
git add docs/CLAIM_DEPENDENCY_DESIGN.md CHANGELOG.md
git commit -m "docs: ladder rows for D.1/D.2 and the changelog line"
git push -u origin <branch>
```
