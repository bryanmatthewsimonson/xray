# Entity Identity — durable, creator-bound entity keypairs (Phase 24)

Status: 24.1 (derivation) shipping; 24.2 (binding wire) and 24.3
(rotation UX) follow. This document is normative for the derivation
recipe and the binding wire format.

## 1. Problem

Before Phase 24, entity keypairs were **disposable**:

- random (`Crypto.generatePrivateKey`), plaintext in
  `chrome.storage.local` under `local_keys`;
- create-once/delete-only — deleted with the entity, wiped by
  `resetWorkspace`, unrecoverable if the keystore is lost (a re-created
  entity minted a brand-new pubkey → on-relay identity discontinuity);
- linked to their creator only by an **unauthenticated**
  `['p', <publisher>, '', 'publisher']` tag on the kind-30067 fact
  sheet — anyone could claim any entity.

The maintainer's requirements: entity identities must be **durable**
(survive keystore loss) and their authority must **trace back to the
creator's primary keypair** — the foundation for X-Ray-as-a-social-
client, where a stranger explores a creator's published corpus and
needs to know which entity records are genuinely that creator's.

## 2. The tradeoff analysis (why the layered design)

Three candidate models were analyzed across five axes (durability,
forgeability, external-client legibility, key rotation, revocation).

### 2.1 NIP-26 delegation tokens (alone)

