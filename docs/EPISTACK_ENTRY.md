# FLF Epistack competition — entry plan + writeup draft

> **Status:** working draft (2026-07-02). Target: FLF's epistemic case
> study competition ("Lab Leaks, Black Holes, and Eggs"), **entries due
> 2026-07-19**. This doc is both the internal plan and the skeleton of
> the submission writeup — §5 is the part that becomes the entry.
>
> **Sourcing caveat:** competition details below were assembled from the
> announcement and its mirrors via search summaries (the drafting
> environment could not fetch flf.org directly). Before submitting,
> re-verify every fact in §1 against <https://flf.org/epistack-competition/>,
> the judging-criteria page it links, and the expression-of-interest form.

## 1. The competition (as understood)

- **Who:** Future of Life Foundation (FLF) — the incubator behind the
  "AI for Human Reasoning" fellowship. Intellectual frame: Sourbut &
  Goldhaber, *A Full Epistemic Stack* (Dec 2025) — layered infrastructure
  for **info gathering → structuring into claims and evidence →
  assessment → end applications**, glued by "a lightweight sharing
  format … a graph of claims and purported evidence, for improved
  further epistemic activity like auditing, hypothesis generation, and
  debate mapping."
- **What they want:** AI-assisted workflows that take a pile of messy,
  conflicting evidence, **structure the claims and arguments**
  ("capturing the relations between different sources, claims,
  authors"), and produce a **calibrated view of what to believe** —
  demonstrated on one or more of three cases: **COVID-19 origins**, the
  **pre-LHC black-hole-risk debate**, and the **health effects of
  eggs**. Analyses should become "reusable, refineable artifacts" so
  investigations compound. They are explicitly **open-minded on
  submission types** and "excited by any submission that advances the
  state-of-the-art on a component."
- **Prizes:** ~$200k pool; $5k–$50k per winning entry; continuation
  funding likely for strong entries (their estimate: 75% chance a $50k
  winner gets a funded-work offer).
- **Deadline:** 2026-07-19, via their submission form.

## 2. Thesis

X-Ray is a **working, shipped implementation of the substrate layers of
the epistemic stack** — not a notebook, not a mockup. Every capture is
content-addressed (SHA-256 `x` tag), signed, timestamped, and published
to open relays in a documented wire format (`docs/NIP_DRAFT.md`), so the
claim/evidence graph any investigation produces is **reusable and
refineable by anyone, without our permission or our server**. That is
the property the competition's "compounding knowledge bases" language is
asking for, and it is the property one-off pipelines cannot retrofit.

We enter as a **component submission**: the provenance + structuring +
per-source-assessment substrate, demonstrated end-to-end on a real case
corpus. We do not claim the top of the stack (question-level
adjudication) — see §4.

## 3. Layer mapping (X-Ray ↔ the epistemic stack)

| Epistack layer | X-Ray, shipped today (v0.6.0) |
|---|---|
| Info gathering | Capture pipeline: articles (Readability→Markdown), Substack incl. paywall reconstruction, YouTube + transcripts, Twitter/X threads, FB/IG/TikTok via GraphQL interception; screenshot + HTML-snapshot evidence hashes |
| Provenance | Signed NOSTR events; canonical article hash (`x` tag) content-addresses every audit/claim to the exact text; time-series `d` schemes — nothing overwrites, supersession is explicit |
| Structuring | Thin claims (kind `30040`, entity-queryable), claim relationships `30055` (contradicts/supports/updates), cross-platform identity layer (the source–claim–author relations the brief names) |
| Assessment | Assessments `30054` (stance, firewalled from audits); eight-module epistemic auditor `30056`–`30061`: verbatim-evidence requirement, score+confidence always paired, knowability ceiling, prediction ledger with resolution events; `PHILOSOPHY.md` as the normative constitution |
| Sharing format | Open NIP draft, fifteen+ documented kinds, decentralized relays — replayable by any consumer |
| End applications | Portal: case dashboards, audit dossiers, entity graphs, predictions-due strip |
| AI-assist | `xray:llm:suggest` (entity/claim extraction, human-review gated) and `xray:audit:run` (quick/thorough LLM audit modes), double consent-gated |

## 4. Honest gaps, and how the entry frames them

1. **Single-document vs question-level.** X-Ray audits a *document's*
   epistemic quality and structures claims *across* documents; it does
   not yet emit a calibrated verdict on a *question* ("did COVID come
   from a lab?"). That layer is designed (Phase 15, truth adjudication —
   `docs/TRUTH_ADJUDICATION_DESIGN.md`, kinds `30063`/`30064` reserved)
   but unbuilt. Framing: the substrate is the submission; adjudication
   is the funded-continuation pitch. **Optional stretch:** implement
   slice 15.1 (local adjudicable-proposition model, no wire kind) so the
   demo ends with per-proposition status, clearly labeled prototype.
2. **No argument-map aggregation.** `30055` edges are pairwise; there is
   no Bayesian/argumentative roll-up. Same framing as (1).
3. **Corpus scale.** Capture is interactive (a human with a browser per
   source). For a 20–40 source corpus that is a feature (human-in-the-
   loop provenance) — say so rather than apologize for it.

## 5. Submission writeup — skeleton

> Everything in this section becomes the entry document. `TBD` markers
> are filled during the case-study run (§6).

### 5.1 Problem statement

Serious investigations die in PDFs and threads: the reasoning is not
inspectable, the evidence links rot, and the next investigator starts
from zero. The missing piece is not another analysis but a **substrate**
on which analyses compound: content-addressed sources, atomized claims,
typed relations, and assessments that carry their own calibration and
their own accountability anchor.

### 5.2 Approach

- Capture the corpus with X-Ray (browser extension, MV3): each source
  becomes a signed kind-`30023` event whose body is content-addressed
  (SHA-256 `x` tag). Paywalled and ephemeral sources get snapshot +
  screenshot evidence hashes.
- Atomize claims (`30040`) with LLM-suggest + human review; link
  contradictions/support/revisions (`30055`); resolve authors and
  outlets through the identity layer so "who is saying this, where else,
  under what name" is a query, not a spreadsheet.
- Run the eight-module epistemic audit per source (headline-body
  fidelity, asymmetric language, number hygiene, source quality,
  internal coherence, definitional precision, omission, prediction
  extraction). Every finding carries a verbatim quote; every score
  carries a confidence; aggregates are capped by a knowability ceiling;
  sub-0.6-confidence renders "needs human review", never a number.
  Predictions are banked in a ledger (`30058`) for later resolution
  (`30059`) — the calibration loop is structural, not aspirational.
- Publish the whole graph to public relays as an ordered batch with a
  per-event ledger. The artifact is not a report *about* the corpus; it
  **is** the corpus, structured.

### 5.3 What the judges receive

- The published graph: relay URLs + the auditor npub + a kind-by-kind
  index (TBD after the run), queryable from any NOSTR client or five
  lines of websocket code.
- A portal walkthrough (screens or screencast): case dashboard, audit
  dossiers, contradiction edges, predictions-due strip. (TBD)
- This methodology writeup + the two governing documents:
  `docs/PHILOSOPHY.md` (normative scoring/display constitution — the
  firewall between quality-audit and stance, the never-average rule for
  disagreeing auditors, the honest-display rules) and
  `docs/NIP_DRAFT.md` (the wire format).
- Corpus stats and headline findings: TBD.

### 5.4 Why this compounds

Anyone can: re-run an audit against the same `x` hash and publish a
disagreeing `30056` (shown side-by-side, never averaged); attach new
`30055` edges to our claims; resolve our banked predictions; or build an
adjudication layer on top — the kinds are documented and the events are
already on public relays. Deleting our server does not delete the work,
because there is no server.

### 5.5 Limitations (stated plainly)

Single-document audit granularity; no question-level verdict yet (Phase
15 designed, unbuilt); pairwise relations without aggregation; LLM
audits are Anthropic-only and consent-gated; interactive capture bounds
corpus size. Continuation-funding pitch: build Phase 15 adjudication on
this substrate.

## 6. Case-study plan and timeline (17 days)

**Case choice — decide by 2026-07-04:**
- **Eggs (recommended primary):** article-shaped nutrition journalism +
  papers = X-Ray's easiest capture tier; rich in number-hygiene and
  headline-fidelity failures the auditor is built for; decades of
  flip-flops = good `30055` `updates`/`contradicts` structure.
- **COVID origins (stretch/secondary):** higher impact, and the only
  case that shows off the forensic behavioral layer (`30062`: asymmetric
  language, omission, narrative revision) — but heavier capture and
  higher political noise.
- LHC: pass (historical corpus is thin and mostly physics preprints —
  poor fit for the capture pipeline).

**Schedule:**
- 07-02 … 07-04 — submit expression-of-interest form; verify §1 facts on
  flf.org; freeze case choice and corpus list (20–40 sources).
- 07-05 … 07-09 — capture corpus; atomize + link claims; identity pass.
  (This doubles as the pending SMOKE_TEST §11–§13 walks.)
- 07-08 … 07-12 — audits (quick pass all sources; thorough on the ~10
  load-bearing ones); enable `epistemicAuditing`, publish batches.
- 07-10 … 07-14 — *(stretch, only if ahead of schedule)* Phase 15.1
  local proposition model for the demo's final screen.
- 07-13 … 07-16 — portal walkthrough capture; fill every TBD in §5;
  internal review against the judging criteria page.
- 07-17 … 07-19 — buffer; submit no later than 07-18.

**Open decisions:** case choice (above); whether to attempt 15.1; which
relays to publish to for the entry (durable, public, no auth).
