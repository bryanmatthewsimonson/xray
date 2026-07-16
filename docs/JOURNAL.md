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

## 2026-07-16 — Tag pushes refused by the remote-exec git proxy (v0.7.0)

Tags: `external`.

Cutting v0.7.0: the release PR (#155) merged normally, but `git push
origin v0.7.0` came back HTTP 403 — the managed remote-execution
environment's git proxy only accepts pushes to the session's designated
work branch, and `refs/tags/*` falls outside that. Deterministic, not
transient — and the environment's permission layer also (correctly)
refused an attempted workaround of creating the tag server-side via a
new Actions workflow: the branch restriction is intentional, not an
oversight to engineer around. Resolution: **the maintainer pushes the
release tag from a local clone** (`git fetch origin main && git tag
v0.7.0 <merge-sha> && git push origin v0.7.0`), which fires
`release.yml` normally. So-what for future releases prepped from a
remote session: the tag step is maintainer-local by design; everything
up to it (version bump, lockfile sync, CHANGELOG roll, release PR) can
be prepped in-session. Runbook §3 notes this.

---

## 2026-07-16 — Rotation warnings + recovery UX (Phase 24.3)

Tags: `design`.

The Phase-24 tail: the rotation-consequence gap flagged in the 24.0
research (identity-profiles.js documented the orphan/misattribution
risks in a source comment; no UI ever said so) is closed — every
primary-identity switch/generate/import path (Options × 3, sidepanel
generate) now confirms with the enumerated consequences. Options gains
"Restore entity keys" (the restoreDerivedKeys surface). The kind-0
`about` now OPENS with the maintainer line when publishing — note this
changes profileContentHash for every entity, so the first republish
after 24.3 re-emits every profile once (correct: the content genuinely
changed).

---

## 2026-07-16 — Creator binding on the wire (Phase 24.2)

Tags: `design`.

The binding layers from ENTITY_IDENTITY_DESIGN §4: the kind-30069
OwnedKeys manifest + NIP-26 delegation tags + the creator p-tag, with
the portal's full/partial/unbound classification.

Decisions worth remembering:
- **schnorrSignHash/schnorrVerifyHash extracted from
  signEvent/verifySignature** — NIP-26 tokens sign
  sha256("nostr:delegation:…"), not an event hash. The refactor is
  guarded by the BIP-340 vector tests (they pin the signature math).
- **The token window is generous (365d), because the MANIFEST is the
  revocation lever.** NIP-26's expiry-only revocation is exactly its
  weakness; we don't pretend the window revokes — republishing the
  manifest without the key does.
- **Verification fails closed on unknown condition grammar** — a
  condition term we don't parse rejects the token rather than being
  skipped (an attacker must not smuggle permissive conditions past the
  verifier).
- **Delegation minting is Local-mode-only** (needs the primary PRIVATE
  key; NIP-07/bunker keep it in the signer). Those setups still bind
  via the manifest — which only needs a signature, not the raw key.
  The manifest publish itself is also primary-signed and
  fingerprint-gated (owned-pubkey-set hash in storage) so replaceable
  republish only happens on change.
- **Binding is enrichment, never a gate**: attach/mint failures warn
  and continue; absence classifies as "unbound", not "invalid".

---

## 2026-07-16 — Entity identity: the NIP-26 decision + derivation (Phase 24.0/24.1)

Tags: `design`.

The maintainer wanted entity keys durable and creator-bound, leaning
NIP-26 but asking for the tradeoffs first. Research (NIP-26 spec +
"unrecommended" annotation + fiatjaf's critique; NIP-06/41/46/48/51
alternatives; mostr prior art) + a codebase audit produced
docs/ENTITY_IDENTITY_DESIGN.md and a maintainer-confirmed decision:
the LAYERED model — the three candidate models solve different
sub-problems and compose.

Decisions worth remembering:
- **NIP-26's ecosystem failure doesn't apply to a self-consumer.** The
  objections that killed it (generic clients see random keys; relays
  must honor delegator-as-author) are about OTHERS implementing it.
  X-Ray verifies its own tokens. But NIP-26 alone fixes neither
  durability (keys stay random) nor revocation (none exists) — hence
  the layers.
- **Derivation recipe is pinned by test vector.** HKDF-SHA256(ikm =
  primary priv, salt = 'xray-entity-v1', info = `${entityId}:${ctr}`)
  mod n. The domain string is versioned — a recipe change means a NEW
  domain, never a silent change (every derived pubkey depends on it).
  tests/key-derivation.test.mjs pins parent 11…11 → child 371e815d….
- **Stored key always wins.** installDerivedKey has importKey's
  CONFLICT semantics; legacy random keys are never overwritten, no
  forced migration. restoreDerivedKeys re-derives only MISSING keys and
  honestly reports that legacy-random entities come back with a NEW
  pubkey (that discontinuity is inherent to random keys, not created by
  us).
- **The entity id being deterministic (sha256 of type:name) is what
  makes derivation total**: same primary + same entity type/name ⇒ same
  pubkey with no stored state at all.

---

## 2026-07-16 — Publish the corpus brief (Phase 23.2b — portal wiring)

Tags: `design`.

Wired the 23.2a builders into the portal: a "Publish brief…" button on
the case dashboard signs both artifacts with the USER's primary identity
(`Signer.signEvent`, not the entity keys) and publishes via
`xray:relay:publish`, and a new **Briefs** library tab reads them back.

Decisions worth remembering:
- **Signed by the user, published from the portal.** Unlike entity
  profiles (signed by the entity key), the brief is the user's synthesis
  — `Signer.signEvent` (Local mode; NIP-07-in-portal stays the known
  limitation) then the already-signed `xray:relay:publish` path. Relays
  resolve from `Storage.preferences.default_relays` else FALLBACK_RELAYS.
- **memberIndex from the live member units, not the stored record.** The
  stored brief keeps only a member COUNT, so the publish action rebuilds
  `{article_hash → {url, title}}` from `buildMemberUnits` (always in
  scope on the dashboard) — so quote source-links work for a stored
  brief too, not just a fresh run.
- **The 30023 brief routes to Briefs, not Articles.** `buildItem`
  detects the `xray-case-brief` `t` marker and re-routes; a normal
  article without it stays an Article. Both the readable 30023 and the
  structured 30068 land in the same Briefs tab.
- **Left OUT of `LEDGERED_KINDS` on purpose.** The publish doesn't write
  a local publish-ledger entry, so 30068 stays "no-ledger" (neutral)
  rather than being mislabeled "remote-only" against an absent ledger.

---

## 2026-07-16 — Publish the corpus brief (Phase 23.2a — builders)

Tags: `design`.

The Phase-20 corpus synthesis was expensive to generate and died on the
maintainer's disk. 23.2 publishes it in TWO forms so a stranger with
only a keypair can read the insights: a readable kind-30023 long-form
article (any NOSTR client renders it) AND a structured kind-30068
`CaseBrief` (X-Ray renders it richly). This slice (23.2a) is the pure
builders + parser + wire spec; the portal publish action + read-back is
23.2b.

Decisions worth remembering:
- **The Phase-20 "no wire kind" decision is superseded, NOT the
  firewall.** 30068 carries the brief's prose fields (summary /
  positions / cruxes / load-bearing / gaps) with NO fused score, NO
  verdict, NO numeric slot — a guard test greps the built event for a
  score-like field. "No wire kind" meant "no scored kind"; a
  firewall-respecting structured kind is fine. Both artifacts state in
  prose that they are a map, not a ruling.
- **`proposals` never publishes.** The local brief's proposals array is
  reviewer-facing edit suggestions; `publishableBrief` strips it from
  both artifacts.
- **Cross-link by COORDINATE, not event id.** The article and the 30068
  both use `d = xray-brief:<caseId>` and reference each other by
  `a`-coordinate, sidestepping the sign-order chicken-and-egg (neither
  id exists until signed).
- **Members referenced by content hash + coordinate.** Every quote names
  its member `article_hash` (the `#x` join X-Ray uses everywhere); when
  the portal can resolve a member's published address it also emits an
  `a … member` coordinate so an X-Ray reader can open the source.
- **Built directly, not via `buildArticleEvent`.** That path injects a
  live "Archived" date (non-deterministic) and derives the d-tag from a
  URL — the brief wants a stable `xray-brief:<caseId>` d-tag and a
  deterministic body, so corpus-publish.js builds the 30023 event
  itself.

---

## 2026-07-16 — Source-type provenance (Phase 23.1)

Tags: `design`.

Phase 23 opens the "publish the corpus + evidence provenance" arc. First
slice: mark what KIND of source a capture is, so a primary paper is
distinguishable from an article that cites it (the maintainer's
Proximal-Origins example).

Decisions worth remembering:
- **Two orthogonal axes, not one.** `source-type` (what it IS: primary
  record/research vs reporting/analysis/reference) is separate from the
  existing `tier-1/2/3` evidence ladder (how well-sourced a specific
  claim is) and from `content_format`/`media` (what MEDIUM). Conflating
  them was the trap; the research (library taxonomy + CiTO + PROV + EBM
  hierarchies) confirmed they're distinct dimensions.
- **User-declared, never inferred.** `suggestSourceType` reads scholarly
  ids + schema.org `@type` as a HINT shown in the dropdown; the tag only
  emits what the user confirms — the same posture as the Phase-22 media
  tag. A DOI/arXiv `i` tag is itself the machine-checkable originality
  proof; the human declaration complements it.
- **Tag-side field, no body-hash change.** `article.source_type` rides
  the reader's Media dialog like `media`/`podcast` (22.2) — declaring it
  on an already-published capture doesn't touch the `x` hash.
- The `link` evidence-role axis (per-link citation intent, CiTO subset)
  is the companion 23.1b slice.

23.1b landed the second axis: the `link` tag's optional 4th positional
carries the citation intent (`evidence`/`mention`/`supports`/`disputes`/
`reviews`). Gotcha worth remembering: `reconstructArticleFromEvent`
reads roles from `tagArrays['link']`, which stores tags with the leading
NAME STRIPPED — so the role is `v[2]`, not `v[3]`. The portal inspector,
reading raw `event.tags`, correctly finds it at index 3. Same value,
two indices depending on whether the tag name is present. Roles are
tag-side (the `link` tags carry them), so declaring them never changes
the body hash.

---

## 2026-07-15 — LLM-suggested claims missed the transcript speaker (22.3)

Tags: `bug`.

The manual Add-claim path prefills "who said it" from the selection's
enclosing paragraph (21.2), but LLM-accepted claims set the source once
per review session to the article-BYLINE entity — on a transcript,
every accepted claim was attributed to the host. Root cause: a claim
proposal carries only a grounded verbatim `quote` (no paragraph
context), and the accept path never re-derived one.

Fix shape worth remembering:
- **Quote → paragraph re-derivation at accept time**: extracted the
  Range-building half of `locateQuoteInBody` into `rangeForQuote`
  (no selection/scroll side effects), then reused the tagger's
  `extractParagraphContext` (now exported) — so the LLM path feeds
  `speakerFromParagraphText` the *same rendered-paragraph substrate*
  the manual path gets. One resolution grammar, two entries.
- **Free-text fallback keeps the no-mint rule**: `ClaimModel.source`
  models entity id | free text | null. An unmatched speaker name lands
  as free text — attribution without bulk-accept minting entities.
- The `!input.source` guard in llm-review is the seam; the builders
  (`buildClaimInput`/`buildFactInput`) never emit `source`, now pinned
  by test so the guard can't be silently starved.

---

## 2026-07-15 — URL-first media metadata + reader transcript attach (Phase 22)

Tags: `design`.

The maintainer's reframe, hours after Phase 21 merged: the URL is the
identity. A podcast has a URL at Spotify/Apple/Substack/YouTube/custom
sites; "podcast" (or "video") is metadata a USER declares on that URL's
capture, and the transcript should attach to the capture in the reader
— not form a separate import-first record. Phase 21's portal import
stays as the no-URL fallback.

Decisions worth remembering:
- **`media` is a declaration, `content_format` is provenance.** A
  Spotify episode page captured as an ordinary article keeps
  `content_format: article` and gains `media: podcast`. Whitelisted in
  BOTH wire directions — an unknown value on read-back reconstructs as
  absent, so a forged tag can't smuggle a string into the article
  object.
- **The attach branches on the canonical side.** Ordinary captures are
  HTML-canonical (`isMarkdownCanonical` is pdf/transcript-only), so the
  section upserts as RENDERED HTML into `article.content`; pdf/
  transcript imports upsert markdown into `article.markdown`. The
  htmlDraft is deliberately NOT folded in first — the live body carries
  entity-mark spans, and folding them into `article.content` would
  double-wrap on the re-render's rehydrate pass. A markdown-tab edit
  (`dirtySource === 'markdown'`) IS folded first: mark-free and
  canonical by contract.
- **The bounded upsert keys on the BARE heading.** `^## Transcript$`
  (markdown) / `<h2>Transcript</h2>` exact text (HTML) → next
  same-level heading or EOF. YouTube's own sections are
  `## Transcript — <lang> (<kind>)` — the em-dash suffix means the
  imported-section replace can never clobber them.
- **The hash change is honest versioning.** Attaching grows the body →
  new canonical hash → the archive snapshots the prior version. That is
  a REAL content change, not a stealth-edit false positive (contrast
  21.2's identical-hash re-save, which rightly snapshots nothing).
- **Cross-source identity was already done.** The 21.3 GUID `i`-tags
  join the same episode across source URLs; 22 only makes them
  declarable on any capture. No new join machinery.

---

## 2026-07-15 — Podcast transcript import (Phase 21)

Tags: `design`.

Import podcast transcripts to expand a case corpus (maintainer's ask).
A pasted/uploaded transcript becomes an ordinary archive record so it
joins cases (20.2) and corpus synthesis (20.4) with no redesign. Pure
parser + article builder (21.1), portal panel + reader handling (21.2),
podcast wire tags (21.3).

Decisions worth remembering:
- **Direct-save-then-open** resolves a race: the reader archives
  asynchronously in a new tab, so tag-after-`xray:reader:open` would
  race an absent row. The panel `saveArticle`s directly first (with the
  precomputed `_articleHash`) then `addArticlesToCase`, so membership is
  immediate; the reader's adopt-save merges the prior row's entities
  before re-saving the identical hash (reader/index.js:306-324), so the
  case ref survives and no false stealth-edit snapshot fires.
- **`isMarkdownCanonical`** generalizes the five reader `contentType ===
  'pdf'` conditionals to transcripts: `markdown` is the hash substrate
  and `content` a derived rendering, and a tag wrap never flips
  dirtySource to 'reader' (the destructive turndown round trip).
- **Speakers are person entities, never platform accounts.** A
  transcript speaker is a bare name with no stable platform id, so it
  can't mint a derived pubkey (the identity rule); the claim `source`
  field (entity id | free text) already models it. The reader prefills
  "who said it" from the selection's turn label, transcript-only, so
  bold-leading prose in ordinary articles keeps the byline default.
- **Episode GUID case-preserved, feed GUID lowercased.** Podcasting-2.0
  feed GUIDs are namespace UUIDs (case-insensitive → lowercased in the
  NIP-73 `i` form); episode GUIDs are opaque case-significant strings and
  ride verbatim. All tag values String()-coerced (a numeric iTunes id
  would be rejected at the relay — the Instagram pk lesson).
- **`transcript_meta` is a manifest, not a substrate** — distinct name
  from `transcript_lang` (different positional semantics); the turn
  bodies + speaker names live in the content markdown that the `x` hash
  covers, never in tags.

---

## 2026-07-14 — Case-synthesis proposals: the reduce stage never got the claim ids (20.6)

Tags: `bug`.

First live run of the 20.4 corpus synthesis on the COVID corpus:
the **Proposals** block was a pile of dim "not acceptable: unknown
claim …" rows. Root cause was a mismatch between the reduce prompt and
its input — `buildReduceSystemPrompt` told the model "reference claim
ids ONLY from the supplied dossier; never invent a claim id", but
`digestDossier` put **only `claim_count` (a number)** into that dossier,
never the id→text index. The instruction was unfulfillable, so with a
low-claim corpus the model shorthanded refs (C1/F1…) and `filterProposals`
rejected every relationship/is_key proposal. (New-claim proposals, which
validate against member article hashes, still worked — hence a few good
rows beside the broken pile.)

Fix: `digestDossier(dossier, { claims })` now emits a compact `claims`
index (id — text — article_hash), built by the portal from the SAME set
`filterProposals`/`claimsById` accept, so an id the model pulls from it
always validates; the reduce prompt points at that index and forbids
inventing/abbreviating ids. Two adjacent defects fixed in the same pass:
`filterProposals` now rejects a relationship whose source and target are
the same claim (a self-link that `EvidenceLinker.create` would throw on
anyway — previously shown with a live Accept button), and dedups
identical proposals by a stable per-kind key. No wire change; the brief
schema is unchanged.

---

## 2026-07-14 — Phase 20 docs tail + case export carries the brief (20.5)

Tags: `design`.

Closes Phase 20: the design doc (`CASE_SYNTHESIS_DESIGN.md`), the
ROADMAP §Phase 20, SMOKE §Phase 20 (rows 20.a–20.l), CHANGELOG, and the
NIP_DRAFT "no new kind" note. Plus the case export now folds in the LLM
corpus brief when one exists — `buildCaseJson` emits a `brief` object,
`buildCaseMarkdown` a "## Case brief (LLM-drafted)" section, both
clearly flagged as a drafting assist with model + prompt version +
grounding drop counts on their face (never presented as a sourced
finding). The side-panel `exportCase` reads `getCaseBrief(entity.id)`
and attaches it; a case with no brief exports exactly as before.

---

## 2026-07-14 — Case-corpus LLM synthesis (20.4)

Tags: `design`.

The maintainer wanted to analyze a whole case corpus at once — a
summary, the load-bearing claims, and the cruxes of disagreement
between opposing views (the Rootclaim debate is two-sided). 20.4 adds
a flag-gated map/reduce over a case's member articles, exactly what
CASE_DOSSIER_DESIGN §5 pre-authorized ("a flag-gated assist could later
draft prose from the dossier — separately designed, consent-gated").

Shape: `corpus-prompts.js` (pure tools — `emit_corpus_extract` map,
`emit_case_brief` reduce; NO numeric field in either schema),
`case-synthesis.js` (pure: member units keyed by article hash,
order-insensitive `corpusInputHash`, dossier digest, schema-walker
validators, per-member quote grounding, proposal filtering),
`runCorpusMapPass`/`runCorpusReducePass` in llm-client (mirror the
audit passes), three `xray:llm:corpus-*` SW routes, and the portal
`synthesis-block.js` runner (orchestrateModuleRuns over member ids for
the map, one reduce call) + `synthesis-review.js` (portal-native
Accept routing through ClaimModel/EvidenceLinker). The brief is stored
in the precious `xray-audits` DB, bumped to v2 with a `case-briefs`
store (export-included via the generic backup dump — a test pins it).

Load-bearing decisions worth remembering: (1) PHILOSOPHY compliance is
structural — the tool schemas carry NO score/confidence/probability
field (a test greps the schema keys), the reduce prompt forbids
adjudicating between positions, and the brief renders BESIDE the
deterministic dossier, never above it. (2) Every brief quote is
machine-grounded against the SAME member text the map stage sent (so
the article-hash join is exact); ungrounded quotes drop their entry and
the drop count is disclosed on the block and stored. (3) Gating is
triple: `caseSynthesis` + `llmAssist` + key, because a corpus run is N
suggest passes' worth of spend — the run also shows an explicit
"sends N articles to Anthropic" confirm. (4) The reader's `openLlmReview`
was NOT reused — it grounds against one document and validates
relationship endpoints as same-pass refs; corpus proposals reference
real existing claim ids across many documents, so the portal got its
own small review surface. (5) A stale chip appears when the live
`corpusInputHash` differs from the stored brief's (membership/text/
claim/prompt change), so the user knows to regenerate. No wire kind —
the brief is local; accepted proposals materialize as ordinary
30040/30055 through the normal publish paths.

---

## 2026-07-14 — Local case entity graph (20.3)

Tags: `design`.

The portal's spokes graph (`portal/graph.js`) is built from PUBLISHED
events only, so a case built by tagging local captures rendered empty
even with ten inter-related articles. 20.3 adds a LOCAL case graph:
new pure `case-graph.js` (`buildCaseGraph` / `layoutCaseGraph`) over the
`collectCaseDossierData` output — case at center, member articles,
entities tagged-on/claimed-about them, entity↔entity co-tag adjacency
(weight = shared member articles), and the contradiction warn-edges the
dossier's `buildKnots` already computes but nothing drew. Rendered by
`portal/case-graph-view.js` (SVG, pan/zoom, click an entity → dossier,
an article → reader), mounted in the case view's shared assembly.

Notes: (1) the collector now returns `entitiesById` (the full registry
snapshot) so the graph can name entities tagged on an article that
never entered an orbit claim — builders ignore the field. (2) The
spokes graph's empty state now ROUTES rather than dead-ends: a case
with a local id offers "Open case dashboard" (the local graph lives
there), a non-case entity offers "Open dossier" — instead of feeding
local models into `buildEgoGraph`, which is defined over published
items and would fork its semantics. (3) Layout is deterministic
concentric rings (no physics), so the same corpus always draws the
same graph.

---

## 2026-07-14 — Add-to-case outside the reader (20.2)

Tags: `design`.

20.1 made tag membership first-class but left the only *write* path
inside the reader (tag text while the article is open). 20.2 adds an
"Add sources…" picker to both the portal case view and the side-panel
case detail: pick archived articles that aren't yet members and tag
them, no reader round-trip. Shared logic in `case-membership.js`
(`memberUrlSets` / `listAddableArticles` / `addArticlesToCase` /
`removeArticleFromCase`).

Two load-bearing choices: (1) the tag ref uses `context: ''` — the
reader's `rehydrateEntityMarks` wraps the first body occurrence of a
ref's `context`, so a sentinel string like "case" would mark a random
word; empty context is skipped by the rehydrate guard and still emits a
bare `['p', pubkey]` on publish. (2) The mutation goes through
`saveArticle` as a read-modify-write that re-passes `_articleHash`,
`source`, `publishedToRelay`, `publishedEventId` — `saveArticle`
preserves cachedAt/published flags for an existing row but defaults
`source` and recomputes the hash, so both ride through explicitly (a
tag change never alters the content hash, but pinning it avoids a
needless recompute and any drift). No republish, ever: an
already-published capture keeps its wire p-tags until re-published from
the reader, and the picker says so with a hint.

---

## 2026-07-14 — Case membership becomes a union; tag-only articles are first-class (20.1)

Tags: `design`.

Maintainer feedback from the live COVID/Rootclaim corpus: a case tagged
on ~10 captured articles showed "0 sources · 9 unprocessed" in the
portal. Root cause — the case-dossier spine was purely claim-mediated
(`claim.about` includes the case id), so an article tagged with the case
entity but carrying no extracted claims surfaced only as an
`unprocessed/local-tag` footnote. Tagging is the cheap first step;
claim extraction is the expensive one, and the tool made the cheap step
look like nothing happened.

Phase 20.1 makes membership a **union**: tagged (archive record's
`article.entities[]` intersects the case's alias family) OR
claim-referenced. `deriveArticleRows` now promotes tagged-claimless
records to **first-class rows** (`claims:[]`, `processed:false`,
`membership:'tag'`) instead of footnotes; claim rows carry
`processed:true` + `membership:'claims'|'both'`. `unprocessed[]` now
holds only wire-injected 32125 items. Coverage gained
`articles_with_claims` — and `buildCaseDossier` was aliasing the
headline `articles_with_claims` to `articles` (that was literally the
"0 sources" the maintainer saw); de-aliased.

Second-guessable calls documented here: (1) tag membership keys on the
whole **alias family** (`EntityModel.aliasFamily`), so an alias case id
on a record still counts — claims already canonicalize to the root at
authoring (E3), so only the tag path needed the family walk. (2) Audit
runs join tag-only rows for free via the record's own `articleHash`
(the same hash the reader stamps), so a tagged article that was audited
but never claimed still shows its audit band. (3) The portal case view
now assembles the dossier ONCE and shares it across the shape / evidence
/ timeline blocks (was three independent `assembleCaseDossier` passes
per open) and gains a local-corpus counts line beside the published
rollup. Backward-compatible: entity dossiers get the same promotion
(same `deriveArticleRows`), and the render blocks accept either a
pre-built dossier or a case id.

While here: fixed two literal NUL bytes in `entity-model.js`
(`mergeEntityRefs`'s dedupe-key separator) — replaced the raw 0x00 with unicode escapes; behavior identical, but the raw bytes made the file read as
binary to tooling.

---

## 2026-07-14 — Reader "Add fact" button gated behind a Settings flag (19.5)

Tags: `design`.

The 19.5 slice put a **📇 Add fact** row in the reader's text-selection
tagger popover, next to *Add as claim / ❝ Quote / 🔎 Mark finding*. In
practice it crowded the popover and read as awkward for the common
capture flow — structured facts are a power-user surface, not something
most selections want. Rather than remove it, we hid it behind a new
default-off feature flag `readerAddFact` (Options → Advanced → Reader →
"Show Add fact"), matching every other X-Ray capability gate.

The gate is purely visibility: the fact modal, `factMode`, fact
records, the 30040 fact tags, and dossier assembly are all untouched —
turning the flag on restores the exact prior behavior. Implementation
note worth remembering: the popover is built with a synchronous
`innerHTML` template in `entity-tagger.js openPopover`, and the reader
never primed the flag cache at startup, so a bare `isEnabled()` at
render time would read the default, not the user's override. Fixed by
`await loadFlags()` in the reader's `init()` before the first
`renderReader()`, then reading the flag there and threading a
`showFactButton` boolean into `installEntityTagger` (which keeps
`entity-tagger.js` free of a feature-flags import). Default OFF means
existing users lose the button until they opt in — the intended
outcome.

Files: `src/shared/metadata/feature-flags.js` (flag),
`src/reader/entity-tagger.js` (gate + threading),
`src/reader/index.js` (prime + pass), `src/options/{options.html,index.js}`
(toggle), `tests/reader-add-fact-flag.test.mjs` (default pin).

---

## 2026-07-13 — ValueGroups split on validity windows; wire representatives are published facts (19.8)

Tags: `design`, `bug`.

Two review findings, one root cause. The dossier's field grouping
originally merged claims on VALUE agreement alone, keeping the first
claim's validity window — so "CEO 2005–2009" and "CEO 2019–" collapsed
into one entry wearing an arbitrary window, and (worse) an unpublished
claim heading a mixed group could put its value string or dates onto
the kind-0/30067 wire, where the only `a`-ref source asserted neither.
Decision: (1) grouping now requires the values to agree AND the
validity/observed windows to be IDENTICAL — same value in different
eras is two assertions, which is what an evolves:true field means;
(2) evidence entries carry each claim's own fact snapshot, and the
wire surfaces (entity-profile.js) take their representative value +
window from the first PUBLISHED evidence's snapshot, never the group
head. Precision-band display merging survives only within identical
windows ("1962" + "1962-03-15", both undated → one dossier entry, two
citations — but the wire carries the published claim's exact string).
Also from the same review batch: the corpus profile gate hashes the
FULL kind-0 content (name+about+nip05, `profileContentHash`) so a
rename republishes; the legacy entity batch skips keyed canonical
roots while the flag is on (it was clobbering enriched profiles with
boilerplate); portal republish requires a CONFIRMED relay OK before
stamping (JOURNAL 2026-07-10 ledger rule) and stamps per surface.

## 2026-07-13 — Republish hashes exclude generated_at (19.7)

Tags: `design`.

The corpus publish gate is compare-and-skip: on every article publish,
each tagged canonical entity's profile `about` and 30067 fact sheet
are re-assembled and hash-compared against the stamps stored by
`markProfilePublished`. The design text (§6) specifies the sheet
content includes `generated_at` — which changes every assembly, so
hashing the raw content would make every publish look changed and the
gate would NEVER converge (republish forever). Decision:
`factSheetContentHash`/`profileAboutHash` hash the canonical content
with `generated_at` (and only it) stripped; the idempotence test
(same content, two generatedAts ⇒ equal hashes) is the pin. Related:
the 30067 `a` coordinates name each claim's ACTUAL stored
`publishedPubkey` (fallback: the batch's publisher) — a coordinate
minted with the wrong pubkey silently never resolves.

## 2026-07-13 — Wire p-tags resolve through the canonical chain (E3)

Tags: `design`.

Phase 17A: every publish path that turns an entity id into a pubkey
(`buildClaimEvent` about/source/fact-subject, 32125 relationships,
32126 `linkedEntityPubkey`, assessment about-mirrors, forensic/truth
subject refs) now resolves through `canonicalIdOf` first. Before, a
claim about an alias tagged the ALIAS's pubkey — so one real-world
person accumulated two disjoint `#p` histories, one per merge-history
fragment. After, new events land on the root identity; the alias's
kind-0 `refers_to` tag is the published forwarding pointer for
consumers holding old references, and local reads were already
family-wide via `equivalencePubkeys`. Second-guess note: we chose
best-effort fallback (alias record used verbatim when the canonical
isn't in the caller's dict) over dropping the tag — a slightly stale
reference beats a vanished one. The dedupe report that makes merges
routine is `entity-health.js` (same commit); resolution helpers are
`EntityModel.resolveCanonical` (id → root record, async) and the pure
`canonicalIdOf(id, snapshot)` for bulk loops.

## 2026-07-12 — The asserter defaults to the article's author, entity-first

Tags: `design`.

Maintainer: "it is really important to know who made the claim.
Usually it is the author of the article or paper… entities should be
the primary way of identifying who asserted the claim." The claim
modal's "Who said it" was optional, free-text-first, and defaulted to
nothing — so most claims shipped with no asserter even though the
byline was sitting right there on the capture.

Now: the source picker is entity-mode-first everywhere, and new
claims default their speaker to the article's author —
`findEntityByName(byline)` (deterministic ids make exact-name lookup
two hashes + one registry read) preselects the entity when it exists;
otherwise the picker opens with the author name prefilled and a
one-click "New as: <type>" row (the tagger popover's create pattern,
now inside the claim modal's pickers — replacing the "tag an entity
from the article body first" dead end). LLM-accepted claims get the
author entity as their source too, but only when it already exists.

Two deliberate lines:
- **No silent entity creation.** Entity ids are `sha256(type:name)` —
  a wrong person/org guess would mint a permanently wrong-typed
  registry entry. Creation stays a deliberate user action; the
  default just makes it one click with the type chosen by a human.
  (Same posture as the identity layer's manual account↔entity link.)
- The wire needed nothing: entity sources already emit
  `['p', pk, '', 'source']` + `['source', name]`, the publish path's
  entity dict is the full registry, and `collectClaimEntityIds`
  already swept `claim.source` into the entity-profile batch.

## 2026-07-12 — The `[hidden]`-vs-author-`display` footgun

Tags: `bug`, `pattern`.

The evidence pickers' search "filtered" a 503-item list down to…
503 items. The handler ran and set `row.hidden = true` correctly —
but the `hidden` attribute is implemented by the **UA stylesheet's**
`[hidden] { display: none }`, and any author `display:` rule on the
same element wins over UA rules regardless of specificity. Every
picker row declares `display: flex`, so `hidden` was silently inert.
The same defeat had been shipping unnoticed in the 🔗 link modal's
search since Phase 11.4 (pools were small) and in the claim modal's
Entity/Free-text mode toggle (`.xr-claim-modal__picker-entity` is
flex).

Fix: scoped guards at each component root —
`.xr-adjudicate [hidden]`, `.xr-integrity [hidden]`,
`.xr-claim-modal [hidden]`, all `{ display: none !important; }` — so
every current and future hidden toggle inside those surfaces stays
honest. Audited every other `.hidden =` toggle in the reader/shared
modals; the rest touch elements without author `display` rules.

So-what: `el.hidden` only works on elements whose classes never set
`display`. When a component styles its rows as flex/grid/inline-*,
add the scoped `[hidden]` guard in the same breath — and when a
filter "doesn't filter", check whether hiding is defeated before
suspecting the matcher.

## 2026-07-12 — Grounded verdict evidence: the plumbed-but-dead provenance chain

Tags: `bug`, `design`.

The maintainer's §Phase 15 smoke walk surfaced it: "needs some design
changes to fix the provenance in truth adjudication." The diagnosis
was striking — every LAYER of evidence provenance already existed,
and none of them ever carried data:

- the model (`cleanVerdictEvidence`) validated `claim_ref` +
  `source_ref` fields nothing ever set;
- the wire tags (`['evidence-for'|'evidence-against', quote, tier,
  url, coord]`) had url/coord slots that always shipped empty;
- the publish mapper (`wireEvidence`) faithfully forwarded the refs
  the modals never captured;
- the inspector's parser preserved fields the renderer dropped.

Both authoring modals captured `{quote, tier}` and nothing else, so
design red line 5 — "no verdict the reader cannot re-derive" — was
structurally unmet: the quote traveled, the source never did.

Fix (design amendment §5.5a, 2026-07-12): evidence entries CITE
captured claims/quotes — nothing evidentiary is typed. A first cut
kept a freeform quote box plus an optional claim link and URL field;
the maintainer pushed further ("there should be other claims/quotes
that are cited as evidence… the evidence steps are freeform text"),
and the insight that settled it: a captured claim already IS the
quote artifact — `claim.quote` is the verbatim article span
(auto-captured, never typed), `claim.source` is the speaker entity
(e.g. W.H.O.), and it carries the anchor + article hash. So both
truth modals' evidence rows became a searchable picker over the
cross-article pool (new shared `claim-candidates.js`: all local
claims + assessed-foreign snapshots, speaker-resolved, canonical-ref
deduped); the record snapshots the linked claim's quote/url so the
ruling stays self-contained; typed fields are the tier and a
why-note only. `wireEvidence` takes a resolver so a LOCAL claim id
resolves through `claimWireInfo` to its published coordinate —
unpublished refs are omitted this batch (the precedent-ref posture;
the ruling still publishes and heals next publish). Pre-amendment
quote-only records still read/render/republish — the MUST binds
authoring, not reading. A "❝ Quote" popover shortcut opens the claim
form quote-framed (speaker picker first) so the capture-first
discipline has a fast path, and the claims bar renders sourced
quotes speaker-first.

Same PR, related vocabulary fix: the outbound-link wire tag renamed
`cites` → `link` ("I was using the word citation as a metaphor" —
the tag asserts a hyperlink, not a scholarly citation). Emit is
`link`-only; read-back dual-reads legacy `cites` (same positions,
brief pre-rename window, documented in NIP_DRAFT's history note).
`deriveCitationEdges` → `deriveLinkEdges` (`links`/`linked_by`), and
the truth layer's precedent citations + the moral lens's
bibliographic `citation` records are deliberately untouched —
different vocabularies.

So-what for future readers: a provenance chain is only as real as its
AUTHORING surface. Every layer below the UI can be perfectly plumbed
and the feature still ships nothing — when adding a provenance field,
start the review at the input box, not the wire format. And when a
field is typed where an artifact could be cited, expect the design to
eventually demand the artifact. Deferred, recorded in the amendment:
attestation authoring UI + verdict↔convergence wiring (§3.2),
proposition snapshots, supersession-reason fields, publishable
revision refs.

## 2026-07-12 — The URL alias layer: identity recovery becomes a persistent map

Tags: `design`.

url-identity.js recovers originals STRUCTURALLY, per capture — but the
recovery evaporated the moment the capture ended: a claim made while an
article keyed to `archive.ph/Zz9Yx` stayed invisible to a later lookup
by the original URL, and vice versa. And structural recovery only knows
the sites it knows.

Two mechanisms, layered:

1. **`url-aliases.js`** — a persisted map (`url_aliases`) of
   normalized-alias → normalized-original, fed by every place an
   original is actually LEARNED: structural recovery at capture, a
   relay read-back's `capture-url` tag, and the reader's manual "Set
   original URL…". Writes flatten chains (lookups stay one hop) and
   refuse cycles; resolution is idempotent, so joins resolve
   unconditionally. Consumers: `ClaimModel.getBySourceUrl` (both sides
   resolved), the reader's prior-capture lookup, and
   `checkArchiveAvailability`.
2. **The mirror registry** in url-identity.js — the wayback /
   archive.today branches refactored into a rules table (host
   predicate + extractor), then extended: Google cache
   (`/search?q=cache:…`, digest + scheme-less forms), 12ft.io
   (`/proxy?q=` + raw path form), AMP caches (`/c/s/` https, `/c/`
   http, cache-owned viewer params dropped, the original's own params
   kept), ghostarchive (`/varchive/<id>` → the YouTube URL;
   `/archive/<code>` honestly unrecoverable). Nested wrappers unwrap
   (wayback-of-12ft-of-X keys to X, bounded depth 3), and a mirror
   host is never adoptable as "the original" — plausibility now gates
   the CANONICALIZED candidate, not the raw one.

The manual affordance is the universal fallback for sites neither
mechanism knows: the reader's URL header field and the capture note's
"Set original URL…" both route through one flow that re-keys identity,
keeps the fetched address as provenance, records the alias, saves the
archive row under the new identity, and refreshes the URL-keyed panels.
Second-guessable choice: the alias map is workspace CONTENT (cleared on
fresh workspace, riding backups) rather than config — it is derived
from captured content, and stale aliases from an old investigation
polluting a new workspace's joins would be a silent wrong-join source.

## 2026-07-12 — Entity tags vanished on reload: three read paths, one active clobber

Tags: `bug`.

Field report: entities tagged during a capture (manual and accepted LLM
suggestions) were gone when the article was reloaded. The tags were
never *lost* in the obvious sense — the publish path had been writing
them into the archive row all along. The problem was the read side,
three ways at once:

1. `adoptArticle`'s load-time save wrote the FRESH article (whose
   `entities` is always `[]`) over the archive row — actively
   destroying the previously saved tags on every revisit.
2. `loadArchivedArticle` deliberately kept the current (empty)
   in-session entity list when swapping in the archived body — the
   header comment even documented "leaves entity refs untouched" as a
   feature. Correct for the mid-session case it was written for,
   wrong for the reload case where the archived copy is the only one
   that HAS refs. It merges now (`mergeEntityRefs`, current wins).
3. Tagging itself never persisted — refs lived only in
   `state.article.entities` until publish, so tag-without-publish
   evaporated on close. A debounced save-on-tag fixes that (skipped
   for read-only portal opens, which must not touch the archive row's
   publish mark — `saveArticle` preserves `publishedToRelay` on
   overwrite, verified, so the tag save can't reset the ledger).

Also: portal "Open in reader" reconstructions now rebuild entity refs
from the event's typed name tags (`reconstructEntityRefsFromEvent`).
The deterministic id derivation (`entity_<sha256(type:name)>`) means
wire-reconstructed refs join local registry records exactly — no
lookup table needed, the hash IS the join.

So-what for future readers: any state that only exists on
`state.article` dies with the tab unless a write path owns it — and a
load-time "cache this" save is a destructive overwrite for every field
the fresh object doesn't carry. Merge from `prior` before saving.

## 2026-07-10 — Full backup/restore: two IndexedDB traps worth remembering

Tags: `design`, `bug`.

`backup.js` gives the extension a real export/restore: every
`chrome.storage.local` key (minus `xray:llm:key` — a third-party API
credential never leaves the machine in a backup, though the nsec and
entity keys deliberately do, by maintainer decision) plus generic dumps
of all three IndexedDB databases, with source-document bytes base64-
wrapped as `{__xrayBytes}` markers behind a default-ON checkbox.
Restore is replace-all (a safety backup downloads first), never merge.

Two traps surfaced while building it, both generic to any IDB-touching
utility code here:

1. **Never open a covered DB "versionless just to peek".** An
   `indexedDB.open(name)` on a never-created database mints an empty
   v1 database — and since our openers open at their declared version,
   `onupgradeneeded` then never fires for a same-version open, leaving
   the module permanently without its object stores. Backup always
   goes through the owning module's opener (`openArchiveDb` /
   `openAuditDb` / `openEventJournalDb`), which creates the canonical
   schema if absent.
2. **Never `close()` a connection you got from a module opener.** All
   three openers cache their connection promise for the page's
   lifetime; closing the handle poisons the cache and every later
   caller in that page gets `InvalidStateError`. The backup module
   treats opener connections as borrowed, not owned.

Also fixed in passing: the `WORKSPACE_KEEP_KEYS` entry for the LLM
suggest-kinds pref said `xray:llm:suggest-kinds` (hyphen) while the
actual storage key is `xray:llm:suggest_kinds` (underscore); and
`WORKSPACE_DATABASES` now includes `xray-events`, so a fresh workspace
clears the journal too — old-identity events shouldn't leak into a new
workspace's rebroadcast/export surfaces, and the export-first flow
(plus this backup) covers preservation.

## 2026-07-10 — The signed-event journal: publish once, rebroadcast forever

Tags: `design`.

X-Ray never stored the events it published — only ledger marks
(publishedAt/publishedEventId). Three consequences converged into one
mechanism: reconcile's "missing" rows had no repair short of a full
re-sign; the win plan's §5.1 durability guarantee ("bundled raw
signed-event JSON — replayable by anyone") had no source of truth; and
the maintainer's republish request had no clean path for NIP-07
identities (every retry = another signer prompt).

`event-journal.js` (IndexedDB `xray-events`, precious like the audit
ledger): every successfully-sent event is journaled VERBATIM with a
per-relay outcome snapshot. All reader publish() families flow through
one gate (`publishOk`) that journals and then answers whether the
local ledger may mark — **CONFIRMED (non-assumed) relay OKs only**.
The old behavior marked on `successful > 0`, and `successful` counted
8-second timeouts as successes ("assume success, many relays don't
send OK") — marking on hope is how published artifacts go missing.
Assumed-only sends now stay unmarked (they retry next publish) and the
summary says "N unconfirmed". The sidepanel's 30078/10002 pushes
journal too. The article's archive-row mark — its only publish
ledger — is now awaited and confirmed-gated instead of
fire-and-forget.

Portal: reconcile's "missing" rows gain **Rebroadcast** (journal
lookup → verbatim re-send, no re-signing; pre-journal publishes get an
honest "re-publish from the reader" message), and the never-published
bucket is ITEMIZED (`listLocalArtifacts` — same iteration as the old
count, records instead of numbers) under "Unpublished local
artifacts", with URL-anchored rows naming their open-in-reader route.

Named follow-ups, deliberately not in this slice: per-family
try/catch inside publish() (per-item guards exist; a family SETUP
throw still aborts the batch tail), and deferral surfacing in the
judgment selectors (wire-not-ready skips are still silent).

## 2026-07-10 — Field bug: archive.ph recovery missed three ways at once

Tags: `bug`.

A real capture (archive.ph short-code page of a NYT piece,
screenshot-verified) failed original-URL recovery and keyed to the
archive address, which broke every downstream join the maintainer
could see — the local copy of the same article stopped being offered.
Three independent misses, all fixed with the maintainer's screenshots
as regression fixtures:

1. **The dotted timestamp.** archive.today's own rel=canonical emits
   `/YYYY.MM.DD-HHMMSS/<original>`; `ARCHIVE_TODAY_PATH_RE` accepted
   only digit runs (the Wayback shape), so the long form — original
   URL right there in the path — didn't parse.
2. **Only the tab URL was consulted.** On a short-code tab the
   recoverable long form arrives via the extractor's canonical pick
   (`rel=canonical`/`og:url`); `resolveUrlIdentity` now takes that as
   a third argument and tries URL-structure recovery on it (same
   archive family only) before touching DOM markers. Pure URL
   structure beats DOM guessing.
3. **The "saved from" marker is an INPUT, not an anchor.** The live
   archive.ph header renders the original URL as a form input VALUE;
   the post-review text-equals-href anchor rule couldn't see it. Input
   values are now the second-trust marker (HIDDEN_URL → input value →
   text-equals-href anchors), each tier failing open on ambiguity.

Also shipped (maintainer "ship it"): the relay probe treats burst
rate-limiting as politeness, not policy — an `OK false` matching
/rate|slow down|too (fast|many)/i gets one patient retry (damus
accepted exactly the first 8 events of a 150ms burst, the fingerprint
that prompted this) — plus `--delay-ms` and a friendly
run-the-probe-first message when `--recheck` finds no state file.

## 2026-07-10 — Adversarial review of the audit/identity/citations sweep: ten confirmed, ten fixed

Tags: `bug`, `pattern`.

An eight-angle finder pass + per-candidate adversarial verification
over the whole PR-#116 diff (the pattern from the PDF sweeps — worth
repeating after any multi-feature burst) confirmed and fixed:

- **Draft lost-update race**: `appendAuditDraft` was a get→set of one
  storage key from three concurrent orchestrator workers — two modules
  landing back-to-back could clobber each other in the resume draft
  (a silently re-billed module). Writes now chain through one promise.
- **Wayback captures published ZERO `cites`**: archives rewrite every
  body anchor onto their own host, so link extraction (which runs
  before the identity hook) classified every citation
  archive-internal. `rewriteArchivedLinks` (url-identity.js) now
  unwraps archive-wrapped links to their originals, re-keys
  `article.domain`, re-classifies internal/external, and drops
  unrecoverable archive-chrome links.
- **Wrong-original adoption risk**: the archive.today header-anchor
  fallback took the FIRST plausible `#HEADER` link — verification
  executed it adopting `blog.archive.today` (subdomains passed the
  blocklist) and any promoted/donate link before the saved-from anchor
  would win. Now: archive-family SUBDOMAINS are rejected, an anchor
  qualifies only when its visible text IS its href (the saved-from
  shape), and two distinct qualifying URLs = ambiguous = fail open.
- **Archived arXiv fork**: an original embedded in an archive path
  (`…/web/<ts>/https://arxiv.org/pdf/X`) skipped arXiv
  canonicalization → `/pdf/` identity vs a direct capture's `/abs/`.
  Every recovered original now routes through `canonicalizeOriginal`.
- **Truncated-capture invisibility ×3**: a >120k audit keys to the
  slice hash, so (a) the prediction ledger (queried under the full
  hash) never rendered its predictions — now merged across both keys;
  (b) the case dossier's evidence table showed the source unaudited —
  runs now carry a `captureArticleHash` join alias (never used for
  score display, only to FIND the run) and the dossier indexes both;
  (c) `auditHashCandidates` gains the slice vintage so publish
  batches and prediction back-references stop skipping those runs.
- **Old claims vanished after re-capture**: `ClaimModel.getBySourceUrl`
  was an exact string match, so claims saved under the pre-unification
  canonical URL form were invisible for the same page. The join now
  normalizes both sides at read time (the forms converge under the
  unified normalizer). The JOURNAL sanctioned d-tag churn — not local
  claim loss.
- **`from` un-stripped**: review showed `from` is a CONTENT param on
  real sites (pagination `?from=100`, date ranges, converter origins)
  and the case-insensitive strip was wider than the legacy list ever
  was. Removed from `TRACKING_PARAMS` — under-merge (a rare share-link
  variant forks) beats over-merge (two different pages become one
  identity). The rest of the merged params are unambiguous trackers.
- Plus: one shared `pushR` dedupe for all three r co-emit blocks (no
  duplicate `r` tags), `refreshAuditStatus` reads parallelized and the
  PDF legacy-hash advisory cached per article instead of re-hashed per
  repaint, the article-rows derivation threaded once through
  `buildCaseDossier` instead of recomputed 3×, and the atomic
  assignment of `articleHash`/`auditableHash` (an interleaved repaint
  between the two writes could miss the truncated-key panel state).

Refuted, for the record: archive-cache bucket drift (re-capture
re-saves under the new key; self-healing), the reader URL-field edit
interplay (pre-existing power-user escape hatch), and the
synthesize-path identity skip (archived platform snapshots fall
through to Readability, where the hook runs).

## 2026-07-09 — Outbound links become citations (`cites` tag, both sides)

Tags: `design`.

Until now an article's hyperlinks survived only inline in the captured
markdown — invisible to queries, the dossier, and the cited article.
`ContentExtractor.extractOutboundLinks` now captures them as
structured data from the SAME cleaned body the markdown derives from:
deduped through the unified normalizer (a link and its tracking-param
variant are one target), first-anchor-text kept, occurrence-counted,
internal (same-host, sans-www — a documented approximation) vs
external classified, capped at 100 distinct targets in document order
with an honest `article.links_truncated` marker.

**Wire (additive, NIP_DRAFT):** kind-30023 gains one `cites` tag per
distinct EXTERNAL link — `['cites', url, anchorText≤120?]` — plus
indexed `r` co-emits for the first 25 targets (after every other
co-emit, deduped, first-r invariant pinned by tests). Design choices
worth second-guessing: `cites` asserts LINKAGE only — endorsement
stays in `responds-to`, which the authoring UI can now offer
one-click when a cited target is already in the corpus (deferred
follow-up); under the cap, absence of a tag is NOT evidence the
article doesn't link somewhere; read-back yields `links: null` (not
`[]`) for pre-extension events — "not captured" must never render as
"zero links" (the dossier's `citations.captured` bit carries the same
distinction). The cited side is derived, never published:
`deriveCitationEdges` (case-dossier.js) computes cites/cited-by maps
inside a corpus, and the CD.2 evidence rows show "cites N external ·
cited by M case articles". Deferred, named: PDFs and the platform
synthesizers don't extract links yet; the portal has no citation
facet.

## 2026-07-09 — One normalizer, and archive captures re-key to their originals

Tags: `design`.

Two identity fixes that belong together, both from the COVID capture
run (archive.is / Wayback / arXiv captures forking the corpus):

**Normalizer unification (maintainer decision: now, not deferred).**
`ContentExtractor.normalizeUrl` — which keys article identity and
30023 `d` tags via `getCanonicalUrl` — had its own tracking-param list
(no param sorting, a keep-some-anchors fragment heuristic) while every
downstream join (claims, assessments, forensics, adjudication, the
archive cache, the case dossier) ran the NIP-73
`metadata/url-normalizer.js`. Same page, two canonical forms — the
dossier's convergence collapse and `#r` queries silently missed. The
legacy-only params (`mkt_tok`, `oly_*`, `vero_id`, `wickedid`,
`__twitter_impression`, `spm`, `share_source`, `from`, `_gid`) merged
into the unified `TRACKING_PARAMS`, `ContentExtractor.normalizeUrl` is
now a delegate, and the random-hash fragment heuristic is gone (all
non-text-fragment anchors strip). **Accepted consequence:** a
post-unification capture of a URL whose params sort or now strip
derives a DIFFERENT `d` tag than a pre-unification capture — a
republish is a new addressable event, not a replacement; the portal's
reconcile absorbs the seam. That churn is why this was a maintainer
call, and it's cheapest now, before the corpus publish.

**Original-as-identity for archive captures** (`url-identity.js`). A
capture made on archive.today/Wayback/ar5iv keyed to the MIRROR's URL,
so a later direct capture of the same piece (or another user's) landed
in a disconnected bucket. Now the recovered original IS the identity
(`article.url`, the `d` tag, the first `r`), and the fetched address
rides as provenance (`article.capture_url` → wire tag `capture-url`,
plus an `r` co-emit AFTER the primary — the first-r read-back
invariant; NIP_DRAFT documents it). Recovery: URL structure first
(Wayback path-embedded originals incl. the `if_`/`im_` modifiers and
the collapsed-scheme repair; archive.today `newest/oldest/<ts>` deep
links; arXiv pdf/html/ar5iv → `/abs/`), then archive.today's own DOM
markers (`input#HIDDEN_URL`, header anchors) validated against an
archive-host blocklist. **Fail-open:** unverifiable ⇒ the capture keys
to the fetched address and claims nothing — a WRONG original forks
identity worse than none. The DOM markers can't be exercised from this
sandbox (egress-blocked); SMOKE 2.10 pins the live check and the code
degrades to not-recovered if archive.today redesigns.

## 2026-07-09 — Thorough audits ran to completion, then vanished: MV3 killed the messenger

Tags: `bug`, `design`.

Field report from the COVID capture run: a thorough epistemic audit
"pulls the results from the LLM" but never displays them — sometimes
quick mode too. Root cause: both modes rode ONE
`chrome.runtime.sendMessage('xray:audit:run')` whose response arrived
60–120+ s later. MV3 service-worker eviction kills a long-lived
response channel; the reader's `await` rejects (or hangs), and since
persistence ran reader-side AFTER the response, the paid-for results
were simply gone. Duration explains the fingerprint: thorough (8
sequential-ish Opus calls) essentially always crossed the eviction
window, quick only sometimes. Two independent aggravators: PDF runs
persisted under the raw turndown-round-trip hash while the panel
queried the `hashableArticle`-adjusted hash (success toast, empty
panel), and >120k-char articles failed `importAuditJson`'s hash gate
after the spend because the SW sliced AFTER the reader hashed.

The fix is the lens topology applied to audits, plus durability:

- **One message per module** (`xray:audit:module`,
  `runAuditModulePass`) — each response resets the MV3 idle timer; a
  lost channel now costs one retryable module, never the run. The
  reader schedules them via the pure `audit/run-orchestrator.js`
  (concurrency 3 — eight parallel calls rate-limited each other into
  429 storms — one auto-retry on 429/5xx/timeout).
- **Draft durability**: every completed module lands in
  `chrome.storage.local` (`xray:audit:draft:<hash>`) before the next
  dispatch; reopening offers resume, re-running only missing modules.
  Assembly (`assembleAudit`, extracted to the lean
  `audit/assemble.js` so the reader bundle still excludes the 38KB
  module prompts) and persistence go through the SAME
  `importAuditJson` firewall as file imports, with `source:
  'background'` (was mislabeled `cli-import`).
- **One hash everywhere**: the reader computes the body from
  `hashableArticle` (PDFs hash the reconstruction), pre-slices to
  `MAX_AUDIT_INPUT_CHARS` (120k) and hashes the SLICE — so the local
  hash, the scored text, the ledger key, and the panel query key are
  one value. Truncation is disclosed pre-spend and the panel labels
  truncated-key runs with their coverage. Legacy PDF orphans (runs
  keyed under the old round-trip hash) get an advisory, never score
  display — different bytes.
- **Quick hardened**: SW-side 300s abort + reader-side 330s race (the
  button can never stick), with a 20s zero-cost keepalive ping while
  in flight.

No wire change — internal messages and local persistence only; the
30056–30061 publish path and CLI import are untouched.

## 2026-07-09 — Wire doc reconciled to v0.7.0 reality; kind 32125 documented

Tags: `design`.

Pre-publish housekeeping ahead of the Epistack corpus publish (runbook
§4 step-0): `docs/NIP_DRAFT.md` gained a **Kind 32125 —
EntityArticleRelationship** section. 32125 has shipped since Phase 9
(`EventBuilder.buildEntityRelationshipEvent`, parsed in the portal) but
was never in the wire draft — so a judge fetching one under the
submission npub would have found no semantics. The section is
**additive documentation of an already-emitted kind — no wire behavior
change**. Worth recording: the `d` tag embeds the author's *local*
entity id (`entity_<hex>:<url>:<about|source>`), reader-local like the
32126 `linked-entity` id; the cross-user handles are the `p` wire
pubkey and the `r` URL, so a stranger's 32125 for "the same" entity
never `d`-collides.

Also corrected the stale reference-implementation paragraph: the
Phase-15 clause claimed "publish/read UI wiring deferred" (false since
#89 — the adjudicate/integrity modals, the flag-gated publish path, and
portal verdict render all ship), and a `*(second client, TBD
pre-merge)*` placeholder was resolved. CHANGELOG `[Unreleased]` gained
the case-dossier (CD.1–CD.3) Added entry with its explicit
no-new-kind wire note, since the v0.7.0 release notes pull from that
block.

## 2026-07-08 — Case dossier CD.2/CD.3: thin render over a pure spine

Tags: `design`.

CD.2 (shape-of-knowledge header + convergence-collapsed evidence
table) and CD.3 (four-axis timeline + gap callouts) render the CD.1
dossier into the portal case view. Decisions worth second-guessing:

- **All logic stays pure; the portal only paints.** The portal render
  layer has no unit tests (no jsdom — confirmed across every
  `tests/portal-*.test.mjs`), so anything that could be wrong lives in
  `case-dossier.js`/`timeline.js` and is fixture-tested: the three gap
  callouts (`buildTimelineGaps`) and the proportional precision-band
  layout (`layoutWorldSpine`). The three new portal blocks
  (`shape-block.js`, `evidence-block.js`, `case-timeline.js`) are
  logic-free projections in the `integrity-block.js` shape
  (sync-append an empty block → async-fill → self-remove on empty/
  error), so nothing important is trapped in the untestable DOM path.
  (Smoke-executed once against a hand-built DOM stub to catch runtime
  errors the build can't.)
- **Assemble from the LOCAL spine, keyed by the local entity id.** The
  case view is pubkey-keyed but already local-registry-gated
  (`case-view.js` early-returns when the case isn't a local entity), so
  the blocks only ever run with a real local id — exactly what
  `assembleCaseDossier` reads. **Wire is left empty for v1**: the
  portal's parsed relay items don't carry the local `proposition_id`s
  the dossier's wire path needs, so cross-author side-by-side variance
  in these surfaces is a later slice (matches every other portal
  surface's v1 posture).
- **Gap thresholds are precision-aware and named, not magic.** A gap is
  flagged only when it clears the coarser side's precision window
  (`PRECISION_WINDOW`), so a year-precision date never fabricates a
  day-level "published before it happened" anomaly (P4); "long after"
  is a single `CAPTURE_LAG_SECONDS` constant, tunable once the corpus
  says what long is — never a clock read.
- **Keep BOTH timelines.** The four-axis timeline is added *alongside*
  the existing wire publish-density strip, not replacing it: the strip
  is network publish activity over all authors' wire items; the new
  timeline is the local structured analysis over world/publication/
  capture/judgment time. Different populations, both honest.
- **The audit band never forks.** The evidence table's per-article
  audit chip runs the raw aggregate CD.1 ships through the shared
  `auditCardChipData` (no naked numbers, sub-0.6 → "review") — the same
  rule the reader and inspector use, so the classification can't drift.
- No case-level score is introduced anywhere (P2). Suite 1342 green,
  build + web-ext lint clean.

## 2026-07-08 — Case dossier CD.1: the orbit assembler is pure and injectable

Tags: `design`.

CD.1 (`src/shared/case-dossier.js`, `docs/CASE_DOSSIER_DESIGN.md` §3)
is the derived, computed-on-read data spine for the case dossier —
the analytical view the Phase-12 flat case list never gave. Decisions
worth second-guessing:

- **Storage-aware collect / pure build split** (the `case-export.js`
  pattern): `collectCaseDossierData` does every async read once (bulk
  maps, one `makeClaimRefCanonicalizer()` snapshot — never the per-
  record N×get of the private `truth-entity-record#propositionsForEntity`),
  the section builders are pure. `generatedAt` is injected and there
  is **no clock read in the module** (a machine-checked guard) — an
  "overdue" prediction needs `Date.now()`, so that derivation is
  deliberately the render layer's (CD.2/CD.3).
- **Injectable inputs with live defaults** for everything that isn't
  `chrome.storage.local`: the archive + audit IndexedDB reads and
  `wire` (other authors' parsed relay items). Tests inject all of
  them, so the suite needs no fake-indexeddb; the portal will inject
  its already-loaded arrays; and `wire` is injection-ONLY — the module
  never opens a relay, so output can't depend on when "Load from
  relays" was clicked (the case-export determinism rule).
- **Two membership rules, on purpose**: §3.1 propositions are
  claim-mediated (claim `about` includes the case); §3.2 integrity
  findings are entity-mediated (`entity_ids` ∩ orbit) — a finding
  about an orbit person belongs even when its claims were captured
  under other folders.
- **The forensic bridge is asserted, not guessed**: forensic subjects
  key on `subject_ref` (identity/pubkey/account/label), a different
  keyspace from entity ids, so each orbit entity is matched by derived
  candidate refs (pubkey, name-as-label) or a caller-supplied bridge,
  and every match stamps `matched_via`; unbridgeable entities are
  counted, never silently dropped.
- **Attestations reach `attestationConvergence` in authoring order**
  (`created`, then id), not id order — the convergence baseline is the
  earliest-authored origin, and an id sort was choosing it arbitrarily
  (caught by a test whose three same-second attestations flipped
  `independent_count` between runs). Everything else (knot node lists)
  stays id-sorted for determinism.
- **No case-level score, ever** (P2): a recursive key-walk test asserts
  no `score|mean|rating|strength|grade` key anywhere except the single
  whitelisted raw per-article audit-aggregate subtree (never rolled
  up). Disagreement is variance objects, never a merge (P5).
- `collectCaseEntityIds` was exported from `case-bundle.js` (it is THE
  orbit definition; re-implementing it would be the duplication this
  module exists to avoid). CD.2/CD.3 (UI, timeline render, gap
  callouts) consume this spine in later PRs.

## 2026-07-08 — Epistack submission plan re-based: relays are the artifact

Tags: `design`.

A full plan review against the codebase (3-agent inventory) found 7 of
the 07-03 sprint queue's 10 items never started, the entry doc stale,
and the release un-cut — while the substrate itself is shipped and the
maintainer is mid-COVID capture run. Re-planned with the owner;
decisions worth second-guessing later:

- **Nothing from the deleted win plan is treated as frozen.** Its
  removal (#109) was anti-overfitting, not a pivot; every inherited
  decision was re-argued on merits. Outcomes that *changed*: a
  self-hosted relay is now a documented contingency (trigger: fewer
  than 3 public relays accept+retain our kinds), no longer banned; the
  CD.1–CD.3 dossier is back on the table merits-first (the investigator
  needs the assembled view; Phase-12's flat case view predates
  Phases 13–15), pure module first, shed CD.3→CD.2 under pressure,
  CD.1 kept.
- **No export/bundle tool — owner decision.** A planned
  raw-signed-event NDJSON exporter was cut: wrapping the corpus in
  files hides the design's core property. The live public relays ARE
  the artifact; the consumer story is any NOSTR client or the short
  WebSocket snippet now embedded in the entry doc. Durability
  = multi-relay redundancy, probed early (runbook §1).
- **Case scope: COVID deep + eggs bounded (6–10 sources), LHC pass.**
  The competition wants ≥2 cases; eggs rides the ready corpus doc via
  a half-day worksheet (`EPISTACK_EGGS_WORKSHEET.md`).
- **Compounding is demonstrated, not promised**: a second-investigator
  walkthrough (fresh workspace + second identity profile → pull corpus
  → adopt entity → publish disagreeing judgment, side-by-side render)
  uses only shipped features — KS.5 stays unbuilt.
- Docs re-based: `EPISTACK_ENTRY.md` rewritten (COVID-first,
  rubric-coverage map, honest-gaps framing — late-binding assessment
  by design, graded-not-calibrated); `EPISTACK_RUNBOOK.md` (probe /
  smoke / v0.7.0 / publish / walkthrough); stale "WIN_PLAN outranks"
  headers fixed in COMPLEX_CONTENT (C1–C4.2 are in fact shipped),
  CASE_DOSSIER, ENTITY_CORPUS; kickoff marked superseded.

## 2026-07-08 — PDF tables: read the grid row-by-row, don't column-band it

Tags: `bug`, `design`.

Field report (screenshot): a Rootclaim-style Bayesian evidence table
(evidence / Bayes / log-odds, 17 rows) captured as a scrambled
diagonal — every label collapsed into one paragraph, then the two
value columns spilled out row-offset ("log-odds 0.30225", "-1.2
13.48", …). Root cause: a table's label column reads as "left" and
its value columns as "right", so `detectTwoCol` misfired and the
column-band reader walked the whole label column top-to-bottom, then
the values as a diagonal — destroying the row↔value links, which for
an evidence tool is a provenance failure (you can't quote "12
nucleotide insert = 50, log-odds 3.91").

Fix: detect an aligned GRID and read it row-by-row. The signal that
can't be confused with prose is **a baseline carrying 3+ segments** —
`linesOfPage` splits a table row into one segment per cell at the
inter-column gaps, and two-column prose is exactly two columns, never
three. `hasGrid` fires when the page is grid-dominant OR carries a
run of ≥4 grid rows (an embedded table on a prose page — the
mean-length dilution the shredded-text warning would also miss).
`mergeGridRows` then joins each row's cells left-to-right with a
middle dot (column boundaries survive into the markdown; a single-cell
quote still grounds) and emits each row as its own block; 1-segment
prose lines around the table pass through and flow normally.

Checked FIRST, before the two-column logic: on a mixed prose+table
page `detectTwoCol` itself misfires (a value column reads as a right
column), so gating the grid handler on `!detectTwoCol` let the table
scramble anyway. A genuine two-column prose paper never reaches three
segments, so grid detection is the safe primary. Not solved: 2-column
label/value tables (ambiguous with prose columns by segment count —
left to the extraction warning), and pretty pipe-table markdown (the
dot-join is quotable, not rendered as an HTML table). Verified against
table-only, embedded-table, and shared-baseline two-column fixtures
plus the full suite.

## 2026-07-08 — PDF stack, round three: the reader's draft machine was the last corruption source

Tags: `bug`, `design`.

The adversarial workflow's final lenses (wire round-trip, build layer,
reader integration, storage) landed after the second sweep merged
(#113). The through-line of this round: **the capture pipeline was
clean, but the reader's draft-state machine un-cleaned it.**

- **`dirtySource: 'reader'` was a mandatory turndown round trip.** The
  reader's draft machine assumes the HTML body is canonical unless the
  user edits markdown — so every untouched PDF publish recomputed the
  body as `htmlToMarkdown(markdownToHtml(markdown))`. That renumbered
  a filing's "14./15./23." numbered paragraphs to "1." on the wire
  (markdownToHtml discarded list start numbers; turndown renumbered
  from 1) and salted the body with escape backslashes that shifted
  every pageMap anchor. PDFs now adopt with `dirtySource: 'markdown'`
  (the reconstruction IS the capture; `content` is derived), the
  capture hash covers the same body publish ships, and markdownToHtml
  preserves `<ol start>` so numbered paragraphs survive display and
  genuine edits alike. Lesson: when a pipeline has one canonical text
  and several derived views, every default that silently re-derives
  the canonical from a view is a corruption vector.
- **Durable identity must live where snapshots happen.** Figure imgs
  were re-hydrated by matching `src^="xray-figure:"`, but htmlDraft
  snapshots the body AFTER hydration (entity tagging, field blur) —
  so re-renders injected imgs whose src was an already-revoked blob
  URL and figures broke permanently. Re-hydration now keys on
  `data-xray-figure`, which survives every snapshot.
- **The publish copy is not the archive copy.** Publishing stored the
  event-shaped article (markdown in `content`) into the archive row;
  "Load archive" injected that markdown as HTML — a garbled, escaped
  single line with figures as literal text — while keeping the raw
  capture's pageMap against the round-tripped body (confidently wrong
  page anchors). The archive now stores a reader-shaped copy and drops
  pageMap when the saved markdown is no longer the text it indexes.
- **pdf.js needs its data files, not just its code.** No `cMapUrl` →
  predefined-CMap (CJK) PDFs extracted zero text and were refused as
  "scans"; no `wasmUrl` → JBIG2/JPEG2000 could never decode (the
  no-wasm fallback ALSO resolves relative to `wasmUrl`). The build now
  copies `cmaps/`, `standard_fonts/`, `wasm/`, `iccs/` into `dist/`.
  And one more missing-API kill: the worker's `fingerprints` getter
  calls `Uint8Array.prototype.toHex` during `GetDocRequest` — round
  two's scan grepped `fromHex` but not `toHex`, so capture stayed dead
  on Firefox 128–132 / Chrome ≤139 until this round's shim.
- Storage hygiene: archive DB connections now close on
  `versionchange` (a workspace reset used to block forever on the
  reader's open handle); the `lastAccessed` bump re-reads inside its
  write transaction instead of writing back a stale record; re-capture
  dedupe hits refresh the pruner's grace window; the prune pass is
  throttled (it materializes every stored byte payload).

Deferred, deliberately: page anchors for quotes duplicated across
pages still resolve to the first occurrence (the grounding API has no
prefix/suffix context yet — the claim's own TextQuoteSelector stays
correct, and the FragmentSelector is additive); `<embed>`-wrapped PDFs
on HTML pages have no capture path (feature, not bug); alpha-bearing
drawable hashes remain theoretically browser-dependent (accepted in
#111's design).

## 2026-07-08 — PDF stack, second sweep: the bugs that survived the first one

Tags: `bug`, `external`.

A second adversarial pass over the Phase 18 PDF stack (multi-lens
agent fan-out, every finding verified by executing the module or
pdf.js itself before fixing). The ones worth remembering:

- **pdf.js 6.x has no `PDFDocumentProxy.destroy()`.** Teardown moved
  to the loading task; our `try { doc.destroy(); } catch (_) {}`
  swallowed the `TypeError` and skipped cleanup entirely —
  resurrecting the exact worker-document leak the previous sweep
  claimed to fix. Lesson: a best-effort catch around a *method call*
  hides API drift; when a vendored API changes shape, the catch turns
  a loud break into a silent regression. Verify the method exists in
  the pinned version (we now call `loadingTask.destroy()`, and the
  stub-engine test asserts it fires on success AND refusal paths).
- **Coordinates: pdf.js rotation lives in the viewport, not the
  data.** `getTextContent` transforms and operator-list CTMs are raw
  PDF user space; `/Rotate` and the MediaBox origin are applied only
  by `PageViewport`. We consumed raw coordinates against
  rotation-swapped viewport dimensions, so a `/Rotate 90` page (a
  landscape exhibit in a filing, a rotated scan with a text layer)
  reconstructed as shredded, interleaved, quote-corrupting text — on
  an evidence tool's highest-stakes documents. All coordinates now
  map through `viewport.convertToViewportPoint` / a composed
  viewport transform (`viewportBBox`), then flip back to the layout
  engine's y-up convention. Identity for unrotated origin-0 pages.
- **Content-hash dedupe vs per-row provenance:** figure rows are
  keyed by pixel hash and shared ACROSS documents, but the row's
  `pdf-figure:<parent>` url names only the FIRST document that stored
  it. The orphan pruner keyed liveness on that parent, so evicting the
  first article deleted the figure out from under every other article
  citing it. When identity is content-addressed, liveness has to be
  computed from the *citing* side (scan article bodies for
  `xray-figure:` refs), not from a single stored back-pointer.
- **Furniture needs position, not just repetition.** The
  digit-stripped signature (`"12 Ibid., at 340."` → `"# ibid., at #."`)
  made every repeating footnote tail in a legal brief "furniture".
  Real headers/footers repeat at a *fixed y*; content that repeats
  modulo digits wanders with the stack height. The y-band check (6pt,
  per margin side) separates them cleanly.
- **pdf.js's actual arg shapes are typed, transferable, and new-API
  hungry.** Three more instances of the same lesson as `destroy()`:
  the Form-XObject `/Matrix` is a `Float32Array` (an `Array.isArray`
  guard silently disabled #111's form-transform fix); Chrome's
  ImageDecoder JPEG path yields a `VideoFrame` — which has NO
  `width`/`height`, only `displayWidth` — so the drawable duck-type
  dropped every JPEG photo figure on Chrome; and `MessageHandler`
  calls `Promise.try` (Firefox 134+) on EVERY main↔worker message, so
  PDF capture was entirely dead on the Firefox 128–133 ESR floor
  until the polyfill grew that shim. When consuming a vendored lib's
  internals, grep the PINNED build for the shapes, don't trust the
  docs — `tests/pdf-capture-realpdf.test.mjs` now pins the whole
  contract end-to-end against the real engine.
- Smaller but real: letter↔digit hyphen breaks lost their lexical
  hyphen (`COVID-19` → `COVID19` — hyphenation only ever splits
  letters from letters, so a digit on either side means the hyphen is
  content); sub/superscript runs split off their line (`H2O` → `H O
  … 2`) — size-mismatched runs now merge by vertical band overlap;
  dropcaps promoted body lines to headings (dominant char-weighted
  size, not max glyph); 1-bit line art (`GRAYSCALE_1BPP` packed rows)
  was silently dropped by channel inference; annotation appearance
  streams corrupted the operator walk's CTM; `#page=3` fragments
  forked the capture identity (the d-tag hashes the raw URL);
  old-style arXiv ids never matched (the regex wanted 8 digits,
  pre-2007 ids have 7).

Files: `src/reader/pdf-capture.js`, `src/shared/pdf-layout.js`,
`src/shared/archive-cache.js`; regression tests in
`tests/pdf-capture-stub.test.mjs` (stub-engine end-to-end),
`tests/pdf-capture-geometry.test.mjs`, `tests/pdf-layout.test.mjs`,
`tests/archive-cache.test.mjs`.

## 2026-07-07 — Phase 16.1–16.4: moral-lens implementation choices

Tags: `design`.

Phase 16 landed as one PR (16.1–16.4 on one branch rather than the
stacked train — the slices are small and the 16.4 guards only make
sense against the whole surface). Everything follows the 16.0.5
amendment; the second-guessable calls it left open, decided here:

- **Lens assertion typing is code-side and user-controlled, never
  model-assigned.** The §7 disposition/`corpus_stance` exclusivity is
  enforced at parse time, which requires knowing each claim's type
  BEFORE validation — a model-assigned type could evade the §3.2
  firewall by mistyping a factual claim as evaluative. Defaults: a
  claim with any truth-adjudicable proposition defaults to `factual`
  (failing toward the firewall); `interpretation`/`stated-value`
  propositions default to `evaluative`; un-atomized claims default to
  `evaluative` with the type select visible in the setup form. The
  chosen typing lives only in the run's output, never on the claim.
- **The grounding report's numbers are computed, not model-echoed:**
  grounded/inference-only counts from the citations' grounding levels,
  per-authority `coverage` from citation frequency (≥ half the claims →
  high), `thin_representation_flags` from the deterministic v1 rule
  (declared multi-vocal worldview + single-work corpus). The model
  supplies only `thin_coverage_flags` + `recommended_sources` — its own
  honesty flags.
- **The session cache deliberately breaks the house
  `storage.session || storage.local` fallback idiom.** Falling back
  would durably write a derived view and void the zero-durable-writes
  guarantee; no session area (nothing modern) simply means no cache.
- **The §5.3 symmetry flag is a deterministic proxy:** a panel where
  every jurisdiction's dispositions run more `rejects` than
  `endorses`/`partially-endorses` flags as possibly one-sided. Crude by
  design — the disclosure is the product, the flag is a nudge.
- **Registry ids are display-name slugs** (`bell-hooks`), matching the
  §7 examples; authority ids hash (citation|excerpt) so re-authoring
  converges. `lens_jurisdictions` joined `WORKSPACE_CLEAR_KEYS` (and
  its pin test) so backup/reset cover corpora.
- **The tiny-schema walker moved** from `audit/findings-schemas.js` to
  `shared/schema-walker.js` (verbatim; audit tests unchanged) so
  `lens-schemas.js` shares it instead of forking.
- The Q1 `admissibility` enum was authored here (nine values; the
  editorially-published subset is everything but `social-capture`) —
  the design named examples, not the enum.

Files: `src/shared/lens-taxonomy.js`, `src/shared/jurisdiction-model.js`,
`src/shared/lens-schemas.js`, `src/shared/lens-prompt.js`,
`src/shared/lens-engine.js`, `src/shared/schema-walker.js`,
`src/shared/llm-client.js` (`runLensPass`/`getLensConfig`),
`src/background/index.js` (`xray:lens:*`), `src/reader/lens-section.js`,
`tests/lens-*.test.mjs`. So-what: if lens behavior ever contradicts
`docs/MORAL_LENS_JURISDICTION_DESIGN.md` (as amended), the doc governs;
the deterministic computations above are implementation choices and are
fair game to revisit — but the parse-time firewall enforcement and the
no-local-fallback cache are load-bearing, not style.

---

## 2026-07-07 — PDF + figures bug sweep: nineteen fixes across the Phase 18 stack

Tags: `bug`, `design`.

A three-angle adversarial review of PR #108 (every finding verified by
executing the modules) surfaced 19 real bugs; all fixed same-day. The
ones worth remembering:

- **The publish path was structurally dead for PDFs.** `?pdf=` never
  wrote the session record, and signing always proxied to
  `record.sourceTabId` — a tab that cannot exist, since no content
  script runs in a PDF viewer (the feature's own premise). Tabless
  records (`sourceTabId: null`) now sign in the worker via the Signer
  façade. Lesson: a capture surface that bypasses the content script
  must be walked through the whole publish path, not just render.
- **Wrong-document capture:** `pdfDocumentUrl` unwrapped `file=`/`src=`
  wrapper params before checking the URL itself, so
  `real.pdf?file=<decoy>` captured the decoy. Order matters when one
  URL can name two documents; the direct read now wins and unwrapping
  requires a viewer-shaped shell.
- **pdf.js store dispatch:** globally-cached images (`g_`-prefixed —
  anything on ≥2 pages) live in `commonObjs`, and asking `page.objs`
  for them never throws OR calls back. The 'fallback' catch was dead
  code; every repeated image burned an 8s timeout per page and the
  logo-furniture detector never saw a repeat. When pdf.js dispatches
  on a prefix, so must we.
- **Encoder-dependent content addresses:** figures were hashed by
  their `canvas.toBlob` PNG bytes; PNG encoders differ across
  browsers/versions, and those refs ride inside the markdown that
  feeds the canonical `x` — byte-identical PDFs forked their article
  hash. Figures are now addressed by sha256 of decoded RGBA pixels.
  Residual (documented): JPEG decoder drift across engines can still
  vary pixels; caps can vary figure inclusion.
- **Figures now flow through reading order as pseudo-lines** instead
  of a post-hoc y-scan that assumed y-descending paragraphs (false
  after two-column reordering — a right-column figure landed at char
  0). Narrow gutters (LaTeX 10pt, IEEE 18.0pt) are found structurally:
  a consistent mid-page x-band of gaps across baselines is a gutter;
  word gaps wander, gutters don't.
- **Archive-after-success:** source bytes/figures were archived before
  the scan-refusal gate, permanently orphaning blobs in a store that
  had no eviction path at all. Bytes now land only after
  reconstruction succeeds, and `pruneSourceOrphans` (30-min grace)
  rides the eviction hook.

Known limits documented instead of fixed (design §5.5): RTL reading
order, captions above tables, superscript markers emitted before
their line, multi-line headings splitting, vector-graphic figures.

## 2026-07-05 — pdf.js 6.x needs `Map.getOrInsertComputed` / `Math.sumPrecise` polyfills (figures returned zero)

Tags: `bug`, `external`.

C4.2 figure extraction shipped green on CI and passed a Node harness, but
in a real browser produced **zero figures** while text captured fine. The
Node harness hid it: pdf.js runs a *fake worker* (main-thread) there, and
`node --test` never touches the built bundles at all.

Reproduced by driving the actual built `dist/pdf-engine.bundle.js` + worker
in headless Chromium (Playwright) against the real PDF. `getOperatorList()`
threw `this._intentStates.getOrInsertComputed is not a function`. pdf.js
**6.1.200 calls `Map.prototype.getOrInsertComputed` unconditionally** (15
sites, incl. `getOperatorList`), and `Math.sumPrecise` for text metrics —
both are bleeding-edge TC39 proposals **absent from the Firefox 128 floor
and older Chrome** (the harness's bundled Chromium among them). Our figure
path calls `getOperatorList()`; its `try/catch` swallowed the throw and
returned no figures. The text path uses a different call, so it survived —
which is exactly why the failure looked so selective.

Fix: `src/reader/pdf-collection-polyfill.js` shims
`Map`/`WeakMap.prototype.getOrInsert{,Computed}` and `Math.sumPrecise`
(Kahan-Neumaier), imported FIRST by both `pdf-engine.js` (main thread) and
`pdf-worker-entry.js` (worker) so the methods exist before pdf.js runs in
either context. Idempotent, no-op where native. With it, the same harness
recovers 14/15 figures, all decoding to PNG. This is load-bearing for the
stated Firefox-128 floor — without it, `getOperatorList()` (hence figure
extraction, and any future operator-list work) is broken on FF128.

Two follow-on notes worth keeping:
- **The browser image object shape differs from Node's.** Real worker +
  OffscreenCanvas hands back `{ data, width, height, bitmap, … }` with an
  `ImageBitmap`; Node's fake worker returned `{ data, … }` only. The
  decoder now tries the bitmap, then falls back to raw channels — because
  one image (page 20) came back as a *dimensionless* bitmap with empty
  data and can't be recovered either way (14/15; the capture never fails).
- **Test the built bundle in a browser, not just modules in Node.** Every
  bug here (this, and the earlier decode-shape issues) lived in the exact
  gap `node --test` and CI can't see. A Playwright smoke over the bundles
  would have caught it pre-merge.

## 2026-07-04 — PDF figures via operator-list transform walk (Phase 18 C4.2)

Tags: `design`, `pattern`.

Earlier PDF capture dropped every image. Recovering them turned on a
few non-obvious choices worth recording:

- **Placement comes from the operator list, not the text content.**
  `page.getTextContent()` gives glyph positions but says nothing about
  images. To know *where* a figure sits (so it can be interleaved into
  the reading-order paragraph stream) you have to replay the page's
  operator list yourself, tracking the CTM: `save`/`restore` push/pop a
  matrix stack, `transform` composes (2×3 multiply), and at each
  `paintImageXObject` the current matrix's `[a,d]` are the displayed
  width/height in points and `[e,f]` the position. The unit-square
  convention means `|ctm[0]|`/`|ctm[3]|` are the on-page size directly.
  `pdf-layout.js#mergeFigures` then inserts each figure by its
  top-of-image `y` between paragraphs. Verified against the real
  `will_decision.pdf` (14 figures, all landing at sensible points) with
  a Node harness replicating the exact walk before trusting the
  in-extension path.
- **Two decode shapes.** pdf.js hands back either an `ImageBitmap`
  (`img.bitmap`) or raw `{data,width,height}` with 1/3/4 channels; both
  go through a canvas → `toBlob('image/png')`. Channel count is inferred
  from `data.length / (w*h)` — 3ch (RGB) and 1ch (gray) are expanded to
  RGBA before `putImageData`.
- **Same-image dedupe is content-addressed and layered.** A page can
  paint one XObject twice (clip-split renders) → dedupe within a page by
  sha256 so it shows once. An identical image on ≥3 pages is furniture
  (logos/watermarks) and is dropped wholesale — the image analogue of
  the repeating-header-text furniture pass. Survivors are archived in
  `source_documents` keyed by their hash, and the markdown references
  them as `![alt](xray-figure:<sha256>)`, hydrated to a blob URL at
  render. This is a *derived* representation: the bytes already live
  inside the archived source PDF, so the source hash still governs
  provenance — the figure PNGs are a convenience, not new evidence.
- **C4.1 interaction:** an image-only page used to trip the
  `sparse-pages` "content is missing" warning. Now that its image is
  captured, that warning would be a lie, so `extractionWarnings` excuses
  any sparse page that carries a captured figure. A page with neither
  text nor figure is still flagged.
- **Known gaps:** no OCR of text *inside* a figure, and vector-drawn
  charts (path ops, no image XObject) aren't captured — those need the
  screenshot/render path, deferred.

## 2026-07-03 — Complex content lands: islands re-sanitize at render; PDF columns share baselines

Tags: `design`, `bug`.

Phase 18 C1–C4 implementation notes, the second-guessable parts:

- **HTML islands are never trusted at render.** Complex tables and
  MathML are preserved as fenced HTML inside the markdown — but
  captured markdown round-trips through relays, so `markdownToHtml`
  re-sanitizes every island body through the same allowlist serializer
  that produced it (`content-islands.js`), and renders it as escaped
  text when it can't. The fence is a display hint, not a trust
  boundary. The serializer is deliberately canonical (fixed attribute
  order, collapsed/trimmed whitespace, unknown elements unwrap,
  script/style/etc. drop outright) so islands can't wobble the
  canonical article hash.
- **Two-column PDFs put both columns on the SAME baseline.** The
  first layout-engine draft clustered runs by baseline only, which
  interleaved the columns line-by-line. Lines now split at
  gutter-sized x-gaps (≥ max(18pt, 1.5× font size)) before column
  ordering. Caught by the synthetic-fixture tests, worth remembering
  for any future run-geometry work.
- **PDF page anchors ground against the extracted markdown**, not the
  rendered body text — the pageMap indexes the markdown, and rendered
  offsets differ. Page lookup re-grounds the quote via
  quote-grounding against the markdown substrate (memoized index).
- **Scans are refused, not mis-captured**: near-zero text density
  throws with a pointer to the designed LLM transcription tier
  (COMPLEX_CONTENT_DESIGN.md §6) — shipping a wrong capture silently
  would be the provenance failure this whole train exists to prevent.

---

## 2026-07-03 — Thin claims stay thin for display, not for provenance; entities keep their verbatim mentions

Tags: `design`.

Follow-up to the grounding work, closing two more provenance holes the
maintainer called out:

- **Claims.** The thin redesign (Phase 10) buried the verbatim quote
  inside the anchor selector JSON (truncated at 500 chars) and the
  30040 wire round-trip dropped it entirely — `buildClaimEvent` wrote
  an `anchor` tag that `parseClaimEvent` never read. Claims now carry
  first-class `quote` + `article_hash` (the Phase 13.4 canonical hash,
  binding the quote to the exact text version) locally and on the wire
  (`quote`/`x`/`captured_at` tags, all additive), with the parse side
  reading everything the build side writes. The deliberate part:
  **thin stays thin in the UI** — these fields are auto-populated by
  the capture paths (grounded span, manual selection), never new form
  fields. `x` reuses the audit family's tag so one `#x` query now
  joins an article version to its audits AND its claims.
- **Entities.** The display name is allowed to disambiguate beyond the
  article's wording ("Elena Vargas", not "the mayor") — but that
  meant LLM-suggested entities lost WHERE the article named them, and
  near-duplicate names minted duplicate ids (the id derives from the
  name). Entity proposals now require a grounded verbatim `mention`;
  accepting one tags the article with the same `{entity_id, context}`
  ref the manual tagger produces (so the mention survives renames and
  reaches the publish flow), and `findEntityMatches` offers
  link-to-existing at accept time (single candidate = default choice)
  instead of silently accumulating "Mayor Elena Vargas" next to
  "Elena Vargas". Retroactive registry cleanup + the entity-as-
  subscribable-corpus model are designed, not built:
  `docs/ENTITY_CORPUS_DESIGN.md`.

---

## 2026-07-03 — Suggest provenance is grounded: the model's quote is a search key, not evidence

Tags: `design`, `bug`.

The LLM Suggest anchor path leaked provenance: `resolveQuoteToSelectors`
did a raw `indexOf` and, on a miss, still emitted a quote-only
TextQuoteSelector containing text the article doesn't contain — a
permanently orphaned anchor (the resolver requires an exact match). The
claim validator never looked at the quote, and the review panel never
displayed it, so a paraphrased "quote" (Opus in particular summarizes
across passages) sailed through Accept with its provenance silently
gone.

Fix is a contract change, not a tolerance tweak
(`shared/quote-grounding.js`): the model's quote is only a SEARCH KEY.
It's located exact → typography-normalized (curly quotes/dashes/
ellipsis/NBSP/case/whitespace, via a per-char offset map) → guarded
fuzzy (token-F1 ≥ 0.8, ≥ 4 tokens, never for short quotes), and
whatever tier hits, the stored anchor is rebuilt from the ARTICLE'S OWN
bytes at the matched span (TextQuoteSelector with real prefix/suffix +
a TextPositionSelector with raw offsets; the resolver only honors the
position when the text there still reproduces the captured exact). A
miss is a hard answer: with a grounding index in ctx, the proposal
firewall rejects claims and findings whose quotes don't locate — the
review panel shows ⚓ chips (verbatim / normalized / close-match % /
not found), lets the user edit the quote in place to re-anchor, and
"Accept all valid" can no longer take an ungrounded item. Claims store
a local-only `anchor_provenance` (`method`/`score`/`proposed_quote`) so a
repaired anchor keeps what the model originally wrote. Label quotes on
assessments stay soft: an unlocatable one saves the label with NO
anchor (never a fabricated one) and says so in the panel.

Second-guessable calls, on purpose: (1) a quote-only edit does NOT flip
`suggested_by` to `user` — the assertion is still the model's and the
anchor is machine-verified either way; (2) the fuzzy tier repairs
small drift (a dropped word, a "fixed" typo) rather than rejecting it,
because the repaired span is real article text the human sees before
accepting; wholesale paraphrase stays a hard reject.

---

## 2026-07-05 — Verify-on-ingest + the 32126 rendezvous (Knowledge Sharing KS.1–KS.4)

Tags: `bug`, `design`.

- **The bug half (KS.1):** `Crypto.verifySignature` existed, was
  BIP-340-vector-tested — and was called by nothing. Every read path
  trusted relays blindly (`queryRelays` accepted any frame with an
  `.id`). Verification now runs inside `queryRelays`' `finish()`:
  that one choke point covers the portal, side panel, reader,
  adjudicate modal, and archive reconstruct — and also entity-sync,
  which calls `NostrClient` directly from the side panel and would
  bypass a fix placed in the `xray:relay:query` handler. A verified-id
  LRU keeps portal re-syncs cheap; cache hits still re-check the id
  hash, so a cached id can never launder tampered content.
- **The design half (KS.2/KS.3):** the deterministic platform-account
  pubkey was the only cross-user person identifier on the wire, and
  nothing published it — kind 32126 had zero publish callers since
  Phase 9. It now publishes flag-gated (default off),
  republish-every-run: it's addressable (`d` = account key) and the
  portal already classed it `no-ledger`, so no publish ledger exists.
  Foreign entity ids derive from `sha256('foreign:'+pubkey)`, NOT the
  deterministic `(type, name)` recipe — the latter would make a
  stranger's "Donald Trump" silently collide with yours; the
  adopt-time prompt owns that merge decision.
- Design doc: `KNOWLEDGE_SHARING_DESIGN.md` (now governs the
  follow/incorporation engine; TEAM_CASE keeps the case-specific
  parts). Wire changes are exhaustively its §10: 32126 gains its first
  publisher + one additive role-marked p tag. `NIP_DRAFT.md` gained
  the 32126 section and the verify-on-ingest consumer rule.

---

## 2026-07-03 — Sprint descopes: public relays only; consensus-protocols idea dropped

Tags: `design`.

Two owner decisions, same day as the scope freeze:

- **No self-hosted relay.** Running relay infrastructure was cut to
  maximize time on X-Ray itself; the Epistack graph publishes to 2–3
  durable public relays. The honest durability story was always the
  bundled raw signed-event JSON (relays are the live demo, not the
  archive); the first real 30063 publish (SMOKE §15 round trip) now
  doubles as the public-relay kind-acceptance test for 30040–30064.
- **`docs/ideas/CONSENSUS_PROTOCOLS_PLAN.md` deleted** (harvested from
  the dead trust-systems branch only days before). The
  aggregation/web-of-trust/bridging direction is not being pursued —
  team collaboration will run on roster-scoped trust (you invited
  them), not computed consensus. Anyone needing the old text can
  recover it from PR #93's history; the repo should not advertise a
  direction the owner has ruled out.

---

## 2026-07-03 — Identity profiles: one live slot, derived active, reset as the paired half

Tags: `design`.

For the Epistack sprint the maintainer wants a dedicated npub, which
surfaced that "identity" lived in four places: the Signing tab's
primary key, the reserved `xray:user` LocalKeyManager slot (signs
30078/10002), the portal's pasted viewer npubs, and per-entity keypairs
in the side panel. Decisions worth second-guessing later:

- **`local_primary_identity` stays the ONE live slot.** Profiles
  (`identity_profiles`, keyed by pubkey) are saved copies; "active" is
  DERIVED by matching the live slot against the registry. No signing
  path changed; no second source of truth to drift.
- **Switching identity ≠ clean slate — by design.** Publish stamps live
  on the records themselves (`publishedPubkeys`, ledger marks), so a
  bare switch would make reconcile attribute the old npub's publishes
  to the new one. The paired half is **Start fresh workspace**
  (Advanced): clears the content stores + `xray-archive`/`xray-audits`
  IndexedDB, keeps settings/relays/flags/LLM-key/saved identities. The
  clear/keep/database lists are exported constants with exact pin
  tests — a new content store that isn't added to the clear list fails
  the suite.
- **Entity keys are workspace content, not user identity.** Reset
  clears `local_keys` (the `xray:user` sync key re-mints lazily); the
  side panel's per-entity keys stay where they are. The portal npub box
  is a read-only viewer for *other* archives — relabeled accordingly,
  with identity management pointed at Settings ▸ Signing.
- **Backups contain nsecs on purpose** (they're the user's own recovery
  file; the UI says to treat it like an nsec). `xray:llm:key` is
  excluded per its module's never-export rule; a pin test asserts the
  exclusion.

Files: `src/shared/identity-profiles.js`, options Signing/Advanced,
`src/portal/index.{html,js}`, `tests/identity-profiles.test.mjs`.

---

## 2026-07-03 — Repo-wide cleanup sweep: docs caught up to the Phase 15 merge

Tags: `pattern`, `design`.

A four-auditor sweep (docs staleness, hygiene, plans-vs-reality, live
gate) after the #89 merge found the docs lagging reality by exactly one
merge, plus accumulated drift. Fixed in one chore PR:

- **Stale-by-success claims**: CLAUDE.md said 937 tests (1018) and
  "Phase 15: design draft, no code yet" (merged); README said 519 tests
  and listed the removed Entities/Keypair-Registry options tabs; ROADMAP
  violated its own keep-current rules (Phases 13/14 headers still
  in-progress/design-agreed, Phase 15 "in progress"); SMOKE_TEST said
  Phases 0–9, five bundles, 528 tests; NIP_DRAFT said "fifteen kinds"
  (seventeen) and its query-filter recipe omitted 30062/30063;
  EPISTACK_ENTRY/WIN_PLAN still called Phase 15 "unmerged." All
  reconciled; the win plan's §2 premise is annotated DONE rather than
  rewritten.
- **Code fixes**: `config.js` version was stranded at `0.5.0` (only
  consumer is the content-script log banner — now 0.6.0 with a
  lockstep comment); the phantom `xray:flags:reload` comment in
  feature-flags.js replaced with the real loadFlags-before-gate
  pattern; the dead `xray:openSettings` listener removed from the SW
  (no sender anywhere — context menus call `openOptionsPage()`
  directly); `web-ext` added to devDependencies so `npm run lint`
  works outside CI (it was global-install-only, broken on fresh
  clones); stale "Phase 1" comment in ci.yml updated.
- **Branch cleanup**: 64 remote branches verified fully
  merged/superseded (by ancestry after unshallowing, or by per-file
  content identity for pre-history-rewrite branches) and queued for
  deletion — the automation credential gets HTTP 403 on ref deletion,
  so the verified list + one-liner ship in PR #93 for the maintainer
  to run. Kept:
  `feature/phase-9b-metadata-ui` — the only copy of the unbuilt
  live-page metadata overlay and the sole consumer of the
  intentionally-orphaned `metadata/ranker.js`/`trust-graph.js` modules
  on main. The one unique artifact on the dead
  `decentralized-trust-systems` branch was harvested to
  `docs/ideas/CONSENSUS_PROTOCOLS_PLAN.md` with a kind-collision
  warning (its proposed 30050–30056 collide with live kinds), so its
  branch is safe to delete.
- **CHANGELOG link refs**: `[Unreleased]` compared against `v0.5.0`
  and `[0.6.0]`/`[0.5.1]` had no link definitions. Root cause worth
  recording: **the v0.6.0 tag was never cut** — `release: v0.6.0`
  (`eee77e4`) bumped the manifest but nobody tagged, so `release.yml`
  hasn't run since v0.5.1 and "v0.6.0" exists only as a manifest
  string. The 0.6.0 link def points at the release commit as the
  honest stand-in. So-what: cut a real tag (v0.7.0, since Phase 15
  has since merged) before pinning any provenance-bearing artifact —
  e.g. the Epistack capture run — to a build.

---

## 2026-07-03 — Phase 16 design amendment (16.0.5) from the pre-implementation audit

Tags: `design`.

A pre-implementation audit of `MORAL_LENS_JURISDICTION_DESIGN.md` (six
area reviews + a completeness pass) found the 2026-06-24 draft not
implementable as written. The amendment (docs-only, no code) records the
decisions; the second-guessable ones, with reasons:

- **The source prompt never existed in the repo.** The draft "carried
  forward verbatim" templates and principles from a
  moral-lens-jurisdiction prompt draft that was never committed. Rather
  than block on recovering it, Appendix A re-authors the eight principles
  and three definition templates from the design's own descriptions —
  now the normative input to 16.2. (Same fix for the phantom "X-Ray's
  copyright rules" citation: §10 writes the quoting discipline down,
  500-char excerpt cap per the anchor `EXACT_LENGTH_CAP` precedent.)
- **Jurisdictions are registry-primary, not entities.** §4's "nothing new
  at the storage layer" was false: `ENTITY_TYPES` has no fit for a legal
  code or a tradition, entity records have no home for jurisdiction
  fields, and entity creation mints keypairs + kind-0/browser exposure
  that "Christianity" must not inherit. A local jurisdiction registry
  (platformAccounts precedent) holds the records; `entity_id` is an
  optional persona-only link. Corpus is never bound via `claim.about[]` —
  that would sweep lens artifacts into truth/case surfaces.
- **Authorities are citation-first.** "Captured claim + W3C anchor"
  cannot cite a book, scripture, or statute; the authority record carries
  a bibliographic citation (work/edition/ISBN/locator/language), with
  claim+anchor as the web-only specialization.
- **Lens typing is its own enum.** `normative`/`framing` never become
  proposition classes; `LENS_ASSERTION_TYPES` adds `evaluative` to cover
  the two classes Phase 15 actually hands over (`interpretation`,
  `stated-value`); `factual` rows get `corpus_stance` and may not carry a
  `disposition` (schema-enforced) — the firewall survives contact with
  the model by construction, not by prompt hope.
- **"Computed-on-open" became "computed on explicit invoke."** The
  dossier pattern is free and deterministic; a lens pass is a paid,
  nondeterministic API call, and 14.5's "one pass per explicit user
  action" governs. Session cache only; zero durable writes,
  guard-tested. The per-jurisdiction "integrity report" was renamed
  **grounding report** (Phase 15 owns "Integrity"), and the living-person
  guardrail fails closed (absent bit ⇒ treated as living), with social
  captures inadmissible for living personas.
- **Base-branch constraint:** `origin/main` had the full 14.5 substrate
  but zero Phase 15 files while the #79–#89 train was open, so the
  amendment barred `truth-*`/`integrity-*` imports. The train merged as
  #89 later the same day, dissolving the constraint — but the
  cross-vocabulary disjointness pins deliberately keep asserting string
  literals, not imports (a pin that imports the enum it pins drifts
  with it).
- **Absorbed from the parallel review (PR #91):** the P5 symmetry
  obligation extends below panel selection to **corpus curation** — a
  sympathetic-looking jurisdiction loaded with a cherry-picked corpus
  defeats every per-reading honesty signal. New `corpus_provenance`
  disclosure (code-stamped, self-attested) and
  `thin_representation_flags` (distinct from thin *coverage*). #91's two
  other design-doc hunks (the fabricated §3 lineage citation, the §5.2
  misquote) had independently been caught and fixed by this amendment's
  audit + review pass — convergent findings, differently worded.

Files: `docs/MORAL_LENS_JURISDICTION_DESIGN.md`, `docs/ROADMAP.md`
(§Phase 16). So-what: if 16.x code ever contradicts the amendment, the
amendment governs — and the original prompt draft, if it surfaces, gets
reconciled against Appendix A, not the other way around.

---

## 2026-07-02 — Phase 15.10: authoring UI — eligibility as the option list

Tags: `design`.

The integrity modal's central choice: **eligibility rules render as
the option space, not as validation errors.** Only word-eligible
propositions appear in the word list, deed candidates filter to the
word's about-entities, match chips come from matchStatesForWordClass —
so the §3.1/§3.4 exclusions (ascribed, unclassified, wrong-class
matches, cross-entity pairs) are mostly unreachable rather than merely
rejected; the model validators stay as the backstop. Attestation
fields on the supports-link flow attach only when the author asserts
an origin key (no origin, no attestation — never defaulted), and the
adjudicate modal now surfaces the 15.2 convergence measurement for
propositions that have attestation edges, closing the audit's
"computed but invisible" note for convergence.

## 2026-07-02 — Phase 15.9: read-back — the missing half, and one deliberate non-persistence

Tags: `design`.

The audit's headline gap ("write half done, read half missing") closes:
portal corpus/reconcile/library/inspector learn 30063/30064, the
entity view gains the §3.5 integrity-record block, and the adjudicate
modal fetches others' rulings. Second-guessable calls:

- **Coverage declarations are per-reading, never persisted.** The
  portal's rollup form asks for assessed/universe/method each time.
  Persisting a declaration would turn a reader's one-time assertion
  into stored state that silently goes stale as new commitments
  arrive — the exact back-door §6.3 warns about. Re-declaring is
  deliberate friction, like the exhaustive-enum tests.
- **Local-only counts exclude superseded rulings** (chain heads only):
  a superseded verdict never publishes by design, so counting it as
  "local only / never published" would manufacture a permanent
  phantom problem in the reconcile view.
- **Others' rulings dedupe by (author, d) keeping newest** — the
  addressable-replacement semantics applied client-side, since relays
  MAY return stale versions; and the read-side adequacy parsers mean
  malformed foreign rulings are simply absent, with a UI note saying
  so rather than pretending the relay set was clean.
- The integrity block computes on open and removes itself when the
  entity has no adjudication data — an empty scoreboard is not a
  scoreboard (rendering zeros for everyone would read as universal
  cleanliness, the §2 selection-bias trap in miniature).

## 2026-07-02 — Phase 15 conformance pass: what a 10-agent design audit caught

Tags: `design`.

A section-by-section adversarial audit of TRUTH_ADJUDICATION_DESIGN.md
against the shipped train surfaced gaps this slice closes; the calls:

- **The §3.6 precedent FIELD now actually lands** ("the field and the
  citation grammar land now so the record is precedent-ready") —
  `precedents: [{ref, weight}]` on verdicts/findings, `binding |
  persuasive` with **persuasive as the default** (an unweighted
  citation must never inflate itself), wire `a … precedent <weight>`
  slot-5, publish threading via the same resolve-or-omit posture as
  revision refs. Implementation stays deferred; the field no longer is.
- **Read-side evidence adequacy**: the parsers now null-parse an
  evidence-less `established-*`/one-sided `contested` (30063) and an
  evidence-less substantive match (30064). Previously build-side only —
  the first foreign-event consumer would have rendered malformed
  rulings; now malformed means invisible, both directions.
- **§2 (v1) defenses that had shape but no surface**: adjudicator
  `exposure` disclosure (field + wire tag + modal input — author-
  asserted, never inferred), right-of-reply `reply_refs` (subject reply
  event ids referenced FROM the ruling; the dedicated UI stays
  deferred), and the rollup's missing **standard gate** (only
  clear-and-convincing/beyond-reasonable-doubt matches count; below-
  standard ones are excluded AND reported). Balance-sheet symmetry,
  bootstrap-on-high-knowability, and camp-discomfort calibration ship
  as documented **operator disciplines** (SMOKE_TEST §15) — honest
  about being practice, not mechanism, in v1.
- **`verdictVariance` accepts both field spellings**
  (`standard_of_proof` local / `standardOfProof` parsed) — the latent
  bug at exactly the seam where the two populations meet — and
  `matchVariance` gives integrity findings the same never-collapsed
  agreement surface.
- Doc debt: SMOKE §15 now covers 15.4/15.5 (rows 15.21–15.27) and the
  30064 publish leg; ROADMAP's stale "paused until Phase 14 merges"
  paragraph replaced with the PR-train map; the kickoff carries its
  post-implementation amendment per its own "fix the prompt" rule;
  EPISTACK_ENTRY no longer claims Phase 15 is unbuilt. GitHub-issue
  mirroring (ROADMAP step 5) remains dead-lettered since Phase 9 —
  noted, not resurrected, pending a decision on whether the practice
  survives.

## 2026-07-02 — Phase 15.8: the firewall and supersession as UI facts

Tags: `design`.

Reader adjudication UI (`adjudicate-modal.js`, the assess-modal
pattern — UI-in-shared, own injected styles, never content-script).
Calls worth recording:

- **Class chips ARE the proposition selector.** One proposition per
  (claim, class) by id construction (15.1), so the six class chips
  double as "load existing or start new" — no separate list UI, and
  the idempotency the model guarantees is what makes this shape safe.
- **The firewall is rendered, not just thrown.** Selecting
  `interpretation`/`stated-value` swaps the entire ruling form for the
  explainer; there is no disabled-but-visible verdict form to socially
  pressure a workaround. Saving still records the proposition — the
  classification is the point.
- **A fresh ruling never seeds from the active one.** When a verdict
  exists, Save becomes "Save superseding ruling" and the form starts
  BLANK — pre-filling would train edit-by-supersession muscle memory,
  and a superseding ruling should be re-derived, not tweaked.
- No delete affordances in the modal (propositions or rulings): chain
  deletion semantics live in the models and, later, the portal;
  putting them next to a Save button invites casual history surgery.

## 2026-07-02 — Phase 15.7: what holds a truth event back from a publish batch

Tags: `design`.

Publish wiring for 30063/30064 (`truth-publish.js` + the reader
section, the forensic-publish pattern). The selection rules that
weren't obvious:

- **Chain heads only.** A superseded verdict/finding never re-emits —
  its successor REPLACES it on relays (same author + `d`), so
  publishing an interior chain link would resurrect a retracted
  ruling. The predecessor's `publishedEventId` threads into the
  successor's `e supersedes` marker when known; a local-only
  supersession (predecessor never published) still publishes, with no
  lineage marker — there is nothing on relays to point at.
- **A constraint gap must resolve or the finding waits.** The 30064
  builder requires `constraintCoord` for a constraint cause; publishing
  without it would strip the very evidence that DISCOUNTS the finding
  — the worst possible lossy cut. So an unpublished constraint
  action-fact holds the whole finding for a later batch.
- **`revision_ref` passes through only when it already is a 30055
  coordinate.** The linker's `markPublished` records no wire d-tag, so
  a local link id can't be rebuilt into a coordinate in v1. The
  finding still publishes (the ref is auxiliary credit, unlike the
  constraint); the limitation is documented rather than silent.
- **Subject resolution mirrors forensic-publish**: the first
  `entity_ids` entry with an entity keypair wins; an unkeyed subject
  waits. And the verdict selector re-checks `isTruthAdjudicable`
  defensively — even a hand-edited storage record can't push a value
  verdict onto the wire.

## 2026-07-02 — Phase 15.6: two asymmetries in the truth wire, both deliberate

Tags: `design`.

Final planned Phase-15 slice — kinds `30063`/`30064` in a new
`truth-builders.js` (the audit-family precedent of a per-family
builder module; metadata/builders.js supplied the idioms, not the
home). Two wire asymmetries someone will eventually question:

- **30063 carries no `p` tag and gets a 1985 mirror; 30064 carries
  `p` and gets NO mirror.** A verdict attaches to a proposition
  (§5.3), so its mirror labels the claim coordinate — safe to
  aggregate. An integrity match is genuinely *about* a person's
  word-deed gap, so the subject `p` belongs on the full event — but a
  bare 1985 match-label on a pubkey, stripped of evidence and
  caveats, is precisely the decontextualized person-grade §3.5
  forbids ("no number travels without its evidence and caveats").
  So the mirror idiom from 30054/30062 is applied to one kind and
  deliberately withheld from the other.
- **The firewall is enforced read-side too.** `parseAdjudicatedVerdictEvent`
  null-parses an event whose `proposition-class` is `interpretation`
  or `stated-value`, and `parseIntegrityFindingEvent` null-parses a
  match invalid for its word class — a malicious or buggy publisher
  cannot make this client *render* a value-verdict, not merely not
  emit one. Caveat tags are likewise structural: no caveat, no parse.

Also: `DISPUTE_TARGET_KINDS` gained `verdict`/`integrity_finding`
(additive — older clients null-parse such disputes, which is the
correct conservative failure); wire supersession is NIP-01 addressable
replacement + an `e supersedes` lineage marker (the local chain keeps
full history; relays keep the current ruling per author, which is what
addressable kinds mean); and 30065 stays reserved with the `precedent`
a-tag marker grammar documented but unimplemented.

## 2026-07-02 — Phase 15.5: the entity record is computed, never stored — and the rollup gate is coverage.status

Tags: `design`.

Fifth Phase-15 slice (docs/TRUTH_ADJUDICATION_DESIGN.md §3.5). Calls:

- **Derived-on-read, not stored** (`truth-entity-record.js` follows
  the audit dossier's computed-on-open posture). An entity's record is
  a pure function of the proposition/verdict/finding/claim stores;
  persisting it would create a second source of truth that goes stale
  the moment a verdict supersedes.
- **Coverage is a caller-declared measurement, not stored state.**
  `declaredCoverage({assessed_count, universe_estimate, method})`
  throws on an undefended denominator (§6.3's open question honored
  by refusing bare assertions); the default is `undetermined`, and
  `optionalRollup` returns **null** unless coverage.status is
  `declared` — the §5.4 no-aggregate-without-coverage red line as a
  type gate. The rollup output is counts + a sentence with the
  coverage fraction and method inline; deliberately no percentage
  field exists.
- **Unscoreable predictions are listed, never dropped**: a resolved
  prediction with no recorded hedge is `no-hedge-recorded` (inventing
  a hedge to make Brier computable would be the estimation §1
  forbids); unresolved ones are `unresolved`. `calibrationV1`'s
  `mean_brier` is admissible because its formula and inputs ship with
  it — a measurement, not a score.
- **The forensic bridge is caller-asserted.** Entity ids and forensic
  `subject_ref`s are different keyspaces; `entityCorrectionRecord`
  composes 30062 findings only when the caller passes the subject
  ref, rather than guessing an identity join.

## 2026-07-02 — Phase 15.4: how "intent is not adjudicated" survives `lie` being in the enum

Tags: `design`.

Fourth Phase-15 slice (docs/TRUTH_ADJUDICATION_DESIGN.md §3.4). The
tension worth recording: §3.4's gap decomposition lists *lie* as a
cause, but red line §5.2 forbids intent adjudication. The resolution
implemented: **a gap cause is recordable only with a documented
explanation** — non-empty note, evidence entries where they exist —
so the system can record "he admitted on tape he knew it was false"
(documented) but can never *infer* a lie from the gap alone
(undocumented cause → rejected). Intent has no field; documentation
is the gate. Related calls in the same slice:

- **The same-entity rule resolves through the claims' `about`
  entities** (word claim ∩ each deed claim must be non-empty; the
  shared ids become the finding's `entity_ids`). A word claim with no
  about-entity is rejected — an integrity finding with no subject is
  meaningless, and defaulting one would manufacture it.
- **Match vocabulary is per word class** (`fulfilled`/`broken` for
  commitments, `consistent`/`contradicted` for values, honest states
  common) — the value firewall in enum form: a value cannot be
  "fulfilled" because it never promised anything, only professed.
- **`constraint_ref` must resolve to an enacted action-fact
  proposition** — the §3.4 "evidence, not an excuse" rule made
  mechanical: the discounting constraint clears the same
  proposition/attestation bar as anything else, and its corroboration
  is readable via the 15.2 convergence measurement.
- **`timelineForEntity` sorts chain heads on the earliest matched
  deed's `occurred_at`, undated last** — the pattern-not-instance
  read; a deed with no event-time cannot claim a place in the
  timeline, which is the no-false-precision rule again from the
  other side.

## 2026-07-02 — Phase 15.3: verdict chains are linear by id construction

Tags: `design`.

Third Phase-15 slice (docs/TRUTH_ADJUDICATION_DESIGN.md §3.3). The
calls worth second-guessing:

- **Supersession forks are impossible by construction, not by check.**
  A verdict id hashes `(proposition_id | supersedes)` — the chain
  position. A second attempt to supersede the same predecessor derives
  the id of the existing successor and idempotently returns it,
  untouched. The explicit "chains are linear" guard is therefore
  belt-and-braces (unreachable through the API); the real invariant is
  the id scheme. Corollary: `VerdictModel` has **no update method** —
  a changed ruling, sharper caveats, or new evidence is a superseding
  verdict, and `delete` is chain-head-only (re-opens the predecessor)
  so history never silently loses an interior ruling.
- **Evidence adequacy is per-state.** `established-true` requires
  `evidence_for`, `established-false` requires `evidence_against`,
  `contested` requires both; `unresolved` / `insufficient-evidence`
  may cite nothing — forcing citations there would manufacture
  evidence for the honest states, and their mandatory caveats carry
  the why.
- **The §6.1 open question (default standard of proof per class) is
  settled at implementation** as `defaultStandardOfProof`: stated
  commitments/values → `clear-and-convincing` (reputationally heavy
  utterances), facts/predictions → `preponderance`. Always overridable;
  the declared standard is stored on the record either way.
- **"Dispute reuse" ships as posture, not code.** §3.3 reuses the
  `30061` wire format as-is; a dispute cannot target a `30063`
  coordinate before verdicts publish, so extending
  `DISPUTE_TARGET_KINDS` with a verdict kind belongs to 15.6 (wire),
  not here. Nothing dispute-shaped was rebuilt locally.

## 2026-07-02 — Phase 15.2: attestations live on the 30055 link, and the baseline needs no note

Tags: `design`.

Second Phase-15 slice (docs/TRUTH_ADJUDICATION_DESIGN.md §3.2). Two
second-guessable calls:

- **An attestation is metadata ON a `supports` link, not a new record
  type.** The design's implementation-seams note points §3.2 at
  `evidence-linker.js` ("tiers, independence") and the slice plan says
  the convergence composes 30055 `supports` — so each attesting
  artifact is a captured claim, the edge to the proposition's
  underlying claim is the existing supports link, and the §3.2 fields
  (`tier`, `origin_key`, `independence_note`) ride the edge as an
  optional validated `attestation` object. Additive only: plain links
  are untouched, non-supports links reject the metadata, and the
  30055 wire format is unchanged until 15.6 decides what (if anything)
  of it publishes.
- **The earliest origin group is the independence baseline.** "Independence
  demonstrated, not assumed" needs an anchor: the first source has
  nothing prior to be independent OF, so it counts without a note, and
  every LATER origin group counts only if it carries an
  `independence_note`. Undemonstrated groups are listed in the
  measurement but excluded from `independent_count` — visible, not
  counted. Created-at ties (second granularity — every test, and any
  same-minute authoring session) break on first-appearance order,
  never alphabetically; the first cut of this sorted ties by
  `origin_key` and the end-to-end test immediately elected the wrong
  baseline (`ap-wire` over the actually-first court record).

## 2026-07-02 — Phase 15.1: adjudicable-proposition modeling choices

Tags: `design`.

First Phase-15 slice (docs/TRUTH_ADJUDICATION_DESIGN.md §3.1,
docs/PHASE_15_KICKOFF.md). Three second-guessable calls:

- **Enum home: a new `src/shared/truth-taxonomy.js`**, not
  `assessment-taxonomy.js` (the kickoff allowed either). Phase 15 will
  add verdict states, standards of proof, and match states in 15.3/15.4;
  parking the growing adjudication vocabulary inside Phase 11's label
  file would blur two layers the design keeps distinct. Hedge levels,
  tractabilities, and `isValidSuggestedBy` are **re-exported** from
  `audit/builders.js` / `assessment-taxonomy.js` (same frozen instances,
  pinned by test) so nothing forks.
- **Id derivation: `prop_<sha16>` over `(claim_id | proposition_class)`**
  — a proposition carries NO text of its own (§3.1 lists only the
  adjudicability fields; the referenced 30040 claim carries the words),
  so one claim atomizes to at most one proposition per class, and
  `create()` is idempotent there. Consequence: `claim_id` and
  `proposition_class` are immutable; reclassification is delete +
  recreate, which is honest — it's a new adjudicability assertion, not
  an edit.
- **`resolution_criteria` reuses the 30058 field vocabulary verbatim**
  (`criteria` / `horizon` / `horizon_iso` / `hedge_level` /
  `tractability`), with two deliberate defaults: `tractability` falls
  back to `'ambiguous'` (PredictionModel's honest don't-know), but
  `hedge_level` defaults to **null**, NOT PredictionModel's `'hedged'` —
  a hand-atomized fact proposition usually has no hedge to record, and
  inventing one would be exactly the estimated-quantity §1 forbids.
  Facts with no horizon get the `'already-determinable'` token (§3.1's
  "already determinable", in the house hyphenated grammar).

Also enforced beyond the kickoff's minimum list:
`occurred_precision` without `occurred_at` rejects (precision on a
missing time is as false as the reverse), and the firewall predicate
fails **closed** — `isTruthAdjudicable` on an unknown class is `false`.

## 2026-07-01 — Remove vestigial Entities + Keypair Registry settings tabs

Tags: `design`.

Two Options tabs turned out to be dead userscript-era holdovers, disconnected
from the Phase 4/9 entity rework. A user found them ("these seem to do
nothing") and a trace confirmed it:

- **Entities tab** edited the `publications` / `people` / `organizations`
  `chrome.storage.local` buckets — read/written ONLY by the tab itself. The
  live entity system is `EntityModel` (the `entities` store), driven by the
  reader tagger + the Entity Browser side panel; event-builder/metadata never
  touched the buckets.
- **Keypair Registry tab** edited `keypair_registry` — but nothing populates
  it (no `Storage.keypairs.set` caller in normal use) and nothing signs with
  it (no `keypairs.get` in any signing path). Per-entity keys live in
  `LocalKeyManager` (`local_keys`); the primary identity is
  `local_primary_identity`. So the registry was empty for everyone and inert
  even if imported into.

Removed: both Options tabs + sections, the dead `Storage.publications` /
`people` / `organizations` / `keypairs` sub-object APIs, their getDefaults
entries, and the "View / Export Keypair Registry" toolbar context-menu items +
content-script handlers (`xray:viewKeypairs` / `xray:exportKeypairs`). The four
legacy storage keys are KEPT in `storageClearExtension`'s list so "erase all
data" still purges any lingering userscript-era data. Docs (README, CLAUDE.md,
SMOKE_TEST) updated; the "Private keys" note now points at the real key stores.
937 tests green, build + lint clean.

## 2026-06-21 — Suggest defaults: extraction ON, judgment opt-in

Tags: `design`.

The Suggest pass used to always request `task: 'all'` — every artifact
kind in one go. We now default to **Entities + Claims only**, with
relationships, assessments, and forensic findings opt-in via Options
checkboxes.

The line is **extraction vs judgment**. The model is reliable and
on-mission extracting what the article *contains* (who's named, what's
asserted, each with a verbatim quote); it's unreliable and off-mission
rendering *judgments* (a stance, a maneuver). The cost of a false
positive is asymmetric: a wrong entity is a one-click reject, but a wrong
*assessment* (an auto-suggested agree/disagree stance) or *finding* is the
tool manufacturing the very verdict X-Ray exists not to render — and it
biases the reviewer by pre-filling an opinion they're supposed to own.
Relationships are held too: on a single captured article there are few
real inter-claim links, so the yield is low while the FP surface is real;
their value is cross-article (not yet wired), so they flip on later.

Mechanism: `SUGGEST_DEFAULT_KINDS` + `normalizeSuggestKinds` /
`categoryOfProposalKind` in `llm-prompts.js`; the pass both SCOPES the
prompt to the enabled kinds (fewer off-target proposals, and the heavy
maneuver guide is dropped when findings are off) and FILTERS the result
(defense in depth). Stored under `xray:llm:suggest_kinds`; an explicit
empty array is honored ("suggest nothing"), an absent key falls back to
the defaults. Forensic findings stay reachable (a power-user can opt in)
but are off by default until their definitions/guardrails mature.

## 2026-06-21 — Thorough (per-module) audit: the rigor upgrade

Tags: `design`.

Follow-up to the single-shot auditor: a **Thorough audit** mode that
runs the orchestrator doc's recommended production path — **one
independent model call per dimension**, each with the dimension's *full*
methodology, instead of all eight sharing one pass. This is the answer to
"how do we get maximum rigor" within the extension.

- **Why it's more rigorous.** Single-shot spreads one context window and
  one ~16k output budget across eight dimensions (attention dilution,
  cross-contamination, truncation, a *condensed* methodology). Per-module
  gives each dimension its own call, its own budget, the real
  step-numbered methodology, and blindness to the others' judgments.
- **Vendored prompts.** The methodology lives in
  `docs/auditor-prototype/prompts/01-08`, which the extension can't read
  at runtime, so `tools/gen-module-prompts.mjs` slices each at its
  `# ARTICLE` marker (exactly the CLI's `loadPrompt`) and emits
  `src/shared/audit/module-prompts.js` verbatim. Imported only by the SW
  bundle (confirmed: 0 occurrences in the reader/content bundles), so the
  reader stays lean.
- **One aggregation path.** The eight per-module tool outputs are
  collected into the same `{modules}` shape and handed to the SAME
  `assembleAudit` + `importAuditJson` — the firewall, hash gate, and
  deterministic aggregate are unchanged. A failed module call simply
  leaves its module absent → recorded FAILED, the rest still aggregate.
- **`standingCaveat` is now a parameter.** Single-shot passes its
  lower-rigor disclosure; thorough passes `null` (nothing to apologize
  for). The model's own per-module caveats flow in both modes.
- **Tradeoffs.** ~8× cost and 8× article tokens; calls run in parallel so
  latency stays ~one call, at the risk of a 429 on a tight key (a 429
  fails that one module, not the run). A reader `confirm()` gates the
  thorough button so the spend is never a surprise.

Files: `shared/audit/module-prompts.js` (generated) + `tools/gen-module-prompts.mjs`,
`buildSingleModuleTool` / `buildModuleSystemPrompt` + the `standingCaveat`
param in `audit-prompt.js`, `runPerModuleAudit` in `llm-client.js`, the
reader's two-button control, `tests/audit-llm.test.mjs`.

## 2026-06-20 — In-extension epistemic auditor (LLM execution path) — design

Tags: `design`.

Phase 13 shipped two audit paths: the out-of-band CLI scorer
(`docs/auditor-prototype/scorer/scorer.js`) and the in-extension
**import** firewall (`shared/audit/import.js`, slice 13.5). This adds a
third — a **"Run audit"** button that runs the audit *inside* the
extension via the 14.5 LLM plumbing — without loosening any invariant.

Decisions worth second-guessing later:

- **Single-shot, not eight calls.** One forced tool call emits all eight
  modules (the orchestrator methodology,
  `prompts/00-orchestrator-single-shot.md`). Cheaper and simpler, lower
  rigor — so every module result carries a standing caveat saying so
  (P12). The orchestrator's own JSON shape is a *simplified* `dimensions`
  block that does **not** match `validateFindings`; using it directly
  would import every module as FAILED. So the in-extension prompt drives
  the **canonical per-module findings** instead, via a tool schema
  **built from `findings-schemas.js`'s `PAYLOADS`** (now exported). One
  source of truth: the model is guided by the exact shapes the validator
  enforces.
- **The aggregate is computed in code, never the model's.** `MODULE_WEIGHTS`,
  the source-quality knowability-ceiling heuristic, and confidence
  stacking are ported verbatim from the CLI scorer into
  `shared/audit/audit-prompt.js`'s `buildAggregate`. The model supplies
  only per-dimension score/confidence/findings (PHILOSOPHY §4: the
  weights are public constants, not a model's opinion). The tool schema
  deliberately has **no** aggregate field to fill.
- **Reuse the firewall, don't fork it.** `assembleAudit` produces the
  exact `{article, module_results, predictions, aggregate}` shape, and the
  reader feeds it to the **same `importAuditJson`** the file importer
  uses — same RQ1 hash gate (we send the SAME markdown we hash, so both
  halves agree), same per-module schema validation, same failure posture.
  `module`/`version` are injected at assembly (never model-supplied) and
  wrapper score/version are set equal to findings' so import's tamper
  check passes. An absent or malformed module imports as a FAILED result,
  not a rejection.
- **No constitution change.** §8 already makes a model a first-class
  auditor (identity `anthropic/<model>`); methodology version stays `1.0`
  because the findings schemas are unchanged. Running/importing are
  local-only and ungated; **publishing stays behind `epistemicAuditing`**
  (slice 13.8). Gating reuses the `llmAssist` flag + key, so flag-off or
  no-key means no network call is reachable.

Files: `shared/audit/audit-prompt.js` (new), `runAuditPass` /
`extractToolInput` in `shared/llm-client.js`, `xray:audit:run` in the SW,
the reader's `setupAuditRunControl` / `runAuditFromReader`,
`tests/audit-llm.test.mjs`.

## 2026-06-20 — Phase 14.5: LLM-assist suggestions through the existing models

**Tags:** design

Phase 14.5 ([`docs/PHASE_14_5_LLM_ASSIST_KICKOFF.md`](PHASE_14_5_LLM_ASSIST_KICKOFF.md))
adds a user-invoked Anthropic call that *proposes* capture artifacts.
Decisions worth recording:

- **The fetch lives in the service worker** (`shared/llm-client.js`),
  not the reader page — same reason the relay pool does: page CSP would
  block the call. Browser-origin requests need the
  `anthropic-dangerous-direct-browser-access: true` header (CORS is
  enabled for it); the SW already has the `api.anthropic.com` host
  permission, so the response is readable.
- **Two consent gates, key never leaves the SW.** The feature is off
  behind `llmAssist`, and even on it does nothing without a user-supplied
  key. The key lives under its own `chrome.storage.local` key
  (`xray:llm:key`), is added to the "erase all" sweep, is never echoed
  back into the Options page (we report only *whether* one is set), never
  logged, and never in any export. The reader learns flag+key state via a
  thin `xray:llm:config` snapshot (booleans + model id), so the key stays
  in the SW.
- **The kickoff assumed every model carried `suggested_by`; claims and
  entities did not.** Rather than touch the kind-30040 / kind-0 wire
  format (compat consequences), I added a **local-only** `suggested_by`
  field to `ClaimModel.create` / `EntityModel.create` (default `'user'`,
  validated). Assessments / links / findings already had the full seam,
  wire included.
- **Validation is two-tier.** `llm-proposals.validateProposal` mirrors
  the model validators using the *same* exported predicates so the review
  panel can show "rejected-with-reason" without writing; the model's
  `create()` is still the ultimate firewall at accept. A finding with no
  counter-note or no quoted anchor fails both — by construction there is
  no intent/score field anywhere to supply.
- **Edit is an inline editor, not a modal pre-fill.** The kickoff
  suggested "open the matching capture modal pre-filled," but the finding
  modal has no non-edit seed path and the assess/link modals collect their
  own candidates — pre-filling unsaved proposals would have meant either
  modal surgery or reimplementing the pickers (a parallel capture UI the
  conventions warn against). A compact, data-driven inline editor over the
  proposal's editable fields keeps one save path (the real models) and
  flips provenance to `'user'` on a substantive edit. Structural fields
  with rich pickers (label sets, maneuver groups) stay as proposed; the
  user rejects + captures manually via the existing bars to change those.

## 2026-06-14 — Phase 14: a behavior layer that deliberately renders no verdict

**Tags:** design

Phase 14 (forensic findings, [`docs/CRIMINOLOGY_DESIGN.md`](CRIMINOLOGY_DESIGN.md))
adds a layer that names *maneuvers* a subject performs around the truth —
evasions, immunizing defenses, self-serving revisions — as a companion to the
Phase 11 assessment layer that grades *claims*. The framing is adapted, with
attribution, from Dawn McCarty's "forensic criminology" segment on
*Mormonism Live* ([`0axZ8EGLaxQ`](https://www.youtube.com/watch?v=0axZ8EGLaxQ)).

**Renumbered 13 → 14 (and re-kinded `30056` → `30062`).** This work was first
drafted as "Phase 13," but a separate, more-mature **Phase 13 = epistemic
audit** already existed on its own branch chain (`claude/phase-13-*`,
kinds `30056–30061`, `epistemicAuditing` flag) — built in parallel and not
yet merged to `main`. To avoid colliding on both the phase number and the
`30056` kind, this layer becomes **Phase 14** and takes **`30062`**. The two
are deliberately distinct features; the criminology layer is meant to build
*on top of* the epistemic audit, so its development is paused until the
Phase 13 chain merges, then this branch rebases onto it. The forensic
`revision/*` edges still ride Phase 11's kind `30055` (the assessment link
substrate), which is unrelated to the audit's kinds.

Two design choices are the ones a future reader might second-guess, recorded
here:

- **No verdict, no score — by construction, not by convention.** The model
  has *no* `lying` / `intent` / `confidence` field. A finding describes
  structure ("the move narrows the alternative until the religious authority
  re-enters as safer ground"), never the subject's honesty, and a
  `counter_note` (the exonerating read) is *required* to save. This mirrors
  the source method's own rule ("we don't want to say tell me if they're
  lying") and the maintainer's "bounded in what's real, no subjectivity"
  constraint. A bounded `basis` enum (`quoted` / `paraphrased` /
  `behavioral-cue` / `structural-inference`) replaces a numeric score — it
  states *how we know*, which is checkable; a 0–100 would not be. If a later
  contributor is tempted to add a severity number or drop the counter-note,
  this is the entry that says don't.
- **Separate kind `30062`, not an extension of the `30054` assessment.** The
  unit differs in three ways that broke reuse: the subject is a
  person-in-a-role over time (not a claim), there is no stance, and maneuvers
  are often ordered *sequences* (grooming; patch-then-contain) needing an
  evidence chain. Diachronic story-changes do reuse the `30055` link
  substrate (additive `revision/*` values), and the taxonomy *reuses* the
  existing `fallacy/*` and `consistency/*` labels where Dawn's vocabulary
  already coincides — the new families are only the behavioral/institutional
  ones (neutralization, DARVO, thought-reform, immunizing defense, grooming)
  that had no home in the truth-label taxonomy.

Design only at this point — no code yet; the taxonomy is meant to be reviewed
before 14.1 lands.

## 2026-06-12 — 13.9 follow-up: the phase-wide review ran — what eight slice reviews couldn't see

**Tags:** bug, design, pattern

The resumed phase-wide adversarial review (7 cross-slice lenses, 68
agents) confirmed **46 findings, refuted 15** — including a class no
per-slice review could structurally catch: bugs that live BETWEEN
slices, where each side honors its own contract and the seam still
breaks. The fixes, by root:

- **THE blocking find — the publish-path hash forked from the capture
  hash.** `assembleArticleBody` re-ran `htmlToMarkdown` whenever its
  input contained `<` — and markdown legitimately contains `<` (small
  inline images, code fences), so the reader's publish path
  double-converted: body mangled on the wire, published `x` ≠ the
  hash every audit anchors to, false stealth-edit banners on the next
  unedited recapture, the import gate demanding a hash that exists
  only on the wire. The conversion now runs once, ever — the publish
  path marks its draft `_contentIsMarkdown` instead of sniffing, with
  a load↔publish byte-parity test. Every per-slice review missed it
  because each slice's tests call `assembleArticleBody` once per
  input; only the cross-slice walk (capture → hash → publish →
  re-import) exposes the two-pass handoff. The heuristic predates
  Phase 13; 13.4 silently promoted it into the content address.
- **The parsers were the third unguarded entrance.** Builders and the
  import gate bound every number; the RELAY parser didn't — a hostile
  30057 carrying score 99999 rendered as authoritative and could
  poison the dossier. All audit-kind parsers now range-check
  (out-of-range = never asserted = null → the review chip), hostile
  contribution rows are dropped at parse, and import requires
  contribution module names from the known vocabulary (which also
  closes a `__proto__` prototype-chain lookup in the publish batch).
- **Resolve… was unreachable for the designed import flow.** The
  vendored scorer hard-codes `resolution_horizon_iso: null`, and only
  horizon-dated predictions got the strip affordance — the acceptance
  walk's resolution arm dead-ended on a count with no rows.
  `predictionsDue` now returns the unscheduled open LIST and the
  strip renders them with Resolve….
- **Import-gate parity with the builders** — the lens that found the
  same seam four ways: lenient `Date.parse` run_at (strict ISO now,
  aggregate rejects / module fails), human auditor ids that weren't
  64-hex pubkeys (treated as absent, fallback applies), `horizon_iso`
  datetimes the 30058 builder refuses (degraded to null at the door),
  bech32 `nostr_event` evidence the Resolve form accepted but the
  builder rejects (validated at save). Posture: nothing imports that
  cannot publish.
- **Publish-identity hardening:** marks now record the publishing
  pubkey; resume coordinates and the 30057's module references are
  minted at the PUBLISHED address after an identity switch, not the
  current key's. The stale-identity resolution skip became a re-key:
  the machine re-files under the prediction's real address (live key
  or this batch's signing key) instead of dead-ending the user with a
  remedy the strip had already withdrawn.
- **Lifecycle closure for RQ6:** late atomization re-emits the
  published 30058 with its claim link (`claim_ref_at` vs
  `publishedAt`, same-key only — replacement is an address property);
  the claim-side back-reference map went multi-vintage (same
  candidate set as the audit batch); deleting a claim now severs the
  promotion links pointing at it; revised resolutions re-emit
  (`updated > publishedAt` — the 13.1 contract the batch had ignored);
  corrected re-imports actually replace the stored run and clear the
  changed events' marks (stale marks over changed findings would have
  frozen stale wire content forever), and both import UIs now say
  already-imported / ledger-updated instead of reporting the fresh
  parse over a stale ledger.
- **Dossier purity:** URL-joined (advisory) audits no longer feed the
  reputation rollup (counted as `excludedUrlJoined`); per-module means
  exclude sub-0.6-confidence contributions — the aggregate-level rule,
  applied per module. The aggregate also DEFERS when a scored module's
  build refuses — a signed 30057 must not silently drop contribution
  rows its final_score counted.
- **Portal vintage-awareness:** 13.8 anchors published audit events to
  the vintage they audited, and the replaceable 30023's `x` moves on
  re-capture — the portal now falls back to PRIOR capture vintages
  (still text-verified hash joins, marked "prior version"), and the
  inspector joins module results by the 30057's own coordinate refs
  instead of a runAt equality that never matched real scorer output
  (per-module `run_at` ≠ aggregate `runAt`) and could be displaced by
  a foreign same-runAt event.
- Also: read-only portal opens keep the carried published hash (the
  panel read "No capture hash" for exactly the audited article the
  portal round-trips); the reader import bar accepts prior-vintage
  matches like the options importer; the audit panel acknowledges
  body edits ("for the CAPTURED text — the body has been edited");
  the audit ledger got the export the design promised (Options ▸
  Epistemic audits ▸ Export audit ledger); and seven doc/code drifts
  were corrected (NIP reference-implementations, 30060 deferral
  language, pub×beat `p` requirement, RQ5 semver note, dossier join
  scope, SMOKE 13.10/13.13, CLAUDE.md's test count).

The refuted 15 were dominated by one shape: accurate code citations
whose triggering data no reachable path can produce (defensive
fallbacks behind validating writers). The verifier instruction that a
finding "contradicting a documented posture is refuted unless the
posture itself is shown broken" earned its keep — and so did the
finder instruction to ignore single-file findings: nearly everything
confirmed was a seam.

---

## 2026-06-12 — 13.9: hardening, and an honest note about the review that didn't run

**Tags:** design, pattern

Final Phase 13 slice (draft PR). What it contains and one thing it
doesn't:

- **SMOKE_TEST §Phase 13** — the 24-step manual acceptance walk:
  capture/hash → scorer CLI → import gates (refusal cases included:
  hash mismatch, no local capture, score-divergence tamper) → display
  rules as explicit check steps (no naked numbers, sub-0.6 review
  chip, side-by-side never averaged, scores never transfer across
  edits) → atomize → flag-gated publish (off-by-default verified
  first, then resume/no-duplicates, the relay-outage retry, and the
  stance/`rating-value`/`L`/`l` firewall on raw events) → portal
  chips/inspector/dossier/Resolve → reconciliation. Surface names
  verified against the actual DOM (the importer and toggle live under
  Options ▸ Advanced ▸ Epistemic audits).
- **Docs-consistency pass** by direct reading: NIP draft §30058/30059
  already agree with what 13.8 publishes (the `claim`-marked
  back-reference, `x` = the *predicting* article's hash, foreign
  extractor pubkeys anticipated in the 30059 reference); the design
  note carries the publish-ordering and resolution-identity rules
  threaded in during 13.8; one SMOKE_TEST step was corrected before it
  ever misled anyone (batch events can share `created_at` seconds, so
  ordering is verified by reference resolution, not timestamps).
- **Cross-slice seam checks, run manually:** reconcile's address
  recomputation and the publish batch derive from the same inputs
  (`run.articleHash`, findings-version-first) so they cannot disagree;
  pre-13.8 records flow through 13.8 paths via fallbacks that degrade
  to counted skips, never blocked batches; claims published before
  11.1 (no `publishedPubkey`) self-heal — the 11.7 `needCoordIds`
  republish stamps the pubkey, and the deferred 30058 follows one
  batch later; the publish flag is re-read inside every publish call,
  so mid-session toggles can't race the gate.
- **The thing that didn't happen:** the planned phase-wide
  multi-agent review lost all seven finder agents to API session
  limits (the 13.5 failure mode, phase-sized this time). Rather than
  fabricate coverage, the workflow script is saved with its run id
  for a later resume, and the honest record stands: eight per-slice
  adversarial rounds (design + 13.1–13.8) confirmed ~109 findings,
  all fixed before their PRs — the phase has been reviewed
  slice-by-slice, not yet wall-to-wall. If the resumed phase review
  ever runs, its findings belong in a follow-up PR, not silently
  folded into history.

---

## 2026-06-11 — 13.8: the publish batch, and what "ordered" has to mean on the wire

**Tags:** design, bug

Slice 13.8 (flag-gated audit publish, draft PR). The calls worth a
paper trail:

- **"Ordered" is a wire property, not a list property.** The first
  cut emitted 30056s → 30057 → 30058s → 30059s in order and called it
  done; the adversarial review (30 confirmed, 10 refuted) pulled the
  thread: under PARTIAL failure the order still inverts — an
  aggregate can land while its module result bounced, a promoted
  30058 while its 30040 was rejected by every relay. Now an aggregate
  defers when any of its run's module events failed this batch, a
  resolution defers when its prediction failed or deferred, and a
  promoted prediction defers until its claim has a **published
  address** — `claimPubkeys` is read from the claim records *after*
  the claims block runs, so "failed this batch" and "never published"
  collapse into one check, and the back-reference is minted at the
  claim's actual address (its `publishedPubkey`), never the current
  signing key's. The marks make every deferral a next-batch retry,
  not a loss.
- **`findings.version` is the d-preimage source of truth.** The
  builder derives the 30056 wire `d` from `findings.version`; the
  batch and the reconcile ledger were deriving coordinates from the
  WRAPPER's `module_version` — a divergent pair would have minted
  30057 contribution coords pointing at addresses that never exist,
  with both events happily on relays. Import now enforces agreement
  (failed-module posture on divergence, findings win when the wrapper
  is absent), and every derivation site reads findings-first. Same
  trust boundary as the score/confidence gate, missed for the one
  field that feeds an address.
- **Per-record hash anchoring.** Records publish against the vintage
  they audited (`run.articleHash`/`p.articleHash`), and the reader
  gathers ledger records across every hash the article has carried
  (current + archive + priorVersions) — otherwise the publish-time
  restamp stranded a resumed batch, and an edited-body publish
  silently dropped the whole thing.
- **The resolution identity rule.** A 30059 whose coordinate matches
  a local prediction under a different pubkey is refused (that
  address will never exist — re-file under the signing identity); a
  coordinate with no local counterpart is someone else's published
  prediction and publishes verbatim, anchored to the prediction's own
  article via the new `article_hash` field the Resolve… form now
  stamps (and backfills on revision). The first cut refused ALL
  foreign coordinates — which made the portal's "publishes with the
  13.8 batch" promise false for the resolver-≠-predictor workflow the
  design explicitly supports.
- **One malformed record never blocks the batch.** assembleAuditBatch
  isolates every build; a refused record is a counted skip with the
  builder's reason, and the summary line carries `ok/count (skipped)`
  — the import module's per-module posture, applied at publish. The
  end-of-loop audit toast was deleted as dead: the summary toast
  replaced it in the same tick (single-slot toast), which would have
  hidden every skip explanation.
- **Known gaps, decided not patched:** `xray:flags:reload` is
  documented in two places but has no sender or listener — benign
  today (the reader `loadFlags()`s before the gate) — left for a
  flags-bus slice; the reader's defer-discipline loop is DOM-bound
  and untested (the property contract it consumes is pinned in the
  batch tests; SMOKE_TEST coverage lands in 13.9); 30060 snapshot
  publish stays deferred (portal read-only).

---

## 2026-06-11 — 13.7: the portal joins, and what a dossier refuses to be

**Tags:** design

Slice 13.7 (portal audit surfaces, draft PR). The calls worth a
paper trail:

- **Hash-first joins, URL fallback only for hashless events.** An
  audit chip on an article card means "this exact text was scored."
  Pre-13.4 articles carry no `x` tag, so they fall back to the URL
  join — and post-13.4 articles NEVER do, even when audits share
  their URL: scores don't transfer across edits, full stop. Pinned by
  test.
- **The dossier rolls up the latest judgment per (article, auditor)**
  — older runs by the same auditor are superseded judgments, not
  extra data points; cross-auditor disagreement stays visible in the
  inspector instead (side-by-side, never averaged). And no audited
  articles → NO dossier, not an empty one at the population prior —
  a dossier that is pure prior is noise dressed as reputation.
- **`DEFAULT_POPULATION_MEAN = 77` is a published assumption**,
  displayed in the dossier line every time it shrinks a mean
  ("shrunk to 77.27 toward population 77, k=10, factor 0.91") — §4's
  publish-the-shrinkage rule, applied literally.
- **The Resolve… form derives unpublished-prediction coordinates
  from the primary identity** — the v1 flow signs predictions and
  resolutions with one key, so the coordinate the local resolution
  keys on is the one the 13.8 publish will mint. No identity → the
  affordance disables rather than guessing.
- **The kind-list and TYPE_DEFS pins fired** when the corpus gained
  the audit family — updated deliberately, which is exactly what
  those pins are for.
- **The adversarial review confirmed 20 findings (0 refuted), the
  most of any slice — two blocking roots.** (1) The hash join was
  DEAD in production: `buildItem` spreads extras flat, my joins read
  the nested `item.extra.articleHash` my own test fixtures had
  invented — every article silently fell to the URL join, local runs
  never surfaced, and dossier predictions were always empty. Fixed
  with a both-shapes accessor and, more importantly, a
  production-pipeline test that builds events with the real builders
  and runs them through `buildItems` — the seam can't silently split
  again. (2) Locally-filed resolutions were invisible everywhere:
  `updateDerived` had zero production callers, `listResolutions` was
  never imported, and the strip re-offered Resolve… forever. Now the
  resolve flow derives the prediction's status, merges the record
  into the index, and the strip matches resolutions by sha16 identity
  (so the coordinate's pubkey can't hide a local filing). Also from
  the review: URL joins now carry an explicit "URL match — text
  unverified" marker everywhere they render; sub-0.6 aggregates are
  EXCLUDED from dossier rollups and counted as pending review (a new
  design-note rule: a number the display refuses must not move a
  reputation); the dossier line now distinguishes audited articles
  from auditor judgments (shrinkage n = judgments, documented); the
  inspector gained module rows + dispute lineage (`modulesByHash` had
  zero consumers); case views gained the dossier block the design
  assigned them; re-filing a resolution upserts instead of silently
  returning the first record; and the resolver identity skips the
  reserved sync key (with NIP-07, `identities[0]` IS the sync key —
  a coordinate minted under it would never match the 13.8 publish).

---

## 2026-06-11 — 13.6: the audit panel, and where the promotion link lives

**Tags:** design

Slice 13.6 (reader audit panel, draft PR). The second-guessable calls:

- **The RQ6 promotion link lives on the PREDICTION record, not the
  claim record.** `ClaimModel` whitelists its fields (id-deriving
  fields immutable, the rest enumerated) — extending it for one
  enrichment field would touch shipped Phase-10 storage for no
  gain. Instead `PredictionModel.setClaimRef` stores
  `{claim_id, pred_d}` (enrichment, no `updated` bump), and the
  publish loop builds a claim→prediction map from the predictions
  side. `pred_d` is stored pre-derived (the wire `d` is the local id
  with the prefix swapped) so `buildClaimEvent` stays synchronous.
- **Quote-locate is selection-only.** The article body is
  contenteditable and syncs `htmlDraft` — wrapping matches in mark
  elements (the entity-tagger idiom) would pollute the draft with
  audit chrome. A Range + Selection highlight scrolls and flashes
  without mutating anything.
- **A sub-0.6 aggregate renders NO band color.** The review chip IS
  the badge — score, band, and color all suppressed, because a
  colored "needs review" still smuggles a verdict.
- **Audits anchored to retained prior versions surface as a re-audit
  notice, never as scores** — scores don't transfer across edits;
  the notice says exactly that and points at the CLI re-run.
- **The adversarial review confirmed 8 findings (0 refuted), one
  BLOCKING**: the publish flow restamps `state.articleHash` to the
  newly built event's hash (13.4) BEFORE the claims loop builds the
  RQ6 back-ref map (13.6) — on an edited-body publish the prediction
  lookup ran under the wrong hash and every back-reference silently
  dropped. Fixed by snapshotting the capture hash before the restamp.
  Also caught: a score with UNKNOWN confidence rendered as a naked —
  and therefore more authoritative — number than one at 0.59
  (unknown now renders the review chip, and import takes
  score/confidence FROM the validated findings, failing modules whose
  top-level copies diverge); `ceiling_binding` was trusted from the
  file though both operands are validated (now derived — a tampered
  file can neither hide a binding ceiling nor paint a spurious one);
  quote-locate had a measured 213ms O(n²) stall plus an off-by-N that
  started selections inside collapsed whitespace (rewritten as one
  O(n) scan with per-character index mapping, cross-node ranges);
  atomizing onto an already-published claim never re-emitted (the
  publish filter skips published-unedited claims — promotion now
  bumps `updated`, because gaining the back-ref tag IS an edit); and
  the pred_d string surgery now has a parity test against the wire
  derivation so the lineage coordinate cannot silently drift.

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
