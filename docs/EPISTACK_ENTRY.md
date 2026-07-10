# FLF Epistack competition — entry plan + writeup skeleton

> **Status:** plan of record (2026-07-08). Target: FLF's epistemic case
> study competition ("Lab Leaks, Black Holes, and Eggs"), **entries due
> 2026-07-19** via the submission form linked from
> [`docs/epistack/COMPETITION.md`](epistack/COMPETITION.md). This doc is
> both the internal submission plan and the skeleton of the writeup —
> §5 is the part that becomes the entry; `TBD` markers are filled from
> the capture runs.
>
> The competition documents in [`docs/epistack/`](epistack/) are
> reproduced verbatim from FLF and **govern** every competition fact
> below. Development itself stays maintainer-driven from the live case
> runs — this document plans the *submission*, never the tool.
> Operational steps live in [`EPISTACK_RUNBOOK.md`](EPISTACK_RUNBOOK.md);
> the bounded second case in
> [`EPISTACK_EGGS_WORKSHEET.md`](EPISTACK_EGGS_WORKSHEET.md).

## 1. The competition

- **Who:** Future of Life Foundation. Frame: Sourbut & Goldhaber,
  *A Full Epistemic Stack* — layered infrastructure for ingestion →
  structure → assessment, treating as much of the stack as possible as
  a knowledge commons ([`epistack/VISION.md`](epistack/VISION.md)).
- **What they want:** AI-assisted workflows that structure messy
  evidence into navigable, **reusable, refineable artifacts** that
  compound across investigators — demonstrated against three cases:
  COVID-19 origins, LHC black-hole risk, health effects of eggs
  ([`epistack/COMPETITION.md`](epistack/COMPETITION.md)).
- **Shapes:** a spec, a prototype tool, or a protocol — combinations
  explicitly allowed ("a submission … may combine these"). A spec
  demonstrates on parts of **at least two** cases; a prototype "in a
  repeatable way on each." Written body **≤10 pages** (appendices and
  worked examples excluded, but navigable, with curated pointers); code
  either brief legible (pseudo)code or well-documented and close to
  one-click-runnable.
- **Judging:** seven dimensions — epistemic uplift, generalizability,
  compounding/shareability, scalability, methodological transparency,
  adversarial robustness, insight contribution
  ([`epistack/JUDGING_CRITERIA.md`](epistack/JUDGING_CRITERIA.md)).
  Judges are told to check "what off-the-shelf deep research or a
  careful Claude Code investigation produces on the same sub-question"
  before scoring, and to **run submissions, not just read them**.
- **Prizes:** ~$200k pool; $5k–$50k per entry; continuation funding
  likely for strong entries. **Deadline: 2026-07-19.**

## 2. Thesis

X-Ray is a **working, shipped implementation of the substrate layers of
the epistemic stack** — not a notebook, not a mockup. Every capture is
content-addressed (SHA-256 `x` tag), signed, timestamped, and published
to **open public relays** in a documented wire format
(`docs/NIP_DRAFT.md`), so the claim/evidence graph any investigation
produces is **reusable and refineable by anyone, without our permission
or our server**. The entry's artifact is not a file we hand over — it
is the **live corpus on NOSTR relays**, consumable from any client or a
few lines of WebSocket code. One-off pipelines cannot retrofit that
property.

