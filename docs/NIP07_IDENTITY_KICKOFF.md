# NIP-07 vs. case-bound entity identity — DECIDED: Option C

**Status:** **DECIDED — Option C ratified by the maintainer 2026-08-11**
("Merge both PRs and go with Option C" — Art. 11; the instruction is
the ratifying act). Implemented the same day (§6). The §3 load-bearing
question was ANSWERED first (2026-08-10, four-way independent code
trace + three adversarial verification passes — evidence inline
below): **there is no truth-of-authorship bug on the wire.**
**Owner of the decision:** the maintainer (Art. 11).
**Governing skills:** `.claude/skills/architect` (one-way doors,
context placement), `.claude/skills/security-threat-modeler` (key
custody), `.claude/skills/product-manager` (whether the surface should
exist at all).

The maintainer's words, which frame the whole thing:

> "We can't use NIP-07 with case-bound identities. We need to remove
> NIP-07 support and stick with local. Or we need to have X-Ray tell
> the truth about what identity is stored in NIP-07."

---

## 1. The problem, verified

Under NIP-07 the extension **never holds the primary private key** —
nos2x/Alby expose only `getPublicKey` and `signEvent`. Several parts of
the entity layer structurally require that private key:

| Needs the primary **private** key | Where | Consequence under NIP-07 |
|---|---|---|
| Entity key derivation (Phase 24) | `entity-model.js:313-319` → `crypto.js:184` `deriveChildKey(parentPrivHex, …)`, which throws unless given 64 hex chars | Falls to the `else` branch: `LocalKeyManager.createKey()` mints a **random** key, `derivedFrom: null` |
| Re-deriving a lost entity key | `entity-model.js:381` (`restoreDerivedKeys`) | Can only restore *derived* keys. Random ones are unrecoverable, forever |
| OwnedKeys manifest (kind 30069) | `reader/index.js:7173` `Crypto.signEvent(unsigned, primary.privateKey)` | The creator-binding event is never signed, so never published |
| Entity sync (kind 30078) | `entity-sync.js:74-79`, `:192`, `:368`, `:490` — NIP-44 self-conversation key from `userPrivkey` | Sync cannot run |

**The defect is that this is silent.** `entity-model.js:313` is an
`if/else`, not a guard. Creating an entity under NIP-07 succeeds, looks
identical in the UI, and produces a key that is not recoverable, not
portable (merge-import excludes `local_keys` — see the T1 change), and
not bound to the operator's identity. Nothing warns at creation time,
and the entity record's `derivedFrom: null` is the only trace.

For a tool whose Phase-24 promise is "a lost keystore is recoverable by
re-derivation," this quietly voids that promise for every entity a
NIP-07 user creates.

---

## 2. What is NOT wrong

Stated so the next session does not re-litigate settled ground:

- **NIP-07 itself works.** Verified by live walk 2026-08-11 (nos2x,
  real publish, real relays — see the walk ledger at the top of
  `docs/SMOKE_TEST.md`). Provider detection, signing, and publishing
  are all confirmed working.
- **Entity-key signing is local regardless of method.**
  `LocalKeyManager.signAsEntity` (`local-key-manager.js:147`) signs
  with the entity's own key via `Crypto.signEvent`. It does not route
  through `Signer`, so it does not depend on `signing_method`.
- The problem is **key creation and custody**, not signing dispatch.

---

## 3. THE QUESTION — ANSWERED 2026-08-10

**Under NIP-07, does the reader's publish flow sign entity-authored
events with the entity key, or with the operator's personal nos2x key?**

**Answer: with the entity key, always — no misattribution exists, by
construction, with defense in depth.** Traced by four independent
code-trace agents (reader publish flow; portal/sidepanel/network
surfaces; the signer dispatch layer; a cross-cutting completeness
sweep over every `.signEvent(` call in the tree), synthesized, then
attacked by three adversarial verification passes. Two refuters found
nothing; one found only an enumeration gap (the portal
reconcile-rebroadcast, `src/portal/index.js:630-659`, which re-sends
already-signed journal events verbatim and structurally cannot
misattribute). The three-layer argument:

1. **Entity-authored events never touch the Signer facade.** The three
   entity-authored surfaces — legacy entity kind-0s
   (`reader/index.js:5907-5909`), corpus enriched kind-0s
   (`:6921-6923`), kind-1 mention notes (`:7013-7027`) — plus the
   portal dossier republish (`entity-dossier-view.js:126`) all stamp
   `pubkey = entity.keypair.pubkey` in the builder
   (`event-builder.js:578-580`, `mention-notes.js:93-95`) and sign via
   `LocalKeyManager.signEvent(event, entity.keyName)`
   (`local-key-manager.js:138-148`). LocalKeyManager contains **zero**
   references to `preferences.signing_method`: entity signing is
   identical in every mode. Transport is the pre-signed path
   (`gatePublish` → `xray:relay:publish`), whose background handler
   (`background/index.js:1263-1278`) requires id+pubkey+sig and never
   signs. (The kickoff's `signAsEntity` grep seed was a stale name —
   the function is `LocalKeyManager.signEvent`; same custody.)
