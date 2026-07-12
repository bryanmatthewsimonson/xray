# X-Ray — User Guide

A complete, feature-by-feature guide to X-Ray for people who **use** it —
not who build it. It is written for an investigator building a corpus
(the running examples come from a COVID-origins corpus), but nothing
here is COVID-specific. Where X-Ray uses a word in a precise way —
"state fact" versus "event fact", "contested" versus "insufficient
evidence" — this guide gives the exact meaning the code enforces and a
concrete example.

> **Scope.** This guide documents what the tool *does*. Where a feature
> is gated off by default, or is authored from the browser console
> rather than a polished UI, it says so plainly. For the wire format,
> see [`NIP_DRAFT.md`](NIP_DRAFT.md); for the audit philosophy, see
> [`PHILOSOPHY.md`](PHILOSOPHY.md); for per-platform capture quirks, see
> [`CAPTURE_GUIDE.md`](CAPTURE_GUIDE.md).

Screenshots are referenced inline as `[SCREENSHOT-nn]` and listed with
capture instructions in [the appendix](#appendix-screenshot-shot-list).
They are placeholders — a human with a browser fills them in.

---

## Table of contents

1. [What X-Ray is](#1-what-x-ray-is)
2. [Setup](#2-setup)
3. [Capturing a page](#3-capturing-a-page)
4. [The reader](#4-the-reader)
5. [The judgment vocabulary](#5-the-judgment-vocabulary) — the heart of the guide
6. [Publishing](#6-publishing)
7. [The portal ("My Archive")](#7-the-portal-my-archive)
8. [The side panel](#8-the-side-panel)
9. [Glossary](#9-glossary)
10. [Troubleshooting](#10-troubleshooting)
11. [Appendix: screenshot shot list](#appendix-screenshot-shot-list)

---

## 1. What X-Ray is

X-Ray is a browser extension that turns any web page — a news article, a
Substack post, a YouTube video with its transcript, a tweet, a
Facebook/Instagram/TikTok post, a PDF — into clean Markdown, lets you
**annotate what you're reading with structured judgments** (who it's
about, what it claims, whether those claims hold up), and **publishes**
the result to [NOSTR](https://nostr.com), a decentralized network of
relays.

The four verbs, in order: **capture → structure → judge → publish.** You
capture a page, structure it (entities, claims), judge it (assessments,
verdicts, audits), and publish the artifacts as signed events anyone can
fetch and verify. Because everything is signed and content-addressed,
your corpus is portable, independently checkable, and not locked inside
any one app.

Nothing is published until you say so, and the analytical work (tagging,
claims, verdicts, audits, the dossier) is fully usable **without ever
publishing** — publishing is opt-in per feature.

---

## 2. Setup

### 2.1 Install and load

- **Chrome / Chromium / Brave / Edge:** `chrome://extensions` → enable
  **Developer mode** → **Load unpacked** → select the repo root.
- **Firefox:** `about:debugging` → **This Firefox** → **Load Temporary
  Add-on** → pick `manifest.json`. (Firefox needs version 128 or newer.)

After any rebuild, click **reload** on the extension card **and** reload
the tab you're testing — content scripts don't re-inject on their own.
`[SCREENSHOT-01]`

### 2.2 Signing identity

X-Ray signs your published events. It defaults to **local signing** but
never generates a key behind your back — the first time you open
**Settings → Signing** you pick a method. `[SCREENSHOT-02]`

- **Local (recommended).** X-Ray holds a NOSTR private key (`nsec`) in
  the browser and signs on-device. Click **Generate new key**, or
  **Import nsec…** to bring an existing identity. **Show nsec** reveals
  it for backup; **Reset** discards it. Your primary signing key lives
  under its own storage slot, deliberately *outside* the per-entity key
  registry, so exporting entity keys can never leak your `nsec`.
- **NIP-07.** Signing is delegated to a separate signer extension
  (nos2x, Alby). Install it first, then pick this option; each publish
  prompts the signer in-context. When NIP-07 is active, X-Ray routes
  the signing request back through the *source tab* so your signer sees
  the right origin.
- **NSecBunker.** Remote signing over a bunker URL. Enter the URL and
  click **Test connection**.

An always-visible **Active method** line shows the current method and
`npub` (your public identifier). You can keep multiple identity
profiles and switch between them.

> **Privacy rule that never changes:** your `nsec` and per-entity
> private keys are never logged, never exported with your entity data,
> and never leave the device. Your `npub`/public key is public by
> definition and appears in every event you publish.

### 2.3 Relays

**Settings → Relays** lists the relays you publish to and read from,
each a row with URL, **read**, **write**, and **enabled** toggles.
Disabled relays are skipped entirely; the publish picker offers only
enabled + writable relays. Start with 3–4 independently operated relays
so no single operator can drop your corpus. `[SCREENSHOT-03]`

### 2.4 LLM assist and the API key

Two X-Ray features can call a large language model on your behalf: the
**epistemic audit** and the **moral lens**. Both need an **Anthropic API
key**, set in **Settings → Advanced → LLM assist**. The key is stored in
its own secret slot and is never logged or exported. `[SCREENSHOT-04]`

Cost note: a **quick** audit is **one** API call; a **thorough** audit is
**eight** (one per dimension). A lens reading is one call per
jurisdiction. You pay your own Anthropic bill; X-Ray never proxies.

### 2.5 Feature flags

Most advanced features are **off by default** and are turned on with
feature flags. UI-surfaced flags live under **Settings → Advanced**;
the rest are flipped in DevTools via the `chrome.storage.local` key
`xray:flags` (a plain object of `{ flagName: true }`). Importantly, the
service worker always **accepts incoming** events of every kind — flags
gate your **publish** paths and some panel tabs, not what you can read.

| Flag | Default | What it gates |
|---|---|---|
| `annotations` | on | Publishing crowdsourced URL annotations (kind 30050) |
| `respondsTo` | on | The "responds-to" relationship tag on articles |
| `topicTrust` | on | Topic-trust metadata (kind 30053) |
| `trustGraphFilter` | on | Trust-graph filtering of what you see |
| `factchecks` | off | Publishing fact-check events (kind 30051) |
| `ratings` | off | Publishing rating events (kind 30052) |
| `helpfulnessVoting` | off | Publishing helpfulness votes (incoming always accepted) |
| `assessmentPublishing` | off | Publishing assessments (30054), claim relationships (30055), and the 1985 label mirror |
| `epistemicAuditing` | off | Publishing the audit family (30056–30061). *Running* an audit needs the API key too |
| `forensicPublishing` | off | Publishing behavioral findings (30062) + their `revision/*` story-change edges |
| `truthAdjudicationPublishing` | off | Publishing verdicts (30063) + integrity findings (30064) |
| `platformAccountPublishing` | off | Publishing platform-account identity links (32126) — discloses your account↔entity graph |
| `llmAssist` | off | The reader "Suggest…" pass + audit *execution* (needs the API key) |
| `moralLens` | off | The reader's lens-reading surface (needs the API key; independent of `llmAssist`) |
| `bridgingRanking`, `transitiveTrust` | off | Experimental ranking/trust (not yet shipped) |

The rule of thumb: **local analysis is never gated** (capturing,
tagging, claims, verdicts, audits you import, the dossier) — flags gate
what leaves your machine.

### 2.6 Backups

Everything X-Ray holds lives in your browser profile — a profile wipe,
a reinstall, or a machine change loses it unless you export. Three
tools, all under **Settings → Advanced**:

- **Full backup** ("Full backup" block → **Download full backup**) is
  the complete copy: settings, relays, feature flags, saved identities
  **including private keys**, entities, claims, judgments, the captured
  article archive, original source documents (PDFs — a checkbox, on by
  default, with a size estimate), audit records, and the signed-event
  journal. One JSON file that brings a fresh install back to exactly
  this state via **Restore from backup…** (restore *replaces*
  everything after a typed confirmation, and downloads a safety backup
  of the current state first). Treat the file like an `nsec`, because
  it contains yours. The one thing never included is your LLM API key —
  set that again by hand on a new machine.
- **Workspace backup** ("Workspace" block) is the smaller,
  content-only snapshot the fresh-workspace flow offers — it does not
  cover the article archive or audit records.
- **Signed-events bundle** (**Export signed-events bundle**) is not a
  backup of your machine but of your *published corpus*: the raw
  signed JSON of every event you've published. Anyone can rebroadcast
  it to any relay — publish it alongside your work and your corpus
  survives a relay shutting down.

Make a full backup before anything risky (reset, browser profile
changes) and after any big capture or publish session.

---

## 3. Capturing a page

### 3.1 Triggers

- **Click the toolbar icon** — captures the active tab and opens it in
  the reader.
- **`Cmd/Ctrl + Shift + X`** — the keyboard shortcut, same effect.
- **Right-click → "Capture this page with X-Ray"** — from the page or
  the toolbar icon. The toolbar icon's right-click menu also has Entity
  Browser, Settings, and Capture tips.

On `chrome://`, `file://`, or extension pages the content script can't
run, so the click opens **Settings** instead. `[SCREENSHOT-05]`

### 3.2 Per-platform notes

Plain articles, Substack, and most blogs capture cleanly with no setup.
The social platforms are finicky about URL shape and timing — a
Facebook post needs the permalink, an Instagram capture may need the
post open, TikTok wants the video page. The details live in the
[capture guide](CAPTURE_GUIDE.md); the reader will tell you when a
capture looks thin and how to improve it.

### 3.3 PDFs, Google Drive, and the import fallback

X-Ray reconstructs PDF text (and tables, row-by-row) into Markdown, and
archives the original bytes so figures resolve later. A Google Drive PDF
preview routes into the PDF pipeline automatically when the tab's title
names a `.pdf`. When automatic capture can't reach a document, an import
picker lets you hand X-Ray the file directly.

### 3.4 Evidence: screenshots and HTML snapshots

For pages that can change or vanish (social posts especially), X-Ray can
attach **evidence**: a screenshot and/or an HTML snapshot, each
content-addressed by hash. These travel with the capture and can be
published alongside it so a reader can confirm you saw what you say you
saw.

### 3.5 Provenance chips

The reader shows a small **provenance chip** telling you *how* the
content was extracted — this matters when you're judging reliability:

- `graphql` — pulled from the platform's own API response (most
  reliable).
- `ssr-script` — parsed from server-rendered JSON embedded in the page.
- `dom-scrape` — scraped from the rendered DOM.
- `og-meta` — only the OpenGraph preview metadata was available
  (thinnest).
- `none` — nothing structured was recovered.

Video captures also show channel/live/short chips and a transcript-origin
chip.

### 3.6 The archive banner and URL identity

If a capture looks paywalled or truncated, X-Ray checks for a richer
version — a longer local copy or a relay-hosted one — and offers it in a
banner. `[SCREENSHOT-06]`

**Archive and mirror captures.** When you capture from an archive
(`archive.today`/`archive.ph`, the Wayback Machine) or an arXiv
rendering variant (`/pdf/`, `/html/`, ar5iv), X-Ray recovers the
**original** URL and makes *that* the article's identity — so an archive
capture and a direct capture of the same piece are treated as the same
source, and your claims, assessments, and audits don't fork across
mirrors. A note under the byline reads either:

- *"captured via archive.ph · original: `<url>`"* — the original was
  recovered; or
- *"captured via archive.ph — original URL not recovered"* — X-Ray could
  not verify the original, so it keys to the address you fetched rather
  than guess.

The fetched address is preserved as provenance and, when you publish,
rides as a `capture-url` tag. `[SCREENSHOT-07]`

### 3.7 Outbound links

X-Ray captures every external hyperlink in the article body as
structured data. On publish these become `link` tags — one per distinct
external link — so the link graph is queryable from both sides
(what this article links to, and which articles link to it). This is
**linkage only**: a `link` tag says "this article contains a link
there", not "this article endorses it".

---

## 4. The reader

The reader is where a capture becomes an annotated artifact.
`[SCREENSHOT-08]`

### 4.1 View modes and editing

Three tabs — **Reader** (clean readable view), **Markdown** (the raw
Markdown that will be published), **Preview** (the Markdown
re-rendered). The metadata fields (title, author, publication, date,
URL) and the body are editable; edits persist across tab switches. Every
edit to the body **re-keys the content hash** at publish (see below) —
X-Ray never lets a judgment silently transfer from the text it was made
on to edited text.

### 4.2 The content hash

Each capture carries a canonical hash of its body — the `x` tag on the
published article. It's the anchor that ties audits and verdicts to *the
exact text they judged*. If you edit the body, the reader shows the hash
as "recomputed at publish", and any audit that scored the prior text is
marked as anchored to that prior version — never re-shown as if it
scored the new text.

### 4.3 Entity tagging

Select a name in the body and tag it as an **entity**. Five entity types,
each with an icon:

| Icon | Type | Use for |
|---|---|---|
| 👤 | person | A named individual (Dr Ferran, a minister) |
| 🏢 | organization | An institution, company, agency (an institute, the WHO) |
| 📍 | place | A location (the Huanan market, Wuhan) |
| 🔷 | thing | A named object/concept (RaTG13, a specific dataset) |
| 🗂️ | case | An investigation container that groups everything about one topic (the origins case) |

Tagging the same entity across many captures builds a cross-capture,
cross-platform picture of that entity — and a **case** entity is what the
portal's case dossier assembles around. `[SCREENSHOT-09]`

### 4.4 Claims

Select a sentence and **mark it as a claim** (📋). A claim is an atomic,
checkable assertion lifted out of the article. On a claim you can set:

- **Key claim** (⭐) — central to the piece, not incidental.
- **Quote** — the verbatim supporting text.
- **Anchor** — a stored pointer back to the passage (so "locate" jumps to
  it even after edits).
- **About** — which entities the claim concerns.

Claim rows also carry action buttons: assess (⚖ / ⚖✓ when you've already
assessed), adjudicate (🏛 / 🏛✓ when propositions exist), and link (🔗)
to another claim. A ⚠ badge means the claim is in a contradiction; a 🌐
means it's been published. `[SCREENSHOT-10]`

Claims have a light **type** for the picker (`factual` 📋, `causal` ➡️,
`evaluative` ⚖️, `predictive` 🔮). This is a rough sort; the *rigorous*
classification happens in adjudication (§5.4).

### 4.5 The reader icon legend

You'll see these glyphs throughout the reader and side panel:

| Glyph | Meaning |
|---|---|
| ⭐ | Key claim |
| 🔗 | Link this claim to another |
| ⚖ / ⚖✓ | Assess this claim / already assessed |
| 🏛 / 🏛✓ | Adjudicate (atomize + rule) / propositions exist |
| ⚠ | In a contradiction (or a warning banner) |
| 🌐 | Published to relays / a relay-sourced item |
| 📋 | A local claim (also the "factual" claim type) |
| 👤 🏢 📍 🔷 🗂️ | The five entity types (person / org / place / thing / case) |

---

## 5. The judgment vocabulary

This is the part worth reading slowly. X-Ray has several distinct
*layers* of judgment, each with a controlled vocabulary and a firewall
that keeps it from overreaching. The COVID examples below use claims of
the shape that corpus produces.

### 5.1 Assessments (a stance on a claim)

An **assessment** is your take on one claim: an optional **stance**, one
or more **labels**, and a rationale.

**Stance** is a discrete −2…+2 scale:

| Value | Meaning |
|---|---|
| −2 | Strongly disagree |
| −1 | Disagree |
| 0 | Unsure |
| +1 | Agree |
| +2 | Strongly agree |

**Labels** name *what's wrong* (or notable), grouped:

- **Factual:** `false`, `unsupported`, `misleading`, `cherry-picked`,
  `missing-context`, `outdated`.
- **Consistency:** `contradicts-prior-statement`, `flip-flop`,
  `moved-goalposts`.
- **Fallacy:** `fallacy/strawman`, `fallacy/ad-hominem`,
  `fallacy/false-dilemma`, `fallacy/whataboutism`, `fallacy/circular`,
  `fallacy/slippery-slope`, `fallacy/appeal-to-authority`,
  `fallacy/appeal-to-consequences`.
- **Rhetorical:** `loaded-language`, `unfalsifiable`, `ambiguous`,
  `euphemism`.
- **Provenance:** `undisclosed-interest`.

You can also add a custom label (lowercase, optionally one
`family/value` segment). *Example:* a headline says "Scientists prove lab
origin" over a body that only quotes one preprint — stance −1, labels
`misleading` + `unsupported`, with the span quoted.

### 5.2 Relationships between claims

Typed links join two claims (kind 30055 on the wire):

- `contradicts` — the two can't both be true (**symmetric**).
- `supports` — the source backs the target (directional).
- `updates` — the source is a newer statement that revises the target
  (directional: source = later, target = earlier).
- `duplicates` — the two state the same thing (**symmetric**).

A separate **revision / story-change** family (directional, source =
earlier statement, target = later) captures how a narrative *moves*:

- `narrative-patch` — a new explanation added after the original was
  damaged, so the original conclusion survives ("covered, not solved").
- `recharacterizes` — the later statement redefines a key term to dodge
  evidence.
- `walks-back` — the later statement retreats from or softens the
  earlier once it was cornered.

*Example:* an agency's January statement ("no evidence of
human-to-human transmission") and its later statement are joined
`updates`; if the later one quietly redefines "evidence", that edge is
`recharacterizes`.

### 5.3 Attestation and convergence

When you record that a source **attests** a claim, you tag an **evidence
tier**:

| Tier | Meaning |
|---|---|
| tier-1 | Primary / official — court records, filings, datasets, signed records, primary recordings |
| tier-2 | Independent reporting |
| tier-3 | Single-source / anonymous / uncorroborated |

Each attestation carries an **origin key** — the underlying source. This
is what powers **convergence**: *twelve outlets running the same wire
story are one origin, not twelve*. The dossier collapses attestations by
origin and reports how many are *demonstrably independent* (own byline,
not a pickup) versus a single origin wearing twelve mastheads.

### 5.4 Adjudication (the truth layer)

Adjudication is X-Ray's most rigorous layer. It first **classifies** a
proposition, then lets you record **verdicts** on it — with a firewall
that keeps values and interpretations out of the true/false machinery.

#### Proposition classes

This is the "state fact vs event fact" distinction the COVID corpus
lives on:

| Class | Meaning | COVID example |
|---|---|---|
| **event-fact** | *X did Y at time T* — a dated act | "The Huanan market was closed on 2020-01-01." |
| **state-fact** | *the state of the world is Z* — a standing condition, no event time | "RaTG13 is the closest published relative of SARS-CoV-2." |
| **prediction** | *Y will occur by T* | "An intermediate host will be identified by 2022." |
| **stated-commitment** | *"I will X"* — a promise | "We will release the database." |
| **stated-value** | *"I value X"* — a bare value | "Open science matters more than speed." |
| **interpretation** | a reading or value-claim | "The delayed disclosure shows bad faith." |

The **event-fact vs state-fact** line is exactly this: an event-fact has
a *time it happened*; a state-fact describes *how the world stands* with
no event time. "The lab logged the sequence on 2019-12-30" is an
event-fact. "RaTG13 is the closest known relative" is a state-fact — it
has no "when", it's a condition that either holds or doesn't.

**The firewall:** only `event-fact`, `state-fact`, `prediction`, and
`stated-commitment` are **truth-adjudicable** (can get a true/false
verdict). `interpretation` and `stated-value` are recordable — you can
classify them, which documents *why* they're firewalled — but they never
get a verdict. Their honesty is assessable through the assessment layer
(§5.1) or the moral lens (§5.7), never ruled "true" or "false". This is
deliberate: it keeps X-Ray from becoming an orthodoxy enforcer.

#### Subject role

Orthogonal to the class — the proposition's relationship to the entity:

- `stated` — the entity's own word (a profession, a promise).
- `enacted` — the entity's deed (an action-fact about them).
- `ascribed` — a third party's characterization of the entity.
- `unclassified` — no role asserted (the absence value; never defaulted
  to something substantive).

#### Occurrence time and precision

An event's time carries a **precision** so a year never masquerades as a
timestamp: `exact`, `day`, `month`, `year`. "Late 2019" is recorded at
`year` precision and rendered as a year-wide band, not a fake date.

#### Verdict states

A verdict is a **descriptive state**, never a percentage:

| State | Meaning |
|---|---|
| `established-true` | Established true to the declared standard |
| `established-false` | Established false to the declared standard |
| `contested` | Credible evidence both ways |
| `unresolved` | A permanent, honest "we don't know" — never forced |
| `insufficient-evidence` | Not enough evidence yet — a first-class state, not a failure |

`unresolved` and `insufficient-evidence` are **honest first-class
states**, not error conditions. "Disagreement is data": multiple
verdicts on one proposition render side by side and are never averaged.

#### Standard of proof

Declared per verdict, borrowed from law: `preponderance`,
`clear-and-convincing`, `beyond-reasonable-doubt`. Facts and predictions
default to `preponderance`; stated commitments and values default to
`clear-and-convincing` (they carry reputational weight). Always
overridable — but the standard is *declared*, never implied.

#### Supersession

Verdicts are **append-only**. A new verdict *supersedes* a prior one
(both remain in the chain); the record shows how a judgment changed over
time rather than overwriting it. Mandatory caveats ride each verdict.

### 5.5 Integrity findings (words vs deeds)

An **integrity finding** pairs a `stated` commitment or value against
`enacted` action-facts about the *same* entity and rules the **match**:

| Word class | Match states |
|---|---|
| stated-commitment | `fulfilled`, `broken` (+ common) |
| stated-value | `consistent`, `contradicted` (+ common) |
| *common to both* | `unrelated`, `contested`, `insufficient` |

When a match is `broken` or `contradicted`, you may record a **gap
cause** — but only *with a documented explanation*; the system never
infers one:

- `revision` — a documented change of position. Treated as potential
  **credit**, not penalty.
- `constraint` — an external constraint (evidence, not an excuse; needs a
  corroborated action-fact).
- `incapacity`, `misattribution`, `lie` — the last only recordable with
  documentation, which is how "intent is not adjudicated" survives the
  word being in the list.

*Example:* an official commits "we will publish the raw sequences"
(stated-commitment); the record shows the database was taken offline
(enacted) → match `broken`, gap cause `constraint` with the corroborating
action-fact, or `revision` if they openly changed the policy.

### 5.6 Epistemic audits

An **audit** scores an article against eight dimensions of journalistic
epistemics. You can **import** an audit produced by the external scorer
CLI, or **run** one in-extension (needs `llmAssist` + the API key).

**Quick vs thorough:**
- **Quick** — one LLM call scoring all eight dimensions. Lower rigor; the
  result carries a standing "single-shot orchestration — lower rigor"
  caveat.
- **Thorough** — one call *per dimension* (eight calls), each with the
  full methodology. Higher rigor and higher cost. Progress shows a live
  "N/8" counter, each completed dimension is saved as it lands, and an
  interrupted run offers **resume** (only the missing dimensions re-run —
  you're never billed twice). `[SCREENSHOT-11]`

**The eight dimensions** (seven scored, one unscored), with their weights:

| Dimension | Weight | Asks |
|---|---|---|
| headline_body_fidelity | 0.15 | Does the headline match the body? |
| asymmetric_language | 0.15 | Is loaded language applied unevenly to the parties? |
| number_hygiene | 0.10 | Are the numbers used honestly? |
| source_quality | 0.20 | How good is the sourcing (named vs anonymous, primary docs)? |
| internal_coherence | 0.10 | Does the piece contradict itself? |
| definitional_precision | 0.10 | Are key/contested terms used precisely? |
| omission | 0.20 | Whose voices/facts are conspicuously absent? |
| prediction_extraction | — | Extracts falsifiable predictions (not scored — they feed the ledger) |

**Scores and bands.** Each dimension returns a 0–100 score **and** a
confidence. The aggregate maps to a band:

| Band | Score |
|---|---|
| Exemplary | 90+ |
| Solid | 75–89 |
| Acceptable, with concerns | 60–74 |
| Significant problems | 40–59 |
| Severe | 20–39 |
| Catastrophic | below 20 |

**Display rules you'll see enforced:** a score is **never** shown
without its confidence (no naked numbers); if aggregate confidence is
below 0.6 the whole badge becomes **"needs human review"** with no number
and no band color. A **knowability ceiling** caps the score when the
subject is inherently hard to know from the artifact alone — and the
ceiling shows its source. These aren't cosmetic; they're the audit
philosophy ([`PHILOSOPHY.md`](PHILOSOPHY.md)) made structural.

**Prediction ledger.** The unscored `prediction_extraction` dimension
pulls falsifiable predictions out of the article into a ledger (text,
hedge level, resolution horizon, criteria). You can **atomize** any of
them into a claim — an offered action, never automatic.

### 5.7 Forensic findings (behavioral maneuvers)

A **forensic finding** names a rhetorical/behavioral **maneuver** a
subject performs *around* the truth and binds it to evidence. It carries
**no stance, no score, and no intent field** — by construction. The five
families (seeded from the criminology and thought-reform canon):

- **neutralization** (Sykes & Matza) — techniques for excusing an act:
  deny-responsibility, deny-injury, deny-victim, condemn-condemners,
  higher-loyalties, ledger, necessity, normalcy ("everybody did it"),
  deny-negative-intent.
- **DARVO** (Freyd) — Deny, Attack, Reverse Victim & Offender.
- **thought-reform** (Lifton) — milieu-control, loading-the-language,
  sacred-science, doctrine-over-person, dispensing-of-existence,
  demand-for-purity, thought-terminating-cliché.
- **defense** (Popper/Lakatos/Proctor) — ad-hoc-patch,
  immunizing-stratagem, manufactured-doubt, frame-control,
  definitional-retreat, presentism, usefulness-pivot, credibility-armor.
- **grooming** (Finkelhor et al., an ordered sequence) —
  build-vulnerability, establish-trust, redefine-boundaries,
  apply-pressure.

Every standard maneuver ships with **indicators** *and*
**counter-indicators** — "what would make this NOT this" is always on the
page (the falsifiability discipline). A finding also requires a
**counter-note** and records its evidence **basis**: `quoted`,
`paraphrased`, `behavioral-cue`, or `structural-inference` (strongest to
weakest) — *how you know*, in place of a score.

*Example:* a spokesperson answers "is the lab-leak hypothesis correct?"
with "look at all the good this research does" → `defense/usefulness-pivot`
(shifting *is it true* to *is it useful*), basis `quoted`, counter-note
noting they *might* be offering utility alongside the truth claim, not
instead of it.

### 5.8 Lens readings (the moral lens)

A **lens reading** reconstructs how a named **jurisdiction** would read a
*normative/evaluative/framing* assertion — grounded only in that
jurisdiction's own texts. Gated by `moralLens` + the API key. It is a
**derived view**: nothing is saved durably, nothing is published, there
is no wire kind.

Jurisdictions are things *you* author in a local registry (X-Ray ships
none):

- `codified` — a legal code (statutes by citation).
- `worldview` — a tradition (which can encode internal divisions).
- `persona` — an author's corpus (a living-person guardrail applies:
  only *editorially published* works are admissible, never social
  captures).

A reading assigns a **disposition** — `endorses`, `rejects`,
`partially-endorses`, `reframes`, `out-of-scope`, or `silent` (the loaded
corpus doesn't address it — never a guess) — with **cited authorities**
(a `silent`/`out-of-scope` reading cites nothing; everything else must
cite). For a *factual* assertion the lens may only report a **corpus
stance** (`asserts` / `denies` / `silent`) — never a disposition; factual
truth is the adjudication layer's job, not the lens's.

Each reading carries a **confidence** (high/medium/low) that measures
**fidelity of reconstruction** — how directly the corpus addresses the
assertion, how unified the tradition is, how much inference was needed —
**not** whether the assertion is true and **not** how strongly the
jurisdiction feels. That distinction is load-bearing.

> **Reality check:** the moral lens is authored and driven partly from
> the browser console today, not a finished point-and-click UI. It works,
> but expect rough edges; the manual walk is in the smoke test (§16).

---

## 6. Publishing

Publishing turns your local artifacts into signed NOSTR events. From the
reader's **Publish** flow, signing happens via your Active method (local
toast, NIP-07 signer prompt, or bunker), and you get per-relay accept/
reject results. `[SCREENSHOT-12]`

**What each flag gates** (recap of §2.5): the article (30023) always
publishes; assessments/relationships (30054/30055) need
`assessmentPublishing`; audits (30056–30061) need `epistemicAuditing`;
forensic findings (30062) need `forensicPublishing`; verdicts and
integrity findings (30063/30064) need `truthAdjudicationPublishing`;
platform-account links (32126) need `platformAccountPublishing`.

**Privacy at publish.** Everything published is public and signed with
your `npub`. Your `nsec` never leaves the device. Publishing a
platform-account link (32126) discloses your captured-account → entity
graph — that's why it's separately opt-in. A published article carries a
`capture-url` tag only for archive/mirror captures, and `link` tags for
its external links.

**Ledger and re-publish.** X-Ray tracks what you've published so a
re-publish only re-emits what actually changed. Editing the body derives
a new content hash — a republish becomes a *new* addressable event rather
than silently replacing the old one; the portal's reconcile view absorbs
this.

---

## 7. The portal ("My Archive")

The portal is a full-tab, read-only view of everything you've published,
reconciled against your relays. `[SCREENSHOT-13]`

- **Library + facets + brush** — browse your corpus, filter by facets,
  brush a time range.
- **Reconcile** — compares local records against what the relays
  actually hold.
- **Inspector** — the raw event behind any item.
- **Case dashboard** — for a `case` entity, the assembled **case
  dossier**:
  - **Shape of knowledge** — the *distribution* of verdict states over
    the case's propositions, coverage counts, standards-of-proof chips,
    and the open/resolved prediction tally. Deliberately **not** a single
    fused "case score".
  - **Knots** — contradiction clusters, words-vs-deeds integrity
    findings, and forensic maneuvers.
  - **Four-axis timeline** — a world-time spine (with precision bands — a
    year-precision event is a year-wide band) plus publication, capture,
    and judgment overlays on one shared scale. Three **gap callouts**
    flag when something was *published before it occurred*, *captured
    long after publication*, or when the *story changed after the event*.
  - **Convergence-collapsed evidence** — one row per source with its
    capture completeness, per-claim quotes, origin convergence, its audit
    band (through the shared display rules), and its **link edges**
    ("links to N external sources · linked from M case articles").
  - **Entities × roles** — routing into each entity's coverage-capped
    record.
- **Entity view** — a person/org's audit dossier, integrity record, and
  forensic lenses; the ego graph; viewer `npub`s.

Everything in the dossier is **derived and computed-on-read** — same
events in, same dossier out. Nothing new is published to build it.

---

## 8. The side panel

The side panel is the entity browser and network feed. `[SCREENSHOT-14]`

- **Entity browser** — every entity you've tagged, by type, with
  merge/alias tools to collapse cross-platform accounts into one person.
- **Keys** — per-entity `npub`/`nsec` and case bundles. Case bundles are
  **password-grade** material — treat them accordingly.
- **Network feed** — assessments, verdicts, and other events seen on your
  relays, grouped by kind (⚖ Assessments, 🏛 Verdicts, …), with
  **adopt-on-sight**: pull a foreign entity or claim into your local view.
- **Sync** — reconcile local entities against the network.

---

## 9. Glossary

- **Anchor** — a stored pointer from a claim/quote back to its passage.
- **Assessment** — your stance + labels on one claim (§5.1).
- **Attestation / origin key** — a source vouching for a claim; the
  origin key collapses reprints into one source (§5.3).
- **Audit** — an eight-dimension epistemic score of an article (§5.6).
- **Band** — the qualitative bucket a score falls in (Exemplary …
  Catastrophic).
- **Case** — an entity type that groups everything about one
  investigation; the unit the dossier assembles around.
- **`capture-url`** — the address an archive/mirror capture was fetched
  from, when it differs from the recovered original.
- **`link`** — a published tag naming one external link in the article
  (linkage, not endorsement).
- **Content hash (`x` tag)** — the canonical hash of an article body;
  ties judgments to exact text.
- **Convergence** — collapsing attestations by origin so reprints count
  once (§5.3).
- **Disposition** — how a jurisdiction reads a non-factual assertion
  (§5.8).
- **Event-fact vs state-fact** — a dated act vs a standing condition
  (§5.4).
- **Firewall** — the rule that values/interpretations never get
  true/false verdicts (§5.4).
- **Forensic finding** — a named rhetorical maneuver bound to evidence,
  no score/intent (§5.7).
- **Integrity finding** — a words-vs-deeds match on one entity (§5.5).
- **Jurisdiction** — a legal code, worldview, or author corpus you author
  for the lens (§5.8).
- **Knowability ceiling** — a cap on an audit score when the subject is
  inherently hard to know (§5.6).
- **`nsec` / `npub`** — your private / public NOSTR key. `nsec` never
  leaves the device.
- **Proposition** — a classified claim that can carry verdicts (§5.4).
- **Provenance chip** — how the content was extracted (§3.5).
- **Relationship** — a typed link between two claims (§5.2).
- **Stance** — the −2…+2 agree/disagree scale (§5.1).
- **Standard of proof** — the declared bar a verdict meets (§5.4).
- **Supersession** — a new verdict replacing a prior one, both retained
  (§5.4).
- **Verdict state** — established-true/false, contested, unresolved,
  insufficient-evidence (§5.4).

**Icon legend:** ⭐ key claim · 🔗 link · ⚖/⚖✓ assess · 🏛/🏛✓ adjudicate
· ⚠ contradiction/warning · 🌐 published/relay · 📋 local claim (factual)
· 👤 person · 🏢 organization · 📍 place · 🔷 thing · 🗂️ case · ➡️ causal
claim · ⚖️ evaluative claim · 🔮 predictive claim.

---

## 10. Troubleshooting

- **Capture is thin / wrong title / scrambled.** Check the provenance
  chip (§3.5) and the platform notes in [CAPTURE_GUIDE.md](CAPTURE_GUIDE.md).
  Social platforms need the right URL shape and the post fully loaded.
  The reader's "this capture looks thin" hint links to specifics.
- **Audit ran but the panel is empty / stuck on "Auditing…".** This was
  a known bug (a long single call lost to a service-worker restart) and
  is fixed: thorough runs are now per-dimension and resumable, quick runs
  time out and restore the button. If a thorough run is interrupted,
  reopen the capture and click **Thorough audit** again — it offers
  **Resume** and only the missing dimensions re-run. If the panel shows a
  draft note, that's paid-for work waiting to resume.
- **"Audit import failed".** The import firewall re-hashes and validates
  before storing — a mismatch means the audit scored different text than
  the current capture (usually an edit after the run). Re-run against the
  current text.
- **Nothing published / relay rejected.** Check **Settings → Relays**
  (enabled + writable), that your Active signing method is set, and the
  per-relay result in the publish toast. A relay may reject oversized
  events — link-heavy or evidence-heavy articles brush size limits first.
- **Archive capture keyed to the wrong URL.** If the original wasn't
  recovered the note says so and it keys to the fetched address (never a
  guess). Click **Set original URL…** on the note (or edit the URL field
  in the header) to re-key it yourself — claims, the local archive copy,
  and audits follow, and the alias is remembered so future captures
  through either address join the same work. If recovery produced a
  *wrong* original, that's a bug — the archive site likely changed its
  markup.
- **A feature's UI is missing.** It's probably flag-gated (§2.5) or needs
  the API key (audit/lens). The moral lens is partly console-driven
  today.
- **Lost data after a reset / new machine.** Restore from a full backup
  (§2.6): Settings → Advanced → Full backup → **Restore from
  backup…**. It replaces the current state with the file's contents.
  If you only have a signed-events bundle, your published events can
  be rebroadcast to relays and re-read via the portal, but local-only
  work (unpublished drafts, source bytes, audit records) only comes
  back from a full backup.

---

## Appendix: screenshot shot list

Numbered placeholders referenced above, with what to capture. Extension
pages (reader, portal, side panel, settings) are quick; live-site shots
need the named page.

| # | Page / state | Frame |
|---|---|---|
| 01 | `chrome://extensions` with Developer mode on, X-Ray loaded | The extension card + reload button |
| 02 | Settings → Signing, first run | The method picker + Active-method line |
| 03 | Settings → Relays | A few relay rows with read/write/enabled toggles |
| 04 | Settings → Advanced → LLM assist | The API-key field + model selector (key blurred) |
| 05 | Toolbar icon right-click menu | The context menu items |
| 06 | Reader with the archive/richer-version banner | The banner offering a better capture |
| 07 | Reader on an archive.ph capture | The "captured via … · original:" note under the byline |
| 08 | Reader, main view | The three tabs + a captured article |
| 09 | Reader, entity tagger open on a selection | The five entity-type buttons |
| 10 | Reader, claims bar with several claims | Rows showing ⭐/⚠/🌐 and the action buttons |
| 11 | Reader, thorough audit mid-run | The "⏳ Auditing N/8…" counter |
| 12 | Reader, publish flow | The per-relay results toast |
| 13 | Portal, a case dashboard | Shape-of-knowledge header + timeline + evidence table |
| 14 | Side panel, entity browser + network feed | The grouped feed (⚖/🏛) and entity list |

*(Live-site shots — 06, 07 — need a real archive/paywalled page. All
others are extension surfaces, ~30 min total.)*
