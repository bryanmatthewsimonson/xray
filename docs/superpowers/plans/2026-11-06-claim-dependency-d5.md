# Claim dependency D.5 — LLM-suggested dependencies through the proposal firewall — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the corpus passes PROPOSE `depends-on` edges — in the brief's `load_bearing` entries as `rests_on` premises and in both relationship-proposal tools — through the existing validate → ground → human-accept path, with the authoring test in the prompts and on the review rows, every drop disclosed, and nothing applied without a click.

**Architecture:** No new accept path. A `rests_on` list on each `load_bearing` brief entry is converted into `relationship: 'depends-on'` proposals by the same `filterProposals` that already validates relationship proposals; the two LLM tools' `relationship` enums widen to `PROPOSABLE_RELATIONSHIPS` (the Phase-11 four plus `depends-on`); the prompts carry the §2.1 authoring test verbatim; the review rows show it under every `depends-on` proposal; a one-line pure summary discloses how many dependency proposals survived and how many dropped, with reasons. Proposal and link keys become direction-aware for directional relationships, since `A depends-on B` and `B depends-on A` are two proposals.

**Tech Stack:** plain ES modules, `node --test`.

**Spec:** `docs/CLAIM_DEPENDENCY_DESIGN.md` §2.1 (the authoring test), §4 item 2 (the LLM producer), §6, §7 row D.5. Firewall: `docs/CASE_SYNTHESIS_DESIGN.md` §4 (validate → ground → filter → human-accept).

## Global Constraints

- Every proposed `depends-on` lands only on a human Accept, stamped `suggested_by: 'llm:<model>'` (the existing `acceptProposal` path in `src/portal/synthesis-review.js`).
- Every ref must resolve to a captured claim; a `rests_on` id that does not is a rejected row with a reason, never a silent drop.
- The authoring test, verbatim, in both system prompts and on every `depends-on` review row: *Could the source still be true if the target turned out to be false? If yes, the link is `supports`, not `depends-on`.*
- Both tools keep NO numeric slot (`tests/corpus-prompts.test.mjs` and `tests/corpus-links.test.mjs` grep-guard it); the prompts keep "NEVER output a verdict, score, probability".
- `MAP_PROMPT_VERSION` stays `corpus-v9` (the extract cache key); `CORPUS_PROMPT_VERSION` → `corpus-v10` and `CLAIM_LINKS_PROMPT_VERSION` → `claim-links-v2` (the reduce and links tool schemas change).
- Prompt files carry `// Standards: analysis — docs/DISCIPLINES.md §6.` already; do not touch the `// Standards:` line.
- Direction-aware keys: `proposalKey` / `linkRecordKey` sort endpoints ONLY for symmetric relationships (`isSymmetricRelationship`); directional ones (`supports`, `updates`, `depends-on`, the `revision/*` values) keep order. This changes the stored triage key of previously-dismissed DIRECTIONAL proposals once (they reappear as open) — a journal entry records it.
- 4-space indentation; `Utils.log` only; `docs/SMOKE_TEST.md` is a process file (cite JOURNAL 2026-11-06).

## Review Focus

1. A `rests_on` id that names the load-bearing claim itself must be rejected as a self-link, not accepted — Task 3.
2. A `rests_on` entry on a `load_bearing` row whose `claim_ref` is null must be rejected with a reason naming the missing source — Task 3.
3. `A depends-on B` and `B depends-on A` must be two proposals with two keys, while `A contradicts B` and `B contradicts A` stay one — Task 1.
4. A `depends-on` proposal whose pair already exists as a `supports` link must NOT be rejected as "already exists" (different relationship, different key) — Task 1 / Task 3.
5. The review row for a `depends-on` proposal must show the authoring test; a `supports` row must not — Task 4.

---

### Task 1: Direction-aware proposal and link keys

**Files:**
- Modify: `src/shared/case-synthesis.js:700-706` (`proposalKey`) and `:775-777` (`linkRecordKey`)
- Test: `tests/case-synthesis.test.mjs` (the `proposalKey is stable and direction-insensitive` test at ~317), `tests/synthesis-review.test.mjs` (the `flipped endpoints keeps its triage status` test at ~38)

**Interfaces:**
- Produces: `proposalKey(p)` → `rel:<a>|<b>:<relationship>` with `[a,b]` sorted only when `isSymmetricRelationship(p.relationship)`; `linkRecordKey(link)` identical rule. Import `isSymmetricRelationship` from `./assessment-taxonomy.js`.

