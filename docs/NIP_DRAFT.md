NIP-XX
======

Web Content Annotations, Fact-Checks, and Topic Trust
-----------------------------------------------------

`draft` `optional`

This NIP defines five event kinds and one tag extension that together let users publish structured, anchored metadata about web content — annotations, fact-checks, ratings, topic-scoped trust assertions, and helpfulness votes — and lets readers query, rank, and surface that metadata in context.

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
2. `RangeSelector` — `{ startContainer, startOffset, endContainer, endOffset }` with XPath. Faster on long documents but brittle to DOM restructuring.
3. `CssSelector` — useful when the page has stable element ids/classes (e.g., paragraph ids on Substack).
4. `FragmentSelector` — for media fragments only: `xywh=...` for images, `t=Ns` for time offsets in audio/video.

Authors SHOULD include multiple selectors. Consumers SHOULD try them in order and treat the first match with confidence ≥ 0.7 as the resolution. Annotations whose selectors do not resolve on the current page are NOT discarded; they are surfaced as page-level annotations with a "could not be located" indicator.

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

## Querying

A client wishing to display all metadata for a URL SHOULD issue these filters in parallel and merge the results:

```jsonc
[
  { "kinds": [30050, 30051, 30052], "#r": ["<url>"], "limit": 200 },
  { "kinds": [9802], "#r": ["<url>"], "limit": 100 },
  { "kinds": [1111], "#i": ["<url>"], "limit": 200 },
  { "kinds": [1985], "#r": ["<url>"], "limit": 100 },
  { "kinds": [17], "#i": ["<url>"], "limit": 200 },
  { "kinds": [1984], "#r": ["<url>"], "limit": 50 },
  { "kinds": [30023], "#r": ["<url>"], "limit": 50 }
]
```

The kind 30023 query catches articles published with `responds-to`; clients filter client-side to those with a matching `responds-to` tag.

A client wishing to display helpfulness aggregates for a set of metadata events SHOULD then issue a follow-up `#a` query against kind 9803 keyed by the addressable coordinates of those events.

## Privacy and trust

This NIP makes events public by default. Clients MUST clearly indicate at publish time that an event will be visible to anyone with relay access. Encrypted variants (where defined, as in TopicTrust) MUST be opt-in.

Reading metadata is private — relay queries do not authenticate the reader — provided the relay is not under [NIP-42](42.md) authentication. Clients SHOULD avoid using NIP-42-authenticated relays for metadata read queries unless the user has explicitly enabled such a relay.

This NIP does not specify a ranking algorithm. Recommended approaches:

- **First-order trust** — show events from authors in the user's [NIP-02](02.md) contact list and/or the user's TopicTrust list, hide others by default.
- **Bridging-based ranking** — for clients with the compute budget or a [NIP-85](85.md) trusted-assertion provider, rank events by a Birdwatch-style matrix-factorization intercept term computed over (rater, event, helpfulness vote) triples. Notes that score helpful across diverse rater clusters surface higher than notes that score helpful within a single cluster.

## Reference implementations

- [x-ray browser extension](https://github.com/bryanmatthewsimonson/xray) — Phase 9, currently shipping kinds 30050 + the `responds-to` extension; remaining kinds scaffolded.
- *(second client, TBD pre-merge)*
