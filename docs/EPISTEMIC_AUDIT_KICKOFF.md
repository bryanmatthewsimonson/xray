# Phase 13 — Epistemic audits: the X-Ray auditor, integrated

**Status:** kickoff brief, 2026-06-11 (rev 3 — rev 2 grounded the
brief in the maintainer's recovered auditor framework, superseding the
rev-1 reconstruction; rev 3 incorporates the three subsequently
recovered sub-READMEs: the per-entity kind map, the calibration
anchors, the integration paths, and derive-don't-ask for the module
findings schemas). This is the prompt for a *new session* to design
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
- `docs/auditor-prototype/prompts/` — the eight surface-scan module
  methodologies (versioned prompts with scoring rubrics and
  structured-JSON output contracts), a single-shot orchestrator, and a
  README whose **calibration notes are load-bearing for display
  design**: a score of 50 is a *meaningfully concerning* article, not
  an average one (competent journalism's expected mean is 70–85);
  confidence below 0.6 means "needs human review"; every finding must
  carry an `evidence_quote` — "this is what makes the audit
  auditable"; methodology changes bump the module version so dossiers
  can show "rescored under v1.2" history.
- `docs/auditor-prototype/schema/` — `audit-types.ts` (the canonical
  data model: content-addressed articles, atomic claims, module
  results, aggregate audits with knowability ceiling, prediction
  ledger + resolutions, dossiers with Bayesian shrinkage, disputes,
  auditor identity, cross-auditor disagreement) plus a README with the
  entity diagram, the per-entity kind suggestions, the NOSTR mapping
  notes (`d`/`e`/`p`/`t` tag schemes), and the design-decisions
  rationale.
- `docs/auditor-prototype/scorer/` — a working Node prototype that
  fans the eight modules out in parallel against the Anthropic API and
  aggregates (weights, ceiling, confidence stacking), plus a README
  with cost notes (cache key = article hash; a cached audit needs no
  recompute until the methodology version changes) and — read this
  twice — a **"Wiring into X-Ray" section laying out two integration
  paths**, each with its trade-offs.

Two referenced artifacts remain unrecovered, both reconstructible:
`schema/relational.sql` (audit-types.ts's header; the schema README
says it can be code-generated from the types — treat as a non-loss)
and the per-module findings JSON schemas in `schema/modules/` (absent,
but both READMEs say they are *derived from the prompt output
specifications* in `prompts/01`–`08` — your design note should derive
them, not ask; note that the scorer's "validates each output" header
AND the schema README's "the scorer prototype validates module
outputs against these schemas before persisting" are both
aspirational — the code only extracts JSON, as the scorer README's
own Limitations section admits). Still genuinely
unrecovered: the original conversation's prose on "governing
principles, dimensions, knowability, calibration multiplier, dispute
mechanics, accessibility tiers" (the main README's final paragraph
points to it). Where THAT would have answered a question, ask the
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

- `CLAUDE.md` — contexts, conventions, the `xray:*` bus (refreshed for
  Phase 12 in PR #59; current as of this brief).
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

1. **Kind remapping (mandatory).** The schema README assigns the six
   entity families precisely — ModuleResult 30050 (×8 modules),
   AggregateAudit 30051, PredictionEntry 30052, PredictionResolution
   30053, DossierSnapshot 30054, AuditDispute 30055 — and itself says
   the numbers "should be claimed via NIP proposal before formal
   publishing." They were chosen before Phases 9a/11 shipped, and
   **every one is now taken inside X-Ray** (30050 annotations, 30051
   fact-checks, 30052 ratings, 30053 topic-trust, 30054 assessments,
   30055 relationships; 30043 is retired-do-not-reuse). Free: 30042,
   30044–30049, 30056+. Map the same six families onto new kinds —
   or argue fewer kinds with `d`-tag discrimination — with
   ASSESSMENTS_DESIGN-grade rationale per choice, `d` recomputable
   from public inputs, dual-read-friendly, flag-gated. Preserve the
   schema README's tag grammar where it fits the house idiom (`d` =
   article hash for module results / subject id for dossiers; `e` to
   predecessors — dispute→audit, resolution→prediction; `p` auditor/
   author pubkeys; `t` beat/publication/module). **And resolve the
   framework's sharpest internal tension head-on:** the schema README
   says "each entity becomes an addressable replaceable event," while
   audit-types.ts mandates "all time-series... nothing overwrites
   prior audits; drift is queryable" — at the same `d`, NIP-01
   replacement would eat the history. Your `d` scheme (run
   discriminator? supersession chains with both visible, as the
   dispute section requires?) must reconcile these, per entity.
2. **Where the model runs.** The scorer is a Node CLI calling the
   Anthropic API; X-Ray the extension currently has no API dependency
   and no key handling. The scorer README's "Wiring into X-Ray"
   section lays out **two integration paths** (presented with
   trade-offs, not as a ruling): (a) the service worker calls a
   **hosted scorer endpoint** (thin wrapper around `scoreArticle`),
   result rendered in the reader — the README says "capture panel,"
   a surface removed with the FAB/in-page panel; the reader is its
   successor — and optionally published as audit events;
   (b) **local-first** — users supply their
   own API key and the scorer logic runs client-side from the
   background worker, no server. Either path yields identical
   `audit-types.ts` shapes downstream. The design note should weigh
   these two (key storage, consent, cost — the README budgets 1–3¢
   per article on Sonnet, and prescribes caching by article hash
   until a methodology version changes; also note a hosted endpoint
   is a new trust dependency for a trust tool), may add a third
   **manual tier** — the module methodologies double as guided human
   checklists in the reader (the unrecovered "accessibility tiers"
   prose may have envisioned this — ask) — and recommend. A
   companion-CLI stopgap (the scorer as-is, emitting signed events
   the portal reads) is compatible with (b) and worth costing as the
   v1 stepping stone. Auditor identity must record which path
   produced each result — the schema supports model/human/pipeline/
   consensus, with constituent auditors on the latter two.
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
   without its ceiling context — and bake in the prompts README's
   calibration anchors: 50 is *concerning*, not average (competent
   journalism's expected mean is 70–85, so any color scale or badge
   must not center on 50), and confidence < 0.6 renders as
   "needs human review," not as a number. Apply it to every UI
   surface, especially the score badge (a surface your note
   *proposes*: the v1 trust-badge UI was removed in Phase 0/10
   reframes, and the auditor README's "metadata badge surface" line
   predates that removal).
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
  builders+NIP draft → capture-time hashing → audit execution path
  per your runs-where recommendation, with stopgap tiers as your
  design dictates → portal surfaces → publish); and
  **review questions** — lead with the runs-where architecture, the
  knowability-ceiling provenance question (who sets it: the auditing
  model, the pipeline heuristic, or a dedicated module — the two
  recovered implementations disagree), and any place the unrecovered
  philosophy prose (calibration multiplier details, accessibility
  tiers) forced a guess.
- **Run a multi-agent adversarial review over the design note itself**
  before opening the PR (lenses: framework fidelity — every deviation
  from `docs/auditor-prototype/` is flagged and justified, none is
  silent; repo fidelity — every file/kind/convention claim verified
  against `main`; scope — small slices, nothing network-shaped,
  design-note-only honored). Fix what's confirmed.
- ROADMAP gains a Phase 13 section (status: design under review) +
  snapshot line. JOURNAL records the second-guessable calls,
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
