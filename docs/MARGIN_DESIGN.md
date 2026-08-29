# The Margin — anchored insights in the reader (design)

> **Status:** **ratified** by the maintainer 2026-08-28 (Art. 11) —
> synthesized from three independent design attempts judged under
> three adversarial lenses (each design won one lens; the grafts
> converged on this hybrid), revised through the same-day ux-designer
> review ([`MARGIN_UX_REVIEW.md`](MARGIN_UX_REVIEW.md)), and closed
> with the maintainer's §12 rulings. Implementation proceeds per the
> §9 slice ladder, one default-off flag per slice; S1 lands with the
> §5.4 guard tests in the same wave.
>
> **Reconciliation caveat (maintainer, 2026-08-28):** several
> constraints inherited here derive from governance codifications the
> maintainer intends to re-examine against his original founding intent
> ("there needs to be a reconciliation between my original intentions
> and what has been codified"). §10 tags every inherited constraint
> with its source and marks the reconciliation-sensitive ones **[R]**.
> This design treats governance as currently written as binding, and is
> structured so an amendment flows through §10 to the affected sections
> instead of requiring a redesign.
>
> **Wire format: none.** This design publishes nothing new and changes
> no tag layout. All reads use existing kinds and existing filters
> (`#r`, `#x`, `#a`, `#p`, authors). Kind 30066 stays free.
>
> **Review log:** ux-designer discipline review completed 2026-08-28
> ([`MARGIN_UX_REVIEW.md`](MARGIN_UX_REVIEW.md)) — all fifteen
> findings (A1–E3) folded into this revision; its disposition table
> records each resolution.

## §1. Problem and intent

X-Ray already extracts claims, records assessments and verdicts, runs
audits, and grounds every one of them in verbatim quotes — then renders
them as seven stacked bars *below* the article and a set of modals. The
insight and the sentence it is about are never in the same place. The
Rap-Genius observation is that a span of text is the natural join key
of human attention: annotations beside the exact passage they address
are read effortlessly; the same content in a list below is homework.

The Margin makes the captured article itself the display surface for
everything X-Ray knows about it — at N=1 first (your own casework,
readable in place), then across the scope rings as the same records
arrive from other people.

Design philosophy (maintainer, 2026-08-28): **high value at N=1 users,
exponential value thereafter**; dead-simple, Apple-quality; the reader
select→tag popover is the quality bar, the portal is the recorded
anti-pattern (`PORTAL_UX_REVIEW.md`); NOSTR stays invisible.

## §2. Terminology (settled 2026-08-28)

- **Library** — a user's total holdings: everything captured plus
  everything accepted in. Never automatically what they follow;
  follows are *sources*. The accept step is **the membrane** — nothing
  foreign enters local stores without an explicit accept. ("My
  Archive" gradually renames to the Library browser; out of scope
  here.)
- **Scope rings** — `Mine · Circle · Network · Everyone`, a visibility
  dial on insight views. Ring chrome is **progressive** (UX review
  A2): no ring control renders while nothing beyond Mine *could*
  exist; once a wider ring becomes possible (a follow exists, or
  `marginRings` is on) the **full four-segment control** appears —
  never a subset. Once shown, its state is always visible (§6).
- **Case** — unchanged: a question-shaped working subset.
- The margin's user-facing umbrella word for an anchored insight is
  **"note"** in legend prose only ("Tinted text has notes"); counts and
  cards always use the typed family words (claim, assessment, …) and
  never a cross-family total (§5, §10 row 1).

## §3. View architecture

A new read-only **Annotated view** joins Reader/Markdown/Preview:

- It renders into its **own non-contenteditable sibling container** of
  the draft body. The contenteditable `.xr-article__body`, its
  turndown round-trip, and the publish path are never touched by
  annotation DOM — the draft-leak hazard (`src/reader/index.js`
  ~3029-3036) becomes structurally impossible, and a guard test
  asserts it (§5.4).
- The renderer is a **pure, deterministic function of (article text,
  records)**, re-invoked whole on every render. There is no
  rehydration to be best-effort about: mode switches and wholesale
  `innerHTML` replacement simply re-run it.
- **Overlap** is solved by segment partition: collect all grounded
  `[start,end)` intervals, split at every boundary, emit disjoint
  segments each carrying its covering set of record ids. This is plain
  DOM in the annotated container — **no CSS Custom Highlight API
  dependency, full Firefox 128 parity, no floor bump**.
  `CSS.highlights` is a feature-detected Chrome fast path only.
- Render fidelity is a budgeted cost: the annotated container must
  reproduce the draft renderer's PDF figure handling, speaker-label
  decoration, platform headers, and image handling, or degrade
  visibly. This is named work in the S1 plan, not an afterthought.
- **Default view:** Annotated when opening an *archived* article
  (library/portal/reader revisit paths); the draft Reader stays the
  landing view for a fresh capture. (Ruled by the maintainer
  2026-08-28 — §12.1.) The view **announces its
  read-onlyness** (UX review C3): the strip carries a permanent quiet
  mode label — "Reading view — edit in Reader," where "Reader" is the
  actual tab-switch affordance — and a keypress inside the annotated
  container flashes that label.

## §4. Visual language and interaction

- **One base tint** on annotated spans — no per-family colors, no
  glyphs on the text. A slightly darker step where ≥3 records of the
  *same family* overlap; never a cross-family density number.
- **Three rail shapes** in a slim gutter: filled dot (claims and the
  judgments that anchor through them), open triangle (forensic),
  hollow square (audit evidence). **Audit evidence never tints the
  body** — its own rail channel is the firewall carrier (§10 row 7).
  Rail markers are **first-class click targets** (UX review B1),
  equivalent to segment clicks for their channel; hovering a marker
  raises its span extent (the inverse of the segment hover rule).
- **Cards use words, not glyphs** ("Claim", "Assessment", "Proposal —
  unreviewed"), grouped under family headers; the audit group renders
  in a hard-fenced block with its own chrome, never interleaved.
- **The strip** above the body: per-family count chips (side by side,
  never summed; **only populated families render a chip** — an empty
  family shows nothing, not a zero), the anchored/page-level split
  ("14 anchored · 3 page notes" — a labeled *coverage* measurement,
  not an insight total; see §5.4), the ring control (§2 progressive
  rule), the quiet mode label (§3), and a "?" opening the legend
  (four short lines: tint, darker-step, the three shapes, the
  authoring gesture — discharging the `ROAD_TO_1_0.md` T7
  in-app-legend item). **Family chips are toggles** (UX review D1):
  all on by default, each toggle filtering its family's tint and rail
  channel, state always visible in the chip itself — the
  hide-with-disclosure pattern, never a silent default. **Zero
  state** (UX review C2): with no records at all, the strip shows one
  designed line — "No notes yet — select any passage to add one" —
  with the "?" adjacent.
- **Gestures** — arbitration is defined by **selection state**, not
  gesture names (UX review C1): *mouseup with a collapsed selection*
  over a tinted segment or rail marker → the card stack; *mouseup
  with a non-collapsed selection* (drag, double-click, triple-click)
  → the existing select→tag popover, unchanged in the Annotated view,
  with anchor capture there being **quote+prefix/suffix-first** (the
  annotated DOM is the wrong substrate for positional selectors).
  Popover-on-copy is accepted as the cost of one consistent selection
  behavior everywhere (Escape/click-away already dismiss it). The
  SMOKE_TEST row for this rule includes double- and triple-click
  cases.
- **The ladder:** each card ends with at most one next action for the
  reader's rung — see → comment/assess → adjudicate — each
  typographically quieter, all routing to the existing modals. **No
  new publish paths** (§10 row 11). Document order always; nothing is
  ranked or emphasized by engagement (§10 row 5). Two ladder
  exemptions (UX review B2/B3): **own-record management**
  (edit/delete, routing to the existing claim modal) is exempt from
  the one-action count and renders on own cards — after S2 folds the
  claims bar this is the only home "fix a typo in my claim" has; and
  **extraction-proposal cards carry inline accept/dismiss** wired to
  the same shared triage handlers the case dashboard uses — a card
  that names a pending decision must let the owner decide it
  (announcement-without-affordance is the portal's recorded A1
  failure).

## §5. Annotation model

### 5.1 The projection

One derived, in-memory record — never persisted, never on the wire
(the dossier/counterfactual precedent):

`MarginNote = { id, family, type, source (kind + coordinate|localId),
author {pubkey, isMine, ring}, anchor {quote, prefix/suffix,
articleHash}, grounding {status, start, end} (computed per render),
reviewState?, payloadRef }`

Projectors are pure per-type functions in a new
`src/shared/annotations/` module over the EXISTING stores: claims
(quote + W3C anchor + hash), assessments/verdicts/integrity through
their claim coordinate (plus direct `label-anchor` spans where
present), forensic `maneuver-step` anchors, extraction atoms (offsets
verified against the quote), audit `evidence_quotes`, 30058 quote
tags. 30041 comments project straight to page notes (§8).

### 5.2 Grounding doctrine

The **quote is the identity**; offsets and selectors are verified
hints. Own records ground with the full `quote-grounding.js` tiers;
anything foreign uses `locate()` **exact/normalized only — fuzzy
refused** (the MA.7 import rule). **Ambiguous repeated-phrase matches
demote to page notes with a stated reason — never first-occurrence
guessed** (this deliberately supersedes the reader's current
first-match quote-locate fallback for margin display).

### 5.3 Family fences

Family separation is enforced in the model, not CSS: per-family card
templates; the renderer's API has no operation composing two families
into one card or one number; reserved truth vocabulary appears only
inside truth-family templates; the audit group is a fenced block in
every layout.

### 5.4 Guard tests — land in S1, not later

1. **draft-leak** — no annotation node ever appears in the draft
   container or the turndown input;
2. **no-fused-number** — the renderer can emit no cross-family
   *judgment* figure: no insight-total headline, no score, no average.
   The only permitted cross-family figures are §4's labeled coverage
   measurements (anchored / page-note counts);
3. **reserved-vocabulary** — truth-family words never render outside
   truth cards;
4. **audit-fence** — audit cards never interleave with
   claims/assessment cards.

## §6. Scope rings

Segmented control — `Mine | Circle | Network | Everyone`, cumulative,
appearing under §2's progressive rule and, once shown, always
visible. Ring state is chrome, not preference — the selected ring and
what wider rings hold are always displayed; stepping down
hides-with-disclosure, never discards. The wider-ring teaser
("Network: 4 more from 2 people you follow") is computable only
*after* a pull; **pre-pull, the Network segment renders as an action
("Check network"), not a filter** (UX review C4) — pressing it IS the
pull gesture. The "?" legend defines the rings by what the user does:
"Circle — already on this device, from people you follow. Network —
press to check for new."

- **Mine** — automatic, instant, local-only. This ring alone is the
  full N=1 product.
- **Circle** — automatic, still local-only: the read-only
  `incorporated_artifacts` store plus already-cached followed-author
  events. No sockets.
- **Network** — explicit pull only: one `xray:relay:query` batch
  through the SW pool — `#r` (canonical URL) for the URL-joined kinds,
  `#x` (articleHash) for the hash-anchored family, authors = the
  follow set, first-`r` identity check applied wherever 30023s are
  involved (`src/background/index.js` ~1283-1300 lesson).
- **Everyone** — same pull, author-unfiltered, behind its own press;
  unfollowed signers render collapsed to per-author count rows with
  deliberate expand (the evil-relay defense, verbatim).

**Absence is three-way and honest:** "You haven't added notes" ≠
"Network not checked yet" ≠ "Checked the network — nothing new (1 of
3 relays didn't answer)" — wired to the pool's failed/EOSE
distinction. User-facing copy says **"relay"** — maintainer ruling
2026-08-28, overruling the ux review's "server" swap (C5): the honest
protocol term, which users meet in Options anyway. The constitutional
constraint binds the three-way *semantics*, not the noun (§10 row 6). Coverage
language says **"reachable records," never "all records"**: `r` tags
are builder-optional on judgment kinds and 30068 briefs carry no URL
tag at all (the two-hop brief join via member hashes is deferred,
§12.4).

**Privacy posture unchanged:** no ring ever queries on navigation or
reader-open; pulls are user gestures. Browse-time querying would be a
new threat-model posture and is out of scope (the doorbell design will
face it).

## §7. Foreign lane (designed now, ships S3+)

- **Hash gate first:** a foreign event whose `x` tag ≠ the local
  `articleHash` goes straight to page notes with a plain-words banner
  ("their copy of this article differs from yours") — no grounding
  attempt, no chip-flagged highlight on the wrong text version.
- Grounded foreign cards render **attributed** (adopted-entity label
  else truncated npub, upgraded only through the adopt flow),
  **side-by-side, never merged or counted with yours**; identical
  quotes group visibly as "same passage — N records, side by side."
- **The membrane is the only write:** viewing writes nothing; the
  card's accept action IS `incorporation.js` (claims/links →
  suggested_by-stamped records; assessments/verdicts → the read-only
  incorporated store); declines persist.
- **Foreign 30070** arrives last (S4): the margin's re-grounding is
  precisely the mechanism whose absence excludes 30070 from the
  network feed today. Rows lead with the author's review-state chip
  (fail-safe unreviewed), model prose renders visually quarantined,
  endorsements render only as pointers to the separately-signed 30040.
- **Art. 7 tail:** forensic findings and 1985 mirrors render as
  structural observation with a counter-read affordance; 30064 has no
  mirror and none is synthesized; nothing ever attaches to a byline or
  identity.

## §8. Page notes (the degradation lane)

A permanent, honest lane — a strip chip plus a fixed panel section —
holding everything that cannot or may not anchor, each row stating WHY
in plain words: "about the whole page" (30041, by design); "no anchor
was recorded" (pre-10.3 claims whose search is ambiguous); "from a
source you haven't captured" (verdict/integrity evidence quotes);
"couldn't find this text in your copy" (foreign locate failure — the
NIP's never-discard, never-reposition rule); "text changed since this
was anchored" (own records orphaned by an edit); "their copy differs"
(hash mismatch). Nothing is dropped; page-note cards keep full
payloads and actions. Derived-only artifacts (lens readings,
hypothesis maps, counterfactuals) stay OUT of the margin — it never
fakes an anchor.

## §9. Phasing — additive first, one default-off flag per slice

- **S1 "See"** (`marginView`): the annotated view, Mine ring, page
  notes, legend strip, the §5.4 guard tests. **Bars untouched —
  purely additive**, reviewable in one sitting, walkable against real
  COVID casework immediately. S1 scope includes the accessibility
  baseline (UX review E2): annotated segments and rail markers
  focusable in document order, Enter opens the card stack, the stack
  is a dialog with Escape — document order is already mandated by §10
  row 5, so the a11y ordering decision is free.
- **S2 "Fold"** (`marginFold`): claims bar and extraction bar fold
  into the margin; a "list view" escape hatch **with a dated kill
  recorded in this doc's changelog when S2 opens** (pre-empting the
  two-permanent-surfaces failure). Header folds 12 buttons → Publish +
  mode tabs + one Tools menu — and the mode-tab strip itself is
  layered in the same pass (UX review E3: the first-session
  distinction is Annotated-vs-Reader; Markdown and Preview are expert
  density). ux-designer review gates this slice.
- **S3 "Circle & Network"** (`marginRings`): ring pulls, foreign
  re-grounding, membrane accept-from-card; retires the others'-claims
  modal after a maintainer soak walk. **Sequenced after the T7
  publish pre-flight lands, and blocked on a THREAT_MODEL delta
  (B18)**; security-threat-modeler review required.
- **S4 "Everyone + foreign extractions"** (`marginEveryone`):
  collapsed-stranger lane, foreign 30070 display.

The live-page **doorbell** (badge → open reader) is explicitly out of
SP2 scope — a later, separate design. Review gates: product-manager
(this doc), architect (S1 — new surface + shared module), ux-designer
(S2 walk), security-threat-modeler (S3), ecosystem-pm ("Wire format:
none" callout on every PR).

## §10. Constraint provenance

Binding-as-written today; **[R]** marks constraints the maintainer's
announced founding-intent reconciliation may re-examine. If a tagged
clause is amended, the listed section is the only thing to revisit.

| # | Constraint in this design | Source | Kind | Sensitivity |
|---|---------------------------|--------|------|-------------|
| 1 | No fused cross-family *judgment* figure anywhere (strip, cards, density). **Recorded carve-out** (UX review A1): lane-membership/coverage counts (anchored vs page-note) are plumbing measurements, permitted when labeled as coverage | CONSTITUTION Art. 5.4, Art. 6 | Constitutional | **[R]** → §4, §5.3 |
| 2 | Ring/filter state always visible once shown (progressive appearance per §2); hide-with-disclosure; no silent defaults | CONSTITUTION Art. 3 | Constitutional | **[R]** → §2, §6 |
| 3 | Foreign records side-by-side, never merged/averaged; same-passage grouping only | CONSTITUTION Art. 6 | Constitutional | **[R]** → §7 |
| 4 | Nothing attaches to identities; forensic counter-read; 30064 no-mirror | CONSTITUTION Art. 7; NIP_DRAFT mirror rules | Constitutional | **[R]** → §7 |
| 5 | Document order; no engagement/recency ranking or belief-optimized emphasis | TRUTH_SYSTEMS H-7 | Annex | **[R]** → §4 |
| 6 | Three-way absence semantics; "reachable records" phrasing. Binds the *semantics*, not vocabulary — the noun was ruled by the maintainer 2026-08-28: copy says "relay" (the ux review's "server" swap overruled) | TS H-5; CONSTITUTION Art. 4.6 | Constitutional | **[R]** → §6 |
| 7 | Audit visual firewall + reserved truth vocabulary (fenced group, no body tint) | PHILOSOPHY family separation; reader invariant (`index.html` ~119-131) | Statute + design precedent | **[R]** → §4, §5.3 |
| 8 | Quote-is-identity; offsets local-only; foreign fuzzy refusal | MA.7 **measured** invariant (hash-equal texts disagree on offsets) | Engineering fact | not policy — survives any reconciliation |
| 9 | The membrane: accept-only incorporation; viewing writes nothing | Phase 25 owner decision (25.0 №1) | Maintainer ruling | ruling, re-arguable |
| 10 | Pull-not-live; no browse-time relay queries | Existing privacy posture; THREAT_MODEL absent (B18) | Process | revisit at doorbell design |
| 11 | No new publish paths; T7 pre-flight before S3 | ROAD_TO_1_0 T7 | Process | scheduling only |

## §11. Risks (carried honestly, from the judge panel)

1. **Re-grounding cost** — O(records × text) per render; memoized on a
   body-text hash; a perf budget and a cap-with-disclosure rule are S1
   plan items; book-length captures with dense extraction layers are
   the test case.
2. **The S1→S2 window** — the margin is temporarily a fourth
   presentation of the same records; S2 is sequenced early for exactly
   this reason, and S2's expert-workflow regression risk (bulk triage,
   evidence-link rows, Integrity button) is borne behind its own flag
   with the dated-kill escape hatch.
3. **Render fidelity duplication** (§3) — named, budgeted S1 work.
4. **Page-notes noise on quote-heavy texts** — the
   demote-ambiguity-to-page-notes rule may send legitimate old claims
   there; validated against real casework in the S1 walk (per the
   maintainer's validation-in-casework preference).
5. **Density at scale** — on analyzed articles near-total tint is the
   *expected* case (the corpus map is comprehensive by design). First
   mitigation is §4's family-chip toggles (disclosed, no ratification
   needed); the labeled "key only" default needs explicit
   ratification only if even claims-only proves unreadable in the
   maintainer's walk (§12.3).
6. **Firewall erosion by refactor drift** — the §5.4 guards are
   load-bearing, not decoration.

## §12. Open questions

1. **View name and default** — RULED (maintainer, 2026-08-28):
   "Annotated" is the tab label, and archived articles open in it by
   default; fresh captures land in the editable Reader (§3).
2. **S2 kill date** for the list-view escape hatch — set when S2
   opens.
3. **Density fallback ratification** — only if the S1 walk finds even
   the claims-only chip state unreadable (§11.5).
4. **Case-brief join** — RULED (maintainer, 2026-08-28): deferred to
   SP4. S3 ships the two-hop member-hash join only (briefs that cite
   this article); any 30068 wire amendment belongs to the shared-cases
   design with ecosystem-pm review.
5. **Entity marks** — stay draft-side in v1; whether entity tags join
   the margin as a family is a later ux-designer question.
6. **User-facing vocabulary** — RULED (maintainer, 2026-08-28): user
   copy says **"relay."** The ux review's "server" swap was an
   *interpretation* of the "NOSTR stays invisible" philosophy line,
   not a governance derivation, and the maintainer overruled it — the
   honest protocol term stands. The specimen stays logged for the
   founding-intent reconciliation as an example of
   interpretation-hardening; the three-way absence semantics are
   unaffected.
