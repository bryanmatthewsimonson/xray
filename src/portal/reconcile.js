// Portal reconciliation (Phase 12.6, docs/PORTAL_DESIGN.md).
//
// The local ledger records INTENT ("I published this"); the relays
// record TRUTH. This module diffs them — strictly read-only, per the
// signed-off design (Q5): the portal never writes markPublished and
// never imports remote-only events into local models.
//
// Matching is two-tier per ledger entry:
//   1. exact     — the recorded publishedEventId is on the relays
//   2. by address — some version of the same replaceable address is
//                   (a republish from any device replaces in place,
//                   so the original event id legitimately disappears)
// Neither ⇒ MISSING — the "ledger says 40, relays confirm 37" gap.
//
// The signing pubkey is not recorded on assessment/link/article
// records (only claims grew publishedPubkey in 11.1), so their
// candidate addresses fan out across the portal's resolved identity
// set — exactly the set the corpus was queried with.
//
// Kinds with no publish ledger (comments 30041, accounts 32126,
// 32125, 1985, 10002, 30078, dormant) are 'no-ledger': present on
// relays by design, never an anomaly.

import { ClaimModel } from '../shared/claim-model.js';
import { AssessmentModel } from '../shared/assessment-model.js';
import { EvidenceLinker } from '../shared/evidence-linker.js';
import { EntityModel } from '../shared/entity-model.js';
import { ForensicModel } from '../shared/forensic-model.js';
import { VerdictModel } from '../shared/truth-adjudication-model.js';
import { IntegrityModel } from '../shared/integrity-model.js';
import { listArticles } from '../shared/archive-cache.js';
import { listRuns, listPredictions, listResolutions } from '../shared/audit/audit-cache.js';
import {
    deriveModuleResultDTag, deriveAggregateAuditDTag
} from '../shared/audit/builders.js';
import { Crypto } from '../shared/crypto.js';
import { isSymmetricRelationship } from '../shared/assessment-taxonomy.js';
import { replaceableKey } from '../shared/nostr-events.js';
import { Utils } from '../shared/utils.js';

// 30060 (snapshots) and 30061 (disputes) have no publish path in 13.8
// — they stay 'no-ledger' below, never an anomaly.
const LEDGERED_KINDS = new Set([30023, 30040, 30054, 30055, 0, 30056, 30057, 30058, 30059, 30062, 30063, 30064]);

async function sha16(s) {
    return (await Crypto.sha256(String(s))).slice(0, 16);
}

const isCoord = (ref) => typeof ref === 'string' && ref.startsWith('30040:');

/**
 * Collect every local "I published this" record, with the candidate
 * relay addresses it should be discoverable under.
 *
 * @param {{pubkeys?: string[]}} opts  the resolved identity set — used
 *        where the signer's pubkey wasn't recorded locally
 * @returns {Promise<Array<{source, localId, label, publishedAt, publishedEventId, addrs}>>}
 */
