# Epistemic audits — the X-Ray auditor, integrated (Phase 13)

**Status:** design **accepted** (drafted 2026-06-11 from the rev-3
kickoff brief, [`docs/EPISTEMIC_AUDIT_KICKOFF.md`](EPISTEMIC_AUDIT_KICKOFF.md);
every load-bearing repo claim verified against `main` post-PR-#60; an
adversarial review pass — framework fidelity / repo fidelity / scope —
ran over this note before the PR opened). The maintainer answered all
eight review questions on 2026-06-11 — answers and dispositions are
recorded in [the resolutions](#review-questions--resolved-2026-06-11),
threaded through the sections they touch, and implementation proceeds
per the [slice plan](#slice-plan-one-pr-each-claudephase-13-).

The maintainer's epistemic-auditor framework is recovered and vendored
at [`docs/auditor-prototype/`](auditor-prototype/README.md) — eight
versioned surface-scan module prompts, the canonical
[`audit-types.ts`](auditor-prototype/schema/audit-types.ts) data model,
and a working Node scorer. Its governing philosophy, unrecovered when
this note was drafted, is now also recovered and vendored
**normatively** at [`docs/PHILOSOPHY.md`](PHILOSOPHY.md) (v1.0.0) —
the twelve principles (P1–P12), red lines, and decision heuristics
this note cites by number. That framework is settled intent; **this
note designs its integration into X-Ray**: kinds, tags, hashing,
execution path, storage, surfaces, and slices. Where this note deviates
from the framework, the deviation is flagged in the
[fidelity table](#fidelity-table--every-audit-typests-entity) and
justified inline; nothing is silently dropped or mutated.

## Decisions at a glance

| Question | Decision |
| --- | --- |
| Kind map | **Six new kinds `30056`–`30061`** (ModuleResult, AggregateAudit, PredictionEntry, PredictionResolution, DossierSnapshot, AuditDispute). The framework's 30050–30055 are all taken inside X-Ray; 30043 is retired-do-not-reuse; the contiguous free block preserves the framework's one-kind-per-entity-family shape ([rationale](#kind-map)) |
| Time-series vs NIP-01 replacement | Reconciled **per entity**: module results and aggregates get **run-unique `d` schemes** (replacement = idempotent republish of the same run only, never an edit channel — audit history survives); predictions **converge** on a stable text-hash identity; disputes are one-per-(filer, target), amendable until adjudication; resolutions and dossier snapshots are **latest-wins replaceable** because for them replacement *is* the right semantics ([per-entity table](#reconciling-each-entity-becomes-an-addressable-event-with-nothing-overwrites)) |
| Article hash | **SHA-256 of the scorer's `normalizeMarkdown` over the captured body markdown** (metadata header excluded), specified [byte-for-byte](#canonical-article-hash); carried as an **indexed `x` tag** (NIP-94 precedent) on every audit event and added to 30023 at capture time (additive, dual-read-safe) |
| Where the model runs | **Local-first, import-then-sign** (RQ1: confirmed as the keeper architecture, not a stopgap): v1 = companion CLI emits unsigned JSON → the extension **re-validates before signing** (re-hash + schema-check; you never sign what you haven't verified) → flag-gated publish through the existing Signer, producer (auditor tags) and publisher (signing pubkey) kept distinct; v1.x = scorer in the background worker with a user-supplied key under the four RQ7 hardenings; **hosted endpoint refused for v1** (centralizes key custody, creates a capture point — §9) ([framing + recommendation](#where-the-model-runs)) |
| Knowability ceiling | **Resolved (RQ2): record both, heuristic binds.** Pipeline runs: the deterministic source-quality heuristic is canonical and score-binding (`ceiling-source: heuristic:source-quality/1.0`, versioned — the most score-determinative scalar must be the most reproducible, P12); the model's estimate rides advisory `model_estimated_ceiling` in the aggregate content; the accumulated divergence is the dataset that designs the future knowability module. Orchestrator runs keep model-set ceilings (`ceiling-source: model`) — calibration tools, not canonical pipeline audits |
| Auditor identity | Not an event — a **tag vocabulary** (`auditor`, repeatable `auditor-constituent`) on every audit event, covering all four `AuditorKind`s; the signing pubkey stays the accountability anchor |
| Predictions | First-class: 30058 entries (stable text-hash `d`, so re-extraction converges) + 30059 resolutions (one per resolver per prediction). 30040 claim atomization is an **offered action, not automatic** (RQ6 confirmed); on promotion the claim event `a`-references the prediction back, so lineage runs both directions ([argument](#predictions-as-first-class-records)) |
| Dossiers | **Derived, computed-on-open in the portal** over published audit events (the schema's reproducibility demand made primary); 30060 snapshot kind defined for optional sharing/caching, parameters (window, shrinkage k, population mean) on the wire so anyone can re-derive. All four subject kinds covered — **a beat is a bare `t` tag, no entity pubkey assumed** |
| Beats | **Curated, versioned vocabulary, binding for dossiers** (RQ8): `beats-v1` ships in-repo (canonical kebab-case slugs + alias map — vocabulary is methodology, P12); dossier beat subjects MUST be canonical slugs; free-form `t` tags ride events but never mint beats; the dossier builder normalizes via the alias map and surfaces unmapped tags for review; flat for v1 ([spec](#beats--a-curated-versioned-vocabulary-rq8)) |
| Calibration | **Rate table canonical for v1**; **`calibration-v1` specified now, logged, not activated** (RQ4): hedge→implied probability (confident 0.90 / hedged 0.70 / speculative 0.55; negatives invert), Brier-scored per resolved prediction; subject calibration = mean Brier, shrunk per §4; the eventual multiplier `clamp(1 + β·(B_pop − B_subject), 0.85, 1.15)`, β≈0.5, dossier-only, never retroactive (P9), displayed only at ≥10 resolved ([spec](#calibration--the-rate-table-and-calibration-v1-rq4)) |
| Participation tiers | The recovered tier spec (delivered with the RQ3 answer — PHILOSOPHY.md itself carries only §8's weight-follows-track-record mechanic) is five tiers (Read / Flag / Verify / Audit / Adjudicate). v1 ships none as UI but holds the **auditor-kind-agnostic invariant**: human `AuditorIdentity` results flow through the same schemas, kinds, and rollups end-to-end — nothing may assume `model`/`pipeline`. The guided-checklist Audit tier is the **first post-v1 slice** (RQ3) |
| Disputes | Kind 30061 defined, **wire-format-only in v1** — no filing UI, no adjudication runtime (explicit non-goal). Structural rhyme with the maintainer's Court-of-Public-Opinion draft noted |
| Display rule | A score **never renders without its confidence**; an aggregate **never without its ceiling**; confidence < 0.6 renders as **"needs human review"**, not a number; color scales anchor 70–85 as normal — **50 is concerning, not the midpoint**; module version + auditor identity always one tap away; cross-auditor disagreement shown side-by-side, never averaged |
| Feature flag | `epistemicAuditing: false` gates every publish path; local capture/import/render is ungated — the Phase 11 split; audit *execution* additionally requires a user-supplied API key (its own consent gate) |
| Findings schemas | **Derived in this note** from the prompt output specs (per-module contract table + worked example); JSON Schema validators land in slice 13.1 — closing the gap the scorer README's Limitations section admits (the prototype only extracts JSON, it does not validate) |
| Firewall | Audit kinds (30056–30061) and assessments (30054) are **separate aggregation signals; consumers MUST NOT merge** — the 30051-vs-30054 NIP_DRAFT idiom applied with full force ([section](#the-firewall-audits-are-not-assessments)) |
| Philosophy | [`docs/PHILOSOPHY.md`](PHILOSOPHY.md) (v1.0.0) is **normative** — code expresses it; when they conflict, it governs until amended. Principle conflicts are documented tensions citing P-numbers, never silent calls |
| Non-goals (v1) | Hosted scorer endpoint, multi-auditor consensus (beyond disagreement display), adjudication runtime, dedicated knowability module, exposure files, network trust machinery (TrustRank, stakes, auto-sanctions), NIP-09 cleanup |

## The framework in one paragraph (what this note integrates)

An **outsider with full transparency, modest claims, and a published
method** examines the *published artifact* — it cannot re-report the
story, only audit what was printed. Eight surface-scan modules, each a
self-contained versioned methodology with a structured-JSON output
contract: headline-body fidelity, asymmetric language, number hygiene,
source quality, internal coherence, definitional precision, omission,
and prediction extraction (not scored — banked in a ledger and resolved
against reality later). Module scores (0–100, each with confidence
0.0–1.0) aggregate under documented weights, capped by a **knowability
ceiling** so careful reporting on hard topics isn't penalized.
Everything is content-addressed to the SHA-256 of the normalized
article markdown, attributed to a first-class **auditor identity**,
versioned per methodology, accumulated as time-series, disputable, and
rolled up into **dossiers** over four subject kinds (author,
publication, beat, publication×beat). Disagreement between auditors is
**published, not averaged**. The governing principles in
[`prompts/00`](auditor-prototype/prompts/00-orchestrator-single-shot.md)
bind every design decision below: **evidence-bound** (every finding
quotes exact text), **knowability-aware**, **symmetric**,
**calibrated**, **no-reformulation** — codified normatively, with
seven more, in [`docs/PHILOSOPHY.md`](PHILOSOPHY.md) (P3, P6, P5, P7,
P4 respectively).

## The firewall: audits are not assessments

A kind-30054 assessment is the user's *judgment of a claim's content*
("I disagree; this is misleading"). An audit is a *methodical
examination of the published artifact's craft and support* under a
published, versioned methodology. A user can disagree with a
high-scoring article and agree with a low-scoring one — the framework's
calibration machinery only works if those signals never blend.

The NIP_DRAFT precedent (30051 vs 30054: *"They are different
aggregation signals; consumers MUST NOT merge them"*) applies with full
force, and gains a third leg:

- **30051 FactCheck** — a formal verdict on a *claim's truth* against a
  published rating scale (ClaimReview interop).
- **30054 Assessment** — a *personal* stance + issue labels on a claim.
- **30056/30057 audit kinds** — a *methodological* examination of the
  *artifact*, never of the claim's truth. An article asserting
  something false can score well (its craft is sound; its sourcing is
  honest about what it knows); an article asserting something true can
  score badly.

Concretely enforced: audit events never carry `stance`, `rating-value`,
or `L/l xray/assessment` tags; assessment/fact-check events never carry
`score`/`confidence`/`ceiling` tags; the NIP draft sections for the new
kinds each state the MUST-NOT-merge rule; and no UI surface sums,
averages, or color-blends an audit score with assessment stances on the
same content. The portal renders them as separate blocks with separate
provenance.

One more leg, for the one audit kind that *does* carry a truth verdict:
a 30059 resolution's `outcome` judges **whether a specific prediction
resolved against reality** — it is not a fact-check of any claim the
prediction was atomized into. Consumers MUST NOT merge 30059 outcomes
with 30051 ClaimReview verdicts (or 30054 stances) on a linked 30040;
the resolution feeds exactly one consumer, the calibration ledger.

## Fidelity table — every `audit-types.ts` entity

Framework entity → X-Ray home → deltas. **Bold** deltas are deviations
from the vendored framework, each justified; "derived" means computed
from published events rather than published itself (reproducibility per
the schema README).

| Framework entity | X-Ray home | Deltas (justified) |
| --- | --- | --- |
| `Article` | **Existing kind 30023** + capture pipeline | No new kind. The fields (headline/byline/publication_date/word_count/language) already ride 30023 tags; `body_markdown` is the content (after the metadata header). **New additive `x` tag** carries the canonical article hash at capture time (wire change to a shipping kind — additive, dual-read-safe, CHANGELOG/JOURNAL callout). **`subhead` has no 30023 carrier and no extractor support today** — flagged: module 01 needs it as input; the CLI path supplies it via its metadata file, and the future in-extension path runs headline-only until capture grows subhead extraction (deferred, noted in the execution slice). `captured_by`/`capture_method` → the existing `client` tag + capture context; `archive_url` → the existing archive layer. `author_ids`/`publication_id` resolution → the entity system, derived at dossier time, not stored on the article |
| `AtomicClaim` | **Existing kind 30040** | Already shipped. **`ClaimType` (incl. `predictive`) is not representable** — claim types were deliberately dropped in Phase 10.1 (`docs/CLAIMS_REDESIGN.md`); prediction semantics live on 30058 instead, which MAY reference a claim coordinate. `is_contested`/`contested_reason` → the assessment layer (30054 labels), firewall-separated. `source_span` → the existing `anchor` selector tag |
| `ModuleResult` | **New kind 30056** | `findings: Record<string, unknown>` → JSON event content, validated against the [derived per-module schemas](#derived-findings-schemas--the-modules-output-contracts). `id` → the `(kind, pubkey, d)` coordinate. **`d` includes `run_at`** (unique-`d` time series; see reconciliation table). `evidence_quotes[]` — the deduplicated cross-module reference index — rides as a top-level array in the content JSON beside the findings (exactly the `collectEvidenceQuotes` output), not as tags |
| `AggregateAudit` | **New kind 30057** | `module_contributions[].module_result_id` → **`a` coordinates referencing the 30056 events** (one per module, role-marked; durable under idempotent republish), plus optional `e` convenience ids. **`superseded_by` and `disputes[]` are reversed into forward pointers**: a superseding audit `e`-tags its predecessor (`supersedes`), a dispute `a`-tags its target — a signed addressable event cannot be mutated by later actors, so backpointers on the original are unpublishable; consumers derive both by query. `knowability_ceiling` + **new `ceiling-source` tag** records which implementation set it (RQ2 resolved: pipeline runs bind the versioned source-quality heuristic; model-set ceilings are advisory `model_estimated_ceiling` or orchestrator-only) |
| `PredictionEntry` | **New kind 30058** | `resolution_status` / `latest_resolution_id` → **derived client-side from 30059 events** (mutable fields don't fit signed immutable wire records; the local model tracks them). `attributed_to_author_id` → entity `p` tag when the author is a tracked entity, name string otherwise. `source_span` → an optional `anchor` selector tag (the 30040 idiom). `extracted_at` → `created_at`, **with a flagged caveat**: under the convergent `d`, a re-extraction's republish refreshes the timestamp (the original extraction date survives only locally). MAY `a`-reference a 30040 claim ([offered action](#predictions-as-first-class-records)) |
| `PredictionResolution` | **New kind 30059** | `prediction_id` → `a` coordinate + optional `e`. `evidence[]` → repeatable **typed** `evidence` tags carrying all three framework fields (`kind`/`value`/`description` — a flagged *extension* of the dormant 30051 builder's bare-string idiom, which couldn't carry `document_hash` or `quote` evidence). One resolution per (resolver, prediction); the resolver editing replaces — by design (the type's own "latest wins"; **its "unless a dispute is open" exception defers with the adjudication runtime**, flagged) |
| `Author` | **Entity system** (person entity + 32126 platform accounts) | No new kind. `beat_tags` → optional `t` tags on audit events (mirrored from the article's topics — see wire conventions). **`exposures[]` deferred** — no X-Ray home yet (candidate: entity-profile extension; carrying sourced exposure files is its own design problem). `aliases` → the existing alias graph. `primary_publication_id` → derived (dossier-time majority); `notes_url` → kind-0 profile content, not audit wire |
| `Publication` | **Entity system** (organization entity) | No new kind. `domains[]` → derived from captured articles + 32125 relationships. `homepage_url`/`notes_url` → kind-0 profile content. **`exposures[]` deferred** as above |
| `DossierSnapshot` | **Derived portal view** (primary) + **new kind 30060** (optional published snapshot) | The schema demands reproducibility from raw audits — so the *derived view is the canonical form* and the event is a cache. Shrinkage/window parameters ride the wire so third parties re-derive. All four `subject_kind`s carried (beat = bare tag, [no entity pubkey assumed](#dossiers-vs-the-portal)) |
| `AuditDispute` | **New kind 30061**, wire-format-only v1 | `adjudications[]` → **deferred with the adjudication runtime** (different pubkeys can't write into the filer's addressable event; adjudication events are a v2 wire question). `status` on the wire is filer-asserted only (`open`/`withdrawn`); upheld/rejected derive from future adjudication events and superseding audits. `evidence[]` → typed `evidence` tags as on 30059. `resulting_audit_id` → reversed: the new audit `e`-tags the dispute (`resolves-dispute`) |
| `AuditorIdentity` | **Tag vocabulary on every audit event** | Not an event. `auditor` tag (kind + id), repeatable `auditor-constituent` for pipeline/consensus; human auditors additionally get an indexed `["p", <pubkey>, "", "auditor"]` (the schema README's `p` grammar). **Two flagged deltas:** the pipeline-id grammar (`xray-auditor/<semver>/anthropic/<model>`) follows the scorer's practice rather than the type comment's "name + manifest hash" — the hash moves to a dedicated optional `auditor-manifest` tag (SHA-256 of the orchestration config: prompt set + weights + versions), which restores re-auditability without overloading the id; `display_name` is dropped (derivable from the id). The signing pubkey remains the accountability anchor — the tag records what *produced* the result; the signature records who *published* it |
| `AuditorDisagreement` | **Derived portal view** | Never published: it's a comparison over sibling 30056/30057 events for one `x` hash, computed at render time. Publishing it would freeze a live comparison and invite consumers to read it instead of the underlying events |
| `ShrinkageParams` | **Tags on 30060** (`shrinkage-k`, `population-mean`) | Recorded per snapshot for reproducibility, defaults documented (k = 10 per the schema's recommendation) |
| `ClaimType`, `HedgeLevel`, `ModuleName`, `Severity` enums | **NIP-draft vocabulary** | `HedgeLevel`/`ModuleName`/tractability/prediction-type publish verbatim as tag values; `ClaimType` intentionally absent (see AtomicClaim row); `Severity` lives inside findings JSON. The schema README's "bump a top-level schema version" rule → the NIP-draft section version + the per-module `$id` versions (no separate wire field) |

### Reconciling "each entity becomes an addressable event" with "nothing overwrites"

The schema README says every entity is an addressable replaceable
event; `audit-types.ts` mandates "all time-series … nothing overwrites
prior audits; drift is queryable." At the same `d`, NIP-01 replacement
eats history. The reconciliation, per entity:

| Kind | `d` scheme | Replacement means | History |
| --- | --- | --- | --- |
| 30056 ModuleResult | `mod:<sha16(article_hash\|module\|module_version\|run_at)>` | Idempotent republish of the *same run* only | Every run is its own event; re-runs and version bumps accumulate. Default display: latest per (auditor, module, version), history expandable |
| 30057 AggregateAudit | `agg:<sha16(article_hash\|auditor_id\|run_at)>` | Same-run republish only | Supersession = a *new* audit `e`-tagging the old; both visible, per the dispute section of the framework |
| 30058 PredictionEntry | `pred:<sha16(article_hash\|norm(prediction_text))>` | **Re-extraction converges** when the restated text matches — same auditor pubkey, same normalized text, one record | Deliberate, with honest limits: the model restates predictions, so differently-phrased re-extractions mint sibling records (accepted; the portal groups near-duplicates for display), and convergence is per-pubkey (NIP-01 identity). What the scheme actually guarantees: a resolution never *retargets* — its `a` coordinate keeps pointing at exactly the text-identity it resolved. The extraction is enrichment, not judgment — replacement loses nothing the ledger needs |
| 30059 PredictionResolution | `res:<sha16(prediction_coord)>` | The resolver revising their resolution | The type's own "latest wins unless a dispute is open"; different resolvers are different pubkeys, so they coexist |
| 30060 DossierSnapshot | `dossier:<sha16(subject_kind\|subject_id)>` | Refreshing the rollup (latest-wins per **(pubkey, subject)** — two pipeline identities under one signing key overwrite each other; acceptable for a cache) | The snapshot is a cache; the underlying audits are the time series. Old snapshots are re-derivable by anyone from the recorded window + parameters — losing them loses nothing |
| 30061 AuditDispute | `dispute:<sha16(target_coord)>` | The filer amending their dispute pre-adjudication, or withdrawing | One dispute per (filer, target); the filed record is otherwise stable |

`run_at` (ISO-8601, also a tag on the event) makes 30056/30057 `d`s
**verifiable** rather than *predictable*: given the event, anyone
recomputes the `d` from its own tags and checks it matches — the same
property the 30054 `d` has via its `a` tag. This is a flagged deviation
from the schema README's "`d` = article hash for module results" (which
would make every re-run a silent overwrite — exactly what audit-types
forbids).

RQ5 (2026-06-11) confirms the schemes **with a constraint now written
into the draft NIP**. The answer's literal constraint: *"include the
methodology version (e.g., `<article_hash>:<module>:<module_version>`)"*
in every audit-bearing `d`, because relays keep only the latest event
per `(pubkey, kind, d)` — a v2 rescoring that reused a v1 `d` would
make the relay silently drop the v1 audit, a P9 violation by storage
semantics. This note generalizes that to **methodology version and/or
run identity in `d`** — a *flagged relaxation*, standing under the
conflicts-supersede instruction: a run-unique `d` prevents the same
relay-drop (30056 carries version *and* run; 30057 carries run, with
the pipeline's methodology semver embedded in its `auditor_id` input),
and supersession is expressed exclusively through explicit `e`-tag
references, never through relay replacement. 30058 sits deliberately
*outside* the constraint: a prediction entry is extraction —
enrichment, not judgment — whose convergence across re-extractions is
the design goal; its methodology version rides the `module-version`
tag instead of forking the ledger identity per version.
Where the maintainer's answer sketched different schemes — append-only
per-filing `d`s for 30059/30061, a window component in the 30060 `d` —
the table above stands per the same instruction; the tension is
documented in
[the resolutions](#review-questions--resolved-2026-06-11) (P9 vs the
types' own latest-wins semantics), not silently resolved.

## Kind map

The framework assigned 30050–30055. **Every one is now taken inside
X-Ray** (30050 annotations, 30051 fact-checks, 30052 ratings, 30053
topic-trust, 30054 assessments, 30055 claim relationships; 30043 is
retired per Phase 11 with legacy events live on relays — reusing it
would collide with vocabulary a public NIP could never honor). Free in
our draft-NIP block: 30042, 30044–30049, 30056+. Checked against the
live `nostr-protocol/nips` registry 2026-06-11 (RQ5's pre-circulation
requirement): **no upstream assignment or reference touches
30056–30061** — nearest registered neighbors are 30040/30041 (NKBIP
curated publications, the known pre-existing divergence NIP_DRAFT
already flags) and 30063 (release artifact sets). Re-check at draft-NIP
submission. The map:

| Kind | Entity | Why its own kind (the ASSESSMENTS_DESIGN test) |
| --- | --- | --- |
| **30056** | ModuleResult | The highest-volume kind (×8 per audit run). Folding it into 30057 with `d`-discrimination would force every "give me the aggregate" query to fetch and client-filter nine events — NIP-01 filters match kinds and full `d` values, not `d` prefixes, so kind separation is the only relay-side cut. Distinct lifecycle too: a methodology bump recomputes one module, not the audit |
| **30057** | AggregateAudit | The headline record — badge surfaces want exactly one small event per (auditor, article, run): `{kinds:[30057], "#x":[hash]}`. Carries weights, ceiling + `ceiling-source`, confidence stacking |
| **30058** | PredictionEntry | Different identity discipline from everything else (stable text-hash `d`, converging), different lifetime (years), different consumers (ledger/calibration vs badge). Reuses the 30040 claim-id *pattern* without overloading the claim kind, whose semantics deliberately exclude prediction typing (10.1) |
| **30059** | PredictionResolution | References 30058 by `a`; arrives possibly years later, possibly from a different auditor. A kind boundary keeps `{kinds:[30059], authors:[me]}` = "my resolution record" cheap, which dossier calibration recomputes from |
| **30060** | DossierSnapshot | Cache semantics — the one kind whose record is wholly re-derivable from published events, so latest-wins replacement loses nothing; subject-keyed not article-keyed, optional to publish at all. Merging with anything would poison the others' time-series discipline |
| **30061** | AuditDispute | Wire-format-only in v1, and disputes target *any* audit entity (`target-kind` tag). Court-of-Public-Opinion rhyme: the maintainer's clause/grievance/verdict draft maps structurally onto target → filed_by → evidence → (deferred) adjudications → status; the grievance-style evidence list and immutable-filing posture carry over |

Fewer-kinds alternatives examined and rejected: (a) one "audit" kind
with `d`-prefix discrimination — kills relay-side filtering (above) and
forces consumers to parse `d` strings to learn what an event *is*;
(b) reusing 30051 FactCheck for module results — 30051 is
ClaimReview-shaped (a truth verdict on a claim), and an audit module
result is *methodologically forbidden* from being that (no-reformulation,
artifact-not-truth); using it would breach the firewall in the wire
format itself. The 30051 builder's *idioms* are reused instead
(JSON-LD-style structured content, repeatable `evidence` tags on 30059).

All six are flag-gated (`epistemicAuditing`), `d`-recomputable from
public inputs, and listed for the NIP draft's pre-submission registry
check alongside 30054/30055.

## Canonical article hash

One normalization, one hash, specified so a third party can recompute
it by hand from a published 30023.

**Input:** the article's body markdown — for a published event, the
30023 `content` **after stripping the X-Ray metadata header** (the
first `---\n…\n---\n\n?` block, exactly what
`reconstructArticleFromEvent` strips). The header carries an
`**Archived**:` date, which would make the hash capture-time-dependent —
the one thing a content address must never be. For an unpublished local
capture, the input is the same markdown the publish path would emit
(header excluded), so local and published hashes agree.

Two scope rules the byte-for-byte promise depends on:

- **The audited text is the published text, in full.** For video
  captures the publish path appends `## Description` and `## Transcript`
  sections (the transcript re-chunked into ~3-sentence paragraphs by
  `buildArticleEvent`); for non-video transcripts, a fenced block.
  These are **inside** the hash input — the auditor scores what was
  published, and the scorer must be fed the same assembled body. Two
  consequences, stated plainly: slice 13.4 hashes the *assembled
  publish-path content minus header* (not the raw `article.content`),
  and the transcript-chunking code is now part of the content address —
  a future formatting tweak there changes video hashes and surfaces as
  ordinary hash-mismatch ("content changed"), which is truthful if
  blunt; such tweaks get the wire-change treatment.
- **Header fields must not be able to forge the terminator.** The
  header interpolates title/byline/site-name raw; a value containing a
  newline followed by `---` would end the strip early and leak header
  residue (including the Archived date) into a third-party
  recomputation. Slice 13.4 sanitizes newlines out of interpolated
  header fields at build time (a no-op for every real capture seen so
  far, and the in-extension hasher works from the body side regardless).

**Normalization** (the scorer's `normalizeMarkdown`, adopted verbatim
as `normalizeForHash`):

1. Replace every `\r\n` with `\n`.
2. Strip trailing spaces and tabs from every line (`/[ \t]+$/` per line).
3. Collapse every run of 3+ `\n` to exactly 2 (`/\n{3,}/g` → `\n\n`).
4. Strip all trailing whitespace at end of input (`/\s+$/`).

**Hash:** SHA-256 over the UTF-8 bytes of the normalized string,
lowercase hex (64 chars). Implemented once in a new
`src/shared/audit/article-hash.js`, unit-tested against vectors
generated by the vendored `scorer.js` so the extension and the CLI can
never drift.

**Two hash disciplines, one table:**

| | `html_snapshot_sha256` (Phase 8a) | Article hash (`x` tag, Phase 13) |
| --- | --- | --- |
| Input | Sanitized raw-HTML evidence snapshot | Normalized extracted markdown |
| Purpose | "The capture wasn't substituted post-hoc" | "The audit scored exactly this text" |
| Layer | Capture evidence | Audit anchor |
| Survives re-extraction? | No (DOM-dependent) | Yes (extraction-output-dependent only) |

They are complementary, not redundant; both stay.

**Carriage:** every audit event carries `["x", <article_hash>]` — `x`
is single-letter (relay-indexed) with NIP-94 precedent as
"SHA-256 of the thing." `{kinds:[30056,30057,30058], "#x":[hash]}` is
the one-filter "everything auditing this exact text" query. The 30023
gains the same `x` tag at capture time (slice 13.4) — additive; old
events without it still join by `r`/`d`, new consumers prefer `x`.

**Stealth-edit handling:** a re-capture whose hash differs from a prior
audited hash is a detected edit. The reader shows it on the audit panel
("content has changed since this audit — score applies to the previous
version") with a **re-audit affordance** (runs the modules against the
new hash; both audit lineages remain). The portal's article card shows
multi-hash lineage when its `x` values diverge. Honest limitation: X-Ray's
30023 is URL-addressed (`d = sha256(url)[:16]`), so a re-capture
*replaces* the article event on relays — the prior text survives in the
local `xray-archive`, in the audits' evidence quotes, and in the hash
itself, but not as a second relay event. Versioning 30023 identity is a
wire change to a shipping kind we refuse here; "capturing both versions
is its own diagnostic" is satisfied locally, and the note's posture is
recorded in [failure modes](#failure-modes).

## Where the model runs

The scorer is a Node CLI calling the Anthropic API; the extension has
no API dependency and no key handling. The scorer README offers two
paths with trade-offs. Framed, costed, and recommended:

| | (a) Hosted endpoint | (b) Local-first | (b0) Companion CLI (v1 path) | (c) Manual tier |
| --- | --- | --- | --- | --- |
| Key handling | Server-side (operator pays or proxies) | User's key in `chrome.storage.local` | User's key in their shell env | None |
| Trust surface | **A new server between a trust tool and its users** — sees every audited article, could bias results | None beyond Anthropic | None beyond Anthropic | None |
| Cost/article | Operator's (1–3¢ on Sonnet + infra)* | User's 1–3¢* | User's 1–3¢* | Time |
| Latency | One round trip | 8 parallel `fetch`es from the SW | Out-of-band | Out-of-band |
| Engineering | Server + auth + abuse handling | Port `scoreArticle` to SW (no SDK; plain `fetch`) | **~zero** (scorer exists; add import) | Checklist UI |
| Identity recorded | `pipeline` w/ endpoint manifest | `pipeline` w/ constituents `model:anthropic/<model>` | same | `human` (user pubkey) |

\* The 1–3¢ figure is the scorer README's estimate; at current Sonnet
pricing, eight calls each carrying a full prompt + article and emitting
verbose findings JSON plausibly run **~10× that** (tens of cents per
article). Re-cost during the execution slice; the caching prescription
is what keeps either number tolerable.

**Recommendation: (b), staged through (b0), with (a) refused for v1.**
*(RQ1, 2026-06-11: confirmed — and import-then-sign is the keeper
architecture, not a stopgap.)*

- **v1 — companion CLI (b0).** The vendored scorer runs as-is
  (`node scorer.js --input … --output audit.json`). X-Ray gains an
  **Import audit** affordance (reader audit panel + options) that
  ingests the JSON, stores it in the local audit ledger, and —
  flag-gated — publishes the 30056/30057/30058 events **through the
  existing Signer façade**. The CLI never touches NOSTR keys. Signing
  belongs in the extension for three reasons (RQ1): NIP-07 signers are
  browser extensions a CLI cannot invoke at all — "CLI signs directly"
  would force raw nsec export into a second custody surface; the
  signature is the attribution act (§8), and the extension's
  interactive signing flow means nothing publishes under the user's
  identity without an explicit approval moment, where an autonomously
  signing CLI could publish under their key in a loop; and the
  unsigned-JSON intermediate is a *feature* — the human-review
  checkpoint before publicly asserting something (P11). Two
  requirements on the import path, both invariants: **the extension
  re-validates before signing** — it re-hashes the imported
  `body_markdown`, checks the result against the JSON's claimed
  `article_hash` (and — this note's addition, beyond RQ1's letter —
  against the local capture's hash), and schema-validates
  every module payload, because you never sign what you haven't
  verified; and **producer and publisher stay distinct in the
  events** — the `auditor`/`auditor-constituent` tags record the
  pipeline that produced the result (CLI version + model), the signing
  pubkey records the human who published it.
- **v1.x — background-worker execution (b), its own slice pair.** Port
  `scoreArticle`'s loop to the SW: load the eight prompt bodies
  (vendored into the extension), eight parallel `fetch`es to
  `api.anthropic.com` with the user's key. Permission posture, stated
  honestly: the manifest already grants
  `host_permissions: ["<all_urls>"]`, so on Chrome no new permission
  exists to request — **the real consent gates are the API key entry
  and the flag**, and the opt-in UI says so plainly (on Firefox 128+,
  where host permissions are runtime-granted, the request surfaces
  naturally). The `anthropic-dangerous-direct-browser-access: true`
  request header is included for CORS correctness regardless. Key
  custody hardenings (RQ7, all four binding on the slice pair):
  **(a) SW-only access invariant** — the key is read exclusively in
  the background service worker; entry UI hands it to the SW by
  message; it never transits content scripts or page world; a test
  asserts no key read outside the SW. **(b) Host allowlist in code** —
  the key attaches only to requests matching a hardcoded
  `api.anthropic.com` allowlist, independent of what `<all_urls>`
  permits; that is the technical gate, the consent copy is the
  honesty. **(c) Session-only as an option, not the only mode** — a
  "don't persist; re-enter each browser session" toggle backed by
  `chrome.storage.session`; default persistent (session-only as the
  sole mode pushes daily users toward worse workarounds like keys in
  shell history). **(d) Honest at-rest disclosure** — the consent copy
  says plainly "stored unencrypted in extension storage on this
  device"; no obfuscation-at-rest theater (P11 applies to security
  posture too: don't imply custody you don't have). Plus: the key is
  never logged, never leaks into audit events or error reports,
  **never included in entity/keypair export** (same red-line as
  `local_primary_identity`), and the consent copy recommends a
  spend-capped workspace key. Caching: a completed audit is cached by
  `(article_hash, module, module_version)` and never recomputed until
  a methodology version changes — the scorer README's prescription,
  enforced in the model layer. (Sizing: two slices — key custody +
  consent UI, then the runner — staged behind the CLI path, not ridden
  into a v1 slice.)
- **(c) manual tier — the first post-v1 slice (RQ3).** The recovered
  tier spec (delivered with the RQ3 answer; `PHILOSOPHY.md` itself
  carries only §8's weight-follows-track-record mechanic) is five
  participation tiers — **Read**
  (browse, free, no account), **Flag** (one-line reason → triage
  queue), **Verify** (claim one open task, submit an evidence-backed
  finding), **Audit** (full methodology audits, public, attributed),
  **Adjudicate** (resolve auditor disagreement, published reasoning) —
  with the load-bearing mechanic that everyone exercising judgment is
  scored on the same epistemic axes as the journalists (§8). The
  guided-checklist mode (the Audit tier: the module prompts'
  step-numbered Methodology sections as forms; a human-scored 30056
  with `auditor: human:<pubkey>`) is deliberately **post-v1, not v1**:
  the deferral isn't effort — it's that v1's job is calibrating the
  methodology against real articles, and opening a human-audit surface
  before module versions stabilize produces human audits under
  methodology that's about to churn. The **v1 requirement instead is
  the auditor-kind-agnostic invariant**: nothing in the pipeline may
  assume `auditor.kind` is `model` or `pipeline` — human
  `AuditorIdentity` results must flow through the same findings
  schemas, wire kinds, and rollups end-to-end, and slice 13.1/13.2
  tests pin that.
- **(a) hosted endpoint — refused for v1, confirmed (RQ1, §9).** It
  centralizes API-key custody, creates a capture point between a trust
  tool and its users, and concentrates liability — the opposite of
  decentralized publication. A hosted *convenience* tier can exist
  later, but never as the canonical path; if a future phase wants
  zero-setup auditing, the endpoint question reopens with its own
  design note.

Either path yields identical `audit-types.ts` shapes; the
`auditor`/`auditor-constituent` tags record which path produced each
result, so consumers can weight accordingly.

## Wire shapes

Common conventions, all six kinds: addressable; `d` recomputable by
hand from the event's own public tags (formulas below);
`["x", <article_hash>]` where an article anchors the record; the
**Phase-11 URL rule** (the 30054/30055 convention — *not* the 9a kinds,
which normalize both tags): **`r` = the article 30023's primary `r`
verbatim** (its first `r` tag — the article URL; `respondsTo` targets
co-emit additional `r`s) + **`i` = normalized URL, `k` = web** (NIP-73)
— on article-anchored kinds; optional `t` tags mirroring the article's
beat/topic tags (the schema README's `t` grammar; feeds beat dossiers);
`["client", "xray"]`; auditor identity tags:

```jsonc
["auditor", "<model|human|pipeline|consensus>", "<id>"],
// id: "anthropic/claude-sonnet-4-6" | "<64-hex pubkey>" |
//     "xray-auditor/<semver>/anthropic/<model>" | "<consensus name>"
["auditor-constituent", "<kind>", "<id>"],  // 0+; pipeline/consensus only
["auditor-manifest", "<sha256>"],           // optional; pipeline: hash of the
                                            // orchestration config (prompts +
                                            // weights + versions)
["p", "<auditor-pubkey>", "", "auditor"]    // human auditors: indexed, per the
                                            // schema README's p grammar
```

Multi-letter tags (`auditor`, `module-version`, `score`, `confidence`,
`ceiling`, …) are **not relay-indexed**; every standard query below
filters on `#x` / `#a` / `#p` / `#t` / `#e` + `kinds` only, with
everything else client-side — the Phase 11 discipline.

### Kind 30056 — ModuleResult

One per (article, module, methodology version, run). Eight per full
audit run.

```jsonc
{
  "kind": 30056,
  "tags": [
    ["d", "mod:<sha16(article_hash + '|' + module + '|' + module_version + '|' + run_at)>"],
    ["x", "<article_hash>"],
    ["a", "30023:<capturer-pubkey>:<article-d>", "<relay-hint>"],   // optional article pointer
    ["r", "<article-r-verbatim>"],
    ["i", "<normalized-url>"], ["k", "web"],
    ["t", "source_quality"],                       // the module name — indexed
    ["module-version", "1.0"],
    ["run-at", "2026-06-11T20:14:00Z"],
    ["score", "62"],                               // omitted by prediction_extraction
    ["confidence", "0.78"],                        // omitted by prediction_extraction
    ["model-params", "temperature=0"],             // optional run metadata (LLM variance posture)
    ["auditor", "model", "anthropic/claude-sonnet-4-6"],
    ["client", "xray"]
  ],
  "content": "<the module's findings JSON + top-level evidence_quotes[] index, validated against its derived schema>"
}
```

`d` formula: `mod:` + first 16 hex of SHA-256 over
`<x-tag> + '|' + <t-tag module name> + '|' + <module-version> + '|' + <run-at>`
— recomputable by hand from the event's own tags. The `content` JSON is
the module's full output (per the
[contract table](#derived-findings-schemas--the-modules-output-contracts))
plus the deduplicated top-level `evidence_quotes[]` index
(`collectEvidenceQuotes`'s output, kept for cross-module
claim-referencing per `audit-types.ts`) — evidence-bound by
construction.

### Kind 30057 — AggregateAudit

One per (auditor, article, run). The badge-surface record.

```jsonc
{
  "kind": 30057,
  "tags": [
    ["d", "agg:<sha16(article_hash + '|' + auditor_id + '|' + run_at)>"],
    ["x", "<article_hash>"],
    ["a", "30023:<capturer-pubkey>:<article-d>", "<relay-hint>"],
    ["r", "<article-r-verbatim>"],
    ["i", "<normalized-url>"], ["k", "web"],
    ["run-at", "2026-06-11T20:14:05Z"],
    ["score", "80"],                         // final, post-ceiling: min(raw, ceiling)
    ["raw-score", "85.4"],
    ["ceiling", "80"],
    ["ceiling-binding", "true"],             // present only when raw > ceiling
    ["ceiling-source", "heuristic:source-quality/1.0"],
    //  ^ "model" | "heuristic:source-quality/<ver>" | "module:<coordinate>" | "human"
    //    — RQ2 resolved: pipeline runs bind the versioned heuristic (a third
    //    party can recompute it exactly from public module output; they cannot
    //    recompute a model's judgment call — P12). Model-set ceilings publish
    //    as "model" (orchestrator/calibration runs, not canonical pipeline
    //    audits). The model's advisory estimate rides model_estimated_ceiling
    //    in the content JSON; heuristic-vs-model divergence, accumulated, is
    //    the dataset that designs the future dedicated knowability module.
    ["confidence", "0.71"],
    ["a", "30056:<auditor-pubkey>:<mod-d>", "<relay-hint>", "headline_body_fidelity"],  // ×N modules — durable refs
    ["a", "30056:<auditor-pubkey>:<mod-d>", "<relay-hint>", "source_quality"],
    ["e", "<30056-event-id>", "<relay-hint>", "source_quality"],   // optional convenience refs
    ["e", "<prior-30057-event-id>", "", "supersedes"],        // optional
    ["e", "<30061-event-id>", "", "resolves-dispute"],        // optional
    ["auditor", "pipeline", "xray-auditor/0.1.0/anthropic/claude-sonnet-4-6"],
    ["auditor-constituent", "model", "anthropic/claude-sonnet-4-6"],
    ["client", "xray"]
  ],
  "content": "{ \"module_contributions\": [ {\"module\":…, \"score\":…, \"confidence\":…, \"weight\":…, \"ref\":\"<30056 coordinate>\"} ], \"knowability_notes\": \"…\", \"model_estimated_ceiling\": null, \"top_strengths\": […], \"top_concerns\": […] }"
  // model_estimated_ceiling: advisory (RQ2) — populated when a model-run
  // produced a ceiling estimate (e.g. an orchestrator run); never binds.
}
```

`d` formula: `agg:` + first 16 hex of SHA-256 over
`<x-tag> + '|' + <auditor-id> + '|' + <run-at>`, where `<auditor-id>`
is **the `auditor` tag's id element (its third slot)** — recomputable
by hand from the event's own tags, like 30056's.

Module references are **`a` coordinates first** (durable — a 30056
idempotently republished gets a new event id, and an `e` reference
would dangle; the coordinate never does), with `e` ids as optional
convenience for direct fetch. The weights publish inside
`module_contributions` (documented-weights principle: the aggregation
is auditable from the event alone — weighted sum of contributions,
renormalized over present modules, min-confidence × success-fraction,
capped at the ceiling, exactly `scorer.js aggregate()`). Supersession
and dispute resolution are **forward** `e`-tag roles on the *new*
event; the superseded audit is never edited.

### Kind 30058 — PredictionEntry

```jsonc
{
  "kind": 30058,
  "tags": [
    ["d", "pred:<sha16(article_hash + '|' + norm(prediction_text))>"],
    //  norm = trim → collapse whitespace runs to single spaces → toLowerCase()
    //  (the 30040 claim-id discipline, exactly) — so re-extraction of the
    //  same restated text converges on one record
    ["x", "<article_hash>"],
    ["a", "30023:<capturer-pubkey>:<article-d>", "<relay-hint>"],   // optional article pointer
    ["a", "30040:<pubkey>:<claim-d>", "<relay-hint>", "claim"],   // optional — the atomized claim
    ["r", "<article-r-verbatim>"],
    ["i", "<normalized-url>"], ["k", "web"],
    ["prediction-type", "explicit"],     // explicit|implicit|conditional|negative|counterfactual
    ["hedge", "hedged"],                 // confident|hedged|speculative
    ["attribution", "named_source"],     // article_voice|named_source|vague_attribution
    ["attributed-name", "Treasury Secretary Janet Williams"],     // optional
    ["p", "<author-entity-pubkey>", "", "predicts"],              // optional, when tracked
    ["condition", "<antecedent>"],                                 // conditional only
    ["horizon", "by the end of the year"],
    ["horizon-iso", "2026-12-31"],                                 // when computable
    ["tractability", "publicly_resolvable"],
    ["quote", "<exact evidence_quote from the article>"],
    ["anchor", "<selector-json>"],       // optional — source_span as a W3C selector, the 30040 idiom
    ["criteria", "<concrete, observable resolution criteria>"],
    ["module-version", "1.0"],           // of prediction_extraction
    ["auditor", "model", "anthropic/claude-sonnet-4-6"],
    ["client", "xray"]
  ],
  "content": "<prediction_text — the clear, testable statement, nothing else>"
}
```

`d` formula: `pred:` + first 16 hex of SHA-256 over
`<x-tag> + '|' + norm(<content>)`, where `norm` is **exactly the
claim-id discipline** (`claim-model.js`): `trim()`, collapse every
whitespace run to a single space (`/\s+/g → ' '`), then
`toLowerCase()`. The content carries the prediction text *and nothing
else* precisely so the `d` is mechanically recomputable from the event —
resolution criteria ride the `criteria` tag, not the content.

### Kind 30059 — PredictionResolution

```jsonc
{
  "kind": 30059,
  "tags": [
    ["d", "res:<sha16(prediction_coordinate)>"],   // one per (resolver, prediction); edits replace
    ["a", "30058:<extractor-pubkey>:<pred-d>", "<relay-hint>", "prediction"],
    ["e", "<30058-event-id>", "<relay-hint>", "prediction"],   // optional
    ["x", "<article_hash>"],                        // the predicting article
    ["outcome", "false"],                           // true|false|partial|unresolvable
    ["confidence", "0.9"],
    ["resolved-at", "2027-01-15T00:00:00Z"],
    ["evidence", "url", "<url>", "<description>"],            // ×N — TYPED:
    ["evidence", "nostr_event", "<coordinate-or-event-id>", "<description>"],
    ["evidence", "document_hash", "<sha256>", "<description>"],
    ["evidence", "quote", "<verbatim text>", "<description>"],
    //  ^ all four framework evidence kinds carried (kind, value, description) —
    //    a flagged extension of the 30051 builder's bare-string idiom, which
    //    could not express document_hash or quote evidence. nostr_event
    //    evidence SHOULD also get a plain `a`/`e` tag for relay indexing.
    ["auditor", "human", "<resolver-pubkey>"],
    ["p", "<resolver-pubkey>", "", "auditor"],
    ["client", "xray"]
  ],
  "content": "<markdown notes: what happened, why this outcome>"
}
```

`d` formula: `res:` + first 16 hex of SHA-256 over the first `a` tag's
value (the 30058 coordinate, verbatim).

### Kind 30060 — DossierSnapshot

```jsonc
{
  "kind": 30060,
  "tags": [
    ["d", "dossier:<sha16(subject_kind + '|' + subject_id)>"],   // latest-wins per (pubkey, subject)
    ["subject-kind", "publication_x_beat"],   // author|publication|beat|publication_x_beat
    ["p", "<entity-pubkey>"],                 // author/publication(/×beat) subjects only
    ["t", "monetary-policy"],                 // beat(/×beat) subjects only — MUST be a
                                              // canonical beats-v1 slug (RQ8)
    ["window-start", "2026-01-01T00:00:00Z"],
    ["window-end", "2026-06-11T00:00:00Z"],
    ["article-count", "14"],
    ["score-mean", "73.5"], ["score-median", "75"], ["score-stdev", "8.1"],
    ["shrinkage-k", "10"], ["population-mean", "77"], ["shrinkage-factor", "0.42"],
    ["auditor", "pipeline", "xray-auditor/0.1.0/anthropic/claude-sonnet-4-6"],
    ["client", "xray"]
  ],
  "content": "{ \"per_module_means\": {…}, \"predictions\": { \"total\":…, \"resolved\":…, \"calibration\": { \"confident\": {…}, \"hedged\": {…}, \"speculative\": {…} }, \"calibration_v1\": { \"mean_brier\":…, \"resolved_count\":…, \"multiplier\": null } }, \"top_named_sources\": […], \"corrections\": null }"
  // calibration_v1: informational (RQ4) — multiplier stays null until the
  // activation decision; never applied to scores in v1.
}
```

`d` formula: `dossier:` + first 16 hex of SHA-256 over
`<subject-kind tag> + '|' + <subject_id>`. `subject_id` per kind:
author/publication → the entity pubkey (64 hex, the `p` tag);
beat → the canonical `beats-v1` slug (lowercase `t`-tag grammar, the
`t` tag — free-form tags never mint dossier subjects, RQ8);
publication×beat → `<entity-pubkey>|<beat-slug>` (the `p` tag + `|` +
the `t` tag). **Beat and pub×beat dossiers carry no entity `p`
requirement** — the `d` derives from the tag string alone, so beat
dossiers cannot fall out of the scheme.
Known limitation, inherited from Phase 11 verbatim: entity pubkeys are
per-install, so cross-*user* dossier aggregation needs entity-sync'd
keys; the aggregation phase owns this.

### Kind 30061 — AuditDispute (wire-format-only in v1)

```jsonc
{
  "kind": 30061,
  "tags": [
    ["d", "dispute:<sha16(target_coordinate)>"],   // one per (filer, target)
    ["a", "<target coordinate>", "<relay-hint>", "target"],
    ["e", "<target-event-id>", "<relay-hint>", "target"],   // optional
    ["target-kind", "aggregate_audit"],   // module_result|aggregate_audit|prediction_resolution|claim
    ["x", "<article_hash>"],              // when the target anchors to an article
    ["status", "open"],                   // filer-asserted: open|withdrawn
    ["contested", "<finding pointer: the finding's evidence_quote or JSON path>"],   // ×N
    ["evidence", "<kind>", "<value>", "<description>"],   // ×N — typed, as on 30059
    ["auditor", "human", "<filer-pubkey>"],
    ["p", "<filer-pubkey>", "", "auditor"],
    ["client", "xray"]
  ],
  "content": "<markdown dispute_summary>"
}
```

`d` formula: `dispute:` + first 16 hex of SHA-256 over the first `a`
tag's value (the target coordinate, verbatim).

v1 defines this kind in the NIP draft and **builds nothing** — no
filing UI, no adjudication. Adjudication events (the `adjudications[]`
array in `audit-types.ts`) are deferred *with* the runtime: they're
authored by other pubkeys, so they need their own kind or a comment
convention, and that wire question should be settled when the
adjudication design happens, not pre-emptively. The structural rhyme
with the maintainer's Court-of-Public-Opinion draft (Code → Grievance →
Verdict; evidence lists typed `url|event|archive|claim`; immutable
filings; client-side WoT-scoped verdict aggregation; a
narrative-quality multiplier) is noted as the natural template for that
later design — its *vocabulary* mined, its verdict-aggregation
machinery refused along with the rest of the network layer.

## Derived findings schemas — the modules' output contracts

The unrecovered `schema/modules/*.json` files are stated by both
READMEs to be *derived from the prompt output specifications* in
`prompts/01`–`08` — so this note derives them rather than asking. Note
honestly: the scorer's "validates each output" header and the schema
README's "validates module outputs against these schemas" are both
aspirational — `scorer.js` only extracts JSON (its own Limitations
section admits this). Slice 13.1 closes that gap with real validators.

Every module's output shares the invariant envelope, which the prompts
README pins as exactly: `module` (const), `version` (semver), `score`
0–100 + `confidence` 0.0–1.0 (both **absent** on
`prediction_extraction`), `auditor_caveats[]`. Modules 01–07
additionally emit `confidence_notes` per their individual Output
blocks; **module 08 does not** — a validator requiring it there would
reject every conforming scorer output. Per-module payload, from each
prompt's Output block:

| Module | Payload fields (arrays of typed findings) |
| --- | --- |
| 01 `headline_body_fidelity` | `headline`, `subhead`; `headline_implications[]` {id, implication, type: factual\|causal\|evaluative\|predictive, implied_strength: definite\|likely\|hedged}; `body_findings[]` {implication_id, support_status: supported\|partially_supported\|unsupported\|contradicted, evidence_quote, notes}; `structural_issues[]` {type: buried_qualification\|inverted_emphasis\|clickbait_framing\|actor_switching\|modality_drift\|other, description, evidence_quote, severity} |
| 02 `asymmetric_language` | `has_contrast_structure`; `parties_identified[]` {name, role}; `language_applied[]` {party, verbs[], adjectives[], epithets_or_labels[], sourcing_verbs[]}; `asymmetry_findings[]` {dimension: action_verbs\|motivation_attribution\|epithets\|sourcing_verbs\|voice_agency\|quantitative_framing, party_a, party_a_term, party_b, party_b_term, evidence_quote_a, evidence_quote_b, justified_by_underlying_facts, justification_notes, severity} |
| 03 `number_hygiene` | `numerical_claims[]` {id, claim, value, context, denominator_test, base_rate_test, comparison_class_test: passed\|failed\|not_applicable, additional_issues[], evidence_quote, notes}; `summary` {total_claims, claims_failing_at_least_one_test, most_common_failure} |
| 04 `source_quality` | `sources[]` {id, label, type: named_primary\|named_secondary\|anonymous_justified\|anonymous_bare\|document_cited\|study_cited\|expert_says_vague, anonymity_justification, relationship_to_matter, evidence_quote}; `claim_to_source_map[]` {claim, source_ids[], is_contested, contested_reason, evidence_quote}; `single_sourced_contested_claims[]` {claim, source_id, source_type, evidence_quote}; `primary_documents[]` {document, linked_or_quoted, specific_enough_to_retrieve, evidence_quote}; `summary` {total_sources, named_count, anonymous_count, anonymous_justified_count, expert_says_vague_count, documents_cited, documents_specifically_identified} — **the summary block feeds the scorer's ceiling heuristic; its field names are load-bearing** |
| 05 `internal_coherence` | `contradictions[]` {type: factual\|numerical\|causal\|tonal\|modality\|quote_paraphrase\|caption_text\|lead_body, claim_a, claim_b, evidence_quote_a, evidence_quote_b, is_dialectic_intent, severity, notes}; `logical_gaps[]` {description, evidence_quote, severity} |
| 06 `definitional_precision` | `contested_terms[]` {term, occurrences, first_use_quote, defined_in_text, definition_quote, definition_quality: explicit\|contextual\|absent, smuggled_assumption, load_bearing, used_consistently, severity_if_undefined}; `weasel_quantifiers[]` {term, evidence_quote, backed_by_evidence, severity}; `category_laundering[]` {category, evidence_quote, treatment, severity} |
| 07 `omission` | `topic_summary`; `voices_directly_quoted[]` {name_or_role, perspective_summary, quote_density: high\|medium\|low, evidence_quote}; `voices_paraphrased_only[]` {name_or_role, perspective_summary, evidence_quote}; `voices_referenced_but_silent[]` {name_or_role, absence_addressed, absence_explanation}; `natural_stakeholder_set[]`; `voices_expected_but_absent[]` {role, why_expected, absence_addressed, severity}; `speaks_for_instances[]` {speaking_party, spoken_for_party, evidence_quote, severity}; `quotation_balance_notes` |
| 08 `prediction_extraction` | `predictions[]` {id, prediction, type: explicit\|implicit\|conditional\|negative\|counterfactual, hedge_level: confident\|hedged\|speculative, attributed_to: article_voice\|named_source\|vague_attribution, attributed_source_name, condition, resolution_horizon, resolution_criteria, tractability: publicly_resolvable\|requires_private_info\|ambiguous, evidence_quote}; `summary` {total_predictions, explicit_count, implicit_count, confident_count, hedged_count, speculative_count, publicly_resolvable_count}. **No score/confidence** — not a scored dimension |

Worked example — the slice-13.1 JSON Schema for module 03 (the other
seven follow mechanically from the table; enums verbatim from the
prompts):

```jsonc
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "xray-audit/modules/number_hygiene/1.0",
  "type": "object",
  "required": ["module", "version", "numerical_claims", "summary",
               "score", "confidence", "auditor_caveats"],
  "properties": {
    "module":  { "const": "number_hygiene" },
    "version": { "type": "string", "pattern": "^\\d+\\.\\d+(\\.\\d+)?$" },
    "numerical_claims": { "type": "array", "items": { "type": "object",
      "required": ["claim", "value", "denominator_test", "base_rate_test",
                   "comparison_class_test", "evidence_quote"],
      "properties": {
        "id": { "type": "integer" },
        "claim": { "type": "string" }, "value": { "type": "string" },
        "context": { "type": "string" },
        "denominator_test":      { "enum": ["passed", "failed", "not_applicable"] },
        "base_rate_test":        { "enum": ["passed", "failed", "not_applicable"] },
        "comparison_class_test": { "enum": ["passed", "failed", "not_applicable"] },
        "additional_issues": { "type": "array", "items": { "type": "string" } },
        "evidence_quote": { "type": "string", "minLength": 1 },   // evidence-bound: non-empty
        "notes": { "type": "string" }
      } } },
    "summary": { "type": "object",
      "required": ["total_claims", "claims_failing_at_least_one_test"],
      "properties": {
        "total_claims": { "type": "integer", "minimum": 0 },
        "claims_failing_at_least_one_test": { "type": "integer", "minimum": 0 },
        "most_common_failure": { "enum": ["denominator", "base_rate", "comparison_class", "none"] }
      } },
    "score":      { "type": "number", "minimum": 0, "maximum": 100 },
    "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
    "confidence_notes": { "type": "string" },
    "auditor_caveats":  { "type": "array", "items": { "type": "string" } }
  }
}
```

Validation is a hand-rolled walker (the repo takes no schema-library
dependency; the shapes above need only type/enum/required/range
checks), shared between the import path and the future SW execution
path, with house-style `node --test` coverage per module. A module
output that fails validation is stored as a failed run
(`score: null`, caveat recorded) and excluded from aggregation with
weight renormalization — `scorer.js`'s existing failure posture.

## Local model and ledger

The Phase 11 pattern (deterministic local ids, idempotent create,
`markPublished` that doesn't bump `updated`, publish-time `d`
derivation), applied per entity. Storage: a new IndexedDB DB
**`xray-audits`** owned by `src/shared/audit/audit-cache.js` following
`archive-cache.js`'s idempotent-open/upgrade pattern and
`fake-indexeddb` tests — module findings JSON runs tens of KB × 8 per
run, which `chrome.storage.local`'s JSON-serialized single-key maps
should not carry. (Separate DB, same rationale as `xray-portal`:
different lifecycle, no coupled schema bumps. Unlike `xray-portal` this
one is *precious* — audits cost money to recompute — so it's
export-included, not droppable.)

- **AuditRun** — one record per execution: article hash, the eight
  module results, the aggregate, run metadata, `source`
  (`cli-import` | `background` | `manual`). Local id =
  `audit_<sha16(article_hash|auditor_id|run_at)>`. Per-event publish
  ledger: `publishedAt`/`publishedEventId` per built event
  (8× 30056 + 1× 30057 + N× 30058), so a partially-published run
  (relay hiccup mid-batch) resumes rather than duplicating —
  the `markPublished`-doesn't-bump-`updated` rule per event.
- **Prediction** — local mirror keyed by the wire `d` derivation
  (`pred_<sha16(article_hash|norm(text))>` — local and wire identity
  coincide deliberately, unlike assessments, because predictions have
  no pre-publish/post-publish ref duality: the article hash is known at
  extraction). Carries `resolution_status` + `latest_resolution_id` as
  *local derived fields*, recomputed from incoming/own 30059s — the
  audit-types mutable fields, homed where mutation is safe.
- **Resolution** — local record for resolutions *the user authors*
  (`res_<sha16(prediction_coord)>`, matching the wire `d`): outcome,
  typed evidence list, notes, `publishedAt`/`publishedEventId` ledger.
  Authoring surface: a minimal **Resolve…** form on the portal's
  predictions strip (slice 13.7) — without it the long-game asset has
  write-side UI nowhere, and the acceptance walk's resolution step
  would be aspirational.
- **Staleness:** a stored module result is **stale** when the vendored
  prompt's version exceeds the result's `module_version`; the audit
  panel offers "re-audit under v1.1" without invalidating anything
  (methodology-ossification mitigation). A stored run is
  **orphaned** when its article hash no longer matches the current
  capture of that URL (stealth-edit surface). Both are display states,
  never auto-recompute triggers — recompute costs the user money.
- **Publish ordering:** 30056s before the 30057 that references them
  (the `a` coordinates are derivable pre-publish, but the optional `e`
  convenience ids need the events to exist); a 30058 carrying an
  atomized-claim `a` reference publishes **after that claim** — the
  Phase 11 claims-before-assessments rule, inherited verbatim
  (otherwise 30058s are independent); resolutions any time after their
  prediction. Ordering holds **on the wire, not just in the list**: a
  referencer whose referent failed (or never published) this batch
  defers to the next one rather than minting a dangling reference, and
  a promoted 30058 carries the claim's *published* address — never the
  current signing key's. The flag (`epistemicAuditing`) gates every
  publish path; local capture/import/render is ungated — the Phase 11
  split.
- **Resolution identity rule (13.8):** a 30059 whose prediction
  coordinate matches a *local* prediction but was minted under a
  different pubkey is refused at publish — that address will never
  exist (the local prediction publishes under the signing key); re-file
  under the signing identity. A coordinate with **no** local
  counterpart is someone else's published prediction, and resolving it
  is a designed workflow — it publishes verbatim, anchored to the
  *prediction's* article hash (`article_hash` on the resolution
  record, stamped by the Resolve… form).

## Predictions as first-class records

The ledger entry and resolution have no X-Ray counterpart; 30040 claims
deliberately carry no prediction semantics (types dropped in 10.1;
`parseClaimEvent` keeps a legacy-render path only). Decisions:

1. **Own kinds (30058/30059)**, not claim overloads — argued in the
   kind map.
2. **Stable text-hash identity** so the ledger survives re-extraction —
   argued in the reconciliation table.
3. **Claim atomization is an offered action, not automatic.** The case
   for automatic: a prediction *is* an assertion about entities, and
   the entity graph (`#p` queries) is where X-Ray accrues value. The
   case against, which wins: 30040s are the user's curated voice —
   auto-publishing LLM-extracted text as the user's claims blurs
   exactly the provenance line the `suggested_by` machinery exists to
   keep crisp, and most extracted predictions reference no tracked
   entity. So: the audit review UI offers "atomize as claim" per
   prediction (pre-filled, user-confirmed, ordinary claim pipeline with
   `suggested_by: llm:<model>`); the 30058 then carries
   `["a", <claim-coord>, hint, "claim"]`. The prediction needs no claim
   to exist; the claim enriches the entity graph when the user wants it.
   RQ6 confirms (the 30040 space is shared substrate — auto-fanning
   unreviewed model extractions into it under the user's signature
   would pollute the layer and skip the consent gate RQ1 establishes;
   promoting asserts more than extracting, P11, so it deserves a
   deliberate act) **and adds the back-reference**: on promotion the
   claim event carries `["a", "30058:<pubkey>:<pred-d>", hint,
   "prediction"]`, so lineage runs both directions. (An `a` coordinate
   rather than the answer's literal `e`: the claim usually publishes
   *before* the prediction event exists — coordinates are derivable
   pre-publish, event ids aren't; an `e` is added when known. Additive
   optional tag on a shipping kind — wire-change callout in the
   13.6 slice.)
4. **`resolution_horizon` × the portal timeline:** `horizon-iso` is a
   plain tag, so the portal can render a **"predictions coming due"**
   strip (next 30/90 days) on the timeline view and a per-subject
   open-ledger table in dossier views — the long-game asset made
   visible. Predictions with descriptive-only horizons list under
   "unscheduled."
5. **Stealth edits fork the ledger per text version — deliberately.**
   The 30058 `d` includes the article hash, so re-auditing a
   stealth-edited article mints fresh entries even for identically
   restated predictions: each text version's predictions are that
   version's ledger, and resolutions stay anchored to the exact text
   that made the prediction. The portal groups entries across hashes by
   normalized prediction text for display, so the fork is visible, not
   confusing.

## Dossiers vs the portal

Phase 12's portal already owns read-back surfaces. Division of labor:

- **Computed-on-open (canonical):** the portal's entity and case views
  gain an **Audit dossier** block — score distribution (mean/median/
  stdev with shrinkage applied and *shown*: "raw 81 over 3 articles,
  shrunk to 78 toward population mean 77, k=10"), per-module means,
  prediction calibration table (per hedge level: resolved / true /
  rate), open predictions due. Inputs: published 30056–30059 events
  for articles whose author/publication resolves to the focused entity
  (via 30023 `p…author` tags + 32126 accounts + `t` beats), plus the
  local audit ledger for unpublished runs. Reproducible by
  construction — anyone with the events derives the same numbers.
  Confidence rule (added in 13.7): aggregates below the 0.6 review
  threshold are **excluded from the rollup and counted as pending
  review** — a number the display rules refuse to show must not move
  a reputation either.
- **Published 30060 (optional cache):** "Publish dossier snapshot" from
  the dossier block, flag-gated like everything else. Latest-wins per
  subject. Consumers MUST prefer re-derivation when they hold the
  underlying events; the snapshot exists for cheap cross-client display
  and for subjects whose audit corpus the consumer can't fetch.
- **Subjects:** the four kinds per the wire shape above. Author and
  publication reuse the entity system (strong prior honored:
  publication = organization entity; its domains derive from captured
  articles and 32125 relationships). **A beat is a bare `t` tag** —
  beat and publication×beat dossiers key on tag strings, no entity
  pubkey, and appear in the portal behind a beat-picker (the `beats-v1`
  vocabulary with alias-normalized counts from audited articles' `t`
  tags; unmapped tags surface only in the review list and mint nothing —
  RQ8), so they cannot fall out of any entity-keyed code path.

### Beats — a curated, versioned vocabulary (RQ8)

Fragmented beats aren't cosmetic: every spelling split
("monetary-policy" / "monetarypolicy" / "fed") silently shrinks sample
sizes and distorts the §4 shrinkage math on reputation-bearing
rollups. So the beat vocabulary is **methodology, versioned like the
prompts** (P12): **`beats-v1`** ships in-repo (slice 13.1, importable
from the audit model and published verbatim as a JSON artifact)
containing canonical kebab-case slugs plus an alias map. Rules:

- A dossier `subject_id` for beat and publication×beat subjects MUST
  be a canonical slug.
- Free-form `t` tags remain allowed on events but **never mint
  beats** — the dossier builder normalizes via the alias map and
  surfaces unmapped tags in a portal review list rather than creating
  subjects from them.
- Flat, single-level for v1 — hierarchy is a v2 problem.
- Starter vocabulary (24 slugs, maintainer-curated):
  `monetary-policy`, `bitcoin`, `banking`, `fiscal-policy`,
  `free-speech`, `religion`, `media-criticism`, `family-law`,
  `mens-issues`, `immigration`, `drug-policy`, `housing-policy`,
  `civil-asset-forfeiture`, `occupational-licensing`,
  `education-policy`, `courts-legal`, `elections`, `foreign-policy`,
  `national-security`, `tech-policy`, `ai`, `public-health`,
  `crime-justice`, `labor-economics`.
- Seed aliases: `fed`, `federal-reserve`, `m2` → `monetary-policy`;
  `btc` → `bitcoin` (**`crypto` is deliberately not aliased to
  `bitcoin`** — not the same beat); `lds`, `mormon` → `religion`.
- Draft-NIP flag (review-time, not v1): bare `t` slugs collide with
  generic NOSTR hashtags, so the NIP states that beat *semantics* for
  the audit kinds derive from matching `t` values against the
  published vocabulary; a namespaced value is a later consideration.

### Calibration — the rate table and calibration-v1 (RQ4)

There is no lost formula to recover: the original prose specified the
ordering constraints (confident-wrong costs more than hedged-wrong;
confident-right earns more than hedged-right — now P7), never
coefficients. The **per-hedge rate table is sufficient and canonical
for v1** (per hedge level: resolved / true / rate — the dossier block
and 30060 content above).

**`calibration-v1` is specified now so it's ready when the ledger has
volume — logged, not activated.** A proper scoring rule, not an ad-hoc
payoff matrix:

- Map hedge levels to implied probabilities: `confident` → 0.90,
  `hedged` → 0.70, `speculative` → 0.55. Negative predictions invert
  (a confident "X won't happen" → p(X) = 0.10; generally
  p = 1 − p_hedge).
- Score each resolved prediction with Brier: `(p − outcome)²`,
  outcome ∈ {1 = true, 0 = false, 0.5 = partial}; `unresolvable`
  excluded. Lower is better.
- P7's ordering falls out automatically: confident-wrong costs 0.81 vs
  hedged-wrong 0.49; confident-right costs 0.01, beating hedged-right's
  0.09.
- Subject calibration = mean Brier, shrunk per §4 (same k machinery as
  scores).
- The probability mapping is an assumption — published as such (P12).
  Empirically recalibrating it against the corpus later is itself a
  publishable finding (do journalists' "confident" predictions resolve
  true 90% of the time? measuring that gap is a story).
- The eventual multiplier, **when activated** (a future, explicit
  decision — never computed off three resolutions):
  `clamp(1 + β·(B_population − B_subject), 0.85, 1.15)` with β ≈ 0.5,
  applied to **dossier rollups only** — never retroactively mutating
  article vintage scores (P9) — and **displayed only at ≥ ~10 resolved
  predictions**; below that it's noise dressed as judgment.
- v1 carriage: the dossier block and the 30060 content JSON carry an
  informational `calibration_v1` object (`mean_brier`,
  `resolved_count`, `multiplier: null`); the multiplier field stays
  `null` until activation.

## Score display — honest by construction

X-Ray dropped the claim confidence slider in 10.1 because its semantics
were ambiguous and its data noisy. The framework's scores avoid that
failure structurally (per-score confidence, methodology version,
auditor identity, ceiling on the aggregate, disagreement preserved);
the display layer must not re-introduce it. Rules, applied to every
surface:

1. **No naked numbers.** A score renders with its confidence
   (`64 ±conf 0.71`-style pairing, exact treatment per surface); an
   aggregate renders with its ceiling whenever the ceiling binds
   ("64 — capped by knowability 80: relies on anonymous sourcing").
2. **Confidence < 0.6 ⇒ "needs human review"** chip instead of a
   number (the prompts README's threshold, verbatim).
3. **The color scale centers on 70–85, not 50.** 50 is a *meaningfully
   concerning* article. Badge bands are **the framework's own rubric
   bands** (`prompts/00`, repeated in every scoring module), not an
   invented scale: 90–100 exemplary · 75–89 solid · 60–74 acceptable
   with concerns · 40–59 significant problems · 20–39 severe · <20
   catastrophic. A badge label that disagreed with the published
   methodology at the band edges would itself be a calibration bug.
   No green at 50.
4. **Provenance one tap away, always:** module version, auditor
   identity (model/pipeline/human), run date, `ceiling-source`.
5. **Disagreement renders side-by-side** ("scored 67 by A, 84 by B"),
   never averaged — the derived AuditorDisagreement view.
6. **Firewall in the UI:** audit blocks and assessment blocks never
   visually merge, sum, or share a color scale.

**Surfaces** (sketch level; the badge is a *proposed new* surface — the
v1 trust-badge UI was removed in the Phase 0/10 reframes, and the
auditor README's "metadata badge surface" line predates that removal):

- **Reader — audit panel:** post-capture section under the claims bar:
  run/import audit, the aggregate badge per the rules above, eight
  module rows (score, confidence, version, expandable findings with
  their evidence quotes highlighted in the article via the existing
  anchor machinery where quotes resolve), predictions list with
  "atomize as claim" offers, hash-mismatch banner + re-audit
  affordance.
- **Portal — Library/article cards:** audit chip (band color + score +
  confidence) when a 30057 exists for the article's `x`; audit tab in
  the item inspector showing the full aggregate + module results +
  lineage (supersessions, disputes).
- **Portal — entity/case views:** the dossier block (above).
- **Portal — timeline:** predictions-coming-due strip.

## Failure modes

- **Score theater** (a 0–100 number invites ignoring the confidence):
  the no-naked-numbers rule + the <0.6 review chip are the direct
  mitigation; the ceiling display is the other half — a capped score
  *advertises* the limits of surface knowledge. The deeper mitigation
  is the firewall: the score is never presented as "how true," only as
  craft-under-method.
- **Methodology ossification:** module prompts are versioned; a version
  bump invalidates **nothing** (results stay valid under their recorded
  `module-version`); the staleness state offers re-audits; dossiers may
  mix versions and say so (per-module version histograms in the
  derived view). Cache keys include the version, so bumps naturally
  trigger fresh computation without erasing the old.
- **Audit rot:** text drift is solved by content-addressing (`x`).
  URL drift: audits join primarily by hash; `r`/`i` tags are
  convenience joins that may go stale — stated in the NIP draft as
  advisory. Article takedown: audits reference the hash, which
  **outlives the capture** — a 30056 whose article no one can fetch is
  still a valid record of what was scored (the evidence quotes carry
  the proof burden); the portal renders such audits with an
  "article unavailable" state. Dangling is fine, and said so.
- **LLM auditor variance** (same module, same article, different runs):
  single-auditor posture — every run publishes `run-at` + model id +
  `model-params`; repeated runs are **separate results** (unique-`d`
  scheme); default display shows the latest per (auditor, module,
  version) with run history expandable; cross-run spread feeds the same
  derived disagreement view as cross-auditor spread. Consensus
  machinery stays a non-goal.
- **Dangling audits** (article deleted locally): the audit ledger keys
  on hash, not on the archive row — audits survive archive eviction;
  the reader simply can't highlight quotes without the text.
- **The social failure mode** (a published low score is one step from a
  hit piece): defenses, all structural — audits are **first-person**
  (signed by the user's pubkey, presented as "this auditor's method
  found," never as objective truth), **dated**, **evidence-bound**
  (every finding quotes the artifact; a findings JSON with empty
  evidence quotes fails validation), **method-published** (the prompts
  are public and versioned; the aggregation is recomputable from the
  event), **disputable** (30061 exists from day one, even
  wire-format-only), and **symmetric** (the governing principle binds
  the prompts themselves). Plus the quietest defense: publishing is
  default-off behind `epistemicAuditing`, so scores leave the machine
  only deliberately.

## Mine / refuse ledger — the history docs

Per the kickoff: vocabulary mined, network machinery refused. From
`git show 71ee3e2:` …`evidentiary-standards.md`,
`trust-reputation-system.md`, `NIP-COURT-OF-PUBLIC-OPINION.md`:

**Mined (vocabulary and shapes):**

- *Evidence-classification language* (evidentiary-standards): the
  named/anonymous/document/study source taxonomy rhymes with module
  04's classification; the burden-of-proof scale
  (`preponderance / clear-convincing / beyond-reasonable`) is reserved
  vocabulary for the future adjudication design; "chain of custody"
  thinking survives as the capture-evidence layer (`html_snapshot_sha256`)
  + content addressing.
- *Calibration vocabulary* (trust-reputation): domain-scoped
  reputation ("expertise per topic") maps onto beat-scoped dossiers —
  scoped-by-subject, never global.
- *Dispute pipeline shape* (Court-of-Public-Opinion): target →
  filed_by → typed evidence list → adjudications → status is
  structurally the AuditDispute pipeline; the typed evidence refs
  (`url|event|archive|claim`) inform 30061's `evidence`/`a` tags; the
  immutable-filing posture and the narrative-quality idea (substantive
  rationale weighs more than drive-by votes) are noted for the
  adjudication design.

**Refused (network machinery, named so the refusal is auditable):**

- Numeric trust scores between users, trust declarations, decay
  functions, transitive trust / TrustRank propagation, web-of-trust
  depth weighting (trust-reputation §all).
- Stake- or vouch-based weighting; reputation bombing / Sybil
  countermeasures (they presuppose the network layer we're not
  building).
- Evidence base-weights and quality-dimension scoring formulas
  (evidentiary-standards): the framework scores *artifacts under
  published methodology*, not evidence items under a universal weight
  table — adopting the weights would smuggle a parallel scoring system
  past the firewall.
- Verdict aggregation across the network, WoT-scoped or otherwise
  (Court): v1 publishes disputes; nobody tallies them.
- Automatic sanctions/enforcement of any kind.

## Non-goals (v1)

- **Hosted scorer endpoint** — refused above; reopens only with its
  own design note.
- **Multi-auditor consensus** — disagreement is *displayed*, never
  resolved; no consensus events, no `consensus` auditor production
  (the tag vocabulary supports it for future use).
- **Adjudication runtime** — 30061 is wire-format-only; no filing UI,
  no adjudication events, no re-score-on-upheld automation.
- **Dedicated knowability module** — open per the framework's own
  not-yet-built list; the `ceiling-source` tag keeps the wire honest
  meanwhile.
- **Exposure files** (Author/Publication `exposures[]`) — no X-Ray
  home yet; deferred with its own future design question.
- **Network trust machinery** — the refuse list above.
- **NIP-09 cleanup / 30023 versioned identity** — unchanged postures.

## Slice plan (one PR each, `claude/phase-13-*`)

1. **13.1 — Model + hashing + schemas + tests.** `audit/article-hash.js`
   (vectors generated against the vendored scorer), the eight derived
   findings-schema validators (hand-rolled walker, per-module tests),
   `audit-cache.js` (IndexedDB `xray-audits`, fake-indexeddb tests),
   AuditRun/Prediction/Resolution local models with the per-event
   publish ledger, the `beats-v1` vocabulary + alias normalizer (RQ8),
   and the `calibration-v1` math (hedge→probability mapping + Brier,
   logged-not-activated — RQ4). Auditor-kind-parity tests throughout
   (RQ3: human results flow every path a model result does). No UI,
   no wire, no manifest change.
2. **13.2 — Wire, audit core.** `buildModuleResultEvent` (30056) +
   `buildAggregateAuditEvent` (30057) (both `{event, body, dTag}`),
   their parsers (pure, null-on-invalid, round-trip-tested,
   pinned-tag-vocabulary tests), the `epistemicAuditing` flag,
   NIP_DRAFT §30056/§30057 + intro count + Querying + the firewall
   clause + the `d`-scheme constraint (RQ5: methodology version/run
   identity in `d`, supersession by reference only), CHANGELOG/JOURNAL
   callouts. Human-auditor round-trips pinned (RQ3). (Phase 11.2's
   grain was two builders + one parser; six kinds in one PR would
   concentrate the exact review surface the one-concern rule spreads —
   hence the split with 13.3.)
3. **13.3 — Wire, ledger + governance kinds.** `buildPredictionEntryEvent`
   (30058), `buildPredictionResolutionEvent` (30059),
   `buildDossierSnapshotEvent` (30060), `buildAuditDisputeEvent`
   (30061) + parsers + tests, NIP_DRAFT §30058–§30061 (30061 marked
   wire-format-only; the beat-vocabulary clause, RQ8), dossier math
   (shrinkage, rate table, informational `calibration_v1` block —
   RQ4) with beat normalization via `beats-v1`.
4. **13.4 — Capture-time hashing.** The `x` tag on new 30023s (additive
   wire change — its own callout), header-field newline sanitization,
   hash recorded in `xray-archive`, reader hash display, stealth-edit
   detection (hash mismatch banner).
5. **13.5 — Audit execution, v1 path.** CLI-import: an Import-audit
   affordance (reader + options) → **re-validate before signing**
   (re-hash the imported `body_markdown`, check against the JSON's
   claimed `article_hash` *and* the local capture; schema-validate
   every module payload — RQ1's invariant) → store in the audit
   ledger. The vendored scorer is the CLI; a thin `--xray-export` note
   in its README. Subhead: supplied via the CLI metadata file; the
   future in-extension path runs module 01 headline-only until capture
   grows subhead extraction (the fidelity table's Article-row
   deferral).
6. **13.6 — Reader audit panel.** Badge + module rows + display rules
   + prediction list with atomize-offers (the promoted claim carries
   the `a` back-reference to its prediction — additive wire change to
   30040, its own callout; RQ6) + re-audit affordance.
7. **13.7 — Portal surfaces.** Library audit chips, inspector audit
   tab, dossier block (computed-on-open), predictions-due strip +
   the minimal **Resolve…** form, disagreement view.
8. **13.8 — Publish path** (flag-gated): ordered batch (30056s →
   30057; claims before claim-referencing 30058s; resolutions),
   per-event ledger marks, reconciliation coverage in the portal,
   optional 30060 snapshot publish.
9. **13.9 — Hardening.** Adversarial review, SMOKE_TEST §Phase 13,
   docs pass.

*(v1.x, RQ1-confirmed, its own slice pair, not a rider: SW-side
execution — key custody + consent UI under the four RQ7 hardenings
first, the `scoreArticle` runner second. First post-v1 slice after
that, per RQ3: the guided-checklist Audit tier.)*

Every push gates on `npm run build` + `npm test` +
`npx --yes web-ext lint --source-dir . --self-hosted`.

## Acceptance walk (one article, end to end)

Capture an article → 13.4 computes + tags its hash → run the CLI (or,
later, the in-extension scorer) → import: eight 30056-shaped module
results validated against the derived schemas, one 30057 with ceiling +
`ceiling-source`, N 30058 predictions → reader badge renders score with
confidence + ceiling context (or "needs human review") → flag on,
publish: ordered batch lands, portal reconciles it → entity view shows
the author's dossier block (shrinkage shown), timeline shows a
prediction due in December → the portal's Resolve… form files a 30059
that flips the calibration table → a hash-mismatched re-capture shows
the stealth-edit banner with a re-audit offer → a hostile reading of
the published score finds: a dated, signed, first-person,
evidence-quoting, versioned, disputable record — not a verdict. Which
parts are what: 13.1–13.9 are v1 slices; SW-side execution is its own
v1.x slice pair (RQ1-confirmed); 30061 is wire-format-only; consensus,
adjudication, knowability module, hosted endpoint, exposures are
non-goals.

## Review questions — resolved 2026-06-11

The maintainer delivered answers to all eight on 2026-06-11 —
prepared as Claude's recommendations from the original conversation,
endorsed as the maintainer's decisions — alongside the recovered
philosophy prose (now [`docs/PHILOSOPHY.md`](PHILOSOPHY.md),
normative). The standing instruction, verbatim: *"Proceed with
implementation. These are Claude's recommended answers based on the
original conversation. Wherever there are conflicts, your
recommendations from the work you've done on this already will
supercede."* [sic] — applied below with each tension documented, per
the philosophy's own how-to-use rule. The original questions are kept
verbatim (P9: the record of what was asked is part of the answer's
meaning).

1. **Runs-where.** *Asked:* Recommended: local-first staged through the
   companion CLI (import-then-sign, not CLI-signs), hosted endpoint
   refused for v1. Confirm the staging — and confirm that the CLI
   stopgap importing *unsigned JSON* (signing stays in the extension)
   matches your intent, since the kickoff sketched the CLI emitting
   signed events directly.

   **Answer: confirmed — and import-then-sign is better than the
   kickoff sketch, not a stopgap. Keep it.** Signing belongs in the
   extension: NIP-07 signers are browser extensions a CLI cannot
   invoke (CLI-signs would force raw nsec export into a second custody
   surface — strictly worse); the signature is the attribution act
   (§8) and the extension's interactive flow guarantees an explicit
   approval moment before anything publishes under the user's
   identity; and the unsigned-JSON intermediate is itself the
   human-review checkpoint (P11). Two import-path requirements:
   re-validate before signing (re-hash + schema-validate — you never
   sign what you haven't verified), and keep producer (pipeline
   auditor tags) distinct from publisher (signing pubkey). Hosted
   endpoint refused for v1 per §9 — it centralizes key custody,
   creates a capture point, concentrates liability; a hosted
   convenience tier may exist later, never as the canonical path.
   *Disposition:* threaded into
   [Where the model runs](#where-the-model-runs) and slice 13.5; the
   re-validate invariant and the producer/publisher split are named
   slice-13.5 test obligations.
2. **Knowability-ceiling provenance.** *Asked:* Your two
   implementations disagree: `prompts/00` has the auditing model set
   the ceiling ("Set this thoughtfully"); `scorer.js` derives it from
   source-quality stats with a hand-tuned clamp, and your README calls
   that heuristic less defensible than a dedicated module. The wire
   records `ceiling-source` either way. **Which is the v1 default for
   pipeline runs** — the deterministic heuristic (reproducible from
   module 04's summary, our lean), the model-set value (more
   information, less reproducible), or both-with-display-preference?

   **Answer: the lean confirmed, with one addition — record both,
   heuristic binds.** For pipeline runs the deterministic heuristic
   (from module 04's summary) is canonical and score-binding, tagged
   `ceiling-source: heuristic:source-quality/1.0`: the ceiling is the
   single most score-determinative scalar in the aggregate, and the
   most consequential number should be the most reproducible one
   (P12, §11.5 — a third party can recompute the heuristic exactly;
   they cannot recompute a model's judgment call). The model's
   estimate is captured advisorily as `model_estimated_ceiling` in the
   aggregate content; the accumulated heuristic-vs-model divergence is
   precisely the dataset that designs the promised dedicated
   knowability module (when the model consistently says 70 where the
   heuristic says 92 on a beat, that beat needs a rule). The heuristic
   itself is versioned (§8). The single-shot orchestrator keeps
   model-set ceilings — it's a calibration tool, and its runs don't
   publish as canonical pipeline audits; `ceiling-source: model`
   already distinguishes them. *Disposition:* threaded into the 30057
   wire shape and the decisions table; the heuristic version rides the
   `ceiling-source` tag value.

3. **Manual tier / accessibility tiers.** *Asked:* The module prompts
   double as guided human checklists; the unrecovered philosophy prose
   may have specified "accessibility tiers" for exactly this. Should
   the manual tier be a v1 surface (13.6 grows a guided-checklist
   mode), a later slice, or did the original prose intend something
   different?

   **Answer: the original prose specified five participation tiers** —
   Read (browse scoreboards, free, no account), Flag (one-line reason
   → triage queue), Verify (claim a single open task — "does this
   study support this claim?" — submit an evidence-backed finding),
   Audit (full methodology audits, public, attributed), Adjudicate
   (resolve auditor disagreement, published reasoning) — with the load-bearing mechanic that everyone
   exercising judgment is scored on the same epistemic axes as the
   journalists, and weight follows track record (§8). **Decision: the
   guided-checklist mode (the Audit tier) is the first post-v1 slice,
   not v1.** Not for effort reasons (the prompts already are the
   checklists; it's form-ification) — but because v1's job is
   calibrating the methodology against real articles, and opening a
   human-audit surface before module versions stabilize produces
   human audits under methodology that's about to churn. **The v1
   requirement, confirmed now: nothing in the pipeline may assume
   `auditor.kind` is `model` or `pipeline`** — human `AuditorIdentity`
   results must flow through the same ModuleResult schema, wire kinds,
   and rollups end-to-end. *Disposition:* the auditor-kind-agnostic
   invariant is pinned by tests in slices 13.1/13.2; the checklist
   tier is scheduled as the first post-v1 slice; Flag/Verify/
   Adjudicate tiers stay future design space (the Adjudicate tier
   joins the deferred adjudication-runtime question).

4. **Calibration multiplier.** *Asked:* The dossier calibration table
   publishes per-hedge-level resolution rates (confident/hedged/
   speculative × resolved/true/rate) but **no single calibration
   multiplier** — the formula lived in the unrecovered prose (module
   08 alludes to reward shaping: confident-and-wrong worse than
   hedged-and-wrong). Is the rate table sufficient for v1, or do you
   want the multiplier formula reconstructed — and if so, what was it?

   **Answer: there is no lost formula.** The original prose specified
   the ordering constraints (confident-wrong > hedged-wrong in cost;
   confident-right > hedged-right in credit — now P7), never
   coefficients; nothing is "recovered" by inventing one. **The rate
   table is sufficient and canonical for v1.** For readiness,
   `calibration-v1` is specified now — logged, not activated — as a
   proper scoring rule rather than an ad-hoc payoff matrix: hedge
   levels map to implied probabilities (confident 0.90 / hedged 0.70 /
   speculative 0.55; negatives invert), each resolved prediction
   Brier-scores as `(p − outcome)²` (partial = 0.5, unresolvable
   excluded), subject calibration is mean Brier shrunk per §4, and the
   eventual multiplier — when explicitly activated, never computed off
   three resolutions — is `clamp(1 + β·(B_population − B_subject),
   0.85, 1.15)`, β ≈ 0.5, applied to dossier rollups only, never
   retroactively to vintage scores (P9), displayed only at ≥ ~10
   resolved predictions. The probability mapping is a published
   assumption (P12); measuring its empirical gap against the corpus is
   itself a story. *Disposition:* the full spec lives in
   [Calibration](#calibration--the-rate-table-and-calibration-v1-rq4);
   the math lands in slice 13.1 (logged), the informational
   `calibration_v1` block in the 30060 content in slice 13.3;
   activation is a future, explicit decision.
5. **Kind numbers 30056–30061** *Asked:* in our draft-NIP block, with
   the per-entity `d` schemes above — confirm.

   **Answer: conditional confirm.** The block is fine (the maintainer
   floated reusing 30050–30055 if the earlier journalism-audit drafts
   that claimed them were superseded and unpublished — but inside
   X-Ray those numbers are *shipped kinds* with live events, 9a/11
   vintage, so reuse is impossible; 30056–30061 stands). Verify
   against the live NIPs repo before the draft circulates — **done
   2026-06-11, block clean** (see [kind map](#kind-map)). The trap
   named in the answer is now a draft-NIP constraint, in the answer's
   words: every audit-bearing `d` must *"include the methodology
   version"*, so prior-methodology audits persist as distinct
   addressable events, with supersession expressed exclusively through
   explicit reference tags, never relay replacement (P9). 30056
   conforms fully (version + run in `d`); for 30057 this note **flags
   a relaxation** — run identity in `d`, with the methodology semver
   embedded in the `auditor_id` input — since run-uniqueness prevents
   the relay-drop the constraint exists for (standing under the
   conflicts-supersede instruction). 30058 is documented as
   deliberately outside the constraint: extraction converges by
   design; its version rides the `module-version` tag. **Documented tension, resolved by the
   conflicts-supersede instruction:** the answer sketched append-only
   per-filing `d`s for disputes and resolutions and a window component
   in the dossier `d`; this note's schemes stand — 30059/30061
   replacement applies only to a *single author revising their own
   judgment record pre-adjudication* (the framework type's own
   "latest wins" semantics; cross-party history lives in distinct
   pubkeys and coordinates), and the 30060 snapshot is a cache whose
   parameters (window included) ride the wire for re-derivation, so a
   windowed `d` would only multiply cache rows. The P9 cost — a
   resolver's own earlier revision isn't relay-retained — is accepted
   and stated, mitigated by the local ledger keeping authored history.

6. **Prediction → claim atomization** *Asked:* as an offered action
   (never automatic) — confirm.

   **Answer: confirm.** The 30040 claim space is shared substrate
   (crux.immo builds on it), and auto-fanning unreviewed model
   extractions into it under the user's signature pollutes the layer
   and skips the consent gate RQ1 establishes. Offered-action keeps
   the human as publisher-of-record; promoting a ledger entry to a
   first-class claim asserts more than extraction does (P11) and
   deserves a deliberate act. **One addition: on promotion the claim
   event must reference the prediction entry back**, so lineage runs
   both directions. *Disposition:* implemented as an `a` coordinate
   (role `prediction`) rather than the answer's literal `e` — the
   claim usually publishes before the prediction event exists, and
   coordinates are derivable pre-publish (an `e` is added when known);
   see [Predictions](#predictions-as-first-class-records), slice 13.6.

7. **API key custody** *Asked:* (for the SW execution slices): a
   dedicated `chrome.storage.local` key, excluded from every export
   path, with the opt-in UI stating plainly that the manifest's
   existing `<all_urls>` grant already covers the API host (the key +
   flag are the real consent gates) — sufficient, or do you want
   harder custody (e.g. session-only entry)?

   **Answer: sufficient with four hardenings; session-only must not be
   the only mode.** (a) SW-only access invariant — the key is read
   exclusively in the background service worker, never transits
   content scripts or page world, with a test asserting it; (b) a
   hardcoded `api.anthropic.com` host allowlist in code — the real
   technical gate, independent of what `<all_urls>` permits; (c)
   session-only as an *option* (`chrome.storage.session`-backed
   toggle), default persistent — sole-mode session-only pushes daily
   users toward worse workarounds; (d) honest at-rest disclosure
   ("stored unencrypted in extension storage on this device") — no
   obfuscation theater (P11 applies to security posture). Plus: never
   log the key, never let it leak into audit events or error reports,
   and recommend a spend-capped workspace key in the consent copy.
   *Disposition:* binding on the v1.x slice pair; threaded into
   [Where the model runs](#where-the-model-runs).

8. **Beat taxonomy.** *Asked:* Beat dossiers key on bare `t` tags.
   Free-form tags will fragment beats ("monetary-policy" vs
   "monetarypolicy" vs "fed"). Curate a starter beat list (the Author
   type's `beat_tags` example suggests you had one in mind), or accept
   free-form + portal-side merge for v1?

   **Answer: curated vocabulary, binding for dossiers; free-form rides
   along.** Fragmentation silently shrinks sample sizes and distorts
   the §4 shrinkage math on reputation-bearing rollups — so a
   versioned `beats-v1` ships in-repo (vocabulary is methodology,
   P12): canonical kebab-case slugs + an alias map; dossier beat
   subjects MUST be canonical slugs; free-form `t` tags never mint
   beats; the dossier builder normalizes via aliases and routes
   unmapped tags to review; flat for v1. A 24-slug starter list and
   seed aliases are recorded in
   [Beats](#beats--a-curated-versioned-vocabulary-rq8), including the
   deliberate non-alias `crypto` ↛ `bitcoin`. Draft-NIP flag (not
   v1): beat semantics derive from matching `t` values against the
   published vocabulary; namespacing is a later consideration.
   *Disposition:* vocabulary + normalizer in slice 13.1; dossier
   enforcement in 13.3; the NIP clause in 13.3.
