# Rulings ledger

**Status:** binding, as `docs/CONSTITUTION.md` Art. 2 states (R-023).
Created 2026-09-26 (R-022).

This ledger lists the maintainer's rulings. Each ruling has an ID of
the form `R-NNN` and records: the date; who ruled; the maintainer's
own words; what it applies to; what it supersedes; and the automatic
test ("guard") that fails if the rule's pinned text or code changes.
A ruling's row quotes the maintainer's own words. JOURNAL entries cite
a ruling's ID instead of restating it. A check fails the build when a
file cites an `R-NNN` ID that this ledger does not list.

## Rulings recorded before 2026-09-26 (seed rows)

These seventeen rows are copied from
`docs/ideas/GOVERNANCE_RECONCILIATION_QUESTIONNAIRE.md` §5, "the
already-reconciled ledger", which lists them as recorded rulings.
R-017 is updated to the maintainer's "relay" ruling (MARGIN_DESIGN
§12.6); §5 listed it as provisional. §5 does not quote the
maintainer's words, or name what each row supersedes or the guard that
pins it, so this table does not carry those fields.

**Status of these rows: pending.** The maintainer has not confirmed
them, and merging this ledger does not confirm them. A pending row
binds nothing by itself; each decision keeps whatever force its own
record (the Record column) gives it. Only a recorded instruction from
the maintainer removes "pending". [INTERPRETATION: Claude, 2026-09-26
— default: pending rows bind nothing by themselves; ask: Should the 17
older rows bind from merge day, or only once you confirm each?]

| ID | Ruling | Date | Record |
|---|---|---|---|
| R-001 | Opaque weights superseded by P12/§4 (published, versioned weights) | 2026-07-23 | FOUNDING_TRANSCRIPT supersession log |
| R-002 | Volatility metric dropped (newsroom-only) | 2026-08-02 | supersession log |
| R-003 | 30d/6m/2y re-audit cadence dropped; event-driven re-evaluation; PHILOSOPHY §5 amended | 2026-08-02 | supersession log; PHILOSOPHY §13 v1.1.0 |
| R-004 | Adversarial/red-team reviewer dropped as audit machinery (lives on as the forensic counter-read) | 2026-08-02 | supersession log |
| R-005 | Auditor's standing self-dossier narrowed (P10 v1.1.0) | 2026-08-02 | supersession log; PHILOSOPHY §13 |
| R-006 | Reach weighting demoted to optional display view | 2026-08-02 | supersession log |
| R-007 | Triage queue parked, not superseded | 2026-08-02 | supersession log |
| R-008 | Public relays only; no self-hosted relay | 2026-07-03 | JOURNAL (owner decision) |
| R-009 | Consensus/aggregation direction killed → narrowed to the Art. 5 license (computed authority stays dead) | 2026-07-03 → 2026-08-02 | JOURNAL both dates |
| R-010 | Art. 8 made gateless on maintainer review (accountability on the published record, never a pre-publication gate) | 2026-07-22 | JOURNAL 2026-08-02 entry |
| R-011 | Art. 9 redrawn from "college of personas" to derived discipline standards | 2026-07-22 | JOURNAL 2026-08-02 entry; DISCIPLINES §13-equivalent log |
| R-012 | MA.6 whole-unit disclosure (reversing the agent-codified review-gate rule) | 2026-07-29 | JOURNAL |
| R-013 | All fifteen 1.0 kill candidates ratified ("kill them all"), then executed with per-entry re-vet notes governing | 2026-08-09 | JOURNAL; ROAD_TO_1_0 status notes |
| R-014 | Phase-9a kinds reclassified reserved-not-retired; never-reuse holds for both | 2026-08-09 | JOURNAL; CONSTITUTION Art. 10 |
| R-015 | The membrane: accept-only incorporation | 2026-07-16 | NETWORK_CLIENT_DESIGN header maintainer decisions + §5 recorded decisions |
| R-016 | "Suggest provenance is grounded" — quote-as-search-key contract, with its second-guessable calls recorded | 2026-07-03 | JOURNAL |
| R-017 | Margin user copy says "relay"; the ux review's "server" swap, an interpretation of "NOSTR stays invisible", overruled | 2026-08-28 | MARGIN_DESIGN §10 row 6, §12.6 |