We enter as a **combination submission — prototype tool + protocol**
(entered under the rules' explicit combination allowance): the
extension (ingestion + provenance + structuring + per-source
assessment) and the wire format it publishes, demonstrated in depth on
COVID-19 origins and in bounded form on eggs. We do not claim the top
of the stack (question-level adjudication) as the product — see §4.

## 3. Layer mapping (X-Ray ↔ the epistemic stack)

As shipped on `main` (to be pinned to the **v0.7.0** tag before the
corpus publish — see the runbook). In the final entry this inventory
ships as an appendix; the body carries the spec, not the feature list.

| Epistack layer | X-Ray, shipped today |
|---|---|
| Info gathering | Capture pipeline: articles (Readability→Markdown), Substack incl. paywall reconstruction, YouTube + transcripts, Twitter/X threads, FB/IG/TikTok via GraphQL interception; **PDFs** (pdf.js text-layer reconstruction with page-anchored claims, figures extracted as content-addressed images, Google-Drive routing); screenshot + HTML-snapshot evidence hashes |
| Provenance | Signed NOSTR events, **BIP-340-verified on every read-back** (verify-on-ingest); canonical article hash (`x` tag) content-addresses every audit/claim to the exact text; **grounded suggestion anchors** — an LLM-proposed quote is only a search key; the stored anchor is rebuilt from the article's own characters or rejected; time-series `d` schemes — nothing overwrites, supersession is explicit |
| Structuring | Thin claims (kind `30040`, entity-queryable, verbatim quote + W3C selector), claim relationships `30055` (contradicts/supports/updates), cross-platform identity layer (who says this, where else, under what name — a query, not a spreadsheet) |
| Assessment | Assessments `30054` (stance, firewalled from quality audits); eight-module epistemic auditor `30056`–`30061`: verbatim-evidence requirement, score+confidence always paired, knowability ceiling, prediction ledger with resolution events; truth adjudication `30063`/`30064` (per-proposition descriptive verdicts on declared standards, append-only chains, words-vs-deeds integrity findings); `PHILOSOPHY.md` as the normative constitution |
| Sharing format | Open NIP draft documenting the kind vocabulary (a pre-publish refresh so every kind under the submission npub resolves in the draft is a runbook step), decentralized public relays — replayable by any consumer, no server of ours involved |
| End applications | Portal: case dashboards, audit dossiers, entity graphs, predictions-due strip, relay reconciliation |
| AI-assist | `xray:llm:suggest` (entity/claim extraction, grounded + human-review gated) and `xray:audit:run` (quick/thorough audit modes), double consent-gated |

## 4. Case scope, and honest gaps

**Case scope:** **COVID-19 origins is primary** — the live capture run:
the Rootclaim debate record (ACX writeup, both judges' decisions as
PDFs, Rootclaim's response, Weissman's Bayesian analysis, the debate
videos), captured, claim-atomized, audited, contradiction-linked, with
flag-gated per-proposition verdicts. **Eggs is the bounded second
case** — 8–10 sources
([`EPISTACK_EGGS_WORKSHEET.md`](EPISTACK_EGGS_WORKSHEET.md))
demonstrating the same pipeline on a different evidence shape with no
per-case code. **LHC: pass**, stated as a reasoned tradeoff: the
combination shape is entered under the rules' "may combine these"
allowance with the two deepest-value cases demonstrated — COVID (the
curated-debate shape) and eggs (the mundane-but-contested shape) —
while LHC's uncontested, preprint-shaped record is the least
differentiating fit for a capture-provenance substrate. That leaves
the rubric's "confident answer w/ complex evidence" shape undemonstrated
— an acknowledged gap, and an optional one-hour gesture (2–3 LHC
sources through the identical pipeline) if ahead of schedule.

The gaps, stated the way the writeup will state them:

1. **No question-level aggregation — by design, not omission.** The
   COVID record's defining fact is that six independent Bayesian
   analyses of the same evidence span 23 orders of magnitude. X-Ray
   deliberately does not average, weight, or roll up: verdicts on one
   proposition render **side by side, never merged**, each on its
   declared standard of proof, and the honest headline is the
   *distribution*. This is the late-binding-assessment position FLF's
   own vision document argues for. **We ship the early half of that
   position**: durable structure + provenance. The per-reader binding
   instruments (trust-list filtering, weighting) are sketched in the
   NIP draft's ranking notes and deliberately unbuilt.
2. **X-Ray's outputs are graded, not calibrated.** Verdicts are
   judgments on declared standards; audit scores carry paired
   confidence and a knowability ceiling. Nothing has been
   calibration-tested, so the writeup never uses that word for itself —
   the prediction ledger (`30058`/`30059` resolution loop) is the
   mechanism that could eventually *earn* it.
3. **Open relays accept anyone's events — including junk.** An
   adversary with free keypairs can publish noise audits or verdicts
   against our coordinates, and side-by-side rendering will show them.
   Today's defense is author-scoped views (the portal loads a chosen
   npub) plus signature accountability; the general defense
   (first-order trust lists, ranking) is specified in the NIP draft and
   unimplemented. Bounded and named, not hidden.
4. **Scanned PDFs are refused, on principle.** Claims anchor to
   verbatim characters of a deterministic text layer; OCR output can't
   provide that guarantee, so image-only PDFs are refused with a
   pointer to the archived original bytes rather than silently
   transcribed (LLM-assisted transcription is designed, deliberately
   unbuilt).
5. **YouTube transcript capture is fragile** (platform-gated APIs,
   selector drift). Named plainly, with the fallback ladder documented
   in the runbook's Contingencies section.
6. **Audits are per-document; relations are pairwise.** Cross-document
   structure comes from `30055` edges and the identity layer, not from
   an argument-map roll-up.
7. **Cross-investigator pick-up is read-only today.** Anyone can query
   the corpus, verify it, adopt its entities, and publish disagreeing
   events beside ours (the second-investigator walkthrough, §5.4,
   demonstrates exactly this with shipped features); a follow/
   incorporation engine is designed but unbuilt.
8. **Ingestion is the layer that does not scale hands-free today** —
   one human, one browser, per source. At 20–40 sources that is a
   deliberate provenance choice; it is also, plainly, the scalability
   bottleneck. Assessment, re-audit, and scrutiny scale with compute
   and contributors, and the relay substrate already ingests corpora
   captured by other X-Ray users — the designed path outward.

