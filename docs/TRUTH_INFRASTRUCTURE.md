# Truth Infrastructure — the expansion map

> **Status:** exploration + expansion map, not a spec. Non-normative:
> [`PHILOSOPHY.md`](PHILOSOPHY.md) **governs** wherever this document
> touches audit surfaces, and nothing here amends it; where this
> document names a mechanism the philosophy forbids, the refusal is
> the content. Distilled from a maintainer essay (2026-08) on
> truth-seeking systems and a follow-up exchange (2026-08-02) on
> double- and triple-entry bookkeeping. The comparative foundation —
> what courts, science, journalism, and Bitcoin share, and the
> evidence base for the strategies below — is **borrowed with
> attribution** from the Truth Systems annex
> ([`TRUTH_SYSTEMS.md`](TRUTH_SYSTEMS.md), landed from PR #263),
> cited throughout as "TS §n" and deliberately not restated. This
> document shipped standalone, ahead of the annex (decision recorded
> in `docs/JOURNAL.md`, 2026-08-02); the prose citations became
> relative links when the annex landed.

---

## §0. The claim

Truth is not a state of being; it is a process of verification. The
institutions that actually produce shared truth — courts, science,
audit, the better parts of journalism — do not assume people are
good. They assume people are fallible and self-interested, and they
design mechanisms under which honesty is the most rational strategy
available. The essay this document distills closes on the right
imperative: **the future of truth lies not in trusting fewer people,
but in verifying more things.**

Call the discipline behind those mechanisms **truth infrastructure**:
the small set of portable structural moves that every serious truth
system converges on. The system-by-system survey of those moves —
sixteen institutions, their invariants, and their characteristic
failures — is the Truth Systems annex (the survey and invariants,
TS §§0–2; its anti-subversion machinery and honest-limits clauses,
TS §§3–4, cited below by their I-n / S-n / H-n clause IDs; all
[`TRUTH_SYSTEMS.md`](TRUTH_SYSTEMS.md)), and one sentence of overlap
acknowledgment is all this document owes it: what the annex
establishes is cited here, never restated.

This document's business is what the annex does not cover. Two
things. First, the framework **as an export**: the five strategies
(§1) and the bookkeeping lens behind them (§2), stated portably
enough to carry into domains X-Ray will never ship. Second, the
**expansion domains** — five the essay proposes (supply chains,
personhood and reputation, truth markets, governance ledgers,
structured debate) and a sixth the follow-up adds (cross-ledger
reconciliation) — each steel-manned, corrected where the pitch is
loose, and mapped to what X-Ray ships, parks, or refuses, and to
where the maintainer's sibling projects already sit
([`PHILOSOPHY.md`](PHILOSOPHY.md) §0; the family map is §9).

---

## §1. The portable framework — five strategies, one shortcut refused

The essay names five strategies. All five survive contact with
X-Ray's constitution — the fifth only after a distinction the naive
reading misses: the *process* it names is the product this family is
building, and what standing law refuses is the shortcut that skips
the process (§1.5).

### §1.1 Distributed trust — "don't trust, verify"

**The strategy.** Replace blind faith in experts with verifiable
processes: truth should emerge from mechanisms many independent
actors can check, not from the benevolence of a central authority.

**Where it lives.** This is P12 made portable — the reader should be
able to reconstruct any score from public materials — and §9's
engineering derivations: reproducible rollups, decentralized
publication preferred, "verifiable even if the system's operators
disappear or defect" ([`PHILOSOPHY.md`](PHILOSOPHY.md) §9, P12). The
shipped form is the substrate itself: every capture
content-addressed, signed, timestamped, verified on ingest, and
publishable to open public relays — "reusable and refineable by
anyone, without our permission or our server"
([`EPISTACK_ENTRY.md`](EPISTACK_ENTRY.md) §2). The essay's slogan is
the house posture: the system asserts nothing it cannot hand the
reader the means to check ([`PHILOSOPHY.md`](PHILOSOPHY.md) §11,
heuristic 8).

### §1.2 Asymmetric incentives for honesty

**The strategy.** Make truth-telling profitable and lying
prohibitively expensive; align individual incentives with collective
truth.

**Where it lives.** Twice, deliberately. The non-financial version
ships as far as the substrate goes: the prediction ledger and
per-hedge resolution record are live, and P7's calibration
multiplier — confident-wrong costs more than hedged-wrong — is
specified and logged but deliberately not yet applied to any score
until the ledger has volume ([`PHILOSOPHY.md`](PHILOSOPHY.md) P7;
TS §1.8). A multi-year resolved ledger is the credential
hardest to fake (§4 adds the Sybil caveat that bounds even that).
The financial version — Lightning bonds staked on one's own claims —
is parked in [`BONDING_NOTES.md`](BONDING_NOTES.md), and stays
parked until its make-or-break constraint (capital-weighted truth,
§5 below) has an answer. The ordering is itself the design: the
reputational stake came first because it is the one stake that
cannot be minted with money.

### §1.3 Friction for falsehood, flow for truth

**The strategy.** Procedural filters — peer review, discovery,
editorial standards — that make falsehood expensive to assert
without impeding verified information.

**Where it lives.** X-Ray's filters are its forms. A finding must
carry verbatim evidence, auditor identity, methodology version,
confidence, and caveats, or it is rejected at the persistence
boundary ([`PHILOSOPHY.md`](PHILOSOPHY.md) P3, §9); a model-proposed
quote is a search key that must re-anchor in the article's own bytes
or it is discarded. The annex says it exactly: inside these forms,
"a lie must expose its evidence, tier, standard, and caveats to be
well-formed at all; outside them, it is visibly formless" (TS §3.1).
One boundary sentence, because the strategy is abusable: friction
here means the procedural cost of *asserting*, never ranking, or
belief-optimization — the persuasion line is TS H-7, and the network
feed stays newest-first, never ranked.

### §1.4 Immutability and append-only records

**The strategy.** Once established, truth should be hard to erase;
history should not be rewritable by whoever holds power now.

**Where it lives.** P9 without remainder: nothing is overwritten,
judgments update by supersession with full lineage, artifacts are
content-addressed so a stealth edit creates a new artifact and a
diff that is itself a finding ([`PHILOSOPHY.md`](PHILOSOPHY.md) P9,
§9). One correction the essay needs, planted here and paid off in
§3: immutability preserves the **record**, not the truth of the
record. An append-only log of garbage is permanent garbage. The
strategy is load-bearing only in combination with §1.1 and §1.3 —
verifiable provenance into forms that cost something to fill.

### §1.5 Decentralized consensus — the process is the product

**The strategy, as the essay states it.** "Truth is not declared; it
is agreed upon through a protocol" — majority rule, supermajority
thresholds, consensus mechanisms in Bitcoin's image.

**Claimed, corrected — not refused.** Read as *truth is a process,
not a ruling*, this strategy is no rejection candidate; it is the
product. The process by which people reach justified agreement —
evidence forced into forms, judgments signed and disputable forever,
dissent preserved at full fidelity, supersession instead of erasure,
disagreement measured and published — has never had infrastructure
of its own. Building it is the whole point. Consensus, here, is an
outcome readers arrive at; the system's job is to make arriving
cheap, auditable, and honest — never to announce the destination on
their behalf.

**The shortcut, refused.** What standing law rejects is the naive
reading's shortcut: the protocol *computing* the verdict. "No
aggregation / consensus / reputation layer — trust is per-reader"
([`KNOWLEDGE_SHARING_DESIGN.md`](KNOWLEDGE_SHARING_DESIGN.md),
owner decisions 2026-07-03), and red line 1 — disagreement is never
averaged into a consensus number
([`PHILOSOPHY.md`](PHILOSOPHY.md) §10, P8). A computed consensus on
an open network is Sybil-capturable, dissent-averaging, and a
central scoreboard wearing decentralized clothes. "Consensus of
adjudicators is a fact about adjudicators, never a property of
reality" (TS H-1). The refusal protects the process: a
system that computes the ruling has ended the process.

**The technical correction, briefly.** Bitcoin does not vote on
truth. Nakamoto consensus uses proof-of-work to *order a ledger*:
every node independently verifies every rule, and a hash-power
majority can at most reorder or censor recent history — it cannot
make an invalid transaction valid. (Slashing, which the essay
attaches to Bitcoin, belongs to proof-of-stake systems — a different
design.) What any of these protocols establishes is truth about the
record — who signed what, when, unchanged since — never truth about
the world (TS §1.12).

**The licensed remainder.** Exactly the shape TS §3.3
licenses: computed **measurement** of the disagreement structure —
"who ruled what, the spread, cross-prior convergence counts," with
the derivation shown — as distinct from computed **authority**, a
fused number on the proposition. Distribution-not-number;
annotate-never-adjudicate. The essay's fifth strategy, in full: the
process, housed (this family's product); the measurement, licensed
(TS §3.3); the ruling, never computed.

---

## §2. The bookkeeping lens — two entries, three, and the asymmetry

The follow-up exchange adds the oldest member of the survey's family,
and one the annex does not treat: double-entry bookkeeping — an
epistemic technology wearing an accountant's clothes.

**Redundancy against an invariant.** Double entry records every
transaction twice, and the books must satisfy a conserved quantity —
assets equal liabilities plus equity. A lone error surfaces as an
imbalance that must be found before the books close; a fraud must be
told twice, consistently, forever, and still balance. That is the
portable move: **structure records so one lie requires many
coordinated lies, tied together by an invariant that must balance.**
Courts run the same move as cross-examination — hunting the violated
invariant in a story; audit runs it as reconciliation; physics runs
it as conservation laws. And bookkeeping solved append-only history
centuries before P9: books are kept in ink, and an error is
corrected by a *reversing entry* that preserves both the mistake and
its correction — supersession, discovered by clerks
([`PHILOSOPHY.md`](PHILOSOPHY.md) P9).

**The residual, and the third entry.** Double entry's weakness is
that both entries live with one party — internally consistent fraud
balances perfectly, which is why audit exists (independence as
structure; TS §1.5). Triple-entry accounting names the
stronger fix — in Ian Grigg's phrase, "the signed receipt is the
transaction": a cryptographically signed record of the deal, held
where neither counterparty can alter it. Bitcoin is that idea
realized at global scale — your entry, my entry, and the network's
sealed shared entry. The primitive is older than the term: the court
record, the timestamped publication. X-Ray's substrate is the third
entry applied to claims — signed events on public relays that
neither author nor subject controls, content-addressed so the record
cannot drift without the hash saying so
([`PHILOSOPHY.md`](PHILOSOPHY.md) §9).

**The master asymmetry.** In nature the economics run the wrong way:
lying is cheap and checking is dear, which is why misinformation
wins by default. Every institution in the survey is a machine for
inverting that asymmetry, and Bitcoin is the purest case — producing
a block costs quintillions of hashes; verifying it costs one. The
design test this lens hands every truth system, this one included:
**is verification cheaper than assertion?** Wherever the answer is
no, the design is not done ([`PHILOSOPHY.md`](PHILOSOPHY.md) §11,
heuristics 5 and 8).

---

## §3. Supply-chain transparency (verifiability over authority)

**The pitch, steel-manned.** Don't trust the label; verify the
journey. Hash the custody record of food, medicine, electronics at
every step, anchor it somewhere append-only, and let the consumer
scan a code and see the product's history. The trust boundary moves
from the brand's say-so to a checkable record.

**What actually transfers.** The mechanism is real and X-Ray already
runs it — for a different cargo. A capture is a custody event: the
exact bytes, content-addressed at the moment of acquisition, signed,
timestamped, with every later judgment anchored to that hash
([`PHILOSOPHY.md`](PHILOSOPHY.md) P3, §9). X-Ray is a supply chain
for quotations and claims: provenance unbroken from artifact to
verdict, and the known-unknowns log disclosing where the chain could
not reach.

**The failure mode the pitch omits.** The oracle problem. A hash
chain verifies custody of *records about* a thing, never the thing:
if the fraud happens before the first hash — the wrong fish in the
right box — the chain preserves it forever, cryptographically
immutable garbage (TS §1.12). Upstream forgery enters as
well-formed evidence; the protocol can only survive it by
supersession and the forger's permanent record (TS S-7).

**The portable rule.** Push the trust boundary as close to the world
as the system can reach, then **disclose exactly where it stands**.
X-Ray asserts provenance of the record from capture onward, and
never claims the capture boundary is the world. Any supply-chain
system honest enough to state its first-hash boundary is applying
X-Ray's rule; any one that says "blockchain-verified" without it is
selling the immutability of its own assumptions.

**Sibling seat.** The maintainer's crux is this domain's native
implementation — claims about documents are custody chains over a
document trail. For X-Ray: shipped for its own cargo; the physical
world is out of scope, and says so.

---

## §4. Personhood and reputation (reputation as cryptographic capital)

**The pitch, steel-manned.** Identity online is cheap, so discourse
drowns in disposable accounts. Give people a sovereign identity that
accrues reputation over time — the essay's phrase is a "reputation
hash" that grows harder to fake — and coordinated disinformation
starts costing what it should.

**What actually transfers.** The true core is P7's: a multi-year
ledger of *resolved* predictions, graded against reality, is the
credential hardest to fake — time is an input no forger can rush
([`PHILOSOPHY.md`](PHILOSOPHY.md) P7, §5; TS §1.8). Signed
history under a stable key is exactly X-Ray's substrate, and the
record survives key rotation only if transitions are attested — the
key-transition gap the annex names (TS §1.12): reputation
systems that cannot survive rotation punish the honest and reward
fresh-key laundering.

**The failure mode the pitch omits.** Sybil. Identities are free, so
accrual can be farmed in parallel — a thousand patient keys aging
gracefully cost almost nothing, and survivorship does the rest: many
keys make many confident calls, the losers are quietly discarded,
and the survivors look prescient while the reader never sees the
graveyard. "Harder to fake as it grows" holds only where identity is
anchored in something scarce: confident calls on hard questions
(where key attrition compounds), explicit rosters, fees, documents,
flesh. X-Ray's stance is
**abstinence**: it counts nothing over open sets, computes no
platform reputation score, and leaves trust per-reader
([`KNOWLEDGE_SHARING_DESIGN.md`](KNOWLEDGE_SHARING_DESIGN.md);
TS S-2). The refusal is the feature: a computed reputation
number over an open network is a Sybil market waiting to clear.

**Sibling seat.** The family's strongest implementation is Honor's
layered verification stack
(<https://github.com/bryanmatthewsimonson/honor>, `docs/TRUST.md`
§1): documents, liveness, fees, in-person presence attestations —
proof of personhood via flesh — and step-up re-verification at the
transition moments where accounts go bad. Personhood is anchored in
atoms there because the stakes are people. X-Ray's stakes are
claims, and claims need authorship, not personhood: gap
acknowledged, abstinence maintained.

---

## §5. Open-source truth markets (algorithmic peer review)

**The pitch, steel-manned.** Peer review is slow, biased, and
paywalled. Let claims be staked instead: endorse with reputation or
money, lose the stake when the claim resolves false. Skin in the
game for information dissemination.

**What actually transfers.** This is the parked design, nearly
verbatim: [`BONDING_NOTES.md`](BONDING_NOTES.md) — bonds attached to
reputation-eligible claims, resolved against pre-stated criteria,
the market *as* the epistemic graph. The essay's "endorsers of
later-disproven claims lose stake" has a shipped non-financial
analogue in the prediction ledger: an author's resolved predictions
accumulate a public per-hedge record (P7's multiplier is logged, not
yet applied), and an endorser's only stake today is the visible
permanence of their signed assessment. What the essay's
version misses, the parked notes add:
pay-for-**discovery** — rewards flowing to whoever supplies the
corroborating primary source, not just to whoever guessed right —
which is the difference between a market that prices beliefs and one
that pays for verified reality.

**The failure mode the pitch omits.** Capital-weighted truth — the
central danger, in the notes' own words: if resolution is
stake-weighted, the rich buy "truth," and a market like that is
worse than nothing. Plus the subjectivity firewall: only cleanly
falsifiable claims are bondable — stake on a value or an
interpretation and you are paying people to enforce an orthodoxy —
and a regulatory surface (CFTC, gambling, money transmission) that
decentralization does not dissolve.

**Status.** Parked, correctly. The prerequisite substrate is the
integrity layer
([`TRUTH_ADJUDICATION_DESIGN.md`](TRUTH_ADJUDICATION_DESIGN.md)
§3.4); the gate is resolution design and capital-capture resistance:
the notes name capital capture the make-or-break constraint and
float reputation-weighted stake as the day-one default mitigation.
The essay is right that this is buildable; the notes are right about
what has to be true first.

---

## §6. Democratic ledgers (immutable public records for governance)

**The pitch, steel-manned.** Government runs on records — votes,
amendments, lobbying, procurement — and opacity is where corruption
lives. Put the records on append-only infrastructure and corruption
becomes auditable in real time.

**The failure mode first, because it is disqualifying as stated.**
"Every vote recorded immutably" destroys the secret ballot. Ballot
secrecy is not a legacy limitation; it is coercion-resistance
technology — an immutable per-vote record is a receipt, and a
receipt is precisely what a vote-buyer or an intimidator demands you
produce. The live research line (end-to-end verifiable elections) is
the attempt to prove to each voter that their vote was counted
without producing evidence of how anyone voted — largely solved for
supervised poll-site voting, still open for remote voting at scale.
Where it is not solved, an immutable individual ballot ledger is an
attack on the voter, not on corruption.

**What actually transfers.** The other half of the essay's list —
procurement, legislative process, contract awards, roll-call acts:
**public acts by public actors**. That is X-Ray's native domain
already (tier-1 evidence is court records, roll-call votes,
filings). And the design rule generalizes P10 and P12 — the auditor
discloses most, the judge is held to the standard harder
([`PHILOSOPHY.md`](PHILOSOPHY.md) P10, P12): whoever exercises power
discloses most. Transparency runs toward power.

**The solved shape to import.** Honor's transparency ledger
(<https://github.com/bryanmatthewsimonson/honor>, `docs/TRUST.md`
§3) already implements the split the naive pitch misses: signed,
hash-chained, append-only **aggregates** under versioned public
definitions, broadcast to relays the operator does not control —
while individual members never appear at all: the ledger is
aggregate-only, and any cell small enough to identify someone is
suppressed. Append-only for the institution; plausible deniability
for the person. That is the design rule this domain
needed all along: **immutable institutions, private individuals.**

---

## §7. Adversarial collaboration and structured debate

**The pitch, steel-manned.** Echo chambers form because nobody is
required to face the other side. Build platforms where standing
comes from arguing both sides well — and let AI referee, flagging
fallacies in real time as a "digital judge."

**What actually transfers.** The adversarial voice as structure, not
hope (TS I-4). Steel-manning is constitutional law: opinion
is graded on whether it engaged the strongest opposing case, never
on its conclusion ([`PHILOSOPHY.md`](PHILOSOPHY.md) §3.2 — mandated
there; the shipped scorer covers the eight news modules today).
Disagreement is data, published with the variance, never averaged
(P8). And the essay's "argue both sides to be verified" has a
measured analogue in P5's discomfort test: if the scoreboard is not
periodically uncomfortable for every camp, the calibration is
broken. The annex's seed in this domain — two disagreeing parties
co-signing resolution criteria before evidence collection — is "the
single highest-leverage social feature the truth layer lacks: it
converts enemies into co-registrants" (TS §1.3).

**The failure mode the pitch omits.** The "digital judge" is
computed authority in a robe. A model ruling on fallacies in real
time is an unaccountable adjudicator with unstated priors — exactly
what the machine-proposes/human-judges line exists to prevent
(TS H-4): every model suggestion is human-accepted, every
judgment is a signed, attributed, disputable act.

**The salvage.** Fallacy-naming as a *labeled finding*, not a gate:
an identified auditor asserts `fallacy/strawman` with a verbatim
quote, signs it, and eats the dispute if it is wrong — the
assessment vocabulary already carries the labels. And the forensic
taxonomy as **inoculation**: naming the maneuvers teaches readers to
see them (TS H-7) — the debate-platform dream delivered as
teaching material, never as a referee with a mute button.

---

## §8. Cross-ledger reconciliation (verifiability between ledgers)

**The pitch, steel-manned.** The great frauds did not live inside a
ledger; they lived in the gaps *between* ledgers nobody cross-footed
— what a firm told the tax authority versus its investors versus its
insurers. Enron, Madoff, and Wirecard were each one honest
reconciliation away from discovery, for years; Wirecard's missing
billions were an unconfirmed bank balance. The move: make every
consequential claim appear in at least two ledgers kept by parties
with different incentives, and publish the cross-footing.

**What actually transfers.** Reconciliation is §2's asymmetry made
operational — mechanical, adversary-friendly verification anyone can
run. The move generalizes past money: arithmetic audits that catch
impossible statistics (reported means no integer sample could
produce), digit-distribution scans on procurement data, sum checks
on published tables — cross-examination for datasets. X-Ray's shape
of it: captures are content-addressed, so an outlet's numbers can be
cross-footed against the primary filings they cite, and the
number-hygiene module already demands the denominator, base rate,
and comparison class every load-bearing number owes the reader
([`PHILOSOPHY.md`](PHILOSOPHY.md) §3.1, module 3).

**The failure modes the pitch omits.** Two. Shared-source collapse:
two ledgers fed by one liar reconcile perfectly — reconciliation
inherits the rule that corroboration must be independent, not merely
numerous (TS I-5), and a reconciliation against a captive
counterparty is theater. And the privacy inversion: cross-linking
ledgers is also the deanonymization attack, so §6's rule returns
with force — cross-foot institutions, never individuals.

**Conservation for new quantities.** Carbon offsets are a failed
conservation law wearing green: one retired ton must be retired
exactly once, and the double-counting scandal is that invariant
unenforced — a shared, append-only retirement ledger is triple-entry
for carbon. Ad impressions and engagement metrics invite the same
treatment: quantities everyone reports and nobody conserves.

**Sibling seat.** Honor ships in-family reconciliation today: batch
receipts are second entries in members' hands, and the platform's
published aggregates must reconcile against them — fabricated totals
fail cross-footing against any single member's records, which is the
design converting "trust us" into "catch us"
(<https://github.com/bryanmatthewsimonson/honor>, `docs/TRUST.md`
§§4, 7). The family's ledgers are written to be cross-footed by
adversaries.

---

## §9. One thesis, three claim domains

The maintainer's projects are one thesis instantiated three times:
signed, user-owned attestations plus a web of trust make words
durable and lying expensive. X-Ray applies it to public claims; crux
to claims about documents; Honor and Virtue
(<https://github.com/bryanmatthewsimonson/honor>) to the most
consequential promises ordinary people make.

| Project | Claim domain | Atomic unit | Verification primitive | Standing refusal |
|---|---|---|---|---|
| X-Ray | public claims | the claim (P2) | content-addressed capture; evidence-bound audit; the resolved ledger | computed consensus or authority |
| crux | claims about documents | the document claim | document-anchored provenance chains | — |
| Honor/Virtue | promises between people | the vow / pact / attestation | cosigned events; witnessed milestones; the signed aggregate ledger | conduct surveillance; fault publication |

Two refusals are family law, not local taste. No computed authority
over open sets — X-Ray's red line 1 and Honor's
never-police-or-attribute-fault constitution are the same clause in
two dialects. And no belief optimization: truth made legible,
translated, and taught, never A/B-tested into acceptance (TS H-7) — Honor's no-engagement-farming vow is the same clause
again. The expansion domains above are not six products; they are
this one thesis, offered six more seats.

---

## §10. What this map adds — seeds, not commitments

Nearly everything the six domains suggest is already an annex seed
(TS §2) or a parked question
([`BONDING_NOTES.md`](BONDING_NOTES.md)) — cited there, not
duplicated here. Net-new from this map, each one line, none of them
roadmap:

- **The capture-boundary disclosure rule** (§3): any future claim
  type that touches the physical world states, as a first-class
  field, where its first hash stands relative to the thing itself.
- **The aggregate-with-privacy-floors pattern** (§6): if X-Ray ever
  publishes counting surfaces, Honor's ledger shape — immutable
  aggregates, versioned definitions, suppressed small cells — is the
  imported answer, already proven in-family.
- **The taxonomy as curriculum** (§7): the forensic maneuver
  vocabulary surfaced as reader-facing teaching material, not only
  as findings — inoculation as a product surface.
- **The corpus cross-foot pass** (§8): a mechanical invariant-check
  surface over captured claims — impossible-number and sum checks
  emitted as labeled, disputable findings, never as verdicts.

---

## Bottom line

The essay's imperative survives every correction this document makes
to its examples: verify more things — and more *kinds* of things.
Public claims, documents, promises; custody records, personhood,
markets, government, debate, and the ledgers that must reconcile.
Every domain above wants the same four imports — provenance, priced
confidence, preserved dissent, invariants that must balance — and
every domain invites the same shortcut, which this family refuses in
every dialect it speaks: letting the infrastructure declare the
winner. Truth is a process, not a ruling, and the refusal was never
of the process — it is of the shortcut that skips it. What no
institution has had is infrastructure built for the process itself;
that is what this family is building. Truth infrastructure can make
verification cheap, permanent, and symmetric. The moment it makes
verification *automatic*, it has become the authority it was built
to replace.
