# The Margin (MARGIN_DESIGN.md) — ux-designer review

> **Date:** 2026-08-28 · **Trigger:** new surface, pre-code design
> review · **Scope:** the design document only; no code exists
> (CONSTITUTION Art. 2). · **Status:** Advisory (Art. 11 — maintainer
> decides). Settled items in the design's status banner (the
> synthesis, terminology, local-first phasing) were not re-litigated.
> **Disposition:** all findings folded into `MARGIN_DESIGN.md` the
> same day — see the disposition table at the end.
>
> Skill-file note: `.claude/skills/ux-designer/SKILL.md` carried no
> governance checklist at review time (the governance-grounding update
> was running in a parallel session); the standard protocol was run,
> with the design's §10 constraint-provenance table as the governance
> lens.

**Overall posture:** the best-aligned design doc this discipline has
reviewed. It cites the portal review as its named anti-pattern and
pre-empts the two worst portal failures structurally (the two-surfaces
problem gets a dated kill; absence gets three-way honest semantics;
the degradation lane states its reasons in plain words). The findings
are mostly places where the doc *contradicts itself*, leaves a named
hazard under-resolved, or inherits a governance constraint without
paying its UX bill — the failure classes a pre-code review can still
fix for the price of a sentence.

## 1. The surface's tasks (from the maintainer's real casework)

- **T1 — Re-read your own analyzed article and see what you
  concluded, in place.** The N=1 core.
- **T2 — Add a note while reading** via the select→tag popover.
- **T3 — Manage your own records**: edit or delete a claim, triage an
  extraction proposal (the dominant loop on COVID casework).
- **T4 — See what others recorded about this page, and accept some of
  it** (S3+; the membrane).
- **T5 — Trust the absence**: know whether "no notes" means none
  exist, not-checked-yet, or partially unreachable.

## 2. Cold walk (narrated against the design as written)

*First archived open, S1, zero records:* I land in a view called
"Annotated" that I did not choose, on an article with no tint, under a
strip showing — the doc does not say what. Nothing says the view is
read-only; last time this article was editable. Nothing invites the
first note. *(→ C2, C3.)*

*Same open, analyzed article:* the corpus pass is comprehensive by
design (UA.1 — every atom), so nearly every sentence is tinted; one
base tint at ~100% coverage reads as background, not signal. *(→ D1.)*
I double-click a word — the first click opens a card stack, the
settled selection opens the authoring popover on top of it. I drag to
copy a quote — the authoring popover appears. *(→ C1.)* A hollow
square sits in the gutter beside untinted text; no gesture opens it.
*(→ B1.)* A card says "Proposal — unreviewed"; nothing lets me act on
that here. *(→ B3.)*

*S3, solo user with one new follow:* §2 said "no ring chrome beyond
Mine"; §6 said the four-ring control is "permanently visible." One
user hits three dead rings; the other never discovers Network exists.
*(→ A2.)* A pull that returns nothing says "2 relays answered" — the
first time this product ever said "relay" to me. *(→ C5.)*

## 3. Findings, ranked by user harm

### Class (a) — the design contradicts itself

**A1. The strip's headline split is a cross-family total the
design's own guard forbade.** §4 shows `"14 anchored · 3 page notes"`
while §5.4 guard 2 (as first drafted) banned any cross-family count.
Either the S1 guard fails against the S1 strip, or the split silently
disappears in implementation. **Fix:** carve the *coverage/lane
membership* counts out of guard 2's scope explicitly and record the
carve-out in §10 row 1 — a count of "things that couldn't anchor" is
a plumbing fact, not a fused judgment, but that reading must be
written down.

