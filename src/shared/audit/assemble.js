// Audit assembly — the deterministic half of the in-extension auditor
// (extracted from audit-prompt.js so the READER can import it without
// pulling the ~38KB generated module-prompts bundle; the lean-reader
// invariant is a recorded JOURNAL decision).
//
// PURE module: no network, no chrome, no DOM. Contents:
//   - the public MODULE_WEIGHTS (PHILOSOPHY §4: public constants, not a
//     model's opinion) and the deterministic aggregate (weights +
//     knowability ceiling + confidence stacking), ported VERBATIM from
//     the CLI scorer;
//   - assembleAudit: tool output → the canonical
//     {article, module_results, predictions, aggregate} shape that
//     importAuditJson's firewall accepts;
//   - the auditable-input bound (MAX_AUDIT_INPUT_CHARS + auditableSlice):
//     the reader slices BEFORE hashing and sending, so the local hash,
//     the text the model scores, the persisted key, and the panel's
//     query key are all the same hash — the SW's own slice is a
//     defensive no-op.
//
// audit-prompt.js re-exports everything here, so existing callers and
// tests are unchanged.

import { articleHash, normalizeForHash } from './article-hash.js';
import {
    MODULE_NAMES, CURRENT_MODULE_VERSIONS, SCOREABLE_MODULES
} from './findings-schemas.js';
import { suggestSourceType } from '../truth-taxonomy.js';

// Quote fields the finding-level walk recognizes. first_use_quote is
// module 06's contested-term smuggle-point — a located span the flat
// evidence_quotes index never carried (R3; the wire index is
// deliberately unchanged, this walk is read-side only).
const FINDING_QUOTE_KEYS = ['evidence_quote', 'evidence_quote_a', 'evidence_quote_b', 'first_use_quote'];

/**
 * Walk a findings payload and emit one row PER QUOTE with its finding
 * context preserved: which array it came from (`kind`) and the
 * finding's severity when it carries one (severity_if_undefined is
 * module 06's spelling). The flat collectEvidenceQuotes below stays
 * untouched — it defines the 30056 wire body's evidence_quotes index;
 * this is the enriched READ-side companion (R3, JOURNAL 2026-08-02).
 *
 * @returns {Array<{quote: string, kind: string|null, severity: string|null}>}
 */
