// Truth-adjudication publish selection — Phase 15 publish wiring
// (docs/TRUTH_ADJUDICATION_DESIGN.md; the forensic-publish.js cousin).
// Pure, unit-testable selection logic for which adjudicated verdicts,
// verdict mirrors, and integrity findings are wire-ready in a publish
// batch. Gated by `truthAdjudicationPublishing` at the CALL SITE (the
// reader), like every publish selector.
//
//   - a VERDICT publishes when it is the CHAIN HEAD (a superseded
//     ruling never re-emits — its successor replaces it on relays,
//     NIP-01 addressable) and its proposition's claim is wire-ready
//     (published, so the 30040 coordinate exists). The usual
//     `updated > publishedAt` staleness gate applies. The superseded
//     predecessor's published event id threads into the wire
//     `e supersedes` marker when known.
//   - a verdict MIRROR (kind 1985) is keyed on `mirroredAt`, like the
//     assessment/forensic mirrors, so a rejected mirror retries.
//   - an INTEGRITY FINDING publishes when its subject resolves to a
//     pubkey (the first `entity_ids` entry with an entity keypair —
//     the forensic resolveSubjectPubkey posture), and EVERY
//     proposition it references resolves to a published claim
//     coordinate: the word, all deeds, and — for a constraint gap —
//     the constraint action-fact (the builder requires its coord; an
//     unresolvable constraint holds the finding for a later batch
//     rather than dropping the discount). A `revision_ref` passes
//     through only when it already IS a 30055 coordinate — local link
//     ids can't be rebuilt into coordinates in v1 (the linker doesn't
//     record its wire d-tag), which is a documented limitation, not a
//     silent drop: the finding still publishes, without the edge ref.

import { claimWireInfo } from './assessment-publish.js';
import { isTruthAdjudicable } from './truth-taxonomy.js';

const HEX64 = /^[0-9a-f]{64}$/;
const COORD_30055_RE = /^30055:[0-9a-f]{64}:.+$/;

/**
 * Resolve a finding's subject to a publishable pubkey via its shared
 * entity ids: the first tagged entity carrying a keypair wins.
 * Returns null when no side of the finding is keyed yet.
 */
export function resolveEntitySubjectPubkey(entityIds, entities) {
    for (const id of entityIds || []) {
        const entity = entities && entities[id];
        const pk = entity && entity.keypair && entity.keypair.pubkey;
        if (typeof pk === 'string' && HEX64.test(pk)) return pk;
    }
    return null;
}

/**
 * Map a stored evidence entry (truth-adjudication-model shape) to the
 * builder's wire shape. `claim_ref` travels only when it already is a
 * 30040 coordinate — a local claim id is meaningless off-device.
 */
export function wireEvidence(entries) {
    return (entries || []).map((e) => ({
        quote: e.quote,
        tier:  e.tier || null,
        url:   (e.source_ref && (e.source_ref.url_raw || e.source_ref.url)) || '',
        coord: e.claim_ref && /^30040:[0-9a-f]{64}:.+$/.test(e.claim_ref) ? e.claim_ref : ''
    }));
}

function isChainHead(record) {
    return !record.superseded_by;
}

function isStale(record) {
    return !(record.publishedAt && (record.updated || 0) <= record.publishedAt);
}

function supersededEventId(record, byId) {
    if (!record.supersedes) return null;
    const prev = byId[record.supersedes];
    return (prev && prev.publishedEventId) || null;
}

/**
 * Verdicts that are wire-ready and stale. Each entry:
 * `{ verdict, proposition, coord, url, supersedesEventId }`.
 * Defensive: a proposition that fails the truth-adjudicability
 * firewall never selects, even if a record somehow carries one.
 */
