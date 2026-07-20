// entity-profile.js — Phase 19.7 (docs/ENTITY_DOSSIER_DESIGN.md §6):
// the PURE assembly of an entity's public kind-0 `about` text from its
// dossier. Publishing itself is flag-gated at the reader call site
// (`entityCorpusPublishing`, default off); nothing here reads storage.
//
// RETIREMENT NOTE (2026-07-20): the Phase 19 fact layer — and with it
// the kind-30067 entity fact sheet and the fact-derived `about` field
// lines — is REMOVED. The typed-field data model proved too stringent
// to be useful. Kind 30067 is retired: X-Ray no longer emits or
// consumes it (foreign 30067s in the wild are simply unknown events).
// The kind-0 profile survives as the entity's wire identity; its
// `about` is now the honest self-description + type + aliases only.
//
// The surviving §6 red line: no judgment language, ever — the profile
// describes what the archive is, it never asserts biography.
//
// Republish hashing (MD-6, not in the design text — JOURNAL'd): the
// stored publishedProfileHash is computed over canonical content, so
// the hash-compare republish gate converges.

import { Crypto } from './crypto.js';

/**
 * The deterministic kind-0 `about` text. `maintainerNpub` (Phase 24.3)
 * prepends the honest self-description line — the stranger-legibility
 * layer (ENTITY_IDENTITY_DESIGN §5): a generic client that verifies
 * neither the OwnedKeys manifest nor the delegation token still
 * renders an honestly-labeled research record instead of a mystery
 * key.
 */
export function buildProfileAbout(dossier, { maintainerNpub = null } = {}) {
    const lines = [];
    if (maintainerNpub) {
        lines.push(`An X-Ray subject record maintained by ${maintainerNpub}`
            + ' — a research dossier about this subject, not the subject posting.');
    }
    const typeLine = `${dossier.subject.type} entity.`
        + (dossier.subject.description ? ` ${dossier.subject.description}` : '');
    lines.push(typeLine);

    const aliases = (dossier.identity.family || [])
        .filter((m) => m.relation === 'alias')
        .map((m) => m.name);
    if (aliases.length > 0) lines.push(`Also mentioned as: ${aliases.join(', ')}.`);

    return lines.join('\n');
}

/** Hash of a profile about text (naturally generated_at-free). */
export async function profileAboutHash(about) {
    return await Crypto.sha256(String(about || ''));
}

/**
 * Hash of the FULL kind-0 content the republish gate compares — name +
 * about + nip05, exactly what buildProfileEvent emits. Hashing the
 * about alone let a rename slip past the gate: the enriched profile
 * would never re-emit with the new name (19.8 review fix).
 */
export async function profileContentHash(entity, about) {
    return await Crypto.sha256(JSON.stringify({
        name: (entity && entity.name) || '',
        about: String(about || ''),
        nip05: (entity && entity.nip05) || ''
    }));
}
