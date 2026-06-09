# Claim redesign — thin, entity-centric claims (Phase 10)

**Status:** design agreed 2026-06-09. Supersedes the Phase 5 structured-claim
model for new work. Implemented in slices 10.1–10.5 (see the bottom of this
doc and `ROADMAP.md` → Phase 10).

This note records *why* the Phase 5 claim model is being reworked and the
shape we're moving to, so the wire-format and UX decisions are on the record
before the code lands.

## Why rework the Phase 5 model

The original claim (see `git log` of `src/shared/claim-model.js` and
`src/reader/claim-extractor.js`) asked the user, per claim, for: text, a
**type** (factual / causal / evaluative / predictive), a **crux** flag + a
**confidence** 0–100 slider, an **attribution** (direct_quote / paraphrase /
editorial / thesis), a **predicate** verb, a **subject** (entity-or-text),
an **object** (entity-or-text), a **claimant** entity, and a **quote date**.
Linking claims was a second modal restricted to the *same article*, and
publish fanned out to three kinds (`30040` claim, `30043` evidence, `32125`
relationship).

Problems, measured against the goal (*lots of useful data about real people,
organizations, and real-world stories*):

1. **Friction fights data volume.** That intake form is analyst-grade; in
   practice most fields stay blank or get guessed, which is worse than
   absent — noisy, inconsistent data.
2. **The S/P/O triple is the heaviest part with the weakest payoff.**
   Forcing prose into subject–predicate–object rarely matches how claims
   read, and the free-text `predicate` will never be query-consistent. The
   valuable structured signal is simply **which real entities a claim is
   about** — that's what makes "what does the network say about person P"
   possible.
3. **Ambiguous semantics → noisy data.** `confidence` on a "crux" reads as
   *how true* to a slider but means *how central* in code. `type` /
   `attribution` are real distinctions but applied inconsistently and rarely
   queried.
4. **Two overlapping systems.** Phase 5 claims (`30040`/`30043`/`32125`) and
   the Phase 9a metadata layer (annotations `30050`, fact-checks `30051`,
   ratings `30052`, topic-trust `30053`) both "anchor a structured assertion
   to content," with different kinds and different anchoring (claims → `#r`
   URL; metadata → W3C text-range selectors).
5. **Same-article-only evidence links miss the point.** The value of linking
   is *cross-source*; same-article linking is the low-value 80% of the
   friction.

## Decisions (agreed)

- **Thin, entity-centric claim** as the core primitive. Key-claim flag is
  enough; no confidence number, type, attribution, predicate, or S/P/O.
- **Claims are the core** "structured assertion about entities." The metadata
  layer's fact-checks/ratings are reframed as **responses to** a claim/URL
  (NIP-draft `responds-to`) rather than a parallel system; claims and
  annotations share the text-anchor mechanism.

## Thin claim — data model

```
Claim {
  id            // unchanged: claim_<sha256(source_url + '|' + norm(text))[:16]>
  text          // required — the assertion (verbatim or paraphrased)
  about[]       // entity ids the claim concerns  ← the queryable core
  source_url    // required
  anchor?       // W3C text-range selector (reuse Phase 9a anchor-capture)
  source?       // who asserts it: null = "the article/author", else an entity
                //   id or free text (a quoted person). Absorbs the old
                //   `claimant` + `attribution`.
  is_key?       // ⭐ single flag — replaces crux + the 0–100 confidence
  context       // surrounding text (kept — cheap, helps anchor rehydration)
  created, updated, publishedAt, publishedEventId
}
```

**Dropped:** `type`, `confidence`, `attribution`, `predicate`, the
`subject`/`object` split, `quote_date`.

**Capture UX:** *select text → "it's about [P] [O]" → save.* Optional ⭐ for a
key claim; optional "who said it" when the claim is a quoted source rather
than the article itself.

## Wire format (kind 30040)

The valuable, queryable signal becomes first-class `p` tags pointing at the
**same entity pubkeys used everywhere else** in X-Ray:

```
kind 30040
  ["r", <source_url>]                     // queryable by #r
  ["p", <entity_pubkey>, "", "about"]     // one per "about" entity ← the payoff
  ["entity", <name>, "about"]             // human-readable mirror per entity
  ["anchor", <selector-json>]?            // exact passage (shared with metadata)
  ["p", <source_pubkey>, "", "source"]?   // who said it, if a quoted entity
  ["key", "true"]?
  ["client", "xray"]
  content: <claim text>
```

"What does the network say about person P" is then a single query:
`{ kinds:[30040], "#p":[P_pubkey] }` across relays — the Phase 10 payoff,
falling out of the model instead of needing a manual S/P/O graph.

## Compatibility

- **Wire-format change** — flagged per the `event-builder.js` rule.
- **Old stored claims** stay readable; a one-time storage migration folds
  them to the thin shape: `is_crux`→`is_key`, `claimant`→`source`,
  `subject_entity_ids` ∪ `object_entity_ids` → `about[]`; the rest is
  dropped.
- **Already-published `30040` events** keep their old tags. The "others'
  claims" reader reads **both** vocabularies — old (`claim-text`, `subject`,
  `object`, `predicate`, `crux`, `confidence`) and new (`content`, `#p about`,
  `key`).

## Claims as the core; metadata as responses

- **Fact-checks / ratings** (`30051` / `30052`): reframe as responses that
  *target a claim* (`e`/`a` reference to the `30040` + NIP-draft
  `responds-to`) or a URL, instead of standing alone.
- **Annotations** (`30050`): a passage note without entities is "a claim with
  empty `about[]`." Unify the **anchor** mechanism (both use
  `metadata/anchor-capture.js`); a claim is the entity-bearing form of the
  same anchored-assertion shape.
- **Same-article evidence links** (`30043`): retire. Cross-source
  corroboration comes for free from entity `#p` aggregation + responds-to;
  the bespoke same-article evidence modal goes away.

## Implementation slices

Each is one reviewable PR (the A–E cadence).

- **10.1 — Thin model + gutted modal.** Rewrite `claim-model` fields
  (+ back-compat read + one-time migration), strip the `claim-extractor`
  modal to text + entity multi-picker + optional source + ⭐, update the
  claims bar. **No wire change yet** — pure friction win, fully testable.
- **10.2 — Lean `30040` + dual-read.** New tag set in
  `EventBuilder.buildClaimEvent`; the others'-claims reader reads both old
  and new vocabularies. (The wire-format-change PR.)
- **10.3 — Shared anchor.** Wire `metadata/anchor-capture.js` into claim
  creation → exact-passage anchoring (also replaces the brittle
  first-text-occurrence rehydrate in `claim-extractor.js`).
- **10.4 — Cross-source aggregation.** "What the network says about entity P"
  — query `30040` by entity pubkey across relays; surface in the reader /
  side panel. The payoff.
- **10.5 — Metadata reframe.** Fact-checks / ratings as responses-to-claims;
  reconcile annotations onto the shared anchor; retire `30043`. (Biggest;
  last.)