The [NIP-26 spec](https://github.com/nostr-protocol/nips/blob/master/26.md)
defines a `delegation` tag — `["delegation", <delegator pubkey>,
<conditions>, <token>]` — where the token is a BIP-340 signature by the
delegator over `sha256("nostr:delegation:<delegatee pubkey>:<conditions>")`,
and conditions constrain `kind` and `created_at` windows.

- ✓ **Forgeability**: the strongest *self-contained* proof — the primary
  key signed an authorization of this exact key, verifiable from the
  event alone.
- ✗ **Durability**: none. Keys stay random; NIP-26 binds, it does not
  back up.
- ✗ **Revocation**: none. Only the pre-committed `created_at` expiry; a
  leaked key is authorized until its window closes.
- ✗ **Ecosystem**: officially annotated *"unrecommended: adds
  unnecessary burden for little gain"* in the
  [nips README](https://github.com/nostr-protocol/nips/blob/master/README.md).
  fiatjaf's critique ([Why I don't like NIP-26](https://fiatjaf.com/4c79fd7b.html)):
  built for the narrow custodial Minds.com case; if used broadly,
  non-implementing clients see "a constant stream of random keys";
  relays must treat the delegator as author in filters — a tax most
  (e.g. nostream) dropped.

**The decisive nuance for X-Ray:** those ecosystem objections are about
*other* clients and relays having to implement it. X-Ray is the
**primary consumer of its own binding data** — it verifies tokens
itself and never relies on relays honoring delegator-as-author. Used
that way, the token format (which is stable) keeps its cryptographic
value and sheds its adoption problem.

### 2.2 Deterministic derivation + a signed binding

- ✓ **Durability**: full. `child = KDF(primary_secret, entityId)` —
  re-creating an entity from the same primary always re-derives the
  same key. Backup of ONE secret covers every entity.
- **Forgeability**: derivation alone proves *nothing* publicly (it is a
  private, one-way operation — the same property that makes
  [NIP-06](https://github.com/nostr-protocol/nips/blob/master/06.md) HD
  keys unlinkable). A **signed manifest** (the primary attests its
  owned keys) supplies the public claim.
- ✓ **Revocation**: the manifest is a *replaceable* event — republish
  without a key and it is disowned immediately, to any consumer that
  checks.
- **Rotation**: children of the OLD secret must re-derive + republish
  under a new primary; the manifest republishes trivially and can
  dual-list old+new pubkeys during migration.

### 2.3 Publish everything under the primary key

Trivially durable and legible, but abandons entities as first-class
identities (their own kind-0 profiles, 30067 fact sheets, and the
Phase-9 identity layer) — an architectural reversal rejected.

### 2.4 What no scheme fixes: the stranger on a generic client

No mainstream client verifies NIP-26, and none reads a custom manifest.
The stranger-legibility problem is solved by **honest self-description**,
not cryptography: every entity kind-0 must say what it is and who
maintains it (§5). Prior art: the mostr bridge's per-account synthetic
keys carry unauthenticated
[NIP-48 proxy tags](https://github.com/nostr-protocol/nips/blob/master/48.md)
plus self-describing profiles — the binding is metadata, the honesty is
the profile.

### 2.5 Verdict — the layers compose

The models solve *different sub-problems*: derivation ⇒ durability;
manifest ⇒ revocable public binding; NIP-26 token ⇒ strongest
self-contained per-event proof; kind-0 honesty ⇒ stranger legibility.
Phase 24 builds all four layers. (Decision confirmed by the maintainer,
2026-07-16.)

## 3. Layer 1 — deterministic derivation (24.1, NORMATIVE)

```
PRK   = HKDF-Extract(salt = UTF8(domain), ikm = parent_priv_bytes)
okm_i = HKDF-Expand(PRK, info = UTF8(`${info}:${ctr}`), 32)   // ctr = 0,1,…
child = okm_i mod n        // reject 0, retry with ctr+1
```

- `domain` = **`xray-entity-v1`** (`ENTITY_KEY_DOMAIN`,
  entity-model.js). Changing the recipe means a NEW domain string —
  never a silent change: every derived pubkey depends on it.
- `info` = the entity id (`entity_<16hex>` — itself deterministic:
  sha256 of `type:normalized-name`). So: **same primary + same entity
  type/name ⇒ same pubkey, forever.**
- The counter suffix (`:0` in practice) makes the ~2⁻¹²⁸ out-of-range
  retry deterministic. Plain mod-n reduction bias is negligible (n is
  within 2⁻¹²⁸ of 2²⁵⁶).
- Implemented as `Crypto.scalarFromHash` + `Crypto.deriveChildKey`
  (crypto.js), reusing the NIP-44 HKDF primitives. **Pinned vector**
  (tests/key-derivation.test.mjs): parent `11…11`, domain
  `xray-entity-v1`, info `entity_0123456789abcdef` ⇒ child
  `371e815d…24bc81`, pubkey `e33d5f64…6885be`.

Lifecycle rules:

- `EntityModel.create` derives when a primary identity exists; without
  one it falls back to the legacy random path (keys stamped
  `metadata.derived: true` when derived).
- **Existing random keys stay valid** — the stored key always wins; no
  forced migration. `installDerivedKey` has importKey's semantics:
  idempotent on the same key, CONFLICT on a different one — never
  silently overwrite key material.
- `EntityModel.restoreDerivedKeys()` is the recovery path: for every
  owned entity whose key is missing from the store, re-derive and
  install. Derived-era entities get their original pubkey back;
  legacy-random entities re-derive to a NEW pubkey (the discontinuity
  is inherent to random keys — reported, never hidden).

## 4. Layer 2 — the binding wire (24.2, NORMATIVE once shipped)

Two artifacts, both verified by X-Ray on ingest:

**Kind 30069 — OwnedKeys manifest** (addressable, `d = xray-owned-keys`,
one per creator). Signed by the **primary**:

```jsonc
{
  "kind": 30069,
  "tags": [
    ["d", "xray-owned-keys"],
    ["p", "<entity pubkey>", "", "owned"],     // one per owned entity
    ["owned", "<entity pubkey>", "<entity id>", "<entity name>"],  // greppable detail row
    ["client", "xray"]
  ],
  "content": ""
}
```

Replaceable ⇒ **revocation is republish-without-the-key**. Rotation ⇒
the new primary republishes (dual-listing old+new entity pubkeys during
migration).

**NIP-26 delegation tag on entity-signed events** (kind 0, 30067):
minted by the primary at publish time, conditions limited to the kinds
entities actually sign and a bounded `created_at` window. X-Ray
verifies the token itself (BIP-340 over the NIP-26 delegation string);
no relay support assumed.

**Verification rule (portal/KS ingest):** an entity is **creator-bound
✓** when it is manifest-listed AND its events carry a valid token;
either alone renders a "partially verified" state; neither ⇒ unbound
(exactly today's posture).

## 5. Layer 3 — stranger legibility (24.2/24.3)

Every entity kind-0 gains: a standard `about` first line — *"An X-Ray
subject record maintained by <primary npub> — a research dossier, not a
person posting"* — and a `['p', <primary>, '', 'creator']` tag. A
generic client renders an honestly-labeled record instead of a mystery
key; the `publisher` p-tag on 30067 remains for compatibility.

## 6. Rotation story (24.3)

Rotation today silently: orphans every kind-30078 entity-sync blob
(NIP-44 encrypted to the OLD primary — entity-sync.js), misattributes
publish marks (documented in identity-profiles.js), and — with
derivation — makes children underivable from the new primary. 24.3
adds: an explicit warning on identity generate/switch enumerating those
consequences; a "restore derived keys" action (surface for
`restoreDerivedKeys`); and a documented (not yet built) migration
recipe — re-derive under the new primary, dual-list both pubkey sets in
the manifest, republish entity profiles with fresh tokens.

## 7. Non-goals (v1)

No NIP-46 bunker routing for entity keys (the multi-key client exists;
wiring is a follow-up). No NIP-41 key migration. No forced migration of
legacy random keys. No reliance on relays honoring delegator-as-author.
No 30078 rewrap-on-rotation (documented instead).

## 8. References

- NIP-26 spec + README annotation: github.com/nostr-protocol/nips (26.md, README.md)
- fiatjaf, "Why I don't like NIP-26 as a solution for key management" (fiatjaf.com/4c79fd7b.html)
- NIP-06 (HD derivation, unrecommended), NIP-46 (remote signing),
  NIP-41 (key migration, unmerged draft), NIP-48 (proxy tags), NIP-51
  (lists), NIP-39/NIP-05 (external identity attestations)
- mostr bridge key model (soapbox.pub/blog/mostr-fediverse-nostr-bridge)
