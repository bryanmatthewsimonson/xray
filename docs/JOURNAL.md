# X-Ray — Engineering Journal

Chronological log of significant bugs, fixes, design decisions, and
external changes that shape the architecture. Newer entries first.

**When to add an entry:**

- A bug whose root cause is non-obvious from the commit diff alone.
- A design decision that future-you or a new contributor might
  reasonably second-guess.
- An external change we had to work around (a platform API shift,
  a protocol-level deprecation, a browser API behaviour change).
- A recurring pattern we've noticed that informs ongoing strategy.

**Format:** `## YYYY-MM-DD — short title`, tagged with one of
`bug`, `design`, `external`, `pattern`, or a combination. Keep entries
tight — a paragraph or two of context, a concrete link to the commit
or files, and the "so-what" for future readers.

---

## 2026-06-11 — 13.5: the import gate, and what rejects vs what degrades

**Tags:** design

Slice 13.5 (`audit/import.js` + reader/options affordances). The
calls worth a paper trail:

- **Reject vs degrade is drawn at the badge.** A corrupt file
  (claimed hash ≠ body), a capture mismatch (audit about text the
  user never captured), or a contradictory aggregate (final >
  min(raw, ceiling)) rejects the whole import — those poison the
  badge record. A single module failing schema validation (or a
  scorer-reported `_error`) degrades instead: stored as a failed run,
  score null, the validation errors recorded as a caveat — the
  scorer's own failure posture, because one flaky module shouldn't
  discard seven paid ones. A file where EVERY module fails rejects.
- **The options importer matches against retained prior versions
  too** — an audit of last week's text is still an audit of text the
  user captured; 13.4's `priorVersions` retention is what makes that
  honest.
- **The reader's status line obeys the display rules from day one**:
  no naked numbers (score renders with confidence), and
  confidence < 0.6 renders as "needs human review" — even in this
  pre-panel stub, so 13.6 inherits a surface that never violated the
  rule.
- **`ceiling_source` defaults to `heuristic:source-quality/1.0` on
  import** when the export predates the field — RQ2's canonical
  pipeline source, which is what the vendored scorer actually does.
  A *present-but-invalid* value rejects (the closed RQ2 grammar,
  enforced at the door rather than at publish).
- **The adversarial review confirmed the slice's one real gate
  hole**: the reader passed `state.articleHash || null`, and the
  hash is never computed for read-only portal opens — so on those
  views ANY internally-consistent audit imported ungated while the
  status line simultaneously said "no audit imported." The reader
  now refuses without a capture hash (pointing at the
  archive-matched options importer); the half-checked state was
  worse than either honest extreme. Mutation testing also showed
  module- and prediction-level auditor attribution was unasserted
  (a silent fallback-to-pipeline would have flattened RQ3's
  identity layer into the published events) — now pinned. Review
  process note: seven verifier agents hit the session usage limit
  mid-run; their finder-lens findings (prediction enums unvalidated,
  never-publishable predictions, ceiling_source grammar, the
  vacuous `.every`-on-empty rejection) were adjudicated by direct
  code reading and all fixed — predictions now validate enums +
  publishability at import and skip with counted reasons.

---

## 2026-06-11 — 13.4: the hash reaches the capture pipeline

**Tags:** design

Slice 13.4 puts the canonical article hash on shipping surfaces. The
second-guessable calls:

- **The hash input is the assembled publish-path body, not raw
  `article.content`.** `assembleArticleBody` was extracted from
  `buildArticleEvent` so the capture path (archive record), the
  publish path (the `x` tag), and any future import path hash
  identical bytes. Consequence, stated in the design and now true in
  code: the video transcript-chunking loop is part of the content
  address — a formatting tweak there changes video hashes and gets
  the wire-change treatment.
- **Header fields are newline-flattened, not rejected.** A title
  smuggling `\n---\n` would forge the header terminator and leak the
  Archived date into a third party's hash recomputation. Flattening
  to spaces is a no-op for every real capture seen so far and keeps
  capture unbreakable by hostile page titles. Pinned by a hostile-
  title test asserting the strip invariant byte-for-byte:
  `stripMetadataHeader(event.content) === assembleArticleBody(article)`.
- **Relay reconstructions carry the published hash (`_articleHash`),
  never recompute.** A markdown→HTML→markdown round trip does not
  byte-match the original body; recomputing would mint a divergent
  hash for the same published text.
- **The reader's stealth-edit check is sequenced, not racing.** The
  load path previously fire-and-forgot the archive save; the hash
  comparison must read the PRIOR row, so hash → compare → save now
  run in order inside one async block (still non-blocking for
  render).
- **Dependency note:** `archive-cache.js` now imports
  `event-builder.js` (for the body assembly) — which transitively
  probes `chrome.storage.local` at module load, so archive-cache
  tests gained the event-builder tests' minimal chrome stub.
- **The adversarial review caught the slice contradicting itself —
  8 confirmed findings, one BLOCKING.** The banner told the user
  "your previous capture stays in the archive" while the very next
  line's `saveArticle` overwrote the single per-URL row — destroying
  the only local copy of the text prior audits anchor to,
  milliseconds after promising to keep it (and the design note had
  explicitly committed to local survival, so softening the copy was
  not an option). Fix: **bounded stealth-edit retention** — when a
  re-capture's hash differs, the displaced `{article, articleHash,
  cachedAt, displacedAt}` snapshots onto the row's `priorVersions`
  (cap 3; the row still LRU-evicts as a unit). Also from the review:
  the hash line went stale after "Load archive" (now refreshed from
  the archive's carried hash, or recomputed) and after body edits
  (now flagged "edited, recomputed at publish" — honest display over
  live recomputation against a half-synced draft); republishing a
  relay-loaded archive would have stamped the OLD carried hash into
  the archive row beside a new event whose x tag differs (publish now
  stamps the just-built event's x); a failed hash no longer inherits
  the prior row's (a hash labels THIS body — inheriting mislabels);
  and three mutation-verified test holes (per-call-site header
  sanitization, the legacy fenced-transcript body — the only shape
  that pins the strip regex's laziness — and the hash-failure path).

---

## 2026-06-11 — 13.3: the ledger kinds, and what a resolution must carry

**Tags:** design

Kinds 30058–30061 + `dossier.js` (slice 13.3). The calls worth a
paper trail:

- **30058 content is the prediction text and nothing else.** The
  resolution criteria, horizon, and attribution all ride tags — so
  the convergent `d` (`pred:<sha16(hash|norm(text))>`) is mechanically
  recomputable from the event alone, and a re-extraction converges
  instead of duplicating. Tempting as it was to put a richer JSON in
  the content, every added byte would have broken `d`-recomputability.
- **Resolutions and disputes require evidence at build time.** P3
  applies recursively ("dispute filings, adjudications, and prediction
  resolutions are equally evidence-bound") — so `evidence: []` throws,
  in the builder, before anything could be signed. Likewise 30061's
  `status` enum is just open/withdrawn: upheld/rejected are other
  pubkeys' judgments and structurally cannot be filer-asserted.
- **30060 enforces canonical beat slugs at build time** (RQ8):
  `buildDossierSnapshotEvent` rejects aliases (`fed`) and unmapped
  strings rather than normalizing silently — the caller should have
  normalized deliberately, and a dossier minted from a typo would be
  a permanent subject identity.
- **Dossier math is a pure module** (`dossier.js`): same inputs, same
  rollup, auditor-kind-blind (RQ3 pinned by test). The shrinkage
  factor is returned with every rollup because it must be *published*,
  not just applied (§4).
- **The adversarial review (14 confirmed, 1 refuted-by-mutation)
  earned its keep again.** The bug class from 13.2 recurred in a new
  costume: typed `nostr_event` evidence emits plain `a`/`e` indexing
  tags that are name-indistinguishable from the prediction/target
  *reference* tags — a foreign 30061 with evidence tags serialized
  first parsed the evidence article as the dispute target (reproduced
  live), and the same id-confusion hit `predictionEventId`. Fix: the
  reference `a`/`e` tags are now role-marked (`prediction`/`target`,
  the 30055 house idiom) with evidence-excluding fallbacks for
  foreign events. Also: the parser's attribution fallback to
  `article_voice` would have silently booked a named source's
  prediction against the *author's* dossier — attribution now rejects
  like hedge does; `x` became required on 30059 (the prediction `d`
  is a one-way hash, so an x-less resolution is invisible to article
  queries); the nostr_event evidence value grammar is pinned to raw
  coordinate/event-id (the three sources disagreed: naddr-or-nevent
  vs coordinate-or-event-id vs unvalidated); and zero-article
  dossiers went from allowed-but-unconstructible (articleCount 0
  passed, the null median it implies threw) to explicitly never
  published.

---

## 2026-06-11 — 13.2: the wire core enforces what the design promises

**Tags:** design

Kinds 30056/30057 (`src/shared/audit/builders.js` + NIP_DRAFT
sections). The calls worth a paper trail:

- **Builders validate findings BEFORE building.** `buildModuleResultEvent`
  runs the slice-13.1 schema validator and throws on failure — the
  RQ1 "never sign what you haven't verified" invariant moved as far
  upstream as it can go. A consequence: `score`/`confidence`/`version`
  are read from the validated findings rather than passed separately,
  so the tags can never disagree with the content, and a
  prediction_extraction event structurally cannot carry score tags.
- **The firewall is enforced by construction, not convention** — the
  builders emit a closed tag vocabulary, and tests pin that no audit
  event ever carries `stance`/`rating-value`/`L`/`l`.
- **`ceiling-binding` presence-is-the-signal.** The design note's
  illustrative 30057 example showed the tag alongside a non-binding
  raw/ceiling pair; the builder computes `raw > ceiling` and the NIP
  text says "present ONLY when". The example was illustrative-sloppy;
  the computed rule governs.
- **Parsers demand the auditor block.** A 30056/30057 without a
  parseable `auditor` tag is structurally unusable (null), because an
  unattributed audit defeats the auditing-the-auditors layer — but
  unknown auditor *kinds* are rejected rather than defaulted, same
  posture as outcomes in 13.1.
- **The three-lens adversarial review confirmed 19 findings (0
  refuted), all fixed pre-PR.** The instructive ones: the canonical
  30057 example in both the design note and the NIP draft was
  *internally inconsistent* (score 64.5 / raw 71.2 / ceiling 80 with
  `ceiling-binding: true` — binding requires raw > ceiling), now a
  coherent binding trio and a builder invariant (`finalScore ≤
  min(raw, ceiling)`, ≤ not == since pipeline degradation may lower
  it); parser module detection trusted t-tag ORDER, which NIP-01
  doesn't specify — `findings.module` (const-checked in the envelope)
  is now authoritative with t-disagreement → null; `Date.parse` as an
  "ISO-8601" gate accepts `"Jun 11 2026 (x|y)"` — a pipe-bearing
  runAt would have corrupted the `|`-delimited `d` preimage, now a
  strict regex; and beats reaching indexed `t` tags unvalidated could
  collide with module names and poison the relay-side module filter.
  Mutation testing again earned its keep: nine surviving-mutant test
  holes (zero-score falsy drops, unparsed lineage roles, first-array-
  element-only walker masking) now bite.

---

## 2026-06-11 — 13.1: the hash is parity-not-idempotence, and other slice-one calls

**Tags:** design, pattern

Slice 13.1 (`src/shared/audit/`) landed the model layer. The
second-guessable calls:

- **The canonical normalization is NOT idempotent — pinned, not
  fixed.** Stripping the trailing space in `"\r \n"` manufactures a
  fresh `\r\n` that a second pass would collapse. The vendored
  scorer's algorithm has this property, so ours does too, verbatim:
  the contract is *parity* (extension output ≡ CLI output, enforced by
  extracting `normalizeMarkdown` from the vendored source at test
  time), defined over exactly one pass. "Fixing" idempotence on either
  side is a methodology change that forks every hash.
- **Validator required-ness follows the design note's worked example,
  not the prompts' canonical examples.** Discriminator enums, scoring
  booleans, and every evidence quote are required; descriptive
  enrichments (ids, notes, context) are typed but optional — a benign
  model omission must not turn a paid run into a failed one. The one
  strict block: module 04's seven summary counts (the ceiling
  heuristic reads them by name). Module 08 *forbids* score/confidence
  rather than omitting them — a scored prediction-extraction is
  malformed.
- **`beats-v1` ships as a JS module + JSON artifact with a sync
  test**, not a JSON import — `with { type: 'json' }` needs Node
  ≥20.10 and the engines floor is `>=20`; a two-file-one-test
  arrangement has zero loader risk and keeps the published artifact.
- **The adversarial review (three lenses, all findings
  adversarially verified) caught three real correctness gaps** before
  the PR: IndexedDB writes resolved on request success rather than
  transaction commit (a silent-loss window on a ledger the module
  itself calls precious); `IDBIndex.getAll(undefined)` is an
  unbounded range, so an unguarded missing key would have widened
  "audits for this article" into "the whole ledger"; and resolution
  outcomes were stored unvalidated, where a typo'd outcome silently
  degrades to "open" and vanishes from calibration. Plus the
  humbling one: every "never bumps `updated`" test was tautological
  (second-granularity timestamps) — mutation-verified, now
  sentinel-based.

---

## 2026-06-11 — Phase 13 design accepted: the resolutions, and the recovered constitution

**Tags:** design

The maintainer answered all eight review questions in
`docs/EPISTEMIC_AUDIT_DESIGN.md` (answers + dispositions now recorded
in the note's resolutions section and threaded through its body) and
delivered the originally-unrecovered philosophy prose — vendored
verbatim and **normative** at `docs/PHILOSOPHY.md` (v1.0.0: twelve
principles, red lines, decision heuristics; CLAUDE.md now instructs
consulting it before structural changes). The calls a future reader
will second-guess:

- **The ceiling binds to the heuristic, not the model (RQ2).** The
  knowability ceiling is the single most score-determinative scalar in
  the aggregate, so it goes to the most *reproducible* source: the
  versioned source-quality heuristic a third party can recompute
  exactly (P12). The model's estimate is kept advisorily
  (`model_estimated_ceiling`); the accumulated divergence between the
  two is the design dataset for the eventually-dedicated knowability
  module.
- **Conflicts-supersede, exercised (RQ5).** The maintainer's answer
  sketched append-only `d`s for resolutions/disputes and a windowed
  dossier `d`; per his standing instruction ("your recommendations …
  supercede"), the note's schemes stand — likewise the answer's
  literal version-in-`d` constraint, generalized to
  version-and/or-run-identity with the relaxation explicitly flagged. The P9 tension is documented
  in the resolutions rather than silently resolved — the accepted
  cost (a resolver's own earlier revision isn't relay-retained) is
  stated, with the local ledger as mitigation.
- **`calibration-v1` is specified, not activated (RQ4).** There was no
  lost formula — the original prose fixed only P7's ordering
  constraints. The Brier spec (hedge→probability mapping, clamped
  dossier-only multiplier, ≥10-resolved display gate) is a *new,
  published assumption*, logged from slice 13.1 and applied never,
  until an explicit activation decision at ledger volume. Don't
  "recover" what didn't exist.
- **Beats are curated (RQ8).** Free-form beat tags silently shrink
  dossier sample sizes and corrupt the shrinkage math — vocabulary is
  methodology, so `beats-v1` is versioned in-repo with an alias map
  (`crypto` deliberately ≠ `bitcoin`); free-form `t` tags never mint
  dossier subjects.
- **The kind block stays at 30056–30061 (RQ5).** The answer floated
  reusing 30050–30055 if the old drafts were unpublished — inside
  X-Ray they're *shipped kinds with live events* (9a/11), so reuse is
  impossible. Upstream `nostr-protocol/nips` registry checked
  2026-06-11: nothing touches 30056–30061.

So-what: implementation starts at 13.1 with these as binding
constraints, and PHILOSOPHY.md governs when code and principles
conflict.

---

## 2026-06-11 — Phase 13 design: the calls a future reader will second-guess

**Tags:** design

`docs/EPISTEMIC_AUDIT_DESIGN.md` (design-note-only session; no code).
The decisions most worth a paper trail:

- **Numeric scores are back in — deliberately.** The rev-1 kickoff
  reconstruction had *forbidden* numeric scores (reasoning from the
  10.1 confidence-slider failure). The recovered framework
  (`docs/auditor-prototype/`) scores 0–100 with per-score confidence, a
  knowability ceiling, versioned methodology, and auditor identity —
  the rev-2 brief reversed rev 1 because **the framework wins where
  they conflict**. The design note's display rules (no score without
  confidence, <0.6 renders as "needs human review", bands anchored to
  the framework's own rubric, never centered on 50) are the guardrails
  that made the 10.1 objection answerable rather than ignored.
- **Kind remap 30050→30056 etc.** The framework's suggested kinds
  30050–30055 were chosen before Phases 9a/11 shipped and every one is
  now occupied in-repo. Six new kinds 30056–30061, same one-family-
  per-kind shape. Not a framework deviation of substance — the schema
  README itself says the numbers "should be claimed via NIP proposal."
- **Run-unique `d` tags for module results/aggregates.** The schema
  README said `d` = article hash; `audit-types.ts` mandates
  "nothing overwrites prior audits." At one `d`, NIP-01 replacement
  eats history — so the note resolves the framework's own internal
  tension toward time-series (`d` includes `run_at`, recomputable from
  the event's tags), and documents per-entity where latest-wins *is*
  correct (resolutions, dossier snapshots).
- **Import-then-sign, not CLI-signs.** The kickoff sketched the
  companion-CLI stopgap as "emitting signed events the portal reads."
  The note recommends the CLI emit *unsigned* audit JSON that the
  extension imports, validates, and signs via the existing Signer —
  keeps nsec handling out of Node entirely. Flagged as review
  question 1 rather than decided silently.
- **Hosted scorer endpoint refused for v1.** A server between a trust
  tool and its users is a new trust dependency; local-first (user's
  API key) staged through the CLI stopgap instead.
- **Adversarial review before the PR** (three lenses: framework
  fidelity / repo fidelity / scope): 1 high + ~8 medium confirmed
  findings, all fixed — the high was hand-recomputability gaps in the
  30057/30058 `d` formulas (fixed by pinning `auditor_id` to the
  `auditor` tag's id slot and moving prediction resolution-criteria
  out of `content` into a `criteria` tag); the most consequential
  mediums: typed evidence (`kind`/`value`/`description`) restored on
  30059/30061, badge bands realigned to the framework's published
  rubric instead of invented breaks, the opt-in host-permission story
  corrected (manifest already grants `<all_urls>` — the API key + flag
  are the real consent gates), and video transcript formatting named
  as part of the canonical hash input.

---

## 2026-06-11 — Phase 12.7: what the adversarial review caught (two relay-sync bugs + a read-only breach)

**Tags:** bug, design, pattern

A three-lens review (correctness / integration / design-fidelity, every
finding probe-verified; 20 confirmed, 1 refuted) over the six portal
slices. The load-bearing fixes, recorded because each encodes a
contract a future reader could re-break:

- **A dead relay is indistinguishable from an empty one** on the
  `xray:relay:query` wire: `queryRelays` deliberately marks a failed
  connect as EOSE so one bad relay can't block the pool (a Phase 5
  choice), which means it answers `{ok:true, events:[]}` for an
  unreachable relay. The portal's sync-cursor guard and "failed:"
  status keyed off `ok` and so were dead code — an *offline* Refresh
  advanced the cursor and silently ate the window. Fix: the connect
  catch now also stamps `failed:true` + `error` on the per-relay stat
  (additive; existing consumers unaffected) and the portal honors it.
- **NIP-01 `until` is inclusive, and paging with `until = oldest − 1`
  drops same-second siblings** whenever a relay's silent response cap
  lands inside a same-second run — which is the *normal* shape of an
  X-Ray corpus, since claims/comments bulk-publish in one pass. Fix:
  page with `until = oldest` and terminate on "this page brought
  nothing this relay hasn't already served" — per-relay, not global,
  because relays page concurrently and one relay's coverage must not
  truncate another's backfill. Residual (documented): a single
  same-second run longer than the relay's own cap.
- **The sync cursor now carries fingerprints of the author + relay
  sets** and only advances on a clean pass (no failures, no
  truncation): a newly pasted npub or newly added relay needs its full
  history, not the last hour.
- **"Open in reader" was a read-only breach**: the reader
  unconditionally archive-caches on load, which would have overwritten
  the local row's `publishedToRelay` marker with a relay
  reconstruction. The stash record now carries `readOnly: true` and
  the reader skips the cache save for it.
- **Reconcile read link endpoints from fields that don't exist**
  (`source`/`target` vs the real `source_claim_id`/`target_claim_id`)
  — its test had seeded the same fiction and passed. The test now pins
  the real field names, plus `publishedKind: 30055` (the
  30043-retirement migration clears publish markers without it). Same
  class of bug for articles: the archive's `urlHash` hashes the
  *normalized* URL but the wire 30023 `d` hashes the *raw* URL, so the
  address tier never fired; reconcile recomputes from `rec.url`.
- Smaller, same pattern of "the design said so": one ms-precision
  `created_at` could explode the timeline into ~3M buckets (sane-window
  filter + bucket ceiling); sourced-claim nodes now get assessment
  decoration like about-claims; case-dashboard rows are inspectable;
  the Library gained its designed status facet, "show more" pagination,
  the local-only count + no-ledger legend; the portal is linked from
  the options/side-panel headers; a failed IndexedDB open un-memoizes
  and the portal degrades to live-only instead of bricking.

---

## 2026-06-10 — Phase 12 design: the "My Archive" portal (for review before code)

**Tags:** design

**Decision:** Phase 12 adds a read-back surface — a full-tab portal page
(`src/portal/`) that queries the user's published corpus off the
configured relays via the existing `xray:relay:query` path, renders it as
Library / Timeline / entity spokes graph / case dashboard / inspector,
and reconciles relay truth against the local published ledger. Read-only;
no new kinds, no builder changes. Full design (for maintainer review
before any feature code): `docs/PORTAL_DESIGN.md`.

Second-guessable calls, on the record:

- **"Me" is a resolved *set*, not one pubkey.** The portal runs outside
  any capture context, so the reader's `xray:capture:getPubkey` →
  source-tab path is unavailable, and NIP-07 cannot answer from an
  extension page at all. The resolver unions `Signer.getPublicKey()`
  (Local/NSecBunker), the reserved `xray:user` sync key, the append-only
  `publishedPubkeys` claim history, and manual npubs — each chip carries
  its provenance. No NIP-07 tab-routing in v1.
- **Two new read-side parsers, placed by precedent:**
  `parseCommentEvent` (30041) goes in `event-builder.js` beside its
  builder and the two existing reconstructors; `parseAssessmentEvent`
  (30054) goes in `assessment-model.js`, mirroring `parseRelationshipEvent`
  living in `evidence-linker.js`. Round-trip-tested against the builders
  with pinned tag vocabularies.
- **Hand-rolled radial SVG ego graph, no dependency.** A force-layout
  package buys nothing for a one-hop spokes view that is better
  deterministic (stable layouts, no physics tuning), and the repo's
  no-deps posture + Firefox 128 floor both favor plain SVG. The full
  free-floating graph is deferred; if it ever needs force layout, that
  slice re-opens the question.
- **A separate IndexedDB (`xray-portal`), not an `xray-archive` v3
  bump.** The portal cache is derived data — droppable and rebuildable
  from relays — while the archive holds precious captures; coupling
  their schema versions and eviction stories buys nothing.
- **Reconciliation is display-only.** The portal never writes
  `markPublished` or imports remote-only events into local models — a
  read surface must not be able to corrupt publish-side invariants.
  Comments/accounts/32125 have no publish ledger (verified), so they
  can only be present/remote-only, never "missing"; accepted for v1.
- **Other clients' events are badged, not filtered.** An
  `authors`+`kinds` query inevitably returns e.g. a Habla 30023 or a
  Damus 10002 by the same pubkey; hiding them would make the
  reconciliation counts lie, so they render with an "other client"
  badge keyed off the `client` tag.

---

## 2026-06-10 — Phase 11.7/11.8 review fixes (one security bug, two wire bugs)

**Tags:** bug, wire-format, security

A three-lens adversarial review of the publishing + collaboration
slices surfaced eleven findings; the load-bearing ones, fixed here:

- **SECURITY (bundle):** import trusted the bundle's `keyName`, so a
  crafted bundle could bind an entity record to the reserved
  `xray:user` primary-identity slot — exfiltrating the user's primary
  key on a later re-share, or planting an attacker key as their
  identity. `keyName` is now ALWAYS derived from the entity id (in both
  `case-bundle.importCaseBundle` and `EntityModel.importRecord`); the
  bundle's own field is ignored. Regression-tested both vectors.
- **WIRE (verbatim `r`):** foreign-claim judgments emitted the
  *normalized* URL as `r`, forking the `#r` join the design makes
  load-bearing (claims publish raw `r`). The models now snapshot
  `url_raw` (verbatim) alongside the normalized `url`; `claimWireInfo`
  emits the raw form as `r`, normalized as `i`.
