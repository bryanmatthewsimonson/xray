# Plan: Decentralized Human Consensus Protocols on Top of `xray`

## Context

`xray` is a NOSTR-based browser extension (MV3) that already ships the **knowledge-graph primitives** that a consensus layer needs to sit on top of. What's built today:

- **Entity system** (`src/shared/entity-model.js`) — person / organization / place / thing, per-entity keypairs, alias resolution, kind-0 profile publishing, side-panel browser.
- **Claims** (`src/shared/claim-model.js`) — kind-30040 structured assertions with type (factual / causal / evaluative / predictive), crux + confidence, subject / predicate / object entity participants, attribution provenance.
- **Evidence links** (`src/shared/evidence-linker.js`) — kind-30043 supports / contradicts / contextualizes edges between claims.
- **Entity relationships** (kind-32125), **long-form articles** (kind-30023), **comments** (kind-30041), **encrypted registry sync** (kind-30078 + NIP-44 v2), **deletion** (kind-5).
- **Three signing paths** — NIP-07 (user identity), NSecBunker (remote), LocalKeyManager (entity keypairs, no prompt).
- **Deterministic hash-based IDs** everywhere — `generateEntityId` / `generateClaimId` / `generateEvidenceLinkId` — idempotent, enabling NIP-01 replaceability.
- **Publish gate** — `updated > publishedAt` pattern reused across all models.
- **Relay pool** in service worker (bypasses page CSP, survives tab navigation), batch publish with inter-event delay, point-in-time query.

The engineering journal states explicitly that today is "v4.2 parity; v5+ would add the trust/consensus machinery on top." This plan is that v5+.

The vision — grounded in *Trust Assembly* (adversarial-review truth surface), *Extelligence / Algorithmic Republic* (Community-Notes-bridging-consensus for the whole web), and *Heretic Foundry* (decentralized knowledge bases) — asks for ten-ish "systems": truth-tracking, dispute adjudication, recommendations, reputation, web-of-trust content surfacing, scientific peer review, editorial journalism review, credentialing, whistleblowing, entity-profile enrichment, curated knowledge bases, and a meta-system for spawning new systems.

**Unifying observation.** All ten are the same primitive — *a signed, addressable, replaceable **attestation** about a subject, in a **dimension**, scored by a **bridging consensus** algorithm, weighted by a **web-of-trust** reputation, gathered into **knowledge bases**, governed by an **Assembly** rule module* — applied to a different subject type. Ship one protocol stack, specialize via Assemblies.

The intended outcome:
- Make it profitable to discover truth and to refute lies (zaps, bounties, KB royalties).
- Benefit humanity by existing (open protocol, forkable assemblies, no platform lock-in).

---

## Design Principles

1. **Reuse before invent.** Every new model follows the existing `{deterministic id, replaceable event, publish gate, merged keypair}` pattern. New event builders go in `event-builder.js`; new models live in `src/shared/` next to their peers.
2. **Protocol first, UI last.** Event kinds and data shapes are the public API of this system — other clients must be able to interoperate. Define them before touching the reader UI.
3. **Local computation, global data.** Trust scores, reputations, and bridging-consensus outputs are **never published** — they are computed per-viewer from public edges. Only the raw edges / attestations travel the network. This keeps the protocol robust to gaming and lets every viewer pick their own lens.
4. **Assemblies are forkable.** If you disagree with how an Assembly scores attestations, fork it. The protocol never picks winners; rule modules compete in the market for subscribers.
5. **Generalize subjects, not attestations.** One attestation event kind, parameterized by `(subject, dimension, assembly)`. Resist the urge to add one kind per use case — it fractures the protocol and the reputation graph.
6. **Plain NOSTR.** No custom relays, no chain, no sidecar server. Lightning (NIP-57) is the only money layer. Anyone's relay, anyone's client.
7. **Anonymity is a later phase with its own threat model.** v1 ships pseudonymous (NOSTR pubkeys). Dead-drop relays, stealth zaps, and whistleblower encryption land in a dedicated phase.

---

## Protocol — Layer 1: New Event Kinds

Six new addressable kinds. All follow xray's existing patterns: deterministic hash IDs, `updated > publishedAt` gate, one event builder per kind in `event-builder.js`.

