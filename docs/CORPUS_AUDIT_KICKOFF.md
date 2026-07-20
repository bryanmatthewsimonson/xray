# Corpus-Scale Epistemic Auditing — Kickoff

**Status: APPROVED (maintainer, 2026-07-20). Slices CA.1–CA.4 below.**

Governing docs: `PHILOSOPHY.md` (normative for the audit family —
cited by principle number throughout), `EPISTEMIC_AUDIT_DESIGN.md`
(the Phase-13 methodology, untouched here), `CASE_SYNTHESIS_DESIGN.md`
(the corpus machinery this joins).

## §1. The diagnosis

The maintainer's observation: *"epistemic audits are curiously
separated from the rest of the claims/quotes ecosystem"* — and the
constitution agrees with him. **P2 states the paradigm this work
completes**: "The claim is the atomic unit. An article is a vector of
claims... Article scores roll up from claim-level and dimension-level
findings." **P3 already forces the atoms to exist**: every finding in
every module requires a verbatim evidence quote (schema-enforced,
`findings-schemas.js`).

The separation is historical, not principled. Phase 13 ported a
standalone auditor prototype as a sealed parallel family — own kinds
(30056–61), own ledger (`xray-audits`), own portal blocks — while the
claim spine and the corpus machinery (briefs, dossiers, links,
hypothesis maps) grew around 30040 claims. Findings quote the article
but never anchor to the claims extracted from the same text; the case
brief is blind to epistemics; auditing a 100-member corpus means 100
reader sessions.

## §2. Why this is cheap now — the joints already shipped

1. **The join is corpus-v4's own machinery.** `linkAssertionsToClaims`
   locates two verbatim spans in the same canonical text and links on
   overlap. A finding's `evidence_quote` and a claim's `quote` live in
   the SAME canonical article text — the identical pure join attaches
   findings to the claim spine locally, computed on read (§9
   "reproducible rollups"; the moral-lens/dossier derived-view
   pattern).
2. **The orchestration is shared already.** `orchestrateModuleRuns`
   drives both the audit's thorough path and the corpus map. The
   extract-cache discipline, the Pre-analyze prepay pattern, and the
   SW keepalive all generalize.
3. **Re-runs are already free.** `xray-audits` runs are keyed by
   article hash (with the truncated-slice `captureArticleHash` alias);
   an audited member costs nothing, and P9 keeps old runs valid under
   their recorded methodology versions.
4. **Cross-article aggregation exists** (the 13.7 entity audit
   dossier); a case-level rollup is the same computation over member
   hashes — `deriveArticleRows` carries `article_hashes` for exactly
   this join.

## §3. Guard rails (PHILOSOPHY, applied)

- **No fused corpus score, ever** (§10.1/.9, §4): corpus surfaces show
  DISTRIBUTIONS — per-member scores, per-module flag rates, knowability
  ceilings — never an average.
- **A finding is not a verdict.** Findings describe the ARTICLE's
  process (§2 Outsider Stance); joined to a claim they are LOCATION,
  never a judgment of the claim's truth (the §3.1 truth firewall
  holds).
- **Methodology untouched.** Module prompts/schemas/weights are not
  changed by any slice; a future change bumps versions per §8.
- **Findings stay article-anchored on the wire** (P4). The claim join
  is local and derived; no new kinds, no tag changes.
- **Every run is consented** (spend confirm with cache-first counts);
  publishing stays the existing human-gated per-article batch.
- **One request builder per stage** (the corpus-v4 lesson): the corpus
  runner sends byte-identical `xray:audit:module` requests to the
  reader's, so runs/drafts/caches are shared, never forked.

## §4. Slices (one PR each; merge-as-you-go)

- **CA.1 — the corpus audit runner.** `shared/audit/corpus-audit.js`
  (pure plan: member → auditable slice + hash → audited/pending via
  the runs ledger, the shared draft-resume helpers) + a case-dashboard
  block: "Audit corpus…" — gates (`epistemicAuditing` + `llmAssist` +
  key), cache-first cost preview ("N of M members already audited —
  reused for free"), per-member × per-module orchestration through
  the SAME `xray:audit:module` message and draft store the reader
  uses (a reader-started draft resumes here and vice versa),
  `assembleAudit` + `importAuditJson` per member. Local ledger only.
- **CA.2 — findings join the claim spine.** Pure
  `linkFindingsToClaims` (grounding-index span overlap, the
  corpus-v4 join); the case dossier's evidence rows and entity
  dossiers render audit findings ON claims, labeled as
  article-process observations at that location.
- **CA.3 — the corpus epistemics block.** A derived case-dashboard
  view over the joined runs: score distribution (list, min/max,
  NEVER a mean), per-module flag rates, per-source concentrations,
  ceilings and caveats on the face. No wire kind.
- **CA.4 — the brief sees epistemics.** `digestDossier` gains the
  audit-coverage summary (counts + distribution + per-member flags)
  so the reduce can note epistemic-quality context per position —
  bounded by P11; the brief still adjudicates nothing.
  CORPUS_PROMPT_VERSION bumps (reduce input changes); the map cache
  is untouched.

**Parallel, non-extension:** the `xray-smoke` skill (the
`xray-capture` pattern — Claude drives the loaded extension via the
chrome connector) executing SMOKE_TEST sections and reporting
pass/fail; and the staged "Process corpus" chaining
(import → pre-analyze → audit → links → analyze) once CA.1 lands.

## §5. Costs, stated plainly

A corpus audit is N members × 8 module calls — the most expensive
button in the product. Mitigations: the runs cache (re-audits free),
drafts (a crash costs nothing already paid), the spend confirm
disclosing call counts and characters, and per-member import (a
failure mid-corpus keeps every completed member). The cheaper-model
lever (per-stage model choice) is follow-up work, noted not built.
