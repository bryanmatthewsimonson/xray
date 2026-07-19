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

- **The live graph on public NOSTR relays.** One publishing identity
  per corpus (each is its own workspace + signing key, so the corpora
  are independently fetchable and never interleave under one author):
  - **COVID-19 origins** — npub (bech32, for clients):
    `npub1dk487wer85fzc9ar0jdndxfsty4ygnn88h2qeseflgshgc8f27esamkdyr`;
    hex pubkey (for filters):
    `6daa7f3b233d122c17a37c9b369930592a444e673dd40cc329fa217460e957b3`;
    permalink: <https://njump.me/npub1dk487wer85fzc9ar0jdndxfsty4ygnn88h2qeseflgshgc8f27esamkdyr>.
  - **Eggs (health effects)** — npub:
    `npub1wj9cy7zyhz3jak3krztjqzkfugkk7n57dp3h32uzh6lxpcqw22kszd24dp`;
    hex pubkey:
    `748b827844b8a32eda361897200ac9e22d6f4e9e686378ab82bebe60e00e52ad`;
    permalink: <https://njump.me/npub1wj9cy7zyhz3jak3krztjqzkfugkk7n57dp3h32uzh6lxpcqw22kszd24dp>.

  Relay list (both corpora): `wss://relay.primal.net`,
  `wss://relay.nostr.net`, `wss://nos.lol`, `wss://nostr.mom`,
  `wss://nostr.oxtr.dev`, `wss://offchain.pub`.

  **Kind-by-kind index — eggs corpus** (published 2026-07-19, from the
  signed-event journal; 314 events total): kind `0` entity profiles
  ×112 · `30023` long-form source articles ×9 · `30040` atomized claims
  ×133 · `30055` claim relationships ×12 · `32125` entity↔article
  relations ×48. Each kind-0 is signed by its own HKDF-derived entity
  key (112 distinct entity pubkeys, all under the one corpus primary);
  everything else is signed by the corpus primary. **COVID corpus
  index:** `TBD` — recover from a full workspace backup's `xray-events`
  journal (Options → Advanced → Download backup, the `xray-backup/1`
  form, not the workspace-backup) or a live relay query.

  Raw signed events are fetchable from any NOSTR client; long-form
  articles render in long-form clients (njump, habla); the structured
  graph renders in the portal. Or fetch by hand:

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
  the "what does case #4 cost" number. **Eggs corpus** (measured):
  9 captured sources → 314 published events (9 articles, 133 claims,
  112 entity profiles, 48 entity↔article relations, 12 claim links).
  LLM calls: ≈9 per-source Suggest passes (entity/claim extraction,
  human-reviewed) + the corpus synthesis (8 map calls + 1 reduce; the
  reduce alone was ~23k input / ~10k output tokens on
  `claude-sonnet-5`, prompt `corpus-v3`); 8 of 9 members analyzed, 1
  failed, 24 brief quotes grounded / 1 dropped. Browser-hours: `TBD`
  (maintainer wall-clock). **COVID corpus:** `TBD` from its full
  backup. The point the table makes: a contested case reaches a
  navigable, signed, reusable graph for single-digit dollars of
  inference plus a bounded human review pass — no per-case code.

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
> Grounded from the case-brief export (`caseId
> entity_94bab542528cc322`; 147 sources; prompt `corpus-v3`). Every
> quote below is **verbatim** from a captured source and every `x=…`
> is the real canonical article hash carried in that export — a judge
> recomputes it from the published 30023's `content`. What is **not**
> yet real is the publish layer: the corpus is unpublished, so NOSTR
> event ids, njump permalinks, `«NPUB»`, and `«RELAY»` stay
> `«placeholder»` tokens that resolve in one pass after runbook §4/§6
> (logged, never guessed). Each "why deep research misses it" describes
> X-Ray's shipped mechanism, not any origin fact. Nothing here
> adjudicates the question (§10 red lines 1, 5).

**(a) A crux made queryable — Huanan-market clustering.** The export
carries the clustering dispute as a first-class crux — *"Does the
geographic clustering of early cases around the Huanan Seafood Market
constitute strong evidence for a market-origin spillover, or is it an
artifact of ascertainment/proximity detection bias?"* — with each side
anchored to a verbatim claim. The market reading: *"our analyses
indicate that the emergence of SARS-CoV-2 occurred via the live wildlife
trade in China, and show that the Huanan market was the epicenter of the
COVID-19 pandemic"* (`x=dddf539785b9add0…`). The collider objection:
*"The probable existence of major proximity detecIon bias should not be
taken to imply that there is no actual clustering of the unlinked cases.
It does mean that these data provide no reliable way of knowing if there
is."* (`x=f4cdfd6470eedb27…`). Rootclaim's quantified downgrade: *"The
HSM early cluster is therefore negligible as evidence. Our analysis
assigns it 2x."* (`x=90b872e151a04c93…`; the brief's side text: worth
"only ~2x rather than ~10,000x"). The crux ships its own resolver —
*"Independent, bias-free ascertainment of all early Wuhan pneumonia
cases … ideally with raw Chinese case data released."* Permalink
`«EVENT:clustering»`. *Why deep research misses it:* a strong run on
"did early cases cluster at the market?" reports the clustering and
presents it as the leading zoonosis datum; it does not make the
clustering's *evidentiary status* — the collider objection, the
2x-vs-10,000x weighting gap — the queryable object with "what would
resolve it" attached. X-Ray stores the hinge, not a settled bullet.

