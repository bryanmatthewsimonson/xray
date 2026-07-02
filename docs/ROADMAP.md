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
Phase 13 ████████████████████  complete — epistemic audits
                                (docs/EPISTEMIC_AUDIT_DESIGN.md; normative
                                constitution docs/PHILOSOPHY.md). Kinds
                                30056–30061; CLI-import AND in-extension LLM
                                execution paths; 13.1–13.9 shipped
Phase 14 ████████████████████  complete — forensic findings:
                                behavioral-pattern layer
                                (docs/CRIMINOLOGY_DESIGN.md, kind 30062).
                                14.1–14.5 shipped
Phase 14.5 ████████████████░░  complete — in-extension LLM assist: a Suggest
                                engine (entities/claims by default; the rest
                                opt-in) + the epistemic auditor (Quick
                                single-shot / Thorough per-module). Flag- +
                                key-gated, opt-in, nothing auto-saves
Phase 15 ███████████████████░  in progress — truth adjudication: verdicts on
                                propositions + words-vs-deeds integrity
                                (docs/TRUTH_ADJUDICATION_DESIGN.md). Kinds
                                30063/30064 (30065 reserved). 15.1–15.8 all
                                shipped (models, attestation, verdicts,
                                integrity, entity record, wire + flag,
                                publish wiring, reader adjudication UI);
                                remaining: read-back/portal surfaces + the
                                deferred precedent/bridging tail
