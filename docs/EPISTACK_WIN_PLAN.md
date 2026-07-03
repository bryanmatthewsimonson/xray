# FLF Epistack competition — plan to research and win

> Supersedes the strategy section of [`EPISTACK_ENTRY.md`](EPISTACK_ENTRY.md)
> (keep that as the writeup skeleton; this is the campaign plan). Produced
> 2026-07-02 from a 14-agent research + strategy + adversarial-judging pass.
> Companion: [`EPISTACK_EGGS_CORPUS.md`](EPISTACK_EGGS_CORPUS.md) (the eggs
> source list).
>
> **Sourcing caveat.** flf.org and the forum mirrors are hard-blocked by
> this environment's egress policy, so every competition fact below came
> from WebSearch result summaries, cross-checked across queries and tagged
> by confidence. **Task 0 (below) — a human fetch of the live rules — must
> run before scope-freeze.**

## 1. The competition, as verified

| Fact | Confidence |
| --- | --- |
| Title: "Lab Leaks, Black Holes, and Eggs: Epistemic Case Study Competition," run by the **Future of Life Foundation (FLF)** (Anthony Aguirre, pres.; announcement by Oliver Sourbut & Josh Jacobson; Ben Goldhaber co-authored the vision essay). Distinct from FLI. | high |
| **Deadline: July 19, 2026.** | high |
| **~$200k pool; per-entry $5k–$50k; multiple $50k possible.** $50k tier = an entry that "changes how they think" / becomes "a new reference point." FLF prefers fewer larger prizes; may expand the pool for a strong wave. | high |
| **Continuation funding**: strong entries may get an offer of further funded work / ongoing FLF relationship (~75% chance for a $50k winner). | high |
| **You do NOT need a full system.** They are "excited by ANY submission that advances the state-of-the-art on a single component" (ingestion, structure, OR assessment). Open-minded on submission type. | high |
| Task: an **AI-assisted workflow** that takes messy, conflicting evidence, **structures the claims/arguments, and produces a calibrated view of what to believe**, demonstrated on the cases. Example format: a spec of a human-AI workflow "demonstrated on multiple parts of **at least two** cases" that supports handoff and scales toward "hands-free." | high |
| **The four judging questions**: (1) Would this actually help someone reason better about this case? (2) Does it generalize? (3) Does it scale with better AI / more compute? (4) Does it compound, as multiple people build on each other's work? A linked "Judging Criteria" doc + "FLF general contest rules" give the fine print. | high |
| Stated desiderata: extract & attribute claims to sources **with provenance** (who/what/when/context); **calibrate confidence accounting for out-of-model error and adversarial environments**; **flag rhetoric that carries more persuasive than evidential weight**; **catch correlated evidence treated as independent**; produce **reusable artifacts that survive adversarial pressure and support handoff**. | high / medium |
| Expression-of-Interest Google Form is live (register now for updates); entry via a linked form by the deadline. | high |
| Eligibility: individuals, teams, companies; existing projects appear allowed. No team-size/nationality cap seen; governed by "general contest rules." | medium |

**Still unknown (Task 0 must resolve):** the full judging-criteria rubric &
any weighting; IP/open-source/licensing terms; exact required entry
package (writeup length? repo mandatory? live demo? how many cases?);
whether pre-existing commercial work is explicitly allowed; the judge
panel.

## 2. The single biggest fact: Phase 15 is already built — and now merged

> **Status update (2026-07-03):** this section's premise is complete.
> The full train (15.1–15.10, developed as PRs #79–#88) **merged to
> `main` via PR #89** with the suite green (1018 tests); the stale train
> branches were deleted in the cleanup sweep. The "one gated merge away"
> framing below is preserved for the record but the merge is DONE; what
> remains from this plan is the capture run, relays, and the writeup.

The truth-adjudication layer I wrote the kickoff for **exists in code** as a
clean linear stack (slices 15.1–15.10). It merged cleanly, inert behind a
default-off flag, verified green.

It adds, all faithful to `TRUTH_ADJUDICATION_DESIGN.md`'s spine (descriptive
verdicts, measurements-not-estimations, **no fused score anywhere**):

