// Portal audit data assembly (Phase 13.7). PURE — every function maps
// library items (+ local ledger records) to display inputs, so the
// joins are testable in node and reproducible by construction.
//
// Join discipline: audit events anchor to the canonical article hash
// (the `x` tag). Articles published since 13.4 carry it; older ones
// join by URL as a fallback — and URL joins are ADVISORY (the design's
// audit-rot posture): callers receive `joinedBy` and must mark them.
// Scores NEVER transfer across hashes: an article WITH a hash never
// falls back to URL, even when the hash finds nothing.
//
// Library items spread their extras FLAT (buildItem's `...extra`);
// test fixtures sometimes nest them. `extraOf` accepts both — the
// production shape is the flat one.

import { normalizeEventBeats, computeDossier, DEFAULT_SHRINKAGE_K } from '../shared/audit/dossier.js';

// The §4 population mean, a PUBLISHED assumption (the design's worked
// examples use it; competent journalism's expected mean is 70–85).
// Displayed wherever it shrinks a rollup — never silently applied.
export const DEFAULT_POPULATION_MEAN = 77;

function extraOf(item) {
    return (item && item.extra) || item || {};
}

function latestFirst(a, b) {
    return String(b.runAt || '').localeCompare(String(a.runAt || ''));
}

function predKeyFromCoord(coord) {
    const i = String(coord || '').lastIndexOf('pred:');
    return i === -1 ? null : String(coord).slice(i + 'pred:'.length);
}

/**
 * Build the audit index from library items: aggregates/modules/
 * predictions/resolutions/disputes, keyed for the joins every surface
 * needs.
 */
export function buildAuditIndex(items) {
    const index = {
        aggregatesByHash: new Map(),    // articleHash → [{...parsedAudit, coordinate, source:'relay'}]
        aggregatesByUrl: new Map(),     // url → same (ADVISORY fallback join)
        modulesByHash: new Map(),       // articleHash → [parsedModule]
        predictions: [],                // [{...parsedPrediction, coordinate, source:'relay'}]
        resolutionsByCoord: new Map(),  // predictionCoord → [resolution-ish {outcome, resolvedAt, source}]
        disputesByTarget: new Map()     // targetCoord → [parsedDispute]
    };
    for (const item of items || []) {
        const x = extraOf(item);
        if (item.typeKey === 'audit' && x.parsedAudit) {
            const a = {
                ...x.parsedAudit,
                coordinate: item.event ? `30057:${item.event.pubkey}:${x.parsedAudit.id}` : null,
                source: 'relay'
            };
            const list = index.aggregatesByHash.get(a.articleHash) || [];
            list.push(a);
            index.aggregatesByHash.set(a.articleHash, list);
            if (a.url) {
                const byUrl = index.aggregatesByUrl.get(a.url) || [];
                byUrl.push(a);
                index.aggregatesByUrl.set(a.url, byUrl);
            }
        } else if (item.typeKey === 'audit' && x.parsedModule) {
            const m = x.parsedModule;
            const list = index.modulesByHash.get(m.articleHash) || [];
            list.push(m);
            index.modulesByHash.set(m.articleHash, list);
        } else if (item.typeKey === 'audit' && x.parsedDispute) {
            const d = x.parsedDispute;
            const list = index.disputesByTarget.get(d.targetCoord) || [];
            list.push(d);
            index.disputesByTarget.set(d.targetCoord, list);
        } else if (item.typeKey === 'prediction' && x.parsedPrediction) {
            const p = x.parsedPrediction;
            index.predictions.push({
                ...p,
                coordinate: item.event ? `30058:${item.event.pubkey}:${p.id}` : null,
                source: 'relay'
            });
        } else if (item.typeKey === 'prediction' && x.parsedResolution) {
            const r = x.parsedResolution;
            const list = index.resolutionsByCoord.get(r.predictionCoord) || [];
            list.push({ outcome: r.outcome, resolvedAt: r.resolvedAt, source: 'relay' });
            index.resolutionsByCoord.set(r.predictionCoord, list);
        }
    }
    for (const list of index.aggregatesByHash.values()) list.sort(latestFirst);
    for (const list of index.aggregatesByUrl.values()) list.sort(latestFirst);
    return index;
}

