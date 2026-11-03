# ux-designer lens — fresh-eyes audit of X-Ray (2026-09-05)

Scope: the five user-facing surfaces as they render from their HTML + JS
(`src/reader/`, `src/portal/`, `src/options/`, `src/sidepanel/`,
`src/network/`), `docs/PORTAL_UX_REVIEW.md` (PR-1..8 shipped),
`docs/MARGIN_DESIGN.md` + `docs/MARGIN_UX_REVIEW.md` (S1 on PR #370), and
the ROAD_TO_1_0 status a month on. Yardstick: a non-technical researcher
who installs X-Ray today. Method: `.claude/skills/ux-designer/SKILL.md`
Protocol — tasks first, cold walk, inventory, rank by user harm, propose
layering. Rendered evidence used where it exists (the
`tools/smoke/ma6-02-expanded.png` screenshot of the case dashboard); the
rest is read from the shells and renderers, with `file:line`.

---

## Verdict

X-Ray has one genuinely excellent interaction — select a passage, a
popover offers "tag as person / organization / place / thing / add as
claim / quote" (`src/reader/entity-tagger.js:1-25,142-158`) — and
everything else is a *list of things the tool knows*, stacked below the
article or folded into a 4,400-pixel column, each block opening with a
small-caps heading and a paragraph explaining itself. The reader shell
declares 20 header buttons (12 flag-hidden) plus 3 view tabs and then
seven bars — entities, claims, claim-proposals, epistemic audit,
findings, lens readings, comments (`src/reader/index.html:99-165`) —
under a comment-enforced rule that they "never visually merge" — a rule
that the CSS does not even implement (all six bars share
`background: var(--xr-surface)`, `src/reader/index.css:1466,1543,1556,
1783,2078,2560`); the separation is purely stacking order. The case
dashboard is 9 top-level `<details>` sections, one of which ("Analysis —
the LLM passes over this corpus") holds 10 sub-blocks (`src/portal/
case-view.js:266-296,306-395`), with 28 explanatory `xr-view__dossier-line`
paragraphs across the block renderers. Options → Advanced is the real
control panel: 18 subsections, 12 flag checkboxes, 41 inputs, 41
buttons, 47 hint paragraphs, one Save at the bottom with no dirty
state (`src/options/options.html:222-800`; 0 hits for `dirty|beforeunload`
in `src/options/index.js`).

For the wide-release yardstick the two biggest harms are unchanged
since ROAD_TO_1_0 a month ago: there is still no first hour (B13 —
`onInstalled` registers context menus and nothing else,
`src/background/index.js:368`; Options opens on the Relays wss:// table,
`options.html:23`), and Publish — the only irreversible public action —
is still one click with mid-flight toasts (B12 — `src/reader/index.js:
8119` → `publish()` at `:6026-7598`, 1,573 lines), while deleting a
*local* copy gets a designed 8-line confirm (`:750-761`). Everything the
August wave shipped (portal PR-1..8, transcription, margin S1) was real
work, but none of it touched minute one or the publish click. The
ROAD_TO_1_0 tracks that carry the first hour (T7 0/11) and the seam
collapse (T8 0/9) have not started; kills K8, K9, K15 are still in the
tree.

Fresh eyes on the whole: this is a three-surface product (Reader,
Library, Settings) shipped as six (reader, portal, sidepanel, network,
options, plus ~13 modals), with roughly twenty-three internal nouns in
its chrome where a researcher needs six (source, claim, person/org,
case, publish, relay). The Margin design's diagnosis — "the insight and
the sentence it is about are never in the same place … a list below is
homework" (`MARGIN_DESIGN.md` §1) — is the correct fresh-eyes reading of
the reader, and it is the right *destination*. But the S1 slice on PR
#370 is, by its own §11.2, "temporarily a fourth presentation of the
same records," flag-gated, with the fold (S2) unscheduled; merging S1
alone adds a surface to a product whose problem is too many surfaces.
The maintainer's "testing stuff I don't even care about" is the correct
instinct: the parts of S1 he does not care about (ring chrome, page-note
lane, four guard tests, a11y baseline) are there for S3's sake, not his.

## What is good (KEEP)

- **The select→tag popover** (`src/reader/entity-tagger.js`). One
  gesture, six typed outcomes, no modal until a claim needs fields. This
  is the product's quality bar and the Margin design correctly names it
  so (`MARGIN_DESIGN.md:48`). Build everything else toward it.
- **The delete-capture confirm** (`src/reader/index.js:750-761`): says
  what goes, what stays, with counts. The publish pre-flight should be
  this text's sibling.
- **Designed empty states that state a reason** — the extraction bar's
  "none retained … dropped rather than stored ungrounded"
  (`src/reader/extraction-bar.js:41-49`), the lens bar's post-T3 copy
  that no longer routes users to the console (`src/reader/lens-section.js:
  50-55`), the Library's "No archive identity yet" summary line
  (`src/portal/header-chrome.js:73-78`).
- **Collapsed `<details>` with per-case memory** (`case-view.js:114-135`)
  — correct progressive-disclosure primitive; the problem is what goes
  in it, not the primitive.
- **The Library header after PR-8**: one "Add ▾", one Refresh, one "⋯"
  (`src/portal/index.html:19-25`, `header-chrome.js`). The right idiom;
  generalize it.
- **Case-view claim rows with relationship chips** (`case-view.js:
  401-458`) — the one place a cross-article link is legible in context.
- **The footer privacy line** "Relays can see that request"
  (`portal/index.html:96-97`, `network/index.html:71-73`) — honest, short,
  verbatim-keep.
- **The one-step "New case"** (`options.html:266-272`, `case-create.js`)
  — the mechanics are right; only its address (buried in Advanced) is
  wrong.
- **The "Accept as claim / Dismiss / Accept all open / Link all covered"
  triage verbs** on proposals (`extraction-block.js`, screenshot) — a
  human-accept loop with bulk affordances; keep the verbs, move the
  block to the top of the case.

## Grandfathered

Each: the thing — the decision that grandfathered it — why the premise
is gone (or was never the maintainer's).

- **The reader's "visual firewall" (bars may not share layout/colour)**
  — `docs/EPISTEMIC_AUDIT_DESIGN.md:1076-1077` rule 6 ("audit blocks and
  assessment blocks never visually merge, sum, or share a color scale"),
  carried into `reader/index.html:116-119,141-143` and repeated per
  family (findings, lens). Provenance: Phase 13 design idiom, E5 on the
  questionnaire's ladder (Q1 lineage: a two-kind consumer rule that
  became an all-families layout rule). The premise — that colour
  adjacency would be read as fusion — was never tested; the CSS already
  gives every bar the same surface colour, so what the rule actually
  buys is *seven stacked headings*. Art. 6's data arm (no number
  computed across families) is a different, keepable thing; the
  layout prohibition is the grandfathered part.
- **Seven bars below the article as the reading surface** — Phase 5
  (claims bar), 13.5 (audit), 14 (findings), 16 (lens), MA.2b
  (extraction), each appended under the previous per the firewall
  idiom. `MARGIN_DESIGN.md` §1 already declares the premise gone.
- **The portal as "My Archive" (a relay-truth viewer)** — `docs/
  PORTAL_DESIGN.md` (2026-06-10) specified a read-only viewer; three
  phases of workflow accreted onto it (PORTAL_UX_REVIEW diagnosis). The
  premise (the user's work lives on relays; the portal reads it back)
  inverted the day case-bound workspaces (2026-07-20) made the local
  corpus the workbench. The identity strip / viewer-npub lane / ledger
  vocabulary (`portal/index.html:36-46,62-67`) are that viewer's organs.
- **The sidepanel as a second application** — Phase 4's "entity browser"
  grew keypair controls, linked accounts, dossier, network activity,
  inconsistencies, case scope, export case, add archived articles,
  publish status, sync-across-devices, health (`sidepanel/index.js:
  265-367,1289,1927`; 2,242 lines). Premise: entities are the user's
  primary object. Since Phase 20 the primary object is the case and the
  claim; the entity is a tag.
- **"Case" as an entity type** — Phase 12.5 "a case IS an entity"
  (`case-view.js:6-8`), so the sidepanel's ＋ New offers type `case`
  (`sidepanel/index.js:1302` over `ENTITY_TYPES` incl. `'case'`,
  `entity-model.js:59`) and the tagger popover offers "Create new as …
  case" (`entity-tagger.js:150`). K9 ratified 2026-08-09 says remove;
  not executed.
- **Options → Advanced as the flag console** — Phase 9a's "flags without
  an Options control are flipped via DevTools" policy
  (`feature-flags.js:12-14`) and the one-checkbox-plus-disclosure
  pattern repeated eleven times. Premise: the flags were temporary
  phase gates. They are now the product's permanent consent switches
  for what leaves the machine, and three of them (B10) still have no
  control at all (`grep pref-extraction|pref-store-first|pref-review
  options.html` = 0).
- **The Network page as a separate surface behind `networkPage`** —
  Phase 25 "off by default while the phase is in flight"
  (`options.html:246-253`). The phase is complete; the empty state
  still names the flag key verbatim (`network/index.js:790-792`).
- **"Options" vs "Settings" as two names for one page** — the manifest
  calls it `options_ui`, the page titles itself "X-Ray — Settings"
  (`options.html:5`), and the reader's error strings say "Options →
  Advanced → LLM assist" seven times (`reader/index.js:653,654,3841,
  4064,4093,4357,4740`) while the chips say "manage cases in Settings"
  (`:8087`). Grandfathered by the userscript port's naming.
- **The Margin §9 slice ladder (S1 "See" → S2 "Fold" → S3 rings)** —
  ratified 2026-08-28 in a governance-caution posture (§10 tags 7 of 11
  constraints [R]); the ladder's premise is "additive first, purely
  additive, reviewable in one sitting." That premise optimizes for
  review safety, not for the user, and the maintainer's 2026-09 remark
  is the evidence that it does not fit how he actually validates.

## Garbage

Dead, duplicated, or actively harmful in the UI. Removal of *capability*
is product-manager's call; these are surface elements whose removal
loses no capability or whose capability is already ratified for kill.

- `reader/index.html:127` "Import audit JSON…" always visible on every
  capture (K8, ratified, not executed) and `options.html:371-376`
  pointing users at `docs/auditor-prototype/scorer/` (K8).
- `portal/entity-view.js:78` the separate "Entity corpus" destination
  button (K15, not executed — the "Experimental" half of K15 was done).
- `sidepanel/index.js:1302` `case` as a creatable entity type in ＋ New,
  and `entity-tagger.js:150` the "case" type button in the popover (K9).
- `network/index.js:790-792` the empty state that prints the flag key
  `networkPage` as UI.
- `portal/cross-workspace-view.js:85` "Bind cases to workspaces in
  Settings ▸ Workspaces" — names a tab that does not exist (the section
  is "Cases" under Advanced, `options.html:255`). Lies-about-itself.
- The eight "— see console" terminations (`entity-dossier-view.js:75,169`;
  `extraction-block.js:276`; `synthesis-block.js:593,594,943`;
  `trace-block.js:63`; `sidepanel/index.js:1869`) now that a Diagnostics
  panel with Copy exists (`options.html:625-637`) — the remedy exists,
  the strings do not point at it.
- Two "Suggest" buttons with different emoji (✨ / 💫,
  `reader/index.html:27,74`) distinguished by *where the model runs* —
  the user-facing difference is "sends article text" vs "on this
  machine" (T8 item, open).
- The "Spokes graph" button label (`case-view.js:166`) — "spokes" is a
  layout algorithm's name, not a thing a researcher wants.

---

## Findings (ranked by harm)

Harm scale: 5 = blocks wide release / destroys trust; 4 = blocks a
primary task; 3 = obscures a primary task; 2 = clutter; 1 = polish.
Effort: S (strings/one file), M (one surface), L (cross-surface).

### UXDE-01 · There is still no first hour — install does nothing, Settings opens on a wss:// table
- **Harm 5 · DEFECT · Effort M · ROAD_TO_1_0 B13 (open), T7 (0/11)**
- **Evidence:** `src/background/index.js:368` (`onInstalled` →
  `registerContextMenus` only); `src/options/options.html:23` (Relays is
  the active tab), `:65-70` (the welcome banner lives inside the Signing
  tab the user has not clicked); no Help link in any of the five shells
  (`grep Help|USER_GUIDE` over the shells = 0 hits); `README.md:19` still
  says v0.7.0.
- **Claim:** a researcher who installs X-Ray sees nothing, clicks the
  toolbar icon, gets a reader tab, and the first thing that fails is
  Publish (no identity) — with the remedy in a tab they were never sent
  to. Blocks: the first capture→publish.
- **Fresh-eyes action:** `onInstalled reason='install'` opens Settings
  on a three-step welcome (identity is generated *for* them with one
  button; default relays pre-filled; "what becomes public" one
  paragraph). Default the Settings landing tab to Signing whenever no
  identity exists. One "?" in every header opening the guide section
  for that surface.

### UXDE-02 · Publish is one click; disclosures are toasts after the events are on the wire
- **Harm 5 · DEFECT · Effort M · B12 (open), T7 pre-flight item (open)**
- **Evidence:** `src/reader/index.js:8119-8125` wires `#xr-publish`
  straight to `publish()`; `publish()` spans `:6026-7598`; the local
  delete confirm at `:750-761` is the designed counter-example.
- **Claim:** the confirmation hierarchy is inverted — the only
  irreversible public action has the least ceremony. With any of the
  seven publish flags on, a click also emits stances, findings,
  verdicts under the user's key. Blocks: *share* (trust).
- **Fresh-eyes action:** a pre-flight sheet assembled from the same
  selectors the loop calls, listing artifact class → count → signing
  key → relays → one irrevocability line, with Publish as its confirm.
  Also the *only* place "what becomes public" needs to be explained;
  the eleven Advanced hint paragraphs then shrink to one link.

### UXDE-03 · The reader's reading surface is seven stacked bars under a "visual firewall" the CSS does not even implement
- **Harm 4 · GRANDFATHERED · Effort L · not in ROAD_TO_1_0 as such (T7 "icon legend" is a symptom)**
- **Evidence:** `src/reader/index.html:99-165` (seven hosts/sections);
  `:116-119,141-143` the firewall comments; `docs/EPISTEMIC_AUDIT_DESIGN.md:
  1076-1077` rule 6 (origin); `src/reader/index.css:1466,1543,1556,1783,
  2078,2560` — every bar `background: var(--xr-surface)`; claim cards
  carry five glyph buttons ⚖ 🏛 🔗 ✎ 🗑 (`claim-extractor.js:779-783`)
  and the bar head two more ("others' claims", "integrity",
  `:798-806`); the findings bar adds "Set baseline… / + Finding"
  (`findings-section.js:24-25`); the audit bar "Quick / Thorough / Import
  audit JSON…"; the lens bar "Run lens reading…".
- **Claim:** the rule forbids the one fix (a single typed notes surface)
  and delivers no separation the user can see beyond order. A first
  session cannot tell which bar is *theirs* to act in. Blocks:
  read → mark → judge in one sitting.
- **Fresh-eyes action:** ONE notes surface (the Margin's §5.3
  model-level fence — per-family templates, reserved words only inside
  their family, audit cards in their own group — is the correct
  implementation of the same principle without the layout tax). Keep
  Art. 6's data arm; retire the layout/colour arm — see Q-A.

### UXDE-04 · The case dashboard is a 4,400px column of 19 self-describing blocks with the daily loop in the middle
- **Harm 4 · GRANDFATHERED (Phase 12.5 viewer + 2026-07-20 declutter) · Effort M · PORTAL_UX_REVIEW §4 layering (partially done); K15 (open)**
- **Evidence:** screenshot `tools/smoke/ma6-02-expanded.png`;
  `src/portal/case-view.js:266-296` (9 sections: Published audit &
  forensic record, Evidence, Analysis, Shape of knowledge, Case graph,
  Hypothesis map, Timeline, People, Published claims, Other artifacts)
  and `:306-395` (10 blocks inside Analysis: links, synthesis,
  extraction, epistemics, cross-coverage, known-unknowns, references,
  wire-scan, forensic-corpus, corpus-audit); block headings such as
  "CLAIM PROPOSALS — THE DURABLE MAP ARTIFACTS", "Corpus epistemics —
  distributions, never an average", "Audit dossier (derived — recompute,
  don't trust)" (`extraction-block.js:104`, `epistemics-block.js:23`,
  `dossier-block.js:12`); 28 `xr-view__dossier-line` explainer
  paragraphs across `src/portal/*-block.js`.
- **Claim:** the block that carries the maintainer's dominant loop —
  accept/dismiss AI claim proposals — is the third sub-block of the
  third section, under a heading written for the wire format. Every
  heading argues with a governance rule ("not a verdict", "never an
  average", "not a ranking") instead of naming a task. Blocks:
  organize-into-a-case and triage.
- **Fresh-eyes action:** a case page with three tabs — **Sources**
  (evidence block + Add ▾), **Claims** (open proposals first, then
  accepted claims with their chips), **Analysis** (everything
  LLM/derived, each block one line until opened). Headings name the
  task ("Review 4 proposals"); governance disclaimers move to the "?"
  tooltip.

### UXDE-05 · Twenty-three internal nouns in chrome where a researcher needs six
- **Harm 4 · GRANDFATHERED (per-phase vocabulary, no naming pass) · Effort M · T8 "one user-facing noun per surface" (open); PORTAL_UX_REVIEW §5 (strings partly done, C1 open)**
- **Evidence (occurrences in surface HTML+JS incl. comments, reader/
  portal/options/sidepanel/network):** relay 174/310/107/133/89 ·
  corpus 105/230/18/3/1 · lens 179/32/9 · extraction 128/79/10 ·
  ledger 49/107/10 · verdict 99/78/8/6/10 · assessment 97/72/15/17/8 ·
  workspace 3/65/81 · integrity 61/50 · forensic 44/52/13 · maneuver
  17/56 · jurisdiction 53 · npub 23/48/24/24/28 · coordinate 22/42 ·
  dossier 8/365/1/22 · proposal 71/85/6/6/26 · reconcile 2/45 ·
  attestation 5/2 · convergence 0/6 · hypothesis map 0/5 ·
  counterfactual 0/6 · entity page 0/9. User-visible specimens:
  "Epistemic audit" bar label (`reader/index.html:122`); "ledger
  status" facet (`portal/index.html:62-66`); "Adjudicate this claim
  (atomize + rule)" (`claim-extractor.js:780`); "Re-broadcast follows",
  "petnames", "trusted provenance only" (`network/index.html:20-27,60-62`);
  "Restore entity keys" (`options.html:111`).
- **Claim:** the words a researcher must know to do the primary flow are
  **source, claim, person/organization, case, publish, relay** (relay
  ruled 2026-08-28). Every other noun is a family name, a storage
  term, or a wire term leaking into chrome. Jargon is a tax on every
  task.
- **Fresh-eyes action:** one noun per concept (table in Fresh-start
  design), applied as a strings-only pass; family names survive inside
  their own cards; wire/storage words (coordinate, ledger, artifact,
  workspace, corpus, atom, extraction, reconcile) never appear in
  chrome. "npub" appears once, as "your public key (npub1…)".

### UXDE-06 · Creating a case has three doors, none where the work is
- **Harm 4 · DEFECT · Effort S · K9 (open)**
- **Evidence:** `src/options/options.html:255-272` (the real one:
  Advanced → Cases → "New case"); `src/sidepanel/index.js:1289-1320`
  (＋ New with type `case`); `src/reader/entity-tagger.js:150` (popover
  "Create new as … case"); the reader/sidepanel case chips route to
  Settings (`reader/index.html:15-16`, `sidepanel/index.html:13-14`);
  the Library has a Cases tab (`library.js:CORE_TAB_KEYS`) but no
  "New case".
- **Claim:** the organize-into-a-case step starts in Settings → Advanced
  behind a paragraph about storage namespaces. The two wrong doors
  (sidepanel/popover) create an entity of type case that is *not* a
  workspace-bound case, so a user can make a "case" that no capture
  joins. Lies-about-itself.
- **Fresh-eyes action:** execute K9 (remove `case` from creatable
  entity types in the sidepanel and popover); add "New case…" to the
  Library's Cases tab and to the reader's case chip menu, both calling
  `createCase()`.

### UXDE-07 · Settings → Advanced is the product's control panel: 18 subsections, one Save, no dirty state, three flags with no control
- **Harm 4 · GRANDFATHERED (Phase 9a flag policy) · Effort M · B10 (open), B11 (half: dead flags retired), T7 "split Advanced" (open)**
- **Evidence:** `src/options/options.html:222-800` — subsections
  Reader, Cases, Active case data, Backups & sharing, Assessments &
  claim links, Epistemic audits, Forensic findings, Truth adjudication,
  Entity corpus, Identity sharing, LLM assist, AI vision, Capture
  automation, Transcription, Diagnostics, Case synthesis, Power user,
  Danger zone; 41 `<input>`, 41 `<button>`, 47 `.xr-opt__hint`;
  `advanced-save` at `:778`; 0 hits for `dirty|beforeunload` in
  `src/options/index.js`; `pref-extraction*|pref-store-first|pref-review*`
  = 0 hits in `options.html` (B10's three DevTools-only flags,
  including the kind-30070 publish gate).
- **Claim:** a researcher deciding *what leaves their machine* must
  read eleven near-identical disclosure paragraphs, and can lose every
  change by closing the tab. Blocks: consent to share.
- **Fresh-eyes action:** split into named tabs by user intent —
  **Identity · Sharing (what becomes public: one table, the eleven
  toggles) · AI · Transcription · Your data (backup/restore/merge/reset)
  · Developer**. Autosave per control (relays/signing already do their
  own Save). Add the three missing controls with their flag comments as
  the disclosure.

### UXDE-08 · Six surfaces for a three-surface product; the entity has four destinations
- **Harm 3 · GRANDFATHERED (per-phase surfaces) · Effort L · K15 (open), T8 "collapse the three entity destinations" (open)**
- **Evidence:** `manifest.json` `side_panel` + `options_ui`; `src/portal/
  entity-view.js:78` "Entity corpus" button; `entity-dossier-view.js`;
  `entity-page-block.js`; `sidepanel/index.js:265-367` detail sections
  (NOSTR keypair, Linked accounts, Dossier, Your claims about this
  entity, Network activity, ⚠ Inconsistencies, Case scope, Export case,
  Add archived articles, Publish status) with buttons Unlink | Link to… |
  Copy | Reveal | Link an account… | Open full dossier | Load from relays
  | Save scope | Export JSON | Export Markdown | Share case bundle
  (includes keys) | Add to case | Save changes; `network/index.html`
  as a third full-tab page.
- **Claim:** "where do I look at a person" has four answers and "where
  is my stuff" has three (reader archive banner, sidepanel, Library).
  Every divergence is learned twice. Blocks: orientation.
- **Fresh-eyes action:** Reader + Library + Settings. Sidepanel content
  becomes Library ▸ People & organizations (detail = one page with
  tabs Overview / Graph / From the network); Network becomes Library ▸
  "From people you follow" as a source lane plus a Follows list under
  Settings ▸ Identity. Keys/sync/export-with-keys move to Settings ▸
  Your data.

### UXDE-09 · The primary action — mark a claim — has no visible affordance; the flag-gated actions do
- **Harm 3 · DEFECT · Effort S · T7 "in-reader icon legend" (open)**
- **Evidence:** `src/reader/index.html:27-84` — 20 declared buttons, 12
  `hidden` by flag (Suggest, pending-suggest, Describe images,
  Transcribe, ▾, Speakers, Suggest (local), …); the only way to add a
  claim is the popover after a text selection (`entity-tagger.js:1-25`);
  the claims bar renders nothing that says so; the claim card's five
  glyphs have tooltips only (`claim-extractor.js:779-783`).
- **Claim:** a first session sees Media / Entities / 🗑 / ✕ / Publish and
  three view tabs, and nothing that says "select text to add a claim."
  Blocks: mark claims.
- **Fresh-eyes action:** the claims bar's empty state reads "Select any
  passage to add a claim or tag a person" (the Margin's zero-state line,
  `MARGIN_DESIGN.md` §4 — ship it now, in the bar); a "?" beside it
  opens the glyph legend; the five glyphs get text labels on hover-less
  devices.

### UXDE-10 · Eight errors still terminate at "see console" although a Diagnostics panel now exists
- **Harm 3 · DEFECT · Effort S · T7 "replace the eight 'see console' terminations" (open)**
- **Evidence:** `src/portal/entity-dossier-view.js:75,169`;
  `extraction-block.js:276`; `synthesis-block.js:593,594,943` ("could
  NOT be saved (see console); it will be lost on reload");
  `trace-block.js:63`; `sidepanel/index.js:1869`; the remedy:
  `options.html:625-637` Diagnostics → "Copy diagnostics".
- **Claim:** a non-technical user has no console; the one error that
  costs money (synthesis save failure) offers no Download escape.
- **Fresh-eyes action:** one shared string: "Something failed — Settings
  ▸ Diagnostics ▸ Copy has the details"; a Download-brief button on
  the synthesis failure.

### UXDE-11 · The Margin S1 (PR #370) adds a fourth presentation instead of replacing three
- **Harm 3 (opportunity cost against UXDE-01/02) · design KEEP, slice plan GRANDFATHERED · Effort M to re-cut · not in ROAD_TO_1_0**
- **Evidence:** `docs/MARGIN_DESIGN.md` §1 (correct diagnosis), §3
  ("Annotated" becomes the *default* for archived opens), §9 (S1 "bars
  untouched — purely additive"; S2 "Fold" unscheduled, its own flag,
  needs a dated kill for a list-view escape hatch), §11.2 ("temporarily
  a fourth presentation of the same records"), §10 (7 of 11 constraints
  tagged [R] pending reconciliation); PR #370 +1,872/−36 across 15
  files, 22 commits, with four guard tests and an a11y baseline in S1
  scope; briefing: maintainer "testing stuff I don't even care about."
- **Claim:** as a destination the Margin is the right reading surface
  (it *is* the answer to UXDE-03). As a slice it lands a read-only
  default view beside the editable one, keeps all seven bars, and
  defers the only change a user would feel (S2) behind a second flag
  and a second review gate. For the first hour it is a distraction; for
  the reader's second hour it is the fix.
- **Fresh-eyes action:** do not merge S1 as a fourth view. Re-cut as
  **one** change: "archived opens show the article with its notes in
  the margin; the claims + proposals bars are gone in that view." Drop
  ring chrome, page-notes as a separate lane (fold into the card
  stack), and the four guard tests to the one that matters
  (draft-leak). Sequence *after* UXDE-01 and UXDE-02, which are smaller
  and block release.

### UXDE-12 · The reader's view tabs put expert density in the primary strip and hide the read-only distinction
- **Harm 2 · GRANDFATHERED (userscript-era Markdown/Preview) · Effort S · MARGIN_UX_REVIEW E3 (accepted for S2)**
- **Evidence:** `src/reader/index.html:18-22` Reader / Markdown /
  Preview; the body is `contenteditable` (MARGIN_DESIGN §3); nothing
  says the Reader tab edits the publish draft.
- **Claim:** a first session does not know Reader is an editor; Markdown
  and Preview are expert views promoted to first paint.
- **Fresh-eyes action:** one primary strip — Read (annotated) / Edit —
  with Markdown/Preview under a "Source ▾" on the Edit view.

### UXDE-13 · "Options" and "Settings" are the same page; "Settings ▸ Workspaces" does not exist
- **Harm 2 (one instance is harm 4: lies-about-itself) · GARBAGE · Effort S · T8 one-noun rule (open)**
- **Evidence:** `options.html:5` "X-Ray — Settings"; `reader/index.js:
  653,654,3841,4064,4093,4357,4740` "Options → Advanced → LLM assist";
  `:8087` "manage cases in Settings"; `corpus-audit-block.js:86-87`
  "Options → Advanced"; `cross-workspace-view.js:85` "Settings ▸
  Workspaces" (no such tab; the section is "Cases").
- **Fresh-eyes action:** "Settings" everywhere; deep-link the strings to
  the tab (`#advanced`) instead of naming the path.

### UXDE-14 · Library residue from the viewer era: ledger vocabulary, viewer-npub lane, dossier dead ends
- **Harm 2 · GRANDFATHERED (PORTAL_DESIGN 2026-06-10) · Effort S · PORTAL_UX_REVIEW C1/PR-9 and B2/PR-10 (open); K15**
- **Evidence:** `portal/index.html:36-46` identity fold with "View
  another archive: npub1…"; `:62-67` "ledger status / Remote-only / No
  ledger"; `entity-dossier-view.js:216-217,263-278` per the review.
- **Fresh-eyes action:** finish PR-9 (one publish-state vocabulary:
  published / not yet / missing from relays) and PR-10; move the viewer
  lane under "⋯".

### UXDE-15 · Documentation is standing in for interface
- **Harm 3 · DEFECT · Effort M · B9, B13 (open); T7 screenshots (open)**
- **Evidence:** `docs/USER_GUIDE.md` 1,250 lines, 15 `[SCREENSHOT]`
  placeholders, 0 images; `docs/SMOKE_TEST.md` 178 KB / 49 sections is
  the only walk record; no in-product Help; `README.md:19` v0.7.0.
- **Claim:** every "how do I" answer is in a 1,250-line file the product
  never links. Blocks: recovery when stuck.
- **Fresh-eyes action:** per-surface "?" → the guide's anchor; the
  pre-flight sheet (UXDE-02) and welcome (UXDE-01) carry the two
  paragraphs that matter; screenshots are shot by the Playwright walk
  that already exists (`tools/smoke/ma6-walk.mjs`), not by hand.

### UXDE-16 · A key-bearing export sits beside routine exports in the entity detail
- **Harm 3 · DEFECT · Effort S · B3/B4 (closed for backups; this label survived)**
- **Evidence:** `src/sidepanel/index.js:348-352` "Export JSON | Export
  Markdown | Share case bundle (includes keys)" as three ghost buttons
  in one row.
- **Claim:** "Share" is the verb a user reaches for to give a colleague
  a file; here it is the one that leaks keys. Lies-about-itself by
  affordance.
- **Fresh-eyes action:** move key-bearing exports to Settings ▸ Your data
  under the "recovery" heading the backup section already uses; the
  sidepanel row keeps only the key-free exports.

### UXDE-17 · Judgment families are visible by default in the reader for users who have not opted into any of them
- **Harm 2 · GRANDFATHERED ("local capture is never gated — it's the product", `feature-flags.js` comments) · Effort S**
- **Evidence:** `reader/index.html:120-131` the audit bar renders
  unconditionally ("No audit imported for this capture."), the
  findings host always mounts, claim cards always carry ⚖ 🏛
  (`claim-extractor.js:779-780`) whether or not any publish flag or
  API key exists.
- **Claim:** the decision "gate publishing, never local capture" was
  about *capability*; it was read as "render every family's chrome
  always." A researcher with no API key sees "Epistemic audit" with
  nothing to do.
- **Fresh-eyes action:** one Settings switch "Advanced analysis
  (audits, findings, verdicts)" that reveals the family chrome; claim
  cards show ⚖ by default and 🏛 only with it on.

### UXDE-18 · Case-dashboard and reader copy argues with governance instead of naming the task
- **Harm 2 · GRANDFATHERED (each block written to pass its firewall review) · Effort S**
- **Evidence:** headings "grounded brief, not a verdict"
  (`synthesis-block.js:394`), "distributions, never an average"
  (`epistemics-block.js:23`), "competing answers, not a ranking"
  (screenshot), "(derived — recompute, don't trust)"
  (`dossier-block.js:12`), "the distribution, not a score"
  (`shape-block.js:32`); reader tooltip "Adjudicate this claim (atomize
  + rule)" (`claim-extractor.js:780`).
- **Claim:** a first session reads negations of things it never
  expected; the copy is written for the reviewer, not the user.
- **Fresh-eyes action:** heading = task; the governance sentence moves
  to a "?" tooltip on the heading (kept verbatim — it is good text, in
  the wrong slot).

---

## Fresh-start design

If I started X-Ray today for non-technical research groups.

### Surfaces: three
1. **Reader** (a tab): the captured article, with a *notes margin* on
   the right (the Margin, folded — one surface, typed cards). Header:
   case chip · Read / Edit · "+" (Suggest with AI ▾ — one button whose
   menu names the cost: "sends text to Anthropic" / "on this machine")
   · Publish (opens the pre-flight). Nothing else on first paint.
2. **Library** (a tab, replaces portal + sidepanel + network): tabs
   **Sources · Claims · People & orgs · Cases · From people you follow**.
   A case is a page with **Sources / Claims / Analysis**. The entity is
   one page (Overview / Connections / From the network). "Add ▾" as
   today. The relay-truth reconciliation lives under "⋯ ▸ Check relays".
3. **Settings**: **Identity · Sharing · AI · Transcription · Your data ·
   Developer**. First-run lands on Identity with the key generated.

Modals shrink from ~13 (`reader/index.js:1682-5049`: claim, finding,
others' claims, integrity, assess, adjudicate, baseline, media,
speakers, vision, evidence link, review, engine picker) to five
(claim, assess, link, AI review, media). Adjudicate / integrity /
finding / baseline become card actions inside the Advanced-analysis
families.

### One noun per concept (user-facing; code names stay)
| Concept | Noun | Never in chrome |
|---|---|---|
| a captured page | **source** | article/capture/artifact/item |
| what a source asserts | **claim** | assertion/atom/proposition |
| an AI-suggested claim | **proposal** | extraction/map artifact |
| your take on a claim | **assessment** | judgment/stance (as noun) |
| a behavioural pattern you name | **finding** | forensic/maneuver (in heading) |
| truth-family ruling | **verdict** (Advanced) | adjudication/atomize |
| people/orgs | **person / organization** | entity |
| a research question's holdings | **case** | workspace/corpus/namespace |
| all your holdings | **Library** | archive/My Archive/portal |
| relay server | **relay** (ruled 2026-08-28) | server |
| your key | **public key (npub1…)** once | npub bare |
| publish state | **published / not yet / missing from relays** | ledger/reconcile/remote-only/confirmed |
| audits, lens, hypotheses, counterfactuals | **Advanced analysis** (one switch) | epistemic/jurisdiction/dossier |

### Primary flow, six steps, each with its one affordance
1. **Capture** — toolbar icon / Ctrl-Shift-X (exists; keep).
2. **Read** — Reader, notes margin empty with "Select any passage to add
   a claim or tag a person."
3. **Mark claims** — select → popover (exists; the quality bar).
4. **Judge** — ⚖ on the claim card (exists); verdicts etc. behind
   Advanced analysis.
5. **Organize** — the case chip in the reader: "Add to case ▾ / New
   case…" (needs UXDE-06).
6. **Share** — Publish → pre-flight sheet (needs UXDE-02); or Library ▸
   case ▸ "Export shareable copy (no keys)" (exists, wrong address).

### Layer behind "Advanced" (one switch, not seven)
Epistemic audits, forensic findings/baselines, truth adjudication and
integrity, lens readings, hypothesis map, counterfactuals, corpus
epistemics, cross-coverage, known unknowns, wire scan, references,
four-axis timeline, entity keypairs and sync, NIP-07/bunker signing,
the relay read/write table, engine tuning, capture automation.

### Delete from the UI outright (route to product-manager for Art. 11)
K8 (reader Import audit JSON; the CLI pointer), K9 (case as entity
type), K15 (entity-corpus destination), the flag-key empty state, the
second Suggest button as a separate control, "Spokes graph" as a label,
Markdown/Preview as primary tabs, "Share case bundle (includes keys)"
from the entity row, the moral-lens reader bar until an editor exists
(K3 half-done: Options control gone, bar remains hidden behind flag —
fine as is).

### What I would keep that is not obvious
The per-family fence *in the model* (the Margin's §5.3), the accept
membrane, the three-way absence semantics, the delete confirm text,
the footer privacy line, the case-view claim chips, per-case section
memory, and every disclosure paragraph's *content* — relocated to the
pre-flight sheet and tooltips.

### Keeping it right
Two mechanisms, both already in the tree: (1) the Playwright walk
(`tools/smoke/ma6-walk.mjs`) runs in CI and shoots the guide's
screenshots — a surface that is not walked is a surface that rots;
(2) the ux-designer skill's one proposed guard graduates: every action
verb in a rendered string ("open … in the reader", "Bind cases … in
Settings ▸ Workspaces") must resolve to a click handler or a real tab
— `portal-string-truth.test.mjs` is the seed.

---

## Questions for the maintainer

Each with the provenance of the current rule and a recommended default.
Where the rule is an agent interpretation, it is phrased as a question,
not a ruling.

**Q-A. Is the reader "visual firewall" (bars may not share layout or
colour) your rule, or an idiom?** Provenance:
`EPISTEMIC_AUDIT_DESIGN.md:1076-1077` rule 6 (Phase 13 design, E5);
generalized per family in `reader/index.html` comments; the
questionnaire's Q1 lineage. Fact: the CSS gives every bar the same
surface colour already. *Recommended default:* keep Art. 6's data arm
(no number computed across families) and the model-level fence
(per-family cards, reserved words inside their family); retire the
layout/colour prohibition so one notes surface can exist. Amendment
tier: design-doc level, not constitutional — Art. 6 does not mention
layout.

**Q-B. Should the Margin S1 (PR #370) merge as a fourth view, or be
re-cut as the replacement for the claims + proposals bars?**
Provenance: `MARGIN_DESIGN.md` §9 slice ladder, agent-authored,
ratified 2026-08-28 in the [R]-tagged caution posture; your 2026-09
remark about testing parts you do not care about. *Recommended
default:* re-cut S1+S2 into one change (archived opens → margin, bars
gone in that view), sequenced after the first hour (UXDE-01/02).

**Q-C. Is "case" its own user-facing noun with its own creator, or an
entity of type case?** Provenance: Phase 12.5 "a case IS an entity"
(`case-view.js:6-8`); case-bound workspaces 2026-07-20; K9 ratified
2026-08-09 but unexecuted. *Recommended default:* user-facing "case" is
its own noun, created from the Library and the reader chip; entity
typing stays internal.

**Q-D. Three surfaces (Reader, Library, Settings) — fold the sidepanel
and the Network page into the Library?** Provenance: sidepanel Phase 4;
Network Phase 25 "off while the phase is in flight" (`options.html:
246-253`). *Recommended default:* yes; the sidepanel's key/sync
controls go to Settings ▸ Your data, the Network feed becomes a Library
source lane. This is the T8 seam collapse, widened by one surface.

**Q-E. Should judgment-family chrome render only after one "Advanced
analysis" switch?** Provenance: the "local capture is never gated —
it's the product" comments in `feature-flags.js` (agent-authored
rationale, applied to *rendering* rather than *capability*).
*Recommended default:* yes — one switch, default off, disclosed once.

**Q-F. Renaming: may family names be softened in chrome, given Art. 6's
linguistic arm (Q4 in the questionnaire)?** Provenance: MORAL_LENS §5.2
(Phase 16) generalized into Art. 6 (E5). *Recommended default:* keep
"assessment / finding / verdict" as the family words, but they appear
only inside their own cards; no new synonyms, so the arm is untouched.

**Q-G. Is a first-run welcome that generates the key for the user
(no "New identity…" step) acceptable?** Provenance: the Signing tab's
"Local signing is the default and recommended" banner
(`options.html:65-70`); B13. *Recommended default:* yes — generate on
install, show the public key once, put "Show nsec" under Your data.

**Q-H. Which headings may carry governance disclaimers?** Provenance:
each block's heading was written to pass its own firewall review
(Phases 13–26). *Recommended default:* headings name the task; the
disclaimer text moves verbatim into a "?" tooltip on the heading. No
principle changes; only the slot.
