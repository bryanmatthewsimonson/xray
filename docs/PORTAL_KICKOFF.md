# Phase 12 — "My Archive": a portal to everything you've published

**Status:** kickoff brief, 2026-06-10. This is the prompt for a *new
session* to deliver Phase 12. Design-first: produce a `docs/` design note
for maintainer review **before** writing feature code, then build in slices
(the Phase 11 working agreement). **Verify everything here against the
current `main` first — the repo is the source of truth and may have moved.**

## Your job this session

Build a **personal data portal** inside X-Ray: a surface where a user can
see, search, and visually explore everything they have published to NOSTR
relays — articles, atomized claims, the YouTube/Substack comments they
captured, their assessments and contradiction links, the entities and cases
they've built, and the cross-platform identities they've stitched together.
A portal to your own knowledge graph.

## Read first (and verify — don't take this brief's word for it)

- `CLAUDE.md` — the four execution contexts, the `xray:*` message bus, the
  conventions. **The load-bearing fact: extension pages have no relay
  access.** The side panel and reader route every relay read through the
  background service worker's `xray:relay:query` (and writes through
  `xray:relay:publish`). Your portal must do the same.
- `docs/ROADMAP.md`, `docs/JOURNAL.md` (newest entries first),
  `docs/ASSESSMENTS_DESIGN.md`, `docs/NIP_DRAFT.md`, `CHANGELOG.md` —
  Phase 11 is complete; you're building on top of it.
- The relay query path: `src/shared/nostr-client.js`
  `queryRelays(relayUrls, filter, timeoutMs)` accepts arbitrary NIP-01
  filters (`authors`, `kinds`, `#r`, `#p`, `#d`, …) and **dedups by event
  id only** — there is no replaceable-event dedup, so a republished
  addressable event returns once per version. The side panel's
  `dedupeReplaceable` (latest-wins per `(kind, pubkey, d)`) in
  `src/sidepanel/index.js` is the pattern to reuse.
- The side panel's Phase 10.4/11.5 query flow (`loadNetworkClaims` →
  `xray:relay:query` with `{kinds, '#p':[entityPubkey]}`) — your closest
  prior art for "query relays from an extension page and render."
- `src/shared/event-builder.js` — every kind X-Ray emits, and the
  **inverse** helpers you'll lean on: `reconstructArticleFromEvent`
  (30023), `reconstructPlatformAccount` (32126). `parseClaimEvent` is in
  `src/shared/claim-model.js`; `parseRelationshipEvent` in
  `src/shared/evidence-linker.js`. **There is no parser yet for kind-30041
  comments or wire kind-30054 assessments — you'll write those (pure,
  dual-read-friendly, unit-tested, mirroring the existing parsers).**
- The local "I published this" ledger: `markPublished` on claims,
  assessments, links, and entities records `publishedAt` /
  `publishedEventId` / (claims:) `publishedPubkey`. The portal should
  **reconcile** this local ledger against relay truth — "I think I
  published 40 things; the relays confirm 37; 3 are missing."

## The corpus — exactly what "everything you've published" means

Everything below is signed by the **user's signing identity** (`userPubkey`
from NIP-07 / Local / NSecBunker) **except** entity kind-0 profiles, which
are signed by each **entity's own keypair** (the user controls those keys
locally), and entity-sync (30078) signed by the reserved `xray:user` key. So
"my published corpus" is the union of:

