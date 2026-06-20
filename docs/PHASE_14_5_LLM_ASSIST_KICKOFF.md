# Phase 14.5 — LLM-assist (in-extension suggestion engine) — implementation prompt

> This file is the **handoff prompt** for the Claude Code session that
> implements Phase 14.5. It is self-contained: read it, read the files it
> points at, then build. Everything in the X-Ray repo's `CLAUDE.md`
> applies (conventions, build, flags, message bus, Firefox floor).

## Task

Build an **in-extension LLM-assist**: a user-invoked pass that calls the
**Anthropic Messages API directly from the background service worker** and
proposes **capture artifacts** from the open article — **entities,
claims, assessments, claim relationships, and forensic findings** (and,
secondarily, baselines and `revision/*` edges) — for the user to
**review and confirm**. Every accepted artifact is created through the
**existing models** with provenance `suggested_by: 'llm:<model>'`.
**Nothing auto-saves; nothing auto-publishes.** The whole feature is
gated by a flag (default off) *and* requires a user-supplied API key (a
second consent gate), because the article text leaves the device.

This completes Phase 14 (`docs/CRIMINOLOGY_DESIGN.md` slice plan, 14.5).
The `suggested_by: 'user' | 'llm:<model>'` seam is **already** baked into
every model and wire builder — so the work is: (1) call the API safely,
(2) turn its structured output into validated `create()` inputs, (3) a
review UI that funnels accepts into the existing capture models.

## Read first (load-bearing context)

- **`CLAUDE.md`** — build (`esbuild`, no transpile), 4-space indent, the
  `xray:*` message bus, `Utils.log`/`Utils.error` (no bare console), the
  flag pattern, the Firefox `gecko.strict_min_version: 128.0` floor, the
  "private keys never leave" rule.
- **`docs/CRIMINOLOGY_DESIGN.md`** — the forensic layer + the **six
  methodology rules** (no verdict / evidence-bound / baseline / role-
  symmetric / sequences / falsifiability) and the **LLM-ready** notes.
- **`docs/ASSESSMENTS_DESIGN.md`** — claims (30040), assessments (30054),
  relationships (30055).
- **The models you will feed** (read their `create()` inputs + validators):
  - `src/shared/entity-model.js` — `EntityModel.create({name, type, …})`,
    `keypair`, `ENTITY_TYPES`/`ENTITY_ICONS`.
  - `src/shared/claim-model.js` — `ClaimModel.create({text, source_url,
    anchor, about, type, suggested_by})`.
  - `src/shared/assessment-model.js` — `AssessmentModel.create({claim_ref,
    stance, labels, rationale, suggested_by})`; `src/shared/assessment-taxonomy.js`
    (`ASSESSMENT_LABEL_GROUPS`, `STANCE_VALUES`, `isValidLabel`,
    `isValidSuggestedBy`, `CLAIM_RELATIONSHIPS`, `REVISION_RELATIONSHIPS`).
  - `src/shared/evidence-linker.js` — `EvidenceLinker.create({source_claim_id,
    target_claim_id, relationship, note, suggested_by})`.
  - `src/shared/forensic-model.js` — `ForensicModel.create({subject_ref,
    role, maneuver, anchors, note, counter_note, basis, suggested_by})` +
    `ForensicBaseline`; `src/shared/forensic-taxonomy.js`
    (`FORENSIC_MANEUVER_GROUPS`, `MANEUVER_GUIDE`, `ROLES`, `BASIS_VALUES`,
    `isValidManeuver`/`isValidRole`/`isValidBasis`).
- **The capture UIs** the review panel should reuse / mirror (do NOT
  invent parallel save paths): `src/reader/entity-tagger.js`,
  `src/reader/claim-extractor.js` (`openClaimModal`),
  `src/shared/assess-modal.js`, `src/shared/forensic-modal.js`,
  `src/reader/findings-section.js`, and the reader wiring in
  `src/reader/index.js`.
- **Anchoring**: `src/shared/metadata/anchor-capture.js`
  (`captureFromRange`, `buildSelectors`) and how the reader rehydrates a
  quote to a span (`rehydrateClaimMarks` / `resolveSelectors`). The LLM
  proposes a **verbatim quote**; you resolve it to a selector against the
  article body so proposals carry real anchors.
- **The flag + external-API-key precedent**: `src/shared/metadata/feature-flags.js`
  (`epistemicAuditing`, `forensicPublishing`), and the Options "Epistemic
  audits" section (`src/options/options.html` + `src/options/index.js`)
  with its key/disclosure pattern. NOTE: the audit scorer is a *companion
  CLI*; **14.5 is in-extension** instead.
- **The message bus + SW**: `src/background/index.js` (how `xray:*`
  handlers register; the relay pool lives here because page CSP blocks
  page-context network — **the LLM call must run here too**).