### 1. Attestation — kind `30050` (proposed)

The workhorse. A signed opinion about a subject, in a named dimension, under an Assembly's rules.

```
kind:         30050
pubkey:       attestor
created_at:   unix seconds
tags:
  ['d',         '<assembly_id>:<subject_ref>:<dimension>']   // addressable coord
  ['a',         '<30055:assembly_author:assembly_id>']        // which Assembly
  ['subject',   '<kind>', '<ref>']                            // see subject types below
  ['dimension', '<slug>']                                     // 'truth' | 'methodology' | 'abuse' | ...
  ['score',     '<number>', '<scale>']                        // e.g. '+1','-1','unit' | '0..100','pct'
  ['evidence',  '<claim_id | evidence_link_id | url>']        // 0..N, optional
  ['confidence','<0..100>']                                   // attestor's self-reported certainty
  ['refutes',   '<attestation_id>']                           // optional, chain disagreement
  ['wot-scope', '<topic>']                                    // optional, narrows which WoT edge applies
  ['client',    'xray/<version>']
content:      markdown reasoning (optional, can be empty)
```

**Subject reference forms** (`['subject', kind, ref]`):
- `claim` -> claim id (`claim_<hash>`)
- `entity` -> entity id (`entity_<hash>`) or npub
- `article` -> article URL (normalized)
- `attestation` -> `30050:<author>:<d-tag>` (meta-attestation / dispute of a vote)
- `kb` -> knowledge-base id (kind 30053)
- `assembly` -> assembly id (kind 30055)
- `credential` -> credential id (kind 30054)

**Dimension is open-ended**, but Assemblies whitelist which dimensions their rules apply to. Starter set: `truth`, `falsity`, `importance`, `novelty`, `methodology`, `replicability`, `sourcing`, `framing`, `omission`, `abuse`, `credential-valid`, `recommend`, `peer-review-accept`, `peer-review-reject`, `endorse`.

**ID**: `att_<sha256(assembly_id | subject_ref | dimension | attestor_pubkey).slice(0,16)>` — idempotent, so re-attestation is an edit, not a duplicate.

### 2. Scoped Trust Edge — kind `30051` (proposed)

The web-of-trust substrate. NIP-02 (`kind:3`) follow lists remain the coarse social graph. This kind lets a user say "I trust Alice 0.8 on virology, 0.2 on politics."

```
kind:         30051
pubkey:       from
tags:
  ['d',       '<to_pubkey>:<scope>']
  ['p',       '<to_pubkey>']
  ['scope',   '<topic-or-assembly-or-dimension>', '<kind>']
              // kind: 'assembly' | 'dimension' | 'topic' | 'global'
  ['weight',  '<-1.0..+1.0>']                           // negative = distrust
  ['expires', '<unix-seconds>']                         // optional
content:      optional note (why I trust/distrust them)
```

Distrust edges are first-class. They sink reputation in WoT propagation and are essential for routing around bad actors without centralized moderation.

### 3. Entity Enrichment Overlay — kind `30052` (proposed)

Type-specific extra dimensions on top of the existing entity record.

```
kind:         30052
pubkey:       enricher
tags:
  ['d',        '<entity_id>:<schema_id>']
  ['e-entity', '<entity_id>']
  ['schema',   '<schema_id>']            // e.g. 'scientist.v1', 'restaurant.v1'
  ['a-schema', '<30055:author:schema_id>']// the schema is itself an Assembly
  ['field',    '<key>', '<value>']        // repeat per field
  ['ref',      '<claim_id | url>']        // 0..N evidence pointers
content:      optional markdown
```

Schema examples:
- `scientist.v1` — `{orcid, affiliation, h_index, primary_fields[], publications[]}`
- `politician.v1` — `{office, district, party, voting_record_url, statements[]}`
- `restaurant.v1` — `{cuisine, price_tier, lat_lon, opening_hours}`
- `product.v1` — `{category, manufacturer, model, gtin}`
- `journalist.v1` — `{outlet, beat, bylines[], corrections_issued[]}`

Each field is attestable (someone can publish a kind-30050 attestation with `subject=entity` and `dimension=field:orcid` to contest or confirm). The viewer's client applies WoT to pick which enricher's value to display — **there is no canonical value, only a per-viewer resolved value**.

