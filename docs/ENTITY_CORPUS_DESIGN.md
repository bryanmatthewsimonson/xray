# Entity Corpus & Smart Entity Management — Design

**Status: COMPLETE — E1–E6 shipped** (v0.1, 2026-07-03; Part A
(E1+E3) landed 2026-07-13, pulled forward as Phase 19.7's hard
prerequisite; the `entityCorpusPublishing` flag and enriched kind-0
shipped with Phase 19.7; **the tail — E2 LLM entity audit, E4 mention
notes, E5 wire-first corpus view, E6 docs — landed 2026-07-20**, PRs
#238–#241). §7's open questions carry their resolutions at the end.

Related: `docs/CLAIMS_REDESIGN.md` (thin claims), `docs/NIP_DRAFT.md`
(wire formats), `docs/PHASE_14_5_LLM_ASSIST_KICKOFF.md` (LLM assist),
`src/shared/identity/` (Phase 9 identity layer), JOURNAL 2026-07-03
(*Suggest provenance is grounded*).

---

## 1. Problem

Three failures, all observed in real capture sessions:

1. **Entity drift and accumulation.** LLM suggestions (and hurried
   manual tagging) disambiguate with extra words — "Mayor Elena Vargas",
   "Elena Vargas (Springfield)", "Elena Vargas". Entity ids derive from
   `sha256(type + ':' + normalized name)`, so every variant mints a new
   id. The registry silts up with near-duplicates of the same
   real-world entity, and the graph splits across them: claims about
   `entity_a41…` don't show up when you look at `entity_9c2…`.
2. **Mention provenance loss.** When the display name differs from the
   article's verbatim text, nothing recorded *where the article names
   the entity*. The manual tagger kept the selected span as `context`;
   the LLM path recorded nothing at all.
3. **Entities are dead rows.** An entity is a name + keypair in local
   storage. The network can query "what did X-Ray users say about
   pubkey P" (`{"#p":[P]}` across kinds 30040/30054/30062/…), but only
   if you already know which kinds to ask for and who published them.
   Nothing is authored *by* the entity, so following the entity's npub
   yields a bare kind-0 profile and silence. The user's requirement:
   **each entity should be a growing, subscribable corpus** — its
   quotes, claims, and mentions accumulating across every article that
   references it, discoverable without knowing who runs the archive.

### 1.1 Groundwork already shipped *(PR #108)*

The provenance-hardening PR laid the substrate this design builds on:

- **Grounded mentions**: entity proposals carry a machine-checked
  verbatim `mention`; accepting one tags the article with the grounded
  span (same `{entity_id, context}` ref the manual tagger produces).
- **Dedupe at accept**: `findEntityMatches` (token containment, same
  type) offers "use existing" instead of minting a near-duplicate; a
  single candidate is the default choice.
- **Claim text provenance**: claims carry first-class `quote` +
  `article_hash` locally and on the 30040 wire (`quote` / `x` /
  `captured_at` tags), and `parseClaimEvent` reads them back — the
  corpus view in Part B renders quotes straight from wire data.
- **Anchor truth**: every anchor stores the article's own bytes
  (TextQuoteSelector + verified TextPositionSelector).

Part A below handles the *stock* problem (the registry you already
have); the shipped dedupe handles the *flow* problem (new suggestions).

---

## 2. Goals and non-goals

**Goals**

- G1. No duplicate real-world entities survive without a deliberate,
  recorded human decision.
- G2. Every entity–article link is traceable to a verbatim, grounded
  span — renames and canonical display names never erase where the
  text actually said it.
- G3. Every entity is a subscribable NOSTR identity whose corpus grows
  as articles referencing it are published: profile, mentions, quotes,
  claims — readable in generic clients, discoverable without knowing
  the archive's owner.
- G4. Zero new capture-time burden. Everything here is review-time
  (audit proposals) or publish-time (corpus events), never a new
  required field in the capture flow.

**Non-goals**

- No automated merges — the LLM proposes, a human confirms, always
  (the Phase 14.5 discipline).
- No computed consensus / web-of-trust (explicitly descoped,
  JOURNAL 2026-07-03); cross-user correlation is *enabled* (NIP-39
  external ids) but never adjudicated by the tool.
- No new NOSTR kind unless an existing one genuinely cannot carry the
  semantics (Part B uses kind 0, kind 1, and the existing 32125/32126).

---

## 3. Part A — Smart entity management

Two passes with different costs and trust profiles: a **deterministic
pass** that is free, local, and always available, and an **LLM audit**
that reasons about hard cases under the existing `llmAssist` consent
gates.

### 3.1 Deterministic duplicate report (no LLM)

A pure sweep over the registry, surfaced as an **"Entity health"**
panel in the sidepanel:

- **Name clusters**: registry-wide `findEntityMatches` (already
  shipped for suggest-time) — normalized-name equality and token
  containment within a type. "Mayor Elena Vargas" ⊂ "Elena Vargas".
- **Shared platform accounts**: two entities linked to the same
  platform account (`32126` / `identity/account-registry.js`) are
  almost certainly one entity.
- **Co-mention overlap**: entities whose grounded mentions in the same
  articles overlap textually (one's mention span contains the
  other's).

Each cluster renders with its evidence and two actions: **Merge…**
(opens the alias flow, §3.3) and **Not duplicates** (records a
dismissal so the cluster stops resurfacing — a local
`entity_dedupe_dismissals` set keyed by the pair).

This pass has no false-authority problem: it only *sorts* the registry
by suspicion; every judgment stays human.

### 3.2 LLM entity audit (`xray:llm:entity-audit`)

For what token heuristics can't see: "Robert Smith" vs "Bob Smith",
"the Diocese" vs "Diocese of Springfield", one name used by two
different people.

- **Trigger**: a button in the Entity health panel ("Audit with
  LLM…"), plus an optional post-suggest nudge when a pass accepted
  entities that had dedupe candidates. Never scheduled, never
  automatic (cost + consent).
- **Gates**: identical to Suggest — `llmAssist` flag AND stored API
  key; runs in the background service worker via the existing
  `llm-client.js`. **Privacy note in the disclosure**: the audit sends
  entity names, types, descriptions, and *stored mention snippets*
  (already-captured article fragments) to Anthropic — no new class of
  data leaves the device, but the disclosure must say so explicitly.
- **Input**: the registry (id, name, type, description, alias links)
  plus per-entity evidence: up to N grounded mentions with article
  title/URL/date. Chunked by type for token bounds.
- **Output — one tool, `propose_entity_ops`**, discriminated on `op`:

  | op | fields | maps to |
  |---|---|---|
  | `merge` | `alias_id`, `canonical_id`, `evidence[]` (mention pairs), `note` | `EntityModel.linkAlias` |
  | `rename` | `entity_id`, `name`, `note` | `EntityModel.update({name})` — display only |
  | `retype` | `entity_id`, `entity_type`, `note` | type correction (rare; validator warns it changes the id derivation for future lookups) |
  | `split` | `entity_id`, `sides[]` (each: name + its evidence mentions), `note` | manual-assisted: creates the second entity, re-points article refs the human assigns |
  | `external_id` | `entity_id`, `scheme` (`wikidata`/`url`), `value`, `note` | stored on the entity; published as NIP-39 `i` tag (Part B) |

- **Validation firewall (mirrors Phase 14.5 discipline)**:
  - every op must cite evidence — for `merge`/`split`, at least one
    grounded mention per entity involved (validated against the
    *stored* mentions, not re-fetched text);
  - `merge` endpoints must exist, share a type, and not already be
    alias-linked (cycle prevention is `linkAlias`'s existing job);
  - ops on entities with published events render a wire-consequence
    warning (§3.3) before Accept;
  - anything failing renders rejected-with-reason, never silently
    dropped. Provenance stamped `suggested_by: 'llm:<model>'`; a
    human Accept is required for every op.
- **Review UI**: the `llm-review.js` pattern verbatim — grouped ops,
  Accept / Edit / Reject, evidence quotes shown with their grounding
  chips.

### 3.3 Merge mechanics (what Accept actually does)

The alias machinery exists (`canonical_id`, `EntityModel.linkAlias`,
`resolveCanonical`); the audit adds policy:

- **Nothing is deleted, ever.** A merge sets
  `alias.canonical_id = canonical.id`. Both records, both keypairs,
  and all mention provenance remain.
- **Keys**: events already published under the alias's key stay valid
  and discoverable; the alias's kind-0 profile is republished with
  `refers_to` → canonical npub (the mechanism `buildProfileEvent`
  already implements). New publishes route to the canonical key —
  `resolveCanonical` at every publish call site (audit item E3 checks
  each one).
- **Display names**: `rename` changes how the entity renders
  everywhere, but **never rewrites mentions** — the grounded verbatim
  spans are immutable history (G2). The UI shows "Elena Vargas
  *(mentioned as 'Mayor Vargas')*" wherever a mention's text differs
  from the display name.
- **Undo**: alias links are reversible (`canonical_id = null`); the
  Entity health panel lists recent merges with an Unlink action.

---

## 4. Part B — The entity corpus on NOSTR

### 4.1 What exists today

Per-entity **keypair**; entity-signed **kind 0** profile (published in
the article publish flow, with `refers_to` for aliases); **10002**
relay lists; user-signed **32125** entity↔article relationships;
**32126** platform accounts; **30078** encrypted entity sync. Plus,
from PR #108: 30040 claims carrying `quote`/`x` on the wire.

The gap: everything *about* the entity is signed by the archive owner
and scattered across kinds. Following the entity's npub gets you a
profile and nothing else. Discovery requires knowing the publisher.

### 4.2 Mention notes — the entity speaks for itself

On article publish, for each entity tagged on the article (with
`entityCorpusPublishing` on), X-Ray publishes **one kind-1 text note
signed by the entity's own key**:

```
content:
  Mentioned in "<article title>"

  "<the grounded verbatim mention, or the strongest claim quote>"

  <article url>

tags:
  ['r',  <article url>]
  ['a',  '30023:<publisher pubkey>:<dTag>', '', 'mention']
  ['x',  <canonical article hash>]
  ['p',  <publisher pubkey>, '', 'publisher']
  ['quote', <verbatim mention>]
  ['client', 'xray']
```

Why **kind 1** and not a new addressable kind:

- The user's requirement is subscription *without prior knowledge*:
  "a person could subscribe to it even if they don't know who created
  it." Kind-1 notes render in **every** NOSTR client — follow the
  entity's npub in Damus/Amethyst/anything and the corpus just
  appears. A custom kind renders nowhere outside X-Ray.
- Idempotence, which addressable kinds give for free, is handled
  locally: a `published_mentions` set keyed by
  `(entity_id, article_url, article_hash)` prevents duplicates; a
  *changed* article hash is deliberately a **new** note (edition
  provenance).
- Structured consumers don't lose anything: the tags carry the machine
  layer (`a`-ref to the article event, `x` hash join with the audit
  family, `quote` verbatim span), and 32125 remains the user-signed
  structured edge.

Etiquette bounds: notes publish only when the user publishes the
article (never on capture); a per-article cap (default 10 entities,
configurable) with a "which entities" checklist in the publish modal;
the entity's own 10002 decides target relays.

### 4.3 Profile enrichment (kind 0)

- `name`: the canonical display name; `about`: type + description +
  known aliases ("also mentioned as: …") + an honest provenance line
  ("Curated entity profile published by an X-Ray archive").
- **NIP-39 external identity `i` tags** from §3.2's `external_id` ops:
  `['i', 'wikidata:Q42', '']`, URLs, etc. This is the cross-user
  correlation hook — two archives each minted their own key for the
  same person, but both kind-0s claiming `wikidata:Q42` lets any
  consumer (and a future X-Ray view) join them **without** X-Ray
  adjudicating identity (non-goal). Alias entities keep publishing
  `refers_to` → canonical npub.

### 4.4 The corpus view (consuming side)

A sidepanel/portal **"Entity corpus"** tab, given any entity pubkey
(yours or a stranger's):

```
{ authors: [P] }                          → profile + its mention notes
{ '#p': [P], kinds: [30023, 30040, 30054,
                     30062, 30063, 32125] } → articles, claims (with
                                              quote/x tags), assessments,
                                              findings, verdicts, edges
```

merged into one timeline: *mentioned in… / quoted saying… / claim
about… / verdict on claim…*. Everything renders from wire data (the
30040 `quote` tag shipped for exactly this), so it works identically
for entities you didn't create. Local registry data enriches the view
when present; relay reconciliation follows the portal's existing
pattern.

### 4.5 Gates and safety

- New flag **`entityCorpusPublishing`** (default **off**) in
  `metadata/feature-flags.js`, with its own Options disclosure: what
  gets signed by entity keys, what becomes public, and that notes are
  irrevocable-in-practice once relayed (NIP-09 deletion is best-effort
  only — say so).
- Entity private keys already live in `local_keys` under the existing
  never-export/never-log rules; this design adds signing *uses*, not
  new key exposure.
- The publish flow signs mention notes through the existing
  `Signer`/LocalKeyManager path — no new signing surface.

---

## 5. Wire additions (all additive)

| addition | kind | signer | status |
|---|---|---|---|
| `quote` / `x` / `captured_at` tags | 30040 | user | *(shipped, PR #108)* |
| `TextPositionSelector` in anchor arrays | 30040/30054/30062 | user | *(shipped, PR #108)* |
| mention notes | 1 | **entity** | this design |
| NIP-39 `i` tags | 0 | **entity** | this design |
| enriched `about` + alias listing | 0 | entity | this design |

No new kinds. No changes to existing tag semantics.

## 6. Slice plan (one concern per PR)

- **E1 — Entity health panel (deterministic).** Registry-wide
  duplicate report (name clusters + shared accounts + co-mention),
  dismissals, merge/unlink actions over the existing alias machinery.
  Pure functions + sidepanel UI; no LLM, no wire.
- **E2 — LLM entity audit.** `xray:llm:entity-audit` message,
  `propose_entity_ops` schema + prompts, validation firewall, review
  UI. Behind `llmAssist`. Includes the rename-vs-id-derivation check
  (§7 Q1) as its first commit.
- **E3 — Merge correctness sweep.** `resolveCanonical` at every
  publish/tag/suggest call site (incl. `findEntityMatches` consulting
  alias chains); alias `refers_to` republish; tests for
  merged-entity claim/finding/publish flows.
- **E4 — Corpus publishing.** `entityCorpusPublishing` flag +
  disclosure, mention notes on article publish (idempotence set,
  per-article cap + checklist), kind-0 enrichment + NIP-39 tags.
- **E5 — Corpus view.** The sidepanel/portal tab (wire-first
  rendering, works on foreign entities).
- **E6 — Docs.** NIP_DRAFT mention-note section, SMOKE_TEST walks,
  CAPTURE_GUIDE note on entity naming discipline.

## 7. Open questions — resolutions (2026-07-20)

1. **Rename vs id derivation.** RESOLVED by pin:
   `EntityModel.update({name})` (and `{type}`) never rederive the id —
   the model documents it as intentional and
   `tests/llm-entity-audit.test.mjs` pins it. `rename` shipped as a
   plain update; no create-and-alias needed.
2. **Mention-note volume.** The v1 cap shipped (10/article, the
   idempotence ledger prevents re-sends per article version). The
   per-publish checklist and the digest-note escalation stay open —
   deliberately deferred until real follower/relay feedback exists.
3. **Retraction.** DEFERRED, honestly: no NIP-09 requests are sent for
   unpublished articles' mention notes in v1. The Options disclosure
   already states notes are irrevocable-in-practice; wiring
   best-effort deletion is future work if real use demands it.
4. **(New, from the build) Case keys.** With case-bound workspaces
   every capture is case-tagged; mention notes therefore EXCLUDE
   case-typed entities twice over (builder refusal + call-site skip) —
   the custody rule (TEAM_CASE_DESIGN §2.1) holds: a case key signs
   only its kind-0 and its 32125s.
4. **NIP-05 for entities.** `buildProfileEvent` already carries
   `nip05`; a verification story (who hosts the identifiers?) is out
   of scope here.
5. **Cross-archive discovery UX.** Given NIP-39 ids, should the corpus
   view offer "other archives publishing about wikidata:Q42"? Powerful.
   The "descoped trust territory" blocker is **struck** (JOURNAL
   2026-07-21): that descope was sprint-scoped, not doctrine, and this
   view adjudicates nothing — it surfaces who *else* published about a
   shared external id, which is discovery, not consensus. Still open,
   but now answerable on its own merits. The real design questions are
   the join key (NIP-39 `i` tags are the only user-independent entity
   handle we publish, and they are optional and sparsely populated) and
   the query's scope — follows-only, or open to any archive.