```

Parity with the v4.2 userscript is long reached; the project now ships
claims, assessments, the "My Archive" portal, epistemic audits, forensic
findings, and opt-in LLM assist (**v0.6.0**), and is moving on to truth
adjudication (Phase 15) and the moral lens (Phase 16).

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
- ✅ **13.2** Wire audit core — `buildModuleResultEvent` (30056) +
  `buildAggregateAuditEvent` (30057) with pure null-on-invalid
  parsers (findings schema-validated before building — never sign
  what you haven't verified; firewall held by construction: no
  assessment vocabulary emitted), the `epistemicAuditing` flag
  (default off), NIP_DRAFT §30056/§30057 incl. the canonical-hash
  `x` tag and the RQ5 time-series `d` constraint, CHANGELOG
  wire-change callout. — #63
- ✅ **13.3** Wire ledger + governance kinds — builders + parsers for
  30058 PredictionEntry (convergent text-hash `d`; content =
  prediction text only, so `d` recomputes from the event), 30059
  PredictionResolution (typed four-kind evidence tags, evidence-bound
  — no evidence, no resolution), 30060 DossierSnapshot (cache
  semantics; beat subjects MUST be canonical `beats-v1` slugs), 30061
  AuditDispute (wire-format-only; filer-asserted status open/withdrawn
  only); dossier rollup math (`dossier.js`: §4 shrinkage published
  per rollup, per-module means, rate table + logged-not-activated
  `calibration_v1`); NIP_DRAFT §30058–§30061 + the beat-vocabulary
  clause. — #64
- ✅ **13.4** Capture-time hashing — the canonical hash rides new
  30023s as an indexed `x` tag (additive wire change, CHANGELOG
  callout; NIP_DRAFT §30023 `x` extension); `assembleArticleBody`
  extracted so capture and publish hash identical bytes;
  header-field newline sanitization (terminator-forge defense);
  `articleHash` on archive records; reader hash line + stealth-edit
  mismatch banner (sequenced before the archive save so the
  comparison reads the prior row). — #65
- ✅ **13.5** Audit execution, v1 path — `audit/import.js` enforces
  the RQ1 gate at the door: re-hash `body_markdown` vs the claimed
  hash, match against the local capture, schema-validate every module
  payload (failed/`_error` modules stored as failed runs — one bad
  module never rejects the file; a contradictory aggregate does);
  reader import bar (keyed to the open capture's hash, display-rule-
  honest status line) + options Advanced importer (archive-matched,
  incl. retained prior versions); scorer README import note. Imports
  are local-only and ungated; publishing is 13.8. — #66
- 🔄 **13.6** Reader audit panel (draft PR for smoke-testing) —
  aggregate badge on the framework rubric bands (no naked numbers;
  confidence < 0.6 renders "needs human review" with no number and no
  band color; ceiling context when binding; provenance line), eight
  expandable module rows (caveats + click-to-locate evidence quotes,
  selection-only — never mutates the contenteditable body), prediction
  ledger list with **Atomize as claim** offers (RQ6: the promotion
  links both ways — prediction `claim_ref` locally, and the promoted
  claim's 30040 emits an `a` back-reference at publish; additive wire
  change, CHANGELOG callout), prior-version re-audit notice,
  staleness chips (`CURRENT_MODULE_VERSIONS` reference), other runs
  side-by-side (never averaged). — #67
- 🔄 **13.7** Portal surfaces (draft PR for smoke-testing) — the
  corpus fetches the audit family (30056–30061; kind-list pin updated
  deliberately); Library gains `Audits`/`Predictions` facets and an
  audit chip on article cards (hash-first join, URL fallback only for
  pre-13.4 hashless events); inspector drawer shows the full audit
  record per article (every run side-by-side, never averaged; local
  unpublished runs marked); entity view gains the **Audit dossier**
  block (derived, computed-on-open via `computeDossier`, shrinkage
  shown with k/factor/population, rate table + informational
  calibration-v1, unmapped-beat review list); timeline gains the
  **predictions-due strip** (90-day window, merged published+local,
  deduped) with the minimal **Resolve…** form (evidence-bound;
  resolutions file locally, publish in 13.8). — #68
- 🔄 **13.8** Publish path (draft PR for smoke-testing) — flag-gated
  (`epistemicAuditing`, default off, Options ▸ Advanced toggle with
  public-visibility disclosure) ordered batch in the reader's publish
  flow: 30056s → 30057 → 30058s → 30059s with per-event ledger marks
  (resume never duplicates); referenced-before-referencer enforced on
  the WIRE (aggregates defer when a module fails this batch, promoted
  30058s defer until their claim has a published address — at that
  address, not the signing key's), per-record hash anchoring (records
  publish against their audited vintage, resumes survive the publish
  restamp), per-entry build isolation (one malformed record never
  blocks the batch, every skip counted into the summary), the
  resolution identity rule (stale-identity filings refused with
  re-file guidance; remote-prediction resolutions publish verbatim,
  anchored via the new `article_hash` record field), import-side
  version trust boundary (wrapper `module_version` must agree with
  `findings.version` — the wire-address preimage), portal
  reconciliation for 30056–30059 (30060/30061 stay no-ledger; 30060
  snapshot publish deferred — portal stays read-only). — #69
- 🔄 **13.9** Hardening (draft PR) — `SMOKE_TEST.md` §Phase 13 (the
  24-step acceptance walk: capture → scorer → import gates → display
  rules → atomize → flag-gated publish incl. resume + firewall →
  portal surfaces → reconcile), docs-consistency pass, and the
  **phase-wide multi-agent review** (7 cross-slice lenses, 68 agents:
  46 confirmed / 15 refuted — on top of the eight per-slice rounds'
  ~109). Headline fixes: the publish-path hash fork (double
  htmlToMarkdown on `<`-bearing markdown — body mangled, published
  `x` ≠ the audited hash; pre-Phase-13 bug promoted into the content
  address by 13.4), relay-parser range-checking, import-gate parity
  with the builders (strict run_at / 64-hex human auditors /
  horizon_iso / evidence grammar — nothing imports that cannot
  publish), publish-identity marks + stale-coordinate re-keying,
  RQ6 lifecycle closure (late atomization re-emits, claim deletion
  severs links, multi-vintage back-references, revised resolutions
  re-publish, corrected re-imports update the ledger), dossier purity
  (URL-joined + sub-0.6 contributions excluded), portal prior-vintage
  joins + coordinate-based module joins, Resolve… for unscheduled
  predictions, and the promised audit-ledger export. — #70

## Phase 14 — Forensic findings (behavioral-pattern layer) ⏳ design agreed

**Builds on Phase 13 (the epistemic audit).** Phase 13 must land on `main`
first; this layer sits on top of it and is a *distinct* feature. The two use
**disjoint wire kinds** — the audit owns `30056–30061` (+ `epistemicAuditing`
flag), so this layer takes **`30062`** for `BehavioralFinding` (+ a separate
`forensicPublishing` flag). New criminology development is paused until the
Phase 13 chain merges, at which point this branch rebases onto it.

Where Phase 11 grades whether a *claim* is true, Phase 14 names what a
*subject* is doing around the truth — an evasion, a defense, a self-serving
revision — and binds it to evidence, **without a verdict on honesty or
intent**. A **behavioral finding** (new kind `30062`) targets a subject (the
Phase 9 identity layer) in a declared **role** (apologist / critic /
institution / witness / survivor), names a **maneuver** from a taxonomy
seeded from the criminology / thought-reform canon (Sykes & Matza
neutralization, Freyd/DARVO, Lifton thought-reform, Popper/Lakatos immunizing
defenses, Finkelhor/Craven grooming sequence, statement-analysis revision),
and carries an **ordered evidence chain** plus a **required counter-note**
(the alternative reading). No stance, no score — a bounded `basis` enum
(`quoted` / `paraphrased` / `behavioral-cue` / `structural-inference`)
records *how we know*. Diachronic story-changes extend kind `30055` with
directional `revision/*` edges (`narrative-patch` / `recharacterizes` /
`walks-back`). Local-first, publish-ready (flag-gated `forensicPublishing`,
kind-1985 mirror), LLM-ready (`suggested_by`). The portal renders the same
findings as Dawn McCarty's four report lenses (evidentiary / executive /
survivor / editor). Companion to — not a fork of — the assessment layer.

Full design, wire formats, methodology rules, and the canon→vocabulary map:
[`docs/CRIMINOLOGY_DESIGN.md`](CRIMINOLOGY_DESIGN.md) — design agreed
2026-06-14.

Slices (one PR each):

- ⏳ **14.1** Foundation — `forensic-taxonomy.js` (six families + role/basis
  enums + indicators/counter-indicators), `forensic-model.js` +
  `behavioral_findings` store, baselines, `evidence-linker.js` `revision/*`
  values; tests. No UI, no wire.
- ⏳ **14.2** Capture UI — finding modal (subject+role, ordered anchors,
  note + required counter-note, basis), findings bar, baseline marking,
  revision-link flow.
- ✅ **14.3** Wire builders + NIP draft — `30062`
  `buildBehavioralFindingEvent` + `parseBehavioralFindingEvent` + the
  kind-1985 maneuver mirror, 30055 `revision/*` emission, the
  `forensicPublishing` flag, §30062/§30055 NIP text with the
  "structural-observation, not verdict" framing + firewall clause.
- ✅ **14.3b** Publish wiring — `forensic-publish.js` selectors
  (subject-pubkey resolution via the entity registry, staleness/mirror
  gates) + a flag-gated reader publish batch (findings → mirrors →
  revision edges), folded into the publish-summary. Revision edges leave
  the `assessmentPublishing` link batch (they publish under
  `forensicPublishing`).
- ✅ **14.4** Portal report lenses — `30062` joins the corpus + Library
  "Findings" facet + inspector section; a **forensic-findings block** on
  the subject/case views renders the four lenses (evidentiary / executive
  / survivor / editor) over the same findings, never averaged; `30062`
  joins `LEDGERED_KINDS` for reconciliation (the wire d-tag recorded at
  publish).
- ✅ **14.5** LLM assist (flag-gated, **in-extension Anthropic call**) — a
  user-invoked pass that proposes **all** capture artifacts (entities,
  claims, assessments, relationships, findings — and baselines / revision
  edges) for human review, created with `suggested_by: llm:<model>`;
  enforces the anchor + counter-note + basis discipline; nothing
  auto-saves or auto-publishes. Off by default behind the `llmAssist`
  flag + a user-supplied API key (the article text leaves the device).
  `shared/llm-{prompts,client,proposals}.js` + `reader/llm-review.js`;
  the `xray:llm:suggest` / `xray:llm:config` messages; Options →
  Advanced → "LLM assist". Implementation prompt:
  [`docs/PHASE_14_5_LLM_ASSIST_KICKOFF.md`](PHASE_14_5_LLM_ASSIST_KICKOFF.md).

Acceptance demo: the source video itself
([`0axZ8EGLaxQ`](https://www.youtube.com/watch?v=0axZ8EGLaxQ)) — profile both
interlocutors (the symmetry check), with evidence chains, counter-notes, and
diachronic revision edges visible across the four lenses.

---

## Phase 15 — Truth adjudication (verdicts + words-vs-deeds) 🚧 (in progress)

**Builds on Phase 14.** The Phase 14 forensic chain must land on `main`
first; this layer composes its findings (`30062`) as a raw signal and takes
the **next disjoint wire kinds** — **`30063`** `AdjudicatedVerdict` and
**`30064`** `IntegrityFinding` (with **`30065`** reserved for a precedent
citation), gated by a separate **`truthAdjudicationPublishing`** flag. New
development is paused until the Phase 14 chain merges, at which point this
branch rebases onto it.

This is the **truth-verdict layer Phase 14 deliberately deferred** (its
non-goals: "truth verdicts on subjects, intent attribution"). Where Phase 11
registers a personal stance on a claim and Phase 14 names a *maneuver*
without a verdict, Phase 15 **adjudicates whether an atomized proposition is
true** — `established-true` / `established-false` / `contested` /
`unresolved` / `insufficient-evidence` — on a declared common-law
**standard of proof**, with verbatim two-sided evidence, tiered sources,
adjudicator identity + mandatory caveats, and append-only supersession. Its
**spine** (§1 of the design): *verdicts are descriptive states; every number
is a reproducible **measurement** that shows its derivation, never an
estimated score* — the deliberate departure from the epistemic audit's
0-100 + knowability-ceiling. Its headline *use* is the **integrity
application**: linking an adjudicated `stated-commitment` / `stated-value`
to adjudicated **action-facts** (the corroborated convergence of
*independent* attestations) and ruling the word-deed `match`
(`fulfilled` / `broken` / `contradicted` …) as its own verdict — **intent
never adjudicated**, values never policed as true/false, only the observable
gap. Entity records are **dimension-separated and coverage-bound** (the
coverage fraction caps every aggregate); the optional rollup is a lossy
ratio of measured outcomes, never a fused score.

**v1 scope** is authoring + wire + local records — the same posture Phases
11/13/14 take. The client emits well-structured verdict events behind a flag
and keeps dimension-separated local records; the **aggregation-layer
defenses** (cross-author bridging, reputation/track-record weighting, Sybil
resistance, capital bonding) are **deferred** — the wire carries the fields a
future protocol layer would consume, but the client does not compute them,
exactly as Phase 13 shipped `30061` wire-only. Disputes inherit that
wire-only posture (no adjudication runtime in v1).

Full design, the form-of-judgment spine, the pitfall→defense table, wire
formats, and red lines:
[`docs/TRUTH_ADJUDICATION_DESIGN.md`](TRUTH_ADJUDICATION_DESIGN.md) — design
draft. The deferred bonded-resolution second act is parked in
[`docs/BONDING_NOTES.md`](BONDING_NOTES.md).

Slices (one PR each; `claude/phase-15-*`):

- ✅ **15.1** Adjudicable-proposition model (local, no wire) —
  `proposition_class` + `resolution_criteria` atomization over existing
  claims (`truth-taxonomy.js` + `truth-adjudication-model.js`); the
  interpretation/value firewall (`isTruthAdjudicable` /
  `isIntegrityEligible`); exhaustive-enum tests.
- ✅ **15.2** Evidence tiers + attestation graph — tiered evidence
  (`EVIDENCE_TIERS` + attestation metadata on 30055 `supports` links);
  independent-attestation convergence for action-facts
  (`truth-attestation.js` — origin-group collapse, demonstrated-
  independence discipline, per-tier counts with full derivation);
  independence checks.
- ✅ **15.3** Verdict model + dispute reuse — `AdjudicatedVerdict`
  (`VerdictModel` in `truth-adjudication-model.js`: descriptive states,
  declared standard-of-proof with §6 per-class defaults, verbatim
  two-sided evidence with per-state adequacy, mandatory caveats, the
  §3.1 firewall enforced at create); multi-adjudicator variance
  *surface* (`verdictVariance`, derived, never collapsed); append-only
  supersession (no update method; linear chains by id construction).
  Dispute reuse is the `30061` wire format as-is — nothing new built;
  the `30063` dispute target kind lands with the wire in 15.6. No
  estimated-score path exists to build.
- ✅ **15.4** Integrity application — `IntegrityFinding`
  (`integrity-model.js`: stated words vs enacted deeds of the same
  entity, match adjudicated as a verdict with per-word-class
  vocabulary — the value firewall; documented-only gap-decomposition
  with intent excluded; `constraint_ref` as corroborated evidence;
  revision-as-credit via `revision_ref` composing 30055/30062;
  append-only supersession; `timelineForEntity` pattern-not-instance
  ordering on the deeds' `occurred_at`).
- ✅ **15.5** Entity record + coverage — dimension-separated descriptive
  records (`truth-entity-record.js`: commitments/values as count+list,
  calibration from resolved predictions reusing `audit/calibration.js`
  with unscoreables listed, corrections composing supersessions +
  disclosed revisions + optional 30062 bridge); the coverage
  measurement (default undetermined) + cap; the optional
  coverage-gated rollup (a ratio sentence, never a score).
- ✅ **15.6** Wire + NIP draft (flag-gated) — `30063`/`30064` builders +
  parsers (`truth-builders.js`, following the 30062 idioms; no `p` on
  30063, no 1985 mirror for 30064, firewall enforced build- AND
  read-side); `truthAdjudicationPublishing` flag; `30061`
  `DISPUTE_TARGET_KINDS` extended with `verdict`/`integrity_finding`
  (additive); NIP draft §30063/§30064 framing verdicts as
  evidence-bound descriptive adjudications with required caveats;
  `30065` + the `precedent` a-tag marker grammar reserved. Publish
  paths + read UI wiring are follow-up work behind the flag.
- ✅ **15.7** Publish wiring (follow-up to 15.6) — `truth-publish.js`
  pure selections (chain heads only; claims-published gating;
  entity-keypair subject resolution; constraint-must-resolve;
  supersedes event-id threading); `markPublished`/`markMirrored`
  stamps on the verdict/integrity models; the flag-gated reader
  batch-publish section (30063 + 1985 mirror + 30064) and publish
  summary. Read-back/portal surfaces still to come.
- ✅ **15.8** Reader adjudication UI — `adjudicate-modal.js` (class
  chips as the one-per-(claim,class) selector; firewall as a UI fact —
  interpretation/stated-value get the explainer, never a ruling form;
  supersession-not-edit surfaced in the Save affordance; verbatim
  evidence rows with tiers; mandatory-caveat field); claims-bar 🏛
  action + per-proposition verdict badges; SMOKE_TEST §Phase 15 UI
  rows. Portal read-back surfaces still to come.
- 📝 **(later)** Precedent + bridging weighting — stare-decisis corpus;
  bridging-weighted standing (the deferred aggregation-layer tail).

---

## Phase 16 — Moral-lens evaluation (lens-readings) 📝 design draft

**The far side of the Phase-15 firewall, and an LLM-assist consumer.** Where
Phase 15 §3.1 declares interpretations and bare values **not** adjudicable as
true/false, this layer takes exactly those firewalled-off proposition classes
— `normative` / `framing` / `interpretation` / `stated-value` — and does the
only honest thing left: it **reconstructs how named perspectives would read
them**, grounded in those perspectives' own authorities, and reports its
evidentiary honesty as the payoff. It never asks "is A true?"; it asks "under
jurisdiction J, how would A be read, on what authority?" `factual` assertions
are **deferred to Phase 15** — this layer may only describe whether a
jurisdiction's corpus asserts/denies/is silent, never pronounce the fact.

A **jurisdiction** is `codified` (a legal code), `worldview` (a tradition,
pluralism encoded — never one decree for "Christianity"), or `persona` (an
author's corpus, with a non-negotiable **living-person guardrail**: published
positions only, never private belief/motive/character). These map onto
existing substrate — jurisdictions are **entities** (`entity-model.js`),
authorities are **captured claims + W3C anchors** (`claim-model.js`), the
target is a captured `30023`.

**Derived/advisory only — no wire kind.** The opinion follows the
`audit/dossier.js` computed-on-open pattern: the model pass isn't
deterministic but its inputs are pinned (authorities by edition/locator,
article hash, jurisdiction defs, prompt version), provenance
`suggested_by: 'llm:<model>'`. **Nothing auto-saves; nothing publishes**
(inherited from Phase 14.5). Gated by a new `moralLens` flag (default off)
**plus** the API-key second consent gate, since article text leaves the
device. Kind **`30066` is left free**; a shareable wire format is a deferred,
separately-designed act.

Three corrections to the source prompt are load-bearing: confidence is a
**legitimate estimation** (fidelity of reconstruction, admissible under
truth-doc §1's own carve-out — not a truth-verdict); the **surface framing is
"lens-reading," not a court** ("verdict" stays reserved for Phase 15); and
**panel composition is a P5 symmetry obligation** — which jurisdictions are
empaneled, and why, is disclosed and a one-sided panel is flagged.

Full design: [`docs/MORAL_LENS_JURISDICTION_DESIGN.md`](MORAL_LENS_JURISDICTION_DESIGN.md)
— design draft.

Slices (one PR each; `claude/phase-16-*`):

- 📝 **16.0** Gate — Phase 14.5 LLM-assist (`llm-client.js`, `llmAssist`
  flag, key consent) merged; this layer does not start before it.
- 📝 **16.1** Jurisdiction model — entity-backed records; the three
  definition templates; corpus-loading binding authorities to captured
  claims + anchors; exhaustive-enum tests.
- 📝 **16.2** Lens-reading engine — hardened system prompt + `llm-client`
  call + structured-output parse; derived view, never saved.
- 📝 **16.3** Surfaces — reader/portal rendering of the reconstruction +
  integrity report + `panel_composition` disclosure; content-vs-framing split.
- 📝 **16.4** Guardrails as tests — living-person guardrail;
  symmetry/selection discipline (thin corpus → `silent`, unloaded → refuse,
  one-sided panel → flag).
- 📝 **(deferred)** publishable wire kind `30066`; persona-corpus tooling;
  multi-target panels.

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
