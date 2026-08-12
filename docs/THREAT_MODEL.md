# Threat model

**Status:** living document. Every PR that adds or changes a surface
updates its row here in the same PR (`.claude/skills/security-threat-modeler`
Standard 1).
**Date:** 2026-08-09. **Scope:** the extension, the loopback companion
service, and the data they hold.

X-Ray holds NOSTR private keys in browser storage, injects scripts into
the MAIN world of every page, strips CSP via `declarativeNetRequest`,
hooks `fetch`/XHR on hostile platforms, and ships prompts and audio to
cloud providers — on behalf of an operator running adversarial
casework. This document says what is worth stealing, which boundaries
an input crosses to reach it, and what checks that boundary.

It is written to be read by someone deciding whether to trust the tool
with their own investigation, not only by its authors.

---

## 1. Assets, in order

1. **Signing keys.** `local_primary_identity` (the operator's `nsec`)
   and `local_keys` (per-entity keys plus the `xray:user` entity-sync
   key), both in `chrome.storage.local`. Compromise means an attacker
   publishes as the operator or as any entity they speak for, and can
   decrypt entity sync. Irrecoverable: NOSTR identity is the key.
2. **The unpublished casework corpus.** Captures, claims, assessments,
   verdicts, audit runs, case briefs, extraction records. This is the
   deliverable — an investigation is months of work — and much of it is
   deliberately not yet public.
3. **The operator's capture pattern.** What they captured, whose pages,
   and when. For adversarial casework this is arguably more sensitive
   than the corpus: it discloses who is under scrutiny before any
   finding is published.
4. **Third-party credentials.** The Anthropic API key, AssemblyAI /
   Deepgram keys, the companion auth token. Financially abusable, and
   their traffic reveals asset 3.

Everything else — caches, derived views, UI state — is replaceable.

---

## 2. Attacker classes

| Class | Capability assumed |
|---|---|
| **Malicious captured page** | Runs arbitrary script in its own MAIN world; can read and post `window.postMessage`; authored the text the capture pipeline and the LLM will read. **Assume every captured page is hostile** — the tool is pointed at people who would rather not be captured. |
| **Malicious relay** | Returns arbitrary events for any filter, including events forged to look like a followed author's. |
| **Malicious peer / shared file** | A collaborator's backup, case bundle, or entity-sync payload — semi-trusted at best, and at 1.0 this is a routine group workflow. |
| **Compromised cloud provider** | Anthropic, AssemblyAI, Deepgram: sees whatever is sent, and returns text the tool will act on. |
| **Local software** | Anything on the machine that can reach `127.0.0.1` and thus the companion. |
| **Shoulder / screenshot** | Whatever the UI renders on screen, including into a screenshot pasted into a bug report. |

Explicitly **out of scope**: an attacker with the operator's unlocked
browser profile, and a malicious NIP-07 signer extension the operator
installed. Both already hold the assets.

---

## 3. Trust boundaries and their controls

| # | Boundary | Crossing data | Receiver-side control |
|---|---|---|---|
| B1 | page DOM → content script | captured HTML/text | Readability + Turndown; handlers return plain data, never DOM or code |
| B2 | page MAIN world → content script | NIP-07 `postMessage` replies | **Unguessable request id; returned event must match the requested pubkey/kind/tags/content and pass BIP-340 verification** (`content/nip07-client.js`) |
| B3 | page MAIN world → content script | `xr:apihook:event` GraphQL captures | shape-checked in `shared/api-hook-buffer.js` — **see gap G1** |
| B4 | extension page ↔ service worker | `xray:*` runtime messages | typed dispatch, one handler per type — **see gap G2** |
| B5 | relay → extension | signed events | id-hash + BIP-340 verified at one choke point before storage or render |
| B6 | imported file → storage | backup / case bundle / entity sync | shape validation; `local_keys` **never** accrues on merge (`MERGE_EXCLUDED_KEYS`); import verifies rather than trusts |
| B7 | captured content → LLM prompt | article text; since UA.1 also PRIOR MODEL OUTPUT — the cached article extract's claim paraphrases ride the Suggest call as the SUPPLIED CLAIM INDEX (and the extract cache is merge-importable across B6) | attacker-authored by definition; grounding rules treat model quotes as search keys, never evidence; **no model output is ever auto-applied**. Index entries are locally-minted C-refs + whitespace-collapsed 200-char single lines, capped at 200 entries; the response's claims category is force-filtered off, `claim_refs` resolve only against the local ref set (unknown refs ignored), and every artifact still passes the human Accept |
| B8 | LLM → extension state | proposals, briefs | every suggestion is human-accepted; nothing durable without an explicit Accept |
| B9 | extension → cloud provider | prompts, audio, API keys | user-initiated only; keys memory-only in the companion child process, never written to its disk or logs |
| B10 | extension → companion | transcription jobs | pinned to `127.0.0.1`/`localhost`; optional shared token on every path except `/health` |
| B11 | storage → screen | keys and tokens | presence-only rendering; credential inputs are `type="password"` and never repopulate a secret into a visible field |

---

## 4. Standing invariants

- **Receiver-side validation.** Data crossing a boundary is
  attacker-controlled until validated *at the receiving end*. A
  sender-side sanitizer is a courtesy, not a control.
- **Custody.** `local_primary_identity` is stored outside the entity
  key registry, so exporting entity keys can never leak the operator's
  `nsec`. Guard-tested.
- **Keys never in artifacts.** No key material in logs, journal
  entries, issues, commits, test fixtures, or error strings. Test keys
  are generated at test time.
- **Loopback pinning.** The companion client only ever talks to
  `127.0.0.1`/`localhost`.
- **No observation of the operator.** No telemetry, no analytics, no
  usage measurement — refused, not deferred. The tool must not watch
  its user's investigations.
- **Nothing model-produced becomes durable without a human accept.**

---

## 5. Known gaps

Recorded honestly; each is either scheduled in `docs/ROAD_TO_1_0.md` or
accepted with its consequence stated.

- **G1 — the `xr:apihook:event` channel is unauthenticated.** Any script
  on Facebook, Instagram or YouTube can post a forged capture envelope
  that the content script will buffer. Impact is bounded (it corrupts a
  capture the operator is about to review, rather than reaching keys or
  storage directly), but the fix is cheap: a per-page token minted in
  the existing configure envelope. *Scheduled, T2.*
- **G2 — `xray:forward:*` is an untyped passthrough.** One wildcard
  branch in the service worker forwards any message type to the active
  tab, serving a surface removed in 2026-06. It is the single hole that
  makes "exactly one handler in exactly one context" unenforceable.
  *Scheduled for replacement with a typed message, T3 kill list.*
- **G3 — CSP is stripped globally.** `rules/csp-strip.json` rule 1
  removes `Content-Security-Policy` on **every page on every site**,
  while three documents describe it as YouTube-scoped. Whether it is
  still needed at all must be re-derived empirically before it is
  scoped or retired — not argued. *Scheduled, T2.*
- **G4 — full backups contain the operator's `nsec` in cleartext.** A
  recorded, deliberate decision (a recovery artifact that omits your
  identity is not a recovery artifact), but it means the routine
  "download a backup" step drops an unprotected key in Downloads. The
  mitigation is a **key-free share export** so the sharing path and the
  recovery path stop being the same file. *Scheduled, T1 follow-up.*
- **G5 — case bundles carry entity private keys by design.** Sharing
  one grants co-signing authority for those entities. Documented at the
  top of `case-bundle.js`; the confirm dialog must state the entity and
  key counts before export. *Scheduled, T6.*
- **G6 — no passphrase encryption** on bundles or backups. NIP-44 v2 is
  already in the tree if a later release wants it. *Accepted for 1.0;
  superseded in practice by G4's share export.*
- **G7 — prompt injection through captured content is possible by
  construction.** The reversed-table attack (Phase 18 C5) proved it.
  Countered by never auto-applying model output and by quote grounding,
  not by trying to sanitize adversarial prose.

---

## 6. Changes recorded here

| Date | Change |
|---|---|
| 2026-08-09 | Document created (T2). NIP-07 return path hardened: unguessable ids, request/response equality checks, BIP-340 verification (B2). `nip04Encrypt`/`nip04Decrypt` removed from the bridge — unreachable from the client, callable by any page. `web_accessible_resources` entry for `nip07-bridge.js` removed: no `getURL` call site, and it let any site fingerprint the extension by its stable ID. `__xrApiHookSetPatterns`/`__xrApiHookMatch` removed from the MAIN world. |
| 2026-08-09 | `local_keys` excluded from `mergeBackup` accrual (B6) — importing a colleague's file no longer installs their signing keys. Companion auth-token field made `type="password"` (B11). |
| 2026-08-12 | UA.1 (One Article Pass): B7 row extended — the cached corpus extract (prior model output, merge-importable via B6) now feeds the Suggest prompt as the SUPPLIED CLAIM INDEX, with the controls listed on the row. Map-pass spend gate relaxed `corpusGate`→`assistGate` (llmAssist + key, no `caseSynthesis`): exact parity with `xray:llm:suggest`'s existing consent level, same user-click trigger, not page-forgeable (no `externally_connectable`; web pages cannot send `chrome.runtime` messages). New model-output field `claim_refs` crosses B8 as entity→claim links; receiver inverts against the local ref set only and unknown refs are dropped. |
