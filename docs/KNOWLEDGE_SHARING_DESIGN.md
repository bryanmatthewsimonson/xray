# Knowledge sharing over NOSTR — design

> **Status:** design + first slices (2026-07-05). This document is the
> **generalization** of [`TEAM_CASE_DESIGN.md`](TEAM_CASE_DESIGN.md)'s
> follow machinery: it owns the follow/incorporation ENGINE (case- and
> entity-scoped) and the cross-user rendezvous substrate; TEAM_CASE
> keeps its case-specific parts (case anchor §2.1, custody §6, roster
> extension §8, dossier integration TC.3, escrow TC.5). Where the two
> disagree about the engine, this document governs.
>
> Slices KS.1–KS.4 (§11) ship with this document; KS.5+ are queued.
> Everything here is additive and flag-gated where it publishes; the
> single-user researcher loses nothing.
>
> **Constraints (owner decisions, 2026-07-03, restated normatively):**
> public relays only; **no aggregation / consensus / reputation layer**
> — trust is per-reader; **zero new wire kinds**; deterministic derived
> keys are identifiers, never signers; the case key never signs
> judgment kinds; private keys never leave the machine except the
> explicit case-bundle path.
>
> **Amendment (2026-07-16, Phase 25):** KS.5–KS.8 are being built as
> Phase 25, the Network client
> ([`NETWORK_CLIENT_DESIGN.md`](NETWORK_CLIENT_DESIGN.md) governs the
> *surface*; this document stays normative for the *engine*). Three
> changes to the 2026-07-05 text; the amendment governs where they
> disagree: (1) §5's anchor set gains a third scope —
> `{scope:'global'}`, person-level follows for the Network feed;
> (2) §9's "no published follow lists" relaxes to an **opt-in,
> default-off kind-3 NIP-02 mirror of the global scope only** — case-
> and entity-anchored follow sets still never publish; (3) §10 gains
> the kind-3 mirror and the `xray/review` kind-1985 label vocabulary
> (both additive; still zero new wire kinds).

X-Ray's goal here: make it easy to **share** captured knowledge, let
strangers **reference the same entities** so the shared corpus
composes, **subscribe** to other people's feeds about an entity or
case while maintaining one's own version, and **merge** others'
artifacts in — each merge a deliberate, reviewed act — so that belief
updating and adversarial review work across users, not just within one
workspace.

---

## §1. The five capabilities, and what already exists

*X-Ray is already multi-user at the wire layer and single-user
everywhere above it* (TEAM_CASE's observation, extended here beyond
teams to strangers). Concretely:

1. **Share captured content** — publish paths exist for 15+ kinds
   (articles 30023, claims 30040, comments 30041, assessments 30054,
   link edges 30055, audits 30056–30061, forensic 30062, verdicts
   30063/30064, profiles 0, relations 32125, relay lists 10002). Every
   artifact is a signed, addressable event on shared relays.
2. **Reference the same entities** — broken today. Entity *ids* are
   deterministic (`sha256(type:name)`) but each install mints a
   **random keypair** per entity (`entity-model.js`), so two users'
   "same person" carry different wire pubkeys and `#p` queries never
   aggregate. The one deterministic cross-user person key — the
   platform-account pubkey (`identity/platform-account.js`) — was
   derived but **never published** (kind 32126 had no publisher).
3. **Subscribe + merge per-reader** — the portal fetches only
   `authors = your own pubkeys`; the sole cross-user affordances were
   pasting an npub (view a whole author) and the case bundle (share
   private keys).
4. **Accept others' articles/entities** — foreign events render
   transiently in three places (reader "others' claims", side-panel
   network claims, adjudicate modal) but were **never verified** and
   never persisted.
5. **Belief updating / adversarial review** — supersession chains and
   30061 disputes exist on-wire but had no cross-user discovery path
   beyond per-claim lookups.

