# X-Ray — End-to-end smoke test

Manual walkthrough that exercises every shipped surface across
Phases 0–16 + the v0.5.x cleanup. The §0–§9 core takes ~20 minutes per
browser; a full pass through the Phase 11–16 sections is a half-day.
Run before any release tag, after any cross-cutting refactor, and
when adding a contributor.

This doc replaces the v1-era checklist that lived on issue #1.

> **Capture model (no FAB).** There is no in-page floating button or
> capture panel. Trigger capture by **clicking the toolbar icon**,
> pressing **`Ctrl/Cmd+Shift+X`**, or **right-click → "Capture this page
> with X-Ray"** — each extracts the page and opens it directly in the
> **reader**. Signing status shows on the **Settings → Signing** "Active
> method" line (not in-page); a prior capture surfaces via the reader's
> archive banner on re-capture (there is no FAB archive badge).

## Setup

```sh
git clone …
cd xray
npm install
npm run build           # produces dist/*.bundle.js (7 bundles)
npm test                # 1277/1277 should pass
```

### Chrome / Chromium / Brave / Edge

1. `chrome://extensions`
2. Enable **Developer mode** (top-right toggle).
3. **Load unpacked** → select the repo root.
4. The 🩻 X-Ray icon should appear. Pin it.

### Firefox (latest stable; 128 ESR if you can)

1. `about:debugging#/runtime/this-firefox`
2. **Load Temporary Add-on…** → pick `manifest.json` at the repo
   root.
3. Firefox unloads temporary add-ons on restart — re-load as
   needed.

### Test prereqs

Have these set up in the test browser:

- A signing identity. Pick one method up front to drive the smoke
  test from a known-good baseline:
  - **Local** (default) — Settings → Signing → **Generate new key**.
    No external dependency. Fastest path for first-time setup.
  - **NIP-07** — install [nos2x](https://github.com/fiatjaf/nos2x)
    or [Alby](https://getalby.com/) with at least one identity, then
    Settings → Signing → **NIP-07**.
  - **NSecBunker** — point at a running bunker WebSocket and click
    **Test connection**.
- For Phase 6 sync testing: a separate browser profile (Chrome
  user-data-dir or a fresh Firefox profile) so you can simulate
  "second device".

---

## Pass criteria — abbreviation key

- ✅  expected, observed, no surprises
- ⚠️  works but with a known caveat noted in `JOURNAL.md` or this doc
- ❌  bug — open a separate issue (see "Reporting" at the end)

---

## Agent-runnable subset

A subset of this checklist can be driven by a browser-aware agent
(any tool that exposes Chrome MCP-shaped APIs against Edge or
Chrome — see `docs/JOURNAL.md` 2026-04-21 entry for the proof of
concept run that established this). Useful when iterating on a
single platform handler and you want fast regression coverage
without manually clicking through.

### One-time human setup

The agent CANNOT do these. You do them once per test profile:

1. Load X-Ray unpacked at `edge://extensions` (or `chrome://extensions`).
2. Install a NIP-07 signer (nos2x or Alby) with at least one
   identity loaded.
3. Configure relays under Options.
4. Make sure the agent's MCP-helper extension is also installed in
   the same browser, and the agent has connected to it.

### What the agent CAN verify solo

For each platform handler:

1. **Navigate** to the test URL (a YouTube video, Substack post,
   X status, WordPress article, etc.).
2. **Read console** filtered by `X-Ray` — look for the init
   sequence. With Local signing selected (the default):
   ```
   [X-Ray] Starting X-Ray content script v0.5.x
   [X-Ray] Local signing identity ready: npub1…
   [X-Ray] Initialization complete
   ```
   With NIP-07 selected the third line is
   `[X-Ray] NIP-07 extension detected` instead. With NSecBunker
   selected the third line is `[X-Ray] NSecBunker connected`.
   If the line for the chosen method is absent after a tab reload,
   the bridge / connection isn't reaching the content script — file
   as a separate bug.
3. **Click** the X-Ray toolbar icon (browser-action button) to capture.
   (Or press `Ctrl/Cmd+Shift+X`.) There is no in-page button to find.
5. **Wait** 8–12 seconds for the capture pipeline to finish.
6. **Re-read console** filtered by `X-Ray` — the platform handler's
   diagnostics narrate the run. Healthy YouTube run looks like:
   ```
   [X-Ray YouTube] fetchTranscript via SW: …            ← signed-URL attempt
   [X-Ray YouTube] transcript fetch failed: PO-token…   ← expected fail
   [X-Ray YouTube] All signed-URL fetches returned empty. Falling back to DOM scrape.
   [X-Ray YouTube] fetch-hook returned no events: …    ← expected on modern UI
   [X-Ray YouTube] DOM probe before/after click + wait
   [X-Ray YouTube] found N transcript segments
   [X-Ray YouTube] extracted N events from N segments  ← 1:1 ratio = healthy
   ```
   If the segment-to-event ratio is > 3, the dedup fix has
   regressed (`docs/JOURNAL.md` 2026-04-21 entry).
7. **Take a screenshot** of the originating tab. For YouTube, the
   transcript panel should be open (the X-Ray click triggered it).
   For Twitter, the focal tweet should be highlighted. For
   Substack, no visible side-effect on the page.

### What the agent must hand off to the user

**The reader tab opens outside the MCP-managed tab group**, so the
agent can't directly verify reader contents. After the capture
pipeline completes successfully, hand off:

> "Capture pipeline completed for `<URL>`. Reader tab opened in your
> Edge window. Please verify the reader content matches expectations
> from the per-phase checklist below, then drag that tab into the
> MCP group if you'd like the agent to continue verification."

If the user does drag the reader tab into the agent's group, the
agent CAN then verify reader content via `get_page_text`, check the
banner state, click view-mode tabs, etc. — but cannot trigger
**Publish** (NIP-07 prompt requires a real user-extension click).

### Per-phase agent coverage

| Phase | Agent can verify | Needs user |
|---|---|---|
| 2 (article) | toolbar capture, content script, capture-pipeline console | Reader content, publish |
| 3a Substack | toolbar capture, capture pipeline, comment-tree extraction in console | Reader content, publish |
| 3b YouTube | Full pipeline including DOM-scrape segment count + dedup ratio | Reader content, publish |
| 3c Twitter | Capture pipeline, focal-tweet detection, console diagnostics | Reader content, publish |
| 3d generic | WordPress comment count via `_commentsSource` console hint | Reader content, publish |
| 4 entity tagger | After user-assisted reader open, can drive selection + popover via `find` and `click` | Side panel, all signing |
| 4 side panel | Extension page — opens via right-click menu / reader header / Options quick-action | Sidepanel actions, signing |
| 5 claims | Same as Phase 4 — text selection in reader is drivable; modal is testable; publish blocked | Signing |
| 6 sync | None — sidepanel + cross-device | All of it |
| 7 cache | (none — archive surfaces in the reader) | Reader's archive banner UX on revisit |
| 7 archive integrity (7.7–7.16) | Nothing. The unit tests simulate this state machine; they cannot drive it | **All of it.** Hash drift, wrong-article loads, and the empty-body publish all render correctly in the reader while being wrong on the wire — the event body is the only witness |
| Polish #2 | The init-sequence signing-method line | — |

### Suggested agent-driven loop

Quick regression script (~3 minutes per platform handler):

```text
for platform in [YouTube, Substack, X, WordPress-blog]:
    1. navigate(test_url[platform])
    2. wait 3s
    3. read_console("X-Ray", limit=10) → must see init sequence
    4. click the X-Ray toolbar icon (browser action) to capture
    5. click(ref_*)
    6. wait 10s
    7. read_console("X-Ray", limit=50) → check for completion signals
       - YouTube: "extracted N events from N segments" with ratio
       - Substack: comment-fetch success
       - Twitter: "focal tweet not found in DOM" → bug, escalate
    8. screenshot → save for the report
    9. Hand off to user: "Reader opened. Verify content + publish."
```

This gives you fast regression coverage on the parts of the test
that historically break (DOM-scrape selectors, focal-tweet
detection, init-sequence completeness) without burning human time
clicking through every URL.

---

## Phase 0 — Infrastructure

| # | Test | Pass criteria |
|---|---|---|
| 0.1 | `npm run build` exits 0 with no errors | ✅ all seven bundles emitted under `dist/` (content, background, options, sidepanel, reader, portal, api-interceptor) |
| 0.2 | `npm test` exits 0 | ✅ 1018/1018 (or current-on-main count) passing |
| 0.3 | Reload extension after a build → no console errors in the SW log | ✅ the SW log under `chrome://extensions` → "Inspect views: service worker" is clean |
| 0.4 | Click toolbar icon on a normal http page | ✅ captures the page → a reader tab opens (no popup window, no in-page panel) |
| 0.5 | Click toolbar icon on `chrome://newtab` | ✅ Options page opens (fallback, since content script can't run there) |
| 0.6 | Right-click toolbar icon | ✅ menu has Toggle Capture / Entity Browser / Settings… / Capture tips |

---

## Phase 1 — Real crypto

| # | Test | Pass criteria |
|---|---|---|
| 1.1 | `npm test -- --test-name-pattern crypto` | ✅ 13 crypto + 5 nip44 tests pass |

---

## Phase 2 — Article capture

Use any plain article page (e.g. a New York Times, Vox, or BBC
piece — anything Readability handles cleanly).

| # | Test | Pass criteria |
|---|---|---|
| 2.1 | Page loads with the X-Ray content script active | ✅ no console errors; no in-page FAB/panel injected |
| 2.2 | Click the toolbar icon → a new tab opens with the X-Ray reader | ✅ reader title + byline + body visible |
| 2.3 | Reader has three tabs: **Reader**, **Markdown**, **Preview** | ✅ all three switch without error |
| 2.4 | **Markdown** tab shows the body as markdown | ✅ recognizable headings, paragraphs, links |
| 2.5 | **Preview** tab shows the markdown re-rendered as HTML | ✅ matches the Reader tab output approximately |
| 2.6 | Edit a metadata field (title, byline, URL, published date) → blur → switch tabs → return | ✅ edit persists |
| 2.7 | Click **Publish** → signing happens via the Active method (toast says "Signing locally…" for Local, prompts a signer extension for NIP-07, talks to the bunker for NSecBunker) → toast reports per-relay results | ✅ at least one configured relay accepts |
| 2.8 | Look up the published article on a NOSTR client (e.g. snort, primal, nostr.band) by your npub → the kind-30023 should be there | ✅ event id matches the toast; pubkey matches the Active method's npub |

**URL identity — archive/mirror captures (url-identity.js; LIVE-SITE check — the archive.today DOM markers cannot be verified from tests)**

| # | Test | Pass criteria |
|---|---|---|
| 2.9 | Capture an article via a Wayback snapshot (`web.archive.org/web/<ts>/<url>`) | ✅ reader URL field shows the ORIGINAL url; the note under the byline reads "captured via web.archive.org · original: <url>" |
| 2.10 | Capture a **short-code** archive.today snapshot (`archive.ph/<code>`) | ✅ the original is recovered from the page's own markers (`input#HIDDEN_URL` / header "saved from" link) and shown in the note; if archive.today has changed its DOM, the note must degrade to "original URL not recovered" — NEVER show a wrong original (then update `archiveTodayDomOriginal`) |
| 2.11 | Publish an archive capture → inspect the event | ✅ first `r` = the original URL; one `capture-url` tag with the archive address; a second `r` with the archive address AFTER the primary |
| 2.12 | Capture an arXiv `/pdf/` link | ✅ article URL reads `arxiv.org/abs/<id>`; capture note names the pdf variant |
| 2.13 | On any capture with a provenance note, click **Set original URL…** and enter a different URL | ✅ the reader re-keys to it (URL field + note update); claims made under the OLD address still list; the archive banner finds the old capture; re-opening either address joins the same work |
| 2.14 | Capture through one of the newer mirror families (a 12ft.io/`/proxy?q=` link, an AMP-cache `*.cdn.ampproject.org/c/s/…` page, or a ghostarchive `/varchive/` video) | ✅ the original is recovered as identity and the note names the mirror host; a ghostarchive `/archive/<code>` snapshot degrades honestly to "original URL not recovered" |
| 2.15 | Publish an article whose body contains external hyperlinks → inspect the event | ✅ one `link` tag per distinct EXTERNAL target (`["link", url, anchorText?]`, document order; internal/same-host links absent); NO `cites` tags (pre-rename name); indexed `r` co-emits for the first 25 targets after the primary `r` |

---

## Phase 3 — Platform handlers

### 3a — Substack

URL: any free Substack post (e.g. `https://noahpinion.substack.com/p/<slug>`).

| # | Test | Pass criteria |
|---|---|---|
| 3a.1 | Toolbar-icon capture → reader opens with the post body | ✅ paywall-unlock works if you're signed in to Substack |
| 3a.2 | Comments section appears below the body | ✅ tree renders with avatars + handles |
| 3a.3 | Toggle "Include all N in publish" → publish → batch shows article + comments | ✅ comment count in the toast matches the tree |

### 3b — YouTube

URL: any video with auto-generated captions (e.g.
`https://www.youtube.com/watch?v=pOlZ-E7tgCQ`).

| # | Test | Pass criteria |
|---|---|---|
| 3b.1 | Toolbar-icon capture → reader opens with the video header (thumbnail + duration + chips) | ✅ thumbnail clickable, duration badge visible |
| 3b.2 | Transcript section appears as prose paragraphs | ✅ no 3× repetition (the bug fixed in `09f99ab`) |
| 3b.3 | Each paragraph starts with a clickable `[0:05]`-style timestamp | ✅ link href ends with `&t=Ns` |
| 3b.4 | Console shows `extracted N events from M segments` with `N ≈ M` (within 1.3×) | ✅ no `high segment/event ratio` warning |

### 3c — Twitter / X

URL: any status detail page (e.g.
`https://x.com/<handle>/status/<id>`).

| # | Test | Pass criteria |
|---|---|---|
| 3c.1 | Toolbar-icon capture → reader opens with the focal tweet body | ✅ title format `@handle: "first-60-chars…"` |
| 3c.2 | URL field reads `https://x.com/<handle>/status/<actual-id>` | ✅ NOT `.../status/null` (the bug fixed in `94ef0c7`) |
| 3c.3 | If multi-tweet thread by the same author: title says `(thread, N tweets)` and body has `1/N…N/N` sections | ✅ tweet ordering matches the on-page order |
| 3c.4 | Replies by other users appear as comments | ✅ comment-publish toggle works |

### 3d — Generic comments (WordPress)

URL: any WordPress blog with native comments enabled.

| # | Test | Pass criteria |
|---|---|---|
| 3d.1 | Article captures via Readability | ✅ body text is reasonable |
| 3d.2 | Comments section populated by the generic extractor | ✅ shows author + body for each top-level WP comment |

### 3d — Generic comments (Disqus)

URL: any Disqus-using page (e.g. older arstechnica.com posts —
verify the page actually shows Disqus comments inline).

| # | Test | Pass criteria |
|---|---|---|
| 3d.3 | Reader shows the **`_commentsNote`** explaining iframe-blocked | ⚠️ no comments captured (cross-origin iframe) — document only, not a regression |

---

## Phase 4 — Entity system

### Tagger

| # | Test | Pass criteria |
|---|---|---|
| 4.1 | In the reader, select text in the body | ✅ a popover appears near the selection with type buttons + search box |
| 4.2 | Click "👤" (or any type) → a new entity is created and the selection gets a colored underline | ✅ underline color matches the type |
| 4.3 | Re-select the same text → the popover's autocomplete shows the entity you just created | ✅ click it to re-tag |
| 4.3a | Tag entities (do NOT publish), close the reader, re-capture the same URL | ✅ the tags come back — entities bar populated, underlines rehydrated (the debounced tag save + reload hydration) |
| 4.3b | On a re-capture where the archive banner offers "Load archive", click it | ✅ archived tags MERGE with any tags made this session (nothing dropped) |
| 4.3c | Publish an article with tags, then portal → inspector → **Open in reader** | ✅ the read-only reconstruction shows the tagged entities (rebuilt from the event's name tags); nothing writes to the archive row |

### Side panel

| # | Test | Pass criteria |
|---|---|---|
| 4.4 | Open via the X-Ray toolbar icon header's entity-browser icon, the right-click menu's **Entity Browser**, or the Options page's **Entity Browser** quick-action | ✅ side panel slides in (Chrome) or new tab opens (Firefox fallback) |
| 4.5 | Type-filter chips work; search filters by name | ✅ entity count in the footer updates |
| 4.6 | Click an entity → detail view shows editable fields + npub + nsec (behind reveal) | ✅ Save enables only when a field changes |

### Kind-0 publishing

| # | Test | Pass criteria |
|---|---|---|
| 4.7 | Tag an entity on an article → publish | ✅ batch toast says "1 entity profile" alongside article |
| 4.8 | Look up the entity's npub on a NOSTR client | ✅ kind-0 event with the entity's name visible |
| 4.9 | Side panel detail view shows 🌐 published indicator + recent date | ✅ |

### Aliases

| # | Test | Pass criteria |
|---|---|---|
| 4.10 | Create two same-type entities (e.g. "Donald J. Trump" + "Donald Trump") | ✅ |
| 4.11 | On the alias's detail view → click "Link to…" → pick the canonical | ✅ alias chevron appears in the list |
| 4.12 | Publish an article tagging the alias | ✅ both entities' kind-0 events get published; alias's event has `refers_to` tag |

---

## Phase 5/10 — Claims (thin model)

| # | Test | Pass criteria |
|---|---|---|
| 5.1 | Select text → entity popover → click "📋 Add as claim" | ✅ claim modal opens with text pre-filled |
| 5.2 | Pick **About** entities, optionally "who said it" + ⭐ key, save | ✅ claim card appears in the claims bar; selection gets dashed colored underline (exact passage, not first occurrence) |
| 5.2a | Select a SPOKEN sentence → popover → **"❝ Quote"** → the modal opens as **"Capture quote"** with the speaker picker FIRST (entity mode preselected, hint "The speaker is what makes this a quote") → pick e.g. W.H.O. → save | ✅ toast "Quote saved"; the claims bar renders the row **speaker-first** ("W.H.O. — “…”" on the quote line; no separate "Per …" line); the record is an ordinary claim (edit/link/assess/adjudicate all work) and it appears in the evidence pickers speaker-first |
| 5.2b | On an article whose **Author** field matches an entity you already have (e.g. byline "World Health Organization" with the W.H.O. org entity in the registry) → Add as claim | ✅ "Who said it" opens in ENTITY mode with the author entity **preselected** as the speaker pill; saving with no changes records the author as the asserter |
| 5.2c | On an article whose author has NO entity yet → Add as claim | ✅ "Who said it" opens in entity mode with the author name **prefilled in the search** and a **"New as: 👤 🏢 📍 🔷 🗂️"** row; one click on the right type creates the entity and selects it (same row appears in the About picker when a search has no match — the "tag from the article body first" dead end is gone) |
| 5.2d | LLM assist → accept a suggested claim on an article whose author entity exists | ✅ the accepted claim's row shows the author as its source ("Per …"/speaker-first); on an article with no author entity the accepted claim has no source (bulk accept never creates entities) |
| 5.3 | Click ✎ on a claim → edit a field → save | ✅ card updates |
| 5.4 | Click 🔗 on a claim → link modal opens (see 11.x for the cross-source flow) | ✅ pick target + relationship + (optional) note → save |
| 5.5 | Both linked claims show the link block | ✅ relationship label correct; ↔ for contradicts/duplicates, →/← otherwise |
| 5.6 | Publish | ✅ batch toast names: article + N claims + M relationships + (entity profiles for any new entities referenced) — **no evidence links** (kind 30043 retired in Phase 11) |
| 5.7 | Look up your published article on a NOSTR client → its `p` tags should include each tagged entity's pubkey | ✅ |

---

## Phase 11 — Assessments, contradictions & cases

The "Community Notes for the internet" loop, end to end on a real
story. Use a real case (e.g. two YouTube videos from opposing sides).
Everything here is **local-first** — no relay publish is involved
except where marked, and assessment/link publishing stays off until
the `assessmentPublishing` flag ships.

**Setup: the case entity**

| # | Test | Pass criteria |
|---|---|---|
| 11.1 | Side panel → ➕ → type chips include 🗂️ **Case** → create "My test case" | ✅ case entity appears in the list; 🗂️ chip filters to it |
| 11.2 | Open its detail view | ✅ sections present: *Your claims about this entity* (empty hint), *Claims about this entity* (Load button), *⚠ Inconsistencies* (empty hint), **Export case** (JSON + Markdown buttons — case entities only) |

**Capture + assess (reader)**

| # | Test | Pass criteria |
|---|---|---|
| 11.3 | Capture page 1 → select a quote → "Add as claim" → About = the case entity (+ a person) → save | ✅ claim row in the bar |
| 11.4 | Add a second claim on the same page | ✅ the About picker **pre-fills the last-used entities** (sticky session default) |
| 11.5 | Click **⚖** on a claim → stance **Disagree** → labels `misleading` + `fallacy/strawman` → note on `misleading` → rationale → Save | ✅ button shows ⚖✓; row shows the 👎 stance chip + label badges |
| 11.6 | Re-open ⚖ → click the active stance to clear → Save | ✅ badges show labels only (label-only assessment is valid) |
| 11.7 | In the assess modal, add a custom label "my made up label" | ✅ normalizes to `my-made-up-label`, renders with the dashed *custom* style |
| 11.8 | Select a label → **📍** → modal minimizes to the pill → select a passage in the article → Done | ✅ label badge gains 📍; re-opening shows ✓ on the mark button |
| 11.9 | ⚖ → **Remove** | ✅ badges disappear; button back to plain ⚖ |
| 11.10 | 🌐 **Others' claims** → any foreign claim → ⚖ → judge it | ✅ badges render on the foreign card; if the "foreign" claim is actually yours, the claims bar badge updates too after closing the modal |

**Cross-source contradiction (reader)**

| # | Test | Pass criteria |
|---|---|---|
| 11.11 | Capture page 2 (different site/video) → add a claim contradicting page 1's claim, About = same case | ✅ |
| 11.12 | 🔗 on it → candidate list shows **claims from page 1** (📋) and any assessed-foreign claims (⚖) with hostnames; search box filters | ✅ |
| 11.13 | Pick page 1's claim → relationship **Contradicts** (default) → note → Save | ✅ both claims' rows show the **⚠ badge**; link row highlighted, ↔ arrow, other endpoint shows text + source host |
| 11.14 | Create the same link from the other claim's 🔗 in the opposite direction | ✅ no duplicate — the existing link is returned (symmetric identity) |

**Case dashboard (side panel)**

| # | Test | Pass criteria |
|---|---|---|
| 11.15 | Open the case entity | ✅ *Your claims* lists every claim about it with stance chips + label badges; ⚖ Assess works here too |
| 11.16 | *⚠ Inconsistencies* | ✅ the contradiction pair renders: both quotes, source hosts, your note; **label tally** on top (e.g. `2× misleading`) |
| 11.17 | Assess/link something in the reader while the panel is open | ✅ the dashboard refreshes live (storage listener) |
| 11.18 | **Load from relays** (needs the case published/p-tagged or returns the empty hint) | ✅ rows render with badges + ⚖; republished claims appear **once** (latest-wins dedupe) |

**Export**

| # | Test | Pass criteria |
|---|---|---|
| 11.19 | **Export JSON** | ✅ `xray-case-<name>-<date>.json` downloads: case header, claims (incl. the foreign endpoint with its snapshot), per-label notes/anchors/`suggested_by`, contradictions with embedded endpoint texts, `label_counts` |
| 11.20 | **Export Markdown** | ✅ readable report: claims grouped by stance, labels + notes per claim, *Inconsistencies* pairing the quotes, label tally |
| 11.21 | Re-export without changing anything | ✅ identical content (deterministic set — viewed-only network claims are excluded) |

**Regression guards (flag OFF — the default)**

| # | Test | Pass criteria |
|---|---|---|
| 11.22 | With the publish toggle **off**, publish an article with claims | ✅ batch summary names article + claims + relationships, but **no assessment / mirror / claim-link events** |
| 11.23 | Delete a claim that has an assessment + links | ✅ confirm lists the blast radius; assessment and links are removed with it |
| 11.24 | Settings → Advanced → Experimental shows **"Publish assessments & claim links"**, **unchecked** by default | ✅ the toggle exists and is off (`xray:flags` → `assessmentPublishing` absent/false) |

---

## Phase 11b — Publishing judgments + case collaboration

The follow-up slices: putting your judgments on the wire (flag-gated) and
sharing a case so a collaborator's claims aggregate with yours.

**Enable + publish (reader)**

| # | Test | Pass criteria |
|---|---|---|
| 11b.1 | Settings → Advanced → Experimental → check **"Publish assessments & claim links to relays"** → Save | ✅ persists across an Options reload; the copy warns judgments become public |
| 11b.2 | On a case you've assessed (stance + labels) and linked, hit **Publish** in the reader | ✅ a second toast announces the judgment sub-batch; summary lists `N assessments` (+ `label mirrors` + `claim links`); progress bar completes |
| 11b.3 | Re-publish the same article with no changes | ✅ judgments are **not** re-emitted (only fresh/edited ones publish) |
| 11b.4 | Edit an assessment's stance → Publish again | ✅ that one assessment re-emits (replaces by `d`); its **🌐** badge stays |
| 11b.5 | A published assessment's row | ✅ shows a **🌐** badge alongside the stance/label badges |
| 11b.6 | Inspect a published kind-30054 on a NOSTR client / relay explorer | ✅ carries `a`=claim coord, `stance`, `l` labels under `xray/assessment`, and the claim's `r` URL **as captured** (tracking params intact — matches the 30040's `r`) |
| 11b.7 | A labeled assessment's kind-1985 mirror | ✅ present once; carries `L`/`l` + `a` + `r`, and **no `p`** (it must not label the claim's author) |

**Case collaboration (two installs, or two browser profiles)**

| # | Test | Pass criteria |
|---|---|---|
| 11b.8 | On the case entity → **Share case bundle (includes keys)** → confirm the warning | ✅ `xray-case-bundle-<name>-<date>.json` downloads; toast reports N entities, M with keys |
| 11b.9 | On the **second** install: entity list → **Import** → pick the bundle | ✅ toast reports added / updated / keys installed |
| 11b.10 | Compare an entity's **npub** on both installs (detail view) | ✅ **identical** — the collaboration property |
| 11b.11 | On the second install, capture a page and tag a claim about the shared case → Publish (flag on) → on the first install open the case → **Load from relays** | ✅ the collaborator's claim appears in *Claims about this entity* (same `#p`) |
| 11b.12 | Independently create a case with the same name on both installs, then import the other's bundle | ✅ import reports a **key conflict**, keeps your existing key, and still imports the non-conflicting entities |
| 11b.13 | Options → Advanced → **Erase all** → reopen Options | ✅ the publish toggle is back to **off** (flags cleared with everything else) |

---

## Publish completeness — journal + rebroadcast + unpublished inventory

| # | Test | Pass criteria |
|---|---|---|
| PC.1 | Publish an article with claims/judgments, then open the portal reconcile panel | ✅ every published event appears in the journal (DevTools → IndexedDB → `xray-events` → row count matches the publish summary); "Unpublished local artifacts" lists any never-published records itemized by type, not a bare count |
| PC.2 | Disable all relays but one dead one → publish → re-enable | ✅ nothing marks published (no confirmed OK); the summary reports unconfirmed/failed rather than success; re-clicking Publish re-emits everything |
| PC.3 | On a "missing from relays" reconcile row, click **Rebroadcast** | ✅ the journaled signed event re-sends verbatim (no signer prompt) and the row reports "N relays confirmed"; a pre-journal publish shows the honest "re-publish from the reader" message instead |

## Full backup & restore

| # | Test | Pass criteria |
|---|---|---|
| BK.1 | Options ▸ Advanced ▸ Full backup: the source-documents checkbox | ✅ checked by default; the label shows a size estimate (document count + approximate file size with/without bytes) |
| BK.2 | **Download full backup**, open the file | ✅ `"format": "xray-backup/1"`; contains your settings, identities (nsec present — by design), archive articles, audit runs, and the `xray-events` journal; the string from Options ▸ LLM key appears **nowhere** in the file |
| BK.3 | Capture one more article, change a setting, then **Restore from backup…** with the BK.2 file | ✅ typed RESTORE confirmation required; a safety backup downloads first; after the reload the extra article and setting change are gone (replace-all), the backup's contents are back, and the LLM key still works |
| BK.4 | Restore a backup that included a captured PDF | ✅ the source document reopens from the archive byte-identical (reader renders it; no "bytes missing") |
| BK.5 | **Export signed-events bundle** after publishing anything | ✅ `xray-events-bundle-<date>.json` downloads with `"format": "xray-events-bundle/1"`; every event has `id` + `sig`; with an empty journal the button reports "Journal is empty" instead of writing an empty file |

## Phase 12 — "My Archive" portal

The read-back surface (docs/PORTAL_DESIGN.md). Best run on a profile
that has already published a case or two: claims, comments,
assessments, a cross-video `contradicts` link, entities, a couple of
captured articles (the Phase 11/11b walkthrough leaves exactly this
behind). The portal is **read-only** — nothing here publishes,
deletes, or writes the local publish ledger.

**Open + identity**

| # | Test | Pass criteria |
|---|---|---|
| 12.1 | Toolbar right-click → **Open My Archive** (also: Options header → **My Archive**, side panel header → **Archive**) | ✅ full-tab portal opens from all three; relay list in the footer + the privacy note ("Relays can see that request") |
| 12.2 | Header identity chips | ✅ your pubkey(s) render with provenance tags (`signer` / `sync-key` / `publish-history` / `manual`); entity-keys chip shows the count, hover lists names |
| 12.3 | Paste a second npub → **Add identity** | ✅ chip appears tagged `manual` with a ✕; ✕ removes it |
| 12.4 | (NIP-07 profile with no history) open the portal | ✅ honest empty state explains NIP-07 can't answer here and points to the npub field — no silent blank |

**Corpus + Library**

| # | Test | Pass criteria |
|---|---|---|
| 12.5 | First open | ✅ status walks resolve → query → "N item(s)"; list renders newest-first with kind chips |
| 12.6 | Close and reopen the portal | ✅ items render **instantly from cache**, then "refreshing…" then "+N new" (or no change) |
| 12.7 | Type tabs | ✅ counts per type; clicking filters; Articles / Claims / Comments / Assessments / Links / Entities / Cases / Accounts / Other |
| 12.8 | **Search** a person's name | ✅ claims/comments/entities mentioning them filter live; tab counts follow |
| 12.9 | Facets | ✅ platform / source domain / case / ledger-status selects filter; "Group by source" renders domain headers; an event published by another client wears a `via <client>` badge but is **not hidden**; >200 rows reveal incrementally via **Show more** |
| 12.10 | Publish something new (reader) → portal **↻ Refresh** | ✅ status reports `+1 new`; the item appears |
| 12.11 | **Full resync** | ✅ cache drops and rebuilds to the same state |

**Timeline**

| # | Test | Pass criteria |
|---|---|---|
| 12.12 | Density strip above the list | ✅ capture sessions show as spikes; gaps stay visible |
| 12.13 | Drag across a spike | ✅ list filters to the brushed range; chip shows it; ✕ clears |

**Graph + case (the acceptance walk)**

| # | Test | Pass criteria |
|---|---|---|
| 12.14 | An entity row → **✳ Spokes** | ✅ radial ego graph: claims ring the focus; co-tagged people/orgs; containing cases; linked accounts |
| 12.15 | Claim nodes | ✅ assessed claims tint by stance (red/green/amber); hover shows label count |
| 12.16 | The `contradicts` link | ✅ ⚠ dashed red edge between the two claims; if the counterpart claim belongs to another entity it renders as a **ghost node** — never hidden |
| 12.17 | Click a co-tagged entity node | ✅ graph refocuses on it |
| 12.18 | Locate box + pan/zoom | ✅ typing pulses the first match; drag pans; wheel zooms |
| 12.19 | More than 24 claims → "+K more" node | ✅ clicking expands the sector |
| 12.20 | A case badge or case row → **☰ Dashboard** | ✅ artifact rollup by type, density strip, member chips (click → spokes), claims with stance + ⚠ contradicted badges |

**Inspector + reconciliation**

| # | Test | Pass criteria |
|---|---|---|
| 12.21 | Click any row title | ✅ drawer: coordinate, event id, author, **relays holding it**, ledger status, raw signed JSON |
| 12.22 | **Copy raw event** | ✅ clipboard gets the JSON ("Copied ✓") |
| 12.23 | An article row → **Open in reader** | ✅ the capture reconstructs from its signed event and opens read-only in the reader |
| 12.24 | Reconciliation line above the list | ✅ "Local ledger says N published; the relays confirm M…" — counts agree with reality |
| 12.25 | Publish to a relay, then remove that relay from Settings → portal **Full resync** | ✅ the item moves to **missing**; the panel lists it with its event id |
| 12.26 | Query a pubkey you've published with from another device | ✅ those items render fully with the **◌ remote-only** chip — informational, not an error |
| 12.27 | After all of the above, check the side panel / reader / options | ✅ untouched — the portal wrote nothing (no markPublished changes, no new local claims/entities) |

**Firefox**

| # | Test | Pass criteria |
|---|---|---|
| 12.28 | Repeat 12.1, 12.5–12.7, 12.14, 12.21 on Firefox ≥128 | ✅ identical behavior (the portal is plain SVG/IDB/`chrome.*`-polyfilled APIs) |

---

## Phase 13 — Epistemic audits

The audit pipeline (docs/EPISTEMIC_AUDIT_DESIGN.md, normative
constitution docs/PHILOSOPHY.md). Needs one captured article and the
companion scorer CLI (`docs/auditor-prototype/scorer/` — an Anthropic
API key and a few cents per run). Publishing is **off by default**;
everything before 13.13 below must work with the flag off.

**Setup: score an article**

| # | Test | Pass criteria |
|---|---|---|
| 13.1 | Capture an article (any platform) → reader | ✅ the metadata header shows the `hash:` line (16-hex prefix); no "content changed" banner on a fresh capture |
| 13.2 | Run the scorer CLI against the captured markdown → JSON output | ✅ JSON carries `article.hash` equal to the reader's hash line prefix (full hash in the file) |
| 13.3 | Edit one character of the article body markdown → rerun the scorer | ✅ different hash — the audit is text-bound, not URL-bound |

**Import (the RQ1 gate)**

| # | Test | Pass criteria |
|---|---|---|
| 13.4 | Options ▸ Advanced ▸ Epistemic audits → import the JSON | ✅ summary toast: modules valid/failed, predictions imported/skipped; re-import of the same file reports already-imported, never duplicates |
| 13.5 | Import a JSON whose `article.hash` matches **no local capture** | ✅ refused with a clear error — audits must be about text you actually captured |
| 13.6 | Hand-edit the JSON body or hash → import | ✅ refused (re-hash mismatch); tamper with one module's top-level `score` so it diverges from `findings.score` → that module imports as **failed**, the rest survive |
| 13.7 | Reader → the same article → audit panel | ✅ aggregate badge with score **and** confidence; binding ceiling shows its provenance; per-module rows expand with caveats; evidence quotes click-to-locate in the body |

**Run audit — the in-extension LLM path (needs `llmAssist` on + an API key; see Phase 14.5 setup)**

| # | Test | Pass criteria |
|---|---|---|
| 13.7a | `llmAssist` **off** → reader audit bar | ✅ **no** "Run audit" button (only "Import audit JSON…") — no network call is reachable |
| 13.7b | Enable `llmAssist` + save a key (Settings ▸ Advanced ▸ LLM assist), reopen the reader | ✅ "Run audit" appears enabled; with the flag on but **no** key it is **disabled** with a key hint |
| 13.7c | Click **Quick audit** on a fresh capture | ✅ button shows "⏳ Auditing…", then a summary toast (modules valid/failed, predictions); the audit panel fills exactly as an imported run does |
| 13.7d | Expand the module rows | ✅ each carries the standing **"single-shot orchestration — lower rigor"** caveat; auditor reads `model · anthropic/<model>`; the aggregate's ceiling-source is `heuristic:source-quality/1.0` |
| 13.7e | Edit one character of the body → **Quick audit** again | ✅ binds to the edited text's hash (no capture-mismatch error); the prior run stays side-by-side, **never averaged** |
| 13.7f | Click **Thorough audit** → confirm the cost prompt | ✅ both audit buttons disable during the run; the active button counts up "⏳ Auditing N/8…" as modules land; on completion the toast says "thorough"; module rows do **not** carry the single-shot caveat (per-dimension methodology); a module whose call fails shows as **failed**, the rest still produce an aggregate |
| 13.7g | Start **Thorough audit**, then kill the run mid-flight (close the reader tab at ~4/8, or evict the SW via `chrome://serviceworker-internals`) → reopen the reader on the same capture | ✅ the audit panel shows the draft note ("a thorough audit draft holds N/8 completed modules"); clicking **Thorough audit** offers **Resume** and re-runs only the missing modules — completed modules are never re-billed |
| 13.7h | **Quick audit** on a long article (a slow ~1–2 min call) with the reader left idle | ✅ the run completes and renders (the 20s keepalive ping holds the SW); if no response ever arrives, the button restores by itself at ~5.5 min with a service-worker-restart error toast — it can never stick on "⏳ Auditing…" |

**Display rules (PHILOSOPHY — check, don't skip)**

| # | Test | Pass criteria |
|---|---|---|
| 13.8 | Any score chip, reader or portal | ✅ **no naked numbers**: score always renders beside its confidence; aggregate confidence < 0.6 renders as "needs human review" with **no** number and no band color |
| 13.9 | Two runs on one article (rerun the scorer, import both) | ✅ side-by-side, **never averaged**; each keeps its auditor + run time |
| 13.10 | Edit the article body in the reader after import | ✅ the hash line flips to "edited, recomputed at publish" and the audit panel header changes to "for the CAPTURED text — the body has been edited"; after publish, the panel marks the run as anchored to the prior text — scores never transfer across edits |

**Prediction ledger + atomization (RQ6)**

| # | Test | Pass criteria |
|---|---|---|
| 13.11 | Audit panel → prediction rows | ✅ each shows text, hedge, horizon, criteria; **Atomize as claim** is an offered action, never automatic |
| 13.12 | Atomize one prediction → claims bar | ✅ a 30040 claim appears carrying the prediction's text; the ledger row shows the promotion link |

**Publish batch (flag-gated — slice 13.8)**

| # | Test | Pass criteria |
|---|---|---|
| 13.13 | With the flag **off** (default), publish the article | ✅ no audit events in the summary; no events of kinds 30056–30061 reach relays (verify in the portal raw corpus). Exception by design: a claim atomized from a prediction still carries its `a` lineage tag pointing at the future 30058 coordinate — addressable references tolerate the referent arriving when the flag turns on |
| 13.14 | Options ▸ Advanced → enable **Publish audit events to relays** | ✅ the disclosure states the per-article scope and public visibility; toggle persists across reloads |
| 13.15 | Publish the article again | ✅ summary line gains `N/M audit events`; the portal corpus holds the 30056s, the 30057 (its `a` contributions resolve to the 30056 coordinates), and the 30058s; the atomized prediction's 30058 carries the `a` back-reference to its claim at the claim's **published** address |
| 13.16 | Publish a second time without changes | ✅ everything audit-shaped reports as skipped (`already published`) — resume never duplicates |
| 13.17 | Disable every write relay → publish → re-enable → publish | ✅ first attempt counts failures honestly (warning toast); second attempt publishes exactly the events that failed — per-event marks, no duplicates |
| 13.18 | Check any published 30056/30057/30058/30059 raw JSON | ✅ carries `x` (article hash) + auditor tags; **never** `stance`, `rating-value`, `L`, or `l` — the audit/assessment firewall |

**Portal surfaces + resolutions**

| # | Test | Pass criteria |
|---|---|---|
| 13.19 | Portal → the audited article's card | ✅ audit chip (score + confidence) joined **by hash**; a pre-hash (URL-joined) event would wear an explicit "URL match — text unverified" marker |
| 13.20 | Article row → inspector | ✅ audit section lists every run (published and local-only marked), module rows, dispute lineage when present |
| 13.21 | An entity with audited articles → entity view | ✅ **Audit dossier** block: shrunk mean with k/factor/population stated in line; per-hedge calibration rate table; calibration-v1 marked informational; sub-0.6 runs counted as "pending review", excluded from the rollup |
| 13.22 | Timeline → predictions-due strip → **Resolve…** | ✅ evidence-bound form (refuses without evidence); filing updates the strip immediately; the resolution publishes with the **next publish of that article** (13.8 batch) as a 30059 referencing the prediction's coordinate |
| 13.23 | Reconciliation line after publishing audits | ✅ audit events count toward "ledger says N / relays confirm M"; removing the relay and resyncing moves them to **missing**, like every other ledgered kind |

**Firefox**

| # | Test | Pass criteria |
|---|---|---|
| 13.24 | Repeat 13.4, 13.7, 13.15, 13.19 on Firefox ≥128 | ✅ identical behavior |

---

## Phase 14 — Forensic findings (behavioral-pattern layer)

The criminology layer (`docs/CRIMINOLOGY_DESIGN.md`): name the
*maneuvers* a subject performs around the truth, evidence-anchored, with
**no verdict on intent**. Local-first; publishing stays off until the
`forensicPublishing` flag is enabled (14.4 portal surfaces not yet
built). The bar lives in the reader **under the claims bar and the
Epistemic-audit bar** — three separate, firewalled blocks.

**Capture + name a finding (reader)**

| # | Test | Pass criteria |
|---|---|---|
| 14.1 | Capture a page with named people making arguments (a debate/op-ed). Below the claims bar, find the **"Forensic findings"** section | ✅ empty-state prompt: "…name a maneuver and bind it to evidence. No verdicts — structure only, with a required counter-read." |
| 14.2 | Select a person's name in the article → entity tagger → create/tag them as an entity (this becomes a selectable subject) | ✅ entity mark renders |
| 14.3 | Select an offending span → in the tagger popover click **🔎 Mark finding** (or scroll to the Forensic findings section → **+ Finding**) | ✅ modal "Name a maneuver" opens; the selected span is pre-filled as **Evidence step 1** |
| 14.4 | In the modal: pick the **Subject** (your tagged entity) + a **Role** (apologist/critic/…); pick a **Maneuver** from the grouped picker | ✅ the guide block shows the maneuver's **definition + source citation + "Would make it NOT this:"** counter-indicators |
| 14.5 | Confirm there is **no stance / score / confidence control** anywhere in the modal | ✅ none exists (the whole point) |
| 14.6 | **+ evidence step** → 📍 → modal minimizes → select a second span → Done | ✅ a Step 2 row appears with the marked span; the badge later shows `·2` |
| 14.7 | Fill **Basis** (`quoted`/…), an optional **Note**, leave **Counter-note blank**, Save | ✅ **blocked**: "A counter-note is required — give the alternative / exonerating reading." |
| 14.8 | Clear the maneuver, Save | ✅ blocked: "Pick a maneuver." |
| 14.9 | Clear all evidence quotes, Save | ✅ blocked: "Add at least one evidence step with a quote." |
| 14.10 | Fill the counter-note → Save | ✅ a finding row appears: subject label + **maneuver/role/basis badges** + the lead quote |
| 14.11 | **Set baseline…** → pick the subject → descriptive register note → Save | ✅ toast "Baseline saved" (no score field anywhere) |
| 14.12 | ✎ edit the finding → change note/basis/role → Save; then 🗑 delete | ✅ edits persist; delete confirms and removes the row |
| 14.13 | Reload the reader tab on the same URL | ✅ the finding reappears (matched to the article by its evidence-anchor source URL) |
| 14.14 | DevTools console: `chrome.storage.local.get(['behavioral_findings','forensic_baselines'], console.log)` | ✅ records carry `subject_ref`, `role`, `maneuver`, ordered `anchors[]`, `counter_note`, `basis`, `suggested_by` — and **no** `stance`/`intent`/`confidence`/`lying` field |

**Publish (flag-gated)**

| # | Test | Pass criteria |
|---|---|---|
| 14.15 | Settings → Advanced → Experimental: confirm **"Publish forensic findings"** is **unchecked** by default (`xray:flags` → `forensicPublishing` absent/false) | ✅ off by default |
| 14.16 | With the flag **off**, Publish the article | ✅ summary names article/claims/etc. but **no `30062` / forensic-mirror / revision events** |
| 14.17 | A finding whose subject is **only a label/handle** (not a tagged keyed entity) | ✅ does **not** publish even with the flag on — it waits for entity linking (the subject has no pubkey) |
| 14.18 | Enable **`forensicPublishing`** → Publish on an article whose finding's subject **is** a tagged entity | ✅ a forensic sub-batch toast; summary lists `N findings` (+ `finding mirrors`) (+ `revision edges` if any); the finding row gains a **🌐** badge |
| 14.19 | Re-publish with no changes | ✅ findings are **not** re-emitted (only fresh/edited; staleness gate) |
| 14.20 | Inspect the published **kind-30062** on a relay explorer | ✅ carries `p`=subject (slot-4 `subject`), `l`=maneuver under **`xray/forensic`**, `role`, ordered `maneuver-step` tags, `basis`, and content = note + `### Counter-read`. **The firewall:** no `stance`, no `rating-value`, no `xray/assessment` label |
| 14.21 | The finding's **kind-1985 mirror** | ✅ present once; `L`/`l` `xray/forensic` + `p`=subject + `r`; no `score`, no intent |
| 14.22 | (If you created a `revision/*` edge between two published claims) inspect the **kind-30055** | ✅ `relationship` = `narrative-patch`/`recharacterizes`/`walks-back`, directional (source = earlier statement) |

**Portal (14.4)**

| # | Test | Pass criteria |
|---|---|---|
| 14.23 | Open the portal → **Library** → the **Findings** facet | ✅ published findings list with subject + maneuver; click one → inspector shows the maneuver, the evidence chain, and the **counter-read** (no score) |
| 14.24 | Open the subject's **entity view** (the person you tagged) | ✅ a **Forensic findings** block beside the audit dossier, with a lens selector |
| 14.25 | Toggle the four lenses — **Evidentiary / Executive / Survivor / Editor** | ✅ same findings, different renders: full evidence + counter-reads / a maneuver tally + one-liners / plain-language with the fair counter-read / a prose draft. **Never a score, never averaged** |
| 14.26 | Reconciliation line after publishing a finding | ✅ the `30062` counts toward "ledger says N / relays confirm M"; removing the relay + resyncing moves it to **missing** |

**Firefox**

| # | Test | Pass criteria |
|---|---|---|
| 14.27 | Repeat 14.3, 14.7, 14.18, 14.25 on Firefox ≥128 | ✅ identical behavior |

---

## Phase 14.5 — LLM assist (in-extension suggestions)

A user-invoked pass that asks Anthropic's Claude to **propose** capture
artifacts for review. Which artifact types it proposes is configurable
(Options → Advanced → LLM assist), defaulting to **Entities + Claims**;
relationships, assessments, and forensic findings are opt-in. Two consent
gates: the `llmAssist` flag (off by default) **and** a user-supplied API
key. Every item is a draft — nothing saves without Accept, nothing
publishes. Requires a real Anthropic API key
(`docs/PHASE_14_5_LLM_ASSIST_KICKOFF.md`).

**Gating (no key / no flag = no calls)**

| # | Test | Pass criteria |
|---|---|---|
| 14.5.1 | Fresh profile, flag off. Open a captured article in the reader | ✅ **no "✨ Suggest…" button** in the chrome; with DevTools Network open, no request to `api.anthropic.com` is possible |
| 14.5.2 | Settings → Advanced → **LLM assist**: confirm the toggle is **unchecked** and "No key saved yet." | ✅ default off, no key |
| 14.5.3 | Check **Enable LLM-assisted suggestions**, leave the key blank, Save → reopen the reader | ✅ the **✨ Suggest…** button is present but **disabled**, tooltip points to the key field; still zero network |
| 14.5.4 | Paste an Anthropic key + pick a **Model**, Save. Confirm the key field clears and status reads "A key is saved." | ✅ key stored; reader's Suggest button now **enabled** |
| 14.5.4b | In **Suggest these artifact types**, confirm the defaults | ✅ **Entities + Claims checked**, Relationships / Assessments / Forensic findings **unchecked** |

**Run a pass + review**

| # | Test | Pass criteria |
|---|---|---|
| 14.5.5 | On an op-ed / debate with named people, click **✨ Suggest…** (defaults) | ✅ button shows "✨ Thinking…", then a **Suggestions** modal opens with **only Entities + Claims** sections (no Assessments / Relationships / Findings); a model badge shows the model id |
| 14.5.5b | Enable **Forensic findings** in Options, Save, re-run a pass | ✅ the modal now also shows a Findings section (and Baselines/Revisions if any) — opt-in kinds appear only once enabled |
| 14.5.6 | Inspect a **Claim** proposal | ✅ summary shows the claim text + the about-entities it links, the **quote it is drawn from**, and a **⚓ grounding chip** (verbatim / typography normalized / close match %); Accept / Edit / Reject buttons |
| 14.5.6b | Inspect an **Entity** proposal | ✅ shows name · type, the **verbatim mention** with its ⚓ chip; if a same-type entity with a token-matching name already exists, a **"≈ may already exist"** select offers *Use existing* (defaulted when there is exactly one candidate) |
| 14.5.6c | Accept an entity, then `chrome.storage.local` + the article: | ✅ *Use existing* links (no duplicate id minted, row notes "Linked to existing"); either way the article gains the entity ref with the **grounded mention as context** (the mention span highlights in the body) |
| 14.5.7 | Inspect a **Finding** proposal | ✅ shows subject + maneuver + role/basis + a quoted lead + the **counter-read** (`↔ …`); **no stance/score/confidence anywhere** |
| 14.5.8 | **Accept** an entity, then its claim, then a finding (or click **Accept all valid**) | ✅ rows flip to "✓ accepted"; the **claims bar** and **Forensic findings bar** gain the artifacts |
| 14.5.8b | Scroll down the suggestions list, Accept a row mid-list | ✅ the list **stays where you were** — no jump back to the top |
| 14.5.8c | Click a section header's **"Accept all entities (N)"** button | ✅ only that section's valid rows accept (claims/assessments untouched); the count reflects what a click can actually do; dependency-blocked rows in an accepted section show why |
| 14.5.8d | After accepting entities, check above the claims bar | ✅ an **Entities bar** lists each tagged entity as a chip (icon + name + type, mention in the tooltip); clicking a chip scrolls to the mention in the body (mark pulses, or the mention text is selected); manual tagger tags appear there too |
| 14.5.9 | DevTools: `chrome.storage.local.get(['article_claims','behavioral_findings','entities'], console.log)` | ✅ accepted records carry `suggested_by: "llm:<model>"`; accepted claims carry a first-class `quote` (the article's own text) and, when the body wasn't edited, an `article_hash`; the finding has `counter_note`, `anchors[].quote`, and **no** `stance`/`intent`/`score` field |
| 14.5.10 | Click a claim's tagged passage / a finding's evidence in the article body | ✅ the LLM's verbatim quote resolved to a real anchor (the span highlights / jumps) |
| 14.5.10b | In the **claims bar**, each accepted claim shows its **verbatim quote** (italic block under the claim text; PDF captures add a `p. N` pill). Click the quote or the claim text | ✅ the article scrolls to the passage — the rehydrated mark pulses, or the quote text gets selected; a claim whose passage no longer exists shows a clear "could not locate" toast |

**The firewall + Edit/Reject**

| # | Test | Pass criteria |
|---|---|---|
| 14.5.11 | If the model returned a finding with a missing/empty counter-note (or no quoted anchor), find its row | ✅ shows **"✗ …counter-note / anchor"** rejected-with-reason, Accept **disabled** — it can never save in that state |
| 14.5.12 | **Edit** a finding row → clear the **Counter-read** → Apply | ✅ the row re-validates to ✗ rejected (Accept disabled) |
| 14.5.13 | **Edit** a claim's text → Apply | ✅ the row gains a **"✎ edited (you)"** badge; on Accept the stored claim is `suggested_by: "user"` (honest provenance) |
| 14.5.13b | **Edit** a claim's **quote** to text that is NOT in the article → Apply | ✅ the row re-validates to **"✗ Quote not found in the article…"**, its chip reads **⚓ not found**, and Accept is disabled (Accept-all skips it) |
| 14.5.13c | Fix that quote back to real article text (or paste a curly-quote/em-dash variant of it) → Apply | ✅ chip returns to **⚓ verbatim** (or *typography normalized*), the message "Quote re-checked against the article." shows, provenance **stays** `llm:<model>` (quote-only edits don't flip it); on Accept the stored anchor's `exact` is the **article's own text**, and a repaired claim carries `anchor_provenance` with the proposed quote it was located from |
| 14.5.14 | **Reject** a proposal | ✅ row dims to "✕ rejected"; nothing is stored for it |
| 14.5.15 | Publishing is unaffected: with `assessmentPublishing` / `forensicPublishing` **off**, Publish | ✅ accepted LLM artifacts are **not** published (suggestion never publishes) |

**Secret hygiene + errors**

| # | Test | Pass criteria |
|---|---|---|
| 14.5.16 | Export entities / a case bundle (Options → Keypair registry / case export) | ✅ the export JSON contains **no** `xray:llm:key` and no key value |
| 14.5.17 | With debug logging on, run a pass | ✅ console logs counts/model only — **never** the API key |
| 14.5.18 | Temporarily set a bad key, run a pass | ✅ a clear toast ("the key was rejected (401/403)…"), no crash |
| 14.5.19 | Options → Advanced → **Clear key**, then **Erase all** | ✅ "Key cleared."; after erase-all, `chrome.storage.local.get('xray:llm:key', console.log)` is empty and the flag is reset |

**Firefox**

| # | Test | Pass criteria |
|---|---|---|
| 14.5.20 | Repeat 14.5.4, 14.5.5, 14.5.8, 14.5.11 on Firefox ≥128 | ✅ identical behavior (the fetch runs in the SW; `anthropic-dangerous-direct-browser-access` header is sent) |

---

## Phase 18 — Complex content (tables, math, PDFs)

**Tables & math (C1)**

| # | Test | Pass criteria |
|---|---|---|
| 18.1 | Capture a page with a complex table (rowspan/colspan or a caption — e.g. a Wikipedia comparison table) | ✅ the reader renders the table as a real table (not mangled pipes); the markdown pane shows it fenced in `<!--xr:island:table-->` with sanitized HTML |
| 18.2 | Capture a page with a simple 2×2 grid table | ✅ it stays a GFM pipe table (no island) |
| 18.3 | Capture a page with KaTeX or MathJax math (e.g. a technical blog) | ✅ markdown carries `$…$` / `$$…$$` TeX (KaTeX/MathJax-v2) or a `math` island (MathJax-v3/MathML) — never rendered glyph soup |
| 18.4 | Publish 18.1's article, then reconstruct it from the relay (portal) | ✅ the island renders identically; hand-editing the fenced markdown to contain `<script>` renders as ESCAPED text, never as markup |

**PDF capture (C3/C4)**

| # | Test | Pass criteria |
|---|---|---|
| 18.5 | Open a text PDF (e.g. an arXiv paper PDF) in a tab, click the X-Ray toolbar icon | ✅ the reader opens on the `?pdf=` path and shows extracted markdown — headings, paragraphs, two-column papers in correct reading order (left column before right) |
| 18.6 | DevTools on the reader: inspect `state.article.extraction` | ✅ `{ method: "pdfjs-…", source_hash: <64-hex>, page_count, archived: true }`; the `source_documents` IndexedDB store holds the original bytes under that hash |
| 18.6b | Capture a PDF with SOME scanned pages (or a form-heavy/glyph-shredded one) | ✅ a **⚠️ Extraction quality** banner above the article names the affected pages ("little or no text layer… content is missing" / "short fragments… verify quotes"), cites the `source_hash`, and dismisses; a clean text PDF shows no banner (and `extraction.warnings` is absent) |
| 18.7 | Select a sentence in the PDF capture → Add as claim → Accept, then inspect the claim's `anchor` | ✅ the selector array includes `{"type":"FragmentSelector","value":"page=N"}` with the right page |
| 18.8 | Click the toolbar icon on a scanned (image-only) PDF | ✅ a clear error explains there is no text layer (LLM transcription is designed, not built) — no junk capture is created |
| 18.9 | Load a PDF behind a login where refetch fails (or use `?pdf=import`) | ✅ the Import-file picker appears; picking the saved PDF captures it (URL provenance retained when known) |
| 18.10 | Repeat 18.5 on Firefox ≥128 | ✅ identical behavior (routing normalizes Firefox's viewer URL; extraction runs in the reader page) |
| 18.12 | Capture a figure-bearing PDF (e.g. a paper with charts/photos) | ✅ figures appear in the article inline, roughly where they sit on the page, with a caption or `Figure (page N)` alt; `state.article.extraction.figures` is the count; the `source_documents` store holds each figure as a PNG keyed by its sha256, and the markdown carries `![alt](xray-figure:<sha256>)` refs |
| 18.13 | Capture a PDF whose image-only page has NO text layer | ✅ the page's image is captured and shown, and that page is **not** listed in the `sparse-pages` warning (its content was captured); a page with neither text nor figure still is |
| 18.14 | With Signing = **Local**, publish a PDF capture (article + a claim) | ✅ publish succeeds end-to-end (no "Session record missing"); with Signing = NIP-07 the error says to switch to Local/NSecBunker for PDF captures |
| 18.15 | Right-click a PDF tab → **Capture this page with X-Ray** | ✅ the PDF reader opens (same as the toolbar icon) — not the Settings page |
| 18.16 | Open a local `file:///…/doc.pdf` tab → toolbar icon | ✅ the reader opens on the Import-file picker (`?pdf=import`); picking the file captures it and the archive row's URL is `file:///imported/<hash16>/…` (two different files named alike don't collide) |
| 18.17 | Open `https://…/real.pdf?file=<url-encoded other PDF>` → toolbar icon | ✅ the capture is of **real.pdf** (check `state.article.url`), never the `file=` target |
| 18.18 | Capture a two-column LaTeX/IEEE paper (10–18pt gutter) with a figure in the right column | ✅ reading order is left column then right; the figure appears within the right column's text, not at the top of the page |
| 18.19 | Capture a PDF containing a `/Rotate 90` (landscape) page with text | ✅ the rotated page's text reads as real lines in visual order — not jammed/interleaved fragments; a claim quoted from that page grounds and carries the right page anchor |
| 18.20 | On **Chrome**, capture a PDF whose figures are JPEG photographs (most scanned-photo reports) | ✅ the photos are captured as figures (pre-fix: Chrome's ImageDecoder hands back a `VideoFrame` and every JPEG figure was dropped); `extraction.figures` ≥ 1 |
| 18.21 | On **Firefox ESR 128–133**, capture any PDF | ✅ capture works at all (pdf.js calls `Promise.try` in its worker RPC; without the shim the first `getDocument` throws and nothing loads) |
| 18.22 | Toolbar-capture a PDF link carrying a fragment (`…/paper.pdf#page=3`) and separately the bare URL | ✅ both open the same capture identity — `state.article.url` has no `#page=…`, one archive row, one d-tag |
| 18.23 | Capture a figure-bearing PDF, tag one entity in the body, switch to Markdown view and back to Reader | ✅ figures still render (pre-fix: the view round-trip revoked their blob URLs and they broke permanently) |
| 18.24 | Capture a PDF whose paragraphs are numbered (a filing: "14. …", "15. …"), publish WITHOUT editing | ✅ the published 30023 body carries the original numbers and matches `state.article.markdown` byte-for-byte (no "1." renumbering, no escape backslashes); the reader body shows the real numbers |
| 18.25 | Publish a PDF capture, close the tab, re-open the same `?pdf=` URL and click "Load archive" | ✅ the body renders as an article (not raw markdown text); figures render; claims still get page anchors |
| 18.26 | Capture a CJK (Japanese/Chinese) PDF | ✅ text extracts (pre-fix: zero text and a false "likely a scan" refusal — predefined CMaps now ship in `dist/cmaps/`) |
| 18.27 | Capture a PDF with JBIG2/JPEG2000 images (archival scan with a text layer) | ✅ such figures decode and archive (wasm decoders now ship in `dist/wasm/`) |
| 18.28 | Capture `https://arxiv.org/pdf/<id>` directly (no .pdf suffix) | ✅ the capture carries `state.article.scholar.arxiv_id` and the published 30023 gains the `arxiv`/`i` tags — identity no longer depends on capturing the abs page |
| 18.29 | On **Edge**, open any PDF tab → toolbar icon | ✅ the PDF reader opens (Edge's viewer hosts content scripts, so the sendMessage-failure fallback never fires there — pre-fix the toast said "Could not extract an article from this page") |
| 18.30 | Open a PDF in **Google Drive's preview** (`drive.google.com/file/d/…/view`) → toolbar icon | ✅ the PDF reader opens on the DOCUMENT (real title, all pages, pageMap) — not an HTML scrape of the viewer titled "Page N of M" with line-per-paragraph text; a Drive preview of a non-PDF file still captures as a normal page |
| 18.31 | Capture a PDF with an evidence/results **table** (3+ columns) | ✅ each row reads left-to-right on one line (`label · value · value`) with row↔value links intact — not every label in one paragraph followed by a scrambled column of numbers; prose around the table still flows |

**Scholarly metadata (C2)**

| # | Test | Pass criteria |
|---|---|---|
| 18.11 | Capture a journal-article page (or arXiv abs page) and publish | ✅ `state.article.scholar` carries `doi`/`arxiv_id`/authors; the 30023 gains `['doi', …]`, `['i','doi:…']`, and/or `['arxiv', …]` tags; a plain blog capture gains none |

## Phase 15 — Truth adjudication (15.1–15.10)

Rows 15.1–15.13 are the **model console walk** (slices 15.1–15.3 have no
UI of their own); rows 15.14–15.20 are the **reader click-through**
(slice 15.8 + the publish path); rows 15.21+ cover the integrity/entity
layers (integrity authoring got its 🤝 modal in 15.10; the console walk
remains the canonical row set). Dynamic `import()` is banned in the service
worker — use the **options page** (right-click toolbar icon → Options →
F12). On Firefox: `about:debugging` → X-Ray → **Inspect**, with the
options page open.

Paste each numbered block as a unit. Every `create` is idempotent, so
re-running after a page reload converges on the same records.

**15.A — setup (paste once per page load):**

```js
const { TruthAdjudicationModel, VerdictModel, verdictVariance } =
    await import('/src/shared/truth-adjudication-model.js');
const { attestProposition, convergenceForProposition } =
    await import('/src/shared/truth-attestation.js');
const { ClaimModel } = await import('/src/shared/claim-model.js');
const { EvidenceLinker } = await import('/src/shared/evidence-linker.js');

const claim = await ClaimModel.create({
    text: 'The senator voted against the bill on March 3.',
    source_url: 'https://example.com/article' });
const prop = await TruthAdjudicationModel.create({
    claim_id: claim.id, proposition_class: 'event-fact',
    resolution_criteria: { criteria: 'The official roll-call record.' },
    subject_role: 'enacted' });
```

| # | Test | Pass criteria |
|---|---|---|
| 15.1 | 15.A, then `prop` | ✅ record has `proposition_class`, `resolution_criteria.horizon: 'already-determinable'`, `subject_role: 'enacted'`; no verdict/score field |
| 15.2 | `await TruthAdjudicationModel.create({ claim_id: 'claim_doesnotexist00', proposition_class: 'event-fact', resolution_criteria: { criteria: 'x' } })` | ❌ throws `Claim not found` — the atomization gate |
| 15.3 | `await TruthAdjudicationModel.create({ claim_id: claim.id, proposition_class: 'prediction', resolution_criteria: { criteria: 'x' } })` | ❌ throws `requires a resolution horizon` |
| 15.4 | `await TruthAdjudicationModel.create({ claim_id: claim.id, proposition_class: 'state-fact', resolution_criteria: { criteria: 'x' }, occurred_at: 1614729600 })` | ❌ throws `no false precision` (occurred_at demands occurred_precision) |
| 15.5 | Attest 3 sources: `rollCall` (tier-1, `origin_key: 'congress-roll-call-71'`), then two claims both on `origin_key: 'ap-wire'` — first with an `independence_note`, second with casing `'AP-Wire'` — plus one `'anon-blog'` claim with **no** note; then `await convergenceForProposition(prop.id)` | ✅ `total_attestations: 4, origin_count: 3, independent_count: 2, undemonstrated: ['anon-blog']`; `origin_groups` lists every link id + note (the derivation) |
| 15.6 | `await EvidenceLinker.create({ source_claim_id: <any>, target_claim_id: claim.id, relationship: 'contradicts', attestation: { tier: 'tier-1', origin_key: 'x' } })` | ❌ throws `only valid on a supports link` |
| 15.7 | `const verdict = await VerdictModel.create({ proposition_id: prop.id, verdict: 'established-true', evidence_for: [{ quote: 'Roll-call 71: Nay.', tier: 'tier-1' }], caveats: ['Could not verify a later motion.'] })` | ✅ `standard_of_proof: 'preponderance'` (defaulted per class AND declared); no score/confidence field |
| 15.8 | Create a `stated-value` proposition on `claim`, then rule on it | ❌ `VerdictModel.create` throws `not adjudicable as true/false` — the §3.1 firewall; the *proposition* create succeeds (recording is legal, ruling is not) |
| 15.9 | `await VerdictModel.create({ proposition_id: prop.id, verdict: 'established-true', evidence_for: [{ quote: 'x' }], caveats: [] })` | ❌ throws — caveats are mandatory |
| 15.10 | `await VerdictModel.create({ proposition_id: prop.id, verdict: 'contested', evidence_for: [{ quote: 'x' }], caveats: ['y'] })` | ❌ throws `BOTH ways` — contested needs both sides |
| 15.11 | Supersede: `const v2 = await VerdictModel.create({ proposition_id: prop.id, supersedes: verdict.id, verdict: 'contested', evidence_for: [{ quote: 'Roll-call 71: Nay.' }], evidence_against: [{ quote: 'Amended record shows a revote.' }], caveats: ['Conflicting records.'] })`, then `await VerdictModel.get(verdict.id)` | ✅ old record: `superseded_by: v2.id` and **nothing else changed**; `getActiveForProposition(prop.id)` returns `v2` |
| 15.12 | `typeof VerdictModel.update` | ✅ `'undefined'` — append-only by construction |
| 15.13 | `verdictVariance([{ verdict: 'established-true' }, { verdict: 'contested' }])` | ✅ per-state counts, `unanimous: false`; **no** consensus/score/mean field exists on the result |

**Reader UI (15.8) — no console needed.** Capture any article, add a
claim via the normal claim flow, then:

| # | Test | Pass criteria |
|---|---|---|
| 15.14 | Claims bar → the claim row shows a **🏛** action | ✅ button present beside ⚖; tooltip "Adjudicate this claim" |
| 15.15 | 🏛 → pick **Event fact**, criteria "the official record", role **Enacted**, ruling **Insufficient evidence**, caveats one line → Save | ✅ toast "Ruled: insufficient-evidence"; the row gains a `📋 Event fact · ∅ Insufficient evidence` badge; 🏛 becomes 🏛✓ |
| 15.16 | 🏛 again, same class | ✅ fields load the existing proposition; the banner shows the **active ruling** and Save reads "Save superseding ruling" |
| 15.17 | Save a new ruling (e.g. **Established true** with one cited evidence-for claim + a caveat) | ✅ toast "…(supersedes prior ruling)"; badge updates; re-open shows the new active ruling |
| 15.17a | Evidence for → **+ cite** → the picker lists every captured claim/quote across ALL articles (📋 local / ⚖ assessed-foreign; search filters by text, quote, speaker, url — the list VISIBLY narrows as you type and restores on clear); pick a local claim from ANOTHER article, then + cite again and pick an assessed-foreign one | ✅ each picked row renders origin icon + speaker-first label ("W.H.O. — “…”" when the claim has a speaker) + host + tier select + a why-note input; there is NO quote box and NO URL field — evidence that isn't captured yet can't be typed in (the empty picker says to capture it as a claim/quote first) |
| 15.17b | Publish (flag on), then inspect the raw 30063 in the portal | ✅ each `evidence-for` tag carries the linked claim's verbatim quote, the tier, the claim's source url, and — if the cited local claim is published — its 30040 coordinate in the coord slot (otherwise empty until next publish); the inspector renders the url as a link and the coordinate as a copyable chip |
| 15.18 | Pick **Stated value** or **Interpretation** as the class | ✅ the ruling section is replaced by the 🔥 firewall explainer; Save reads "Save proposition"; the badge reads "not truth-adjudicable" |
| 15.19 | Ruling with **no caveats**, or **Contested** with one-sided evidence, or a **Prediction** with no horizon | ❌ the modal surfaces the model's error inline; nothing saves |
| 15.20 | Options → Advanced → **Truth adjudication** → check "Publish adjudicated verdicts…" → Save → reader **Publish** | ✅ after the claim publishes, "Also publishing adjudications…" toast; summary gains `n/n verdict` + mirror segments; second publish re-emits nothing (staleness gate); unchecking the toggle removes the adjudication segment entirely |

**Integrity + entity record (15.4/15.5) — console walk** (the 🤝
integrity modal shipped in 15.10; these console rows remain the
canonical model-level checks). In the options-page console, after 15.A:

| # | Test | Pass criteria |
|---|---|---|
| 15.21 | Create a word (stated-commitment, role `stated`) and a deed (event-fact, role `enacted`) whose claims share an `about` entity, then `IntegrityModel.create({word_proposition_id, deed_proposition_ids, match: 'broken', evidence_for: [{quote: '…'}], caveats: ['…']})` (import from `/src/shared/integrity-model.js`) | ✅ record with `standard_of_proof: 'clear-and-convincing'` (defaulted), `entity_ids` = the shared entity; no intent/score field |
| 15.22 | Same create with `match: 'contradicted'` on the commitment word, or with an `ascribed` word | ❌ throws (per-word-class vocabulary; by-construction exclusion) |
| 15.23 | `gap: { cause: 'lie', note: '' }` | ❌ throws "must be documented" — intent is never inferred |
| 15.24 | `await IntegrityModel.timelineForEntity('<entity id>')` | ✅ chain heads ordered on the deeds' occurred_at, undated last |
| 15.25 | `const { entityIntegrityRecord, declaredCoverage, optionalRollup } = await import('/src/shared/truth-entity-record.js')`; `optionalRollup(await entityIntegrityRecord('<entity id>'))` | ✅ `null` — no aggregate without declared coverage |
| 15.26 | Re-run with `{ coverage: declaredCoverage({assessed_count: 1, universe_estimate: 10, method: 'smoke fixture'}) }` | ✅ rollup counts + a sentence carrying "high-standard", the 1/10 coverage, and the method |
| 15.27 | 30064 publish leg: with the flag on and the word/deed claims + a keyed entity published, Publish | ✅ summary shows `n/n integrity finding`; second publish re-emits nothing |

**Read-back (15.9)** — needs published adjudications (rows 15.20/15.27):

| # | Test | Pass criteria |
|---|---|---|
| 15.28 | My Archive → fetch → Library | ✅ **Verdicts** / **Integrity** facets appear; published rulings list as `Verdict — <state>` / `Integrity — <match>`; clicking opens the inspector with evidence, standard, caveats, disclosure, and any precedent citations on the face |
| 15.29 | My Archive → Reconcile | ✅ published verdicts/findings reconcile (in ledger & on relays); an unpublished chain head shows in the local-only counts; a superseded ruling never does |
| 15.30 | Portal → entity view for the finding's subject | ✅ the **Integrity record** block renders: dimension counts beside their lists, the timeline ordered on deed event-time, calibration/corrections lines; declaring coverage (assessed/universe/method) unlocks the rollup sentence; without it the rollup line stays "no aggregate" |
| 15.31 | Reader → 🏛 on the published claim → **Others' rulings** | ✅ fetches foreign 30063s for the selected class; shows each ruling + the spread ("disagreement is data"), never a consensus number; malformed rulings (the read-side adequacy nulls) simply don't appear |

**Authoring UI (15.10)** — replaces the 15.21-series console steps
when preferred:

| # | Test | Pass criteria |
|---|---|---|
| 15.32 | Claims bar → **🤝 Integrity…** | ✅ modal lists only word-eligible propositions (stated commitments/values); picking one filters deeds to enacted facts sharing its entity; match chips match the word class |
| 15.33 | Rule a `broken` match with a caveat; reopen with the same word+deeds | ✅ saved via toast; reopening shows the active match and "Save superseding finding" |
| 15.34 | Gap: cause `constraint` with no pick, or any cause with no note | ❌ inline error (documented-only; constraint needs its corroborated action-fact) |
| 15.35 | 🔗 link flow → relationship **supports** | ✅ the attestation fields appear (tier / origin key / independence note); filling an origin key saves attestation metadata; the adjudicate modal for the target's proposition then shows the convergence line ("N demonstrated-independent origin(s) of M …") |

**Operator disciplines (v1)** — §2 defenses that ship as practice, not
mechanism; follow them until tooling lands: seek **kept** commitments as
hard as broken ones (balance-sheet symmetry — an entity record that only
ever accretes `broken` is a selection-bias smell, not a finding); fill
the ruling's **Disclosure** field whenever you have a relevant interest
(adjudicator exposure); **bootstrap on high-knowability propositions**
(court records, official rolls) before reputationally heavy ones; and if
your verdicts never discomfort your own camp, treat your calibration as
broken and audit your selection.

**15.B — cleanup:**

```js
chrome.storage.local.remove(['adjudicable_propositions', 'adjudicated_verdicts', 'integrity_findings']);
await EvidenceLinker.deleteForClaim(claim.id);
// then ClaimModel.delete(...) for each test claim created above.
// Only blanket-remove 'article_claims'/'evidence_links' on a disposable
// profile — real captures share those keys.
```

---

## Phase 16 — Moral lens (lens-readings, 16.1–16.4)

Rows 16.1–16.9 are **keyless** (registry authoring + gating negatives +
the code-enforced pre-flight refusals — no network is reachable from any
of them); rows 16.10+ need a **real Anthropic API key** and spend real
tokens — run them on a **short op-ed with a cheap model** (Options →
Advanced → LLM assist → Model). Dynamic `import()` is banned in the
service worker — use the **options page** console (right-click toolbar
icon → Options → F12). On Firefox: `about:debugging` → X-Ray →
**Inspect**, with the options page open.

Paste each numbered block as a unit. Jurisdiction `create` throws on an
id collision — re-running after a page reload is a no-op error, not
divergence (delete via 16.B first if re-seeding).

**16.A — setup (paste once per page load):**

```js
const { JurisdictionModel, treatAsLiving, admissibleAuthorities } =
    await import('/src/shared/jurisdiction-model.js');
const { lensPreflightRefusal } = await import('/src/shared/lens-engine.js');
const { ClaimModel } = await import('/src/shared/claim-model.js');

// A worldview lens with pluralism encoded (Appendix A.2 template).
const christianity = await JurisdictionModel.create({
    jurisdiction_type: 'worldview',
    display_name: 'Christianity (multi-tradition)',
    internal_divisions: ['Catholic social teaching', 'Reformed'],
    corpus_provenance: { curated_by: 'me', selection_basis: 'texts the target essay itself invokes' },
    corpus: [{
        citation: { work: 'Bible (NRSV)', edition: 'NRSV Updated Edition, 2021',
                    locator: 'Matthew 20:25-28', tradition: 'shared', language: 'en' },
        excerpt: 'whoever wishes to be first among you must be your slave',
        admissibility: 'published-scripture' }] });

// A living persona with ONLY a social capture loaded — the guardrail bait.
const living = await JurisdictionModel.create({
    jurisdiction_type: 'persona', display_name: 'Living Author',
    is_living_person: true,
    corpus: [{ citation: { work: 'x.com post', locator: 'status/123' },
               excerpt: 'a tweet', admissibility: 'social-capture' }] });

// A persona whose living bit was never set — must be TREATED as living.
const unknownBit = await JurisdictionModel.create({
    jurisdiction_type: 'persona', display_name: 'Unknown Author' });
```

**Registry + guardrails (16.1 — all console, all keyless):**

| # | Test | Pass criteria |
|---|---|---|
| 16.1 | `await JurisdictionModel.list()` | ✅ three records; `christianity.id === 'christianity-multi-tradition'` (slug ids); codified/worldview rows have `is_living_person: null` and NO entity/keypair anywhere |
| 16.2 | `await JurisdictionModel.create({ jurisdiction_type: 'worldview', display_name: 'X', entity_id: 'entity_abc' })` | ❌ throws `entity_id is persona-only` |
| 16.3 | `await JurisdictionModel.addAuthority(christianity.id, { citation: { work: 'W', locator: 'L' }, excerpt: 'a'.repeat(501), admissibility: 'published-book' })` | ❌ throws `exceeds 500 characters … never silently truncated` |
| 16.4 | `treatAsLiving(unknownBit)` / `treatAsLiving(christianity)` | ✅ `true` (absent bit fails closed) / `false` (never applies to a worldview) |
| 16.5 | `admissibleAuthorities(living)` | ✅ `[]` — the social capture is inadmissible for a living persona |
| 16.6 | `lensPreflightRefusal(living)` / `lensPreflightRefusal(unknownBit)` | ✅ `{ code: 'living-person-ungrounded', … }` both — refused in code, before any network call |
| 16.7 | `chrome.storage.local.get('lens_jurisdictions', console.log)` | ✅ the registry map, id→record — a plain local registry; no kind-0, no relay traffic |

**Gating negatives (reader + options — keyless):**

| # | Test | Pass criteria |
|---|---|---|
| 16.8 | `moralLens` flag OFF (default): capture any page → reader | ✅ **no lens UI anywhere** (the whole "Lens readings" section is absent); Options → Advanced shows the Moral lens block with its consent copy stating the article text **plus jurisdiction definitions and authority excerpts** are sent |
| 16.8b | Enable Moral lens in Options (no API key saved) → re-open reader | ✅ section appears; **Run lens reading…** disabled with the "Set an Anthropic API key" hint — flag-on/keyless means no call is reachable |
| 16.8c | Key saved but `llmAssist` OFF | ✅ lens control fully live — the two flags are independent gates; Suggest/audit buttons stay hidden |
| 16.9 | With flag+key on: Run → pick ONLY `Living Author` + any claim → Run reading | ✅ cost confirm states **1 API call**; the card renders **refused pre-flight** with the living-person message; devtools Network shows **zero** api.anthropic.com requests |

**Keyed rows (real key, short op-ed, cheap model):**

| # | Test | Pass criteria |
|---|---|---|
| 16.10 | Capture a short op-ed; capture 2–3 claims incl. one factual (e.g. a dated vote); Run lens → pick `christianity` + all claims; type the factual claim as **Factual** | ✅ confirm names the call count; per-jurisdiction card renders with readings — **structure asserted, never specific dispositions** (the pass is nondeterministic) |
| 16.11 | Every confidence chip | ✅ carries "fidelity, not truth" + the full §5.1 note on hover — on EVERY chip |
| 16.12 | The factual claim's row | ✅ "deferred to truth layer" badge + a corpus-stance descriptor (asserts/denies/silent) — **never** a disposition; 🏛 opens the adjudicate modal on that claim |
| 16.13 | A claim the corpus can't address | ✅ reads `silent` (never a guess) with recommended sources in the grounding report |
| 16.14 | Panel composition block | ✅ empaneled list + selection basis (or "not stated"); running ONLY a hostile lens produces the ⚠ one-sided-panel symmetry flag |
| 16.15 | Grounding report | ✅ grounded/inference-only counts; single-work multi-vocal corpus shows the §5.3 thin-representation flag |
| 16.16 | Derived-only guarantees, after a successful run | ✅ `chrome.storage.local.get(null, o => console.log(Object.keys(o)))` shows **no new keys** vs before the run; publish summary has **no lens segment**; `chrome.storage.session.get(null, console.log)` shows the `xray:lensread:<id>` cache |
| 16.17 | Close the reader tab mid-run → re-capture the page → reader | ✅ dropped results are gone (the confirm warned about this); re-opening the SAME capture id within the session re-renders the cached panel with **no** new API call |
| 16.18 | Bad key (edit the saved key to garbage) → Run | ✅ per-jurisdiction card fails with the 401/403 message pointing at Options; the rest of the panel still completes |
| 16.19 | Oversized target (a very long capture, >120k chars) → Run | ✅ the grounding report carries the truncation flag — never silent |
| 16.20 | Long panel (4+ jurisdictions) with the SW devtools open | ✅ each per-jurisdiction call arrives as its own message (SW log); the worker survives the whole run; partial failures render failed-with-reason while the rest complete |
| 16.21 | Repeat 16.8, 16.9, 16.12 on Firefox ≥128 | ✅ identical behavior (the background page is an event page there, not a service worker) |

**16.B — cleanup:**

```js
chrome.storage.local.remove(['lens_jurisdictions']);
// The session cache (xray:lensread:*) dies with the browser session on
// its own. Then ClaimModel.delete(...) for any test claims created.
```

---

## Identity & workspace (profiles + fresh-workspace reset)

All keyless. Settings ▸ Signing (Local method selected) + Settings ▸
Advanced ▸ Workspace.

| # | Test | Pass criteria |
|---|---|---|
| IW.1 | Signing ▸ Identity → **New identity…** → label "Epistack" → Generate & switch | ✅ Active line shows **Epistack** + a fresh npub; profile row appears marked ACTIVE; "Active method" line shows the new npub |
| IW.2 | With a pre-existing unlabeled key active, **Save current as profile…** → "Personal" | ✅ row appears; Active line switches from "unsaved identity" to **Personal**; the save button disappears |
| IW.3 | **Use** on the other profile | ✅ active row swaps; status warns that existing records keep their old stamps and points at Start fresh workspace |
| IW.4 | **Remove** on the ACTIVE profile's row | ✅ no Remove button is offered on the active row at all |
| IW.5 | **Import nsec…** with a known nsec + label | ✅ imports, saves, switches; same npub as the key's origin |
| IW.6 | Advanced ▸ **Download backup (JSON)** | ✅ file downloads; contains `identity_profiles` and content stores; does **not** contain `xray:llm:key` |
| IW.7 | Advanced ▸ **Start fresh workspace…** → type `RESET` | ✅ backup auto-downloads first; entities/claims/links/assessments/findings/adjudications/platform accounts empty; side panel and portal show empty state after reload; saved identities + relays + flags + LLM key intact |
| IW.8 | After IW.7, capture any page and publish | ✅ publishes under the new npub; portal (after refresh) attributes nothing to it from before the reset |
| IW.9 | Portal header | ✅ input reads "View another archive…"; **Identity settings** button opens the Options page; pasted viewer npubs are gone after IW.7 (they're workspace content) |

---

## Phase 6 — Entity sync

Run on **Device A** (your normal profile) and **Device B** (a
fresh browser profile). Both must have the X-Ray extension loaded
and at least one entity tagged on Device A.

| # | Test | Pass criteria |
|---|---|---|
| 6.1 | Open side panel → expand **🔒 Sync across devices** → "Generate new" or paste an existing nsec → Save identity | ✅ npub appears in the header; nsec reveal works |
| 6.2 | Click **⬆ Push** | ✅ log shows "Pushed N, skipped 0, failed 0" |
| 6.3 | Immediately click **⬇ Pull** | ✅ log shows "Added 0, updated 0, unchanged N" — the same-device idempotency check |
| 6.4 | On Device B: copy the nsec from Device A's reveal → paste into Device B's side panel → Save → **⬇ Pull** | ✅ Device B's entity browser now lists the same entities as Device A |
| 6.5 | On Device B: edit one entity's name → Push → on Device A: Pull | ✅ Device A's entry updates (last-write-wins on `updated`) |
| 6.6 | Click **Clear remote** (NIP-09) | ✅ log shows N delete batches published; subsequent pull fetches 0 |

---

## Phase 7 — Archive reader

### Cache + archive banner

| # | Test | Pass criteria |
|---|---|---|
| 7.1 | Open any article via the toolbar icon → reader opens, capture is cached | ✅ |
| 7.2 | Close the reader, navigate away, then re-capture the original URL | ✅ the reader's archive banner offers the cached copy |
| 7.3 | DevTools → Application → IndexedDB → `xray-archive` → `articles` | ✅ entry exists for the URL hash |

### Paywall fallback

URL: any article behind a paywall you've previously published from
inside (so a relay copy exists).

| # | Test | Pass criteria |
|---|---|---|
| 7.4 | Visit the paywalled URL fresh → toolbar-icon capture → reader | ✅ banner above the body offers either "📦 Your archive (date)" OR "🌐 Relay archive by npub…" |
| 7.5 | Click "Load archive" | ✅ body swaps to the longer cached/relay copy; toast confirms |
| 7.6 | Click "Keep capture" instead | ✅ banner dismisses; current capture stays |

### Archive integrity (the 2026-07-17 stack — MUST be walked by hand)

Everything above checks that the body *swaps*. None of it checks that it
swapped to the **right** body, or that the hash survived. All four bugs
below shipped undetected past a green suite, and every fix was verified by
**simulating** the reader (`tests/archive-reload-hash.test.mjs` replays the
state machine) — nothing here has been driven in a real browser. Walk it
after any change to `archive-draft.js`, `loadArchivedArticle`,
`adoptArticle`, or the publish body assembly.

Prereq: an article you have **published**, whose body contains characters
turndown escapes — `5 * 3`, `that_is_it`, `[1]`, a line starting `14.`.
Plain prose round-trips cleanly and will pass against the bug.

| # | Test | Pass criteria |
|---|---|---|
| 7.7 | Re-capture the published URL. Note the "content hash" line under the body. Click **Load archive**, then **Publish** again with no edits. Compare the hash line before and after | ✅ **identical**. A changed hash means the reload→republish drift is back; it forks every audit anchored to this article, and the new event REPLACES the old at the same NIP-33 coordinate |
| 7.8 | Repeat 7.7 three more times on the same article | ✅ the hash never moves. Drift is exponential (escape backslashes n → 2n+1), so a second cycle makes it obvious |
| 7.9 | Load archive → tag **one entity** → Publish | ✅ hash unchanged. Tagging is text-neutral; the span never reaches the wire |
| 7.10 | Load archive → fix a typo in the **title** (not the body) → Publish | ✅ **body** hash unchanged |
| 7.11 | Load archive → open the **Markdown** tab, look, switch back → Publish | ✅ hash unchanged, and the Markdown tab shows **markdown** (not HTML) |
| 7.12 | Load archive → **Media** button → attach a transcript → Publish | ✅ the published body is **NOT empty** and contains both the transcript and the original text. ⚠️ This is the one that nearly shipped an empty kind-30023 (`x` = `e3b0c442…` = sha256 of "") **over the real article** — check the event body, not just the reader, which paints correctly either way |
| 7.13 | Load archive → genuinely **edit the body** → Publish | ✅ the hash **does** change. The fix must not suppress real edits — that is a different article |
| 7.14 | Capture article **A** that links to article **B**, publish A. Then visit **B** (never captured) and capture it | ✅ the banner does **NOT** offer A's body under B's URL. Publishing an article co-emits indexed `r` tags for its first 25 outbound links, so B's archive probe matches A; with no published capture of B, A is the only candidate and wins silently (`altCount: 0`, no "N versions" tell) |
| 7.15 | Re-capture any published, unedited article | ✅ the archive banner does **not** appear. It used to fire ~100% falsely on every published article, every visit — it compared raw HTML across two substrates that can never match |
| 7.16 | Options → Advanced → Archive banner → `always` (the default), then repeat 7.15 | ✅ still silent. `always` must mean "when it actually differs", not "always" |

---

## Cross-cutting polish

### Signing methods + active-method line

| # | Test | Pass criteria |
|---|---|---|
| S.1 | Fresh profile → first time opening Settings → Signing tab | ✅ first-run banner asks the user to pick a method |
| S.2 | Pick **Local** → Generate new key → **Save** | ✅ npub appears in the Active method line at the top of the tab |
| S.3 | Switch to **NIP-07** (with nos2x or Alby installed) → Save | ✅ Active method line shows "NIP-07"; on a tabbed reload the init log says `NIP-07 extension detected` |
| S.4 | Switch to **NSecBunker** with a running bunker URL → click **Test connection** | ✅ "Connected." status; Active method line shows "Bunker" |
| S.5 | With **Local** active, capture and publish an article | ✅ no signer-extension prompt; published event's `pubkey` matches the local npub |
| S.6 | Local panel → **Show nsec…** → **Copy** | ✅ nsec lands in clipboard; warning text is visible |

### Options page

| # | Test | Pass criteria |
|---|---|---|
| O.1 | Right-click toolbar icon → **Settings…** → Relays tab | ✅ per-relay rows render with read / write / enabled checkboxes |
| O.2 | Add a relay URL → Save → reload the Options page → relay still listed | ✅ persists across reloads |
| O.3 | Disable a relay's **write** flag → publish from a captured article → that relay's URL is absent from the per-relay rollup toast and from the X-Ray toolbar icon's relay picker | ✅ |
| O.4 | Advanced → set **Article cache budget (MB)** to e.g. 10 → reload the extension → DevTools → Application → IndexedDB → archive store stays under 10 MB after captures | ✅ override applied at content-script init via `applyConfigOverrides()` |
| O.5 | Header quick-action **Capture Page** with a normal page in the background | ✅ that tab is captured and a reader tab opens |
| O.6 | Header quick-action **Entity Browser** | ✅ side panel opens (or new tab on Firefox) |

### Context menus

| # | Test | Pass criteria |
|---|---|---|
| C.1 | Right-click the toolbar icon | ✅ four X-Ray items: Toggle Capture, Entity Browser, Settings…, Capture tips |
| C.2 | Click each one — they should each dispatch without console error | ✅ |

---

## Firefox-specific

The MAIN-world `nip07-bridge.js` content script and the
`strict_min_version=128` declaration are the highest-risk
Firefox-only points.

| # | Test | Pass criteria |
|---|---|---|
| F.1 | After "Load Temporary Add-on", `about:debugging` shows the extension with no manifest warnings | ✅ |
| F.2 | With Signing method = NIP-07 and a NIP-07 provider installed, the X-Ray toolbar icon header signing badge shows "NIP-07" | ✅ if it fails, the MAIN-world bridge isn't reaching the isolated world — file as a separate bug |
| F.3 | Run the full Phase 2 + Phase 3a (Substack) checklist | ✅ same outcomes as Chrome |

If you have ESR 128 handy, repeat F.1–F.3.

---

## Knowledge sharing (KS.1–KS.4)

KS.1/KS.4 are keyless-runnable (console fixtures, the Phase 15
convention); KS.2/KS.3 want two identity profiles (or two browser
profiles) to simulate two users.

| # | Test | Pass criteria |
|---|---|---|
| KS.1 | From any extension page console: `chrome.runtime.sendMessage({type:'xray:relay:query', relays:['wss://relay.damus.io'], filter:{kinds:[1],limit:5}}, console.log)` | ✅ response carries `events` **and** `invalid`; SW console logs a drop count only when nonzero |
| KS.2 | Options ▸ Advanced ▸ Identity sharing → enable → capture + publish a YouTube video whose channel account is linked to a person entity | ✅ publish toast counts "N platform account(s)"; relay query `{kinds:[32126],"#d":["youtube:<channelId>"]}` returns the record with `p …account` AND `p …linked-entity` tags; portal reconcile classes it `no-ledger` |
| KS.3 | Side panel → entity detail → **Network activity** → Load from relays → "🔑 Unknown entity keys referenced" → **Adopt…** (choose separate) | ✅ new entity appears with the 🔑 foreign badge; keypair block shows npub, no nsec reveal; publish status says its kind-0 is authored by its owner; sync **⬆ Push** counts it skipped |
| KS.3b | Adopt the same key again, choosing alias of the viewed entity | ✅ no duplicate record (same entity id); it becomes an alias; the feed re-runs wider |
| KS.4 | Entity with a linked platform account → **Network activity** → Load from relays | ✅ loading line says "across K keys" (K > 1); claims keep the ⚖ Assess flow; extra kinds render as collapsed groups; loading writes nothing to local models |
| KS.4b | With all flags at defaults, publish any capture | ✅ event count identical to a pre-KS build (no 32126 arm); single-user flows unchanged |

---

## Case dossier (CD.1–CD.3)

Needs a local **case** entity with claims, at least one proposition +
verdict, an audit run, and an archived source or two — then open it in
the portal ("My Archive" → a case row → **☰ Dashboard**). CD.1 is
pure and covered by `tests/case-dossier.test.mjs`; these rows verify
the CD.2/CD.3 render surfaces match the pure numbers. (Full §Case
dossier detail is CD.5's deliverable.)

| # | Test | Pass criteria |
|---|---|---|
| CD.2a | Open a case dashboard with adjudicated propositions | ✅ **Shape of knowledge** block shows a verdict-state *distribution* (one chip per state + "unadjudicated"), a coverage line (claims / with-propositions / propositions as counts), standards-of-proof chips, and an open/resolved prediction tally — **no single fused score anywhere** |
| CD.2b | Same case, **Evidence** block | ✅ one row per source with capture chips (archived / screenshot / relayed), verbatim claim quotes, an origin count, and — where an audit ran — the shared audit band chip (or "audit: review" under 0.6 confidence, never a naked number); a convergence line; an "Unprocessed sources" list for tagged-but-unprocessed sources |
| CD.3a | Same case, **Four-axis timeline** | ✅ an SVG with world / published / captured / judged lanes on one shared time scale; a year-precision world event renders as a *wide band*, an exact event as a thin mark; hovering shows date+precision+kind; an "N undated" note appears when some events lack a date (never placed on a fake date) |
| CD.3b | A case with a source published before its event, a late capture, or a superseded ruling | ✅ **Gap callouts** list the anomaly with a danger (published-before-occurred) or warning (late-capture / story-changed) dot and a human-readable lag |
| CD.3c | A bare case (no propositions/sources) | ✅ the shape, evidence, and timeline blocks each render nothing (self-remove) — the existing case view is unchanged |

---

## Phase 19 — Entity dossiers (17A + 19.1–19.8)

The key walk (design §8): two articles that disagree on a biographical
fact, captured as facts, rendered contested, published only when the
flag says so. Needs two captured articles (any two pages you can edit
locally work — the disagreement is what matters) and one person entity
tagged in both.

| # | Test | Pass criteria |
|---|---|---|
| 19.a-flag | Fresh profile, select any sentence → tagger popover | ✅ the popover shows only **Add as claim / ❝ Quote / 🔎 Mark finding** — **no 📇 Add fact** (gated behind `readerAddFact`, default OFF). Options → Advanced → Reader → check **Show "Add fact" in the reader selection menu** → Save → reload the reader tab → the 📇 Add fact row is back |
| 19.a | With **Show "Add fact"** ON: select a birth-date sentence → tagger popover → **📇 Add fact** | ✅ the Add-fact modal opens with the selection as the value seed and quote; picking the subject populates the **field** select with person fields + "Custom…"; typing `1962` under *Valid from* shows a live "year precision" hint; free-text garbage in a date field shows "not a date", never saves fabricated precision |
| 19.b | Save `birth_date = 1962`; in a second article add `birth_date = 1963` for the same person | ✅ the pre-flight strip appears BEFORE save: "A captured source says **1962**" with its quote and URL — and **Save stays enabled** (inform, never block) |
| 19.c | Side panel → the person → **Dossier** block | ✅ compact table shows top known fields; a "⚠ 1 contested field" banner; **Open full dossier** opens the portal dossier view via `#dossier=` deep-link |
| 19.d | Portal dossier → the `birth_date` row | ✅ row is highlighted **contested** with BOTH values side by side (no winner, no auto-resolution); clicking each value opens its evidence — verbatim quote, source host, capture date, hash chip |
| 19.e | Unknown rows | ✅ every registry field renders; empty ones say "unknown — no captured source" (never silently absent) |
| 19.f | Side panel footer → **Health** | ✅ the duplicate report lists suspect pairs with evidence; **Merge…** offers a keep-which choice and links the alias (dossiers re-unify — re-open the dossier and both families' facts aggregate); **Not duplicates** persists across rescans; **Unlink** undoes a merge |
| 19.g | Case entity detail → **Case scope** | ✅ scope question / status / opened / closed save and re-render; the case export (JSON + Markdown) carries a "Case scope (author's framing)" block; the portal case view header shows the framing; each member chip has a **dossier →** link |
| 19.h | Options → LLM assist → enable **Entity facts** + run Suggest on an article | ✅ facts arrive quote-grounded in the review panel (default OFF — the checkbox starts unchecked); a fact whose quote isn't verbatim in the article is rejected; accepting requires its subject entity first; accepted facts appear in the dossier stamped `llm:<model>` |
| 19.i | **Flag OFF** (default): publish an article with tagged entities; watch the network panel / relay log | ✅ **no kind-0-enriched or kind-30067 event leaves the device** — the publish summary shows no corpus segment |
| 19.j | Options → Entity corpus → ON (read the disclosure) → publish an article citing a PUBLISHED fact | ✅ the entity's kind-0 `about` gains only published-claim lines, each "per <source>"; the CONTESTED field is absent from the profile; kind-30067 carries both published sides with `contested: true`; every `a` coordinate resolves to a real published claim |
| 19.k | Publish the same article again with nothing changed | ✅ no corpus events re-emit (the hash gate skips); edit + publish a new fact → exactly the changed surfaces re-emit; portal dossier's **Republish profile** force-publishes both |

---

## Phase 20 — Case-first (20.1–20.4)

Needs a **case** entity tagged on several captured articles (a couple
disagreeing on the case question is ideal — the Rootclaim corpus). Open
the case in the portal ("My Archive" → the case row).

| # | Test | Pass criteria |
|---|---|---|
| 20.a | Tag a case on ~3 captured articles (no claims yet) → open it in the portal | ✅ the header shows **"Local corpus: N sources · 0 with claims · …"** (not "0 sources"); the Evidence block lists all N as rows, each with a **"no claims yet"** chip + an **Extract claims →** button |
| 20.b | Click **Extract claims →** on a claimless row | ✅ the archived article opens in the reader (writable); marking a claim about the case and returning → the row flips to *processed* (no "no claims yet" chip) on the next case open |
| 20.c | Case view → **Add sources…** | ✅ an inline picker lists archived articles NOT in the case; filter + check a few + **Add** tags them (canonical case id); an already-published one shows the **"won't carry the case until re-published"** hint; the case re-renders with the new rows |
| 20.d | A tag-member row → **✕ remove**; a row that is also claim-referenced | ✅ remove detaches the tag and the row drops; a claim-referenced row shows **"tagged + claimed"** (no remove — its claims keep it a member) |
| 20.e | Side panel → the case entity → **Add archived articles** | ✅ the same picker in the side panel adds sources; the count updates |
| 20.f | Case view **Case graph** block | ✅ an SVG with the case at center, member-article nodes, tagged/claimed entity nodes, dashed co-tag links between entities, and ⚠ contradiction edges where claims contradict; clicking an entity opens its dossier, an article opens the reader |
| 20.g | Entity spokes graph on a tag-only case (nothing published) | ✅ instead of a dead-end, an **"Open case dashboard"** button (the local graph lives there) |
| 20.h | Options → Advanced → **Case synthesis** OFF (default): open a case | ✅ **no "Analyze corpus" surface** appears |
| 20.i | Case synthesis ON + API key → **Analyze corpus…** | ✅ a confirm states "sends N articles to Anthropic"; on run, a grounded **brief** renders — summary, positions, **cruxes of disagreement side by side**, load-bearing claims, coverage gaps — with a provenance line (model · prompt version · quotes checked/dropped · members). **No score or verdict anywhere.** |
| 20.j | The brief's **Proposals** → **Accept** one | ✅ a relationship proposal creates a local 30055 link (stamped `llm:<model>`); an is_key flags the claim; a new-claim proposal creates a local claim about the case; rejected proposals show a reason and no Accept |
| 20.k | Add another source, re-open the case | ✅ a **"stale — corpus changed"** chip on the stored brief; **Analyze corpus** regenerates it |
| 20.l | Side panel → case → **Export Markdown** after a brief exists | ✅ the export carries a **"## Case brief (LLM-drafted)"** section clearly flagged as an assist, with the cruxes; JSON export carries a `brief` object |

---

## Phase 21 — Podcast transcript import (21.1–21.3)

Import a transcript from the portal (library header **Import transcript…**
or a case view's button beside "Add sources…"). Any transcript works — a
Rootclaim debate transcript with `Speaker:` lines is ideal.

| # | Test | Pass criteria |
|---|---|---|
| 21.a | Paste a WebVTT transcript with `<v Name>` voices | ✅ the live preview reads **"Detected: WebVTT · N turns · M speakers — …"**; parser warnings (if any) show below |
| 21.b | Library-header import, Title only (no Episode URL) → **Import** | ✅ the reader opens with a speaker-labeled body (**bold Speaker:** paragraphs); the URL field shows a `file:///imported/…` id and is editable; a hash line is present |
| 21.c | Case-view import (paste `Speaker:` lines, Title, Import) | ✅ the case **re-renders with the new source immediately** (before you touch the reader tab) — it counts in the local corpus and appears in the graph |
| 21.d | In the opened transcript, select a sentence inside a turn → **Add as claim** | ✅ "Who said it" is prefilled with **that turn's speaker** (resolve-or-create the person entity), not the host/byline |
| 21.e | Fill the **Podcast IDs** (feed GUID, iTunes id) + Episode URL → **Publish** | ✅ the raw kind-30023 event carries `podcast_guid` + `i` `podcast:guid:…` (lowercased), `podcast_episode_guid` + `i` `podcast:item:guid:…` (case-preserved), `itunes_id` (string), `feed_url` as a second `r`, and `transcript_meta` `srt:N:M` |
| 21.f | Portal inspector on the published event → **Open in reader** | ✅ the transcript body renders; `article.podcast` + `transcript_meta` round-trip; speaker prefill still works (regex path, no local speaker list) |

---

## Phase 22 — URL-first media metadata + reader transcript attach (22.1–22.2)

Capture a podcast episode's PAGE first (a Substack podcast post or any
episode page works), then use the reader's **🎙 Media…** toolbar button.

| # | Test | Pass criteria |
|---|---|---|
| 22.a | Capture an episode page → **🎙 Media…** → "a podcast episode" + Show + Episode GUID → **Save** (no transcript) | ✅ toast "Media metadata saved"; the **hash line is unchanged** (metadata is tag-side); reload the reader from the archive — the fields are still set in the modal |
| 22.b | **🎙 Media…** again → paste a `Speaker:` transcript → preview reads "Detected: speaker-labeled · …" → **Save** | ✅ the body gains a `## Transcript` section with **bold Speaker:** paragraphs and clickable stamps linking into the episode URL (`#t=…`); the **hash line changes**; a toast reports turns + speakers |
| 22.c | Select a sentence inside an attached turn → **Add as claim** | ✅ "Who said it" prefilled with that turn's speaker — on an ORDINARY article capture (contentType stays `article`), not just an imported transcript |
| 22.d | **🎙 Media…** a third time → paste a corrected transcript → Save | ✅ the modal warned it will REPLACE; the body has **one** `## Transcript` section (the new one); any YouTube `## Transcript — <lang>` section on a YouTube capture is untouched |
| 22.e | **Publish** → inspect the raw event | ✅ carries `media` `podcast`, `content_format` `article` (provenance unchanged), the podcast GUID tags + `i` forms, and `transcript_meta`; the `x` tag matches the post-attach hash line |
| 22.f | Read-only open (portal inspector → Open in reader) | ✅ the **🎙 Media…** button is absent |
| 22.g | On a transcript (imported or attached), run **✨ Suggest…** → accept a claim whose quote sits inside a turn (single accept AND Accept all) | ✅ the claim's source is **that turn's speaker** — the person entity if one exists, else the name as free text — NOT the host/byline; on a non-transcript article, accepted claims still default to the byline entity. Audit panel → **Atomize as claim…** on a predicate quoted from a turn → "Who said it" prefilled with that speaker |

---

## Phase 23 — Publish the corpus + evidence provenance (23.1+)

| # | Test | Pass criteria |
|---|---|---|
| 23.a | Capture a scientific paper (with a DOI) → reader **🎙 Media & source** | ✅ the Source-type dropdown **suggests "Primary research"**; the hint names it |
| 23.b | Set source type → Save → **Publish** → portal inspect the raw event | ✅ the kind-30023 event carries `['source-type','primary-research']`; the **hash line is unchanged** (tag-side) |
| 23.c | Portal library row for a primary-source capture | ✅ a **★ Primary research** badge shows on the row; the inspector drawer names the source type |
| 23.d | Capture a news write-up / op-ed | ✅ the suggestion is **Reporting / Analysis** respectively (from schema.org type) — confirm or change; a `reference`/undeclared capture shows no primary badge |
| 23.e | Capture an article that links to a paper → **🎙 Media & source** → **Outbound links** → set the paper's role to **Disputes** (and another to **Cited as evidence**) → Save → Publish | ✅ the raw kind-30023 event's `link` tag for that URL carries the 4th positional `disputes` (and `evidence`); the **hash line is unchanged** (tag-side) |
| 23.f | Portal inspect that event | ✅ a **Cited sources** list shows each roled link with its role badge; an undeclared-role link is not listed |
| 23.g | Open a case dashboard with a stored corpus brief → **Publish brief…** (Local signing) | ✅ status reads "Published — the article is readable in any NOSTR client"; no errors in console |
| 23.h | Portal library → **Briefs** tab | ✅ two new rows for the case: a **Case brief** (kind 30068, "N positions · M cruxes · K sources") and the readable article (kind 30023, routed here by the `xray-case-brief` marker, not to Articles) |
| 23.i | Inspect the 30068 brief | ✅ the drawer shows the summary + counts + a "grounded: N verified, M pruned … a map, not a ruling" note; the raw event's content has NO score/verdict field and NO `proposals` |
| 23.j | Open the published 30023 article URL in a **non-X-Ray** NOSTR long-form client (e.g. Habla) | ✅ it reads as a coherent brief — summary, positions, cruxes, load-bearing claims, gaps — with every quote linked to its source |

---

## Phase 24 — Durable, creator-bound entity identity (24.1–24.3)

Requires a Local-mode primary identity (Options → Signing → Local).

| # | Test | Pass criteria |
|---|---|---|
| 24.a | Create a new entity (tag one in the reader) → sidepanel entity detail | ✅ the entity has a pubkey; its `local_keys` entry carries `metadata.derived: true` (inspect via Options backup or devtools) |
| 24.b | **Keystore-loss drill**: note the entity's npub → devtools: `chrome.storage.local.remove('local_keys')` → reload → Options → **Restore entity keys** | ✅ status reports the entity restored; its npub is **identical** to the noted one |
| 24.c | Publish the entity's profile (reader batch or portal dossier → publish) → inspect the raw kind-0 | ✅ carries `['p', <your pubkey>, '', 'creator']` AND a `delegation` tag (4 elements, NIP-26 form); the `about` opens with "An X-Ray subject record maintained by npub…" |
| 24.d | Same publish → portal → refresh | ✅ a kind-30069 **Owned keys** row exists (labeled, N entities); the entity's row shows **✓ creator-bound** |
| 24.e | Options → switch/create/import an identity | ✅ a confirm enumerates the rotation consequences (sync blobs, stamps, derived keys) BEFORE anything changes; cancel aborts cleanly |
| 24.f | Republish entity batches twice without changes | ✅ the 30069 manifest is NOT republished the second time (fingerprint gate) |

---

## Phase 25 — Network client (25.1+)

Best walked with **two identity profiles** (or two browser profiles):
publisher P and follower F, sharing at least one relay. Sections grow
as slices land.

| # | Test | Pass criteria |
|---|---|---|
| 25.a | Flag gate: F with `networkPage` OFF — right-click toolbar icon; open `src/network/index.html` directly | ✅ no "Open Network" menu item; the page shows the enable hint and no controls |
| 25.b | Options → Advanced → "Enable the Network page" → check the toolbar right-click menu (no extension reload) | ✅ "Open Network" appears; the Network quick-access button appears in Options; sidepanel shows a Network button |
| 25.c | Network → Follows → paste P's **npub** (+ a label) | ✅ entry renders with label + npub side by side; garbage input errors without adding |
| 25.d | As P: publish an article + a claim + a verdict. As F: Feed → ↻ Refresh | ✅ P's group shows the article/claim/verdict rows newest-first, npub beside the label; the verdict arrives WITHOUT any second query (authors axis) |
| 25.e | F: Unfollow P → Refresh | ✅ feed empties (or P's group gone); nothing else about the workspace changed |
| 25.f | Settings ▸ Advanced ▸ Start fresh workspace (after export) | ✅ the follow list is cleared with the workspace (`follow_sets` is workspace content) |
| 25.g | F: Refresh → close the tab → reopen the Network page | ✅ the feed renders from cache immediately (no query); Refresh still pulls fresh |
| 25.h | As P: publish something new. As F: Refresh | ✅ an "✨ N new since…" strip appears above the feed; a second Refresh with nothing new shows no strip |
| 25.i | F: follow P WITHOUT a label → Refresh; then feed group header + Follows tab | ✅ P's kind-0 profile name shows with a "profile name"/"profile:" badge (their claim, not verified); npub still beside it |
| 25.j | As P: publish a claim tagging an entity F doesn't know. As F: Refresh → "Entities referenced" → Adopt… | ✅ the adopt prompt proposes the kind-0 name/type; adopting creates a read-only foreign entity (sidepanel shows it badged) |
| 25.k | F: "Clear cache" → confirm | ✅ feed empties; follows intact; next Refresh rebuilds |
| 25.l | F: Refresh → **Queue** tab | ✅ P's claims/links/assessments/verdicts appear as proposals grouped under P; articles do NOT |
| 25.m | Accept a claim proposal → sidepanel/reader claim views | ✅ the claim exists locally with a `nostr:…` provenance badge; capture P's source URL and publish — the incorporated claim is NOT in the publish batch |
| 25.n | Decline a proposal → Refresh → Queue | ✅ it does not re-surface (dismissals persist) |
| 25.o | Accept an assessment proposal | ✅ it is NOT in your assessments (no judgment-model entry); it lives in the read-only incorporated store |
| 25.p | Flip `reviewCoordination` ON as P → portal → inspect an own published artifact → **Request review** | ✅ a 1985 lands on relays with `L xray/review`, `l review-requested`, an `a` coordinate, and **no `p` tag** |
| 25.q | As F (follows P): Refresh → Queue | ✅ "Open review requests" lists P's coordinate; the awareness strip counts it |
| 25.r | As F: assess one of P's published claims. As P: Refresh → Queue | ✅ "Inbound review" lists F's assessment against P's coordinate |
| 25.s | As F with `reviewCoordination` ON: **Re-broadcast follows** | ✅ confirm dialog shows the count; events re-publish verbatim (authors' signatures, no re-signing); flag OFF hides the button |
| 25.t | Options ▸ Advanced ▸ "Allow publishing your follow list" | ✅ a consent dialog enumerates the disclosure (public, irrevocable-in-practice, global-only, merge-not-clobber) BEFORE the flag flips; Cancel leaves it off |
| 25.u | Network ▸ Follows ▸ **Mirror follow list…** (petnames unticked) | ✅ the confirm shows local count + preserved-remote count; the published kind 3 has `['p', pk, hint]` tags, empty content, NO petnames for local labels; portal Refresh shows a "Follows — N keys" row |
| 25.v | Publish a kind 3 from ANOTHER client (different follows) → Mirror again from X-Ray | ✅ the other client's entries survive (union), their petnames intact in the re-published event |
| 25.w | F follows P; P's kind 3 follows Q; F's feed references Q (collapsed or candidate) → Refresh | ✅ Q's row shows "followed by 1 of your follows"; the chip is a count, nothing reorders |
| 25.x | Tick "trusted provenance only" | ✅ builds-on-unfollowed items and the unsolicited strip disappear with an honest hidden-count note; unticking restores; order never changes; the toggle resets OFF on reload |

---

## Corpus brief — download + provenance (Phase 26 prep)

Requires `caseSynthesis` + `llmAssist` + an API key, and a case with a
stored brief (run "Analyze corpus…" once).

| # | Test | Pass criteria |
|---|---|---|
| P26.a | Case dashboard ▸ Corpus synthesis ▸ **Download .md** | ✅ a `case-brief-<slug>.md` downloads; opens as the readable brief with each quote linked to its source URL |
| P26.b | **Download .json** | ✅ a `case-brief-<slug>.json` downloads; contains `brief`, `grounding`, `model`, `members`, `inputHash` |
| P26.c | Inspect the rendered brief on the dashboard | ✅ each **crux** shows its grounded evidence quotes with a source link; each **load-bearing** claim shows a "Source:" link (and a "Claim:" text when `claim_ref` resolves); each **position** shows "Held by:" source links |
| P26.d | Click a source link | ✅ opens the captured source's original URL in a new tab; nothing publishes |
| P26.e | A case with a `supports`/`updates`/`duplicates` link between two claims → case dashboard ▸ Claims | ✅ the claim rows show a "→ supports: <other claim>" / "← updated by: <other>" badge naming the linked claim; contradiction still shows its ⚠ badge separately |
| P26.f | Read the Evidence and Case-graph section headers | ✅ each has a one-line explainer; the source's link line reads "cites N outbound URLs (M also in this case) · cited by K case sources" |

---

## Reporting

For each defect found:

1. **Open a separate issue** — one defect per issue. Don't let
   smoke-test failures pile up in #1.
2. Title in the form `<area>: <one-sentence symptom>`.
3. Body must include:
   - Browser + version + OS.
   - URL where you reproduced (where applicable).
   - Console output.
   - Expected behaviour.
4. Tag with `bug` + the relevant `area/*` label.
5. If the bug is non-obvious or shapes future design, also add a
   `docs/JOURNAL.md` entry once the fix lands.

When the smoke test passes end-to-end, post a comment on issue #1
with the date + git SHA + browser / OS / version triple. That's
the closest thing X-Ray currently has to a release-blocker
checklist.