- [ ] **Step 1: Rewrite the two tests**

```js
test('case-synthesis: proposalKey sorts endpoints for symmetric relationships only — a directional pair is two proposals (D.5)', () => {
    const k = (s, t, r) => CS.proposalKey({ kind: 'relationship', source_claim_id: s, target_claim_id: t, relationship: r });
    assert.equal(k('c2', 'c1', 'contradicts'), 'rel:c1|c2:contradicts', 'symmetric: order does not fork the key');
    assert.equal(k('c1', 'c2', 'supports'), 'rel:c1|c2:supports');
    assert.equal(k('c2', 'c1', 'supports'), 'rel:c2|c1:supports', 'directional: the reverse is a different proposal');
    assert.notEqual(k('c1', 'c2', 'depends-on'), k('c2', 'c1', 'depends-on'));
    assert.notEqual(k('c1', 'c2', 'depends-on'), k('c1', 'c2', 'supports'), 'the relationship is in the key');
    assert.equal(CS.linkRecordKey({ source_claim_id: 'c2', target_claim_id: 'c1', relationship: 'depends-on' }), 'rel:c2|c1:depends-on');
    assert.equal(CS.linkRecordKey({ source_claim_id: 'c2', target_claim_id: 'c1', relationship: 'duplicates' }), 'rel:c1|c2:duplicates');
});
```

and in `tests/synthesis-review.test.mjs` make the flipped-endpoints test use `contradicts` (symmetric: triage kept) and add the assertion that a flipped `supports` proposal is a NEW open row.

- [ ] **Step 2: Run and watch them fail**

Run: `node --test tests/case-synthesis.test.mjs tests/synthesis-review.test.mjs`
Expected: FAIL on the directional assertions.

- [ ] **Step 3: Implement** both functions with one shared `pairKey(a, b, relationship)` helper.

- [ ] **Step 4: Run** the two files plus `tests/corpus-links.test.mjs` — all PASS.

- [ ] **Step 5: Commit** `fix(synthesis): proposal and link keys keep endpoint order for directional relationships (D.5)`

---

### Task 2: The proposable vocabulary and the authoring test as pure constants

**Files:**
- Modify: `src/shared/assessment-taxonomy.js` (append after `isDependencyRelationship`)
- Modify: `src/shared/evidence-linker.js` (`DEPENDENCY_AUTHORING_TEST` becomes a re-export of the taxonomy constant; `EVIDENCE_RELATIONSHIPS` unchanged)
- Test: `tests/assessment-taxonomy.test.mjs`

**Interfaces:**
- Produces: `export const PROPOSABLE_RELATIONSHIPS = Object.freeze([...CLAIM_RELATIONSHIPS, ...DEPENDENCY_RELATIONSHIPS])` and `export const DEPENDENCY_AUTHORING_TEST` (the verbatim §2.1 sentence) in `assessment-taxonomy.js`. `evidence-linker.js` keeps exporting `DEPENDENCY_AUTHORING_TEST` (re-export) so D.3's importers are untouched.

- [ ] **Step 1: Write the failing test**

```js
test('taxonomy: PROPOSABLE_RELATIONSHIPS is the picker set — the LLM may propose exactly what a human may draw (D.5)', () => {
    assert.deepEqual(PROPOSABLE_RELATIONSHIPS, [...CLAIM_RELATIONSHIPS, ...DEPENDENCY_RELATIONSHIPS]);
    assert.ok(!PROPOSABLE_RELATIONSHIPS.some((r) => REVISION_RELATIONSHIPS.includes(r)), 'revision values are drawn by the forensic flow, never proposed here');
    assert.match(DEPENDENCY_AUTHORING_TEST, /^Could the source still be true if the target turned out to be false\? If yes, the link is `supports`, not `depends-on`\.$/);
});
```

- [ ] **Step 2: Run and watch it fail**; **Step 3: Implement** (move the sentence, re-export from the linker); **Step 4: Run** `node --test tests/assessment-taxonomy.test.mjs tests/evidence-linker.test.mjs` — all PASS; **Step 5: Commit** `feat(taxonomy): PROPOSABLE_RELATIONSHIPS and the authoring test as pure constants (D.5)`

---

### Task 3: `rests_on` in the brief; `depends-on` in both tools, the schema, the validators

