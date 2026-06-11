# Phase 13 — Epistemic audits: recording what you *checked*, not just what you concluded

**Status:** kickoff brief, 2026-06-11. This is the prompt for a *new
session* to design Phase 13. **Design note ONLY this session** — the
maintainer has explicitly scoped this run to producing
`docs/EPISTEMIC_AUDIT_DESIGN.md` for review; **no feature code, no wire
builders, no UI, not even "obviously safe" model scaffolding** until the
review questions at the bottom of the design note are answered. The
Phase 10/11/12 cadence applies, but this session ends at the design PR.
**Verify everything here against the current `main` first — the repo is
the source of truth and may have moved.**

## Provenance warning — read this before believing this brief

The "epistemic audit" concept below is a **reconstruction**. The
maintainer developed the original framework in conversations that were
not accessible when this brief was written (confirmed inaccessible:
other-chat history, session transcripts, memory; in the repos, no
framework exists — the only "epistemic" hit anywhere in history is an
incidental topic-tag example in a dropped plan, see below). What WAS
recoverable is three planning docs that lived in this repo's
`docs/plans/` tree at commit `71ee3e2` (later dropped from the tree in
`6bb1932` — retrieve from history, all runnable from the repo root):

```sh
git show 71ee3e2:docs/plans/evidentiary-standards.md      # 2,840 lines
git show 71ee3e2:docs/plans/trust-reputation-system.md    # 2,162 lines
git show 71ee3e2:docs/plans/NIP-COURT-OF-PUBLIC-OPINION.md
```

Read all three (inputs, not specs; see "Mining the prior art" below).
The third is the maintainer's own 2026-04 draft — codes of conduct
(kind 32150: versioned, inheritable **clause lists** with ids and
severities), grievances citing clauses, self-published verdicts. Note
its explicit split: "Disputes address *facts*; grievances address
*behavior*." The epistemic-audit layer is plausibly the **facts
sibling** of that behavior track — structured examination against
codified criteria, producing a signed finding — and the 32150
clause/`extends`/versioning pattern is a live candidate for publishing
audit *methodologies* as first-class events. Take the parallel
seriously; it is the closest thing to the maintainer's own voice on
this topic that survives in the repo.

Because the concept is reconstructed, your design note must treat
**the concept itself as reviewable**, not just the implementation:
state the conceptual commitments crisply, and put a review question to
the maintainer asking where the reconstruction diverges from their
original framework. Expect corrections; design so corrections are
cheap (vocabularies and enums, not schemas and engines).

## Your job this session

Repo: `/Users/bryan/Library/CloudStorage/Dropbox/working/xray`
(github.com/bryanmatthewsimonson/xray) — you should already be in it.
This brief lives at `docs/EPISTEMIC_AUDIT_KICKOFF.md` on `main`.

Design (do not build) an **epistemic-audit layer** for X-Ray: a
structured, repeatable, signed record of *the checks performed* on an
epistemic object — a claim, a source, a case, a capture, or your own
judgment history — and *what those checks found*, as distinct from the
verdict you hold about it. X-Ray already records verdicts (kind-30054
assessments: stance + issue labels). The audit is the complement:
**assessment = my judgment OF the claim; audit = my examination of the
claim's SUPPORT.** Financial-audit framing: methodology, working
papers, findings, an opinion, and an artifact someone — including
future-you — can re-perform.

The orthogonality is the payoff, so protect it: a user can disagree
(−2) with a well-supported claim, and agree (+2) with one whose audit
returns unsupported. That second cell — *agree, unsupported* — is "I
believe this on vibes," arguably the single most valuable thing a
personal epistemics tool can show its user. A design that lets audits
read as endorsements (or assessments masquerade as audits) has failed.

## Read first (and verify — don't take this brief's word for it)

- `CLAUDE.md` — contexts, conventions, the `xray:*` bus. **CAUTION:**
  parts of it are stale (pre-Phase-11): its event-builder kind list
  still shows retired 30043 as live and omits 30054/30055, and its
  roadmap line stops at Phase 9a/v0.5.0. On kinds and phase status,
  trust `docs/ROADMAP.md`, `docs/ASSESSMENTS_DESIGN.md`, and the code
  — they postdate it. (Fixing CLAUDE.md is queued separately; not your
  concern tonight.)