- **kind 30063 AdjudicatedVerdict** — a signed, addressable, per-proposition
  verdict: `established-true | established-false | contested | unresolved |
  insufficient-evidence`, on a declared standard of proof (preponderance /
  clear-and-convincing / beyond-reasonable-doubt), with two-sided verbatim
  evidence carrying source tiers and **≥1 mandatory caveat**. Content-
  addressed to the claim; **deliberately no `p`-tag** (attaches to the
  proposition, not the person); kind-1985 mirror labels the *claim*, never a
  pubkey.
- **kind 30064 IntegrityFinding** — words-vs-deeds match (fulfilled/broken,
  consistent/contradicted) as a full verdict; documented gap-cause, **intent
  never inferred**; value firewall (a value is never ruled true/false);
  ordered into a per-entity timeline; no 1985 mirror by design.
- Evidence tiers + **attestation-convergence** ("two outlets on one wire =
  one source"), dimension-separated **coverage-capped entity records**,
  reader adjudicate UI, publish path, `truthAdjudicationPublishing` flag
  (default off). ~72 new tests (suite 1018 total on merged `main`).

**This means the competition's literal headline deliverable — a graded
per-proposition verdict anyone can replay, re-audit, or dispute — is
already on `main`, not a build.** (Per §3 fix 1, never brand it
"calibrated" in the entry.)

Other branches (triaged): `decentralized-trust-systems-m393u` holds one
unique 537-line design doc — the deferred aggregation / web-of-trust /
bridging / Sybil layer — **stale as code (would revert Phases 8–15) and
its proposed kinds 30050–30056 collide with live kinds**. *(Harvested
2026-07-03 to `docs/ideas/CONSENSUS_PROTOCOLS_PLAN.md` with a renumber
warning; its branch is verified safe to delete.)* `feature/phase-9b-metadata-ui` (live-page read/annotate
overlay) is valuable but not needed for this entry. Everything else is
merged or stale.

## 3. Chosen strategy (unanimous across three adversarial judges)

**Build-to-Rubric: a running epistemic stack that ends on a signed,
graded per-proposition verdict.** Judges scored it 83 / 82 / 75 vs the
pure-substrate floor (74/64/72) and the COVID-deep full-arc (70/70/53).

The spine is: merge Phase 15 → run X-Ray's real pipeline on the cases →
end on **signed graded verdicts spanning the full state range**, published
as an open, content-addressed graph, with a rubric-mapped writeup. Keep the
**pure-substrate v0.6.0 entry as a guaranteed-shippable fallback** behind
it (the merge reverts trivially).

Two fixes every judge demanded, now baked in:

1. **Do not brand the output "calibrated."** There is no activated Brier
   loop / reliability diagram behind it. Call it a **graded descriptive
   verdict on a declared standard of proof, with mandatory caveats and
   evidence tiers**. Present the **verdict-state distribution across a case
   as "the calibrated view,"** and disclose the Brier loop as
   specified-but-logged-only (P11 under-claim).
2. **Do not only ever output "uncertain."** An entry that only hedges proves
   half the calibration curve. Deliberately include propositions where the
   *same machine* lands a **confident, correct** verdict, so the entry shows
   the full curve.

## 4. Case selection: all three, scoped by depth

FLF picked three **deliberately-varied challenge profiles** — settled
(LHC), contested (COVID), messy (eggs) — to test *differential* behavior.
The winning move spans all three but pays for depth only where it's cheap,
and deliberately spans the confident↔uncertain curve:

- **EGGS — deep spine (guaranteed).** Corpus already built
  (`EPISTACK_EGGS_CORPUS.md`), entirely in X-Ray's easy article-capture
  tier. Uniquely contains **both** a confident-correct sub-fact (RCTs:
  dietary cholesterol raises LDL-C → **established-true**) **and** an
  honestly-uncertain outcome (egg→CVD → **insufficient-evidence/contested**,
  "critically low strength"), plus the auditor's sweet spot (industry-COI
  49% vs 13% discordance; press-release drift; number hygiene; the
  DGA/AHA/TIME-1984→2014 updates timeline).
