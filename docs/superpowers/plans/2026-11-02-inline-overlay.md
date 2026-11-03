# Inline Overlay (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On any URL already in the local archive, show the user's claims, judgments, forensic findings, extraction rows and personal notes inline at their passage, and on YouTube at their moment, without any note text entering the page.

**Architecture:** Two pure modules (`anchor-resolve.js`, `overlay-model.js`) do the matching and assembly. A background module answers `xray:overlay:*` messages with sender checks. The content script draws only markers (highlights, pins, YouTube ticks, a chip). An extension-origin iframe (`overlay-card.html`) renders all text and the note editor. Personal notes live under the `chrome.storage.local` key `page_notes`.

**Tech Stack:** Plain ES modules, esbuild IIFE bundles, `node --test` with hand-built `chrome.*` / DOM stubs, MV3 (Chrome/Edge + Firefox ≥ 128).

**Spec:** `docs/superpowers/specs/2026-11-02-inline-overlay-design.md`

## Global Constraints

- Firefox floor stays `gecko.strict_min_version: 128.0`; the CSS Custom Highlight API (Firefox 140+) is never required.
- Indentation 4 spaces; CSS classes `xr-ov-*`; user-visible strings say "X-Ray"; logging via `Utils.log` / `Utils.error` only.
- Wire format: **none**. No new kind, no tag change, nothing published.
- Flag `inlineOverlay` in `FLAGS_DEFAULTS`, default `false`.
- Content script never receives `text`, `content`, `body`, `note`, `verdict`, `assessment`, `stance`, `labels` keys from any `xray:overlay:*` response.
- `xray:overlay:card` and `xray:overlay:note:*` answer only when `sender.url` starts with `chrome.runtime.getURL('src/overlay/overlay-card.html')` AND `Utils.normalizeUrl(sender.tab.url) === Utils.normalizeUrl(message.url)`. The one other accepted sender is an extension page with no `sender.tab` (the side panel's CSP fallback), since our own pages can read storage directly anyway. Content-script senders (`sender.tab` set and `sender.url` not on the extension origin) are always refused.
- Thresholds: accept confidence ≥ 0.7; fuzzy only for quotes ≤ 200 chars; skip anchoring when page text > 2 MB (2 \* 1024 \* 1024 chars); URL poll 1000 ms; observer debounce 2000 ms, give up after 30000 ms; re-add markers at most 3 times; lookup retry once after 1000 ms; YouTube auto-pop window ±1 s, auto-close 8000 ms unless hovered.
- Review states shown to the user: map extraction `status` `open` → "unreviewed model proposal", `accepted` → "accepted", `dismissed` → "rejected". Rejected rows hidden by default behind "Show rejected"; never deleted.
- Version lockstep: don't bump versions in this plan.

## Review Focus

1. **The same quote appears twice on the page** (pull quote + body). With no prefix/suffix match the item must resolve to neither occurrence (unique-check fails) rather than the first one → test in Task 2 (`resolve: duplicate exact without context is unresolved`).
2. **Archive normalized the URL differently from the live tab** (tracking params, `www.`, trailing slash, `m.youtube.com`, `youtu.be`). Lookup must still hit → test in Task 4 (`lookup: matches archived URL across utm params and youtu.be form`).
3. **YouTube SPA navigation to a different video** must tear down the old video's ticks before the new lookup returns, so no stale tick seeks the wrong video → test in Task 7 (`youtube: ticks cleared on yt-navigate-finish before relookup`).
4. **The user selects text inside our own pin, chip, or a text node we wrapped in `<mark>`** and presses the note command. The captured quote must be the page text, never our UI's label → test in Task 6 (`captureSelection ignores xr-ov UI nodes`).
5. **A video item's `seconds` is beyond `video.duration`** (a capture of a longer re-upload, or a live stream) → tick not drawn, item listed as not located → test in Task 7 (`youtube: seconds past duration go to list`).

---

### Task 1: Spike — highlight visibility, YouTube strip, iframe CSP (throwaway)

Needs the maintainer's Edge + Firefox with the unpacked extension; this is a manual probe, not code that is kept.

**Files:**
- Modify: `docs/superpowers/specs/2026-11-02-inline-overlay-design.md` (§9 only)

- [ ] **Step 1:** On a scratch branch, add to `src/content/index.js` a temporary block that registers `CSS.highlights.set('xr-ov-spike', new Highlight(range))` over the first paragraph, plus a `::highlight(xr-ov-spike)` style. Build, reload, open any article.
- [ ] **Step 2:** In the page's DevTools console (top frame context, NOT the extension context) run `CSS.highlights.has('xr-ov-spike')` and `[...CSS.highlights.keys()]`. Record true/false per browser.
- [ ] **Step 3:** On a YouTube watch page, inject an absolutely positioned 4px strip as the last child of `.ytp-progress-bar-container` with a tick at 50%. Check theater, fullscreen, miniplayer, and clicking a related video. Record which survive.
- [ ] **Step 4:** Inject an iframe pointing at a web-accessible extension page on three sites known for strict CSP (e.g. github.com, an X/Twitter status, a major news site). Record which block it.
- [ ] **Step 5:** Discard the scratch branch. Write the three results into spec §9 "Spike results", replacing `_pending §7_`, and state the marker decision: **if Step 2 was true in any browser → Task 9 is skipped**; otherwise Task 9 runs.
- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-11-02-inline-overlay-design.md
git commit -m "docs(overlay): record phase-1 spike results"
```

---

### Task 2: `anchor-resolve.js` — text index, resolution, quote → seconds

**Files:**
- Create: `src/shared/anchor-resolve.js`
- Test: `tests/anchor-resolve.test.mjs`

**Interfaces:**
- Produces:
  - `normalizeForMatch(s: string): string`: NFKC; NBSP and all whitespace runs → single space; `‘’‚‛` → `'`, `“”„‟` → `"`, `–—―‒` → `-`; strip `**`, `__`, `*`, `_` emphasis markers and `[text](url)` → `text`; trim.
  - `buildTextIndex(segments: Array<{ref: any, text: string}>): {text: string, map: Array<{start: number, end: number, ref: any, rawStart: number}>}`: concatenates normalized segments with a single space between them; `map` converts a normalized offset back to `(ref, raw offset)`. Opaque `ref` keeps it DOM-free.
  - `locate(index, start: number, end: number): {startRef, startOffset, endRef, endOffset}` (raw offsets inside each ref's original text).
  - `resolve(index, item: {anchor?: object|Array, quote?: string}): {range: {start: number, end: number} | null, confidence: number, method: 'quote-context' | 'exact-unique' | 'fuzzy' | 'none'}`
  - `quoteToSeconds(quote: string, article: {markdown?: string, content?: string, timeMap?: Array}): number | null`
  - `ACCEPT_CONFIDENCE = 0.7`, `FUZZY_MAX_QUOTE = 200`, `MAX_PAGE_CHARS = 2 * 1024 * 1024`

- [ ] **Step 1: Write the failing tests**

```js
test('normalizeForMatch folds quotes, dashes, NBSP, markdown', () => {
    assert.equal(normalizeForMatch('“It’s — *fine*” [here](https://x.y)'), '"It\'s - fine" here');
});
test('resolve: exact with prefix/suffix → 1.0 quote-context', () => {
    const idx = buildTextIndex([{ ref: 'a', text: 'alpha beta gamma beta delta' }]);
    const r = resolve(idx, { anchor: [{ type: 'TextQuoteSelector', exact: 'beta', prefix: 'gamma ', suffix: ' delta' }] });
    assert.deepEqual([r.range.start, r.method, r.confidence], [17, 'quote-context', 1]);
});
test('resolve: unique exact quote → 0.9 exact-unique', () => { /* quote 'gamma' → start 11 */ });
test('resolve: duplicate exact without context is unresolved', () => {
    const idx = buildTextIndex([{ ref: 'a', text: 'beta x beta' }]);
    assert.equal(resolve(idx, { quote: 'beta' }).range, null);
});
test('resolve: fuzzy accepts one-word drift ≥ 0.7, rejects > 200 chars', () => { /* … */ });
test('resolve: spans segments and locate() maps back to refs', () => {
    const idx = buildTextIndex([{ ref: 'p1', text: 'one two' }, { ref: 'p2', text: 'three four' }]);
    const r = resolve(idx, { quote: 'two three' });
    assert.deepEqual(locate(idx, r.range.start, r.range.end), { startRef: 'p1', startOffset: 4, endRef: 'p2', endOffset: 5 });
});
test('quoteToSeconds: timeMap path', () => { /* use tests/fixtures timeMap from diarized-transcript tests */ });
test('quoteToSeconds: caption &t= paragraph path', () => {
    const md = '[0:05](https://www.youtube.com/watch?v=abc&t=5s) hello there\n\n[1:10](https://www.youtube.com/watch?v=abc&t=70s) the quoted line';
    assert.equal(quoteToSeconds('the quoted line', { markdown: md }), 70);
});
test('quoteToSeconds: no timing → null', () => { /* plain article markdown */ });
```

- [ ] **Step 2:** `node --test tests/anchor-resolve.test.mjs`. Expected: FAIL, module not found.
- [ ] **Step 3:** Implement. Try selectors in array order. `TextPositionSelector` is ignored (offsets come from a different text); `TextQuoteSelector` with context counts only when `prefix+exact+suffix` (normalized) occurs exactly once. Fuzzy: sliding window of `quote.length ± 10%` over the text, score = `1 - levenshtein/quote.length`, pick the best; return `none` when the best is < 0.7 or ties. `quoteToSeconds` with `timeMap` locates the quote in `article.markdown` (falling back to `article.content`) and calls `timeRangeOfSpan` from `./diarized-transcript.js`, returning `.startSec`; otherwise it takes the last `&t=(\d+)s` link before the quote's offset.
- [ ] **Step 4:** Run the tests again. Expected: PASS.
- [ ] **Step 5: Commit**: `git commit -m "feat(overlay): pure anchor resolver and quote-to-seconds"`

---

### Task 3: `overlay-model.js` — assembly, lookup projection, guard

**Files:**
- Create: `src/shared/overlay-model.js`
- Test: `tests/overlay-model.test.mjs`, `tests/overlay-guards.test.mjs`

**Interfaces:**
- Consumes: nothing from earlier tasks (pure).
- Produces:
  - `buildOverlay(url: string, sources: {claims, assessmentsByClaim: Map<id, Array>, verdictsByClaim: Map<id, Array>, findings: Array, extraction: object|null, notes: Array}): FullItem[]`
  - `FullItem = {id, kind: 'claim'|'finding'|'extraction'|'note', anchor, quote, seconds: number|null, judgmentKinds: string[], reviewState: 'unreviewed'|'accepted'|'rejected'|null, detail: object}`. `detail` holds all display content and is never sent to the content script.
  - `toLookupItems(items: FullItem[]): LookupItem[]`. `LookupItem` = `FullItem` minus `detail`; an explicit allow-list of keys `['id','kind','anchor','quote','seconds','judgmentKinds','reviewState']`.
  - `LOOKUP_ALLOWED_KEYS` (exported for the guard).
  - Ids: claims `claim:<claim.id>`, findings `finding:<finding.id>:<anchorIndex>` (one item per anchor whose `source_ref.url` normalizes to `url`), extraction `extraction:<assertion.key>`, notes `note:<note.id>`.

- [ ] **Step 1: Write the failing tests**: `judgments attach as judgmentKinds ['assessment','verdict']`; `finding yields one item per anchor on this URL, none for other URLs`; `extraction status open/accepted/dismissed → unreviewed/accepted/rejected`; `extraction assertions that became claims (status accepted with claim id) are not duplicated when that claim is present`; `notes pass through with seconds`. Guard file: `toLookupItems output keys ⊆ LOOKUP_ALLOWED_KEYS for a fixture with every kind`, and `LOOKUP_ALLOWED_KEYS contains none of text/content/body/note/verdict/assessment/stance/labels`.
- [ ] **Step 2:** Run both files. Expected: FAIL.
- [ ] **Step 3:** Implement. Claim `seconds` is filled later by the background (it needs the article), so the model takes an optional `secondsFor(quote) => number|null` in `sources` and calls it for every item that has a quote and no `timestamp`. A finding anchor's `timestamp` wins when present.
- [ ] **Step 4:** Run again. Expected: PASS.
- [ ] **Step 5: Commit**: `git commit -m "feat(overlay): overlay model and no-private-text guard"`

---

### Task 4: `page-notes.js` + backup coverage

**Files:**
- Create: `src/shared/page-notes.js`
- Modify: `src/shared/workspace-keys.js` (add `'page_notes'` to `WORKSPACE_CONTENT_KEYS` with a comment `// Inline overlay phase 1 — local personal notes`)
- Test: `tests/page-notes.test.mjs`; extend `tests/backup-merge.test.mjs`

**Interfaces:**
- Produces: `PageNotes = { list(): Promise<Note[]>, forUrl(url): Promise<Note[]>, save({id?, url, anchor?, quote?, seconds?, text}): Promise<Note>, remove(id): Promise<void> }`. `Note = {id, url, anchor, quote, seconds, text, created, updated}`; `url` is stored normalized; `id` = `pn_` + 16 hex random; `text` is required, trimmed, ≤ 10000 chars, otherwise `save` throws. Storage shape is `page_notes: {[id]: Note}` (a map, so `mergeBackup` accrues by id like the other content maps).

- [ ] **Step 1: Write the failing tests**: CRUD; `forUrl` matches across utm params; `save` rejects empty text; in backup-merge, `page_notes from file accrue by id, local wins on conflict`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement on `Storage.get/set` (same shim style as `claim-model.test.mjs`).
- [ ] **Step 4:** Run the new and existing backup tests. Expected: PASS.
- [ ] **Step 5: Commit**: `git commit -m "feat(overlay): local page notes, included in backup"`

---

### Task 5: Background `xray:overlay:*` handlers + flag

**Files:**
- Create: `src/background/overlay.js`
- Modify: `src/background/index.js` (route the four types to `handleOverlayMessage`, async `return true`), `src/shared/metadata/feature-flags.js` (add `inlineOverlay: false` with a comment block citing the spec)
- Test: `tests/overlay-background.test.mjs`

**Interfaces:**
- Consumes: `buildOverlay`, `toLookupItems` (Task 3); `quoteToSeconds` (Task 2); `PageNotes` (Task 4); `getArticle` (archive-cache), `ClaimModel.getBySourceUrl`, `AssessmentModel.getByClaimRef({claim_id})`, `TruthAdjudicationModel.getByClaim` → `VerdictModel.getActiveForProposition`, `ForensicModel.getAll`, `getArticleExtraction(article.articleHash)`.
- Produces: `handleOverlayMessage(message, sender, io = defaultIo): Promise<object>` for the message types:
  - `xray:overlay:lookup {url}` → `{ok: true, items: LookupItem[]}`; `{ok: true, items: []}` when the flag is off, the host is in `overlay_site_off`, or `getArticle(url)` is null, and in that case no other model is read.
  - `xray:overlay:card {url, itemIds: string[]}` → `{ok: true, items: FullItem[]}` (only the requested ids).
  - `xray:overlay:note:save {url, note}` → `{ok: true, note}`; `xray:overlay:note:delete {url, id}` → `{ok: true}`.
  - Refusals → `{ok: false, error: 'forbidden'}` or `{ok: false, error: 'bad request'}`.
  - `io` bundles every data accessor plus `getURL`, so the tests inject fakes.

- [ ] **Step 1: Write the failing tests**: `lookup: unarchived → [] and no model reads`; `lookup: matches archived URL across utm params and youtu.be form`; `lookup: response passes the overlay guard`; `card: refused from a content-script sender (sender.url is the page)`; `card: refused when tab url ≠ message url`; `card: allowed from our iframe on the matching tab`; `card: allowed from a tabless extension page (side panel)`; `note:save: refused from a page-embedded card on a different tab url`; `malformed payload (itemIds not array of strings, url not string) → bad request`; `flag off → []`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. Cache nothing across calls (the service worker sleeps anyway).
- [ ] **Step 4:** Run, then the full `npm test`. Expected: PASS.
- [ ] **Step 5: Commit**: `git commit -m "feat(overlay): background lookup/card/note handlers with sender checks"`

---

### Task 6: Content-script overlay: lifecycle, `<mark>` markers, pins, chip, selection capture

**Files:**
- Create: `src/content/overlay.js`, `src/content/overlay.css` (injected as a `<style>` by the script, not via the manifest)
- Modify: `src/content/index.js` (after `loadFlags()`, call `startOverlay()` when `isEnabled('inlineOverlay')`)
- Test: `tests/overlay-content.test.mjs`

**Interfaces:**
- Consumes: `buildTextIndex`, `resolve`, `locate`, `MAX_PAGE_CHARS` (Task 2); `xray:overlay:lookup` (Task 5).
- Produces (exported for Tasks 7–8 and the tests):
  - `startOverlay(env = {window, document, chrome}): {teardown(): void}`
  - `collectSegments(root: Element): Array<{ref: Text, text: string}>`: visible text nodes under the first of `article`, `[role=main]`, `body`; skips `script, style, noscript, [aria-hidden=true]` and every `.xr-ov-*` node.
  - `captureSelection(selection): {anchor: Array, quote: string} | null`: builds a `TextQuoteSelector` with 32-char prefix/suffix from `collectSegments` text; returns null if the selection lies inside `.xr-ov-*` UI.
  - Events for Task 7: `document.dispatchEvent(new CustomEvent('xr-ov:open', {detail: {itemIds, rect, mode: 'cards'|'list'|'new-note', draft?}}))`.
  - DOM: `<mark class="xr-ov-mark xr-ov-<kind>" data-xr-ov="<id>">`, pin `<span class="xr-ov-pin" data-xr-ov-ids="id1,id2">`, chip `<div class="xr-ov-chip">` with the text `X-Ray: N notes · M not located` (the "· M not located" part is omitted when M = 0) and a menu holding "Show all" and "Hide on this site" (the latter writes the hostname into `overlay_site_off`).
- Lifecycle values come from Global Constraints (URL poll, observer, re-add cap, retry, 2 MB guard).

- [ ] **Step 1: Write the failing tests** (hand-built DOM stub with `Text` nodes, `MutationObserver`, `location`): `marks wrap resolved ranges and carry data-xr-ov`; `teardown fully restores the original text nodes (innerHTML identical)`; `URL change → teardown then relookup`; `unresolved items counted in chip`; `chip omits "not located" when zero`; `over 2 MB → chip only, no marks`; `page removing marks re-adds at most 3 times`; `captureSelection ignores xr-ov UI nodes`; `site in overlay_site_off → no lookup sent`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. Wrap each resolved range per text node it covers (split text nodes with `splitText`); remember the originals for teardown via `normalize()` on parent elements. Register the note command handler: the background relays the `xray:overlay:addNote` command to the tab, and the content script answers by dispatching `xr-ov:open` with `mode: 'new-note'` and `draft` from `captureSelection` (or `{seconds}` from Task 8 on YouTube when nothing is selected).
- [ ] **Step 4:** Run, then `npm run build`. Expected: PASS / build ok.
- [ ] **Step 5: Commit**: `git commit -m "feat(overlay): content-script markers, chip, selection capture"`

---

### Task 7: Card iframe: page, bundle, manifest, positioning, CSP fallback

**Files:**
- Create: `src/overlay/overlay-card.html`, `src/overlay/index.js`, `src/overlay/index.css`, `src/content/overlay-frame.js`
- Modify: `esbuild.config.mjs` (add `'overlay'` to the extension-pages list → `dist/overlay.bundle.js`); `manifest.json` (a second `web_accessible_resources` entry `{resources: ["src/overlay/overlay-card.html", "dist/overlay.bundle.js", "src/overlay/index.css"], matches: ["<all_urls>"], use_dynamic_url: true}`; command `"xray:overlay:addNote": {"description": "Add X-Ray note to selection"}` with no suggested key); `src/background/index.js` (relay that command to the active tab as `{type: 'xray:overlay:addNote'}`); `src/content/index.js` (wire the frame)
- Test: `tests/overlay-card.test.mjs`

**Interfaces:**
- Consumes: the `xr-ov:open` event (Task 6); `xray:overlay:card` / `note:*` (Task 5).
- Produces:
  - `overlay-frame.js`: `mountFrame(env): {open(detail), close()}`. A single iframe `class="xr-ov-frame"`, `src = chrome.runtime.getURL('src/overlay/overlay-card.html')`, positioned next to `detail.rect` (clamped to the viewport). Handshake: the frame posts `{xrOv: 'ready', nonce}` to the parent; the parent replies `{xrOv: 'show', nonce, url: location.href, itemIds, mode, draft}`, posting only to the frame's `contentWindow` with `targetOrigin` = the extension origin. The nonce is generated per mount and passed in the iframe URL hash.
  - CSP fallback: if no `ready` arrives within 1500 ms, send the new `xray:overlay:openInSidePanel {url, itemIds}`. The background opens the side panel for that tab and writes `{url, itemIds}` to the `chrome.storage.session` key `overlay_sidepanel_focus`. The side panel reads that key, calls `xray:overlay:card`, and renders with `renderList`. Minimal side-panel wiring is part of this task.
  - `src/overlay/index.js`: `renderCards(items: FullItem[]): string` (pure, HTML-escaped), `renderList(items, {showRejected}): string`, `renderEditor(draft): string`. Card copy: the claim text; judgment kinds as labelled rows; extraction rows show the review-state label from Global Constraints; unlocated items carry "Could not be located on this page".
- [ ] **Step 1: Write the failing tests** for the pure renderers: `escapes HTML in claim text`; `rejected hidden unless showRejected`; `review-state labels exact`; `unlocated label exact`; and for `mountFrame` with stubs: `posts show only after ready with matching nonce`; `ignores messages from other origins`; `no ready in 1500 ms → openInSidePanel sent`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. The frame reads `url` from the `show` message but the background verifies it against `sender.tab.url` (Task 5), so a lying parent gets nothing.
- [ ] **Step 4:** `npm test`, `npm run build`, `npm run lint`. Expected: all green, lint clean.
- [ ] **Step 5: Commit**: `git commit -m "feat(overlay): extension-origin card iframe with CSP side-panel fallback"`

---

### Task 8: YouTube ticks and auto-pop

**Files:**
- Create: `src/content/overlay-youtube.js`
- Modify: `src/content/overlay.js` (on `www.youtube.com/watch`, hand items with `seconds` to `mountYouTube`; listen for `yt-navigate-finish`)
- Test: `tests/overlay-youtube.test.mjs`

**Interfaces:**
- Consumes: `LookupItem.seconds` (Task 3); the `xr-ov:open` event (Task 6).
- Produces: `mountYouTube(env, items: LookupItem[]): {teardown(): void, currentSeconds(): number | null}`. The strip is `<div class="xr-ov-yt-strip">` appended to `.ytp-progress-bar-container`, with ticks `<button class="xr-ov-yt-tick" data-xr-ov-ids>` at `left: seconds/duration*100%`. Clicking a tick sets `video.currentTime = seconds`; `timeupdate` crossing `[s-1, s+1]` dispatches `xr-ov:open` (mode `cards`, rect = player corner) once per crossing. The crossing re-arms when playback leaves the window. The card auto-closes after 8000 ms unless hovered. Waits up to 10 s for `video.html5-main-video` and a finite `duration`, then gives up and leaves the items to the list.

- [ ] **Step 1: Write the failing tests**: `tick position = seconds/duration`; `click seeks`; `auto-pop fires once per crossing and re-arms`; `youtube: ticks cleared on yt-navigate-finish before relookup`; `youtube: seconds past duration go to list`; `no player within 10 s → no strip, items listed`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm test`, `npm run build`. Expected: PASS.
- [ ] **Step 5: Commit**: `git commit -m "feat(overlay): YouTube progress-bar ticks and auto-pop"`

---

### Task 9 (conditional on Task 1): CSS Custom Highlight API as primary marker

Skip entirely if spec §9 records `CSS.highlights` as page-readable in any browser.

**Files:**
- Modify: `src/content/overlay.js`
- Test: `tests/overlay-content.test.mjs`

**Interfaces:**
- Produces: `markerStrategy(env): 'highlight' | 'mark'`, which returns `'highlight'` iff `typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight === 'function'`. Highlight names: `xr-ov-claim`, `xr-ov-judged`, `xr-ov-finding`, `xr-ov-extraction`, `xr-ov-note`. Pins and the chip are unchanged.

- [ ] **Step 1: Write the failing tests**: `uses highlights when available and adds no <mark>`; `falls back to <mark> when Highlight is undefined`; `teardown deletes all xr-ov-* highlights`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit**: `git commit -m "feat(overlay): CSS Highlight API markers with mark fallback"`

---

### Task 10: Options control, docs, reviews, live walk

**Files:**
- Modify: `src/options/index.js` + its HTML (Advanced: an `inlineOverlay` toggle and an `overlay_site_off` list with remove buttons); `docs/SMOKE_TEST.md` (new "Inline overlay" section, spec §6.3 steps); `docs/JOURNAL.md` (entry: the no-in-page-chrome reversal and why approach B); `CLAUDE.md` (Architecture item 1: content script now draws overlay markers behind `inlineOverlay`; add `src/overlay/` to the extension-pages list and the build-model entry list); `docs/THREAT_MODEL.md` (overlay trust boundary, sender checks, residual "which spans are highlighted"); `docs/USER_GUIDE.md` (feature + flag)
- Test: `tests/options-*.test.mjs` if an options test exists for flag toggles; otherwise none

- [ ] **Step 1:** Implement the Options controls, then `npm test`, `npm run build`, `npm run lint`. Expected: green.
- [ ] **Step 2:** Write the docs listed above.
- [ ] **Step 3:** Run the `architect`, `security-threat-modeler`, `schema-evolution` and `verification-engineer` skills against the branch and record each report's verdict in the PR body. Fix anything a report marks as required.
- [ ] **Step 4:** Maintainer live walk: the new SMOKE_TEST section on Edge and Firefox (Substack with claims; generic news; YouTube via captions; YouTube via transcription). Record pass/fail per row in the JOURNAL entry.
- [ ] **Step 5: Commit**: `git commit -m "docs(overlay): smoke section, journal, threat model, guide"`

## Execution record (2026-11-03)

Executed subagent-driven. Tasks 2–8 and 10 complete; Task 1 (spike) and Task 9 (Highlight API) deferred to the maintainer, along with the four discipline-skill reviews and the live SMOKE_TEST walk.

### Deferred follow-ups (final-review triage, all can-ship-deferred)

| # | Task | Item | Verdict | Reason |
|---|---|---|---|---|
| 1 | T2 | NFKC per code point; decomposed text won't compose | can-ship-deferred | Rare. It degrades to "not located" and stays listed, never dropped. |
| 2 | T2 | Exact match lacks a word-boundary check | can-ship-deferred | Only very short quotes are affected. The worst case is a mis-placed highlight, and the card is still correct. |
| 3 | T2 | Fuzzy 50-region cap filled in quote order | can-ship-deferred | Bounded cost by design. A miss falls back to "not located". |
| 4 | T2 | End offset +1 can split a surrogate pair | can-ship-deferred | Cosmetic, for emoji at a quote edge only. Teardown restores the exact nodes. |
| 5 | T2 | `quoteToSeconds` rebuilds the index per call | can-ship-deferred | Already mitigated: `assemble` memoizes per quote (`background/overlay.js:162`). |
| 6 | T2 | Quote starting inside a `[m:ss]` link uses the previous link's time | can-ship-deferred | The tick lands at most one caption paragraph early. Not data-affecting. |
| 7 | T2 | Test gaps: non-unique context fallback, locate end on separator | can-ship-deferred | Edge coverage only. The core paths are tested. |
| 8 | T2 | No separate RED run recorded | can-ship-deferred | Process note. Not observable in the product. |
| 9 | T3 | PRIVACY: `toLookupItems` copies `anchor` by reference | resolved (no action) | Folded into T5: `sanitizeAnchor` plus a polluted-anchor guard test (`overlay-guards.test.mjs:25`). |
| 10 | T3 | `detail` duplicates fields in whole records | can-ship-deferred | Internal shape only. It never leaves extension contexts. |
| 11 | T3 | No separate RED run | can-ship-deferred | Process note. |
| 12 | T4 | applyBackup/export round-trip and clear not separately tested | can-ship-deferred | Covered structurally by `WORKSPACE_CONTENT_KEYS`. Add a fixture when schema-evolution reviews. |
| 13 | T4 | Blank-line nit in `backup-merge.test.mjs` | can-ship-deferred | Style. |
| 14 | T5 | PRIVACY: lookup doesn't bind `message.url` to `sender.tab.url` | can-ship-deferred | It needs a compromised renderer, which is already documented in G8. SPA tab-URL lag makes a strict bind risky. Revisit with phase 3. |
| 15 | T5 | Card and note handlers ignore `inlineOverlay` and `overlay_site_off` | **must-fix-before-merge** | Flag-off write path and membership oracle. See I3. |
| 16 | T5 | Anchor selector strings uncapped in the background | can-ship-deferred | The only accepted senders (our card, capped at 4096, and the side panel) are ours. Bounded. |
| 17 | T5 | Global chrome stub in the overlay-background test never torn down | can-ship-deferred | Test hygiene. `node --test` isolates files per process. |
| 18 | T5 | No TDD red-first | can-ship-deferred | Process note. |
| 19 | T5 | Note on a not-yet-archived youtu.be page orphaned once archived | **must-fix-before-merge** | Part of the broader I2: notes on any unarchived page are invisible. Fix them together. |
| 20 | T6 | Re-add budget spent by unrelated mutations | can-ship-deferred | Degrades to fewer markers, per spec §5.2. Never breaks the page. |
| 21 | T6 | Observer on `pickRoot` misses a replaced `<article>` | can-ship-deferred | Same degradation. The smoke walk will show how often it happens. |
| 22 | T6 | `boundaryEntry` refuses an element container with a non-text child | can-ship-deferred | The command no-ops, with no data effect. Pair it with the M3 toast. |
| 23 | T6 | Duplicate `.xr-ov-chip` CSS rules | can-ship-deferred | Style (`overlay.js:35,39`). |
| 24 | T6 | Retry `setTimeout` not cancelled on teardown | can-ship-deferred | Guarded by `dead`, so it has no effect. |
| 25 | T6 | No TDD red-first | can-ship-deferred | Process note. |
| 26 | T6 | `overlay.js:6` header still mentions `xr-ov:open` | resolved (no action) | The header now says `env.onOpen` (`overlay.js:5-6`). |
| 27 | T7 | Frame positioned once, not re-placed on scroll or resize | can-ship-deferred | Cosmetic. `position:fixed`, and any page click closes it. |
| 28 | T7 | New `console.warn` in the side panel; `index.css` uses 2-space indent | can-ship-deferred | The file already uses `console.warn`. CLAUDE.md bans bare `console.log`, not `warn`. |
| 29 | T7 | Stale test title "dispatch xr-ov:open"; esbuild header says "seven bundles" | can-ship-deferred | Cosmetic. A good one-line fix in the I1–I4 round. |
| 30 | T7 | Side panel can't self-open without a gesture; read-only fallback lacks unlocated marking | can-ship-deferred | A browser constraint. The toast tells the user, and the focus key persists. |
| 31 | T8 | Tick mousedown/pointerdown not stopped | can-ship-deferred | YouTube's scrubber seeks to about the same pixel, so the result is equivalent. |
| 32 | T8 | `yt-navigate-finish` re-applies when the URL is unchanged (chip flicker) | can-ship-deferred | Cosmetic. `gen` guards correctness. |
| 33 | T8 | Auto-close test stubs the frame; no RED run | can-ship-deferred | Coverage-quality note. The smoke walk covers the live path. |
| 34 | T8 | NaN-duration drop doesn't call `onLocated`; a `layout()` throw re-polls | can-ship-deferred | Before the first layout, `giveUp` bounds it at 10 s. After that, a 2 s recheck that throws is cheap and logs only in debug. |
| 35 | T10 | THREAT_MODEL §6 2026-08-09 row says the nip07 WAR was removed | can-ship-deferred | Docs consistency. Add a one-line "restored in a3a8e02" note so G8's premise stands. |
| 36 | T10 | CLAUDE.md "src/ is never loaded directly except…" now inexact | can-ship-deferred | The card loads `dist/overlay.bundle.js`. Only the HTML and CSS come from `src/`, as with every other page shell. |
| 37 | T10 | USER_GUIDE 3.8 states same-hash-with-overlay as fact; only unit-tested | **must-fix-before-merge** | It is currently false for live-DOM capture paths. Fix I1, or soften the sentence. |

### Parked after the final fix wave

- Parked — suspend() teardown steps not individually wrapped; a throw in stopYouTube leaves marks during that one capture — Ruling: real, deferred; overlay-strip clone stripping is the second line of defence for Readability/snapshot paths, and the page recovers on resume — cost if wrong: one capture with pin text in Markdown.
- Parked — capture triggered before startOverlay finishes init runs unsuspended — Ruling: real, narrow window, deferred — cost if wrong: same as above, rarely.
- Parked — THREAT_MODEL G8 "not what" wording outdated by I4 pin labels (page can read review-state/judgment-kind labels) — Ruling: real doc residual, hand to security-threat-modeler review — cost if wrong: threat model understates by-design exposure.
