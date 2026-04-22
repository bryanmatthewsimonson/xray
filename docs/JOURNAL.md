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
