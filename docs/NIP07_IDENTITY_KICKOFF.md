# NIP-07 vs. case-bound entity identity — open decision

**Status:** OPEN. No code change proposed yet; one load-bearing
question is still UNVERIFIED (§3). Raised by the maintainer 2026-08-11,
traced the same day, handed off unfinished.
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

## 3. THE UNVERIFIED QUESTION — do this first

**Under NIP-07, does the reader's publish flow sign entity-authored
events with the entity key, or with the operator's personal nos2x key?**

This was never traced and it changes the decision:

- If entity events are correctly signed by the entity key → the problem
  is recoverability and binding (serious, not urgent).
- If entity events are going out signed by the operator's **personal**
  key while the UI attributes them to the entity → that is a
  **truth-of-authorship bug on the wire**, published, permanent, and it
  outranks everything else in this document.

**How to trace it:** start at the reader publish batch
(`src/reader/index.js`, the `publish()` path — the entity-profile /
entity-page / mention-note branches), and follow which signer each
entity-authored event reaches: `Signer.signEvent` (dispatches on
`signing_method`, so nos2x under NIP-07) versus
`LocalKeyManager.signAsEntity` (always the entity key). Grep seeds:
`Signer.signEvent` has 7 call sites; `signAsEntity` is the entity path.
Check `entity-profile.js`, `entity-page-publish.js`, and the kind-0 /
kind-1 mention-note publishers. Confirm against a real published event
if possible — the portal inspector shows the raw signed event and its
`pubkey`.

---

## 4. The three options to write up

The next session should produce a full implications write-up — the
K14-explanation standard: what each function does, what breaks, what a
user loses, what is reversible — so the maintainer decides informed,
not blind. Do **not** implement any of them without ratification.

**Option A — Remove NIP-07 support; local signing only.**
Simplifies custody to one model, makes every entity derived and
recoverable by construction, and removes a whole class of silent
degradation. Costs the one signing method where the `nsec` never enters
the extension — a real security property for adversarial casework, and
the reason NIP-07 exists here. Also a user-visible removal of a working,
just-walked feature. Weigh: how many real users use NIP-07, and does
the threat model actually favor an external signer?

**Option B — Tell the truth, keep both.**
Surface honestly what NIP-07 mode means: no derived entity keys, no
OwnedKeys binding, no entity sync, entity keys unrecoverable. Note
carefully: **disclosure alone does not fix it** — an informed user still
ends up with unrecoverable keys. If chosen, it should almost certainly
include *refusing* to silently mint a random entity key (turn
`entity-model.js:313`'s `else` into an explicit error or an explicit
confirmed choice), which is arguably mandatory regardless of which
option wins.

**Option C — Coexist, with the entity layer requiring a local primary.**
NIP-07 signs what it is good at (the operator's own publishes:
articles, claims, judgments). The entity layer requires a local primary
identity and says so plainly, rather than degrading. Preserves the
security property where it matters, removes the silent failure where it
does not work. Open sub-questions: can a user hold *both* (NIP-07 for
personal, a local key for entities)? Does that confuse the
identity model more than it helps? Is the primary-identity slot
single-valued today?

---

## 5. What must be true before anything ships

- The §3 question answered, with evidence.
- The maintainer chooses (Art. 11); this document records the choice
  and its rationale in `docs/JOURNAL.md`.
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