**Files:**
- Modify: `src/shared/corpus-prompts.js` — the reduce tool (`load_bearing` items gain `rests_on: { type: 'array', items: { type: 'string' }, description: 'Existing claim ids this claim CANNOT be true without — necessary conditions only.' }`; the `proposals` relationship enum → `PROPOSABLE_RELATIONSHIPS`), the reduce system prompt (a `DEPENDENCIES` block: the §2.1 definition, the authoring test verbatim, "propose `depends-on` on BOTH sides of a disagreement where it exists; a corpus whose dependencies all sit under one position deserves scrutiny, not smoothing", "`rests_on` names ONLY existing ids from the claims index"), the claim-links tool enum and system prompt (same block), and the version constants (`CORPUS_PROMPT_VERSION = 'corpus-v10'`, `CLAIM_LINKS_PROMPT_VERSION = 'claim-links-v2'`)
- Modify: `src/shared/case-synthesis.js` — `BRIEF_SCHEMA` (`load_bearing` items gain optional `rests_on: arr(str())`; the proposal enum → `PROPOSABLE_RELATIONSHIPS`); `filterProposals` gains a first step: for each `load_bearing` entry with `rests_on`, synthesize `{ kind: 'relationship', source_claim_id: entry.claim_ref, target_claim_id: id, relationship: 'depends-on', note: entry.why || '', from_rests_on: true }` rows ahead of `brief.proposals` (a null `claim_ref` → rejected `'rests_on names no source claim (claim_ref is null)'`); the relationship check uses `PROPOSABLE_RELATIONSHIPS`
- Modify: `src/shared/llm-proposals.js:237-241` (`validateProposal` relationship case → `PROPOSABLE_RELATIONSHIPS`)
- Test: `tests/corpus-prompts.test.mjs` (version pins; a new prompt test), `tests/corpus-links.test.mjs` (version pin; enum), `tests/case-synthesis.test.mjs` (filterProposals rests_on tests), `tests/llm-proposals.test.mjs`

**Interfaces:**
- Consumes: Task 2's constants.
- Produces: `filterProposals(brief, ctx)` → `{ acceptable, rejected }` where `rests_on` rows appear as `depends-on` relationship proposals carrying `from_rests_on: true`; rejected rows carry a reason.

- [ ] **Step 1: Write the failing tests**

```js
// tests/case-synthesis.test.mjs
test('filterProposals: a load_bearing entry\'s rests_on becomes depends-on proposals — source = the claim, each target validated; self and null-source rejected with reasons (D.5)', () => {
    const brief = { summary: 's', load_bearing: [
        { claim_ref: 'c1', article_hash: 'A', quote: 'q', why: 'rests on the log', rests_on: ['c2', 'c1', 'nope'] },
        { claim_ref: null, article_hash: 'A', quote: 'q', rests_on: ['c2'] }
    ], proposals: [{ kind: 'relationship', source_claim_id: 'c1', target_claim_id: 'c2', relationship: 'depends-on' }] };
    const { acceptable, rejected } = CS.filterProposals(brief, { claimsById: { c1: {}, c2: {} } });
    assert.deepEqual(acceptable.map((p) => [p.source_claim_id, p.target_claim_id, p.relationship, p.from_rests_on === true]),
        [['c1', 'c2', 'depends-on', true]], 'the explicit duplicate proposal dedups against the rests_on row');
    assert.equal(acceptable[0].note, 'rests on the log');
    assert.deepEqual(rejected.map((r) => r.reason).sort(), ['rests_on names no source claim (claim_ref is null)', 'source and target are the same claim', 'unknown target claim nope']);
});
test('filterProposals: depends-on is a valid proposal relationship; a revision value is not', () => { … });
// tests/corpus-prompts.test.mjs — update the version pin: MAP 'corpus-v9', CORPUS 'corpus-v10'; add:
test('corpus-prompts: both tools offer depends-on and both prompts carry the authoring test verbatim (D.5)', () => {
    for (const tool of [CP.buildReduceTool(), CP.buildClaimLinksTool()]) { /* find the relationship enum; assert it deepEquals PROPOSABLE_RELATIONSHIPS */ }
    assert.ok(CP.buildReduceTool().input_schema.properties.load_bearing.items.properties.rests_on);
    for (const sys of [CP.buildReduceSystemPrompt({}), CP.buildClaimLinksSystemPrompt({})]) {
        assert.ok(sys.includes(DEPENDENCY_AUTHORING_TEST));
        assert.match(sys, /BOTH sides/);
        assert.match(sys, /NEVER output a verdict, score, probability/);
    }
});
// tests/corpus-links.test.mjs — version pin → 'claim-links-v2'; prepareLinkProposals accepts depends-on and rejects 'narrative-patch'
// tests/llm-proposals.test.mjs — validateProposal accepts a depends-on relationship with two refs
```

