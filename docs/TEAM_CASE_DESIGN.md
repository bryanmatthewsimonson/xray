# Team Cases — collaboration design

> **Status:** design draft (2026-07-03), **amended same day**: the v1
> model is now **follow-feed** — a case pubkey plus local, unpublished
> per-case follow lists and an incorporation queue — and the original
> published-roster machinery is demoted to §8, an extension for the one
> scenario that genuinely needs it (a standing public panel). The
> amendment exists because most of the roster machinery solved problems
> the published roster itself created; dropping it removes the
> adversarial review's blocking finding (roster memory-holing) and the
> worst OPSEC leak (team composition on relays) *by construction*.
> Where the amendment and the original text disagree, the amendment
> governs.
>
> Post-sprint queue, behind the Case Dossier
> ([`CASE_DOSSIER_DESIGN.md`](CASE_DOSSIER_DESIGN.md)) — TC.3 renders
> into that surface. Pressure-tested by two independent reviews (a
> NOSTR-protocol review verifying NIP citations against the spec texts,
> and an adversarial review); load-bearing findings are normative text
> below.
>
> **Constraints (owner decisions, 2026-07-03):** public relays only;
> **no aggregation / consensus / reputation layer** — trust is
> per-reader ("you follow them"); the single-user researcher remains a
> first-class use case (everything here is additive view configuration).
> **Zero new wire kinds.**
>
> **Amendment (2026-07-05):** the follow/incorporation ENGINE is
> generalized to case- **and** entity-scoped follows in
> [`KNOWLEDGE_SHARING_DESIGN.md`](KNOWLEDGE_SHARING_DESIGN.md), which
> now governs the engine (its §5). TC.1's foreign-entity half shipped
> as KS.3 (`EntityModel.importForeign`, adopt-on-sight); TC.2
> implements the KS.5 engine spec. The case-specific parts here — the
> case anchor (§2.1), custody (§6), the roster extension (§8), dossier
> integration (TC.3), escrow (TC.5) — remain authoritative in this
> document.
>
> **Amendment (2026-07-16):** the KS.5–KS.8 engine slices are being
> built as **Phase 25** (the Network client) — TC.2's follow engine
> lands as 25.1/25.3, TC.4's thin coordination as 25.4/25.5. See the
> KS §11 slice mapping and
> [`NETWORK_CLIENT_DESIGN.md`](NETWORK_CLIENT_DESIGN.md) for the
> surface. Case-anchored follow sets remain unpublished (the §2.2
> closure); only the new global scope may mirror to kind 3, opt-in
> (amended KS §9).

X-Ray is already multi-user at the wire layer — every artifact is a
signed, content-addressed NOSTR event on shared relays — and
single-user everywhere above it. This design closes that gap for small
teams collaborating on a case: sharing captures, leveraging each
other's judgments, and running adversarial review — without key
ceremonies, private infrastructure, published membership, or consensus
machinery.

---

## §1. Collaboration is three levels, not one

**Level 0 — substrate rendezvous (exists; zero coordination).** Two
people who capture the same article get the same canonical content
hash; their claims, audits, and verdicts meet at that `x`-hash and at
each other's claim coordinates automatically. Strangers' judgments
compose with no shared case, no follows, no invitation. This level MUST
stay follow-agnostic — it is what makes the public graph compound.

**Level 1 — the case (the folder; this design).** Where *scope, trust,
and disclosure* live: which authors' events the portal fetches and the
dossier foregrounds, and what a newcomer needs to join. The case is a
**lens, not a container** — artifacts never become case property; a
verdict authored inside one case is fully usable in any other view of
the same claim. Nothing in the data model carries case membership
beyond ordinary tags.

**Level 2 — coordination (deliberately thin).** Review requests,
assignments, awareness. Most of this belongs in the team's chat, not on
a permanent public ledger. The design ships the minimum (§5) and
refuses the rest.

**The ruled-out level — aggregation.** No weighting, no reputation, no
bridging, no votes, no member ranking, ever (owner decision). The
follow-feed model applies the chosen trust posture *consistently*:
trust is per-reader; nobody's view of "the team" is authoritative; each
dossier reflects its reader's follows and incorporations. Stated
honestly per P11: this is designed for **single-digit teams where each
member personally chooses whom to follow**. No delegation, no
governance. If you need those, this is the wrong tool.

