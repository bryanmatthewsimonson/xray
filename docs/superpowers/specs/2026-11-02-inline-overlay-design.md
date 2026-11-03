# Inline Overlay — Phase 1 Design (2026-11-02)

Status: **design approved in conversation; spec awaiting maintainer review.**
Reference product: Common Notes (https://commonnotes.net/) — Community
Notes–style context shown inline on articles and at timestamps on YouTube.

## 1. Brief

**Goal (maintainer).** X-Ray needs inline notes and in-video notes of the
kind Common Notes demonstrates. All three loops are wanted, phased:

1. **Overlay my work on the source** — this spec.
2. Author notes in place and publish them — later; needs a wire decision.
3. Read followed users' anchored notes inline — later; Network client.

**Phase 1 scope (maintainer choices).**

- Always on, automatically, on any URL already in the local archive.
- Overlays: claims (30040), judgments on claims (assessments 30054,
  truth verdicts 30063, forensic findings 30062), extraction rows (MA
  layer, with review state), and free personal notes (local only).
- Video: YouTube only.
- Rendering approach **B**: markers in the page, note text in an
  extension-origin iframe.

**Assumptions (mine, accepted with the design).**

- Phase 1 publishes nothing new. **Wire format: none.**
- Matching the current URL against the archive is local; nothing about
  the page leaves the machine.
- Gated behind a new flag, default off until the smoke walk passes.

**Success criteria.**

- On a captured Substack article, a captured news article, and a captured
  YouTube video (captions path and transcription path), every overlay item
  either renders at its passage/moment or is listed as "not located" —
  never silently dropped.
- No note text, verdict state, or assessment content is ever present in
  the page's DOM or in any message the content script receives
  (machine-checked, §6.2).
- A non-archived page incurs one message round-trip and zero DOM changes.
- Turning the flag off restores today's behaviour exactly.

**What this reverses.** CLAUDE.md records that X-Ray injects no in-page
chrome beyond a transient error toast. This feature deliberately changes
that, behind a flag; the change gets a JOURNAL entry and a CLAUDE.md
architecture update when it lands.

## 2. Components

Each unit has one job and is testable without a browser.

| Unit | Context | Job |
|---|---|---|
| `src/shared/anchor-resolve.js` | pure | Resolve an item's anchor to a text range in a flattened page-text + node map; map a quote to media seconds. |
| `src/shared/overlay-model.js` | pure | `buildOverlay(url, sources)` → anchored item list; attaches judgments to claims. No I/O. |
| `xray:overlay:lookup` handler | background | Normalize URL, gather records, return `buildOverlay` result stripped of private text. |
| `xray:overlay:card` handler | background | Return full card content for one item, only to our iframe on the matching tab URL. |
| `xray:overlay:note:{save,delete}` handlers | background | Write/delete `page_notes` entries; same sender checks as `card`. |
| `src/content/overlay.js` | content script | Lookup, resolve, draw markers (highlights, pins, YouTube ticks, chip); host the iframe. |
| `overlay-card.html` + `src/overlay/index.js` | extension iframe | Render cards, list mode, and the new-note editor. New esbuild IIFE entry → `dist/overlay.bundle.js`. |

### 2.1 `anchor-resolve.js`

- `buildTextIndex(rootTextNodes)` → `{ text, map }`: one normalized string
  plus a map from normalized offsets back to `(node, offset)`.
- `resolve(index, item)` → `{ range: {start, end} | null, confidence,
  method }`, trying in order:
  1. `TextQuoteSelector` exact + prefix + suffix → confidence 1.0
  2. exact `quote`/`exact`, unique in page → 0.9
  3. fuzzy (bounded edit distance, quotes ≤ 200 chars only) → its score
  Accept at confidence ≥ 0.7, else unresolved.
- Normalization (applied to page text and quotes alike): NFKC; collapse
  whitespace incl. NBSP; unify curly/straight quotes and dash variants;
  strip Markdown emphasis and `[text](url)` link syntax (quotes come from
  Turndown output).
- `quoteToSeconds(item, article)`:
  1. if `article.timeMap` exists → locate the quote in the canonical
     markdown, then `timeRangeOfSpan(timeMap, start, end)`
     (`diarized-transcript.js`);
  2. else → the nearest preceding `[m:ss](…&t=Ns)` paragraph link in the
     archived markdown (`platforms/youtube.js` caption format);
  3. else `null` (item goes to the list, §4).

### 2.2 `overlay-model.js`

`buildOverlay(url, { claims, assessments, verdicts, findings,
extractionRows, notes })` → `Item[]`:

```
Item = {
  id, kind: 'claim' | 'finding' | 'extraction' | 'note',
  anchor?, quote?, seconds?,           // locating data only
  judgmentKinds: string[],             // e.g. ['assessment','verdict'] — kinds, not content
  reviewState?: 'unreviewed' | 'accepted' | 'rejected'   // extraction rows only
}
```

- Forensic findings (30062) are first-class items, not attachments: a
  finding's subject is an actor, not a claim, and each of its `anchors`
  carries its own quote, selector, timestamp and `source_ref.url`. The
  overlay emits one `finding` item per anchor whose URL is this page.
  (Amended 2026-11-02 during planning; the design conversation had
  assumed findings hang on claims.)
- Assessments and verdicts attach to their claim by claim id; a judgment
  whose claim is not on this URL is ignored here (it belongs to its own
  claim's page).
- Rejected extraction rows are included with `reviewState: 'rejected'`;
  hiding is a render choice, not a model choice (CONSTITUTION Art. 3).
- The model holds full content internally for the `card` handler; the
  `lookup` projection is a separate function, `toLookupItems(items)`,
  that emits only the fields above.

### 2.3 Personal notes

- Storage: `chrome.storage.local` key `page_notes` → array of
  `{ id, url /* normalized */, anchor?, quote?, seconds?, text,
  created, updated }`.
- A storage key, not an IndexedDB version bump — the smaller one-way
  door. `schema-evolution` review confirms backup export/import and
  `mergeBackup` coverage (accrual by id, local wins) before merge.
- Written only via background handlers called from the iframe.

## 3. Data flow

1. Content script, at `document_idle` and on URL change, sends
   `xray:overlay:lookup {url}` (if the flag is on and the site is not in
   `overlay_site_off`).
2. Background returns `{ items: [] }` immediately for non-archived URLs
   (hot path), else `toLookupItems(buildOverlay(...))`.
3. Content script resolves anchors (and, on YouTube, uses `seconds`) and
   draws markers.
4. Click/hover on a pin or tick → content script positions the iframe and
   posts it `{ itemIds }`. The iframe calls `xray:overlay:card
   {url, itemIds}` and renders.
5. New note: user selects text, presses the new command. The content
   script captures `TextQuoteSelector` + quote (both already visible to
   the page) and opens the iframe in editor mode; the iframe saves via
   `xray:overlay:note:save`. On YouTube, the command with no selection
   captures `video.currentTime` instead.

## 4. Live-page anchoring and YouTube

**Triggers.** `document_idle`; URL change detected by polling
`location.href` every 1 s (no MAIN-world `pushState` hook); on YouTube
also `yt-navigate-finish`. URL change → full teardown, then re-lookup.

**Re-resolution.** While unresolved items remain, a `MutationObserver` on
`document.body`, debounced 2 s, retries them; it disconnects when all
resolve or after 30 s. This covers lazy-loaded bodies and comment threads.

**Root container.** First of `article`, `[role=main]`, `body`; visible
text nodes only.

**Text markers.** _(Amended 2026-11-03: only the `<mark>` strategy shipped; see §9.)_
- Primary: CSS Custom Highlight API, one named highlight per kind
  (claim, judged claim, extraction, note).
- Fallback: `<mark class="xr-ov-*">` wraps, fully reversed on teardown —
  used on Firefox < 140 (the floor stays 128) and everywhere if the spike
  (§7) finds `CSS.highlights` readable from the page world.
- A small margin **pin** per highlight is the click target; overlapping
  items share one pin and its card lists them all.
- Extraction pins carry review state as text, not colour alone.

**YouTube.**
- Ticks live in our own absolutely positioned strip overlaid on
  `.ytp-progress-bar-container`, sized from `video.duration` — we do not
  inject into YouTube's re-rendering DOM.
- `timeupdate` crossing an item's start (±1 s, once per playthrough of
  that span) auto-pops its card in a player corner; it closes after 8 s
  unless hovered. Clicking a tick sets `video.currentTime`.
- If the transcript panel is open, its text is matched too.

**Open channel and teardown (amended 2026-11-03).** The page-visible
`xr-ov:open` DOM event originally implied here was replaced by an
isolated-world callback: `env.onOpen(detail)` (with `env.onClose`,
`env.onLocated`, `env.getVideoSeconds`) is wired by the content script, so
page scripts can neither forge nor observe an open. Teardown restores the
**exact original text nodes** from a split log (never `Node.normalize()`,
which would merge or alter nodes the page owns). Overlay nodes are stripped
from captures by `src/shared/overlay-strip.js` (used by `content-extractor`
and `html-snapshot`), so the captured Markdown and hash are identical with
the overlay on or off. Notes on `youtu.be`, `/shorts/`, `/embed/` and
`/live/` URLs resolve to the canonical watch URL. Forensic findings are
first-class anchored items (one per anchor on the page URL), not
attachments to claims.

**Unresolved items.** A corner chip — "X-Ray: N notes · M not located" —
opens the card in list mode with every item; unlocated items are marked,
never hidden. On YouTube, items without `seconds` appear here. The chip
menu carries "Hide on this site".

## 5. Gating, failure modes, security

### 5.1 Gating

- Flag `inlineOverlay` in `metadata/feature-flags.js`, default **off**.
  Flip proposed to the maintainer after the smoke walk (`product-manager`
  review).
- `overlay_site_off`: list of hostnames, set from the chip, reversible
  in Options.
- "Show rejected" toggle in list mode (default off).

### 5.2 Failure modes — degrade to fewer markers, never break the page

| Condition | Behaviour |
|---|---|
| Lookup fails / SW asleep | One retry after 1 s, then nothing, silently. |
| Resolver throws, or page text > 2 MB | Skip anchoring; chip + list mode only. |
| Page removes our elements | Re-add at most 3 times, then stop. |
| YouTube player DOM shape changed | No ticks; items go to the list. |
| Page CSP blocks the iframe (`frame-src`) | Card opens in the side panel at that item instead. `rules/csp-strip.json` is not widened. |

### 5.3 Security

- Card text lives only in the cross-origin extension iframe.
- `overlay-card.html` is a web-accessible resource, so a hostile page can
  embed it. Therefore `xray:overlay:card` and `xray:overlay:note:*` are
  answered only when the sender is an extension-origin frame
  (`sender.url` is our `overlay-card.html`) **and** normalized
  `sender.tab.url` equals the requested `url`. A page can never pull notes
  for another URL; an embedding page cannot read the iframe's response.
  The one other accepted sender is a tabless extension page (the side
  panel, for the CSP fallback), since our own pages already read storage
  directly. Content-script senders are always refused.
  _(Amended 2026-11-03: the sender rule as built is `sender.id` equals the
  runtime id AND an extension-protocol URL AND `pathname ===
  '/src/overlay/overlay-card.html'`, plus `sender.tab` and the tab-URL
  binding. Tabless senders are accepted only from `src/sidepanel/index.html`.
  The card is also inert unless `window.parent === window.top` (and
  `ancestorOrigins.length === 1` where available), so a nested third-party
  iframe cannot embed it.)_
- ~~Chrome: `use_dynamic_url: true` on the resource to block fingerprinting
  by probe.~~ _(Amended 2026-11-03: NOT used. `nip07-bridge.js` is already
  a static `<all_urls>` web-accessible resource, so the extension is
  fingerprintable regardless and dynamic URLs would buy nothing, while
  risking the card iframe failing to load on Chrome 130+. Fingerprinting
  via static WARs is accepted. Firefox randomizes the extension UUID per
  install.)_
- `lookup` returns only `toLookupItems` fields. Quotes are already on the
  page.
- All `xray:overlay:*` messages get receiver-side shape validation.
- Residual, accepted: the page can observe *which* spans are highlighted.
- `docs/THREAT_MODEL.md` delta via `security-threat-modeler`.

### 5.4 Manifest delta

One `web_accessible_resources` entry (`overlay-card.html` + its bundle),
one `commands` entry ("Add X-Ray note to selection"). No new permissions;
content scripts already run on all URLs. `architect` review covers the
new message types and esbuild entry.

## 6. Testing

### 6.1 Unit (`node --test`, no DOM)

- `anchor-resolve`: exact/prefix/suffix, uniqueness, fuzzy threshold,
  normalization (curly quotes, Markdown emphasis, NBSP), 2 MB guard;
  `quoteToSeconds` against a real `timeMap` fixture and a real YouTube
  caption-markdown fixture.
- `overlay-model`: judgment attachment, review-state labels, rejected
  rows present but flagged, foreign-claim judgments ignored.
- Background handlers: non-archived URL → `[]`; sender checks refuse
  wrong frame, mismatched tab URL, malformed payload.
- Content overlay: hand-built DOM stub — teardown on URL change, full
  `<mark>` reversal.
- `page_notes`: CRUD, backup round-trip, `mergeBackup` accrual.

### 6.2 Guard

New guard test: the `lookup` response and `toLookupItems` output never
contain `text`, `content`, `verdict`, `assessment`, `body`, or `note`
keys — the "no private text into the page" invariant, permanent.

### 6.3 Live

New `docs/SMOKE_TEST.md` section: Substack article with claims; generic
news article; YouTube video via captions; YouTube video via transcription.
Check highlights, cards, tick seek, auto-pop, unlocated chip, "Hide on
this site", and a note surviving reload and backup. Whether a canary for
the YouTube selectors is worth automating goes to the `automator` review.

## 7. Pre-implementation spike (throwaway, ~1 h, Edge + Firefox)

1. Register a highlight from the content script; check from the page
   world whether `CSS.highlights` exposes it. Decides §4's primary marker.
2. Overlay strip over `.ytp-progress-bar-container` through theater,
   fullscreen, miniplayer, and SPA navigation between videos.
3. Find a real site whose CSP blocks the extension iframe — sizes how
   often §5.2's side-panel fallback fires.

Results are recorded in §9 before any marker code is written. (Amended
during planning: the `<mark>` path is built regardless, as the Firefox
< 140 fallback, so the spike decides only whether the Highlight API
task runs. It is Task 1 of the plan rather than a precondition for
writing it.)

## 8. Out of scope (phase 1)

- Publishing notes (phase 2). Kinds 30050–30053 were moved to RESERVED
  by K1 (`docs/ROAD_TO_1_0.md`, PR #317); phase 2 must choose a new kind
  or a CONSTITUTION Art. 10 amendment reviving 30050.
- Followed users' notes (phase 3).
- Non-YouTube video and podcast audio players.
- Auto-overlay inside the X-Ray reader.

## 9. Decision log

- 2026-11-02 — Phase order: overlay first (reuses existing anchors; no
  wire kind; builds the engine phases 2–3 reuse).
- 2026-11-02 — Activation: always on for archived URLs (over badge-toggle
  and side-panel-only).
- 2026-11-02 — Contents: claims, judgments, extraction rows, local notes.
- 2026-11-02 — Video: YouTube only.
- 2026-11-02 — Rendering: approach B (markers in page, text in extension
  iframe) over A (shadow DOM, page-readable) and C (side panel only).
- Spike results: _pending §7_ (Task 1 spike deferred to the maintainer).
- 2026-11-03 — Amended: the `xr-ov:open` page-visible DOM event replaced by
  an isolated-world `env.onOpen(detail)` callback (page scripts could forge
  or observe the DOM event); `env.onClose`, `env.onLocated` and
  `env.getVideoSeconds` added alongside (§4).
- 2026-11-03 — Amended: `use_dynamic_url` NOT used on the card resource
  (static `<all_urls>` WAR already exists via `nip07-bridge.js`; Chrome
  130+ load risk) (§5.3).
- 2026-11-03 — Amended: card sender rule is id + extension protocol + exact
  pathname + `sender.tab` and tab-URL binding; tabless senders only from
  `src/sidepanel/index.html`; the card is inert unless
  `window.parent === window.top` (§5.3).
- 2026-11-03 — Amended: teardown restores exact original text nodes via a
  split log, never `Node.normalize()` (§4).
- 2026-11-03 — Added: overlay nodes stripped from captures by
  `src/shared/overlay-strip.js` (content-extractor, html-snapshot).
- 2026-11-03 — Added: notes on youtu.be / shorts / embed / live URLs
  resolve to the canonical watch URL.
- 2026-11-03 — Amended: forensic findings are first-class anchored items
  (one per anchor on the page URL), not attachments to claims.
- 2026-11-03 — Deferred: CSS Custom Highlight API (Task 9) and the Task 1
  spike go to the maintainer; `<mark>` wrapping is the only marker strategy
  shipped (§4).
- 2026-11-03 — Options: `inlineOverlay` toggle and a "Hidden on these
  sites" list (`overlay_site_off`) added under Advanced.