/**
 * Merge LOCAL audit runs (the xray-audits ledger — imported but maybe
 * unpublished) into the index. Local runs carry their aggregate in
 * the 13.1 record shape; normalize to the parsed-event field names.
 */
export function mergeLocalRuns(index, localRuns) {
    for (const run of localRuns || []) {
        const agg = run.aggregate || {};
        const normalized = {
            articleHash: run.articleHash,
            runAt: run.runAt,
            finalScore: typeof agg.final_score === 'number' ? agg.final_score : null,
            rawScore: typeof agg.raw_weighted_score === 'number' ? agg.raw_weighted_score : null,
            ceiling: typeof agg.knowability_ceiling === 'number' ? agg.knowability_ceiling : null,
            ceilingBinding: agg.ceiling_binding === true,
            ceilingSource: agg.ceiling_source || null,
            confidence: typeof agg.overall_confidence === 'number' ? agg.overall_confidence : null,
            knowabilityNotes: agg.knowability_notes || '',
            auditor: run.auditor || null,
            moduleContributions: agg.module_contributions || [],
            coordinate: null,            // unpublished — minted at publish (13.8)
            source: 'local',
            localRunId: run.id
        };
        const list = index.aggregatesByHash.get(run.articleHash) || [];
        // A published copy of the same run (same auditor + runAt) wins
        // over the local record — don't double-list.
        if (!list.some((a) => a.runAt === normalized.runAt
                && a.auditor && normalized.auditor && a.auditor.id === normalized.auditor.id)) {
            list.push(normalized);
            list.sort(latestFirst);
        }
        index.aggregatesByHash.set(run.articleHash, list);
    }
    return index;
}

/**
 * Merge LOCAL resolutions (filed via the Resolve… form, unpublished
 * until 13.8) so the strip and the dossier see them immediately.
 */
export function mergeLocalResolutions(index, localResolutions) {
    for (const r of localResolutions || []) {
        if (!r || !r.prediction_coord || !r.outcome) continue;
        const list = index.resolutionsByCoord.get(r.prediction_coord) || [];
        list.push({ outcome: r.outcome, resolvedAt: r.resolved_at || null, source: 'local' });
        index.resolutionsByCoord.set(r.prediction_coord, list);
    }
    return index;
}

/**
 * The aggregates anchored to one article — hash join first; URL
 * fallback ONLY when the article carries no hash at all (pre-13.4
 * events), and marked as such. An article WITH a hash that finds no
 * audits gets an EMPTY result, never another text's scores.
 *
 * @returns {{runs: Array, joinedBy: 'hash'|'url'|null}}
 */
export function auditsForArticle(index, articleItem, priorHashesByUrl) {
    const hash = extraOf(articleItem).articleHash;
    if (hash) {
        const current = index.aggregatesByHash.get(hash) || [];
        if (current.length) return { runs: current, joinedBy: 'hash', vintage: 'current' };
        // 13.8 anchors published audit events to the vintage they
        // audited, and the replaceable 30023's x moves on re-capture
        // + republish — a current-hash-only join would silently lose
        // every earlier audit. Prior capture vintages of the same URL
        // are still TEXT-VERIFIED hash joins, to older text, and say
        // so (vintage: 'prior').
        const priors = (priorHashesByUrl && articleItem && articleItem.url)
            ? (priorHashesByUrl.get(articleItem.url) || []) : [];
        for (const ph of priors) {
            if (ph === hash) continue;
            const runs = index.aggregatesByHash.get(ph) || [];
            if (runs.length) return { runs, joinedBy: 'hash', vintage: 'prior' };
        }
        return { runs: [], joinedBy: 'hash', vintage: 'current' };
    }
    const url = articleItem && articleItem.url;
    const runs = url ? (index.aggregatesByUrl.get(url) || []) : [];
    return { runs, joinedBy: runs.length ? 'url' : null, vintage: null };
}

