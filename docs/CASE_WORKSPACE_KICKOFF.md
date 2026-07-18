# Case-as-workspace — the type fix, the orbit fix, and the identity question

> **Status:** design draft, **2026-07-17**, written for maintainer
> review. **NOT approved.** Nothing here is a decision; §6 is the list
> of things only the maintainer can settle. This file exists to be
> merged to `main` and handed to a fresh Claude Code session as its
> starting prompt — so it is self-contained, and §7 is the "start
> here" brief.
>
> **Where this document and the constitution disagree, the
> constitution governs** — [`docs/PHILOSOPHY.md`](PHILOSOPHY.md) (the
> normative constitution of the audit family, `30056`–`30061`),
> [`CASE_DOSSIER_DESIGN.md`](CASE_DOSSIER_DESIGN.md) §2.2 ("**No
> case-level score, ever**"), and
> [`TRUTH_ADJUDICATION_DESIGN.md`](TRUTH_ADJUDICATION_DESIGN.md) §1
> (the form-of-judgment spine). This draft proposes no score, no
> aggregation, and no new evaluative number; if an implementation of
> it starts computing "case strength," it has left the constitution
> and the constitution wins. Two further normative texts are
> load-bearing here and are quoted where they bite:
> `TEAM_CASE_DESIGN.md` §1 ("the case is a **lens, not a container**")
> and §2.1's **custody rule** ("the case key never signs judgment
> kinds"). §3 and §4 are written to respect both; §6 Q4 asks whether
> the maintainer wants to amend them, because part of his proposal
> cannot be built without doing so.
>
> **Phase number:** unclaimed. ROADMAP's tail is Phase 26 (in
> progress, `ROADMAP.md:1807`); Phase 27 is in flight on
> `claude/phase-27-*` and not yet in ROADMAP. **28** is the next free
> slot — confirm before claiming it.
>
> **Every number in §1 and §4 was re-measured** from
> `xray-backup-2026-07-17 (1).json` for this draft, not carried over
> from the investigation briefs. Where the briefs disagreed, the
> corrections are called out inline. **The widely-repeated "252
> entities / 796 claims" is stale: the real figures are 283 and 980.**

---

## §1. The problem

In the maintainer's words:

> "The LLM suggest feature keeps on suggesting/creating 'cases', but
> doing it for things like scientific papers and court cases. … As a
> researcher trying to figure out the answer to a question, or go deep
> on a particular topic, I want to make sure that the articles and
> entities I capture don't mess with too many other unrelated items.
> … The current design dictates that the entities list will keep
> growing and growing…"

### §1.1 What is actually in the registry

| Measured | Value |
|---|---|
| entities | **283** — person 137, organization 85, thing 32, place 24, **case 5** |
| `local_keys` | **261** (260 `entity:<id>` + the reserved `xray:user` slot) |
| claims | **980** (843 carry a `publishedPubkey`) |
| archive records | 62 articles + 98 `source_documents` |
| `platform_accounts` | 390 — **0 carry `linkedEntityId`** (the Phase-9 link layer is inert) |
| identity profiles | 2 — `epistack` (`6daa7f3b…`), `Personal` (`4ba5145d…`) |
| publishing pubkeys on claims | `6daa7f3b…` × 818, `4ba5145d…` × 25 |

The five `case` entities, with the provenance field that decides the
whole argument (`entity-model.js:314`, `cleanSuggestedBy` at `:188`):

| name | `suggested_by` | created | member sources |
|---|---|---|---|
| **What is the origin of Covid?** | **`user`** | 2026-07-03 | 49 (all tag-mediated) |
| Proximal Origin paper | `llm:claude-opus-4-8` | 2026-07-12 | 1 |
| Pekar et al. 2022 paper | `llm:claude-opus-4-8` | 2026-07-12 | 1 |
| Worobey et al. paper | `llm:claude-opus-4-8` | 2026-07-12 | 1 |
| The pending litigation connected to the matter | `llm:claude-opus-4-8` | 2026-07-12 | 1 |

**`suggested_by` separates project from subject-of-study with 100%
accuracy on this data.** Every user-made case is a project; every
LLM-made case is a subject. All five carry `authored_fields: null` —
no case has a scope question yet, including the real one.

Two corrections to the framing the briefs inherited:

- **The three "paper" cases are all tagged on one article** —
  `michaelweissman.substack.com/p/an-inconvenient-probability-v57`.
  Their apparent orbits are that one article's entities, three times.
- **"The pending litigation connected to the matter" is not a COVID
  lawsuit.** It is tagged and claimed exclusively on
  `bricksandminifigs.com/blog/blog/2026/07/10/an-update-to-our-customers-and-community`
  — the Lego-store matter.

### §1.2 Root cause: `case` is overloaded, and the prompt says so out loud

The word does three jobs — *lawsuit*, *workspace*, *story-under-
assessment* — and the two halves of the codebase have already picked
different ones.

**The type comment still says "subject."** `entity-model.js:46-50`:

```js
// `case` (Phase 11.1) models a real-world story under assessment —
// "John Dehlin excommunication", "Bricks & Minifigs scandal" — so the
// side-panel entity detail can serve as the case dashboard
export const ENTITY_TYPES = ['person', 'organization', 'place', 'thing', 'case'];
```

**The field schema says "project."** `entity-field-schemas.js:66-71`
gives `case` four rows, **all `provenance: 'authored'`** — the only
type in the registry with zero *sourced* fields:

```js
    case: Object.freeze([
        row('scope_question', 'Scope question', 'text', { provenance: 'authored' }),
        row('status',         'Status',         'enum', { provenance: 'authored', evolves: true, … }),
        row('opened',         'Opened',         'date', { provenance: 'authored' }),
        row('closed',         'Closed',         'date', { provenance: 'authored' })
    ])
```

Every other type answers *"what does the world assert about this?"*;
`case` answers *"what am I investigating?"*. Phase 19 redefined the
type in the schema and never told the comment. Phase 20 then built
`case-membership.js`, `case-dossier.js`, `case-graph.js`, and
`case-synthesis` on the project reading. **The code has already
decided. Only the comment and the prompt are stale.**

**The prompt is the proximate cause, and it is not subtle.**
`llm-prompts.js:382-387`:

```js
const RULES_ENTITIES = `
ENTITIES (people / organizations / places / things / cases named in the text):
…
- type must be one of: ${ENTITY_TYPES.join(', ')}.`;
```

