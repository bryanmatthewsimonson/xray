# Moral-Lens Evaluation — design (Phase 16)

> **Status:** design draft (2026-06-24). **Phase 16.** Depends on Phase 14.5
> (LLM-assist client) landing and sits on the far side of the Phase-15 truth
> firewall (`docs/TRUTH_ADJUDICATION_DESIGN.md`). **Derived/advisory only:**
> no wire kind, nothing auto-saved, computed-on-open. This doc evaluates and
> specifies the engine sketched in the `moral-lens-jurisdiction` system-prompt
> draft; the prompt artifact itself is authored at implementation (16.2).

This layer answers a question the rest of the stack deliberately refuses:
*"Under a named perspective J, how would assertion A be read, and on what
authority?"* It never asks *"is A true?"* — that firewall is the whole point.

---

## §1. Why this exists — the missing half of the truth firewall

Phase 15 (`TRUTH_ADJUDICATION_DESIGN.md` §3.1) draws a hard line. A
proposition is adjudicable as true/false only when it is an `event-fact`,
`state-fact`, `prediction`, or `stated-commitment`. **Interpretations and
bare values are explicitly *not* adjudicable** — "only the honesty of the
reasoning behind them is assessable… the firewall against the tool becoming
an orthodoxy enforcer."

That leaves a real gap. An article's load-bearing work is often *normative*
("men should step down from hierarchy") or *framing* (what the title
emphasizes, what is omitted, the tone). Phase 15 correctly declines to call
these true or false. But declining to adjudicate is not the same as having
nothing useful to say. This layer takes exactly the proposition classes the
truth layer firewalls off and does the only honest thing available:
**reconstructs how specific, named perspectives would read them, grounded in
those perspectives' own authorities** — and reports its own evidentiary
honesty as the payoff.

The truth layer and this layer are two sides of one wall:

| | Truth layer (Phase 15) | Lens-reading layer (Phase 16) |
|---|---|---|
| Owns | `event-fact` / `state-fact` / `prediction` / `stated-commitment` | `interpretation` / `stated-value` / `normative` / `framing` |
| Asks | "Is the proposition true?" | "How would perspective J read it?" |
| Output | descriptive truth-state (true/false/contested/unresolved) | a `disposition` *under a named jurisdiction*, never in the tool's voice |
| Voice | the world | the perspective |
| Persisted | wire kinds `30063`/`30064` (gated) | nothing — derived view only |

---

## §2. Position in the judgment stack

X-Ray already separates several judgment kinds by wire kind so none can be
mistaken for another. This layer extends that discipline and is the first
that produces **no canonical wire artifact at all**.

| Layer | Kind | What it judges | Form |
|---|---|---|---|
| Assessment | `30054` | the reader's own stance on a claim | stance + labels |
| Audit | `30056`–`30061` | article craft / epistemics | 0–100 **estimation** w/ knowability ceiling |
| Forensic | `30062` | behavioral maneuvers | categorical, no score |
| Truth | `30063`/`30064` | truth-value of facts & commitments | descriptive state, measurements only |
| **Lens-reading** | **none (derived)** | **how a named perspective reads normative/framing/value** | **per-jurisdiction `disposition` + integrity report** |

**Firewall map.** This layer owns precisely the proposition classes Phase 15
§3.1 excludes. A reader who wants "is this true" goes to the truth layer; a
reader who wants "how would this tradition / author / legal code see it" comes
here. Neither answers the other's question.

---

## §3. Division of labor with the truth layer (the central integration)

Assertions are tagged, as in the source prompt, `factual | normative |
framing`. The boundary with Phase 15 is sharp and one-directional:

- **`normative`, `framing`, and value/`interpretation` assertions** are this
  layer's to evaluate — perspectivally, never as truth.
- **`factual` assertions** are **deferred to the truth layer.** This engine
  does **not** pronounce a fact true or false even when a jurisdiction's
  corpus takes a side. The most it may say about a factual assertion is the
  *descriptive* observation **"jurisdiction J's loaded corpus asserts / denies
  / is silent on this,"** which is a statement about the corpus, not about
  reality. Any actual truth-adjudication routes to Phase 15.

This keeps the two layers from quietly competing: a `worldview` "ruling" that
a factual claim is false would be truth-policing in perspectival costume, and
is forbidden here.

---

## §4. Core concepts mapped to existing infrastructure

The source prompt's three abstractions already have homes in the codebase —
nothing new is invented at the storage layer.

| Prompt concept | X-Ray substrate | File |
|---|---|---|
| **Jurisdiction** (codified / worldview / persona) | an **entity** (`person`/`organization`, with `description`, `canonical_id` alias, keypair) | `src/shared/entity-model.js` |
| **Authority** (statute §, scripture + tradition, book locator, captured excerpt) | a **captured claim + W3C anchor** (verbatim quote + locator, rehydratable) | `src/shared/claim-model.js`, `src/shared/metadata/anchor-capture.js`, `anchor-resolver.js` |
| **Target** (the article under review) | a captured article (`30023`) | existing capture pipeline |
| **Opinion** | a **derived view**, computed-on-open, never auto-saved | follows `src/shared/audit/dossier.js` pattern |