**(b) A rhetorical-vs-evidential move pinned to a verbatim quote —
"Proximal Origin."** The paper's genomic argument is captured as its own
claim: *"Our analyses clearly show that SARS-CoV-2 is not a laboratory
construct or a purposefully manipulated virus."* (`x=7400679218004bcc…`).
Separately, the export captures a move that engages none of that genomics
but attacks the paper's *provenance* — the House Select Subcommittee
majority's *“The Proximal Origin of SARS-CoV-2” Was “Prompted” by Dr.
Anthony Fauci to “Disprove” the Lab Leak Theory* (`x=59287ed60272fac7…`)
— and, beside it, the counter that the provenance claim is unfounded:
*"all authors interviewed by the Select Subcommittee confirmed that Drs.
Fauci and Collins did not lead, oversee, or influence the drafting of the
paper."* (`x=2850b921a9d450cf…`). Three coordinates, one structure;
permalink `«EVENT:proximal»`. *Why deep research misses it:* asked what
the paper argues, deep research summarizes the genomic case; asked
whether it was influenced, it summarizes the email controversy — in two
separate answers. It does not, in one artifact, *type the "prompted by
Fauci" move as an attack on how the paper came to exist rather than an
evidential rebuttal of its genomics,* and hold both plus the counter
adjacent. Neither side adjudicated (§10 red lines 1, 5).

**(c) Correlated sourcing collapsed by convergence grouping.** Identity
in X-Ray is the SHA-256 of normalized text, so one artifact recurs under
one `x=…` however many times or ways it is cited: the House majority
report backs both the provenance quote in (b) and the majority conclusion
in (5) under the single hash `x=59287ed60272fac7…`; the Democratic
minority report recurs under `x=2850b921a9d450cf…`. The corpus's source
list also holds the same underlying artifacts under multiple URLs — the
WSJ "intelligence on sick staff at Wuhan lab" report three ways (`amp`,
`world/china` canonical, and an `archive.is` snapshot) and each Rootclaim
debate-judge decision as a Google-Drive *view* URL and a *download* URL of
the same file. Grouping by `x=…` reads those as one line of evidence
apiece. *Bounded, stated plainly:* only byte-identical normalized captures
share a hash — the two Drive URL forms of one judge PDF do; a cross-host
`amp`-vs-`archive.is` pair may not — and a portal renderer that visually
folds same-hash captures into one node with URL aliases is **not yet
shipped**; today the guarantee is the shared hash on the signed event,
which any consumer can group on. *Why deep research misses it:* a
deep-research source list shows the WSJ story, its amp copy, the archive
mirror, and downstream pieces quoting it as separate line items that
*read as corroboration*; with no content-identity primitive it cannot say
"these are one artifact."

**(d) A banked prediction with a resolution horizon — shown on eggs, not
COVID.** This brief is retrospective and banks no clean dated, resolvable
prediction, so the capability is honestly better shown on the eggs corpus
(P11). The eggs worksheet pre-registers two falsifiable propositions to
bank as `30058` ledger entries — *"Dietary cholesterol raises serum
LDL-C"* (predicted `established-true`, preponderance) and *"Egg
consumption increases cardiovascular disease risk"* (predicted
`insufficient-evidence`/`contested`) — with the 2025 umbrella review as
the declared ceiling. Events `«EVENT:eggs-ldl»`/`«EVENT:eggs-cvd»`,
resolution horizon `«FILL:eggs-horizon — resolution criterion/date from
the eggs run, e.g. the next umbrella review or RCT»`. The two
propositions are verbatim in `EPISTACK_EGGS_WORKSHEET.md`. *Why deep
research misses it:* deep research answers "does dietary cholesterol raise
LDL-C?" well today, but cannot *bank a dated, falsifiable pre-registration
and hold itself to resolving it.* X-Ray writes the 30058 when the
prediction is made and a 30059 resolution against reality later,
computing calibration over time — the one axis where outsider and insider
hold identical information: time (`PHILOSOPHY.md` §5).

