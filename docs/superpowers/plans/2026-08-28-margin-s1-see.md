# Margin S1 "See" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship slice S1 of docs/MARGIN_DESIGN.md — the flag-gated, read-only "Annotated" reader view that renders every locally-held, span-groundable insight (claims + their judgments, extraction proposals, forensic findings, audit evidence, predictions) anchored to the exact text, with the strip, rail, card stacks, page-notes lane, zero state, and the four §5.4 guard tests. Mine ring only. Bars untouched. Zero wire changes.

**Architecture:** A new `src/shared/annotations/` module family (pure projectors → one derived MarginNote shape; an async collector over the existing models; a pure grounding+segment-partition pass) feeds a new `src/reader/annotated-view.js` renderer that builds a **non-contenteditable sibling article** inside `#xr-main` (the `renderPreview` precedent, src/reader/index.js:5611-5638). Grounding always re-locates by verbatim quote against the annotated container's own `textContent` via ONE `createGroundingIndex` per render — stored offsets are hints only (the two-substrate invariant, src/reader/index.js:3308-3315). Segment partition (disjoint intervals carrying covering-id sets) is plain DOM wrapping in the display-only container — no CSS Highlight API, full Firefox 128 parity. `src/reader/index.js` integrates it as a fourth view mode.

**Tech Stack:** Vanilla MV3 WebExtension JS (no framework, no TS), esbuild IIFE bundles (reader entry already bundles any `src/shared/annotations/` import — esbuild.config.mjs:87-93, zero config change), `node --test` + `node:assert/strict` `.mjs` tests with `fake-indexeddb/auto` + a `globalThis.chrome` stub.

## Global Constraints

