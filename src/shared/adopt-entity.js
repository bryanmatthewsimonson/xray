// adopt-entity.js — the KS.3 adopt-on-sight flow, extracted from the
// sidepanel (Phase 25.2b) so the Network page runs the identical
// prompts and import semantics.
//
// A foreign pubkey surfaces (a feed candidate, a claim's about tag);
// this offers it as a foreign-entity import: fetch its kind-0 for a
// name/type proposal, warn on a local name clash, and prompt —
// adopt-as-alias (only when a same-type context entity is given),
// adopt-separate, or cancel. Misattribution stays a deliberate act,
// never a default (KNOWLEDGE_SHARING §4 / TEAM_CASE §2.3).
//
// Environment-specific pieces are injected: `query` (the relay call —
// the caller owns its message bus) and `confirmFn` (window.confirm in
// the surfaces; a stub in tests). Import semantics live in
// EntityModel.importForeign, shared already.

import { EntityModel, ENTITY_TYPES } from './entity-model.js';

const HEX64 = /^[0-9a-f]{64}$/i;

/**
 * Fetch the pubkey's newest kind-0 and propose a display name + entity
 * type for the adopt prompt. Offline-safe: falls back to the pubkey
 * prefix and the supplied default type.
 */
export async function proposeForeignIdentity(pubkey, { query, defaultType = 'person' } = {}) {
    let name = pubkey.slice(0, 12) + '…';
    let type = defaultType;
    try {
        const resp = await query({ kinds: [0], authors: [pubkey], limit: 1 }, 5000);
        if (resp && resp.ok && resp.events && resp.events.length) {
            const newest = [...resp.events].sort((a, b) => (b.created_at || 0) - (a.created_at || 0))[0];
            const content = JSON.parse(newest.content || '{}');
            if (content.name) name = String(content.name).slice(0, 200);
            const m = new RegExp('^(' + ENTITY_TYPES.join('|') + ') entity created by X-Ray').exec(content.about || '');
            if (m) type = m[1];
        }
    } catch (_) { /* offline adopt still works */ }
    return { name, type };
}

/**
 * Run the full adopt flow. Returns a status object the caller turns
 * into its own toasts/refreshes:
 *   {status: 'adopted'|'alias-linked'|'already-local'|'alias-link-failed'
 *          |'cancelled'|'invalid'|'failed',
 *    entity?, asAlias?, error?}
 *
 * @param {string} pubkey        64-hex foreign pubkey
 * @param {object} opts
 * @param {Function} opts.query        async (filter, timeoutMs) => {ok, events}
 * @param {Function} [opts.confirmFn]  (message) => boolean; defaults to globalThis.confirm
 * @param {object}  [opts.contextEntity]  enables the alias offer when types match
 * @param {object}  [opts.entities]       current entity map for the clash note
 * @param {string}  [opts.defaultType]    proposal fallback ('person')
 */
export async function adoptForeignEntity(pubkey, {
    query,
    confirmFn = (msg) => globalThis.confirm(msg),
    contextEntity = null,
    entities = {},
    defaultType = 'person'
} = {}) {
    if (!pubkey || !HEX64.test(pubkey) || typeof query !== 'function') {
        return { status: 'invalid' };
    }
    const { name, type } = await proposeForeignIdentity(pubkey, {
        query,
        defaultType: (contextEntity && contextEntity.type) || defaultType
    });

    const clash = Object.values(entities || {}).find((e) =>
        e && e.type === type
        && String(e.name).trim().toLowerCase() === String(name).trim().toLowerCase()
        && !(e.foreign_pubkey === pubkey.toLowerCase()));
    const clashNote = clash ? `\n\n⚠ You already have a ${type} named "${clash.name}" — adopting keeps them SEPARATE unless you alias them.` : '';

    let canonicalId = null;
    let asAlias = false;
    if (contextEntity && type === contextEntity.type) {
        asAlias = confirmFn(`Adopt "${name}" (${type}, key ${pubkey.slice(0, 12)}…) as an ALIAS of "${contextEntity.name}"?\n\nOK — their claims and judgments join this entity's network view.\nCancel — you'll be offered a separate adopt instead.${clashNote}`);
        if (asAlias) {
            const root = await EntityModel.resolveAlias(contextEntity);
            canonicalId = (root && root.id) || contextEntity.id;
        } else if (!confirmFn(`Adopt "${name}" as a SEPARATE read-only foreign entity?${clashNote}`)) {
            return { status: 'cancelled' };
        }
    } else if (!confirmFn(`Adopt "${name}" (${type}, key ${pubkey.slice(0, 12)}…) as a read-only foreign entity?${clashNote}`)) {
        return { status: 'cancelled' };
    }

    try {
        const adopted = await EntityModel.importForeign({ name, type, pubkey, canonicalId });
        if (!EntityModel.isForeign(adopted)) {
            // importForeign returned an existing locally KEYED entity
            // (never shadow yourself) — canonicalId was NOT applied.
            // Honor an alias request with an explicit local alias link.
            if (canonicalId && adopted.id !== canonicalId) {
                try {
                    await EntityModel.linkAlias(adopted.id, canonicalId);
                    return { status: 'alias-linked', entity: adopted, asAlias };
                } catch (err) {
                    return { status: 'alias-link-failed', entity: adopted, error: err };
                }
            }
            return { status: 'already-local', entity: adopted };
        }
        return { status: 'adopted', entity: adopted, asAlias };
    } catch (err) {
        return { status: 'failed', error: err };
    }
}
