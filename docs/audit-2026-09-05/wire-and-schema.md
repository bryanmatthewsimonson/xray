# Wire-and-schema lens — fresh-eyes audit of X-Ray (2026-09-06)

Discipline run: `ecosystem-pm` Protocol (kind census, classification, parity, degradation, replaceable-citizenship) + `schema-evolution` Protocol (ladders, fixtures, imports, journal provenance) over the whole tree at origin/main c1e652c, plus the three wire-relevant open PRs (#368, #324, #370). Everything below is `file:line` on that tree unless marked as a doc cite.

## Verdict

The wire is the best-engineered part of X-Ray and the part least likely to be what the maintainer means by "a mess". Every emitted addressable kind has a recomputable `d`, the audit family carries run identity in its `d` so relay latest-wins cannot destroy history (NIP_DRAFT.md:462), verify-on-ingest is real, the kind-3 mirror does fetch-and-union (SMOKE 25.v), the kind schedule in CONSTITUTION Art. 10 is guard-tested for its negative half, and the Phase-9a scaffold was retired with the reserved/retired distinction stated correctly (JOURNAL 2026-08-09). All three open wire-relevant PRs carry the mandatory `Wire format:` callout. That discipline is genuinely working and should be kept exactly as is.

What is NOT working is the record. ROAD_TO_1_0 B16 is a month old and still open on its substance: kind 30041 (third parties' comment text republished under the user's key) and kind 30078 (entity sync) have no NIP_DRAFT section at all; kinds 30060/30061 are `active` in Art. 10 with no emit path anywhere in `src/`; kind 5 deletion requests and kind 1 mention notes are emitted and absent from the schedule; the `x` tag carries two incompatible meanings on the same kind and only one is documented; the 30023 `d` derivation (`sha256(url).slice(0,16)`, unnormalized) that every other coordinate hangs off is documented nowhere; and the guard that would have caught all of this (emit set == schedule) was specified in B16 and never written. A second client cannot be built from NIP_DRAFT.md today, which by ecosystem-pm's own first principle 3 means the format is "an implementation detail wearing a spec's clothes".

On the persisted side the picture inverts: the shapes are well-designed (append-only ladders, the journal v1→v2 migration is a real seeded-database test, mergeBackup's four rules are written down and pinned by 14+ tests, credential exclusion is a class not a string) but the fixture discipline schema-evolution Standard 3 demands does not exist. `tests/fixtures/` contains one normalizer-parity JSON and two PDF stubs — zero persisted-shape fixtures, zero golden signed events. audit-cache is at v7 with seven rungs and not one upgrade-from-v(n) test; archive-cache is at v3 and its v2 rung mints five dead stores on every fresh profile forever (JOURNAL 2026-08-09 records this as a deliberate deferral). A top-to-bottom refactor of the kind the maintainer is contemplating would today be flying blind on exactly the thing that cannot be re-created: the casework corpus and the already-signed events. The fix is cheap and mechanical and is the first thing any refactor branch should land.

## What is good (KEEP)

- **Recomputable `d` on every addressable kind, with the time-series constraint on audit kinds.** NIP_DRAFT.md:461-462, :519; `audit/builders.js` derives `mod:`/`agg:`/`pred:` from run identity. This is the single design decision that makes relay latest-wins safe. KEEP verbatim.
- **Reserved-vs-retired distinction in Art. 10** (CONSTITUTION.md:427-441) and the negative guard (`tests/constitution-guards.test.mjs:201-233`). Retired = events exist, keep parsers; reserved = never emitted, no read path. Correct and rare.
- **The `Wire format:` PR callout is honored in practice** — #368, #324, #370 all carry it (PR bodies fetched 2026-09-06). Standard 1 works without a CI grep; graduate it anyway (cheap).
- **Kind-3 fetch-and-UNION** (`follow-publish.js`, SMOKE 25.v) — the correct replaceable-event citizenship precedent.
- **Kind-1 mention notes / kind-0 profiles / kind-1985 mirrors as the graceful-degradation story** (NIP_DRAFT.md:67-93, :1178-1192). A stranger's client renders something sensible for every X-Ray artifact that matters.
- **Append-only IDB ladders with frozen rungs** — `audit/audit-cache.js:110-179`, `archive-cache.js:161-211`, `event-journal.js:118-144`. Nobody has edited a frozen rung; JOURNAL 2026-08-09 explicitly chose not to when tempted.
- **The journal v1→v2 migration test seeds a REAL v1 database** (`tests/event-journal-migration.test.mjs:49-86`). This is the template every other ladder should copy.
- **mergeBackup semantics are written down** (JOURNAL 2026-07-25, `backup.js:37-52`) and pinned (`tests/backup-merge.test.mjs`, 16 tests): content-only, local-wins-by-id, nothing-deleted, unknown-shapes-keep-local, `local_keys` never accrues (`backup.js:70`).
- **Credential exclusion as an imported class** (`backup.js:100-105`, guarded by `tests/backup-hygiene.test.mjs:83-100`) and the `xrayVersion`/`dbVersions`/`shareable` stamps with a newer-than-understood refusal (`backup.js:18-28`, tests :157-187). ROAD_TO_1_0 B3/B4 CLOSED.
- **Archive eviction is no longer automatic and `unlimitedStorage` is requested** (`archive-cache.js:33-52`, `manifest.json:45`). B1 CLOSED.
- **Row normalizers owned by the owning module and applied on both restore and merge** (`backup.js:84-98`) — schemas are never reinvented in the importer.
- **Workspace namespacing with zero migration** (`workspace-keys.js:67-69`: default workspace == bare keys/DB names). The cheapest possible multi-tenancy; keep.
- **`chrome.storage.session` for the capture handoff and the lens cache** (`session-articles.js`, `lens-engine.js:336-349`) — ephemeral state kept out of the durable store.

## Grandfathered

- **Five dead object stores minted at archive-cache v2 forever** (`archive-cache.js:169-201`: annotations/factchecks/ratings/helpfulness/trust_graph). Grandfathered by the Phase-9a scaffold (spring 2026) whose builders K1 retired 2026-08-09; JOURNAL 2026-08-09 chose to leave the rung untouched. Premise gone; the rung is frozen history and correct to keep on the UPGRADE path, but a fresh install should not mint them (see WIRE-08).
- **`pending-suggestions` store (audit-cache v4)** — its producer (park-proposals-after-import) was retired in UA.3 (CLAUDE.md, 2026-08-12); no reader outside `audit-cache.js` (`grep` 2026-09-06). Same disposition as above.
- **`entity_fact_dismissals` in WORKSPACE_CONTENT_KEYS** (`workspace-keys.js:33`) — retired with the fact layer 2026-07-20, kept "so workspace clears still purge legacy data". Reasonable; becomes dead at a 1.0 fresh-install boundary.
- **Kinds 30060 (DossierSnapshot) and 30061 (AuditDispute) as `active`** (CONSTITUTION.md:418). Built and parsed (`audit/builders.js:919-1160`), never emitted — no caller outside the builder module. Grandfathered by the Phase-13 design (June 2026) which specified the family's full shape up front; the wire-format-only decision is recorded in NIP_DRAFT.md:1305 but the schedule was never reconciled. Fresh eyes: these are RESERVED by Art. 10's own definition.
- **Reserved-kind full specifications kept inline in NIP_DRAFT** (30050 :143, 30051 :205, 30052 :269, 9803 :298, 30053 :332 — ~220 lines). Kept under Art. 3 (exposure never deletion), which is right; but a second implementer reads five specs for kinds that never existed before reaching the ones that do. Move to an appendix; nothing is lost.
- **Two `preferences._migrations` entries** (`storage.js:175-220`, dated 2026-04-20 and 2026-05-01). Correct idempotent design; the offchain.pub one is a fossil whose premise (a WoT relay in the default list) is gone.
- **The v4-compat `Storage.entities` / `Storage.articleCache` stubs** (`storage.js:354-360`, :408-412) — K14, half-done; JOURNAL 2026-08-09 found `entities` is a runtime-overwritten null-object that `event-builder.js` reads, so deletion is not a grep. Still grandfathered by the userscript port.
- **`storeFirstPublish` default OFF** (`feature-flags.js:203-212`). Grandfathered by the 2026-08-02 decision "smoke is sufficient, flip early"; T3 recommends default-on and the flag dropped; the journal v2 migration already ran on every profile. The flag-off path leaves the journal an incomplete record of what was signed (`publish-gate.js:102-141`: only `legacyJournalOnSuccess` sites journal).
- **The `x` tag as the universal join** — grandfathered by Phase 13.4 (June 2026) when it meant one thing (own-body hash). Phases 23 and EP.4 reused it for member hashes (`corpus-publish.js:427`, `entity-page-publish.js:163`). The premise "x == this event's body" is no longer true on kind 30023.

## Garbage

- **No persisted-shape fixtures at all** — `tests/fixtures/` = `normalizer-parity.json`, `real-pdf-engine.mjs`, `stub-pdf-engine.mjs`. schema-evolution Standard 3 is unmet for every store and every kind. Not a thing to delete; a hole to fill (WIRE-05).
- **Unclassified storage keys**: `forensic_baselines` (`forensic-model.js:36`), `owned_keys_manifest_hash` (`reader/index.js:7652,7674`), `xray:audit:draft:<hash>` (`reader/index.js:4383`, `audit/corpus-audit.js:24`), `xray:transcriber:engine`, `xray:transcriber:assemblyai:key`, `xray:transcriber:deepgram:key`, `xray:diagnostics` — in neither `WORKSPACE_CONTENT_KEYS` (`workspace-keys.js:16-40`) nor `WORKSPACE_KEEP_KEYS` (`identity-profiles.js:49-62`). The pin tests pin the two lists exactly (`tests/identity-profiles.test.mjs:48-89`) but nothing asserts every key the code writes is on one of them. `forensic_baselines` is per-case content living un-namespaced: a second workspace reads the first's baselines (the 2026-07-19 incident class).
- **`Storage.articleCache` stub** — pure dead code (K14, open).
- **`xray-audit-ledger/1` as a separate export format** (`options/index.js:1280`) — a strict subset of the backup's `xray-audits` dump with its own envelope and no version gate on import (`audit/import.js:160` accepts `xray-auditor-import/unknown`). One of six interchange envelopes (WIRE-07).

## Findings (ranked by harm)

### WIRE-01 — Kind 30041 republishes strangers' comment text under the user's key with no wire documentation and no flag
- **Evidence:** `event-builder.js:807-856` (builder: comment text, author handle, profile URL, platform, reply-to); emit at `reader/index.js:6318` behind a per-publish `includeComments` checkbox (`:6281-6283`), not a feature flag; `grep -n 30041 docs/NIP_DRAFT.md` → no section; CONSTITUTION.md:415 lists it `active`; the 30041/NKBIP-01 collision is recorded nowhere (`grep NKBIP docs/JOURNAL.md` → nothing).
- **Claim:** A non-technical researcher who ticks "include comments" signs and permanently publishes other people's words, handles and profile URLs, on a kind number another spec already uses, under a format no one but X-Ray can interpret. That is the wrong default posture for wide release and the wrong documentation posture for a covenant kind.
- **Fresh-eyes action:** Before 1.0 either (a) add the `## Kind 30041 — Captured comment` section (tags as built, `d` = platform comment id, "signer is the capturer, never the commenter" clause, the NKBIP-01 caveat) AND move the opt-in behind a named flag with disclosure text, or (b) make comments local-only at 1.0 (archive them, never publish) and mark 30041 reserved-scaffolded. Recommended default: (b) for 1.0, (a) later on demand — nothing in the group workflow reads 30041 today.
- **Effort:** S (doc) / M (flag + disclosure). **ROAD_TO_1_0:** B16 (open), T3 parity checkbox (open).

### WIRE-02 — The Art. 10 schedule does not equal the emit set, and the guard only checks the negative half
- **Evidence:** emitted-but-absent: kind 5 (`entity-sync.js:483`, `k=30078` deletion), kind 1 mention notes (`mention-notes.js`, documented at NIP_DRAFT.md:67 but no schedule row); listed-active-but-never-emitted: 30060/30061 (`audit/builders.js:919,1060`; no caller outside that file; NIP_DRAFT.md:1305 says "publish paths deferred"); `tests/constitution-guards.test.mjs:201-233` asserts only that retired/free/reserved numbers do not appear. T3's parity checkbox is unchecked (ROAD_TO_1_0.md:869-873).
- **Claim:** Standard 5 makes the table the one place status is stated so subsets cannot drift; it has drifted in both directions, and 1.0 freezes whatever the table says.
- **Fresh-eyes action:** Reclassify 30060/30061 as `reserved — defined, never emitted` (they meet Art. 10's own definition); append rows for kind 1 (mention notes, entity-signed) and kind 5 (deletion requests, scope: the user's OWN 30078 blobs only — the Art. 3 note); extend the guard to the positive half: every `kind:` literal at an emission site appears in the table and has a NIP_DRAFT `## Kind` heading. Better: generate the table from a registry (see Fresh-start).
- **Effort:** S. **ROAD_TO_1_0:** B16 (open).

### WIRE-03 — The `x` tag means two different things on kind 30023 and only one is documented
- **Evidence:** own-body hash on captures (`event-builder.js:182`, NIP_DRAFT.md:1168-1176); cited-member hashes on case briefs (`corpus-publish.js:427`) and entity pages (`entity-page-publish.js:163`) — both ALSO kind 30023, disambiguated only by `t: xray-case-brief` / `t: xray-entity-page` (NIP_DRAFT.md:779 documents the recognizer for entity pages but not the `x` semantics).
- **Claim:** `{"kinds":[30023],"#x":[h]}` — the join every audit kind and the group's clients lean on — returns entity pages and briefs as if they were the article whose body hashes to `h`. A stranger's client following the documented rule renders the wrong object.
- **Fresh-eyes action:** Amend the §x-tag section: "on a 30023 carrying `t: xray-case-brief` or `t: xray-entity-page`, `x` tags are the hashes of CITED members, never of this event's body; consumers MUST filter by `t` before treating `#x` as identity." Additive doc change; already-published events unaffected. Longer term (post-1.0) member refs belong in `a … member` only, which corpus-publish already emits alongside (`:426`).
- **Effort:** S. **ROAD_TO_1_0:** B16 (open).

### WIRE-04 — The kind-30023 `d` derivation is undocumented, unnormalized, and is exactly what PR #368 shows can be chosen by the page
- **Evidence:** `event-builder.js:584-587` `d = sha256(url).slice(0,16)` over `article.url` verbatim; no NIP_DRAFT sentence states it (grep for `sha256(url`/`generateDTag` → only the 30040 rule at :102); `metadata/url-normalizer.js:99` exists but is not applied here; PR #368 diff (`platforms/instagram.js:843`, +`canonicalPostUrl`) fixes a case where `og:url` chose the URL and therefore the coordinate and `r` tag of a signed public event.
- **Claim:** The coordinate space every 30054/30055/30058/30063/30064/30070 `a` tag points into is defined by an unwritten rule over an input each platform handler picks by its own heuristic. A second client cannot recompute a coordinate; a handler bug becomes a permanent wrong address.
- **Fresh-eyes action:** Document the derivation and the metadata-header strip regex in NIP_DRAFT (B16 fix text already says this). Add a per-platform "URL identity" unit rule — the handler returns `canonicalUrl` from the navigated path first (facebook.js:970 and now instagram.js are the pattern) — as a `platforms/` contract test. For #368 specifically: classify as **additive/corrective — no layout change**; already-published IG events whose `d` came from a stale `og:url` are NOT superseded (new coordinate), which is the right outcome; the PR's JOURNAL entry should say so in one line.
- **Effort:** S. **ROAD_TO_1_0:** B16 (open); #368 mergeable (clean).

### WIRE-05 — No golden fixtures for any persisted shape or emitted kind; a refactor has nothing to check against
- **Evidence:** `ls tests/fixtures/` → `normalizer-parity.json`, two pdf-engine stubs. Upgrade tests: journal v1→v2 seeded (`tests/event-journal-migration.test.mjs:49-86`) — the only one; `tests/audit-cache.test.mjs` tests each store's CRUD at v7, never an open-at-v(n)-then-upgrade; `tests/archive-cache.test.mjs` same at v3; `tests/backup.test.mjs:200`, `backup-merge.test.mjs:447`, `backup-hygiene.test.mjs:187` hand-build one old shape each inline. Builder tests (`tests/event-builder.test.mjs` etc.) assert tag presence, never byte-identical output or id recompute against a checked-in event.
- **Claim:** schema-evolution Standard 3 and ecosystem-pm's "already-published events are the first consumers" are both unmet. The maintainer's months-old profile has every historical shape layered inside it; the suite would be green after a migration that strands them.
- **Fresh-eyes action:** Land BEFORE any refactor branch: (1) `tests/fixtures/idb/<db>-v<N>.json` — a dump per shipped version per database, produced once by a script that seeds the historical rung and exports (`backup.js:dumpDatabase` already does the dumping); (2) a generic migration test that, for every fixture, opens it at its version with fake-indexeddb, lets the current module upgrade, and asserts every row is readable through the current API; (3) `tests/fixtures/wire/<kind>.json` — one real signed event per emitted kind (the maintainer's own journal export is the source — `event-journal.js` rows carry the verbatim event), with a test that re-verifies id+sig, parses it with the current parser, and re-builds it from the parsed form to byte identity where the builder is deterministic; (4) `tests/fixtures/backup/xray-backup-1-<version>.json` and a round-trip test (import → export → invariants). Then the CI rule schema-evolution S3 names: a diff touching any `DB_VERSION` without a new fixture fails.
- **Effort:** M. **ROAD_TO_1_0:** schema-evolution appendix "nothing records what version wrote a record" — the stamps landed (T1 done); the fixture corpus did not (new).

### WIRE-06 — Workspace content keys exist outside the classification lists, so they leak across workspaces and are never merged or reset
- **Evidence:** `forensic_baselines` (`forensic-model.js:36`, per-(subject,source) baselines — casework content), `owned_keys_manifest_hash` (`reader/index.js:7652`), `xray:audit:draft:*` (`reader/index.js:4383`, paid module results) are absent from `WORKSPACE_CONTENT_KEYS` (`workspace-keys.js:16-40`); `Storage.mapKey` (`storage.js:51-54`) namespaces only listed keys; `mergeBackup` accrues only listed keys (`backup.js:48-52`); `resetWorkspace` clears only `WORKSPACE_CLEAR_KEYS`. No test asserts "every key written under `src/` is on exactly one list".
- **Claim:** A researcher with two case workspaces sees case A's forensic baselines in case B (the 2026-07-19 "unscoped cache resurfaced the previous project's corpus" class, on a content key this time); a colleague's baselines never merge; a reset leaves them behind. Cross-store invariant assumed, not enforced (schema-evolution S9; JOURNAL 2026-07-25 names this defect class).
- **Fresh-eyes action:** Add `forensic_baselines` to `WORKSPACE_CONTENT_KEYS` (with a one-time migration that leaves the bare key as the default workspace's — zero-cost by the 28.1 rule); decide `owned_keys_manifest_hash` (content: it is a per-identity publish stamp) and the audit drafts (content, but prefixed — either list the prefix or move drafts into `xray-audits`); add a source-grep guard: every string literal passed to `Storage.get/set` or `storage.local.get/set` in `src/` appears in CONTENT ∪ KEEP ∪ CREDENTIAL ∪ an explicit EPHEMERAL allowlist.
- **Effort:** S. **ROAD_TO_1_0:** not listed (new; DEFECT).

### WIRE-07 — Six interchange envelopes, one of which hands out private keys per click, with no shared version gate
- **Evidence:** `xray-backup/1` (`backup.js:107`, stamped, gated); shareable copy (same format, `shareable: true`); `xray-case-bundle` v1 (`case-bundle.js:25-26`, carries entity PRIVATE KEYS by design, header :1-14); `xray-audit-ledger/1` (`options/index.js:1280`; importer accepts `xray-auditor-import/unknown`, `audit/import.js:160`); entities JSON import (sidepanel); the signed-event journal export (`event-journal.js:14-16`); `case-export.js` (no format stamp found). Only backup and bundle refuse newer versions.
- **Claim:** For the group workflow the FILE is the collaboration surface. Six shapes with different trust properties (one contains nsecs) and different version discipline is a support burden and a foot-gun for non-technical users ("which file do I send?").
- **Fresh-eyes action:** At 1.0 collapse to ONE envelope `xray-export/2 { format, xrayVersion, dbVersions, contents: 'workspace'|'shareable'|'case'|'audit-ledger'|'events', payload }` with the existing gates, and ONE importer that dispatches on `contents` and applies the same normalizers. Keep `xray-backup/1` and `xray-case-bundle/1` readable forever (Standard 6). Whether the case bundle should carry private keys at all is a maintainer question (Q4 below).
- **Effort:** M. **ROAD_TO_1_0:** B14/T6 adjacent (group surfaces); B3 closed for the merge path only.

### WIRE-08 — The IDB ladders can only be collapsed at a fresh-install boundary, and nothing says which rungs a fresh install should skip
- **Evidence:** `archive-cache.js:169-201` mints five stores no code reads (JOURNAL 2026-08-09: deliberate deferral); `audit-cache.js:139-143` mints `pending-suggestions` whose producer retired in UA.3; five databases (`workspace-keys.js:44-56`), two of which are rebuildable caches with no ladder (`portal-cache.js:71-88`, `network-cache.js:74-91`).
- **Claim:** Frozen rungs are correct on the UPGRADE path and wasteful on the FRESH-INSTALL path; the two paths are the same code today, so every fresh 1.0 install inherits five months of scaffolding. Nothing is at risk now; the cost is that the ladder becomes a one-way ratchet the maintainer is already reluctant to touch.
- **Fresh-eyes action:** Adopt the two-path rule explicitly: `if (oldVersion === 0) { createCurrentSchema(); return; }` at the top of each `onupgradeneeded`, followed by the frozen rungs for `oldVersion >= 1` — fresh installs mint only live stores, upgrades keep history. Delete dead stores from existing profiles only via a journaled step with the re-derivability statement (they are empty, so "nothing to re-derive" IS the statement). At 1.0 consider merging `xray-portal` + `xray-network` into one derived-cache DB (same shape, same lifecycle) — a deleteDatabase-and-rebuild, not a migration.
- **Effort:** S (rule) / M (merge caches). **ROAD_TO_1_0:** K1 (half: stores still minted).

### WIRE-09 — `storeFirstPublish` is still off, so the journal — the only local golden record of everything signed — is incomplete
- **Evidence:** `feature-flags.js:203-212` default false; `publish-gate.js:102-141` flag-off journals only where `legacyJournalOnSuccess` is passed (e.g. `entity-sync.js:379`; the kind-5 path passes `ledger: null` and journals nothing flag-off); EVENT_STORE_DESIGN.md:512/568 "smoke is sufficient, flip early"; T3 checkbox "decide storeFirstPublish (recommend: default on, flag dropped)" unchecked; the v2 migration already ran on every profile (`event-journal.js:118-144`).
- **Claim:** The design's four promises (republish without re-sign, durability, honest reconcile, outbox) hold only for events that happened to go through a legacy-journaling site. For a NIP-07 user a lost signature is unrecoverable. Also relevant to WIRE-05: the journal is the natural source of golden wire fixtures, and it is partial.
- **Fresh-eyes action:** Flip default on, run the §12 smoke rows once, drop the flag in the following release. This is a publish-PATH change, not a wire change: classification none.
- **Effort:** S. **ROAD_TO_1_0:** T3 (open), B2 (closed for the three surfaces; `confirmedOk` now adopted at 8 call sites).

### WIRE-10 — Kind 10002 relay-list push is a blind overwrite; kind 3 is not
- **Evidence:** `entity-sync.js:362-385` builds and publishes with no fetch-current; `network/index.js:719` + `follow-publish.js` fetch-and-union for kind 3 (SMOKE 25.v). Standard 7 names 0/3/10002 as co-authorable.
- **Claim:** A user running another NOSTR client on the same nsec loses that client's relay list the first time they press Push. Low frequency for this audience, high surprise.
- **Fresh-eyes action:** Copy the kind-3 pattern: fetch current 10002 (`fetchRelayList` at `:391` exists), union, publish. Additive; no format change.
- **Effort:** S. **ROAD_TO_1_0:** B17 (half open — kind 3 fixed, 10002 not; the feed's silent-drop half not re-verified here).

### WIRE-11 — Kind 30070 is `active` with a DevTools-only gate and has never been observed on a public relay
- **Evidence:** `feature-flags.js:214-227` default off, no Options control (T3 second checkbox unchecked; ROAD_TO_1_0 B10); the only walk is the headless loopback one (JOURNAL 2026-08-02; BRIEFING addendum — built, not sent); `extraction-publish.js:63` EXTRACTION_ANALYSIS_KIND.
- **Claim:** Art. 10 says `active`; reality is "specified, builder tested, never emitted to the world". That is a legitimate state, but the table has no word for it, so it is indistinguishable from 30023.
- **Fresh-eyes action:** Give Art. 10 a `status` vocabulary that matches reality: `active` / `active-unwalked` (or `gated`) / `reserved` / `retired` / `free`, and require the walk-ledger date for `active`. Disposition for 1.0: ship 30070 as gated-with-an-Options-control, OR hold it `reserved` until the first real publish is walked. Recommended default: hold — the maintainer's own 2026-07-29 posture says turning it on "is a decision about disclosure".
- **Effort:** S. **ROAD_TO_1_0:** B10 (open), B16 (open).

### WIRE-12 — 30058/30059 emit only inside the audit batch; 30060/30061 never — the audit family's wire surface is half real
- **Evidence:** `audit/publish-batch.js:100-297` builds 30056/30057/30058/30059; no caller for `buildDossierSnapshotEvent`/`buildAuditDisputeEvent` outside `audit/builders.js`; NIP_DRAFT.md:728/774 route Phase-15 disputes onto 30061 with `target-kind` extensions that nothing can emit.
- **Claim:** Two numbers are spent on an escalation path (disputes, right-of-reply) with no authoring UI, and the truth family's dispute story is documented against it. For wide release this is a promise in the spec that the product cannot keep.
- **Fresh-eyes action:** Reserve 30060/30061 (WIRE-02) and strike the "disputes reuse 30061" sentences in the 30063/30064 sections down to "deferred; see reserved 30061". If disputes matter for group work (they do — adversarial review is the whole point), build the authoring UI post-1.0 and re-activate then.
- **Effort:** S. **ROAD_TO_1_0:** ecosystem-pm appendix (the speculative-twin finding), B15 adjacent.

### WIRE-13 — NIP_DRAFT.md cannot pass the second-client test and is too long to be maintained by hand
- **Evidence:** 108 KB; 30041/30078 absent; five reserved-kind full specs inline (:143-364); the reference-implementations paragraph (:1305) is a 1,900-character sentence carrying per-kind status that belongs in a table; `d` for 30023 absent; `x` dual meaning absent.
- **Claim:** Standard 3's bar ("reconstruct a byte-compatible event and recompute its d from the section alone") fails for the flagship kind. Doc drift is structural: the doc is the only place the kind inventory lives, and it is edited by hand per PR.
- **Fresh-eyes action:** Generate the parts that can be generated (see Fresh-start: `wire/kinds.json` → Art. 10 table + NIP_DRAFT index + status paragraph + guard), keep prose per kind hand-written, move reserved specs to an appendix, add the two missing sections.
- **Effort:** M. **ROAD_TO_1_0:** B16 (open), K13 adjacent (doc consolidation).

### WIRE-14 — Extraction-record and cache-key versioning lives in prompt-version strings, not in the persisted record
- **Evidence:** `corpus-prompts.js:107-108` `corpus-v9`; `map-artifacts.js:187` stamps `promptVersion` per merge; `article-extractions` rows carry no `schemaVersion` of their own (`map-artifacts.js:95-160` `emptyRecord`/`normalizeExtractionRecord`); archive `articles` rows likewise (`archive-cache.js:20-31`). The backup stamps `dbVersions` (DB-level) but rows are unversioned.
- **Claim:** After 1.0 a normalizer cannot branch on row vintage; today it copes by being maximally tolerant (`normalizeExtractionRecord` coerces everything), which is fine until a field's MEANING changes.
- **Fresh-eyes action:** Stamp `v: N` on every row type written after 1.0 (additive; absent == 0); keep normalizers tolerant. Cheap insurance; do it in the same PR as the fixture corpus.
- **Effort:** S. **ROAD_TO_1_0:** schema-evolution appendix (record-vintage stamp — half done at the file level).

### WIRE-15 — PR #324 changes who can create entities (a persisted-record precondition), and its base is 164 commits stale
- **Evidence:** PR body "Wire format: none" (correct — no builder change); `entity-model.js` diff removes the random-key else-branch so `derived_from` is always non-null for NEW records; `case-create.js` pre-flights the refusal; mergeable_state `dirty`; JOURNAL +65 lines.
- **Claim:** No storage-shape change and no wire change; the persisted CONSEQUENCE is that every post-merge entity is derivable from the primary — good for 1.0 (recoverability). Risk is only the stale base: `entity-model.js`, `storage.js`, `signer.js` have all moved since 2026-08-11.
- **Fresh-eyes action:** Rebase, re-run the fixture round-trip (once WIRE-05 exists) to confirm legacy random-keyed entities (`derived_from: null`) still load and sign; classification: none (wire), none (schema), behavior-changing (soak rule applies).
- **Effort:** S. **ROAD_TO_1_0:** T2 (NIP-07 identity split — closed by JOURNAL 2026-08-10; this PR is its follow-through).

### WIRE-16 — PR #370 (marginView) has no wire or storage footprint and should not be on the wire-and-schema critical path
- **Evidence:** PR body "Wire format: none"; diff adds `annotations/{notes,collect,segments}.js` — "computed on read, never persisted, never on the wire" (`notes.js:1-4`); the only shared change is one flag key (`feature-flags.js:+229-234`); grep of the `reader/index.js` diff for `Storage.set|storage.local.set|indexedDB` → nothing.
- **Claim:** From this lens the branch is safe to merge or park at will; the maintainer's "testing stuff I don't care about" cost is entirely UX, not data.
- **Fresh-eyes action:** None for this lens. (The flag adds a 21st `FLAGS_DEFAULTS` key; the flag ledger T3 asks for is still unwritten.)
- **Effort:** — . **ROAD_TO_1_0:** T3 flag ledger (open).

### WIRE-17 — The never-merge firewall's "wire arm" is number bookkeeping, and its provenance is an agent's generalization
- **Evidence:** CONSTITUTION.md:301-304 "The firewall's wire arm: kind 30066 stays free, kind 30065 stays reserved, and retired kinds are never reused"; the actual signal-separation shape (no `stance`/`rating-value`/`L`/`l` on audit kinds; no score on 30063/30064) is enforced by SMOKE rows 13.18/14.20/OP.h and the vocabulary grep, not by that sentence; ecosystem-pm Standard 8 restates the separation correctly ("the firewall is signal separation, not a score ban"). BRIEFING §governance 5–7; PR #366's F-inventory grades most constitutional generalizations E5.
- **Claim:** Keeping a number free is not a firewall; it is a reservation. Conflating the two is one of the "firewalls everywhere" the maintainer named. The real wire firewall (Standard 8) is good and should stay; the Art. 6 sentence should say what it actually guards.
- **Fresh-eyes action:** Question for the maintainer (Q1 below), not a ruling. If accepted: Tier-appropriate amendment rewording Art. 6's wire arm to "no kind imports a sibling family's numeric or label vocabulary (guard-tested by the vocabulary grep and the fixture tolerance test); numbers are reserved per Art. 10", leaving 30065/30066 untouched (no renumbering).
- **Effort:** S. **ROAD_TO_1_0:** not listed; PR #366 questionnaire (open).

### WIRE-18 — Reserved-kind specs and the 30040/30041 NKBIP-01 collision decision are undocumented as decisions
- **Evidence:** NIP_DRAFT.md:137-141 caveat "a pre-submission question"; `grep NKBIP docs/JOURNAL.md` → nothing; T3 checkbox "record the NKBIP-01 keep decision with the disambiguator" unchecked.
- **Claim:** 1.0 answers this permanently by inaction. Renumbering is breaking against published events (B16's own fix text); the only remaining move is to record "kept, disambiguated by `client: xray` + required tags" so a dual implementer knows.
- **Fresh-eyes action:** One JOURNAL entry + two sentences in NIP_DRAFT. Pure record.
- **Effort:** S. **ROAD_TO_1_0:** B16 (open).

### Kind census table (disposition for 1.0)

| Kind | Emitter | Gate | Public-relay evidence | Foreign consumer | 1.0 disposition |
|---|---|---|---|---|---|
| 30023 article | event-builder.js:130 | none | strong (JOURNAL 2026-07-17, 2026-04-24; SMOKE 2.8) | generic clients render | ship |
| 30023 case brief | corpus-publish.js:453 | reachable only via caseSynthesis brief | SMOKE 23.h (walked 2026-07-20 wave) | generic | ship (document `x` = members) |
| 30023 entity page | entity-page-publish.js:165 | entityCorpusPublishing | SMOKE P28.j | generic | ship (document `x` = members) |
| 30040 claim | event-builder.js:643 | none | strong | none non-X-Ray | ship (record NKBIP keep) |
| 30041 comment | event-builder.js:807 | per-publish checkbox | SMOKE §5 batch rows | none | local-only at 1.0 or gate+document (WIRE-01) |
| 0 entity profile | event-builder.js:594 | entityCorpusPublishing | SMOKE 4.8, 19.j, 24.c | generic | ship |
| 1 mention note | mention-notes.js | entityCorpusPublishing | SMOKE 17.5 | generic | ship; add Art. 10 row |
| 3 follow mirror | event-builder.js:746 | followListPublishing | SMOKE 25.u/v (no dated ledger row) | generic | ship (opt-in) |
| 5 delete (own 30078) | entity-sync.js:483 | user action | none recorded | generic | ship; add Art. 10 row with Art. 3 scope |
| 10002 relay list | event-builder.js:727 | user action | JOURNAL 2026-04-22 | generic | ship after fetch-and-merge (WIRE-10) |
| 30078 entity sync | event-builder.js:707 | user action | JOURNAL 2026-04-22, 10328 | none (encrypted to self) | ship; add NIP_DRAFT section |
| 32125 entity↔article | event-builder.js:771 | none | documented 2026-07-09 | none | ship |
| 32126 platform account | event-builder.js:907 | platformAccountPublishing | SMOKE KS.2 | none | ship (opt-in) |
| 30054/30055 + 1985 | metadata/builders.js:238,339,368 | assessmentPublishing | Phase 11 walk 2026-07-20 | 1985: generic NIP-32 | ship |
| 30056–30059 | audit/builders.js | epistemicAuditing | Phase 13 walk 2026-07-20 | none | ship |
| 30060/30061 | audit/builders.js:919,1060 | NO EMIT PATH | none | none | retire-to-reserved (never emitted) |
| 30062 + 1985 | metadata/builders.js:614,640 | forensicPublishing | Phase 14 walk | 1985: generic | ship |
| 30063 + 1985, 30064 | truth-builders.js | truthAdjudicationPublishing | Phase 15 walk | 1985: generic | ship |
| 30065 | constant only | reserved | — | — | reserved (guard-pinned) |
| 30066 | — | free | — | — | free (guard-pinned) |
| 30068 CaseBrief | corpus-publish.js:17 | via caseSynthesis | SMOKE 23.h/23.i | none | ship |
| 30069 OwnedKeys | reader/index.js:7652 path | rides entity batch | SMOKE 24.d/24.f | none | ship |
| 30070 ExtractionAnalysis | extraction-publish.js:63 | extractionAnalysisPublishing (DevTools-only) | loopback only (2026-08-02) | none | hold as gated/unwalked (WIRE-11) |
| 1985 xray/review | metadata/builders.js:423 | reviewCoordination (DevTools-only) | none recorded | generic NIP-32 | hold until Options control |
| 30043, 30067 | parsers only | retired | historical | — | retired (keep parsers) |
| 30050–30053, 9803 | none | reserved | none | — | reserved (move specs to appendix) |

### Persisted-shape inventory (what a refactor must preserve byte-for-byte)

- **IndexedDB (5 DBs × workspace suffix `::<wsId>`):** `xray-archive` v3 {articles(keyPath urlHash; idx lastAccessed, publishedToRelay, cachedAt; rows carry `priorVersions[]`), annotations, factchecks, ratings, helpfulness, trust_graph [dead], source_documents(keyPath hash; idx url, fetchedAt)}; `xray-audits` v7 {runs(id; articleHash, runAt), predictions(id; articleHash, resolutionStatus, horizonIso), resolutions(id; predictionCoord), case-briefs(caseId), corpus-extracts(key), pending-suggestions(url) [dead], case-link-suggestions(caseId), entity-pages(entityId), article-extractions(articleHash)}; `xray-events` v2 {published_events(eventId; kind, address, articleUrl, publishedAt, flushState=flush.state)}; `xray-portal` v1 and `xray-network` v1 {events(id; kind, pubkey, created_at, addr), meta(key)} — derived, rebuildable, never backed up.
- **chrome.storage.local (all values JSON strings via the façade):** CONTENT (namespaced per workspace): the 21 keys at `workspace-keys.js:16-40`. KEEP (install-level): the 12 at `identity-profiles.js:49-62`. INSTALL PLUMBING: `workspaces`, `active_workspace`. CREDENTIAL (never exported): `xray:llm:key`, `xray:transcriber:token`, `xray:transcriber:assemblyai:key`, `xray:transcriber:deepgram:key`. UNCLASSIFIED (WIRE-06): `forensic_baselines`, `owned_keys_manifest_hash`, `xray:audit:draft:<hash>`, `xray:transcriber:engine`, `xray:diagnostics`. `preferences` is one blob {default_relays, relays[], signing_method, signing_method_configured, nsecbunker_url, debug, config_overrides, archive_banner_sensitivity, _migrations{drop_offchain_pub, signing_method_default}}.
- **chrome.storage.session:** `xray:article:<uuid>` capture handoff (`session-articles.js`), lens per-capture cache (`lens-engine.js:336`), `xray-figure:*`, `xray:transcribe:job:*` (with `.local` fallback where session is absent).
- **Files:** `xray-backup/1` (+`xrayVersion`, `dbVersions`, `shareable`; `{__xrayBytes}` markers), `xray-case-bundle` v1 (private keys inside), `xray-audit-ledger/1`, journal signed-event bundle, entities JSON, case export.
- **Cache-key vocabularies that are de-facto schema:** `corpus-v9` (`corpus-prompts.js:107`), `hyp-edges-v1`, `claim-links-v1`, lens `1.0`; the `xray-entity-v1` HKDF domain (`crypto.js:182`, `entity-model.js:44`) — changing that string re-keys every derived entity; treat as wire.
- **Byte-for-byte invariants a refactor must not touch:** `generateDTag` (`event-builder.js:584`), `articleHash` normalization + `stripMetadataHeader` (`audit/article-hash.js`), every `d` formula in NIP_DRAFT §Kind sections, claim id `claim_<sha256(url|text)>.slice(0,16)` (`claim-model.js:69-70`), `urlHash` (`archive-cache.js:22`), `replaceableKey` (`nostr-events.js`), the HKDF domain string, `caseBriefDTag`, `makeCommentDTag`, the 32126 `d` (`platform-account.js:107`), the JSON-string encoding of façade values (`storage.js:96`), and the `__xrayBytes` marker.

### Where ladders can be collapsed at 1.0

- **Fresh-install path:** every `onupgradeneeded` gets an `oldVersion === 0` branch that mints only live stores (archive: articles + source_documents; audits: runs, predictions, resolutions, case-briefs, corpus-extracts, case-link-suggestions, entity-pages, article-extractions; events: published_events with flushState). Version numbers do NOT reset — a fresh install opens at the same `DB_VERSION` so an upgrade from any older version still runs the frozen rungs.
- **Upgrade path:** rungs stay frozen. Dead-store deletion (`deleteObjectStore` for annotations/factchecks/ratings/helpfulness/trust_graph/pending-suggestions) is a NEW rung with the re-derivability statement "stores verified empty — nothing to re-derive" and a fixture test seeded with a v3/v7 dump that has rows in the dead stores, asserting the migration refuses (or exports) rather than drops if any row exists.
- **Never collapse:** `xray-events` (the signatures), `article-extractions` (the map artifacts), `articles.priorVersions`.
- **Merge candidates:** `xray-portal` + `xray-network` → one derived cache (delete-and-rebuild, not migrate).

## Fresh-start design

If I started X-Ray's wire and storage today for non-technical research groups:

1. **One registry, generated everywhere.** `src/shared/wire/kinds.json`: `{kind, name, status: active|gated|reserved|retired|free, flag, family, signal, emitter, parser, nipSection, walkedOn}`. Art. 10's table, NIP_DRAFT's index and status paragraph, the Options flag table, and the constitution guard are all GENERATED from it (`npm run docs:wire`, drift-guarded like `discipline-standards.html`). The emitted-set == registry guard becomes a two-line test. Doc drift on the wire becomes impossible rather than discouraged.
2. **Golden corpus as a first-class test input.** `tests/fixtures/wire/*.json` (one signed event per kind per shipped version, sourced from the maintainer's own journal), `tests/fixtures/idb/*-v*.json`, `tests/fixtures/export/*.json`. Three generic tests: verify-and-parse every wire fixture; open-and-upgrade every IDB fixture; import-export-import every file fixture. A `DB_VERSION` diff without a fixture fails CI.
3. **Fewer kinds on day one.** Ship: 30023, 30040, 0/1/3/10002 (standard), 32125/32126, 30054/30055, 30056–30059, 30062, 30063/30064, 30068/30069, 1985 mirrors. Gated-unwalked: 30070, `xray/review`. Reserved: 30060/30061/30065, 30050–30053/9803. Local-only until documented: 30041. 30078 documented as "own encrypted sync, NIP-78". Same numbers, same events, just an honest status column.
4. **Two IndexedDB databases, not five:** `xray-content` (articles, source docs, audits, extractions, journal — everything backed up) and `xray-cache` (portal + network — never backed up, delete-and-rebuild). Workspace suffixing stays. Migration from the five is a one-time copy at first open of the new build, journaled, with the old DBs left in place for one release (rollback story) then deleted by explicit user action.
5. **One storage-key registry with a classification the façade enforces.** `Storage.set` refuses a key not in CONTENT/KEEP/CREDENTIAL/EPHEMERAL; the classification drives namespacing, backup, merge, reset, and the shareable copy from ONE list instead of four.
6. **One export envelope** `xray-export/2` with a `contents` discriminator; one importer; older envelopes readable forever; private keys travel ONLY in the `workspace` (own backup) contents, never in a `case` bundle — collaborators get shareable bundles and the creator-binding (30069 + NIP-26) does the identity work the shared nsec used to do.
7. **`storeFirstPublish` is not a flag; it is how publishing works.** The journal is the outbox and the golden corpus; the portal reconciles it against relays.
8. **Keep exactly as they are:** the `d` derivations, the audit time-series rule, the kind-3 union, the 1985 mirrors, the `Wire format:` callout, the reserved/retired distinction, the row normalizers, the mergeBackup four rules, the credential class, the version stamps.

## Questions for the maintainer

**Q1. Is "the wire arm of the never-merge firewall = keep 30065 reserved and 30066 free" your rule, or an agent's?**
- Provenance: CONSTITUTION.md:301-304, drafted 2026-07-22 by an agent, ratified by merge (E5 in PR #366's grading). The 30066-free rule came from the moral-lens design (2026-07-03 amendment) as "the lens has no wire kind", which is a local-vs-wire decision, not a firewall. The real wire firewall (no cross-family vocabulary on any kind) is ecosystem-pm Standard 8 and is smoke-walked.
- Recommended default: reword Art. 6's wire arm to name signal separation (Standard 8) and leave number reservation to Art. 10. No renumbering, no guard change beyond the sentence pin.

**Q2. May kind 30041 (captured comments) go local-only for 1.0?**
- Provenance: the comment publish opt-in dates from the userscript port (spring 2026); no design doc argued the wire value of republishing third parties' text; B16 flagged it 2026-08-09; nothing in the group workflow reads it.
- Recommended default: yes — archive comments locally, do not publish at 1.0; mark 30041 reserved-scaffolded with a note that pre-1.0 events exist (so: retired-style read path retained). Re-open when a consumer exists.

**Q3. Should 30060/30061 move from `active` to `reserved` now?**
- Provenance: Phase-13 design (June 2026) specified the whole family up front; the deferral of the dossier/dispute publish paths was recorded only in the NIP_DRAFT reference paragraph.
- Recommended default: yes; it is a table edit plus a guard extension, and it makes the schedule true.

**Q4. Should case bundles keep carrying entity private keys?**
- Provenance: `case-bundle.js:1-14`, Phase 11.8 (June 2026), pre-dating creator binding (Phase 24, July 2026) which was designed precisely so collaborators need not share nsecs.
- Recommended default: at 1.0, the case bundle becomes a shareable (key-free) export; the key-carrying form stays importable forever and is reachable only under an explicit "includes private keys" export with the same typed confirm as restore.

**Q5. Flip `storeFirstPublish` on and drop the flag?**
- Provenance: your 2026-08-02 decision (EVENT_STORE_DESIGN §13 Q2: "smoke is sufficient, flip early"); T3 recommends default-on; the §12 smoke rows have not been recorded in the walk ledger.
- Recommended default: flip on in the next release with the smoke rows walked once; drop the flag the release after.

**Q6. Should Art. 10 gain a `gated`/`active-unwalked` status so 30070 and `xray/review` stop reading as shipped?**
- Provenance: the table's three-state vocabulary predates the DevTools-only gates (B10, 2026-08-09).
- Recommended default: yes, with the walk-ledger date as the promotion criterion to `active`.

**Q7. Is the fixture corpus (WIRE-05) the first PR of the refactor effort?**
- Provenance: schema-evolution Standard 3 (written 2026-08); never executed.
- Recommended default: yes — it is the only thing that lets multiple refactor threads run in parallel without one of them silently stranding the casework DB.
