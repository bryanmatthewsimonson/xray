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
import { accountsForEntity } from './identity/account-registry.js';

/**
 * Compute the equivalence pubkey set for an entity.
 *
 * Family = every entity whose alias chain resolves to the same root
 * as `entityId` (cycle-guarded by EntityModel.resolveAlias). Pubkeys =
 * each family member's wire pubkey (minted local or foreign) plus the
 * deterministic account pubkeys of accounts linked to any member.
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

    const entity = await EntityModel.get(entityId);
    if (!entity) return empty;

    const root = await EntityModel.resolveAlias(entity);
    const rootId = (root && root.id) || entity.id;

    const all = await EntityModel.getAll();
    const family = [];
    for (const candidate of Object.values(all)) {
        const canonical = await EntityModel.resolveAlias(candidate);
        if (canonical && canonical.id === rootId) family.push(candidate);
    }

    const pubkeys = [];
    const push = (pk, bucket) => {
        if (!pk || pubkeys.includes(pk)) return;
        pubkeys.push(pk);
        if (bucket) bucket.push(pk);
    };

    for (const member of family) {
        const pk = member.keypair && member.keypair.pubkey;
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
    for (const member of family) {
        for (const acct of await accountsForEntity(member.id)) {
            if (acct && acct.accountPubkey) push(acct.accountPubkey, breakdown.accountPubkeys);
        }
    }

    return { rootId, pubkeys, breakdown };
}
