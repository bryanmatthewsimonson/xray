// =============================================================================
// X-Ray Epistemic Auditor — Data Schema
// =============================================================================
//
// Designed with NOSTR alignment for X-Ray, but storage-agnostic. Every entity
// can be expressed as either:
//   (a) a NOSTR replaceable/addressable event (kind suggestions noted), or
//   (b) a row in a relational store (Postgres sketch in schema/relational.sql).
//
// Design principles:
//   - Articles are content-addressed (SHA-256 of normalized markdown). All
//     downstream entities reference the article HASH, not the URL. URLs change;
//     content does not. This makes audits replay-safe across stealth edits.
//   - Per-module results stored independently so methodology updates only
//     require recomputing the affected modules, not the whole article.
//   - Every score carries a confidence value AND a versioned methodology
//     reference. Stored audits stay valid under their original methodology
//     even after methodology updates.
//   - Auditor identity is first-class. Model+version, human pubkey, or a
//     hybrid pipeline are all captured the same way.
//   - All time-series. The latest audit is just the newest one; nothing
//     overwrites prior audits. Drift is queryable.
//   - Predictions are extracted at audit time but resolved later. Resolution
//     events reference the prediction ID and feed the calibration multiplier.
//
// Suggested NOSTR kinds (claim before publishing as a NIP):
//   30023  — Article (existing X-Ray kind for long-form)
//   30040  — Atomic claim extracted from article (planned X-Ray Phase 4)
//   30050  — Surface-scan module result (this proposal)
//   30051  — Aggregate article audit (this proposal)
//   30052  — Prediction ledger entry (this proposal)
//   30053  — Prediction resolution (this proposal)
//   30054  — Author/publication dossier snapshot (this proposal)
//   30055  — Audit dispute / challenge (this proposal)
//
// =============================================================================


// ---------- Common primitives ----------

export type ISO8601 = string;            // "2026-05-06T14:23:00Z"
export type SHA256Hex = string;          // 64 hex chars
export type NostrPubkey = string;        // 64 hex chars (npub-decoded)
export type NostrEventId = string;       // 64 hex chars
export type Score = number;              // 0–100
export type Confidence = number;         // 0.0–1.0
export type Severity = "low" | "medium" | "high";
export type SemVer = string;             // "1.2.0"


// ---------- Auditor identity ----------

export type AuditorKind = "model" | "human" | "pipeline" | "consensus";

export interface AuditorIdentity {
  kind: AuditorKind;
  // For models: provider + model + version (e.g., "anthropic/claude-opus-4-7")
  // For humans: NOSTR pubkey
  // For pipelines: a name + manifest hash referencing the orchestration config
  // For consensus: a name + the constituent auditor IDs
  id: string;
  display_name?: string;
  // For pipelines/consensus: the constituent auditors that produced the result
  constituents?: AuditorIdentity[];
}


// ---------- Article (content-addressed) ----------

export interface Article {
  // Primary key: SHA-256 of the normalized markdown body
  // Normalization: trim trailing whitespace, collapse multi-blank lines, LF
  // line endings, strip extension-injected DOM (X-Ray's content-extractor
  // already produces clean output suitable for hashing).
  hash: SHA256Hex;

  // The source URL at capture time. May change later; not authoritative.
  source_url: string;

  // Captured headline, subhead, byline, publication, date.
  // These are EXTRACTED and stored separately because they participate in
  // multiple module checks (especially headline_body_fidelity).
  headline: string;
  subhead: string | null;
  byline_raw: string | null;     // verbatim byline text
  author_ids: string[];          // resolved author entity IDs (may be empty)
  publication_id: string | null; // resolved publication entity ID
  publication_date: ISO8601 | null;
  language: string;              // BCP-47 ("en", "en-US", "es")
  word_count: number;

  // The full normalized markdown. Stored once; everything else references hash.
  body_markdown: string;

  // Capture metadata.
  captured_at: ISO8601;
  captured_by: AuditorIdentity;  // who/what fetched and normalized
  capture_method: "xray_extension" | "api_fetch" | "manual_paste";

  // Optional: archive link for permanent reference (Wayback, archive.today,
  // or X-Ray's own archive system once Phase 6 lands).
  archive_url?: string;
}


// ---------- Atomic claim ----------
// Maps to X-Ray's planned kind 30040.

export type ClaimType =
  | "factual"      // assertion about state of the world
  | "causal"       // X caused Y
  | "evaluative"   // X is good/bad/significant
  | "predictive"   // X will happen
  | "definitional" // X means Y
  | "attributive"; // X said/did Y

export interface AtomicClaim {
  id: string;                    // UUID or NOSTR event id
  article_hash: SHA256Hex;       // anchor to immutable article
  claim_text: string;            // restated in clear, testable form
  type: ClaimType;
  // Verbatim quote from the article that establishes this claim
  evidence_quote: string;
  // Character span in the source markdown for precise anchoring
  source_span: { start: number; end: number };
  // The article's stated source for this claim (may be "article_voice")
  article_attributed_source: string;
  is_contested: boolean;
  contested_reason: string | null;
  extracted_by: AuditorIdentity;
  extracted_at: ISO8601;
}


