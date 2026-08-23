# Portal ("My Archive") UX review — ux-designer discipline

**Date:** 2026-08-23 · **Trigger:** maintainer field report — "ugly, cluttered, and evidently broken … The only reason I'm able to use this thing is because I told you how to build it. It is hardly intuitive." (the discipline's exact trigger words, `.claude/skills/ux-designer/SKILL.md:12`)
**Scope:** `src/portal/` main archive view + sub-views (case, entity dossier, inspector, import panels).
**Status:** Advisory review report (CONSTITUTION Art. 11 — maintainer decides; this discipline never merges, never writes code).
**Structural diagnosis up front:** `docs/PORTAL_DESIGN.md` (2026-06-10) specifies a read-only five-surface *viewer*; `src/portal/` today is 43 modules carrying four sign sites, three import panels, and ~15 case-dashboard blocks. The clutter complaint is three later phases' *workflows* accreted onto a viewer's information architecture. The fix is layering, not amputation (First principle 4).

---

**Status annotations (2026-08-23, at filing):** finding **A1** and the
chapter-row half of **B2** are already delivered by the in-flight
PR #341 (`fix/book-chapters-open` — the shared `portal/open-archived.js`
opener, wired into the artifacts rows and the dossier's captured-content
lines, seam-guarded). §7's **PR-1 is therefore done**, and **PR-10**
shrinks to the relationship-chip half plus the K15 sequencing. Nothing
else in this report is started.

**Status annotations (2026-08-23, end of day):** §7's **PR-1 through
PR-8 are MERGED**, each behind a maintainer soak walk recorded in
`docs/SMOKE_TEST.md`: #341 (PR-1), #349 (PR-2, plus a signing-banner
defect the walk surfaced), #353 (PR-3), #346 (PR-4), #354 (PR-5), #347
(PR-6), #350 (PR-7), #355 (PR-8). Two findings outside this report
landed alongside, both field-found by the maintainer on the walks:
#351 (the case view's People & organizations section was relay-only;
now local-first) and the Settings signing banner (it branched on
whether Save had ever been pressed, not on whether signing worked).
**Still open:** PR-9 (C1 vocabulary) stays sequenced behind Phase
29.5's reconcile repoint — the walks confirmed a third costume for it
(the summary line's "778 item(s)" beside a filtered "All 629", both
true, neither labelled); PR-10 (B2 relationship chips) waits on the
K15 fold ruling; the §2 D3 dead-label kills need Art. 11 ratification.
The pointer/touch brush (B3's second half), C5 (repeat the confirm()
line in the panel) and C6 (silent background transcript completion)
were never in §7 and remain unstarted.

---

## 1. The surface's tasks (from real use, not the feature list)

- **T1 — See, search, and inspect everything published.** The founding purpose (docs/PORTAL_DESIGN.md:14-16): tabs + facets + search + timeline + per-item inspector.
- **T2 — Reconcile publish intent against relay truth, then repair.** The "ledger says 40; relays confirm 37; 3 missing" headline, Rebroadcast, and the unpublished-local-artifacts list. Caught a real false-published stamp in the MA.6 walk (docs/JOURNAL.md 2026-07-10).
- **T3 — Build and work a case corpus.** The maintainer's dominant observed use (COVID-first): batch import, open-in-reader claim extraction, the case dashboard, corpus-level publishing (brief/entity page/extraction analysis).
- **T4 — Import non-web sources.** Transcript paste, EPUB books (real use 2026-07-18: three slices in one day), URL batches, media transcription.
- **T5 — Explore an entity and what is known about it.** Dossier / spokes / entity-corpus — already flagged by the 1.0 audit as three overlapping destinations (K15, half-done, "needs a portal walk", docs/ROAD_TO_1_0.md:1124-1131).

---

## 2. Cold first-session walk