---

## §2. The v1 mechanism: follow-feed

### §2.1 The case anchor

The case entity's keypair (existing `EntityModel` `type: 'case'`)
anchors the folder. In v1 the case key signs exactly two things:

- its own **kind-0** profile (name, description),
- its **32125** entity↔article relations.

Members' content events tag the case pubkey (the role-marked
`['p', pk, '', 'about']` idiom already on the wire) and are signed with
their own identities.

**Custody rule (normative, unchanged):** the case key **never signs
judgment kinds** (30054, 30056–30061, 30062, 30063, 30064). A
subject-naming finding signed by a shared or container key is
accountability laundering — it breaks the truth design's §3.5
symmetric-accountability principle ("no free shots") and is the worst
legal artifact a team could emit. Every member signs judgments with
their own identity.

### §2.2 Joining: share the case pubkey and some npubs

There is no invite artifact and no published membership. Joining a
case is out-of-band by design: a teammate sends you the **case pubkey**
(npub or nprofile with relay hints) and the **npubs of the other
collaborators** — a chat message. Locally you:

1. Create a foreign (keyless) case entity from the pubkey; fetch its
   kind-0 and 32125s.
2. Add the teammates to a **local, unpublished per-case follow set**.
3. Reconcile: one-shot `{authors: [followed…], kinds: [30023…30064]}`
   REQs (the existing pull model — no standing subscriptions), plus the
   `#p`-scoped case query. Widen relays via followees' published
   kind-10002 lists (NIP-65 write-relays; X-Ray already builds 10002).

