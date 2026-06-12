// X-Ray — the audit publish batch (Phase 13, slice 13.8).
//
// Assembles the ORDERED list of unsigned audit events for one capture,
// honoring the design's publish ordering: 30056 module results before
// the 30057 that references them; claims before claim-referencing
// 30058s (the claims publish earlier in the same reader batch, and a
// promoted prediction DEFERS when its claim isn't on relays yet);
// 30059 resolutions last, after their predictions. Per-event ledger
// marks ride along so the publisher can resume a partially-published
// batch instead of duplicating — the markPublished-never-bumps-updated
// rule, per event.
//
// Every event anchors to ITS OWN record's article hash (a run imported
// against one capture vintage publishes against that vintage even when
// the reader's current hash has moved on). The articleHash param is
// only the fallback for records that predate per-record hashes.
//
// Skips, all counted: failed module results (score null — they never
// publish), already-published events (the resume path), records a
// builder refuses (one malformed record never blocks the rest — the
// import module's posture, applied at publish), promoted predictions
// whose claim has no published address yet, and resolutions whose
// prediction coordinate belongs to a LOCAL prediction minted under a
// different pubkey (a stale signing identity — re-file; a coordinate
// with no local counterpart is a remote prediction someone else
// published, and resolving those is a designed workflow).

import {
    buildModuleResultEvent, buildAggregateAuditEvent,
    buildPredictionEntryEvent, buildPredictionResolutionEvent,
    deriveModuleResultDTag
} from './builders.js';

function alreadyPublished(run, eventKey) {
    return !!(run.events && run.events[eventKey] && run.events[eventKey].publishedEventId);
}

// The wire d derives from findings.version (the builder's rule);
// import enforces wrapper agreement, but derive from the same source
// the builder uses so the two can never disagree here.
function moduleWireVersion(r) {
    return (r.findings && r.findings.version) || r.module_version || '1.0';
}

/**
 * @param {object} params
 * @param {string} params.articleHash - the capture's canonical hash
 *   (fallback anchor for records without their own)
 * @param {string} params.userPubkey - the signing pubkey (producer ≠
 *   publisher: auditor tags ride the events; this key signs)
 * @param {Array} params.runs - AuditRun records for the article
 * @param {Array} params.predictions - Prediction records for the article
 * @param {Array} params.resolutions - Resolution records (the user's own)
 * @param {Object<string,string>} [params.claimPubkeys] - claim_id →
 *   the pubkey the claim is PUBLISHED under (its address). A promoted
 *   prediction whose claim_id is absent here defers — the claim isn't
 *   on relays, and the back-reference must never precede its referent.
 * @param {string} [params.articleUrl] - the article's r value, verbatim
 * @param {string|null} [params.articleCoord] - 30023 coordinate
 * @param {string} [params.relayHint]
 * @returns {Promise<{entries: Array<{label: string, event: object, mark: object}>, skipped: Array<{what: string, reason: string}>}>}
 */
