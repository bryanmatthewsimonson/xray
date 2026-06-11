# Phase 13 — Epistemic audits: the X-Ray auditor, integrated

**Status:** kickoff brief, 2026-06-11 (rev 2 — now grounded in the
maintainer's recovered auditor framework; supersedes the rev-1
reconstruction). This is the prompt for a *new session* to design
Phase 13. **Design note ONLY this session** — the maintainer has
explicitly scoped this run to producing `docs/EPISTEMIC_AUDIT_DESIGN.md`
for review; **no feature code, no wire builders, no UI** until the
review questions at the bottom of the design note are answered. The
Phase 10/11/12 cadence applies, but this session ends at the design PR.
**Verify everything here against the current `main` first — the repo is
the source of truth and may have moved.**

Repo: `/Users/bryan/Library/CloudStorage/Dropbox/working/xray`
(github.com/bryanmatthewsimonson/xray) — you should already be in it.
This brief lives at `docs/EPISTEMIC_AUDIT_KICKOFF.md` on `main`.

## Provenance — what is authoritative here

The maintainer's epistemic-auditor framework, developed in prior
conversations, is **recovered and vendored in this repo** at
`docs/auditor-prototype/` — read ALL of it before anything else:

- `docs/auditor-prototype/README.md` — the architecture and the design
  rationale, in the maintainer's own words. Authoritative.
- `docs/auditor-prototype/prompts/00`–`08` — the eight surface-scan
  module methodologies (versioned prompts with scoring rubrics and
  structured-JSON output contracts) plus a single-shot orchestrator.
- `docs/auditor-prototype/schema/audit-types.ts` — the full data
  model: content-addressed articles, atomic claims, module results,
  aggregate audits with knowability ceiling, prediction ledger +
  resolutions, author/publication dossiers with Bayesian shrinkage,
  audit disputes, auditor identity, cross-auditor disagreement.
- `docs/auditor-prototype/scorer/` — a working Node prototype that
  fans the eight modules out in parallel against the Anthropic API and
  aggregates (weights, ceiling, confidence stacking).