- `docs/ASSESSMENTS_DESIGN.md` — the Phase 11 design this layer sits
  beside; its "why a new kind" rationale (§ kind 30054 vs 30051/30052)
  is the template for your own kind-number argument.
- `docs/NIP_DRAFT.md` — the wire conventions: `d`-tag recomputability,
  `r` verbatim + `i` normalized, the 30051-vs-30054 "consumers MUST NOT
  merge" firewall you'll replicate for audits-vs-assessments.
- `docs/PORTAL_DESIGN.md` + `docs/PORTAL_KICKOFF.md` — Phase 12; the
  portal is where audit-derived views will surface.
- `src/shared/assessment-taxonomy.js` — the label grammar and the
  custom-label escape hatch (`family/value`, ≤64 chars). Note the
  existing vocabulary is entirely *failure-mode* labels; "I checked X
  and it held" is currently unrepresentable.
- `src/shared/claim-ref.js` + `src/shared/assessment-model.js` — the
  local-id/coordinate duality and publish-time coordinate backfill.
  Your audit record's target-ref scheme inherits this machinery (and
  its hard-won rules: a record referencing an unpublished local claim
  cannot publish; republished claims acquire second coordinates,
  tracked via `claimPublishedPubkeys`).
- `src/shared/metadata/builders.js` — the `{event, body, dTag}` builder
  contract, and the **dormant kind-30051 fact-check builder**: its
  repeatable `evidence` tags are the only evidence-attachment primitive
  in the codebase today.
- `src/shared/html-snapshot.js` + `src/shared/screenshot.js` — capture
  evidence with SHA-256 hashes, published as 30023 tags
  (`html_snapshot_sha256`, `screenshot_sha256`). Page-level only; no
  per-claim or per-judgment evidence binding exists.
- `src/shared/case-export.js` — the deterministic case artifact
  (closest existing thing to an audit report; client-side, unsigned).
- `src/portal/reconcile.js` — `LEDGERED_KINDS` and address
  recomputation; a published audit kind must join this machinery.

## What exists, what's missing

The audit layer composes with shipped primitives: claims (30040,
coordinate-addressed, span-anchored), assessments (30054: stance −2..+2,
labels with per-label anchors + notes, `suggested_by` provenance),
relationships (30055: contradicts/supports/updates/duplicates), label
mirrors (1985), cases-as-entities with shareable key bundles, the
dormant Phase 9a kinds (30050 annotations, 30051 fact-checks with
ClaimReview JSON-LD + `evidence` tags, 30052 ratings, 30053
topic-trust, 9803 helpfulness), capture-evidence hashing, case export,
and the portal's read-back/reconciliation.

The genuine gaps your design fills (verify each against the code):

1. **No record of checks performed.** Assessments record conclusions;
   nothing distinguishes "I verified the primary source and it held"
   from "I never looked." A clean claim and an unexamined claim are
   indistinguishable.
2. **No evidence-attachment primitive.** Kind 30043 was *retired* in
   Phase 11 (do not reuse the number); 30055 links claim↔claim only.
   "The evidence behind this judgment" has no representation.
3. **No per-source track record.** Nothing computes "across my corpus,
   this source's claims failed verification N times."
4. **No staleness story for judgments.** Targets update; prior
   examinations silently keep vouching.
5. **No calibration surface.** Stance history is never compared to how
   claims resolved or how well-supported they proved to be.

Kind-number space: 30056+ is free (30042 also unused; 30044–30049
free; 30043 retired-do-not-reuse). The contiguous 3005x block keeps the
metadata-layer conventions reusable — but argue your choice in the
note the way ASSESSMENTS_DESIGN argued 30054.

## The reconstructed concept (treat as a strawman to refine)

Two tiers run through everything below — keep them separate in the
note:

- **Verified against `main` — keep:** no numeric confidence (the 0–100
  field was deliberately removed in Phase 10.1; see
  `docs/CLAIMS_REDESIGN.md`); a separate kind with a hard
  consumers-MUST-NOT-merge firewall (the NIP_DRAFT 30051-vs-30054
  precedent); local-first, flag-gated, `d` recomputable, dual-read;
  design-note-only scope this session.
