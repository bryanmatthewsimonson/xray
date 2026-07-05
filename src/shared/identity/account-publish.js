// Platform-account publish selection — Knowledge Sharing KS.2
// (docs/KNOWLEDGE_SHARING_DESIGN.md §3).
//
// Selector mirroring assessment-publish.js / truth-publish.js: given
// the accounts touched by this publish run and the entities in it,
// decide which kind-32126 PlatformAccount events to emit.
//
// Republish-every-run is intentional: 32126 is addressable (d = the
// account key), so a re-publish replaces in place per NIP-01 — no
// publish ledger needed (the portal already classifies 32126 as
// `no-ledger`). Selection stays scoped to the run's own material:
// publishing an account record discloses nothing the run's article /
// comment p-tags don't already carry, except the entity link — which
// is the point of the rendezvous, and why the whole arm sits behind
// the default-off `platformAccountPublishing` flag.

import { Storage } from '../storage.js';
import { EntityModel } from '../entity-model.js';
import { accountsForEntity } from './account-registry.js';

/**
 * Select the PlatformAccount records to publish for this run.
 *
 * Union of (a) accounts touched (materialized) by this capture and
 * (b) accounts linked to any of the run's entities, alias-resolved so
 * an account linked to a run entity's canonical also surfaces. Each
 * selection carries the linked entity's wire pubkey when the link
 * resolves, so the builder can emit the role-marked
 * `['p', <entityPubkey>, '', 'linked-entity']` tag.
 *
 * @param {object}   opts
 * @param {string[]} [opts.touchedAccountKeys]  "<platform>:<stableId>"
 * @param {string[]} [opts.entityIds]           entity ids in this run
 * @returns {Promise<Array<{account: object, linkedEntityPubkey: string|null}>>}
 */
export async function selectAccountsToPublish({ touchedAccountKeys = [], entityIds = [] } = {}) {
    const byKey = new Map();

    for (const key of touchedAccountKeys) {
        if (!key || byKey.has(key)) continue;
        const rec = await Storage.platformAccounts.get(key);
        if (rec) byKey.set(key, rec);
    }

    for (const id of entityIds) {
        if (!id) continue;
        const family = [id];
        try {
            const entity = await EntityModel.get(id);
            if (entity) {
                const canonical = await EntityModel.resolveAlias(entity);
                if (canonical && canonical.id && canonical.id !== id) family.push(canonical.id);
            }
        } catch (_) { /* selection is enrichment; skip on lookup failure */ }
        for (const eid of family) {
            for (const rec of await accountsForEntity(eid)) {
                if (rec && rec.key && !byKey.has(rec.key)) byKey.set(rec.key, rec);
            }
        }
    }

    const out = [];
    for (const account of byKey.values()) {
        let linkedEntityPubkey = null;
        if (account.linkedEntityId) {
            try {
                const entity = await EntityModel.get(account.linkedEntityId);
                if (entity && entity.keypair && entity.keypair.pubkey) {
                    linkedEntityPubkey = entity.keypair.pubkey;
                }
            } catch (_) { /* dangling link publishes without the pubkey tag */ }
        }
        out.push({ account, linkedEntityPubkey });
    }
    return out;
}
