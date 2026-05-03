> **Status: TENTATIVE — authored in X-Ray on 2026-04-24.** Working spec for the Court of Public Opinion MVP. Expect revision as implementation surfaces edge cases.

# NIP — Court of Public Opinion

A NOSTR-native overlay for structured dispute resolution over online behavior. Defines three new event kinds:

| Kind  | Name             | Type                      | Purpose |
|-------|------------------|---------------------------|---------|
| 32150 | Code of Conduct  | Parameterized-replaceable | A user (or community) codifies behavioral rules they hold themselves and others to. |
| 32151 | Grievance        | Regular (immutable)       | A structured complaint that a specific post or person violated specific clauses. |
| 32152 | Verdict          | Regular (immutable)       | A self-published finding on a grievance. Aggregation is client-side, weighted by the viewer's web of trust. |

## Motivation

Online arguments today have no agreed-upon rulebook, no structured grievance mechanism, and no behavioral record. The loudest voice wins; truth and good faith are unrewarded. This NIP defines the primitives for a **decentralized court of public opinion**: users publicly codify the values they'll be held to, anyone can file grievances citing those codified values, and the community renders verdicts. No central authority decides which verdicts "count" — each viewer's kind 30382 trust graph filters the verdict signal they see.

## Relationship to existing kinds

- **Kind 30382 (Trust Declaration)** — drives verdict aggregation; no changes to the kind itself.
- **Kind 30386 (Reputation Score)** — optionally consumed when weighting verdicts.
- **Kind 30040 (Claim)**, **Kind 30043 (Archive)**, **Kind 30023 (Long-form)**, **Kind 1 (Note)** — any of these may be referenced as evidence or as a grievance target.
- **Kind 32141 (Dispute)** — spec'd in the [nostr-article-capture event schemas](https://github.com/bryanmatthewsimonson/nostr-article-capture/blob/main/projects/docs/nostr-event-schemas.md), not currently implemented in X-Ray. Disputes address *facts*; grievances address *behavior*. A grievance MAY reference a dispute; it is not required.

## Kind 32150 — Code of Conduct (Jurisdiction)

Parameterized-replaceable. A user publishes one or more codes under stable `d` identifiers; editing a code replaces prior versions at the same address.

### Tags

| Tag | Count | Format | Description |
|---|---|---|---|
| `d` | 1 (required) | string | Stable code id (e.g. `personal-v1`, `rationalist-core`, `fb-community-rules`). Lowercase kebab-case. |
| `title` | 1 (required) | string | Human-readable name. |
| `description` | 0–1 | string | One-paragraph summary of what the code is for. |
| `version` | 0–1 | string | Free-form version label (e.g. `1.0.0`, `2026-04`). |
| `clause` | 0+ | `[clause-id, name, description, severity]` | A single behavioral rule. `severity` ∈ {`info`, `violation`, `serious`}. `clause-id` MUST be unique within the code and across inherited parents after resolution. |
| `extends` | 0+ | `[<naddr of parent kind 32150>]` | This code inherits clauses from the parent. Clause-id collisions are resolved child-wins. Cycles MUST be rejected by clients. |
| `derived-from-question` | 0+ | `[question-id, clause-id]` | Forward-compat for the Phase 2 trade-off questionnaire. Clients MAY ignore in MVP. |
| `t` | 0+ | topic tag | Free-form topic tags (e.g. `discourse`, `epistemics`). |

### `content`

Free-form preamble/manifesto. Clients SHOULD render this above the clause list. May be empty.

### Example

```json
{
  "kind": 32150,
  "pubkey": "<author-pk>",
  "created_at": 1714000000,
  "tags": [
    ["d", "personal-v1"],
    ["title", "My Personal Code"],
    ["description", "How I argue, and what I expect from others."],
    ["version", "1.0.0"],
    ["clause", "no-ad-hominem", "No ad hominem", "Attack the argument, not the arguer.", "violation"],
    ["clause", "strongest-point", "Respond to the strongest point", "If you respond at all, respond to the most charitable interpretation of the opposing view.", "violation"],
    ["clause", "cite-evidence", "Cite evidence for factual claims", "Unsupported factual claims on contested matters are a violation.", "violation"],
    ["clause", "no-chilling", "No chilling tactics", "Threats, mob-summoning, or doxxing to silence speech are serious violations.", "serious"],
    ["t", "discourse"]
  ],
  "content": "I believe free speech is a sacred principle for keeping tyranny at bay. I hold myself to these rules and will entertain grievances that cite them."
}
```