- **WIRE (1985 mirror):** the mirror carried `['p', claimAuthor]`,
  which under NIP-32 labels the *author* with the issue labels — a
  reputational mislabel. Dropped the `p`; the mirror now carries
  `L`/`l` + `a` + verbatim `r` only.
- **Mirror loss:** mirror emission was keyed to the assessment's
  publish state, so a mirror rejected (while its 30054 landed) was
  never retried. Now keyed to a separate `mirroredAt`; `selectMirrors`
  picks up any labeled, wire-ready, un-mirrored assessment and the
  reader marks it only on mirror relay-success.
- **30043→30055 republish:** the design promised legacy links
  republish as 30055, but their 30043-era `publishedAt` suppressed
  them forever. `normalizeLink` now clears a publish marker lacking
  `publishedKind` (one-time read-time migration); `markPublished`
  stamps `publishedKind: 30055` going forward.
- Plus: foreign 30054s now mirror the assessed claim's about-entity
  `p` tags (single-`#p` surfacing); pre-pubkey own claims with a
  pending judgment get re-emitted to backfill their coordinate;
  "Erase all" clears `xray:flags`; published assessments show 🌐;
  malformed bundle keys bucket separately from genuine conflicts;
  unknown entity types are rejected before key install; trailing
  inter-event sleeps guarded.

---

## 2026-06-10 — Phase 11.8: collaboration = shared entity keys, by bundle

**Tags:** design

Cross-user aggregation was the design note's first known limitation:
entity keypairs are random per install, so two users' "claims about P"
never meet. The fix is deliberately low-tech — a **case bundle** file
(case entity + every entity its claims reference, WITH private keys)
that a collaborator imports.

Decisions worth remembering:

- **Bundle import preserves the exporter's entity ids** via the new
  `EntityModel.importRecord` (upsert-as-given). `create()` re-derives
  ids from (type, name), which breaks after renames — and the id is
  what `keyName` and claim `about` refs point at. Discovered en route:
  the panel's legacy array-import path creates entities with FRESH
  keypairs, so it never enabled aggregation; it remains for name-set
  sharing, bundles are the collaboration path.
- **Key conflicts are terminal, not merged:** `LocalKeyManager.importKey`
  is idempotent for the same key and throws for a different one — we
  never overwrite key material. The same case independently created on
  two installs (deterministic ids collide on purpose) reports a
  conflict; claims published under the two keys won't merge, pick one
  side's bundle and re-tag.
- **Security posture:** the bundle is plaintext keys, same as the
  keypair-registry export precedent. The UI says "share it like a
  password" twice. Encrypting to a collaborator's npub (NIP-44) is the
  obvious upgrade once a key-exchange UX exists.

---

## 2026-06-10 — Phase 11.7: judgment publishing behind the flag

**Tags:** design, wire-format

The `assessmentPublishing` flag now does something: the reader's batch
publishes wire-ready 30054 assessments + 30055 claim links + kind-1985
label mirrors, after the claims (publish ordering per design rule 4 —
own-claim coordinates derive from the RECORDED publishedPubkey, never
the current signer). Selection logic is pure + unit-tested
(`shared/assessment-publish.js`); the options Advanced tab grew an
Experimental toggle (writes the `xray:flags` override; the reader
re-reads flags at publish time, so no reload ping is needed — the
`xray:flags:reload` message remains aspirational).

Three second-guessable calls:

- **Batch scope is ALL wire-ready judgments**, not just this article's:
  judgments are article-agnostic records, and cross-article ones
  (foreign-claim assessments, cross-source links) would otherwise never
  publish. The progress total extends mid-batch (judgment counts aren't
  knowable until claims record their pubkeys); a second toast announces
  the judgment sub-batch.
- **Mirrors are first-publish only, and only when their 30054 landed.**
  Kind 1985 is a regular (non-replaceable) event — re-mirroring on every
  edit would accumulate duplicates in naive aggregators. Cost: a label
  edit after first publish leaves the mirror stale until a NIP-09
  cleanup pass exists (same posture as every other superseded event).
- **Pre-backfill ambiguity, accepted:** an assessment stored against our
  own claim's coordinate BEFORE the claim recorded its pubkey publishes
  "as foreign" (correct coordinate, just no registry enrichment); once
  the pubkey lands, the same record selects via the local claim. Either
  path emits the same coordinate, so the wire d is identical.

---

## 2026-06-10 — Phase 11.3: assess UI; the one UI module in src/shared/

**Tags:** design

The judgment-capture surface. Two second-guessable calls:

- **`assess-modal.js` lives in `src/shared/` and renders DOM** — an
  explicit exception to the pure-ish-shared norm, because it is one
  surface used by two extension pages (reader claims bar + others'
  modal now; side-panel network rows in 11.5). It injects its own
  `<style>` (xr-assess-* only) so neither page's stylesheet carries the
  modal styles — no cross-surface CSS drift. Must never be imported by
  the content script.
- **Span anchoring minimizes the modal** instead of reusing the 10.3
  popover capture directly: a modal with a backdrop has no live
  selection, so the flow is mark-span → modal hides to a floating pill
  → user selects in the article → `captureFromRange` on the cloned
  range → modal restores. Capability-gated by `anchorContext` (the
  side panel has no article DOM and won't pass one).

---

## 2026-06-10 — Phase 11.2: kind 30054/30055 wire builders; 30043 builder deleted

**Tags:** design, wire-format

The wire-format slice (docs/ASSESSMENTS_DESIGN.md §wire; NIP_DRAFT.md gains
§30040/§30054/§30055 + querying filters). Builders only — **nothing
publishes yet**: both paths gate behind the new `assessmentPublishing`
flag (default off), wired in the Phase 11 publish slice.

**What landed:** `buildAssessmentEvent` (kind 30054) +
`buildClaimRelationshipEvent`/`parseRelationshipEvent` (kind 30055) in the
metadata-builders family ({event, body, dTag} contract);
`buildEvidenceLinkEvent` (kind 30043) deleted along with the reader's dead
link-publish loop and summary plumbing (publishing was gated off in 11.1,
so this is pure code removal — no behavior change).

Wire rules worth remembering:

- **d-tags are recomputable from the `a` tags** — 30054's d hashes the
  claim coordinate; 30055's hashes `coordA|coordB|relationship` with
  endpoints (and their url/eventId bundles) sorted lexically for the
  symmetric relationships. Local ids never hit the wire; the builders
  throw on `claim_*` refs.
- **`r` verbatim / `i` normalized:** both kinds mirror the target claim's
  `r` value exactly (the `#r` join with 30040s, which publish raw URLs
  today) and carry the normalized URL in the NIP-73 `i`/`k` pair. One
  rule, stated in the design note's URL section.
- **NIP-32 honesty:** `L`/`l` on a non-1985 kind are formally self-labels;
  NIP_DRAFT §30054 defines them as applying to the `a`-referenced claim
  (documented deviation), and the kind-1985 mirror is the designated
  ecosystem-aggregation path (publish slice).
- **builders.js stays chromeless:** it can't import claim-ref.js (which
  pulls claim-model → storage.js, and storage.js dereferences
  `chrome.storage.local` at module load — would break the shimless
  metadata tests). It carries a local 10-line coordinate shape-parser
  instead; claim-ref.js keeps the registry-aware canonicalization.

---

## 2026-06-09 — Phase 11.1: assessment data layer; legacy 30043 publish retired

**Tags:** design, wire-format

First Phase 11 slice (see `docs/ASSESSMENTS_DESIGN.md`, agreed same day).
Model + taxonomy + tests only — no UI, no new wire kinds yet.

**What landed:** `assessment-taxonomy.js` (label vocabulary under
`xray/assessment`, stance −2..+2, relationship directionality),
`claim-ref.js` (canonical claim refs: local id for ours, coordinate for
foreign, with the collapse rule), `assessment-model.js`
(one-assessment-per-claim under the `claim_assessments` key),
evidence-linker repurposed cross-source (coordinate endpoints, new
`contradicts/supports/updates/duplicates` enum, sorted endpoints for
symmetric relationships, endpoint snapshots, `suggested_by`), the `case`
entity type, and `ClaimModel.markPublished` recording `publishedPubkey`.

**Behavior change (the wire-format-rule callout):** the reader's batch
publish no longer emits kind-30043 evidence-link events —
`resolveEvidenceLinksToPublish` returns `[]`. Rationale: the agreed design
retires 30043 (its local-id tag vocabulary can't survive a public NIP, and
a re-keyed d could never replace already-published events); gating the
legacy path off *before* the model accepts coordinate refs guarantees no
hybrid-vocabulary event can ever publish (a coordinate inside a
`source-claim` tag would be malformed under both vocabularies). Local link
records keep accumulating; the cross-source kind-30055 path arrives in 11.2
and publishes behind `assessmentPublishing`. Already-published 30043s stay
on relays per the standing NIP-09 posture.

**Subtle invariant worth remembering:** assessment/link identity hashes the
*canonical* ref, and `canonicalizeClaimRef` only collapses a coordinate to
a local id when the coordinate's pubkey matches one of the claim's recorded
publishing pubkeys (`publishedPubkeys`, append-only — a re-keyed republish
must not orphan coordinates minted under the old identity). The d-tag alone
is insufficient because claim ids hash (url|text), so two users capturing
the same quote derive the same d under different pubkeys.

