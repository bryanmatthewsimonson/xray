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
        // Null prototype: module names key this map, and a hostile
        // contribution row named '__proto__'/'constructor' must not
        // resolve through the prototype chain.
        const coordByModule = Object.create(null);
        // A SCORED module whose build refused poisons the aggregate:
        // its contribution row would silently vanish from a signed,
        // immutable 30057 while final_score still counts it. The
        // aggregate defers until the refusal is fixed.
        let scoredBuildRefused = false;
        for (const r of run.moduleResults || []) {
            if (r.failed || !r.findings || typeof r.findings !== 'object') {
                skipped.push({ what: `module ${r.module} (run ${run.runAt})`, reason: 'failed result — never publishes' });
                continue;
            }
            const eventKey = `mod:${r.module}`;
            try {
                const dTag = await deriveModuleResultDTag(runHash, r.module, moduleWireVersion(r), r.run_at);
                if (alreadyPublished(run, eventKey)) {
                    // The coordinate as PUBLISHED — after an identity
                    // switch the current key would mint an address
                    // that never existed on relays.
                    const pk = run.events[eventKey].publishedPubkey || userPubkey;
                    coordByModule[r.module] = `30056:${pk}:${dTag}`;
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
                if (typeof r.score === 'number') scoredBuildRefused = true;
                skipped.push({ what: `module ${r.module} (run ${run.runAt})`, reason: `build refused: ${err.message || err}` });
            }
        }

        // --- then the 30057.
        const agg = run.aggregate;
        if (!agg || typeof agg.final_score !== 'number') {
            skipped.push({ what: `aggregate (run ${run.runAt})`, reason: 'no scored aggregate' });
        } else if (alreadyPublished(run, 'agg')) {
            skipped.push({ what: `aggregate (run ${run.runAt})`, reason: 'already published — resume skips it' });
        } else if (scoredBuildRefused) {
            skipped.push({
                what: `aggregate (run ${run.runAt})`,
                reason: 'a scored module’s build refused — publishing the aggregate without its contribution would misstate the run'
            });
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
        // The coordinate this prediction HAS (already published —
        // under the key that signed it) or WILL have (this batch,
        // under the signing key).
        const coord = `30058:${p.publishedEventId ? (p.publishedPubkey || userPubkey) : userPubkey}:${predD}`;
        predCoordById[p.id] = coord;
        predHashById[p.id] = p.articleHash || articleHash;
        const claimId = p.claim_ref && p.claim_ref.claim_id;
        if (p.publishedEventId) {
            // Late atomization (RQ6): a prediction promoted AFTER its
            // 30058 published re-emits with the claim back-reference
            // — the kind is replaceable, and without this the lineage
            // holds in one direction only. Replacement only works at
            // the SAME address, so the signing key must match the
            // publishing key. Otherwise the resume skip.
            const lateClaimLink = claimId && p.claim_ref_at && p.publishedAt
                && p.claim_ref_at > p.publishedAt && claimPubkeys[claimId]
                && (p.publishedPubkey || userPubkey) === userPubkey;
            if (!lateClaimLink) {
                skipped.push({ what: `prediction ${predD}`, reason: 'already published' });
                continue;
            }
        } else if (claimId && !claimPubkeys[claimId]) {
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
                label: p.publishedEventId ? 'prediction (re-emit: claim link)' : 'prediction',
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
    const predById = {};
    for (const p of predictions) predById[p.id] = p;
    const localPredByDSuffix = new Map();
    for (const [id, coord] of Object.entries(predCoordById)) {
        localPredByDSuffix.set(coord.split(':').slice(2).join(':'), id);
    }
    for (const r of resolutions) {
        // A REVISED resolution re-emits: update() bumps `updated`,
        // markPublished never does, and the same d replaces the prior
        // event on relays — the 13.1 model contract, honored here.
        if (r.publishedEventId && !((r.updated || 0) > (r.publishedAt || 0))) {
            skipped.push({ what: `resolution ${r.id}`, reason: 'already published' });
            continue;
        }
        const reEmit = !!r.publishedEventId;
        if (deferredPredCoords.has(r.prediction_coord)) {
            skipped.push({ what: `resolution ${r.id}`, reason: 'its prediction deferred this batch' });
            continue;
        }
        const coordPubkey = String(r.prediction_coord || '').split(':')[1] || '';
        const dSuffix = String(r.prediction_coord || '').split(':').slice(2).join(':');
        const localPredId = localPredByDSuffix.get(dSuffix);
        // The address this resolution must reference:
        //   - no local counterpart → someone else's published
        //     prediction; the stored coordinate is the live address —
        //     publish verbatim.
        //   - local counterpart → the prediction's REAL address (the
        //     key it published under, or the signing key it publishes
        //     under this batch). A stored coordinate minted under a
        //     stale identity is re-keyed here — the machine re-files
        //     under the signing identity instead of dead-ending the
        //     user with a skip whose remedy the strip has withdrawn.
        let wireCoord = r.prediction_coord;
        let rekeyedCoord = null;
        if (localPredId) {
            const targetCoord = predCoordById[localPredId];
            if (wireCoord !== targetCoord) {
                wireCoord = targetCoord;
                rekeyedCoord = targetCoord;
            }
        } else if (!coordPubkey) {
            skipped.push({ what: `resolution ${r.id}`, reason: 'unparseable prediction coordinate' });
            continue;
        }
        try {
            const built = await buildPredictionResolutionEvent({
                predictionCoord: wireCoord,
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
                label: reEmit ? 'resolution (revision)' : 'resolution',
                event: built.event,
                mark: { type: 'resolution', id: r.id, ...(rekeyedCoord ? { rekeyedCoord } : {}) },
                // Dependency key: the publisher defers this resolution
                // if the prediction minting this coordinate fails in
                // this very batch.
                predictionCoord: wireCoord
            });
        } catch (err) {
            skipped.push({ what: `resolution ${r.id}`, reason: `build refused: ${err.message || err}` });
        }
    }

    return { entries, skipped };
}