export async function loadLocalLedger({ pubkeys = [] } = {}) {
    const entries = [];

    try {
        const claims = await ClaimModel.getAll();
        for (const c of Object.values(claims || {})) {
            if (!c || !c.publishedAt || !c.publishedEventId) continue;
            const keys = Array.isArray(c.publishedPubkeys) && c.publishedPubkeys.length
                ? c.publishedPubkeys
                : (c.publishedPubkey ? [c.publishedPubkey] : []);
            entries.push({
                source: 'claim',
                localId: c.id,
                label: c.text || c.id,
                publishedAt: c.publishedAt,
                publishedEventId: c.publishedEventId,
                addrs: keys.map((pk) => `30040:${pk}:${c.id}`)
            });
        }
    } catch (err) { Utils.error('Reconcile: claim ledger scan failed', err); }

    try {
        const assessments = await AssessmentModel.getAll();
        for (const a of Object.values(assessments || {})) {
            if (!a || !a.publishedAt || !a.publishedEventId) continue;
            const coord = a.claim_ref && a.claim_ref.coord;
            const addrs = [];
            if (isCoord(coord)) {
                const d = 'assess:' + (await sha16(coord));
                for (const pk of pubkeys) addrs.push(`30054:${pk}:${d}`);
            }
            entries.push({
                source: 'assessment',
                localId: a.id,
                label: (a.claim_ref && a.claim_ref.text) || a.rationale || a.id,
                publishedAt: a.publishedAt,
                publishedEventId: a.publishedEventId,
                addrs
            });
        }
    } catch (err) { Utils.error('Reconcile: assessment ledger scan failed', err); }

    try {
        const links = await EvidenceLinker.getAll();
        for (const l of Object.values(links || {})) {
            if (!l || !l.publishedAt || !l.publishedEventId) continue;
            const addrs = [];
            // Records store endpoints as source_claim_id/target_claim_id
            // (canonical refs — local id for ours, coordinate for
            // foreign). The wire d is recomputable only when both are
            // coordinates (own claims backfill coords at publish, 11.7).
            if (isCoord(l.source_claim_id) && isCoord(l.target_claim_id)) {
                let a = l.source_claim_id;
                let b = l.target_claim_id;
                if (isSymmetricRelationship(l.relationship) && b < a) [a, b] = [b, a];
                const d = 'rel:' + (await sha16(`${a}|${b}|${l.relationship}`));
                for (const pk of pubkeys) addrs.push(`30055:${pk}:${d}`);
            }
            entries.push({
                source: 'link',
                localId: l.id,
                label: `${l.relationship || 'link'} (${l.id})`,
                publishedAt: l.publishedAt,
                publishedEventId: l.publishedEventId,
                addrs
            });
        }
    } catch (err) { Utils.error('Reconcile: link ledger scan failed', err); }

    try {
        const all = await EntityModel.getAll();
        for (const e of Object.values(all || {})) {
            if (!e || !e.publishedAt || !e.publishedEventId) continue;
            const pk = e.keypair && e.keypair.pubkey;
            entries.push({
                source: 'entity',
                localId: e.id,
                label: e.name || e.id,
                publishedAt: e.publishedAt,
                publishedEventId: e.publishedEventId,
                addrs: pk ? [`0:${pk}`] : []
            });
        }
    } catch (err) { Utils.error('Reconcile: entity ledger scan failed', err); }

    try {
        const articles = await listArticles();
        for (const rec of (articles || [])) {
            if (!rec || !rec.publishedToRelay || !rec.publishedEventId) continue;
            // The archive's urlHash hashes the NORMALIZED url, but the
            // published kind-30023 d-tag hashes the RAW capture url
            // (event-builder) — recompute from rec.url or the address
            // tier never fires (12.7 review fix).
            const wireD = rec.url ? (await Crypto.sha256(rec.url)).slice(0, 16) : null;
            entries.push({
                source: 'article',
                localId: rec.urlHash,
                label: (rec.article && rec.article.title) || rec.url || rec.urlHash,
                publishedAt: rec.cachedAt || null,
                publishedEventId: rec.publishedEventId,
                addrs: wireD ? pubkeys.map((pk) => `30023:${pk}:${wireD}`) : []
            });
        }
    } catch (err) { Utils.error('Reconcile: article ledger scan failed', err); }

    // Audit kinds (13.8). The run's per-event ledger marks which of
    // its 30056s/30057 went out; predictions and resolutions carry
    // plain publishedEventId. Wire d-tags are recomputable from the
    // records (the local-id discipline shares the sha16 inputs), and
    // — like assessments — the signer's pubkey isn't recorded, so
    // addresses fan out across the resolved identity set.
    try {
        for (const run of (await listRuns()) || []) {
            if (!run || !run.events) continue;
            for (const [eventKey, mark] of Object.entries(run.events)) {
                if (!mark || !mark.publishedEventId) continue;
                const addrs = [];
                if (eventKey === 'agg') {
                    const d = await deriveAggregateAuditDTag(
                        run.articleHash, run.auditor && run.auditor.id, run.runAt);
                    for (const pk of pubkeys) addrs.push(`30057:${pk}:${d}`);
                } else if (eventKey.startsWith('mod:')) {
                    const r = (run.moduleResults || [])
                        .find((m) => m && m.module === eventKey.slice('mod:'.length));
                    if (r) {
                        // The wire d derives from findings.version
                        // (the builder's source) — the wrapper field
                        // is only the fallback for failed results.
                        const d = await deriveModuleResultDTag(
                            run.articleHash, r.module,
                            (r.findings && r.findings.version) || r.module_version, r.run_at);
                        for (const pk of pubkeys) addrs.push(`30056:${pk}:${d}`);
                    }
                }
                entries.push({
                    source: 'audit',
                    localId: `${run.id}/${eventKey}`,
                    label: eventKey === 'agg'
                        ? `aggregate audit (${run.runAt})`
                        : `module ${eventKey.slice('mod:'.length)} (${run.runAt})`,
                    publishedAt: mark.publishedAt || null,
                    publishedEventId: mark.publishedEventId,
                    addrs
                });
            }
        }
    } catch (err) { Utils.error('Reconcile: audit-run ledger scan failed', err); }

    try {
        for (const p of (await listPredictions()) || []) {
            if (!p || !p.publishedEventId) continue;
            const d = 'pred:' + String(p.id || '').slice('pred_'.length);
            entries.push({
                source: 'prediction',
                localId: p.id,
                label: (p.text || p.id).slice(0, 60),
                publishedAt: p.publishedAt || null,
                publishedEventId: p.publishedEventId,
                addrs: pubkeys.map((pk) => `30058:${pk}:${d}`)
            });
        }
    } catch (err) { Utils.error('Reconcile: prediction ledger scan failed', err); }

    try {
        for (const r of (await listResolutions()) || []) {
            if (!r || !r.publishedEventId) continue;
            const d = 'res:' + String(r.id || '').slice('res_'.length);
            entries.push({
                source: 'resolution',
                localId: r.id,
                label: `${r.outcome || 'resolution'} (${r.prediction_coord || r.id})`.slice(0, 60),
                publishedAt: r.publishedAt || null,
                publishedEventId: r.publishedEventId,
                addrs: pubkeys.map((pk) => `30059:${pk}:${d}`)
            });
        }
    } catch (err) { Utils.error('Reconcile: resolution ledger scan failed', err); }

    try {
        const findings = await ForensicModel.getAll();
        for (const f of Object.values(findings || {})) {
            if (!f || !f.publishedAt || !f.publishedEventId) continue;
            // The wire address rebuilds from the recorded d-tag +
            // publishing pubkey; without a stored d-tag we still match by
            // exact event id (the primary path).
            const addrs = (f.publishedPubkey && f.publishedDTag)
                ? [`30062:${f.publishedPubkey}:${f.publishedDTag}`] : [];
            entries.push({
                source: 'finding',
                localId: f.id,
                label: `${f.maneuver} (${(f.subject_ref && f.subject_ref.label) || ''})`.slice(0, 60),
                publishedAt: f.publishedAt,
                publishedEventId: f.publishedEventId,
                addrs
            });
        }
    } catch (err) { Utils.error('Reconcile: finding ledger scan failed', err); }

    try {
        // Phase 15: adjudicated verdicts (30063). Same posture as the
        // 30062 block — address rebuilds from the recorded d-tag +
        // publishing pubkey; event-id match is the primary path.
        for (const v of await VerdictModel.list() || []) {
            if (!v || !v.publishedAt || !v.publishedEventId) continue;
            const addrs = (v.publishedPubkey && v.publishedDTag)
                ? [`30063:${v.publishedPubkey}:${v.publishedDTag}`] : [];
            entries.push({
                source: 'verdict',
                localId: v.id,
                label: `${v.verdict} (${v.proposition_id})`.slice(0, 60),
                publishedAt: v.publishedAt,
                publishedEventId: v.publishedEventId,
                addrs
            });
        }
    } catch (err) { Utils.error('Reconcile: verdict ledger scan failed', err); }

    try {
        // Phase 15: integrity findings (30064).
        for (const f of await IntegrityModel.list() || []) {
            if (!f || !f.publishedAt || !f.publishedEventId) continue;
            const addrs = (f.publishedPubkey && f.publishedDTag)
                ? [`30064:${f.publishedPubkey}:${f.publishedDTag}`] : [];
            entries.push({
                source: 'integrity',
                localId: f.id,
                label: `${f.match} (${f.word_proposition_id})`.slice(0, 60),
                publishedAt: f.publishedAt,
                publishedEventId: f.publishedEventId,
                addrs
            });
        }
    } catch (err) { Utils.error('Reconcile: integrity ledger scan failed', err); }

    return entries;
}

