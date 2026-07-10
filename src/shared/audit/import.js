// X-Ray — CLI-audit import (Phase 13, slice 13.5).
//
// The v1 execution path (RQ1, confirmed as the keeper architecture):
// the vendored scorer runs out-of-band (`node scorer.js --input …
// --output audit.json`), and the extension ingests the JSON here. The
// CLI never touches NOSTR keys; signing stays in the extension, and
// the unsigned-JSON intermediate is the human-review checkpoint (P11).
//
// THE RQ1 INVARIANT — you never sign what you haven't verified — is
// enforced at the door, before anything persists:
//   1. Re-hash the imported `body_markdown` and require it to equal
//      the JSON's claimed `article.hash`.
//   2. When a local capture hash is supplied, require it to match too
//      (this note's addition beyond RQ1's letter): the audit must be
//      about the text the user actually captured.
//   3. Schema-validate every module payload. A failed validation (or
//      a scorer-reported `_error` run) is stored as a FAILED module
//      result — score null, caveat recorded, excluded from
//      aggregation — the scorer's own failure posture; one bad module
//      never rejects the file.
// The aggregate is different: it is the badge record, so a malformed
// aggregate rejects the whole import.
//
// Import is local-only and ungated (the Phase 11 split) — publishing
// the resulting events is slice 13.8, behind `epistemicAuditing`.

import { articleHash } from './article-hash.js';
import { MODULE_NAMES, validateFindings } from './findings-schemas.js';
import { AuditRunModel, PredictionModel } from './audit-model.js';
import {
    AUDITOR_KINDS, isValidCeilingSource, isStrictRunAt,
    PREDICTION_TYPES, HEDGE_LEVELS, ATTRIBUTION_KINDS, TRACTABILITIES
} from './builders.js';

const HASH64_RE = /^[0-9a-f]{64}$/;

function fail(message) {
    const err = new Error(`importAuditJson: ${message}`);
    err.auditImport = true;
    return err;
}

// The builders additionally require a HUMAN auditor's id to be the
// 64-hex pubkey (it becomes an indexed p tag) — a human id like
// "bryan" would import cleanly, display fine, and then the whole
// run would silently refuse to build at publish, forever. Invalid
// human entries are treated as absent (callers fall back); same rule
// for constituents.
function validAuditorEntry(c) {
    return c && AUDITOR_KINDS.includes(c.kind) && typeof c.id === 'string' && c.id
        && (c.kind !== 'human' || HASH64_RE.test(c.id));
}

function normalizeAuditor(raw, fallbackId) {
    if (validAuditorEntry(raw)) {
        const auditor = { kind: raw.kind, id: raw.id };
        if (Array.isArray(raw.constituents)) {
            auditor.constituents = raw.constituents
                .filter(validAuditorEntry)
                .map((c) => ({ kind: c.kind, id: c.id }));
        }
        return auditor;
    }
    return fallbackId ? { kind: 'pipeline', id: fallbackId } : null;
}

/**
 * Import one scorer-export JSON (the `scoreArticle` result shape:
 * `{article, module_results, predictions, aggregate}`) into the local
 * audit ledger.
 *
 * @param {object} json - the parsed scorer output
 * @param {object} [opts]
 * @param {string|null} [opts.localArticleHash] - the current capture's
 *   canonical hash; when present, a mismatch REJECTS the import (the
 *   audit is about different text than the user captured)
 * @returns {Promise<object>} summary: {runId, articleHash,
 *   modulesValid, modulesFailed, failedModules, predictionsImported,
 *   alreadyImported}
 */
