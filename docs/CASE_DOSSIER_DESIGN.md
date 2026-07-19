# Case Dossier — design

> **Status:** design draft (2026-07-03; sequencing updated
> 2026-07-08). Upgrades the existing portal case view
> (`src/portal/case-view.js`, Phase 12.5) into the assembled dossier
> the Case entity was always meant to open onto. **Derived,
> computed-on-read, no new wire kind** — every section is a pure
> function of events and local records that already exist. Built on
> its merits for the live case runs (the COVID corpus is the working
> fixture), CD.1 → CD.2 → CD.3, pure module first; see §6.
> `PHILOSOPHY.md` and `TRUTH_ADJUDICATION_DESIGN.md` §5 are cited as
> borrowed principles with attribution.

A **case** is an entity (`type: 'case'`) used as a folder: articles,
claims, entities, and judgments accumulate in its orbit. *(Amended
2026-07-19: this paragraph previously blessed the LLM Suggest pass
proposing court cases as case entities — "consistent with the intent."
That is superseded: a case is the researcher's own investigation
workspace, created by a human in the side panel, and the suggest pass
may propose only person / organization / place / thing —
`SUGGESTABLE_ENTITY_TYPES` in `llm-prompts.js`. A court case or a
scientific paper types as `thing`, with `thing_type` / `creator` /
`custom:*` fields carrying its metadata.)* This design answers four
questions for one case: how the evidence assembles, how the important
parts surface without burying the rest, how provenance traces, and what
actually advances a human's understanding.

---

## §1. What a case is today (mechanics, verified)

Membership is **claim-mediated plus tag-mediated**:

- A claim whose `about` includes the case id pulls in its article, its
  anchored quote, its other `about` entities, and its evidence links
  (`case-bundle.js` `collectCaseEntityIds` walks exactly this orbit).
- Articles tagged with the case entity at capture time link via kind
  `32125` entity↔article relationships.

Three tools already ride the orbit:

| Tool | Phase | What it does |
|---|---|---|
| Side-panel case dashboard | 11.5 | local claims about the case + stances + contradiction inconsistencies |
| Case export | 11.6 | deterministic JSON + Markdown of the orbit (`case-export.js`) |
| Case bundle | 11.8 | collaboration export incl. entity keys (`case-bundle.js`) |
| Portal case view | 12.5 | published artifacts grouped/badged: per-kind counts, claims w/ stance + ⚠, co-tagged people/orgs, publish-density strip (`case-view.js`) |

What is missing is the **synthesis**: the portal case view predates
Phases 13–15, its timeline axis is event `created_at` only
(`timeline.js` buckets publication/judgment time — never world time),
evidence renders as a flat list with no independence structure, and
there is no provenance rendering. Every ingredient below exists as a
primitive; this design is **composition, not new capture**.

---

## §2. Principles (borrowed, with attribution)

1. **Derived and reproducible.** The dossier follows the
   `audit/dossier.js` / `truth-entity-record.js` posture: computed on
   read from events + local records, never persisted, no new wire
   kind. Anyone with the same events derives the same dossier.
2. **No case-level score, ever.** The truth design's §5 red lines and
   `PHILOSOPHY.md`'s never-score-a-conclusion rule apply with full
   force: a fused "case strength" number is how a case folder becomes
   an orthodoxy machine. The honest headline is a *distribution*
   (§3.1), not a number.
3. **Every summary is a door, not a wall.** Each level of the inverted
   pyramid links to the level below; nothing renders that cannot be
   clicked through to its verbatim, content-addressed support.
4. **Time axes are never flattened.** World time, publication time,
   capture time, and judgment time are different facts; their *gaps*
   are evidence (§3.3).
5. **Disagreement is data.** Multiple authors' verdicts on one
   proposition render side by side (`verdictVariance` /
   `matchVariance`), never averaged — the portal's existing
   never-average rule extended to the case surface.
6. **Coverage on its face.** Every section states what it covers (N
   articles, M claims, K propositions) so absence of evidence is never
   silently read as evidence of absence.

---

## §3. The five sections, mapped to data that exists

### §3.1 Shape of knowledge (the header)

The verdict-state distribution over the case's propositions:
**"N established (true/false), M contested, K unresolved, J
insufficient-evidence — plus P predictions open, Q resolved."**

| Need | Source |
|---|---|
| Propositions in the case | `TruthAdjudicationModel` records whose `claim_id` resolves to a claim with the case in `about` |
| Verdict states | `VerdictModel` **chain heads only** (supersession chains collapse to the active ruling) |
| Standards of proof | each verdict's `standard_of_proof` — shown as chips, because "established at preponderance" ≠ "established beyond reasonable doubt" |
| Prediction ledger | `audit-cache.js` `listPredictions` / `listResolutions` scoped to the orbit's articles |
| Coverage line | orbit counts: articles / claims / claims-with-propositions — the denominator that caps every impression |

Multiple adjudicators on one proposition → the variance renders, never
a merge (P5 borrowed).

### §3.2 Knots (contested territory first)

- **Contradiction clusters**: connected components over
  `EvidenceLinker` `contradicts` edges within the orbit (the existing
  case view badges *individual* contradicted claims; the dossier
  renders the *cluster* — the knot is the unit of interest).
- **Words-vs-deeds gaps**: `IntegrityModel` findings (chain heads)
  whose word/deed propositions live in the orbit, via
  `timelineForEntity` per involved entity.
- **Forensic findings** (kind 30062) whose subject is an orbit entity —
  named maneuvers, categorical, no score.

### §3.3 Timeline (the four axes)