The gaps this design closes: verification on ingest (KS.1), the
person-level rendezvous (KS.2), per-reader entity equivalence
(KS.3), and the entity-scoped read feed (KS.4) — then the engine
(KS.5+).

---

## §2. The rendezvous ladder

How two strangers' artifacts meet, strongest rung first. Level 0
rendezvous requires **zero coordination** — no shared case, no
follows, no invitation (TEAM_CASE §1's substrate level).

| Rung | Join key | Strength | Status |
|---|---|---|---|
| **R1** | `x` canonical article hash (`#x`) | content-addressed; survives URL drift, paywalls, stealth edits (a hash mismatch *is* a detected edit) | live (`event-builder.js`, `audit/article-hash.js`) |
| **R2** | claim `d` = `claim_<sha(rawURL\|normText)>` | convergent-but-coordinate-split: same `d` under different pubkeys, joined via `#r` + client-side `d` match; the full coordinate is the identity, by design (NIP_DRAFT "Claim") | live |
| **R3** | normalized URL `r` / `i` (NIP-73) | page-level; all metadata kinds anchor here | live |
| **R4** | deterministic platform-account pubkey — `getPublicKey(sha256("xray:platform-account:v1:" + platform + ":" + stableId))` | person-level, identical for every user, derivable by anyone from a handle; the only deterministic cross-user person key | derivation live; **published as kind 32126 by KS.2** |
| **R5** | per-reader entity equivalence — my entity ≡ {my minted pubkey, adopted foreign pubkeys, linked account pubkeys} | person/org/case-level | KS.3 + KS.4 |

**R5 is reader-local data, not wire data.** There is no published
"same-entity" assertion in v1 and no global entity registry, ever.
Your merge is your judgment (P8): a stranger with a different merge
sees a different — equally valid — view. The wire-level future option
(kind-1985 same-entity labels on entity coordinates, composing with
the Phase 9 identity primitives, per TEAM_CASE §6) is named here and
deliberately deferred: it is a *claim about the graph*, adjudicable
like any other claim, not a registry.

---

## §3. Sharing — the publish side

Publishing is already the default posture; two additions make the
person rung queryable:

1. **Kind 32126 platform accounts begin publishing** (flag
   `platformAccountPublishing`, default **off**). `d` =
   `<platform>:<stableId>`; the deterministic account pubkey rides a
   role-marked `p` tag. Anyone can then resolve
   `{kinds:[32126], "#d":["twitter:foo"]}` — or `#p` by the derived
   pubkey — into "who has captured @foo, and who do *they* say @foo
   is."
2. **The `linked-entity` gap closes.** 32126 carried only the local
   `entity_…` id string, which no stranger can resolve. An additive
   role-marked `['p', <entityPubkey>, '', 'linked-entity']` tag now
   carries the linking user's entity pubkey, so account → entity
   resolution is one hop, no kind-0 required.

**Wire-format changes are exhaustively those two** (§10). Both are on
a kind that previously had no publisher, so no existing consumer can
break.

**OPSEC.** Publishing 32126 discloses your account→entity link graph —
which platform accounts you captured and whom you consider them to be.
That disclosure *is* the rendezvous; it is opt-in (flag default-off,
options-page hint), scoped to the current publish run's touched
accounts and published entities (so it tracks material you're
publishing anyway), and per-case identities (TEAM_CASE §4) remain the
prescribed mitigation for adversarial casework.

---

## §4. Referencing the same entities

**Foreign keyless entities.** A new entity-record state: `foreign_pubkey`
present, no local keypair — read-only, badged in the side panel,
excluded from kind-0 signing and entity-sync push. This completes the
case-bundle "reference-only" stub (which previously imported with no
pubkey at all). Its id derives from the **pubkey**
(`entity_<sha256('foreign:'+pubkey)>`), deliberately not from
(type, name), so a foreign "Donald Trump" can never silently collide
with yours — the collision *prompt* owns the merge decision.

**Adopt-on-sight.** When a foreign pubkey surfaces (a claim's
`p …about` tag in the feed, a followee's artifact), X-Ray offers it as
a foreign-entity import: fetch its kind-0, propose name/type, and
prompt on name collision with three outcomes — **adopt-as-alias** (the
foreign entity becomes an alias of yours via the existing
`canonical_id` mechanism), **adopt-separate**, or cancel.
Misattribution stays a deliberate act, never a default (TEAM_CASE
§2.3).

**The consequence that matters:** the alias mechanism is the
equivalence primitive, so `resolveAlias`, kind-0 `refers_to`, and the
side-panel canonical UI all work unchanged — and once adopted, your
claims and judgments p-tag the *foreign* pubkey through the existing
builders. Cross-user `#p` aggregation starts working **without anyone
sharing private keys**. The case bundle stops being the only
composition mechanism; it remains the tool for shared *custody*.

**Platform accounts are the deterministic hub** of an equivalence
class: two strangers who each link `twitter:foo` to their own local
person have, through R4, a shared pubkey their artifacts already meet
at — before either adopts the other's entity.

---

## §5. The subscription model — one follow/incorporation engine

One engine serves both TEAM_CASE's teams and this document's
entity-watchers. Specified here; **built as KS.5** (TC.2 implements
against this spec). This branch ships only the engine's read layer
(§ KS.4): equivalence fan-out + feed assembly — no follow persistence,
no queue. Named explicitly so nobody mistakes the read feed for the
engine.

- **Follow set:** local-primary, keyed by *anchor*
  `{scope: 'case'|'entity'|'global', entityId?}` — one storage shape
  (`follow_sets` registry; workspace content, cleared by
  fresh-workspace reset). TC.2's per-case follows are the
  `scope:'case'` instance of the same registry. *(Amended 2026-07-16:)*
  the third scope, `'global'` (registry key `'global'`, no
  `entityId`), carries person-level follows for the Phase-25 Network
  feed — follow a researcher across everything, not per anchor; it is
  the only scope the §9 opt-in kind-3 mirror may project. Entries are
  `{pubkey, label?, addedAt, relayHints[]}`, hints harvested from the
  followee's published kind-10002 (NIP-65 widening —
  `entity-sync.js` `pullRelayList` exists).
- **Fetch model: pull, not live.** `queryRelays` is a point-in-time
  snapshot by design; the feed refreshes on demand plus a "new since
  you last looked" strip (TEAM_CASE §5). Live subscriptions are a
  named v1 non-goal (§9); a `subscribeRelays` sibling can slot in
  later without changing the engine.
- **Query classes:** `{authors:[follows…], kinds:[…]}` (followed
  authors' output), the anchor's equivalence-pubkey `#p` fan-out
  (everything about this entity), and the `#a` judgment hop
  (judgments on discovered claims).
- **Because case- and entity-anchored follow sets never publish,
  team/interest composition never touches a relay** — the
  watched-workspace leak stays closed by construction for casework
  (TEAM_CASE §2.2). *(Amended 2026-07-16:)* the global scope may
  publish through the §9 opt-in mirror only.

---

## §6. Incorporation-as-review (merging on your own terms)

**Followed and foreign artifacts arrive as proposals, not facts** —
the same human-in-the-loop seam the LLM Suggest flow uses. The
incorporation queue (KS.5) lands their claims, links, assessments, and
verdicts for per-artifact accept/decline; accepted items enter your
local models with provenance recorded (the `suggested_by`-style seam,
pointing at the author's pubkey and event). Every incorporation is a
review; **follow ≠ trust**.

This already has a shipped precedent: **assessing a foreign claim
(exists today) is the lightest form of incorporation** — your 30054
snapshots the foreign coordinate and your stance, without importing
the claim itself. Adoption of a foreign entity (KS.3) is the second
form, with `adopted_from` provenance. The queue generalizes the
pattern.

Rules imported from TEAM_CASE:

- **Unfollowing keeps incorporated artifacts** — they passed your
  review; removing them would be its own memory-hole (TEAM_CASE
  §10.4).
- **Foreign articles render transiently in v1** (the read-only
  reconstruct path). Persistence into the archive cache (the dormant
  `source:'relay'` path) waits for the queue, where acceptance is
  explicit — persisting on *view* would make relay content
  self-installing, which is exactly the volume-griefing vector
  TEAM_CASE §3.2 closes.

---

## §7. Belief updating and adversarial review — why NOSTR carries this

The properties being leveraged, each mapped to a shipped mechanism:

1. **Signed, portable artifacts.** Every judgment binds to its
   author's key; signatures are now **verified on ingest** (KS.1 — a
   real hole until this branch: no read path called
   `Crypto.verifySignature`). Track records bind to keys (P10), and
   the 32126 bridge extends per-actor records across platforms.
2. **Content addressing composes with signing.** A verdict cites the
   exact reviewed bytes (`x`); an edited source visibly no longer
   binds. Nothing in the incumbent landscape survives edits, deletion,
   and paywalls this way.
3. **Addressable replaceables give self-correction with lineage.**
   Supersession is expressed via forward `e`-refs, never relay
   replacement, so the correction *chain* is public — updating your
   beliefs is a first-class, visible act, not an overwrite.
4. **Tag-indexed rendezvous.** The ladder (§2) is all standard NIP-01
   `#`-filters — any client, five lines of websocket, no X-Ray
   required.
5. **Disagreement is data (P8).** Competing verdicts on one
   proposition render side-by-side and are **never averaged**
   (`verdictVariance`; the adjudicate modal's "others' rulings" view).
   There is no convergence step, by design — the verdict-state
   *distribution* is the calibrated view.
6. **Adversarial review is structural.** 30061 disputes target any
   judgment kind including verdicts; `e …reply` gives right-of-reply;
   the auditor's methodology is itself signed and disputable.
7. **No server.** The format outlives the app; relays are caches; the
   signed-event JSON export is the archive.

The belief-updating loop, end to end: you publish → a stranger's
competing artifact meets yours at a rung → it renders beside yours →
you assess, dispute, or supersede → your revision chains publicly →
their reader sees the same spread from their own trust posture.

---

## §8. Trust and rendering discipline

Trust is **per-reader**; nobody's view is authoritative. TEAM_CASE
§3's rendering rules are imported by reference and generalized to
entity scope: default view = self + follows; unfollowed material
collapsed with counts, metadata-first, body on explicit click, labeled
untrusted; npubs beside names everywhere; provenance-propagation
badges ("builds on unfollowed material"); no member ranking, ever.

`trust-graph.js` / `ranker.js` (complete, tested, deliberately
unwired) are the future *filtering* layer for a reader's own feed —
first-order follows and topic trust — never ranking for others. Wiring
them is KS.8, after the engine exists.

---

## §9. Refused non-goals

- No consensus, aggregation, or reputation layer; no votes, no
  weighting, no bridging (owner decision — the deferred
  aggregation/Sybil layer remains designed-not-pursued).
- No global entity registry or naming authority; no published
  same-entity assertions in v1.
- No auto-merge of foreign entities — the prompt is always shown.
- No new wire kinds.
- No live relay subscriptions in v1 (pull + refresh).
- Follow lists are local-primary. *(Amended 2026-07-16 — was "no
  published follow lists":)* the **global** follow scope has an
  opt-in, default-off **kind-3 NIP-02 mirror** (Phase 25.6, flag
  `followListPublishing`; read-merge-union-confirm against the user's
  existing remote kind 3, never blind-replace; local labels ride as
  petnames only via a per-publish checkbox). Case- and entity-anchored
  follow sets never publish — composition disclosure stays computed
  from actual inclusion (TEAM_CASE §3.5; the §8 roster extension
  remains the one exception, unchanged).
- No NIP-70 protected events; no team-private encryption (verified
  unsuitable, TEAM_CASE §7).

---

## §10. Wire-format changes (exhaustive)

1. **Kind 32126 begins publishing** — an existing kind gains its first
   publisher; `docs/NIP_DRAFT.md` gains its section (tags, `d`
   scheme, the pubkey-derivation recipe, and the invariant that the
   account pubkey is an identifier, never a signer).
2. **Additive role-marked `['p', <entityPubkey>, '', 'linked-entity']`
   on 32126** — closes the account→entity resolution gap.

*(Amended 2026-07-16 — Phase 25 adds two more, both additive, still
zero new kinds:)*

3. **Kind 3 begins publishing — the opt-in follow-list mirror**
   (Phase 25.6). Standard NIP-02: `['p', pubkey, relayHint, petname?]`
   tags, empty content, projecting the **global** follow scope only;
   flag `followListPublishing` default-off; merge-with-remote before
   every publish. An existing standard kind gains a publisher; no
   format invention.
4. **The `xray/review` kind-1985 label vocabulary** (Phase 25.4):
   `l` ∈ {`review-requested`, `review-done`} under `L xray/review`,
   subject `a`/`e`/`r` tags, never a `p` tag. Additive vocabulary on a
   kind X-Ray already publishes.

Plus one normative consumer rule (documented, not a format change):
**clients MUST verify event signatures on ingest.** Relay-supplied
events are otherwise attacker-controlled input.

---

## §11. Slice ladder

| Slice | Content | Where |
|---|---|---|
| **KS.1** | Signature verification on relay ingest (always-on, no flag) | **this branch** |
| **KS.2** | 32126 publish, flag-gated + `linked-entity` pubkey tag | **this branch** |
| **KS.3** | Foreign keyless entities + adopt-on-sight (⊂ TC.1) | **this branch** |
| **KS.4** | Per-entity network feed (read-only, side panel) | **this branch** |
| KS.5 | Follow sets + incorporation queue, case+entity+global scoped (generalizes TC.2) | **Phase 25.1 + 25.3** |
| KS.6 | Review-request labels, awareness strip, re-broadcast-who-you-follow (≈ TC.4) | **Phase 25.4** |
| KS.7 | NIP-65 relay widening + confirmed-OK publish for identity kinds (⊂ TC.1/TC.4) | **Phase 25.5** |
| KS.8 | trust-graph wiring as reader-side feed filter | **Phase 25.7** (last, droppable) |

*(Amended 2026-07-16:)* Phase 25 additionally builds the Network
surface (25.2a/25.2b, `NETWORK_CLIENT_DESIGN.md`) and the kind-3
opt-in mirror (25.6, amended §9/§10).

TC.3 (dossier integration) and TC.5 (custody/escrow) stay
case-specific in TEAM_CASE_DESIGN.md.

---

## §12. Decisions recorded (were open questions)

1. **KS.1 verifies everything.** Every event returned by
   `queryRelays` is BIP-340-verified, with a verified-id LRU and
   chunked yields so portal re-syncs don't re-pay. If first-sync cost
   on very large archives proves painful, the documented fallback is
   skip-verify on authors-scoped self-queries only — not implemented.
2. **Verdict feed coverage is two-hop.** 30063 carries no `p` tag
   (attaches to the proposition, never the person — Phase 15 red
   line), so the entity feed reaches verdicts via `#a` over hop-1
   claim coordinates (capped). Verdicts on claims outside hop 1 stay
   feed-invisible but remain fully visible per-claim in the adjudicate
   modal. Accepted for v1. *(2026-07-16: this limit is `#p`-axis only —
   on the Phase-25 `authors` axis, followees' 30063s are author-signed
   and arrive first-class in the follows feed.)*
3. **No foreign-event persistence until KS.5**, where acceptance is
   explicit (§6).
4. **32126 publish scope** = the current publish run's touched
   accounts + published entities (§3 OPSEC).