- **COVID — bounded medium slice.** 2–3 crisp propositions (market
  centrality; furin cleavage naturalness; DEFUSE-as-blueprint), ~8–12
  article-shaped sources. Produces a genuine **mix** of verdict states,
  exercises the forensic 30062 layer (EcoHealth undisclosed interest;
  agencies revising confidence on "fresh looks" with no new evidence) and
  attestation-convergence (many outlets → one press release; analyses
  reusing one dataset), and lands honestly on **"contested / undetermined,
  capped by China's withheld data"** — a calibration virtue, not
  side-taking. One institution-level **IntegrityFinding** on the EcoHealth
  word-vs-deed gap (subject to your consent — see §7).
- **LHC — thin slice (the confident-correct + out-of-model-error showcase).**
  1 proposition (micro-black-holes destroy Earth → **established-false,
  beyond-reasonable-doubt**, via the cosmic-ray / white-dwarf survival
  argument), from article-shaped material only (Wikipedia "Safety of
  high-energy particle collision experiments," LSAG HTML summary, Physics
  World, reason.com). Encode Ord et al. "Probing the Improbable" (P(the
  safety argument is itself flawed) dwarfs the computed risk) as an explicit
  knowability caveat. The collider ran and Earth survived → one genuine
  **resolved, scored** datapoint. LHC is the descope lever; the eggs-LDL-C
  verdict is the confident-correct insurance if LHC capture stalls.

## 5. Deliverables (mapped to the rubric)

1. **The live signed graph (centerpiece).** All three corpora published to
   ≥2 durable public relays (≥1 self-hosted, no-auth): 30023 content-
   addressed sources, 30040 claims, 30055 contradiction/support/updates
   edges, 30054 assessments, 30056/30057 audits, 30058/30059 prediction
   ledger, 30062 forensic, **30063 verdicts, 30064 integrity**, 32126
   cross-platform identity. Judges get relay URLs + auditor npub + a
   kind-by-kind index. **Raw signed-event JSON bundled** so "replayable by
   anyone" can't be falsified by a relay outage. → Q1, provenance.
2. **The verdict climax.** Signed graded verdicts spanning the full range
   (LHC established-false BRD; LDL-C established-true; COVID
   contested/insufficient). Verdict-state **distribution per case** = "the
   calibrated view." → Q1, Q2, the brief's literal ask.
3. **Correlated-evidence-as-independent, demonstrated.** attestation-
   convergence run on COVID (press-release cluster) and eggs (overlapping
   cohorts). → named desideratum.
4. **Compounding + robustness proofs (cheap, high-signal).** (a) content-
   addressing adversarial demo: edit a source → x-hash changes → prior
   verdict visibly no longer binds; (b) **live n=2 compounding**: a second,
   deliberately *disagreeing* verdict on the same x-hash, side-by-side,
   never averaged (P8); (c) a ~5-line websocket consumer that rebuilds the
   graph from relays **without the extension**. → Q4.
5. **Portal read surface + 6–8 min screencast.** The existing reader
   adjudicate modal + portal case dashboard + a minimal verdict-state-
   distribution view grouped by question/sub-question (additive, no new wire
   kind). Screencast: capture → content-addressed source → claim atomization
   → contradiction knot → 8-module audit → signed verdict distribution,
   ending on confident-correct LHC/LDL-C beside honest COVID "undetermined."
   → Q1.
6. **The methodology writeup (~2,500–4,000 words, the entry document).**
   LEADS with **"the format outlives the app — we re-decentralize exactly
   what the platforms are abandoning"** (ClaimReview being retired by
   Google; C2PA media-only + signatures expire; Community Notes decays with
   a post ID). Maps each of the four questions AND each desideratum 1:1 to a
   shipped mechanism, grounded in `PHILOSOPHY.md` (P3 evidence-bound, P5
   symmetry, P7 calibration-over-correctness, P8 disagreement-is-data, P11
   under-claim). **Delete the draft's §4.1 self-cap** ("does not yet emit a
   question-level verdict") — the merge makes it shipped. Honest calibration
   language throughout.
7. **Governing docs + wire format.** `PHILOSOPHY.md`,
   `TRUTH_ADJUDICATION_DESIGN.md`, `NIP_DRAFT.md` updated for the additive
   30063/30064 + 1985 verdict mirror + `xray/adjudication` namespace + the
   30061 dispute-target extension. → Q4 / "who checks the checkers."
