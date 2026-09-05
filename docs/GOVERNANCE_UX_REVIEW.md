# The governance corpus — ux-designer review

> **Date:** 2026-09-05 · **Trigger:** maintainer directive, 2026-08-28
> — *"We also need to have the designer look at the constitution and
> all governance docs"* — clarified 2026-09-05: the corpus is the thing
> under review, and it is to be **grounded in design skill, not the
> other way around.** · **Scope:** `docs/CONSTITUTION.md`,
> `docs/PHILOSOPHY.md`, `docs/TRUTH_SYSTEMS.md`,
> `docs/TRUTH_INFRASTRUCTURE.md`, with `docs/DISCIPLINES.md` read for
> method. The documents are reviewed **as artifacts people must read
> and act from** — not as authorities this review answers to. ·
> **Status:** Advisory (Art. 11 — the maintainer decides). Nothing
> here amends anything.
>
> **Method note.** This is the `ux-designer` protocol run on documents
> instead of screens: name the tasks, walk them cold, inventory, rank
> by user harm, propose layering. No finding below rests on a
> constitutional citation for its authority — a design finding that
> needs the constitution to be true is the `corpus cosplay` failure,
> and it is withdrawn. Where a fix would touch normative text, it is a
> proposal for the maintainer under Art. 13, never an edit made here.

**Overall posture.** This corpus is unusually well built for the thing
it is: the derivation method is stated and followed, amendments are
logged and marked *inline* where the text changed, failure modes are
named beside their countering standard, and the honest-limits sections
say plainly what the system cannot do. It is not a corpus with a
content problem. It has a **wayfinding and authority-signalling
problem**: a reader cannot reliably tell, from where they land, which
document governs, which sentences bind, and what any of it means for
the thing they are actually about to build. Every finding below is one
of those three, and every fix is additive — no renumbering, no
principle touched, no rewrite.

---

## 1. Who reads this, and to do what

Not "who should" — who demonstrably does, from `CLAUDE.md`, the design
docs, and the review record.

- **R1 — the implementer mid-change.** "I am about to build a surface
  / emit a kind / add a number. Does the corpus permit it, and in what
  form?" The dominant task by volume; every design doc in `docs/`
  opens by answering it.
- **R2 — the agent.** `CLAUDE.md` instructs every Claude Code session
  to consult the constitution before any structural, normative,
  scoring, schema, or wire-format change. Agents arrive by grep, land
  mid-document, and cite.
- **R3 — the amender.** "I am changing a normative doc. Which tier,
  what ceremony, what do I owe the log?" (Art. 13.)
- **R4 — the citer.** "I need to reference this rule so the next
  reader can find it." Citation form is binding project-wide, so this
  is a first-class task, not clerical.
- **R5 — the stranger.** The constitution is a public artifact making a
  public claim — re-derivability by outsiders is itself a
  constitutional value, and the standing self-check is that this must
  remain *a document a cult could not have written*. A stranger
  evaluating that claim is a real reader with no context at all.

R1 and R2 are where the corpus is actually load-bearing day to day,
and they are the two it serves least well.

---

## 2. Cold walk

*R1, about to build a surface.* I need to know what I may render. I
open `CONSTITUTION.md`. Art. 3 tells me filtering must not be silent.
Art. 4.4 tells me nothing carries a fused score — but so does Art.
5.4, and Art. 6, and red line 12.2, each from a different angle. Art.
5.2 governs when a number may appear at all. Art. 7 covers badges.
Art. 8 covers my own pages. Then I learn the empty-state rule is not
in this document at all — it is `TRUTH_SYSTEMS` H-5 — and the
no-engagement-ranking rule is H-7, in the same other document. Nine
locations across two documents, and no page anywhere that assembles
them. *(→ B1.)*

*Same reader, citing what they found.* I want to cite the
reader-side-fusion caution. It is `TS S-4`. I write "TS S-4" beside
"CONSTITUTION Art. 6" as though they were the same kind of thing. They
are not: that annex's status line makes only §3.3 and §4 normative, so
S-4 is evidence and Art. 6 is law, and nothing at the point of use
says so. *(→ A1.)*