### Discovery

Clients SHOULD let users:
- Publish their own code(s).
- Browse codes authored by people they follow or trust (kind 30382).
- Reference any code by its `naddr` when filing a grievance.

## Kind 32151 — Grievance

Regular, immutable. A structured complaint. Every grievance MUST identify a target, a respondent, at least one jurisdiction, and at least one cited clause.

### Tags

| Tag | Count | Format | Description |
|---|---|---|---|
| `p` | 1+ (required) | `[<respondent-pk>]` | The pubkey(s) being accused. Usually 1. |
| `e` or `a` or `r` | 1+ (required) | standard | Target of the grievance. `e` for a NOSTR event id, `a` for an addressable event, `r` for a raw URL (e.g. a Facebook post URL). |
| `jurisdiction` | 1+ (required) | `[<naddr of kind 32150>]` | Which Code(s) of Conduct the filer claims apply. |
| `cite` | 1+ (required) | `[<jurisdiction-naddr>, <clause-id>, <reason-text>]` | Specific clause(s) alleged to have been violated, with a reason. The `jurisdiction-naddr` MUST match one of the `jurisdiction` tags. The `clause-id` MUST resolve within that code (incl. inherited). |
| `claim` | 0–1 | `[<claim-text>]` | Free-text summary of the alleged behavior. If omitted, the `content` field serves as the claim. |
| `evidence` | 0+ | `[<evidence-type>, <ref>, <note?>]` | Supporting material. `evidence-type` ∈ {`url`, `event`, `archive`, `claim`}. `ref` is a URL (for `url`), an event id (for `event`, which may be a kind 30043 `archive` or kind 30040 `claim`, or any other), or an `naddr`. |
| `burden` | 0–1 | `[preponderance \| clear-convincing \| beyond-reasonable]` | Burden of proof the filer is asserting. Default: `preponderance`. Matches `docs/plans/evidentiary-standards.md` §6. |
| `state` | 0–1 | `[filed]` | Always `filed` for kind 32151. State advancement (acknowledged, rebutted, appealed) is represented by separate kind 32151 follow-up events that `e`-reference the original grievance, or by out-of-band UX. |
| `t` | 0+ | topic tag | Free-form topics (optional). |

### `content`

The grievance narrative. SHOULD be 1–3 paragraphs. Clients render alongside the structured tags.

### Validation (client-side)

On receipt, clients SHOULD:

1. Resolve each `jurisdiction` tag to a kind 32150 event (possibly via relay query). If unresolvable, the grievance is displayed with a warning.
2. Confirm each `cite` references a valid clause-id within the resolved jurisdiction (including `extends` inheritance).
3. Confirm the respondent (`p`) differs from the filer (`pubkey`).
4. Reject `cite` tags whose `jurisdiction-naddr` is not listed in `jurisdiction` tags.

### Example

```json
{
  "kind": 32151,
  "pubkey": "<filer-pk>",
  "created_at": 1714000100,
  "tags": [
    ["p", "<respondent-pk>"],
    ["r", "https://facebook.com/somebody/posts/12345"],
    ["jurisdiction", "30150:<author-pk>:personal-v1"],
    ["cite", "30150:<author-pk>:personal-v1", "no-ad-hominem", "Called me a fascist instead of responding to the substantive point about free speech."],
    ["cite", "30150:<author-pk>:personal-v1", "strongest-point", "Ignored my best argument and attacked a weaker one."],
    ["evidence", "url", "https://facebook.com/somebody/posts/12345?comment_id=67890", "The specific comment."],
    ["burden", "preponderance"],
    ["state", "filed"]
  ],
  "content": "The respondent replied to my post on free speech by name-calling instead of engaging with the argument..."
}
```

