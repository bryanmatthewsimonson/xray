# Dossier Schema

The data model for the X-Ray epistemic auditor. Storage-agnostic but designed for NOSTR-native publishing.

## Files

- `audit-types.ts` — TypeScript type definitions for every entity. The canonical schema.

## Entity overview

```
                  ┌──────────────────┐
                  │     Article      │  content-addressed (SHA-256 of markdown)
                  │   (kind 30023)   │
                  └────────┬─────────┘
                           │
          ┌────────────────┼────────────────────┬────────────────┐
          │                │                    │                │
          ▼                ▼                    ▼                ▼
   ┌──────────────┐ ┌─────────────┐  ┌──────────────────┐ ┌─────────────┐
   │ AtomicClaim  │ │ ModuleResult │  │ PredictionEntry  │ │ Aggregate   │
   │ (kind 30040) │ │ (kind 30050) │  │  (kind 30052)    │ │   Audit     │
   └──────────────┘ │  × 8 modules │  └────────┬─────────┘ │(kind 30051) │
                    └──────────────┘           │           └─────────────┘
                                               ▼
                                    ┌────────────────────┐
                                    │ PredictionResolution│
                                    │   (kind 30053)      │
                                    └────────────────────┘

           ┌─────────────────┐                     ┌──────────────────┐
           │     Author      │ ─── rolled up ───▶  │ DossierSnapshot  │
           │   Publication   │                     │  (kind 30054)    │
           └─────────────────┘                     └──────────────────┘

                    ┌──────────────────────┐
                    │   AuditDispute       │  references any of the above
                    │   (kind 30055)       │
                    └──────────────────────┘
```

## Key design decisions

### Articles are content-addressed by SHA-256 of normalized markdown

URLs change. Outlets stealth-edit. Paywalls move. The hash anchors every downstream entity to the *exact text that was scored*. If the article is later edited and re-captured, it gets a new hash and a new audit lineage — the old audits are not silently invalidated, and the diff between the two captures is itself a notable artifact.

X-Ray's existing capture pipeline produces clean markdown via Readability + Turndown; that output is suitable for hashing after a normalization pass (trim trailing whitespace, collapse blank-line runs, force LF line endings).

### Per-module results are stored independently

When a module's prompt or methodology improves, only that module's score for affected articles needs to be recomputed. The aggregate audit re-derives from whatever module results are current. Module results carry their `module_version` so historical audits remain valid under their original methodology.

### Auditor identity is a first-class type

`AuditorIdentity` covers four kinds: a model (e.g., `anthropic/claude-opus-4-7`), a human (NOSTR pubkey), a pipeline (a named orchestration with a manifest hash), or a consensus (multiple constituent auditors). Every score, claim extraction, prediction resolution, and dispute carries its auditor. This is what lets the system audit the auditors over time.

### Disagreement is published, not averaged away

When multiple auditors score the same article, the schema preserves all individual scores and their variance via `AuditorDisagreement`. Consumers can see "this article was scored 67 by one auditor and 84 by another" rather than a false consensus. This is the structural defense against ideological capture of the auditor itself.

### Predictions are extracted at audit time and resolved later

The `PredictionEntry` is created when the article is first audited. Its `resolution_status` starts as `"open"`. A `PredictionResolution` event fills it in later — possibly years later, possibly by a different auditor than extracted it. The dossier rollups compute the per-author and per-publication calibration: of confident predictions, what fraction resolved true; of hedged predictions, what fraction; etc. This is the long-game asset that makes the system durable.

### Disputes don't silently change scores

If an audit is challenged and the challenge is upheld, a *new* audit is created and the original is marked `superseded_by`. Both remain visible. The full history of how a score moved over time is the audit trail; nothing is overwritten.

### Dossier snapshots are reproducible from raw data

`DossierSnapshot` is a materialized rollup for fast lookup, but the canonical truth is always the underlying audits. Anyone can re-derive a snapshot from scratch given the same window and methodology. This is what makes the system reproducible by third parties — the central feature distinguishing it from a black-box ratings service.

## NOSTR mapping notes

X-Ray already publishes articles as `kind: 30023` (NIP-23 long-form) and plans `kind: 30040` for atomic claims. The auditor needs additional kinds; the suggested numbering (`30050`–`30055`) avoids collision with existing NIPs in the 30k addressable range, but should be claimed via NIP proposal before formal publishing.

Each entity becomes an addressable replaceable event:
- `d` tag: stable identifier (article hash for module results; subject ID for dossier snapshots)
- `e` tag: references to predecessor events (e.g., dispute → audit, resolution → prediction)
- `p` tag: pubkeys involved (auditor pubkey for human auditors, author pubkey when known)
- `t` tag: topical tags (beat, publication, module name)

This makes the entire audit corpus queryable across NOSTR relays the same way X-Ray already queries URL metadata.

## Relational alternative

For non-NOSTR storage (Postgres, SQLite), the same schema maps to tables straightforwardly:
- One table per entity type (`articles`, `atomic_claims`, `module_results`, etc.)
- `article_hash` as the foreign key on most tables
- JSONB columns for `findings` and other variable-shape fields
- Indexes on `(article_hash, module, auditor_id, run_at)` for module results
- Indexes on `(subject_id, generated_at)` for dossier snapshots

A relational migration sketch can be generated from `audit-types.ts` via standard codegen (e.g., `kysely-codegen` or `drizzle-kit`).

## Validation

The `findings` field on `ModuleResult` is `Record<string, unknown>` because the shape varies per module. Validate using per-module JSON Schemas derived from the prompt output specifications (in `prompts/01`–`prompts/08`). The scorer prototype validates module outputs against these schemas before persisting.

## Versioning

Every entity that captures methodology carries a version (`module_version`, the auditor's `id` includes model version). When the schema itself changes, bump a top-level schema version and migrate. The principle: nothing about a stored audit should become ambiguous as the system evolves.