/**
 * The latest aggregate for an article's card chip (or null), with the
 * join provenance so URL matches can carry their advisory marker.
 */
export function latestAuditFor(index, articleItem, priorHashesByUrl) {
    const { runs, joinedBy, vintage } = auditsForArticle(index, articleItem, priorHashesByUrl);
    if (!runs.length) return null;
    const a = runs[0];
    return { final_score: a.finalScore, overall_confidence: a.confidence, joinedBy, vintage };
}

/**
 * Dossier inputs for an entity (author/publication/case pubkey): the
 * articles whose 30023 p-tags include the entity, the latest USABLE
 * aggregate per (article, auditor), and the subject's resolved
 * predictions.
 *
 * Usable means confidence ≥ 0.6: the display rules refuse to show a
 * sub-0.6 score as a number, so the reputation rollup must not
 * aggregate it either — excluded runs are counted, not hidden.
 * Returns null when no usable aggregates exist (a dossier that is
 * pure prior is noise dressed as reputation).
 */
export function dossierInputsForEntity(items, index, focusPubkey, priorHashesByUrl) {
    const articles = (items || []).filter((i) => i.typeKey === 'article'
        && (i.event.tags || []).some((t) => t[0] === 'p' && t[1] === focusPubkey));
    if (!articles.length) return null;

    const aggregates = [];
    const hashes = new Set();
    const auditedArticles = new Set();
    const unmappedBeats = new Set();
    let excludedForReview = 0;
    let excludedUrlJoined = 0;
    for (const art of articles) {
        const { runs, joinedBy } = auditsForArticle(index, art, priorHashesByUrl);
        if (!runs.length) continue;
        // URL joins are ADVISORY — "URL match, text unverified" on
        // every chip that renders them. A reputation rollup is the
        // one place an advisory join must NOT feed: scores would
        // transfer across unverified text at full weight. Counted,
        // never silently dropped.
        if (joinedBy !== 'hash') {
            excludedUrlJoined += runs.length;
            continue;
        }
        const artHash = extraOf(art).articleHash;
        if (artHash) hashes.add(artHash);
        // Latest USABLE judgment per auditor, per article — older runs
        // by the same auditor are superseded judgments, not data.
        const seen = new Set();
        for (const a of runs) {
            const key = a.auditor ? a.auditor.id : 'unknown';
            if (seen.has(key)) continue;
            seen.add(key);
            if (typeof a.confidence !== 'number' || a.confidence < 0.6) {
                excludedForReview += 1;
                continue;
            }
            aggregates.push(a);
            auditedArticles.add(a.articleHash || art.url || art.id);
        }
        const { unmapped } = normalizeEventBeats((art.event.tags || [])
            .filter((t) => t[0] === 't').map((t) => t[1]));
        unmapped.forEach((b) => unmappedBeats.add(b));
    }
    if (!aggregates.length) return null;

    const resolvedPredictions = [];
    let totalPredictions = 0;
    for (const p of index.predictions) {
        if (!hashes.has(p.articleHash)) continue;
        totalPredictions += 1;
        const resolutions = p.coordinate ? (index.resolutionsByCoord.get(p.coordinate) || []) : [];
        if (!resolutions.length) continue;
        const latest = resolutions.slice().sort((a, b) =>
            String(b.resolvedAt || '').localeCompare(String(a.resolvedAt || '')))[0];
        resolvedPredictions.push({ hedge_level: p.hedgeLevel, outcome: latest.outcome });
    }

    return {
        auditedArticles: auditedArticles.size,
        excludedForReview,
        excludedUrlJoined,
        aggregates: aggregates.map((a) => ({
            finalScore: a.finalScore,
            moduleContributions: a.moduleContributions || []
        })),
        resolvedPredictions,
        totalPredictions,
        unmappedBeats: [...unmappedBeats]
    };
}

