// Entity equivalence — Knowledge Sharing KS.4 (rendezvous rung R5,
// docs/KNOWLEDGE_SHARING_DESIGN.md §2/§4).
//
// A reader's view of "this entity" spans several wire pubkeys: the
// locally minted entity key, the keys of alias-family members
// (including adopted foreign keyless entities, KS.3), and the
// deterministic platform-account pubkeys of every account linked to
// the family. This module computes that per-reader equivalence set —
// reader-local data, never published; there is no global registry.

import { EntityModel } from './entity-model.js';
import { Storage } from './storage.js';

/**
 * Compute the equivalence pubkey set for an entity.
 *
 * Family = every entity whose alias chain resolves to the same root
 * as `entityId` (EntityModel.aliasFamily — one registry snapshot,
 * in-memory walk). Pubkeys = each family member's wire pubkey (minted
 * local or foreign) plus the deterministic account pubkeys of
 * accounts linked to any member.
 *
 * @param {string} entityId
 * @returns {Promise<{rootId: string|null, pubkeys: string[],
 *   breakdown: {self: string|null, aliasPubkeys: string[],
 *               foreignPubkeys: string[], accountPubkeys: string[]}}>}
 */
export async function equivalencePubkeys(entityId) {
    const breakdown = { self: null, aliasPubkeys: [], foreignPubkeys: [], accountPubkeys: [] };
    const empty = { rootId: null, pubkeys: [], breakdown };
    if (!entityId) return empty;

    const all = await EntityModel.getAll();   // one read, keypairs merged
    if (!all[entityId]) return empty;
    const { rootId, ids } = await EntityModel.aliasFamily(entityId, all);
    const familyIds = new Set(ids);

    const pubkeys = [];
    const push = (pk, bucket) => {
        if (!pk || pubkeys.includes(pk)) return;
        pubkeys.push(pk);
        if (bucket) bucket.push(pk);
    };

    for (const id of ids) {
        const member = all[id];
        const pk = member && member.keypair && member.keypair.pubkey;
        if (!pk) continue;
        if (member.id === entityId) {
            breakdown.self = pk;
            push(pk, null);
        } else if (EntityModel.isForeign(member)) {
            push(pk, breakdown.foreignPubkeys);
        } else {
            push(pk, breakdown.aliasPubkeys);
        }
    }

    const accounts = await Storage.platformAccounts.getAll();   // one read
    for (const acct of Object.values(accounts || {})) {
        if (acct && acct.accountPubkey && acct.linkedEntityId && familyIds.has(acct.linkedEntityId)) {
            push(acct.accountPubkey, breakdown.accountPubkeys);
        }
    }

    return { rootId, pubkeys, breakdown };
}