**(5) The distribution surfaced instead of merged.** On the same
evidence, the formal exercises the corpus captures reach opposite
high-confidence conclusions, each stored as its own claim and rendered
side by side, never averaged (§4.1; §10 red line 1): a Rootclaim
debate-judge — *"I find with high confidence that zoonotic spillover is
the more likely origin of sars-cov-2."* (`x=1ba436bb1ba141ad…`) — against
Rootclaim itself — *"we would like to explain why we still believe the
lab leak hypothesis is the most likely explanation for the origin of
COVID-19"* (`x=72215f239cd1d2de…`) — and a Bayesian treatment putting
*"the probability that the COVID-19 community outbreak first observed in
Wuhan is linked to some Wuhan lab activity is at least 54.5%"*
(`x=a8036f255f8b1638…`). At the institutional level the House majority's
*"Likely Emerged Because of a Laboratory or Research Related Accident"*
(`x=59287ed60272fac7…`) sits beside the minority's *"the origins of
COVID-19 are unknown"* (`x=2850b921a9d450cf…`). Permalink
`«EVENT:distribution»`. *Why deep research misses it:* asked "so how
likely is a lab leak?", deep research lands a single bottom line, however
hedged. X-Ray's constitution forbids the merge and shows instead that
careful analysts of the *same* evidence run from "high-confidence
zoonosis" to "≥54.5% lab" to "origins … unknown" — the shape of the
disagreement is the finding, not a manufactured consensus.

**Baseline comparison (honest both directions).** *Where the X-Ray
treatment beats a strong deep-research run on the same sub-question:*
every claim carries a verbatim anchor and a real content hash a stranger
can recompute (deep research paraphrases, and its links rot); the crux
(a) ships with "what would resolve it"; content addressing collapses
correlated captures (c) a deep-research source list inflates; and the
never-merge rule (5) refuses the single-number roll-up deep research is
pulled toward. *Where deep research is genuinely as good or better:* it is
far more readable and hands the reader a usable bottom line in minutes; it
brings in source-credibility and outside context X-Ray does not model; and
on a well-trodden sub-question its synthesis is fast and substantially
right. X-Ray's edge is durability, contestability, and provenance — not
speed or narrative. *Full side-by-side* (portal-rendered treatment vs a
deep-research report on one COVID sub-question): appendix
`«APPENDIX:baseline»` — TBD from runbook §6; until then this summary is
the non-strawman characterization.

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
| Epistemic uplift | §5.4(a)–(5): verbatim-anchored claims, real content hashes, cruxes carrying "what would resolve it" | Open §5.4(a) and confirm *"…proximity detecIon bias…"* appears character-for-character in the source at `x=f4cdfd6470eedb27…`; follow §5.4(5) and confirm the judge (`x=1ba436bb1ba141ad…`) and Rootclaim (`x=72215f239cd1d2de…`) claims render side by side, unaveraged; read baseline appendix `«APPENDIX:baseline»` |
| Generalizability | One pipeline, zero per-case code, on COVID (147 sources, `caseId entity_94bab542528cc322`; PDF/video/blog-heavy) and eggs (journals/news); §5.4(d) is eggs | Load both corpora under `«NPUB»` (§5.3); confirm §5.4(d)'s `«EVENT:eggs-ldl»`/`«EVENT:eggs-cvd»` are 30058s from the same code path as the COVID events; skim `src/shared/platforms/` |
| Compounding & shareability | Signed events, documented kinds; second-investigator walkthrough (§5.5); real `claim_id`s + 30055 edges (e.g. `claim_32d767d5f24740d4` contradicts `claim_0ecd32327b410b4a`) | Query `«NPUB»` per kind via the §5.3 snippet; re-run §5.5 from your own key against a §5.4 coordinate (e.g. the Proximal-Origin claim `x=7400679218004bcc…`) and publish a side-by-side 30063/30054 |
| Scalability | Audit modules parallelize; convergence-collapse §5.4(c) scales with captures; owned bottleneck: ingestion is interactive (§4.8) | Re-run a quick audit against `x=7400679218004bcc…` — your own Anthropic key + the `epistemicAuditing` flag; ≈ 1 call (quick) or 8 parallel calls (thorough); confirm it anchors to that same hash |
| Methodological transparency | `PHILOSOPHY.md`, `NIP_DRAFT.md`, decision JOURNAL, §4; grounded suggest anchors (verbatim, typos and all) | Recompute the `x` hash from the published 30023's `content` for §5.4(a)'s collider claim and compare to `x=f4cdfd6470eedb27…` (the value in the case-brief JSON export); every audit score on the wire carries confidence + module version |
| Adversarial robustness | BIP-340 verify-on-ingest; content addressing §5.4(c); never-average §5.4(5); flooding named and bounded (§4.3) | Fetch `«EVENT:distribution»` via the snippet, flip one character, re-import through the portal — verify-on-ingest rejects it (or `node --test tests/nostr-verify.test.mjs`); confirm §5.4(5)'s conclusions render side by side, never merged. **Bounded:** §5.4(c)'s visual collapse-to-one-node-with-aliases is not yet shipped — today the guarantee is the shared `x=…` any consumer groups on |
| Insight contribution | §5.4(5): high-confidence zoonosis, "≥54.5% lab", and "origins … unknown" side by side is why never-merge is the honest form here; graded-vs-calibrated; audit/stance firewall | Read §5.4(5) + §4.1 against `epistack/COMPETITION.md`'s COVID description; confirm no aggregate origin number is emitted anywhere in the corpus |

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
