# X-Ray — End-to-end smoke test

Manual walkthrough that exercises every shipped surface across
Phases 0–9 + the v0.5.x cleanup. Aim for ~20 minutes per browser.
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
npm run build           # produces dist/*.bundle.js (5 bundles)
npm test                # 528/528 should pass
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
| 0.1 | `npm run build` exits 0 with no errors | ✅ all five bundles emitted under `dist/` (content, background, options, sidepanel, reader) plus `api-interceptor` |
| 0.2 | `npm test` exits 0 | ✅ 521/521 (or current-on-main count) passing |
| 0.3 | Reload extension after a build → no console errors in the SW log | ✅ the SW log under `chrome://extensions` → "Inspect views: service worker" is clean |
| 0.4 | Click toolbar icon on a normal http page | ✅ captures the page → a reader tab opens (no popup window, no in-page panel) |
| 0.5 | Click toolbar icon on `chrome://newtab` | ✅ Options page opens (fallback, since content script can't run there) |
| 0.6 | Right-click toolbar icon | ✅ menu has Toggle Capture / Entity Browser / Settings… / View Keypair Registry / Export Keypair Registry / Capture tips |

---

## Phase 1 — Real crypto

| # | Test | Pass criteria |
|---|---|---|
| 1.1 | `npm test -- --test-name-pattern crypto` | ✅ 13 crypto + 5 nip44 tests pass |
| 1.2 | Settings → Keypair Registry → **View** | ✅ JSON of saved entity keypairs renders without error |

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
| C.1 | Right-click the toolbar icon | ✅ six X-Ray items: Toggle Capture, Entity Browser, Settings…, View Keypair Registry, Export Keypair Registry, Capture tips |
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
