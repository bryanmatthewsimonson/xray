# Team Cases — collaboration design

> **Status:** design draft (2026-07-03). Post-sprint queue, behind the
> Case Dossier ([`CASE_DOSSIER_DESIGN.md`](CASE_DOSSIER_DESIGN.md), PR
> #96) — TC.3 renders into that surface. Pressure-tested by two
> independent reviews (a NOSTR-protocol review verifying every NIP
> citation against the spec texts, and an adversarial review; their
> load-bearing findings are folded in as normative text below).
>
> **Constraints (owner decisions, 2026-07-03):** public relays only —
> no self-hosted or special-purpose relays, ever, in this design; **no
> aggregation / consensus / reputation layer** — the trust model is the
> roster ("you invited them"); the single-user researcher remains a
> first-class use case (everything here is additive view configuration;
> nothing changes for a user who never joins a case). **Zero new wire
> kinds.**

X-Ray is already multi-user at the wire layer — every artifact is a
signed, content-addressed NOSTR event on shared relays — and
single-user everywhere above it. This design closes that gap for small
teams collaborating on a case: sharing captures, leveraging each
other's judgments, and running adversarial review — without key
ceremonies, private infrastructure, or consensus machinery.

---

## §1. Collaboration is three levels, not one

**Level 0 — substrate rendezvous (exists; zero coordination).** Two
people who capture the same article get the same canonical content
hash; their claims, audits, and verdicts meet at that `x`-hash and at
each other's claim coordinates automatically. Strangers' judgments
compose with no shared case, no roster, no invitation. This level MUST
stay roster-agnostic — it is what makes the public graph compound.

**Level 1 — the case (the folder; this design).** Where *scope, trust,
and disclosure* live: which events the dossier fetches and foregrounds,
who is on the panel, what an invite points at. The case is a **lens,
not a container** — artifacts never become case property; a verdict
authored inside one case is fully usable in any other view of the same
claim. Nothing in the data model carries case membership beyond
ordinary tags.

**Level 2 — coordination (deliberately thin).** Review requests,
assignments, awareness. Most of this belongs in the team's chat, not on
a permanent public ledger. The design ships the minimum (§5) and
refuses the rest.

**The ruled-out level — aggregation.** No weighting, no reputation, no
bridging, no votes, no member ranking, ever (owner decision; the idea
doc was removed from the repo the same day). Consequence, stated
honestly per P11: **roster-as-trust has a ceiling — single-digit teams
where the owner personally knows every member.** At larger scale the
pressures (delegated invites, output triage, contested removals)
silently recreate reputation machinery without its disclosures. If you
need that, this is the wrong tool. The dossier groups member output by
author at any size and never ranks members against each other.

---

## §2. The mechanism

### §2.1 The case anchor

The case entity's keypair (existing `EntityModel` `type: 'case'`)
anchors everything. The case key signs exactly three things:

- its own **kind-0** profile (name, description),
- its **32125** entity↔article relations,
- its **kind-30000 roster** (NIP-51 follow set, `d` = the case id).

**Custody rule (normative):** the case key is held by the case owner —
and it **never signs judgment kinds** (30054, 30056–30061, 30062,
30063, 30064). A subject-naming finding signed by a shared or
container key is accountability laundering — it breaks the truth
design's §3.5 symmetric-accountability principle ("no free shots") and
is the worst legal artifact a team could emit. Every member signs
judgments with their own identity; the roster never pools or launders
liability.

### §2.2 The invite: one `naddr`

Because the roster is authored *by the case pubkey*, a single NIP-19
`naddr` — kind `30000`, author = case pubkey, `d` = case id, **plus
2–3 relay hints** (mandatory: they are a fresh install's only
bootstrap) — carries everything a joiner needs:

1. Fetch the roster at that coordinate → member pubkeys, case display
   metadata.
2. The author field *is* the case rendezvous pubkey → fetch its kind-0
   and 32125s; use it as the `#p` query scope.
3. Harvest co-tagged entity pubkeys from the `#p` query results (the
   existing NIP_DRAFT §Querying pattern) → create **foreign entities**.
4. Widen fetch via members' published kind-10002 relay lists (NIP-65
   write-relays; X-Ray already builds 10002).

**No private keys travel, ever.** The authoritative-binding rule: the
invite pins the one owner-signed coordinate, and everything derives
from it — lookalike rosters under other keys are non-events. The
existing key-sharing case bundles (`case-bundle.js`) are demoted to one
narrow job (§6).

### §2.3 Foreign entities

A new entity-record state: pubkey present, **no keypair** — read-only,
cannot publish kind-0, clearly badged in the side panel. Collaborators
tag claims with foreign pubkeys exactly like local ones (the
role-marked `['p', pk, '', 'about']` idiom already on the wire). This
single change is what turns collaboration from a key ceremony into a
link.

### §2.4 Roster semantics — scope, never permission, never history

