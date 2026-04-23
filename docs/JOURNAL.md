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