export async function importAuditJson(json, { localArticleHash = null, source = 'cli-import', captureArticleHash = null } = {}) {
    if (!json || typeof json !== 'object' || Array.isArray(json)) {
        throw fail('expected the scorer JSON object (article / module_results / aggregate)');
    }
    const { article, module_results: moduleResults, predictions, aggregate } = json;

    // --- 1+2: the hash gate ------------------------------------------------
    if (!article || typeof article.body_markdown !== 'string' || !article.body_markdown) {
        throw fail('article.body_markdown missing — the audited text must ride with the audit');
    }
    if (typeof article.hash !== 'string' || !HASH64_RE.test(article.hash)) {
        throw fail('article.hash missing or malformed');
    }
    const recomputed = await articleHash(article.body_markdown);
    if (recomputed !== article.hash) {
        throw fail(`article.hash does not match its body_markdown — claimed ${article.hash.slice(0, 16)}…, recomputed ${recomputed.slice(0, 16)}… (the file is corrupt or tampered)`);
    }
    if (localArticleHash && localArticleHash !== recomputed) {
        throw fail(`this audit scored different text than your capture — audit ${recomputed.slice(0, 16)}…, capture ${localArticleHash.slice(0, 16)}… (re-run the scorer against the current capture, or open the capture this audit belongs to)`);
    }

    // --- aggregate: the badge record — malformed rejects -------------------
    if (!aggregate || typeof aggregate !== 'object') {
        throw fail('aggregate missing');
    }
    const finalScore = aggregate.final_score;
    const rawScore = aggregate.raw_weighted_score;
    const ceiling = aggregate.knowability_ceiling;
    const confidence = aggregate.overall_confidence;
    for (const [name, v, lo, hi] of [
        ['final_score', finalScore, 0, 100],
        ['raw_weighted_score', rawScore, 0, 100],
        ['knowability_ceiling', ceiling, 0, 100],
        ['overall_confidence', confidence, 0, 1]
    ]) {
        if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) {
            throw fail(`aggregate.${name} must be a number in [${lo}, ${hi}] (got ${v})`);
        }
    }
    if (finalScore > ceiling + 1e-9 || finalScore > rawScore + 1e-9) {
        throw fail(`aggregate is internally contradictory: final_score ${finalScore} exceeds min(raw ${rawScore}, ceiling ${ceiling})`);
    }
    // Strict ISO-8601 with explicit zone — the BUILDERS' grammar, not
    // Date.parse's. run_at feeds the wire d preimage; a lenient
    // timestamp here imports a run that can never publish.
    if (!isStrictRunAt(aggregate.run_at)) {
        throw fail(`aggregate.run_at must be strict ISO-8601 with timezone, e.g. 2026-06-11T20:14:05Z (got ${aggregate.run_at})`);
    }
    // A present-but-invalid ceiling provenance means a tampered or
    // foreign file — the wire's closed grammar (RQ2) would reject it
    // at publish anyway; reject it at the door instead.
    if (aggregate.ceiling_source != null && !isValidCeilingSource(aggregate.ceiling_source)) {
        throw fail(`aggregate.ceiling_source is not a valid provenance (got ${aggregate.ceiling_source})`);
    }
    // Contribution rows feed the published 30057's content verbatim —
    // the NIP's "aggregation is auditable from the event alone"
    // property dies if a malformed weight/confidence silently coerces
    // to 0 at publish. Rejected at the persistence boundary (P9).
    if (aggregate.module_contributions != null) {
        if (!Array.isArray(aggregate.module_contributions)) {
            throw fail('aggregate.module_contributions must be an array when present');
        }
        for (const c of aggregate.module_contributions) {
            // Module must be a KNOWN name: the builder requires it,
            // and an attacker-shaped name ('__proto__', 'constructor')
            // would otherwise hit prototype-chain lookups downstream.
            const ok = c && typeof c.module === 'string' && MODULE_NAMES.includes(c.module)
                && (c.score === null || (typeof c.score === 'number' && Number.isFinite(c.score)))
                && typeof c.confidence === 'number' && Number.isFinite(c.confidence) && c.confidence >= 0 && c.confidence <= 1
                && typeof c.weight === 'number' && Number.isFinite(c.weight) && c.weight >= 0 && c.weight <= 1;
            if (!ok) {
                throw fail(`aggregate.module_contributions has a malformed row (module ${c && c.module}) — known module, score number|null, confidence/weight in [0,1] required`);
            }
        }
    }
    const auditor = normalizeAuditor(aggregate.auditor, 'xray-auditor-import/unknown');

    // --- 3: per-module validation, failure posture per module --------------
    if (!Array.isArray(moduleResults) || moduleResults.length === 0) {
        throw fail('module_results missing or empty');
    }
    const storedResults = [];
    const failedModules = [];
    for (const r of moduleResults) {
        const module = r && r.module;
        if (!MODULE_NAMES.includes(module)) {
            failedModules.push({ module: String(module), reason: 'unknown module' });
            continue;
        }
        const base = {
            module,
            module_version: (r && r.module_version) || '1.0',
            auditor: normalizeAuditor(r && r.auditor, null) || auditor,
            run_at: (r && r.run_at) || aggregate.run_at,
            evidence_quotes: Array.isArray(r && r.evidence_quotes) ? r.evidence_quotes : [],
            auditor_caveats: Array.isArray(r && r.auditor_caveats) ? r.auditor_caveats : []
        };
        if (r._error) {
            storedResults.push({
                ...base, score: null, confidence: null,
                findings: r.findings || null, failed: true
            });
            failedModules.push({ module, reason: 'scorer-reported error' });
            continue;
        }
        // Per-module run_at feeds this module's wire d — the builder's
        // strict grammar, enforced at the door (failed posture: the
        // rest of the run still imports).
        if (r.run_at != null && !isStrictRunAt(r.run_at)) {
            storedResults.push({
                ...base, score: null, confidence: null, findings: r.findings || null,
                failed: true,
                auditor_caveats: [...base.auditor_caveats,
                    `run_at is not strict ISO-8601 with timezone (got ${r.run_at}) — the wire address cannot be derived`]
            });
            failedModules.push({ module, reason: 'run_at not strict ISO-8601' });
            continue;
        }
        const { valid, errors } = validateFindings(module, r.findings);
        if (!valid) {
            storedResults.push({
                ...base, score: null, confidence: null, findings: r.findings,
                failed: true,
                auditor_caveats: [...base.auditor_caveats,
                    `findings failed schema validation on import: ${errors.slice(0, 3).map((e) => `${e.path}: ${e.message}`).join('; ')}`]
            });
            failedModules.push({ module, reason: `schema validation (${errors.length} errors)` });
            continue;
        }
        // Score/confidence come FROM the schema-validated findings —
        // the wrapper's top-level copies sit outside every gate, and a
        // divergent (tampered) pair would otherwise import cleanly and
        // render as a naked, more-authoritative number (the exact
        // score-theater failure the display rules exist to block).
        const findingsScore = typeof r.findings.score === 'number' ? r.findings.score : null;
        const findingsConf = typeof r.findings.confidence === 'number' ? r.findings.confidence : null;
        const topDiverges = (typeof r.score === 'number' && findingsScore !== null && r.score !== findingsScore)
            || (typeof r.confidence === 'number' && findingsConf !== null && r.confidence !== findingsConf);
        if (topDiverges) {
            storedResults.push({
                ...base, score: null, confidence: null, findings: r.findings,
                failed: true,
                auditor_caveats: [...base.auditor_caveats,
                    `top-level score/confidence diverge from the validated findings (${r.score}/${r.confidence} vs ${findingsScore}/${findingsConf}) — tampered or corrupt`]
            });
            failedModules.push({ module, reason: 'score/confidence diverge from findings' });
            continue;
        }
        // Same trust boundary for the VERSION: findings.version feeds
        // the wire d (the builder derives the address from it), so a
        // wrapper module_version diverging from it would mint
        // 30056/30057 coordinates that never agree. Findings win;
        // a present-and-different wrapper is the tamper signal.
        const findingsVersion = r.findings.version;
        if (typeof r.module_version === 'string' && r.module_version !== findingsVersion) {
            storedResults.push({
                ...base, score: null, confidence: null, findings: r.findings,
                failed: true,
                auditor_caveats: [...base.auditor_caveats,
                    `wrapper module_version ${r.module_version} diverges from findings.version ${findingsVersion} — the wire address would dangle`]
            });
            failedModules.push({ module, reason: 'module_version diverges from findings.version' });
            continue;
        }
        storedResults.push({
            ...base,
            module_version: findingsVersion,
            score: findingsScore,
            confidence: findingsConf,
            findings: r.findings,
            failed: false
        });
    }
    // Explicit empty check — .every() on an empty array is vacuously
    // true, which happens to reject, but the contract should not hang
    // on a vacuous truth.
    if (storedResults.length === 0 || storedResults.every((r) => r.failed)) {
        throw fail('every module result failed validation — nothing importable');
    }

    // --- persist -------------------------------------------------------------
    const existing = await AuditRunModel.getByArticleHash(recomputed);
    const storedAggregate = {
            final_score: finalScore,
            raw_weighted_score: rawScore,
            knowability_ceiling: ceiling,
            knowability_notes: aggregate.knowability_notes || '',
            // DERIVED, never trusted: the flag controls whether the
            // badge shows its cap context, and a tampered file could
            // hide a binding ceiling (or paint a spurious one). Both
            // operands are validated above; the scorer's own
            // definition is raw > ceiling.
            ceiling_binding: rawScore > ceiling,
            // RQ2: the scorer's heuristic is the canonical pipeline
            // source; an import carrying its own source wins.
            ceiling_source: aggregate.ceiling_source || 'heuristic:source-quality/1.0',
            model_estimated_ceiling: typeof aggregate.model_estimated_ceiling === 'number'
                ? aggregate.model_estimated_ceiling : null,
            overall_confidence: confidence,
            module_contributions: Array.isArray(aggregate.module_contributions)
                ? aggregate.module_contributions : [],
            top_strengths: Array.isArray(aggregate.top_strengths) ? aggregate.top_strengths : [],
            top_concerns: Array.isArray(aggregate.top_concerns) ? aggregate.top_concerns : []
    };
    // Provenance: the caller names how the run arrived (the reader's
    // in-extension LLM path passes 'background'; the file importer keeps
    // the default). AuditRunModel.create validates against RUN_SOURCES.
    // captureArticleHash: when a run scored a truncated SLICE of an
    // over-limit capture, articleHash is the slice's hash (the exact
    // text scored — the gate above verified it) and this carries the
    // FULL capture's hash as a join alias, so surfaces that key on the
    // capture (the case dossier's evidence table) still find the run.
    const run = await AuditRunModel.create({
        articleHash: recomputed,
        auditor,
        runAt: aggregate.run_at,
        source,
        captureArticleHash: (captureArticleHash && captureArticleHash !== recomputed)
            ? captureArticleHash : null,
        moduleResults: storedResults,
        aggregate: storedAggregate
    });
    const alreadyImported = existing.some((r) => r.id === run.id);
    // A CORRECTED export keeps its run identity (hash|auditor|runAt)
    // — create's idempotence returned the stale record untouched
    // while the toast reported the fresh parse. Replace the contents
    // and clear the publish marks of every changed event so the next
    // publish re-emits it (replaceable kinds replace in place).
    let ledgerUpdated = false;
    if (alreadyImported) {
        const replaced = await AuditRunModel.replaceContents(run.id, {
            moduleResults: storedResults,
            aggregate: storedAggregate
        });
        ledgerUpdated = replaced.changed;
    }

    // Predictions are ledger records: enum fields feed calibration and
    // the 30058 builder requires horizon/criteria/evidence at publish.
    // An entry that could never publish (or would silently vanish from
    // calibration) is SKIPPED with a counted reason — extraction is
    // enrichment, so one malformed prediction never fails the import.
    let predictionsImported = 0;
    const skippedPredictions = [];
    for (const p of (Array.isArray(predictions) ? predictions : [])) {
        const text = (p && (p.prediction_text || p.prediction)) || '';
        const candidate = {
            text: typeof text === 'string' ? text.trim() : '',
            type: p && (p.prediction_type || p.type),
            hedge_level: p && p.hedge_level,
            attributed_to: p && (p.attribution_kind || p.attributed_to),
            tractability: p && p.tractability,
            condition: (p && p.condition) || null,
            horizon: (p && p.resolution_horizon) || '',
            criteria: (p && p.resolution_criteria) || '',
            evidence_quote: (p && p.evidence_quote) || ''
        };
        const reason = !candidate.text ? 'no prediction text'
            : !PREDICTION_TYPES.includes(candidate.type) ? `invalid type (${candidate.type})`
                : !HEDGE_LEVELS.includes(candidate.hedge_level) ? `invalid hedge_level (${candidate.hedge_level})`
                    : !ATTRIBUTION_KINDS.includes(candidate.attributed_to) ? `invalid attribution (${candidate.attributed_to})`
                        : !TRACTABILITIES.includes(candidate.tractability) ? `invalid tractability (${candidate.tractability})`
                            : !candidate.horizon ? 'no resolution horizon'
                                : !candidate.criteria ? 'no resolution criteria'
                                    : !candidate.evidence_quote ? 'no evidence quote'
                                        : (candidate.type === 'conditional' && !candidate.condition) ? 'conditional without its antecedent'
                                            : null;
        if (reason) {
            skippedPredictions.push({ text: candidate.text.slice(0, 60), reason });
            continue;
        }
        // The extraction methodology's version, from this run's own
        // prediction_extraction result — the published 30058 states
        // the version that actually produced it, not a constant.
        const extraction = storedResults.find((m) => m.module === 'prediction_extraction');
        await PredictionModel.create({
            articleHash: recomputed,
            text: candidate.text,
            type: candidate.type,
            hedge_level: candidate.hedge_level,
            attributed_to: candidate.attributed_to,
            attributed_source_name: p.attributed_to_named_source || p.attributed_source_name || null,
            condition: candidate.condition,
            horizon: candidate.horizon,
            // The 30058 builder requires strict YYYY-MM-DD or null —
            // a datetime here would import a prediction that shows in
            // the due strip, takes a resolution, and then both skip
            // at every publish. Degrade to null; the horizon STRING
            // stays for display.
            horizon_iso: /^\d{4}-\d{2}-\d{2}$/.test(p.resolution_horizon_iso || '')
                ? p.resolution_horizon_iso : null,
            criteria: candidate.criteria,
            tractability: candidate.tractability,
            evidence_quote: candidate.evidence_quote,
            module_version: (extraction && extraction.module_version) || '1.0',
            auditor: normalizeAuditor(p.extracted_by, null) || auditor,
            extracted_at: p.extracted_at || aggregate.run_at
        });
        predictionsImported += 1;
    }

    return {
        runId: run.id,
        articleHash: recomputed,
        modulesValid: storedResults.filter((r) => !r.failed).length,
        modulesFailed: failedModules.length,
        failedModules,
        predictionsImported,
        predictionsSkipped: skippedPredictions.length,
        skippedPredictions,
        alreadyImported,
        ledgerUpdated
    };
}