/**
 * Count local records that were never published — the design's
 * "local only / never published (shown only as counts)" bucket.
 * Display-only, like everything else here.
 *
 * @returns {Promise<{claim: number, assessment: number, link: number,
 *                    entity: number, article: number, auditRun: number,
 *                    prediction: number, resolution: number, total: number}>}
 */
export async function countLocalOnly() {
    const counts = {
        claim: 0, assessment: 0, link: 0, entity: 0, article: 0,
        auditRun: 0, prediction: 0, resolution: 0,
        verdict: 0, integrity: 0, total: 0
    };
    const unpublished = (r) => r && (!r.publishedAt || !r.publishedEventId);
    try {
        for (const c of Object.values(await ClaimModel.getAll() || {})) if (unpublished(c)) counts.claim++;
    } catch (_) { /* counted as zero */ }
    try {
        for (const a of Object.values(await AssessmentModel.getAll() || {})) if (unpublished(a)) counts.assessment++;
    } catch (_) { /* counted as zero */ }
    try {
        for (const l of Object.values(await EvidenceLinker.getAll() || {})) if (unpublished(l)) counts.link++;
    } catch (_) { /* counted as zero */ }
    try {
        for (const e of Object.values(await EntityModel.getAll() || {})) if (unpublished(e)) counts.entity++;
    } catch (_) { /* counted as zero */ }
    try {
        for (const r of (await listArticles() || [])) {
            if (r && (!r.publishedToRelay || !r.publishedEventId)) counts.article++;
        }
    } catch (_) { /* counted as zero */ }
    try {
        // Verdicts/findings: only CHAIN HEADS count — a superseded
        // ruling never publishes by design, so it is not "local only".
        for (const v of await VerdictModel.list() || []) {
            if (v && !v.superseded_by && unpublished(v)) counts.verdict++;
        }
    } catch (_) { /* counted as zero */ }
    try {
        for (const f of await IntegrityModel.list() || []) {
            if (f && !f.superseded_by && unpublished(f)) counts.integrity++;
        }
    } catch (_) { /* counted as zero */ }
    try {
        // A run is "local only" when NONE of its events went out — a
        // partially-published run is a `missing` problem, not this one.
        for (const run of (await listRuns()) || []) {
            const marks = Object.values((run && run.events) || {});
            if (!marks.some((m) => m && m.publishedEventId)) counts.auditRun++;
        }
    } catch (_) { /* counted as zero */ }
    try {
        for (const p of (await listPredictions()) || []) if (unpublished(p)) counts.prediction++;
    } catch (_) { /* counted as zero */ }
    try {
        for (const r of (await listResolutions()) || []) if (unpublished(r)) counts.resolution++;
    } catch (_) { /* counted as zero */ }
    counts.total = counts.claim + counts.assessment + counts.link + counts.entity + counts.article
                 + counts.auditRun + counts.prediction + counts.resolution
                 + counts.verdict + counts.integrity;
    return counts;
}

