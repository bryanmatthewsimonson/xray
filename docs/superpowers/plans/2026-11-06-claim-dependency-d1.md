# Claim dependency D.1 — the `depends-on` kind-30055 value — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `depends-on` as a directional kind-30055 relationship value that the taxonomy, the 30055 builder, the wire parser, the local linker and the publish selector all accept, with a golden wire fixture and the NIP draft text, and nothing else (no UI, no walks).

**Architecture:** A new frozen constant `DEPENDENCY_RELATIONSHIPS = ['depends-on']` lives beside `CLAIM_RELATIONSHIPS` and `REVISION_RELATIONSHIPS` in `src/shared/assessment-taxonomy.js`, deliberately NOT inside `CLAIM_RELATIONSHIPS` so the reader's link picker (`EVIDENCE_RELATIONSHIPS`) is unchanged until slice D.3 adds the authoring test. The builder and the linker validate against the three-way union; the publish selector keeps publishing it on the ordinary 30055 path (it is not a `revision/*` edge). Source depends on target, hashed in semantic order like `supports`.

**Tech Stack:** plain ES modules, `node --test`, the golden wire-fixture generator (`tests/tools/gen-wire-fixtures.mjs`).

**Spec:** `docs/CLAIM_DEPENDENCY_DESIGN.md` §2.1, §2.2, §7 row D.1 (and the compatibility paragraph under the ladder).

## Global Constraints

- 4-space indentation in `src/shared/*.js` authored here; `src/shared/metadata/builders.js` uses 2 spaces (ported file). Match the file.
- `depends-on` is directional: **source depends on target**. Never sorted; `d` = `rel:<sha16(source|target|depends-on)>` recomputable from the `a` tags + `relationship` (NIP_DRAFT §30055).
- A `depends-on` link and a `supports` link between the same ordered pair coexist (the relationship is in both the wire `d` and the local link id).
- No `weight` / `strength` / `score` / `probability` / `likelihood` / `confidence` field anywhere on the edge (spec §2.4).
- The reader's picker (`EVIDENCE_RELATIONSHIPS`) does NOT change in this slice.
- `tests/assessment-taxonomy.test.mjs` pins `CLAIM_RELATIONSHIPS` by exact deepEqual; it must keep passing unchanged, which is why the new value is a separate constant.
- The PR for this slice carries `Wire format: additive` and states that an older client's `EvidenceLinker.create` rejects the value while `parseRelationshipEvent` passes it through (spec §7 paragraph). Run the `ecosystem-pm` and `architect` skills before requesting merge (CLAUDE.md: a diff touching `metadata/builders.js` is wire-lane).
- Logging through `Utils.log` only; no bare `console`.

## Review Focus

1. A self-loop `A depends-on A` must throw in both the builder and the linker, as it does for `supports` (Task 2 and Task 3 each add the assertion).
2. Reversing the endpoints must produce a DIFFERENT wire `d` and a DIFFERENT local id (circular `A→B`, `B→A` are two edges, kept, per spec §2.3) — Task 2 and Task 3.
3. A foreign 30055 event carrying `depends-on` arriving through `parseRelationshipEvent` must parse with `relationship: 'depends-on'` and source/target in tag order (Task 4).
4. The publish selector must include a stale `depends-on` link (it is not `revision/*` and not `contextualizes`) — Task 5.
5. The legacy `contextualizes` and the `revision/*` values must keep their current behavior everywhere — every task reruns the file's full suite, and Task 1 asserts the three constants are disjoint.

---

### Task 1: The taxonomy constant

**Files:**
- Modify: `src/shared/assessment-taxonomy.js` (after `REVISION_RELATIONSHIPS` / `isRevisionRelationship`, ~line 119–125)
- Test: `tests/assessment-taxonomy.test.mjs`

**Interfaces:**
- Produces: `export const DEPENDENCY_RELATIONSHIPS = Object.freeze(['depends-on'])` and `export function isDependencyRelationship(relationship): boolean`. Both importable from `src/shared/assessment-taxonomy.js`. `isSymmetricRelationship('depends-on')` stays `false` with no change to `SYMMETRIC_RELATIONSHIPS`.

- [ ] **Step 1: Write the failing test** (append to `tests/assessment-taxonomy.test.mjs`, importing the two new names beside the existing taxonomy imports at line 16)