The three jurisdiction **definition templates** from the prompt (codified /
worldview / persona, with the bell hooks / Celeste Davis / multi-tradition
Christianity / US-federal examples) are carried forward verbatim as *inputs*
to the engine, not part of it.

---

## §5. Design principles — adopt all eight, with three corrections

The source prompt's eight principles (ground-in-corpus, lens-vs-truth
separation, steelman, encoded pluralism, living-person guardrail, calibrated
confidence, cite-precedent/flag-silence, split-content-from-framing) are
adopted as written — they are already congruent with `PHILOSOPHY.md` (P3
verbatim-evidence, the never-score-a-conclusion rule, §3.2 steel-manning).
Three points need explicit reconciliation so the layer doesn't contradict the
rest of the stack:

### 5.1 Confidence is a *legitimate estimation*, not a stray score

The truth layer's §1 forbids estimated scores standing in for verdicts:
*"Verdicts are descriptive states. Quantities are measurements, never
estimations."* This engine's `high | medium | low` confidence **is** an
estimation. It is nonetheless **admissible here, for the same reason the
audit's 0–100 is** (truth-doc §1: an estimation is legitimate where scope is
"limited" and purpose is "heuristic"):

> A lens-reading is **not a truth-verdict.** Its confidence measures the
> *fidelity of a perspectival reconstruction* — how directly the loaded
> corpus addresses the assertion, how unified the tradition is, how much
> inference was required — never how true the assertion is or how strongly
> the jurisdiction "feels." Because it makes no claim about reality at human
> stakes, the §1 prohibition does not bind it; it sits on the
> estimation-legitimate side of the same line the audit score sits on.

This must be stated wherever confidence is surfaced, or it reads as a
violation of §1 when it is in fact an instance of §1's own carve-out.

### 5.2 Surface framing is **"lens-reading," not a court**

The source prompt's "Online Court of Justice / rulings / verdicts / opinion"
metaphor collides with two things: the truth layer's own reserved word
**"verdict,"** and X-Ray's under-claiming posture (`CRIMINOLOGY_DESIGN.md`'s
"structural observations, not verdicts"). The *structure* is kept —
authorities, confidence, content-vs-framing split, integrity report — but the
surface vocabulary changes:

| Prompt term | This layer's term |
|---|---|
| ruling / verdict | **reading** / `disposition` |
| court opinion | **perspectival reconstruction** |
| jurisdiction | jurisdiction *(kept — it is descriptive)* |

"Verdict" is reserved for Phase 15 so the firewall stays legible at a glance.
The `disposition` vocabulary itself is unchanged from the prompt:
`endorses | rejects | partially_endorses | reframes | out_of_scope | silent`.

### 5.3 Panel composition is a symmetry obligation (new)

The prompt's integrity report covers *per-jurisdiction* honesty well
(grounded vs inferred, thin-coverage, recommended sources). It does not cover
the bias that enters one level up: **which** jurisdictions get empaneled.
Loading only lenses hostile to a target turns the panel into a hit piece
while every individual reading stays scrupulously grounded. `PHILOSOPHY.md`
**P5 (symmetry is existential)** applies directly:

> The empaneled jurisdictions, and the basis for selecting *these and not
> others*, are disclosed in the integrity report's new `panel_composition`
> field. A panel with no jurisdiction a fair observer would expect to be
> sympathetic to the target is flagged, exactly as an audit that is never
> "uncomfortable for every camp" is flagged. Selection is itself a judgment
> call, and asymmetric selection is how this tool would die quietly.

---

## §6. Architecture and reuse

- **The model call** uses the Phase 14.5 client (`src/shared/llm-client.js`,
  built in 14.5): Anthropic Messages API from the background service worker,
  `anthropic-dangerous-direct-browser-access`, API key in
  `chrome.storage.local` (`xray:llm:key`). This layer is purely a *consumer*
  of that seam and ships nothing of its own at the transport layer.
- **The opinion is a derived view**, following `audit/dossier.js`: "DERIVED,
  REPRODUCIBLE… computed-on-open." The model pass is not deterministic, but
  its **inputs are pinned and reproducible** — authorities cited by edition /
  ISBN / locator, the target article hash, the jurisdiction definitions, and
  the prompt version. Provenance is `suggested_by: 'llm:<model>'`, the seam
  already baked into every model.
- **Nothing auto-saves and nothing publishes**, inheriting the Phase 14.5
  rule. A lens-reading is shown, can be discarded, and only its *constituent
  artifacts* (a captured authority excerpt, an entity) persist through the
  existing `create()` paths on explicit user confirmation.