## 2026-09-26 — the R1 reconciliation session

On 2026-09-26 the maintainer answered the six decisions of
`docs/RESET_PLAN.md` §4.3 (D1–D6). The maintainer chose the plan's
default option on all six, and answered D6's separate lens question
"Yes: allow a lasting cache". The answers and the maintainer's words
are also kept in `docs/ideas/GOVERNANCE_RECONCILIATION_QUESTIONNAIRE.md`
§6. Under "Applies to", each row quotes the plan's text for the
chosen option (for R-024 and R-025, also the decision card's text);
those are not the maintainer's words. On 2026-09-26 the maintainer
also answered the fourteen before-merge questions of PR #403. Under
"Before-merge answers (2026-09-26, PR #403)", a row quotes each
question as the PR's questions page put it (not the maintainer's
words), then the answer chosen and the maintainer's words, verbatim.

### R-018 — The never-merge rule: which parts stay law? (D1)

- **Ruled:** 2026-09-26, by the maintainer, in the R1 session.
- **Answer chosen (verbatim):** Plan default: core sentence as law, rest as guidance
- **In the maintainer's words:**

  > The data itself differentiates what is happening. Let design deal with that rather than Claude's interpretation. Also, there's no point in permanently banning a wire kind that never gets published; It shouldn't exist in that case.