Three referenced artifacts were NOT recovered: `schema/README.md`
(cited by the README for the per-entity kind suggestions),
`schema/relational.sql` (cited in audit-types.ts's header), and the
per-module findings JSON schemas in `schema/modules/` (cited by
`ModuleResult.findings` — note the scorer's "validates each output"
header is aspirational; the code only extracts JSON). Also unrecovered:
the original conversation's prose on "governing principles, dimensions,
knowability, calibration multiplier, dispute mechanics, accessibility
tiers" (the README's final paragraph points to it). Where any of these
would have answered a question — the module findings schemas bear
directly on your module-result wire shape — put the question to the
maintainer rather than inventing the answer.

An earlier revision of this brief reconstructed the concept from first
principles before the framework was recovered. Where the
reconstruction conflicts with the framework, **the framework wins** —
notably: the framework scores on 0–100 scales with confidence values
and a knowability ceiling (the reconstruction had forbidden numeric
scores), and the auditor is primarily a *model/pipeline* running
versioned prompt methodologies (the reconstruction had designed
human-run checklists). What genuinely converged, keep: the
audit/assessment firewall, evidence-bound findings, content-hash
anchoring against stealth edits, audits accumulating as time-series
rather than replacing, and auditing-the-auditors.

## The framework in one breath

An **outsider with full transparency, modest claims, and a published
method** examines the *published artifact* — it cannot re-report the
story, only audit what was printed. Eight surface-scan modules, each a
self-contained versioned methodology: headline-body fidelity,
asymmetric language, number hygiene (denominator / base rate /
comparison class), source quality, internal coherence, definitional
precision, omission (who got the microphone), and prediction
extraction (not scored at audit time — banked in a ledger and resolved
against reality later; the calibration record is "the long-game
asset"). Module scores (0–100, each with confidence 0.0–1.0) aggregate
under documented weights, capped by a **knowability ceiling** so
careful reporting on hard-to-verify topics isn't penalized. Everything
is content-addressed to the SHA-256 of the normalized article markdown
(outlets stealth-edit; audits must anchor to the exact text scored),
attributed to a first-class **auditor identity** (model+version, human
pubkey, pipeline, or consensus-with-constituents), versioned per
methodology, accumulated as time-series, disputable through a
filed-and-adjudicated challenge pipeline, and rolled up into
**dossiers** over four subject kinds — author, publication, beat, and
publication×beat (a beat is a bare tag, not an entity — your d-tag and
subject design must carry that). Disagreement between auditors is
**published, not averaged**.

Settled with one named exception class: the README's "What's not yet
built (intentionally)" list (persistence, dispute runtime,
multi-auditor consensus, dossier queries, knowability module) is open
by the framework's own admission. The sharpest instance: the two
vendored implementations *disagree on who sets the knowability
ceiling* — `prompts/00` has the auditing model set it ("Set this
thoughtfully"), while `scorer.js`'s `aggregate()` derives it from
source-quality stats with a hand-tuned clamp, and the README calls
that heuristic less defensible than a dedicated module. Your
AggregateAudit wire shape must state who sets the ceiling; put it on
the review-questions list.

The governing principles in `prompts/00` are load-bearing for every
design decision: evidence-bound (every finding quotes exact text),
knowability-aware, symmetric, calibrated, no-reformulation.

**Audits and assessments remain firewall-separated.** A kind-30054
assessment is the user's *judgment of a claim's content*; an audit is
a *methodical examination of the published artifact's craft and
support*. The NIP_DRAFT precedent (30051-vs-30054: "consumers MUST NOT
merge") applies with full force. A user can disagree with a
high-scoring article and agree with a low-scoring one — the framework's
calibration machinery only works if those signals never blend.

## Read next (and verify — don't take this brief's word for it)

- `CLAUDE.md` — contexts, conventions, the `xray:*` bus. **CAUTION:**
  parts are stale (pre-Phase-11): its event-builder kind list still
  shows retired 30043 as live and omits 30054/30055, and its roadmap
  line stops at Phase 9a/v0.5.0. On kinds and phase status, trust
  `docs/ROADMAP.md`, `docs/ASSESSMENTS_DESIGN.md`, and the code.
- `docs/ASSESSMENTS_DESIGN.md` — the Phase 11 design this layer sits
  beside; its "why a new kind" section is the template for your
  kind-number arguments.
- `docs/NIP_DRAFT.md` — wire conventions: `d`-tag recomputability,
  `r` verbatim + `i` normalized, flag-gating, the MUST-NOT-merge
  firewall idiom.
- `docs/PORTAL_DESIGN.md` — Phase 12; the portal is a natural display
  surface for audit results and dossiers.
- `src/shared/event-builder.js` + `src/shared/metadata/builders.js` —
  the `{event, body, dTag}` builder contract; the dormant kind-30051
  fact-check builder (ClaimReview JSON-LD + repeatable `evidence`
  tags) is the closest existing wire shape to a module result.
- `src/shared/html-snapshot.js` — X-Ray already hashes captured
  content (`html_snapshot_sha256` tag on 30023s). The framework
  content-addresses the *normalized markdown* with its own
  normalization (`scorer.js` `normalizeMarkdown`). Two hash
  disciplines, one purpose — the design note must reconcile them into
  one canonical article-hash story.
- `src/shared/claim-ref.js` + `src/shared/assessment-model.js` — the
  local-id/coordinate duality and publish-time backfill; audit records
  that reference claims inherit this machinery.
- `src/shared/metadata/feature-flags.js` — the gating pattern; expect
  a new default-off flag (e.g. `epistemicAuditing`).
- Background prior art (in-history): `git show
  71ee3e2:docs/plans/evidentiary-standards.md`, `...:docs/plans/
  trust-reputation-system.md`, `...:docs/plans/NIP-COURT-OF-PUBLIC-
  OPINION.md`. The first two are userscript-era network designs —
  mine vocabulary, refuse the network machinery. The third (the
  maintainer's own clause/grievance/verdict draft) is structurally
  adjacent to the framework's **AuditDispute** pipeline; note the
  rhyme in the design.

## The integration problems the design note must solve

These are the actual design work. The framework's shape is the
maintainer's settled intent (modulo its own not-yet-built list, above);
its *integration into X-Ray* is not.

1. **Kind remapping (mandatory).** `audit-types.ts` suggests kinds
   30050–30055 — written before Phases 9a/11 shipped, and **every one
   of those numbers is now taken** (30050 annotations, 30051
   fact-checks, 30052 ratings, 30053 topic-trust, 30054 assessments,
   30055 relationships; 30043 is retired-do-not-reuse). Free: 30042,
   30044–30049, 30056+. The note must map the framework's six entity
   families (module result, aggregate audit, prediction entry,
   prediction resolution, dossier snapshot, dispute) onto new kinds —
   or argue fewer kinds with `d`-tag discrimination — with
   ASSESSMENTS_DESIGN-grade rationale per choice, `d` recomputable
   from public inputs, dual-read-friendly, flag-gated. Note which
   entities are addressable (latest-wins is WRONG for audits — the
   schema says "nothing overwrites prior audits; drift is queryable" —
   so argue the addressable-vs-regular choice per entity carefully).
2. **Where the model runs.** The scorer is a Node CLI calling the
   Anthropic API. X-Ray the extension has no API dependency, no API
   keys, and a hard local-first posture. Options to weigh (this is
   the biggest open question — frame it, recommend, and ask):
   (a) companion-tool architecture — the scorer stays outside the
   extension, emits signed NOSTR events the extension/portal then
   reads like any other corpus events; (b) in-extension calls to an
   LLM API behind settings + the flag (key storage, cost, consent);
   (c) a manual tier — the module *methodologies* double as guided
   human checklists run in the reader (the unrecovered "accessibility
   tiers" prose may have envisioned exactly this — ask); (d) hybrid.
   Auditor identity must record which path produced each result —
   the schema already supports model/human/pipeline/consensus, with
   constituent auditors on the latter two.
3. **Article hashing, canonically.** One normalization, specified
   byte-for-byte in the note (the scorer's `normalizeMarkdown` is the
   candidate), its relationship to `html_snapshot_sha256`, and how a
   hash mismatch (stealth edit detected) surfaces in the reader and
   portal. "Capturing both versions is its own diagnostic" — design
   the re-audit affordance.
4. **Predictions as first-class records.** The ledger entry and
   resolution entities have no X-Ray counterpart; claims (30040)
   carry no prediction semantics (claim types were dropped in 10.1 —
   `parseClaimEvent` retains a legacy-render path only). Decide:
   prediction entries as their own kind, with resolution events
   referencing them; how `resolution_horizon` interacts with the
   portal timeline; whether a prediction extracted from an article
   should also atomize into a 30040 claim (probably, with the
   prediction entry referencing the claim coordinate — argue it).
5. **Dossiers vs the portal.** DossierSnapshot overlaps Phase 12's
   read-back surfaces (entity views, reconciliation, timeline). The
   design should make dossiers *derived, reproducible* views over
   published audit events (the schema demands reproducibility), and
   decide what is computed-on-open in the portal vs materialized as a
   published snapshot event — and whether publication/author entities
   reuse X-Ray's entity system (org/person + platform accounts) or
   get their own registry. Strong prior: reuse entities; a
   publication is an org-entity with domains. But note all FOUR
   dossier subject kinds: author, publication, **beat**, and
   **publication×beat** — a beat is a bare topic tag with no entity,
   so the subject/d-tag scheme cannot assume an entity pubkey, and
   beat dossiers must not fall out of the fidelity table.
6. **Disputes.** Map AuditDispute onto X-Ray idioms (and note the
   Court-of-Public-Opinion rhyme). v1 can be wire-format-only
   (define the kind, build nothing) — say so explicitly if so.
7. **Scores, displayed honestly.** X-Ray dropped the claim 0–100
   confidence slider in 10.1 because its semantics were ambiguous —
   it read as *how true* but meant *how central* — and the data was
   noisy (`docs/CLAIMS_REDESIGN.md`, "Why rework"). The framework's
   scores avoid that failure differently: each module score carries
   its own confidence, methodology version, and auditor identity; the
   knowability ceiling lives on the *aggregate*; and cross-auditor
   disagreement is preserved as a sibling record rather than averaged
   away. The design note should make the display rule explicit — a
   score never renders without its confidence, and an aggregate never
   without its ceiling context — and apply it to every UI surface,
   especially the score badge (a surface your note *proposes*: the v1
   trust-badge UI was removed in Phase 0/10 reframes, and the auditor
   README's "metadata badge surface" line predates that removal).
8. **Failure modes** (address each): score theater (a 0–100 number
   invites consumers to ignore the confidence — the display rule
   above is the mitigation; the knowability ceiling is the other
   half); methodology ossification (module prompts are versioned —
   define how a methodology bump invalidates nothing and triggers
   re-audit offers); audit rot (content-addressing solves text drift;
   URL drift and article-takedown need a stated posture); LLM auditor
   variance (same module, same article, different runs — the schema's
   AuditorDisagreement covers cross-auditor spread; state the
   single-auditor run-to-run posture, e.g. publish run metadata and
   treat repeated runs as separate results); dangling audits (article
   deleted locally; audits reference the hash, which outlives the
   capture — fine, but say so); and the social failure mode — a
   published low score is one step from a hit piece; the same
   defenses as rev 1 apply (first-person, dated, evidence-bound,
   method published, disputable), now strengthened by the framework's
   symmetric-standards principle.

## Working agreement — design note only

- Branch `claude/phase-13-audit-design`. Deliverable:
  `docs/EPISTEMIC_AUDIT_DESIGN.md` in the ASSESSMENTS_DESIGN/
  PORTAL_DESIGN house style — decisions-at-a-glance table; the
  firewall section; **fidelity table covering every entity in
  `schema/audit-types.ts`** (framework entity → X-Ray home → deltas,
  justified — including entities that map onto existing kinds and
  ones that become derived views, not just the six new-kind
  families); kind map with rationale; the runs-where decision
  framed with a recommendation; canonical hashing spec; wire shapes
  per entity (tags + `d` derivation, recomputable by hand);
  local-model + ledger pattern per entity (markPublished, staleness);
  portal/reader surface sketches; the mine/refuse ledger over the
  history docs; non-goals (network consensus, multi-auditor
  aggregation beyond disagreement display, adjudication runtime);
  slice plan for a later implementation run (model+tests → wire
  builders+NIP draft → capture-time hashing → companion/manual audit
  path → portal surfaces → publish, or as your design dictates); and
  **review questions** — lead with the runs-where architecture and
  any place the unrecovered philosophy prose (calibration multiplier
  details, accessibility tiers) forced a guess.
- **Run a multi-agent adversarial review over the design note itself**
  before opening the PR (lenses: framework fidelity — every deviation
  from `docs/auditor-prototype/` is flagged and justified, none is
  silent; repo fidelity — every file/kind/convention claim verified
  against `main`; scope — small slices, nothing network-shaped,
  design-note-only honored). Fix what's confirmed.
- ROADMAP gains a Phase 13 section (status: design under review) +
  snapshot line. (Housekeeping: if the §Phase 12 section header still
  says "(in progress)", fix it in passing — the snapshot is
  authoritative.) JOURNAL records the second-guessable calls,
  including the rev-1→rev-2 reversal on numeric scores (the kind of
  thing future readers will second-guess). Gate the push on
  `npm run build`, `npm test`, `npx --yes web-ext lint --source-dir .
  --self-hosted` even though docs-only. One PR; **stop after opening
  it** — the maintainer reviews in the morning.

## Acceptance (for the design note, not a demo)

A maintainer reading `docs/EPISTEMIC_AUDIT_DESIGN.md` cold can: see
their framework's every entity mapped onto X-Ray kinds and conventions
with nothing silently dropped or mutated (a fidelity table:
framework entity → X-Ray home → any deltas, justified); recompute a
module-result `d`-tag and the article hash by hand from the spec;
trace one article end-to-end through capture → hash → eight modules →
aggregate → badge → dossier → dispute, knowing exactly which parts are
v1 slices, which are wire-format-only, and which are non-goals; find
the runs-where question framed with costs and a recommendation rather
than decided by fiat; and answer the review questions knowing nothing
has been built that their answers would invalidate.