export function collectEvidenceFindings(findings) {
    const out = [];
    const seen = new Set();
    const walk = (node, kind) => {
        if (Array.isArray(node)) {
            for (const item of node) walk(item, kind);
            return;
        }
        if (!node || typeof node !== 'object') return;
        const severity = typeof node.severity === 'string' ? node.severity
            : (typeof node.severity_if_undefined === 'string' ? node.severity_if_undefined : null);
        for (const k of FINDING_QUOTE_KEYS) {
            const q = node[k];
            if (typeof q !== 'string' || !q) continue;
            const key = `${q}|${kind || ''}|${severity || ''}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({ quote: q, kind: kind || null, severity });
        }
        for (const [k, v] of Object.entries(node)) {
            if (v && typeof v === 'object') walk(v, Array.isArray(v) ? k : kind);
        }
    };
    walk(findings, null);
    return out;
}

// The standing caveat stamped when the audited artifact is opinion/
// analysis rather than reporting (founding-transcript integration R5
// interim; JOURNAL 2026-08-02): the eight surface modules were designed
// for news, and PHILOSOPHY §3.2's opinion dimensions are codified but
// not yet implemented. Until they are, an opinion audit is honest only
// with this on its face. Lives HERE (not audit-prompt.js) so the reader
// imports it without the module-prompts bundle — the lean-reader
// invariant. No methodology version bump: findings schemas unchanged
// (the single-shot caveat precedent).
export const STANDING_OPINION_CAVEAT =
    'Opinion/analysis artifact: the eight surface modules were designed for news '
    + 'reporting, and the opinion dimensions (premise accuracy, steel-manning, '
    + 'disclosure, originality — PHILOSOPHY §3.2) are not yet implemented. '
    + 'Findings describe craft under the news methodology only.';

/**
 * The opinion caveat for an article, or null. The user's declared
 * source_type wins (media modal); otherwise the capture-time
 * suggestion. 'analysis' is the opinion-shaped bucket — schema.org
 * OpinionPiece and AnalysisNewsArticle both map there.
 */
export function opinionStandingCaveat(article) {
    const kind = (article && article.source_type) || suggestSourceType(article || null);
    return kind === 'analysis' ? STANDING_OPINION_CAVEAT : null;
}

// The documented dimension weights — the CLI scorer's MODULE_WEIGHTS,
// verbatim. Public constants, not a model's choice (PHILOSOPHY §4).
export const MODULE_WEIGHTS = Object.freeze({
    headline_body_fidelity: 0.15,
    asymmetric_language:     0.15,
    number_hygiene:          0.10,
    source_quality:          0.20,
    internal_coherence:      0.10,
    definitional_precision:  0.10,
    omission:                0.20
});

// The OPINION family's weights (R5/OP.2) — the §8 OQ.3 ruling: the
// recommended ratios, renormalized to admit asymmetric_language at
// 0.10 (OQ.5). Public constants; Σ = 1.00. Opinion and news scores
// share the §0 axis but are NEVER averaged together — dossiers report
// the families as separate rows (§10.1 applied across families).
export const OPINION_MODULE_WEIGHTS = Object.freeze({
    premise_accuracy:               0.22,
    logical_validity:               0.18,
    steel_manning:                  0.14,
    disclosure_transparency:        0.14,
    asymmetric_language:            0.10,
    fact_interpretation_separation: 0.09,
    definitional_precision:         0.09,
    originality_synthesis:          0.04
});

// The opinion knowability ceiling — the §8 OQ.2 ruling, RQ2 posture
// (the deterministic heuristic binds; a third party recomputes it
// exactly from module output). An argument built on unverifiable
// premises cannot earn a 95 no matter how elegant (P6, opinion form).
export const OPINION_CEILING_SOURCE = 'heuristic:premise-accuracy/1.0';

/**
 * @param {object|null} premiseFindings  the premise_accuracy findings
 * @returns {{ceiling: number, notes: string}}
 */
export function opinionKnowabilityCeiling(premiseFindings) {
    const s = premiseFindings && premiseFindings.summary;
    if (!s || typeof s.load_bearing_count !== 'number' || s.load_bearing_count <= 0) {
        return { ceiling: 90, notes: 'Default ceiling; premise_accuracy findings unavailable.' };
    }
    const verifiable = typeof s.load_bearing_verifiable_count === 'number'
        ? s.load_bearing_verifiable_count : 0;
    const fraction = Math.max(0, Math.min(1, verifiable / s.load_bearing_count));
    const ceiling = Math.max(40, Math.min(95, Math.round(50 + 45 * fraction)));
    return {
        ceiling,
        notes: `${Math.round(fraction * 100)}% of load-bearing premises verifiable in principle`
            + ` (${verifiable}/${s.load_bearing_count}).`
    };
}

// Dimension scoring directions — PHILOSOPHY §3.1/§4 encoded as the
// published constant it always claimed to be (R10a, founding-transcript
// integration; JOURNAL 2026-08-02). Sources, by section: module 1 is
// explicitly "Penalty-only: a headline cannot be better than accurate"
// (§3.1); module 4 is explicitly "Credit-bearing: linked primary
// sources earn points" (§3.1); §4 names bidirectional as the third
// class and nothing else is classified — those default to it; module 8
// is unscored by construction. DESCRIPTIVE for now: the aggregation
// math stays direction-agnostic (a direction-aware aggregate is a
// full methodology wave across every module version, not something to
// smuggle into a display slice). Publishing the classification is the
// P12 half; the math is future work, said plainly.
export const MODULE_DIRECTIONS = Object.freeze({
    headline_body_fidelity: 'penalty-only',
    asymmetric_language:     'bidirectional',
    number_hygiene:          'bidirectional',
    source_quality:          'credit-bearing',
    internal_coherence:      'bidirectional',
    definitional_precision:  'bidirectional',
    omission:                'bidirectional',
    prediction_extraction:   'unscored'
});

// Bound the article text an audit covers, so a pathologically long
// capture can't balloon the request. ~120k chars ≈ well within context
// for one pass. The reader slices with auditableSlice BEFORE hashing —
// the hash gate then covers exactly the text that was scored.
export const MAX_AUDIT_INPUT_CHARS = 120000;

/**
 * Slice a body to the auditable bound, reporting whether anything was
 * cut so the caller can disclose coverage BEFORE spending.
 */
export function auditableSlice(markdown) {
    const text = String(markdown || '');
    if (text.length <= MAX_AUDIT_INPUT_CHARS) {
        return { text, truncated: false, totalChars: text.length };
    }
    return {
        text: text.slice(0, MAX_AUDIT_INPUT_CHARS),
        truncated: true,
        totalChars: text.length
    };
}

/**
 * Walk a findings object and collect every evidence_quote / _a / _b into
 * a deduplicated list of {quote}. The CLI scorer's collectEvidenceQuotes,
 * verbatim, so the reader's "Evidence quotes (click to locate)" strip is
 * populated identically on both paths.
 */
export function collectEvidenceQuotes(findings) {
    const quotes = new Set();
    (function walk(node) {
        if (node === null || typeof node !== 'object') return;
        if (Array.isArray(node)) { node.forEach(walk); return; }
        for (const [k, v] of Object.entries(node)) {
            if ((k === 'evidence_quote' || k === 'evidence_quote_a' || k === 'evidence_quote_b')
                && typeof v === 'string') {
                quotes.add(v);
            } else {
                walk(v);
            }
        }
    })(findings);
    return [...quotes].map((quote) => ({ quote }));
}

// Coerce a model-supplied score/confidence into the range the validator
// AND the aggregate require, BEFORE either consumes it. A recoverable
// model quirk (the common one: confidence emitted as a 0-100 percentage
// rather than a 0.0-1.0 fraction) must degrade a number, never discard
// the whole eight-module audit at the import firewall. This is NOT a
// tamper-gate relaxation — import.js still validates everything; we are
// keeping the value we hand it in-range so a quirk doesn't masquerade as
// corruption. A non-number stays non-number (assembleAudit nulls it,
// import takes the per-module failed posture).
function clampScore(v) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return v;
    return Math.max(0, Math.min(100, v));
}
function clampConfidence(v) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return v;
    // Clearly a percentage (1 < v <= 100) → it's a 0-100 value the model
    // mislabeled; recover the fraction. Anything still out of range
    // (negatives, >100) clamps to the bound.
    if (v > 1 && v <= 100) v = v / 100;
    return Math.max(0, Math.min(1, v));
}

// The deterministic aggregate — scorer.js aggregate(), ported. The
// knowability ceiling is derived from source_quality's summary counts;
// the weighted score uses only the scoreable modules; confidence stacks
// (min × success fraction). The model contributes NONE of this.
function buildAggregate({ hash, byModule, model, runAt }) {
    const sourceResult = byModule.source_quality;
    let knowabilityCeiling = 95;
    let knowabilityNotes = 'Default ceiling; source_quality findings unavailable.';

    if (sourceResult && !sourceResult._error && sourceResult.findings && sourceResult.findings.summary) {
        const s = sourceResult.findings.summary;
        const totalSources = s.total_sources || 0;
        const namedRatio = totalSources > 0 ? (s.named_count || 0) / totalSources : 0;
        const anonymousJustifiedRatio = totalSources > 0 ? (s.anonymous_justified_count || 0) / totalSources : 0;
        const anonymousBareRatio = totalSources > 0
            ? ((s.anonymous_count || 0) - (s.anonymous_justified_count || 0)) / totalSources
            : 0;
        const docsLinkedRatio = (s.documents_cited || 0) > 0
            ? (s.documents_specifically_identified || 0) / s.documents_cited
            : 1;
        knowabilityCeiling = Math.round(
            60 + 25 * namedRatio + 10 * docsLinkedRatio + 5 * anonymousJustifiedRatio - 15 * anonymousBareRatio
        );
        knowabilityCeiling = Math.max(40, Math.min(98, knowabilityCeiling));
        knowabilityNotes =
            `Ceiling derived from sourcing pattern: ${Math.round(namedRatio * 100)}% named, `
            + `${Math.round(anonymousBareRatio * 100)}% bare anonymous, `
            + `${Math.round(docsLinkedRatio * 100)}% of documents specifically identified.`;
    }

    let weightedSum = 0;
    let totalWeightApplied = 0;
    const moduleContributions = [];
    for (const m of SCOREABLE_MODULES) {
        const r = byModule[m];
        const weight = MODULE_WEIGHTS[m];
        if (!r || r._error || typeof r.score !== 'number') {
            moduleContributions.push({ module: m, module_result_id: null, score: null, confidence: 0, weight: 0 });
            continue;
        }
        const score = clampScore(r.score);
        weightedSum += score * weight;
        totalWeightApplied += weight;
        moduleContributions.push({
            module: m, module_result_id: null,
            score, confidence: clampConfidence(typeof r.confidence === 'number' ? r.confidence : 0.5), weight
        });
    }

    const rawWeighted = totalWeightApplied > 0 ? weightedSum / totalWeightApplied : 0;
    const ceilingBinding = rawWeighted > knowabilityCeiling;
    const finalScore = Math.min(rawWeighted, knowabilityCeiling);

    const successful = moduleContributions.filter((c) => c.score !== null);
    const minConfidence = successful.length ? Math.min(...successful.map((c) => c.confidence)) : 0;
    const successFraction = successful.length / SCOREABLE_MODULES.length;
    const overallConfidence = clampConfidence(Number((minConfidence * successFraction).toFixed(2)));

    const topStrengths = [];
    const topConcerns = [];
    for (const m of SCOREABLE_MODULES) {
        const r = byModule[m];
        if (!r || r._error || typeof r.score !== 'number') continue;
        if (r.score >= 85) topStrengths.push(`${m}: ${r.score}`);
        if (r.score <= 55) topConcerns.push(`${m}: ${r.score}`);
    }

    return {
        article_hash: hash,
        auditor: {
            kind: 'pipeline',
            id: `xray-auditor-inext/anthropic/${model}`,
            display_name: 'X-Ray Epistemic Auditor (in-extension, single-shot)',
            constituents: SCOREABLE_MODULES.map((m) => ({ kind: 'model', id: `anthropic/${model}` }))
        },
        run_at: runAt,
        module_contributions: moduleContributions,
        knowability_ceiling: knowabilityCeiling,
        knowability_notes: knowabilityNotes,
        raw_weighted_score: Number(rawWeighted.toFixed(1)),
        final_score: Number(finalScore.toFixed(1)),
        ceiling_binding: ceilingBinding,
        // The ceiling is derived from source_quality — name that provenance
        // explicitly (importAuditJson would otherwise default it).
        ceiling_source: 'heuristic:source-quality/1.0',
        overall_confidence: overallConfidence,
        top_strengths: topStrengths,
        top_concerns: topConcerns,
        disputes: []
    };
}

/**
 * Transform one emit_audit tool output into the canonical scorer-export
 * object importAuditJson accepts: {article, module_results, predictions,
 * aggregate}. Deterministic and async only because the article hash is.
 *
 * @param {object} params
 * @param {object} params.toolInput  the emit_audit tool_use input
 * @param {string} params.model      the model id used (provenance)
 * @param {string} params.markdown   the article body markdown (the SAME
 *                                   text the reader hashes — the hash
 *                                   gate matches it against the capture)
 * @param {object} [params.metadata] headline / byline / url / etc.
 * @param {string|string[]|null} [params.standingCaveat] caveat(s)
 *   prepended to every module, in the given order (the single-shot path
 *   passes its lower-rigor disclosure, optionally joined by the opinion
 *   caveat; the per-module path passes the opinion caveat or null).
 * @returns {Promise<{article, module_results, predictions, aggregate}>}
 */
export async function assembleAudit({ toolInput, model, markdown, metadata = {}, standingCaveat = null }) {
    const modulesIn = (toolInput && typeof toolInput.modules === 'object' && toolInput.modules) || {};
    const standingList = standingCaveat ? [].concat(standingCaveat).filter(Boolean) : [];
    const normalized = normalizeForHash(markdown);
    const hash = await articleHash(markdown);
    const runAt = new Date().toISOString();
    const auditorModel = { kind: 'model', id: `anthropic/${model}` };

    const moduleResults = [];
    for (const name of MODULE_NAMES) {
        const version = CURRENT_MODULE_VERSIONS[name];
        const raw = modulesIn[name];

        // Absent module → a FAILED result so the run still imports and
        // the gap is visible (the scorer's per-module failure posture).
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            const absentCaveats = [...standingList, 'module absent from model output'];
            moduleResults.push({
                article_hash: hash, module: name, module_version: version,
                auditor: auditorModel, run_at: runAt, score: null, confidence: null,
                findings: { error: 'module absent from model output' },
                evidence_quotes: [],
                auditor_caveats: absentCaveats,
                _error: true
            });
            continue;
        }

        // Build the findings envelope. module/version are injected (never
        // model-supplied) so the wire address can't dangle.
        const findings = { module: name, version, ...raw };
        if (name === 'prediction_extraction') {
            // 08 is unscored — score/confidence are forbidden in findings.
            delete findings.score;
            delete findings.confidence;
        }

        const caveats = Array.isArray(raw.auditor_caveats) ? raw.auditor_caveats.slice() : [];
        for (const s of [...standingList].reverse()) {
            if (!caveats.includes(s)) caveats.unshift(s);
        }
        findings.auditor_caveats = caveats;

        // Normalize score/confidence IN the findings object so the wrapper,
        // the validated findings, and buildAggregate all see one in-range
        // value (and import's tamper check, which requires wrapper ===
        // findings, still passes). A recovered percentage is noted so the
        // degrade is transparent (P12), not silent.
        if (name !== 'prediction_extraction') {
            if (typeof findings.confidence === 'number'
                && Number.isFinite(findings.confidence) && findings.confidence > 1) {
                caveats.push(
                    `confidence ${findings.confidence} was out of range and normalized into 0.0-1.0`);
            }
            findings.score = clampScore(findings.score);
            findings.confidence = clampConfidence(findings.confidence);
        }

        const score = typeof findings.score === 'number' ? findings.score : null;
        const confidence = typeof findings.confidence === 'number' ? findings.confidence : null;

        moduleResults.push({
            article_hash: hash, module: name, module_version: version,
            auditor: auditorModel, run_at: runAt,
            // Wrapper score/version are set EQUAL to findings' so import's
            // tamper check (top-level vs findings) passes cleanly.
            score, confidence, findings,
            evidence_quotes: collectEvidenceQuotes(findings),
            auditor_caveats: caveats
        });
    }

    const byModule = Object.fromEntries(moduleResults.map((r) => [r.module, r]));

    const predModule = modulesIn.prediction_extraction;
    const predictions = (predModule && Array.isArray(predModule.predictions)) ? predModule.predictions : [];

    const aggregate = buildAggregate({ hash, byModule, model, runAt });

    const article = {
        hash,
        source_url: metadata.source_url || metadata.url || null,
        headline: metadata.headline || metadata.title || null,
        subhead: metadata.subhead || null,
        byline_raw: metadata.byline || null,
        author_ids: [],
        publication_id: metadata.publication_id || null,
        publication_date: metadata.publication_date || null,
        language: metadata.language || 'en',
        word_count: normalized.split(/\s+/).filter(Boolean).length,
        body_markdown: normalized
    };

    return { article, module_results: moduleResults, predictions, aggregate };
}