- **Applies to:** the chosen option, in the plan's words
  (`docs/RESET_PLAN.md` §4.3, row D1, "Recommended default"):

  > Art. 6 becomes its one data-arm sentence plus "side-by-side composition is always lawful"; the linguistic arm becomes naming guidance ("verdict" stays the truth kind's *name*); the wire arm folds into Art. 10 (never-reuse kept; 30066 "reserved — lens, if ever ratified"); the visual arm becomes one guidance line ("scores and stances never share a color scale"). Remove C2; demote C7/C8

  Text the same row names as touched: Art. 6, Art. 10 row 30066, Art. 12 red line 4 (narrowed to the data arm).
- **Supersedes:** the earlier text that this PR amends under this ruling, as listed in the D1 paragraph of the 2026-09-26 entry in the `docs/CONSTITUTION.md` amendment log and in the other amendment-log entries and dated notes in this PR that cite R-018.
- **Pinned by:** `tests/constitution-guards.test.mjs` 'guard: the Art. 10 kind schedule matches the code — retired and reserved kinds unemitted'; `tests/lens-guards.test.mjs` 'guard: no builder in src/ emits kind 30066, and no constant reserves it'; `tests/wire-fixtures.test.mjs` NEVER_EMITTED; `tests/extraction-publish.test.mjs` 'GUARD: kind 30070 is the ONLY kind this module emits (no mirror, no twin)' (its never-30065/30066/30067 half). No test pins Art. 6's wording.
- **Record:** `docs/ideas/GOVERNANCE_RECONCILIATION_QUESTIONNAIRE.md` §6; JOURNAL 2026-09-26.
- **Before-merge answers (2026-09-26, PR #403):**
  - **Q5 (S5), Kind 30066:** Should the constitution keep a row reserving event kind 30066 for the lens?
    - **Answer chosen (verbatim):** OK: keep the reserved row and its risk sentence
    - **In the maintainer's words:**

      > Moral lenses are merely out of focus right now while bug fixes and other features are focused on. They will be reinstated so we need to keep the wire kind reserved.

  - **Q6b (S6), The deleted lens word checks:** Should any of the deleted lens word checks come back as tests?
    - **Answer chosen (verbatim):** OK: no, none comes back
    - **In the maintainer's words:**

      > These are words for features. They're useful inasmuch as they describe which feature they refer to. But the product continues to evolve.

  - **Q11 (S12), Word-for-word pins:** Should this PR also delete the two word-for-word test pins the 2026-09-05 governance audit said to keep: Art. 3's "never its removal" sentence, and Art. 5.1's core sentence, checked in both documents?
    - **Answer chosen (verbatim):** OK: no, keep those two
    - **In the maintainer's words:**

      > Doesn't matter that much.

### R-019 — Which summary numbers X-Ray may show (D2)

- **Ruled:** 2026-09-26, by the maintainer, in the R1 session.
- **Answer chosen (verbatim):** Plan default: define "fused" and name three first numbers
- **In the maintainer's words:**

  > This is such an unimportant question for a feature that is rarely used across a wide range of articles. Estimation and aggregation was the original point of the epistemic audit feature, so the rules needed to be loosened.

- **Applies to:** the chosen option, in the plan's words
  (`docs/RESET_PLAN.md` §4.3, row D2, "Recommended default"):

  > Keep Art. 5.2's five conditions as the license; **define "fused"** ("a single number or state computed from more than one family's judgment, or presented without its inputs, method, spread and n"); declare the first licensed instruments: a corpus mean + range + n beside the subject dossier's existing one, the §3.5 commitments ratio that `truth-entity-record.js` already computes, a labeled case "evidence balance" rendered beside — never above — the dossier header; "does not appear" renders as "estimate withheld: <failed condition>" (Art. 3)

  Text the same row names as touched: Art. 4.4 ("no case, entity, or corpus ever carries a fused score" — narrowed by the definition), Art. 5.4's third sentence (the case-headline rule, kept), Art. 12 red line 2, PHILOSOPHY P8 (unchanged: inputs stay individually visible).
- **Supersedes:** the earlier text that this PR amends under this ruling, as listed in the D2 paragraph of the 2026-09-26 entry in the `docs/CONSTITUTION.md` amendment log and in the other amendment-log entries and dated notes in this PR that cite R-019.
- **Pinned by:** a unit test of `isLicensedEstimate()` (`tests/estimate.test.mjs`); no product output is checked yet.
- **Record:** `docs/ideas/GOVERNANCE_RECONCILIATION_QUESTIONNAIRE.md` §6; JOURNAL 2026-09-26.
- **Before-merge answers (2026-09-26, PR #403):**
  - **Q6a (S7), The 24 kept word lists:** May the 24 kept word-list tests stay until 2026-12-25?
    - **Answer chosen (verbatim):** OK: they stay until 2026-12-25
    - **In the maintainer's words:**

      > I don't know why there is anything banning words at all within X-Ray. That's counterproductive to the goals of the project, which is about truth and accuracy and research. Words have definitions for a reason, therefore they should be allowed to be used where the definition fits. That does not exempt any user from being required to be disciplined and be held to the same standards.

  - **Q6c (S7), Agent-picked person-label words:** In four of the kept lists, an agent picked the words it judged to be person labels (such as "liar" and "credibility") and tied them to your ruling R-020, so those words never expire. Do those marks stand?
    - **Answer chosen (verbatim):** OK: the marks stand
    - **In the maintainer's words:**

      > Opinions are opinions. This is not relevant until the product is actually used.

  - **Q10 (S11), Where "fused" is defined:** Should "fused" be defined once, in Art. 1, for the three places that use it (Art. 4.4, Art. 5.4 and red line 2)?
    - **Answer chosen (verbatim):** OK: once, in Art. 1
    - **In the maintainer's words:**

      > This doesn't matter that much.

### R-020 — The two rules that protect people (D3)

- **Ruled:** 2026-09-26, by the maintainer, in the R1 session.
- **Answer chosen (verbatim):** Plan default: keep both rules, make small edits at the edges
- **In the maintainer's words:**

  > This is honestly a little too abstract for me to know all of the implications right now. These features need to be exercised for me to get a better sense of how they will evolve and their potential for abuse. But one of the goals of X-Ray is to identify behaviors that are manipulative or deceitful. Keeping track of who says/does such things is critically important. The point is not to avoid judgment--we all judge!--but to do it better.

- **Applies to:** the chosen option, in the plan's words
  (`docs/RESET_PLAN.md` §4.3, row D3, "Recommended default"):

  > Keep the §3.1 gate and no-auto-person-label as law; strike "permanently" from TS H-2; add "disclosure is not criticism" to Art. 7; 30064 no-mirror stays as a default; read-side null becomes visible not-admitted

  Text the same row names as touched: Art. 7 (one sentence added), TS H-2 (one word struck).
- **Supersedes:** the earlier text that this PR amends under this ruling, as listed in the D3 paragraph of the 2026-09-26 entry in the `docs/CONSTITUTION.md` amendment log and in the other amendment-log entries and dated notes in this PR that cite R-020.
- **Pinned by:** `tests/truth-taxonomy.test.mjs` 'truth-taxonomy: the firewall — interpretation and stated-value are never truth-adjudicable'; `tests/truth-verdict-model.test.mjs` 'verdict: THE FIREWALL — no verdict on interpretation or stated-value'; `tests/truth-builders.test.mjs` '30063: the firewall holds on the wire — build AND parse' (its build half; its read-side null half pins the behaviour R-020 replaces in a later PR) and '30063 mirror: labels the claim coordinate, never a pubkey'; `tests/entity-dossier.test.mjs` 'dossier: grade-word string guard — no scores, grades, or liar-class labels anywhere' (its person-label words); `tests/entity-page-publish.test.mjs` 'markdown: no judgment vocabulary — the §3.5 wire posture', `tests/entity-page.test.mjs` 'digest: deterministic, capped, key-first, distributions-only — and no banned vocabulary' and `tests/entity-profile.test.mjs` 'profile about: no judgment vocabulary, ever (§3.5 on the wire hardest of all)' (their person-label words).
- **Record:** `docs/ideas/GOVERNANCE_RECONCILIATION_QUESTIONNAIRE.md` §6; JOURNAL 2026-09-26.
- **Before-merge answers (2026-09-26, PR #403):**
  - **Q4 (S4), The Art. 7 sentence:** Which sentence goes into Art. 7?
    - **Answer chosen (verbatim):** OK: "An exposure file (PHILOSOPHY §3.3) is disclosure, not criticism."
    - **In the maintainer's words:**

      > Abundant accurate information is the goal. Sometimes that requires disclosure of critical details. All of this is based on existing public data anyway, so this is not an issue.

### R-021 — Which written rules overrule the working product (D4)

- **Ruled:** 2026-09-26, by the maintainer, in the R1 session.
- **Answer chosen (verbatim):** Plan default: documents win only where outsiders depend on them
- **In the maintainer's words:**

  > DISCIPLINES was always about advice in the first place. Claude has a habit of overinterpreting things, including the quote "governance docs are to be grounded in the design skill, not the other way around"-- which was my original attempt to state that the governance was becoming unwieldy and needed to give way to design considerations. But Claude misinterpreted that to mean that I don't care about governance as much as design. In fact, it is the over-interpretation and brittle logic that needed to be stopped. My actual preferences were not even being considered due to Claude believing that I had already ruled with ironclad law on a given subject previously. Claude is great at code and bad at judgement.

- **Applies to:** the chosen option, in the plan's words
  (`docs/RESET_PLAN.md` §4.3, row D4, "Recommended default"):

  > Narrow Art. 2's doc-governs-code to wire / schema / security; elsewhere a code-vs-doc conflict is a recorded question for the maintainer, not an automatic doc win; DISCIPLINES becomes guidance (prompt-header lint stays); rule on §15.3: bulk-accept of individually grounded rows is lawful — the grounding is the review; H-7 scoped to judgment surfaces

  Text the same row names as touched: Art. 2 (narrowed), DISCIPLINES §15 standard 3 (reversed — named as such), TS H-7 (scoped).
- **Supersedes:** the earlier text that this PR amends under this ruling, as listed in the D4 paragraph of the 2026-09-26 entry in the `docs/CONSTITUTION.md` amendment log and in the other amendment-log entries and dated notes in this PR that cite R-021.
- **Pinned by:** `tests/disciplines.test.mjs` 'guard: every "You are" prompt file carries a registered Standards header' (the prompt-header lint that stays). No test pins Art. 2's wording.
- **Record:** `docs/ideas/GOVERNANCE_RECONCILIATION_QUESTIONNAIRE.md` §6; JOURNAL 2026-09-26.
- **Before-merge answers (2026-09-26, PR #403):**
  - **Q2 (S2), The constitution's own force:** Should the constitution itself still overrule the working product automatically?
    - **Answer chosen (verbatim):** OK: yes, the constitution still wins
    - **In the maintainer's words:**

      > We still need governing docs to avoid breaking important rules. The main thing these amendments fix is Claude's misinterpretations.

### R-022 — How the maintainer's decisions get recorded and ratified (D5)

- **Ruled:** 2026-09-26, by the maintainer, in the R1 session.
- **Answer chosen (verbatim):** Plan default: labels, a rulings ledger, the three lines written down, Art. 11 amended
- **In the maintainer's words:**

  > This is the correct direction to make decisions explicit and identify where AI interpretation is defaulted. This is good discipline and ensures that the human maintains control of the project.

- **Applies to:** the chosen option, in the plan's words
  (`docs/RESET_PLAN.md` §4.3, row D5, "Recommended default"):

  > Adopt, or amend and then adopt, the marker protocol (§4.4); create and seed the rulings ledger; write "NOSTR stays invisible — interfaces never require NOSTR literacy; not a vocabulary ban", "high value solo first", "Apple-quality simplicity" down with their force stated; amend Art. 11 so that the maintainer's explicit recorded instruction is the ratification and who presses the merge button is mechanical (it has been waived twice on the record, JOURNAL 2026-08-04)

  Text the same row names as touched: Art. 11 (ratification wording; and its literal "recorded in `docs/JOURNAL.md`" — the ledger and the per-month split change where a decision is recorded).
- **Supersedes:** the earlier text that this PR amends under this ruling, as listed in the D5 paragraph of the 2026-09-26 entry in the `docs/CONSTITUTION.md` amendment log and in the other amendment-log entries and dated notes in this PR that cite R-022.
- **Pinned by:** the ruling-ID check added in this PR. No test pins Art. 11's wording.
- **Record:** `docs/ideas/GOVERNANCE_RECONCILIATION_QUESTIONNAIRE.md` §6; JOURNAL 2026-09-26.
- **Before-merge answers (2026-09-26, PR #403):**
  - **Q1 (S1), Dependabot:** May any class of change merge without your click? If yes, write one line in your own words naming it, for example "Dependabot dev-tool and CI-action updates may merge when the checks pass".
    - **Answer chosen (verbatim):** OK: nothing merges without my click
    - **In the maintainer's words:**

      > It is important for me to review everything before it merges.

  - **Q1b (S1), The risk sentence for standing instructions:** Does this drafted risk sentence say what you accept: "a change inside a class that a standing instruction names can merge without anyone reading it"?
    - **Answer chosen (verbatim):** Something else — I'll say it below
    - **In the maintainer's words:**

      > Nothing merges without my approval.

  - **Q7 (S8), Your go-ahead:** Is your go-ahead valid when it is quoted in your own words, on the PR or in the ledger, before the merge, including when an agent quotes your chat on the PR?
    - **Answer chosen (verbatim):** OK: yes, as described
    - **In the maintainer's words:**

      > Yes, I am allowed to instruct an agent to merge.

### R-023 — Which documents bind, and the lens cache (D6)

- **Ruled:** 2026-09-26, by the maintainer, in the R1 session.
- **Answer chosen (verbatim):** Plan default: four binding documents, the rest advice or archive
- **In the maintainer's words:**

  > This is the correct narrowing of the power of the governance docs, and states explicitly what is binding. Having rulings be explicitly identified seems to be the right approach. This removes ambiguity from Claude while also giving me flexibility. Binding rules have their place, and realtime tradeoff decisions have their place.

- **Applies to:** the chosen option, in the plan's words
  (`docs/RESET_PLAN.md` §4.3, row D6, "Recommended default"):

  > Normative set of four documents (CONSTITUTION ≈450 lines; PHILOSOPHY; a rulings ledger; a one-page surface-constraints index); everything else guidance or archived with a banner (Art. 3, nothing deleted); #364 merge, #366 merge as the answered record, #365 fold to ≤120 lines; lens durable local cache is an ordinary feature

  Text the same row names as touched: Art. 2's list of organic statutes and the non-normative tier (TS and DISCIPLINES move to guidance).
- **Supersedes:** the earlier text that this PR amends under this ruling, as listed in the D6 paragraph of the 2026-09-26 entry in the `docs/CONSTITUTION.md` amendment log and in the other amendment-log entries and dated notes in this PR that cite R-023.
- **Pinned by:** none.
- **Record:** `docs/ideas/GOVERNANCE_RECONCILIATION_QUESTIONNAIRE.md` §6; JOURNAL 2026-09-26.
- **Before-merge answers (2026-09-26, PR #403):**
  - **Q3 (S3), TRUTH_ADJUDICATION:** Should TRUTH_ADJUDICATION §1 and §5 stay a fifth binding document?
    - **Answer chosen (verbatim):** OK: no, four documents bind
    - **In the maintainer's words:**

      > Truth adjudication is a writeup for a product feature, like PHILOSOPHY.md. Claude's misinterpretation made it something more, although that was not without its usefulness.

  - **Q8 (S9), The screen-rules page:** Should the one-page list of what a screen may and may not do only point to rules written elsewhere, rather than hold rules of its own?
    - **Answer chosen (verbatim):** OK: it only points
    - **In the maintainer's words:**

      > This is all theoretical until it is actually used.

  - **Q9 (S10), When the ledger and another document disagree:** When a ledger row and PHILOSOPHY or a design document disagree, which wins? And does adding or correcting a ledger row need an amendment ceremony?
    - **Answer chosen (verbatim):** OK: neither wins automatically
    - **In the maintainer's words:**

      > Allows me to continue to rule while using governing docs as guidelines.

### R-024 — Integrity findings (kind 30064) keep no label copy (a kind-1985 mirror event), as a default (D3)

- **Ruled:** 2026-09-26, by the maintainer, as part of the D3 answer (R-020).
- **Answer chosen (verbatim):** Plan default: keep both rules, make small edits at the edges
- **In the maintainer's words:** none beyond the answer above; the D3 answer's words are quoted under R-020.
- **Applies to:** in the plan's words (`docs/RESET_PLAN.md` §4.3, row D3):

  > 30064 no-mirror stays as a default

  The D3 decision card, as shown to the maintainer on 2026-09-26:

  > The missing label copy for integrity findings is recorded as a default, to revisit if another app asks for it.

- **Supersedes:** nothing; kind 30064 events already carry no kind-1985 label copy.
- **Pinned by:** none.
- **Record:** `docs/ideas/GOVERNANCE_RECONCILIATION_QUESTIONNAIRE.md` §6; JOURNAL 2026-09-26.

### R-025 — The moral lens may keep a lasting local cache (D6)

- **Ruled:** 2026-09-26, by the maintainer, as D6's separate lens question.
- **Answer chosen (verbatim):** Yes: allow a lasting cache
- **In the maintainer's words:** none beyond the answer above; the D6 answer's words are quoted under R-023.
- **Applies to:** the D6 decision card's lens question, as shown to the
  maintainer on 2026-09-26:

  > if you revive the moral lens, may it save its readings on your computer?

  In the plan's words (`docs/RESET_PLAN.md` §4.3, row D6):

  > lens durable local cache is an ordinary feature

  The card's option text, then its effort line:

  > It may keep readings on your computer like any ordinary feature. It gets no wire kind (no published event number) and publishes nothing.

  > No product code changes while the lens stays parked. If it returns, a lasting cache is an ordinary feature PR, and that PR also excludes the cache from backups.

- **Supersedes:** the session-only rule for lens readings, "never durably written" (`docs/MORAL_LENS_JURISDICTION_DESIGN.md` §6; questionnaire Q15, firewall F12), as listed in the dated notes in this PR that cite R-025.
- **Pinned by:** `tests/lens-guards.test.mjs` 'guard: lens modules export no wire builders (no lens event exists to build)' pins "publishes nothing"; no test pins the cache permission. Until the lens-cache PR, three tests in `tests/lens-engine.test.mjs` pin today's session-only code: 'runLensPass: assembles the §7 object — identity stamped from the registry, zero durable writes'; 'cache: round-trips through storage.session and never touches storage.local'; 'cache: with NO session area it declines — it must not fall back to local'.
- **Record:** `docs/ideas/GOVERNANCE_RECONCILIATION_QUESTIONNAIRE.md` §6; JOURNAL 2026-09-26.
