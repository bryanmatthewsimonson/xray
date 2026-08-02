# The local event store — store-first publish (Phase 29)

> **Status:** design **agreed 2026-08-02** — the maintainer ruled on
> all seven review questions; §13 records the rulings in place.
> Commissioned 2026-08-01 from planning (maintainer: "X-Ray the
> client needs to be thoughtfully designed"). Nothing is built yet;
> slices at §11. The NIP-01 filter engine is deliberately **not**
> designed here — see §4.3.
>
> **Maintainer decisions (2026-08-02):** Phase 29, numbered, with a
> described ROADMAP entry. Flag flips gate on the smoke rows alone.
> `is_private` adopts the local-only `held` tier (a recorded
> divergence from crux `PLAN.md` — §6). crux.immo coordination is
> backburnered — X-Ray is the focus. Subsumption order is
> network-then-portal. The localhost dev tier is recorded as
> SANCTIONED future tooling. Merge-imported pending rows join the
> flush queue.

Related: [`KNOWLEDGE_SHARING_DESIGN.md`](KNOWLEDGE_SHARING_DESIGN.md)
(KS — its owner constraints of 2026-07-03 and its §9 non-goals are
imported: public relays only, zero new wire kinds, pull-not-live),
[`TEAM_CASE_DESIGN.md`](TEAM_CASE_DESIGN.md) (TC — §2.5 descoped the
self-hosted relay; JOURNAL 2026-07-08 later re-filed it as a
documented, untriggered contingency — this design adds no relay
process either way), [`PORTAL_DESIGN.md`](PORTAL_DESIGN.md) (the
read-only reconcile contract is untouched in code; §4.2 pins the rule
that keeps its *input* honest), `docs/JOURNAL.md` 2026-07-10 (the
signed-event journal this design extends), and crux.immo `PLAN.md` §5
(in the companion crux.immo repository, not this repo — the
consumption-side counterpart whose relay X-Ray will eventually default
to; cross-repo items in §6).

## §1. The gap

X-Ray's knowledge of NOSTR events is scattered across five
hand-rolled IndexedDB stores (journal, portal cache, network cache,
archive, audits), each with a bespoke write path and a bespoke query
API. Three publish-side defects share that root cause:

1. **A publish that no relay accepts loses the signature.** The
   reader's gate journals only when `results.successful > 0`
   (`src/reader/index.js:4731-4759`): with every relay down or
   rejecting, the signed event is discarded — no journal row, no
   ledger mark, a NIP-07 approval click wasted. The journal's own
   header calls signatures irreplaceable for NIP-07 identities
   (`src/shared/event-journal.js:18-22`); today they are exactly as
   losable as the network is flaky.
2. **An assumed-only publish retries by re-signing, not by
   flushing.** An assumed-only send IS journaled, but the retry path
   ("stayed UNMARKED locally so the next publish retries them") builds
   and signs a NEW event instead of rebroadcasting the journaled copy
   verbatim — a needless second prompt under NIP-07, a needless new
   event id under any signer. The verbatim-rebroadcast machinery
   already exists (`src/portal/index.js:624-654`); only reconcile's
   missing-row repair uses it.
3. **"Signed ⇒ journaled" is per-call-site, not structural.** The
   reader's `publishOk` covers its families (including everything
   routed through the background's `xray:capture:publish` handler —
   the reader is that handler's only caller), and `entity-sync.js`
   journals its pushes. Everything else signs and publishes with no
   journal row: the network page's kind-3 mirror
   (`src/network/index.js:736-749`), the portal's entity page
   (`src/portal/entity-page-block.js:361-364`), case brief + kind
   30068 (`src/portal/synthesis-block.js:566-571`), review-request
   label (`src/portal/inspector.js:346-357`), kind-0 entity-profile
   republish — an IDENTITY kind —
   (`src/portal/entity-dossier-view.js:125-140`), and entity-sync's
   own `clearRemote` kind-5 chunks
   (`src/shared/entity-sync.js:462-473`). Nothing enforces the
   invariant; coverage is whatever each surface remembered to do.

The read side has the mirror problem: every relay read is a
5-second-timeout round trip (`src/shared/nostr-client.js:214`), every
surface keeps its own cache with its own API, and "which claims anchor
to this URL?" — the query the crux.immo alignment will ask on every
page visit — has no fast local answer.

The requirement, in one line: **signed ⇒ durable, at the cost of one
local write; publishing becomes flushing; local queries answer NIP-01
filters without the network.**

## §2. What "local relay" means here — the tradeoff analysis

### §2.1 A localhost relay process (strfry, a tray relay)

- ✗ **Feasibility**: an MV3 extension cannot host one — there is no
  listening-socket API in the web platform. It would be a separate
  install per machine.
- ✗ **Posture**: TC §2.5 descoped self-hosted relay infrastructure
  for the sprint; JOURNAL 2026-07-08 keeps it as a documented
  contingency (trigger: fewer than 3 public relays accept + retain
  our kinds), untriggered. The §5.1 durability doctrine
  (EPISTACK_WIN_PLAN — doc removed, PR #109; revived by owner
  decision, JOURNAL 2026-07-10) made the signed-event export, not any
  relay, the durability guarantee. A relay process serves neither.
- ✓ **Sharing**: other NOSTR clients could read the same store.
- ✓ **Features**: real relay capabilities (sync, subscriptions) for
  free.

Rejected as this phase's architecture. A LOCALHOST dev tier under the
transcriber companion's loopback-pinning precedent
(127.0.0.1/localhost/[::1] only) is sanctioned as future tooling (Q6,
2026-08-02) — its own later design, no part of Phase 29.

### §2.2 SQLite-WASM in a worker (`@snort/worker-relay` style)

- ✓ **Queries**: real SQL over event tables.
- ✗ **Portability**: OPFS + threading constraints are a gamble
  against the Firefox 128 floor, which is load-bearing and pinned.
- ✗ **Posture**: a heavy foreign dependency in a no-framework,
  own-crypto codebase; new build machinery for the worker bundle.

Rejected.

### §2.3 An in-extension store speaking the relay's contract

Implement the relay's CONTRACT — signed EVENT in, NIP-01 filter out —
as a shared module over IndexedDB, exactly like the five IDB stores
the repo already hand-rolls.

- ✓ **Install**: none; ships in the extension.
- ✓ **Contexts**: IndexedDB is origin-shared, so reader, portal,
  network, sidepanel, and the SW all read it directly, no message
  hop.
- ✓ **Posture**: no new wire kinds, no sockets, no subscriptions —
  the KS constraints hold by construction.
- ✗ **Sharing**: X-Ray-only; nothing else can query it. Accepted —
  sharing is what public relays are for (KS).

### §2.4 Verdict — the local relay is a posture, not a process

Option 2.3, in two layers with different preciousness. The **journal**
(exists today; PRECIOUS; backup-covered via `WORKSPACE_DATABASES`)
becomes the outbox by widening its write gate from
first-relay-success time to **sign time**. A **new derived store**
(droppable, like `xray-portal`/`xray-network`) becomes the queryable
index over everything — own events and the network's. Layer 1 fixes
durability; layer 2 fixes queries; neither needs the other to ship.

## §3. Layer 1 — the journal becomes the outbox

The rule: **an event is journaled the moment it is signed**, before
any relay send. Everything else follows from that inversion.

### §3.1 Journal row, v2

```jsonc
{
  eventId, kind, pubkey, address, createdAt,
  event,            // verbatim signed event — unchanged
  articleUrl,       // unchanged
  signedAt,         // NEW — epoch s; row creation is now sign time
  publishedAt,      // last flush attempt (null until the first)
  relays,           // [{url, success, assumed}] — unchanged shape
  flush: {          // NEW — the outbox state machine
    state,          // 'pending' | 'flushed' | 'held'
    attempts,       // flush attempts so far
    nextAttemptAt   // epoch s; backoff schedule (§3.3)
  },
  ledger: {         // NEW — how to mark the local model on confirm
    model,          // 'claim' | 'entity' | 'assessment' | … | null
    localId,        // the model's own id (claim.id, entity id, …)
    extra,          // model-specific args (dTag, rekeyedCoord, …)
    markedAt        // epoch s once the mark ran; null until then
  }
}
```

- `pending` — signed, zero CONFIRMED OKs anywhere. Assumed-only
  stays `pending`: the confirmed-vs-assumed doctrine (JOURNAL
  2026-07-10, `src/shared/nostr-client.js:169-172`) is **unchanged**
  by this design — it now drives the flusher instead of a re-sign.
- `flushed` — at least one confirmed OK.
- `held` — excluded from flushing by policy. Decided (Q3,
  2026-08-02): **`is_private` captures are `held`** — signed,
  journaled, exported in the bundle, never flushed; the journal is
  their only home (§6). The capture-side Private toggle that sets it
  ships in 29.2.

**Supersession is computed, never stored.** At flush time a `pending`
row is skipped when a newer-`created_at` signed row exists at the
same `replaceableKey` (`src/shared/nostr-events.js:18-33`) — computed
across the whole journal, so it stays correct after backup
merge-imports unite two machines' histories (§3.4). The journal
remains append-only history; no row is ever rewritten as
"superseded." Note `replaceableKey` is NOT a pure widening of the
journal's current `eventAddress`: the two agree on addressable events
with a non-empty `d` tag, but for a missing/empty `d`,
`replaceableKey` falls back to the event id where `eventAddress`
yields null/`kind:pubkey:` — the migration recomputes every address
under the new rule.

**The `ledger` descriptor** is written by the gate at sign time, when
the call-site context is in hand. Without it, late-confirm marking is
unimplementable: "the ledger" is really a fan-out across the ~12
per-kind stores reconcile's `loadLocalLedger` enumerates
(`src/portal/reconcile.js:59-294`) — ClaimModel / EntityModel /
AssessmentModel / the forensic-verdict-integrity families /
archive-cache `publishedToRelay` / case-membership /
published_mentions among them — each needing arguments (dTag,
rekeyedCoord, the model's local id) that the signed event alone does
not carry.

**Migration (v1 → v2), for existing installs:** `flush.state` derives
from the stored relay snapshot (any confirmed OK → `flushed`;
assumed-only → `pending`, preserving today's retry doctrine — 29.1
removes the re-sign path, so these rows MUST enter the queue or the
retry promise silently dies). `signedAt` backfills from `publishedAt`
(approximate, documented as such). Addresses recompute under
`replaceableKey` for every row, which also gives historical
kind-0/3/10002 rows addresses for the first time. Migrated `pending`
rows get a deferred `nextAttemptAt` — no first-wake flood of the
historical assumed-only backlog into a rate-limited relay (§6).
`ledger` backfills null (their marks already ran or were declined
under the old rules). `getByAddress` and `exportBundle` re-sort on
`signedAt` (falling back to `publishedAt`) so pending rows — whose
`publishedAt` is null — order correctly.

### §3.2 One gate, structurally

A new shared module (`src/shared/publish-gate.js`) becomes the ONE
path from signer to relays: sign → journal (`pending`) → inline
attempt → snapshot results. Every sign-and-publish site routes
through it — the reader's publish families, entity-sync's pushes AND
`clearRemote`, the network page's kind-3 mirror, and the portal's
four sign sites (§1.3). The gate is a shared library running in EACH
publishing context (reader, sidepanel, network, portal, SW); IndexedDB
is origin-shared, so the journal rows land identically regardless of
context, and the gate keeps using the existing SW transports
(`xray:capture:publish`, `xray:relay:publish`) for the relay leg.

"Signed ⇒ journaled" then stops being a convention and becomes
structural, guard-tested at the transport layer: outside the gate and
the flusher, no module calls `NostrClient.publishToRelays` or sends
`xray:relay:publish`/`xray:capture:publish`. (A guard on
`publishToRelays` alone would miss the portal sites, which publish
through the message transport and never touch the pool directly.)

The honest durability bound: the loss window shrinks from "until a
relay accepts" to **sign → one local IDB commit**. A page closed
inside that window can still lose a signature; nothing can shrink it
further from inside the extension.

The inline attempt is load-bearing: **the queue is a failure
fallback, not a delay**. The happy path still publishes at capture
time — crux.immo's capture-to-render-within-5s done-criterion
(`PLAN.md` Phase 2) is preserved. `publishOk`'s ledger-marking rule
(CONFIRMED only) moves into the gate unchanged.

### §3.3 The flusher

A background pass over `flush.state == 'pending'` rows whose
`nextAttemptAt` is due: skip superseded rows (§3.1), rebroadcast the
journaled event VERBATIM (the generalization of the portal's
`rebroadcastMissing`), record the per-relay snapshot, mark `flushed`
on a confirmed OK, and run the row's `ledger` mark (late
confirmation). Backoff is exponential with a ceiling (attempt 1
inline at sign time, then ~5 min, ~30 min, ~2 h, capped at ~6 h);
there is **no give-up state** — a permanently failing row stays
visible (§7), never silently dropped.

Scheduling is `chrome.alarms` (§8) — the extension's FIRST alarm, so
the lifecycle is pinned here: one periodic alarm (`xray-flush`,
`periodInMinutes: 5`, matching the backoff floor and comfortably
above Chrome's 30-second minimum), created in `onInstalled` and
`onStartup` and kicked once immediately by the gate when a pending
row is written. The MV3 service worker wakes, flushes due rows with
the shared pacing constant (29.2 lifts the reader-local
`BATCH_PUBLISH_DELAY_MS` into `src/shared/` so the reader and the
flusher share one value), sleeps. The queue lives in IDB, so SW
suspension costs nothing — which also finally corrects the stale
header claim in `src/shared/nostr-client.js:1-4` (the sockets live in
the SW pool and in extension pages that import NostrClient directly,
not the content script — fix the comment in the same slice).

**Rejection handling.** Today any relay `OK false` rejects
permanently. The flusher classifies the NIP-01 machine-readable
prefixes: `duplicate:` → treat as confirmed (the relay has it);
`rate-limited:`, `error:`, and connection loss → retryable;
`invalid:`, `blocked:`, `restricted:`, `mute:`, `pow:` → permanent
for that relay (snapshot entry marked failed, no reschedule there);
unknown prefix → retryable at the ceiling. Permanent failures stay
visible per-relay; a row is `flushed` on its first confirmed OK from
ANY relay.

**Workspaces.** The relay leg of flushing is cross-workspace: the
flusher enumerates the workspace registry and opens each journal by
`workspaceDbName`, so a queue never starves because its workspace is
inactive. Ledger marks are the exception — the chrome.storage models
are namespaced to the ACTIVE workspace, so marks for an inactive
workspace defer (that's what `ledger.markedAt` tracks) and run when
that workspace next activates.

### §3.4 Merge and multi-machine

Backups are the Mac ↔ Windows sync path, and `mergeBackup` merges
`xray-events` by the generic id-keyed local-wins rule
(`src/shared/backup.js`) — so the design must survive two journals
uniting:

- **Stale versions cannot flush.** Supersession is computed at flush
  time across the merged union (§3.1), so importing a backup that
  carries a newer signed version at the same address retires the
  local older pending row automatically — a stored per-row state
  would have gone stale here.
- **Foreign pending rows JOIN the local queue** (decided — Q7,
  2026-08-02). Re-publishing is idempotent by construction
  (immutable, id-keyed events; `src/shared/confirmed-publish.js`),
  and §3.3's `duplicate:` classification makes a double-flush
  self-healing — the second machine's re-send draws a confirmation,
  not a duplicate, so both journals converge to `flushed`. The
  alternative (arriving `held`) would strand signed events silently
  on the less-checked machine, against §7's posture. The flusher's
  pacing and backoff absorb the rate-limit exposure (§6).
- **Conflicting flush states resolve local-wins** (the existing merge
  rule): a local `pending` beats an incoming `flushed`, costing at
  most one redundant, idempotent re-send.

## §4. Layer 2 — the derived event store

### §4.1 The database

One new IndexedDB database, `xray-relay` — the database that stands
in for a relay. It joins `DERIVED_CACHE_DATABASES`
(`src/shared/workspace-keys.js:52-58`): droppable, never backed up,
workspace-namespaced (the 2026-07-19 unscoped-cache incident rule
applies to it like any cache). Rebuild recipe: journal `listAll` +
the existing pull-refresh paths — droppable stays TRUE even though
own pending events are mirrored into it, because the journal is
their durable home.

One `events` store, keyPath `id`, with the portal-cache index scheme
(kind, pubkey, created_at, addr — `''` for regular events) **plus a
multiEntry `tags` index** of normalized single-letter tag pairs
(`'e:<id>'`, `'a:<coord>'`, `'r:<url>'`, `'p:<pubkey>'`, `'d:<val>'`,
`'x:<hash>'`). That index is what turns "claims anchored to this URL"
from a 5-second relay round trip into a ~1 ms lookup. The write
contract is the SAME merge/skip-stale/supersede contract
`portal-cache.js` and `network-cache.js` already share (keyed on
`replaceableKey`, relay-set merge, `firstSeenAt`/`lastSeenAt`), and
verify-on-ingest (KS.1) applies at the write door — the store never
holds a signature-invalid event.

**Persistence here is cache, not incorporation.** KS §6 warns that
persisting relay content on view "would make relay content
self-installing" — the volume-griefing vector TC §3.2 closes — and
KS §12.3 recorded no-foreign-event-persistence until KS.5's explicit
accept. The line that keeps this design on the right side of both is
the one `xray-network` already established (JOURNAL 2026-07-16):
provenance-tagged rows in a droppable, workspace-scoped cache are NOT
"entering your local models" — the KS.5 reviewed-accept queue remains
the ONLY door into models. The griefing bound gets teeth in 29.3: a
Clear-cache affordance plus a pruning rule for foreign rows with no
local reference (exact bound pinned in the slice).

### §4.2 Writers and readers

Writers: (a) **dual-write on journal append** — own events appear in
the store the moment they are signed, carrying an EMPTY relay set
until a confirmed OK arrives; (b) **ingest-on-read** — every
`queryRelays` result batch feeds the store, making it a read-through
cache of the network. Pull-not-live stands: no subscriptions (KS §9).

Readers: local-first. A surface asks the store first and refreshes
from relays via the existing pull paths. One rule is NORMATIVE from
day one: **relay-truth surfaces filter on provenance.** The portal's
reconcile is built on "the relays record TRUTH"
(`src/portal/reconcile.js:1-22`); a dual-written row with an empty
relay set is signed-but-nowhere-accepted, and letting it into
reconcile's item set would make "ledger says 40, relays confirm 37"
lie. Reconcile (and any future relay-truth read) consumes only rows
with ≥ 1 confirmed relay — an explicit acceptance criterion of slice
29.5. `xray-network` and `xray-portal` remain until repointed
(29.4/29.5); the store subsumes them one consumer at a time, and
their databases drop only after their last reader moves.

### §4.3 The filter engine — deferred, separately designed

The module that answers an arbitrary NIP-01 filter from these indexes
with relay-identical semantics is **deliberately not designed here —
it is the next design doc.** This doc pins only its contract: same
filter in, same events out as a compliant relay would give (ids,
authors, kinds, `#x` tag filters, since/until, limit-with-newest-first
ordering, replaceable latest-wins), so local and remote results merge
transparently. Until that doc lands, slice 29.3's store ships with
the narrow query helpers its first consumers need (by address, by
author+kind, by tag pair) — the same posture the existing caches have
today, just unified.

## §5. What does NOT change

1. **The confirmed-vs-assumed doctrine** (JOURNAL 2026-07-10) —
   ledger marks still key on CONFIRMED OKs only.
2. **Portal reconcile stays read-only** (PORTAL_DESIGN Review Q5).
   The flusher is publish-side machinery in the gate's lineage — the
   portal still never writes `markPublished`. (§4.2 guards its input;
   its code and contract are untouched.)
3. **The export bundle stays the durability guarantee** (the revived
   §5.1 doctrine; TC §2.5: "the signed-event JSON export remains the
   actual archive — relays are caches"). Sign-time journaling strictly
   WIDENS the bundle: it now contains everything you signed, not
   everything a relay happened to take.
4. **The wire format** — zero new kinds, zero new tags (KS
   constraint). This design emits nothing.
5. **Pull-not-live** — no live relay subscriptions (KS §9).

## §6. crux.immo coordination notes (cross-repo, informational)

- **NIP-42 AUTH**: crux.immo's relay will require AUTH from
  registered npubs. X-Ray speaks no NIP-42 today; the flusher needs
  it when `wss://relay.crux.immo` becomes the default. Additive to
  `nostr-client.js`; noted here so the slice that adds the default
  relay budgets for it.
- **Rate limits**: the planned 60 captures/hr per npub means a
  long-offline queue could trip the limiter on flush. The flusher's
  pacing + retryable-rejection backoff (§3.3) is the mitigation;
  never drop.
- **The late-arrival question** (the real coordination item): the
  crux indexer resumes its REQ with `since = cursor − 60s`. A queued
  event flushed after a long offline gap carries a `created_at` older
  than that window and may never match the indexer's filter even
  though the relay accepted it. `PLAN.md` is silent on this. Decided
  (Q4, 2026-08-02): crux.immo is backburnered and 29.2 does NOT gate
  on it — the item moves to the crux intake list (drop `since` from
  the live filter and rely on idempotent writes, or periodic
  re-scan) for whenever that work reactivates. Until a crux relay is
  in the default list, nothing flushes there anyway.
- **`created_at` stays capture-honest** — it records sign time, no
  coarsening, no rewriting at flush (§10). Late-published events are
  simply old events, which is the truth.
- **`is_private`**: `PLAN.md`'s model is a server-filtered flag —
  private captures are still published to the shared relay and
  rendered in the owner's /me feed. "Private = held locally, never
  flushed" is STRONGER than the plan. Decided (Q3, 2026-08-02):
  X-Ray adopts the local-only tier anyway — private captures are
  `held`, their only home the journal and its export bundle. This is
  a RECORDED DIVERGENCE from `PLAN.md` (whose /me feed and export
  expectations assume private events reach the server); it goes on
  the crux intake list with the late-arrival item above.

## §7. Failure modes and honesty

- **Nothing fails silently.** The publish summary generalizes the
  existing unconfirmed honesty line to three numbers: "journaled N ·
  confirmed M · pending K — retrying in the background." The portal's
  "Unpublished local artifacts" bucket generalizes to a pending-flush
  view with per-row relay snapshots; a row that keeps failing is
  permanently visible there, and inactive workspaces surface a
  pending count on the workspace switcher so a queue is never
  invisible.
- **Workspace delete and reset tell the truth.** The delete flow's
  confirmation currently promises "Published events stay on the
  relays" (`src/options/index.js:813`) — false for pending rows
  (signed, accepted nowhere). Both it and the reset flow (which also
  clears the journal) gain a "N signed events not yet accepted by
  any relay" warning when the journal being destroyed has pending
  rows.
- **Quota**: the manifest gains `unlimitedStorage` (§8), which also
  retires the stale assumption in `src/shared/archive-cache.js:33-37`
  that it was already declared. Eviction of `xray-relay` would be
  survivable by definition (derived); eviction of the journal would
  not be — `unlimitedStorage` protects both.

## §8. Manifest changes

`permissions` += `alarms` (the flusher's scheduler — today the
extension has no periodic background work at all) and
`unlimitedStorage` (§7). Both additive, both supported at the Firefox
128 floor; `web-ext lint` and a smoke walk gate them like any
manifest change.

## §9. Flags

| Flag | Gates | Default |
|---|---|---|
| `storeFirstPublish` | the gate + flusher (a publish-path change) | off |
| `localEventStore` | `xray-relay` + local-first reads | off |

Both ship default-off while the phase is in flight — the
`networkPage` precedent (`src/shared/metadata/feature-flags.js`:
every flag since Phase 9a defaults false). Flip-on gates on the §12
smoke rows ALONE — no soak period (Q2, 2026-08-02, "smoke is
sufficient"). `storeFirstPublish` falls
squarely under the repo rule (flags gate publish paths).
`localEventStore` is honestly a third category — an infrastructure
rollout gate, neither a surface nor a publish path — but the rule's
payload is intact: the SW still accepts incoming events of every
kind, and read parsing is never gated.

## §10. Non-goals (v1)

No localhost or native relay process in this phase (the JOURNAL
2026-07-08 contingency stands documented and untriggered; the
loopback dev tier is sanctioned future tooling, Q6, separately
designed); no live relay subscriptions
(KS §9); no new wire kinds or tags; no negentropy or any sync
protocol beyond plain REQ; no `created_at` coarsening or privacy
batching; no scheduled/delayed-publish UX (the queue is failure
recovery, not a scheduler); no filter-engine spec (§4.3 — separately
designed); no portal reconcile changes; no BYO-relay UI.

## §11. Slice map

| Slice | Content | Anchor |
|---|---|---|
| 29.1 | `publish-gate.js`: sign ⇒ journal (`pending`) ⇒ inline attempt ⇒ snapshot; journal DB v2 (`flush`, `ledger`, `signedAt`, recomputed addresses) + the v1→v2 migration; EVERY sign site routed — reader families, entity-sync push + `clearRemote`, network kind-3 mirror, the portal's four sign sites; the transport guard test | §3.1–3.2 |
| 29.2 | The flusher: `alarms` lifecycle + backoff, OK-prefix classification, computed supersession, cross-workspace queue + deferred ledger marks, portal pending-flush view, delete/reset warnings, summary honesty line, shared pacing constant, the capture Private toggle → `held` (Q3) | §3.3–3.4, §7 |
| 29.3 | `xray-relay` store: dual-write on journal append (empty relay set until confirmed), ingest-on-read from `queryRelays`, foreign-row pruning bound + Clear-cache, narrow query helpers, `unlimitedStorage` | §4.1–4.2 |
| 29.4 | Network feed reads from the store; `xray-network` retired | §4.2 |
| 29.5 | Portal reads from the store — acceptance: reconcile consumes only ≥1-confirmed-relay rows; `xray-portal` retired | §4.2 |
| 29.6 | The filter engine — its own design doc first, then slices | §4.3 |

Each slice is independently shippable; **29.1 closes the
signature-loss window** — provided its routing list is complete,
which is why §1.3's inventory is exhaustive and the guard test sits
at the transport layer — and is worth shipping even if everything
after it waits.

## §12. Testing

Per the house harness (`node --test`, fake-indexeddb, hand-built
`chrome.*` stubs): a v1→v2 migration test (v1 rows in, derived flush
states and recomputed addresses asserted); flusher tests over an
injectable clock + alarm stub (backoff schedule, OK-prefix
classification, computed supersession, cross-workspace enumeration) —
`chrome.alarms` has no existing stub pattern, this suite creates it;
`tests/event-journal.test.mjs` and `tests/backup-merge.test.mjs`
extend for v2 rows and merged flush states; the transport guard as a
grep-test (§3.2); SMOKE_TEST rows for 29.1 (publish with relays
blackholed → journaled pending, flushes on recovery) and 29.2
(assumed-only → flushed without re-sign).

## §13. Review questions — all decided 2026-08-02

1. **Phase number** — ✅ **Phase 29, numbered**, with a described
   ROADMAP entry (maintainer: "numbered with description would be
   helpful").
2. **Flag flips** — ✅ **"Smoke is sufficient."** Both flags flip on
   once the §12 smoke rows pass; no soak period. 29.1 stays behind
   `storeFirstPublish` with the rest — the flag flips early rather
   than the code shipping unflagged.
3. **`is_private`** — ✅ **adopt the local-only `held` tier** (§3.1,
   §6): private captures are signed, journaled, exported, never
   flushed. A recorded divergence from crux `PLAN.md`.
4. **The crux indexer late-arrival question** — ✅ **backburnered
   with the rest of the crux coordination** ("crux.immo is on the
   backburner at the moment; X-Ray is the focus"). 29.2 does not
   gate on it; §6 carries it on the crux intake list.
5. **Cache subsumption order** — ✅ **network first, then portal**
   (left to judgment; network-cache is the younger, simpler
   consumer and the Network tab is lightly used — lowest blast
   radius first).
6. **Localhost relay dev tier** — ✅ **recorded as sanctioned**
   future dev tooling under the transcriber-companion loopback
   precedent — separately designed, no part of this phase.
7. **Merge-imported pending rows** — ✅ **join the local flush
   queue** (recommended and adopted): idempotent by construction,
   `duplicate:` OKs make a double-flush self-healing, and `held`
   would strand signed events silently on the less-checked machine
   — against §7's nothing-fails-silently posture.