// ---------- Surface-scan module result ----------
// Maps to suggested kind 30050. One per (article, module, auditor, run).

export type ModuleName =
  | "headline_body_fidelity"
  | "asymmetric_language"
  | "number_hygiene"
  | "source_quality"
  | "internal_coherence"
  | "definitional_precision"
  | "omission"
  | "prediction_extraction";

export interface ModuleResult {
  id: string;
  article_hash: SHA256Hex;
  module: ModuleName;
  module_version: SemVer;        // matches the prompt's declared version
  auditor: AuditorIdentity;
  run_at: ISO8601;

  // Score and confidence (omitted for prediction_extraction which doesn't score)
  score: Score | null;
  confidence: Confidence | null;

  // The raw structured findings — schema varies by module.
  // Validated against the per-module JSON schemas in /schema/modules/.
  findings: Record<string, unknown>;

  // Evidence quotes referenced by findings, deduplicated and indexed for
  // claim-level cross-referencing across modules.
  evidence_quotes: Array<{
    quote: string;
    source_span?: { start: number; end: number };
  }>;

  // Notes about what limited the auditor's confidence
  auditor_caveats: string[];
}


// ---------- Aggregate article audit ----------
// Maps to suggested kind 30051. Combines module results into article score.

export interface AggregateAudit {
  id: string;
  article_hash: SHA256Hex;
  auditor: AuditorIdentity;       // typically a "pipeline" auditor
  run_at: ISO8601;

  // Per-module result references and the weights used in this aggregation.
  module_contributions: Array<{
    module: ModuleName;
    module_result_id: string;
    score: Score | null;
    confidence: Confidence;
    weight: number;                // 0.0–1.0; sums to 1.0 across scoreable modules
  }>;

  // The knowability ceiling: max score achievable given inherent topic difficulty.
  // 100 = fully publicly verifiable. 60 = relies heavily on classified or
  // private sources that cannot be checked from the article alone.
  knowability_ceiling: Score;
  knowability_notes: string;

  // Raw weighted aggregate before ceiling.
  raw_weighted_score: Score;

  // Final score after applying ceiling. If ceiling binds, raw > final.
  final_score: Score;
  ceiling_binding: boolean;

  // Aggregate confidence. Lower than min(module_confidences) by convention,
  // because pipeline-level uncertainty stacks.
  overall_confidence: Confidence;

  // Highlights for human consumption.
  top_strengths: string[];
  top_concerns: string[];

  // Dispute pointer: if a later challenge has been adjudicated against this
  // audit, the dispute event ID lives here. Score does not silently change;
  // the dispute is its own event and the audit may be superseded by a
  // newer aggregate audit.
  superseded_by?: string;          // ID of newer audit
  disputes: string[];              // IDs of dispute events referencing this audit
}


// ---------- Prediction ledger entry ----------
// Maps to suggested kind 30052. Extracted at audit time, resolved later.

export type HedgeLevel = "confident" | "hedged" | "speculative";

export interface PredictionEntry {
  id: string;
  article_hash: SHA256Hex;
  // Author of the prediction is usually the article author, but predictions
  // attributed to named sources within the article are tagged separately.
  attributed_to_author_id: string | null;
  attributed_to_named_source: string | null;
  attribution_kind: "article_voice" | "named_source" | "vague_attribution";

  prediction_text: string;
  prediction_type: "explicit" | "implicit" | "conditional" | "negative" | "counterfactual";
  hedge_level: HedgeLevel;
  condition: string | null;        // for conditional predictions

  resolution_horizon: string;      // ISO date or descriptive
  resolution_horizon_iso: ISO8601 | null;  // computed if possible
  resolution_criteria: string;
  tractability: "publicly_resolvable" | "requires_private_info" | "ambiguous";

  evidence_quote: string;
  source_span?: { start: number; end: number };

  extracted_by: AuditorIdentity;
  extracted_at: ISO8601;

  // Filled in by resolution events. Multiple resolutions may exist; latest wins
  // unless a dispute is open.
  resolution_status: "open" | "resolved_true" | "resolved_false" | "resolved_partial" | "unresolvable";
  latest_resolution_id: string | null;
}


// ---------- Prediction resolution ----------
// Maps to suggested kind 30053. References a prediction; provides outcome evidence.

export interface PredictionResolution {
  id: string;
  prediction_id: string;
  resolved_by: AuditorIdentity;
  resolved_at: ISO8601;
  outcome: "true" | "false" | "partial" | "unresolvable";
  // Evidence for the resolution: links, document hashes, references to other
  // articles, public records, etc.
  evidence: Array<{
    kind: "url" | "nostr_event" | "document_hash" | "quote";
    value: string;
    description: string;
  }>;
  notes: string;
  // Confidence in this resolution (resolutions can themselves be disputed).
  confidence: Confidence;
}


// ---------- Author and publication ----------