- [ ] **Step 2: Run and watch them fail**; **Step 3: Implement**; **Step 4: Run** the four files plus `tests/structure-guards.test.mjs tests/disciplines.test.mjs` — all PASS (the no-numeric-slot guards included); **Step 5: Commit** `feat(llm): propose depends-on through the brief's rests_on and both relationship tools, behind the authoring test (D.5)`

---

### Task 4: The review rows and the disclosure line

**Files:**
- Modify: `src/shared/case-synthesis.js` (append `dependencyProposalSummary(acceptable, rejected)`)
- Modify: `src/portal/synthesis-review.js` (`describe()` for a `depends-on` row appends the authoring test; the list header gets the summary line when any dependency proposal exists)
- Modify: `src/portal/links-block.js:168-170` (the status line after `prepareLinkProposals` appends the summary)
- Test: `tests/case-synthesis.test.mjs`, `tests/synthesis-review.test.mjs`

**Interfaces:**
- Produces: `dependencyProposalSummary(acceptable, rejected)` → `''` when neither list has a `depends-on` row; else `N dependency proposal(s) to review · M dropped (reason; reason)` with the distinct reasons joined by `; `. `describe(p, …)` (already exported or exportable from `synthesis-review.js`) ends with ` — ${DEPENDENCY_AUTHORING_TEST}` for `depends-on` rows only.

- [ ] **Step 1: Write the failing tests**

```js
test('dependencyProposalSummary: counts dependency proposals and discloses every drop reason; empty when none', () => {
    const acc = [{ kind: 'relationship', relationship: 'depends-on' }, { kind: 'relationship', relationship: 'supports' }];
    const rej = [{ kind: 'relationship', relationship: 'depends-on', reason: 'unknown target claim x' }, { kind: 'relationship', relationship: 'depends-on', reason: 'unknown target claim x' }, { kind: 'is_key', reason: 'unknown claim' }];
    assert.equal(CS.dependencyProposalSummary(acc, rej), '1 dependency proposal to review · 2 dropped (unknown target claim x)');
    assert.equal(CS.dependencyProposalSummary([{ kind: 'relationship', relationship: 'supports' }], []), '');
});
test('synthesis-review: a depends-on row shows the authoring test; a supports row does not', () => { /* describe() */ });
```

- [ ] **Step 2: Run and watch them fail**; **Step 3: Implement**; **Step 4: Run** `node --test tests/case-synthesis.test.mjs tests/synthesis-review.test.mjs tests/structure-guards.test.mjs` — all PASS; **Step 5: Commit** `feat(portal): the authoring test on every depends-on proposal row and a dependency-proposal disclosure line (D.5)`

---

### Task 5: Journal, smoke rows, ladder, changelog, gates, PR

**Files:**
- Modify: `docs/journal/2026-11.md` (append an entry: direction-aware proposal keys — why, and the one-time reappearance of dismissed directional proposals), regenerate `docs/JOURNAL.md` with `npm run docs:journal`
- Modify: `docs/SMOKE_TEST.md` (rows P-D.l: Analyze corpus → the brief's proposals include `depends-on` rows each showing the authoring test, with the disclosure line; P-D.m: Suggest links → same; P-D.n: Accept one → a `depends-on` link stamped `llm:<model>` appears on the claim card and the dashboard chips of D.3/D.4 follow)
- Modify: `docs/CLAIM_DEPENDENCY_DESIGN.md` (§7 row D.5 shipped; §4 item 2 rewritten to the shipped shape: `rests_on` plus the two tools' enums, through `filterProposals`), `CHANGELOG.md`

- [ ] **Step 1: Write the journal entry and regenerate the index**; **Step 2: smoke rows, ladder, §4, changelog**; **Step 3: Run the gates** `npm run lint:js && npm run build && npm run check:budget && npm test` — green; **Step 4: Commit, push, open the PR** — `Verification layer: unit + guard + human-soak (P-D.l–n)`; `Wire format: none`; `Docs: docs/journal/2026-11.md (+ docs/JOURNAL.md), docs/SMOKE_TEST.md (JOURNAL 2026-11-06), docs/CLAIM_DEPENDENCY_DESIGN.md, CHANGELOG.md`; interpretive steps: `rests_on` rides the relationship-proposal path rather than a new accept path; direction-aware keys resurrect dismissed directional proposals once; the prompt's "both sides" rule is an instruction plus the disclosure line, not a post-check that refuses a one-sided result.