export async function assembleAuditBatch({
    articleHash, userPubkey, runs = [], predictions = [], resolutions = [],
    claimPubkeys = {}, articleUrl = '', articleCoord = null, relayHint = ''
}) {
    const entries = [];
    const skipped = [];

    for (const run of runs) {
        const runHash = run.articleHash || articleHash;
        // --- 30056s first: the aggregate's a-coords must reference
        // events that exist (or are in this very batch).
        const coordByModule = {};
        for (const r of run.moduleResults || []) {
            if (r.failed || !r.findings || typeof r.findings !== 'object') {
                skipped.push({ what: `module ${r.module} (run ${run.runAt})`, reason: 'failed result — never publishes' });
                continue;
            }
            const eventKey = `mod:${r.module}`;
            try {
                const dTag = await deriveModuleResultDTag(runHash, r.module, moduleWireVersion(r), r.run_at);
                if (alreadyPublished(run, eventKey)) {
                    coordByModule[r.module] = `30056:${userPubkey}:${dTag}`;
                    skipped.push({ what: `module ${r.module} (run ${run.runAt})`, reason: 'already published — resume skips it' });
                    continue;
                }
                const built = await buildModuleResultEvent({
                    articleHash: runHash,
                    module: r.module,
                    runAt: r.run_at,
                    findings: r.findings,
                    // An empty index is a recompute trigger, not data —
                    // the builder dedupes quotes out of the findings.
                    evidenceQuotes: Array.isArray(r.evidence_quotes) && r.evidence_quotes.length
                        ? r.evidence_quotes : null,
                    articleCoord, relayHint, articleUrl,
                    auditor: r.auditor,
                });
                coordByModule[r.module] = `30056:${userPubkey}:${dTag}`;
                entries.push({
                    label: `module ${r.module}`,
                    event: built.event,
                    mark: { type: 'run-event', runId: run.id, eventKey }
                });
            } catch (err) {
                // One malformed record never blocks the batch — and a
                // module that won't build must not be referenced by
                // the aggregate either (no coordByModule entry).
                skipped.push({ what: `module ${r.module} (run ${run.runAt})`, reason: `build refused: ${err.message || err}` });
            }
        }

        // --- then the 30057.
        const agg = run.aggregate;
        if (!agg || typeof agg.final_score !== 'number') {
            skipped.push({ what: `aggregate (run ${run.runAt})`, reason: 'no scored aggregate' });
        } else if (alreadyPublished(run, 'agg')) {
            skipped.push({ what: `aggregate (run ${run.runAt})`, reason: 'already published — resume skips it' });
        } else {
            try {
                const contributions = (agg.module_contributions || [])
                    .filter((c) => coordByModule[c.module])
                    .map((c) => ({
                        module: c.module,
                        coord: coordByModule[c.module],
                        score: typeof c.score === 'number' ? c.score : null,
                        confidence: typeof c.confidence === 'number' ? c.confidence : 0,
                        weight: typeof c.weight === 'number' ? c.weight : 0
                    }));
                const built = await buildAggregateAuditEvent({
                    articleHash: runHash,
                    runAt: run.runAt,
                    finalScore: agg.final_score,
                    rawScore: typeof agg.raw_weighted_score === 'number' ? agg.raw_weighted_score : agg.final_score,
                    ceiling: typeof agg.knowability_ceiling === 'number' ? agg.knowability_ceiling : 100,
                    ceilingSource: agg.ceiling_source || 'heuristic:source-quality/1.0',
                    confidence: typeof agg.overall_confidence === 'number' ? agg.overall_confidence : 0,
                    knowabilityNotes: agg.knowability_notes || '',
                    modelEstimatedCeiling: typeof agg.model_estimated_ceiling === 'number' ? agg.model_estimated_ceiling : null,
                    moduleContributions: contributions,
                    topStrengths: agg.top_strengths || [],
                    topConcerns: agg.top_concerns || [],
                    articleCoord, relayHint, articleUrl,
                    auditor: run.auditor,
                });
                entries.push({
                    label: 'aggregate audit',
                    event: built.event,
                    mark: { type: 'run-event', runId: run.id, eventKey: 'agg' }
                    // The publisher must defer this if any of the SAME
                    // run's module events fail in this batch (mark.runId
                    // is the dependency key) — the ordering promise is
                    // referenced-before-referencer on the wire, not just
                    // in the list.
                });
            } catch (err) {
                skipped.push({ what: `aggregate (run ${run.runAt})`, reason: `build refused: ${err.message || err}` });
            }
        }
    }

    // --- 30058s. A promoted prediction defers until its claim has a
    // published address (claims publish earlier in the same reader
    // batch — a claim that landed THIS batch is already in
    // claimPubkeys by the time this assembles).
    const predCoordById = {};
    const predHashById = {};
    const deferredPredCoords = new Set();
    for (const p of predictions) {
        const predD = 'pred:' + String(p.id || '').slice('pred_'.length);
        const coord = `30058:${userPubkey}:${predD}`;
        predCoordById[p.id] = coord;
        predHashById[p.id] = p.articleHash || articleHash;
        if (p.publishedEventId) {
            skipped.push({ what: `prediction ${predD}`, reason: 'already published' });
            continue;
        }
        const claimId = p.claim_ref && p.claim_ref.claim_id;
        if (claimId && !claimPubkeys[claimId]) {
            deferredPredCoords.add(coord);
            skipped.push({
                what: `prediction ${predD}`,
                reason: 'atomized claim has no published address yet — defers until the claim lands'
            });
            continue;
        }
        try {
            const built = await buildPredictionEntryEvent({
                articleHash: p.articleHash || articleHash,
                predictionText: p.text,
                predictionType: p.type,
                hedgeLevel: p.hedge_level,
                attribution: p.attributed_to,
                attributedName: p.attributed_source_name || null,
                condition: p.condition || null,
                horizon: p.horizon,
                horizonIso: p.horizon_iso || null,
                criteria: p.criteria,
                tractability: p.tractability,
                evidenceQuote: p.evidence_quote,
                anchor: p.anchor || null,
                moduleVersion: p.module_version || '1.0',
                claimCoord: claimId ? `30040:${claimPubkeys[claimId]}:${claimId}` : null,
                articleCoord, relayHint, articleUrl,
                auditor: p.auditor || { kind: 'human', id: userPubkey },
            });
            entries.push({
                label: 'prediction',
                event: built.event,
                mark: { type: 'prediction', id: p.id },
                coord
            });
        } catch (err) {
            deferredPredCoords.add(coord);
            skipped.push({ what: `prediction ${predD}`, reason: `build refused: ${err.message || err}` });
        }
    }

    // --- 30059s last.
    const ownCoords = new Set(Object.values(predCoordById));
    const localPredByDSuffix = new Map();
    for (const [id, coord] of Object.entries(predCoordById)) {
        localPredByDSuffix.set(coord.split(':').slice(2).join(':'), id);
    }
    for (const r of resolutions) {
        if (r.publishedEventId) {
            skipped.push({ what: `resolution ${r.id}`, reason: 'already published' });
            continue;
        }
        if (deferredPredCoords.has(r.prediction_coord)) {
            skipped.push({ what: `resolution ${r.id}`, reason: 'its prediction deferred this batch' });
            continue;
        }
        const coordPubkey = String(r.prediction_coord || '').split(':')[1] || '';
        const dSuffix = String(r.prediction_coord || '').split(':').slice(2).join(':');
        const localPredId = localPredByDSuffix.get(dSuffix);
        if (coordPubkey !== userPubkey && !ownCoords.has(r.prediction_coord) && localPredId) {
            // The coordinate's d belongs to a LOCAL prediction, but it
            // was minted under a different identity — that address
            // will never exist (this batch publishes the prediction
            // under the signing key). A coordinate with NO local
            // counterpart is a remote prediction and publishes fine.
            skipped.push({
                what: `resolution ${r.id}`,
                reason: 'prediction coordinate minted under a different pubkey — re-file under the signing identity'
            });
            continue;
        }
        try {
            const built = await buildPredictionResolutionEvent({
                predictionCoord: r.prediction_coord,
                articleHash: r.article_hash || (localPredId && predHashById[localPredId]) || articleHash,
                outcome: r.outcome,
                confidence: typeof r.confidence === 'number' ? r.confidence : 0.9,
                resolvedAt: new Date((r.resolved_at || 0) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
                evidence: r.evidence || [],
                notes: r.notes || '',
                relayHint,
                auditor: r.auditor || { kind: 'human', id: userPubkey },
            });
            entries.push({
                label: 'resolution',
                event: built.event,
                mark: { type: 'resolution', id: r.id },
                // Dependency key: the publisher defers this resolution
                // if the prediction minting this coordinate fails in
                // this very batch.
                predictionCoord: r.prediction_coord
            });
        } catch (err) {
            skipped.push({ what: `resolution ${r.id}`, reason: `build refused: ${err.message || err}` });
        }
    }

    return { entries, skipped };
}