/**
 * The computed dossier (the canonical, reproducible form). Note the
 * two counts: `auditedArticles` (distinct articles) for "over N
 * articles" display, and `judgments` (latest-per-auditor aggregates —
 * computeDossier's n, which also drives the shrinkage; documented:
 * each auditor's current judgment is a sample).
 */
export function computeEntityDossier(inputs, { k = DEFAULT_SHRINKAGE_K, populationMean = DEFAULT_POPULATION_MEAN } = {}) {
    if (!inputs) return null;
    const dossier = computeDossier({
        aggregates: inputs.aggregates,
        resolvedPredictions: inputs.resolvedPredictions,
        totalPredictions: inputs.totalPredictions,
        k,
        populationMean
    });
    return {
        ...dossier,
        judgments: dossier.articleCount,
        auditedArticles: inputs.auditedArticles,
        excludedForReview: inputs.excludedForReview,
        unmappedBeats: inputs.unmappedBeats
    };
}

/**
 * Predictions coming due: open predictions (remote + local merged,
 * deduped by their sha16 identity) with horizon-iso inside the
 * window — INCLUDING already-overdue ones — soonest first; plus the
 * open-but-unscheduled count. Resolution-awareness matches on the
 * sha16 identity, so a locally-filed resolution clears its
 * prediction regardless of which pubkey's coordinate it used.
 */
export function predictionsDue(index, localPredictions, { nowMs, windowDays = 90 } = {}) {
    const now = Number.isFinite(nowMs) ? nowMs : 0;
    const horizonLimit = now + windowDays * 86400 * 1000;

    const resolvedKeys = new Set();
    for (const coord of index.resolutionsByCoord.keys()) {
        const key = predKeyFromCoord(coord);
        if (key) resolvedKeys.add(key);
    }

    const byKey = new Map();
    for (const p of index.predictions) {
        const key = String(p.id || '').replace(/^pred:/, '');
        byKey.set(key, {
            key,
            text: p.text,
            hedge: p.hedgeLevel,
            horizonIso: p.horizonIso,
            coordinate: p.coordinate,
            articleHash: p.articleHash || null,
            resolved: resolvedKeys.has(key),
            source: 'relay'
        });
    }
    for (const p of localPredictions || []) {
        const key = String(p.id || '').replace(/^pred_/, '');
        if (byKey.has(key)) continue;   // published copy already listed
        byKey.set(key, {
            key,
            text: p.text,
            hedge: p.hedge_level,
            horizonIso: p.horizon_iso,
            coordinate: null,            // unpublished — coordinate at publish (13.8)
            articleHash: p.articleHash || null,
            resolved: p.resolution_status !== 'open' || resolvedKeys.has(key),
            localId: p.id,
            source: 'local'
        });
    }

    const open = [...byKey.values()].filter((p) => !p.resolved);
    const due = open.filter((p) => {
        if (!p.horizonIso) return false;
        const t = Date.parse(p.horizonIso);
        return Number.isFinite(t) && t <= horizonLimit;
    }).sort((a, b) => String(a.horizonIso).localeCompare(String(b.horizonIso)));
    // Unscheduled open predictions are returned as a LIST, not just a
    // count: the vendored scorer never emits horizon_iso (it
    // hard-codes null), so for CLI-imported predictions the Resolve…
    // affordance would otherwise be unreachable — the acceptance
    // walk's resolution arm dead-ends on a count with no rows.
    const unscheduledList = open.filter((p) => !p.horizonIso);

    return {
        due,
        unscheduled: unscheduledList.length,
        unscheduledList,
        openCount: open.length
    };
}

/**
 * Pick the identity that will sign predictions/resolutions in the v1
 * flow: the signer when known; otherwise any identity that is not
 * solely the reserved sync key (which signs entity-sync blobs, never
 * audit events). Null when nothing qualifies — the Resolve affordance
 * disables rather than minting a coordinate under the wrong key.
 */
export function resolverIdentity(identities) {
    const list = identities || [];
    const signer = list.find((i) => (i.sources || []).includes('signer'));
    if (signer) return signer;
    return list.find((i) => (i.sources || []).some((s) => s !== 'sync-key')) || null;
}
