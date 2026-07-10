# Epistack sprint — Claude Code kickoff

> **SUPERSEDED (2026-07-08).** This brief sequenced work against
> `EPISTACK_WIN_PLAN.md`, which was deliberately removed (PR #109) to
> avoid overfitting the tool to the competition. **Neither the sprint
> queue nor the "hard constraints"/decision bullets below are binding
> any longer** — several were re-argued on merits and reversed (the
> bundled-JSON durability story, the ban on self-hosted relays as even
> a contingency, the eggs-deep/COVID-bounded case depths; see JOURNAL
> 2026-07-08). Current plan of record:
> [`EPISTACK_ENTRY.md`](EPISTACK_ENTRY.md) (entry + writeup skeleton)
> and [`EPISTACK_RUNBOOK.md`](EPISTACK_RUNBOOK.md) (operational
> steps). Kept for history.
>
> **Handoff brief** (2026-07-03) for the Claude Code session executing
> the FLF Epistack competition sprint. **Deadline: 2026-07-19.**
> `EPISTACK_WIN_PLAN.md` (removed) governed strategy;
> `docs/epistack/` holds the authoritative competition rules (they
> supersede the win plan's §1 facts); this brief sequences the work.
> Read `CLAUDE.md` first — its conventions bind every PR.

## Where things stand (verified 2026-07-03)

- **Phase 15 (truth adjudication, kinds 30063/30064) is merged** to
  `main` (#89) behind the default-off `truthAdjudicationPublishing`
  flag. Suite **1036 green**, lint 0 errors.
- **Identity profiles + fresh workspace** shipped (#95) — Settings ▸
  Signing has labeled identity profiles; Settings ▸ Advanced has
  backup + workspace reset. The maintainer works under a dedicated
  **Epistack identity** on a fresh workspace.
- **Scope is frozen** (win plan §9, all seven decided): all three
  cases depth-scoped (eggs deep / COVID bounded / LHC thin); the
  EcoHealth IntegrityFinding ships (institution-level); **public
  relays only — self-hosting descoped**; ~$100 LLM budget; individual
  entry, MIT; descope gate ~Jul 9; honest-calibration framing (never
  brand X-Ray's output "calibrated").
- **Designs merged and ready to build:**
  [`CASE_DOSSIER_DESIGN.md`](CASE_DOSSIER_DESIGN.md) (slices CD.1–CD.5;
  **CD.1–CD.3 satisfy win-plan §5 deliverable 5**) and
  [`TEAM_CASE_DESIGN.md`](TEAM_CASE_DESIGN.md) (post-sprint; do NOT
  build during the sprint).
- **v0.6.0 was never tagged** — the last release tag is v0.5.1. A
  **v0.7.0 release is due** right after the human smoke gate (below).
- **Phase 16 (moral lens) is parked until after Jul 19** — design
  amended and ready, deliberately not started. Do not start it.

## Human-owned items (support, never block on)

1. **SMOKE §Phase 15 round trip** — flip the flag, author → sign →
   publish → portal-render against public relays, under the Epistack
   identity. This is simultaneously: the pending Phase 15 acceptance
   walk, the **public-relay kind-acceptance test** for 30040–30064,
   and CONTRIBUTING's smoke gate for the release tag.
2. EOI form submission (if not already done).
3. The capture run itself (browser + Anthropic key).

When the human reports smoke results, fix what surfaced, then cut
**v0.7.0** (`npm run version:set 0.7.0`, CHANGELOG `[Unreleased]` →
`[0.7.0]`, commit `release: v0.7.0`, tag — per CONTRIBUTING; the tag
triggers `release.yml`, which has not run since v0.5.1).

## Work queue (in order; one PR per slice, `claude/sprint-*` branches)

1. **Relay shortlist note.** Pick 3–4 candidate public relays under
   independent operators (the config defaults are a starting point);
   document per-relay expectations (arbitrary-kind acceptance,
   any known retention caveats) in a short section added to the win
   plan. Final selection is confirmed by the human round trip — the
   note prepares it, does not preempt it.
2. **Eggs capture-run scaffolding.** Turn
   [`EPISTACK_EGGS_CORPUS.md`](EPISTACK_EGGS_CORPUS.md) into an ordered
   capture worksheet: per-source URL + capture-timing notes (cite
   `CAPTURE_GUIDE.md` where the platform is finicky), the proposition
   targets (LDL-C → `established-true`; egg→CVD →
   `insufficient-evidence`/`contested`), the attestation-convergence
   targets (overlapping cohorts; press-release clusters), and per-source
   checklist columns (captured / claims / audit / attested). Ship as a
   docs PR the human works through in the browser.
3. **CD.1 — orbit assembler** (`src/shared/case-dossier.js` + tests):
   pure `assembleCaseDossier(caseEntityId)` per CASE_DOSSIER §6.
   Buildable now, before any captures exist — fixtures are the test
   substrate.
4. **CD.2 — shape-of-knowledge header + convergence-collapsed evidence
   table** in the portal case view.
5. **CD.3 — four-axis timeline** (world-time spine with precision
   bands; publication/capture/judgment overlays; gap callouts).
6. **Demo staging** (win-plan §5 #4): the content-addressing tamper
   demo, the n=2 disagreeing-verdict render, and the ~5-line
   relay-replay consumer script. Small, high-signal, late-window.
7. **Baseline-comparison appendix prep** (win-plan §5 #8) and writeup
   support as the deadline approaches — body ≤10 pages, mapped to the
   7-dimension rubric in `docs/epistack/JUDGING_CRITERIA.md`.

CD.4/CD.5 are upside if the window allows; the **mid-point descope
gate is ~Jul 9** (win plan §6) — check progress against it honestly.

## Hard constraints (do not relitigate)

- **Public relays only.** No self-hosted or special-purpose relay
  work of any kind.
- **No aggregation/consensus/reputation layer.** Deleted from the
  repo by owner decision; do not reintroduce.
- **No Phase 16 work** until after 2026-07-19.
- **No new wire kinds** for the dossier (derived, computed-on-read)
  and none anywhere without an explicit wire-format callout per
  CLAUDE.md.
- **Never call X-Ray's output "calibrated"** in any judge-facing text
  (win plan §3 fix 1; the verdict-state *distribution* is the
  calibrated view, X-Ray's verdicts are *graded*).
- The bundled **raw signed-event JSON is the durability guarantee**;
  relays are the live demo.

## House cadence (unchanged)

Gate green before every push (`npm run build`, `npm test`,
`npx web-ext lint --self-hosted` — 0 errors; warnings are
pre-existing). Draft PRs with the What/Why/How-I-tested/Screenshots/
Compatibility template. Tight JOURNAL entries for second-guessable
decisions. SMOKE rows land with the slices that add surfaces.
4-space indent in new JS; `xr-*` CSS; `Utils.log`; no bare console.