/**
 * Pure diff of ledger entries against the fetched corpus items.
 *
 * @param {Array} ledger  loadLocalLedger() output
 * @param {Array} items   library items (each carries .event)
 * @returns {{
 *   summary: {ledgerPublished, confirmed, missing, remoteOnly},
 *   missing: Array,                       // ledger entries no relay returned
 *   statusByEventId: Object<string,string> // 'confirmed' | 'remote-only' | 'no-ledger'
 * }}
 */
export function reconcile(ledger, items) {
    const list = Array.isArray(items) ? items : [];
    const entries = Array.isArray(ledger) ? ledger : [];

    const itemIds = new Set(list.map((i) => i.id));
    const itemAddrs = new Set();
    for (const item of list) {
        const addr = replaceableKey(item.event);
        if (addr) itemAddrs.add(addr);
    }

    const missing = [];
    let confirmed = 0;
    const ledgerIds = new Set();
    const ledgerAddrs = new Set();
    for (const entry of entries) {
        ledgerIds.add(entry.publishedEventId);
        for (const addr of entry.addrs) ledgerAddrs.add(addr);
        if (itemIds.has(entry.publishedEventId)) { confirmed++; entry.status = 'confirmed'; }
        else if (entry.addrs.some((a) => itemAddrs.has(a))) { confirmed++; entry.status = 'confirmed-version'; }
        else { entry.status = 'missing'; missing.push(entry); }
    }

    const statusByEventId = {};
    let remoteOnly = 0;
    for (const item of list) {
        if (!LEDGERED_KINDS.has(item.kind)) {
            statusByEventId[item.id] = 'no-ledger';
            continue;
        }
        const addr = replaceableKey(item.event);
        if (ledgerIds.has(item.id) || (addr && ledgerAddrs.has(addr))) {
            statusByEventId[item.id] = 'confirmed';
        } else {
            statusByEventId[item.id] = 'remote-only';
            remoteOnly++;
        }
    }

    return {
        summary: {
            ledgerPublished: entries.length,
            confirmed,
            missing: missing.length,
            remoteOnly
        },
        missing,
        statusByEventId
    };
}
