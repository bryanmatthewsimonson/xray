# Dev-process discipline skills

Eight review disciplines for **how the software gets built**, written
in the `docs/DISCIPLINES.md` §0 method: the idealized-practitioner
question as elicitation scaffolding, first principles extracted,
numbered checkable standards, and each discipline's characteristic
failure mode named beside the standard that counters it. No
discipline exempts itself.

**Scope, and what this is not.** `docs/DISCIPLINES.md` governs the
disciplines the *product* draws on — how X-Ray judges truth. These
skills govern the *engineering process* — how X-Ray gets built. They
are Tier-3 process tooling under CONSTITUTION Art. 13: ordinary PRs,
no amendment required, nothing normative about the product.

This is deliberately **not** a revival of the College of Personas
killed on 2026-07-22 (JOURNAL, "Discipline standards, derived from
first principles"). That draft reified the scaffolding — eighteen
anthropomorphized offices with a check-graph, standing in for the
standards. Here the standards are the deliverable; the role name is
only the invocation handle, and there is no check-graph, no quorum,
and no office with authority. Every skill produces a review report.
The maintainer decides and merges (Art. 11).

**Advisory by default.** No skill's finding blocks a merge until one
of its standards graduates to a guard test or CI check by the
explicit clause in that standard. Advisory-not-gating is the Art. 8.6
posture applied to process.

**Reading them together.** `docs/discipline-standards.html` renders all
eight on one browsable page — every standard, the seam map, and the
preflight ordering — generated from these files by
`npm run docs:disciplines`. It is committed but GENERATED: edit the
SKILL.md, then regenerate. `tests/discipline-docs.test.mjs` fails when
a source changes without a regen, so the page cannot silently diverge
from these files. It cannot vouch for the files themselves — a stale
fact written into a SKILL.md regenerates faithfully and ships green,
which is exactly how `ROADMAP.md` went stale. That one is a human read.

## The roster

| Skill | Mandate |
|---|---|
| [`product-manager`](product-manager/SKILL.md) | No code before a stated user problem; no phase without a falsifiable success criterion and a kill condition; no shipped feature carried past its check date without recorded evidence the casework pulls it. |
| [`architect`](architect/SKILL.md) | Keep the load-bearing structure — four execution contexts, the `xray:*` bus, storage schemas, the kind schedule, the bundle graph — coherent as agent-authored changes accumulate, forcing one-way doors through a recorded, ratified decision before they close. |
| [`continuous-improvement`](continuous-improvement/SKILL.md) | Keep the preconditions of improvement true — fast trustworthy feedback loops, friction recorded and searchable, recurring pain converted into structure — and refuse any process change that cannot cite the friction it relieves. |
| [`automator`](automator/SKILL.md) | Advance every recurring task up the documentation → checklist → script → CI gate → guard test → agent skill ladder exactly as far as its proven payback licenses, while the manual path stays alive and human judgment gates stay human. |
| [`ecosystem-pm`](ecosystem-pm/SKILL.md) | Ensure every event X-Ray publishes stays parseable, ignorable, or renderable by strangers' clients forever; mint kinds only when cross-client value is demonstrated; keep `docs/NIP_DRAFT.md` complete enough to implement a second client from. |
| [`verification-engineer`](verification-engineer/SKILL.md) | Make every change name which verification layer actually observes its principal risk, convert every escaped bug into a new observer, and spend the one scarce resource — human browser time — only where machines cannot look. |
| [`security-threat-modeler`](security-threat-modeler/SKILL.md) | Enumerate the assets and trust boundaries of a key-holding, page-injecting, cloud-talking extension in one living document, and make every new surface justify itself against that map before it ships. |
| [`schema-evolution`](schema-evolution/SKILL.md) | Guarantee that every record any shipped version ever wrote stays readable and every kind ever emitted stays parseable — migration, fixtures, and rollback story in the same PR. |

## Routing — which skill for which moment

| The moment | Skill |
|---|---|
| A feature, phase, or wave is proposed, before solutioning | `product-manager` |
| A `docs/*KICKOFF*.md` is drafted or reviewed | `product-manager` |
| A change crosses execution contexts, adds an `xray:*` message, or adds a bundle entry point | `architect` |
| A decision looks irreversible (one-way door) | `architect` |
| A PR touches any builder or `*-publish.js` module | `ecosystem-pm` (semantics) + `architect` (placement) |
| An IndexedDB `DB_VERSION` or `chrome.storage` shape changes | `schema-evolution` |
| A new kind or tag is proposed | `product-manager` (should the artifact exist) → `ecosystem-pm` (has it earned the wire) |
| A new surface touches keys, page injection, or a network destination | `security-threat-modeler` |
| A bug escapes to a live run | `verification-engineer` (which layer should have seen it) |
| The same manual sequence runs a second time in a session | `automator` |
| Friction recurs, or a pain class appears twice in `JOURNAL` | `continuous-improvement` |
| Before a `v*` tag | all eight, in the order below |

## Release preflight — the shared ordering

Seven of the eight self-invoke before a `v*` tag. Without an ordering
they duplicate each other's checks and nobody closes. The sequence:

**A. Mechanical preflight — `automator`.** Version lockstep,
`CHANGELOG.md` section for the exact target version, clean tree,
build/test/lint green, smoke recency stated. (The
`scripts/release-preflight.mjs` that would make this one command is
to-be-built; until it exists these run by hand.)

**B. Discipline reviews — independent, run in any order.**
`schema-evolution` (fixture suite over every shipped store version),
`ecosystem-pm` (changelog wire re-run, NIP_DRAFT parity),
`security-threat-modeler` (drift check: new surfaces since last tag
against the threat model), `architect` (whole-tree structural pass),
`continuous-improvement` (command / flag / roadmap-claim currency),
`verification-engineer` (verification-fact currency and the debt
ledger).

**C. `product-manager` validation-debt sweep.** Runs **after**
`verification-engineer`, because it reads that skill's ledger rather
than keeping its own.

**D. `automator` aggregates.** Every tag-time report collects here.

**E. `verification-engineer` issues the go/no-go.** Pending debt may
still ship, but only with an explicit acceptance line in
`CHANGELOG.md` or a `JOURNAL` entry naming the accepted risk.

The tag push and the release-environment approval stay human
(`CONTRIBUTING.md`).

## Seams — who owns a contested call

Where two skills touch, one owns the ruling and the other cites it.
These seams were set by a cross-skill consistency review; a skill
that restates a neighbor's rule instead of citing it is a defect.

- **Wire format.** `architect` owns code placement (kind literals
  confined to builder / `*-publish` modules) and the recorded-decision
  demand. `ecosystem-pm` owns stranger-facing semantics — tolerant
  read, never-reuse, NIP_DRAFT parity — and **declares the canonical
  PR-body callout literal: a section headed `Wire format:`**, which
  the other two cite. `schema-evolution` owns own-record
  survivability.
- **Kind existence.** `product-manager` judges whether the artifact
  should exist and what it costs the maintainer; `ecosystem-pm` owns
  the wire-earning decision and its threshold.
- **Automation ladder.** `automator` owns the ladder, the
  one-rung-at-a-time rule, and the repetition thresholds;
  `continuous-improvement` asserts only "mechanize rather than
  remember" and defers placement.
- **Removing machinery.** `automator` kills mechanical rot in shipped
  automation (two false alarms with no true positive, or two release
  cycles unused); `continuous-improvement` retires process
  experiments that never delivered relief at their check boundary.
- **Verification debt.** `verification-engineer` owns the ledger at
  the top of `docs/SMOKE_TEST.md`; `product-manager` reads it and
  keeps no second ledger.
- **Doc currency.** `verification-engineer` owns verification facts
  (test counts, bundle lists, smoke currency);
  `continuous-improvement` owns commands, flags, and roadmap claims.
- **Smoke-step classification.** `verification-engineer` owns the
  vocabulary — every step is **agent-verifiable** or **needs-human-eyes**
  — and the check; `automator` moves steps into the agent-verifiable
  column.

**Never restated anywhere:** the reserved and retired kind numbers.
Cite the kind table in `docs/CONSTITUTION.md` Art. 10 (the wire
covenant). Restated subsets drift — that is the doc-drift class this
repo keeps paying for.

## Invoking

Load one in-session with the Skill tool (`product-manager`,
`architect`, …) when you hit its trigger, or delegate a full review to
a subagent with the skill's text as the prompt when the review is
large enough to want its own context. Both paths produce the same
artifact: a review report with the sections that skill's Protocol
requires.

Accepted recommendations — especially kills, deferrals, and
second-guessable design calls — get a `docs/JOURNAL.md` entry with
date and rationale (Art. 11 decision recording).
