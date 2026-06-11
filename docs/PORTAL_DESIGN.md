# "My Archive" — the personal data portal (Phase 12)

**Status:** design **agreed 2026-06-10** (drafted the same day from the
kickoff brief, [`docs/PORTAL_KICKOFF.md`](PORTAL_KICKOFF.md), with every
load-bearing claim re-verified against `main` post-PR-#47; all five
review questions answered in the affirmative by the maintainer — see the
[bottom of this doc](#review-questions)). Implementation proceeds in
slices 12.1–12.7 (PR #48).

X-Ray publishes a lot on the user's behalf — articles, atomized claims,
captured comments, assessments, contradiction links, entity profiles,
platform accounts, sync blobs — and offers no way to see any of it again
short of a relay explorer. Phase 12 adds the read-back surface: a
**full-tab portal page** where a user can see, search, and visually explore
everything they have published to NOSTR relays, reconciled against the
local "I published this" ledger. v1 is personal ("my data"), but the
information architecture is designed as a window onto the larger graph the
same primitives produce at network scale.

## Decisions at a glance

| Question | Decision |
| --- | --- |
| Surface | New **full-tab extension page** `src/portal/` (sixth esbuild entry). Opened from a context-menu item and links in the side panel/options header. **No manifest change needed** — extension pages open via `chrome.tabs.create(chrome.runtime.getURL(...))`, same as the reader |
| Relay access | None directly — every read routes through the background pool via the existing `xray:relay:query` message (the CLAUDE.md load-bearing rule). The portal adds **zero** new background message types for relay work |
| Identifying "me" | A small **identity resolver** that unions four sources: `Signer.getPublicKey()` (works for Local + NSecBunker from an extension page), the reserved `xray:user` sync key, the append-only `publishedPubkeys` history on claims, and a manual npub field. NIP-07 pubkeys arrive via history/sync key/manual entry — **no tab-routing in v1** (rationale below) |
| Entity fan-out | Entity pubkeys (`EntityModel.getAll()` → `keypair.pubkey`) are queried **in a separate subscription** for kind 0 — not folded into the main `authors` list (privacy + filter-shape rationale below) |
| New parsers | `parseCommentEvent` (30041) in `event-builder.js` (beside its builder and the two existing reconstructors); `parseAssessmentEvent` (30054) in `assessment-model.js` (mirroring `parseRelationshipEvent`'s home in `evidence-linker.js`). Pure, null-on-invalid, round-trip-tested against the builders |
| v1 surfaces | **Library** (type-faceted lists + cross-cutting search, with by-source grouping as a facet), **Timeline**, **Entity spokes view** (the graph), **Case dashboard**, **Item inspector** + **Reconciliation panel** |
| Graph | **Hand-rolled SVG radial ego layout** (no dependency, no force simulation in v1); spokes-from-one-entity first, full free-floating graph deferred |
| Cache | New IndexedDB DB **`xray-portal`** owned by `src/portal/portal-cache.js` (separate from `xray-archive`; rationale below). Cache-first render, incremental `since`-window refresh, manual full resync |
| Reconciliation | Local ledger (claims/assessments/links/entities/articles) diffed against relay truth: **confirmed / missing / remote-only**. Display-only — the portal never writes the ledger |
| Read-only | The portal publishes nothing and deletes nothing. NIP-09 unpublish is noted as a follow-up, not built |
| Wire format | **No new event kinds, no builder changes** — this phase is a reader of existing kinds |

## Identity — resolving "me" (and my entities)

The corpus query needs `authors`, and the portal runs outside any capture
context, so it cannot use the reader's path (`xray:capture:getPubkey` →
source tab → NIP-07 bridge, `src/background/index.js:278`). What works
from a standalone extension page, per signing mode
(`src/shared/signer.js:70`):

- **Local** — `Signer.getPublicKey()` reads `Storage.primaryIdentity`
  (`chrome.storage.local` key `local_primary_identity`). Works anywhere.
- **NSecBunker** — `Signer.getPublicKey()` connects via
  `preferences.nsecbunker_url`. Works from extension pages (the signer
  façade header documents exactly this split).
- **NIP-07** — requires the MAIN-world bridge in a *tab*; `Signer`
  throws in this context. The portal does not get a synchronous answer.

Additionally, "me" is plural in practice:

- the **`xray:user` sync key** (`LocalKeyManager`, reserved name at
  `src/sidepanel/index.js:33`) signs entity-sync 30078 and the NIP-65
  10002 relay list (`entity-sync.js:163,339`) and may differ from the
  current signing identity;
- claims record an **append-only `publishedPubkeys` history**
  (`claim-model.js:258-277`) precisely because the publishing key can
  change over time;
- a user may have published from another device or before switching
  signing modes.

**Design:** a small pure module `src/portal/identity.js` resolves a set of
`{pubkey, source}` pairs by unioning, in order:

1. `Signer.getPublicKey()` (best-effort; swallow the NIP-07
   context error) → source `signer`
2. `LocalKeyManager.getKey('xray:user')?.pubkey` → source `sync-key`
3. `∪ claims[].publishedPubkeys` over `ClaimModel.getAll()` → source
   `publish-history`
4. manual npubs pasted in the portal header (decoded via
   `Crypto`/bech32, persisted under a new `portal_identities` storage
   key) → source `manual`

The header shows the resolved set as chips with provenance, so a NIP-07
user with no history sees an honest empty state ("no identity resolved —
paste your npub, or publish once") instead of a silent empty portal.
Follow-up (not v1): an optional "fetch from a NIP-07 tab" button that
routes through an active tab the way the reader does.

**Entity pubkeys** come from `EntityModel.getAll()` →
`entity.keypair.pubkey` (keys live in `LocalKeyManager` under
`entity:<id>`). They are the `authors` of entity kind-0 profiles only —
everything else in the corpus is signed by a user key (the `xray:user` key
for 30078/10002, the signing identity for the rest).

## The corpus and the query plan

Verified kind-by-kind against `event-builder.js`, `metadata/builders.js`,
and the docs. **Parser status** is what exists on `main` today:

| Kind | What | d-tag | Parser today | Portal rendering |
| --- | --- | --- | --- | --- |
| 30023 | Captured page | `sha256(url)[:16]` | `reconstructArticleFromEvent` ✅ | Article card (title, domain, image, date) |
| 30040 | Claim | claim id (`claim_<16hex>`) | `parseClaimEvent` ✅ (dual-read) | Claim row (text, about-entities, source, key badge) |
| 30041 | Captured comment | platform-namespaced comment id | **none — new `parseCommentEvent`** | Comment row (author, platform, date, text, thread) |
| 30054 | Assessment | `assess:<sha16(coord)>` | **none — new `parseAssessmentEvent`** | Stance + labels + rationale, linked to its claim |
| 30055 | Claim relationship | `rel:<sha16(sorted coords\|rel)>` | `parseRelationshipEvent` ✅ | Typed edge row; ⚠ for `contradicts` |
| 1985 | Label mirror | — (non-addressable) | none needed | Grouped under its assessment via the `a` tag; raw view |
| 0 | Entity profile (signed by **entity key**) | — | none needed (JSON content) | Entity card (name, about, nip05) |
| 32125 | Entity↔article relationship | `<entityId>:<url>:<type>` | none needed (flat tags) | Edge row in entity view |
| 32126 | Platform account | `<platform>:<stableId>` | `reconstructPlatformAccount` ✅ | Account card (platform, handle, linked entity) |
| 10002 | NIP-65 relay list | — | none needed (`r` tags) | "Relays I declared" panel |
| 30078 | Entity-sync blob (NIP-44, signed by `xray:user`) | entity id | **opaque by design** | Listed with kind/date/d only — never decrypted in v1 |
| 30050–30053, 9803 | Dormant metadata kinds (flag-gated) | various | none | Generic raw rows; likely zero events — handled, not styled |

Anything that parses to nothing (unknown kind, malformed, dormant) falls
back to a **generic event row** (kind, d, created_at, tag summary, raw
JSON in the inspector) — the portal never drops an event it fetched.

**Queries.** `NostrClient.queryRelays` (`nostr-client.js:208`) sends
**one filter per REQ** and dedups by event id only, so the portal issues
two staged subscriptions through `xray:relay:query`
(`background/index.js:547`, response `{ok, events, byRelay}`):

- **Q1 — my content:** `{ authors: [...myPubkeys], kinds: [30023,
  30040, 30041, 30054, 30055, 1985, 9803, 10002, 30050, 30051, 30052,
  30053, 30078, 32125, 32126], limit: 1000 }`
  (30078/10002 ride along because the `xray:user` key is in
  `myPubkeys` when configured.)
- **Q2 — my entities' profiles:** `{ authors: [...entityPubkeys],
  kinds: [0], limit: 1000 }`, chunked at 100 authors per query.

Client-side, results pass through the side panel's proven
`dedupeReplaceable` (latest-wins per `(kind, pubkey, d || id)`,
`sidepanel/index.js:433`) — lifted into a shared helper rather than
copied a third time — applied to addressable/replaceable kinds only
(1985 and 9803 are regular events; every one is kept).

**Pagination.** Relays cap responses silently. v1 backfills with a
`until`-window loop (repeat with `until = min(created_at) - 1` until an
empty page or a 10-page safety cap, logged in the UI as "fetched N events
across M pages"). Incremental refresh queries with
`since = lastSyncAt - 3600` (one hour of clock-skew overlap) and merges.

**Other clients' events.** `authors`+`kinds` filters will also return
events the same pubkey published from *other* NOSTR clients (a Habla
30023, a Damus-written 10002). The portal **shows them with an
"other client" badge** (keyed off the `client` tag) rather than filtering
— they are part of "everything you've published," and silently hiding
them would make reconciliation counts lie.

## The two new parsers

Both are pure functions over a raw event, returning `null` for
wrong-kind/invalid input, tolerating missing optional tags, and reading
tags-first with content fallback — the existing parsers' style
(`parseClaimEvent` at `claim-model.js:80`, `parseRelationshipEvent` at
`evidence-linker.js:84`).

**`parseCommentEvent(event)` → in `src/shared/event-builder.js`** (beside
`buildCommentEvent:530` and the other two inverses). Returns:

```
{ id,                — d tag (platform-namespaced comment id)
  text,              — 'comment-text' tag, falling back to content
  author,            — 'comment-author'
  platform,          — 'platform'
  authorHandle,      — 'author-handle' | null
  authorUrl,         — 'author-url' | null
  commentDate,       — Number('comment-date') seconds | null
  replyTo,           — 'reply-to' (parent comment d) | null
  reactionCount,     — Number('reaction-count') | 0
  restackCount,      — Number('restack-count') | 0
  commenterPubkey,   — first `p` with role 'commenter' | null
  url, title,        — 'r', 'title' (the article it was captured from)
  pubkey, created_at, eventId }
```

**`parseAssessmentEvent(event)` → in `src/shared/assessment-model.js`**
(the model module, mirroring where 30055 parsing lives). Returns:

```
{ id,                — d tag ('assess:<sha16>')
  claimCoord,        — first `a` tag value (required; null ⇒ reject)
  claimEventId,      — first `e` | null
  claimAuthorPubkey, — first role-less `p` | null
  stance,            — integer −2..+2 | null  (clamped/validated)
  labels,            — [{label, anchor|null, note|null}] from l /
                       label-anchor / label-note under 'xray/assessment'
  rationale,         — content
  aboutPubkeys,      — `p` tags with role 'about'
  url,               — 'r' (verbatim claim URL) | null
  suggestedBy,       — 'suggested-by' | 'user'
  pubkey, created_at, eventId }
```

Note the `p`-disambiguation: `buildAssessmentEvent`
(`metadata/builders.js:517`) emits the claim author as a role-less `p`
and about-entities as `['p', pk, '', 'about']` — the parser keys on the
slot-4 role marker, the repo's established idiom.

**Tests** (house style: `node --test`, hand-built `chrome.storage` stubs,
exhaustive tag pins): round-trips (`buildCommentEvent` → `parseCommentEvent`
field-for-field, `buildAssessmentEvent` → `parseAssessmentEvent` including
label anchors/notes and the stance=null label-only case), wrong-kind →
null, missing-required → null, ms-vs-s `comment-date` handling, and a
pinned-tag-vocabulary test per kind so any future builder change forces a
parser look.

## Information architecture — the five surfaces

Framing: at network scale these same primitives are claims accreting
about every public entity, archived comments outliving platform
deletions, contradictions surfacing across sources. The portal's v1 cuts
are the ones that stay intuitive in both the personal and the global
frame; "browse my 40 events" and "browse a million-event graph" want the
same doors (entity, type, time, case, source, search).

1. **Library** — the default view. Type tabs (Articles / Claims /
   Comments / Assessments / Links / Entities / Cases / Accounts / Other)
   with counts, newest-first, paginated. Facets: platform, source domain
   (from `r` tags — this is the "by source" surface, folded in as a
   facet + group-by toggle rather than a separate page), case,
   reconciliation status, "other client". A persistent **search box**
   does cross-cutting full-text over claim text, comment text + authors,
   article titles/domains, entity names, assessment rationale + labels,
   account handles — in-memory index over parsed events, incremental,
   type-faceted results.
2. **Timeline** — publish-date density (day buckets, week rollup at
   zoom-out) over `created_at`. Brushing a range filters the Library
   list below it; capture sessions and case bursts show as spikes.
3. **Entity spokes view** — the graph (next section). Reached by
   clicking any entity anywhere, or search-to-focus.
4. **Case dashboard** — the publish-side complement of the side panel's
   local case dashboard (Phase 11.5): for a `case`-type entity, the
   published-artifact rollup (counts per kind), its claims with
   stance/⚠ badges, the people/orgs p-tagged alongside, and a
   per-case timeline strip.
5. **Item inspector** — a drawer on every item: parsed fields, the raw
   signed event JSON (copyable), the addressable coordinate, **which
   relays hold it** (accumulated from `byRelay` provenance at fetch
   time), reconciliation status, and jump links — source URL, the
   entity/case views, and (when the article is reconstructable) open in
   the reader.
6. **Reconciliation panel** — see below; also surfaced as per-item
   status chips throughout.

(1, 2, and 6 are list-shaped and cheap; 3–5 are where the design risk
lives, hence the slice ordering.)

## The graph — entity-centric spokes, hand-rolled SVG

Per the maintainer's lean (kickoff Q3), v1 ships the **ego view**: one
focused entity at the center, everything one hop out, click-to-refocus.

- **Center:** the focused entity (kind-0 card data).
- **Rings (by node type, radially clustered):** claims *about* it
  (30040 `p…about`), claims it *sourced* (`p…source`), platform
  accounts linked to it (32126 `linked-entity`), cases it appears in,
  co-tagged entities (entities sharing a claim with the focus).
- **Edges between ring nodes:** 30055 relationships between visible
  claims — `contradicts` drawn hot with the ⚠ affordance; when a
  contradiction targets a claim *outside* the current ego set, its
  counterpart renders as a ghost node so the warning is never hidden.
  Assessments decorate their claim nodes (stance color, label count)
  rather than being nodes themselves.
- **Layout:** deterministic radial — type-sector angular allocation,
  ring radius by type, golden-angle spread within a sector. No force
  simulation: layouts are stable across opens (same data ⇒ same
  picture), there's no physics to tune, and it's legible at the
  hundreds-of-nodes mark with per-sector "top N + show all" collapsing.
  Pan/zoom via viewBox transform; search-to-locate pulses the match.
- **Why no library (kickoff Q2):** the repo is dependency-light by
  design and ships its own crypto rather than take deps; a force
  package (d3-force ≈30 KB+, cytoscape ≈400 KB) buys little for an ego
  layout that is *better* deterministic, and everything used
  (SVG, viewBox math) is comfortably within the Firefox 128 floor. If
  the later free-floating-graph slice genuinely needs force layout,
  that slice re-opens the question with a concrete candidate.

A full free-floating knowledge graph (all entities + claims at once) is
**deferred** — the ego view plus Library/search covers the v1 acceptance
walk ("focus an entity, walk its claims, the people around it, and a ⚠
contradiction").

## Cache and refresh — `xray-portal` (IndexedDB)

Querying the whole corpus on every open is too slow at scale, so:
**render from cache instantly, refresh in the background, reconcile.**

A new DB **`xray-portal` v1**, owned by `src/portal/portal-cache.js`,
following `archive-cache.js`'s idempotent-open/upgrade pattern and its
`fake-indexeddb` test harness. Separate from `xray-archive` deliberately:
different lifecycle (derived, droppable, rebuildable from relays at any
time vs. precious local captures), different eviction story, and no
coupling of schema version bumps across concerns.

- **Store `events`** — keyPath `id`; record
  `{id, kind, pubkey, created_at, dTag, addr, event, relays: [url…],
  firstSeenAt, lastSeenAt}` with indexes on `kind`, `pubkey`,
  `created_at`, `addr`. Raw signed events are the stored truth; parsing
  happens on read (parsers are cheap and this keeps cached data valid
  across parser evolution). Addressable kinds replace-in-place by
  `addr` (latest `created_at` wins; superseded rows deleted); duplicate
  ids merge their `relays` sets — that union *is* the "which relays
  hold it" provenance, fed by `byRelay`-tagged per-relay re-queries
  only when the user opens the inspector's relay detail (v1 default:
  provenance = relays that returned the event during normal fetches).
- **Store `meta`** — sync cursors (`lastSyncAt` per query class), the
  last resolved identity set, last-known relay list.
- **Flow:** open → load + parse cache → render → background incremental
  refresh (`since` window) → diff → toast "+12 new events" + live
  re-render. A visible **Resync** button does the full windowed
  backfill. Relay set = `preferences.default_relays`
  (background falls back to the same hardcoded trio it already uses,
  `background/index.js:510`), shown in the portal footer.

## Reconciliation and provenance

The local ledger records *intent*; relays record *truth*. The portal
diffs them — read-only:

| Local record | Ledger fields (verified) | Relay match key |
| --- | --- | --- |
| Claim (`article_claims`) | `publishedAt`, `publishedEventId`, `publishedPubkey` + `publishedPubkeys` history (`claim-model.js:267`) | coordinate `30040:<publishedPubkey>:<id>` |
| Assessment (`claim_assessments`) | `publishedAt`, `publishedEventId`, `mirroredAt` (`assessment-model.js:327`, `assessment-publish.js`) | `d = assess:<sha16(coord)>` (recomputable) |
| Link (`article_claim_links`) | `publishedAt`, `publishedEventId` (`evidence-linker.js:364`) | `d = rel:<sha16(…)>` (recomputable) |
| Entity (`entities`) | `publishedAt`, `publishedEventId` (`entity-model.js:426`) | kind 0 by `entity.keypair.pubkey` |
| Article (IndexedDB `xray-archive`) | `publishedToRelay`, `publishedEventId` (`archive-cache.js`) | `d = sha256(url)[:16]` |
| Comments / accounts / 32125 | **no local publish ledger** (verified gap) | — relay-only by design |

Statuses per item: **confirmed** (ledger says published, relays have
it), **missing** (ledger says published, no relay returned it — the "I
think 40, relays confirm 37" headline), **remote-only** (on relays, no
local counterpart — published from another device, or a kind with no
ledger; rendered fully, badged, never treated as an error), **local
only / never published** (shown only as counts, since the portal is
about the published corpus). The panel leads with the summary sentence
and counts; chips appear on every list row and in the inspector. The
portal **never writes the ledger** (no "mark as published" backfill) —
that stays a deliberate non-goal so a read surface can't corrupt
publish-side invariants (Review Q5).

Comments/accounts/32125 lacking a ledger is *accepted* for v1 and called
out in the panel's legend; adding `markPublished` to those paths is a
publish-side change, noted as a follow-up outside this phase.

## Privacy callout (kickoff Q4)

Nothing here discloses anything *new to relays in content terms* — every
queried event is already public and already signed by these pubkeys, and
entity-sync/pull (`entity-sync.js:213`) already queries
`authors:[pubkey]`. Two honest correlation notes for the design record:

1. A relay serving the portal's REQ learns that **one connection holds
   this whole pubkey set** — signing identity, sync key, historical
   keys, and (via Q2) every entity key. The events already link these
   publicly (claims p-tag entity pubkeys; same-author events share a
   pubkey), so this confirms more than it reveals; still, the portal
   only queries **the relays the user already publishes to** (the
   configured set) — it never fans out to discovery relays.
2. Keeping Q2 (entity kind-0) a **separate subscription** from Q1 costs
   nothing and avoids putting user keys and entity keys in one
   `authors` array on the wire.

The portal's first-run footer states it plainly: *"The portal asks your
configured relays for events signed by your keys. Relays can see that
request."* No new permissions, no new storage of sensitive material
(manual npubs are public keys).

## Build wiring and page shell

Verified against `esbuild.config.mjs` and `manifest.json`:

- **esbuild:** add `'portal'` to the mapped extension-pages array
  (`esbuild.config.mjs:57`) → `dist/portal.bundle.js` (IIFE). Update the
  file-header bundle list comment (it says "five bundles"; it becomes
  seven — it already undercounts `api-interceptor`).
- **Files:** `src/portal/index.html` (shell referencing
  `../../dist/portal.bundle.js`), `src/portal/portal.css` (`xr-*`
  prefixes), `src/portal/index.js`, plus `identity.js`, `portal-cache.js`,
  and view modules as they land.
- **Manifest:** **no change.** The reader page proves the pattern —
  extension pages need no manifest entry to be opened via
  `chrome.tabs.create({url: chrome.runtime.getURL('src/portal/index.html')})`.
- **Background:** one new context-menu item (`xray:open-portal`, beside
  `xray:open-entities`/`xray:open-settings`, `background/index.js:67-113`)
  and one new runtime message **`xray:openPortal`** (naming matches
  `xray:openSettings`/`xray:openEntities`) so the side panel and options
  pages can link to it. This is the only background change in the phase.
- **Reuse:** the portal imports shared modules exactly like the other
  page bundles (each page is its own IIFE; duplication across bundles is
  the existing model). `dedupeReplaceable` moves from
  `sidepanel/index.js:433` into a shared helper (e.g.
  `src/shared/nostr-events.js`) and the side panel switches to the
  import — the one cross-surface refactor, kept tiny.

## Slice plan (one PR each, `claude/phase-12-*`, UI PRs as drafts)

- **12.1 Foundation** — esbuild entry + portal shell + background
  open wiring; identity resolver + header chips; corpus queries Q1/Q2
  via `xray:relay:query` with windowed backfill; **the two new parsers
  + tests**; shared `dedupeReplaceable` extraction; a flat newest-first
  "everything" list with generic rows. Proves the whole pipe end-to-end.
- **12.2 Library** — type tabs, per-type renderers on the parsers,
  facets (type/platform/domain/case/client), cross-cutting search.
- **12.3 Cache** — `portal-cache.js` (IndexedDB `xray-portal`),
  cache-first render, incremental refresh + diff toast, resync,
  relay-provenance persistence; `fake-indexeddb` tests.
- **12.4 Timeline** — density buckets + brush filtering the Library.
- **12.5 Entity & case views** — radial spokes SVG (focus, refocus,
  filters, ghost contradiction nodes), case dashboard.
- **12.6 Inspector & reconciliation** — raw-event drawer, per-relay
  holdings, ledger diff with confirmed/missing/remote-only, summary
  panel, privacy footer, open-in-reader for reconstructable articles.
- **12.7 Hardening** — the multi-agent adversarial review
  (correctness / integration / design-fidelity, probe-verified), fixes,
  `docs/SMOKE_TEST.md` **§Phase 12** grouped checklist, ROADMAP/
  CHANGELOG/JOURNAL final pass.

Every push gates on `npm run build` + `npm test` + `npx --yes web-ext
lint --source-dir . --self-hosted`. New parsers and anything
wire-touching get house-style unit tests in 12.1; no wire-format changes
are expected anywhere in the phase (if one becomes necessary it triggers
the full CHANGELOG + JOURNAL + dual-read discipline).

## Known limitations (accepted for v1)

- **NIP-07 identity is indirect** (history/sync-key/manual) until the
  tab-routed fetch follow-up.
- **30078 stays ciphertext** — listed, never decrypted, even when the
  `xray:user` key could. (Decrypt-and-diff against local entities is a
  natural follow-up that belongs with sync, not the portal.)
- **Comments, accounts, and 32125 have no publish ledger**, so they
  can't be "missing," only present/remote-only.
- **Snapshot queries, not live subscriptions** — refresh is
  on-open/on-demand (`queryRelays` is point-in-time by design,
  `nostr-client.js:199`).
- **No NIP-09 deletion/unpublish**, no publish actions of any kind.
- **Search is in-memory substring/token matching** — fine for personal
  corpora; a worker-offloaded index is the scale follow-up.
- **Full free-floating graph deferred** to a later slice/phase.

## Review questions — all decided 2026-06-10

The four from the kickoff plus one this design surfaced. All five
answered by the maintainer on 2026-06-10:

1. **Identifying "me":** ✅ **yes** — the four-source union resolver
   (signer / `xray:user` sync key / `publishedPubkeys` history / manual
   npub) with provenance chips, **no NIP-07 tab-routing in v1**, and
   entity kind-0 queried as a separate-subscription fan-out across all
   entity pubkeys.
2. **Graph build:** ✅ **yes** — **hand-rolled SVG radial ego layout, no
   third-party graph dependency** (bundle-size + no-deps posture +
   deterministic legibility; Firefox 128 floor untouched).
3. **Graph scope:** ✅ **confirmed** — **entity-centric spokes view in
   v1**, full free-floating graph as a later slice.
4. **Privacy:** ✅ **sufficient as designed** — no new content
   disclosure; correlation caveat documented + stated in a portal
   footer; queries restricted to the user's configured relays; entity
   queries kept in a separate subscription. No explicit first-open
   consent step required.
5. **Reconciliation is display-only:** ✅ **yes** — the portal never
   backfills `markPublished` (no ledger writes from a read surface),
   and remote-only items render fully but are never imported into
   local models in v1.