- **Reconstruction — challenge freely:** every named check, the
  outcome and opinion enums, the depth field, the derived views, the
  failure-mode mitigations. These are one defensible shape, not the
  maintainer's settled intent.

**Targets.** Claim audits first; the design should make source, case,
capture, and self (calibration) audits *additive vocabularies on the
same record shape*, not new shapes. A sixth target — auditing an audit
(re-performance) — is what keeps the artifact honest; design for it,
don't build it.

**Instrument.** Per-target check vocabularies in the house label
grammar: small (≤8 checks), namespaced + versioned
(`xray/audit/claim@1`), one shared outcome enum everywhere —
`pass | fail | n-a | blocked`. `blocked` (attempted, couldn't
determine: paywall, dead link) is not `fail`; recording *inability to
verify* is half the point. Candidate claim-audit checks to refine:
`traced` (followed to origin utterance, not a paraphrase chain),
`primary` (primary source located), `corroborated` (independent
second source — not the same wire copy), `anchored` (tied to exact
span), `firsthand` (asserter positioned to know), `current` (no
superseding update), `contradictions-examined` (outstanding 30055s
each looked at — deliberately *examined*, not "cleared": whether they
resolve in the claim's favor is assessment territory), `archived`
(evidence durable). Checks may carry a note, a W3C-selector anchor
(the `label-anchor` idiom), and an evidence ref.

**Record.** Addressable per (author, target, methodology, as-of):
**target ref** + `methodology@version` + `as-of` date **+ target
content hash** (staleness detection) + `depth` (spot/standard/deep —
effort, which is observable) + checks with outcomes + an **opinion
enum** lifted from financial audit. The target ref is real design
work, not a footnote: claims inherit the local-id/coordinate duality
and publish-time backfill from the assessment layer
(`claim-ref.js`, `resolveClaimRef`), but a *source* is a domain or
entity, a *case* is an entity pubkey, and *self* is the user pubkey —
none of which is an event coordinate; the note must define the ref
scheme per target. Re-audits accumulate as dated artifacts (unlike
30054, where latest-wins replacement is correct). **No numeric
confidence anywhere** — the 0–100 confidence field was deliberately
removed from claims in Phase 10.1; don't reintroduce false precision
through the back door. **Choose opinion tokens disjoint from
`STANCE_LABELS` and `ASSESSMENT_LABELS`** in
`src/shared/assessment-taxonomy.js` — beware: the obvious candidate
`unsupported` is ALREADY an assessment label, so a naive
supported/unsupported enum breaks the firewall at the vocabulary
level; the financial-audit-native tokens
(`clean | qualified | adverse | disclaimer`) are collision-free
candidates — argue the choice in the note.

**Derived views (single corpus, no network):** source track records
(outcome rates with visible denominators — never a composite score),
case readiness ("3 of 7 load-bearing claims audited; 2 contradictions
open"), the stance×opinion calibration quadrant with *agree,
unsupported* as the headline cell, an audit coverage/staleness map, and
a re-audit queue ("claims you lean on hardest, unaudited or stale").

**Known failure modes to design against** (address each in the note):
rubric theater (mitigations: `pass` on load-bearing checks requires a
note or evidence ref; `n-a`/`blocked` are the cheap honest outcomes; an
always-passing check is surfaced as decorative), false precision (no
numbers in records; fractions with denominators in views), audit rot
(`as-of` hash → visible stale flag; re-audit pre-filled from the prior
one), assessment conflation (separate kind, disjoint vocabulary,
distinct UI verb — "Assess ⚖" vs "Audit 🔍"), and **dangling or
fragmented audits** — the target gets deleted (the reader
cascade-deletes a claim's links and assessment; is cascade right for
an *accumulating* audit trail whose point is re-performance, or do
audits outlive their target?) or republished under a new signing
identity (`claim-ref.js` design rule 1 / `claimPublishedPubkeys` —
coordinate-keyed audit history would fragment across pubkeys, and the
content hash can't detect it because the text didn't change). Say how
audit history follows the claim.

## Mining the prior art (and what to refuse from it)

Both userscript-era docs assume a *network* of strangers and engineer
for adversaries; v1 is **one user auditing their own corpus**. Mine
selectively:

- From `evidentiary-standards.md`: the evidence-type taxonomy
  (primary/secondary/tertiary/supporting with subtypes) is genuinely
  useful **as typed evidence-refs** on checks — flattened to the label
  grammar (`evidence/primary/official-document`), not the 0.95-weight
  scoring apparatus. The claim-evidence matrices' *red-flag lists* are
  good seed material for check vocabularies. **Refuse:** the quality
  formula, time-decay functions, confidence intervals, aggregation
  bonuses — all numeric machinery the no-false-precision rule excludes.
- From `trust-reputation-system.md`: the *framing* that track records
  are computed from validated outcomes (not vibes) survives as the
  source-audit target. **Refuse:** reputation scores, web-of-trust,
  transitive trust, TrustRank, cold-start, anti-Sybil — all of it
  requires the network and is an explicit non-goal; say so in the note.
  (Topic-trust 30053 already covers "whom I trust per topic" as an
  input prior; don't duplicate it.)
- From `NIP-COURT-OF-PUBLIC-OPINION.md`: the **clause pattern** —
  codified criteria with stable ids, severities, versioning, and
  `extends` inheritance, published as an addressable event — is a
  serious candidate for representing audit *methodologies* on the wire
  (a check vocabulary IS a clause list for facts). Mine the structure
  and the facts-vs-behavior split. **Refuse:** trust-graph-weighted
  verdict aggregation (network-era), and don't conflate a grievance
  (someone violated a norm) with an audit finding (a claim's support
  was examined).

## Working agreement — design note only

- Branch `claude/phase-13-audit-design`. Deliverable:
  `docs/EPISTEMIC_AUDIT_DESIGN.md` in the ASSESSMENTS_DESIGN/
  PORTAL_DESIGN house style — decisions-at-a-glance table; the
  audit-vs-assessment firewall; the record's local model AND draft wire
  mapping (kind choice argued, `d` recomputable, dual-read-friendly,
  flag-gated `epistemicAudits` default-off); check vocabularies;
  staleness mechanics; derived views + which portal surfaces they
  extend; the prior-art mine/refuse ledger; non-goals; a slice plan for
  a later Phase 13 implementation run (13.1 model+taxonomy+tests,
  13.2 wire builders+NIP-draft, 13.3 reader audit UI, 13.4 portal
  views, 13.5 publish, or as your design dictates); and **review
  questions** — including, explicitly, "where does this reconstruction
  diverge from your original epistemic-audit framework?"
- **Run a multi-agent adversarial review over the design note itself**
  before opening the PR (lenses: concept coherence — does the
  audit/assessment orthogonality survive every section; repo fidelity —
  every file/kind/convention claim verified against `main`; scope —
  is each element buildable in small slices and is everything
  network-shaped excluded). Fix what's confirmed.
- ROADMAP gains a Phase 13 section (status: design under review) +
  snapshot line. (Housekeeping while you're in there: the §Phase 12
  section *header* still says "(in progress)" — stale; the status
  snapshot at the top is authoritative and says complete. Fix the
  header in passing.) JOURNAL records the second-guessable calls and
  the provenance caveat. Gate the push on `npm run build`, `npm test`,
  `npx --yes web-ext lint --source-dir . --self-hosted` even though
  docs-only. One PR; **stop after opening it** — the maintainer
  reviews in the morning.

## Acceptance (for the design note, not a demo)

A maintainer reading `docs/EPISTEMIC_AUDIT_DESIGN.md` cold can: state
the audit/assessment distinction in one sentence and verify every
section preserves it; see the exact record a claim audit produces
(fields, tags, `d` derivation) and recompute the `d` by hand; see what
the reader and portal would gain, slice by slice; find every numeric-
scoring temptation from the prior art explicitly refused with a reason;
and answer a short list of review questions — concept corrections
first — knowing **nothing has been built yet** that their answers
would invalidate.