## 5. Submission writeup — skeleton

> Everything below becomes the entry document. `TBD` markers are
> filled during the case-study runs. Body budget (≤10 pages): problem
> + approach ≤2.5pp; what-judges-receive ≤1.5pp; what the corpus
> surfaced ~2pp; eggs demonstration ~1pp; compounding + walkthrough
> ~1pp; limitations + rubric map ≤1.5pp. The §3 layer inventory, the
> full kind index, worked examples, and the baseline comparison go to
> appendices with curated pointers into the corpus.

### 5.1 Problem statement

Serious investigations die in PDFs and threads: the reasoning is not
inspectable, the evidence links rot, and the next investigator starts
from zero. The missing piece is not another analysis but a **substrate**
on which analyses compound: content-addressed sources, atomized claims,
typed relations, and assessments that carry their own confidence and
uncertainty markers and their own accountability anchor.

### 5.2 Approach

- Capture the corpus with X-Ray (browser extension, MV3): each source
  becomes a signed kind-`30023` event whose body is content-addressed
  (SHA-256 `x` tag). PDFs (court-filing-shaped judge decisions, papers)
  are reconstructed from their deterministic text layer with
  page-anchored provenance and archived original bytes; paywalled and
  ephemeral sources get snapshot + screenshot evidence hashes.
- Atomize claims (`30040`) with LLM-suggest + human review — every
  accepted anchor is rebuilt from the article's own characters, so a
  claim can never carry text its source lacks; link
  contradictions/support/revisions (`30055`); resolve authors and
  outlets through the identity layer.
- Run the eight-module epistemic audit per source. Every finding
  carries a verbatim quote; every score carries a confidence;
  aggregates are capped by a knowability ceiling; sub-0.6-confidence
  renders "needs human review", never a number. Predictions are banked
  in a ledger (`30058`) for later resolution (`30059`).
- Where a proposition is adjudicable, record descriptive verdicts
  (`30063`) on declared standards with mandatory caveats — append-only
  chains, side-by-side disagreement, never a merge.
- Publish the whole graph to public relays as an ordered batch with a
  per-event ledger. The artifact is not a report *about* the corpus; it
  **is** the corpus, structured, live, and replayable.

### 5.3 What the judges receive

- **The live graph on public NOSTR relays.** The publishing identity in
  both encodings — npub (bech32, for clients): `TBD`; hex pubkey (for
  filters): `TBD` — the relay list (`TBD`), a kind-by-kind index with
  counts (`TBD` after the run), and a curated permalink (njump.me /
  nostr.band view of the npub: `TBD`). Raw signed events are fetchable
  from any NOSTR client; long-form articles render in long-form clients
  (njump, habla); the structured graph renders in the portal. Or fetch
  by hand:

  ```js
  const ws = new WebSocket('wss://<relay>');
  ws.onopen = () => ws.send(JSON.stringify(['REQ', 'xray', {
      authors: ['<pubkey-hex>'],   // 64-char hex — NOT the npub1… form
      kinds: [30023],              // one kind per query for exact counts
      limit: 500,                  // relays cap results per filter
  }]));
  ws.onmessage = (m) => console.log(m.data);
  ```

  Runs in a browser console opened on a CSP-permissive page — open
  `example.com` or `about:blank` in a new tab first; most sites' CSP
  blocks third-party WebSockets. Repeat per kind (`30040`, `30054`,
  `30055`, `30056`, `30057`, `30058`, `30062`, `30063`, …) to match the
  published index. Kind semantics: `docs/NIP_DRAFT.md` (refreshed
  pre-publish so every kind under the npub resolves — runbook §4).
- **The tool itself**, close to one click: clone → `npm install &&
  npm run build` → `chrome://extensions` → Load unpacked (repo root) →
  right-click any page → X-Ray → **Open My Archive** → paste the npub
  into the read-only viewer box → load from relays. **Viewing requires
  no flags, no API key, and no account.** (Chrome recommended; Firefox
  ≥128 works.) Walkthrough: case dashboard, audit dossiers,
  contradiction edges, predictions-due strip, per-event raw inspector.
  (Portal screens/screencast: `TBD`.)
- **The governing documents**: this writeup, `docs/PHILOSOPHY.md` (the
  normative scoring/display constitution — the firewall between
  quality-audit and stance, the never-average rule, the honest-display
  rules) and `docs/NIP_DRAFT.md` (the wire format).
- **Per-case effort/cost table** (sources, browser-hours, LLM calls) —
  the "what does case #4 cost" number: `TBD` from the two runs.

### 5.4 What the corpus surfaced