Public relays have no permissions; the roster only decides what the
portal fetches and what the dossier foregrounds.

The hazard is self-inflicted: kind-30000 is **replaceable** (per
`kind+pubkey+d`, latest `created_at` wins). Filtering the dossier by
the *current* roster would let an owner disappear a dissenting
collaborator's on-record disagreement with one list edit — a P8/P9
breach delivered by the design's own mechanism, no attacker required.
Normative fixes:

- **Ever-member union.** The default view renders events from everyone
  who appeared in *any owner-signed roster version ever seen*; removed
  members render badged **"former member (removed <date>)"**, never
  filtered. Removal gates *future* inclusion only.
- **Roster lineage.** Each roster version carries a monotonic
  `version` tag and the hash of the prior version. Append-only lineage
  on a replaceable event; the client caches every version it has seen.
  A version that does not chain from the last-seen one renders a loud
  **discontinuity warning** — which doubles as the cheapest compromise
  detector for a stolen case key.
- **Newest-per-coordinate reduction.** Roster fetches MUST route
  through the existing replaceable-event reducer
  (`nostr-events.js` newest-per-coordinate) — `NostrClient.queryRelays`
  dedups by event id only, which is wrong for replaceables served
  stale by offline relays.

### §2.5 Publish reliability on public relays

- **Confirmed-OK for join-critical events.** `publishToRelay`
  currently assumes success on an 8s timeout — fine for content,
  unacceptable for the roster and case kind-0, whose silent loss breaks
  joining. These publishes surface only relay-confirmed OKs (or verify
  by re-query).
- **Redundancy, NOSTR-native:** publish to 3–4 relays under independent
  operators; **any member lazily re-broadcasts teammates' signed events
  to their own write relays on read** (signed events re-publish freely —
  this replaces the descoped self-hosted relay as the anti-prune
  mechanism); replaceables (roster, kind-0, 32125) get periodic
  re-publish since they are the most prune-exposed; the signed-event
  JSON export remains the actual archive — relays are caches.
- **NIP-70 (protected events) is rejected**, verified against the spec:
  compliant relays drop `["-"]` events without NIP-42 AUTH (X-Ray has
  none), relays SHOULD reject *reposts* — which destroys the member
  re-broadcast pattern — and it hides nothing from readers anyway.

---

## §3. Rendering discipline (the adversarial-review fixes)

1. **Default view = roster-scoped.** Neutralizes case-tag floods
   (anyone on earth can `#p`-tag the public case pubkey).
2. **The "everything else" toggle renders collapsed**: non-roster
   material grouped by author pubkey with counts ("17 events from 3
   non-roster pubkeys"), metadata first, body only on explicit
   per-event click, never auto-fetched inline, labeled **untrusted**
   (not merely "other"). Volume griefing becomes one line; content
   injection requires an affirmative act.
3. **Provenance-propagation badge.** A roster-signed event whose
   references (a-tag / e-tag / x-hash target) resolve to non-roster
   material renders in the default view with a visible "builds on
   non-roster material" marker — the roster filters authorship, not
   lineage, and laundering is the way poison gets in.
4. **npubs beside names, everywhere, both views.** Display names never
   stand alone; lookalike members and lookalike cases die here.
5. **The roster renders as a panel-composition block** on every case
   dossier — who, since when, removals. Coordinated findings from a
   visible roster look like a campaign *because they are one*; hiding
   the roster would be the P10 violation, disclosing it is the
   compliance. This is the same symmetry obligation the moral-lens
   design carries (P5), landing here a phase early.
6. **Evidence above accusation.** On subject-naming kinds (30062,
   30064), the dossier renders the evidence chain above the finding —
   the screenshot a lawyer takes leads with evidence.
7. **No member ranking, ever** (§1 ceiling).

---

## §4. Working patterns (prescriptions, not machinery)

Public relays mean **the subject watches**. Local-first authoring is
the privacy model — X-Ray publishes only on explicit batch — and three
disciplines turn that from accident into practice:

1. **The roster stays off-relay until the case's first content
   publish.** Invitees receive it inside the invite and hold it locally
   as a filter; there is nothing to fetch-scope before content exists.
   Team composition otherwise leaks at the least-evidenced moment.
2. **Per-case identities are the prescribed default** — the identity
   profiles feature (Settings ▸ Signing) exists for exactly this.
   Disclosed cost, honestly: per-case keys forfeit the cross-case
   asserter track record (truth doc §3.5); for adversarial casework
   that is the point.
3. **Claims publish together with their evidence** — never
   claim-now-evidence-later. Every publish is discovery to the
   adversary.

Where the P8 line sits: pre-publication disagreement lives in local
drafts and team chat; **post-publication disputes (30061) and competing
judgments are never hidden or withdrawn from view** — disagreement is
data, and the side-by-side-never-averaged rule applies to teammates
exactly as to strangers.

Adversarial review between collaborators needs no new machinery — it
IS the existing wire: a competing assessment/audit/verdict on the same
coordinate or x-hash, a 30061 dispute, a `reply_refs` right-of-reply,
all rendered side by side.

---

## §5. Thin coordination

- **Review requests:** a kind-1985 label (NIP-32, the intended use) on
  one's *own* event under the existing `xray/*` namespacing — "I want
  adversarial eyes on this." The portal review queue lists (a)
  teammates' events targeting coordinates you authored (inbound
  review), (b) open review-request labels in the case.