- **Gating:** a new `moralLens` flag in `FLAGS_DEFAULTS`
  (`src/shared/metadata/feature-flags.js`), default off, **plus** the API-key
  second consent gate inherited from 14.5 (article text leaves the device).
- **No wire kind.** Kind **`30066` is left free**; if lens-readings ever
  become shareable on relays that is a deferred, separately-designed act
  (§9), not part of v1.

---

## §7. Output contract

The engine emits a machine-readable object plus a human-readable
reconstruction, structurally the source prompt's schema with the §5.2 renames
and the §5.3 addition. Sketch (full schema authored at 16.2):

```json
{
  "target": { "title": "…", "url": "…|null",
    "claims": [ { "id": "c1", "text": "verbatim", "type": "factual|normative|framing" } ] },
  "jurisdictions": [ {
    "id": "bell-hooks", "type": "persona|worldview|codified",
    "display_name": "…", "is_living_person": false,
    "authorities_loaded": [ { "authority_id": "…", "citation": "work+edition+locator", "coverage": "high|medium|low" } ],
    "internal_divisions": [ "…" ],
    "readings": [ {
      "claim_id": "c1",
      "disposition": "endorses|rejects|partially_endorses|reframes|out_of_scope|silent",
      "reasoning": "in the jurisdiction's own logic",
      "authorities_cited": [ { "authority_id": "…", "locator": "…", "grounding": "direct_quote|paraphrase|inference" } ],
      "content_vs_framing": "how substance vs. framing fare, separately",
      "confidence": "high|medium|low",
      "confidence_rationale": "coverage + unity + inference load (fidelity, not feeling — §5.1)"
    } ],
    "reconstruction_summary": "short narrative in the jurisdiction's voice",
    "integrity": {
      "grounded_count": 0, "inferred_count": 0,
      "thin_coverage_flags": [ "…" ], "recommended_sources": [ "…" ]
    }
  } ],
  "panel_composition": {
    "empaneled": [ "…" ],
    "selection_basis": "why these jurisdictions",
    "symmetry_flags": [ "no jurisdiction sympathetic to the target was loaded" ]
  },
  "panel_comparison": {
    "agreements": [ "…" ],
    "divergences": [ { "claim_id": "c1", "split": "who reads what, and the premise driving it" } ]
  }
}
```

Quoting discipline inherits X-Ray's copyright rules: authorities cited by
locator, content paraphrased; short attributed excerpts only where exact
wording is load-bearing.

**Hard stops** (refuse or downgrade, never fabricate): no corpus loaded for a
jurisdiction → do not read, report "jurisdiction not grounded"; corpus does
not address a claim → `silent`, not a guess; living-person persona → the
guardrail is non-negotiable; a locator that can't be anchored to a named
edition → `grounding: inference` and flag it.

---

## §8. Slice plan (Phase 16.x)

- **16.0 — gate.** Phase 14.5 LLM-assist (`llm-client.js`, `llmAssist` flag,
  key-consent UI) merged. This layer does not start before it.
- **16.1 — jurisdiction model.** Entity-backed jurisdiction records; the three
  definition templates (codified / worldview / persona); corpus-loading that
  binds authorities to captured claims + anchors; exhaustive-enum tests for
  `type` and `disposition`.
- **16.2 — the lens-reading engine.** System prompt (hardened from the draft
  with the §5 corrections) + `llm-client` call + structured-output parse into
  the §7 contract; derived view, never saved.
- **16.3 — surfaces.** Reader/portal rendering of the reconstruction + the
  integrity report + the **`panel_composition` disclosure**; the
  content-vs-framing split shown per reading.
- **16.4 — guardrails as tests.** Living-person guardrail enforcement;
  symmetry/selection-discipline checks (thin corpus → `silent`,
  unloaded jurisdiction → refuse, one-sided panel → flag).
- **(deferred)** publishable wire kind `30066`; persona-corpus capture
  tooling; multi-target panels.

---

## §9. Open questions / deferred

1. **Persona corpus provenance.** The living-person guardrail says "published
   positions only," but X-Ray captures social posts that may not be
   publications. Persona jurisdictions should require a genuine published
   corpus, not scraped semi-private posts — needs a concrete admissibility
   rule.
2. **Factual hand-off UX.** How a `factual` assertion visibly routes from this
   layer to Phase 15 in the reader, so the firewall is legible to the user and
   not just to the code.
3. **Built-in vs user-authored jurisdictions.** Whether a curated set ships
   (with its own selection-bias exposure) or jurisdictions are entirely
   user-defined.
4. **Wire format, if ever.** Should lens-readings become shareable, `30066`
   and a NIP draft framing them as *perspectival reconstructions, not
   verdicts* — a separate design, gated on demand that does not yet exist.
