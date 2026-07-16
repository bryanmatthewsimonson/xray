# The Network client — Phase 25 design

> **Status:** normative for the Network *surface* (2026-07-16).
> [`KNOWLEDGE_SHARING_DESIGN.md`](KNOWLEDGE_SHARING_DESIGN.md) (KS)
> stays normative for the follow/incorporation *engine* it renders —
> this document maps KS §5/§6/§8 onto a concrete page and records the
> surface-level decisions those sections leave open.
> [`TEAM_CASE_DESIGN.md`](TEAM_CASE_DESIGN.md) (TC) rules are imported
> where cited.
>
> **Maintainer decisions (2026-07-16, recorded from planning):**
> v1 scope is **follows + feed + incorporation** — no kind-1 notes, no
> DMs; the surface is a **standalone full-tab Network page**
> (`src/network/`); follow lists get an **opt-in, default-off kind-3
> NIP-02 mirror of the global scope only** (amended KS §9).

## §1. What this is for

A social layer for people genuinely curious about the truth. The
stranger story it must serve end to end: someone installs X-Ray with
nothing but a NOSTR keypair, pastes a researcher's npub, follows them,
reads their published artifacts (articles, claims, assessments,
audits, verdicts, case briefs), and pulls the pieces they find
convincing into their own corpus — **on their own terms, one reviewed
accept at a time** (KS §6). Conversation happens in the existing
judgment kinds: you respond to a claim by assessing it (30054),
disputing it (30061), or adjudicating it (30063) — not by posting.
Disagreement renders side-by-side and is never averaged (KS §7.5).

## §2. The surface

A standalone full-tab extension page, `src/network/index.html` +
`network.bundle.js` (new esbuild entry), opened via the
`xray:openNetwork` message exactly like the portal (`openPortal`);
no manifest entry required. It is **not** part of the "My Archive"
portal — the portal is self-framed; this page is other-people-framed.
The two stay separate surfaces sharing `src/shared/` modules only
(house rule: no cross-surface directory imports).

Three views, portal-style in-JS routing:

- **Feed** — the follows feed (§3).
- **Queue** — the incorporation review queue (§5) and, from 25.4, the
  inbound review-request strip.
- **Follows** — the global follow list: add by npub paste, relabel,
  remove; from 25.6 the opt-in kind-3 mirror controls live here.

The whole surface is gated by the `networkPage` flag (default off) —
context-menu item, options/sidepanel links, and page boot all check
it. Flags gate surfaces and publish paths, never read parsing.

## §3. The feed

- **Axis:** KS §5's `{authors: [follows…], kinds: […]}` query class —
  the global follow set's pubkeys. Note (amended KS §12.2): 30063
  verdicts are author-signed, so followees' verdicts arrive
  first-class on this axis.
- **Kinds:** `NETWORK_FEED_KINDS = [30023, 30040, 30054, 30055,
  30062, 30063, 30064, 30068, 32126, 1985]` — pinned by test.
  Deliberately a subset of the portal's `CONTENT_KINDS`: no 30041
  comment bodies, no 30078 ciphertext, no dormant metadata kinds.
- **Pull, not live** (KS §5/§9): fetch on open + manual Refresh
  through the existing `xray:relay:query`; no subscribe primitive.
- **Cache:** IndexedDB `xray-network` (the portal-cache pattern) —
  derived, droppable, wiped by fresh-workspace reset and a manual
  "Clear feed cache" action; the follow list itself lives in
  `chrome.storage` (`follow_sets`) and never in the droppable DB.
- **Read-state:** a `lastLookedAt` cursor per view; the "new since
  you last looked" strip is `firstSeenAt > lastLookedAt` (TC §5).
- **Volume:** per-author render cap (newest ~100 per author per
  refresh) against followee flooding; verification is already
  LRU-cached and chunked (KS §12.1).

## §4. Rendering discipline — KS §8 mapped to UI

Checklist the feed renderer must satisfy (guard-tested where pure):

1. Default view = **self + follows**, newest-first. No other ordering
   exists; nothing is ranked, ever (TC §3.8).
2. **Unfollowed material is collapsed**: one row per foreign author —
   npub, event count, kind breakdown — metadata-first, body only on
   explicit click, labeled untrusted (TC §3).
3. **npubs beside names everywhere.** A display name is never shown
   without its npub; profile names come from cached kind 0 and are
   clearly the author's own claim.
4. **Provenance propagation:** an item whose `a`/`e`/`x` refs resolve
   outside self+follows carries a "builds on unfollowed material"
   badge (TC §3.3).
5. **No persist-on-view** (KS §6/§12.3): rendering the feed writes
   nothing into local models — the incorporation queue is the only
   door, and it is per-artifact explicit.
