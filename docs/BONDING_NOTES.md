# BONDING_NOTES.md

**Status:** parking-lot exploration, not a spec. Captures the
"money-where-your-mouth-is" bonding idea so we can pick it up later.
**Deferred, out of v1 scope** for the truth-adjudication layer — the
integrity substrate it builds on is
[`TRUTH_ADJUDICATION_DESIGN.md`](TRUTH_ADJUDICATION_DESIGN.md) §3.4 (the
"integrity doc" / "INTEGRITY_DESIGN.md" referenced below is that section;
there is no separate integrity file).

**The pitch (your framing):** the integrity/resolution substrate could
be the base layer for a **decentralized Kalshi/Polymarket that actually
incentivizes truth-seeking** — not just truth-*betting*. Bonds attach to
the claims and predictions we already model; resolution and reputation
are already half-built. The market *is* the epistemic graph, not a
separate venue.

---

## Why this composes cleanly with what we have

The integrity doc already defines the non-financial version of skin in
the game: a pubkey's calibration / accuracy / correction record, derived
from resolutions (30059) and disputes (30061), gated to claims that can
be *wrong in a resolvable way*. **Bonding is the same substrate with an
economic layer bolted on:**

- A bond is an optional Lightning stake attached to a
  **reputation-eligible** claim — i.e. a prediction (30058) with
  pre-stated resolution criteria, or an `enacted` fact-claim with a
  resolution path. (Same eligibility gate. Interpretations and stance
  stay un-bondable, by construction — you cannot stake on a value.)
- Resolution against the pre-stated criteria settles the bond: correct
  -> stake returned + reward; wrong -> slashed.
- Reputation and stake can combine (reputation-weighted stake), so truth
  is not purely capital-weighted (see hard problem #2).

So the schema work in the integrity layer
([`TRUTH_ADJUDICATION_DESIGN.md`](TRUTH_ADJUDICATION_DESIGN.md) §3.4) is the
prerequisite; bonding is a layer on top, not a parallel system.

> **Vocabulary note.** These notes predate the truth-adjudication doc and
> use `enacted` / `ascribed` / `broken-by-conduct`. The canonical
> vocabulary is that doc's `proposition_class` (`event-fact` /
> `state-fact` / `prediction` / `stated-commitment` / `stated-value` /
> `interpretation`) plus its **`subject_role`** axis (`stated` / `enacted` /
> `ascribed`) and match states (`fulfilled` / `broken` / `consistent` /
> `contradicted` …). Read `enacted` ≈ `subject_role: enacted` over an
> `event-fact` / `state-fact`, `ascribed` ≈ `subject_role: ascribed`,
> `broken-by-conduct` ≈ a `contradicted` IntegrityFinding.

## What makes it "truth-seeking," not just a prediction market

Kalshi (centralized, CFTC-regulated) and Polymarket (centralized
resolution via UMA's optimistic oracle) price **future events**. The
interesting extension here is broader:

- **Present-fact bonding** — stake on "this `enacted` claim about
  reality is true," resolved by corroboration / surviving dispute, not
  just on "will X happen."
- **Integrity bonding** — stake on a documented word<->deed contradiction
  (a `broken-by-conduct` edge), resolved on the evidence.
- **Pay people to find reality** — rewards can flow to whoever supplies
  the corroborating primary-source claim (a `supports` edge), not only
  to whoever guessed the outcome. That incentivizes *documentation and
  discovery*, which is the part prediction markets don't reward.

That's the difference between "a market that prices beliefs" and "a
market that pays for verified reality."

## Prior art to study before designing

- **UMA optimistic oracle** — the assert-then-challenge pattern that
  resolves Polymarket. The cleanest decentralized resolution primitive.
- **Augur** — fully decentralized, REP-token Schelling-point resolution.
  Study both the design and *why it struggled* (liquidity, slow/awkward
  resolution, fork mechanics).
- **Kleros** — decentralized arbitration via staked jurors; the model for
  making *challengers* stake too.
- **Reality.eth** — escalation-game oracle; good reference for crowd
  resolution with bonded answers.
- **Robin Hanson, futarchy** — the theoretical north star (decisions by
  prediction market), plus **proper scoring rules** (Brier, log) for
  incentive-compatible forecasting — ties directly to `calibration.js`.
- **Community Notes bridging** — for resolution that resists faction
  capture (see #2).

## Hard problems (the honest list)

1. **The oracle problem.** Who/what declares resolution? Options:
   designated trusted-source list, optimistic oracle + challenge window,
   bonded crowd vote, or bridging-consensus. Each has a failure mode;
   probably different mechanisms for different claim types
   (a court record resolves cleanly; "did his conduct contradict his
   value" does not).
2. **Capital-weighted truth — the central danger.** If resolution is
   stake-weighted voting, the rich buy "truth." A truth market that
   becomes "whoever has the most money is right" is worse than nothing.
   Mitigations to evaluate: reputation-weighting (not just capital),
   bridging (reward cross-faction agreement), quadratic mechanisms,
   conviction over time. This is the make-or-break constraint.
3. **The subjectivity boundary.** Only *cleanly falsifiable* claims are
   bondable. The `role` + resolution-criteria gate is the firewall:
   bond `enacted` facts and `prediction`s with criteria; never
   `ascribed` interpretations, stance, or moral-lens verdicts. Get this
   wrong and you are paying people to enforce an orthodoxy.
4. **Regulatory exposure.** Event-contract / prediction markets touch
   CFTC, gambling, money-transmission, and possibly securities law
   (Kalshi spent years litigating the CFTC; decentralized venues raise
   their own money-transmitter questions). A Lightning-bonded version
   does not escape these by being decentralized. Flagging as a real
   design constraint — **not legal advice; this needs actual counsel
   before anything ships.**
5. **Griefing / frivolous challenges.** Symmetric staking (Kleros-style)
   so challengers also have something at risk.
6. **Cold start.** Markets need liquidity and participants; the
   epistemic-graph framing (bonds on claims people already make) is one
   bootstrap path, but worth thinking through.

## Open questions for the future session

- Lightning mechanics: hold-invoices / escrow / DLCs (Discreet Log
  Contracts are the native Bitcoin primitive for oracle-settled bets —
  likely the right substrate, given the stack)?
- Where does the reward pool come from — slashed counter-bonds, a fee,
  or both?
- Reputation-weighted vs pure-capital stake — can we make the former the
  default so #2 is mitigated from day one?
- Which claim types are bondable at launch (likely: predictions with
  criteria only), and what is the staged path to present-fact and
  integrity bonding?
- DLC/oracle design for the resolution source per claim type.

**Bottom line:** the substrate you'd need is mostly the integrity layer.
Bonding is a believable second act — but the whole thing lives or dies
on resolution design (problem #1) and resisting capital capture (#2).
Worth a dedicated session once the `role` + conduct-edge + reputation
primitives exist to attach bonds to.