## Kind 32152 — Verdict

Regular, immutable. Anyone can publish a verdict on any grievance. Aggregation is always client-side.

### Tags

| Tag | Count | Format | Description |
|---|---|---|---|
| `e` | 1 (required) | `[<grievance-event-id>]` | The grievance being ruled on. |
| `p` | 0–1 | `[<respondent-pk>]` | The accused (copied from the grievance for convenience). |
| `finding` | 1+ (required) | `[<jurisdiction-naddr>, <clause-id>, <ruling>, <rationale>]` | Per-clause finding. `ruling` ∈ {`upheld`, `dismissed`, `mitigated`, `partial`, `abstain`}. One finding per cited clause; additional clauses MAY be added if the verdict author believes other clauses apply. |
| `overall` | 0–1 | `[<ruling>]` | Optional summary ruling across all clauses. |
| `sanction-recommendation` | 0+ | `[<type>, <severity>, <note?>]` | Advisory only. `type` is a free string (e.g. `warning`, `credibility-mark`, `blocklist`). Clients MUST NOT auto-enforce; they MAY surface recommendations when aggregate WoT support is high. |
| `t` | 0+ | topic tag | Free-form. |

### `content`

Narrative rationale. SHOULD explain the reasoning; verdicts without narrative SHOULD be weighted less.

### Example

```json
{
  "kind": 32152,
  "pubkey": "<verdict-author-pk>",
  "created_at": 1714000500,
  "tags": [
    ["e", "<grievance-event-id>"],
    ["p", "<respondent-pk>"],
    ["finding", "30150:<author-pk>:personal-v1", "no-ad-hominem", "upheld", "The respondent's reply contains 'fascist' directed at the filer, not at the argument."],
    ["finding", "30150:<author-pk>:personal-v1", "strongest-point", "partial", "Respondent engaged with part of the argument but skipped the strongest claim."],
    ["overall", "upheld"]
  ],
  "content": "I reviewed the linked post and comment. The ad-hominem is clear..."
}
```

## Verdict aggregation algorithm (reference)

Given:
- A grievance `G` with cited clauses `C = { c₁, c₂, … }`.
- All kind 32152 verdicts `V = { v₁, v₂, … }` that `e`-reference `G`.
- The viewer's trust graph `T`: a function `T(pk) → weight ∈ [0, 1]` derived from the viewer's kind 30382 trust declarations, optionally propagated 1–N hops and modulated by kind 30386 reputation scores.

For each cited clause `c ∈ C`:

1. Let `Fᵥ(c)` = the `finding.ruling` tag in verdict `v` for clause `c`, or `abstain` if absent.
2. Let `wᵥ` = `T(v.pubkey)` if the viewer trusts the verdict author; else 0.
3. Weighted counts per ruling:
   - `upheld_score(c)   = Σ wᵥ × hasNarrative(v) for v where Fᵥ(c) = upheld`
   - `dismissed_score(c) = Σ wᵥ × hasNarrative(v) for v where Fᵥ(c) = dismissed`
   - (similarly for `mitigated`, `partial`)
4. `hasNarrative(v)` is 1.0 if `v.content` is non-trivial (≥ 20 chars), else 0.5. Rationale weighting prevents drive-by verdicts from dominating.
5. Aggregate ruling:
   - If `max(scores) == 0`: `insufficient-signal` (no trusted verdicts).
   - Else the ruling with the highest score, with a confidence = `max_score / total_score`.
6. Return `{ clause-id, aggregate-ruling, confidence, trusted-verdict-count, total-verdict-count }`.

Clients MAY expose tuning knobs:
- Trust-graph hop depth (default: 2).
- Minimum trust weight to count a verdict (default: 0.3).
- Whether to include kind 30386 reputation as a multiplier.

This algorithm is the load-bearing logic — implementations MUST be pure functions of (grievance-id, verdicts, trust-graph) for testability.

