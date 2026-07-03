# Complex Content Capture — Design (PDFs, tables, scientific papers)

**Status: DESIGN ONLY** (v0.1, 2026-07-03). Nothing in this document is
implemented. The FLF Epistack sprint (`docs/EPISTACK_WIN_PLAN.md`)
outranks this work until it ships. Slices at the end.

Related: `docs/CAPTURE_GUIDE.md` (per-platform capture),
`docs/PHASE_14_5_LLM_ASSIST_KICKOFF.md` (LLM assist + consent gates),
`docs/EPISTEMIC_AUDIT_DESIGN.md` §"Canonical article hash",
JOURNAL 2026-07-03 (*Suggest provenance is grounded* — the
quote-as-search-key contract this design extends to extraction).

---

## 1. Problem

Three classes of content X-Ray cannot capture, or captures badly:

1. **PDFs — total failure, structural.** Capture lives in the content
   script, and neither Chrome nor Firefox injects content scripts into
   their built-in PDF viewers. The pipeline never sees the document.
   Today a toolbar click on a PDF tab hits the
   `chrome.tabs.sendMessage(tab.id, {type:'xray:capture'})` failure
   branch in `src/background/index.js` and punts to Settings — the
   user gets nothing.
2. **Complex tables — silent mangling.** `content-extractor.js`
   already uses the Turndown GFM plugin, so simple grids survive. But
   GFM markdown has **no representation** for rowspan/colspan, nested
   tables, or multi-row headers; Turndown flattens them into garbage,
   and the damage is invisible until someone reads the capture.
3. **Scientific papers — death by a dozen cuts.** Rendered math
   (MathJax/KaTeX DOM) turns to noise in markdown; two-column PDF
   layouts scramble reading order; figures lose their captions;
   reference lists — the provenance-richest part of a paper — arrive
   as undifferentiated text.

These matter beyond convenience: X-Ray is an evidence tool, and PDFs
(court filings, official reports, preprints) are precisely the
documents a case capture most needs.

## 2. Goals and non-goals

**Goals**

- G1. A PDF tab captures with one toolbar click, exactly like an HTML
  page: extracted markdown in the reader, claims/entities/findings
  pipeline unchanged downstream.
- G2. Complex structure degrades **honestly**: a table the format
  can't represent is preserved (HTML block or image), never silently
  mangled.
- G3. Extraction provenance is absolute, extending the Phase 14.5
  contract: every stored capture records *how* its text was derived
  and from *which bytes*, and quotes ground against a deterministic
  text layer wherever one exists.
- G4. Scientific papers keep their load-bearing structure: math as
  TeX, tables as tables, references as references, page-level
  citability.

**Non-goals**

