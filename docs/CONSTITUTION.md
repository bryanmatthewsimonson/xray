# The X-Ray Constitution

**Document version:** 1.0.0
**Status:** Normative — supreme
**Date:** 2026-07-22

This document is the constitution of the X-Ray project and of the
decentralized human-consensus protocol it serves. Every other document in
this repository is subordinate to this one. Where any document, prompt,
schema, or line of code conflicts with this document, this document
governs until it is amended (Art. 13). It is machine-checked: the guards
in `tests/constitution-guards.test.mjs` pin its load-bearing clauses, and
a change that breaks a guard is either a bug or an unratified amendment.

---

## How to use this document

Read this document before any structural, normative, scoring, schema, or
wire-format decision, in any part of the project. Citation convention,
binding project-wide:

- A bare `P<n>` (P1–P12) refers exclusively to `docs/PHILOSOPHY.md`
  §1, the audit family's organic statute.
- Articles of this document are cited `CONSTITUTION Art. <n>`.
- Every other document's numbered principle is cited `<DOC> §<n>` —
  never a bare P-number.

When two provisions appear to conflict, document the tension where the
decision is made (commit message, design note, or JOURNAL entry), cite
both by number, and choose the option that best preserves the reader's
ability to audit the system itself. Changes to this document follow
Art. 13 — the constitution keeps an audit trail, because a system built
on immutable history cannot have a mutable constitution.

---

## Preamble — mandate and honest limits

X-Ray exists to abolish lies by exposure, never by deletion: to make
fraud legible, manipulation nameable, journalism improvable, and every
record of words and deeds durable, verifiable, and symmetric — the
operator's own record first. X-Ray, the extension, is the first client
of an intended decentralized human-consensus protocol; this document
governs both the client and every protocol surface the project defines.

What a protocol CAN do: make the record legible, durable,
content-addressed, signed, and re-derivable by strangers; make the cost
of lying visible; keep the path to correction open; and preserve
disagreement at full fidelity so that consensus, where it emerges, is
real. What a protocol CANNOT do: make anyone believe a true thing,
adjudicate intent or hearts, reach what was never recorded, substitute
for courts, or force repentance. The system says so, on every surface
where the difference matters. (The full statement of limits is
`docs/TRUTH_SYSTEMS.md` H-1–H-7, adopted on ratification of that annex.)

The operator's own object-level convictions — about money, about
institutions, about any case this tool is pointed at — are not
constitutional content. They are cases, to be prosecuted under these
rules, exposed to the same adversarial reading as anyone's claims. This
document enshrines method, never its authors' conclusions.

The standing self-check, applied to every amendment and every feature:
**this must remain a document a cult could not have written.** A cult's
founding text demands the frame before the rules, exempts its authors,
and punishes exit. This one states universal obligations with named
debts, binds its operator hardest, and keeps every exit open — forks
are legitimate, the record is portable, and the reader owes the system
nothing but scrutiny.

---

## Article 1 — Definitions and scope

**Operator** — any party running an X-Ray instance and publishing under
its keys. The maintainer is the first operator, not a special one.

**Maintainer** — the holder of merge authority over this repository
(Art. 11).

**Signal families** — the judgment layers this project defines, each
with its own form of judgment and its own wire footprint: assessments
(kind 30054, with 30055 relationships); epistemic audits (kinds
30056–30061); forensic findings (kind 30062); truth adjudication —
verdicts and integrity findings (kinds 30063/30064); the moral lens and
the case-analysis surfaces (hypothesis map, counterfactual, dossier,
synthesis) — derived views with no wire kind; and entity records.

**Measurement / estimation** — as defined by
`TRUTH_ADJUDICATION_DESIGN.md` §1, adopted here project-wide: a
measurement is reproducible and traceable (a count of independent
sources, a Brier score over resolved predictions, a coverage fraction);
an estimation is an approximate evaluative judgment folded into a
number. Measurements are admissible as evidence about a judgment;
estimations are lawful only under the license of Art. 5.

**The constitutional corpus**, in rank order: this document; the organic
statutes (Art. 2); the design documents; code. Higher rank governs
lower.

**Scope** — this document binds every surface of the project: prompts,
schemas, UI copy, wire events, documentation, tests, and the operator's
own published conduct.

