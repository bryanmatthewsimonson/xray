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
import { listArticles } from '../shared/archive-cache.js';
import { Crypto } from '../shared/crypto.js';
import { isSymmetricRelationship } from '../shared/assessment-taxonomy.js';
import { replaceableKey } from '../shared/nostr-events.js';
import { Utils } from '../shared/utils.js';

const LEDGERED_KINDS = new Set([30023, 30040, 30054, 30055, 0]);

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
            // The wire d is recomputable only when both endpoints are
            // coordinates (own claims backfill coords at publish, 11.7).
            if (isCoord(l.source) && isCoord(l.target)) {
                let a = l.source;
                let b = l.target;
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
            entries.push({
                source: 'article',
                localId: rec.urlHash,
                label: (rec.article && rec.article.title) || rec.url || rec.urlHash,
                publishedAt: rec.cachedAt || null,
                publishedEventId: rec.publishedEventId,
                addrs: pubkeys.map((pk) => `30023:${pk}:${rec.urlHash}`)
            });
        }
    } catch (err) { Utils.error('Reconcile: article ledger scan failed', err); }

    return entries;
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