2. **Everything that CAN reach nos2x claims the operator's own
   pubkey — fetched from nos2x itself.** The whole reader batch
   (30023/30041/30040/32125/32126/30054/30055/1985/30056-61/30062/
   30063/30064) resolves `userPubkey` once via `xray:capture:getPubkey`
   (`reader/index.js:5664-5671`), which under NIP-07 reads it from the
   source tab's `window.nostr` (`background/index.js:536-568`) — the
   same signer that later signs. Entities ride as p-tags, never as
   authors.
3. **A cross-key mistake cannot ship silently.** The PR #316 gate
   (`nip07-client.js:116-148`) preserves the caller's pubkey into the
   request, then rejects the response if the returned pubkey differs,
   if kind/created_at/content/tags were altered, or if the signature
   fails a full NIP-01 id recompute + BIP-340 verification. A
   misrouted entity-pubkey event throws loudly; no such routing exists
   today anyway.

The UI-vs-wire check also passed: no surface attributes to an entity
what the wire signs as the operator, or vice versa (the entity-page
button explicitly says "signed by YOUR identity"; the network page
re-broadcasts foreign events verbatim under their original
signatures).

So the problem is exactly the serious-not-urgent branch:
**recoverability, binding, and dead features** — enumerated next.

---

## 3.5 The full dead-path census under NIP-07 (traced, cited)

Two classes, and the split matters for the decision:

**Silent no-ops** (the dangerous class — nothing tells the user):

- Entity key creation degrades to a **random, unrecoverable** key
  (`entity-model.js:313-318`) — the §1 defect, confirmed.
- `EntityModel.restoreDerivedKeys` throws "no primary identity to
  derive from" (`entity-model.js:364-366`).
- The kind-30069 OwnedKeys manifest silently early-returns
  (`reader/index.js:7162-7163`; documented Local-only at
  `:7156-7160`) — no creator binding is ever published.
- `attachCreatorBinding` silently skips BOTH the creator p-tag and the
  NIP-26 delegation when no local primary exists
  (`reader/index.js:7137`, `:7142-7148`) — entity kind-0s and mention
  notes publish with no binding at all.

**Loud failures** (annoying but honest):

- All five extension-page `Signer` call sites throw "NIP-07 client not
  available in this context" (`signer.js:93-96`, `:126-133`): entity
  page publish (`entity-page-block.js:388`), case brief
  (`synthesis-block.js:554`), ExtractionAnalysis 30070
  (`extraction-block.js:179`), review-request 1985
  (`inspector.js:411`), kind-3 follow mirror (`network/index.js:713`).
  Root cause: only the content script configures a `nip07Client`
  (`content/index.js:83`) and **nothing in the tree installs a
  `signRequestForwarder`** — the facade's proxy hook exists but has no
  implementation.
- Tabless captures (PDF, EPUB, transcript import, portal
  reconstruction) fail with "NIP-07 signing needs a normal web page…
  Switch Settings → Signing to Local"
  (`background/index.js:1656-1663`, `:1687-1691`).

Orthogonal, not signing_method-dependent: the entity-sync family
(30078/10002/kind-5) runs off the separately pasted `xray:user` sync
key (`sidepanel/index.js:1495-1523`) — it is dead under NIP-07 only in
the sense that generating/managing that key's ecosystem assumes a
local-first posture.

So under NIP-07 today, the tool is **already** effectively
"capture-and-judge only": articles, claims, comments, judgments, and
audits publish fine from tab captures; the entire entity/corpus
publishing layer either silently degrades or loudly refuses. Option C
below is therefore less a change than an honest formalization of the
status quo.

---

## 3.6 NEW FINDING — the identity split (needs a decision of its own)

`Storage.primaryIdentity.get()` reads `local_primary_identity`
**unconditionally** (`storage.js:233`); the comment above it implies a
`signing_method === 'local'` gate that does not exist in code. So a
user who set up Local, created a primary, then switched to NIP-07 —
the natural migration path — is in a **split state**:

- Articles/claims/judgments carry the **nos2x pubkey**.
- The 30069 OwnedKeys manifest, the creator p-tag, and the NIP-26
  delegation re-arm and name the **leftover local primary's pubkey**
  (`reader/index.js:7140-7148`, `entity-dossier-view.js:115-122`).