### 4. Knowledge Base — kind `30053` (proposed)

A curated bundle. Think NIP-51 list, specialized. A KB is a signed, versioned, forkable pointer to a filtered slice of the network.

```
kind:         30053
pubkey:       curator
tags:
  ['d',        '<kb_slug>']
  ['title',    '...']
  ['summary',  '...']
  ['a-assembly','<30055:...>']                 // which Assembly's scores to trust (optional)
  ['include',  'kind:30040', '#t=virology']    // filter rules, repeat
  ['e',        '<entity_id>']                  // pinned entities
  ['claim',    '<claim_id>']                   // pinned claims
  ['fork_of',  '<kb_addr>']                    // optional lineage
  ['zap',      '<lnurl>', '<split_pct>']       // royalty split if subscribers zap KB
content:      markdown description
```

Subscribing to a KB turns it into a lens. The reader queries through that lens: when viewing an article, only attestations / claims inside the KB's filters are considered.

### 5. Credential — kind `30054` (proposed)

Issuer signs a claim about a subject entity. Issuer's reputation (via WoT) is what gives the credential weight.

```
kind:         30054
pubkey:       issuer
tags:
  ['d',          '<subject_entity_id>:<credential_slug>']
  ['e-entity',   '<subject_entity_id>']
  ['credential', '<slug>']                 // 'md', 'phd', 'verified-journalist-NYT', 'kyc-jurisdiction-X'
  ['issued',     '<iso-date>']
  ['expires',    '<iso-date>']             // optional
  ['revoked',    'true']                   // optional (replaceable so can be revoked)
  ['evidence',   '<url | claim_id>']       // 0..N
content:      markdown citation/evidence
```

Revocation = publish a new version with `['revoked', 'true']`.

### 6. Assembly Definition — kind `30055` (proposed)

The rule module. Codifies how attestations in this Assembly are scored, what subjects it governs, what the dispute flow is.

```
kind:         30055
pubkey:       author
tags:
  ['d',          '<assembly_slug>']
  ['title',      '...']
  ['subjects',   '<kind>', ...]           // which subject types accepted
  ['dimensions', '<slug>', ...]           // whitelisted dimensions
  ['score-fn',   '<algo_name>', '<json_params>']
                 // e.g. 'bridging-v1' | 'weighted-mean' | 'quorum-threshold'
  ['quorum',     '<n_attestors>', '<min_wot_weight>']
  ['appeal',     '<addr_of_parent_assembly>']  // dispute appeal path
  ['credential', '<slug>']                     // required attestor credential (optional)
  ['fork_of',    '<addr>']
  ['zap',        '<lnurl>', '<split_pct>']
content:      long-form human-readable charter (markdown)
```

Anyone can publish an Assembly. Subscribers (clients / KBs) pick which ones to honor. The protocol doesn't mint authority — it makes every rule module a market participant.

### 7. Bounty — kind `30056` (proposed)

Profitability for truth-discovery. Any user attaches a Lightning bounty to a claim, an article, or a dimension of investigation.

```
kind:         30056
pubkey:       funder
tags:
  ['d',        '<bounty_slug>']
  ['subject',  '<kind>', '<ref>']         // what we want attestations on
  ['dimension','<slug>']
  ['ask',      '<human-readable brief>']
  ['amount',   '<sats>']
  ['escrow',   '<lnurl | zap-split addr>']
  ['judge',    '<pubkey>']                // who picks the winner; can be multi-sig
  ['expires',  '<unix-seconds>']
content:      full brief
```

Payouts use standard NIP-57 zaps to the winning attestation's author. The `judge` is a trust-locus — choose an Assembly author, a known journalist, or a multi-sig of three.

### Relationship to existing kinds

| Existing | Role in v5 |
|---|---|
| `kind:0` + entity keypair | Identity for entities, unchanged |
| `kind:30023` (NIP-23 article) | The base "subject" that gets attested |
| `kind:30040` (claim) | The finer-grained subject (what a viewer attests the truth of) |
| `kind:30043` (evidence link) | Still an edge between claims; attestations wrap claims, not evidence links |
| `kind:30041` (comment) | Still the discussion thread; not a vote |
| `kind:30078` (registry sync) | Unchanged |
| `kind:3` (NIP-02 follows) | Used as a zero-cost default trust prior |
| `kind:9735` (NIP-57 zap receipt) | Payment layer |