**A2. §2 and §6 give the implementer opposite ring chrome.** §2:
solo users see "no ring chrome"; §6: the control is "permanently
visible." Permanent four-ring chrome gives a solo first-session user
three dead segments (the portal's dead-labels pattern reborn); no
chrome makes Network undiscoverable. **Fix:** progressive chrome with
a trigger condition — no ring control while nothing beyond Mine
*could* exist; the full four-segment control (never a subset) appears
once a follow exists or `marginRings` is on. Satisfies Art. 3 (once
scope state is a live question, it is always visible) and the solo
simplicity bar at once.

### Class (b) — a task is blocked as designed

**B1. Audit evidence has no opening gesture.** Audit never tints the
body (correct, firewall) and lives as hollow squares on the rail —
but the only card-opening gesture specified is a click on a *tinted
segment*. Unreachable cards. **Fix:** rail markers are first-class
click targets, equivalent to segment clicks for their channel;
hovering a marker raises its span extent.

**B2. Owner edit/delete has no home after S2 folds the bars.** The
ladder gives each card "at most one next action"; nothing gives a
card owner Edit or Delete. Fine in S1 (the claims bar still carries
them); after S2's fold and the escape hatch's dated kill, "fix a typo
in my claim" has no affordance anywhere. **Fix:** own-record
management (edit/delete, routing to the existing claim modal) is
exempt from the one-action ladder count and renders on own cards.

**B3. Extraction-proposal cards announce a review state they don't
let you act on.** "Proposal — unreviewed" with no route to decide is
the portal's A1 precedent (instruction without affordance) — the
exact finding this project already paid for once. **Fix:** inline
accept/dismiss on the proposal card wired to the same shared triage
handlers the case dashboard uses. Prose ("review in the dashboard")
is the one option the portal review already ruled out.

### Class (c) — a task is obscured

**C1. The gesture arbitration rule doesn't cover double-click, and
read-view copying summons an authoring popover.** Double-click
word-selection is a non-collapsed selection with no drag — as
specified, click opens the stack AND the settled selection opens the
popover on top of it. And in a *reading* view the most common drag is
select-to-copy. **Fix:** restate the rule in selection-state terms —
"mouseup with a collapsed selection over a tinted segment → cards;
mouseup with a non-collapsed selection (drag, double-click,
triple-click) → the popover" — accept popover-on-copy as the cost of
one consistent selection behavior (Escape/click-away already
dismiss), and add double-click to the SMOKE_TEST row.

**C2. The margin's empty state — the first thing every new user sees
— is unspecified.** The design specifies absence semantics for rings
but never the Mine-ring zero state; the one authoring gesture is
invisible until known. In-repo precedent: the entities bar's "Select
a name in the body to tag it." B13's no-first-hour finding lands here
hardest — this view is slated to become the default on every archived
open. **Fix:** a designed strip line for the zero state: "No notes
yet — select any passage to add one," with the "?" legend adjacent.

**C3. The Annotated view's read-onlyness is silent, and the
default-view split makes it a trap.** A user who edited yesterday
reopens today, clicks into a paragraph, types — nothing happens,
nothing says why. Silent state is a documented portal failure mode.
**Fix:** a permanent quiet mode label in the strip ("Reading view —
edit in Reader," where "Reader" is the actual tab-switch affordance),
and a keypress inside the annotated container flashes it.

**C4. Circle vs Network reads as social distance but encodes fetch
state.** Both rings are "people you follow"; the boundary is whether
a round-trip has happened — an implementation fact wearing a social
costume. Also: the wider-ring teaser ("Network: 4 more…") is only
computable after a pull; the pre-pull state was never shown. **Fix:**
define the rings by what the user *does* (legend/tooltips: "Circle —
already on this device, from people you follow. Network — press to
check for new"); render the Network segment pre-pull as an action
("Check network"), not a filter; add the pre-pull state to §6's
example copy. Ring names are settled — no rename.

**C5. The honest-absence copy speaks NOSTR out loud.** "2 relays
answered, 1 unreachable" vs §1's "NOSTR stays invisible." The
three-way semantics are constitutional (row 6); the *noun* is not.
**Fix:** keep the semantics verbatim, swap the noun: "Checked the
network — nothing new (1 of 3 servers didn't answer)." Note in §10
row 6 that the constraint binds the semantics, not the word "relay."

### Class (d) — clutter and density

**D1. On analyzed articles, near-total tint is the expected case, not
the edge.** The corpus map is comprehensive by design (UA.1); project
every atom onto the text and most sentences tint. Signal is contrast.
There is a mitigation needing no ratification because it fuses
nothing and hides nothing silently: **make the strip's family chips
toggles** (all on by default; the toggle state IS the visible strip,
so Art. 3's no-quiet-default is satisfied; muting the extraction
family is a disclosed user gesture — the hide-with-disclosure pattern
row 2 already blesses). The "key only" ratification question then
arises only if even claims-only proves unreadable.

**D2. The strip is one accretion away from the portal's 17-tab strip
in miniature.** ~7 family counts + coverage split + ring control +
"?" on one line. **Fix:** only populated families render a chip (an
empty family shows nothing, not a zero) — composing with D1's
toggles and §2's only-populated ring rule.

### Class (e) — polish, cheap now, expensive later

**E1. The forensic rail shape is literally unnamed** ("third shape").
Pick it in the doc; budget the "?" legend honestly — tint +
darker-step + three shapes + the authoring gesture is six facts, so
the legend may need four lines. Three labeled shapes is still a
categorical win over the current 13 unlabeled glyphs.

**E2. No accessibility line anywhere.** Tint (color-only),
hover-raise (mouse-only), and small rail targets are the three
primary affordances; T7 already carries the reader's ARIA debt.
**Fix:** one S1 plan line — segments and rail markers focusable in
document order; Enter opens the stack; the stack is a dialog with
Escape. (Document order is already mandated — row 5 makes the a11y
ordering decision for free.)

**E3. "Annotated" makes four sibling mode tabs** where the
first-session-meaningful distinction is Annotated-vs-Reader; Markdown
and Preview are expert density. Not an S1 blocker — the S2 header
fold should consider the tab strip in the same pass.

## 4. Proposed layering (S1 first paint)

**First paint:** the article, tinted where Mine has notes · the strip
(populated-family chips as toggles, per-family page-note counts, "?"
legend, quiet "Reading view" label) · rail shapes · the designed zero
state. **One interaction deep:** card stacks (segment or rail-marker
click) · the page-notes panel with stated reasons · the popover on
selection. **S3 adds, not before:** the ring control (progressive),
pull-as-action, absence copy in server-not-relay words.

## 5. What NOT to change

The segment-partition renderer as a pure function; the page-notes
lane with per-row stated reasons; the hash-gate banner's plain words;
the membrane, the dated S2 kill, the §5.4 guards, "bars untouched" in
S1; one base tint with no per-family colors on text (resist future
color-coding requests — the rail carries family identity); the
quote-is-identity doctrine and ambiguity-demotes-honestly rule.

## 6. Disposition (2026-08-28, folded into MARGIN_DESIGN.md)

| Finding | Resolution |
|---|---|
| A1 | Coverage carve-out written into §5.4 guard 2 and recorded in §10 row 1 |
| A2 | Progressive ring chrome adopted; §2 and §6 aligned (full control, never a subset, once a wider ring could exist) |
| B1 | Rail markers are first-class click targets; hover raises span extent |
| B2 | Own-record edit/delete exempt from the one-action ladder count |
| B3 | Inline accept/dismiss on proposal cards via the shared triage handlers |
| C1 | Arbitration restated by selection state; double/triple-click in the smoke row; popover-on-copy accepted |
| C2 | Zero-state strip line specified |
| C3 | Permanent "Reading view — edit in Reader" label + keypress flash |
| C4 | Rings defined by action in legend; Network renders as "Check network" pre-pull; pre-pull state added |
| C5 | **Overruled by the maintainer** (2026-08-28): copy keeps "relay" — the review's "server" swap was interpretation-hardening of a philosophy line; the three-way absence semantics stand (§10 row 6 binds semantics, not vocabulary) |
| D1 | Family chips are toggles, all-on default, disclosed state |
| D2 | Only populated families render chips |
| E1 | Forensic shape = open triangle; legend budgeted at four lines |
| E2 | Accessibility line added to S1 scope |
| E3 | Tab-strip layering added to S2's header-fold scope |