export function selectVerdictsToPublish({ verdicts, propositions, claims, canon }) {
    const out = [];
    for (const v of Object.values(verdicts || {})) {
        if (!isChainHead(v) || !isStale(v)) continue;
        const proposition = (propositions || {})[v.proposition_id];
        if (!proposition || !isTruthAdjudicable(proposition)) continue;
        const info = claimWireInfo(claims || {}, canon(proposition.claim_id), {});
        if (!info) continue;   // claim unpublished — a later batch
        out.push({
            verdict: v,
            proposition,
            coord: info.coord,
            url: info.url,
            supersedesEventId: supersededEventId(v, verdicts || {})
        });
    }
    out.sort((x, y) => (x.verdict.created || 0) - (y.verdict.created || 0));
    return out;
}

/**
 * The kind-1985 verdict mirrors to publish: every wire-ready chain
 * head not yet mirrored. The mirror labels the CLAIM COORDINATE
 * (never a pubkey); the reader still skips a candidate whose 30063
 * failed this batch.
 */
export function selectVerdictMirrors({ verdicts, propositions, claims, canon }) {
    const out = [];
    for (const v of Object.values(verdicts || {})) {
        if (!isChainHead(v) || v.mirroredAt) continue;
        const proposition = (propositions || {})[v.proposition_id];
        if (!proposition || !isTruthAdjudicable(proposition)) continue;
        const info = claimWireInfo(claims || {}, canon(proposition.claim_id), {});
        if (!info) continue;
        out.push({ verdict: v, coord: info.coord, url: info.url });
    }
    out.sort((x, y) => (x.verdict.created || 0) - (y.verdict.created || 0));
    return out;
}

function sideRef(proposition, info) {
    return {
        coord:             info.coord,
        class:             proposition.proposition_class,
        occurredAt:        proposition.occurred_at,
        occurredPrecision: proposition.occurred_precision
    };
}

/**
 * Integrity findings that are wire-ready and stale. Each entry:
 * `{ finding, subjectPubkey, word, deeds, constraintCoord,
 *    revisionCoord, sourceUrl, supersedesEventId }` — word/deeds in
 * the builder's `{coord, class, occurredAt, occurredPrecision}` shape.
 */
export function selectIntegrityFindingsToPublish({ findings, propositions, claims, entities, canon }) {
    const out = [];
    const props = propositions || {};
    for (const f of Object.values(findings || {})) {
        if (!isChainHead(f) || !isStale(f)) continue;

        const subjectPubkey = resolveEntitySubjectPubkey(f.entity_ids, entities);
        if (!subjectPubkey) continue;   // subject not keyed yet

        const word = props[f.word_proposition_id];
        if (!word) continue;
        const wordInfo = claimWireInfo(claims || {}, canon(word.claim_id), {});
        if (!wordInfo) continue;

        const deeds = [];
        let deedsResolved = true;
        for (const deedId of f.deed_proposition_ids || []) {
            const deed = props[deedId];
            const deedInfo = deed ? claimWireInfo(claims || {}, canon(deed.claim_id), {}) : null;
            if (!deedInfo) { deedsResolved = false; break; }
            deeds.push(sideRef(deed, deedInfo));
        }
        if (!deedsResolved || deeds.length === 0) continue;

        // A constraint gap needs its corroborated action-fact's
        // coordinate — the builder refuses without it, so the finding
        // waits rather than publishing with the discount stripped.
        let constraintCoord = '';
        if (f.gap && f.gap.cause === 'constraint') {
            const cProp = props[f.gap.constraint_ref];
            const cInfo = cProp ? claimWireInfo(claims || {}, canon(cProp.claim_id), {}) : null;
            if (!cInfo) continue;
            constraintCoord = cInfo.coord;
        }
        const revisionCoord = f.gap && f.gap.revision_ref && COORD_30055_RE.test(f.gap.revision_ref)
            ? f.gap.revision_ref : '';

        out.push({
            finding: f,
            subjectPubkey,
            word: sideRef(word, wordInfo),
            deeds,
            constraintCoord,
            revisionCoord,
            sourceUrl: wordInfo.url,
            supersedesEventId: supersededEventId(f, findings || {})
        });
    }
    out.sort((x, y) => (x.finding.created || 0) - (y.finding.created || 0));
    return out;
}