6. Detail = a lightweight drawer (raw event JSON copy, coordinate,
   author npub, open-in-reader for 30023 via `xray:reader:open`) —
   deliberately **not** the portal inspector, which carries
   ledger/reconciliation concepts this page must not imply.

## §5. Incorporation — recorded decisions

KS §6 governs the semantics (proposals not facts; accept/decline;
unfollow keeps incorporated artifacts, TC §10.4). Three decisions the
engine spec left open are fixed here:

1. **Foreign assessments and verdicts land in a dedicated read-only
   store (`incorporated_artifacts`), not the native models.** Foreign
   *claims* and *link edges* are content and DO enter `ClaimModel` /
   `EvidenceLinker` with provenance (`suggested_by: 'nostr:<pubkey>'`
   + an `origin` record). But a foreign 30054/30063 entering
   `claim_assessments`/`adjudicated_verdicts` would pollute "my
   judgments" rollups, exports, and publish inventories. The dedicated
   store keeps publish selectors clean **by construction** and renders
   side-by-side with native records (never averaged — P8). This
   nuances KS §6's "enter your local models" wording; the nuance
   governs.
2. **Nothing incorporated is ever republished as yours.** Publish
   selectors exclude `origin`-carrying and `nostr:`-suggested records;
   guard-tested. Re-broadcast (§6) is the only way foreign events
   reach your relays, verbatim under the author's signature.
3. **Declines persist** (`incorporation_dismissals`, keyed by event
   coordinate) — a declined proposal never re-surfaces.

## §6. Thin coordination (25.4) and the kind-3 mirror (25.6)

- **Review requests:** kind-1985 labels, `L xray/review`, `l` ∈
  {`review-requested`, `review-done`} (pinned enum — TC §10.3), on
  subject `a`/`e`/`r` tags, never a `p`. Publishing them (and the
  re-broadcast button) is gated by `reviewCoordination` (default off).
- **Re-broadcast-who-you-follow** (TC §2.5): verified cached events
  re-published verbatim, capped per run; user-initiated only.
- **Kind-3 mirror** (amended KS §9): global scope only; flag
  `followListPublishing` (default off) + a first-enable consent
  dialog (it publishes who you follow, under your primary identity,
  effectively irrevocably). **Clobber protection is mandatory:**
  kind 3 is replaceable and the user may maintain a contact list in
  another client on the same nsec — every publish fetches the
  current remote kind 3 first, UNIONs unknown remote entries into the
  publish set, and shows the diff before signing; if the fetch fails
  on every relay, a loud warning precedes any replace. Local labels
  ride as NIP-02 petnames only via a per-publish checkbox (default
  unticked — naming people is its own disclosure).

## §7. Trust filter (25.7 — last, droppable)

KS.8: `trust-graph.js` `composeGraph` seeded with a synthesized
contact-list from the **local** global follow set (registry primary;
the user's own published kind 3 is optional input), plus follows'
fetched kind 3s. Under the existing `trustGraphFilter` flag, the feed
gains (a) a narrow-only filter toggle (default off; it never
reorders) and (b) "followed by N of your follows" count chips on
collapsed unfollowed groups — counts as discovery, never ranking.
`ranker.js` stays unwired; feed order remains newest-first.

## §8. Flags

| Flag | Gates | Default |
|---|---|---|
| `networkPage` | the Network surface (menu, links, page boot) | off |
| `reviewCoordination` | review-label publish + re-broadcast | off |
| `followListPublishing` | the kind-3 mirror + consent dialog | off |
| `trustGraphFilter` (existing) | the §7 filter toggle + count chips | on |

## §9. Non-goals (v1)

No kind-1 notes or replies; no DMs; no live relay subscriptions; no
ranking or reputation; no persist-on-view; no auto-merge of foreign
entities (the adopt prompt always shows); no new wire kinds (kind 3
is standard NIP-02); no mute list (collapsed-unfollowed already
reduces a griefer to one line — revisit on real use); no sidepanel
KS.4 feed changes.

## §10. Slice map

| Slice | Content | KS/TC anchor |
|---|---|---|
| 25.0 | This doc + KS §5/§9/§10/§11 + TC header amendments | — |
| 25.1 | `follow-model.js` registry (case/entity/global) + relay-hint harvest | KS §5 |
| 25.2a | Network page scaffold + authors-axis fetch + feed render | KS §5/§8 |
| 25.2b | `xray-network` cache + read-state + awareness + follow/paste/adopt | TC §5 |
| 25.3 | Incorporation queue + provenance + publish-selector guards | KS §6 |
| 25.4 | Review-request labels + review queue + re-broadcast | KS.6 / TC.4 |
| 25.5 | NIP-65 widening + confirmed-OK identity publishes | KS.7 / TC §2.5 |
| 25.6 | Kind-3 opt-in mirror — the phase's only wire change | amended KS §9/§10 |
| 25.7 | Trust-graph feed filter | KS.8 |