## Article 2 — Supremacy and the organic statutes

The rank order of Art. 1 is enforced by the doc-governs-code rule,
generalized from the audit family's practice: where behavior contradicts
the governing document (as amended), the document governs; deterministic
implementation details are revisable at will; parse-time firewalls and
validators are load-bearing law, not style.

The organic statutes, each supreme within its family and subordinate to
this document:

- **`docs/PHILOSOPHY.md`** (v1.1.0+) — the organic statute of the
  epistemic-audit family (kinds 30056–30061). Its twelve principles
  P1–P12 retain their numbering and their text; this document adopts
  the universal ones as project-wide law (Art. 4) and leaves the
  audit-scoped ones (P1's score mechanics, P6's ceiling, P7's
  multiplier) to their family.
- **`docs/TRUTH_ADJUDICATION_DESIGN.md`** §1 and §5 — the organic
  statute of the truth-adjudication family (kinds 30063/30064). Its
  header's "not a derivation of PHILOSOPHY.md" stands: the two statutes
  are siblings under this document, harmonized by Art. 5.

Subordinate documents' internal amendment idiom (`Amended <date> — the
amendment governs`) remains valid within its tier (Art. 13).
`docs/VISION.md`, when it exists, is aspirational and non-normative: it
can inspire proposals, never license features. A capability exists when
a design document under this constitution specifies it, and not before.

## Article 3 — The two missions and their mutual constraint

The project pursues two missions that constrain each other. The
anti-lies mission: make deception legible and costly by exposure. The
anti-censorship mission: never silence anyone. Neither mission may be
pursued by means that defeat the other.

**The only lawful remedy for a lie is a durable, evidence-bound record
beside it — never its removal.** No feature of this system may delete,
suppress, or coerce the deletion of another party's speech, and no
protocol-level mechanism may render speech invisible to a reader who
has asked to see it. A reader's own filters are the reader's own
business; the constitutional line is that filtering is never done *for*
the reader silently.

The purpose of exposure is correction and restoration, not humiliation.
Exposure artifacts state what the evidence shows and what would
constitute correction; corrections received are published with at least
the prominence of the original finding; and the record must always
leave a legible road back for the corrected — a system with no road
back teaches its subjects never to concede, which destroys the record's
supply.

*Roots: Brandeis, Whitney v. California (1927) — "the remedy to be
applied is more speech, not enforced silence"; Jeremiah 36 — the burned
scroll answered by re-publication, with words added.*

## Article 4 — Universal principles

The following principles, restated here in canonical form, are
project-wide law in every signal family. Sources are credited in the
Concord Schedule (Art. 14).

**4.1 Evidence-bound** *(from P3; TRUTH_ADJUDICATION §5.5a).* No
finding, verdict, reading, or synthesis in any family without a
followable citation of a captured artifact. Nothing evidentiary is
typed by hand; evidence is citation of the captured record.

**4.2 The artifact as published** *(from P4; PHILOSOPHY §9).* Judgment
attaches to the exact published text, content-addressed: the hash is
the identity, the URL is metadata. A stealth edit creates a new
artifact, a new lineage, and a diff that is itself a finding.

**4.3 Symmetry** *(from P5).* One standard for every camp, blind to
valence, identity, and the operator's sympathies. The practical test:
if the record is not periodically uncomfortable for every camp —
including the operator's — the calibration is broken.

**4.4 Disagreement is data** *(from P8; CASE_DOSSIER_DESIGN §2.2).*
Every judgment renders beside its rivals. Variance is the honest
headline; the shape of the disagreement is the finding. Nothing
averages disagreement into false consensus, and no case, entity, or
corpus ever carries a fused score.

**4.5 History is immutable** *(from P9).* Append-only everywhere.
Judgments update by supersession with visible lineage, never by edit or
erasure. This applies to the project's own governance: kills, reversals,
and amendments are recorded, never scrubbed.

**4.6 Under-claim** *(from P11).* Bounded findings; the system states
what it could not determine, and declines to judge what it cannot judge
honestly. Declining is a first-class, honorable output.

**4.7 Asymmetric transparency** *(from P12).* Method, weights, prompt
versions, coverage, and the known-unknowns are published. Every output
is re-derivable by a stranger from public materials, or it does not
ship.

**4.8 Atomization** *(from P2).* The claim is the atomic unit.
Judgment attaches to atoms — specific words, specific propositions —
never to a vibe, a narrative, or a person as such.

## Article 5 — The form of judgment and the license of estimation

**5.1 The spine.** Adopted verbatim from
`TRUTH_ADJUDICATION_DESIGN.md` §1, now project-wide law:

> **Verdicts are descriptive states. Quantities are measurements, never
> estimations. Every number shows its derivation from evidence, or it
> does not appear.**

A judgment may be expressed as a score only when what it measures is
(a) genuinely graduated and (b) either low-stakes enough to tolerate
approximation, or rigorous enough to defend at the stakes in play.

**5.2 The license.** An estimation — a crude, approximate, or
aggregated quantity that is not a reproducible measurement — is lawful
**as an instrument** if and only if it satisfies all five conditions:

1. **Declared.** It is labeled an estimate at every surface where it
   appears — machine-readably in stored and wire form, visibly in
   rendered form. The label travels with the number; a number separated
   from its label may not be rendered.
2. **Derived in the open.** Its method — inputs, assumptions, weights,
   prompt versions — is disclosed with it, at the precision the method
   actually has and no more.
3. **Spread-shown.** Where it summarizes more than one input, it
   presents the distribution, range, or variance, never only a point;
   disagreement among inputs stays individually visible (Art. 4.4). A
   point estimate carries its uncertainty or does not appear.
4. **Stakes-bounded.** Its purpose is heuristic — triage,
   prioritization, synthesis of utility too fuzzy to measure. An
   estimation may never be the operative content of a verdict-family
   artifact, never automatically triggers a consequence, and never
   caps, gates, or overrides another family's output.
5. **Firewall-respecting.** It never fuses signals across the
   never-merge firewall (Art. 6), and the signals beneath it remain
   independently retrievable.

An estimation failing any condition does not appear. An estimation
passing all five is not a lesser output to be apologized for: crude,
labeled, method-shown estimates are how finite minds steer, and
refusing them wholesale was itself a form of false precision.

**5.3 Schedule of precedents.** The epistemic audit's 0–100 score with
knowability ceiling is a licensed estimation (limited scope, heuristic
purpose — the original §1 holding). The moral lens's high/medium/low
confidence is a licensed estimation (MORAL_LENS_JURISDICTION_DESIGN
§5.1, the first application of this test). Hypothesis-map edge counts
and counterfactual dependency counts are measurements, untouched by
this article. The assessment stance (−2..+2) is neither: it is a
declared datum — the assessor's self-reported position, trivially
reproducible from its author — and remains quarantined by Art. 6.

**5.4 What remains forbidden.** A fused single number standing where a
distribution belongs. Any estimation as the operative content of a
kind-30063/30064 artifact. A fused case-probability as a case's
headline or verdict — the project's answer to Rootclaim-style scoring
remains no *as a conclusion*; a labeled, method-shown, spread-shown
probability instrument rendered beside (never above) the deterministic
record is a separate feature decision that must pass this article.
Cross-family fusion (Art. 6). Hidden weights (Art. 4.7). Consequences
auto-triggered by estimates.

**5.5 Consensus-adjacent mechanisms.** Aggregation across authors is
lawful as spread-shown distributions with roster and coverage
disclosed. Diversity-weighted convergence (bridging) is admissible in
principle as a *measurement of the disagreement structure* — who ruled
what, and whether raters with divergent prior records converge — under
the constraints of `docs/TRUTH_SYSTEMS.md` §3.3 on its adoption; it may
gate attention, never set a verdict, and stays dormant below a
disclosed minimum-data threshold. Computed *authority* — a consensus
number presented as the network's judgment — remains forbidden.

## Article 6 — The never-merge firewall

The signal families of Art. 1 answer different questions: what do I
think of it; how well was it made; what maneuvers does it perform; is
it true; how would a named perspective read it; what does the corpus
contain. **Composition is lawful; fusion is not.** A verdict may cite a
forensic finding as evidence; a dossier renders every family side by
side. But no number or state in one family may be computed *from*
another family's judgment such that the reader can no longer tell which
family is speaking, and consumers MUST NOT merge them.

The firewall's linguistic arm: the reserved vocabulary (Verdict,
Ruling, Opinion, Court, Integrity) belongs to the truth family and
never appears in other families' exports, storage keys, or UI strings.
The firewall's wire arm: kind 30066 stays free, kind 30065 stays
reserved, and retired kinds are never reused (Art. 10). Both arms are
guard-tested.

## Article 7 — Targets of criticism

Criticism attaches to **behaviors, claims, and artifacts — never to
identities or groups.** The derivation is the reverse-criticism test:
no criticism is worthwhile if it cannot be withstood in reverse. A
criticism of what someone *is* cannot be answered, corrected, or
repented of — it is not criticism but attack. A criticism of what
someone *said or did* can be answered, and the answer becomes part of
the record.

Accordingly: entities accumulate records through their artifacts, and
are never judged for who they are (PHILOSOPHY §0); verdicts attach to
propositions, not persons (TRUTH_ADJUDICATION §5); intent is never
adjudicated — structure, not intent, in every family; living persons
get published-positions-only reconstruction; and good-faith-wrong is
never treated as bad-faith.

## Article 8 — The plank protocol

The operator is bound first, hardest. This article generalizes P10
project-wide and makes it concrete.

*Roots: the plank protocol takes its name and its order of operations
from Matthew 7:1–5 — the plank comes out of the operator's eye before
anyone's speck is touched. Stated here as attribution of origin, not as
a confessional requirement.*

1. **First subject.** The tool runs on its operator first. Before the
   operator publishes a judgment-family artifact about another party at
   a given rigor tier, at least one artifact of the operator's own
   authorship must have been run through the same pipeline at the same
   tier, with results retained under the same rules. The operator's
   published corpus is a standing member of the operator's own audit
   queue.
2. **The exposure file.** The operator maintains a dated record of
   conflicts, memberships, priors, and history with named subjects —
   and discloses from it before exposing anyone else's conflicts.
3. **The reverse-forensic pass.** Before publishing operator-authored
   criticism, the forensic maneuver taxonomy is run against the
   operator's own draft; findings are resolved or published unresolved
   with the artifact. The detector pointed outward points inward first.
4. **The reverse-criticism attestation.** Each operator-authored
   criticism records the answer to: would I accept this standard
   applied to me, by my least charitable critic, on my worst day? A
   "no" is a publication bar; a recorded "yes" is disputable like
   everything else.
5. **Corrections at operator grade.** The operator's corrections
   receive at least the prominence of the original claim — the
   strictest correction standard in the system is the one the operator
   bears.
6. **No special cases in code.** No code path may condition on the
   operator's identity. The operator's key never appears in source.
   Guard-tested (Art. 12).
7. **Severity order.** Where any standard in this document admits
   degrees, it binds the operator at the strictest degree. Ties resolve
   against the operator.

Obligations 1–5 bind as discipline from ratification, using existing
machinery; their dedicated surfaces (the Plank Check, the Respect Gate,
the About-Me view — `docs/PERSONAS.md` §6) are roadmap seeds, advisory
by design, never blocking: a safeguard that blocks becomes a censor; a
safeguard that records becomes a conscience.

## Article 9 — The college of personas

The project's judgment surfaces answer to named offices — idealized
standards with jurisdictions, non-negotiables, and known failure modes
— chartered in `docs/PERSONAS.md`, which enters the Concord Schedule as
an organic statute on its adoption. Whatever its content, any college
must satisfy these constraints:

- A persona is a **named jurisdiction with a cited corpus** — it speaks
  from its corpus, on its authority, never as the system's own voice
  (the Phase-16 architecture is the constitutional pattern).
- Persona output is perspectival reconstruction, never a verdict
  (Art. 6).
- The college must span priors such that Art. 4.3's discomfort test can
  bind — a college that always agrees with the operator is broken.
- Personas of living persons obey published-positions-only.
- No office is unchecked; no office checks itself.

## Article 10 — The wire covenant

The project's obligations to strangers consuming its events:

- Every published event is third-party verifiable — signed and
  content-addressed — with no trust in the operator required. The
  system's claims must remain checkable if its operators disappear or
  defect.
- Tolerant read, strict write. Wire-format changes are called out
  explicitly in every PR that makes them.
- Kind numbers are never reused after retirement, and reservations are
  honored. The schedule:

| Kind | Status | Family |
|---|---|---|
| 0, 10002, 3 (opt-in), 1985 | active | profiles, relay lists, follow mirror, label mirrors |
| 30023 | active | articles, case briefs, entity pages |
| 30040, 30041 | active | claims, comments |
| 30050–30053 | active | crowdsourced URL metadata (`docs/NIP_DRAFT.md`) |
| 30054, 30055 | active | assessments, cross-claim relationships |
| 30056–30061 | active | epistemic-audit family |
| 30062 | active | forensic findings |
| 30063, 30064 | active | verdicts, integrity findings |
| 30065 | reserved | precedent (unimplemented) |
| 30066 | free | permanently unassigned — the lens has no wire kind |
| 30067 | retired | fact sheets — never reuse |
| 30043 | retired | evidence — never reuse |
| 30068, 30069 | active | CaseBrief, OwnedKeys |
| 30078, 32125, 32126 | active | entity-sync, entity↔article, platform accounts |

The table covers the kinds this project defines, reserves, or has
retired; standard NOSTR kinds it merely consumes or mirrors are used
per their own specifications.

- Supersession semantics hold on every addressable kind (Art. 4.5).
- Durability is multi-relay redundancy plus the bundled signed-event
  JSON — the relays are the artifact; no central archive is the
  authority.
- Machine suggestions carry model-identity provenance
  (`suggested_by`), permanently.

## Article 11 — Governance

**Merge authority.** The maintainer alone merges to `main`. Agents
author PRs and never merge. A maintainer merge is the ratifying act for
any normative change.

**Decision recording.** Every decision that accepts a design, kills a
feature, or resolves an open question is recorded in `docs/JOURNAL.md`
with date and rationale. Agent–maintainer disagreement is recorded, not
silently resolved — disagreement is data internally too (Art. 4.4
applied to governance).

**Kill-and-revisit.** A kill is recorded with rationale and left
git-recoverable. A killed plan is not frozen doctrine: every inherited
decision may be re-argued on merits (the 2026-07-08 precedent,
JOURNAL). Only an explicit red line requires a Tier-1 amendment to
reverse.

**The JOURNAL discipline** is Art. 4.5 applied to the project itself:
the append-only history of how the rules were made, kept with the same
care as the records the rules govern.

## Article 12 — Red lines and enforcement

The system must never:

1. Delete, suppress, or coerce the deletion of another party's speech,
   or silently filter speech for a reader who asked to see it (Art. 3).
2. Average away disagreement into false consensus, or let a fused
   number stand where a distribution belongs (Art. 4.4).
3. Launder an estimation into a verdict — any estimation as the
   operative content of a verdict-family artifact (Art. 5).
4. Fuse signals across the never-merge firewall (Art. 6).
5. Attach criticism to an identity or group, or adjudicate intent
   (Art. 7).
6. Exempt the operator from any standard, in code or in practice
   (Art. 8).
7. Erase, overwrite, or silently mutate published history (Art. 4.5).
8. Apply different standards by political valence, or tune any method
   toward a desired outcome for any target (Art. 4.3).
9. Claim or imply verification that was not performed (Art. 4.6).
10. Hide method — weights, versions, prompts, coverage, or the
    known-unknowns log (Art. 4.7).

The enforcement formula, adopted verbatim from PHILOSOPHY §10: a
proposed feature that requires crossing a red line **is not a feature;
it is a different, worse system.**

Machine enforcement: the normative documents are guard-tested
(`tests/constitution-guards.test.mjs`, and each family's own guards). A
PR that breaks a constitutional guard is, by definition, either a bug
or an unratified amendment; CI treats both the same way. Guards follow
the house idiom: a positive sanity assertion proving the scanner sees,
then the negative assertion that enforces.

## Article 13 — Amendment

Three tiers:

- **Tier 1 — constitutional.** Articles of this document, and red
  lines anywhere in the corpus. Requires: a version bump, a dated entry
  in the Amendment log, a written rationale, **an explicit statement of
  the failure mode the change accepts** (for any removal or weakening
  of a norm), a JOURNAL entry, and a maintainer merge. Silent edits are
  void (Art. 4.5).
- **Tier 2 — prescriptive.** Normative sections of organic statutes
  and design documents. The established inline idiom applies
  (`Amended <date> … the amendment governs`), with the failure-mode
  statement required when weakening a norm.
- **Tier 3 — implementation.** Deterministic implementation details:
  ordinary PR under doc-governs-code. No ceremony.

## Article 14 — Ratification and the Concord Schedule

This constitution is ratified by maintainer merge to `main`; the merge
commit is the ratification signature. All pre-existing documents
continue in force except at the concord points enumerated here.

**Concord Schedule** — the article-to-source map, machine-checked by
the guards:

| Provision | Source | Concord |
|---|---|---|
| Art. 4.1–4.8 | PHILOSOPHY.md P3, P4/§9, P5, P8, P9, P11, P12, P2 | P-headings pinned |
| Art. 4.4 | CASE_DOSSIER_DESIGN.md §2 "No case-level score, ever" | text pinned |
| Art. 5.1 | TRUTH_ADJUDICATION_DESIGN.md §1 (the spine, quoted verbatim) | two-sided quote pin |
| Art. 5.3 | MORAL_LENS_JURISDICTION_DESIGN.md §5.1 | heading pinned |
| Art. 6 | EPISTEMIC_AUDIT_DESIGN.md firewall; MORAL_LENS §5.2 reserved words | lens-guards |
| Art. 12 | PHILOSOPHY.md §10 (enforcement formula, quoted verbatim) | two-sided quote pin |
| Organic statute | PHILOSOPHY.md v1.1.0 (audit family) | version + concord sentence pinned |
| Organic statute | TRUTH_ADJUDICATION_DESIGN.md §1/§5 (truth family) | §-headings pinned |
| On adoption | docs/PERSONAS.md (Art. 9) | enters schedule when merged |
| On adoption | docs/TRUTH_SYSTEMS.md (Preamble, Art. 5.5) | enters schedule when merged |

Concord points enacted with this document's ratification:

1. `docs/PHILOSOPHY.md` is amended (its own §13, to v1.1.0) from "the
   constitution of the X-Ray Epistemic Auditor" to the organic statute
   of the audit family under this document. No principle or red line
   is altered; P-numbering is canonical project-wide.
2. The breadth of the 2026-07-03 aggregation kill is superseded per
   Art. 5, under the kill-and-revisit rule (Art. 11); the kill's entry
   remains visible, and its two operative same-day decisions stand as
   ordinary history.
3. `docs/TRUTH_ADJUDICATION_DESIGN.md` gains a status line recording
   its role as an organic statute; its non-derivation header stands.

---

## Amendment log

Amendments follow Art. 13, Tier 1. Silent edits are void.

**v1.0.0 — 2026-07-22.** Initial ratification. Fourteen articles:
definitions; supremacy and the organic statutes; the two missions'
mutual constraint; eight universal principles; the form of judgment and
the license of estimation (enacting the aggregation reopening); the
never-merge firewall; targets of criticism; the plank protocol; the
college of personas; the wire covenant; governance; red lines and
enforcement; three-tier amendment; ratification and the Concord
Schedule. Register: universal operative text, roots credited by name
(maintainer decision, 2026-07-22). Failure modes accepted and named:
Art. 5 accepts that licensed estimates can be misread as authority
despite labels (mitigated by the five conditions and Art. 6); Art. 2
accepts that audit-family law can be overridden by a document written
later than it (mitigated by verbatim adoption of its universal
principles and the two-sided guard pins).

---

## Credo

Truth is not a weapon the strong may aim; it is the ground the weak may
stand on. This system wins nothing by silencing, everything by
recording. An outsider with full transparency, modest claims, and a
published method beats an insider with privileged access and unstated
priors — over the body of work, on every timescale that matters. The
constitution's promise is narrower than its ambition and stronger for
it: within these forms, a lie must expose its evidence to be
well-formed at all; outside them, it is visibly formless; and in either
case, the liar signs.