```js
test('taxonomy: depends-on is its own directional vocabulary (CLAIM_DEPENDENCY_DESIGN §2.1)', () => {
    assert.deepEqual(DEPENDENCY_RELATIONSHIPS, ['depends-on']);
    assert.equal(Object.isFrozen(DEPENDENCY_RELATIONSHIPS), true);
    assert.equal(isDependencyRelationship('depends-on'), true);
    assert.equal(isDependencyRelationship('supports'), false);
    assert.equal(isSymmetricRelationship('depends-on'), false, 'source depends on target — never sorted');
    // The picker vocabulary is untouched until D.3.
    assert.equal(CLAIM_RELATIONSHIPS.includes('depends-on'), false);
    assert.equal(REVISION_RELATIONSHIPS.includes('depends-on'), false);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test tests/assessment-taxonomy.test.mjs`
Expected: FAIL — `DEPENDENCY_RELATIONSHIPS` is not exported (SyntaxError on the named import, or `undefined`).

- [ ] **Step 3: Add the constant and predicate** in `src/shared/assessment-taxonomy.js`, directly below `isRevisionRelationship`, with a doc comment in the file's house style that cites `docs/CLAIM_DEPENDENCY_DESIGN.md §2.1`, states "source depends on target: the source cannot be true unless the target is true", and says it is kept OUT of `CLAIM_RELATIONSHIPS` so the Phase-11 picker is unchanged until D.3.

- [ ] **Step 4: Run the file's suite**

Run: `node --test tests/assessment-taxonomy.test.mjs`
Expected: all PASS, including the untouched `relationship vocabulary + directionality` test.

- [ ] **Step 5: Commit**

```bash
git add src/shared/assessment-taxonomy.js tests/assessment-taxonomy.test.mjs
git commit -m "feat(taxonomy): add depends-on as its own directional 30055 vocabulary (D.1)"
```

---

### Task 2: The kind-30055 builder accepts `depends-on`

**Files:**
- Modify: `src/shared/metadata/builders.js:29-31` (import) and `:293-299` (the `ALL_RELATIONSHIPS` union inside `buildClaimRelationshipEvent`)
- Test: `tests/evidence-linker.test.mjs` (the builder tests already live there, ~line 370–415)

**Interfaces:**
- Consumes: `DEPENDENCY_RELATIONSHIPS` from Task 1.
- Produces: `buildClaimRelationshipEvent({ sourceCoord, targetCoord, relationship: 'depends-on', … })` returns `{ event, body, dTag }` with `event.kind === 30055`, the `a` tags in source/target order, and `dTag === 'rel:' + sha16(\`${sourceCoord}|${targetCoord}|depends-on\`)`.

- [ ] **Step 1: Write the failing tests** (append to `tests/evidence-linker.test.mjs`, beside the existing `parseRelationshipEvent round-trips the kind-30055 builder` test at ~line 372, which shows the coordinate fixtures the file already uses)

```js
test('builder: depends-on is directional — endpoints stay in semantic order and the d is deterministic', async () => {
    const A = '30040:' + 'a'.repeat(64) + ':claim-a';
    const B = '30040:' + 'b'.repeat(64) + ':claim-b';
    const { event, dTag } = await buildClaimRelationshipEvent({ sourceCoord: B, targetCoord: A, relationship: 'depends-on' });
    const aTags = event.tags.filter((t) => t[0] === 'a');
    assert.deepEqual(aTags.map((t) => [t[1], t[3]]), [[B, 'source'], [A, 'target']], 'B depends on A: not sorted');
    assert.deepEqual(event.tags.find((t) => t[0] === 'relationship'), ['relationship', 'depends-on']);
    assert.match(dTag, /^rel:[0-9a-f]{16}$/);
    assert.equal(event.tags.find((t) => t[0] === 'd')[1], dTag);
    const same = await buildClaimRelationshipEvent({ sourceCoord: B, targetCoord: A, relationship: 'depends-on' });
    assert.equal(same.dTag, dTag, 'recomputable from (source, target, relationship)');
    const reversed = await buildClaimRelationshipEvent({ sourceCoord: A, targetCoord: B, relationship: 'depends-on' });
    assert.notEqual(reversed.dTag, dTag, 'A→B and B→A are two edges');
    const sup = await buildClaimRelationshipEvent({ sourceCoord: B, targetCoord: A, relationship: 'supports' });
    assert.notEqual(sup.dTag, dTag, 'coexists with supports on the same ordered pair');
});

test('builder: depends-on rejects a self-loop like every other relationship', async () => {
    const A = '30040:' + 'a'.repeat(64) + ':claim-a';
    await assert.rejects(
        buildClaimRelationshipEvent({ sourceCoord: A, targetCoord: A, relationship: 'depends-on' }),
        /cannot link a claim to itself/
    );
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `node --test tests/evidence-linker.test.mjs`
Expected: the first new test FAILS with `relationship must be one of contradicts, supports, updates, duplicates, narrative-patch, recharacterizes, walks-back (got depends-on)`.

- [ ] **Step 3: Widen the builder's union.** Import `DEPENDENCY_RELATIONSHIPS` beside `CLAIM_RELATIONSHIPS, REVISION_RELATIONSHIPS` at `builders.js:29`, and make `ALL_RELATIONSHIPS` inside `buildClaimRelationshipEvent` the three-way spread. Extend the JSDoc `@param {string} args.relationship` line and the "Wire rules" comment with one sentence: `depends-on` is directional, source depends on target (`docs/CLAIM_DEPENDENCY_DESIGN.md` §2.1).

- [ ] **Step 4: Run the file's suite**

Run: `node --test tests/evidence-linker.test.mjs`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/metadata/builders.js tests/evidence-linker.test.mjs
git commit -m "feat(wire): kind-30055 builder accepts depends-on, hashed in semantic order (D.1)"
```