- **Flag:** everything renders only when `isEnabled('marginView')` (new key, default `false`). The reader init already primes flags before render (src/reader/index.js:8111), so synchronous `isEnabled()` is safe in render paths.
- **Indentation:** 4 spaces in all new files; **2 spaces inside `src/shared/metadata/feature-flags.js`** (userscript-era file — match it).
- **Never** mutate `.xr-article__body` or `state.htmlDraft` from annotated code — the draft-leak guard (Task 5) enforces it.
- **No new publish paths.** Card actions route to existing module-local functions/modals only.
- **No cross-family judgment figure.** Strip shows per-family counts; the only cross-family figures are the labeled coverage counts ("N anchored · M page notes") — MARGIN_DESIGN §5.4 guard 2 carve-out.
- **Reserved truth vocabulary** (`/verdict|ruling|opinion|court|integrity/i`) appears ONLY inside truth-family sub-card templates; nowhere else in annotated HTML, class names, or data attributes. Truth sub-cards use it lawfully.
- **No `kind: 30066`** or any new `*_KIND` constant anywhere (two repo-wide kind-scans hard-fail: tests/constitution-guards.test.mjs:201-235, tests/lens-guards.test.mjs:154-174). Existing kind references are fine.
- **Never** write the literal string `You are ` in any `src/shared/` file (tests/disciplines.test.mjs:113-128 scans every shared .js for it) — e.g. the mode label copy must avoid it.
- User-visible strings say **"X-Ray"** (hyphenated) and **"relay"** (maintainer ruling 2026-08-28, MARGIN_DESIGN §12.6 — S1 has no relay copy, but if any appears, "relay" not "server").
- All chrome.storage reads go through `Storage`/the models; all IndexedDB reads through `audit-cache.js`/`archive-cache.js` exports (workspace scoping is only correct that way — src/shared/storage.js:51-54, workspace-keys.js:95).
- No `console.log` — `console.warn` in catch blocks matches reader convention; shared modules stay silent or use `Utils.log`.
- Commit style: `feat(margin): …` / `test(margin): …`, imperative present, one concern per commit. Do NOT push or open a PR until the final task.
- Gates that must stay green after every task: `npm test` (~2500 tests) — and `npm run build` + `npm run lint` at Tasks 7-10. Run `npm install` first if `node_modules` is missing (the #1 false alarm).

## File Structure

- Create: `src/shared/annotations/notes.js` — pure projectors: existing records → MarginNote[]. One responsibility: shaping. No storage, no DOM.
- Create: `src/shared/annotations/collect.js` — async collector: fetches from models/caches, calls projectors. One responsibility: data access.
- Create: `src/shared/annotations/segments.js` — pure grounding + disjoint-segment partition. No storage, no DOM.
- Create: `src/reader/annotated-view.js` — HTML renderers + DOM hydrate for the annotated container (strip, body, rail, cards, page notes). No imports from index.js; index.js imports IT (the claims-bar pattern).
- Modify: `src/shared/metadata/feature-flags.js:228` — add `marginView: false` after `extractionAnalysisPublishing`.
- Modify: `src/reader/index.html:18-22` (fourth tab button) and section region (no new hosts — the view renders into `#xr-main`).
- Modify: `src/reader/index.js` — import block; `setViewMode` (5653-5668) + the three other re-render switch sites (1300-1304, 4042-4046, 5825-5829); new `renderAnnotated()`; default-view rule; event delegation for cards; tagger install on the annotated body.
- Modify: `src/reader/index.css` — annotated styles (tokens only; adds the reader's FIRST width media query).
- Test: `tests/margin-notes.test.mjs`, `tests/margin-segments.test.mjs`, `tests/margin-collect.test.mjs`, `tests/margin-guards.test.mjs`.
- Modify: `docs/SMOKE_TEST.md` (new "Margin S1" section + walk-ledger row placeholder), `docs/JOURNAL.md` (entry, final task).

---

### Task 1: The `marginView` flag

**Files:**
- Modify: `src/shared/metadata/feature-flags.js` (insert before the closing `});` of FLAGS_DEFAULTS, after the `extractionAnalysisPublishing` entry at line 228)
- Test: `tests/margin-guards.test.mjs` (created here with the flag pin; the four §5.4 guards join it in Task 5)

**Interfaces:**
- Consumes: `FLAGS_DEFAULTS`, `loadFlags()`, `isEnabled(flag)` from `src/shared/metadata/feature-flags.js` (loadFlags at :244, isEnabled at :261 — synchronous, false for unknown keys).
- Produces: the flag key string `'marginView'` — every later task gates on `isEnabled('marginView')`.

- [ ] **Step 1: Write the failing test**

Create `tests/margin-guards.test.mjs`:

```js
// Margin S1 guards — MARGIN_DESIGN.md §5.4 + the flag-default pin.
// Idiom: positive sanity assertion first, then the enforcing negative
// (the constitution-guards convention; helpers stay test-local).
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

const { FLAGS_DEFAULTS } = await import('../src/shared/metadata/feature-flags.js');

test('guard: marginView defaults OFF (MARGIN_DESIGN §9 — S1 ships behind its own default-off flag)', () => {
    assert.ok(Object.prototype.hasOwnProperty.call(FLAGS_DEFAULTS, 'marginView'),
        'the marginView key is registered in FLAGS_DEFAULTS');
    assert.equal(FLAGS_DEFAULTS.marginView, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/margin-guards.test.mjs`
Expected: FAIL — "the marginView key is registered in FLAGS_DEFAULTS".

- [ ] **Step 3: Add the flag (2-space indent, comment names the design doc — the file's convention)**

In `src/shared/metadata/feature-flags.js`, immediately after the `extractionAnalysisPublishing: false,` entry (line 228), inside the frozen object:

```js
  // The Margin S1 (docs/MARGIN_DESIGN.md §9): the read-only Annotated
  // reader view — span-anchored insight cards over the user's own
  // records. Display-only; no publish path and no wire kind rides
  // this flag. Default off until the maintainer's S1 soak walk.
  marginView: false
```

(Add a trailing comma to the previous entry if needed so the object stays valid.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/margin-guards.test.mjs`
Expected: PASS (1 test).

- [ ] **Step 5: Run the full suite (the flag file is imported widely)**

Run: `npm test`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/shared/metadata/feature-flags.js tests/margin-guards.test.mjs
git commit -m "feat(margin): register the default-off marginView flag"
```

---

### Task 2: `src/shared/annotations/notes.js` — the MarginNote projectors (pure)

**Files:**
- Create: `src/shared/annotations/notes.js`
- Test: `tests/margin-notes.test.mjs`

**Interfaces:**
- Consumes: record shapes exactly as stored (see fixtures below): claim records (src/shared/claim-model.js:326-343), assessment record (assessment-model.js:315-326, ONE per claim), proposition/verdict records (truth-adjudication-model.js:258-269, :586-604), forensic findings (forensic-model.js:278-295, anchors rows :163-170), the article-extractions record (map-artifacts.js — `assertions` is an ARRAY of rows `{key,quote,start,end,why,text,status,accepted_claim_id,first_seen}`), audit runs (`moduleResults[]`, evidence via `collectEvidenceFindings(findings)` → `[{quote,kind,severity}]`, src/shared/audit/assemble.js:57), prediction records (audit-model.js:257-285, `evidence_quote` string), and `normalize` from `src/shared/metadata/url-normalizer.js` (forensic URLs are stored through THIS normalizer, never Utils.normalizeUrl — scout warning).
- Produces (every later task relies on these exact names):

```js
// MarginNote — the one derived render record (MARGIN_DESIGN §5.1).
// Computed on read, never persisted, never on the wire.
// {
//   id: string,            // stable render id, unique per view
//   family: 'claim'|'extraction'|'forensic'|'audit'|'prediction'|'comment',
//   quote: string,         // verbatim span to ground; '' => page note
//   grounding: null,       // segments.js fills {status,start,end,exact}
//   pageReason: string|null,// non-null => page-notes lane, stated reason
//   title: string,         // card headline, words not glyphs
//   body: string,          // card prose
//   meta: object,          // the source record (renderer reads fields)
//   actions: string[],     // verbs index.js binds: 'locate','assess',
//                          // 'adjudicate','edit','accept','dismiss'
//   reviewState: 'open'|'accepted'|'dismissed'|null, // extraction only
//   sub: Array             // claim judgments: {kind:'assessment'|'verdict', record}
// }
export function projectClaimNotes({ claims = [], assessmentsByClaimId = {}, verdictsByClaimId = {} })
export function projectExtractionNotes(record)          // record|null
export function projectForensicNotes(findings, pageUrl) // findings: id->record map; pageUrl RAW (normalized inside)
export function projectAuditNotes(runs = [])
export function projectPredictionNotes(predictions = [])
export function projectCommentNotes(comments = [])      // always page notes
export const PAGE_REASONS = Object.freeze({...})        // the §8 reason strings
```

- [ ] **Step 1: Write the failing tests**

Create `tests/margin-notes.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

const {
    projectClaimNotes, projectExtractionNotes, projectForensicNotes,
    projectAuditNotes, projectPredictionNotes, projectCommentNotes, PAGE_REASONS
} = await import('../src/shared/annotations/notes.js');

const CLAIM = {
    id: 'claim_ab12cd34ef56ab12', text: 'The sale closed in March.',
    quote: 'the transaction was completed in March', anchor: null,
    article_hash: 'a'.repeat(64), source_url: 'https://example.com/story',
    about: [], source: null, is_key: true, context: '', created: 1
};

test('claim note carries quote, actions, and judgment sub-cards', () => {
    const assessment = { id: 'as1', claim_ref: { claim_id: CLAIM.id }, stance: -1, rationale: 'r', labels: [] };
    const verdict = { id: 'v1', proposition_id: 'p1', verdict: 'unfounded', standard_of_proof: 'clear', evidence_for: [], evidence_against: [] };
    const notes = projectClaimNotes({
        claims: [CLAIM],
        assessmentsByClaimId: { [CLAIM.id]: assessment },
        verdictsByClaimId: { [CLAIM.id]: [verdict] }
    });
    assert.equal(notes.length, 1);
    const n = notes[0];
    assert.equal(n.family, 'claim');
    assert.equal(n.id, 'claim:' + CLAIM.id);
    assert.equal(n.quote, CLAIM.quote);
    assert.equal(n.pageReason, null);
    assert.equal(n.grounding, null);
    assert.ok(n.actions.includes('assess') && n.actions.includes('adjudicate')
        && n.actions.includes('edit') && n.actions.includes('locate'));
    assert.equal(n.sub.length, 2);
    assert.deepEqual(n.sub.map((s) => s.kind).sort(), ['assessment', 'verdict']);
});

test('anchorless pre-10.3 claim without quote falls back to claim text with the no-anchor page reason ONLY when text search must be ambiguous later — projection keeps it groundable by text', () => {
    const legacy = { ...CLAIM, id: 'claim_legacy0000000000', quote: '', anchor: null };
    const [n] = projectClaimNotes({ claims: [legacy], assessmentsByClaimId: {}, verdictsByClaimId: {} });
    assert.equal(n.quote, legacy.text);   // ground by the claim text; segments.js demotes on miss
    assert.equal(n.pageReason, null);
});

test('extraction notes lead with review state and skip nothing', () => {
    const record = {
        articleHash: 'a'.repeat(64), url: 'https://example.com/story', assertions: [
            { key: 'a:10-42', quote: 'exact span one', start: 10, end: 42, why: 'w', text: 'paraphrase', status: 'open', accepted_claim_id: null, first_seen: { producer: 'map' } },
            { key: 'a:50-70', quote: 'exact span two', start: 50, end: 70, why: '', text: null, status: 'dismissed', accepted_claim_id: null, first_seen: { producer: 'suggest' } }
        ]
    };
    const notes = projectExtractionNotes(record);
    assert.equal(notes.length, 2);
    assert.equal(notes[0].family, 'extraction');
    assert.equal(notes[0].reviewState, 'open');
    assert.ok(notes[0].actions.includes('accept') && notes[0].actions.includes('dismiss'));
    assert.equal(notes[1].reviewState, 'dismissed');
    assert.deepEqual(notes[1].actions, ['locate']);   // decided rows keep locate only
    assert.equal(projectExtractionNotes(null).length, 0);
});

test('forensic notes: one note per anchor, filtered by the metadata-normalized page URL', () => {
    const findings = {
        f1: { id: 'f1', maneuver: 'quote_mining', note: 'n', counter_note: 'c', anchors: [
            { quote: 'clipped words', selector: null, source_ref: { url: 'https://example.com/story' }, timestamp: null, step_note: '' },
            { quote: 'other page words', selector: null, source_ref: { url: 'https://elsewhere.org/x' }, timestamp: null, step_note: '' }
        ] },
        f2: { id: 'f2', maneuver: 'cherry_pick', note: '', counter_note: '', anchors: [
            { quote: 'unrelated', selector: null, source_ref: null, timestamp: null, step_note: '' }
        ] }
    };
    const notes = projectForensicNotes(findings, 'https://example.com/story?utm_source=x');
    assert.equal(notes.length, 1);
    assert.equal(notes[0].family, 'forensic');
    assert.equal(notes[0].quote, 'clipped words');
    assert.ok(notes[0].body.includes('c'), 'counter-note rides the card (Art. 7 counter-read)');
});

test('audit notes never offer respond actions (read-only by firewall) and carry module context', () => {
    const runs = [{ id: 'r1', moduleResults: [
        { module: 'module-03', findings: { hidden_premises: [{ premise: 'x', evidence_quote: 'the stated basis' }] } }
    ] }];
    const notes = projectAuditNotes(runs);
    assert.equal(notes.length, 1);
    assert.equal(notes[0].family, 'audit');
    assert.equal(notes[0].quote, 'the stated basis');
    assert.deepEqual(notes[0].actions, ['locate']);
});

test('prediction and comment projections', () => {
    const preds = [{ id: 'p1', text: 'X will happen', evidence_quote: 'will happen by June', anchor: null, resolution_status: 'open' }];
    const [pn] = projectPredictionNotes(preds);
    assert.equal(pn.family, 'prediction');
    assert.equal(pn.quote, 'will happen by June');
    const [cn] = projectCommentNotes([{ author: 'someone', text: 'a platform comment' }]);
    assert.equal(cn.family, 'comment');
    assert.equal(cn.quote, '');
    assert.equal(cn.pageReason, PAGE_REASONS.pageLevelByDesign);
});

test('no projector output smuggles reserved vocabulary outside truth sub-cards', () => {
    const RESERVED = /verdict|ruling|opinion|court|integrity/i;
    const notes = [
        ...projectExtractionNotes({ articleHash: 'a'.repeat(64), assertions: [{ key: 'a:1-2', quote: 'q', start: 1, end: 2, why: '', text: null, status: 'open', accepted_claim_id: null, first_seen: {} }] }),
        ...projectAuditNotes([{ id: 'r', moduleResults: [{ module: 'm', findings: { f: [{ evidence_quote: 'q' }] } }] }])
    ];
    for (const n of notes) {
        assert.doesNotMatch(n.title, RESERVED, `title of ${n.id}`);
        assert.doesNotMatch(n.family, RESERVED, `family of ${n.id}`);
    }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/margin-notes.test.mjs`
Expected: FAIL — cannot find module `../src/shared/annotations/notes.js`.

- [ ] **Step 3: Implement `src/shared/annotations/notes.js`**

```js
// Margin S1 — pure projectors: existing records -> MarginNote[].
// docs/MARGIN_DESIGN.md §5.1. Computed on read, never persisted,
// never on the wire. No storage access, no DOM: callers fetch, we
// shape. Family separation is structural — each projector emits one
// family and the renderer keys templates off it (§5.3).
import { collectEvidenceFindings } from '../audit/assemble.js';
import { normalize } from '../metadata/url-normalizer.js';

export const PAGE_REASONS = Object.freeze({
    pageLevelByDesign: 'About the whole page, not a passage',
    couldNotLocate: 'Could not find this text in your copy — the article may have changed',
    noAnchorRecorded: 'No anchor was recorded when this was made',
    sourceNotCaptured: 'From a source you have not captured here',
    editedAway: 'No longer matches the text after your edit'
});

const note = (fields) => ({
    id: '', family: '', quote: '', grounding: null, pageReason: null,
    title: '', body: '', meta: {}, actions: ['locate'], reviewState: null,
    sub: [], ...fields
});

export function projectClaimNotes({ claims = [], assessmentsByClaimId = {}, verdictsByClaimId = {} }) {
    return claims.map((claim) => {
        const sub = [];
        const assessment = assessmentsByClaimId[claim.id];
        if (assessment) sub.push({ kind: 'assessment', record: assessment });
        for (const v of verdictsByClaimId[claim.id] || []) {
            sub.push({ kind: 'verdict', record: v });
        }
        return note({
            id: 'claim:' + claim.id,
            family: 'claim',
            // Prefer the untruncated first-class quote; fall back to the
            // claim text (pre-14.5 records) — segments.js demotes a miss
            // to the page lane rather than first-occurrence guessing.
            quote: String(claim.quote || claim.text || ''),
            title: claim.is_key ? 'Key claim' : 'Claim',
            body: String(claim.text || ''),
            meta: claim,
            actions: ['locate', 'assess', 'adjudicate', 'edit'],
            sub
        });
    });
}

export function projectExtractionNotes(record) {
    if (!record || !Array.isArray(record.assertions)) return [];
    return record.assertions.map((row) => {
        const state = (row.status === 'accepted' || row.status === 'dismissed') ? row.status : 'open';
        return note({
            id: 'extract:' + row.key,
            family: 'extraction',
            quote: String(row.quote || ''),
            title: 'Claim proposal',
            body: String((row.text || row.why) || ''),
            meta: row,
            reviewState: state,
            actions: state === 'open' ? ['locate', 'accept', 'dismiss'] : ['locate']
        });
    });
}

export function projectForensicNotes(findings, pageUrl) {
    const wanted = normalize(String(pageUrl || ''));
    const out = [];
    for (const f of Object.values(findings || {})) {
        for (let i = 0; i < (f.anchors || []).length; i++) {
            const a = f.anchors[i];
            const anchorUrl = a && a.source_ref && a.source_ref.url ? normalize(a.source_ref.url) : null;
            if (!anchorUrl || anchorUrl !== wanted) continue;
            out.push(note({
                id: 'forensic:' + f.id + ':' + i,
                family: 'forensic',
                quote: String(a.quote || ''),
                title: 'Forensic finding — ' + String(f.maneuver || '').replace(/_/g, ' '),
                // Structural observation with its counter-read beside it
                // (CONSTITUTION Art. 7; NIP_DRAFT counter_note discipline).
                body: [f.note, f.counter_note ? ('Counter-read: ' + f.counter_note) : '']
                    .filter(Boolean).join(' — '),
                meta: { finding: f, anchor: a }
            }));
        }
    }
    return out;
}

export function projectAuditNotes(runs = []) {
    const out = [];
    for (const run of runs) {
        for (const mr of run.moduleResults || []) {
            const found = collectEvidenceFindings((mr && mr.findings) || {});
            for (let i = 0; i < found.length; i++) {
                out.push(note({
                    id: 'audit:' + run.id + ':' + (mr.module || 'm') + ':' + i,
                    family: 'audit',
                    quote: String(found[i].quote || ''),
                    title: 'Audit evidence — ' + String(mr.module || ''),
                    body: String(found[i].kind || ''),
                    meta: { runId: run.id, module: mr.module, severity: found[i].severity || null }
                }));
            }
        }
    }
    return out;
}

export function projectPredictionNotes(predictions = []) {
    return predictions.map((p) => note({
        id: 'prediction:' + p.id,
        family: 'prediction',
        quote: String(p.evidence_quote || ''),
        title: 'Prediction',
        body: String(p.text || ''),
        meta: p
    }));
}

export function projectCommentNotes(comments = []) {
    return comments.map((c, i) => note({
        id: 'comment:' + i,
        family: 'comment',
        quote: '',
        pageReason: PAGE_REASONS.pageLevelByDesign,
        title: 'Platform comment',
        body: String(c.text || ''),
        meta: c,
        actions: []
    }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/margin-notes.test.mjs`
Expected: PASS (7 tests). If `collectEvidenceFindings`'s import chain pulls chrome at import time, the stub at the top of the test file covers it (same pattern as tests/archive-cache.test.mjs:19-21).

- [ ] **Step 5: Commit**

```bash
git add src/shared/annotations/notes.js tests/margin-notes.test.mjs
git commit -m "feat(margin): add the MarginNote projectors (pure, one per family)"
```
