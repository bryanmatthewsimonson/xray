# Case-bound workspaces — one case, one workspace, one identity

> **Status:** design draft, **2026-07-19**, for maintainer review after
> the Epistack submission. **NOT approved; no slice here is
> deadline-week work.** Successor to
> [`CASE_WORKSPACE_KICKOFF.md`](CASE_WORKSPACE_KICKOFF.md), whose
> analysis this document assumes and does not repeat. Where this
> document and the constitution disagree, the constitution governs —
> [`PHILOSOPHY.md`](PHILOSOPHY.md), `CASE_DOSSIER_DESIGN.md` §2.2 ("no
> case-level score, ever"), `TEAM_CASE_DESIGN.md` §2.1 (the custody
> rule).
>
> **Decisions the maintainer has now made** (2026-07-19, closing part
> of the prior kickoff's §6):
>
> - **Q1 — yes**: `case` means the researcher's investigation
>   workspace, full stop. CW.1 shipped (PR #215); the suggest pass can
>   no longer propose one.
> - **Case-as-signer — conceded/refused**: the case *entity's* key will
>   not sign captured content or judgments (the prior kickoff's §4.2 /
>   §4.4 reasoning stands unchallenged). The requirement behind that
>   proposal survives and governs here: *"I need to easily manage a
>   bunch of different corpuses and I need real boundaries between
>   them and it needs to work well."*
> - The serial workflow (backup → switch profile → fresh workspace) is
>   **rejected as the long-term answer** by lived experience: it is
>   destructive, ordering-sensitive, and leaky (see §1).

## §1. The evidence: boundaries by discipline do not hold

Two incidents, both from real use, both with the documented flow
followed in good faith:

1. **The profile-switch contamination** (prior kickoff §1.4): two
   projects in one workspace under switched profiles; the portal
   unions every `publishedPubkey` into one "me" and the reconcile
   ledgers interlock. Cause: `resolveIdentities()` has no case
   dimension.
2. **The fresh-workspace leak** (2026-07-19): after a by-the-book
   backup → new profile → `resetWorkspace()`, the portal still
   rendered the previous project's entire corpus (13,516 events) under
   the new signer. Cause: the `xray-portal` cache is outside
   `WORKSPACE_DATABASES` (it is a rebuildable cache, so it is excluded
   from backups — and was therefore never cleared), `loadRecords()` is
   identity-unscoped, a failed `clearAll()` was console-only, and any
   still-open portal tab re-saves its stale state into the shared
   cache. Hotfixed same day (`DERIVED_CACHE_DATABASES` cleared on
   reset; loud clear failure) — but the hotfix narrows the trap, it
   does not remove the class.

The lesson that shapes this design: **scoping enforced per read-site
fails open** — every forgotten filter is a leak discovered in
production. A storage boundary fails closed.

## §2. The design in one paragraph

Make the workspace **first-class and N-instance**. A small **workspace
registry** — `{id, label, case_entity_id, identity_pubkey, created}`
per workspace, plus an `active_workspace` pointer — lives *outside*
the boundary (like `identity_profiles` today). Every
workspace-content store is **namespaced by the active workspace id**:
`storage.js` prefixes the `WORKSPACE_CLEAR_KEYS`-class keys, and the
content IndexedDBs *and the derived relay caches* get per-workspace
names. Each workspace is **bound to one case entity** (created inside
it, its project anchor) **and one identity profile** (its signing
primary, from which its entity keys derive). **Switching cases
switches workspace + signing identity + portal scope atomically** —
one action; the ordering mistakes that caused both §1 incidents become
inexpressible. "Start fresh workspace" becomes "create workspace" /
"delete workspace": non-destructive to every other case.

## §3. Constitutional compliance

- **"Lens, not container" (`TEAM_CASE_DESIGN.md` §1) survives — on the
  wire, where it is normative.** Every artifact remains a public,
  signed, content-addressed event; strangers rendezvous at x-hashes
  and coordinates exactly as before; nothing in the *data model*
  carries case membership beyond ordinary tags. The partition is of
  local *working state* — desk drawers, not property rights.
- **The custody rule is untouched.** The case key signs its kind-0 and
  its 32125s, nothing else (CW.5's guard test is a rider here). The
  workspace's *primary* signs judgments, as today.
- **Zero wire-format changes.** No kind, tag, `d`, or content field
  moves. The kind-30069 owned-keys manifest becomes per-corpus *for
  free*: it enumerates `local_keys`, which is namespaced, and each
  workspace publishes under its own primary — the prior kickoff's §4.4
  "fatal irony" (one manifest cryptographically linking every corpus)
  dissolves structurally, with the manifest's shape unchanged.
- **Phase 24 derivation becomes coherent instead of a footgun**: each
  workspace's entity keys derive from its bound primary. The
  derivation root is recorded at create; `restoreDerivedKeys` refuses
  under a mismatched primary (the prior kickoff's CW.4).
- **P9 / append-only:** nothing here mutates or erases published
  history; deleting a workspace is a local act with the same standing
  as today's reset, and its published events remain on relays.

## §4. What changes (the honest list)

| Surface | Change |
|---|---|
| `storage.js` | Key prefixing for workspace-content keys; the single riskiest edit in the design — the canonical source of truth. One-time migration: existing unprefixed data is **renamed** (never copied) into a `default` workspace. Pin-tested like the clear lists. |
| `identity-profiles.js` | Workspace registry + atomic activate (namespace + `local_primary_identity` + portal scope together); reset → create/delete-workspace semantics. |
| IDB naming | `xray-archive` / `xray-audits` / `xray-events` / `xray-portal` / `xray-network` become `<name>::<workspace-id>`. The caches **join the boundary** (supersedes the prior kickoff's open Q7). |
| Side panel / options / portal chrome | A workspace switcher; the active case name always visible — you should never wonder whose data you are looking at. |
| Capture pipeline | Every capture auto-tags the bound case (reusing `addArticlesToCase` verbatim — `context: ''`, alias-root canonicalization). The suggest prompt receives the case frame (name + scope question). |
| Background SW | Re-reads `active_workspace` on every MV3 wake (the existing debug-pref pattern). |
| Backups | Per-workspace backup files (label in filename) + a whole-install export. Old backups import into a fresh workspace. |
| Portal viewer | **"View another archive" npub is fenced as a viewer, never unioned into "me"** — separate list, separate chip color, excluded from reconcile's expected-set. This is the one §1-class vector a namespace alone does not close. |
| Case dossier | A real source manager (search / bulk-add from library / per-row remove / tag-vs-claim membership chips) replacing the current add-sources strip — though under case-bound workspaces it stops being load-bearing, since everything captured in the workspace is already in its case. |

**What does NOT change:** the wire format, the custody rule, signing
semantics, publish paths, `PHILOSOPHY.md`-governed scoring/display,
the judges' read-only viewer flow, `ENTITY_TYPES`.

## §5. Costs, stated plainly

1. **Cross-workspace entity duplication.** Two corpora that both tag
   the same person hold two entity records with two derived pubkeys —
   the prior kickoff's §4.1 fragmentation cost. Measured on the real
   projects it is zero (COVID vs Bricks & Minifigs: 0 shared entities,
   0 shared URLs), and the shipped corpora (COVID / eggs / LHC) are
   disjoint by construction. The cost bites only when **sub-dividing
   one investigation**, so the guidance ships with the feature: **one
   workspace per corpus, not per sub-question.** Cross-workspace
   overlap becomes an explicit, read-only surface (§6 slice 6) that
   renders shared entities as *signal*, never silent leakage.
2. **Per-case identity is Local-mode-only.** NIP-07 exposes one key;
   X-Ray cannot mint or switch keys inside another extension. Explicit,
   documented refusal (prior kickoff §4.3) — a NIP-07 user gets one
   workspace, or switches keys in their signer.
3. **`storage.js` migration risk.** Mitigated by rename-not-copy, a
   pinned before/after test over a synthetic full workspace, and the
   backup-first flow already in the options UI.

## §6. Slices (one PR each, post-submission; branches `claude/case-ws-*`)

1. **28.1 — registry + namespace + migration + switcher.** The core.
   `storage.js` prefixing, IDB renaming, `default`-workspace
   migration, the switcher UI. Everything else stacks on this.
2. **28.2 — binding + guards.** Case entity + identity profile bound
   at workspace creation; atomic activate; derivation-root recording +
   `restoreDerivedKeys` refusal (CW.4); the custody guard test (CW.5);
   the NIP-07 refusal surface.
3. **28.3 — capture scoping.** Auto-tag captures to the bound case;
   pass the case frame into Suggest; active-case chrome in the reader
   and side panel.
4. **28.4 — viewer fencing.** The portal's foreign-npub viewer becomes
   read-only-by-construction: never in "me", never in reconcile,
   distinct rendering. (The caches already joined the boundary in
   28.1.)
5. **28.5 — the source manager.** The case dossier's add/remove UI
   rebuilt as a real surface.
6. **28.6 — cross-workspace graph.** The prior kickoff's §3.5:
   an explicit multi-case root over `buildCaseGraph`, shared entities
   as first-class cross-case edges. Deliberate, read-only, side by
   side (P8).

## §7. Open questions for the maintainer

1. Workspace id scheme: random id vs the bound case entity id?
   (Random recommended — a workspace can outlive a renamed/retyped
   case anchor, and ids must never collide with entity-id derivation.)
2. Should "delete workspace" require the same typed confirmation as
   today's reset, plus an automatic backup? (Recommended: yes, both.)
3. Does the `default` migration workspace get retro-bound to the
   maintainer's existing `epistack` profile + COVID case? (Recommended:
   yes, with a one-time confirm.)
4. Is a read-only "all workspaces" library view wanted before 28.6, or
   is per-workspace strictness the point until then? (Recommended:
   strictness until 28.6.)