| Axis | Meaning | Source |
|---|---|---|
| **World time** (default spine) | when things happened | `occurred_at` + mandatory `occurred_precision` on propositions/deeds (Phase 15 — no false precision: a year-precision event renders as a year-wide band, never a fake date) |
| Publication | when things were said | article metadata dates on 30023s in the orbit |
| Capture | when evidence was preserved | capture/archive-cache timestamps |
| Judgment | when rulings happened | verdict `created`/supersessions, forensic finding dates, prediction horizons + resolutions |

Default render: world-time spine with the other axes as toggleable
overlays. The **gap callouts** are the value-add no link folder has:
published-before-occurred (prediction or fabrication?), story-changed-
after-event (supersession following a world event), capture-long-after-
publication (late preservation, weaker archival claim). The existing
`timeline.js` bucketing (UTC day/week rollup) is reused for the
publication/judgment overlays; the world-time spine is new and must
respect precision bands.

### §3.4 Evidence table (convergence-collapsed)

The orbit's articles grouped by **origin**, not listed flat:

- Grouping: `truth-attestation.js` `attestationConvergence` — origin
  keys collapse "twelve outlets, one press release" into one origin
  group with its independence measurement (`origin_count`,
  `independent_count`, tie-broken baseline, full derivation shown).
- Per-article context chips (never aggregated upward): audit band per
  the display rules (no naked numbers; sub-threshold renders "needs
  human review"), evidence tier where attested, content-hash presence
  (`x` tag), capture completeness (archive copy / screenshot /
  snapshot).
- Per-claim rows under each article: the anchored verbatim quote, its
  stance/assessment chips, its link edges.

### §3.5 Entities involved (name × role × record)

Union of: co-`about` entities on orbit claims, claim `source` entities,
platform accounts (32126) collapsed to persons via the identity layer,
forensic roles (witness / critic / institution / …), and integrity
subjects. Each row: name, role(s) *in this case*, and a click-through
to the existing coverage-capped entity record
(`truth-entity-record.js` — commitments kept/broken as count+list,
calibration, corrections; never a person-grade). The case dossier
never invents a new per-person judgment surface — it routes to the one
that exists, coverage caps intact.

---

## §4. The provenance walk

One affordance, added to the portal inspector: from any judgment,
walk down the already-content-addressed chain, one signed hop at a
time —

```
verdict (30063, signed, claim coordinate + article hash)
  → proposition (class, criteria, occurred_at)
    → claim (30040, signed — verbatim quote + W3C selector + source)
      → article (30023, signed — canonical x-hash)
        → capture (archive copy / HTML snapshot / screenshot, local)
          → author (32126 platform account → identity → track record)
```

Each hop renders what binds it to the next (the coordinate, the hash,
the selector) and its signature author. Two failure states are
first-class, not errors: **binding broken** (live page no longer
matches the x-hash — the judgment visibly binds to the *archived*
bytes, which is the point of content addressing) and **hop absent**
(e.g. no capture — the walk says so instead of faking continuity).

---

## §5. Non-goals (by construction)

- **No case verdict.** The dossier never rules on "the case" — only
  its propositions carry rulings, and the header is a distribution.
- **No auto-narrative.** No LLM-written case summary in v1; the
  structure *is* the summary. (A flag-gated assist could later draft
  prose from the dossier — separately designed, consent-gated.)
- **No new wire kind; nothing persisted.** Cross-investigator
  shareability is the published events on public relays — the dossier
  is derived, so anyone with the events recomputes it. The existing
  case export/bundle MAY later gain the dossier's JSON as a
  collaboration-handoff section (CD.5 — out of the current window;
  deterministic, so it composes with `case-export.js`'s existing
  determinism contract).
- **No cross-user aggregation.** Same v1 posture as everything else:
  other users' events render side-by-side when loaded, never merged.

---

## §6. Slice plan (one PR each; `claude/case-dossier-*`)

Sequenced **merits-first alongside the live case runs** — the COVID
corpus is the working fixture (eggs the second). CD.1 is pure and
fixture-testable with no UI risk; if reactive capture fixes consume
the window, shed CD.3 first, then CD.2 — **CD.1 is the data spine and
is kept** (its numbers stand alone even without new UI).

- **CD.1 — orbit assembler.** `src/shared/case-dossier.js`: pure
  `assembleCaseDossier(caseEntityId)` → {propositions+verdict heads,
  knots, evidence groups, entities×roles, timeline events with axis
  tags}. Reuses collectors from case-bundle/case-export; exhaustive
  tests over fixtures (incl. precision bands, chain-head collapse,
  convergence grouping).
- **CD.2 — shape-of-knowledge + evidence table.** Case-view header
  (distribution + coverage line + standards chips) and the
  convergence-collapsed evidence table with context chips.
- **CD.3 — timeline.** World-time spine with precision bands +
  overlay toggles + gap callouts; reuse `timeline.js` bucketing for
  overlays.
- **CD.4 *(later — out of the current window)* — knots +
  entities×roles.** Contradiction clusters,
  integrity/forensic panels, the entity-role table routing to entity
  records.
- **CD.5 *(later — out of the current window)* — provenance walk +
  export.** Inspector walk (incl. both
  failure states); dossier JSON section in case export; SMOKE §Case
  dossier rows (keyless — fixtures via console, the §Phase 15
  convention).

---

## §7. Open questions

1. **Membership edges** — v1 takes the union (claims-`about` +
   32125 tags). Should an article tagged to the case but with zero
   claims render in the evidence table? Default: yes, in an
   "unprocessed sources" group — visible backlog, not hidden.
2. **Large-case performance** — computed-on-read over a big orbit
   (hundreds of articles) may need the portal-cache treatment;
   defer until the eggs case (~24 sources) says otherwise.
3. **Dossier JSON in bundles** — bundles carry keys; exports don't.
   The dossier section goes in the *export*; whether bundles also
   embed it is a collaborator-workflow question, deferred.