- **Awareness:** a "new since I last looked" strip from the existing
  pull-based reconcile pass — the relay client holds no subscriptions,
  so team awareness is a fetch-scope question, already answered by the
  roster.
- **Assignments / division of labor:** out of band (team chat). The
  dossier's "unprocessed sources" group (CASE_DOSSIER §7.1) is the
  shared backlog view; that is as far as the tool goes.

---

## §6. Entity-graph repair and custody

**Repair without consensus.** An entity tag is a claim by the event's
signer; the primary repair path is the signer's own supersession (they
signed it, they correct it). Disagreement about the graph itself —
same-entity / distinct-entity — is expressed as signed claims (1985
labels on the entity coordinate composing with the Phase 9 identity
primitives), rendered side by side per P8, applied **per-reader**: each
dossier merges what its user chooses to trust. Nobody is authoritative,
which is the stated trust model. The dossier adds a lint (never a
verdict): near-duplicate entities within a case flag as "possibly
ambiguous."

**Custody and succession.** The old full-orbit key bundles remain only
for explicit shared custody. New, narrow escrow: export **the case
key alone** to a designated deputy (a slimmed `case-bundle.js` path).
If the owner vanishes, roster edits and case kind-0 updates freeze but
nothing else breaks — members keep publishing and rendezvousing on
`#p` and x-hashes. Recovery is a *new* roster event that
supersedes-tags the old coordinate, rendered with the supersession
disclosed and adopted per-reader. Full protocol-level succession
(NIP-26 delegation is effectively unadopted) is explicitly deferred.

---

## §7. Named deviations and non-goals

- **`#p`-pubkey rendezvous, not `#a`-coordinate.** The most
  NOSTR-native container would be an addressable case-definition event
  referenced by `#a` (the NIP-72 pattern). Kept as pubkey because the
  entity model, 32125s, and the published NIP_DRAFT query recipes all
  center pubkeys. Migration is additive (honor `#a` references later);
  the deviation is named so it never calcifies unexamined.
- **No team-private encryption in v1.** Verified: NIP-51 private items
  are **self-encrypted to the author's own key** — a "private roster"
  would be readable by the owner alone, not the team. v1 rosters are
  public with an explicit "roster membership is public" warning at
  publish time; per-member encrypted distribution is a deferred
  extension. NIP-29 groups require special relays (ruled out); NIP-72
  is the wrong machinery for this corpus.
- **No aggregation, no reputation, no delegation, no votes** — ruled
  out above; restated here so the section a skeptic reads first says
  it too.
- **Single-user is untouched.** Every mechanism in this doc activates
  only when a case has a roster; a solo researcher's flows gain
  nothing and lose nothing.

---

## §8. Slices (one PR each; `claude/team-case-*`; post-sprint)

- **TC.1 — case anchor + invite.** Roster builder/parser (30000 under
  the case key, `version` + prior-hash lineage tags), foreign keyless
  entity records, `naddr` encode/decode (bech32 TLV beside the existing
  npub/nsec codecs), confirmed-OK publish for roster + case kind-0.
  Exhaustive tests incl. lineage-chain verification and the
  newest-per-coordinate reducer path.
- **TC.2 — roster-scoped fetch + ever-member rendering.** Portal corpus
  scope from the roster; union semantics; former-member badges;
  npubs-beside-names; discontinuity warning.
- **TC.3 — dossier integration.** Panel-composition block, the
  collapsed untrusted toggle, provenance-propagation badges — lands in
  the Case Dossier surface (CD.2+).
- **TC.4 — working-pattern affordances.** Per-case identity nudge at
  case creation; review-request labels + queue; lazy member
  re-broadcast on read; periodic replaceable re-publish.
- **TC.5 — custody.** Single-key deputy escrow; supersedes-tagged
  roster recovery rendering; docs + SMOKE rows (keyless, two-profile
  walk).

---

## §9. Open questions

1. **`d`-value convention** for the roster (raw case entity id vs a
   `case:` prefix) — decide at TC.1 with a pin test.
2. **Review-request vocabulary** — label values under `xray/*`
   (e.g. `review-requested`, `review-done`) need the same
   exhaustive-enum treatment as every other taxonomy.
3. **Invite transport** — `naddr` string is v1 (paste anywhere); QR
   and OS share-sheet are UI sugar, later.
4. **Roster-publish timing UX** — how the "first content publish also
   publishes the roster" milestone is surfaced so it never happens by
   surprise (§4.1).