*R3, amending.* I read `PHILOSOPHY.md` to see whether my change touches
it. Title, status line ("Normative"), and §0 ("Every score the system
produces… The system exists to…") all read repo-wide. The scope limit
— audit family only — is in the header paragraph's subordinate clause,
in `CONSTITUTION` Art. 2, in `CLAUDE.md`, and in this document's own
amendment log at the very bottom. The reader who stops at §0, which is
where "what is this document?" is normally answered, leaves with the
wrong scope. *(→ B2.)*

*R5, arriving cold.* There is no front door. The one real map is a
long "Project docs" section in `CLAUDE.md` — an agent-instructions
file a contributor may never open and a stranger certainly will not.
Inside the corpus, rank order is in Art. 1 and the tier list is in
Art. 2: correct, and a hundred lines in. *(→ C1.)*

*Anyone landing mid-`TRUTH_INFRASTRUCTURE`.* §9 tells me "Two refusals
are **family law**, not local taste." §3 gives me "**The portable
rule**." §6 concludes "That is the design rule this domain needed all
along." Bolded, imperative, and binding on nothing — the
non-normative marker is in a blockquote at the top I never saw.
*(→ C2.)*

---

## 3. Findings, ranked by user harm

### Class (a) — the corpus misstates its own authority

**A1. `TRUTH_SYSTEMS`'s three ID families are cited as one, but only
one of them binds.** The status line reads: *"Evidentiary annex to
`docs/CONSTITUTION.md`; normative for the §3.3 bridging constraints
and the §4 honest-limits clauses."* So `H-1`–`H-7` and §3.3 bind;
`I-1`–`I-18` (§2) and `S-1`–`S-9` (§3.2) are evidence. Nothing at the
point of citation says which is which, and the ID shapes are
deliberately parallel, so they read as one scheme.
**Evidence it misleads:** `TRUTH_INFRASTRUCTURE` §0 introduces them as
a single citable set — *"cited below by their I-n / S-n / H-n clause
IDs"* — and then cites `TS S-7`, `TS I-5` and `TS H-4` in identical
register. This review's own commissioning work did the same, citing
`TS S-4` and `TS S-6` as binding design constraints; that was wrong,
and nothing in the corpus would have caught it.
**Task damaged:** R4, and through R4 every reader downstream of a
citation. **Fix:** two sentences in the status block — an ID legend
saying `H-n` and §3.3 bind while `I-n` and `S-n` are evidence that may
motivate a proposal but never license or forbid a feature on their
own. No renumbering, no clause moved.

**A2. Two red-line lists, both numbered 1–10, both opening "The system
must never:", with the same rule at different numbers.**
`CONSTITUTION` Art. 12 and `PHILOSOPHY` §10. Averaging disagreement is
**§10 red line 1** in one and **Art. 12.2** in the other.
**Evidence it misleads:** `TRUTH_INFRASTRUCTURE` uses the bare phrase
twice — once qualified (§1.5: *"red line 1 … (PHILOSOPHY.md §10,
P8)"*) and once bare (§9: *"X-Ray's red line 1"*). The bare form
resolves to two different rules depending on which document the reader
assumes.
**Task damaged:** R4, in the register where precision matters most.
**Fix:** one clause added to the citation convention in "How to use
this document", which already forbids bare `P<n>`: a red line is
always cited with its document and number (`CONSTITUTION Art. 12.2`,
`PHILOSOPHY §10.1`), never as a bare "red line n". Renumbering either
list is the wrong fix and would break every existing citation.

### Class (b) — a task is blocked

**B1. There is no surface-constraints index, so every new surface
re-derives one — and re-derivation is where the errors are.** What a
rendered surface may and may not do is currently assembled from at
least nine places across two documents: filtering visible and
reader-controlled (Art. 3; red line 12.1); no fused cross-family
figure (Art. 4.4, 5.4, 6; red line 12.2); estimates labelled and
spread-shown wherever they render (Art. 5.2, conditions 1–3); no
judgment badge on an identity (Art. 7; red line 12.5); the operator's
pages get the same instruments (Art. 8.3, 8.5); absence states what it
means (Art. 4.6; `TS` H-5); no belief-optimised presentation (`TS`
H-7); reserved vocabulary stays inside the truth family (Art. 6); and
the reader-side fusion caution (`TS` S-4 — which per A1 is not
normative at all).
**Evidence it blocks:** `docs/MARGIN_DESIGN.md` had to build its own
§10 constraint-provenance table to answer this for one surface — a
private re-derivation of a map that should exist once. And that
re-derivation immediately hit an ambiguity the corpus does not
resolve: whether a labelled cross-family **coverage** count is a
"fused figure". It took a maintainer ruling and a recorded carve-out
(§5.4 guard 2, §10 row 1) to settle, per-surface, a question the
corpus will pose again to the next surface.
**Task damaged:** R1 — the highest-volume task, at the moment of
highest cost. **Fix:** one page the corpus owns, cited rather than
re-derived — either a new article-level appendix or a standalone
`docs/SURFACE_CONSTRAINTS.md` seated under the constitution. Each row:
the constraint, its governing citation, the one-line render rule, and
any ratified carve-out (the Margin's coverage carve-out is row one).
It restates nothing — it *indexes* — so it cannot drift into a second
spine. **This is the finding that carries the directive**: it is the
governance corpus absorbing what the design discipline knows, in the
corpus, where the next implementer will actually look.

**B2. `PHILOSOPHY.md`'s scope is corrected in four places, none of
them where a reader meets it.** Title, `**Status:** Normative`, and §0
("*Every score the system produces…*", "*The system exists to…*") all
read repo-wide. The limit — the audit family, kinds 30056–30061 — is
in the header paragraph's subordinate clause, in `CONSTITUTION` Art.
2, in `CLAUDE.md`, and in this document's own §13 amendment log:
*"Scope reminder: this document governs the epistemic-audit family
only … not repo-wide law."*
**Evidence it misleads:** that reminder exists because readers got it
wrong at scale — the 2026-08-02 record describes every post-Phase-15
design citing an unwritten bundle as "the epistemic constitution".
A scope correction that lives in the amendment log is placed where the
reader looks last.
**Task damaged:** R3 and R1 — audit-family law cited as project law.
**Fix:** move the scope into the Status field itself — *"Normative
within the epistemic-audit family (kinds 30056–30061); not repo-wide
law — see CONSTITUTION Art. 2"* — and one qualifying clause in §0's
first sentence. Two lines; no principle altered.

### Class (c) — a task is obscured

**C1. The corpus has no front door, and `CLAUDE.md` is doing its
wayfinding.** 2,804 lines across five documents, and the routing
question — *which document answers my question?* — is answered only by
reading into `CONSTITUTION` Art. 1 (rank order) and Art. 2 (the
statutes and the non-normative tier), roughly a hundred lines in. The
one real map is the 216-line "Project docs" section of `CLAUDE.md`: an
agent-instructions file that a human contributor may never open and
R5 certainly will not, and which must be hand-maintained in lockstep
with a corpus it lives outside.
**Task damaged:** R5 and R2. **Fix:** a six-row routing table inside
"How to use this document" — question → document → article. It
composes with E1 and costs one screen.

**C2. A document that binds nothing is written in the register of one
that binds.** `TRUTH_INFRASTRUCTURE.md`'s status blockquote is
explicit — *"exploration + expansion map, not a spec. Non-normative"*
— and then the body says "Two refusals are **family law**, not local
taste" (§9), "**The portable rule**" (§3), and "That is the design
rule this domain needed all along" (§6). Art. 2 is clear that this
tier *"can inspire proposals but never license features or settle
conflicts"*; the prose invites exactly that.
**Task damaged:** R1 and R4, for anyone arriving by search or deep
link rather than at the top. **Fix:** not a rewrite. Either a short
italic non-normative marker at each section head, or re-cast the three
imperative phrasings as observations ("the pattern this domain
converges on"). A top-of-file blockquote cannot survive mid-document
arrival, which is how agents read.

### Class (d) — density

**D1. `TRUTH_SYSTEMS` is 727 lines of which the binding part is two
sections, and they are at the bottom.** §§1–2 (the sixteen-system
survey and the eighteen invariants) are the evidence base; §3.3 and §4
are what the constitution adopts, beginning around line 592. A reader
who needs the binding content reads ~590 lines first or must already
know to skip.
**Task damaged:** R1, R3. **Fix:** one line in the status block
pointing at §3.3 and §4 as the binding sections and naming §§1–2 as
the evidence base. Composes with A1's legend — same block, same edit.

### Class (e) — polish, cheap now

**E1. The constitution has no article index.** 619 lines, fourteen
articles plus preamble, credo and amendment log; locating "the rule
about badges" means scanning headings. A fourteen-line index after
"How to use this document", one line per article, is also the natural
host for C1's routing table.

---

## 4. Proposed layering

**First paint** (what a reader meets in the first screen of each
document): the constitution's "How to use" carrying the citation
convention *plus* the routing table (C1) and the article index (E1);
`PHILOSOPHY`'s Status field carrying its own scope (B2);
`TRUTH_SYSTEMS`'s status block carrying the ID legend and the
binding-sections pointer (A1, D1); `TRUTH_INFRASTRUCTURE`'s
non-normative marker travelling with its sections (C2).

**One click deep:** the surface-constraints index (B1) — the page an
implementer opens instead of re-deriving, and the page a design doc
cites instead of building its own table.

**Unchanged:** every article, principle, clause and number in the
bodies. Every fix above is an addition to a header, a status block, or
a new index page.

---

## 5. What NOT to change

- **Any number.** Articles, principles, red lines, clause IDs, kind
  numbers. Renumbering to resolve A2's collision would break every
  existing citation — including the ones in already-published
  artifacts and in `tests/constitution-guards.test.mjs`. The fix for a
  numbering collision is a citation rule, never a renumber.
- **The inline amendment markers.** `PHILOSOPHY` §5 and P10 both carry
  `(v1.1.0, §13)` *in the body text that changed*. This is rare and
  genuinely good: a reader of the body learns the text was amended
  without visiting the log. Keep it; extend it if anything else is
  amended.
- **Art. 10's reserved-vs-retired passage**, which explains *why* the
  distinction is load-bearing for a stranger implementing against the
  wire. It is the model for how a rule should explain its own stakes.
- **The failure-mode-beside-the-standard discipline**, and "no
  discipline exempts itself" (`DISCIPLINES` §0). It is the corpus's
  best structural idea.
- **The Preamble's cult self-check, the honest-limits sections, and
  the Credo.** These do work no restructuring should touch, and the
  density there is the point.
- **The citation convention itself.** It works. A2 asks for one more
  clause in it, not a replacement.

---

## 6. Disposition

Open — for the maintainer (Art. 11). Every item above is advisory and
additive; A1, B2, D1 and C2 are header/status edits, C1 and E1 are one
screen inside an existing section, and B1 is the one new page. Nothing
here is merge-blocking, and nothing here amends anything: the fixes
that touch normative text are proposals under Art. 13, to be ratified
by merge or declined.