- **The `claude-api` skill** in this harness (or current Anthropic docs)
  for the **current Messages API shape, tool-use, and model IDs** —
  default to the latest capable Claude model; **do not hard-code an old
  model id from memory.**

## Branch

Develop on **`claude/x-ray-criminology-framework-t2cegk`** (the Phase 14
branch / PR #71), as slices **14.5.x**. If PR #71 has already merged to
`main`, branch from `main` instead. Keep build + `npm test` + `web-ext
lint --self-hosted` green before every push, and open/refresh a draft PR.

## Architecture

1. **Service-worker LLM client** — `src/shared/llm-client.js`, invoked
   from `src/background/index.js` via a new message **`xray:llm:suggest`**
   (request: `{ task, articleText, articleUrl, context }`; response:
   `{ ok, proposals } | { ok:false, error }`). It:
   - reads the API key from `chrome.storage.local` (a dedicated secret key,
     e.g. `xray:llm:key` — NEVER `preferences`, never exported);
   - reads model + flag from settings;
   - calls `https://api.anthropic.com/v1/messages` with `fetch`, the
     `x-api-key`, `anthropic-version`, and **`anthropic-dangerous-direct-browser-access: true`**
     headers (browser-origin calls need this; see Gotchas);
   - uses **tool-use / structured output** so the model returns JSON that
     maps onto the model `create()` inputs (one tool per artifact type, or
     one tool whose schema is a discriminated union keyed by `kind`);
   - is the ONLY module that touches the API; everything else consumes
     validated proposals.
   - `manifest.json` gains a host permission for `https://api.anthropic.com/*`
     (and the matching `host_permissions`/`optional_host_permissions`;
     don't widen beyond the API host).

2. **Settings** — Options → Advanced gains an **"LLM assist"** section:
   an API-key field (password input; stored under the secret key; a
   "clear key" affordance), a **model picker** (defaults to the latest
   capable Claude; populate from the `claude-api` skill), and the
   **`llmAssist` flag** (default off) with a disclosure that the article
   text is sent to Anthropic and that suggestions are drafts requiring
   confirmation. Mirror the `epistemicAuditing` toggle wiring.

3. **The suggestion → confirmation loop** (reader) — a **"✨ Suggest…"**
   control (in the reader chrome and/or the selection popover) runs a pass
   for the chosen task(s). Results land in a **review panel** grouped by
   artifact type. For each proposal the user can **Accept / Edit / Reject**;
   Accept creates the artifact through the existing model with
   `suggested_by: 'llm:<model>'`; Edit opens the matching capture modal
   pre-filled (the user's edits make it `suggested_by: 'user'` only if they
   change load-bearing content — your call, but record the provenance
   honestly). **Reject discards.** Publishing stays behind the existing
   publish flags — suggestion never publishes.

4. **Validation firewall** — every proposal is validated against the SAME
   model validators that protect manual capture before it can be accepted.
   A proposal that fails (e.g. a finding with no counter-note, a claim with
   no text, a bad maneuver/label) is shown as **rejected-with-reason**, not
   silently dropped and never saved.

## Per-artifact suggestion spec — cover ALL of these

| Task | Proposes | Maps to | Hard requirements the validator enforces |
| --- | --- | --- | --- |
| **entities** | people / orgs / places / cases named in the text | `EntityModel.create({name, type})` | `type ∈ ENTITY_TYPES`; dedupe against the existing registry (offer "tag existing" vs "create new") |
| **claims** | atomized assertions + their about-entities | `ClaimModel.create({text, source_url, anchor, about, type})` | non-empty `text`; a **verbatim quote** resolved to an `anchor`; `about` entities suggested too (link to the entity proposals) |
| **assessments** | stance + issue labels on a claim | `AssessmentModel.create({claim_ref, stance, labels, rationale})` | `stance ∈ −2..2 \| null`; labels from `ASSESSMENT_LABEL_GROUPS` (or the custom-token grammar); at least one of stance/labels; per-label anchors where possible |
| **relationships** | contradicts / supports / updates / duplicates between two claims | `EvidenceLinker.create({source_claim_id, target_claim_id, relationship, note})` | `relationship ∈ CLAIM_RELATIONSHIPS`; both endpoints must exist (suggest the linked claims first) |
| **findings** *(the criminology layer)* | a named **maneuver** a subject performs | `ForensicModel.create({subject_ref, role, maneuver, anchors, note, counter_note, basis})` | **NO verdict / intent** — describe structure only; `maneuver ∈` the canon taxonomy (or custom token); `role ∈ ROLES`; **≥1 evidence anchor with a verbatim quote**; **`counter_note` REQUIRED** (the exonerating read); `basis ∈ BASIS_VALUES`; reject anything missing the counter-note |
| **revision edges** *(secondary)* | a subject's self-serving story-change between two statements | `EvidenceLinker.create({…, relationship: 'narrative-patch'\|'recharacterizes'\|'walks-back'})` | both statement-claims must exist; directional (earlier → later) |
| **baselines** *(secondary)* | a subject's established register | `ForensicBaseline.create({subject_ref, note, source_url})` | descriptive note, no score |

The system prompt MUST embed, per task:
- for **findings**: the `MANEUVER_GUIDE` (definition + indicators +
  counter-indicators per maneuver) and the six rules — instruct the model
  to **describe the move, never assert intent or a truth verdict**, to
  **always provide a counter-read**, and to set `basis` honestly
  (`quoted` only when the evidence is a verbatim span; `structural-inference`
  / `behavioral-cue` otherwise);
- for **assessments**: the label taxonomy + that stance is a personal
  judgment, not a fact verdict;
- for all: return **verbatim quotes** (so anchoring works), and emit
  `suggested_by: 'llm:<model>'`.

## Privacy, security, consent (hard requirements)

- **Off by default** (`llmAssist` flag) AND **no key = no calls** (the
  second gate). The first run discloses that the article text is sent to
  Anthropic.
- The **API key is a secret**: stored under its own `chrome.storage.local`
  key, never in `preferences`, **never included in entity-export / case
  bundles**, never logged (`Utils.log`/`error` must not print it), never
  committed. Add it to whatever "erase all" already clears.
- **Human-in-the-loop is non-negotiable**: nothing the LLM proposes is
  saved without an explicit Accept, and nothing is published by this
  feature (publishing stays behind `assessmentPublishing` /
  `forensicPublishing`).
- **Cost/rate**: one pass per explicit user action; no background polling;
  surface a token/cost estimate if cheap to do. Handle 401/429/5xx with a
  clear toast, not a crash.

## Slice plan (one concern per PR)

- **14.5.1 — client + settings + manifest.** `llm-client.js` (SW fetch,
  key/model/flag, tool-use scaffold, error mapping), the `xray:llm:suggest`
  handler in `background/index.js`, the Options "LLM assist" section
  (key + model + flag), the `llmAssist` flag, and the
  `api.anthropic.com` host permission. Verify with a trivial round-trip.
- **14.5.2 — schema + prompts + anchoring.** The per-task tool schemas,
  the system prompts (taxonomy + rules embedded), the proposal validators
  (reuse the model validators), and quote→selector resolution. Pure,
  heavily unit-tested with a **mocked** client (no live API in CI).
- **14.5.3 — review UI.** The reader "✨ Suggest…" control + the grouped
  review panel (Accept/Edit/Reject per proposal) that funnels accepts into
  the existing models with `suggested_by: 'llm:<model>'`.
- **14.5.4 — tests + smoke + docs.** Mock-client tests for the full
  mapping + the no-verdict/counter-note enforcement; `SMOKE_TEST.md`
  §Phase 14.5; CHANGELOG; ROADMAP 14.5 → done.

## Acceptance criteria

- With the flag on + a key set, "✨ Suggest…" on a captured article
  returns proposals for **entities, claims, assessments, relationships,
  and findings**, each reviewable; Accept creates the real artifact
  (visible in the claims/findings bars) tagged `suggested_by: 'llm:<model>'`.
- A proposed **finding always carries a counter-note and ≥1 quoted
  anchor**, or it is shown rejected-with-reason and never saved; no
  proposal carries a stance/score/intent on a person.
- Flag **off** or **no key** ⇒ the Suggest control is absent/disabled and
  **zero** network calls are made.
- The key never appears in exports/logs; `npm test`, build, and
  `web-ext lint --self-hosted` are green; Firefox ≥128 behaves identically.

## Gotchas (don't relearn these the hard way)

- **Browser-origin Anthropic calls** need
  `anthropic-dangerous-direct-browser-access: true` (and CORS is enabled
  for that header). Run the `fetch` in the **service worker**, not a page
  with site CSP. If a future API change blocks direct browser access,
  fall back to documenting a user-run proxy — do not ship a hidden one.
- **MV3 host permissions**: add `https://api.anthropic.com/*`; keep it
  narrow. Re-read the flag/key on each SW wake (the SW sleeps).
- **Anchoring drift**: the model's "verbatim" quote may not be byte-exact;
  resolve with a tolerant text-find, and if it fails, keep the proposal
  with the quote but a null selector (the model layer already tolerates a
  quote-only anchor — except findings, which need the quote non-empty).
- **Provenance honesty**: don't relabel an LLM proposal as `user` just
  because it passed through a modal; only the user's substantive edits
  should change provenance. Keep `isValidSuggestedBy` happy
  (`llm:<non-blank-model>`).
- **No new save/publish paths** — reuse `EntityModel` / `ClaimModel` /
  `AssessmentModel` / `EvidenceLinker` / `ForensicModel`. The wire +
  reconciliation already understand `suggested_by`.
