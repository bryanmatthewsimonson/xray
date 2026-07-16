NIP-XX
======

Web Content Annotations, Fact-Checks, and Topic Trust
-----------------------------------------------------

`draft` `optional`

This NIP defines eighteen event kinds and two tag extensions that together let users publish structured, anchored metadata about web content — atomized claims, annotations, fact-checks, ratings, personal assessments, claim relationships, topic-scoped trust assertions, helpfulness votes, epistemic-audit records (per-module surface-scan results, aggregate article audits, a prediction ledger with resolutions, dossier rollup snapshots, and audit disputes — content-addressed to the exact text scored), behavioral findings (named maneuvers a subject performs around the truth, evidence-anchored, with no verdict on intent), adjudicated verdicts (descriptive truth-states on atomized propositions, on a declared standard of proof, with two-sided evidence and mandatory caveats — attached to the proposition, never a person), integrity findings (words-vs-deeds match states with documented gap causes, intent never adjudicated), and cross-platform account records (a captured platform account materialized under a deterministic derived pubkey, carrying the author's claimed account→entity link) — and lets readers query, rank, and surface that metadata in context.

It composes with rather than replaces:

- [NIP-22](22.md) (comments) — annotations are also valid NIP-22 comments and appear in NIP-22 readers.
- [NIP-23](23.md) (long-form) — extends `kind:30023` with an optional `responds-to` tag.
- [NIP-32](32.md) (labels) — labels remain the canonical taxonomy primitive; annotations carry richer structure.
- [NIP-73](73.md) (external content IDs) — all URL anchoring uses NIP-73's `i`/`k` pattern.
- [NIP-84](84.md) (highlights) — highlights remain the right primitive for "draw attention without commentary."
- [NIP-85](85.md) (trusted assertions) — bridging-based ranking results are publishable as NIP-85 trusted assertions.

## Concepts

### Anchoring

Every event defined in this NIP that targets web content MUST anchor to a normalized URL. Clients SHOULD apply standard URL canonicalization before constructing tags: lowercase scheme and host, strip default ports, remove tracking query parameters (`utm_*`, `fbclid`, `gclid`, `ref`, `mc_*`, etc.), remove URL fragments unless the fragment is meaningful (e.g., `#:~:text=` text fragments), and remove trailing slashes from path segments other than root.

URL anchoring uses the NIP-73 + NIP-22 pattern jointly:

```jsonc
"tags": [
  ["r", "https://example.com/article"],
  ["i", "https://example.com/article"],
  ["k", "web"],
  ["I", "https://example.com/article"],
  ["K", "web"]
]
```

The `r` tag is for fast relay-side filtering. The `i`/`k` and `I`/`K` pairs are for NIP-22 / NIP-73 conformance — clients implementing those NIPs index against them, so this NIP's events appear in their UIs without bespoke handling.

### Selectors

Annotations and fact-checks may anchor to a specific span within a target. Selectors live inside the event `content` (which is a JSON object for these kinds) and follow the [W3C Web Annotation Data Model](https://www.w3.org/TR/annotation-model/) selector vocabulary.

The recommended selector types, in order of robustness preference:

1. `TextQuoteSelector` — `{ exact, prefix, suffix }`. The author captures ~32 characters of context on each side of the selection. The consumer searches `prefix + exact + suffix` first, falling back to `exact` alone with a uniqueness check. Robust to DOM and CSS changes.
2. `TextPositionSelector` — `{ start, end }`: UTF-16 code-unit offsets into the rendered text content of the capture-time article body (the same text stream the sibling `TextQuoteSelector` was cut from). Emitted alongside a `TextQuoteSelector` by machine-grounded anchors (X-Ray's LLM-suggest path). Consumers MUST treat it as verification-only: resolve it only when the text at `[start, end)` reproduces the sibling `TextQuoteSelector`'s `exact` (allowing for that selector's >500-char `head … tail` truncation); on mismatch, skip it rather than guess — the offsets are meaningless against edited text.
3. `RangeSelector` — `{ startContainer, startOffset, endContainer, endOffset }` with XPath. Faster on long documents but brittle to DOM restructuring.
4. `CssSelector` — useful when the page has stable element ids/classes (e.g., paragraph ids on Substack).
5. `FragmentSelector` — media fragments (`xywh=...` for images, `t=Ns` for time offsets in audio/video) and, for captures extracted from PDF documents, RFC 3778 page fragments (`{ "conformsTo": "http://tools.ietf.org/rfc/rfc3778", "value": "page=N" }`) alongside the text selectors — page-level provenance for consumers that can cite it; skipped by resolvers that can't.

Authors SHOULD include multiple selectors. Consumers SHOULD try them in order and treat the first match with confidence ≥ 0.7 as the resolution. Annotations whose selectors do not resolve on the current page are NOT discarded; they are surfaced as page-level annotations with a "could not be located" indicator.

## Kind 30040 — Claim

Addressable. An atomized assertion extracted from web content: the claim text plus the real-world entities it concerns. This is the unit the assessment (30054) and relationship (30055) kinds target.

```jsonc
{
  "kind": 30040,
  "tags": [
    ["d", "claim_<sha256(source_url + '|' + normalized_text).slice(0,16)>"],
    ["r", "<source-url>"],
    ["title", "<source title>"],
    ["p", "<entity-pubkey>", "", "about"],     // one per entity the claim concerns
    ["entity", "<entity name>", "about"],      // human-readable mirror per entity
    ["p", "<source-pubkey>", "", "source"],    // who asserts it, when a quoted entity
    ["source", "<who said it>"],               // entity name or free text
    ["anchor", "<selector-json>"],             // W3C selector array for the exact span
    ["key", "true"],                           // present only on key claims
    ["quote", "<verbatim article span>"],      // optional — the exact text the claim is drawn from
    ["x", "<canonical article hash>"],         // optional — binds the quote to the exact article version
    ["captured_at", "<unix seconds>"],         // optional — when the human captured the claim
    ["fact", "<field>", "<value>", "<subject entity pubkey>"],  // optional — structured fact layer (one per event)
    ["valid_from", "<band ISO>", "<precision>"],   // optional — fact validity start
    ["valid_to", "<band ISO>", "<precision>"],     // optional — fact validity end
    ["observed_at", "<band ISO>", "<precision>"],  // optional — when the source observed it
    ["client", "<client>"]
  ],
  "content": "<the claim text>"
}
```

**Text provenance tags** (all optional, additive): `quote` is the
verbatim span of the source article the claim is drawn from —
untruncated, unlike the `anchor` selector's capped `exact`; `x` is the
canonical article hash (the same value the epistemic-audit kinds join
on via `#x`), binding the quote to the exact text version it was
located in; `captured_at` records capture time, which `created_at`
(publish time) does not. Consumers rendering a claim SHOULD prefer
`quote` for display and use `anchor` for on-page location.

**Fact layer tags** (all optional, additive — Phase 19): a claim MAY
carry one structured fact — `["fact", <field>, <value>, <subject
entity pubkey>]`, where `field` is a typed biographical field name
(e.g. `birth_date`, `headquarters`, or a `custom:<token>` field) and
the 4th slot identifies the fact's subject, which MUST also appear
among the event's `about` p-tags (a fact about X is a claim about X).
The three date tags scope the fact's temporal validity. Their value
slot is an ISO-8601 date **truncated to its honest precision band** —
`1962` (year), `1962-03` (month), `1962-03-15` (day), or a full
timestamp (exact) — with the precision named explicitly in slot 2
(`year|month|day|exact`); emitting a full timestamp for a
year-precision statement would fabricate a month and day the source
never asserted. Readers that do not understand `fact` see a normal
claim; readers that do can assemble entity fact tables whose every
row cites a verbatim `quote` and an `x`-hashed article version.

The `d` tag is deterministic over the verbatim (trimmed) source URL and the whitespace-collapsed, casefolded claim text, so re-publishing an edited claim's metadata replaces rather than duplicates, and two captures of the same quote from the same page-as-captured by the *same* author coincide. (URL variants — tracking parameters, trailing slashes — derive distinct `d`s; the reference implementation does not normalize the URL input here.) Note that two **different** authors who capture the same quote derive the same `d` under different pubkeys — those are distinct addressable events, and consumers MUST treat the full `30040:<pubkey>:<d>` coordinate as the claim's identity.

The `p` tags carry the queryable signal: `{ "kinds": [30040], "#p": ["<entity-pubkey>"] }` returns everything the network claims about an entity. The 4th-position `about`/`source` markers distinguish the entity's role; `#p` filters match either, so role-sensitive consumers filter client-side. Publishers that maintain local entity aliases SHOULD tag the **canonical** identity's pubkey (the alias's kind-0 `refers_to` tag is the published forwarding pointer), so one real-world entity doesn't fragment across merge history.

*Caveat for the kind registry:* `30040` has known third-party uses in the wild (NKBIP-01 curated publications). The reference implementation predates this NIP; a kind renumber is a pre-submission question, not a format one.

## Kind 30050 — Annotation

Addressable. An anchored note with optional structured body and motivation.

```jsonc
{
  "kind": 30050,
  "tags": [
    ["d", "<deterministic-id>"],
    ["r", "<url>"],
    ["i", "<url>"], ["k", "web"],
    ["I", "<url>"], ["K", "web"],
    ["motivation", "rebutting"],
    ["t", "<topic>"],
    ["a", "30023:<reviewer-pubkey>:<slug>", "<relay-hint>"],
    ["lang", "en"]
  ],
  "content": "<JSON-LD body, see below>"
}
```

The `d` tag MUST be deterministic so re-publishing an edit replaces (NIP-01 addressable-event semantics):

```
d = "ann:" + sha256(normalized_url + "|" + selector_hash + "|" + motivation).slice(0, 16)
```

The `motivation` tag MAY appear multiple times. Allowed values include but are not limited to: `commenting`, `highlighting`, `fact-checking`, `rebutting`, `supporting`, `contextualizing`, `correcting`, `responding-to`, `linking`, `tagging`. Clients SHOULD render unknown motivations as generic annotations.

The `content` is a JSON-LD `Annotation` object using the `http://www.w3.org/ns/anno.jsonld` context. Minimum:

```jsonc
{
  "@context": "http://www.w3.org/ns/anno.jsonld",
  "type": "Annotation",
  "motivation": "rebutting",
  "body": {
    "type": "TextualBody",
    "format": "text/markdown",
    "language": "en",
    "value": "<markdown body>"
  },
  "target": {
    "source": "<url>",
    "selector": [
      { "type": "TextQuoteSelector", "exact": "...", "prefix": "...", "suffix": "..." }
    ]
  }
}
```

If `motivation` is `correcting`, the event SHOULD include a `correction-type` tag with one of: `headline`, `quote`, `stat`, `name`, `date`, `other`.

If the annotation is itself a published article (e.g., a kind 30023 reaction post) being referenced as the "body" of the annotation, an `a` tag SHOULD reference the article event.

## Kind 30051 — FactCheck

Addressable. A `ClaimReview`-shaped event: a specific claim is reviewed against a specific scale.

```jsonc
{
  "kind": 30051,
  "tags": [
    ["d", "factcheck:<sha256(url + '|' + claimReviewed)>.slice(0,16)"],
    ["r", "<url>"],
    ["i", "<url>"], ["k", "web"],
    ["claim-reviewed", "<short text of the claim>"],
    ["rating-value", "1"],
    ["rating-best", "5"],
    ["rating-worst", "1"],
    ["rating-name", "False"],
    ["rating-scale", "<scale-namespace>"],
    ["t", "<topic>"],
    ["e", "<related-claim-event-id>", "<relay-hint>"],
    ["evidence", "<url-or-naddr>"]
  ],
  "content": "<JSON-LD ClaimReview body>"
}
```

The `content` is a [Schema.org `ClaimReview`](https://schema.org/ClaimReview) object:

```jsonc
{
  "@context": "https://schema.org",
  "type": "ClaimReview",
  "datePublished": "<ISO-8601>",
  "claimReviewed": "<text>",
  "itemReviewed": {
    "type": "Claim",
    "appearance": {
      "type": "Article",
      "url": "<url>",
      "headline": "<headline>",
      "datePublished": "<ISO-8601>"
    }
  },
  "reviewRating": {
    "type": "Rating",
    "ratingValue": 1,
    "bestRating": 5,
    "worstRating": 1,
    "alternateName": "False",
    "ratingExplanation": "<explanation>"
  }
}
```

This NIP defines a reference rating scale at the namespace `nostr.dev/scale/v1` (provisional pending NIP merge) with values 1–5: False, Mostly False, Mixed, Mostly True, True. Reviewers MAY use other scales (PolitiFact's six-point, Snopes' fourteen-point, etc.) by setting `rating-scale` to a unique namespace identifier and providing a human-readable label in `rating-name`. Consumers rendering an unknown scale SHOULD display the `rating-name` text and a normalized 0–1 bar derived from `(rating-value - rating-worst) / (rating-best - rating-worst)`.

The `evidence` tag MAY appear multiple times. Each value SHOULD be a URL or a `nostr:nevent1...` / `nostr:naddr1...`. Evidence pointing to a NOSTR event SHOULD also use an `e` or `a` tag for relay indexing.

## Kind 30052 — Rating

Addressable. An overall ordinal review of a URL, lighter than a fact-check.

```jsonc
{
  "kind": 30052,
  "tags": [
    ["d", "rating:<sha256(url + '|' + author_pubkey)>.slice(0,16)"],
    ["r", "<url>"],
    ["i", "<url>"], ["k", "web"],
    ["rating-value", "4"],
    ["rating-best", "5"],
    ["rating-name", "<short label>"],
    ["t", "<topic>"]
  ],
  "content": "<plain markdown rationale>"
}
```

A given (author, URL) pair has at most one rating, since the `d` tag includes the author's pubkey and is therefore unique per (author, URL).

## Kind 9803 — HelpfulnessVote

Regular event. The atomic input to bridging-based ranking algorithms (à la Community Notes / Birdwatch). One vote per (voter, target) pair; clients deduplicate by `created_at`, tie-breaking on event id.

```jsonc
{
  "kind": 9803,
  "tags": [
    ["a", "<kind>:<author-pubkey>:<d-tag>", "<relay-hint>"],
    ["e", "<event-id>", "<relay-hint>"],
    ["p", "<author-pubkey>"],
    ["helpful", "1"]
  ],
  "content": "<optional rationale>"
}
```

The `helpful` tag value MUST be one of:

- `1` — helpful
- `-1` — not helpful
- `0` — needs more context (a "soft no" that signals the annotation is unclear or insufficient rather than wrong)

Helpfulness votes are typically applied to kind 30050 / 30051 / 30052 events, but MAY be applied to any kind whose author intends to receive them.

A user revoking a vote SHOULD do so via [NIP-09](09.md) deletion request rather than by publishing a new vote with a different value. Clients SHOULD honor NIP-09 deletions of helpfulness votes.

## Kind 30053 — TopicTrust

Addressable. Topic-scoped trust assertion: "I trust pubkey X on topic Y."

```jsonc
{
  "kind": 30053,
  "tags": [
    ["d", "trust:<topic>:<target-pubkey-hex-prefix>"],
    ["p", "<target-pubkey>"],
    ["t", "<topic>"],
    ["weight", "85"],
    ["expires", "<unix-time>"]
  ],
  "content": "<optional public rationale>"
}
```

The `weight` tag is an integer 0–100. The `expires` tag is optional; assertions without expiration SHOULD be reaffirmed by clients on a periodic basis (e.g., yearly) to demonstrate the assertion is still held.

The `d` tag's `<topic>` SHOULD be the same value used in `t` tags throughout the rest of NOSTR (lowercase, hyphenated). The `<target-pubkey-hex-prefix>` is the first 16 hex chars of the target pubkey.

A user MAY publish a TopicTrust assertion encrypted to themselves (using [NIP-44](44.md) v2 with their own pubkey as recipient) when they want to record an assertion privately. Encrypted assertions appear in NOSTR with `content` as the NIP-44 ciphertext. Encrypted assertions do NOT contribute to other users' bridging scores.

Clients computing trust graphs SHOULD treat the absence of an assertion as neutral, NOT as distrust. A separate distrust primitive is out of scope for this NIP and should be modeled via [NIP-51](51.md) mute lists or [NIP-56](56.md) reports.

## Kind 30054 — Assessment

Addressable. A **personal judgment** on one claim (kind 30040): a graded stance and/or typed issue labels, with an optional rationale. One assessment per (author, claim) — the `d` tag hashes the claim's coordinate, so editing republishes the same `d` and replaces.

This kind is deliberately distinct from kind 30051 (FactCheck): a FactCheck is a *formal review against a published truth scale* (Schema.org ClaimReview — interoperable with professional fact-checking tooling), keyed by claim text. An Assessment is a *personal agree/disagree judgment with issue labels*, keyed by claim coordinate (stable under claim-text edits). They are different aggregation signals; consumers MUST NOT merge them.

```jsonc
{
  "kind": 30054,
  "tags": [
    ["d", "assess:<sha256(claim_coordinate).slice(0,16)>"],
    ["a", "30040:<claim-author-pubkey>:<claim-d>", "<relay-hint>"],
    ["e", "<claim-event-id>", "<relay-hint>"],
    ["p", "<claim-author-pubkey>"],
    ["r", "<claim-r-verbatim>"],
    ["i", "<normalized-url>"], ["k", "web"],
    ["stance", "-1"],
    ["L", "xray/assessment"],
    ["l", "misleading", "xray/assessment"],
    ["l", "fallacy/strawman", "xray/assessment"],
    ["label-anchor", "misleading", "<selector-json>"],
    ["label-note", "misleading", "<short note>"],
    ["p", "<about-entity-pubkey>", "", "about"],
    ["suggested-by", "user"],
    ["client", "<client>"]
  ],
  "content": "<markdown rationale>"
}
```

- The `a` tag is the claim reference; the `d` MUST be recomputable as `assess:<sha256(a-tag value).slice(0,16)>`. The `e` tag is an optional pointer to a specific seen event. At least one of `stance` / `l` MUST be present.
- **`stance`** is a discrete integer in −2..+2: −2 strongly disagree · −1 disagree · 0 unsure · +1 agree · +2 strongly agree. Omitted for label-only assessments.
- **Labels** use the `L`/`l` structure with the `xray/assessment` namespace. Per NIP-32, `L`/`l` on a non-1985 kind are formally *self*-labels; this kind **defines** them as applying to the `a`-referenced claim (a documented deviation). Clients wanting plain-NIP-32 aggregation SHOULD also publish a kind-1985 mirror whose labeled subjects are the claim's `a` coordinate and its verbatim `r` URL — and which carries **no `p` tag** (a `p` on a 1985 would label the claim's *author* with the issue labels, a reputational mislabel). The standardized vocabulary: factual (`false`, `unsupported`, `misleading`, `cherry-picked`, `missing-context`, `outdated`), consistency (`contradicts-prior-statement`, `flip-flop`, `moved-goalposts`), fallacy (`fallacy/strawman`, `fallacy/ad-hominem`, `fallacy/false-dilemma`, `fallacy/whataboutism`, `fallacy/circular`, `fallacy/slippery-slope`, `fallacy/appeal-to-authority`, `fallacy/appeal-to-consequences`), rhetorical (`loaded-language`, `unfalsifiable`, `ambiguous`, `euphemism`), provenance (`undisclosed-interest`). Other values are valid custom labels if they match the token grammar (lowercase `a-z0-9-`, at most one `/` namespace segment, ≤ 64 chars). At most one `l` per label value.
- **`label-anchor`** / **`label-note`** enrich a label with the offending span (a W3C selector array, JSON, as in the 30040 `anchor` tag — a deviation from the content-borne selectors of 30050/30051, since `content` here is human-readable markdown) and a short note, keyed by the label value in slot 1.
- **`r` carries the claim's `r` value verbatim** (the per-URL join key with the 30040); `i`/`k` carry the normalized NIP-73 form. Consumers joining assessments to claims by URL SHOULD use `#r`; consumers needing the canonical URL use `i`.
- **About-entity `p` tags are mirrored from the claim** (4th-position marker `about`) so a single `{"kinds":[30040,30054],"#p":[entity]}` filter returns an entity's claims and their assessments together. The unmarked `p` is the claim's author (the kind-9803 idiom).
- **`suggested-by`** is `user` or `llm:<model>` — provenance for machine-suggested judgments.
- `stance`, `label-anchor`, `label-note`, and `suggested-by` are multi-letter tags and therefore not relay-indexed; all standard queries for this kind filter on `#a` / `#r` / `#p` / `#l` + `kinds`, with stance filtering client-side.

## Kind 30055 — ClaimRelationship

Addressable. A typed link between two claims — the cross-source contradiction tracker.

```jsonc
{
  "kind": 30055,
  "tags": [
    ["d", "rel:<sha256(coordA + '|' + coordB + '|' + relationship).slice(0,16)>"],
    ["a", "30040:<author-A>:<d-A>", "<relay-hint>", "source"],
    ["a", "30040:<author-B>:<d-B>", "<relay-hint>", "target"],
    ["e", "<event-id-A>", "", "source"],
    ["e", "<event-id-B>", "", "target"],
    ["relationship", "contradicts"],
    ["r", "<claim-A-r-verbatim>"],
    ["r", "<claim-B-r-verbatim>"],
    ["i", "<normalized-url-A>"], ["i", "<normalized-url-B>"], ["k", "web"],
    ["suggested-by", "user"],
    ["client", "<client>"]
  ],
  "content": "<note>"
}
```

- `relationship` MUST be one of: `contradicts`, `supports`, `updates`, `duplicates`, or the directional **`revision/*` story-change values** `narrative-patch`, `recharacterizes`, `walks-back` (Phase 14 / kind 30062). The latter three express how the *same subject's* account changed over time — `source` = the earlier statement, `target` = the later — and MAY be characterized by a kind-30062 finding (which references this link by `a` coordinate). They are never symmetric.
- **`contradicts` and `duplicates` are symmetric**: the two coordinates MUST be sorted lexically — both in the `d` hash and in `a`-tag order — so the same logical link republishes the same `d` regardless of creation direction, and the `source`/`target` markers carry no meaning. **`supports` and `updates` are directional** (source → target) and hash in semantic order.
- The `d` MUST be recomputable from the two `a` tags + `relationship`. The 4th-position markers on `a`/`e` follow the same role-marker idiom as `p` tags elsewhere in this NIP.
- `r` tags carry each claim's `r` verbatim, `i` tags the normalized forms (values deduplicated when both claims share a URL); one `k` = `web` accompanies them. Relationship events anchor to the claims (via `a`), not to pages — the URL tags exist for `#r`-join convenience and MAY be omitted when an endpoint's URL is unknown.
- Surfacing rule: a `contradicts` link SHOULD surface a warning indicator on **both** claims wherever they render.

## Kind 30056 — AuditModuleResult

Addressable. One surface-scan module's structured findings for one article text, under one versioned methodology, from one run. An epistemic audit examines the *published artifact's craft and support* — headline fidelity, language symmetry, number hygiene, source quality, internal coherence, definitional precision, omission geometry, prediction extraction — never the truth of its claims. The audited artifact is identified by content hash, not URL: outlets stealth-edit, and an audit must stay anchored to exactly the text it scored.

```jsonc
{
  "kind": 30056,
  "tags": [
    ["d", "mod:<sha256(article_hash + '|' + module + '|' + module_version + '|' + run_at).slice(0,16)>"],
    ["x", "<sha256 of normalized article markdown>"],
    ["a", "30023:<capturer-pubkey>:<article-d>", "<relay-hint>"],   // optional article pointer
    ["r", "<article-url-verbatim>"],
    ["i", "<normalized-url>"], ["k", "web"],
    ["t", "source_quality"],                 // the module name — indexed
    ["module-version", "1.0"],
    ["run-at", "2026-06-11T20:14:00Z"],
    ["score", "62"],                         // 0–100; omitted by prediction_extraction
    ["confidence", "0.78"],                  // 0.0–1.0; omitted by prediction_extraction
    ["model-params", "temperature=0"],       // optional run metadata
    ["auditor", "model", "anthropic/claude-sonnet-4-6"],
    ["client", "<client>"]
  ],
  "content": "<the module's findings JSON + top-level evidence_quotes[] index>"
}
```

- **`x` is the canonical article hash**: SHA-256 (lowercase hex) of the normalized article markdown — CRLF→LF, trailing spaces/tabs stripped per line, runs of 3+ newlines collapsed to 2, trailing whitespace stripped at end of input; defined over exactly **one** normalization pass, computed over the article body excluding any client metadata header. `x` is single-letter and relay-indexed (NIP-94 precedent: the SHA-256 of the thing); `{"kinds":[30056,30057],"#x":["<hash>"]}` is the one-filter "everything auditing this exact text" query. `r`/`i` are convenience joins that MAY go stale as URLs drift; the hash is the identity.
- The `d` MUST be recomputable from the event's own tags: `mod:` + the first 16 hex of SHA-256 over `<x> | <t module name> | <module-version> | <run-at>` (`|`-joined, verbatim tag values).
- **Time-series constraint (normative for every audit kind):** relays keep only the latest event per `(pubkey, kind, d)`, so audit-bearing `d`s MUST carry methodology version and/or run identity — a re-run or a version bump derives a NEW `d` (this scheme does so via `module-version` + `run-at`), prior-methodology audits persist as distinct addressable events, and supersession is expressed exclusively through explicit reference tags on the newer event, never through relay replacement. Republishing the same `d` is permitted only as an idempotent re-emit of the same run.
- `t` carries the module name (one of the eight; relay-indexed). Additional `t` values MAY mirror the article's topic/beat tags; beat *semantics* for audit kinds derive from matching `t` values against the publisher's published beat vocabulary — collisions with generic hashtags are expected and harmless.
- `score`/`confidence` mirror the content payload. `prediction_extraction` events carry **neither** — that module extracts a prediction ledger and is not scored.
- `content` is the module's findings JSON: a shared envelope (`module`, `version`, `score` + `confidence` except on prediction_extraction, mandatory `auditor_caveats[]` — what this scan could not determine) plus per-module finding arrays in which **every finding carries a verbatim `evidence_quote`** from the audited text. A finding that cannot quote the words it is about does not exist. A deduplicated top-level `evidence_quotes[]` index rides beside the findings.
- **Auditor identity tags**: `["auditor", "<model|human|pipeline|consensus>", "<id>"]`, plus repeatable `["auditor-constituent", "<kind>", "<id>"]` for pipeline/consensus auditors and an optional `["auditor-manifest", "<sha256>"]` (hash of the orchestration config: prompt set, weights, versions). Human auditors additionally carry an indexed `["p", "<pubkey>", "", "auditor"]`. The auditor tags record what *produced* the result; the signing pubkey records who *published* it. Human and machine auditors use identical wire shapes.
- **Firewall:** an audit module result scores craft under a published methodology — never a claim's truth. It is a different aggregation signal from kind 30051 (FactCheck — a truth verdict) and kind 30054 (Assessment — a personal stance); consumers MUST NOT merge them. Audit kinds never carry `stance`, `rating-value`, or `L`/`l` assessment labels; 30051/30054 never carry `score`/`confidence`/`ceiling`.
- Multi-letter tags (`module-version`, `run-at`, `score`, `confidence`, `auditor`, …) are not relay-indexed; standard queries filter on `#x` / `#a` / `#t` / `#p` + `kinds`, everything else client-side.

## Kind 30057 — AggregateAudit

Addressable. The combined article audit: per-module contributions under documented weights, capped by a **knowability ceiling** — the maximum score achievable given how verifiable the artifact's claims are in principle, so careful work on hard-to-verify topics is not penalized and easy topics cannot coast.

```jsonc
{
  "kind": 30057,
  "tags": [
    ["d", "agg:<sha256(article_hash + '|' + auditor_id + '|' + run_at).slice(0,16)>"],
    ["x", "<article-hash>"],
    ["a", "30023:<capturer-pubkey>:<article-d>", "<relay-hint>"],
    ["r", "<article-url-verbatim>"],
    ["i", "<normalized-url>"], ["k", "web"],
    ["run-at", "2026-06-11T20:14:05Z"],
    ["score", "80"],                         // final, post-ceiling
    ["raw-score", "85.4"],
    ["ceiling", "80"],
    ["ceiling-binding", "true"],             // present ONLY when raw > ceiling
    ["ceiling-source", "heuristic:source-quality/1.0"],
    ["confidence", "0.71"],
    ["a", "30056:<auditor-pubkey>:<mod-d>", "<relay-hint>", "source_quality"],  // ×N modules
    ["e", "<30056-event-id>", "<relay-hint>", "source_quality"],   // optional convenience
    ["e", "<prior-30057-event-id>", "", "supersedes"],             // optional
    ["e", "<dispute-event-id>", "", "resolves-dispute"],           // optional
    ["auditor", "pipeline", "xray-auditor/0.1.0/anthropic/claude-sonnet-4-6"],
    ["auditor-constituent", "model", "anthropic/claude-sonnet-4-6"],
    ["client", "<client>"]
  ],
  "content": "{ \"module_contributions\": [...], \"knowability_notes\": \"...\", \"model_estimated_ceiling\": null, \"top_strengths\": [...], \"top_concerns\": [...] }"
}
```

- The `d` MUST be recomputable from the event's own tags: `agg:` + the first 16 hex of SHA-256 over `<x> | <auditor id> | <run-at>`, where the auditor id is the `auditor` tag's third slot. The 30056 time-series constraint applies: every run is a new `d`; nothing overwrites.
- **Ceiling semantics:** the reference aggregation sets `score = min(raw-score, ceiling)`; `score` MUST NOT exceed either `raw-score` or `ceiling` (pipeline-level degradation MAY lower it further). `ceiling-binding` is present only when `raw-score > ceiling` — presence is the signal. `ceiling-source` MUST state the ceiling's provenance: `heuristic:<name>/<version>` (deterministically recomputable from the referenced module results — the reference implementation's canonical source for pipeline runs), `model` (the auditing model's judgment — calibration runs), `module:<coordinate>` (a dedicated knowability module), or `human`. `model_estimated_ceiling` in the content is advisory and never binds.
- **Module references are `a` coordinates first** (role-marked with the module name; durable across idempotent republish), with `e` ids as optional convenience. The weights publish inside `module_contributions`, so the aggregation is auditable from the event alone: weighted sum over present modules, renormalized, capped at the ceiling.
- **Supersession is a forward reference:** a newer audit `e`-tags its predecessor with role `supersedes` (and role `resolves-dispute` when it answers an upheld challenge). The superseded audit is never edited and remains visible; consumers derive lineage by querying forward references.
- **Disagreement is data:** multiple 30057s for the same `x` from different auditors are siblings. Consumers MUST NOT average them into a single consensus number; surface the spread.
- A score SHOULD never render without its confidence, and an aggregate never without its ceiling context — the wire carries both precisely so displays have no excuse.
- The 30056 firewall clause applies identically: consumers MUST NOT merge aggregate audit scores with 30051 verdicts or 30054 stances.

## Kind 30058 — PredictionEntry

Addressable. One testable prediction extracted from an article — the write side of the prediction ledger, the audit system's compounding long-game asset. Extracted at audit time, resolved later (possibly years later, possibly by a different auditor) via kind 30059.

```jsonc
{
  "kind": 30058,
  "tags": [
    ["d", "pred:<sha256(article_hash + '|' + norm(prediction_text)).slice(0,16)>"],
    ["x", "<article-hash>"],
    ["a", "30023:<capturer-pubkey>:<article-d>", "<relay-hint>"],   // optional
    ["a", "30040:<pubkey>:<claim-d>", "<relay-hint>", "claim"],     // optional — the atomized claim
    ["r", "<article-url-verbatim>"], ["i", "<normalized-url>"], ["k", "web"],
    ["prediction-type", "explicit"],     // explicit|implicit|conditional|negative|counterfactual
    ["hedge", "confident"],              // confident|hedged|speculative — the calibration input
    ["attribution", "named_source"],     // article_voice|named_source|vague_attribution
    ["attributed-name", "<who, when named>"],          // optional
    ["p", "<author-entity-pubkey>", "", "predicts"],   // optional, when tracked
    ["condition", "<antecedent>"],                     // REQUIRED for conditional predictions
    ["horizon", "by the end of the year"],
    ["horizon-iso", "2026-12-31"],                     // optional, when computable
    ["tractability", "publicly_resolvable"],           // publicly_resolvable|requires_private_info|ambiguous
    ["quote", "<exact evidence quote from the article>"],
    ["anchor", "<selector-json>"],                     // optional — W3C selector, the 30040 idiom
    ["criteria", "<concrete, observable resolution criteria>"],
    ["module-version", "1.0"],                         // prediction_extraction's version
    ["auditor", "model", "anthropic/claude-sonnet-4-6"],
    ["client", "<client>"]
  ],
  "content": "<the prediction text, restated clear and testable — NOTHING else>"
}
```

- The `content` carries the prediction text and nothing else, precisely so the `d` is mechanically recomputable from the event: `pred:` + the first 16 hex of SHA-256 over `<x> | norm(content)`, where `norm` trims, collapses whitespace runs to single spaces, and lowercases (the kind-30040 claim-id discipline, exactly).
- **The convergent `d` is deliberate**: re-extraction of the same restated text converges on one ledger record, so a resolution's `a` coordinate never retargets. Differently-phrased re-extractions mint sibling records (consumers group near-duplicates for display). The `d` includes the article hash, so a stealth-edited article's predictions are that text version's ledger.
- `resolution_status` and any latest-resolution pointer are NOT wire fields — they derive client-side from kind-30059 events (mutable state does not belong on signed immutable records).
- Predictions are NOT scored at extraction (no `score`/`confidence` tags, ever) — the ledger is graded by reality, via resolutions.
- When a prediction is promoted to a kind-30040 claim, the entry carries the claim's `a` coordinate (role `claim`) and the claim SHOULD carry an `a` back-reference to this entry (role `prediction`) — lineage runs both directions.

## Kind 30059 — PredictionResolution

Addressable. The outcome of one prediction, judged against reality with evidence. One per (resolver, prediction): the `d` derives from the prediction coordinate alone, so a resolver revising their resolution replaces it (latest wins); different resolvers are different pubkeys and coexist.

```jsonc
{
  "kind": 30059,
  "tags": [
    ["d", "res:<sha256(prediction_coordinate).slice(0,16)>"],
    ["a", "30058:<extractor-pubkey>:<pred-d>", "<relay-hint>", "prediction"],
    ["e", "<30058-event-id>", "<relay-hint>", "prediction"],   // optional
    ["x", "<article-hash>"],                        // the predicting article
    ["outcome", "false"],                           // true|false|partial|unresolvable
    ["confidence", "0.9"],
    ["resolved-at", "2027-01-15T00:00:00Z"],
    ["evidence", "url", "<url>", "<description>"],                 // ×N — typed:
    ["evidence", "nostr_event", "<coordinate-or-event-id>", "<description>"],
    ["evidence", "document_hash", "<sha256>", "<description>"],
    ["evidence", "quote", "<verbatim text>", "<description>"],
    ["auditor", "human", "<resolver-pubkey>"],
    ["p", "<resolver-pubkey>", "", "auditor"],
    ["client", "<client>"]
  ],
  "content": "<markdown notes: what happened, why this outcome>"
}
```

- **Resolutions are evidence-bound**: at least one typed `evidence` tag is REQUIRED — a resolution without verifiable references is returned, not published. Each entry carries kind, value, and description; `nostr_event` evidence values MUST be a raw `kind:pubkey:d` coordinate or a 64-hex event id (never bech32), and additionally emit a plain `a` (coordinate) or `e` (event id) tag for relay indexing.
- The `d` MUST be recomputable: `res:` + the first 16 hex of SHA-256 over the role-marked `prediction` `a` tag's value, verbatim. The role markers on the reference `a`/`e` tags exist because typed `nostr_event` evidence also emits plain `a`/`e` indexing tags — consumers MUST prefer role-marked references and MUST NOT treat evidence-derived tags as the prediction reference.
- Resolutions feed exactly one consumer: the calibration ledger (per-hedge resolution rates, and the published Brier-based calibration spec). A 30059 `outcome` judges whether a *specific prediction resolved against reality* — it is NOT a fact-check of any claim the prediction was atomized into. Consumers MUST NOT merge 30059 outcomes with 30051 ClaimReview verdicts or 30054 stances on a linked 30040.

## Kind 30060 — DossierSnapshot

Addressable. A materialized rollup of a subject's audit record — author, publication, beat, or publication×beat. **A cache, latest-wins by design**: the canonical truth is always the underlying audit events, and the snapshot carries every parameter (window, shrinkage constant, population mean) needed for any third party to re-derive it from scratch. Consumers MUST prefer re-derivation when they hold the underlying events.

```jsonc
{
  "kind": 30060,
  "tags": [
    ["d", "dossier:<sha256(subject_kind + '|' + subject_id).slice(0,16)>"],
    ["subject-kind", "publication_x_beat"],   // author|publication|beat|publication_x_beat
    ["p", "<entity-pubkey>"],                 // author/publication(/×beat) subjects
    ["t", "monetary-policy"],                 // beat(/×beat) subjects — a canonical vocabulary slug
    ["window-start", "2026-01-01T00:00:00Z"],
    ["window-end", "2026-06-11T00:00:00Z"],
    ["article-count", "14"],
    ["score-mean", "73.5"], ["score-median", "75"], ["score-stdev", "8.1"],
    ["shrinkage-k", "10"], ["population-mean", "77"], ["shrinkage-factor", "0.42"],
    ["auditor", "pipeline", "xray-auditor/0.1.0/anthropic/claude-sonnet-4-6"],
    ["client", "<client>"]
  ],
  "content": "{ \"per_module_means\": {…}, \"predictions\": { \"total\":…, \"resolved\":…, \"calibration\": {…}, \"calibration_v1\": { \"mean_brier\":…, \"resolved_count\":…, \"multiplier\": null } }, \"top_named_sources\": […], \"corrections\": null }"
}
```

- `subject_id` per kind: author/publication → the entity pubkey (the `p` tag); beat → the beat slug (the `t` tag); publication×beat → `<entity-pubkey>|<beat-slug>`. The `d` MUST be recomputable from the `subject-kind` tag plus those values.
- **Beat subjects MUST be canonical slugs from the publisher's versioned beat vocabulary** — free-form topic tags ride audit events but never mint dossier subjects (fragmented beats silently shrink sample sizes and distort the shrinkage math on reputation-bearing rollups). Beat semantics derive from matching `t` values against that published vocabulary.
- **Shrinkage is published, always**: rolled-up means are pulled toward the population mean (`shrunk = (n/(n+k))·raw + (k/(n+k))·population`), and the applied factor rides the wire — a raw three-article mean is never presented as a stable reputation.
- `calibration_v1` in the content is informational: the published Brier-based calibration spec, logged so the wire shape is stable; the `multiplier` field stays `null` until an explicit activation decision, and is never applied retroactively to article scores.

## Kind 30061 — AuditDispute

Addressable. A challenge to an audit record — module result, aggregate audit, prediction resolution, or claim. Anyone may file, **with evidence**: challenges without evidence quotes or verifiable references are returned, not adjudicated.

```jsonc
{
  "kind": 30061,
  "tags": [
    ["d", "dispute:<sha256(target_coordinate).slice(0,16)>"],
    ["a", "<target coordinate>", "<relay-hint>", "target"],
    ["e", "<target-event-id>", "<relay-hint>", "target"],   // optional
    ["target-kind", "aggregate_audit"],   // module_result|aggregate_audit|prediction_resolution|claim
    ["x", "<article-hash>"],              // when the target anchors to an article
    ["status", "open"],                   // filer-asserted: open|withdrawn
    ["contested", "<finding pointer: an evidence_quote or JSON path>"],   // ×N
    ["evidence", "<kind>", "<value>", "<description>"],   // ×N — typed, as on 30059
    ["auditor", "human", "<filer-pubkey>"],
    ["p", "<filer-pubkey>", "", "auditor"],
    ["client", "<client>"]
  ],
  "content": "<markdown dispute summary>"
}
```

- One dispute per (filer, target): the `d` derives from the target coordinate verbatim (the role-marked `target` `a` tag — evidence-derived `a`/`e` tags are never the target reference), so the filer may amend pre-adjudication or withdraw (`status: withdrawn`); the filed record is otherwise stable.
- **`status` is filer-asserted only** (`open`/`withdrawn`). Upheld/rejected outcomes are NOT wire fields here — they derive from adjudication events (a separate, future kind authored by other pubkeys) and from superseding audits that `e`-tag this dispute with role `resolves-dispute`. A dispute never edits its target; an upheld dispute produces a NEW audit that supersedes the original, and both remain visible.
- A rejected dispute remains visible too — the record of what was challenged and survived is part of a score's credibility.

## Kind 30062 — BehavioralFinding

Addressable. Names a **maneuver** a subject performs around the truth — an evasion, an immunizing defense, a self-serving revision — and binds it to an ordered evidence chain. It is the companion to kind 30054 (Assessment): where an assessment grades a *claim*, a finding describes a *subject's move*, and **renders no verdict on the subject's honesty or intent.**

```jsonc
{
  "kind": 30062,
  "tags": [
    ["d", "find:<sha256(subjectPubkey + '|' + maneuver + '|' + anchorsHash).slice(0,16)>"],
    ["p", "<subject-pubkey>", "", "subject"],
    ["L", "xray/forensic"],
    ["l", "defense/ad-hoc-patch", "xray/forensic"],
    ["role", "apologist"],
    ["r", "<source-url-verbatim>"], ["i", "<normalized-url>"], ["k", "web"],
    ["a", "30055:<author>:<rel-d>"],                       // optional: a revision/* edge this characterizes
    ["maneuver-step", "0", "<quote>", "<selector-json>", "<timestamp?>"],
    ["maneuver-step", "1", "<quote>", "<selector-json>", "<timestamp?>"],
    ["basis", "quoted"],
    ["suggested-by", "user"],
    ["client", "<client>"]
  ],
  "content": "<structural note>\n\n### Counter-read\n\n<the required alternative reading>"
}
```

- The subject is referenced by `p` with a `subject` slot-4 marker. A finding publishes against a **resolved subject pubkey**; the local subject reference (a display label or platform handle) never hits the wire.
- `l` carries the **maneuver** under the `xray/forensic` namespace. Values are drawn from a canon-seeded vocabulary (`neutralization/*`, `darvo/*`, `thought-reform/*`, `defense/*`, `grooming/*`) with the same custom-token escape hatch as kind 30054 labels; a maneuver MAY also reuse a 30054 `fallacy/*` or `consistency/*` value where the move *is* one of those.
- `maneuver-step` tags are **ordered** `[index, quote, selector-json, timestamp]`; `n > 1` is a multi-step sequence (e.g. a grooming chain). `anchorsHash` = `sha256(JSON of [[quote, selector-json, timestamp], …])`, so the `d` is recomputable from the `maneuver-step` tags alone. Multi-letter tags (`role`, `maneuver-step`, `basis`, `suggested-by`) are not relay-indexed.
- `basis` is one of `quoted` / `paraphrased` / `behavioral-cue` / `structural-inference` — *how we know*, in place of any numeric score. **There is no score, stance, or confidence on this kind**, by construction.
- `content` carries the structural `note`, then the **REQUIRED counter-read** under the last `### Counter-read` heading — the alternative/exonerating reading. A finding with no counter-read is malformed.
- **Firewall:** a behavioral finding is a distinct aggregation signal. It never carries `stance`, `rating-value`, `score`/`confidence`, or the `xray/assessment` namespace; consumers MUST NOT merge findings with assessments (30054), fact-checks (30051), or audits (30056–30061).
- **NIP-32 mirror + the verdict caveat.** A kind-1985 event MAY mirror the maneuver (`L`/`l` `xray/forensic`, `p` = the subject, `r` = the source URL) as the plain-NIP-32 aggregation path. Unlike the 30054 mirror, this one *does* label a person's pubkey — so consumers SHOULD treat it as a **structural observation, not a verdict**, and SHOULD surface the richer 30062's required counter-read alongside it. The mirror carries no `score` and asserts no intent.

## Kind 30063 — AdjudicatedVerdict

Addressable. **One author's** ruling on one **adjudicable proposition** — an atomized claim (kind 30040) typed by a `proposition-class` — as a **descriptive state** on a **declared standard of proof**, with verbatim two-sided evidence and **required caveats**. There is no consensus event, no authoritative-adjudicator role, and **no numeric truth anywhere on this kind**: when several authors rule on one proposition, agreement and variance are computed at read time over their separate 30063 events and never collapsed into a number.

```jsonc
{
  "kind": 30063,
  "tags": [
    ["d", "verdict:<sha256(claimCoord + '|' + propositionClass).slice(0,16)>"],
    ["a", "30040:<author>:<claim-d>", "<relay-hint>", "proposition-claim"],
    ["L", "xray/adjudication"],
    ["l", "established-true", "xray/adjudication"],
    ["proposition-class", "event-fact"],
    ["subject-role", "enacted"],
    ["criteria", "<what evidence settles it>"],
    ["horizon", "<descriptive or ISO>"], ["horizon-iso", "YYYY-MM-DD"],   // horizon REQUIRED for prediction
    ["hedge", "confident"], ["tractability", "publicly_resolvable"],      // optional, the 30058 vocabulary
    ["occurred", "<unix-seconds>", "day"],                                 // event-time + REQUIRED precision
    ["standard", "preponderance"],
    ["evidence-for", "<verbatim quote>", "tier-1", "<url>", "<30040-coord>"],
    ["evidence-against", "<verbatim quote>", "tier-3", "<url>"],
    ["caveat", "<what this ruling could not determine>"],
    ["method", "<how adjudicated>"],
    ["a", "3006(3|4):<author>:<d>", "<relay-hint>", "precedent", "binding|persuasive"],
    ["e", "<reply-event-id>", "<relay-hint>", "reply"],
    ["exposure", "<adjudicator's relevant interests, disclosed>"],
    ["e", "<superseded-event-id>", "<relay-hint>", "supersedes"],
    ["r", "<source-url>"], ["i", "<normalized-url>"], ["k", "web"],
    ["suggested-by", "user"],
    ["client", "<client>"]
  ],
  "content": "<rationale markdown>"
}
```

- `l` carries the verdict state under `xray/adjudication`: `established-true` | `established-false` | `contested` | `unresolved` | `insufficient-evidence`. `unresolved` and `insufficient-evidence` are **first-class, permanently honest states** — never forced to resolve.
- **The firewall (build- and read-side):** `proposition-class` MUST be one of `event-fact` | `state-fact` | `prediction` | `stated-commitment`. A verdict on an `interpretation` or `stated-value` proposition is **malformed** — interpretations and bare values are not adjudicable as true/false; consumers MUST reject such events rather than render them. (For a `stated-commitment`, `established-true` means *the commitment was really made as quoted* — never that it was wise.)
- **Evidence adequacy is per-state:** `established-true` MUST cite `evidence-for`; `established-false` MUST cite `evidence-against`; `contested` MUST cite both. Evidence entries are `[quote, tier, url, 30040-coord]` with the tier ladder `tier-1` (primary/official) / `tier-2` (independent reporting) / `tier-3` (single-source/uncorroborated). The honest states may cite nothing — their `caveat` tags carry the why.
- **`caveat` tags (≥1) are structural, not decorative.** A verdict with no caveat is malformed: what the ruling could not determine travels with it, so no state can be quoted away from its limits.
- **There is NO `p` tag on this kind.** Verdicts attach to propositions, not persons; any entity-level reading is the reader's own aggregation over proposition verdicts, coverage-capped.
- `d` is keyed **(author, proposition)** — recomputable from the `a` coordinate + `proposition-class` alone — so a superseding ruling by the same author **replaces** (NIP-01 addressable) and chains by the `e … supersedes` marker; lineage stays legible without mutating prior events.
- **Disputes** reuse kind 30061 with `target-kind: verdict` (an additive extension of that enum; clients predating it null-parse such disputes).
- **Precedent citations** (`a … precedent <weight>`, weight `binding` | `persuasive`, defaulting to `persuasive` when absent — an unweighted citation never inflates itself) reference prior 30063/30064 rulings of the same proposition or match class. Informational only until kind 30065 ships; consumers MUST NOT treat them as authority.
- **Right of reply** (`e … reply`) references a subject-authored response event FROM the ruling, so the reply travels with it; consumers SHOULD surface it alongside. A dedicated reply UI is out of scope here.
- **`exposure`** discloses the adjudicator's relevant financial/political/relational interests, published WITH the ruling (the political-capture defense). It is author-asserted and optional; consumers SHOULD render it verbatim when present, and its absence is itself information.
- **NIP-32 mirror.** A kind-1985 event MAY mirror the verdict state (`L`/`l` `xray/adjudication`, `a` = the claim coordinate, `r` = the source URL). Like the 30054 mirror — and unlike the 30062 one — it labels **content, never a pubkey**.

## Kind 30064 — IntegrityFinding

Addressable. The adjudicated **word-deed match**: links a subject's **stated** commitment or value (their word — a 30040 claim atomized as `stated-commitment`/`stated-value` with subject-role `stated`) to one or more of their **enacted** action-facts (their deeds), and rules the observable gap. The match **is a verdict, not a drawn edge** — it carries the same standard-of-proof / evidence / caveat / supersession apparatus as kind 30063. `ascribed` words (a third party's characterization) are not the subject's to be held to and MUST NOT appear as the word side.

```jsonc
{
  "kind": 30064,
  "tags": [
    ["d", "integrity:<sha256(wordCoord + '|' + wordClass + '|' + sortedDeedKey).slice(0,16)>"],
    ["p", "<subject-pubkey>", "", "subject"],
    ["L", "xray/adjudication"],
    ["l", "broken", "xray/adjudication"],
    ["word", "30040:<author>:<word-d>", "stated-commitment", "<occurred-at>", "day"],
    ["a", "30040:<author>:<word-d>", "<relay-hint>", "word"],
    ["deed", "30040:<author>:<deed-d>", "event-fact", "<occurred-at>", "day"],
    ["a", "30040:<author>:<deed-d>", "<relay-hint>", "deed"],
    ["standard", "clear-and-convincing"],
    ["evidence-for", "<verbatim quote>", "tier-1", "<url>"],
    ["caveat", "<limit of this match>"],
    ["gap-cause", "constraint", "<the documented explanation>"],
    ["gap-evidence", "<verbatim quote>", "tier-1", "<url>"],
    ["a", "30040:<author>:<constraint-d>", "<relay-hint>", "constraint"],
    ["a", "30055:<author>:<rel-d>", "<relay-hint>", "revision"],
    ["a", "3006(3|4):<author>:<d>", "<relay-hint>", "precedent", "binding|persuasive"],
    ["e", "<reply-event-id>", "<relay-hint>", "reply"],
    ["exposure", "<adjudicator's relevant interests, disclosed>"],
    ["e", "<superseded-event-id>", "<relay-hint>", "supersedes"],
    ["r", "<source-url>"], ["i", "<normalized-url>"], ["k", "web"],
    ["suggested-by", "user"],
    ["client", "<client>"]
  ],
  "content": "<rationale markdown>"
}
```

- **Match vocabulary is per word class** — `fulfilled`/`broken` for a `stated-commitment`, `consistent`/`contradicted` for a `stated-value`, with `unrelated`/`contested`/`insufficient` common to both. A `contradicted` commitment or a `fulfilled` value is malformed. **The value firewall:** for a `stated-value` the match adjudicates only the observable gap between the stated value and documented deeds — the value itself is never ruled true/false, on this kind or any other.
- `word`/`deed` tags carry `[coord, proposition-class, occurred-at, occurred-precision]`; the deed's event-time (distinct from `created_at`) is what integrity timelines order on, under the same no-false-precision rule as 30063's `occurred` (a time without a declared precision is malformed). `d` is recomputable from the `word` + `deed` tags alone; **deed order is not identity** (the deed key sorts). Each coordinate is mirrored as an indexed `a` tag with a slot-4 marker.
- **`gap-cause` is DOCUMENTED or absent.** One of `lie` / `revision` / `incapacity` / `constraint` / `misattribution`, attaching only to a `broken`/`contradicted` match, and it MUST carry a non-empty documented explanation — an undocumented cause is an intent inference, and **intent is never adjudicated** (there is no intent field to smuggle it into). `constraint` additionally requires an `a … constraint` reference to a **corroborated action-fact** (the constraint is evidence that discounts the finding, not an excuse, and clears the same corroboration bar as any proposition). A disclosed `revision` MAY cite the 30055 `revision/*` edge it composes (`a … revision`) — disclosed revision on new evidence is potential **credit**; undisclosed reversal is already a 30062 `walks-back`/`narrative-patch`, composed, not re-invented.
- A finding is read as **pattern, not instance**: consumers SHOULD render an entity's findings as a time series ordered on the deeds' `occurred-at`, and SHOULD NOT surface a single match as a conclusion about the person.
- **There is deliberately NO kind-1985 mirror for this kind.** A bare match-label on a person's pubkey, stripped of its evidence and caveats, is exactly the decontextualized person-grade this family forbids; the full 30064 is the only wire shape.
- **Disputes** reuse kind 30061 with `target-kind: integrity_finding`.
- **Precedent citations, right of reply, and `exposure`** carry the same grammar and semantics as on kind 30063.

**Kind 30065 is RESERVED** for a future PrecedentCitation — a verdict/finding citing prior rulings of the same proposition or match class as `binding`/`persuasive` precedent (§stare-decisis, deferred). Until it ships, precedent MAY be expressed as an `a` tag on 30063/30064 with a slot-4 `precedent` marker and a slot-5 weight (`binding` | `persuasive`); consumers MUST treat it as informational only.

## Kind 30067 — EntityFactSheet

Addressable. The full structured field table for one entity — an adjudicable **index over verifiable events**: every fact references a *published* kind-30040 claim, so any consumer can follow the `a` coordinates to the verbatim quotes and `x`-hashed article versions each value rests on. Signed by the **entity's own key** (the same key its kind-0 profile uses); the publishing archive is named in a `p` tag. (Kind 30066 is deliberately unused — the moral-lens feature is wire-less by design and its guards machine-check that; 30067 is the next free slot.)

```jsonc
{
  "kind": 30067,
  "tags": [
    ["d", "xray-facts"],                                  // fixed — one replaceable sheet per entity per archive
    ["p", "<publisher pubkey>", "", "publisher"],         // the archive that assembled it
    ["L", "xray/fact-sheet"],
    ["l", "v1", "xray/fact-sheet"],
    ["fact", "<field>", "<value>", "<valid_from band ISO | ''>", "<valid_to band ISO | ''>"],  // one per value
    ["a", "30040:<claim publisher pk>:<claim d>", "", "fact-source"],  // one per distinct source claim
    ["x", "<canonical article hash>"],                    // one per distinct article version cited
    ["i", "<scheme:external-id>", ""],                    // NIP-39 mirrors, when known
    ["client", "xray"]
  ],
  "content": "{ \"version\": 1, \"entity_id\": …, \"fields\": [ { \"field\", \"value\", \"value_ref_pubkey\", \"valid_from\", \"valid_from_precision\", \"valid_to\", \"valid_to_precision\", \"observed_at\", \"observed_precision\", \"contested\", \"sources\": [ { \"claim_coord\", \"url\", \"article_hash\", \"quote\", \"captured_at\" } ] } ], \"assembled_from\", \"generated_at\" }"
}
```

- **Every fact in the sheet references a published 30040** — an unpublished side of a disagreement is withheld until its claim lands, while the field still flags `contested: true`. The sheet never contains anything a relay reader can't independently verify.
- **Contested fields DO appear, both sides with evidence** — the inverse of the kind-0 `about`, which omits them entirely. The profile is the summary a generic client renders; the sheet is the structured record a fact-checking client consumes.
- Date slots use the same **band-truncated ISO + explicit precision** convention as the 30040 fact tags: `1962`, `1962-03`, `1962-03-15`, or full ISO, never more precise than a source asserted.
- No verdict states, no integrity vocabulary, no scores — a fact sheet carries *what sources said*, with citations; judgment kinds (30054/30063/30064) do their own work against the referenced claims.
- Replaceable-event semantics make republish idempotent; the reference implementation republishes only when the content (excluding `generated_at`) actually changed.
- The enriched kind-0 `about` this sheet accompanies is assembled from the same dossier: only published-claim facts, contested fields omitted, every line attributed "per <source>" — the profile cites, it never asserts.

## Kind 30068 — CaseBrief

Addressable. The structured form of X-Ray's Phase-20 corpus synthesis for one case — the machine-readable companion to a readable kind-30023 long-form article that carries the SAME content as prose. Both are published together and cross-linked; a stranger with any NOSTR client reads the 30023 article, while an X-Ray client renders the 30068 richly and can open the referenced members. Signed by the **user's primary identity** (it is the user's synthesis, not an entity's).

```jsonc
{
  "kind": 30068,
  "tags": [
    ["d", "xray-brief:<caseId>"],                       // one replaceable brief per case
    ["title", "Case brief — <case name>"],
    ["t", "xray-case-brief"],                           // recognizer (also on the sibling 30023)
    ["prompt_version", "corpus-v1"],
    ["grounded", "<checked>:<dropped>"],                // grounding disclosure (quotes verified : pruned)
    ["a", "30023:<user pk>:xray-brief:<caseId>"],       // cross-link to the readable article (by coordinate)
    ["a", "30023:<member pk>:<member d>", "", "member"],// one per member the brief cites (when resolvable)
    ["x", "<member article hash>"],                     // one per distinct member version, for the #x join
    ["client", "xray"]
  ],
  "content": "{ \"case_name\", \"scope_question\", \"summary\", \"positions\": [ { \"label\", \"core_argument\", \"holders\": [ { \"article_hash\" } ] } ], \"cruxes\": [ { \"question\", \"sides\": [ { \"position_label\", \"view\" } ], \"evidence_refs\": [ { \"article_hash\", \"quote\" } ], \"what_would_resolve\" } ], \"load_bearing\": [ { \"claim_ref\", \"article_hash\", \"quote\", \"why\" } ], \"coverage_gaps\": [ … ] }"
}
```

- **Prose and structure only — NO fused score, NO verdict.** The content carries exactly the map fields (summary / positions / cruxes / load-bearing claims / coverage gaps); it has no numeric case score, no rating, and no adjudication between positions. This is Phase 20's firewall (`docs/CASE_SYNTHESIS_DESIGN.md` §no fused score) carried onto the wire, machine-checked by a guard test. The **`proposals`** array from the local brief (reviewer-facing edit suggestions) is deliberately EXCLUDED from publication.
- **Every quote is verbatim from a named member** (`article_hash`) and was grounded before storage; the `grounded` tag discloses how many quotes were verified vs. pruned. Consumers can follow the `x`/`a` member references to the exact source text.
- **The two artifacts cross-link by coordinate** (`d` = `xray-brief:<caseId>` on both), not by event id, so neither has to be signed before the other. The 30023 sibling carries the same `t xray-case-brief` recognizer and the same member `a`/`x` references.
- Replaceable per case: re-running the synthesis and re-publishing replaces the prior brief for that `d`.

## Kind 30069 — OwnedKeys (creator-binding manifest)

Addressable. A creator's signed list of the entity pubkeys their archive operates — the revocable half of X-Ray's creator binding (`docs/ENTITY_IDENTITY_DESIGN.md` §4). Signed by the **creator's primary key**; one per creator (`d` fixed):

```jsonc
{
  "kind": 30069,
  "tags": [
    ["d", "xray-owned-keys"],
    ["p", "<entity pubkey>", "", "owned"],                       // one per owned entity
    ["owned", "<entity pubkey>", "<entity id>", "<entity name>"], // greppable detail row
    ["client", "xray"]
  ],
  "content": ""
}
```

- **Revocation is republish-without-the-key** — the manifest is replaceable, so disowning an entity key takes effect immediately for any consumer that checks. This is deliberately the property NIP-26 lacks.
- **Rotation-survivable**: a new primary republishes the manifest under its own key (dual-listing old + new entity pubkeys during a migration window).
- Rows are sorted by pubkey (deterministic republish comparison). Consumers MUST take the newest manifest per creator.

## Kind 0 / 30067 — creator binding on entity-signed events (extension)

Entity-signed events (the kind-0 profile and the kind-30067 fact sheet) additionally carry:

```
["p", "<creator primary pubkey>", "", "creator"]
["delegation", "<creator pubkey>", "<conditions>", "<64-byte Schnorr token, hex>"]   // NIP-26 format
```

- The `creator` p-tag is the honest, human-legible backlink (it complements — does not replace — the 30067 `publisher` tag).
- The `delegation` tag follows **NIP-26 verbatim**: the token is a BIP-340 signature by the creator over `sha256("nostr:delegation:<entity pubkey>:<conditions>")`, with conditions restricted to `kind=0&kind=30067` plus a bounded `created_at` window. NIP-26 is officially *unrecommended* for general use — X-Ray adopts only the token FORMAT and **verifies it itself**: no relay is expected to honor delegator-as-author filters, and no other client is expected to check it. It is present because it is the strongest *self-contained* proof that the creator authorized this entity key, verifiable from the event alone.
- **Verification rule (reference implementation):** an entity is *creator-bound* when its pubkey is listed in the creator's newest 30069 **and** at least one of its events carries a valid token from that creator; exactly one of the two ⇒ *partially bound*; neither ⇒ unbound. Verifiers MUST check the token's conditions against the event that carries it (kind whitelist, `created_at` window) and MUST fail closed on unknown condition grammar.
- The binding tags are enrichment: absence means "unbound", never "invalid".

## Kind 32125 — EntityArticleRelationship

An addressable event asserting that a captured article stands in a named relationship to an entity — that the article is **`about`** the entity, or that the entity is the article's **`source`** (its asserter). Authored by the capturing user, it makes "which articles concern this entity, and who they attribute claims to" a one-hop relay query rather than a re-derivation from every claim. One event is emitted per `(entity, article, relationship)` triple at publish time, deduplicated by the `d` tag.

The two `relationship` values are derived from the entity's role on the article's claims: **`about`** (the claim's `about` list includes the entity) and **`source`** (the claim's `source` is this entity). Republishing replaces in place per NIP-01.

Tags:

- `d` (required) — `<entity-id>:<article-url>:<relationship>`. The `entity-id` here is the **author's local** entity id (e.g. `entity_1234abcd5678ef90`), so it is reader-local and does **not** collide across users — exactly like the 32126 `linked-entity` id. The cross-user handles are the `p` pubkey and the `r` URL below.
- `r` (required) — the normalized article URL (the same canonical form the article's kind-30023 uses).
- `p`, slot-4 role = the `relationship` value (required) — the entity's **wire** pubkey. This is the queryable cross-user identifier for the entity; the `d`-tag id is not.
- `entity-name`, `entity-type` (required) — mirrored for non-indexed reads / list titles.
- `relationship` (required) — `about` | `source`, mirrored out of the `d` tag.
- `claim-ref` (optional) — the local claim id that induced this relationship, when one did.
- `client` (optional).
- `content` is empty.

Because the relationship is the author's *claim* about an article, two users MAY assert different relationships for the same URL and entity; consumers attribute each to its event's author and render disagreements side by side, never merged (the 32126 posture).

```jsonc
{
  "kind": 32125,
  "tags": [
    ["d", "entity_1234abcd5678ef90:https://example.com/article:about"],
    ["r", "https://example.com/article"],
    ["p", "<entity's wire pubkey>", "", "about"],
    ["entity-name", "Institute X"],
    ["entity-type", "organization"],
    ["relationship", "about"],
    ["claim-ref", "claim_0011223344556677"],
    ["client", "xray"]
  ],
  "content": ""
}
```

Queries:

```jsonc
{ "kinds": [32125], "#r": ["<article-url>"], "limit": 100 }        // which entities an article is about / sourced from
{ "kinds": [32125], "#p": ["<entity wire pubkey>"], "limit": 100 } // which articles concern an entity
```

## Kind 32126 — PlatformAccount

An addressable event that materializes a captured social-platform account as a NOSTR-queryable identity reference, authored by the capturing user.

The account's identifying pubkey is **derived, deterministic, and identical for every user**:

```
account_pubkey = secp256k1_pubkey( sha256( "xray:platform-account:v1:" + platform + ":" + stable_id ) )
```

where `platform` is the lowercased platform slug (`twitter`, `youtube`, `substack`, `instagram`, `facebook`, `tiktok`) and `stable_id` is the platform's most stable identifier for the account (channel id, numeric user id, or handle, per platform). Anyone who knows the handle can derive the same pubkey — that is the rendezvous: every capturer's articles (`p` role `author`) and comments (`p` role `commenter`) reference the same account pubkey with zero coordination.

**The derived pubkey is an identifier, never a signer.** The private scalar is discarded at derivation and no event is ever signed with it. Clients MUST NOT treat events *authored by* a derived account pubkey as authentic account activity.

Tags:

- `d` (required) — the account key `<platform>:<stable_id>`; republishing replaces in place per NIP-01.
- `p`, role `account` (required) — the derived account pubkey.
- `account-platform`, `account-id` (required) — platform slug + stable id, mirrored for non-indexed reads.
- `account-username`, `account-name`, `r` (profile URL), `account-verified` (optional) — display metadata.
- `linked-entity` (optional) — the author's **local** entity id string for the person/organization they consider this account to belong to. Reader-local; third parties cannot resolve it.
- `p`, role `linked-entity` (optional) — the wire pubkey of that entity, making account → entity resolution a one-hop relay query.

The entity link is the author's *claim*, not a registry fact: two users MAY link the same account to different entity pubkeys, and consumers MUST attribute each link to its event's author and render disagreements side by side, never merged.

```jsonc
{
  "kind": 32126,
  "tags": [
    ["d", "twitter:jack"],
    ["p", "<derived account pubkey>", "", "account"],
    ["account-platform", "twitter"],
    ["account-id", "jack"],
    ["account-username", "jack"],
    ["linked-entity", "entity_1234abcd5678ef90"],
    ["p", "<author's entity wire pubkey>", "", "linked-entity"],
    ["client", "xray"]
  ],
  "content": ""
}
```

## Kind 30023 — `responds-to` tag (extension)

A long-form article (kind 30023) MAY declare that it responds to one or more other pieces of content. Each response is a separate `responds-to` tag:

```
["responds-to", "<target>", "<relationship>", "<relay-hint>"?]
```

Where:

- `<target>` is one of: a normalized URL, a `nostr:nevent1...`, or a `nostr:naddr1...`.
- `<relationship>` is one of: `rebuts`, `supports`, `extends`, `contextualizes`, `corrects`.
- `<relay-hint>` is optional and meaningful only for `nostr:` targets.

Authors SHOULD also emit an `r` tag with the same target URL (or, for `nostr:` targets, an `a` or `e` tag) to enable relay-side indexing — multi-letter tag names are not indexed by default per NIP-01.

Consumers visiting a URL or NOSTR event that is the target of a `responds-to` SHOULD surface the responding articles in addition to comments and other annotations. A standard query:

```jsonc
{ "kinds": [30023], "#r": ["<target-url>"], "limit": 50 }
```

Filtered client-side to events that carry a matching `responds-to` tag.

## Kind 30023 — `capture-url` tag (extension)

A long-form article (kind 30023) MAY record that its content was fetched from a different address than the article's identity URL — an archive.today or Wayback Machine snapshot, or an arXiv rendering variant (`/pdf/`, `/html/`, ar5iv):

```
["capture-url", "<address the capture was actually fetched from>"]
```

At most one per event. The article's **identity** — the first `r` tag and the input to the `d` tag — is the ORIGINAL URL, recovered from the archive URL's structure (Wayback path-embedded originals, archive.today deep links, arXiv id mapping) or from the archive page's own markers, and normalized like any direct capture. This is deliberate: an archive capture and a direct capture of the same piece MUST land in the same metadata bucket (same `#r`, same `d`), or claims, assessments, and audits fork across mirrors of one text.

The tag is present ONLY when the original was verifiably recovered (so it always differs from the first `r`). When recovery fails, publishers claim nothing: the capture keys to the address actually fetched and no `capture-url` is emitted — a wrong original forks identity worse than none.

Publishers SHOULD also co-emit an indexed `r` tag with the capture address, strictly AFTER the primary `r` (consumers take the FIRST `r` as the article URL), so `{"kinds":[30023],"#r":["<archive-url>"]}` finds the capture from the mirror side too.

## Kind 30023 — podcast identity tags (extension)

A long-form article that is an **imported podcast transcript** (Phase 21 — `content_format` = `transcript`, `platform` = `podcast`) MAY carry the universal podcast identifiers the user supplied at import. All are optional and additive; a publisher claims nothing it was not given.

```
["show", "<podcast / show name>"]
["podcast_guid", "<feed GUID>"]           +  ["i", "podcast:guid:<feed GUID, lowercased>"]
["podcast_episode_guid", "<episode GUID>"] + ["i", "podcast:item:guid:<episode GUID, case-preserved>"]
["feed_url", "<RSS feed URL>"]
["itunes_id", "<iTunes / Apple collection id>"]
```

At most one of each. The greppable domain tag (`podcast_guid`, `podcast_episode_guid`) is paired with its **NIP-73 external-id** form (`["i", "podcast:guid:…"]`), the DOI/arXiv dual-tag pattern — NIP-73 defines the `podcast:guid:` and `podcast:item:guid:` identifier namespaces upstream, and this is X-Ray's adoption of them. The **feed GUID** is a podcast-namespace UUID and is lowercased in its `i` form; the **episode GUID** is a case-significant free string and rides verbatim in both forms. Numeric values (iTunes id) are string-coerced (relays reject non-string tag values).

When a `feed_url` is present, publishers SHOULD co-emit an indexed `r` tag with it, strictly AFTER the primary `r` (consumers take the FIRST `r` as the article URL), so `{"kinds":[30023],"#r":["<feed-url>"]}` finds every captured episode of one show.

A transcript also carries a structure manifest:

```
["transcript_meta", "<format>:<turn_count>:<speaker_count>"]
```

`format ∈ {vtt, srt, speaker-lines, plain}`. This is a MANIFEST, not a substrate: the transcript's speaker names and turn bodies live in the event **content** (the speaker-labeled markdown the `x` hash covers), never in tags — a full transcript would blow the event-size budget. `transcript_meta` is distinct from `transcript_lang` (Kind 30023 YouTube captures): that one is a per-track language manifest with different positional semantics.

## Kind 30023 — `media` tag (extension)

A long-form article MAY carry one **user-declared media-type** tag:

```
["media", "podcast"]     or     ["media", "video"]
```

At most one; only these two values. It records what the captured URL **contains** — a podcast episode, or a video hosted off the platforms X-Ray detects natively — as declared by the capturing user in the reader. It is **never inferred** by the publisher, and it is deliberately distinct from `content_format`: that tag is capture provenance (what the extractor produced — `article`, `video`, `transcript`, `pdf`, …), while `media` is a human assertion about the underlying work. A Spotify episode page captured as an ordinary article keeps `content_format` = `article` and gains `media` = `podcast`.

The tag typically travels with the podcast identity tags above (same episode declared at its Spotify, Apple, Substack, YouTube, or custom-site URL — the NIP-73 `i` forms are what join those captures), but is valid alone: a bare declaration with no known identifiers still publishes.

## Kind 30023 — `source-type` tag (extension)

A long-form article MAY carry one **user-declared source-type** tag recording what KIND of artifact the captured URL is:

```
["source-type", "primary-research"]
```

At most one; values are a closed set: `primary-record` (an official/original document, dataset, filing, ruling, transcript, or raw recording) · `primary-research` (the original study/paper/preprint) · `reporting` (first-hand journalism/eyewitness) · `analysis` (secondary commentary/review/op-ed) · `reference` (tertiary summary/explainer). Distilled from the library primary/secondary/tertiary distinction and the epistemic-audit Module-04 source taxonomy; "primary" means the **originating** artifact others cite (the Nature paper), not a write-up of it.

It is **user-declared, never inferred by the publisher** — X-Ray auto-suggests from scholarly identifiers (a `doi`/`arxiv` tag ⇒ `primary-research`) and schema.org `@type`, but the capturing user confirms. It is orthogonal to two neighbours: `content_format`/`media` (what MEDIUM the capture is), and the `tier-1/2/3` evidence ladder on verdict events (how well-sourced a specific evidence claim is). Consumers treat an unrecognized value as absent. A DOI/arXiv `i` tag on the same event is itself machine-checkable proof of a version-of-record / preprint, complementing the human `source-type` declaration.

## Kind 30023 — `link` tag (extension)

A long-form article (kind 30023) MAY carry one `link` tag per distinct EXTERNAL outbound link in its body, in document order:

```
["link", "<normalized target URL>", "<anchor text, ≤120 chars>"?, "<evidence-role>"?]
```

Where:

- `<target URL>` is normalized exactly as the primary `r` (§6.2 rules) — a link and its tracking-param variant are ONE target, and a link to an article meets that article's own capture on one URL.
- The optional anchor text is the link's visible text, whitespace-collapsed and truncated to 120 characters. It is descriptive, not normative.
- The optional **4th positional `evidence-role`** (Phase 23.1b) records the **citation intent** — WHY the article points at this target — as a user declaration. Closed value set, a lay-relabelled subset of CiTO (the Citation Typing Ontology): `evidence` (cito:citesAsEvidence — the primary source relied on) · `mention` (citesForInformation) · `supports` · `disputes` · `reviews`. When a role is present the anchor slot is filled (empty string if the link had no anchor text) so the role's position is unambiguous. Consumers treat an unrecognized role as absent. A `disputes`/`evidence` link from an `analysis`-typed article to a `primary-research`-typed target is a visible secondary→primary derivation edge (PROV `wasDerivedFrom`).

Semantics: absent an `evidence-role`, `link` asserts **linkage only** — the body contains a hyperlink to the target, no stance. The role, when present, adds the citing article's declared intent; broader endorsement/rebuttal of a whole work is still the separate `responds-to` relationship. Internal links (same-host navigation) are not emitted. Publishers extract links under a cap (X-Ray: 100 distinct targets), so **the absence of a `link` tag is not evidence the article does not link somewhere** — consumers needing certainty must consult the captured body.

Publishers SHOULD co-emit an indexed `r` tag for the first **25** linked targets (after the primary `r` and every other co-emit; deduplicated against `r` tags already on the event — the FIRST `r` remains the article's own URL). This makes the edge queryable from the linked side:

```jsonc
{ "kinds": [30023], "#r": ["<linked-url>"], "limit": 100 }
```

returns both captures OF that URL and articles LINKING to it; the `link`/`capture-url`/`responds-to` tags (against the first `r`) disambiguate which is which. Relay tag-count and event-size limits are the practical bound here — see the relay-selection notes in the operations runbook.

History: this tag first shipped as `cites` (2026-07, briefly). "Citation" overstated the semantics — the tag asserts a hyperlink, not a scholarly citation — so it was renamed before any tagged release. Consumers MAY read `cites` tags with identical positions from events published in that window; publishers MUST emit `link`.

## Kind 30023 — `x` tag (extension)

A long-form article (kind 30023) SHOULD carry the canonical article hash of its own body as an indexed `x` tag (NIP-94 precedent: the SHA-256 of the thing):

```
["x", "<sha256 of the normalized article body markdown>"]
```

The hash input is the event `content` after stripping the client metadata header (the leading `---…---` block), normalized exactly as specified in the kind-30056 section — so any consumer can verify the tag from the event alone, and `{"kinds":[30023],"#x":["<hash>"]}` finds the article a set of audit events scored. Additive and optional: events published before this extension carry no `x` tag and join audit queries by `r`/`d` instead; a re-published edit derives a NEW hash, which is the point — the audit kinds anchor to the exact text they scored, and a hash change between captures of one URL is a detected content change, not an error.

## Kind 1985 — label mirrors (NIP-32)

Consolidated grammar for the plain-NIP-32 `1985` events an X-Ray publisher emits. Each is a MIRROR of a richer parameterized event — an aggregation convenience for generic NIP-32 consumers, never the primary record — and each uses exactly one of three namespaces. The full rules live in the parent-kind sections; the invariants gathered here:

| Namespace (`L`) | Mirrors | Labeled subjects | Person-labeling rule |
|---|---|---|---|
| `xray/assessment` | kind 30054 | the claim's `a` coordinate + its verbatim `r` URL | **No `p` tag, ever** — a `p` would pin the issue labels on the claim's *author* (a reputational mislabel) |
| `xray/forensic` | kind 30062 | the subject `p` + the source `r` URL | Does label a pubkey — consumers SHOULD treat it as a **structural observation, not a verdict**, surface the 30062's required counter-read alongside it; it carries no score and asserts no intent |
| `xray/adjudication` | kind 30063 | the claim's `a` coordinate + the source `r` URL | Labels **content, never a pubkey** |

- `l` values come from the namespace's vocabulary in the parent section (assessment labels, forensic maneuvers, verdict states); at most one `l` per value.
- **Kind 30064 (integrity findings) deliberately has NO 1985 mirror**: a bare match-label on a person's pubkey, stripped of its evidence and caveats, is exactly the decontextualized person-grade that family forbids — the full 30064 is the only wire shape.
- A mirror is never authoritative on its own: consumers resolving a 1985 under one of these namespaces SHOULD fetch the parent event (same author, matching `a`/`p`/`r`) for the evidence, caveats, and firewall context the mirror strips.

## Phase 20 — case-corpus synthesis (no new kind)

The Phase-20 case-first work (`docs/CASE_SYNTHESIS_DESIGN.md`) adds **no
wire kind**. Case membership is local (the archive record's entity tags
or a claim's `about` — the same 30023 `p` tags and 30040 `about` already
documented), the local case graph is derived on read, and the LLM
corpus **brief is local-only** (stored in IndexedDB, exported in the
case file, never published). The brief's *proposals*, once a human
accepts them, materialize as ordinary **kind-30040** claims and
**kind-30055** relationship links through the existing publish paths —
nothing new on the wire.

## Querying

A client wishing to display all metadata for a URL SHOULD issue these filters in parallel and merge the results:

```jsonc
[
  { "kinds": [30040, 30050, 30051, 30052, 30054, 30055], "#r": ["<url>"], "limit": 200 },
  { "kinds": [30056, 30057, 30058, 30062, 30063], "#r": ["<url>"], "limit": 100 },
  { "kinds": [9802], "#r": ["<url>"], "limit": 100 },
  { "kinds": [1111], "#i": ["<url>"], "limit": 200 },
  { "kinds": [1985], "#r": ["<url>"], "limit": 100 },
  { "kinds": [17], "#i": ["<url>"], "limit": 200 },
  { "kinds": [1984], "#r": ["<url>"], "limit": 50 },
  { "kinds": [30023], "#r": ["<url>"], "limit": 50 }
]
```

The kind 30023 query catches articles published with `responds-to`; clients filter client-side to those with a matching `responds-to` tag.

Other standard queries:

```jsonc
{ "kinds": [30040, 30054], "#p": ["<entity-pubkey>"], "limit": 200 }   // claims about an entity + their assessments
{ "kinds": [30054, 30055], "#a": ["30040:<pubkey>:<d>"], "limit": 100 } // judgments + links targeting one claim
{ "kinds": [30054], "#l": ["misleading"], "limit": 100 }                // everything labeled `misleading`
{ "kinds": [30056, 30057, 30058], "#x": ["<article-hash>"], "limit": 100 } // every audit of this exact text
{ "kinds": [30057], "#t": ["monetary-policy"], "limit": 100 }           // aggregate audits on a beat
{ "kinds": [30059], "#a": ["30058:<pubkey>:<d>"], "limit": 50 }         // resolutions of one prediction
{ "kinds": [30061], "#a": ["30057:<pubkey>:<d>"], "limit": 50 }         // disputes targeting one audit
{ "kinds": [32126], "#d": ["twitter:jack"], "limit": 50 }               // who captured @jack + whom they say @jack is
{ "kinds": [32126], "#p": ["<derived-account-pubkey>"], "limit": 50 }   // same rendezvous, by derived pubkey
{ "kinds": [30067], "authors": ["<entity-pubkey>"], "limit": 10 }       // an entity's fact sheet(s), one per archive
{ "kinds": [30040, 30067], "#x": ["<article-hash>"], "limit": 100 }     // claims + fact sheets citing this exact text
{ "kinds": [30023, 30040, 32126, 30054, 30062, 30064, 1985], "#p": ["<equivalence-pubkeys…>"], "limit": 300 } // entity feed, hop 1 (a reader's equivalence set)
```

A client wishing to display helpfulness aggregates for a set of metadata events SHOULD then issue a follow-up `#a` query against kind 9803 keyed by the addressable coordinates of those events.

## Privacy and trust

This NIP makes events public by default. Clients MUST clearly indicate at publish time that an event will be visible to anyone with relay access. Encrypted variants (where defined, as in TopicTrust) MUST be opt-in.

Reading metadata is private — relay queries do not authenticate the reader — provided the relay is not under [NIP-42](42.md) authentication. Clients SHOULD avoid using NIP-42-authenticated relays for metadata read queries unless the user has explicitly enabled such a relay.

Relay-supplied events are untrusted input. Clients MUST verify each incoming event — the id equals the hash of the serialized event, and the BIP-340 signature binds that id to its `pubkey` — before rendering, storing, or acting on it. The reference implementation enforces this at its single relay-read choke point.

Publishing kind 32126 discloses the author's captured-account → entity link graph. Clients MUST keep that publish path opt-in and state what it reveals at enable time.

This NIP does not specify a ranking algorithm. Recommended approaches:

- **First-order trust** — show events from authors in the user's [NIP-02](02.md) contact list and/or the user's TopicTrust list, hide others by default.
- **Bridging-based ranking** — for clients with the compute budget or a [NIP-85](85.md) trusted-assertion provider, rank events by a Birdwatch-style matrix-factorization intercept term computed over (rater, event, helpfulness vote) triples. Notes that score helpful across diverse rater clusters surface higher than notes that score helpful within a single cluster.

## Reference implementations

- [x-ray browser extension](https://github.com/bryanmatthewsimonson/xray) — shipping kinds 30040 + 30050 + the `responds-to` and `x` extensions; 30054/30055 builders with publishing flag-gated (Phase 11); 30056–30059 fully implemented — builders, parsers, a flag-gated ordered publish path, and portal read surfaces (Phase 13); 30060/30061 builders + parsers implemented, publish paths deferred (the dossier stays derived; disputes are wire-format-only in v1); 30062 behavioral-finding builder + parser + the kind-1985 mirror and the `revision/*` 30055 values, publishing flag-gated (Phase 14); 30063/30064 adjudicated-verdict + integrity-finding builders + parsers and the 30063 kind-1985 mirror, publish paths behind `truthAdjudicationPublishing` (Phase 15; 30065 reserved; the adjudicate/integrity reader modals, the flag-gated publish path, and portal verdict render all ship); 32125 entity↔article relationships (builder + parser + portal read); 32126 platform-account records with the derived-pubkey rendezvous and the `linked-entity` pubkey tag, publishing behind `platformAccountPublishing`, plus verify-on-ingest enforced on every relay read (Knowledge Sharing KS.1–KS.4). The case-dossier surfaces (`docs/CASE_DOSSIER_DESIGN.md`, CD.1–CD.3) are derived / computed-on-read over these kinds — no new kind of their own.
- *(a second interoperating client is the natural next reference implementation.)*