Every event is truthfully self-signed — a split, not a forgery — but
the creator-binding layer then points at an identity that is not the
operator's wire identity. Whichever option wins, this needs either a
gate (`primaryIdentity.get()` consults signing_method for
binding/derivation purposes) or an explicit statement that the local
primary is the "entity root" identity independent of the publish
signer (which is close to what Option C formalizes).

Also noted for the record (not NIP-07, no current caller affected):
the local Signer branch trusts a caller-stamped `pubkey`
(`signer.js:122`) and `Crypto.signEvent` never derives or verifies the
pubkey (`crypto.js:376-387`), so a future caller error would emit a
wire-invalid, relay-rejected event with no local pre-publish
verification. A one-line post-sign self-verify would close it.

---

## 4. The three options, with implications (written 2026-08-10)

The K14-explanation standard: what each does, what breaks, what a user
loses, what is reversible. Do **not** implement any of them without
ratification (Art. 11).

**Option A — Remove NIP-07 support; local signing only.**
Simplifies custody to one model, makes every entity derived and
recoverable by construction, and removes a whole class of silent
degradation. Costs the one signing method where the `nsec` never enters
the extension — a real security property for adversarial casework, and
the reason NIP-07 exists here. Also a user-visible removal of a working,
just-walked feature. Weigh: how many real users use NIP-07, and does
the threat model actually favor an external signer?

*Implications (traced).* What it touches: the Signer facade's nip07
branch (`signer.js`), the NIP-07 bridge + client
(`src/page/nip07-bridge.js`, `src/content/nip07-client.js`, the
`web_accessible_resources` entry — the exact entry the 2026-08-11
field break proved load-bearing), the source-tab sign routing
(`background/index.js:1685-1708`, `:536-568`), the Options signing
panel, and `xr_signing_state`. What a user loses: any existing NIP-07
user's **wire identity** — their published corpus hangs off the nos2x
pubkey, and Local mode cannot sign as it without importing the nsec
into the extension, which is precisely what NIP-07 users refused.
There is no migration that preserves identity without violating the
property. What survives: published events (permanent, self-signed);
capture itself (never gated on signing). Reversibility: code-wise
trivial to restore (git); trust-wise poor — removing a shipped signing
method after users bound identities to it is a promise break. Blast
radius beyond code: README/USER_GUIDE/SMOKE_TEST NIP-07 sections, the
T2 verification-gate tests, the walk ledger's NIP-07 row.

**Option B — Tell the truth, keep both.**
Surface honestly what NIP-07 mode means: no derived entity keys, no
OwnedKeys binding, no entity sync, entity keys unrecoverable. Note
carefully: **disclosure alone does not fix it** — an informed user still
ends up with unrecoverable keys. If chosen, it should almost certainly
include *refusing* to silently mint a random entity key (turn
`entity-model.js:313`'s `else` into an explicit error or an explicit
confirmed choice), which is arguably mandatory regardless of which
option wins.

*Implications (traced).* Smallest diff: a disclosure block in Options
→ Signing + the entity-creation refusal (one `else` branch →
`throw`/confirm). What breaks if the refusal ships: entity creation
under NIP-07 stops working until the user makes a local primary —
which is Option C wearing a warning label, minus C's clarity. What
stays broken with disclosure alone: everything in §3.5's silent class,
now merely documented; the five loud portal failures keep their
unhelpful "not available in this context" message unless each gets a
custom explanation, which is five surfaces of copy for a posture the
project does not actually recommend. Risk: the §3.6 identity split
remains live and undecided. Reversibility: total. The honest cost:
this option converts a design incoherence into a documented design
incoherence.

**Option C — Coexist, with the entity layer requiring a local primary.**
NIP-07 signs what it is good at (the operator's own publishes:
articles, claims, judgments). The entity layer requires a local primary
identity and says so plainly, rather than degrading. Preserves the
security property where it matters, removes the silent failure where it
does not work. Open sub-questions: can a user hold *both* (NIP-07 for
personal, a local key for entities)? Does that confuse the
identity model more than it helps? Is the primary-identity slot
single-valued today?

*Implications (traced).* The trace answered the sub-questions:

- *Can a user hold both?* **They already can and do** — the slot
  (`local_primary_identity`) is single-valued, read unconditionally
  (`storage.js:233`), and survives a switch to NIP-07. §3.6 IS the
  both-at-once state, currently accidental and undisclosed. Option C
  makes it deliberate: the local primary becomes the **entity-root
  identity** (derivation, OwnedKeys, delegation), the active signing
  method governs the operator's own publishes.