Because the follow list never publishes, **team composition never
touches a relay**. The watched-workspace leak (the subject's counsel
reading the investigation's membership at its least-evidenced moment)
is closed by construction, not by discipline.

### §2.3 Foreign entities + adopt-on-sight

A new entity-record state: pubkey present, **no keypair** — read-only,
cannot publish kind-0, clearly badged in the side panel.

The follow-feed model's one real data-quality cost is **entity
fragmentation**: followees' claims tag *their* local entity pubkeys for
the same people, and the `#p` graph splits. The mitigation is
**adopt-on-sight**: when incorporating a followee's artifact (§2.4),
X-Ray offers its unknown entity pubkeys as foreign-entity imports, with
a name-collision prompt when a local entity of the same name exists.
Adopting early keeps the team's graph converged; the prompt keeps
misattribution a deliberate act rather than a default.

### §2.4 The incorporation queue (follow ≠ trust)

**Followed authors' artifacts arrive as proposals, not facts** — the
same human-in-the-loop seam the LLM Suggest flow already uses. Their
claims, links, assessments, and verdicts land in an incorporation
queue; you accept or decline per artifact; accepted items enter your
local case with provenance recorded (the `suggested_by`-style seam,
pointing at the author's pubkey and event).

This is the design's quality core: **every incorporation is a review.**
Adversarial collaboration needs no additional machinery — a teammate's
competing verdict on the same coordinate or x-hash renders side by side
with yours (never averaged, P8) whether or not you incorporate it; a
30061 dispute or `reply_refs` right-of-reply is the escalation path,
identical for teammates and strangers.

### §2.5 Publish reliability on public relays

- **Confirmed-OK for the case kind-0** (and 32125s): `publishToRelay`
  currently assumes success on an 8s timeout — fine for bulk content,
  unacceptable for the events whose silent loss breaks joining. These
  publishes surface only relay-confirmed OKs (or verify by re-query).
- **Redundancy, NOSTR-native:** publish to 3–4 relays under independent
  operators; **re-broadcast who you follow** — any member lazily
  re-publishes followed authors' signed events to their own write
  relays on read (signed events re-publish freely; this replaces the
  descoped self-hosted relay as the anti-prune mechanism);
  replaceables (kind-0, 32125) get periodic re-publish; the
  signed-event JSON export remains the actual archive — relays are
  caches.
- **NIP-70 (protected events) is rejected**, verified against the
  spec: compliant relays drop `["-"]` events without NIP-42 AUTH
  (X-Ray has none), relays SHOULD reject *reposts* — which destroys the
  re-broadcast pattern — and it hides nothing from readers anyway.

---

## §3. Rendering discipline

1. **Default view = followed authors + self.** Neutralizes case-tag
   floods (anyone on earth can `#p`-tag the public case pubkey).
2. **The "everything else" toggle renders collapsed**: unfollowed
   material grouped by author pubkey with counts ("17 events from 3
   unfollowed pubkeys"), metadata first, body only on explicit
   per-event click, never auto-fetched inline, labeled **untrusted**.
   Volume griefing becomes one line; content injection requires an
   affirmative act.
3. **Provenance-propagation badge.** A followed author's event whose
   references (a-tag / e-tag / x-hash target) resolve to unfollowed
   material renders with a visible "builds on unfollowed material"
   marker — follows filter authorship, not lineage.
4. **npubs beside names, everywhere, both views.** Display names never
   stand alone; lookalike members and lookalike cases die here.
5. **Panel composition is computed, not declared.** The dossier's
   panel block lists the authors whose events the *rendered view
   actually incorporates* — who, how many artifacts, since when. This
   is stronger disclosure than nominal membership: it discloses actual
   inclusion (P5/P10), and it works with zero published membership.
   Case exports carry the same computed block.
6. **Correlated-judgment disclosure.** Attestation convergence catches
   correlated *sources*; it cannot catch correlated *judgment* — five
   collaborators building on one teammate's claim chain. The dossier
   computes and states it: "N of this view's judgments trace to
   material from a single author." No machinery fixes groupthink;
   disclosure names it.
7. **Evidence above accusation** on subject-naming kinds (30062,
   30064) — the screenshot a lawyer takes leads with evidence.
8. **No member ranking, ever.**

---

## §4. Working patterns (prescriptions, not machinery)

Public relays mean **the subject watches what you publish** — but with
no published membership, the only things visible are the artifacts you
deliberately publish. Local-first authoring is the privacy model;
two disciplines remain:

1. **Per-case identities are the prescribed default** — the identity
   profiles feature (Settings ▸ Signing) exists for exactly this.
   Disclosed cost, honestly: per-case keys forfeit the cross-case
   asserter track record (truth doc §3.5); for adversarial casework
   that is the point.
2. **Claims publish together with their evidence** — never
   claim-now-evidence-later. Every publish is discovery to the
   adversary.

Where the P8 line sits: pre-publication disagreement lives in local
drafts and team chat; **post-publication disputes and competing
judgments are never hidden or withdrawn from view** — disagreement is
data, for teammates exactly as for strangers.

---

## §5. Thin coordination

- **Review requests:** a kind-1985 label (NIP-32, the intended use) on
  one's *own* event under the existing `xray/*` namespacing — "I want
  adversarial eyes on this." The portal review queue lists (a) followed
  authors' events targeting coordinates you authored (inbound review),
  (b) open review-request labels among followed authors.
- **Awareness:** a "new since I last looked" strip from the existing
  pull-based reconcile pass over the follow set.
- **Assignments / division of labor:** out of band (team chat). The
  dossier's "unprocessed sources" group (CASE_DOSSIER §7.1) is the
  shared backlog view; that is as far as the tool goes.

---

## §6. Entity-graph repair and custody

**Repair without consensus.** An entity tag is a claim by the event's
signer; the primary repair path is the signer's own supersession.
Disagreement about the graph itself — same-entity / distinct-entity —
is expressed as signed claims (1985 labels on the entity coordinate
composing with the Phase 9 identity primitives), rendered side by side
per P8, applied **per-reader**: each dossier merges what its user
chooses to incorporate. Nobody is authoritative, which is the stated
trust model. The dossier adds a lint (never a verdict): near-duplicate
entities within a case flag as "possibly ambiguous."

**Custody and succession.** The old full-orbit key bundles remain only
for explicit shared custody. New, narrow escrow: export **the case
key alone** to a designated deputy (a slimmed `case-bundle.js` path).
If the owner vanishes, case kind-0 and 32125 updates freeze but nothing
else breaks — members keep publishing and rendezvousing on `#p` and
x-hashes, and follow lists are theirs, not the owner's. Full
protocol-level succession (NIP-26 delegation is effectively unadopted)
is explicitly deferred.

---

## §7. Named deviations and non-goals

- **No published membership in v1.** The follow set is local and
  unpublished; panel disclosure is computed from actual inclusion
  (§3.5). The published-roster mechanism is the §8 extension.
- **`#p`-pubkey rendezvous, not `#a`-coordinate.** The most
  NOSTR-native container would be an addressable case-definition event
  referenced by `#a` (the NIP-72 pattern). Kept as pubkey because the
  entity model, 32125s, and the published NIP_DRAFT query recipes all
  center pubkeys. Migration is additive; the deviation is named so it
  never calcifies unexamined.
- **No team-private encryption in v1.** Verified: NIP-51 private items
  are **self-encrypted to the author's own key** — useless for sharing
  a list *with* a team. Irrelevant to v1 anyway (nothing membership-
  shaped publishes); noted for the §8 extension.
- **No aggregation, no reputation, no delegation, no votes.**
- **Single-user is untouched.** Every mechanism activates only when a
  case has follows; a solo researcher's flows gain nothing and lose
  nothing.

---

## §8. Extension (deferred): the published roster — a standing public panel

One scenario legitimately wants membership *on the record*: a standing
panel whose composition is itself an accountability feature (a named
review board publishing under a shared banner, where "who is on this
panel" must be independently verifiable, not self-reported by each
member's dossier). For that case only, the original design applies, in
condensed normative form:

- A **kind-30000 roster** (NIP-51 follow set, `d` = case id) authored
  **by the case pubkey**, making a single NIP-19 `naddr`
  (kind + case pubkey + `d` + 2–3 relay hints — mandatory, they are a
  fresh install's only bootstrap) a complete one-link invite.
- **Replaceability is the hazard**: filtering by the *current* roster
  would let the owner memory-hole a dissenting member's on-record
  disagreement with one list edit (the adversarial review's blocking
  finding). Normative fixes: **ever-member union rendering** (anyone in
  any owner-signed version ever seen; removed members badged "former
  member," never filtered), **version + prior-hash lineage tags** on
  the replaceable event with a loud **discontinuity warning** (doubling
  as a stolen-key detector), and **newest-per-coordinate reduction** on
  fetch (route through the `nostr-events.js` reducer —
  `queryRelays` dedups by event id only, wrong for replaceables).
- Roster publication is a milestone: not before the case's first
  content publish. Confirmed-OK publish applies to the roster.
- The roster renders as the panel-composition block (declared form),
  *alongside* the computed-inclusion block — declared vs actual is
  itself a disclosure.
- Everything else in this document (custody rule, rendering
  discipline, incorporation queue) applies unchanged. The roster is,
  precisely, a *published follow set* — the two models compose.

---

## §9. Slices (one PR each; `claude/team-case-*`; post-sprint)

- **TC.1 — case anchor + foreign entities.** Foreign keyless entity
  records (read-only, badged); adopt-on-sight import with
  name-collision prompt; case-pubkey share affordance (copy
  npub/nprofile); confirmed-OK publish for case kind-0/32125.
- **TC.2 — per-case follows + incorporation queue.** Local unpublished
  follow sets per case; reconcile scope `{authors, kinds}` + NIP-65
  widening; the incorporation queue on the Suggest-proposals seam with
  provenance recording.
- **TC.3 — dossier integration.** Computed panel-composition block,
  the collapsed untrusted toggle, provenance-propagation badges, the
  correlated-judgment disclosure line — lands in the Case Dossier
  surface (CD.2+).
- **TC.4 — working-pattern affordances.** Per-case identity nudge at
  case creation; review-request labels + queue; re-broadcast-who-you-
  follow; periodic replaceable re-publish.
- **TC.5 — custody.** Single-key deputy escrow; docs + SMOKE rows
  (keyless, two-profile walk).
- **(deferred)** §8 published-roster extension; per-member encrypted
  roster distribution; QR/share-sheet invite sugar.

---

## §10. Open questions

1. **Per-case follow-set storage shape** — a `case_follows` registry
   keyed by case entity id (workspace content: cleared by fresh-
   workspace reset) — confirm at TC.2 with a pin test.
2. **Incorporation granularity** — per-artifact accept/decline is v1;
   whether accepted claims auto-pull their anchored article captures
   (probably yes, with size disclosure) — decide at TC.2.
3. **Review-request vocabulary** — label values under `xray/*`
   (e.g. `review-requested`, `review-done`) need the exhaustive-enum
   treatment.
4. **Unfollow semantics** — prior incorporated artifacts stay (they
   passed your review; removing them would be its own memory-hole);
   confirm the rule with a test at TC.2.
