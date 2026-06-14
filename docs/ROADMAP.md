# X-Ray — Migration Roadmap (v4.2 parity)

X-Ray is a Chrome/Firefox MV3 WebExtension port of the
`nostr-article-capture` userscript. The original port started from
userscript **v1.8.0**; the userscript has since been rewritten twice
and is now at **v4.2.0**. This document is the single source of truth
for what has landed in the extension and what remains — organized by
the phase structure laid out in [issue #20](https://github.com/bryanmatthewsimonson/xray/issues/20).

Related docs:

- [`docs/JOURNAL.md`](JOURNAL.md) — chronological log of bugs,
  design decisions, and external platform changes. Worth a read
  when a capture target breaks or a design choice needs context.

Per-phase GitHub issues are the working trackers:

| Phase | Issue | Title |
|---|---|---|
| 0 | [#11](https://github.com/bryanmatthewsimonson/xray/issues/11) | Teardown + infrastructure rebuild |
| 1 | [#12](https://github.com/bryanmatthewsimonson/xray/issues/12) | Real NOSTR crypto (secp256k1 / BIP-340 / bech32 / NIP-44) |
| 2 | [#13](https://github.com/bryanmatthewsimonson/xray/issues/13) | Capture parity for article-shaped content |
| 3 | [#14](https://github.com/bryanmatthewsimonson/xray/issues/14) | Easy-tier platform handlers (Substack, YouTube, Twitter/X, generic) |
| 4 | [#15](https://github.com/bryanmatthewsimonson/xray/issues/15) | Entity system (types, tagger, browser, aliases, kind-0 profiles) |
| 5 | [#16](https://github.com/bryanmatthewsimonson/xray/issues/16) | Claims + evidence linking |
| 6 | [#17](https://github.com/bryanmatthewsimonson/xray/issues/17) | Entity sync over NIP-78 with NIP-44 v2 encryption |
| 7 | [#18](https://github.com/bryanmatthewsimonson/xray/issues/18) | Archive reader (IndexedDB cache + paywall detection + relay reconstruction) |
| 8 | [#19](https://github.com/bryanmatthewsimonson/xray/issues/19) | Hard-tier platforms (Facebook / Instagram / TikTok) |

Ordering rationale and non-goals live in the roadmap issue; this doc
focuses on *what is done, what's next, and what is deliberately out of
scope for a given phase*.

---

## Status snapshot

```
Phase 0  ████████████████████  complete
Phase 1  ████████████████████  complete
Phase 2  ████████████████████  complete
Phase 3  ████████████████████  complete — Substack + YouTube + Twitter + generic comment extractor
Phase 4  ████████████████████  complete — entity model + tagger + kind-0 publish + side panel
Phase 5  ████████████████████  complete — claims + evidence links + relay query
Phase 6  ████████████████████  complete — entity sync via NIP-78 + NIP-44 v2
Phase 7  ████████████████████  complete — archive reader (IDB cache + paywall detection + relay reconstruct)
Phase 8  ████████████████████  complete — 8a infra + TikTok + Instagram + Facebook shipped
Phase 9a ████████████████████  complete — URL-metadata data model (annotations / fact-checks / topic-trust) + NIP draft; data-model only, UI in 9b+
Phase 9  ████████████████████  complete — identity layer: platform accounts + YouTube comments + manual account↔entity linking

Cleanup  ████████████████████  complete — v0.5.x post-parity cleanup (Phases A–E):
                                de-FAB / one capture surface, settings consolidation,
                                client-tag unify, nac-→xr- rename, roadmap + docs refresh
Phase 10 ████████████████████  complete — claim tracking (thin entity-centric
                                claims). 10.1–10.4 shipped; 10.5 (metadata reframe)
                                superseded by Phase 11 (see below)
Phase 11 ████████████████████  complete — assessments & contradictions
                                (docs/ASSESSMENTS_DESIGN.md). 11.1–11.6 +
                                publishing (11.7) + collaboration (11.8)
                                shipped; case smoke-runs pending
Phase 12 ████████████████████  complete — "My Archive" personal data
                                portal (docs/PORTAL_DESIGN.md). 12.1–12.7
                                shipped incl. adversarial-review fixes;
                                §Phase 12 smoke-run pending
Phase 13 ███░░░░░░░░░░░░░░░░░  in progress — epistemic audits
                                (docs/EPISTEMIC_AUDIT_DESIGN.md; design
                                accepted 2026-06-11, all eight review
                                questions answered, the recovered
                                philosophy vendored normatively at
                                docs/PHILOSOPHY.md). Kinds 30056–30061
                                confirmed; implementation slices 13.1+
                                under way
```

Parity with the v4.2 userscript is reached; the project now operates as a
pure WebExtension and is moving past parity toward the claim-tracking goal.

---

## Phase 0 — Teardown + infrastructure rebuild ✅

**Status:** complete. Commits `52ed35c`, `b85791b`, `0dd1cc7`.

Landed:

- Removed the v1 URL-metadata UI (trust badges, annotation highlights,
  `kind 32123..32144` machinery) — explicit decision to skip
  forward to the v4.2 data model rather than port v1 features
  piecemeal.
- esbuild bundling with ES modules, `src/` restructured into
  `content/`, `background/`, `reader/`, `popup/`, `options/`,
  `sidepanel/`, `shared/`, `page/`. (`popup/` was later removed when
  the toolbar-icon click was repurposed to toggle the FAB directly —
  see the Unreleased section of `CHANGELOG.md`.)
- Relay client lives in the background service worker (`src/background/index.js`)
  — relay WebSockets survive tab navigation and aren't subject to
  page CSP.
- Content scripts split into MAIN-world (`nip07-bridge.js`) and
  ISOLATED-world bundles.
- Firefox compatibility via `browser_specific_settings.gecko`.

Not done under this phase (tracked separately):

- End-to-end smoke test in Chrome and Firefox — [#1](https://github.com/bryanmatthewsimonson/xray/issues/1).
- Replace placeholder icons — [#6](https://github.com/bryanmatthewsimonson/xray/issues/6).

---

## Phase 1 — Real NOSTR crypto ✅

**Status:** complete. Commit `e179346`.

Landed under `src/shared/crypto.js`:

- secp256k1 / BIP-340 Schnorr signatures, verified against the BIP-340
  test vectors.
- NIP-01 event hashing.
- bech32 encoding / decoding with tampering-reject tests for npub /
  nsec.
- NIP-44 v2 encryption: HKDF conversation key, symmetric Alice↔Bob,
  HMAC tamper detection, wrong-version-byte rejection.
- ECDH shared secret derivation.

The previous v1 stub had unconditional-true signature verification and
fake bech32 — all of that is gone.

Tests: `tests/*.test.mjs`, 18 passing, runs on `npm test`.

---

## Phase 2 — Capture parity for article-shaped content ✅

**Status:** complete. Commits `b69596c`, `5eab5a9`, `864c307`.

Landed:

- **`content-detector.js`** — URL + DOM-based platform detection,
  exports a platform id consumed by the handler registry.
- **`content-extractor.js`** — Mozilla Readability + Turndown, plus
  a lightweight `markdownToHtml()` forward renderer for preview and
  the initial reader view.
- **`event-builder.js`** — `buildArticleEvent()` (kind 30023),
  `buildCommentEvent()` (kind 30041), `buildClaimEvent()` (kind
  30040), `buildEntitySyncEvent()` (kind 30078 stub),
  `buildEntityRelationshipEvent()` (kind 32125 stub),
  `buildEvidenceLinkEvent()` (kind 30043 stub),
  `buildPlatformAccountEvent()` (kind 32126).
- **Reader page** (`src/reader/`) — full extension-page reader with
  Reader / Markdown / Preview tabs, contenteditable metadata fields,
  publish button.
- **FAB → reader round-trip** — content script extracts, stashes the
  article in `chrome.storage.session` keyed by a UUID, opens the
  reader with `?id=<uuid>`. Publish flow:
  1. Reader requests NIP-07 pubkey from source tab via SW.
  2. Source tab signs unsigned event via its `window.nostr` bridge.
  3. SW publishes signed event to configured relays with a 200ms
     inter-event throttle.
  4. Reader shows per-relay rollup toast + progress bar.
- **Archive-reader inverse function** — `reconstructArticleFromEvent()`
  already stubbed for Phase 7.

---

## Phase 3 — Easy-tier platform handlers ✅

**Issue:** [#14](https://github.com/bryanmatthewsimonson/xray/issues/14). Complete — Substack, YouTube
(incl. Shorts), Twitter/X, and the generic comment extractor all shipped.

### 3a — Substack handler ✅

Commits `2e6531a`, `03c3516`, `219d0a4`, `8ce5646`, `0f7ee49`, `22abdc9`.

Landed:

- **`platforms/substack.js`** — `enrichArticle()` layers Substack
  metadata onto Readability's extraction (`article.substack.{postId,
  handle, apiOrigin, authorBio, publicationName}`, `article.engagement.{likes,
  restacks, comments}`).
- **`platforms/substack-api.js`** — API-based capture (`/api/v1/posts/<slug>`,
  `/api/v1/post/<id>/comments`) via background SW with
  `credentials: 'include'` so the user's Substack session unlocks
  paywalled bodies automatically.
- **Custom-domain Substacks** — slug-based endpoint works for
  `thefp.com` and similar where there's no `post_id` in the HTML.
- **`body_json` comments fallback** — Substack migrated from `body`
  to a tiptap doc; `extractTextFromTiptap()` handles both shapes.
- **Reader UI** — comment tree below the article, opt-in "Include
  all N in publish" toggle, each non-deleted comment publishes as
  kind-30041 with `d: cmt:substack:<id>`, reply-to threading
  resolved during sequential publish.

Deferred (not blocking Phase 4):

- Substack Notes (different URL shape + data model).
- Podcast episodes.
- Per-comment inclusion toggle.
- Batch-signing UX — one NIP-07 prompt per comment today; will
  leverage `LocalKeyManager` once Phase 4 lands entity keypair UX.

### 3b — YouTube handler ✅

Commits `bbc7ac3` → `c8a07e9` (12 commits covering the multi-round
diagnosis and ship of C1, C2, C3).

Landed under `src/shared/platforms/youtube.js` + reader/event-builder
extensions:

- **Detection** — matches `(www|m).youtube.com/watch?v=…`.
- **Metadata synthesis** — parses the in-page
  `ytInitialPlayerResponse` blob for `videoDetails` (title,
  channel, duration, view count, keywords, thumbnails) and
  `microformat` (publishDate, category, uploadDate, isLive).
- **Language selection rule** — capture **origin language ∪ user
  language** × **both kinds (human + ASR)**. Origin detected via
  the ASR track's own `languageCode`.
- **Transcript acquisition** — cascades three strategies:
  1. Signed `/api/timedtext` URL via SW → page-world fetch injection.
     *Expected to fail* since mid-2024 — YouTube returns HTTP 200
     with 0-byte body under PO-token gating.
  2. Fetch-hook into `/youtubei/v1/get_transcript` POST response —
     catches YouTube's own InnerTube call when it fires.
  3. **DOM scrape of `transcript-segment-view-model` elements** —
     the reliable primary path as of late 2025. Text-walk handles
     the element-rename from `ytd-transcript-segment-renderer`,
     plus filters out screen-reader duration fluff (`9 seconds`,
     `1 minute, 5 seconds`) without dropping the visible timestamp
     (which lives inside `aria-hidden="true"` for a11y reasons).
- **Kind-30023 tags** — full structured emission:
  `video_id`, `duration`, `channel`, `channel_id`, `category`,
  `view_count`, `origin_language`, `user_language`, `is_live`,
  `upload_date`, one `transcript_lang` row per captured track
  (encoded as `<lang>:<kind>:<role>`). Legacy `videoMeta` shape
  also populated for back-compat with pre-C2 tooling.
- **Reader layout** — dedicated `<section class="xr-video">`
  between the byline row and the body: 16:9 thumbnail → YouTube
  click-through with play-triangle overlay and duration badge,
  plus chip row (channel, views, category, LIVE, one chip per
  captured transcript language with human/auto marker — origin
  language gets an accent pill).
- **Clickable transcript timestamps** — each paragraph begins
  with a `[0:05](…&t=5s)` markdown link. NOSTR clients render it
  as a real `<a>` so readers can jump into the source video at
  any cited passage. Turndown preserves the anchors through the
  reader's HTML→Markdown publish roundtrip.
- **Prose paragraph coalescing** — `coalesceCuesIntoParagraphs()`
  groups consecutive cues into paragraphs of ~380–900 characters,
  breaking at sentence boundaries. Per-cue data is preserved on
  `article.youtube.transcripts[].events` (in-memory structure);
  only the rendered markdown body uses paragraph form.

Deferred (revisit after Phase 4 / 7):

- Per-cue timestamp archival in the relay event itself (would
  inflate tag count unsustainably for long videos; either a
  sibling event kind or a collapsed block inside content).
- Livestream chat replay capture.
- Short-form (`/shorts/…`) URL shape.
- Channel-page and playlist captures.

### 3c — Twitter/X handler ✅

`src/shared/platforms/twitter.js`. Status detail pages
(`/<handle>/status/<id>`) only — profile, search, and list pages are
detected and rejected because they don't have a single focal tweet
to anchor on. Extracts:

- Focal tweet metadata: id, author (handle / display name / profile
  / avatar), text, timestamp, engagement (replies / retweets / likes
  / views), media URLs.
- Thread detection: every `<article data-testid="tweet">` in the DOM
  by the focal tweet's author becomes a thread tweet. Sorted by
  snowflake-id ascending (chronological).
- Replies by *other* users → opt-in `comments` array consumed by the
  reader's existing kind-30041 batch publish (same shape Substack
  uses).
- Tags emitted on the kind-30023: `tweet_id`, `author_handle`,
  `thread: 'true'`, `thread_length` (legacy `tweetMeta` already wired
  in event-builder.js:179) plus a richer `article.twitter` block for
  downstream consumers.
- DOM-shape resilience: `data-testid` selectors throughout (more
  stable than class names but still subject to X's UI churn — the
  YouTube-arms-race pattern in `JOURNAL.md` applies). Loud diagnostic
  if the focal tweet doesn't render within 2s of the click.

Deferred to a follow-up:

- Quoted tweet recursive extraction (rendered as a markdown link to
  the quoted tweet for now).
- Polls / spaces / community notes.

### 3d — Generic comment extractor ✅

`src/shared/platforms/comment-extractor.js`. Heuristic DOM walker
for any article-shaped page that doesn't have a dedicated handler.
Three tiers:

1. **Disqus** — detected by the `<div id="disqus_thread">` shell.
   Comments live in a cross-origin iframe so we can't actually scrape
   them; we surface a `_commentsNote` explaining the limitation so
   the user knows the platform uses Disqus.
2. **WordPress** — `ol.comment-list` / `commentlist` containers with
   `<li class="comment">` children, recursive into `ol.children`
   nested replies. Picks up author, profile URL, avatar, datetime,
   and content.
3. **Generic class-name-based** — any container with class names
   matching `comment-list` / `comments-list` / `comment-thread` /
   `comment-section`, scored by direct-child comment-shaped count.

Output matches the same `Comment` shape Substack and Twitter use, so
the reader's existing comment-tree renderer + opt-in kind-30041
batch publish consume it without changes.

Wired into `enrichArticleForPlatform` so any platform that doesn't
populate `article.comments` itself gets a generic pass. No-op on
pages without a recognizable comment system.

### Phase 3 exit criteria — all ✅

- ✅ Twitter thread capture produces a kind-30023 event with all
  thread tweets concatenated, `thread: 'true'`, `thread_length: N`.
- ✅ Generic comment extraction picks up WordPress / generic
  class-named comment threads. Disqus is detected and reported as
  cross-origin-iframe-blocked (X-Ray can't read it from the host
  page; a future polish could route through a SW-side Disqus API
  fetch).

---

## Phase 4 — Entity system ✅

**Issue:** [#15](https://github.com/bryanmatthewsimonson/xray/issues/15) (complete). Commits `c57d5e3`, `c79cd74`, `3e05254`,
`7e857af`, `338f7e9`.

### Data model + storage (C1)

- Four entity types: `person` 👤, `organization` 🏢, `place` 📍, `thing` 🔷.
- Each entity gets its own secp256k1 keypair via `LocalKeyManager`
  (stored under `local_keys` at keyName `entity:<id>`). `EntityModel.get`
  transparently merges the keypair into the returned record.
- Deterministic hash-based IDs:
  `entity_<sha256(type+':'+normalized_name).slice(0,16)>` — normalization
  handles whitespace + case so disambiguation lives in the alias
  graph, not in string-matching.
- `canonical_id` with cycle detection + graph flattening.
- Storage key: `entities` in `chrome.storage.local`.
- 14 unit tests under `tests/entity-model.test.mjs` (32/32 total).

### Reader text-selection tagger (C2)

- Select text in `.xr-article__body` → popover opens with autocomplete
  search (pre-filled from selection) + "New as: 👤 🏢 📍 🔷" row.
- Pick existing → tag that entity. Pick a type → create entity with
  the search-box value as name, tag with it.
- Tagged text wrapped in
  `<span class="xr-entity xr-entity--<type>">` with type-coded colors.
  Rehydrate on reload best-effort by first-text-match.

### Kind-0 profile publishing (C4)

- On article publish, `resolveEntitiesToPublish` de-dups tagged
  entities by id, skips ones with `publishedAt >= updated`, and
  auto-enqueues any unpublished canonicals an alias might refer to
  (so `refers_to` tags don't dangle).
- Each entity signs its own kind-0 via
  `LocalKeyManager.signEvent(event, 'entity:<id>')` — no NIP-07
  prompt, stable pubkey, NIP-01 replaceable-event semantics re-emit
  on edits.
- `EntityModel.markPublished` records `publishedAt` + `publishedEventId`
  without bumping `updated`, so the re-publish gate works.

### Side panel entity browser (C3)

- List view: type-filter chips / search / entity rows with 🌐
  published indicator and → alias chevron. Footer with count +
  export/import.
- Detail drill-in: editable name/description/nip05, canonical link
  picker (modal), keypair block (npub always copyable, nsec behind
  reveal), publish status, delete with alias-blast-radius confirm.
- `chrome.storage.onChanged` cross-tab sync.
- Opens from: FAB header entity-browser icon, right-click menu's
  "Entity Browser" item, Options page header quick-action, reader
  header "👤 Entities" button, or Chrome's own sidepanel toolbar.

### Exit criteria — all satisfied

Per issue #15:

- ✅ Creating a new Person entity generates a valid keypair (real
  secp256k1, verified by Phase 1 tests).
- ✅ Tagging an entity on an article publishes kind-30023 with
  `p`/`person` tags + a kind-0 for the entity.
- ✅ Aliasing A → B: A's kind-0 includes `refers_to` → B's npub;
  tagging A also p-tags B.
- ✅ Side panel Entity Browser lists all entities with type filters
  and search.

### Deferred (tracked separately)

- **Entity auto-suggest** — scan article content for known entity
  names, rank by frequency, offer one-click tag. Polish for a
  future iteration; not in the exit criteria.
- **Entity-relationship events (kind-32125)** — `buildEntityRelationshipEvent`
  is already stubbed in event-builder; emission path belongs with
  Phase 5's claims work, not here.
- **Batch kind-0 re-publish from the side panel** — today an
  edited entity re-publishes on the next article capture. An
  explicit "Push profile now" button from the detail view is a
  small follow-up.

---

## Phase 5 — Claims + evidence linking ✅

**Issue:** [#16](https://github.com/bryanmatthewsimonson/xray/issues/16) (complete). Commits `73b1cae`, `c92bce7`,
`5220719`, `d5703e7`, `cd966e2`.

### Claim data model (C1)

- `src/shared/claim-model.js` — deterministic hash-based ids
  (`claim_<sha256(source_url + '|' + normalized_text).slice(0,16)>`);
  CRUD plus `getBySourceUrl` (crux-first sorted). Four types
  (factual / causal / evaluative / predictive), four attributions
  (direct_quote / paraphrase / editorial / thesis), crux + confidence
  (0-100 rounded to int). Immutable id/text/source_url under
  `update()`. `markPublished` doesn't bump `updated` — matching
  entity-model re-publish-gate semantics.
- 10 unit tests under `tests/claim-model.test.mjs`.

### Reader claim extractor UI (C2)

- `src/reader/claim-extractor.js` — `openClaimModal` with 4-button
  type row, crux + confidence slider, attribution dropdown,
  predicate + S/P/O pickers (entity-or-freetext with live autocomplete
  against `EntityModel.search`), optional claimant + quote-date.
- Entity-tagger popover gains a "📋 Add as claim" row that hands off
  the selected text + surrounding paragraph as `context`.
- Claims bar below the article body, one card per claim with triple,
  claimant, attribution, published dot, edit/delete/link buttons.
  Cruxes sort first.
- Visual marks on claim text — `.xr-claim.xr-claim--<type>` with
  dashed type-coded underline (amber solid for crux).

### Kind-30040 + kind-32125 publish wiring (C3)

- Publish flow batch-step 4: claims signed by the user's NIP-07.
  `resolveClaimsToPublish` + `updated > publishedAt` gate.
  `buildClaimEvent` fed a pre-fetched `EntityModel.getAll()` dict so
  claimant / subject / object IDs resolve into `p` + name tags
  without per-claim round-trips.
- Batch-step 5: entity-relationship events (kind-32125). Derived
  from claims' participants, de-duped by `{entityId}:{url}:{relType}`
  (the addressable `d`-tag coord). Publishes kind-32125 once per
  unique coord per session; replaceable-event semantics make
  redundant emits cheap.
- Entity-resolution step now unions tagged-entity ids with
  claim-referenced ids so `p` tags don't dangle.

### Evidence linking (C4)

- `src/shared/evidence-linker.js` — deterministic hash-based ids
  (`link_<sha256(source + '|' + target + '|' + relationship).slice(0,16)>`),
  CRUD, `getForClaim` (both endpoints), `deleteForClaim` (called on
  claim-delete cascade). Three relationship types: supports /
  contradicts / contextualizes. 10 unit tests.
- `openEvidenceLinkModal({ sourceClaim, candidates })` — picks target
  claim from the article's other claims, picks relationship, optional
  note.
- Each claim card shows its evidence-link block with per-link ✕.
- Batch-step 6: kind-30043 events. `resolveEvidenceLinksToPublish`
  filters to links whose both endpoints are on this article; same
  `updated > publishedAt` gate.

### "View others' claims" (C5)

- `NostrClient.queryRelays(relays, filter, timeoutMs)` — one-shot
  REQ per relay, de-duped events + per-relay stats, all-EOSE or
  timeout resolves, sends CLOSE before returning.
- `xray:relay:query` SW handler.
- 🌐 button in the claims-bar header → `openOthersClaimsModal` sends
  `{ kinds: [30040], '#r': [url], limit: 200 }`. Grouped by author
  npub; each card reconstructs from the event's tags.

### Exit criteria — all ✅

Per issue #16:

- ✅ Selecting text → claim → Factual → save creates a claim with a
  valid `claim_<hash>` id.
- ✅ Marking a claim as crux with confidence 85 publishes a kind-30040
  with `["crux","true"]` + `["confidence","85"]`.
- ✅ Creating an evidence link between two claims publishes a
  kind-30043 with the right relationship tag.
- ✅ Claims bar in the reader view shows the local claims.
- ✅ 🌐 "View others' claims" button queries relays for kind-30040
  events filtered by the article URL.

### Deferred (tracked separately)

- **Evidence-link edit UX** — today the modal creates-only; delete +
  recreate is the path for changing note / target / relationship.
  `EvidenceLinker.update({ note })` already supports patching notes.
- **Cross-article evidence links** — the model stores arbitrary claim
  id pairs, but the reader UI only surfaces same-article candidates.
  A "paste claim id" path or relay-query-based picker is a follow-up.
- **"Import others' claim" affordance** — the "Others' claims" modal
  is read-only. A one-click local-clone action could follow if the UX
  warrants.
- **Live subscriptions** — `queryRelays` is point-in-time. A sibling
  `subscribeRelays()` for persistent subscriptions can slot in when
  needed (Phase 7 archive reader, maybe).

---

## Phase 6 — Entity sync over NIP-78 + NIP-44 v2 ✅

**Issue:** [#17](https://github.com/bryanmatthewsimonson/xray/issues/17) (complete). Commit `9c13598`.

### Mechanism

- Kind-30078 (NIP-78 app-specific data) per entity, `d: <entity_id>`.
- Content = NIP-44 v2 ciphertext of the full entity payload including
  its per-entity keypair.
- Encryption is encrypt-to-self via ECDH(userPrivkey, userPubkey); the
  resulting conversation key never leaves the user's device.
- Tags: `['d', entityId]`, `['entity-type', type]`, `['L', 'nac/entity-sync']`,
  `['l', 'v1', 'nac/entity-sync']`, `['client', 'nostr-article-capture']`.

### Shipped

- `src/shared/entity-sync.js` — `pushEntities`, `pullEntities`,
  `clearRemote`, `serializeEntityForSync`, `deserializeEntityFromSync`.
  7 unit tests under `tests/entity-sync.test.mjs` (59/59 total).
- Side-panel sync section: collapsible `<details>` at the bottom of
  the entity browser. Two states — "needs identity" (nsec input +
  Generate new button) and "configured" (npub display with copy,
  nsec reveal, Push / Pull / Clear / Forget buttons + inline log).
- User identity stored in `LocalKeyManager` at the reserved key
  name `xray:user`, separate from the per-entity keys.
- Last-write-wins merge on the payload's `updated` field (not the
  relay-side `created_at`) — the user's intent timestamp is the
  authority.
- `clearRemote` publishes NIP-09 delete requests chunked into
  100-e-tags batches; not all relays honor NIP-09 but partial
  success is fine.

### Exit criteria

- ✅ Push → pull same device is idempotent (`unchanged` counter
  increments, `added` + `updated` stay at zero).
- ✅ Export nsec on A, import on B, pull: B has the same registry.
- ✅ Malformed event rejected cleanly (`malformed` counter increments).
- ⏳ NIP-04 read-path fallback for pre-v4 userscript events —
  deliberately not implemented (MV3 port, no pre-existing users).
  Easy to add later if needed.

### Known constraints (deferred)

- Phase 6 needs the user's raw privkey to encrypt. NIP-07 doesn't
  expose that. A later polish pass can route through
  `nip44_encrypt` / `nip44_decrypt` on the NIP-07 signer when
  available (Alby, nos2x-fox both support these) to avoid an nsec
  on disk.
- CRDT-shaped conflict resolution (collaborative entity editing by
  multiple authors) is out of scope — Phase 6 targets a single
  user's own devices.

---

## Phase 7 — Archive reader ✅

**Issue:** [#18](https://github.com/bryanmatthewsimonson/xray/issues/18) (complete). Commit `TBD`.

### Shipped

- **`src/shared/archive-cache.js`** — IndexedDB wrapper keyed by
  `urlHash = sha256(Utils.normalizeUrl(url)).slice(0, 16)`. Store:
  `articles` (keyPath: `urlHash`, indexes on `lastAccessed`,
  `publishedToRelay`, `cachedAt`). API: `saveArticle`,
  `getArticle`, `hasArticle`, `deleteArticle`, `listArticles`,
  `count`, `clear`, `evictIfNeeded`. LRU eviction tiered by
  `publishedToRelay` (published first — relay is the backup; a lost
  published entry is re-fetchable), then by `lastAccessed`.
  MVP budget: 500 entries; byte-budget lands later if usage
  warrants. 8 unit tests under `tests/archive-cache.test.mjs` via
  `fake-indexeddb`.

- **Cache-on-load + cache-on-publish wire-ups in the reader** — every
  reader-opened article is written to IDB with `publishedToRelay:
  false`. On first-relay-accept during publish, the record is
  upserted with `publishedToRelay: true` + the signed event id.

- **Paywall detection** — `ContentExtractor.detectPaywall(article)`
  combines four signals:
  1. JSON-LD `isAccessibleForFree: false` (highest confidence, 0.95)
  2. DOM selector match on known paywall vendors + generic
     `.paywall` / `[class*="paywall"]` shells (0.7 if visible)
  3. Truncation ratio: extracted text < 25% of `body.innerText`
     length (0.5) or < 40% borderline (0.3)
  4. "Tiny body + headline present" sanity check (0.4)

  Returns `{ paywalled, confidence, signals[] }`. `paywalled: true`
  at confidence ≥ 0.5 — requires one strong signal or two weak ones
  to avoid false positives on short articles.

- **Fallback flow** — on reader mount, if the capture looks tiny
  or a longer cached copy exists for the same URL:
  - Try local `ArchiveCache.getArticle(url)` first. If the cached
    body is ≥ 1.3× longer than the current capture, offer it.
  - Otherwise, message the SW with `xray:archive:reconstruct` —
    the SW queries configured relays for
    `{ kinds:[30023], '#r':[url], limit:20 }`, picks the most-recent
    event, and returns the reconstructed article via
    `EventBuilder.reconstructArticleFromEvent` (already in place
    since Phase 2).
  - A banner above the main reader offers "Load archive" / "Keep
    capture". Load swaps the body + markdown draft and re-renders.

- **FAB badge** — the content script's FAB shows a 📦 badge when
  `ArchiveCache.hasArticle(currentUrl)` returns true, so the user
  sees "this is already archived" before clicking in.

### Exit criteria

- ✅ Publishing caches locally with `publishedToRelay: true`.
- ✅ Visiting a paywalled URL that has a cached copy opens via the
  reader (with the archive banner offering the cached body).
- ✅ Visiting a URL with no local cache but a relay-hosted kind-30023
  reconstructs and offers to open it.

### Deferred

- **Byte-budget eviction** — entry-count MVP is fine for typical
  usage; replace with a size-aware pass when archive > 100MB.
- **In-reader archive browser** — a "browse my archive" surface
  (maybe in the side panel) that lists cached articles with search.
  Today the cache is opaque to the user except through per-URL
  lookups and the banner.
- **Manual "archive this URL" action from the FAB** — today the
  cache only fills via reader open + publish. A direct archive
  action could slot in later.

---

## Phase 8 — Hard-tier platforms ✅

**Issue:** [#19](https://github.com/bryanmatthewsimonson/xray/issues/19). All three platforms + anti-obfuscation
infrastructure shipped. See per-day entries in `JOURNAL.md` for
architectural decisions and bug history.

### Anti-obfuscation infrastructure (8a) ✅

- `src/shared/html-snapshot.js` — subtree clone with script/iframe
  stripping + bounded truncation + SHA-256.
- `src/shared/screenshot.js` + background-side `handleScreenshotCapture` —
  element-cropped screenshots via `tabs.captureVisibleTab` + DPR-aware
  crop math.
- `src/page/api-interceptor.js` — MAIN-world fetch + XHR hook,
  configurable URL/header patterns. Responses posted back via
  nonce-tagged `postMessage`.
- `src/shared/api-hook-buffer.js` — ISOLATED-world ring buffer
  (MAX_EVENTS=50) queried synchronously by platform handlers at
  capture time.

Not shipped and deliberately deferred — the primary paths turned out
to be sufficient:
- React Fiber traversal helper (unused so far).
- `shared/module-hook.js` for FB's `__d()` registry (unused so far).
- Click-to-select overlay (the `[role="article"]` + largest-image
  heuristic landed instead).

### Per-platform

- ✅ TikTok (`src/shared/platforms/tiktok.js`) — `__UNIVERSAL_DATA_FOR_REHYDRATION__`
  / SIGI / `__NEXT_DATA__` triple-shape SSR parse + screenshot.
- ✅ Instagram (`src/shared/platforms/instagram.js`) — og-meta primary +
  GraphQL interception for carousels + profile lookup + DOM scrape
  fallback + screenshot. The post item's inline `.user` is a 4th
  handle-resolution fallback when og/URL/description all come up empty.
- ✅ Facebook (`src/shared/platforms/facebook.js`) — URL grammar covers
  `/<user>/posts`, `/<user>/videos`, `/reel`, `/watch`, `/permalink.php`,
  `/story.php`, `/share/p|v|r`, `/photo`, and `/groups/.../posts`.
  GraphQL buffer walk primary (for private posts), og-meta secondary,
  DOM scrape tertiary, screenshot evidence always.

### Platform-review gate

Before starting Phase 8, confirm FB/IG/TikTok obfuscation patterns
haven't shifted enough since v4.2's userscript version to invalidate
the existing code. Fresh recon is cheaper than porting stale code.

### Extension-native wins worth exploiting

- `declarativeNetRequest` can inspect GraphQL responses at the network
  layer without patching page `fetch`.
- `chrome.debugger` API is a cheat code for especially-hostile
  targets; high-friction auth prompt though, so only a last resort.

---

## Cross-cutting issues (not phase-scoped)

See the [full issue list](https://github.com/bryanmatthewsimonson/xray/issues) for up-to-date state. Headline open items:

| Issue | Priority | What |
|---|---|---|
| [#1](https://github.com/bryanmatthewsimonson/xray/issues/1) | P0 | ✅ End-to-end smoke test (`docs/SMOKE_TEST.md` + agent-runnable subset) |
| [#2](https://github.com/bryanmatthewsimonson/xray/issues/2) | P1 | ✅ `xr_signing_state` written by content script |
| [#3](https://github.com/bryanmatthewsimonson/xray/issues/3) | P1 | ✅ Publish success/failure surfaces as native OS notifications |
| [#6](https://github.com/bryanmatthewsimonson/xray/issues/6) | P2 | ✅ Real X-Ray icons + `npm run icons` rasterization script |
| [#7](https://github.com/bryanmatthewsimonson/xray/issues/7) | P2 | ✅ Opt-in migration from nostr-article-capture userscript storage |
| [#8](https://github.com/bryanmatthewsimonson/xray/issues/8) | P3 | ✅ Release pipeline: CHANGELOG, version bump, tagged releases |
| [#9](https://github.com/bryanmatthewsimonson/xray/issues/9) | P3 | ✅ Tests for EventBuilder, Utils.normalizeUrl, sync deserializer, migration importer (96 tests) |
| [#10](https://github.com/bryanmatthewsimonson/xray/issues/10) | P3 | ✅ Verified `strict_min_version: "128.0"` (3 APIs land there; matches FF ESR) |

---

## Post-parity cleanup (v0.5.x, Phases A–E) ✅

Once parity was reached the codebase carried userscript-era cruft and a
two-surface capture model. A staged cleanup (one reviewable PR per phase)
removed it, in preparation for the claim-tracking work:

- **A — De-FAB / one capture surface.** Removed the in-page floating action
  button and the legacy in-page capture panel. Every trigger (toolbar
  icon, `Ctrl/Cmd+Shift+X`, right-click) now sends `xray:capture` and opens
  the page directly in the reader. `src/content/ui.js` 1017 → ~160 lines.
- **B — Settings consolidation.** Removed the "Migrate from userscript" tab
  + importer, the dead Advanced Theme/Media-handling controls, and the
  unused `recent_publications` key. Advanced reorganized into Reader /
  Power-user groups.
- **C — Wire-format hygiene.** Unified the NOSTR `client` tag to `'xray'`
  across all builders; entity-sync label `nac/entity-sync` → `xray/entity-sync`
  (reads still accept the legacy label for back-compat).
- **D — Final prefix cleanup.** Renamed the last `nac-*` capture-pipeline
  markers to `xr-*`; the codebase is now 100% `xr-*`.
- **E — Roadmap + docs refresh.** This update; smoke-test FAB-step rewrite.

**Deferred from the cleanup (needs browser QA):** the deeper CSS
token/color unification (reconciling minor success/warning/danger value
drift across reader/options/sidepanel + a couple of hardcoded colors) — a
visual change best done with eyes on the rendered UI.

---

## Deferred backlog — disposition

The per-phase "Deferred" lists above were triaged against the
claim-tracking north star (*useful data about real people, organizations,
and real-world stories*):

**Keep — serves claim tracking / usability (candidates for Phase 10+):**

- Entity auto-suggest (scan article for known entity names, one-click tag).
- Cross-article evidence links (model already stores arbitrary claim-id
  pairs; needs a picker beyond same-article candidates).
- "Import others' claims" — clone a relay-queried claim locally.
- Evidence-link editing (today create+delete only).
- In-reader archive browser (browse/search the IDB cache).
- Batch-signing UX (one prompt for a comment/claim batch).
- "Push profile now" from the entity side panel.

**Defer — opportunistic, not core:**

- Substack Notes; podcast episodes; YouTube livestream-chat replay,
  channel/playlist captures, per-cue transcript archival; quoted-tweet
  recursion; polls / spaces; live relay subscriptions; byte-budget cache
  eviction; manual "archive this URL" action.

**Cut — out of scope:**

- NIP-04 read-path fallback for pre-v4 userscript events (no such users).
- Per-comment inclusion toggle (marginal over the all/none toggle).

---

## Phase 10 — Claim tracking ✅

The north star: turn X-Ray from a capture tool into a system that
**produces useful, usable data about real people, organizations, and
real-world stories.** Phases 4–5 already ship the primitives (entities
with keypairs, claims `30040`, evidence links `30043`, relationships
`32125`, others'-claims relay query). Phase 10 is about making those
*useful and usable at scale* rather than adding new wire kinds.

Scope is still being shaped, but the working themes:

- **Usability of claim capture** — lower the friction from "I see an
  assertion" to "it's a structured claim tied to real entities."
- **Connecting claims across sources** — so a story accretes evidence from
  many pages instead of living in one capture.
- **Reading others' claims** — go beyond the point-in-time "others'
  claims" modal toward a browsable, trust-filtered view (leaning on the
  Phase 9a trust graph) of what the network says about a person / org /
  story.
- **Identity quality** — make the Phase 9 cross-platform identity layer do
  real work: collapse duplicate captured authors into canonical people and
  attach their claims to that person.

### Foundation: claim redesign (agreed 2026-06-09)

The Phase 5 claim model is being reworked first — see
[`docs/CLAIMS_REDESIGN.md`](CLAIMS_REDESIGN.md) for the full design and
rationale. In short: replace the heavy structured claim (type / confidence /
attribution / predicate / subject–predicate–object / quote-date) with a
**thin, entity-centric claim** — *text + the entities it's about + a source
anchor*, plus an optional "who said it" and a single ⭐ key-claim flag. The
queryable value moves into `p`-tag links to entity pubkeys, so "what the
network says about person P" is a single `{kinds:[30040], "#p":[P]}` query.
**Claims become the core primitive**; the Phase 9a metadata layer's
fact-checks / ratings are reframed as *responses to* claims, sharing the
text-anchor mechanism, rather than a parallel system.

Implemented in slices (one PR each):

- ✅ **10.1** Thin model + gutted modal (no wire change). — #32
- ✅ **10.2** Lean `30040` tag set + dual-read of old/new vocab (wire change). — #33
- ✅ **10.3** Shared anchor (reuse `metadata/anchor-capture.js`). — #34
- ✅ **10.4** Cross-source aggregation — "what the network says about entity P"
  (side-panel entity detail → *Load from relays*). — #35
- 🔁 **10.5** Metadata reframe — *superseded by Phase 11* (see
  [`docs/ASSESSMENTS_DESIGN.md`](ASSESSMENTS_DESIGN.md)): the
  responses-to-claims idea becomes the assessment primitive (new kind
  `30054`); `30043` retires as planned, replaced by the cross-source
  claim-relationship kind `30055`; annotations keep the shared anchor
  from 10.3.

**10.1–10.4 shipped** (thin capture, lean entity-centric wire, precise
anchoring, the cross-source entity payoff). A dedicated Phase 10 issue will
pin exit criteria; this section + the design note are the intent, not the
final spec.

---

## Phase 11 — Assessments & contradictions ✅

"Community Notes for the internet": register a **personal judgment** on any
captured claim (yours or a foreign one) and surface it wherever the claim or
entity reappears. Two orthogonal axes per assessment — a graded stance
(−2..+2) and typed issue labels (NIP-32 `xray/assessment`: `misleading`,
`fallacy/strawman`, `flip-flop`, …, each optionally anchored to the offending
span) — plus typed **cross-source claim links** (`contradicts` / `supports` /
`updates` / `duplicates`) that put a ⚠ inconsistency badge on both claims.
Local-first (records usable immediately), publish-ready (clean mapping to
new kinds `30054` assessment + `30055` claim relationship, flag-gated;
legacy `30043` retires), LLM-ready (`suggested_by`). A case ("John Dehlin
excommunication", "Bricks & Minifigs scandal") is an entity with a new
`case` entity type; the side-panel entity view becomes the case dashboard;
cases export as JSON + Markdown. Design agreed 2026-06-09 (PR #37).

Full design, wire formats, and rationale:
[`docs/ASSESSMENTS_DESIGN.md`](ASSESSMENTS_DESIGN.md). Absorbs/supersedes the
former 10.5 metadata-reframe slice.

Slices (one PR each):

- ✅ **11.1** Taxonomy + assessment model + tests; evidence-linker
  cross-source refs + relationship enum; legacy `30043` publish gated
  off. — #38
- ✅ **11.2** Wire builders + NIP draft — `30054` assessment + `30055`
  claim relationship (the wire-format PR). — #39
- ✅ **11.3** Assess UI in the reader (stance chips, label badges, span
  anchors, foreign claims, sticky about-defaults). — #40
- ✅ **11.4** Cross-source link UI (search all captured claims; ⚠
  badges; snapshot rendering). — #41
- ✅ **11.5** Side-panel rollups + inconsistencies (the case
  dashboard + label tally + replaceable dedupe). — #42
- ✅ **11.6** Case export (JSON + Markdown, deterministic content
  set). — #43
- ✅ **11.7** Judgment publishing — flag-gated emission of `30054` +
  `30055` + the kind-1985 label mirror; claim-before-assessment
  ordering; coord backfill; options toggle. — #44
- ✅ **11.8** Case collaboration — shareable entity-key bundles so
  collaborators' claims aggregate under the same pubkeys. — #45

Remaining: run the acceptance demo end-to-end on the two driving cases
(LDS Church v. Dehlin; Bricks & Minifigs v. Reckless Ben) — the
checklist is `docs/SMOKE_TEST.md` §Phase 11 + §Phase 11b. Later, if
warranted: network assessment aggregation/trust-weighting, and
NIP-44-encrypted collaboration bundles.

---

## Phase 12 — "My Archive" personal data portal ✅

A **full-tab portal page** (`src/portal/`) where the user sees, searches,
and visually explores everything they have published to NOSTR relays —
articles (30023), claims (30040), captured comments (30041), assessments
(30054) + label mirrors (1985), claim relationships (30055), entity
profiles (0, signed by entity keys), entity↔article relationships
(32125), platform accounts (32126), the NIP-65 relay list (10002), and
entity-sync blobs (30078, listed opaque) — reconciled against the local
published ledger ("ledger says 40; relays confirm 37; 3 missing").
Read-only: no publishing, no deletion, no new event kinds. Surfaces:
type-faceted **Library** with cross-cutting search, publish-date
**Timeline**, an entity-centric **spokes graph** (hand-rolled radial SVG,
full free-floating graph deferred), per-**case** dashboards, and an
**item inspector** (raw signed event, which relays hold it, jump links).
Cache-first via a new IndexedDB DB (`xray-portal`), refreshed
incrementally.

Full design, identity-resolution plan, parser inventory, and rationale:
[`docs/PORTAL_DESIGN.md`](PORTAL_DESIGN.md) — design agreed 2026-06-10,
all five review questions answered in the affirmative (PR #48; kickoff
brief: [`docs/PORTAL_KICKOFF.md`](PORTAL_KICKOFF.md)).

Slices (one PR each):

- ✅ **12.1** Foundation — portal shell + esbuild entry + open wiring;
  identity resolver; corpus queries; **new `parseCommentEvent` (30041)
  + `parseAssessmentEvent` (30054) parsers + tests**; flat event
  list. — #49
- ✅ **12.2** Library — type tabs, per-type renderers, facets,
  cross-cutting search. — #50
- ✅ **12.3** Cache — IndexedDB `xray-portal`, cache-first render,
  incremental refresh, relay-provenance persistence. — #51
- ✅ **12.4** Timeline — density buckets + brush filtering. — #52
- ✅ **12.5** Entity & case views — radial spokes graph + case
  dashboard. — #53
- ✅ **12.6** Inspector & reconciliation — raw events, per-relay
  holdings, ledger diff (confirmed / missing / remote-only), privacy
  footer. — #54
- ✅ **12.7** Hardening — three-lens adversarial review (20 confirmed
  findings fixed, incl. two relay-sync bugs and a read-only breach;
  JOURNAL 2026-06-11), SMOKE_TEST §Phase 12, docs pass. — #55

---

## Phase 13 — Epistemic audits 🚧 (in progress)

The maintainer's epistemic-auditor framework — eight versioned
surface-scan module prompts (headline-body fidelity, asymmetric
language, number hygiene, source quality, internal coherence,
definitional precision, omission, prediction extraction), a canonical
data model (`audit-types.ts`: content-addressed articles, module
results with confidence, aggregate audits under a knowability ceiling,
a prediction ledger with resolutions, dossiers with Bayesian shrinkage,
disputes, first-class auditor identity), and a working Node scorer —
is recovered and vendored at
[`docs/auditor-prototype/`](auditor-prototype/README.md) (PRs #58/#60).

Phase 13 integrates it into X-Ray. The design note,
[`docs/EPISTEMIC_AUDIT_DESIGN.md`](EPISTEMIC_AUDIT_DESIGN.md)
(drafted 2026-06-11 from the rev-3 kickoff,
[`docs/EPISTEMIC_AUDIT_KICKOFF.md`](EPISTEMIC_AUDIT_KICKOFF.md), and
adversarially reviewed before its PR), proposes: six new kinds
**30056–30061** (the framework's 30050–30055 are all taken in-repo); a
canonical article hash (the scorer's normalization, byte-for-byte)
carried as an indexed `x` tag; a local-first execution path via a
companion CLI, import-then-sign (RQ1 confirmed it as the keeper
architecture, not a stopgap; hosted endpoint refused for v1); a
strict audit/assessment firewall; dossiers as derived portal views over
published audit events; honest score display (no score without
confidence, no aggregate without its ceiling, <0.6 confidence renders
as "needs human review"); and a nine-slice implementation plan.

**Status: design accepted 2026-06-11.** The maintainer answered all
eight review questions (resolutions recorded and threaded in the
design note) and delivered the previously-unrecovered philosophy
prose, vendored **normatively** at
[`docs/PHILOSOPHY.md`](PHILOSOPHY.md) (v1.0.0). Headline resolutions:
import-then-sign confirmed as the keeper v1 architecture (hosted
endpoint refused; re-validate-before-sign; producer ≠ publisher);
the knowability ceiling binds to the versioned source-quality
heuristic, the model's estimate riding advisorily; the
guided-checklist tier is the first post-v1 slice, with an
auditor-kind-agnostic invariant binding v1; `calibration-v1` (Brier)
specified but logged-only until an explicit activation decision;
kinds 30056–30061 confirmed (upstream registry checked clean
2026-06-11) with the `d`-scheme constraint written into the draft
NIP; beats become a curated versioned vocabulary (`beats-v1`).
Implementation slices 13.1+ are in progress.

- ✅ **13.1** Model + hashing + schemas + tests — canonical article
  hash (vendored-scorer parity pinned by source-extracted vectors),
  the eight derived findings validators (evidence-bound, module 08
  score-forbidden), `xray-audits` IndexedDB ledger,
  AuditRun/Prediction/Resolution models with the per-event publish
  ledger, `beats-v1` vocabulary + alias normalizer, `calibration-v1`
  math (logged, not activated), auditor-kind-parity tests;
  three-lens adversarial review (7 confirmed findings fixed). — #62

---

## Abandonment criteria

From issue #20 — bears repeating. At any phase boundary, if the cost
to continue exceeds the marginal value of reaching parity (for
example, if the platforms we care about simply don't use NOSTR at
all and nothing we build sees users), it's reasonable to stop.
Nothing about this roadmap is a commitment to shipping all phases —
it's a commitment to doing them in this order *when* we do them.

---

## Keeping this doc current

When a sub-phase lands:

1. Flip its checkbox in the phase section.
2. Append the commit hashes to the "Landed" list.
3. Move any deferred items into the "Deferred" subsection with a
   note on why.
4. Update the status snapshot progress bar at the top.
5. Mirror the same update on the corresponding GitHub issue (phase
   issue + the master roadmap #20).
