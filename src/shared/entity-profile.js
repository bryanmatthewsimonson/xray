// entity-profile.js — Phase 19.7 (docs/ENTITY_DOSSIER_DESIGN.md §6):
// the PURE assembly of an entity's public wire surfaces from its
// dossier — the enriched kind-0 `about` text and the kind-30067
// entity fact sheet. Publishing itself is flag-gated at the reader
// call site (`entityCorpusPublishing`, default off); nothing here
// reads storage, and the only clock read is buildFactSheetEvent's
// created_at fallback when no generatedAt is injected (the house
// event-builder pattern; tests always inject).
//
// The §6 red lines, enforced structurally + string-guard tested:
// - only facts whose claim is PUBLISHED may appear (every profile
//   line is independently verifiable from relays);
// - contested fields are OMITTED from kind 0 entirely — contested
//   status comes from the FULL dossier, not the published subset, so
//   a single published side can't masquerade as known;
// - the fact sheet shows contested fields BOTH SIDES — but only sides
//   whose claims are published (every `a`-ref must resolve);
// - no judgment language, ever: the profile says "per <source>",
//   never "is"; §3.5 applies to the wire hardest of all.
//
// Republish hashing (MD-6, not in the design text — JOURNAL'd): the
// stored publishedProfileHash / publishedFactSheetHash are computed
// over canonical content WITH `generated_at` stripped; hashing the
// timestamp would make every assembly look changed and the
// hash-compare republish gate would never converge.

import { Crypto } from './crypto.js';
import { bandISO } from './dossier-time.js';

export const FACT_SHEET_KIND = 30067;
export const FACT_SHEET_D = 'xray-facts';
export const FACT_SHEET_LABEL = 'xray/fact-sheet';
export const FACT_SHEET_VERSION = 'v1';

function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch (_) { return url || ''; }
}

function isoDay(unixSec) {
    return new Date(unixSec * 1000).toISOString().slice(0, 10);
}

// The published subset of a field row: ValueGroups reduced to their
// published evidence; groups with none drop out. The wire-facing
// `group` is REBUILT from the first published claim's own fact
// snapshot — a merged group's head may be an unpublished claim (its
// value string can differ within a date band), and nothing an
// unpublished claim asserted may represent the group on the wire
// (19.8 review fix). Falls back to the display group only for
// pre-snapshot evidence records.
function publishedGroups(row) {
    const out = [];
    for (const group of [...(row.current || []), ...(row.history || [])]) {
        const published = (group.evidence || []).filter((ev) => ev.published_event_id);
        if (published.length === 0) continue;
        const rep = published[0].fact || null;
        out.push({
            group: rep ? {
                value:               rep.value,
                value_ref:           rep.value_ref,
                valid_from:          rep.valid_from,
                valid_from_precision: rep.valid_from_precision,
                valid_to:            rep.valid_to,
                valid_to_precision:  rep.valid_to_precision,
                observed_at:         rep.observed_at,
                observed_precision:  rep.observed_precision
            } : group,
            published
        });
    }
    return out;
}

/**
 * Fields eligible for the wire, per the §6 rules. `excludedFields` is
 * the user's per-field publish checklist (persisted on the entity
 * record so the AUTOMATIC republish honors it too).
 * `forAbout` additionally drops contested fields (kind-0 rule);
 * the sheet keeps them (both published sides, contested flagged).
 */
function wireFields(dossier, { excludedFields = [], forAbout = false } = {}) {
    const excluded = new Set(excludedFields || []);
    const out = [];
    for (const row of dossier.fields || []) {
        if (excluded.has(row.field)) continue;
        if (row.provenance === 'authored') continue;          // framing never publishes as fact
        if (forAbout && row.status === 'contested') continue; // the §6 [decision]
        const groups = publishedGroups(row);
        if (groups.length === 0) continue;
        out.push({ row, groups });
    }
    return out;
}

// One about line: "Occupation: CEO of Acme Corp (2019–, per
// acme-times.com, captured 2026-05-02)". Attribution is structural:
// "per <host>" — the profile never asserts, it cites.
function aboutLine(row, groups) {
    const parts = groups.map(({ group, published }) => {
        const notes = [];
        if (group.valid_from !== null) {
            notes.push(`${bandISO(group.valid_from, group.valid_from_precision || 'exact')}–${group.valid_to !== null ? bandISO(group.valid_to, group.valid_to_precision || 'exact') : ''}`);
        }
        if (row.value_type === 'date' && /^\d{4}$/.test(String(group.value).trim())) {
            notes.push('year precision');
        }
        const hosts = [...new Set(published.map((ev) => hostOf(ev.source_url)))].filter(Boolean);
        if (hosts.length) notes.push(`per ${hosts.join(', ')}`);
        const captured = published.map((ev) => ev.captured_at).filter(Boolean).sort()[0];
        if (captured) notes.push(`captured ${isoDay(captured)}`);
        return `${group.value}${notes.length ? ` (${notes.join(', ')})` : ''}`;
    });
    return `${row.label}: ${parts.join('; ')}`;
}

/**
 * The deterministic kind-0 `about` text (§6 template, fixed ordering =
 * the dossier's registry field order). Returns the boilerplate-only
 * text when nothing publishable exists — the pre-19.7 profile shape.
 *
 * `maintainerNpub` (Phase 24.3, additive) prepends the honest
 * self-description line — the stranger-legibility layer
 * (ENTITY_IDENTITY_DESIGN §5): a generic client that verifies neither
 * the OwnedKeys manifest nor the delegation token still renders an
 * honestly-labeled research record instead of a mystery key.
 */