> The body's center of gravity, and the rubric's anchor criterion:
> 3–5 concrete findings about the COVID record (and one from eggs),
> each formatted **claim → event id/permalink → why the same
> sub-question run through off-the-shelf deep research misses it**
> (a crux made queryable; a rhetorical-vs-evidential move pinned to a
> verbatim quote; correlated sourcing collapsed by convergence
> grouping; a banked prediction with a resolution horizon). Includes a
> 3–6 line summary of the baseline comparison, honest in both
> directions; the full side-by-side (portal-rendered treatment vs the
> deep-research report on the same sub-question) is an appendix.
> Content: `TBD` — filled from the run; nothing here is written before
> the corpus exists.

### 5.5 Why this compounds

Anyone can: re-run an audit against the same `x` hash and publish a
disagreeing `30056` (shown side-by-side, never averaged); attach new
`30055` edges to our claims; resolve our banked predictions; adopt our
entities and assess our claims from their own key; or build an
adjudication layer on top — the kinds are documented and the events are
already on public relays. **No single server is load-bearing**: events
are mirrored across independently operated relays, and because every
event is signed, anyone holding a copy can re-host the corpus intact
(relay-retention risk is real and named — see the runbook's probe). We
demonstrate pick-up concretely with a **second-investigator
walkthrough**: a fresh workspace under a second identity pulls the
published corpus from the relays (signature-verified on ingest), adopts
a foreign entity, and publishes a *disagreeing verdict — or, where the
adjudicate modal does not accept a foreign claim, a contrary
assessment*; either proves the property (same coordinate, different
author, side by side, never merged). Evidence: `TBD` — screenshots +
event ids.

### 5.6 Limitations (stated plainly)

The §4 list, compressed for the entry: per-document audit granularity;
pairwise relations without argument-map aggregation; question-level
verdicts are single-author and flag-gated (cross-author aggregation
deliberately unbuilt — late binding, with the binding instruments
themselves also unbuilt); no Sybil/flooding defense beyond
author-scoped views and signature accountability; LLM assistance is
Anthropic-only and consent-gated; scanned PDFs refused on provenance
principle; interactive capture bounds corpus size. Continuation pitch:
harden the adjudication layer in the wild and build the
follow/incorporation engine on this substrate.

### 5.7 Rubric coverage (dimension → where → how a judge checks)

| Dimension | Where demonstrated | How to check |
|---|---|---|
| Epistemic uplift | §5.4's findings, each with event ids; verbatim-anchored claims; audits with quoted findings + paired confidence | Follow a §5.4 finding to its events; walk a claim from verdict to archived bytes; read the baseline appendix |
| Generalizability | Same pipeline, zero per-case code, on COVID (PDF/video/blog-heavy) and eggs (journals/news); per-case cost table (§5.3) | The two corpora on the relays; `src/shared/platforms/` handler architecture |
| Compounding & shareability | Signed events on public relays in a documented format; second-investigator walkthrough | Query the corpus (snippet or client); repeat the walkthrough from any NOSTR key |
| Scalability | Audit modules parallelize; model roster upgrades slot in; more scrutiny = more auditors publishing side-by-side. Owned bottleneck: ingestion is interactive (§4.8) | Re-run an audit against the same `x` hash — requires your own Anthropic key + the `epistemicAuditing` flag; cost ≈ 1 call (quick) or 8 parallel calls (thorough) over the article body |
| Methodological transparency | `PHILOSOPHY.md` (versioned normative constitution), `NIP_DRAFT.md`, decision JOURNAL, this doc's §4 | Read them; every score carries confidence + module version on the wire |
| Adversarial robustness | BIP-340 verify-on-ingest; content addressing; stance/quality firewall; never-average; flooding named and bounded (§4.3) | Fetch an event via the snippet, flip one character, re-import it through the portal — verify-on-ingest rejects it (or run `node --test tests/nostr-verify.test.mjs`); recompute a `30023`'s `x` hash from its `content` and compare |
| Insight contribution | The competition's own case brief documents a 23-orders-of-magnitude spread among careful analysts — evidence that never-merge side-by-side is the honest form of judgment there; graded-vs-calibrated and the audit/stance firewall as reusable framings | Read §4 against `epistack/COMPETITION.md`'s COVID description |

## 6. Path to submission

The dated critical path, the relay probe, release, publish, and
walkthrough procedures live in
[`EPISTACK_RUNBOOK.md`](EPISTACK_RUNBOOK.md). Spine: capture run →
early relay probe → eggs pass → SMOKE §Phase 15 round trip → v0.7.0
tag → NIP-draft refresh + corpus publish → second-investigator
walkthrough → fill `TBD`s → submit by **2026-07-19**.

Open items (maintainer): the submission npub; final relay selection
(after the probe + round trip); submission-form access confirmed;
optional portal screencast; optional LHC gesture.