None of the existing models change. All six new kinds are additive.

---

## Protocol — Layer 2: Algorithms

All three are **client-local**. Nothing here is ever published. Each viewer materializes their own view from the same public edges.

### A. Web-of-Trust reputation (`src/shared/wot.js`)

Inputs:
- Viewer's pubkey `v`
- NIP-02 follows as weight-1 edges with default scope `global`
- Scoped trust edges (kind 30051) with explicit `(scope, weight)`
- Distrust edges (negative weights)

Algorithm (v1 = simple, replace later if needed):
1. Build a directed weighted graph from edges, indexed by scope.
2. For a target pubkey `t` under scope `s`, compute `W(v, t, s)` via **attenuated shortest-path** — each hop multiplies the weight by a decay factor `alpha = 0.6`; distrust edges clamp the path to 0 and poison it for any hop going through `t`.
3. Cache `W(v, *, s)` lazily per scope; invalidate on new follow / trust-edge events.

Output: `W(v, t, s)` in `[-1.0, +1.0]`, used to weight every attestation `t` makes in dimension `s`.

No PageRank / EigenTrust in v1 — those have known attacks (sybil cluster inflation) and require heavier compute. Attenuated shortest-path is robust, fast, and legible. Swap for a better algorithm in a later phase; the interface is `W(viewer, target, scope) -> weight`.

### B. Bridging consensus (`src/shared/bridging.js`)

The mechanism the Extelligence vision points at — X's Community Notes core idea, adapted. "A note wins not by being the most voted, but by being voted up by people who usually disagree."