export interface Author {
  id: string;                      // UUID, or NOSTR pubkey if author is NOSTR-native
  name: string;
  aliases: string[];
  // Public exposure file for transparency (financial holdings, donations,
  // prior employment, public commitments). Each item is sourced.
  exposures: Array<{
    kind: "financial_holding" | "donation" | "prior_employment" | "public_commitment" | "family_relationship" | "other";
    description: string;
    source_url: string;
    as_of: ISO8601;
  }>;
  primary_publication_id: string | null;
  beat_tags: string[];             // e.g., ["monetary_policy", "central_banks"]
  notes_url?: string;              // public notes/clarifications page
}

export interface Publication {
  id: string;
  name: string;
  homepage_url: string;
  domains: string[];               // ["nytimes.com", "www.nytimes.com"]
  // Ownership exposure file at publication level.
  exposures: Array<{
    kind: "ownership" | "controlling_investor" | "advertiser_dependence" | "other";
    description: string;
    source_url: string;
    as_of: ISO8601;
  }>;
  notes_url?: string;
}


// ---------- Dossier rollup snapshot ----------
// Maps to suggested kind 30054. Periodically materialized for fast lookup.
// Should be reproducible from scratch from the underlying audits.

export interface DossierSnapshot {
  id: string;
  subject_kind: "author" | "publication" | "beat" | "publication_x_beat";
  subject_id: string;              // author/publication id; for beat just the tag
  generated_at: ISO8601;
  generated_by: AuditorIdentity;
  // Window over which the rollup is computed
  window_start: ISO8601;
  window_end: ISO8601;
  article_count: number;

  // Aggregate scores. Each uses statistical shrinkage toward the population
  // mean for low article counts; shrinkage_factor records how much the raw
  // mean was pulled.
  aggregate_score_mean: Score;
  aggregate_score_median: Score;
  aggregate_score_stdev: number;
  shrinkage_factor: number;        // 0 = no shrinkage, 1 = fully shrunk to population mean

  // Per-module score means, for dimension-level visibility
  per_module_means: Partial<Record<ModuleName, Score>>;

  // Prediction ledger summary for this subject
  predictions: {
    total: number;
    resolved: number;
    resolved_true: number;
    resolved_false: number;
    resolved_partial: number;
    // Calibration: of confident predictions, fraction true; of hedged, fraction true; etc.
    calibration: Record<HedgeLevel, { resolved: number; true_count: number; rate: number }>;
  };

  // Correction history summary for publications
  corrections?: {
    total: number;
    prominently_acknowledged: number;
    average_days_to_correct: number;
  };

  // Top recurring named sources, for sourcing pattern visibility
  top_named_sources?: Array<{ name: string; appearances: number }>;
}


// ---------- Audit dispute / challenge ----------
// Maps to suggested kind 30055. Anyone can file; adjudicators resolve.

export interface AuditDispute {
  id: string;
  target_kind: "module_result" | "aggregate_audit" | "prediction_resolution" | "claim";
  target_id: string;
  filed_by: AuditorIdentity;
  filed_at: ISO8601;

  // What's contested and what evidence is presented.
  dispute_summary: string;
  contested_findings: string[];    // specific findings within the target
  evidence: Array<{
    kind: "url" | "nostr_event" | "document_hash" | "quote";
    value: string;
    description: string;
  }>;

  // Adjudication is a separate step, performed by a higher-trust reviewer
  // or by consensus. Multiple adjudications can exist (e.g., from different
  // independent reviewers); the dispute is resolved when convergence reached
  // or escalated.
  status: "open" | "under_review" | "upheld" | "rejected" | "partially_upheld" | "withdrawn";
  adjudications: Array<{
    adjudicator: AuditorIdentity;
    decided_at: ISO8601;
    decision: "upheld" | "rejected" | "partially_upheld";
    reasoning: string;
  }>;
  // If upheld, this is the audit ID that supersedes the original
  resulting_audit_id?: string;
}


// =============================================================================
// Aggregation helpers (reference implementation contracts)
// =============================================================================

// Bayesian shrinkage formula for low-volume subjects.
// Pulls a raw mean toward the population mean as sample size shrinks.
//
//   shrunk = (n / (n + k)) * raw_mean + (k / (n + k)) * population_mean
//
// where k is a tunable shrinkage constant (recommended starting value: 10).
// At n=0, shrunk = population_mean. At n=k, halfway. As n grows, shrunk → raw.
export interface ShrinkageParams {
  k: number;
  population_mean: Score;
}

// Cross-auditor disagreement metric for transparency.
// Measures the spread across multiple auditors' scores of the same article.
// Stored alongside aggregate audits so consumers can see "this article was
// scored 67 by auditor A and 84 by auditor B" rather than a false consensus.
export interface AuditorDisagreement {
  article_hash: SHA256Hex;
  module: ModuleName | "aggregate";
  auditor_scores: Array<{
    auditor: AuditorIdentity;
    score: Score;
    confidence: Confidence;
  }>;
  variance: number;
  notes: string;
}
