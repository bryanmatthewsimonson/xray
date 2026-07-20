# Entity Pages — grounded knowledge artifacts, claims-first (kickoff)

**Status: APPROVED 2026-07-20** (maintainer: "write the kickoff doc and
build the slices"). Supersedes the retired Phase 19 fact layer as the
path to Wikipedia-like entity artifacts (see `docs/JOURNAL.md`
2026-07-20 and the `ENTITY_DOSSIER_DESIGN.md` retirement banner).

Related: `docs/CASE_SYNTHESIS_DESIGN.md` (the map/reduce engine this
reuses wholesale), `docs/ENTITY_DOSSIER_DESIGN.md` (the surviving
dossier assembler), `docs/PHILOSOPHY.md` (P6 knowability, P8
disagreement-is-data — normative posture here), `docs/NIP_DRAFT.md`
(the page publishes as an ordinary kind-30023; no new wire kind).

## 1. Diagnosis — why facts failed, and what that teaches

The Phase 19 fact layer built Wikipedia's **infobox** without
Wikipedia's **article**:

- **Premature ontology.** A fixed typed registry (`birth_date`,
  `headquarters`, validity windows) forced the corpus into slots
  before knowing what it contained. Real captures assert prose-shaped
  things; almost nothing fit, and what fit carried *less* information
  than the quoted claim it rode on.
- **Double data entry.** Capturing a fact meant filling a form for
  something the quote already said better.
- **Backwards priority.** A wiki page's value is grounded prose with
  citations; the infobox is a byproduct. We built the byproduct first,
  and sophisticated machinery (precision bands, conflict comparators,
  a wire kind) served a data model nobody fed.

The lesson is NOT "knowledge artifacts are out of reach." It is:
**the claim is the atom** (P2). X-Ray already owns Wikipedia's three
pillars, claims-first:

| Wikipedia pillar    | X-Ray equivalent (shipped)                             |
|---------------------|--------------------------------------------------------|
| Verifiability       | Claims with verbatim quotes + content-addressed hashes  |
| Neutral POV         | P8: contradicts links, distributions, side-by-side variance — never averaged |
| No original research| Extraction-only Suggest + the quote-grounding firewall  |

And the **case brief** is a working prototype of the entire loop:
corpus → cached map extracts → grounded synthesis → human review →
replaceable publish with staleness. The smarter way is to point that
engine at a subject.

## 2. The design in one paragraph

**An entity page is a case brief about a subject.** Prose sections,
every citation grounded to a verbatim member quote; disagreement
rendered side by side with attribution, never resolved; coverage gaps
stated honestly (P6); a "key facts" box that is a **curated list of
claims** (the claim is the fact; the quote is the verification — no
ontology, no forms); human-reviewed before anything persists as the
page; published as a **user-signed replaceable kind-30023** that
updates like a wiki revision. No new wire kind: the page's citations
are `a`-refs to published kind-30040 claims, which IS the
machine-readable layer.

## 3. Guard rails (the mistakes that must not return)

1. **No typed fields.** The page tool schema has no
   `field`/`value`/`valid_from` slots and no numeric slots
   (grep-tested). Dates and roles live as prose inside claims.
2. **No model knowledge.** If the corpus doesn't establish it, it is
   not on the page — it goes in `gaps`. Same rule the retired fact
   prompt carried, now enforced at the only surface left.
3. **No verdicts, scores, or adjudication** (P8, §10 red lines). The
   disputes block presents sides; the prompt forbids resolving them;
   the schema has nowhere to put a winner.
4. **No minted references.** `key_claim_ids` must be a subset of the
   digest's claims index (code-filtered, not just prompted);
   citations ground against member texts or drop, disclosed.
5. **One-request-builder rule (corpus-v4).** The map stage builds
   requests via `corpusMapRequest` with the ACTIVE CASE's frame when
   the workspace is case-bound — byte-identical cache keys, so an
   entity page inside a worked case reuses the extracts Analyze /
   Pre-analyze already paid for. Never a hand-built lookalike.
6. **Custody.** The page is the researcher's synthesis — a
   judgment-carrying artifact — so the USER signs it (Signer), never
   an entity key. Entity keys keep signing exactly what they sign
   today (kind-0, mention notes, 32125s); the signing-site pin in
   `tests/custody-guards.test.mjs` must not move.

## 4. Slices

- **EP.1 — Entity corpus slice (reuse, not build).** Membership is
  the dossier orbit already computed by `collectEntityDossierData`
  (alias family: claims about ∪ spoken-by ∪ tagged articles); member
  units come from `buildMemberUnits` over that envelope — the SAME
  builder case synthesis uses. `ensureExtracts` runs the cache-first
  map stage: plan keys via `corpusMapRequest`/`corpusExtractKey`,
  reuse valid hits, call `xray:llm:corpus-map` only on misses,
  persist via `saveCorpusExtract`. In a case-bound workspace the hits
  are the case's own extracts (see rail 5) — an entity page for
  anyone in a worked case costs ~one reduce call.
- **EP.2 — The entity-page reduce.** `emit_entity_page`
  (`entity-page-v1`): input = a deterministic entity digest (subject,
  claims index with art-keys, judgment distributions, co-tagged
  names, coverage) + the member extracts; output = `lead`, prose
  `sections` (headings emerge from the corpus, not a template) each
  carrying `citations`, `key_claim_ids` (selected, subset-filtered),
  `disputes` (sides side-by-side, each groundable), `gaps`. Validated
  by schema-walker; citations grounded per member; a section whose
  citations all drop is flagged `uncited`, never silently trusted.
  Stored locally in the `xray-audits` DB (`entity-pages` store, DB
  v6, keyed by entity id) with `inputHash` staleness — the brief's
  exact discipline.
- **EP.3 — Review UI.** The portal entity dossier gains an "Entity
  page" block: Generate (spend confirm disclosing map misses + 1 page
  call), then section-by-section edit/remove, and the key-facts
  checklist (which selected claims ride the box). Human curation is
  the editorial layer Wikipedia gets from editors. Nothing persists
  as the page without the human's Save.
- **EP.4 — Publish.** A replaceable kind-30023 (`d:
  xray-entity-page-<dtag>`, stable per entity), USER-signed, `p`-tag
  on the entity, `a`-refs to every cited claim that is itself
  published, `x` tags for member hashes; content is the assembled
  markdown (lead, sections with quote citations, key facts quoting
  their claims, disputes, gaps, provenance footer). Gated behind
  `entityCorpusPublishing` (the existing entity-publish consent);
  generation is gated behind `caseSynthesis` + `llmAssist` + the API
  key (it IS the synthesis engine — same spend class, same gates; no
  new flags).
- **EP.5 — Freshness.** `entityPageInputHash` (members + claim ids +
  prompt version) compares stored vs live: a stale chip and an
  Update button re-run the reduce over current extracts (map misses
  only re-pay for changed/new members).

## 5. Costs

Map: reused from the case cache where the workspace is case-bound;
otherwise one call per uncached member (disclosed before running).
Reduce: one call per generate/update (`MAX_ENTITY_PAGE_OUTPUT_TOKENS`
bounded). The digest and grounding are free (local, deterministic).

## 6. Deferred (recorded, not committed)

- A structured companion event for the page (only if real consumers
  need more than the 30023 + `a`-refs — resist repeating 30067).
- Entity-framed extracts (own map pass focused on the subject) if
  case-flavored extracts prove inadequate in real pages.
- Cross-entity page interlinks (wiki-style links between published
  pages).
