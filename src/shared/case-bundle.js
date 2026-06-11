// Case collaboration bundles — Phase 11.8 (docs/ASSESSMENTS_DESIGN.md
// "Known limitations": entity pubkeys are per-install, so cross-user
// aggregation only works between users who share entity keys).
//
// A bundle carries a case entity and every entity its claims
// reference — INCLUDING their private keys — so a collaborator who
// imports it tags claims under the SAME entity pubkeys, and both
// sides' published claims aggregate in the `#p` queries / case
// dashboard. Treat bundle files like nsec backups: anyone holding one
// can sign as those entities.
//
// Import is conflict-safe: a different key already installed under an
// entity's name is never overwritten — the entity is reported as a
// conflict (claims published under the two keys won't merge; pick one
// side's bundle and re-tag).

import { Storage } from './storage.js';
import { ClaimModel } from './claim-model.js';
import { EntityModel, ENTITY_TYPES } from './entity-model.js';
import { LocalKeyManager } from './local-key-manager.js';

export const CASE_BUNDLE_FORMAT = 'xray-case-bundle';
export const CASE_BUNDLE_VERSION = 1;

/**
 * Every entity id in the case's orbit: the case itself, every entity
 * a claim about the case is `about`, entity claim sources, and the
 * canonical targets of any of those (aliases must travel with their
 * canonical or the importer's alias graph dangles).
 */
async function collectCaseEntityIds(caseEntityId) {
    const ids = new Set([caseEntityId]);
    const claims = Object.values(await ClaimModel.getAll())
        .filter((c) => (c.about || []).includes(caseEntityId));
    for (const c of claims) {
        for (const id of c.about || []) ids.add(id);
        if (c.source && /^entity_/.test(c.source)) ids.add(c.source);
    }
    // Pull in canonical targets (alias graph is depth ≤ 1 by design).
    const all = await Storage.get('entities', {});
    for (const id of [...ids]) {
        const rec = all[id];
        if (rec && rec.canonical_id) ids.add(rec.canonical_id);
    }
    return [...ids];
}

/**
 * Build the shareable bundle for a case. Returns the plain object;
 * `buildCaseBundleJson` serializes it.
 */
export async function collectCaseBundle(caseEntityId) {
    const caseEntity = await EntityModel.get(caseEntityId);
    if (!caseEntity) throw new Error(`Entity not found: ${caseEntityId}`);

    const ids = await collectCaseEntityIds(caseEntityId);
    const entities = [];
    for (const id of ids) {
        const e = await EntityModel.get(id);
        if (!e) continue;   // dangling about-ref — claim survives, bundle skips it
        entities.push({
            id:           e.id,
            name:         e.name,
            type:         e.type,
            description:  e.description || '',
            nip05:        e.nip05 || '',
            canonical_id: e.canonical_id || null,
            keyName:      e.keyName || `entity:${e.id}`,
            // The collaboration payload. Reference-only entities (no
            // local key) export without one — the importer gets the
            // record but can't sign for it.
            privkey:      (e.keypair && e.keypair.privateKey) || null
        });
    }

    return {
        format:   CASE_BUNDLE_FORMAT,
        version:  CASE_BUNDLE_VERSION,
        case_id:  caseEntity.id,
        entities
    };
}

/** Serialize with an injected timestamp (pure; deterministic in tests). */
export function buildCaseBundleJson(bundle, exportedAt) {
    return JSON.stringify({ ...bundle, exported_at: exportedAt }, null, 2);
}

/** Shape check for incoming parsed JSON. */
export function isCaseBundle(parsed) {
    return !!(parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        && parsed.format === CASE_BUNDLE_FORMAT
        && Array.isArray(parsed.entities));
}

/**
 * Import a parsed bundle: install keys (conflict-safe), upsert entity
 * records under their ORIGINAL ids. Returns
 * `{ caseId, added, updated, keysInstalled, conflicts, skipped }`.
 */
export async function importCaseBundle(parsed) {
    if (!isCaseBundle(parsed)) throw new Error('Not an X-Ray case bundle');
    if (parsed.version > CASE_BUNDLE_VERSION) {
        throw new Error(`Bundle version ${parsed.version} is newer than this X-Ray understands (${CASE_BUNDLE_VERSION})`);
    }

    const existingAll = await Storage.get('entities', {});
    let added = 0, updated = 0, keysInstalled = 0;
    const conflicts = [];   // a DIFFERENT key already installed under this id
    const invalid = [];     // malformed/unimportable rows (bad type, bad key)
    let skipped = 0;

    for (const row of parsed.entities) {
        if (!row || !/^entity_[0-9a-f]{16}$/.test(String(row.id || '')) || !row.name) {
            skipped++;
            continue;
        }
        // SECURITY: the keyName is ALWAYS derived from the entity id and
        // the bundle's own `keyName` is ignored. Trusting it would let a
        // crafted bundle bind a record to the reserved `xray:user`
        // primary-identity slot — exfiltrating it on a later re-share, or
        // planting an attacker key as the user's identity. A legitimate
        // bundle's keyName is already `entity:<id>`, so this is
        // behavior-preserving. (CLAUDE.md private-key rule.)
        const keyName = `entity:${row.id}`;

        // Validate the type BEFORE touching key material, so an unknown
        // type from a newer exporter can't orphan an installed key.
        if (!ENTITY_TYPES.includes(row.type)) {
            invalid.push(`${row.name}: unknown entity type "${row.type}"`);
            continue;
        }

        let keyOk = true;
        if (row.privkey) {
            try {
                const before = LocalKeyManager.getKey(keyName);
                await LocalKeyManager.importKey(keyName, row.privkey, {
                    entityId: row.id, entityName: row.name, entityType: row.type
                });
                if (!before) keysInstalled++;
            } catch (err) {
                const msg = String(err && err.message || err);
                // Distinguish a genuine same-id-different-key conflict
                // (kept your key) from a malformed key in the bundle.
                if (/conflict/i.test(msg)) conflicts.push(`${row.name}: ${msg}`);
                else invalid.push(`${row.name}: ${msg}`);
                keyOk = false;
            }
        }
        if (!keyOk) continue;   // record under a conflicting/bad key would mislead

        try {
            const existed = !!existingAll[row.id];
            await EntityModel.importRecord(row);   // importRecord re-derives keyName
            if (existed) updated++; else added++;
        } catch (err) {
            invalid.push(`${row.name}: ${err.message || err}`);
        }
    }

    return { caseId: parsed.case_id || null, added, updated, keysInstalled, conflicts, invalid, skipped };
}