- No server-side conversion service — everything runs in the
  extension (or, gated, through the user's own Anthropic key).
- No general OCR stack (tesseract.js + WASM + language data is ~10MB
  of bundle and MV3 CSP friction); scanned documents route through
  the Tier-3 LLM path instead, honestly labeled.
- No attempt at pixel-faithful PDF re-rendering; the capture target
  remains readable, hashable, groundable markdown plus the archived
  original bytes.

## 3. Architecture: three tiers, one substrate rule

| tier | handles | mechanism | trust profile |
|---|---|---|---|
| 1 | complex tables, math, scholarly HTML | deterministic extractor rules + platform handlers | pure code, no new deps |
| 2 | PDFs with a text layer | pdf.js in the reader page | deterministic, ~1.5MB lazy bundle |
| 3 | scans, brutal layouts, table semantics | Claude (native PDF/vision) behind `llmAssist` | model output — constrained by the substrate rule |

**The substrate rule** (the one design decision everything else hangs
on): *the deterministic text layer is always the grounding substrate.*
Tier 3 may reconstruct **structure** — reading order, table shape,
section boundaries — but its output must re-ground against Tier-2
text (via `quote-grounding.js`) before anything is stored. Only where
no text layer exists (pure scans) may model-transcribed text become
the capture, and then the extraction provenance says so. This is the
quote-as-search-key contract, one level down the stack.

---

## 4. Tier 1 — deterministic extractor upgrades

All inside `content-extractor.js` + `platforms/`, no new dependencies.

### 4.1 Complex tables: preserve, don't mangle

- **Classifier** (pure): a table is *complex* if it has `rowspan`/
  `colspan` > 1, nested tables, `> 1` header row, or cell-level block
  content. Simple → existing GFM path, unchanged.
- **Complex → sanitized HTML block** embedded in the markdown
  (markdown legally carries inline HTML; the reader already renders
  it). Sanitization is a strict allowlist (`table/thead/tbody/tr/
  th/td/caption` + `rowspan/colspan` only) applied on the cloned
  node — same pattern as the existing `xr-*` capture markers.
- **Determinism**: the serialized HTML is normalized (attribute
  order, whitespace) so `article_hash` stays stable across captures.
- **Grounding**: unaffected — grounding runs over rendered
  `textContent`, and an HTML table linearizes the same way every
  time. Cell-level anchors work today and keep working.
- **Fallback affordance**: the capture UI's existing screenshot
  message (`xray:screenshot:capture`) can rasterize a table the user
  judges hopeless; the image embeds with the table's caption. Manual,
  never automatic.

### 4.2 Math: recover the source, don't transcribe the rendering

- **MathJax/KaTeX detection**: both preserve the author's TeX —
  MathJax v3 in its internal math list and `<mjx-container>` data,
  KaTeX in the `<annotation encoding="application/x-tex">` node.
  A Turndown rule replaces the rendered subtree with `$…$` /
  `$$…$$` from that source.
- **Raw MathML** (no TeX annotation): preserved as an inline HTML
  island like complex tables.
- Reader gains a math renderer for display (KaTeX, bundled, ~280KB,
  extension-page only) — display-time, not capture-time, so captures
  stay dependency-free.

### 4.3 Scholarly HTML: platform handlers, the existing seam

New handlers in `src/shared/platforms/` (dispatch + detector cases —
the designed extension point; no UI changes):

- **`arxiv.js`** — prefer the ar5iv/"HTML (experimental)" rendition
  when the user is on `/abs/` or `/pdf/`; carry arXiv id + version as
  capture metadata (versioned preprints are an edition-provenance
  gift: the id pins the exact revision).
- **`pmc.js`** — PubMed Central's clean article DOM: structured
  abstract, section headings, figure captions, and the references
  list parsed into structured entries.
- **DOI enrichment** — when a DOI is detected (meta tags, URL), a
  background Crossref lookup (`<all_urls>` already granted) fills
  canonical title/authors/date. Metadata only; the captured text is
  always what the page said.
- **References as structure**: a parsed reference list lands in a
  `references` field on the capture (title/authors/year/DOI per
  entry) — the natural feed for citation-graph work later (papers as
  `case`/`thing` entities), but this design stops at capturing it.

## 5. Tier 2 — native PDF ingestion

### 5.1 Trigger and routing

The background already owns the click. The `sendMessage` catch that
today punts to Settings becomes a router:

```
toolbar click → sendMessage('xray:capture') fails
  → tab.url or Content-Type sniff says PDF?
      → open reader with ?pdf=<encoded original url>
      → else: today's Settings fallback
```

Firefox's viewer is itself pdf.js at a `resource://` URL with the
document URL embedded — the router normalizes both browsers' viewer
URLs back to the raw document URL. Also: a `capture PDF` context-menu
item on PDF links (capture without opening the viewer at all).

### 5.2 Acquisition

The **reader page** (extension page; host permissions apply) fetches
the bytes with `credentials: 'include'`, so cookie-gated PDFs the
user can see are usually fetchable. Failure modes are surfaced, not
smoothed over: auth-bound URLs that 403 on refetch get a clear toast
("this PDF can't be refetched — save it locally and use Import PDF"),
and an **Import PDF file…** input in the reader covers the local-file
case (and is the fully-offline path).

### 5.3 Parsing: pdf.js in the reader page

- `pdfjs-dist` bundled by esbuild as a lazy chunk + its worker
  spawned from a bundled same-extension URL. No service-worker or
  offscreen-document machinery — the reader is a full extension page
  on both browsers (Firefox ≥128 unaffected).
- `getTextContent()` per page → positioned runs → **layout
  reconstruction** (pure, unit-testable): x-cluster runs into
  columns, order columns left-to-right, merge lines into paragraphs
  by leading/indent heuristics, drop repeating headers/footers
  (same-y text recurring on ≥3 pages), reflow hyphenated line
  breaks. This covers one- and two-column text PDFs — most reports,
  filings, and preprints.
- Output: markdown + a **page map** (`[{page, start, end}]` — char
  offsets into the canonical text per page).

### 5.4 Provenance (the point)

- **`source_hash`** — sha256 of the original bytes — recorded on the
  capture; the bytes themselves land in the archive cache (IndexedDB
  v3 adds a `source_documents` store keyed by that hash: bytes, mime,
  original URL, fetch time). The archive holds the *evidence*, not
  just our reading of it.
- **`extraction` record** on the capture (local, and later mirrorable
  on the 30023 as additive tags):
  `{ method: 'pdfjs-<version>', source_hash, page_count }`.
- **Page anchors**: claims captured from a PDF get a page number
  derived from the page map, carried as an additive
  `FragmentSelector` (`{type:'FragmentSelector', value:'page=7',
  conformsTo: <PDF fragment spec>}`) alongside the existing
  TextQuote/TextPosition selectors. Resolvers that don't know it
  skip it (the Phase 14.5 pattern); consumers that do can cite
  "p. 7".
- `article_hash` computes over the extracted markdown exactly as for
  HTML captures — the whole grounding/claims/audit stack works
  unchanged.

### 5.5 Known limits (by design)

Encrypted PDFs: fail with a clear message. Pure-scan PDFs (no text
layer): detected (near-empty text content) and offered the Tier-3
path. Forms/annotations: out of scope v1.

## 6. Tier 3 — LLM extraction assist

### 6.1 What it's for

Three cases where deterministic extraction is insufficient: scanned
pages (no text layer), layouts the heuristics scramble (dense
multi-column with floats, magazine layouts), and **table semantics**
(a table whose meaning needs header-scope reasoning to linearize).
The Messages API accepts PDFs natively as document blocks (vision
over rendered pages included), so no OCR stack is needed.

### 6.2 The substrate rule, mechanized

New message `xray:llm:extract` (service-worker client, same
`llmAssist` + API-key gates, always an explicit user action — a
"Reconstruct with LLM…" button on the capture, never automatic):

- **Text layer exists (the common case):** the model receives the
  PDF and returns *structure over the substrate* — ordered section
  spans, table reconstructions, figure captions — where every text
  span it emits is treated as a **search key** and re-grounded
  against the Tier-2 text via `quote-grounding.js`. Spans that
  ground are re-canonicalized to substrate bytes (the Suggest
  contract, verbatim); spans that don't are dropped and counted,
  with the count surfaced ("3 of 214 spans could not be verified and
  were discarded"). The stored capture never contains model-authored
  body text.
- **No text layer (scans):** the model's transcription IS the
  capture — allowed, but `extraction.method = 'llm:<model>'` and the
  reader banners it ("machine-transcribed from a scanned document —
  verify against the archived original"), with the archived bytes
  one click away. Grounding then runs against the transcription
  (internally consistent), and `source_hash` still pins the original.
- **Consent copy** states plainly that the document leaves the
  device; cost is bounded by explicit action + the existing
  one-pass-per-click discipline. Anthropic's PDF input caps
  (~100 pages/request) are handled by page-range chunking with the
  page map keeping offsets straight.

### 6.3 Provenance record

```
extraction: {
  method:      'pdfjs-4.x' | 'llm:<model>' | 'pdfjs-4.x+llm:<model>',
  source_hash: <sha256 of original bytes>,
  page_count:  N,
  unverified_spans?: n     // Tier-3 structure passes only
}
```

Local-first; when the article publishes, `method` and `source_hash`
mirror as additive 30023 tags so consumers can distinguish
"deterministic text layer" from "model-transcribed" forever.

## 7. Wire and storage additions (all additive)

| addition | where | status |
|---|---|---|
| complex-table HTML islands, `$TeX$` math | 30023 content (markdown) | Tier 1 |
| `references` structure | local capture record | Tier 1 |
| `source_documents` store (bytes by sha256) | IndexedDB v3 | Tier 2 |
| `extraction` record | local capture record | Tier 2/3 |
| `FragmentSelector` (`page=N`) in anchor arrays | 30040/30054/30062 selectors | Tier 2 |
| `extraction-method` / `source-hash` tags | 30023 | Tier 3 mirror |

No new kinds; unknown selectors/tags are skipped by existing
consumers (the established pattern).

## 8. Slice plan (one concern per PR)

- **C1 — tables + math.** Classifier, HTML-island preservation +
  normalization, TeX recovery rules, KaTeX display in the reader;
  extractor tests over fixture DOMs.
- **C2 — scholarly HTML handlers.** `arxiv.js`, `pmc.js`, DOI/
  Crossref enrichment, references parsing; CAPTURE_GUIDE entries.
- **C3 — PDF routing + acquisition.** Background router (viewer-URL
  normalization both browsers), reader `?pdf=` + Import-PDF-file
  path, archive-cache v3 `source_documents`, `source_hash`.
- **C4 — pdf.js extraction.** Lazy bundle + worker, layout
  reconstruction (pure module, fixture-tested), page map,
  `extraction` record, page-anchored claims (FragmentSelector emit +
  resolver skip-tolerance test).
- **C5 — LLM extraction assist.** `xray:llm:extract`, dual-substrate
  re-grounding pass with unverified-span accounting, scanned-document
  path + banner, consent copy; mock-client tests.
- **C6 — docs + smoke.** SMOKE_TEST §PDF walk, NIP_DRAFT additive-tag
  notes, CHANGELOG.

Suggested order: C1/C2 are independent quick wins; C3→C4 is the
unlock; C5 only after C4's substrate exists (the rule requires it).

## 9. Open questions

1. **PDF viewer URL normalization coverage** — Chrome's viewer,
   Firefox's `resource://pdf.js` wrapper, and embedded `<embed>`
   viewers on publisher sites; enumerate shapes in C3 and keep a
   JOURNAL entry per discovered variant (the CAPTURE_GUIDE pattern).
2. **Very large PDFs** — bytes in IndexedDB are fine to ~tens of MB;
   set a cap (50MB?) with a keep-bytes-or-hash-only choice above it.
3. **`references` → claims/entities** — capturing the structure is
   this design; whether references auto-suggest `thing`/`case`
   entities belongs to the entity-corpus work
   (`docs/ENTITY_CORPUS_DESIGN.md`), not here.
4. **EPUB and other document formats** — the Tier-2 pattern (fetch
   bytes → parse in reader → markdown + source_hash) generalizes;
   out of scope until PDFs prove it.
5. **Turndown GFM edge**: whether to *also* emit a linearized GFM
   approximation next to an HTML-island table for grep-ability of
   published markdown — leaning no (two renderings of one table is
   two chances to disagree).