**Drift-robust matching (review-forced):** canonicality is *time-dependent* —
a stored coordinate becomes collapsible only once its claim records a
publishedPubkey (e.g. claims published pre-11.1 gain it on their next
republish). Matching only the query side would orphan such records under
BOTH representations and let `create()` mint duplicates. So every matcher
(`getByClaimRef`, `getForClaim`, `deleteForClaim`) canonicalizes the stored
side too (via a one-storage-read snapshot canonicalizer,
`makeClaimRefCanonicalizer`), and both `create()`s fall back to match-based
dedupe when the id lookup misses. Pinned by the "drift" tests in
`tests/assessment-model.test.mjs` / `tests/evidence-linker.test.mjs`.

---

## 2026-06-09 — Phase 11 design: assessments & contradictions; 10.5 superseded

**Tags:** design

**Decision:** Phase 11 ("Community Notes for the internet") adds a personal
judgment layer on claims: per-claim **assessments** (graded stance −2..+2 +
NIP-32 `xray/assessment` issue labels, each label optionally anchored) and
**cross-source claim relationships** (`contradicts`/`supports`/`updates`/
`duplicates`). Local-first; publishing flag-gated. Full design:
`docs/ASSESSMENTS_DESIGN.md` (for review before code).

Three second-guessable calls, on the record (the draft went through an
adversarial review pass; the second call below was *reversed* by it):

- **New kind `30054` for assessments** instead of overloading the dormant
  `30052`/`30051`. 30052's d-tag is per-(author, URL) — can't hold per-claim
  stances without changing its identity semantics; 30051 is Schema.org
  ClaimReview ("reviewed against a truth scale"), semantically distinct from
  a personal agree/disagree judgment — and although 30051 is unshipped (so
  redefining it would be compat-free), its ClaimReview JSON-LD interop and
  formal-verdict semantics are worth keeping as a distinct signal, and its
  text-keyed d breaks on claim edits where a coordinate-keyed d doesn't.
- **`30043` retired (as 10.5 planned), replaced by new kind `30055`** for
  cross-source claim relationships. The first draft repurposed 30043 with a
  new tag vocabulary + dual-read; review killed that: the legacy publish
  path is live and *ungated* today, so relays already hold local-id-vocab
  30043s a public NIP could never honor, and a re-keyed d can't replace
  them (different hash input — both versions would live forever). A fresh
  `3005x` kind starts coordinate-only and conventions-conformant; nothing
  in src/ reads foreign 30043s, so retirement costs ~nothing. The
  `evidence-linker.js` *module* is still repurposed as the cross-source
  local model.
- **A "case" is an entity, not a new object** — the keypair/p-tag/
  relay-query pipeline works unchanged and the entity detail view grows
  into the case dashboard. Recommended refinement (open for review): a
  first-class `case` entity *type* rather than overloading `thing`, because
  entity type is already wire-visible (30078/32125 `entity-type` tags) and
  deferring it means a type migration + republish later.

Other review-forced specifics worth remembering: assessment/link identity
keys on a *canonical claim ref* (local id for ours, coordinate for foreign,
normalized everywhere — the naive "coord when present, else local id" rule
breaks idempotency across the publish boundary); `ClaimModel.markPublished`
must start recording the publishing pubkey or coordinates of our own
published claims are unrecoverable; NIP-32 `l` tags on a non-1985 kind are
formally *self*-labels, so the kind-1985 mirror is the designated ecosystem
aggregation path; `contradicts`/`duplicates` are symmetric and need sorted
endpoint ordering in the d-hash or A↔B double-counts.

**Consequence for ROADMAP:** 10.5 ("metadata reframe") is superseded —
responses-to-claims arrives as the assessment primitive; annotations keep
the 10.3 shared anchor; 30043's retirement is confirmed and lands in 11.1
(publish path gated off). Phase 11 section added with slices 11.1–11.6.

---

## 2026-06-09 — Cross-source claim aggregation (Phase 10.4)

**Tags:** design

The payoff slice. Added a "Claims about this entity" section to the side
panel's entity-detail view (`renderDetail`): a **Load from relays** button
queries `kind 30040` by the entity's pubkey (`{kinds:[30040], "#p":[P]}`)
and renders what the network says about that entity, grouped by author.

**Placement (decided with maintainer):** side-panel entity detail, *not* the
reader. The reader's existing "Others' claims" is per-**URL** (`#r`); this is
per-**entity** (`#p`) across all articles — a different axis, and the panel is
the entity-centric surface. The panel has no relay access of its own (by
design — see its header comment), so the query routes through the background
SW's `xray:relay:query` (same path the reader uses), with relays read from
`preferences.default_relays` (mirroring the reader's `getConfiguredRelays`).

**Shared parse:** added `parseClaimEvent(event)` to `claim-model.js` — a pure,
dual-vocabulary (thin 10.2 + legacy) reader that turns a `30040` into a
display object. Unit-tested both vocabularies. (The reader's
`renderForeignClaim` still has its own inline parse; DRYing it onto
`parseClaimEvent` is a low-value follow-up, left alone to avoid churn.)

Querying is **on-demand** (a button), not auto-on-detail-open, so browsing
entities doesn't fire a relay round-trip per click. 526/526 green.

---

## 2026-06-09 — Precise claim anchoring (Phase 10.3)

**Tags:** design

Wired the Phase 9a `metadata/anchor-capture.js` into claim creation. At
"Add as claim" the tagger captures a selector array from the **cloned**
selection range (`captureFromRange`, a new sibling of `captureFromSelection`
— the live selection is already cleared by the time the popover button
fires, so reading `window.getSelection()` there returns nothing). The anchor
threads tagger → `onClaim` → `openClaimModal` → `ClaimModel.create({anchor})`
and rides the `30040` `anchor` tag (already wired in 10.2).

Rehydration (`rehydrateClaimMarks`) now prefers the anchor: `resolveSelectors`
returns `{textStart,textEnd}` offsets into `container.textContent`, which a
new `wrapByOffsets` maps to a DOM Range (walking text nodes) and wraps —
disambiguating *which* occurrence via prefix/suffix instead of always taking
the first. Falls back to `wrapFirstTextOccurrence` for pre-10.3 claims or
unresolvable anchors, and skips spans already inside an `.xr-claim` so
repeated `refreshClaimsBar` re-renders stay idempotent.

**Gotcha fixed:** the refactor first made `captureFromSelection` delegate to
`captureFromRange` (exact via `range.toString()`), which broke two existing
anchor-capture tests whose mock *range* has no real `toString()`. Kept
`captureFromSelection` reading `selection.toString()` and factored the shared
body into `captureWith(exact, range, root)`. 524/524 green.

---

## 2026-06-09 — Lean kind-30040 wire format (Phase 10.2)

**Tags:** design, wire-format

**What changed:** `buildClaimEvent` now emits the thin shape directly. Claim
text moves to the event **content** (was a `claim-text` tag); about-entities
become **`['p', pubkey, '', 'about']`** + `['entity', name, 'about']`; the
source is `['source', value]` (+ a `p`-tag with `source` marker when it's an
entity); `['key','true']` replaces `crux`/`confidence`. Gone: `claim-type`,
`attribution`, `predicate`, `subject`/`object`, `claimant`, `quote-date`. The
`buildArticleEvent` embedded `['claim', …]` tags went thin too
(`['claim', text]` / `['claim', text, 'key']`). The 10.1 transitional mirror
in `claim-model.js` is removed; `normalizeClaim` stays (reads pre-redesign
local records). The reader's publish flow (`collectClaimEntityIds`,
`resolveRelationshipsToPublish`) now reads `about` + `source`, and the derived
`32125` relationships use `about` / `source` relTypes (the relationship
builder takes an arbitrary type, so no enum change).

**Why this is the payoff:** about-entities tagged with the *same entity
pubkeys used everywhere else* make "what the network says about person P" a
single `{ kinds:[30040], "#p":[P] }` relay query (Phase 10.4 will surface it).

**Compat:** wire-format change, back-compat preserved. Already-published
30040s keep their old tags; `renderForeignClaim` is **dual-read** — it
understands both the new vocab (`content`, `entity …about`, `source`, `key`)
and the legacy one (`claim-text`, `subject`/`object`, `claimant`, `crux`), so
others' claims published before the redesign still display. Tests:
`tests/event-builder.test.mjs` gains two lean-format cases; the 10.1 mirror
test was dropped. 523/523 green.

---

## 2026-06-09 — Thin claims shipped: model + modal (Phase 10.1)

**Tags:** design

**What changed:** First slice of the claim redesign. `claim-model.js` is now
thin — `text` + `about[]` (entity ids) + `source` (entity id / free text /
null=article) + `is_key` + `anchor?`. The claim modal (`claim-extractor.js`)
lost the type row, crux+confidence slider, attribution dropdown, predicate,
the subject/object/claimant pickers, and the quote-date field; in their place
it has a single **About** multi-entity picker, an optional **"who said it"**
entity-or-text picker, and a ⭐ **Key claim** checkbox. The claims bar renders
text + about-entities + source + ⭐ instead of the type/triple/attribution.

