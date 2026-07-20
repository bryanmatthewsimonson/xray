// One-step case creation — the composed verb over the 28.x primitives
// (the 2026-07-20 simplification: "a case is a project workspace that a
// profile owns; the user shouldn't have to think about creating and
// binding").
//
// createCase() does, in order, what the Options assembly ritual used to
// ask the user to do by hand:
//
//   1. resolve the owning identity (an existing saved profile, a
//      freshly minted one, or none — the NIP-07 / keep-current path),
//   2. create the workspace labeled with the case name,
//   3. ACTIVATE it (the 28.1 atomic switch: namespace + identity),
//   4. create the case entity INSIDE the new namespace — ordering is
//      load-bearing: created before activation it would land in the
//      wrong workspace's registry, and its Phase-24 derivation root
//      must be the workspace's own profile,
//   5. stamp the scope question (the suggest/synthesis frame),
//   6. bind the case to the workspace.
//
// The case entity stays the wire representation (its pubkey anchors
// kind-0 / 32125s / claim p-tags — removing it would orphan every
// published corpus); this module just makes it an implementation
// detail the user never assembles by hand.
//
// Failure after step 3 leaves the new workspace ACTIVE but unbound —
// deliberately: the state is visible and recoverable through the
// existing bind affordances in Options ▸ Cases, never silent.

import { Workspaces, IdentityProfiles } from './identity-profiles.js';
import { EntityModel } from './entity-model.js';

/**
 * @param {object} opts
 * @param {string} opts.caseName        the case (and workspace) name
 * @param {string} [opts.scopeQuestion] the author's framing question
 * @param {string} [opts.profilePubkey] own it with this SAVED profile
 * @param {string} [opts.newProfileLabel] mint a new profile with this label
 *        (mutually exclusive with profilePubkey; neither = no identity
 *        binding, the workspace keeps whatever signer is active)
 * @returns {Promise<{workspace: object, caseEntity: object}>}
 */
export async function createCase({ caseName, scopeQuestion = '', profilePubkey = null, newProfileLabel = null } = {}) {
    const name = String(caseName || '').trim();
    if (!name) throw new Error('Case name required');
    if (name.length > 60) throw new Error('Case name too long (max 60 chars)');
    if (profilePubkey && newProfileLabel) {
        throw new Error('Pass profilePubkey OR newProfileLabel, not both');
    }

    // Identity first — every failure before the workspace exists leaves
    // nothing behind (a minted-but-unused profile is harmless and
    // visible in the profile list).
    let identityPubkey = null;
    if (profilePubkey) {
        const key = String(profilePubkey).toLowerCase();
        const all = await IdentityProfiles.getAll();
        if (!all[key]) throw new Error('No saved profile for that pubkey');
        identityPubkey = key;
    } else if (newProfileLabel) {
        const p = await IdentityProfiles.create(newProfileLabel, { activate: false });
        identityPubkey = p.pubkey;
    }

    const workspace = await Workspaces.create({ label: name, identityPubkey });
    await Workspaces.activate(workspace.id);

    // The new namespace is live from here on.
    const caseEntity = await EntityModel.create({ name, type: 'case' });
    const scope = String(scopeQuestion || '').trim();
    if (scope) {
        await EntityModel.update(caseEntity.id, {
            authored_fields: { scope_question: { value: scope } }
        });
    }
    await Workspaces.update(workspace.id, { caseEntityId: caseEntity.id });

    return {
        workspace: await Workspaces.active(),
        caseEntity: await EntityModel.get(caseEntity.id)
    };
}