Line 383 asks the model to find, inside the article, the one thing
that by construction is never in it — the researcher's own frame. Line
387 interpolates `ENTITY_TYPES` raw (`llm-prompts.js:26` imports it),
rendering `person, organization, place, thing, case` with **no
definition of any type**. `person`/`organization`/`place` self-define;
`thing` and `case` do not. So the model resolves `case` to ordinary
English — a matter under investigation — and proposes the litigation.
**The model is obeying the prompt.** Compare the forensic rules in the
same file, where this debt was already paid: `:431-438` spends eight
lines defining attribution ("*the most common error, so read
carefully*") and `:449-450` injects the full `MANEUVER_GUIDE`. Entities
get one parenthetical. The asymmetry is the bug.

Note the Options hint already disagrees with the prompt and is right —
`llm-prompts.js:89-90`: *"people, organizations, places, and things
named in the text."* No cases.

**Nothing auto-accepts.** `reader/index.js:1905` → `xray:llm:suggest`
→ `background/index.js:485` `runSuggestionPass` → `openLlmReview`
(`reader/index.js:1928`). The four bad cases were confirmed by hand.
But the prompt manufactured the proposals, and a reviewer clicking
through twenty rows takes the type the model chose.

### §1.3 The uncomfortable part: this behavior is *documented as intended*

`CASE_DOSSIER_DESIGN.md:14-20`, verbatim:

> "A **case** is an entity (`type: 'case'`) used as a folder:
> articles, claims, entities, and judgments accumulate in its orbit,
> and **on several occasions the LLM Suggest pass has proposed court
> cases as case entities — consistent with the intent.**"

The maintainer's complaint is against **blessed** behavior. This
kickoff proposes to supersede that sentence and the `entity-model.js:46-49`
comment (§3.1). That is an amendment to a design doc, and it needs his
sign-off, not a patch. Related irony worth naming: `entity-model.js:48`
offers **"Bricks & Minifigs scandal"** as a canonical example case —
the exact corpus he now cites as contamination. The two use cases were
*designed to share one registry*.

### §1.4 The contamination: what actually happened

**Not a manual paste.** `portal_identities` in his backup is `[]` — he
pasted nothing. (One investigation brief asserted `addManualIdentity`
was the mechanism; **that is wrong**, and the correction matters
because it changes which line to fix.)

The real chain needs no user action at all:

1. He has two identity profiles and **one workspace**. Switching
   profiles moves `local_primary_identity` and **touches no content**
   — `IdentityProfiles.activate()` (`identity-profiles.js:189-197`) is
   *only* `Storage.primaryIdentity.set(profile.privateKey)`.
2. So 818 epistack claims and 25 Bricks & Minifigs claims sit in one
   `article_claims` store, each stamped with its own
   `publishedPubkeys` (`claim-model.js:437-452`).
3. `resolveIdentities()` (`portal/identity.js:99-109`) unions
   **every `publishedPubkey` on every claim** into "me" under source
   `'publish-history'`. Both npubs are now one identity set.
   Provenance is tracked for chip display and **scopes nothing**.
4. `portal/index.js:981-987` → `fetchCorpus({pubkeys: state.identities.map(…)})`
   → `portal/corpus.js:169,186-188` — **one REQ, all authors, all
   kinds.**
5. `portal/reconcile.js:88,115,159` cross-products every local d-tag
   against every pubkey in the union. COVID assessments become
   "expected" under the Bricks npub and vice versa — the ledgers
   **interlock**, not merely co-display.

The module header predicted this exactly — `identity-profiles.js:12-17`:

> "Switching identity does NOT touch content records. … an identity
> switch **without a workspace reset** would make the portal/reconcile
> attribute the old npub's publishes to the new one. `resetWorkspace()`
> is the paired half."

He ran the documented-unsupported configuration. The shipped UI even
says so (`options/index.js:377`: "*use Start fresh workspace (Advanced)
for a clean slate*"). **His proposal is, correctly, a request to make
the paired half unnecessary** — because `resetWorkspace()` is
destructive and serial (`identity-profiles.js:252-266`), and "delete
one project to work the other" is not an answer for someone running
two concurrently.

### §1.5 The finding that actually explains "the entities list keeps growing"

**His real case's entity orbit contains exactly one entity: itself.**

Membership is defined twice, and the two disagree:

| Definition | Where | Rule |
|---|---|---|
| `memberUrlSets` | `case-membership.js:34-60` | **tag OR claim** (the Phase-20.1 union) |
| `collectCaseEntityIds` | `case-bundle.js:34-49` | **claim only** — `c.about.includes(caseEntityId)` |

`case-bundle.js:31-32` declares itself "**THE definition of case-orbit
membership**," and `case-dossier.js:80` uses it for `orbit.entity_ids`.
He built his COVID workspace entirely by **tagging** — 49 member
articles, **0 claims `about` the case**. Measured:

```
"What is the origin of Covid?"
   member articles = 49 (all tag-mediated)
   SHIPPED collectCaseEntityIds  →   1 entity  (the case itself)
   UNION (tag-inclusive)         → 265 entities
```

**Correction to one brief:** it concluded from this that "his case
dashboard is empty." It is not. `deriveArticleRows`
(`case-dossier.js:290-318`) *is* tag-inclusive — the 49 articles render
as first-class rows with `membership: 'tag'`, `processed: false`. And
`case-graph.js:30-32` sidesteps the orbit entirely by reading
`data.entitiesById`. So articles and the graph work; **the entity
orbit is what is empty**, and it feeds `collectCaseBundle`
(`case-bundle.js:59`), the integrity filter (`case-dossier.js:131-136`),
and the forensic bridge (`:138`).

The codebase **documents its own gap** — `case-dossier.js:184-187`:

> "Full entity registry snapshot (Phase 20.3) — the case graph
> resolves names for entities TAGGED on member articles that never
> entered an orbit claim (**so aren't in orbit.entities**)."

So: he has a case view. Half of it is wired to the wrong side of a
union that Phase 20.1 already defined. What he sees instead is the
side panel's flat list of all 283 (`sidepanel/index.js:107` renders
`EntityModel.getAll()` with a type filter and no case filter). **That
is "the entities list will keep growing and growing."** He is proposing
an identity re-architecture to fix, substantially, a one-sided orbit
definition and a stale prompt.

---

## §2. What already exists

Scrupulously: **most of this proposal is built.** The parts that are
not built are the parts that are dangerous. Read this section as the
do-not-rebuild list.

### §2.1 Built and correct — do not touch

| Capability | Where | Note |
|---|---|---|
| **Union membership (tag ∪ claim)** | `case-membership.js:34-60` | the definition his workspace depends on |
| **Add/remove sources outside the reader** | `case-membership.js:103-141` | writes `context: ''` refs, canonicalized to the alias root; **never publishes** (`:8-13`) |
| **Case dossier assembler** | `case-dossier.js` (1055 lines) | derived, computed-on-read, no wire kind |
| **Local case graph** | `case-graph.js` + `portal/case-graph-view.js` | pure/deterministic; case center, member articles, co-tag adjacency, contradiction warn-edges, ghost nodes (`:155-159`), degree-ranked cap |
| **Portal case dashboard** | `portal/case-view.js` (508 lines) | 10+ blocks; router at `portal/index.js:745,767` |
| **Case scope authoring** | `sidepanel/index.js:299-305` | "Case scope — *your framing*"; the project reading, already shipped |
| **Case export / bundle** | `case-export.js`, `case-bundle.js` | 11.6 / 11.8 |
| **Case synthesis** | Phase 20.4, `caseSynthesis` flag | grounded brief, no new wire kind |
| **Identity profiles** | `identity-profiles.js:115-227` | per-case identities, **already the prescribed default** (`TEAM_CASE_DESIGN.md:224-228`) |
| **Workspace clear/backup** | `identity-profiles.js:36-95,236-266` | 21 content stores + 3 IDBs, enumerated and pin-tested |
| **Foreign keyless entities** | `entity-model.js:476-510` | TC.1/KS.3; adopt-on-sight |
| **Case-scoped follow sets** | `follow-model.js:31,46-57` | `FOLLOW_SCOPES = ['case','entity','global']` |

### §2.2 Built, tested, and **unused** — free leverage

**Case-scoped follows have zero consumers.** `FOLLOW_SCOPES` includes
`'case'` and `anchorKey()` produces `'case:<id>'`, but both consumers
hardcode global:

- `network/index.js:40` — `const GLOBAL = { scope: 'global' };`
- `follow-publish.js:25-27` — `selectFollowsToPublish()` returns
  `FollowModel.getSet({ scope: 'global' })`, commented "**the GLOBAL
  anchor, nothing else**".

The only `scope: 'case'` call sites in the repo are
`tests/follow-model.test.mjs:24` and `tests/follow-publish.test.mjs:43`.
A tested, shipped, consumer-less data model with **no migration cost**
— and it carries the OPSEC closure the proposal wants
(`KNOWLEDGE_SHARING_DESIGN.md:203-208`: case- and entity-anchored
follow sets **never publish**). This is the single largest piece of
free real estate here, and it is exactly the "simplify collaboration"
half of the proposal.

### §2.3 The concept he is asking for **already has a name in this repo — and it is a singleton**

`options/options.html:239-247` defines *workspace* as, near-verbatim,
his proposed case scope:

> "A workspace is everything you have captured or authored: entities
> (and their keypairs, including the entity-sync key), claims,
> evidence links, assessments, forensic findings, truth adjudications,
> platform accounts, the archive cache, audit records, and the
> signed-event journal. Settings, relays, feature flags, the LLM key,
> and your saved identities are not part of it."

Compare: *"use a case entity as the workspace, including all articles,
entities, links, comments, etc."*

**So the proposal, stated precisely, is: make `workspace` per-case and
N-instance.** Today N=1, it is defined extensionally by three frozen
lists (`WORKSPACE_CLEAR_KEYS` / `KEEP_KEYS` / `DATABASES`,
`identity-profiles.js:36-95`), and the only "switch" is *destroy and
start over*. There is **no active-case concept anywhere** —
`grep -rni "active_case|activeCase|currentCase|current_case" src/`
returns zero.

### §2.4 New vs renaming — say it plainly

| Element of the proposal | Verdict |
|---|---|
| "Each case is like a project" | **Renaming.** The schema (`entity-field-schemas.js:66-71`) and all of Phase 20 already say this. Only `entity-model.js:46-49` and `llm-prompts.js:383` are stale. |
| "Everything gets tagged" | **Built.** `case-membership.js` + the `['p', casePubkey, '', 'about']` wire idiom (`TEAM_CASE_DESIGN.md:100-102`). |
| "A universal graph … explored in one place" | **80% built.** `case-graph.js` does one case. Missing: a multi-case root and cross-case edges (§3.3). |
| "Case entity as the workspace" | **New — and collides with `TEAM_CASE_DESIGN.md:66-72`** ("lens, not a container … **Nothing in the data model carries case membership beyond ordinary tags**"). |
| "Avoid accidentally merging two projects" | **New.** A real gap; §4.1 only *prescribes* against it and nothing enforces. |
| "Segregating their data with that case npub as the capturing identity" | **New, forbidden in part, and does not deliver segregation** (§4.2, §4.3). |
| "Simplify collaboration" | **Free** — §2.2's case-scoped follows. |

### §2.5 Two live tensions the repo already carries, independent of this proposal

Record these either way; they are not this proposal's fault.

1. **`TEAM_CASE_DESIGN.md:224` prescribes per-case identities. Phase 24
   (COMPLETE) derives every entity pubkey from the primary** —
   `ENTITY_IDENTITY_DESIGN.md:104-125`: "same primary + same entity
   type/name ⇒ same pubkey, **forever**", `ENTITY_KEY_DOMAIN =
   'xray-entity-v1'` (`entity-model.js:44`). Following the prescription
   therefore mints a *different* pubkey per case for the same human. The
   two were never reconciled. **Live consequence:**
   `restoreDerivedKeys()` (`entity-model.js:337-356`) re-derives from
   *whatever primary is active* — run it under "Personal" and every
   epistack-era entity silently re-derives to a wrong pubkey. The
   doc-comment (`:329-334`) discloses the discontinuity only for the
   *legacy-random* case, **not** the cross-profile one. This looks like
   an undocumented gap, not a decision.
2. **The custody rule is doc-only.** `grep` finds no enforcement in
   `src/` — nothing stops a case key from signing a 30062 today.
   Compare Phase 16, where the analogous red line ("30066 stays free")
   *is* guard-tested. **The guard is owed regardless of which way §6 Q4
   goes.**
3. Minor, but it bites "avoid merging two projects": the portal's case
   facet is **name-keyed, not pubkey-keyed** — `portal/index.js:191-197`
   scans `state.entityIndex` for `ent.type === 'case' && ent.name === name`.
   Two same-named cases collide. (They also collide at the id layer,
   since `generateEntityId` is `sha256(type:name)`.)

---

## §3. The design

Split hard along one line: **the parts that scope a *view* are cheap,
safe, and reversible; the parts that change *identity* are expensive,
partly forbidden, and — the decisive point — do not deliver the
segregation they are meant to buy (§4.2).**

The recommended shape is **lens, not partition**, consistent with
`TEAM_CASE_DESIGN.md:66-72`. **It requires zero wire-format changes.**
That is not a happy accident; it is the selection criterion.

### §3.1 SAFE — the type vocabulary fix

**Recommendation: do NOT add a type. Do NOT split `case`. Fix the
comment, the prompt, and the guard.**

`ENTITY_TYPES` stays `['person','organization','place','thing','case']`
and `case` means **the researcher's workspace** — which is what
`entity-field-schemas.js:66-71` already encodes and what every Phase-20
module already assumes. Amend the two stale texts:

- `entity-model.js:46-49` — the "real-world story under assessment"
  comment. Replace: a `case` is the **researcher's investigation
  workspace**; it carries only authored fields; it is created by a
  human, never extracted from an article.
- `CASE_DOSSIER_DESIGN.md:14-20` — strike "consistent with the intent."

**Why not add `project` / `proceeding` / `paper`?** Each is a verified,
load-bearing cost, and the last one is disqualifying:

1. Every new type needs a field registry —
   `tests/entity-field-schemas.test.mjs:39` pins
   `Object.keys(ENTITY_FIELD_SCHEMAS).sort() === ENTITY_TYPES.sort()`.
2. `ENTITY_TYPES` is exhaustively pinned —
   `tests/entity-model.test.mjs:261`, plus the tag-map loop at `:267`
   and the `buildArticleEvent` loop at `:277`.
3. **The tag mapping is quadruplicated, not centralized.** There is no
   `ENTITY_TYPE_TAGS` constant. It is `entityTypeToTag`
   (`entity-model.js:56-65`), hand-copied as an inline ternary at
   `event-builder.js:310` **and again at `:319`**, and inverted as
   `TAG_TO_TYPE` at `:987-990`. The only guard is a "Keep in sync"
   comment. A new type that updates only the map **falls back to
   `'place'` silently on the wire** — the test at
   `tests/entity-model.test.mjs:277` exists because this already
   happened once.
4. **Bundle import hard-rejects unknown types** —
   `case-bundle.js:135-138` pushes to `invalid` and `continue`s. A
   collaborator on an older build **silently drops** every
   `project`-typed entity. That directly damages the collaboration goal
   in the proposal. (30078 sync is tolerant — `entity-sync.js:130` only
   requires a string — so the split breaks bundles, not sync.)
5. **Disqualifying: the wire type is a read-path key on the kind-0
   `about`.** `event-builder.js:570` emits
   `` `${entity.type} entity created by X-Ray` ``, parsed back by a
   regex built from the **live** vocabulary —
   `adopt-entity.js:35`:
   ```js
   const m = new RegExp('^(' + ENTITY_TYPES.join('|') + ') entity created by X-Ray').exec(content.about || '');
   ```
   Rename `case` → `project` and **every already-published case kind-0
   on relays stops matching**, silently falling back to `defaultType`
   (`'person'`). Every collaborator adopting his COVID case would adopt
   it as a *person*.

`ASSESSMENTS_DESIGN.md:427-430` already argued this, in the
maintainer's own words — entity type is wire-visible, so churning the
vocabulary means "a type migration + republish later — exactly the
wire-vocabulary churn the compat rule exists to avoid." That reasoning
now cuts **against** the split.

**A scientific paper is not an entity problem — it is already an
article.** X-Ray's native representation of "Proximal Origin" is a
captured kind-30023, and the URL layer already knows what a paper is
(`url-identity.js:33` `ARXIV_HOSTS`, `:104-114` `arxivOriginal()`).
Captured articles are already first-class case-graph nodes
(`case-graph.js:104`). Where an entity *handle* is genuinely wanted,
`thing` fits better than `case` ever did: `thing_type` = "scientific
paper" / "litigation", `creator` (entity-ref, **multiple**) = the
authors, `created_date` = publication date
(`entity-field-schemas.js:61-65`), and gaps close with custom fields —
`CUSTOM_FIELD_RE = /^custom:[a-z0-9][a-z0-9_-]{0,47}$/`
(`:77`, synthesized def at `:100-106`) → `custom:journal`,
`custom:docket`, `custom:court`.

### §3.2 SAFE — the suggest-prompt fix

Make the model **structurally unable to mint a workspace**. Three edits
plus a guard, all mechanical:

1. **`llm-prompts.js`, near the `:26` import** — a suggestable subset:
   ```js
   // A `case` is the RESEARCHER's workspace — authored fields only
   // (entity-field-schemas.js:66), never a thing named in an article.
   // The model may not mint one; humans create cases in the side panel.
   export const SUGGESTABLE_ENTITY_TYPES = Object.freeze(
       ENTITY_TYPES.filter((t) => t !== 'case'));
   ```
2. **Rewrite `RULES_ENTITIES` (`:382-387`)** — drop "cases named in the
   text", **define every type** (the `thing` gap is half the bug), and
   name the failure mode explicitly, in the house style already used
   for forensic attribution at `:431-438`:
   > `thing` — anything else with a name: a scientific paper, a lawsuit,
   > a product, a report, a policy, an event. **When in doubt, it is a
   > thing.** A SCIENTIFIC PAPER is a thing, never a case. A LAWSUIT is
   > a thing, never a case. "Case" here means the researcher's own
   > investigation workspace — it is never named in an article and you
   > must never propose one.
3. **Narrow the tool enum** (`:170-173`) to `SUGGESTABLE_ENTITY_TYPES`.
   Guidance only — `:126-131` documents that strict mode is
   deliberately off and "the real firewall is each model's create() at
   accept time." Hence:
4. **Hard guard in the validator** — `llm-proposals.js:179-181` is
   currently `if (!ENTITY_TYPES.includes(prop.entity_type))`. Switch to
   `SUGGESTABLE_ENTITY_TYPES` with a `case`-specific message that tells
   the human what to do instead.

**One deliberate narrowing to flag.** `reader/llm-review.js:214` calls
`validateProposal` inside `validityOf(row)`, which re-runs on every
render — so a human retyping a row *to* `case` in the review modal
would see it go invalid (the type `<select>` at `llm-review.js:66`
offers `ENTITY_TYPES`). **Recommend accepting that**: creating a
workspace is not a per-article capture decision, and the side-panel
create form (`sidepanel/index.js:1272,1290`) stays the sovereign path.
Also point `llm-review.js:66` at `SUGGESTABLE_ENTITY_TYPES` so the UI
does not offer what the validator rejects.

**Wire consequence: none.** No kind, tag, `d`, or content field
changes. `ENTITY_TYPES` is untouched, so `adopt-entity.js:35` keeps
parsing every published case kind-0, and
`tests/entity-model.test.mjs:261` stays green. No existing test pins
`case` in the suggest enum or in `RULES_ENTITIES` (checked
`tests/llm-proposals.test.mjs`, `tests/llm-suggest-kinds.test.mjs`; the
negative case at `llm-proposals.test.mjs:147` uses `'alien'`).

### §3.3 SAFE — the orbit fix, and it is the one that changes his day

**Make `collectCaseEntityIds` tag-inclusive so it matches the union
`case-membership.js:34-60` already defines.** Measured effect on his
data: **his COVID case goes from 1 entity to 265.**

This is the fix for "unwieldy." He has a workspace view; half of it is
wired to the wrong side of the union. Mechanically: `collectCaseEntityIds`
must walk the alias family's **tag** membership as well as claim
`about` — the same `memberUrlSets` logic, hoisted so both callers share
one definition. Watch three things:

- `case-bundle.js:31-32` calls itself "THE definition" — after this
  change that is finally true. Keep the exported name; fix the body.
- **The bundle is the risk surface, not the dossier.** `collectCaseBundle`
  (`case-bundle.js:59`) exports **entity private keys**. Widening the
  orbit from 1 → 265 widens what a bundle export hands over by two
  orders of magnitude. **This is a CLAUDE.md private-key concern and
  must be a deliberate, separately-reviewed step** — recommend the
  dossier/graph read the widened orbit first, and the bundle keep the
  narrow one (or gain an explicit scope selector + a count in its
  confirm) until the maintainer rules. See §6 Q2.
- Ordering/determinism: `case-dossier.js:94` sorts `entityIds`; the
  graph's degree-rank cap (`case-graph.js:29`, `maxEntities = 40`)
  already handles 265 gracefully.

**Wire consequence: none.** Pure local read-path.

### §3.4 SAFE-ish — case-as-workspace scoping (the lens)

Three pieces, no storage migration, no wire change:

1. **An active-case pointer.** One preference key (e.g.
   `preferences.active_case`) + a switcher in the side panel and
   portal. Every *write* path stamps the active case ref by reusing
   `addArticlesToCase` **verbatim** (`case-membership.js:103-124`) —
   `context: ''`, canonicalized to the alias root. Claims already carry
   `about`. The existing union membership then does the rest for free.
2. **Scope the reads that leak.** In priority order:
   - `resolveIdentities()` (`portal/identity.js:80-134`) must return a
     case-scoped set, not a flat union. **This is where the
     contamination originates (§1.4) and it is the single
     highest-leverage line in the proposal.**
   - `fetchCorpus` (`portal/corpus.js:169,186-188`) takes the scoped
     author set.
   - `loadLocalLedger` (`portal/reconcile.js:88,115,159,179,190,217,232`)
     stops cross-producting all d-tags × all pubkeys.
   - `portal-cache.js:157` `loadRecords()` is unfiltered; it has
     `kind`/`pubkey`/`created_at` indexes (`:61-63`) and uses none to
     segregate.
   - Incorporation (`incorporation.js:14-16`) accepts into the
     **global** `ClaimModel` — a second contamination vector the moment
     Phase 25 follows are used.
   - Fix the name-keyed case facet → pubkey-keyed
     (`portal/index.js:191-197`, `library.js:420-428`).
3. **Pass the active case into the suggest prompt** so proposals arrive
   pre-scoped.

**Note on `xray-portal`:** it is deliberately **excluded** from
`WORKSPACE_DATABASES` (`identity-profiles.js:86-95` — "a rebuildable
cache in a backup is dead weight"). Under a scoped model a stale cache
is **cross-case leakage**, not merely dead weight. That exclusion needs
re-examining; today the only purge is the portal's own Resync →
`clearAll()` (`portal/index.js:1055` → `portal-cache.js:182`).

**Wire consequence: none.** All of this is read-scoping and local tags.

### §3.5 SAFE — the cross-case graph

`buildCaseGraph` (`case-graph.js:29`) takes one dossier. Add a
multi-case root: loop it over cases, add a case-level ring, and render
**shared entities as first-class cross-case edges**. Reuse the
ghost-node idiom's *visibility* principle (`case-graph.js:155-159` —
"endpoint outside this scope, rendered so it is never hidden") and
invert its meaning.

**This is where the proposal's intuition and its mechanism diverge most
usefully.** An entity in two cases is the **interesting signal** — "did
Bricks & Minifigs just touch COVID?" — and a hard partition would
*delete* it. A design that scopes views can surface it; a design that
partitions identity cannot. Today the only anti-unwieldy mechanism is
caps (`maxEntities = 40`, `maxCotagEdges = 30`); his ask is scoping,
which is a workspace question, not a graph question.

### §3.6 RISKY — "the case npub as the capturing identity"

**Recommendation: do not build this. Build §3.4's per-case *profile*
binding instead — which is `TEAM_CASE_DESIGN.md:224-228`'s existing
prescription — and only if §6 Q3/Q4 come back in its favor.**

The phrase is ambiguous across two different keys, and the reading
decides everything:

- **Reading A — the case *entity's* key signs captured content.**
  Violates the custody rule (`TEAM_CASE_DESIGN.md:104-110`) for every
  judgment kind, and §2.1 (`:94-100`: "the case key signs **exactly two
  things**" — its kind-0 and its 32125s) for the rest. Needs a formal
  amendment, not an implementation. **Also: it does not work** (§4.2).
- **Reading B — a per-case identity *profile* is the active
  `local_primary_identity` while working a case.** This is already
  prescribed, already shipped, and already what his two profiles are.
  What he is missing is not per-case keys; it is **per-case scoping of
  everything downstream of the key** — §3.4.

If Reading B is bound to the workspace (store `identity_pubkey` on the
case entity; activating a case calls the built
`IdentityProfiles.activate(pubkey)`), it dodges the custody rule and
the case-key deviation simultaneously — but it walks straight into
Phase 24's derivation (§2.5.1 and §4.1). The honest options are:

- **(i)** accept per-case entity pubkeys as the *intended* segregation
  and disclose the `#p` fragmentation cost —
  `TEAM_CASE_DESIGN.md:226-228` already frames this as "for adversarial
  casework that is the point." **This is a real amendment to Phase 24.**
- **(ii)** keep ONE primary for derivation and segregate only at the
  view/tag layer. **Preserves the Phase-24 investment and delivers most
  of the ask.** Recommended.

Either way, **`restoreDerivedKeys` needs a guard** (§2.5.1): today it
will happily re-derive an epistack entity under the Personal primary
and mint a wrong pubkey with no warning.

---

## §4. The hard problems, stated honestly

### §4.1 Cross-case entity identity and dossier fragmentation

**The tension is not "what happens to Fauci in two cases." The
mechanics answer that themselves — and then it splits into two
questions with opposite answers.**

Entity identity is **name-derived and global**: `generateEntityId(type, name)`
= `entity_` + sha256(`${type}:${normalizeName(name)}`)[0:16]
(`entity-model.js:117-121`). `EntityModel.create` re-derives the id and,
on the same type+name, **idempotently returns the existing record**
(`:264-273`). So:

> **The same person in two cases already collides — by construction.**
> Capturing Fauci in a second case does not make a second Fauci. It
> cannot.

Entity key material has **exactly one slot per entity id**:
`keyName = entity:${id}` (`:295`); `local_keys` is a flat `name → keyData`
map (`local-key-manager.js:22-25`); `createKey` **throws** if the name
exists (`:30-32`); `importKey` **throws** on conflict — "*never
silently overwrite key material*" (`:58-63`).

**Therefore the proposal's literal ask is not expressible in the current
schema.** Under case-key derivation,
`deriveChildKey(caseKey, 'xray-entity-v1', entity_0353…)` yields a
different pubkey per case for the same Fauci id — but there is one slot
named `entity:entity_0353…`. The second case either silently reuses the
first case's Fauci key (**no segregation achieved**) or throws.

**THE REAL NUMBER, measured, four ways:**

| Question | Answer |
|---|---|
| Entities in >1 case orbit **today**, shipped claim-only definition (`case-bundle.js:34-49`) | **0** — the mechanism is unused: 973/980 claims are about no case |
| Entities in >1 case orbit under the **union** definition | **16** (20 counting the case-typed entities themselves) |
| …after the §3.1/§3.2 retype leaves **one** case | **0** |
| Entities shared between his **two real projects** (epistack 175 entities / 818 claims vs Personal 12 / 25) | **0.** Source URLs shared: **0** (Personal is 2 URLs, both `bricksandminifigs.com`) |

**All 16 are artifacts of the misclassification** — the three
paper-cases are tagged on one article, so their "orbits" are that
article's 19 entities, thrice.

**The forward-looking bound is the number that matters**, because 0 and
16 both flatter the proposal — he has one real project. Any sub-case
partition of COVID inherits the **intrinsic sharing rate**:

```
entities referenced by ≥1 source : 280
  … by exactly 1 source          : 186
  … by >1 source                 :  94  (33.6%)
histogram (sources/entity): {1:186, 2:43, 3:15, 4:8, 5:5, 6:6, 7:2, 8:2, 10+:13}
top travellers: Wuhan Institute of Virology (33), SARS-CoV-2 (23),
  Huanan Seafood Market (20), Wuhan China (19), Rootclaim (15)
If each source were a case: 694 (entity,case) memberships / 280 distinct
  ⇒ copy-on-reference duplication factor = 2.48x
```

> **Verdict.** Hard scoping is **free exactly where he doesn't need it**
> (Bricks vs COVID: 0 shared) and **2.48x expensive exactly where he
> does** (sub-cases of COVID — "Proximal Origin", "the litigation" —
> which is what he'll create next).

**What fragments under hard scoping**, verified:

- **The entity dossier — a loss, not a feature.** Its membership is the
  **alias family, never a case** (`entity-dossier.js:68-73`), sweeping
  all claims and all articles with no case filter. Hard scoping gives
  one human two ids ⇒ two families ⇒ two dossiers ⇒ **two kind-0s and
  two kind-30067 fact sheets**, since the sheet is signed by the
  *entity's* key (`reader/index.js:4911`) at the constant d-tag
  `FACT_SHEET_D` (`entity-profile.js:173`). The sheet's whole promise —
  "an adjudicable INDEX over verifiable events — every fact `a`-refs
  its PUBLISHED kind-30040 claim" (`entity-profile.js:160-164`) —
  becomes two partial sheets under two pubkeys **with no link between
  them, and a relay consumer cannot tell they describe one human.**
  ⚠️ **Wire-format consequence.** Meanwhile the case-scoped view it
  would supposedly buy **already exists** as `case-dossier.js`.
  Fragmenting the entity dossier duplicates the case dossier and
  destroys the entity dossier's reason to exist. The codebase committed
  to *both* views on purpose: "what does this case say about X?" is
  `case-dossier.js`; "what do I know about X?" is `entity-dossier.js`.
  Fauci's birth date does not change per project.
- **`canonicalIdOf` / `aliasFamily` / `linkAlias`** (`entity-model.js:98-110,435-444,655-689`)
  are id-space-global. A case-namespaced id space forks every chain.
  There is no `EntityModel.merge` — merge is `linkAlias`, which **hard-
  refuses a cross-type link** (`:663-665`).
- **`entity-health.js` dedupe floods.** `dedupeReport` (`:191-236`) is
  registry-wide by construction and **cannot distinguish an intentional
  per-case copy from name drift**. `DedupeDismissals` are keyed by an
  unordered id pair (`entity-facts.js:158-160`), so every "Not
  duplicates" judgment would need re-making per case pairing. And note
  what his actual duplication *is*: 6 entities carry `canonical_id`,
  and the drift is **intra-case name variance** — `"Wuhan Institute of
  Virology"` ↔ `"Wuhan Institute of Virology (WIV)"`, `"Huanan Seafood
  Market"` ↔ `"(HSM)"`, `"Wei Guixian"` ↔ `"(shrimp vendor / first
  known case)"`. **Case scoping does nothing for this; it multiplies
  it.** Dedupe (`ENTITY_CORPUS_DESIGN.md` E2/E4–E6, design-only) and
  partition are different answers to "283 entities" — §6 Q5.
- **Precedent, and its price.** `importForeign` **already** namespaces
  ids away from `(type,name)` — `sha256('foreign:' + pk)`
  (`entity-model.js:497-498`) — because "a foreign 'Donald Trump' must
  never silently collide with the user's own" (`:469-471`). So a second
  id scheme is not unthinkable. But note the price it pays there:
  foreign entities are **keyless** (`:509`), get a read-only synthesized
  keypair (`:201-206`), and require an **adopt-time human collision
  prompt**. That is the honest cost of a namespaced id: a manual
  reconciliation step per duplicate.
- **`platform_accounts`**: 390 records, **0 linked** — the layer is
  inert, so nothing breaks today. But a YouTube channel is one channel
  regardless of project; hard scoping forecloses ever linking it
  without a per-case account registry.

### §4.2 What a case-signed event MEANS on the wire — and the coordinate consequence

**On NOSTR the pubkey IS the author.** Every kind's spec text in
`NIP_DRAFT.md` names the signer:

| Kind | Signed today by | What the pubkey means | Under "case npub signs" |
|---|---|---|---|
| 30023 article | user (`reader/index.js:3673`) | the **capturing archivist** — `NIP_DRAFT.md:381,417,457` call it `<capturer-pubkey>` | loses "who archived this" |
| 30040 claim | user (`reader/index.js:3966-3970`) | the **atomizer/asserter**; `NIP_DRAFT.md:109` — "consumers MUST treat the full `30040:<pubkey>:<d>` coordinate as the claim's identity" | the one kind with a re-key story (below) |
| 30054 assessment | user | "**a personal judgment** on one claim" (`NIP_DRAFT.md:304`) | **FORBIDDEN** (custody rule) |
| 32125 entity↔article | user (`reader/index.js:4003-4019`) | "the **author's** *claim* about an article … never merged" (`NIP_DRAFT.md:807`) | one of the two kinds the case key **is** allowed to sign |
| 30062 forensic | user | the finder; the 1985 mirror **labels a person's pubkey** | **FORBIDDEN** — the "worst legal artifact" case |
| 30063 verdict | user | "**One author's** ruling … There is no consensus event, no authoritative-adjudicator role" (`NIP_DRAFT.md:609`) | **FORBIDDEN**, and the semantics break hardest — see below |
| 30064 integrity | user | the adjudicator of a word-deed gap | **FORBIDDEN** |
| 30067 fact sheet | **entity key** (`reader/index.js:4911`) | already entity-signed | unaffected |
| 30068 case brief | user | "Signed by the **user's primary identity** (**it is the user's synthesis, not an entity's**)" (`NIP_DRAFT.md:730`) | **explicitly contradicted by the proposal** |
| 30069 OwnedKeys | primary (`reader/index.js:5043-5054`) | "Signed by the **creator's primary key**" | see §4.3 — it defeats the whole point |

**The 30063 inversion is the sharpest.** A container-signed verdict
*manufactures the consensus event the kind explicitly refuses to have*.
Read-time cross-author variance — the entire mechanism
`TRUTH_ADJUDICATION_DESIGN.md` §1 rests on — collapses to one apparent
author.

Design and code already disagree on one row, worth surfacing:
`TEAM_CASE_DESIGN.md:104` says the case key signs **32125**, but the
shipped code signs 32125 with the **user's** key
(`reader/index.js:4003-4005`: "The user signs these — they're
assertions about the shape of a knowledge graph node, not the entity's
own statement").

#### The coordinate consequence — ⚠️ the load-bearing wire finding

**Does any `d` hash the pubkey?** The answer is an asymmetry, and it is
what breaks:

**Pubkey-INDEPENDENT `d`** (address survives a re-key; old and new
coexist, **neither replaces the other**):
`30023` = sha256(url)[0:16] (`event-builder.js:544-547`) ·
`30040` = sha256(url|text)[0:16] (`claim-model.js:69-72`) ·
`30041` = `String(comment.id)` · `32125` = `${entity.id}:${url}:${rel}`
(`event-builder.js:767`) · `30067` = constant `FACT_SHEET_D` ·
`30068` = `xray-brief:<caseId>` · `30069` = constant ·
**`30062`** = `find:` + sha16(`subjectPubkey|maneuver|anchorsHash`)
(`metadata/builders.js:929`) — hashes the **SUBJECT's** pubkey, so it is
signer-independent.

**Pubkey-DEPENDENT `d`** (address **FORKS** on a re-key, because the `d`
hashes a *coordinate* and a coordinate contains a pubkey):

- **30054** — `assess:` + sha16(`claimCoord`) — `metadata/builders.js:553`
- **30055** — `rel:` + sha16(`src.coord|tgt.coord|relationship`) — `:659`
- **30063** — `verdict:` + sha16(`claimCoord|propositionClass`) — `truth-builders.js:198`
- **30064** — `integrity:` + sha16(`word.coord|word.class|deedKey`) — `truth-builders.js:473`

**So a claim keeps its `d` and nothing tells you it moved.** Two 30040s
with the same `d` and different pubkeys are *distinct addressable
events* (`NIP_DRAFT.md:109`), and the spec **forbids consumers merging
them**. Locally X-Ray collapses both; **no other NOSTR client can.**
The duplication is invisible to X-Ray and permanent for everyone else.
Meanwhile every judgment referencing that claim **forks its address** —
the old 30054/30055/30063/30064 keep pointing at the old coordinate and
can never be replaced, only orphaned (NIP-01 replacement is per
`(kind, pubkey, d)`).

**This repo has already ruled on exactly this failure, once, and paid
for it by killing a kind.** `JOURNAL.md:3749-3753`, on why 30043 was
*retired rather than migrated*: relays already hold events "a public NIP
could never honor, and **a re-keyed `d` can't replace them (different
hash input — both versions would live forever)**."

**Does the append-only `publishedPubkeys` history absorb a key
migration?**

- **For 30040: yes, fully and by design.** `markPublished(id, eventId, publishedPubkey)`
  appends (`claim-model.js:437-452`); the header (`:428-435`) states the
  intent verbatim — "coordinates minted under an OLD identity are live
  addressable events on relays and must keep collapsing after a re-keyed
  republish." `canonicalizeClaimRef` collapses on **any** recorded
  pubkey (`claim-ref.js:84-107`), pinned by
  `tests/claim-ref.test.mjs:108-122`. **His 980 claims survive.**
- **For everything else: no.** It is a *claim-model* feature, not a
  platform one. It cannot replace orphaned 30054/30055/30063/30064
  (their `d` forked), and it cannot supply a signer for records that
  **never recorded one**: `AssessmentModel.markPublished(id, eventId)`
  (`assessment-model.js:396`), `EvidenceLinker.markPublished`
  (`evidence-linker.js:427`), and `EntityModel.markPublished`
  (`entity-model.js:709`) **take no pubkey parameter at all**. (By
  contrast `ForensicModel` `:338`, `VerdictModel` `:629`,
  `IntegrityModel` `:345`, `audit-model.js:440` do record it.) So
  `reconcile.js:15-18` *says outright* that it **guesses**: "The signing
  pubkey **is not recorded** … their candidate addresses **fan out
  across the portal's resolved identity set**." **It absorbs one kind
  out of eleven. The proposal needs all of them.**

**And one bug that would bite even with a re-key path:** `claimWireInfo`
(`assessment-publish.js:33-44`) builds the coordinate from
**`claim.publishedPubkey`** — the *singular latest* — not from the
`publishedPubkeys` history. After a re-key + republish, every newly
emitted 30054/30055 references the new coordinate at a new `d`, and the
old ones stay live at the old address, **never superseded**.

**Precedent that a fix is possible but unbuilt:** the audit layer
already re-keys — `audit/publish-batch.js:277-291`: "A stored
coordinate minted under a stale identity is **re-keyed here** — the
machine re-files under the signing identity instead of dead-ending the
user with a skip." It works by matching the local counterpart on the
**`d`-suffix** (`:273`) — viable *precisely because* that `d` is
pubkey-free. **No equivalent exists for 30054/30055/30063/30064**, and
building one still could not *replace* the orphans; it would only
re-file future ones.

### §4.3 NIP-07 users, whose key lives in another extension

`Signer.getMethod()` (`signer.js:35-39`) reads
`preferences.signing_method` — **a single global preference**, no
per-context override. Four concrete breaks, in order of severity:

1. **A case npub cannot BE a NIP-07 key.** NIP-07 exposes exactly one
   key from the user's signer extension (`signer.js:83`). X-Ray cannot
   mint, hold, or switch to a per-case key inside nos2x/Alby.
   **Per-case identity is structurally Local-mode-only** — as
   `identity_profiles` already is (it stores `privateKey`/`nsec`,
   `identity-profiles.js:24`). This needs an explicit, documented
   refusal, not a silent degradation.
2. **Entity keys can't derive.** `deriveChildKey` needs
   `primary.privateKey` (`crypto.js:184-186`). A NIP-07 user has none →
   falls to the legacy **random** path (`entity-model.js:301-302`) →
   keys unrecoverable, `restoreDerivedKeys` throws (`:338-341`).
3. **Neither binding layer works.** `attachCreatorBinding` skips the
   NIP-26 tag without a local privkey (`reader/index.js:5024-5025`), and
   its own comment concedes NIP-07 users "bind via the manifest alone"
   (`:5013-5015`) — **but the manifest is also local-only** (`:5044`:
   `if (!primary || !primary.privateKey) return;`). So a NIP-07 user
   gets **neither**. Per-case identity makes this worse, since
   cross-case linkage was the manifest's job.
4. **The portal already cannot see them.** `resolveSignerPubkey` returns
   `pubkey: null` for `'nip07'` (`portal/identity.js:54-60`) — "NIP-07
   signs in page tabs only — paste your npub below." **That affordance
   is the documented on-ramp to the exact union that causes the
   contamination.** NIP-07 users are *pushed* toward the merge path.

### §4.4 ⚠️ The fatal irony: kind 30069 publicly re-links every case key to one primary

The segregation the proposal wants is **undone by an already-shipped
publish path**, and this is the finding that should decide §6 Q3.

Derivation itself is private and unlinkable —
`ENTITY_IDENTITY_DESIGN.md:67-71`: "derivation alone proves *nothing*
publicly (it is a private, one-way operation…)". So far so good.

**But `publishOwnedKeysManifest` (`reader/index.js:5039-5054`) publishes
one primary-signed kind-30069 listing EVERY owned entity pubkey**:

```js
const owned = LocalKeyManager.listKeys()
    .filter((k) => k.name && k.name.startsWith('entity:') && k.metadata && k.metadata.entityId)
    .map((k) => ({ pubkey: k.pubkey, id: k.metadata.entityId, name: k.metadata.entityName || '' }));
```

**No case scoping.** `NIP_DRAFT.md:757`: "one per creator (`d` fixed)"
— `d = 'xray-owned-keys'`. ⇒ The Bricks & Minifigs case key and the
COVID case key would be **published side by side in a single event
signed by the same primary**. Anyone running
`{kinds:[30069], authors:[primary]}` gets the full cross-project map.

**Segregation on the wire: zero. And it is worse than the status quo**,
because today the linkage is only inferable from behavior; 30069 makes
it *cryptographically attested by the researcher himself*.

**Plus the delegation token doesn't cover the new kinds.**
`attachCreatorBinding` mints NIP-26 conditions `kinds: [0, 30067]`
(`reader/index.js:5028`). A case key signing 30040/30054/30023 emits
events **outside its own delegation conditions** ⇒ per
`ENTITY_IDENTITY_DESIGN.md:172-175`, X-Ray's own ingest verification
renders the corpus **unbound**. He would be attacking his own trust
chain.

### §4.5 Two more collisions worth naming

- **Self-incorporation lockout.** `isValidSuggestedBy`
  (`assessment-taxonomy.js:132-142`) accepts `nostr:<64-hex>` for
  incorporated artifacts, and publish selectors **MUST exclude them**
  ("you never republish another's content as yours") — enforced at
  `assessment-publish.js:67,96`. Under per-case signing, the case pubkey
  is a *foreign author* from every other workspace's view: his own work,
  re-read from relays, arrives stamped `nostr:<casePubkey>` and becomes
  **permanently unpublishable as his**. The guard's premise silently
  misfires because the case key *is* him.
- **Reset destroys the signing key.** Entity keys (`local_keys`) are
  **`WORKSPACE_CLEAR_KEYS`** (`identity-profiles.js:37-38`) — "Entity
  keypairs … are workspace content, not user identity." Profiles are
  **KEPT** (`:74-83`). So making the case *entity* key the signing
  identity means **the documented remedy for his contamination bug
  deletes his signing keys.** The prescribed vehicle (profiles) is
  preserved precisely because it is identity, not content.

### §4.6 Migration of his 283 entities and existing published events

**The good news: the id is immutable on retype, and that is deliberate.**
`entity-model.js:522-534`:

> "Patch an existing entity. Keypair and id are immutable. Name and
> type changes **don't rederive the id** — this is intentional: the id
> is the stable identifier for relay-published kind-0 events."

**So the whole migration is: retype in place. Never delete-and-recreate**
(`create` re-derives ⇒ new id ⇒ **new pubkey** ⇒ every published
`['p', <old pubkey>]` orphans; `delete` destroys the key,
`entity-model.js:590-592`).

| Surface | Effect of `update(id, {type:'thing'})` |
|---|---|
| entity id | **unchanged** |
| `keyName` / pubkey / npub | **unchanged** (`keyName = entity:${id}`) |
| kind-0 already on relays | stale `"case entity created by X-Ray"` until republish; **still adopt-parses** — `adopt-entity.js:35`'s regex is built from `ENTITY_TYPES`, and `case` stays in it (this is a §3.1 dividend) |
| kind-0 republish | **automatic and self-healing** — `entity-profile.js:133` emits the type into `about`; `reader/index.js:4853-4856` republishes on `contentHash !== entity.publishedProfileHash`. Same pubkey, replaceable. (Gated on `entityCorpusPublishing`.) |
| kind-32125 | **clean overwrite** — `d` is `${entity.id}:${url}:${rel}` (`event-builder.js:767`), **id-based**; the `['entity-type', …]` tag (`:771`) refreshes at the same coordinate |
| kind-30067 | unaffected — `d` is the constant `FACT_SHEET_D` |
| 30078 sync | tolerant — parse only requires a string (`entity-sync.js:130`) |
| **kind-30023 read path, already-published** | ⚠️ **stays joined, because of the stale tag.** `reconstructEntityRefsFromEvent` (`event-builder.js:983-1006`) derives `generateEntityId(type, name)` from the **wire tag** — a published `['case','Proximal Origin paper',ctx]` reconstructs to sha16(`case:proximal origin paper`), which **is** the retyped record's never-re-derived id. The join survives. |
| **kind-30023 read path, on REPUBLISH** | ⚠️ **BREAKS — flagged here for the first time.** After the retype, `buildArticleEvent` emits `['thing','Proximal Origin paper',ctx]`; `reconstructEntityRefsFromEvent` then derives sha16(`thing:…`) — **an id that does not exist locally.** The wire→local round-trip pinned at `tests/entity-model.test.mjs:427` ("*the derived ids MATCH the registry's*") holds only while `id == sha16(type:name)` for the record's **current** type. A retype-in-place is precisely the state where it doesn't. |

**Blast radius of that last row is narrow but real**: the only consumer
is `portal/inspector.js:410` (the portal event inspector rebuilding
refs for display), so the symptom is a dangling ref on one surface, for
articles that are both retyped-entity-tagged **and** republished. The
options, none free: (i) **rename on retype** so the divergence is
deliberate and visible; (ii) accept it and note it; (iii) don't
republish those three articles. **Recommend (iii) + a JOURNAL entry** —
they are three articles and one lawsuit, and the retype is worth more
than the republish. §6 Q6 asks whether the id↔(type,name) coupling
should be broken properly, which is a bigger question than this
migration.

**Net for his five, concretely:**

- **"What is the origin of Covid?"** → **stays `case`.** It is the only
  correct one. Zero change. (Then give it a scope question — it has
  none, and `hypothesis-map.js:79` / `corpus-prompts.js:324` both read
  it.)
- **The three papers** → `update(id, {type:'thing'})`,
  `thing_type: "scientific paper"`, `creator` → the author entities.
  **First check whether each is already a captured 30023** — if so the
  entity duplicates the archive record (`case-graph.js:104` already
  makes articles first-class nodes) and should be deleted only if it
  carries no claims.
- **The litigation** → `update(id, {type:'thing'})`,
  `thing_type: "litigation"`, `custom:court` / `custom:docket`.
- **`authored_fields`:** all five are `null`, so `cleanAuthoredFields`
  (`entity-model.js:554`) will not throw. Had any carried a scope
  question, `update()` would reject it against the new type's registry
  (`entity-field-schemas.js:156`) and it would need clearing first.

**Do not write a migration script.** Four `EntityModel.update` calls
from the side panel are auditable and reversible; a script over 283
entities that cannot tell "Bricks & Minifigs scandal" (a legitimate
Phase-11 story-case, and *the type comment's own example*) from "Pekar
et al. 2022 paper" is not.

---

## §5. Slice ladder

One concern per PR, each independently green
(`npm run build` + `npm test` + `web-ext lint --self-hosted`), branches
`claude/case-workspace-*`. **The FLF Epistack deadline is 2026-07-19.**

| # | Slice | Wire? | Pre-deadline? |
|---|---|---|---|
| **CW.1** | **Prompt + type guard.** `SUGGESTABLE_ENTITY_TYPES` (`llm-prompts.js`); rewrite `RULES_ENTITIES` (`:382-387`) — define every type, kill "cases named in the text", name the paper/lawsuit failure explicitly; narrow the tool enum (`:170-173`); hard guard in `llm-proposals.js:179-181`; point `llm-review.js:66` at the subset. Amend `entity-model.js:46-49` + `CASE_DOSSIER_DESIGN.md:14-20`. **Tests:** a `case` proposal is rejected with the workspace message; `ENTITY_TYPES` pin still green; `RULES_ENTITIES` contains no "case". | **none** | ✅ **YES — do this first.** ~40 lines, additive, test-safe. Stops the bleeding. |
| **CW.2** | **Retype his four, by hand.** Four `EntityModel.update(id, {type:'thing'})` from the side panel + the `thing_type`/`creator`/`custom:*` fields. Check the three papers against the archive first. **Do not republish those articles** (§4.6). JOURNAL entry recording the id↔type divergence. | **none** (no republish) | ✅ **YES.** Minutes. Not a code change. |
| **CW.3** | **Orbit union.** Make `collectCaseEntityIds` (`case-bundle.js:34-49`) tag-inclusive, sharing one definition with `memberUrlSets` (`case-membership.js:34-60`). **Hold the bundle at the narrow orbit** pending §6 Q2 — widening what exports private keys is its own decision. **Tests:** a tag-only case's orbit contains the tagged entities; the bundle's key-export set is unchanged by this PR; determinism pins hold. | **none** | ✅ **YES.** His COVID case goes **1 → 265**. Highest user-visible value per line in this document. |
| **CW.4** | **`restoreDerivedKeys` guard.** Refuse (or loudly warn) when an entity's recorded derivation root ≠ the active primary (§2.5.1). Record the root at create time if it isn't recorded. **Test:** re-deriving under a second profile does not silently mint a wrong pubkey. | **none** | ✅ **YES.** It is a live footgun with two profiles installed. |
| **CW.5** | **Custody guard test.** Machine-check `TEAM_CASE_DESIGN.md:104-110`: a case-typed entity's key signs nothing but kind-0 and 32125. Mirror the Phase-16 "30066 stays free" guard idiom. | **none** | ✅ **YES.** Owed regardless of how §6 Q3/Q4 resolve; cheap; makes every later slice safer. |
| **CW.6** | **Active-case pointer.** `preferences.active_case` + side-panel/portal switcher; capture writes stamp the case via `addArticlesToCase` verbatim; filter the flat entity list (`sidepanel/index.js:107`) and the pickers; pass the case into the suggest prompt. | **none** | ⚠️ **Probably not.** Touches capture. Small, but not a deadline-week change. |
| **CW.7** | **Scope the leaking reads.** `resolveIdentities` (`portal/identity.js:80-134`) case-scoped — **the contamination fix**; then `fetchCorpus`, `loadLocalLedger`, `portal-cache.loadRecords`, incorporation, and the pubkey-keyed case facet. | **none** | ❌ No. |
| **CW.8** | **Case-scoped follows.** Wire the built-and-unused `scope:'case'` anchor (`follow-model.js:31`) into `network/index.js:40`. Preserve the never-publish closure (`KNOWLEDGE_SHARING_DESIGN.md:203-208`) — **the case anchor must not reach `follow-publish.js:25-27`.** Guard-test that. | **none** (by design) | ❌ No — but it is the cheapest real win *after* the deadline. |
| **CW.9** | **Cross-case graph.** Multi-case root over `buildCaseGraph`; shared entities as first-class cross-case edges. | **none** | ❌ No. |
| **CW.10** | **Per-case identity binding — ONLY if §6 Q3/Q4 approve.** Store `identity_pubkey` on the case entity; activating a case calls `IdentityProfiles.activate`. **Must ship with:** an explicit NIP-07 refusal (§4.3); a **case-scoped 30069** or a documented decision to stop publishing the manifest (§4.4); and the Phase-24 amendment (§3.6 option (i)) or the option-(ii) disclosure. | ⚠️ **YES — 30069 shape** | ❌ **No. Not this month.** Blocked on §6. |
| **(refused)** | The case *entity's* key signing captured content. | ⚠️ **yes, many** | **Recommend never** — §4.2, §4.4, `TEAM_CASE_DESIGN.md:104-110`. |

**CW.1–CW.5 are the pre-deadline set: five PRs, zero wire changes, zero
migrations, and they deliver the presenting complaint plus the "entities
list keeps growing" complaint.**

---

## §6. Open questions for the maintainer

**Q1. Does `case` mean *workspace* — full stop?**
*Recommendation: yes.* `entity-field-schemas.js:66-71` already encodes
it and all of Phase 20 assumes it. Adopting it costs a comment and a
prompt (CW.1). Refusing it means keeping a type whose field schema
contradicts its definition. **This also formally supersedes
`CASE_DOSSIER_DESIGN.md:14-20` and retires "Bricks & Minifigs scandal"
as a canonical example case — say so out loud.**

**Q2. Should the case *bundle* widen with the orbit (CW.3)?**
*Recommendation: no, not in the same PR.* `collectCaseBundle` exports
**entity private keys** (`case-bundle.js:6-10`). Widening 1 → 265
changes what one click hands over by two orders of magnitude. Split it:
dossier/graph read the union now; the bundle gets its own PR with a
scope selector and a count in the confirm.

**Q3. Per-case *identity profiles* — enforce, or leave prescribed?**
*Recommendation: leave prescribed for now; revisit after CW.7.* The
prescription (`TEAM_CASE_DESIGN.md:224-228`) is already satisfied by his
two profiles. **The measured evidence says the identity model was never
the problem: his two projects share 0 entities and 0 URLs. The
contamination came from `portal/identity.js:80-134` unioning identities
with no case dimension** — a read-scoping bug, fixable without touching
a key.

**Q4. Do you want to amend the custody rule (`TEAM_CASE_DESIGN.md:104-110`)
and §2.1's "exactly two things"?**
*Recommendation: **no**.* Not because the rule is sacred, but because
amending it buys nothing: §4.4 shows kind-30069 re-links every case key
to one primary in a single self-signed event, so the segregation the
amendment would authorize **does not exist on the wire anyway** — and
§4.2 shows the cost is orphaned, unreplaceable 30054/30055/30063/30064
that this repo has already refused once (`JOURNAL.md:3749-3753`). If you
*do* want it, it needs to be a written amendment citing "accountability
laundering" by name, plus a 30069 answer, before any code.

**Q5. Is partition meant to supersede or complement dedupe?**
`ENTITY_CORPUS_DESIGN.md` names his exact 283-entity problem
(`:20-27`, "the registry silts up with near-duplicates") and its remedy
is **merge/dedupe, never partition** (E2/E4–E6, design-only).
*Recommendation: complement, and dedupe first.* His measured
duplication is **intra-case name drift** — WIV vs "WIV (WIV)", six
Huanan variants — which case scoping **multiplies**. Only 6 of 283
entities carry a `canonical_id` today; the canonical sweep has more
value left in it than the partition does.

**Q6. Should `generateEntityId` stop hashing the type?**
Not proposed here, but §4.6 exposes the coupling: a retype makes the id
unrecomputable from the wire tags of any newly published event. Today's
blast radius is one display path (`portal/inspector.js:410`).
*Recommendation: leave it; note it in JOURNAL.* Changing the id scheme
re-mints all 283 ids and every derived pubkey — strictly worse than the
narrow divergence. Revisit only if retyping becomes routine.

**Q7. Should `xray-portal` join `WORKSPACE_DATABASES`?**
It is excluded deliberately (`identity-profiles.js:86-95`) as a
rebuildable cache. *Recommendation: revisit at CW.7* — under scoped
identities a stale cache is cross-case **leakage**, not dead weight, and
`resetWorkspace()` currently leaves foreign cached events behind.

---

## §7. For the next session — start here

You are implementing **CW.1** (and, if it lands clean, CW.3). Assume
nothing in this file; verify against `main`, which may have moved.

### Read first, in this order

1. **`CLAUDE.md`** — contexts, conventions, the `xray:*` bus, 4-space
   indent, `Utils.log`, the private-key rule, version lockstep.
2. **`src/shared/entity-field-schemas.js:66-71`** — the eleven lines
   that prove `case` already means *project*. If you read nothing else,
   read these.
3. **`src/shared/llm-prompts.js:26, 82-95, 126-131, 165-180, 375-395,
   425-455`** — the import, the Options hints (already correct, already
   contradicting the prompt), the not-strict-mode note, the tool schema,
   `RULES_ENTITIES`, and `RULES_FINDINGS` as the **house style to
   imitate**.
4. **`src/shared/llm-proposals.js:170-195`** — the validator that is the
   real firewall.
5. **`src/shared/case-bundle.js:25-49`** vs
   **`src/shared/case-membership.js:1-60`** — the two conflicting orbit
   definitions. CW.3 lives here.
6. **`docs/TEAM_CASE_DESIGN.md` §1 (`:66-72`), §2.1 (`:92-110`), §4.1
   (`:223-228`)** — lens-not-container, the custody rule, the per-case
   identity prescription.
7. **`docs/CASE_DOSSIER_DESIGN.md:14-20`** — the sentence CW.1 amends.
8. **Tests to mirror:** `tests/llm-proposals.test.mjs` (the `'alien'`
   negative at `:147`), `tests/entity-model.test.mjs:261` (the
   `ENTITY_TYPES` pin — **must stay green untouched**),
   `tests/case-membership.test.mjs`.

### Invariants that must not break

1. **`ENTITY_TYPES` does not change.** `case` stays in it. If you find
   yourself editing `entity-model.js:50`, stop — you are about to break
   `adopt-entity.js:35`'s regex against every published case kind-0 on
   relays, and `tests/entity-model.test.mjs:261` will tell you.
2. **No wire-format change in CW.1–CW.5.** No kind, tag, `d`, or content
   field moves. If a diff touches `event-builder.js`,
   `metadata/builders.js`, `truth-builders.js`, or `NIP_DRAFT.md`, you
   have left the slice.
3. **Never delete-and-recreate an entity to retype it.** `update()`
   only (`entity-model.js:522-534`). `create` re-derives the id ⇒ new
   pubkey ⇒ orphaned kind-0s; `delete` destroys the key (`:590-592`).
4. **The human stays sovereign.** Every proposal is confirmed
   (`reader/index.js:1928`). CW.1 narrows what the *model* may propose,
   never what the human may create — the side-panel form
   (`sidepanel/index.js:1272,1290`) is the only path to a case, and it
   must stay open.
5. **The case key signs nothing but kind-0 and 32125**
   (`TEAM_CASE_DESIGN.md:104-110`). CW.5 makes this machine-checked.
   Until then, respect it by hand.
6. **`PHILOSOPHY.md` P9 (history is immutable) and
   `CASE_DOSSIER_DESIGN.md` §2.2 (no case-level score, ever)** govern.
   Nothing here computes a number.
7. **Determinism.** `case-graph.js:11-12` and the dossier's sorts are
   pinned "same data → deep-equal graph." CW.3 widens a set; keep the
   sorts.

### The first slice, concretely

**CW.1.** Branch `claude/case-workspace-prompt-fix` from `main`. Draft
PR. Then:

1. Add `SUGGESTABLE_ENTITY_TYPES = ENTITY_TYPES.filter(t => t !== 'case')`
   to `llm-prompts.js`, with the comment explaining *why* (a case is
   authored-fields-only; the human creates it).
2. Rewrite `RULES_ENTITIES` (`:382-387`): drop "cases named in the
   text"; define all four suggestable types — **especially `thing`,
   whose undefinedness is half the bug**; state the paper→thing and
   lawsuit→thing rules explicitly with the "when in doubt, it is a
   thing" fallback. Match the density of `:431-438`.
3. Narrow `entity_type.enum` (`:170-173`) and `llm-review.js:66` to the
   subset.
4. Guard `llm-proposals.js:179-181` with a `case`-specific message that
   tells the human where to create a workspace.
5. Amend `entity-model.js:46-49` (the type comment) and
   `CASE_DOSSIER_DESIGN.md:14-20` (strike "consistent with the intent").
6. Tests: a `case` proposal is rejected with the workspace message; a
   `thing` proposal is accepted; `RULES_ENTITIES` contains no "case";
   the `ENTITY_TYPES` pin is untouched and green.
7. `docs/JOURNAL.md` entry: **why the type was not split** — the
   `adopt-entity.js:35` regex, the quadruplicated tag ternary, and
   `case-bundle.js:135-138`'s silent drop for older collaborators —
   citing `ASSESSMENTS_DESIGN.md:427-430`.
8. ROADMAP: add the phase (confirm the number first — §status header).

**Acceptance:** the model cannot propose a `case`; the validator rejects
one if it does; a human can still create a case in the side panel; the
maintainer's own registry needs no code migration (CW.2 is four clicks);
`npm run build` + `npm test` + `web-ext lint --self-hosted` green; **no
wire-format change of any kind.**

### One thing to tell the maintainer in the PR

His diagnosis is right and his data proves it: 283 entities in one flat
namespace, cases-as-views-not-containers, and a portal that unions every
identity into one "me." **But the two halves of his proposal have very
different prices.** Scoping the *view* is ~6 files, no wire change, and
turns his COVID case from 1 entity into 265. Making the case *npub* the
*signing* identity re-roots 261 derived keys, orphans four kinds of
judgment events at forked addresses that can never be replaced, breaks
NIP-07 users completely, collides with a normative custody rule — and
**buys no segregation at all**, because kind-30069 already publishes
every one of his entity keys in a single event signed by his primary.

The word "case" is overloaded three ways and "capturing identity" two.
Disambiguating both collapses most of this proposal into five safe PRs
and a two-line prompt fix.