| Kind | What it is | Notable tags to surface |
| --- | --- | --- |
| `30023` | A captured page (article / Substack post / YouTube video) as Markdown | `title`, `r` (source url), `published_at`, `image`, `author`, `t` topics, embedded `claim` tags |
| `30040` | An atomized **claim** | content = text; `p …about` (entity pubkeys), `entity …about` (names), `source`, `anchor`, `key`, `r` |
| `30041` | A **captured comment** (YouTube / Substack) | `comment-text`, `comment-author`, `platform`, `author-handle`, `author-url`, `comment-date`, `reply-to`, `reaction-count`, `restack-count`, `p …commenter`, `r` |
| `30054` | An **assessment** (your judgment) | `a` (claim coord), `stance`, `L`/`l` labels `xray/assessment`, `label-anchor`, `label-note`, `p …about`, `r` |
| `30055` | A **claim relationship** (contradicts/supports/updates/duplicates) | two `a` coords + `source`/`target` markers, `relationship`, `r` |
| `1985` | The NIP-32 **label mirror** of a labeled assessment | `L`/`l`, `a`, `r` |
| `0` | A **kind-0 profile** for each entity you created (signed by the *entity's* key) | name, about, nip05 |
| `32125` | An **entity↔article relationship** | `p …<role>`, `relationship`, `entity-name`, `claim-ref` |
| `32126` | A **platform account** (cross-platform identity you captured/linked) | `account-platform`, `account-id`, `account-username`, `account-name`, `linked-entity`, `r` |
| `10002` | Your NIP-65 **relay list** | the relays you publish to |
| `30078` | **Entity-sync** blobs (NIP-44 encrypted, signed by `xray:user`) | opaque — list, don't try to render content |
| dormant | `30050` annotations, `30051` fact-checks, `30052` ratings, `30053` topic-trust, `9803` helpfulness | flag-gated; may have zero events — handle gracefully |

The query is roughly
`{ authors: [myPubkey, ...myEntityPubkeys], kinds: [...all of the above], limit: N }`
fanned across the configured relays — but see the hard parts.

## The framing — design for scale even though v1 is personal

Imagine tens of millions of people capturing this same data: claims
accreting about every public person, org, place, thing, and unfolding story;
comments archived from videos and posts that the platforms later delete;
contradictions surfacing across sources. **This portal is "my data" first —
but design the information architecture as if it's a window onto that larger
graph, because the same primitives drive both.** Think about every way this
content wants to be surfaced, and pick the few that are genuinely intuitive:

- **By entity (the knowledge graph).** Entities (person/org/place/thing/case)
  are the natural nodes. Edges: *I claimed X about this entity*, *this entity
  said Y* (claim source), *these two claims contradict* (⚠), *this case
  clusters these claims*, *this platform account is this person*. A case is a
  super-node clustering its claims and the people/orgs involved. The graph is
  the headline "explore visually" surface — but it must stay legible at
  hundreds of nodes (cluster, filter by type, focus+neighbors,
  search-to-locate).
- **By type.** Articles, claims, comments, assessments, links, entities,
  cases, accounts — each a browsable, paginated, filterable list.
- **By time.** A publish-date timeline — when did I archive what, with
  density/spikes around active capture sessions and cases.
- **By case.** Each case ("John Dehlin excommunication", "Bricks & Minifigs
  scandal") as a dashboard of its published artifacts — the publish-side
  complement to the existing local case dashboard.
- **By source.** Group by captured URL / domain / platform — "everything I
  pulled from this YouTube channel", "all my archived Substack comment
  threads."
- **Cross-cutting search.** Full-text over claim text, comment text, article
  titles, entity names, rationales — fast, incremental, with type facets.
- **Reconciliation & provenance.** For any item: which relays actually hold
  it, when it was published, the raw signed event (copyable), a link back to
  the source URL, and a way to re-open it in the reader or jump to its
  entity/case. Surface the gaps — locally-marked-published-but-not-found, and
  found-on-relays-but-not-in-local-ledger (things published from another
  device).

## Decided shape (refine in the note) + open questions for the maintainer

- **A new full-tab extension page** (`src/portal/`), not a side-panel cramp —
  the graph + timeline want width. New esbuild entry point + HTML shell +
  manifest wiring + a context-menu / toolbar entry to open it
  (`chrome.tabs.create`). The reader is your template for a full-page
  surface. (The esbuild config builds `options`/`sidepanel`/`reader` from a
  mapped array of entry-point names — add `portal` there; the manifest
  references `dist/*.bundle.js` from HTML shells.)
- **Read-only v1.** The portal *shows and explores*; it does not publish or
  delete. (NIP-09 "unpublish from relays" is a tempting follow-up — note it,
  don't build it.)
- **Cache + incremental.** Querying the whole corpus across relays on every
  open is too slow at scale. Cache results (IndexedDB, like
  `archive-cache.js`), show cached instantly, refresh in the background,
  dedup replaceable events client-side.

Open questions to put to the maintainer in the design note:

1. **Identifying "me":** how does the portal learn `myPubkey` outside a
   capture context (NIP-07 `getPublicKey`, the Local primary identity,
   NSecBunker)? And do we fan out across **all** entity pubkeys as `authors`,
   or query entity kind-0 separately?
2. **Graph library vs. hand-rolled SVG/canvas** — the repo has no framework
   and no heavy deps by design; weigh a tiny force-layout vs. building one
   against the bundle-size / Firefox-128-floor constraints.
3. **Scope of v1's graph** — full knowledge graph, or start with the
   entity-centric "spokes from one entity" view and grow? *(Maintainer's
   lean: start with the entity-centric spokes view; treat the full
   free-floating graph as a later slice. Confirm in the note.)*
4. **Privacy callout** — querying relays by `authors:[myPubkey]` is already
   how sync works, but a portal makes the pubkey↔content link first-class;
   anything to warn about?

## Working agreement (same as Phase 11)

- **Design note first** (`docs/PORTAL_DESIGN.md` or similar): data flow, the
  my-pubkey/entity fan-out resolution, the kind→parser inventory (incl. the
  new 30041/30054 parsers), the IA + the chosen surfaces, the graph
  approach, caching/reconciliation, the new-page build wiring, and the slice
  plan. **Check in with the maintainer before feature code.**
- Branch `claude/phase-12-*`; one concern per PR; small reviewable slices
  (e.g. my-pubkey resolution + corpus query + parsers → list/type views +
  search → timeline → entity/case views → knowledge graph → reconciliation
  polish). Open UI PRs as draft for smoke-testing.
- Gate every push on green `npm run build`, `npm test`,
  `npx --yes web-ext lint --source-dir . --self-hosted` (`web-ext` isn't a
  local dep — use npx; lint warnings are fine, errors aren't).
- New parsers and any wire-touching code get unit tests in the house style
  (`node --test`, hand-built `chrome.storage` shims, exhaustive-enum pins).
  No new event kinds expected — this is a *reader* of existing kinds — but if
  you find you need one, that's a wire-format change with the full CHANGELOG
  + JOURNAL + dual-read discipline.
- Add JOURNAL entries for non-obvious decisions; keep ROADMAP/CHANGELOG
  current. **Run a multi-agent adversarial review over the finished slices
  before the final merge** (correctness / integration / design-fidelity
  lenses, each finding verified with probes), fix what's confirmed, then
  deliver a grouped **§Phase 12** smoke-test checklist in
  `docs/SMOKE_TEST.md`.
- `dist/` is gitignored: after checkout `npm run build` + reload the
  extension card, then open the portal.

## Acceptance (demo on real data)

With a profile that has published a case or two (claims, comments,
assessments, a cross-video `contradicts` link, entities, a couple of
captured articles): open the portal → see the full published corpus,
instantly from cache then refreshed from relays → **search** a name and
watch claims/comments/entities filter → scrub the **timeline** to a capture
session and see what landed → open the **knowledge graph**, focus an entity,
and walk its claims, the people/orgs around it, and a ⚠ contradiction → open
a **case** and see its published artifacts → click any item to view its raw
event, the relays holding it, and a jump back to the source or the reader →
and see the **reconciliation** flag where the local ledger and the relays
disagree.