- *What changes in code?* Entity creation's `else` branch
  (`entity-model.js:313`) becomes a refusal with a pointer ("entity
  identities need a local primary — create one in Settings → Signing";
  the existing profile registry supports a local primary that is NOT
  the active signer). The five loud portal failures get the same
  message instead of "client not available". `attachCreatorBinding` /
  the 30069 publish keep keying off the local primary — under C that
  is no longer a split but the design: the manifest + delegation
  publicly bind the entity fleet to the local root, and NIP-26
  delegation to the operator's nos2x key is even the protocol-native
  way to CONNECT the two identities later if wanted.
- *What breaks?* Nothing that works today. Every §3.5 silent path
  becomes either functional (user has a local primary) or a named
  refusal (user does not).
- *What must be decided within C:* whether the 30069/creator-binding
  layer naming the local root while articles carry the nos2x pubkey is
  the INTENDED public statement (recommend: yes, and say so in
  ENTITY_IDENTITY_DESIGN — "the creator is the local root identity;
  the publish signer may differ"), or whether binding should be
  suppressed until the user links the identities. This is a wire-
  visible semantic, so an `ecosystem-pm` review + `Wire format:`
  callout regardless.
- *Migration/schema:* existing random-keyed entities keep working
  untouched (they sign with their stored keys; nothing re-keys). The
  refusal only affects NEW entity creation. No storage migration.
  Reversibility: high.

**Recommendation (advisory, not a decision):** Option C, with B's
refusal folded in (it is C's core mechanism) and §3.6 resolved by
declaring the local primary the entity root. It matches what the code
already does on every working path, converts every silent degradation
into either function or a named refusal, keeps the external-signer
security property for the adversarial-casework audience, and is the
smallest diff that leaves no lie in the system. Option A should be
taken only if the maintainer decides the two-identity model itself is
the confusion — that is a product judgment, not a code one.

---

## 5. What must be true before anything ships

- ~~The §3 question answered, with evidence.~~ **Done 2026-08-10 —
  §3 above; no truth-of-authorship bug.**
- ~~The maintainer chooses (Art. 11); this document records the choice
  and its rationale in `docs/JOURNAL.md`.~~ **Done 2026-08-11 —
  Option C; see §6 and the JOURNAL entry.**
- If any option changes wire behavior (who signs what), it is an
  `ecosystem-pm` review and a `Wire format:` PR callout — published
  events are permanent.
- Any change to entity-key creation is a `schema-evolution` concern:
  **existing random-keyed entities must keep working**, and any
  migration needs its fixtures. Do not strand corpora that already
  exist.
- A live walk, not just a green suite. Entity creation and publish
  under both signing methods are exactly the kind of path the ~2500
  unit tests structurally cannot observe — the lesson of 2026-08-11.

---

## 6. Decision record — Option C, implemented

**Ratified 2026-08-11** (Art. 11). Option C with Option B's refusal
folded in, and §3.6 resolved by declaring the local primary the
**entity root** (see the amendment banner in
`docs/ENTITY_IDENTITY_DESIGN.md`, which is now the normative home of
that doctrine).

What shipped, same day:

- `EntityModel.create` (`entity-model.js`) **refuses** when no local
  primary exists, with a pointer to Settings → Signing — the random-key
  else branch is gone. Nothing is half-created on refusal. Existing
  random-keyed entities (`derived_from: null`) keep working untouched;
  no migration, no re-keying.
- The refusal is SURFACED at every creation door (the adversarial
  review found five leaks in the first draft — see the JOURNAL entry):
  the claim modal's picker and the entity tagger render it inline, the
  sidepanel import aborts-and-reports instead of success-toasting a
  zero-row import, `createCase` pre-flights the check before creating
  or activating the workspace, and the LLM review's accept-all stops
  before minting entity-less claims whose links could never be
  regained.
- The Signer facade's extension-page NIP-07 throws (`signer.js`) now
  say what works — "publish from the reader after a capture, or switch
  to Local" — instead of "client not available in this context". The
  background's tabless mapping still matches them.
- `storage.js` `primaryIdentity` documents the unconditional read as
  the entity-root design; the §3.6 split between the local root and a
  NIP-07 wire identity is INTENDED, and the creator binding names the
  root (NIP-26 delegation being the protocol-native connector).
- Options → Signing's NIP-07 panel discloses the whole posture: what
  NIP-07 covers, what needs Local, and why entities need a local
  primary alongside it.

**Wire format:** none — no builder or parser changed; who signs what
is unchanged. The 30069/creator-binding semantics ("creator = local
root, publish signer may differ") are now documented rather than
accidental.

**Still owed (§5's last clause):** the live walk — entity creation
under Local and under NIP-07 (expect the refusal without a local
primary, derived creation with one), and one entity-tagged publish
under NIP-07 — before the next release tag. The suite covers the
logic; only a walk observes the surfaces.