Inputs, for a given subject `x` and dimension `d`:
- Attestor set `A = {a : attestation on (x,d) exists}`
- Score matrix `S[i][j] = attestor_i's score on subject_j` over a context window (all subjects they've attested on)
- Viewer `v`'s WoT weights `w_a = W(v, a, d)` for each attestor

Algorithm (matrix-factorization, same family as Community Notes):
1. Factor `S ~= mu + b_attestor + b_subject + f_attestor . f_subject` (low-rank intercepts + 1-2 factors) via regularized least squares.
2. The factor loadings `f_attestor` encode ideological/cluster position. A note's **bridging score** is its intercept `b_subject` — the part of the rating *not explained by* the cluster structure.
3. Return `bridge_score(x, d)` for the viewer, then optionally reweight by `w_a` (viewer's WoT prior).

v1 implementation: pure JS, <= 5k attestations per subject context window, compute on demand when the reader page opens a claim; memoize per `(article_url, dimension)` for 10 minutes.

Fallbacks when data is thin:
- < 10 attestors -> show raw WoT-weighted mean, flag as `preliminary`.
- < 3 attestors -> show individual attestations, no score.

### C. Claim / dispute lifecycle

A claim (kind-30040) is not "voted true" or "voted false" — it accumulates attestations in dimensions the governing Assembly accepts. Status labels are **computed**, not stored:

```
unreviewed     -> no attestations
contested      -> attestations exist in both +truth and +falsity, |bridge| < threshold
bridging-true  -> bridge_score(truth) >= +theta  AND  quorum met
bridging-false -> bridge_score(truth) <= -theta  AND  quorum met
ambiguous      -> factor loadings explain most variance (polarized, no cross-cluster agreement)
```

**Dispute** = any attestor publishes a meta-attestation with `subject=attestation:<id>` and `dimension=abuse|bad-faith|invalid`. Meta-attestations feed the same bridging algorithm, one level up. If an Assembly has an `appeal` tag, clients surface the parent Assembly's verdict alongside.

**Never delete, always replace.** Revised attestations are new versions (same `d`-tag, later `created_at`). Full audit trail.

### D. Recommendation (web-of-trust content surfacing)

Given a viewer `v` and a universe of kind-30023 articles (or claims, or entities):
1. Pull attestations on those subjects in the `recommend` dimension.
2. Bridge-score each, gated by `W(v, attestor, 'recommend')`.
3. Sort. Show top-N with explanations (`3 of your trusted sources recommended this, bridging across 4 clusters`).

This is what replaces "algorithmic feed" for the viewer. Same machinery as fact-check, different dimension slug.

---

## First Assembly: "General Web Fact-Check" (the MVP Assembly)

This ships first. Concretely:

```
kind:         30055
d:            'general-web-factcheck'
title:        'General Web Fact-Check'
subjects:     ['claim', 'article']
dimensions:   ['truth', 'falsity', 'sourcing', 'framing', 'omission']
score-fn:     ['bridging-v1', '{"decay":0.6,"min_quorum":12,"theta":0.4}']
quorum:       ['12', '0.1']
appeal:       <address of v1.1, TBD>
credential:   (none — open participation)
```

**How a user experiences it** (ties to existing reader UI):
1. On an article page, claims bar already shows the user's own claims and a button for others' claims. Add a new tab / mode **Fact-Check**.
2. Next to each claim, four tiny dimension chips with +1 / -1 buttons: *true / false / sourcing / framing*. Clicking emits a kind-30050 attestation bound to `assembly=general-web-factcheck`.
3. Next to each claim, a computed **bridging label** (Trusted / Contested / Refuted / Polarized / Preliminary) — computed locally using WoT from the viewer's NIP-02 + kind-30051 edges, filtered to the first Assembly.
4. Side panel gains a **Trust** tab: search a pubkey or entity, see their attestation history, their reputation in each dimension *from your perspective*, a button to publish a scoped trust edge (kind-30051).
5. Zap button (NIP-57) on every attestation and every claim — the economic layer.

---

## Code Map — Files Added or Modified

### New files under `src/shared/` (same location as peers)

| Path | Purpose | Analog to reuse |
|---|---|---|
| `src/shared/attestation-model.js` | CRUD for kind-30050 attestations | `claim-model.js` verbatim structure |
| `src/shared/trust-edge-model.js` | CRUD for kind-30051 scoped trust edges | `evidence-linker.js` (directional edges) |
| `src/shared/enrichment-model.js` | CRUD for kind-30052 entity enrichment | `entity-model.js` + schema validator |
| `src/shared/kb-model.js` | CRUD for kind-30053 knowledge bases | `entity-model.js` with filter-rule field |
| `src/shared/credential-model.js` | CRUD for kind-30054 credentials | `claim-model.js` (simpler, no S/P/O) |
| `src/shared/assembly-model.js` | CRUD for kind-30055 assembly definitions | `entity-model.js` with DSL field |
| `src/shared/bounty-model.js` | CRUD for kind-30056 bounties | `claim-model.js` |
| `src/shared/wot.js` | Attenuated-shortest-path WoT engine | pure compute; no storage |
| `src/shared/bridging.js` | Matrix-factorization bridging consensus | pure compute; memoized in module scope |
| `src/shared/reputation.js` | Viewer-local reputation resolver (thin wrapper) | — |
| `src/shared/enrichment-schemas/` | JSON-schema files: `scientist.v1.json`, `journalist.v1.json`, `politician.v1.json`, `restaurant.v1.json`, `product.v1.json` | static assets |
| `src/shared/assembly-presets/` | Built-in Assembly definitions, shipped as seed data | static JSON, published on first run |

### Modified files

| Path | Change |
|---|---|
| `src/shared/event-builder.js` | Add `buildAttestationEvent`, `buildTrustEdgeEvent`, `buildEnrichmentEvent`, `buildKBEvent`, `buildCredentialEvent`, `buildAssemblyEvent`, `buildBountyEvent` following existing pattern (lines 257-473 are the template). |
| `src/shared/nostr-client.js` | Add `subscribeRelays` for live attestation feed (today only `queryRelays` point-in-time; a stub already noted in Phase 7 deferred list). Add `queryRelaysMany` for the bridging-consensus context window fetch. |
| `src/shared/storage.js` | Three new top-level keys: `attestations`, `trust_edges`, `assemblies_cache`. Pattern matches `article_claims`, `evidence_links`. |
| `src/reader/index.js` | New **Fact-Check** tab in the reader (the file already hosts tab switching at ~line 900). Hook attestation emission into the existing publish orchestration (~line 962-1608). Wire computed bridging labels into the claims bar. |
| `src/reader/claim-extractor.js` | Add the dimension-chip buttons next to each claim in the claims bar. |
| `src/sidepanel/index.js` | New **Trust** tab. Entity profile shows enrichment + credentials + reputation per dimension. Pubkey view shows their attestation history + their bridging factor loadings from viewer's WoT lens. |
| `src/options/index.js` | Subscribe / unsubscribe to Assemblies and KBs. Trust edge editor. Zap config. |
| `src/background/index.js` | Relay messages for new event kinds (the service worker currently switches on message type around the relay pool; add handlers alongside `xray:capture:publish`). |
| `manifest.json` | Add `"side_panel"` entries if any new routes. No new permissions expected (we already have `storage`, `activeTab`, all host permissions, WebSockets). |

### New tests

Under `tests/`, mirror the existing Jest style:
- `tests/attestation-model.test.js` — idempotent IDs, publish gate, merge with pubkey.
- `tests/trust-edge-model.test.js` — scope parsing, distrust semantics.
- `tests/wot.test.js` — attenuated-path correctness, distrust poisoning, cycle termination.
- `tests/bridging.test.js` — matrix-factorization on synthetic ratings, cross-cluster bridge preference, quorum gating, thin-data fallbacks.
- `tests/enrichment-model.test.js` — schema validation, per-viewer field resolution.
- `tests/event-builder-v5.test.js` — builder output shapes against the protocol spec above.

### Docs

- `docs/ROADMAP.md` — append Phase 8 onward (below).
- `docs/PROTOCOL-v5.md` — the six new event kinds as a standalone spec (so other clients can implement).
- `docs/JOURNAL.md` — per-phase entries as we ship.

---

## MVP Scope — Phase 8: "First Assembly"

The smallest shippable vertical slice that proves the architecture. **What ships:**

1. **Attestations + publish path**
   - `attestation-model.js`, `buildAttestationEvent`, UI to emit on existing claims.
   - Only the `truth` / `falsity` dimensions in UI (other dimensions valid but not surfaced).
2. **WoT from NIP-02 only**
   - `wot.js` reads viewer's kind-3 follow list as weight-1 edges. Scoped trust edges (kind-30051) deferred to Phase 9.
3. **Bridging consensus v1**
   - `bridging.js` with matrix-factorization against the viewer's NIP-02-derived trust-weighted attestor set.
   - Labels shown on every claim in the reader.
4. **One Assembly seeded**
   - `general-web-factcheck` Assembly auto-published on first run from `src/shared/assembly-presets/`.
5. **Others' attestations querying**
   - Parallel to existing `openOthersClaimsModal`: `openAttestationsModal` filters `kind:30050 #a=<assembly>` for the current article's claims.
6. **Zaps on attestations**
   - NIP-57 zap button on every attestation row. The minimum economic loop.

**Out of scope for MVP (deferred):**
- Scoped trust edges (kind-30051) — users still get WoT via follows.
- Entity enrichment overlays (kind-30052).
- Knowledge bases (kind-30053).
- Credentials (kind-30054).
- Bounties (kind-30056).
- Assembly forking / subscription UI (one seeded Assembly only).
- Recommendations dimension.
- Anonymity / whistleblower primitives (deferred).

**Definition of done for MVP:**
- A viewer opens any captured article, sees claims, attests `+truth` or `-truth` on 3 claims -> their signed kind-30050 events propagate to relays.
- Another viewer (different npub) opens the same article -> sees bridging labels computed from attestations they can reach via NIP-02 follows.
- Smoke test (`docs/SMOKE_TEST.md` extended) walks this end-to-end across two profiles on two relays.

---

## Long-Horizon Roadmap

Each phase ships something that is usable on its own. Ordering is by protocol-dependency and by time-to-market for the economic loop. Durations are order-of-magnitude sizing only.

### Phase 9 — "Scoped Trust + Sourcing/Framing" (~4 weeks)

- Kind-30051 scoped trust edges (`trust-edge-model.js`, UI in side panel).
- Surface `sourcing`, `framing`, `omission` dimensions in the reader.
- Distrust-poisoning in WoT (`wot.js` hardening).
- Assembly subscription UI (start with the one preset, allow fork).

### Phase 10 — "Knowledge Bases + Web-of-Trust Feed" (~6 weeks)

- Kind-30053 KB model; KB editor in side panel; subscribe to KBs.
- Reader page gains a KB picker — "view through this KB's lens."
- New home view: a WoT-filtered feed across KBs the user subscribes to.
- `recommend` dimension surfaced; recommendations become a default lens.
- KB royalty splits via NIP-57 zap-split.

### Phase 11 — "Entity Enrichment" (~4 weeks)

- Kind-30052 + five shipped schemas (`scientist`, `journalist`, `politician`, `restaurant`, `product`).
- Side-panel entity profile renders enrichment with per-viewer WoT resolution of each field.
- Field-level attestations (attest `field:orcid` on an entity).
- Enrichment auto-suggest: scan captured article for known names, offer to enrich.

### Phase 12 — "Credentialing + Scientific Peer Review Assembly" (~6 weeks)

- Kind-30054 credentials + revocation.
- New shipped Assembly preset: `scientific-peer-review.v1` (gated by `phd` or `md` credential, dimensions `methodology / replicability / novelty / peer-review-accept`).
- New shipped Assembly preset: `editorial-journalism.v1` (dimensions `sourcing / framing / omission`, gated by `verified-journalist-*` credentials).
- Credential issuer directory.

### Phase 13 — "Bounties + Profitability Loop" (~5 weeks)

- Kind-30056 bounty model.
- Funded-bounty feed: "claims people will pay you to investigate."
- Judge-signed payout (NIP-57 zap to winning attestation author).
- Multi-sig judges (3-of-5 FROST or simpler 2-of-3 Nostr-native signature proof).
- KB subscribers' zap-split auto-flows.

### Phase 14 — "Anonymity + Whistleblower" (~6 weeks, own threat model doc)

- Separate threat model doc: `docs/ANON-THREAT-MODEL.md`.
- Ephemeral key derivation per report; stealth zaps (BOLT-12 / NIP-69 if ratified).
- Dead-drop relays (a kind-10002 relay list with `anon=true` annotation; honor-system).
- Encrypted attestation variant (kind-30057, NIP-44 v2 to an Assembly judge set).
- Abuse-report Assembly: dimensions `abuse / harassment / ToS-violation`, routed to Assembly-defined respondents.

### Phase 15 — "Meta-Assembly — system for creating systems" (~4 weeks)

- Assembly Designer in-app: a form-based builder for new Assembly definitions (picks subject kinds, dimensions, score fn, quorum, credential gate, fork lineage).
- Schema Designer for enrichment schemas.
- Public gallery of user-authored Assemblies with bridging-consensus on which Assemblies themselves are trusted (meta-attestations on kind-30055 events — the protocol is self-referential, by design).

---

## Reuse Map — What xray Already Gives Us

| New thing | Reuses existing |
|---|---|
| Deterministic attestation IDs | `generateClaimId` pattern in `claim-model.js:74` |
| Attestation publish gate | `updated > publishedAt` pattern, `reader/index.js:1383-1410` |
| Attestation event shape | Unsigned-event builder style, `event-builder.js:257-473` |
| Attestation signing | NIP-07 path already wired (`nip07-client.js`); `LocalKeyManager` available for any future anonymized identity |
| Attestation storage | `chrome.storage.local` via `Storage.get/set`, `storage.js:13-105` |
| Relay publish | `NostrClient.publishToRelays`, batch + inter-event delay pattern (`reader/index.js:1075-1139`) |
| Relay query of others' attestations | `queryRelays` pattern of `openOthersClaimsModal` |
| Entity reference on attestation subject | Existing entity ids and canonical resolution (`EntityModel.resolveAlias`) |
| Enrichment overlay -> entity | Existing entity keypair + kind-0 republish gate |
| KB filter rules -> article selection | Existing URL normalization (`utils.js`) and platform detection (`content-detector.js`) |
| Side panel hosting the Trust tab | Existing sidepanel module (Phase 4 infrastructure) |
| Encryption of anonymous/private attestations | Existing NIP-44 v2 impl from `entity-sync.js` |
| Signing flexibility | All three paths (NIP-07, NSecBunker, LocalKeyManager) work for new kinds without change |
| Deletion of withdrawn attestations | Existing kind-5 bulk delete from `entity-sync.js:1` |

The bridging-consensus engine, WoT engine, and reputation resolver are net-new but are pure-functional — no dependencies on storage or relays, so they can be unit-tested in isolation and reused from any context (reader, side panel, options).

---

## Verification Plan

End-to-end testing across the stack, concrete and testable.

### Unit (Jest, existing pattern in `tests/`)

1. `generateAttestationId` is idempotent and collision-resistant over 10k randomized inputs.
2. `buildAttestationEvent` output validates against the protocol-spec shape (snapshot test).
3. `wot.computeWeight(v, t, scope)` on a hand-built 7-node graph returns expected decay values, zeros on poisoned paths, and terminates on cycles.
4. `bridging.score` on a synthetic 50-attestor x 20-claim matrix recovers known intercepts when clusters are planted.
5. Publish gate: two edits in succession without a publish event -> one publish call; one edit -> publish -> one more edit -> two publish calls.

### Integration (the existing manual `docs/SMOKE_TEST.md` extended)

Two separate profiles on two browsers, connected to two local relays (`nostr-rs-relay` or `strfry`):

1. **Profile A** captures a Substack article (existing flow) -> extracts 3 claims (existing) -> emits `+truth` on claim 1, `-truth` on claim 2, leaves claim 3 unreviewed.
2. **Profile B** opens the same article on the same relays. Confirm:
   - Profile A's attestations appear.
   - Bridging labels render: claim 1 `preliminary-true`, claim 2 `preliminary-false`, claim 3 `unreviewed`.
3. Profile B follows Profile A (kind-3). Refresh. Confirm labels upgrade from `preliminary` -> WoT-weighted.
4. Profile B publishes an opposing attestation on claim 1. Labels on both profiles update to `contested`.
5. A third profile — following both — publishes `+truth` on claim 1. Confirm bridging favors the cross-cluster agreement.
6. Profile B zaps Profile A's attestation on claim 1. Confirm NIP-57 zap receipt flow.

### Release gate

Before tagging the Phase 8 release: the six-step smoke test above passes on Chrome and Firefox, against two public relays and one self-hosted. No console errors. Bridging compute for a 200-attestor subject stays under 100 ms on commodity hardware.

---

## Deferred / Open Questions

Intentionally left for later phases or follow-up conversations:

- **Bridging-algorithm tuning** — matrix-factorization hyperparameters (`lambda` regularization, factor count, iteration cap) need empirical tuning once real data exists. v1 ships conservative defaults; expose overrides in `options/`.
- **Sybil resistance beyond WoT** — v1 relies entirely on the viewer's trust graph to filter sybils. If that proves insufficient, Phase 11+ can layer credential-gated Assemblies (already in the protocol, just not mandatory).
- **Cross-article evidence linking** — existing code only links claims within the same article. Independently tracked in the legacy roadmap; orthogonal to v5.
- **Live subscriptions (vs point-in-time queries)** — `subscribeRelays` is noted as a Phase 7 follow-up. Phase 8 can still ship using `queryRelays` polling; live subscription is a perf upgrade in Phase 9.
- **AI-assisted moderation / claim extraction** — deliberately excluded from v5. The protocol is human-consensus-first. An AI could publish attestations (it would just have its own pubkey and reputation), but the client does not call out to an LLM.
- **Mobile / PWA** — out of scope. xray is a browser extension; protocol is open enough that any client (NOSTR mobile apps, e.g.) can implement v5 kinds.
- **On-chain settlement** — Lightning (NIP-57) is the only money layer. No L1 chains, no stablecoins, no governance tokens.
- **Legal surface of credentials** — issuer-side legal exposure when issuing credentials like `md` or `verified-journalist-NYT` is deferred to the Phase 12 threat-model doc. Protocol is neutral; the credential issuer bears the responsibility.

### Open design questions worth resurfacing when Phase 8 lands

1. Should attestation emission require a zap (even dust) to create a cost on spam? Current plan: no — dust zaps gate spam but raise the UX bar. Revisit if sybils dominate.
2. Should the Assembly preset be hardcoded or ship as a signed event by a trust anchor? Current plan: ship as a signed seed event; users can fork.
3. Bridging threshold `theta=0.4` is a guess. Expose as Assembly param, tune on real data.
4. Does the reader page need a read-only mode when the viewer has no NIP-07 identity? Current plan: yes — show unattributed bridging labels, disable attestation buttons.