**T1 (see my stuff).** First paint: a header with seven buttons plus a case switcher, an identity strip showing chips labeled with raw tokens — `signer`, `sync-key`, `publish-history` — an input that says "View another archive:", and a search box under a strip of up to 17 tabs. I don't know what a "sync-key" is or whether this page knows who I am. If nothing loads, the empty state tells me to "Paste your npub above" — but the only input above says it's for viewing *another* archive, so I hesitate. The row list appears, then mutates for several seconds as badges land in waves. I want to open an item; nothing indicates the row title is a button — I discover the inspector by accident (its only disclosure is a hover tooltip, index.js:260). The timeline chart looks like a static decoration; nothing anywhere on the page says I can drag across it to filter by time (that fact lives in an HTML comment, index.html:73-74).

**T2 (is it really published?).** Below the chart, a long semicolon sentence uses one vocabulary (published / confirm / missing / "on relays only" / "local only"), the facet above uses a second (Confirmed / Remote-only / "No ledger"), and the row badges a third (✓ / "◌ remote-only"). "Local only" items in the sentence can never be selected by the facet — they aren't library rows at all, which nothing explains. In the "Unpublished local artifacts" fold, each row *instructs* me to "open this article in the reader and Publish" — but the URL is plain text. The interface tells me what to do and gives me no way to do it, right next to a "Missing" fold that has a real Rebroadcast button. This is the field precedent the skill itself canonizes (SKILL.md First principle 3).

**T3 (work my case).** The header shows "🗂 my case", so I click "Import URLs…" and import ten pages — which silently go to *no* case (caseEntityId=null, index.js:1286) and the library doesn't even refresh. Later, inside the case view, I click a person's "dossier →" chip, read it, hit "← Library" — and I'm dumped in the library, my case gone; browser Back exits the portal entirely (no history writes, index.js:1366-1367). I re-find the case through the Cases tab.