**Compat / how it stays non-breaking:** This slice deliberately makes **no
wire-format change** (that's 10.2). `ClaimModel.create/update` mirror the thin
fields onto the legacy fields the unchanged `buildClaimEvent` + reader publish
flow read (`subject_entity_ids`←`about`, `claimant_entity_id`←`source` when an
entity, `is_crux`←`is_key`, `type='factual'`, `attribution='editorial'`).
`normalizeClaim()` does the inverse for pre-10.1 records on read, so old
claims render in the thin UI. Both the mirror and `normalizeClaim` go away in
10.2 when the `kind 30040` builder reads the thin fields directly. Id
derivation (`source_url|norm(text)`) is unchanged, so published-event ids stay
stable. Tests: `tests/claim-model.test.mjs` rewritten (thin API + legacy
normalization); 522/522 green.

---

## 2026-06-09 — Claim redesign agreed: thin, entity-centric claims (Phase 10)

**Tags:** design

**Decision:** Rework the Phase 5 structured-claim model. The original asked
for ~9 fields per claim (type / crux+confidence / attribution / predicate /
subject / object / claimant / quote-date / text) plus a separate
same-article evidence-link modal — analyst-grade friction that fights the
goal of *volume* of useful entity data, with a brittle S/P/O graph and a
`confidence` slider whose semantics are ambiguous (truth vs. centrality).

Agreed shape: a **thin, entity-centric claim** — `text` + `about[]` (the
entities it concerns) + `source_url`/`anchor`, an optional `source` ("who
said it", absorbing attribution+claimant), and a single `is_key` ⭐ flag.
Everything else is cut. The queryable value moves into `30040` `p`-tags on
entity pubkeys, so "what the network says about person P" is one
`{kinds:[30040], "#p":[P]}` query. **Claims become the core primitive**; the
Phase 9a metadata fact-checks/ratings get reframed as *responses to* claims
(shared text-anchor) rather than a parallel system; same-article evidence
links (`30043`) retire in favor of cross-source entity aggregation.

Full design + rationale + compat plan: `docs/CLAIMS_REDESIGN.md`. Ships in
slices 10.1–10.5 (see ROADMAP). Wire-format change in 10.2 with dual-read of
old/new tag vocab and a one-time storage migration of old claim records.

---

## 2026-06-09 — Roadmap + docs refresh; Phase 10 teed up (Phase E)

**Tags:** design

**What changed:** Closed out the staged cleanup with a docs pass. ROADMAP:
fixed staleness (Phase 3 header `🟡`→`✅`, Shorts noted as shipped), added a
status-snapshot line + a "Post-parity cleanup (A–E)" record, triaged the
scattered per-phase "Deferred" lists into one **keep / defer / cut**
disposition against the claim-tracking north star, and added a **Phase 10 —
Claim tracking** section capturing the intent (make the existing claim /
evidence / identity primitives *useful and usable*, not new wire kinds).
SMOKE_TEST: rewrote the FAB-era steps for the no-FAB model and dropped the
now-impossible assertions (FAB renders bottom-right, FAB 📦 badge,
FAB-header signing badge) — signing status reads from the Settings Active
method line, archive from the reader banner. README status updated.

**So-what:** The roadmap now reflects reality and points at the next
milestone, and the release-gating smoke test no longer instructs testers
to look for UI that was deliberately removed. End of the v0.5.x cleanup
arc (A de-FAB → B settings → C client-tag → D nac→xr → E docs); next work
is Phase 10.

---

## 2026-06-09 — Eliminate the last `nac-*` markers (Phase D)

**Tags:** design

**What changed:** Renamed the remaining `nac-*` class names — the
capture→Markdown markers in `content-extractor.js` (`nac-tweet-embed`,
`nac-inline-img`, `nac-facebook-post`/`nac-fb-*`,
`nac-instagram-post`/`nac-ig-*`) — to `xr-*`. The codebase is now
100% `xr-*` (the FAB/panel `nac-*` CSS went in Phase A; this clears the
internal markers). Pure string rename, no behavior change: these are class
names on cloned DOM nodes the Turndown rules match, and producer/consumer
pairs were renamed in lockstep within the one file.

**Tracing notes (for whoever touches these next):** `xr-tweet-embed` and
`xr-inline-img` have live producer+consumer pairs. `xr-inline-img` is
otherwise **vestigial** — Phase A deleted the content.css rule that styled
it, and `htmlToMarkdown`'s image rule keys on width, not the class. The
`xr-facebook-post` / `xr-instagram-post` Turndown rules have **no producer
anywhere in src** — they're dead code from an earlier HTML-embed
architecture (FB/IG handlers now return data objects). Left both in place
(renamed) rather than deleted to keep Phase D a zero-risk rename; removing
the dead rules + vestigial class is a safe future cleanup.

**Deferred (needs browser QA):** the deeper CSS *token/color* unification
the audit flagged — reconciling the minor success/warning/danger value
divergence across reader/options/sidepanel and the couple of hardcoded
`#363636`s — is a visual change I can't verify headless, so it's left as a
documented follow-up rather than shipped blind.

---

## 2026-06-09 — Unify the NOSTR `client` tag to `xray` (Phase C)

**Tags:** design, external

**What changed:** The `['client', …]` tag was inconsistent — the article,
entity-sync, relationship, and evidence builders emitted
`'nostr-article-capture'` (the old userscript name) while the comment and
platform-account builders already emitted `'xray'`. Unified all to
`'xray'`. The entity-sync NIP-32 label namespace likewise moved from
`nac/entity-sync` to `xray/entity-sync`. Also retitled the entity kind-0
`about` field ("entity created by X-Ray").

**Compatibility:** The `client` tag is informational — no consumer filters
on it for correctness, and already-published events keep their old value,
so unifying is cosmetic on the wire. The **sync label is a read filter**,
though: changing it naively would orphan entities synced under the old
label. So the write path emits `xray/entity-sync` while the *read* path
(`entity-sync.js` pull/clear filters) queries **both** the new label and
the legacy `nac/entity-sync` (`SYNC_LABELS_READ`). The write label lives
in `EventBuilder.buildEntitySyncEvent`; the read constants live in
`entity-sync.js` — keep them in lockstep.

**Left intentionally:** the line-1 port-attribution comments in
`event-builder.js` / `crypto.js` (historical, not wire data).

---

## 2026-06-09 — Settings consolidation (Phase B of the cleanup)

**Tags:** design

**What changed:** Removed the **"Migrate from userscript" tab** and its
importer (`shared/userscript-migration.js` + test). Removed two **dead
Advanced controls** — the **Theme** and **Media handling** selectors,
which were written to `preferences` but never read anywhere in the capture
or publish path (media is always emitted as URLs per the event-builder
note; theme was never wired to any stylesheet). Removed the unused
`recent_publications` storage key (defaults + clear-list). Reorganized the
Advanced tab into a **Reader** group (archive-banner sensitivity, promoted
out of the engine-tuning pile where it was buried) and a **Power user**
group (debug + engine-tuning overrides), then the Danger zone.

**Why:** Audit found the settings were "dispersed in weird ways": the
Migrate tab was the most prominent old-project remnant, two Advanced
controls did nothing, and a genuinely user-facing reader control (archive
banner) sat among power-user knobs. The FAB-panel's separate per-capture
media toggle that *did* do something was already deleted in Phase A, so
the Advanced media pref had no remaining purpose.

**Note:** `LocalKeyManager` import dropped from `options/index.js` (only
the removed `runMigration` used it). The storage `_runMigrations()` runner
(relay/signing data migrations) is unrelated to the userscript importer
and stays. Test count 528 → 521 (the 7 migration tests went with the
module).

---

## 2026-06-09 — De-FAB: one capture surface (Phase A of the cleanup)

**Tags:** design

**What changed:** Removed the in-page floating action button (FAB) and the
in-page capture panel. Every capture trigger — toolbar-icon click, the
`Ctrl/Cmd+Shift+X` command, and the right-click menu — now sends a single
`xray:capture` message to the content script, which runs `UI.openReader()`
(extract → stash in `chrome.storage.session` → open the reader tab). The
content script injects no in-page chrome beyond a transient error toast.

**Why:** The FAB opened the modern reader while the toolbar/keyboard/menu
still opened a *legacy in-page panel* — two capture surfaces with
divergent feature sets (the panel duplicated ~60% of the reader but lacked
entity tagging, claims, comments, and the archive flow the reader gained
in Phases 4–7). The FAB also "got in the way" on every page for no benefit
now that the extension owns a toolbar action. Collapsing to the reader as
the single surface removed the inconsistency and ~600 lines of
content-script JS/CSS, including most of the orphaned `nac-*` styling.

**Surface:** `src/content/ui.js` shrank from ~1017 lines (FAB + panel +
overlay + publish form + signing-status + all panel helpers) to ~165
(capture core + toast + keypair-registry utilities). `content.css` shrank
to the toast styles only (now `xr-toast`, self-contained, no `:root`
pollution). The toolbar `action`, the `xray:toggle` command id (kept so
existing key bindings survive), the context-menu item ("Capture this
page…"), and the options "Capture Page" quick-action were all re-pointed
at `xray:capture`. Removed the dead `xray:toggle`/`xray:open` content-side
handlers and the panel-only signing-status calls; `recordSigningState`
still writes `xr_signing_state` for the options Signing tab.

**Follow-ups:** the 15 remaining `nac-*` tokens are capture→Markdown
markers in `content-extractor.js` (not UI) — renamed in a later phase. The
detailed SMOKE_TEST step rewrite rides with the Phase E docs refresh (a
correction banner was added in the meantime). First of the staged cleanup
phases; the entry-point decision was recorded with the user.

---

## 2026-06-06 — Relays reject events with non-string tag values

**Tags:** bug, external

**Symptom:** Publishing a josephsmithpapers.org capture failed on every
relay with `invalid: tag val was not a string` (per-relay `{ok:0, fail:1}`).
The event was otherwise well-formed and signed.

**Root cause:** NOSTR requires every element of every tag to be a string,
and relays reject the *whole* event if one isn't. `buildArticleEvent`
pushes some tag values straight from the page's JSON-LD, where schema.org
legitimately allows non-string shapes: `articleSection` can be an **array**
(`["History","Religion"]`) and `inLanguage` an **object**
(`{"@type":"Language","name":"en"}`). Those flowed into `['section', …]`
and `['lang', …]` as a raw array/object → relay rejection. Most sites emit
string scalars, so this never showed up in testing until a richly-marked-up
scholarly site hit it.

**Fix:** `EventBuilder.sanitizeTags()` runs over the article event's tags
before it's returned. `coerceTagAtom()` turns each value into a string —
primitives stringify, arrays flatten+join, schema.org objects yield their
`name`/`@value`/`@id`, anything else becomes null and the tag is dropped
(a valueless `["section"]` is meaningless). Empty positional markers (the
`""` in `["p", pk, "", "author"]`) are preserved.

**So-what:** Any tag value sourced from a third party's structured data is
untrusted shape-wise. The sanitizer is a wire-level guarantee, not a
per-field patch, so the next exotic JSON-LD field can't silently break
publishing. Files: `src/shared/event-builder.js`,
`tests/event-builder.test.mjs`.

---

## 2026-06-06 — Readability eats inline names on josephsmithpapers.org

**Tags:** bug, external

**Symptom:** Capturing a Joseph Smith Papers introduction
(`/intro/introduction-to-administrative-records-volume-1`) produced prose
with gaps where every person and place name should be — e.g. "organized a
council in `[ ]`, Illinois" and "met in Nauvoo under `[ ]`'s leadership".
The body text was otherwise complete (~56k chars captured), so it read as
"missing full text" but was really *missing inline entities*.

**Root cause:** JSP wraps each inline person/place name in an interactive
glossary popup:

```html
<aside class="popup-wrapper">
  <a class="reference staticPopup" title="Nauvoo, Illinois">Nauvoo</a>
  <div class="popup-content">…hover blurb…</div>
</aside>
```

Readability's `unlikelyCandidates` regex matches the literal substring
**`popup`**, so during `_grabArticle` it removes the entire `<aside>` —
visible name included — leaving the surrounding punctuation behind. Plain
text occurrences of the same word survive because they aren't wrapped. The
editorial footnote markers (`<aside>` → `a.editorial-note-static`) get
eaten the same way.

**Fix:** `ContentExtractor._unwrapInlinePopups()` runs on the detached
document clone *before* Readability. It replaces each `aside.popup-wrapper`
with its reference link's visible text (so "Nauvoo" becomes a bare text
node Readability keeps) and drops editorial-note markers so footnote
superscripts don't litter the prose. It operates on the clone, never the
live page (so the user's interactive popups are untouched), and is
best-effort — any failure falls through without blocking extraction.

**So-what:** This is the same class as the YouTube `aria-hidden` timestamp
drop (2026-04-19 entry): a third party's a11y/interaction markup colliding
with an extraction heuristic that strips "chrome". The `popup` keyword in
Readability's blocklist is the trap — any site that renders meaningful
inline content inside a `popup`-classed element will lose it. Files:
`src/shared/content-extractor.js`, `tests/content-popup-unwrap.test.mjs`.

---

## 2026-04-24 — Facebook capture: full shake-down + scope-based DOM discipline

**Tags:** bug, design, pattern

**Context:** End-to-end real-world testing against a personal-profile
FB post (Jessica McManus's acne-journey post at
`/jessica.clydesdale/posts/pfbid...`) exercised every extraction
path under adversarial conditions — private-profile with empty
og-meta, multi-story GraphQL response containing sibling posts
and comments, post-detail modal rendered on top of a profile feed.
Each capture turned up a new failure mode; each fix tightened a
pattern rule that now applies across all DOM-based platforms.

**Five failures surfaced and fixed this session:**

1. **Wrong story from first-match walker.** The GraphQL response for
   a post-detail view includes the focal post plus sibling stories
   (comments, nearby feed units, "suggested posts"). `findStoryRecursively`
   took the first quacking node — which was "Lindsey Baker" (a
   commenter) instead of "Jessica McManus" (the author). Replaced
   with `collectStoriesRecursively` + `pickBestStory` scoring by
   `message.text` length + `feedback`/`attachments` bonuses.
   *Rule learned:* first-match walkers are wrong when a response
   may contain multiple candidates; prefer candidate collection +
   scoring.

2. **Empty images on photo posts.** `evidenceTarget.querySelectorAll('img')`
   returned zero hits because FB splits the focal post across
   DOM siblings: `[role="article"]` holds the header + text, the
   image gallery is a sibling inside the enclosing dialog. Broadened
   to the whole document — which then pulled in ~5 images including
   a profile banner, a family photo from the feed behind the modal,
   and an adjacent post. Fixed with `pickImageScope` (renamed
   `pickFocalScope`) scoped to `[role="dialog"]` when present.
   *Rule learned:* DOM scope matters as much as selector specificity;
   on modal overlays, the feed behind is always a DOM sibling.

3. **Body text swallowed an adjacent profile-feed post.** Even after
   the image scope was fixed, the body text came through as "Nova
   Colette, It has almost been 2 months..." — a *different* post by
   Jessica visible in her profile feed under the modal. Broadened
   body scraper (whole-document longest `<div dir="auto">`) hit the
   same trap. Extended `pickFocalScope` to govern every DOM scraper
   (body, author, verified flag, post date, images) — one scope,
   all scrapers.
   *Rule learned:* every DOM scraper on a multi-container platform
   needs the same scope; scoping one and leaving another unbounded
   silently regresses.

4. **Screenshot captured an 80-pixel sliver.** `pickScreenshotTarget`
   walked up from any image ≥200×200 — which on FB included the
   thumbnail strip at the top of the post wrapper. Raised the floor
   to 400×400 so the algorithm prefers the actual post media and
   falls back to the full post container when no media qualifies.
   *Rule learned:* largest-media heuristics need a "nothing big
   enough" fallback that returns the parent rather than a degenerate
   sibling.

5. **Missing publish date.** `scrapePostDate` checked only
   `<abbr data-utime>` (legacy, gone from current FB) and
   `story.creation_time` top-level (also gone — now nested under
   `comet_sections.timestamp.story.creation_time`). Three new paths:
   recursive `findCreationTime` walk of the GraphQL story subtree,
   `aria-label` parse on permalink anchors, and a word-boundary
   relative-time parser for "12h" / "3d" text tokens. The recursive
   GraphQL walk skips `feedback` / `comments` subtrees so a
   comment's `creation_time` can't mask the post's.
   *Rule learned:* FB nests the same field at three different paths
   depending on UI version; recursive bounded walks are cheaper to
   maintain than path-case matrices.

**Two user-visible polish items landed together:**

- **`null (@handle)` byline** — `author + (handle ? ...)` string-
  concats `null` as the literal string `"null"`. Defensive guard
  on any nullable-left concatenation.
- **Multi-line title from truncation** — the 80-char truncate ran
  against body text that included `\n\n` paragraph breaks, so the
  title rendered as multiple markdown link-lines. `truncate` now
  `.replace(/\s+/g, ' ')` before measuring and cuts at the last
  word boundary.

**Documentation shipped alongside the fixes:**

- `docs/CAPTURE_GUIDE.md` — user-facing walkthrough for Instagram,
  Facebook, TikTok. Each platform gets a "do this" / "don't do
  this" / "what you'll see" / "known limitations" block, plus a
  symptom → fix table.
- In-reader hint banner when capture quality is thin (missing
  body, no images, `extractedFrom === 'none'`). Platform-specific
  retry instructions linked to the guide.
- Platform-aware FAB tooltip on FB/IG/TikTok hosts so hovering
  the capture button surfaces the "open the specific post" tip
  before the user clicks.
- Popup "Capture tips" button → GitHub-hosted guide.

**Cross-platform pattern update.** The `pickFocalScope` discipline
(one scope, all scrapers) is now the established approach for any
platform where the target content can share a DOM with sibling
content (modals, feeds, infinite-scroll pages). Instagram's
`pickEvidenceElement` already scoped to `article[role="presentation"]`
after the "More posts grid" bug (2026-04-23); this session made
the pattern explicit and named. Any future hard-tier platform
should follow: pick the focal scope first, pass it to every
extractor, never query `document` directly from a scraper.

**Test count:** 176 → 223 (+47 across IG pk regression + FB URL
grammar + og-description + GraphQL walker + image extractor +
date parsers + creation_time walker). All green.

**Publish timing:** `parseRelativeTime` against `Date.now()` is
approximate to the string's granularity — "12h" lands within the
hour. Acceptable for a best-effort signal; `findCreationTime` on
a future response that exposes the exact `creation_time` will
take precedence when the walker finds it.

Files: [src/shared/platforms/facebook.js](../src/shared/platforms/facebook.js),
[src/shared/platforms/instagram.js](../src/shared/platforms/instagram.js),
[src/shared/event-builder.js](../src/shared/event-builder.js),
[src/reader/index.js](../src/reader/index.js),
[src/reader/index.css](../src/reader/index.css),
[src/popup/popup.html](../src/popup/popup.html),
[src/popup/index.js](../src/popup/index.js),
[src/content/ui.js](../src/content/ui.js),
[docs/CAPTURE_GUIDE.md](CAPTURE_GUIDE.md).

---

## 2026-04-24 — Facebook: first-capture iteration

**Tags:** bug, design, pattern

**Context:** First real capture against a personal-profile FB post
(`/jessica.clydesdale/posts/pfbid...`) surfaced four problems that
matched the YouTube DOM arms-race pattern exactly — each extraction
path had a silent-failure mode that handed the next layer garbage.
Fixing them is less about Facebook specifics and more about making
the pattern's "fail visibly, track provenance" rules load-bearing.

**What broke:**

1. **`null (@jessica.clydesdale)` byline.** `synthesizeArticle`
   built the byline as `author + (handle ? ...)`. With `author = null`,
   JS string-concatenated the literal `"null"`. Visible garbage on
   every personal-profile capture where no author layer produced a
   name.
2. **Wrong provenance chips.** The chip logic inferred the source
   by re-checking (`apiUser ? 'graphql' : (domAuthor.name ? 'dom-scrape' : 'og-meta')`),
   which defaulted to `'og-meta'` even when og-meta contributed
   nothing and the handle came from URL regex alone. The reader's
   provenance chip — the whole point of the three-layer model —
   was lying about where fields came from.
3. **Empty post body despite visible text on screen.** The OG
   description was empty (personal profile), the GraphQL walker
   matched a sibling node without `message.text`, and the DOM
   scraper was scoped to the first `[role="article"]` — which on
   post-detail pages is often NOT the focal post (FB renders
   multiple article regions: focal post, comments, sidebar
   suggestions, each its own article role).
4. **Wrong story identified.** The post was "Jessica McManus's
   Post" but the GraphQL walker returned `actors[0].name =
   "Lindsey Baker"`. `findStoryRecursively` matched the first
   node that quacked like a story — which was a nested
   comment/feed-unit story, not the focal post. The screenshot
   captured a `680×80` sliver because the wrong-story container
   didn't have the focal post's images.

**Fixes — all pattern-aligned:**

- **Never string-concat nullable fields.** [facebook.js:691](../src/shared/platforms/facebook.js:691)
  defensive byline: `author ? author + (handle ? ...) : (handle ? '@handle' : '')`.
- **Track winning source at assignment time.** [facebook.js:619](../src/shared/platforms/facebook.js:619)
  records `authorSource` + `extractedFrom` as the extraction runs,
  not by re-inferring at the end. Chip vocabulary expands to include
  `url`, `dom-scrape`, `og-title`, `og-meta`, `graphql`. The chip
  now matches reality; when the next platform change breaks a layer,
  the chip makes it obvious.
- **Broaden the DOM body scraper.** [facebook.js:327](../src/shared/platforms/facebook.js:327)
  searches the whole document for the longest `<div dir="auto">`,
  skipping `aria-hidden` subtrees. Removes the "first article region
  wins" bug. Post-detail pages reliably have exactly one
  many-hundred-char text node, so longest-wins is a decent proxy.
- **Score GraphQL story candidates.** [facebook.js:341](../src/shared/platforms/facebook.js:341)
  replaces `findStoryRecursively` (first-match) with
  `collectStoriesRecursively` + `pickBestStory`. Score: length of
  `message.text` + bonuses for `feedback` (real post metadata) and
  `attachments` (actual media). The focal post reliably has the
  longest body text of any story-shaped node in the response.
- **Raise the screenshot floor.** [facebook.js:540](../src/shared/platforms/facebook.js:540)
  required media width/height 200→400px. When nothing qualifies,
  screenshot the whole evidence container instead of walking up
  from a thumbnail strip. A tall faithful screenshot beats a
  sliver of nothing.
- **Relaxed `looksLikeStory`.** [facebook.js:392](../src/shared/platforms/facebook.js:392)
  now accepts `feedback + message.text` without requiring `actors`
  — catches feed-wrapper shapes where actors are hoisted into a
  sibling envelope.

**Tie to the YouTube arms-race playbook:**

1. ✅ *Multiple strategies with priority ordering* — graphql →
   og-meta → dom-scrape → fallback. Each strategy can fail
   independently.
2. ✅ *Loud diagnostics at each stage boundary* —
   `[X-Ray Facebook] buffer scan: walking N events` /
   `buffer event matched: /api/graphql/ — actor: <name>` /
   `capture diagnostic: {...}`. A user pasting their console
   output now narrates exactly which path ran and where it landed.
3. ✅ *Defensive selectors* — ARIA roles, `data-ad-comet-preview`,
   `<div dir="auto">`. No class-name selectors anywhere in the
   handler. FB's class names randomize per deploy; ARIA and
   data-attrs change on a quarters-to-years cadence.
4. ✅ *Fail gracefully + visibly* — provenance chips surface the
   degradation. If the next capture shows `extractedFrom: none`,
   the user sees it instantly; they don't have to diff two JSON
   objects to notice something regressed.

**Known unfixed case.** If a sibling story in the GraphQL response
happens to have a longer `message.text` than the focal post's
(e.g. a long ad comment where the focal post has a short caption),
`pickBestStory` still picks wrong. The real fix needs post-id
matching against the URL's `pfbid*`, but pfbid IDs don't appear
literally in GraphQL payloads — FB uses different internal id
formats (`feedback.id`, `post_id`, `story.id`, each encrypted
differently). Flagged for future work once we have captured
payloads to pin the id-mapping.

**So-what:** Every hard-tier platform will hit some variant of
these four failure modes — null-concat, mis-inferred provenance,
first-match walker, misaligned screenshot. The pattern-level fixes
(track provenance at assignment; search broadly not narrowly;
score don't first-match; graceful fallback) generalize to
Instagram/TikTok if they regress, and to the next hard-tier
platform we tackle.

Files: [src/shared/platforms/facebook.js](../src/shared/platforms/facebook.js).

---

## 2026-04-24 — Instagram: numeric pk blocks relay publish

**Tags:** bug

**Context:** Every Instagram capture published a signed event
successfully but all three relays rejected it with
`"invalid: tag val was not a string"`. Relay logs:

```
Received message from relay: ["OK","<event-id>",false,"invalid: tag val was not a string"]
```

**Root cause:** Instagram's REST `/api/v1/media/.../info/` response
gives `user.pk` as a number (e.g. `507869549`), not a string. The
yesterday's `normalizeUserShape` passed it through as-is. EventBuilder
pushed it into a tag:

```js
if (ig.author && ig.author.pk) tags.push(['author_id', ig.author.pk]);
```

NIP-01 requires all tag values to be strings. The signed event
serializes fine (numbers JSON-stringify), but relays enforce the
type at ingestion. Failure mode was 100% — every relay, every
attempt.

**Fix at two layers** so this can't regress:

1. **[instagram.js:509](../src/shared/platforms/instagram.js:509)**
   — `normalizeUserShape` coerces pk to string at the normalization
   boundary via `rawPk != null ? String(rawPk) : null`. Downstream
   callers never see a non-string.
2. **[event-builder.js:243](../src/shared/event-builder.js:243)**
   — defensive `String()` wrap on the `author_id` tag emission as a
   backstop, in case a future codepath hands us a raw user object.

**Regression test** in [tests/event-builder.test.mjs](../tests/event-builder.test.mjs)
builds an article event with a numeric `pk` and asserts
`typeof v === 'string'` for every value in every tag — catches
this class broadly, not just pk.

**Pattern takeaway:** JSON fields that feed event tags need either
explicit string coercion at the normalization boundary, or a type
audit at the emission site. Pk/id-style fields are the highest
risk because JSON gives them as numbers while every other id-ish
thing in the codebase (shortcodes, handles, URLs) is already a
string — the mixed-type path is easy to miss during code review.

Files: [src/shared/platforms/instagram.js](../src/shared/platforms/instagram.js),
[src/shared/event-builder.js](../src/shared/event-builder.js),
[tests/event-builder.test.mjs](../tests/event-builder.test.mjs).

---

## 2026-04-23 — Phase 8d: Facebook handler — third hard-tier platform

**Tags:** design

**Context:** Third and final hard-tier platform. Facebook was the
"real test" flagged during Phase 8c — no SSR JSON blob, hostile
randomized class names, anti-replay `fb_dtsg` tokens, and OG meta
that's rich-when-public / empty-when-private.

**Four-layer capture model.** Same three-layer Phase 8a foundation
as TikTok/Instagram, plus a fourth path needed specifically for
Facebook's inconsistent OG emission:

1. **GraphQL response interception** — load-bearing path for private
   posts. The api-hook buffer captures `/api/graphql/`-tagged POSTs
   during page load. `extractPostFromGraphQL` recursively walks the
   parsed response for the first node that quacks like a story
   (has `actors` + `message.text`, or `creation_time` + `message`,
   or `actors` + `attachments`). No envelope-path hardcoding — FB's
   query shapes drift too often to commit to specific paths.
2. **Open Graph + Twitter Card meta tags** — the cleanest path for
   public pages and share-link URLs. Parser handles the
   `"<Author>: \"<body>\""` and `"<Author> wrote on Facebook: <body>"`
   shapes, plus optional leading engagement counts. Falls back to
   whole-string-as-body on unparseable input.
3. **Defensive DOM scrape** — ARIA-based author extraction
   (`[role="article"]` → `strong a[role="link"]`), verified-flag
   detection, legacy `<abbr data-utime>` for post date when present.
4. **HTML snapshot + screenshot** — always-on evidence layer. A
   separate `pickScreenshotTarget` walks the post for the largest
   media element and climbs to its container, same pattern as
   Instagram — keeps the screenshot tight on the visible media
   rather than sweeping the whole comment thread.

**URL grammar covers:**
- `/<user>/posts/<id>`, `/<user>/videos/<id>`, `/<user>/photos/<set>/<id>`
- `/watch/?v=<id>`, `/reel/<id>`
- `/permalink.php?story_fbid=<id>`, `/story.php?story_fbid=<id>`
- `/share/p|v|r/<shortcode>/` — the modern share-link form
- `/photo/?fbid=<id>`, `/photo.php?fbid=<id>`
- `/groups/<g>/posts|permalink/<id>/`

The `id` is opaque throughout — numeric story ids, `pfbid*` opaque
ids, and share shortcodes all flow through the same code path.
Canonical URL reconstruction picks the shape based on post kind +
handle availability.

**GraphQL response format detail.** Facebook serves GraphQL responses
as newline-delimited multi-JSON in some cases (streamed partial
updates). `extractFromBuffer` tries a direct parse first, then splits
on newlines and tries each fragment — catches both shapes.

**Manifest + content-script wiring:** the api-interceptor is now
loaded at `document_start` on `*.facebook.com` and `*.fb.com` in
addition to Instagram. Content script configures the buffer with
`{ urlIncludes: 'graphql' }` on FB pages; no separate `/api/v1/media/`
pattern since FB routes everything through `graphql`.

**Test count:** 176 → 203 (27 new Facebook tests pinning all URL
shapes + og:description variants + GraphQL recursive walker across
top-level, deeply-nested, owner-vs-actors, and permalink-style
shapes).

**So-what:** All three hard-tier platforms ship on the same
four-layer foundation without architectural changes. The screenshot
+ HTML snapshot + extractedFrom provenance chip pattern validated
across TikTok (rich SSR) → Instagram (sparse SSR + GraphQL) →
Facebook (no SSR + GraphQL-only) without rework. Phase 8 complete.

**Known unknowns for first real-world tests:**
- The OG description parser's format assumptions are inferred from
  FB's historical behavior; the first actual capture may surface
  shapes the regex doesn't cover. Falls back to whole-string body,
  so nothing breaks — just means less-structured author extraction
  until the parser is tuned.
- `looksLikeStory` may match non-focal stories in `/api/graphql/`
  responses that include feed context (e.g. a response carrying
  both the focal post and a "People you may know" nested story).
  Shortcode-style filtering isn't available since FB doesn't
  embed a consistent id across response shapes. Newest-event-wins
  heuristic should hold; if it doesn't, add a
  `if (story.post_id !== postId) continue` gate once the real-world
  shape is known.

Files: [src/shared/platforms/facebook.js](../src/shared/platforms/facebook.js),
[src/shared/platforms/index.js](../src/shared/platforms/index.js),
[src/content/index.js](../src/content/index.js),
[manifest.json](../manifest.json),
[src/shared/event-builder.js](../src/shared/event-builder.js),
[src/reader/index.js](../src/reader/index.js),
[tests/facebook.test.mjs](../tests/facebook.test.mjs).

---

## 2026-04-23 — Instagram: rich author profile + platform_account tag

**Tags:** design

**Context:** Live test of carousel capture flagged that the
captured artifact had `Author: Reason Magazine` but no link back
to the actual Instagram account, no profile picture, no
verified flag, and no follower count. For a truth-system goal
that maps content to who said it, the author entity is at least
as important as the content.

**Two related issues:**

1. **Handle extraction was failing for direct `/p/<id>/` URLs.**
   `extractHandleFromUrl` only matched user-prefixed URLs
   (`/<user>/p/<id>/`), and `parseOgDescription` only matched
   the `(@handle)` parenthesized form which Instagram doesn't
   always include. New `extractHandleFromMeta` parses the
   `"<handle> on April 22, ..."` substring as a fallback.

2. **No structured profile data.** When SPA navigation captures
   the `/api/v1/users/<id>/info/` or `data.user` GraphQL response,
   Instagram returns rich profile fields: `pk` (stable user id),
   `full_name`, `username`, `is_verified`, `profile_pic_url`,
   `follower_count`, `following_count`, `media_count`, `biography`,
   `category`. Wired `extractProfileFromBuffer` to scan the
   api-hook buffer for the post author's profile and surface it
   in `article.instagram.author`.

**Reader treatment:** new `xr-ig-author` block above the post
header shows avatar + handle + verified + display name +
follower/post counts + bio + account category. Whole block links
to the author's Instagram profile so a reader can verify or
cross-reference the source in one click.

**Event tags (Phase 8c entity readiness):**
- `author_handle` — `@reasonmagazine`
- `author_id` — Instagram's stable `pk` identifier
- `author_verified` — `'true'` when applicable
- `author_followers` — count
- `platform_account` — `instagram:reasonmagazine` (generic
  cross-platform identifier; the entity system can match on this
  to deduplicate the same account across captures)

**Provenance chip extension:** the reader header now shows TWO
provenance chips — one for media (`graphql`/`ssr-script`/
`dom-scrape`/`og-meta`) and one for author profile
(`graphql-profile`/`og-meta`). Lets the user see at a glance
whether they got the rich profile or just the og-derived basics.

**Entity classification deliberately deferred.** The article shape
now has the structured data the entity system would need
(`platform_account`, `author_id`, `author_handle`, profile pic,
verified, follower count, biography). Auto-creating an entity
on capture would be a bigger feature touching the whole entity
flow across all platforms, not just Instagram. Worth doing once
the pattern is stable enough to apply uniformly to Twitter
authors, YouTube channels, Substack publications, etc. For now,
the user can manually tag the author via the existing entity
tagger — and when we do auto-create, the data is already there.

**Test count:** 168 → 174 (6 new tests for `extractUserFromGraphQL`:
canonical-path match, recursive walk, multi-user filtering by
username, no-match returns null, falsy `requireUsername`
accepts any user, defensive against false-positives that
quack like users without a `username` field).

Files: [src/shared/platforms/instagram.js:430](../src/shared/platforms/instagram.js:430),
[src/shared/event-builder.js:226](../src/shared/event-builder.js:226),
[src/reader/index.js:705](../src/reader/index.js:705),
[src/reader/index.css:691](../src/reader/index.css:691).

---

## 2026-04-23 — Instagram carousel: accept the SPA-vs-direct-nav split

**Tags:** design

**Context:** Spent considerable time trying to get full-carousel
capture for direct-navigation Instagram posts (where the user
opens the post URL directly rather than clicking through from a
feed). The challenge: Instagram serves direct-navigation pages
with the post payload embedded in a Meta-internal "Lightspeed"
opcode encoding inside `<script>` blocks. The data is THERE, but
not as plain JSON we can parse — it's a binary-ish bytecode where
field names are encoded as integer indices.

**What we tried:**

1. ✅ **api-interceptor + GraphQL response capture** — works
   perfectly for SPA navigation (clicking a post from the
   feed/profile triggers a fresh fetch we capture).
2. ✅ **Recursive JSON parser** — finds the post item anywhere in
   a parsed JSON tree, no matter how deeply nested. Handles SSR
   envelopes that DO use plain JSON.
3. ❌ **SSR script JSON parser** — found 54 candidate scripts on
   the page, none of them had a parseable post item (the data
   was Lightspeed-encoded, not JSON).
4. ❌ **Brute-force regex over `<script>` content for CDN URLs**
   — pulled in 720 URLs (every CDN reference on the page).
5. ❌ **Regex constrained to scripts mentioning the shortcode** —
   got 20 URLs but they were app store badges + related-posts
   thumbnails. The script with the shortcode also has all the
   page chrome URLs intermingled. The shortcode filter just says
   "this script is for a post page" without identifying which
   URLs in it ARE post media.

**Decision: remove the brute-force layer.** Approach #4/#5
produces noise, not signal. Lightspeed-decoding would require
reverse-engineering Meta's opcode table — significant work,
brittle to internal changes, not worth it for a single feature.

**Final priority chain (`src/shared/platforms/instagram.js`):**
- api-hook buffer (GraphQL response) → `graphql` provenance
- SSR script JSON parse → `ssr-script`
- DOM scrape (currently rendered slides) → `dom-scrape`
- og:image (1:1 thumbnail) → `og-meta`

**Honest tradeoff documented for users:**
- **SPA navigation** (click into post from feed/profile/explore):
  full carousel via GraphQL. All slides at full resolution.
- **Direct navigation** (open post URL directly): visible slide(s)
  + screenshot evidence + caption + metadata. The screenshot is
  the always-faithful artifact for what's visible.

This isn't a perfect outcome but it's an honest one. The
infrastructure (api-interceptor + Phase 8a screenshot) makes the
common case (SPA navigation) work, and the screenshot fallback
makes direct-navigation captures evidentiary-grade even with only
one slide.

**Test count:** 178 → 168 (10 tests removed for the dropped
script-regex layer; 16 remain for the rest of the Instagram
handler — URL grammar, og:description parser, meta extractor,
DOM scrape, GraphQL parser including recursive walk).

**So-what:** Some platforms can't be fully captured without
parsing internal binary encodings. Knowing where to stop is
itself a design decision. The screenshot evidence layer makes
"good enough" actually good enough for the truth-system use
case — even one slide + a faithful screenshot is more than the
nothing the userscript could ever produce on Instagram.

Files: [src/shared/platforms/instagram.js:340](../src/shared/platforms/instagram.js:340).

---

## 2026-04-23 — Instagram: api-interceptor wired for full carousel capture

**Tags:** design

**Context:** The DOM-scrape strategy fundamentally can't see all
carousel slides on Instagram — React recycles slide DOM nodes as
the user navigates, so at capture time only the currently-visible
slide is present as an `<img>`. The Phase 8a api-interceptor was
built for exactly this situation; first real wiring lands now.

**Architecture:**

1. **Manifest content_script** loads `dist/api-interceptor.bundle.js`
   into MAIN world at `document_start` for `*://*.instagram.com/*`.
   Document-start matters: Instagram fires its initial GraphQL
   request during page load, before our regular content script
   runs at `document_idle`. Loading via manifest puts the
   interceptor in place first.

2. **`src/shared/api-hook-buffer.js`** — ISOLATED-world listener
   that catches `xr:apihook:event` postMessages from MAIN-world
   interceptor and holds them in a 50-event ring buffer per tab.
   Exposes `findApiHookEvents(predicate)` for handlers to query
   synchronously at capture time.

3. **Content script** (`src/content/index.js`) installs the buffer
   listener and configures the interceptor to capture
   `/graphql/query` and `/api/v1/media/` responses on Instagram
   pages. Other platforms get no interceptor — surface area is
   per-domain.

4. **Instagram handler** queries the buffer for matching responses,
   parses out `carousel_media` via `extractMediaFromGraphQL`, and
   uses the result in preference to DOM scrape. Provenance chip
   in the reader header now reflects which path produced the
   captured media: `graphql` / `dom-scrape` / `og-meta` / `none`.

**`extractMediaFromGraphQL` is the load-bearing parser.** It walks
three known response shapes:
- Current GraphQL: `data.xdt_api__v1__media__shortcode__web_info.items[0]`
- Legacy GraphQL: `data.shortcode_media` (with `edge_sidecar_to_children` for carousels and `display_resources` for resolution variants — translated to current-shape internally)
- REST `/api/v1/media/`: top-level `items[0]`

For each post item, walks `carousel_media[]` if present (carousel),
otherwise treats the item itself as a single media. Per slide,
prefers `video_versions[]` over `image_versions2.candidates`
(if both, the slide is a video and the image is just the cover).
Picks the highest-resolution variant within each.

**Shortcode validation:** the buffer may hold responses from
prior SPA navigations (Instagram is single-page-app routed). The
handler only accepts a buffered response if its `code`/`shortcode`
matches the URL we're capturing — protects against grabbing the
previous post's media into the current capture.

**Test count:** 160 → 166 (6 new tests pinning the GraphQL shapes:
current `xdt_api...web_info`, carousel-of-4 with high-res
selection, video-versions preference over image cover, legacy
`shortcode_media` + `edge_sidecar_to_children`, REST shape,
unrecognized-shape rejection).

**So-what:** Carousel posts now capture all slides at the highest
resolution Instagram serves, regardless of which slide the user
was viewing when they clicked the FAB. The DOM scrape and
og:image fallbacks remain as defense-in-depth — if a future
Instagram redesign changes the GraphQL shape we don't handle yet,
the handler degrades gracefully through the chain.

This is also the proof of concept for Facebook (Phase 8d), which
will use the same interceptor plumbing against
`fb_api_req_friendly_name`-tagged GraphQL responses.

Files: [manifest.json:79](../manifest.json:79),
[src/shared/api-hook-buffer.js](../src/shared/api-hook-buffer.js),
[src/content/index.js:30](../src/content/index.js:30),
[src/shared/platforms/instagram.js:243](../src/shared/platforms/instagram.js:243),
[tests/instagram.test.mjs](../tests/instagram.test.mjs).

---

## 2026-04-23 — Instagram: signed URLs, evidence target, screenshot scope

**Tags:** bug

**Context:** First real test of the carousel-image fix surfaced
three problems:

**Bug 1 — broken images in the captured article.** The 9 captured
image URLs all rendered as broken icons in the reader. Cause:
`canonicalImageKey` stripped the query string for dedup AND
returned the path-only URL as the rendered URL. Instagram CDN's
`?_nc_oh=…&oe=…` query params are signing tokens — without them
the CDN returns 403 to any cross-origin loader (including
`chrome-extension://` origins). Fix: separate the dedup key (path
only) from the returned value (full URL with query string,
first-seen variant wins).

**Bug 2 — 9 wrong images instead of the post's 1.** The `<main>`
fallback in `pickEvidenceElement` was matching the entire
post-detail page including the "More posts from <user>" grid that
Instagram renders below the focal post. That grid has 9
thumbnails, all from the Instagram CDN, all passing our
content-image filters. Result: scraped the recommendation grid
rather than the post itself. Fix: restrict evidence target to
post-specific selectors (`article[role="presentation"]`,
`main article:first-of-type`, `article`), never bubble out to
`<main>` or `<body>`. If we can't find any `<article>` we now
return null and the capture proceeds without the evidence layer
(better than scraping unrelated content).

**Bug 3 — screenshot showed the bottom of the post, not the
content.** Tall posts (caption + comments + hashtags) extend
well past the viewport. `scrollIntoView({ block: 'center' })`
on the post `<article>` puts the *centerpoint* of the article
in viewport center — for a tall article that's somewhere in the
comments section. The screenshot then captured the wrong area.
Fix: new `pickScreenshotTarget` walks the post for the largest
`<img>` or `<video>`, then climbs up to its slide container
(capped at 4 hops). The screenshot now targets just the visible
media region, which is small enough to always fit in the
viewport when scrolled-to-center.

**Carousel limitation re-acknowledged:** Instagram's React layer
recycles slide DOM elements as the user navigates. Even after
the user navigates through all slides, only the currently-visible
slide(s) are present as `<img>`s at capture time. Getting the full
carousel requires either programmatically clicking through (hostile
UX, may fail silently) or wiring the api-interceptor to grab the
GraphQL response with the full media list. The screenshot remains
the always-faithful fallback for the slide that IS in view.

**Test count:** 159 → 160 (1 test rewritten to pin the URL-must-
include-query-string contract; 1 new test to pin first-seen-wins
order across multiple unique images).

Files: [src/shared/platforms/instagram.js:243](../src/shared/platforms/instagram.js:243).

---

## 2026-04-23 — Instagram: image content embed, not just the OG thumbnail

**Tags:** bug, design

**Context:** Real-world test of Phase 8c flagged that captures
were "missing the images" — only the screenshot and caption made
it through. og:image gives us exactly one image (the first/main
one); for carousel posts that loses the other slides, and even
for single-image posts the image was only being shown as a small
header thumbnail rather than embedded in the article body.

**Fix:** New `extractContentImageUrls(imgs)` walks `<img>`
elements inside the post container, filtering to Instagram-CDN
hosts (`cdninstagram.com`, `fbcdn.net`, `scontent-*` subdomains),
rejecting tiny avatars (<200px or `s120x120`-style sizing
variants), and deduping by path (Instagram appends different
cache-busting query params to the same image across loads).

The full image set (og:image first, then anything additional the
DOM scrape found) lands in:
- `article.instagram.images[]` for the reader header
- A new `## Media` section in the markdown body, rendered as
  `![](url)` per image. Single-image posts get no slide labels;
  carousels get `**Slide 1**` / `**Slide 2**` / etc. so the
  reader sees the carousel structure preserved.

**Reels also get a `## Video` section** referencing `og:video`
with an explicit note that Instagram's video URLs are signed and
ephemeral — the cover image and screenshot are the durable
artifacts. We don't try to embed the video bytes (multi-MB,
multi-minute capture, signed URLs that expire within hours).

**What we don't yet capture:** carousel slides the user hasn't
navigated to. Instagram lazy-loads slides as the user clicks
through; the DOM scrape only sees what's been loaded. Two
possible follow-ups:
1. Programmatically click through the carousel before capture
   (hostile UX, may fail silently).
2. Wire the api-interceptor to grab the GraphQL response that
   carries the full media list.

The screenshot evidence layer is the always-faithful safety net
in the meantime.

**Test count:** 152 → 159 (7 new tests pinning the image filter
across Instagram CDN host variants, avatar-by-size filter, the
`s120x120` path filter, and the canonical-key dedup).

Files: [src/shared/platforms/instagram.js:243](../src/shared/platforms/instagram.js:243),
[tests/instagram.test.mjs](../tests/instagram.test.mjs).

---

## 2026-04-23 — Phase 8c: Instagram handler — meta-tag-first capture

**Tags:** design

**Context:** Second hard-tier platform on the Phase 8a stack.
Instagram is harder than TikTok in that there's no equivalent of
TikTok's `__UNIVERSAL_DATA_FOR_REHYDRATION__` — the post page is
SPA-loaded and the DOM is heavily React-obfuscated. But Instagram
emits unusually rich Open Graph + Twitter Card meta tags into the
initial HTML, and those have been stable for years.

**Architectural decision: meta-tags-first, GraphQL never.** The
api-interceptor (Phase 8a) is ready to plug in here, but in v1
we deliberately don't. Reasons:
- OG tags carry the load-bearing data: author display name +
  handle, full caption, like count, comment count, image/video URL,
  canonical URL.
- The api-interceptor adds attack surface (every Instagram page
  load patches `window.fetch`) and timing complexity (the GraphQL
  request fires before the user clicks the FAB, so we'd have to
  inject the interceptor on every page load to catch it).
- The cost-to-value ratio favors waiting until concrete evidence
  shows OG-only is missing something users actually want.

If GraphQL ever becomes load-bearing, the `extractedFrom`
provenance chip in the reader header has a deliberately-permanent
slot for it — when the chip starts saying "graphql" instead of
"og-meta", we'll have a paper trail of which source produced each
artifact in the archive.

**The og:description parser is the trickiest part.** Instagram's
og:description is a structured-but-prose string:
`"<N> likes, <M> comments — <Display Name> (@<handle>) on
Instagram: \"<caption>\""`. The regex `parseOgDescription` handles
the canonical form, missing leading engagement counts, missing
parenthesized handle, smart quotes vs straight quotes, and
em-dash vs hyphen separators. Falls back to "whole string is the
caption" rather than null on unparseable input — better to ship a
caption-without-author than to drop the artifact entirely.

**DOM scrape is intentionally minimal.** Two fields only:
- Post date from `<time datetime>` (ISO-8601, the only stable
  timestamp signal across Instagram redesigns).
- Verified flag from `svg[aria-label="Verified"]` (an ARIA
  contract Instagram has kept stable for years).

Anything else (full caption beyond truncation, comment thread,
follower count, location tag) we deliberately don't try. They're
either covered by meta tags or they're not worth the maintenance
cost of fragile selectors.

**Reader treatment:** mirrors TikTok's video header. Author chip
(verified ✓), engagement counts, post-kind chip (`post`/`reel`/
`igtv`), `extractedFrom` provenance chip, and the same collapsible
"📸 Screenshot evidence" panel. Visual consistency across hard-tier
platforms keeps the reader UX coherent.

**Test count:** 136 → 152 (16 new Instagram tests pinning the URL
grammar across all five recognized shapes + the og:description
parser across canonical/missing-engagement/missing-handle/
smart-quote/unparseable inputs + the meta-field reader with K/M
suffix engagement counts).

**So-what:** Two of three hard-tier platforms shipped. The
three-layer model (structured + HTML snapshot + screenshot)
holds up across both TikTok (rich SSR) and Instagram (sparse SSR)
without architecture changes — validates the Phase 8a foundation.
Facebook is next, and it'll be the real test: no SSR, hostile
DOM, anti-replay GraphQL tokens. Likely the first place we'll
need to actually wire the api-interceptor.

Files: [src/shared/platforms/instagram.js](../src/shared/platforms/instagram.js),
[src/shared/platforms/index.js:36](../src/shared/platforms/index.js:36),
[src/reader/index.js:618](../src/reader/index.js:618),
[tests/instagram.test.mjs](../tests/instagram.test.mjs).

---

## 2026-04-23 — Phase 8b: TikTok handler — first hard-tier platform

**Tags:** design

**Context:** First platform built on the Phase 8a anti-obfuscation
stack. TikTok was deliberately first — its metadata lives in a
server-rendered JSON blob, so structured extraction is robust;
the screenshot path validates the always-works fallback without
depending on the harder GraphQL-interception machinery.

**Three SSR shapes, three keyed paths:**

TikTok serves the same logical data through three different script
tags depending on route + recency:
- `__UNIVERSAL_DATA_FOR_REHYDRATION__` (newest, 2023+) — payload
  at `__DEFAULT_SCOPE__["webapp.video-detail"].itemInfo.itemStruct`
- `SIGI_STATE` (intermediate) — `ItemModule[<id>]` keyed by video id
- `__NEXT_DATA__` (oldest, still on some embeds) — Next.js standard
  `props.pageProps.itemInfo.itemStruct`

`parseSsrState` walks them newest-first; `extractItemStruct` knows
each path. When TikTok ships a 4th shape, `parseSsrState` adds one
line and `extractItemStruct` adds one branch — every existing
extraction continues working.

**Three-layer capture in production:**

The handler composes everything we need from itemStruct (caption,
author, hashtags via `textExtra`, music, view/like/comment/share
counts, duration, cover image), then unconditionally grabs:
- HTML snapshot of `[data-e2e="browse-video"]` (or fallback) via
  `html-snapshot.js`
- Screenshot of the same element via `screenshot.js`

Both land in `article.evidence`. The publish flow already knows
how to surface the hashes as event tags (Phase 8a). The reader's
new TikTok header has a collapsible "📸 Screenshot evidence" panel
showing the captured image inline before publish.

**Reader treatment:** mirrors the YouTube header pattern — thumbnail
+ duration badge + chip row. Chips include author handle (with
verified ✓), engagement counts, music attribution, and an
`sourceShape` provenance chip ("universal"/"sigi"/"nextdata"). The
provenance chip is a deliberately-permanent feature: when TikTok
shifts formats, captures from the old format keep a paper trail
of which shape they came from, useful for debugging archive
reconstructions years from now.

**What we deliberately didn't do:**
- **No comment thread capture.** TikTok's comments are paginated +
  auth-gated; the cost-to-value ratio is poor. Hashtags + caption
  cover the main searchable content.
- **No GraphQL interception.** TikTok's structured data is
  server-rendered, so the fetch-hook machinery isn't needed for
  this platform. It exists for FB/IG, where it'll matter more.
- **No video file capture.** The `video.playAddr` is a signed,
  time-limited URL — embedding it would produce a dead link
  within hours. The cover image is permanent enough to embed
  as the article featured image.

**Test count:** 126 → 136 (10 new TikTok tests pinning the SSR
shapes + extraction paths).

**So-what:** First platform on the new infrastructure validates the
three-layer model. Even if structured extraction fully breaks
(format change, JSON shape drift), the screenshot is still a
faithful artifact + a hash in the event tags. That's the floor we
needed before betting on Instagram and Facebook, where the metadata
extraction will be much more fragile.

Files: [src/shared/platforms/tiktok.js](../src/shared/platforms/tiktok.js),
[src/shared/platforms/index.js:35](../src/shared/platforms/index.js:35),
[src/reader/index.js:617](../src/reader/index.js:617),
[src/reader/index.css:691](../src/reader/index.css:691),
[tests/tiktok.test.mjs](../tests/tiktok.test.mjs).

---

## 2026-04-23 — Phase 8a: anti-obfuscation infrastructure (no platform yet)

**Tags:** design

**Context:** Discovered while planning Phase 8 that the userscript
never actually shipped Facebook/Instagram/TikTok handlers — the
roadmap's "1,629 LOC across the three platforms" was aspirational,
described in `docs/` but not in code. The userscript explicitly
stopped social-media support because of CSP isolation; the whole
point of moving to a WebExtension is to escape that sandbox.

After analyzing what an extension can actually do (service worker
WebSockets bypass page CSP, MAIN-world `executeScript` for hooks,
`tabs.captureVisibleTab` for screenshots, `declarativeNetRequest`
for header rewrites), I proposed a **three-layer capture model**
where every social capture produces:
1. Best-effort structured extraction (DOM + GraphQL interception
   + ARIA fallback + OG meta last-resort)
2. A bounded, sanitized HTML snapshot of the post subtree
3. An element-cropped screenshot

Any subset surviving = a useful evidentiary artifact. The
screenshot is the always-works fallback that makes the system
robust to DOM breakage.

**Phase 8a shipped today:** the three infrastructure modules,
unit-tested in isolation, with NO platform handler wired in yet.
That separation is deliberate — validates the tooling before any
platform-specific bet.

- `src/shared/html-snapshot.js` — clones the subtree, removes
  `<script>` / `<iframe>` / `<noscript>` / etc. + `on*` handlers
  + `data:` URLs in src/href, collapses whitespace, byte-honest
  truncation with a marker. SHA-256 helper for the evidence tag.
- `src/shared/screenshot.js` (content side) +
  `handleScreenshotCapture` (background side) — content script
  scrolls element into view, sends rect to SW, SW does
  `tabs.captureVisibleTab` + OffscreenCanvas crop, returns a fresh
  PNG dataURL. The crop math is split into a pure
  `computeCropBox(rect, dpr, bitmapW, bitmapH)` so the DPR + viewport
  clamping edge cases are unit-testable without spinning up Canvas.
- `src/page/api-interceptor.js` — IIFE injected into MAIN world via
  `chrome.scripting.executeScript`. Wraps `window.fetch` and
  `XMLHttpRequest`; on requests matching URL/header patterns
  configured by the content script, clones the response body and
  posts it back via the same nonce-tagged `postMessage` envelope
  the NIP-07 bridge uses. Pattern matcher extracted to
  `src/shared/api-pattern.js` for unit-testability — the IIFE
  reimplements the logic inline (it can't import — it's the entire
  module). The shared file is the canonical implementation; if the
  inline copy diverges, the unit test catches it.
- New `dist/api-interceptor.bundle.js` build target so the SW can
  inject the file via `executeScript({ files: [...] })` on demand.

**Article shape:** new optional `article.evidence` field carries
`{ screenshot, screenshotHash, screenshotUrl, htmlSnapshot,
htmlSnapshotHash }`. Event-builder emits `screenshot_sha256`,
`screenshot_url`, `html_snapshot_sha256` tags when present;
archive-reader inverse reads them back. The blob bodies live in
event content (or hosted externally referenced by URL); the tags
carry the verifiable refs. Two new tests pin the round-trip.

**Test count:** 96 → 126.

**So-what:** With this infrastructure in place, the next phase
(8b: TikTok handler) can wire the three layers together end-to-end
without re-debating architecture. The screenshot path is the most
load-bearing — it's the layer that makes hard-tier captures
*never* return empty even when the page changes shape under us.

Files: [src/shared/html-snapshot.js](../src/shared/html-snapshot.js),
[src/shared/screenshot.js](../src/shared/screenshot.js),
[src/page/api-interceptor.js](../src/page/api-interceptor.js),
[src/shared/api-pattern.js](../src/shared/api-pattern.js),
[src/shared/event-builder.js:233](../src/shared/event-builder.js:233),
[esbuild.config.mjs:65](../esbuild.config.mjs:65),
[src/background/index.js:374](../src/background/index.js:374).

---

## 2026-04-23 — Pre-release polish: icons, test coverage, Firefox version pin

**Tags:** design

**Context:** Pre-release sweep of the remaining cross-cutting
issues so the next tag isn't carrying obvious gaps.

**#6 icons:** Replaced the placeholder X with a purple-on-purple
X-Ray scan-lens treatment. Source lives at `icons/source.svg`;
`npm run icons` rasterizes to 16/48/128 PNGs via `@resvg/resvg-js`.
The PNGs are checked in alongside the SVG so a fresh clone works
without the dev dep being installed (the script only runs when the
SVG changes).

**#9 test coverage:** Added unit tests for the surface that other
clients depend on or that's easy to silently break:
- `Utils.normalizeUrl` — UTM stripping, port collapse, hostname
  case, trailing slash, fragment removal.
- `EventBuilder` — kind-30078 `d`/`L`/`l` tag shape (matches the
  userscript's pull filter), kind-10002 NIP-65 `r`-tag emission,
  defensive filtering of non-string entries.
- `normalizeRelayUrl` — trailing-slash equivalence, lowercase,
  whitespace trim, the exact `wss://nos.lol` vs `wss://nos.lol/`
  case that broke the relay-adoption prompt.
- `deserializeEntityFromSync` — accepts both X-Ray (16-char id,
  `privateKey`) and userscript (64-char id, `privkey`) shapes,
  normalizes to canonical on output.
- `migrateUserscriptBlob` — full round-trip per key
  (`user_identity` with pubkey-mismatch rejection,
  `entity_registry`, `relay_config` with disabled-row skip,
  `article_claims` merge semantics, unknown-key reporting).

96 tests now (up from 67).

**#10 Firefox version pin:** Verified `strict_min_version: "128.0"`.
Three independent dependencies all land in Firefox 128:
`content_scripts[].world: "MAIN"`,
`scripting.executeScript({ world: "MAIN" })`, and
`declarativeNetRequest` `modifyHeaders` with `responseHeaders`
(used by `rules/csp-strip.json` to enable YouTube transcript
fetching). 128 is also the ESR baseline, so we cover the full ESR
install base. Documented in `CONTRIBUTING.md` so the rationale is
findable next time someone wonders if 128 is too high.

**So-what:** Pre-tag housekeeping. v0.3.0 ships with real branding,
unit-test coverage of the protocol surface, and a documented
Firefox version floor — none of which are individually
ship-blocking, but together they're what separates a release from
a "release-shaped tag."

Files: [icons/source.svg](../icons/source.svg),
[scripts/build-icons.mjs](../scripts/build-icons.mjs),
[tests/utils.test.mjs](../tests/utils.test.mjs),
[tests/event-builder.test.mjs](../tests/event-builder.test.mjs),
[tests/relay-url-normalize.test.mjs](../tests/relay-url-normalize.test.mjs),
[tests/userscript-migration.test.mjs](../tests/userscript-migration.test.mjs),
[CONTRIBUTING.md](../CONTRIBUTING.md).

---

## 2026-04-23 — Release pipeline: CHANGELOG, version sync, tag-driven release

**Tags:** design

**Context:** No CHANGELOG existed. `package.json` and `manifest.json`
each carried a version independently — easy to bump one and forget
the other, producing a `.zip` whose manifest lies about the release
it represents. No automation around tagged releases either; building
a release was a manual `npm run build && web-ext build && upload to
GitHub Releases by hand` ritual.

**Shipped:**

- **`CHANGELOG.md`** in [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
  format. `[0.2.0]` baseline summarizes Phases 0–7 (the work that
  shipped before this session). `[0.3.0]` collects everything from
  this session: Shorts, userscript migration, OS notifications,
  NIP-65 sync, archive sensitivity, NIP-04 fallback, deserializer
  normalization, sidepanel CSS fixes, plus the journal + smoke-test
  docs that landed alongside.
- **`scripts/set-version.mjs`** + `npm run version:set` — bumps both
  `package.json` and `manifest.json` in lockstep. Doesn't touch git
  — the user commits and tags themselves, with a recipe printed
  after the bump.
- **`.github/workflows/release.yml`** — fires on `v*` tag push (and
  on manual dispatch with a tag input). Verifies tag/package/manifest
  versions agree (rejects mismatch — caught early instead of in a
  bad `.zip`), runs the full build + lint + tests, packages via
  `web-ext build`, extracts the relevant CHANGELOG section, and
  publishes a GitHub Release with the `.zip` attached.
- **CONTRIBUTING release section** — five-step recipe from `version:set`
  to `git push --tags`. Includes manual-dispatch escape hatch for
  re-running on an existing tag if a CI run was botched.

**So-what:** Tagging is now the only manual step that produces a
release. Everything else — build, lint, tests, packaging,
release-notes extraction, GitHub Release creation, artifact upload
— is reproducible from CI. The two-version-files-in-lockstep
hazard is fail-fast: CI catches the mismatch before publishing
anything wrong.

Next pieces to layer on top: Chrome Web Store / Firefox AMO upload
automation (would need their respective signing keys as repo
secrets), and CHANGELOG enforcement on PR (a check that any
user-facing change touches the `[Unreleased]` section).

Files: [CHANGELOG.md](../CHANGELOG.md),
[scripts/set-version.mjs](../scripts/set-version.mjs),
[.github/workflows/release.yml](../.github/workflows/release.yml),
[CONTRIBUTING.md](../CONTRIBUTING.md).

---

## 2026-04-23 — Userscript migration importer + native publish notifications

**Tags:** design

**Context:** Two polish items closed in the same session:
- **#3 OS notifications** — publish flow can take many seconds, and
  the user often tabs away mid-publish. The in-page toast disappears
  with the reader; native notifications survive outside the browser
  tab so completion is visible no matter where focus has moved.
- **#7 userscript migration** — every user with userscript history
  was hitting the friction we spent the entire 2026-04-22 session
  debugging (NIP-04 fallback, schema differences, relay-list
  mismatch). A direct importer that takes a JSON blob from the
  userscript's GM_setValue store skips all of it.

**Notifications wiring:** Added a `notify(title, message, level)`
helper in [src/reader/index.js:1672](../src/reader/index.js:1672) that
calls `chrome.notifications.create` with the X-Ray icon. Fired from
three sites: the `showPublishSummary` rollup (success/warning/error
level reflects the relay outcome), and the two publish-error catch
blocks. `notifications` permission was already in the manifest from
day one — just unused until now.

**Migration design:** New
[src/shared/userscript-migration.js](../src/shared/userscript-migration.js)
takes a JSON object whose top-level keys are userscript storage
keys (`user_identity`, `entity_registry`, `relay_config`,
`article_claims`, `evidence_links`) and writes them into X-Ray's
canonical shapes. Schema normalizations from the 2026-04-22 work
are reused: `keypair.privkey → keypair.privateKey`, 64-char entity
ids accepted alongside 16-char, identity privkey is verified
against its claimed pubkey before storage to catch
copy-paste-half-of-the-wrong-key mistakes. Relays merge into the
existing list rather than replacing.

**Migration UI:** New "Migrate" tab on the Options page
([src/options/options.html:104](../src/options/options.html:104))
with a textarea, a file picker, a Migrate button, and a per-key
result panel. Includes an inline "How to get the JSON" expander
that walks through Tampermonkey's storage browser. Existing X-Ray
records merge — never replace — so a partial migration on one
device doesn't clobber unique-to-this-device data.

**So-what:** New userscript users now have a one-click path that
sidesteps the relay-sync friction entirely. They paste their data,
get a per-key receipt, and X-Ray's storage matches the userscript's
state. After migration, normal X-Ray push/pull keeps the devices in
sync without the legacy NIP-04 path mattering.

Files: [src/reader/index.js:1672](../src/reader/index.js:1672),
[src/shared/userscript-migration.js](../src/shared/userscript-migration.js),
[src/options/index.js:236](../src/options/index.js:236),
[src/options/options.html:104](../src/options/options.html:104).

---

## 2026-04-23 — YouTube Shorts: URL recognition + "SHORT" badge

**Tags:** design

**Context:** The FAB did nothing on YouTube Shorts URLs because
`isYouTubeVideoPage` only matched `/watch?v=…`. Shorts URLs are
`/shorts/<videoId>` — a different path entirely. Everything else
(the `ytInitialPlayerResponse` JSON blob, the thumbnail + metadata
extraction, the reader header layout) works for Shorts unchanged.

**Change:**
- New `videoIdFromLocation()` helper centralizes the id lookup —
  handles both `/watch?v=…` and `/shorts/<id>`. `isYouTubeVideoPage`
  now routes through it.
- New `isYouTubeShortsPage()` that downstream code can check. The
  article shape gains a top-level `youtube.isShort` boolean; the
  event-builder emits `['is_short', 'true']` and reads it back on
  archive-reader inverse.
- The reader's video header gains a `SHORT` chip styled in the
  warning color (next to `LIVE` in color weight). Tooltip on the
  chip explains "transcripts rarely available" so the reader
  doesn't wonder where the transcript body went.
- The markdown header swaps `**Video**:` for `**Short**:` when
  `isShort` is true, so a Short event looks honest both in the
  reader and when rendered by any other NIP-23 client.

**What we didn't do:**
- **No transcript heroics.** Shorts don't have a "Show transcript"
  button in their UI, so the DOM-fallback scrape path doesn't
  apply. The SW direct-fetch path against `/api/timedtext` still
  runs — if a Short happens to have captions (rare, mostly on
  Shorts repurposed from longer content), they'll show up. For
  everything else, captures are metadata-only: thumbnail, channel,
  duration, view count, video id. Still a useful NOSTR artifact.
- **No separate content type.** `article.contentType` stays
  `'video'`; `article.platform` stays `'youtube'`. Shorts are
  videos; the `is_short` tag is the differentiator.

**So-what:** The capture-something-on-every-supported-surface
invariant now extends to Shorts. The threshold for "is this worth
capturing" is different — a ~45-second clip with no transcript is a
lower-value artifact than a 20-minute lecture — but the user gets
to decide. Silent FAB-does-nothing was the worst outcome.

Files: [src/shared/platforms/youtube.js:30](../src/shared/platforms/youtube.js:30),
[src/shared/event-builder.js:200](../src/shared/event-builder.js:200),
[src/reader/index.js:576](../src/reader/index.js:576),
[src/reader/index.css:668](../src/reader/index.css:668).

---

## 2026-04-22 — Entity-sync deserializer too strict for userscript payloads

**Tags:** bug, external

**Context:** Sync pull in Edge reported `Fetched 852, Added 0,
Unchanged 82, Malformed 689, Failed 81`. The 689 malformed events
all decrypted cleanly via NIP-44 — they failed *validation* in
`deserializeEntityFromSync`. Only 82 events got through.

**Root cause:** Two field-shape mismatches between the
userscript's payload and X-Ray's deserializer:

1. **Keypair field name.** Userscript stores
   `keypair.privkey`; X-Ray reads `keypair.privateKey`. The validator
   rejected anything without `privateKey`.
2. **Entity id length.** Userscript ids are
   `entity_<64-hex>` (32-byte hash); X-Ray's regex required exactly
   `entity_<16-hex>`. The 689 malformed were all userscript-shaped.

**Fix:** Loosened the validator to:
- Accept `entity_<8..64 hex>` to span both formats (X-Ray's 16 +
  userscript's 64).
- Accept either `keypair.privateKey` or `keypair.privkey` in input,
  normalizing to `privateKey` on the way out so the rest of the
  pull loop only ever sees X-Ray's canonical shape.
- Synthesize `npub`/`nsec` as null when absent (some userscript
  payloads omitted them entirely).

**So-what:** This was the actual blocker for cross-browser sync —
not the AES-CBC quirk, not the NIP-04 fallback, not the relay
list. The user's 689 entities should now flow on the next pull.
Whenever we touch payload schemas, the validator needs to
explicitly handle both the strict X-Ray form and any
userscript-tolerant alternative — they're effectively a wire
protocol now.

Files: [src/shared/entity-sync.js:106](../src/shared/entity-sync.js:106).

---

## 2026-04-22 — NIP-65 relay-list sync, plus per-format pull breakdown

**Tags:** design

**Context:** Cross-browser entity sync kept tripping on relay-list
mismatch — pushing from one browser sends to its local relays, but
pulling on another only sees the relays in *its* local list. The
intersection determines whether anything propagates. Tracked via a
manual "copy textarea contents between Options pages" workaround.
Real fix: travel the relay list with the identity.

**Implementation:**

- New `EventBuilder.buildRelayListEvent(relays, pubkey)` — kind
  10002, `r`-tags per relay, NIP-65-compliant. Other clients
  (Damus, Amethyst, Coracle) can read this too.
- New `pushRelayList` / `pullRelayList` in entity-sync.js. Push is
  signed with the sync identity's nsec, same trust boundary as
  entity push.
- Push button in the sidepanel now publishes both kind-30078s and
  kind-10002 in the same flow. Push-feedback line in the sync log
  reports relay-list publish counts separately.
- Pull button discovers the remote relay list after entities pull.
  If the remote list adds relays not in local, surfaces a
  one-line confirmation — `Add to my list` / `Ignore`. Local list
  is authoritative until the user opts in; we never auto-replace
  to avoid orphaning queries to relays they're about to drop.

**Why per-format pull breakdown:** While debugging Edge's failure
to see Firefox-pushed events, we couldn't tell from the sync log
whether NIP-44 events were arriving but failing silently, or not
arriving at all. The new "Format split: N NIP-44, M NIP-04" line
in the sync log distinguishes the two cases without devtools.

**So-what:** This closes the relay-mismatch class of bugs for
anyone using sync across two devices. Future state: relay editing
on one device propagates on the next pull. The friction floor is
now "click Pull" rather than "manually copy textarea contents".

Files: [src/shared/event-builder.js:354](../src/shared/event-builder.js:354),
[src/shared/entity-sync.js:267](../src/shared/entity-sync.js:267),
[src/sidepanel/index.js:758](../src/sidepanel/index.js:758).

---

## 2026-04-22 — Firefox sidebar: `sidebar_action` alongside Chrome's `side_panel`

**Tags:** external, design

**Context:** In Firefox the "Open entity browser" button opened the
sidepanel HTML in a regular tab instead of as a sidebar. Chrome and
Edge both expose `chrome.sidePanel`; Firefox doesn't (it uses the
WebExtensions-era `sidebar_action` manifest key + `sidebarAction`
runtime API).

**Fix:** Added a `sidebar_action` entry to `manifest.json` (Firefox
recognizes it; Chrome ignores unknown keys) pointing at the same
`src/sidepanel/index.html`. Updated the popup and reader openers to
prefer `browser.sidebarAction.toggle()` when available, then fall
back to `chrome.sidePanel.open()`, then a tab. `open_at_install:
false` keeps Firefox from auto-opening the sidebar on install — it
opens only when the user clicks Entities.

**So-what:** This is the right pattern for any panel-shaped UI we
add later — declare both manifest keys and dispatch on which API
is present at runtime. Don't try to UA-sniff or branch on
`navigator.userAgent`; feature-test the API instead.

Files: [manifest.json:33](../manifest.json:33),
[src/popup/index.js:67](../src/popup/index.js:67),
[src/reader/index.js:1733](../src/reader/index.js:1733).

---

## 2026-04-22 — Entity sync NIP-04 fallback works in Firefox, fails in Edge

**Tags:** bug, external

**Context:** Following the NIP-04 read-fallback fix
(2026-04-21 entry below), the same code that fails to decrypt
userscript-pushed events in Edge succeeds in Firefox. Same code,
same nsec, same ciphertext, same relays — only the browser differs.

**What we ruled out:**

- **Code correctness:** X-Ray's `getPublicKey` and `getSharedSecret`
  match `@noble/curves/secp256k1` byte-for-byte (validated in
  `/tmp/xr-ecdh-real.mjs`). Self-encrypt-decrypt round-trips inside
  Edge succeed.
- **Wrong key on this device:** A push from X-Ray followed by an
  immediate pull decrypts the just-pushed events successfully — the
  privkey on the device IS the right one for self-ECDH.
- **Relay query layer:** Side panel devtools shows EVENT frames
  arriving with the right ciphertext; pull failures are downstream
  of network.

**Remaining suspect:** Edge's `crypto.subtle.decrypt({name: 'AES-CBC'})`
behaves differently than Firefox's on these specific ciphertext +
key combinations — possibly a key-import caching quirk, possibly
Chromium's stricter padding rejection. Reproducible in user's
environment but not deterministic to debug from the project side
without Edge-runtime access.

**Workaround in code:** The NIP-04 path now tries raw-X first AND
SHA256(X) as a fallback (handles both common NIP-04 key-derivation
conventions). Doesn't fix the Edge runtime issue but costs nothing
and unblocks the more common case.

**Workaround for the user:** Pull from Firefox to retrieve the
historical NIP-04-encrypted entities. Once pulled, Firefox saves
them locally. Pushing them back from Firefox produces NIP-44
ciphertext that any browser (including Edge) can decrypt.

**So-what:** WebCrypto AES-CBC behavior across Chromium and Gecko
isn't always interchangeable for hostile/legacy ciphertext. Log
this for the next time we lean on `crypto.subtle.decrypt` for
non-self-produced data.

Files: [src/shared/entity-sync.js:185](../src/shared/entity-sync.js:185).

---

## 2026-04-21 — Entity sync pull: NIP-04 read-fallback for userscript events

**Tags:** bug, external

**Context:** First real attempt to pull entities from relays returned
"+0 added, 0 updated" despite the user's npub having 50+ kind-30078
sync events on damus.io and 400+ on nos.lol. Direct relay probe
confirmed the events existed and were properly tagged
`L: nac/entity-sync`. Side panel devtools console showed
`pull decrypt failed for event ... atob ... not correctly encoded`
for every event.

**Root cause:** The userscript (v4.x, the upstream this is being
ported from) pushes entity-sync events with **NIP-04** encryption
(AES-256-CBC, payload format `<base64-ciphertext>?iv=<base64-iv>`).
X-Ray's `pullEntities` only attempted **NIP-44 v2** decryption, which
expects pure base64. The `?iv=` segment broke `atob` immediately on
every event.

The original journal block in `entity-sync.js` literally said:
> "A deliberate simplification: NIP-04 read-path fallback for events
> produced by pre-NIP-44 userscript versions is NOT implemented here.
> Real-world need is effectively zero."

It wasn't zero. The first user with userscript history hit it on
their first pull.

**Fix:** Detect the `?iv=` suffix in event content; route legacy
events to `nip04Decrypt` with the raw ECDH shared secret (computed
once up-front via `getSharedSecret(userPrivkey, userPubkey)` —
self-ECDH, the same input as NIP-44's conversation-key derivation).
Push remains NIP-44 only — userscript v4.x reads NIP-44 fine, so
there's no compat issue in the other direction. Pull's return shape
gained `legacyNip04` count; the sync log surfaces it as
"(N legacy NIP-04)".

**Diagnostic instrumentation added in the same patch session:** the
sync log now shows per-relay event counts (received + EOSE status),
so the next "0 events" mystery resolves in one click instead of
needing a custom WebSocket probe script.

**So-what:** Any userscript user porting to X-Ray will have
NIP-04-encrypted history on relays. The fallback is permanent —
deleting it would re-break first-pull for every userscript migrator.
If we ever do a clean break, the warning needs to come with a
"re-push under NIP-44" affordance.

Files: [src/shared/entity-sync.js:185](../src/shared/entity-sync.js:185),
[src/sidepanel/index.js:758](../src/sidepanel/index.js:758).

---

## 2026-04-21 — Archive banner: new "always" default, sensitivity setting

**Tags:** design

**Context:** The Phase 7 archive banner used a hardcoded "≥1.3× longer
AND >1000 chars" threshold for both cache and relay paths. That
threshold existed to suppress firing on Twitter (single tweets are
~280 chars, so any relay-published copy is the same content but the
length math always tripped). Side effect: the banner was *also*
hidden in legitimate cases — a re-capture where the archived copy was
shorter or the same length but textually different (edited title,
re-extracted with a different paywall workaround) wouldn't be
offered.

**Change:** Replaced the length-only heuristic with a content-equality
check, and exposed the choice as a preference.

- New default is `'always'`: show the banner whenever an archived copy
  exists and isn't byte-identical or a strict substring of the current
  capture. Skipping strict-substring matches handles the Twitter case
  cleanly — the relay-published tweet body is fully contained in the
  reader's current body, so it's silently filtered.
- `'richer'` keeps the prior 1.3×/1000-char rule, for users who only
  want the banner when an archive looks like a paywall unlock.
- `'never'` is an escape hatch.

The setting lives under Options → Advanced → Archive banner. Default
is `'always'` if the preference is missing, so existing profiles get
the new behaviour without touching settings.

**So-what:** The metric line in the banner is now derived from the
actual length comparison rather than always saying "Nx longer", so
short archives surface honestly ("Archive is 412 chars shorter")
instead of silently being filtered. If the always-on default proves
noisy in practice (re-captures of the same article producing
near-identical bodies that aren't strict prefixes due to whitespace
drift), the next move is to compare normalized-whitespace hashes
rather than raw strings.

Files: [src/reader/index.js:167](../src/reader/index.js:167),
[src/options/index.js:209](../src/options/index.js:209),
[src/options/options.html](../src/options/options.html).

---

## 2026-04-21 — Browser-aware agent can drive part of the smoke test

**Tags:** design, pattern

**Context:** Tested whether a Chrome-MCP-aware agent could run the
smoke checklist solo against Edge. Proof of concept: drove a
YouTube capture (`pOlZ-E7tgCQ`) start to finish from the agent —
navigate → wait for init → find FAB → click → wait → read console.

**What worked:**

- Connecting to Edge (Chrome MCP works fine against Edge with the
  helper extension installed).
- Verifying the content script loaded (read_console filtered by
  `X-Ray`). The `[X-Ray] NIP-07 extension detected` log line
  doubles as confirmation of the polish-#2 fix landing live.
- Finding the FAB by natural-language query — `find("X-Ray Capture
  article FAB floating button bottom right")` matched first try.
- Clicking, waiting, re-reading console for the full capture
  pipeline. The `extracted N events from N segments` line gives
  us the dedup-fix sanity check for free (1:1 ratio = healthy).

**Hard limit found — reader tab outside MCP group:**

The capture pipeline ends with the SW calling
`chrome.tabs.create({ url: 'chrome-extension://…/reader/…?id=<uuid>' })`.
That tab opens in whatever window/group makes sense for the user,
NOT the MCP-managed tab group the agent owns. So the agent can't
navigate inside the reader tab to verify content unless the user
manually drags it into the group.

This isn't a bug in either X-Ray or the MCP — it's an architectural
intersection. Workarounds:

1. User drags the reader tab into the MCP group after each capture.
2. Add a SW message handler `xray:smoke:export-state` that returns
   the latest article from `chrome.storage.session` so the agent
   can read full state via a content-script eval. Considered for
   future automation work; not needed for the lightweight loop.

**Implication codified:** `docs/SMOKE_TEST.md` now has an
"Agent-runnable subset" section explicitly listing what the agent
can verify solo and what it must hand off. Useful when iterating
on a single platform handler — gets fast regression coverage on
the parts that historically break (DOM-scrape selectors, focal-
tweet detection, init-sequence completeness) without burning
human time. Full reader / publish / sidepanel verification still
requires the human checklist.

---

## 2026-04-21 — Twitter capture: focal-tweet id leaked through as the literal string "null"

**Tags:** bug

**Symptom:** First successful Twitter capture after the focal-tweet
detection fix landed (entry below). Reader opened with the right
title, byline, body content, even thread detection — but the URL
field read `https://x.com/TheAmolAvasare/status/null`. String
templating against `focal.id === null` produced the literal "null".

**Root cause:** Two-step lookup — `waitForFocalTweet` had an id-
backfill in its third fallback path (when `tweets[0]` is the focal
tweet but its extracted id is null), but path 1 (matching against
ANY anchor descendant for `/status/<id>`) returned `extractTweet(el)`
directly without backfill. And `extractTweet` only harvested the id
from `<time>.closest('a')`, which doesn't exist on the focal tweet
because clicking the focal timestamp would reload the same page.

So path 1 found the focal element via the share-button anchor,
returned an extracted tweet with id=null, and synthesizeArticle
built the canonical URL as `${handle}/status/${null}` →
`.../status/null`.

**Fix:**

1. `extractTweet` now has an id-extraction fallback: if the
   `<time>` anchor doesn't yield an id, scan all
   `a[href*="/status/"]` anchors in the tweet and use the first
   matching id. Share / copy-link buttons reference the canonical
   id even when the timestamp doesn't.
2. `synthesizeArticle` defensively backfills `focal.id` from the
   pre-parsed `focalId` and constructs `focal.url` if missing — so
   `null` can never reach URL composition even if a future DOM
   shift breaks both extraction paths.

**Bonus fix:** the Phase 7 archive banner was firing on every
Twitter capture because the relay-reconstruct path only checked
`currentLen < 1500` (always true for short-form content like
tweets) and didn't compare the reconstructed length against the
current. Tightened to "1.3× longer AND ≥1000 chars" — same
threshold the cache path uses. Banner now only fires when the
relay version is meaningfully bigger than what we just captured.

---

## 2026-04-21 — Twitter/X focal tweet not found in DOM

**Tags:** bug, external

**Repro URL:** `https://x.com/theamolavasare/status/2046724659039932830`.

**Symptom:** First Twitter capture after Phase 3c shipped — handler
logged `focal tweet not found in DOM` and bailed; reader fell through
to Readability (got *something* usable but missed the structured
Twitter shape — no thread detection, no engagement metrics, comments
not separated from thread continuation).

**Root cause(s) — two compounding:**

1. `pickTweetElements()` only matched `article[data-testid="tweet"]`.
   On a status detail page X may now wrap the focal tweet in a
   different testid container (`tweetDetail`, `cellInnerDiv`, etc.).
   No reproduction in our DOM, but the symptom matches.
2. `waitForFocalTweet()` looked for the URL's status id by walking
   `time → closest('a').href`. On the focal tweet's *own* status
   page, X often renders the timestamp as plain text (clicking would
   reload the same page) — so no enclosing anchor exists, so
   matching failed even with the focal tweet right there.

**Fix:** `09f99ab`-style defensive layering:

- Priority-ordered selectors in `pickTweetElements`: strict testid →
  alternative testids → `article[role="article"][tabindex]` → loose
  `main article` filtered by presence of `<time>`.
- `waitForFocalTweet` now: matches against ANY anchor descendant
  (not just the timestamp), then falls back to "any tweet whose
  extracted id matches", then to "the first tweet on a status page
  is the focal one by convention" with id backfilled from the URL.
- Loud diagnostic when no focal tweet found: logs candidate count,
  interesting `data-testid` inventory, and the first candidate's
  outerHTML — same shape as the YouTube extraction diagnostics. A
  user paste should be enough to add a targeted selector for the
  next X UI rewrite.

**Pattern note:** Second platform-specific DOM bug after the YouTube
3× duplication. Both fixed by the same defensive recipe (strict-first
selectors with loose fallback + loud diagnostics on miss). The
`pattern/youtube-arms-race` entry below now generalizes to all
DOM-scraped platforms — Twitter / X qualifies for the same
expectations.

---

## 2026-04-21 — YouTube transcript: 3× cue duplication in the new DOM

**Tags:** bug, external, pattern

**Commit:** `09f99ab`. **Repro URL:** `watch?v=u-vMNzHgSHI`.

**Symptom:** Console showed `found 6374 transcript segments, extracted
1818 events` — a ~3.5× segment/event ratio. Output: each paragraph's
text rendered three times verbatim, one after the other.

**Root cause:** Two compounding DOM issues in YouTube's new transcript
panel:

1. **Virtualization / a11y shadow rendering** emits N copies of each
   `<transcript-segment-view-model>` for the same cue.
2. Our selector had a loose `[class*="transcript-segment" i]` fallback
   that matched wrapper elements in addition to real segments, so a
   wrapper-plus-its-children showed up as distinct matches.

**Fix:** Three layered defenses in `src/shared/platforms/youtube.js`:

- Priority-ordered selectors — strict element-name selectors first,
  fall through to the fuzzy class-substring match only when the
  strict ones return zero. Filter out nested matches in the fuzzy
  path.
- Intra-segment dedup inside the text walker — drop repeated text
  strings within a single segment.
- Cross-segment dedup on `(startMs, text-prefix-64)` — if the same
  cue appears as N sibling DOM segments, only one event survives.

Also added a new diagnostic: `high segment/event ratio` warning that
logs the first segment's outerHTML when the ratio exceeds 3×.

**Pattern note:** This is the fifth YouTube DOM churn we've absorbed
in ~18 months. See the `pattern/youtube-arms-race` entry below for
the strategic framing.

---

## 2026-04-21 — Journal started

**Tags:** design

Formalized this document. Prior to today the project history lived
in commit messages + GitHub issue comments + `docs/ROADMAP.md`. Those
are still the canonical trackers for *what* shipped; the journal is
for the *why* and the *what-surprised-us* — the tacit context that
makes the next bug faster to diagnose.

---

## 2026-04-20 — Phase 6: encrypt-to-self for entity sync

**Tags:** design

**Commit:** `9c13598` (Phase 6).

**Decision:** Entity sync encrypts each entity payload via NIP-44 v2
with a conversation key derived from
`ECDH(userPrivkey, userPubkey).x` — the user as both endpoints.

**Why:** Cross-device sync needs the entity's private key to travel
between devices. Relays should never see it. The obvious approach is
encrypt-to-self; the less obvious question is *which* key to
encrypt with.

**Constraint:** NIP-07 extensions (Alby, nos2x) don't expose the
user's raw privkey to third-party code. We can't use the primary
NIP-07 identity for NIP-44 encryption unless the extension exposes
`nip44_encrypt` / `nip44_decrypt` methods (some do, some don't —
inconsistent).

**Decision:** Phase 6 requires the user to explicitly provide an
`nsec` that X-Ray stores in `LocalKeyManager` under a reserved slot
`xray:user`. Sync uses that key for encrypt + sign. Article publish
continues to route through NIP-07.

**Cost:** Security trade-off made explicit in the sync-panel
warning — the nsec sits in `chrome.storage.local`, which has the
same trust properties as any extension with the `storage`
permission. We warn on the settings UI every time.

**Future:** When NIP-07 `nip44_*` methods become widespread we can
add a second path that avoids the stored nsec. Tracked as a
"later polish" in the Phase 6 closure comment on issue #17.

---

## 2026-04-20 — Phase 5: claim + evidence-link ID scheme

**Tags:** design

**Decision:** Deterministic hash-based IDs for both:

- `claim_<sha256(source_url + '|' + normalized_text).slice(0, 16)>`
- `link_<sha256(source + '|' + target + '|' + relationship).slice(0, 16)>`

Text/URL normalization (whitespace collapse, casefold) so cosmetic
differences don't generate distinct IDs.

**Why:** Matches the entity-model pattern (Phase 4). Idempotent
creation — calling `create()` twice with the same inputs returns the
same record. Enables NIP-01 replaceable-event semantics: a claim's
kind-30040 event is addressable by `(pubkey, d=claim_id)`, so
republishing the same claim (after an edit) replaces the old event
rather than accumulating duplicates.

**Cost:** Source of a subtle issue — editing the text of a claim
breaks id derivation. Mitigation: text + source_url are immutable
under `update()`; change them via delete + recreate. This is
signposted in the modal's "text is immutable after creation" hint
for edit mode.

---

## 2026-04-20 — Phase 4: alias-graph flattening

**Tags:** design

**Commit:** `c57d5e3` (Phase 4 C1).

**Decision:** `EntityModel.linkAlias(A, B)` doesn't just set
`A.canonical_id = B` — it follows B's canonical chain to the root
first and points A at *that*. So the entity graph stays shallow
(always depth 1, never a deeper chain).

**Why:** Without flattening, a user can construct:

    A → B → C → D → … → root

`resolveAlias` would walk the chain. That's O(depth), and any cycle
introduced mid-chain is a wedge — we'd have to detect cycles at
resolution time on every publish.

With flattening, every alias points directly at the canonical root.
Resolve is O(1). Cycle detection only runs at `linkAlias` time, not
on every hot read.

**Cost:** The `canonical_id` field loses its "which *immediate*
canonical did the user pick" information. We decided we don't need
it — the user cares whether two entities are aliased, not about
intermediate picks.

---

## 2026-04-19 — pattern: YouTube DOM arms race

**Tags:** pattern, external

**Observation:** Each fix we ship to YouTube capture is valid until
the next UI rewrite. The cadence is roughly "every few months".

**What we've hit** (chronological):

- **mid-2024** — PO-token gating on `/api/timedtext` endpoint.
  Signed URLs start returning HTTP 200 with 0-byte bodies. This was
  deliberate anti-scraping, widely discussed in yt-dlp circles.
- **late 2025** — `ytd-transcript-segment-renderer` custom element
  renamed to `transcript-segment-view-model`. Incidental (kevlar UI
  refactor); selectors broke.
- **late 2025** — Visible timestamps wrapped in
  `<span aria-hidden="true">` because the accessible version lives
  on the parent button's `aria-label`. Genuine a11y pattern, not
  anti-scraping. Our too-aggressive aria-hidden filter dropped the
  timestamps; we removed the filter.
- **late 2025** — Transcripts pre-loaded via `ytInitialData` instead
  of a live `/youtubei/v1/get_transcript` POST. Performance
  optimization. Defeats our fetch-hook strategy because the event
  never fires.
- **2026-04-21** — 3× cue duplication in the DOM (the entry above).

**Strategic takeaway:** Treat ALL DOM-scraped platforms as perpetually
fragile (X, Substack-DOM-fallback, Phase 8 hard-tier targets all
qualify, not just YouTube). Investing in *specific* resistance to any
given change is wasted effort — the change will be obsolete in a
quarter. Invest in the *defensive pattern*:

1. **Multiple strategies** with explicit priority ordering — signed-URL
   fetch → fetch-hook → DOM scrape.
2. **Loud diagnostics** at every stage boundary — `[X-Ray YouTube]`
   logs that narrate which path ran and what it found. A user
   pasting their console output should be enough to diagnose the
   next regression in under a minute.
3. **Defensive selectors** — prefer strict element names over class
   substrings; dedup aggressively; sanity-check ratios.
4. **Fail gracefully + visibly** — if all strategies fail, the error
   message names the likely cause so the user knows whether to wait
   for a fix or file a bug.

The same pattern will apply when we eventually tackle
Facebook/Instagram/TikTok (Phase 8). React Fiber walking + API
interception are deliberately anti-scraping-hostile and change
faster than YouTube.

---

## 2026-04-19 — Phase 3b: PO-token discovery + DOM-scrape fallback

**Tags:** bug, external

**Commits:** `bbc7ac3` → `fb2f2ce`.

**Symptom:** YouTube transcript capture returning empty. `/api/timedtext`
responses were HTTP 200 with 0 bytes, even with the signed baseUrl
embedded in `ytInitialPlayerResponse`, Referer rewritten to
`https://www.youtube.com/`, and cookies attached.

**Root cause:** Since mid-2024, YouTube gates timedtext on a
proof-of-origin token (PO-token) generated by the page's JS challenge
system. Without it, every request — including from the page's own JS
context — returns 0 bytes.

**Approaches tried (all failed):**

- declarativeNetRequest Referer rewrite
- `X-YouTube-Client-Name` / `X-YouTube-Client-Version` headers
- Page-world fetch injection via `chrome.scripting.executeScript({ world: 'MAIN' })`
- Four URL format variants (`fmt=json3` / `xml` / `srv3` / `vtt`)
- InnerTube `/youtubei/v1/get_transcript` fetch-hook

**Solution:** DOM-scrape YouTube's own "Show transcript" panel. The
UI loads the transcript data via the same InnerTube calls that are
PO-token-gated, but from the page's own client context where the
token exists. We can't participate in the token exchange, but we can
read the data after YouTube has rendered it.

**Strategic consequence:** The `/api/timedtext` and fetch-hook paths
are kept as cheap fast-paths but are expected to fail on most
captures. The DOM scrape is the de-facto primary path. Our error
messaging was updated to signal "this is the designed path, not a
degraded fallback."

---

## 2026-04-19 — Phase 0 decision: scrap v1 URL-metadata stack

**Tags:** design

**Commit:** `52ed35c`.

**Decision:** Remove the v1 URL-metadata UI (annotation highlights,
trust-score badges, debunk banner, kinds `32123..32144`) instead of
porting them forward.

**Why:** X-Ray was ported from `nostr-article-capture` userscript
v1.8.0. The userscript has since been rewritten twice and is now at
v4.2. v1-era features were built around a data model that v4
explicitly deprecates. Porting them forward and then immediately
deprecating them would be wasted work.

**What replaces them:** Nothing immediately visible. The v4 model
centres on entities + claims + evidence — a knowledge-graph stack
rather than a URL-metadata badge. That came online in Phases 4–6.
The user-visible surface looks smaller for now; the plumbing
underneath is richer and accumulates value over time.

**Cost:** Some short-term feature regression against the userscript.
Acceptable per the v4.2-parity roadmap's explicit "Phase 0 scraps v1".

---