8. **Baseline comparison appendix.** A plain Claude / deep-research pass on
   the eggs question beside the signed graph — showing exactly what tamper-
   evidence + per-source audit + forkability + cross-platform identity add
   that an ungrounded LLM synthesis does not. → the direct answer to "what
   does this give me that deep-research doesn't?"
9. **Open-source repo + reproducibility/anti-fabrication kit + continuation
   roadmap.** Loadable unpacked, suite green; instructions for a judge to
   re-audit any source against its x-hash and publish a competing
   30056/30063 rendered side-by-side; the honest framing that content-
   addressing makes the **input** reproducible (byte-identical hash) while
   LLM-assisted **content** is verified by signature+provenance, not by
   re-running; a one-page continuation roadmap for the deferred
   aggregation/bridging/Sybil layer (harvested from the consensus-protocols
   doc, renumbered off the live 30050–30064 block), labeled DESIGN.
10. **(Upside, off critical path)** a zero-install hosted, click-to-explore
    rendering of the published graph, built only if the mid-point buffer
    holds.

## 6. Timeline (to July 19)

- **Jul 2–3 (Day 0–1):** Task 0 — human fetch of flf.org rules + judging
  criteria *(DONE — `docs/epistack/` committed via #91/#92, authoritative
  over §1)* + submit EOI. **Merge `phase-15-adjudicate-ui`** *(DONE —
  merged as #89, suite 1018 green)* + full gate
  (`npm test` / `build` / `web-ext lint`) + the pending Phase 15 SMOKE_TEST,
  specifically the 30063 author→sign→publish→portal-render round trip.
  Freeze + self-host relays. **GATE:** if the merge can't go green, switch
  to the substrate-only fallback now.
- **Jul 4–8 (Day 2–6):** Eggs spine end-to-end incl. the confident-correct
  LDL-C verdict, the uncertain egg→CVD verdict, and attestation-convergence.
  **Milestone ~Jul 8: a complete, submittable entry exists from eggs alone.**
- **Jul 9–11 (Day 7–9):** COVID bounded slice (2–3 propositions, forensic
  layer, one IntegrityFinding, attestation-convergence, contested/
  insufficient verdicts). **Mid-point descope gate ~Jul 9:** if COVID
  capture stalls, cut it, proceed eggs+LHC.
- **Jul 12–13 (Day 10–11):** LHC thin slice — confident-correct verdict +
  out-of-model-error caveat + the one resolved/scored datapoint.
- **Jul 14–15 (Day 12–13):** publish the whole graph as an ordered batch;
  stage the content-addressing demo, the n=2 disagreeing verdict, the
  relay-replay consumer, the baseline comparison.
- **Jul 16–17 (Day 14–15):** writeup + screencast + reproducibility kit +
  doc updates.
- **Jul 18–19 (Day 16–17):** buffer, final fact re-check against Task 0,
  submit. Upside-only: the hosted explorer.

## 7. Differentiators (what to lead with)

1. **Content-addressed verdict bound to the exact reviewed bytes** (30023
   x-hash) — survives edits, deletion, paywalls; the adversarial demo proves
   it. Community Notes decays with a post ID; fact-checkers bind to mutable
   URLs; Ground News rates a publication name. No incumbent has this.
2. **The only system unifying claim + evidence + graded verdict + per-source
   audit in one open, signed graph.** The field is siloed: Kialo/Argdown =
   structure only; Metaculus/Squiggle = numbers only (and forecast future
   events, not published-claim veracity); Elicit/Consensus = literature
   synthesis; ClaimReview (retiring) / C2PA (media-only, expiring) =
   provenance markup; Ground News = publication-level; Community
   Notes/Pol.is = platform-locked consensus.
3. **Re-decentralizes what platforms are abandoning**, on a running open
   protocol (NOSTR) with a live relay/cache tier — the interoperability the
   vision essay says "motivates the whole design." The format outlives the
   app; there is no server.
4. **Demonstrated full calibration curve** — same machine, confident-correct
   *and* honestly-uncertain.
5. **"Who checks the checkers" as a shipped answer** — the auditor's
   methodology is a signed public constitution (`PHILOSOPHY.md`) bound to its
   npub; the checker is itself disputable (30061) and its track record binds
   to its key.
6. **Cross-platform signed identity (32126)** — per-actor track records
   spanning sites, a direct hit on FLF's own "epistemic track records of any
   actor" wishlist that siloed rivals structurally cannot build.
7. **Verdict attaches to the proposition, not the person** (no `p`-tag);
   integrity findings require a documented gap and never adjudicate intent —
   the structural answer to defamation/side-taking that lets the entry touch
   COVID without picking a political winner.

## 8. Risks & mitigations

- **Merge/gate risk** (the suite/smoke were never run in the audit): merge
  day-1, flag default-off (the only production change is a demo-time flip),
  substrate fallback ready, revert trivial.
- **Overclaiming "calibrated"** (the skeptic's sharpest attack): drop the
  word; verdict-state distribution + demonstrated curve are the evidence;
  disclose the Brier loop is logged-not-activated and the LHC datapoint is
  illustrative.
- **COVID capture difficulty** (paywalls/preprints/threads): restrict to
  8–12 article-shaped sources + screenshot/HTML-snapshot + paywall
  reconstruction for 2–3 primaries; eggs+LHC is a complete entry if COVID is
  cut.
- **LHC PDF corpus:** scope to one proposition from article-shaped sources;
  eggs-LDL-C is the confident-correct insurance.
- **Legal/reputational exposure** of a signed permanent finding naming an
  org: institution-level only (EcoHealth, not an individual), documented
  gap-cause, no `p`-tag; headline COVID verdict is "contested/undetermined,"
  not "lab leak: true."
- **Compounding is n=1 today:** show the mechanism live at n=2 + relay-replay
  script; concede the aggregation/bridging/Sybil layer is designed-not-
  shipped (roadmap).
- **Stale competition facts:** Task 0 before scope-freeze; never repeat the
  digest's git hashes or "fast-forward" as load-bearing in the writeup.

## 9. Open decisions for the user — ALL DECIDED 2026-07-03 (scope freeze)

1. **Scope: DECIDED — all three cases, depth-scoped** as recommended
   (eggs deep spine / COVID bounded 2–3 propositions / LHC thin single
   proposition). LHC remains the descope lever at the §6 mid-point gate.
2. **EcoHealth IntegrityFinding: DECIDED — ship it.** Institution-level
   only, documented gap-cause, intent never adjudicated, no `p`-tag on
   the verdicts; the headline COVID verdict stays
   "contested/undetermined."
3. **Relays: DECIDED — self-host one no-auth relay + ~2 durable public
   relays.** Raw signed-event JSON is bundled regardless, so a relay
   outage can't falsify replayability. The explorer hosting box stays
   upside-only (§5 deliverable 10).
4. **LLM budget: DECIDED — ~$100 ceiling.** Sonnet-class for suggest
   passes and most audits; a handful of Opus-class thorough audits on
   the load-bearing spine sources; headroom for re-runs.
5. **Entry identity: DECIDED — individual entry, existing MIT license.**
   The fetched rules admit individuals and teams; the IP fine print
   lives in the linked contest-rules doc — re-verify it at submission
   time.
6. **Descope gate: ACCEPTED as written** — mid-point gate ~Jul 9; the
   substrate fallback stays ready (a downgraded-but-shipped entry beats
   a rushed full one).
7. **Honest-calibration framing: SIGNED OFF** — headline COVID verdict
   "contested/undetermined, capped by withheld data"; the word
   "calibrated" is never applied to X-Ray's own output; the Brier loop
   is disclosed as logged-not-activated.

## 10. Immediate next actions

1. **You:** run Task 0 (fetch flf.org rules + judging-criteria doc; submit
   the EOI form) — it gates scope-freeze and I can't reach flf.org.
   *(Rules/criteria fetch DONE — `docs/epistack/`; §9 scope-freeze
   DECIDED 2026-07-03; EOI status unknown — submit if not yet done.)*
2. **Me, on your go** *(DONE — merged as #89)*: merge `phase-15-adjudicate-ui` to `main` behind its
   default-off flag, run the full gate (test/build/lint) and report green
   before anything else; then stand up the capture run scaffolding.
3. **You + browser:** the capture run itself (needs the extension loaded +
   your API key).