---

### Task 3: The local linker stores `depends-on`

**Files:**
- Modify: `src/shared/evidence-linker.js:37-40` (import), `:53-59` (`ALL_LINK_RELATIONSHIPS`), `:64-85` (labels + icons)
- Test: `tests/evidence-linker.test.mjs`

**Interfaces:**
- Consumes: `DEPENDENCY_RELATIONSHIPS` from Task 1.
- Produces: `EvidenceLinker.create({ source_claim_id, target_claim_id, relationship: 'depends-on', note?, suggested_by? })` stores and returns a normalized link record with `relationship: 'depends-on'`; `generateEvidenceLinkId(A, B, 'depends-on')` is direction-sensitive. `EVIDENCE_RELATIONSHIP_LABELS['depends-on'] === 'Depends on'` and `EVIDENCE_RELATIONSHIP_ICONS['depends-on'] === '⤵'`. `EVIDENCE_RELATIONSHIPS` is unchanged.

- [ ] **Step 1: Write the failing tests** (append to `tests/evidence-linker.test.mjs`, using the file's existing `A`/`B` claim fixtures and storage stub)

```js
test('linker: depends-on stores directionally, dedupes on the ordered triple, and coexists with supports', async () => {
    const ab = await EvidenceLinker.create({ source_claim_id: A, target_claim_id: B, relationship: 'depends-on' });
    assert.equal(ab.relationship, 'depends-on');
    assert.equal(ab.source_claim_id, A);
    assert.equal(ab.target_claim_id, B);
    const again = await EvidenceLinker.create({ source_claim_id: A, target_claim_id: B, relationship: 'depends-on' });
    assert.equal(again.id, ab.id, 'idempotent on (source, target, depends-on)');
    const ba = await EvidenceLinker.create({ source_claim_id: B, target_claim_id: A, relationship: 'depends-on' });
    assert.notEqual(ba.id, ab.id, 'the reverse edge is a second record (a cycle is stored, never refused — §2.3)');
    const sup = await EvidenceLinker.create({ source_claim_id: A, target_claim_id: B, relationship: 'supports' });
    assert.notEqual(sup.id, ab.id);
    assert.ok(!ab.attestation, 'attestation metadata is a supports-only field');
});

test('linker: depends-on rejects a self-loop and is NOT in the picker vocabulary yet', async () => {
    await assert.rejects(
        EvidenceLinker.create({ source_claim_id: A, target_claim_id: A, relationship: 'depends-on' }),
        /Cannot link a claim to itself/
    );
    assert.equal(EVIDENCE_RELATIONSHIPS.includes('depends-on'), false, 'picker unchanged until D.3');
    assert.equal(EVIDENCE_RELATIONSHIP_LABELS['depends-on'], 'Depends on');
    assert.equal(typeof EVIDENCE_RELATIONSHIP_ICONS['depends-on'], 'string');
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `node --test tests/evidence-linker.test.mjs`
Expected: FAIL with `Invalid relationship: depends-on (expected one of …)`.

- [ ] **Step 3: Widen the linker.** Import `DEPENDENCY_RELATIONSHIPS` at `evidence-linker.js:37-40`; make `ALL_LINK_RELATIONSHIPS` the three-way spread; add `'depends-on': 'Depends on'` to `EVIDENCE_RELATIONSHIP_LABELS` and `'depends-on': '⤵'` to `EVIDENCE_RELATIONSHIP_ICONS`. Update the comment above `ALL_LINK_RELATIONSHIPS` to name the third family and why it is outside the picker. `cleanAttestation` already throws for a non-`supports` relationship only when attestation metadata is PASSED — confirm no change is needed there.

- [ ] **Step 4: Run the file's suite**

Run: `node --test tests/evidence-linker.test.mjs`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/evidence-linker.js tests/evidence-linker.test.mjs
git commit -m "feat(links): EvidenceLinker stores depends-on edges; picker untouched (D.1)"
```

---

### Task 4: Wire parse round-trip and the publish selector

**Files:**
- Modify: `src/shared/assessment-publish.js:90-106` (comment only, if needed — see Step 3)
- Test: `tests/evidence-linker.test.mjs` (parse), `tests/assessment-publish.test.mjs` (selector)

**Interfaces:**
- Consumes: Task 2's builder output, Task 3's stored record shape.
- Produces: nothing new; pins that `parseRelationshipEvent` and `selectLinksToPublish` already do the right thing for `depends-on`.

- [ ] **Step 1: Write the failing-or-passing parse test** (append to `tests/evidence-linker.test.mjs`)

```js
test('parse: a foreign depends-on event round-trips with source/target in tag order', async () => {
    const A = '30040:' + 'a'.repeat(64) + ':claim-a';
    const B = '30040:' + 'b'.repeat(64) + ':claim-b';
    const { event } = await buildClaimRelationshipEvent({ sourceCoord: B, targetCoord: A, relationship: 'depends-on', note: 'B presupposes A' });
    const p = parseRelationshipEvent({ ...event, id: 'f'.repeat(64), pubkey: 'c'.repeat(64) });
    assert.equal(p.relationship, 'depends-on');
    assert.equal(p.source.coord, B);
    assert.equal(p.target.coord, A);
    assert.equal(p.note, 'B presupposes A');
});
```

- [ ] **Step 2: Write the selector test** (append to `tests/assessment-publish.test.mjs`, using the file's own `resetState()`, `ClaimModel`, `EvidenceLinker`, `buildClaimCoord`, `PUBKEY_A/B` and `ctx()` helpers exactly as the `links need BOTH endpoints wire-ready` test at ~line 173 does)

```js
test('publish-select: a stale depends-on link publishes on the ordinary 30055 path (not revision/*)', async () => {
    resetState();
    const pubClaim = await ClaimModel.create({ text: 'Ours, published.', source_url: 'https://example.com/p' });
    await ClaimModel.markPublished(pubClaim.id, 'e'.repeat(64), PUBKEY_A);
    const foreignCoord = buildClaimCoord(PUBKEY_B, 'their-d');
    const dep = await EvidenceLinker.create({
        source_claim_id: pubClaim.id, target_claim_id: foreignCoord,
        relationship: 'depends-on',
        target_snapshot: { url: 'https://example.com/f', text: 'Foreign.' }
    });
    const sel = selectLinksToPublish(await ctx());
    assert.equal(sel.length, 1);
    assert.equal(sel[0].link.id, dep.id);
    assert.equal(sel[0].link.relationship, 'depends-on');
});
```

- [ ] **Step 3: Run both files**

Run: `node --test tests/evidence-linker.test.mjs tests/assessment-publish.test.mjs`
Expected: PASS. The parser passes the value through and the selector only skips `contextualizes` and `revision/*`, so no code change is expected. If the selector test fails, the only permitted fix is in `selectLinksToPublish` and must keep `REVISION_RELATIONSHIPS` skipped. Either way, add one sentence to the comment block above `selectLinksToPublish` saying `depends-on` publishes here under the same flag as `supports` (spec §7).

- [ ] **Step 4: Commit**

```bash
git add tests/evidence-linker.test.mjs tests/assessment-publish.test.mjs src/shared/assessment-publish.js
git commit -m "test(wire): pin depends-on parse round-trip and its publish path (D.1)"
```

---

### Task 5: Golden wire fixture + NIP draft text

**Files:**
- Modify: `tests/tools/gen-wire-fixtures.mjs:376-385` (add a second 30055 spec after the `relationship` one)
- Modify: `tests/tools/wire-fixture-parsers.mjs:175-182` (add the `'30055-dependency'` parser entry)
- Create (generated): `tests/fixtures/wire/30055-dependency.json`
- Modify: `docs/NIP_DRAFT.md:428-429` (the `relationship` MUST line and the directionality line)
- Test: `tests/wire-fixtures.test.mjs` (existing; no edit expected)

**Interfaces:**
- Consumes: Task 2's builder.
- Produces: fixture `30055-dependency.json`, `rebuild: 'exact'`, signer TV1, inputs `{ sourceCoord: CLAIM_COORD_B, targetCoord: CLAIM_COORD, relationship: 'depends-on', sourceUrl, targetUrl, sourceEventId, targetEventId, sourceRelayHint: RELAY, targetRelayHint: '', note: 'Cannot be true unless the court filing exists.', suggestedBy: 'user' }` (mirror the `relationship` spec's URL and event-id inputs exactly so the two fixtures differ only in relationship, note and `d`).

- [ ] **Step 1: Add the spec and the parser entry.** In `gen-wire-fixtures.mjs` add `{ kind: 30055, shape: 'dependency', … notes: 'Directional edge (depends-on): source depends on target, NOT sorted — docs/CLAIM_DEPENDENCY_DESIGN.md §2.1.' }` using the same `build` shape as the `relationship` spec. In `wire-fixture-parsers.mjs` add `'30055-dependency'` with the same checks as `'30055-relationship'`.

- [ ] **Step 2: Run the fixture guard and watch it fail**

Run: `node --test tests/wire-fixtures.test.mjs`
Expected: FAIL — the determinism test reports a spec with no checked-in file (`30055-dependency.json`).

- [ ] **Step 3: Regenerate**

Run: `node tests/tools/gen-wire-fixtures.mjs`
Expected: `tests/fixtures/wire/30055-dependency.json` is written; `git status` shows ONLY that new file under `tests/fixtures/wire/` (every other fixture byte-identical — if any other fixture changed, stop: that is an unintended wire change).

- [ ] **Step 4: Run the fixture guard again**

Run: `node --test tests/wire-fixtures.test.mjs`
Expected: PASS (verify, re-parse, exact rebuild, emitted-kind rule, hygiene, determinism).

- [ ] **Step 5: Edit `docs/NIP_DRAFT.md` §30055.** On the `relationship` MUST line add `depends-on` to the list and this sentence: "`depends-on` (claim dependency, `CLAIM_DEPENDENCY_DESIGN.md`) is directional — `source` depends on `target`: the source claim cannot be true unless the target claim is true. It is a necessary-condition edge, distinct from `supports`, which is evidential." On the directionality line change "`supports` and `updates` are directional" to "`supports`, `updates` and `depends-on` are directional". Add a final bullet: "Consumers ignore a relationship event whose `relationship` value they do not recognize."

- [ ] **Step 6: Run the doc-sensitive guards and the whole suite**

Run: `node --test tests/wire-fixtures.test.mjs tests/structure-guards.test.mjs tests/constitution-guards.test.mjs && npm test`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add tests/tools/gen-wire-fixtures.mjs tests/tools/wire-fixture-parsers.mjs tests/fixtures/wire/30055-dependency.json docs/NIP_DRAFT.md
git commit -m "feat(wire): golden 30055-dependency fixture and NIP draft text for depends-on (D.1)"
```

---

### Task 6: Lint, budget, CHANGELOG line, PR

**Files:**
- Modify: `CHANGELOG.md` (Unreleased section, one line)
- Modify: `docs/CLAIM_DEPENDENCY_DESIGN.md` §7 table — mark D.1 "shipped (PR #n)" in the row once the PR number exists

- [ ] **Step 1: Run the repo's fast gates**

Run: `npm run lint:js && npm run build && npm run check:budget && npm test`
Expected: every gate green; the ESLint baseline is shrink-only, so no new warnings.

- [ ] **Step 2: Add the CHANGELOG line** under Unreleased: "Added `depends-on` to the kind-30055 relationship vocabulary (claim dependency D.1; `docs/CLAIM_DEPENDENCY_DESIGN.md`). Not yet offered in the link picker."

- [ ] **Step 3: Run the two review skills and the seam check** — `ecosystem-pm` (produces the `Wire format: additive` callout text), `architect` (the kind-emission one-way-door record), `seam-and-invariant-check` (a second member joined a set: the relationship vocabulary). Fold any blocking finding into the tasks above before pushing.

- [ ] **Step 4: Commit, push, open the PR** with the template: `Verification layer: unit + guard`; `Wire format: additive — already-published 30055 events parse and render unchanged; an older client's EvidenceLinker.create rejects the new value at the store boundary while parseRelationshipEvent passes it through, so nothing renders wrong`; `Docs: docs/NIP_DRAFT.md, CHANGELOG.md, docs/CLAIM_DEPENDENCY_DESIGN.md`; `Interpretive steps (1): kept depends-on out of CLAIM_RELATIONSHIPS so the picker waits for D.3's authoring test — default: separate constant.`

```bash
git add CHANGELOG.md docs/CLAIM_DEPENDENCY_DESIGN.md
git commit -m "docs: changelog + design ladder row for claim dependency D.1"
git push -u origin <branch>
```