**T4 (import a book).** This works — panel, progress, "Open the book →". The link full-page-reloads into the dossier, where "Captured content" lists my chapters as plain text I cannot click (entity-dossier-view.js:268-273); each chapter's library card subtitles itself with a synthetic `file:///imported/epub/…` path and never shows the book's name (library.js:128-129, import-book.js:48). *(Both are the known field defects already in flight — cited here as the pattern's ground, not as new findings.)*

**T5 (who is this entity?).** From the case, a person chip goes to spokes, "dossier →" goes to the dossier; the dossier's "Relationships" block shows truncated raw ids (`entity_ab…`) that name nothing and click to nothing (entity-dossier-view.js:216-217). Three destinations show overlapping things — the K15 finding, unchanged.

---

## 3. Findings, ranked by harm class

### Class (a) — the interface lies about itself

**A1. Instruction with no affordance in "Unpublished local artifacts".** Rows say "`<url>` — open this article in the reader and Publish to emit it" as plain text (src/portal/index.js:754-755). *Damages T2* — the repair loop dead-ends; the user must copy a URL by hand while the sibling "Missing" fold has a real button. **Fix:** render the URL as a button wired to the same open-archived-in-reader path the case view already uses (src/portal/case-view.js:43-54). One handler, no new concept.

**A2. Header imports silently ignore the active case.** The header announces "🗂 <caseName>" while "Import transcript…/URLs…" pass `caseEntityId: null, onDone: null` (src/portal/index.js:1247,1261,1286) — imports are not case-tagged and the library doesn't refresh. *Damages T3/T4* — the chrome asserts a context the actions don't honor. **Fix:** pass the active case's entity id and a `boot()` onDone to the header-mounted panels; the panels already accept both (the case view proves it).

**A3. Empty state directs users to an input labeled for something else.** "Paste your npub above" (src/portal/index.js:1083) points at the input whose placeholder is "View another archive:" (index.html:42) — and pasting your own npub there yields a read-only *viewer* unless another source corroborates it (identity.js:133-146). *Damages T1* — the recovery path for the most common broken first session misdirects. **Fix:** change the empty-state copy to name the real options in order ("configure signing in Settings, or publish once"), and retitle the input "Your npub, or another archive to view" only if identity.js genuinely promotes corroborated keys — otherwise don't mention pasting at all.

### Class (b) — task blocked

**B1. No navigation history: every "back" is "← Library", and browser Back exits the portal.** `onBack` hard-codes `{name:'library'}` (src/portal/index.js:860); no pushState/popstate anywhere (index.js:1363-1374). *Damages T3/T5* — case → person → dossier → back loses the case; the dominant casework loop pays a re-find on every exploration. **Fix:** a one-array in-memory view stack — push the current `state.view` on each `onOpen*`, pop it in `onBack`, label the button "← Back" with the destination name. (Hash-based history can layer on later; the stack alone unblocks the loop.)

**B2. Dossier content rows and relationship chips are dead ends.** "Captured content" lines are text-only spans (src/portal/entity-dossier-view.js:263-278); "Relationships" badges show truncated raw entity ids, unclickable (216-217). *Damages T4/T5* — the unreachable-chapters defect is one instance of a block-wide pattern: the dossier lists things it cannot open. **Fix:** make each content row a button through the existing open-in-reader path, and resolve relationship ids to names via the entity registry, routing through the existing `onOpenEntityDossier`. *(Sequence with the in-flight chapter fixes and the K15 portal walk — see §7.)*

**B3. The timeline brush is undiscoverable and mouse-only.** Drag-to-filter exists only as mousedown/mouseup handlers (src/portal/index.js:584-599) and an HTML comment (index.html:73-74). *Damages T1* — time-scoping, a founding "door" (PORTAL_DESIGN.md:208-209), is invisible; on touch it is absent. **Fix:** one visible caption under the chart — "drag across the bars to filter by time" — appearing whenever the chart renders unbrushed. (Pointer-events touch support is a separate, second change.)

### Class (c) — task obscured

**C1. Three vocabularies for one concept: publish state.** Summary line (published/confirm/missing/"on relays only"/"local only", index.js:674-679) vs facet (Confirmed/Remote-only/"No ledger", index.html:63-66) vs badges (✓/"◌ remote-only", index.js:267-273) — and "local only" vs "No ledger" are *different concepts* wearing similar clothes. *Damages T2.* **Fix:** adopt the summary line's words as canonical (it's the founding vocabulary, ROADMAP.md:1062-1063) and rename the facet options and badge tooltips to match — pure string changes. *(Coordinate with Phase 29.5's reconcile repoint, ROADMAP.md:2112-2113 — do the renaming in or after that PR, not before.)*

**C2. The inspector's opener is a secret.** Row titles open the drawer, disclosed only by hover tooltip (src/portal/index.js:260-261) — invisible on touch and to non-hoverers. *Damages T1.* **Fix:** a small trailing "ⓘ" icon-button on each row bound to the same handler; title-click stays.

**C3. Up to 17 top-level tabs, with self-hiding composition.** library.js:38-55 + index.js:172: a layperson's corpus shows a shifting strip whose judgment-kind tabs (Assessments, Audits, Predictions, Findings, Verdicts, Integrity, Extractions…) mean nothing on day one. *Damages T1 structure* — the strip is expert density priced into entry. **Fix:** first-paint tabs All / Articles / Claims / Cases / Entities, with the remaining typed tabs under one "More ▾" overflow that shows the same live counts. No tab is deleted; the counts logic is untouched.

**C4. Two same-looking "open in reader" actions with opposite write semantics.** Inspector's "Open in reader" is a read-only relay reconstruction (inspector.js:488-490); the case view's evidence path opens the writable archive record — distinguished only by tooltips. *Damages T3* — a user extracts claims into the wrong (read-only) surface and loses work-intent. **Fix:** rename the inspector action "View published copy (read-only)".

**C5. Key one-time instructions live in native `confirm()` dialogs.** The workspace-switch warning (index.js:1204) and the LLM-spend warning (import-urls.js:139-141) vanish on OK and can't be re-read. *Damages T3.* **Fix:** after confirmation, repeat the operative line in the panel's status area ("Analyzing N pages — up to N Anthropic calls"); the dialog itself can stay.

**C6. Silent background completion of transcriptions.** A closed media panel still saves the finished transcript with no notification (import-media.js:192-198) — work "appears" later, unexplained, in local artifacts. *Damages T4.* **Fix:** on completion with the panel disconnected, write one line into `#xr-status` ("Transcript of <title> saved to the archive").

### Class (d) — clutter

**D1. The header mixes three action families in one row.** Four import buttons + a graph view + two sync buttons (index.html:19-31). *Damages T1 first-paint legibility.* **Fix:** one "Add ▾" select-as-menu (Transcript / Book / URLs / Transcribe) — the exact pattern the case view's "Sources ▾" already ships (case-view.js:172-196; consistency, First principle 5) — leaving Refresh visible and moving Full resync + Across workspaces into a "⋯" overflow. Also dissolves the two-click toggle defect (a different importer currently only *closes* the open panel, index.js:1246-1285) and the book panel's missing Close.

**D2. The identity strip renders internal provenance tokens as UI.** Chips print `sync-key`, `publish-history`, `manual` verbatim (index.js:102,122). *Damages T1.* **Fix:** one token→label map (see §5) and fold the whole identity strip (chips + viewer input + settings button) behind a one-line summary: "Showing events signed by <shortKey> ▸".

**D3. Dead kind labels no user can populate.** Annotation / Fact-check / Rating / Topic trust / Vote (library.js:69-73) — already kill candidates (ROAD_TO_1_0.md:1975-1978). Removal is product-manager's call, not this discipline's; noted here only as clutter evidence supporting that ratification.

### Class (e) — polish

**E1.** Page still titles itself "My Archive" against the ratified one-noun rule "Archive" (ROAD_TO_1_0.md:1060; index.html:6,12). String change.
**E2.** Book import's "Open the book →" does a full `location.reload()` (import-book.js:179-182), losing scroll/panel state — route through the in-memory router instead once B1's stack exists.
**E3.** Inspector closes only via the small ✕ (inspector.js:342-345) — add Escape.
**E4.** Rows/badges arrive in async waves for seconds after first paint (index.js:974-1020) — acceptable; do not chase this before Phase 29.5's cache work.

---

## 4. Proposed layering — main view

**First paint (structure for the first-session user):** page title + active-case switcher · "Add ▾" menu + ↻ Refresh · search box · five core tabs + "More ▾" (live counts) · the row list (kind chip, title-as-button *plus* visible ⓘ, date, ✓ badge) · the timeline chart with its one-line drag hint · the status line · the designed empty states.
**One click deep:** facets (platform/source/case/client/status) behind a "Filter ▾" disclosure · the inspector drawer · the ledger summary sentence with its two repair folds (already collapsed `<details>` — correct as-is) · predictions-due strip · group-by-source.
**Advanced fold:** identity chips + viewer-npub input + entity-keys rollup ("Showing events signed by … ▸") · Full resync · Across workspaces · raw provenance detail · the reconciliation legend.
Nothing is removed; every current element keeps a home one level down from where it sits today.

---

## 5. Jargon table

| Term | Where it appears | Plain replacement / first-contact line |
|---|---|---|
| `sync-key`, `publish-history`, `manual` | identity chips, index.js:102 | "backup key" / "seen in your published events" / "added by you" |
| npub | viewer input, empty state (index.html:42, index.js:1083) | keep, once, with "(your public key, starts with npub1)" |
| ledger | summary line, facet, badges (index.js:674) | "publish record" — or keep "ledger" but use it in *all three* places (C1) |
| ◌ remote-only | row badge (index.js:271) | "on relays, not in this device's publish record" (promote tooltip to label in the facet) |
| "No ledger" | status facet (index.html:66) | "kind has no publish record (never counted missing)" |
| Rebroadcast | repair fold (index.js:702) | keep — add "(re-send as originally signed)" once |
| coordinate | inspector fields (inspector.js:352-365) | "event address" with the raw value beside it |
| "readable corpus brief" | Briefs sub-line (library.js:129) | "case summary (readable article)" |
| "encrypted — listed, not decrypted" | library.js:233 | "encrypted backup entry (contents not shown)" |
| "NIP-02 follow list (opt-in mirror)" | library.js:372 | "your follow list" |
| "creator-binding manifest" / "✓ creator-bound" | library.js:382, index.js:330 | "key ownership proof" / tooltip stays for the expert detail |
| "publishes with the 13.8 batch" | prediction resolution status (index.js:493) | "publishes with your next audit publish" |
| Spokes | case header, badges (index.js:340-345) | "Connections graph" (pending K15's fold ruling) |
| "artifact" | folds, rollups (index.js:742) | "item" in user-facing chrome; "artifact" stays in docs/wire |

---

## 6. What NOT to change (the taste-churn guard, applied to myself)

- **The inspector drawer's contents** — raw JSON open by default, relay holdings, side-by-side audit runs. Expert density exactly one click deep; the founding read-back promise fulfilled. Fix its *opener* (C2), not its body.
- **The ledger headline sentence.** "Local ledger says N; the relays confirm M; K missing" is the design's best sentence — honest, load-bearing, field-proven (it caught a false stamp). C1 conforms everything else *to* it.
- **Tab counts respecting live search/facets.** "What would I see if I clicked this" is the right invariant; it reads as surprising only because there are 17 tabs. Keep it under C3's smaller strip.
- **Collapsed-by-default `<details>` folds and per-case section memory** (case-view.js:123-141). Correct progressive disclosure; a returning expert's layout persistence is muscle memory worth protecting.
- **The designed empty states.** "No identity resolved" / "Nothing found on the relays" with recovery text is First principle 6 done right — only A3's misdirection needs the copy fix.
- **The case view's "Sources ▾" pattern** — don't invent a second grouping idiom; D1 *generalizes* this one.
- **The footer privacy note** ("Relays can see that request") — honest-limits posture; keep verbatim.
- **No deletion of judgment tabs, facets, or the viewer-npub capability.** Everything in §4 keeps a home; removals (D3's dead labels) route to product-manager for Art. 11 ratification.

---

## 7. Sequenced work list (smallest first; each independently shippable; none blocks casework)

1. **PR-1 — Wire the dead instruction (A1).** Button-ify the unpublished-artifacts URL via the existing open-archived-in-reader path. ~1 file.
2. **PR-2 — String truth pass (A3, C4, E1, part of §5).** Empty-state copy, "View published copy (read-only)", "Archive" title, provenance-token map, sub-line jargon. Strings only.
3. **PR-3 — Import panel mechanics (part of D1).** Clicking a different import button opens it in one click; book panel gets Close. No layout change yet.
4. **PR-4 — Header imports honor the active case (A2).** Pass active-case entity id + `boot()` onDone. *(If case-inheritance is contested, the maintainer rules first; the fallback is a visible "not added to any case" line on header-mounted panels.)*
5. **PR-5 — Inspector opener + timeline hint (C2, B3-caption).** Trailing ⓘ per row; one caption line under the chart. Touch events for the brush deferred to its own PR.
6. **PR-6 — View stack (B1, then E2).** In-memory back stack; "← Back" targets the real previous view; book-import deep link routes through it.
7. **PR-7 — Tab layering (C3).** Five core tabs + "More ▾" with live counts.
8. **PR-8 — Header regroup + identity fold (D1, D2).** "Add ▾" menu, "⋯" overflow, identity strip behind its summary line.
9. **PR-9 — One publish-state vocabulary (C1).** Facet/badge renames to the headline's terms — **sequenced into or after Phase 29.5's reconcile repoint**, not before.
10. **PR-10 — Dossier dead ends (B2).** Clickable content rows + named relationship chips — **after the in-flight chapter fixes land and the K15 portal walk rules** on the dossier/spokes fold, so this doesn't polish a surface K15 may collapse.

Each PR names the task it unblocks above; none swaps one aesthetic for another; the live-walk precondition already named for portal changes (ROAD_TO_1_0.md:1124-1131) applies to PRs 6-10.