## Privacy considerations

- Grievances and verdicts are **public, immutable, cryptographically signed** statements. Filers and verdict authors are accepting the reputational consequences of being wrong or bad-faith.
- Respondent pubkeys are included so clients can surface grievances on the respondent's profile. Grievances against **non-NOSTR** actors (identified only by URL) don't notify the respondent at all; they are purely community record.
- Codes of Conduct are public; subscribing via `extends` is public. Use an alt identity if a code's political implications are sensitive.
- Nothing in this NIP relies on deletion (kind 5). Clients MAY hide events from muted/blocked authors, but the events themselves persist on relays.

## Abuse vectors and mitigations

| Vector | Mitigation |
|---|---|
| **Grievance spam / harassment** — flooding a target with bad-faith grievances. | Client-side: WoT filter — view only grievances from trusted filers. Kind 30382 `distrust`/`block` on the filer suppresses their grievances. |
| **Verdict brigading** — coordinated group publishes many verdicts. | Aggregation is WoT-weighted per *viewer*; raw counts don't dominate. Narrative-quality multiplier penalizes drive-bys. |
| **Strategic code authorship** — framing values to make any dissent a "violation". | Code authorship is public and forkable. Readers evaluate the code itself; bad codes don't attract verdicts from high-trust authors. |
| **Respondent cannot defend** — accused is off-NOSTR or unaware. | Respondent MAY publish a rebuttal as a standard kind 1 note referencing the grievance `e`-tag; clients render rebuttals in the grievance thread. Phase 2 may add a formal kind 32153 Rebuttal. |
| **Circular clause inheritance** — `extends` cycles. | Clients MUST detect cycles during resolution and refuse to render the offending code. |

## Open questions (pre-implementation)

1. **`naddr` vs `a` tag** — should `jurisdiction` tags use full `naddr` strings or the canonical `kind:pubkey:d` form? The `a`-tag form is more parseable on relays; the `naddr` form is more portable. **Current spec uses `a`-tag form (`30150:pubkey:d`)** for relay compatibility; UI MAY render `naddr` for sharing.
2. **Should verdicts be parameterized-replaceable** so an author can refine their ruling? Decision: **no for MVP.** Immutable verdicts make the record trustworthy; authors publish a *new* verdict and clients can surface the most recent from the same author.
3. **Filer identity requirements** — require a kind 0 profile? A minimum age? **MVP: no requirement.** WoT filtering handles this downstream.
4. **Cross-jurisdiction rulings** — may a verdict cite a clause from a code the grievance didn't list? **Yes**, per spec — but clients SHOULD surface this as an "extended finding" separately from direct responses to cited clauses.

## Phase 2 hooks (NOT required for MVP)

- **Kind 32153 — Rebuttal** (by respondent).
- **Kind 32154 — Trade-off Question Response** (belief-modeller input).
- **Kind 32155 — Sanction** (applied, not recommended — gated behind WoT aggregate).
- **Appeal flow** — grievance → verdict → appeal verdict, as chained immutable events.

## Implementation checklist (MVP)

- [ ] `event-builder.js`: `buildCodeOfConductEvent`, `buildGrievanceEvent`, `buildVerdictEvent`.
- [ ] `jurisdiction-model.js`: clause CRUD, inheritance resolution with cycle detection.
- [ ] `grievance-model.js`: target/jurisdiction/cite validation.
- [ ] `verdict-aggregator.js`: pure, well-tested, matches the aggregation algorithm above.
- [ ] Options page: Code of Conduct editor.
- [ ] Side panel: file grievance, grievance detail view with WoT aggregate.
- [ ] Content scripts: `⚖️` injection on Facebook + Twitter posts/profiles.
- [ ] Popup: court summary on known profile pages.
- [ ] Tests: event-builder validation, jurisdiction inheritance (incl. cycle rejection), aggregator fixtures.

---

*This spec is TENTATIVE as of 2026-04-24 and will be revised during implementation. Update this file when you discover an edge case the spec doesn't cover — don't leave the code and the spec out of sync.*