export function buildProfileAbout(dossier, { excludedFields = [], maintainerNpub = null } = {}) {
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

    const fields = wireFields(dossier, { excludedFields, forAbout: true });
    for (const { row, groups } of fields) {
        lines.push(aboutLine(row, groups));
    }

    if (fields.length > 0) {
        const sources = new Set();
        for (const { groups } of fields) {
            for (const { published } of groups) {
                for (const ev of published) if (ev.source_url) sources.add(ev.source_url);
            }
        }
        lines.push(`Assembled from ${sources.size} captured source${sources.size === 1 ? '' : 's'} by an X-Ray archive. Field detail: kind-30067 fact sheet.`);
    }
    return lines.join('\n');
}

/**
 * The unsigned kind-30067 entity fact sheet (§6 [decision — take the
 * kind now]): an adjudicable INDEX over verifiable events — every
 * fact `a`-refs its PUBLISHED kind-30040 claim. Signed by the
 * ENTITY's key (the caller signs). `entities` maps ids → records for
 * value_ref pubkey resolution (emit-if-resolvable).
 */
export function buildFactSheetEvent(dossier, {
    entityPubkey, publisherPubkey, generatedAt = null,
    excludedFields = [], entities = {}
} = {}) {
    const fields = wireFields(dossier, { excludedFields, forAbout: false });

    const tags = [
        ['d', FACT_SHEET_D],
        ['p', publisherPubkey, '', 'publisher'],
        ['L', FACT_SHEET_LABEL],
        ['l', FACT_SHEET_VERSION, FACT_SHEET_LABEL]
    ];
    const contentFields = [];
    const claimCoords = new Set();
    const hashes = new Set();

    // Coordinates name each claim's ACTUAL publisher (multi-device /
    // NIP-07 users may have published under more than one key); the
    // caller-supplied publisherPubkey is the fallback for pre-stamp
    // records.
    const coordOf = (ev) => `30040:${ev.published_pubkey || publisherPubkey}:${ev.claim_id}`;

    for (const { row, groups } of fields) {
        for (const { group, published } of groups) {
            tags.push(['fact', row.field, String(group.value),
                group.valid_from !== null ? bandISO(group.valid_from, group.valid_from_precision || 'exact') : '',
                group.valid_to !== null ? bandISO(group.valid_to, group.valid_to_precision || 'exact') : '']);
            for (const ev of published) {
                claimCoords.add(coordOf(ev));
                if (ev.article_hash) hashes.add(ev.article_hash);
            }
            const refRecord = group.value_ref ? entities[group.value_ref] : null;
            contentFields.push({
                field: row.field,
                value: group.value,
                value_ref_pubkey: (refRecord && refRecord.keypair && refRecord.keypair.pubkey)
                    || (refRecord && refRecord.foreign_pubkey) || null,
                valid_from: group.valid_from, valid_from_precision: group.valid_from_precision,
                valid_to: group.valid_to, valid_to_precision: group.valid_to_precision,
                observed_at: group.observed_at, observed_precision: group.observed_precision,
                contested: row.status === 'contested',
                sources: published.map((ev) => ({
                    claim_coord: coordOf(ev),
                    url: ev.source_url,
                    article_hash: ev.article_hash,
                    quote: ev.quote,
                    captured_at: ev.captured_at
                }))
            });
        }
    }

    for (const coord of [...claimCoords].sort()) tags.push(['a', coord, '', 'fact-source']);
    for (const h of [...hashes].sort()) tags.push(['x', h]);
    for (const extId of (dossier.identity.external_ids || [])) {
        if (extId) tags.push(['i', String(extId), '']);
    }
    tags.push(['client', 'xray']);

    return {
        kind: FACT_SHEET_KIND,
        pubkey: entityPubkey,
        created_at: generatedAt ?? Math.floor(Date.now() / 1000),
        tags,
        content: JSON.stringify({
            version: 1,
            entity_id: dossier.subject.id,
            fields: contentFields,
            assembled_from: [...hashes].sort().length,
            generated_at: generatedAt ?? null
        })
    };
}

/** Read-back for the portal / verification tooling. */
export function parseFactSheetEvent(event) {
    if (!event || event.kind !== FACT_SHEET_KIND) return null;
    const tags = event.tags || [];
    const first = (name) => { const t = tags.find((x) => x[0] === name); return t ? t[1] : ''; };
    let content = null;
    try { content = JSON.parse(event.content || 'null'); } catch (_) { content = null; }
    return {
        d: first('d'),
        publisher_pubkey: (tags.find((t) => t[0] === 'p' && t[3] === 'publisher') || [])[1] || '',
        entity_pubkey: event.pubkey || '',
        facts: tags.filter((t) => t[0] === 'fact').map((t) => ({
            field: t[1], value: t[2], valid_from: t[3] || null, valid_to: t[4] || null
        })),
        fact_sources: tags.filter((t) => t[0] === 'a' && t[3] === 'fact-source').map((t) => t[1]),
        article_hashes: tags.filter((t) => t[0] === 'x').map((t) => t[1]),
        external_ids: tags.filter((t) => t[0] === 'i').map((t) => t[1]),
        content,
        created_at: event.created_at || 0
    };
}

// ------------------------------------------------------------------
// Republish hashing (MD-6): canonical content minus generated_at.
// ------------------------------------------------------------------

/** Hash of a built fact-sheet event's content with generated_at stripped. */
export async function factSheetContentHash(sheetEvent) {
    let content = null;
    try { content = JSON.parse(sheetEvent.content || 'null'); } catch (_) { content = null; }
    if (!content) return await Crypto.sha256('');
    const { generated_at, ...stable } = content;
    return await Crypto.sha256(JSON.stringify(stable));
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
