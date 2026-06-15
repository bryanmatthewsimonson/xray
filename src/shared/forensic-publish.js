// Forensic publish selection — Phase 14 publish wiring
// (docs/CRIMINOLOGY_DESIGN.md). The flag-gated cousin of
// assessment-publish.js: pure, unit-testable selection logic for which
// behavioral findings, finding mirrors, and revision/* edges are
// wire-ready in a publish batch.
//
//   - a FINDING publishes when its subject resolves to a pubkey: an
//     external `subject_ref.pubkey`, or a tagged entity's keypair
//     (`identity_id` → registry → `keypair.pubkey`). A subject known
//     only by label/handle can't publish yet — it waits for the user to
//     link it to a keyed entity. The usual `updated > publishedAt`
//     staleness gate applies.
//   - a finding MIRROR (kind 1985) is keyed on `mirroredAt`, like the
//     assessment mirror, so a rejected mirror retries.
//   - a REVISION edge is a kind-30055 link whose relationship is one of
//     the `revision/*` values; both claim endpoints must be wire-ready
//     (reusing assessment-publish's `claimWireInfo`). These are gated by
//     `forensicPublishing`, NOT `assessmentPublishing` — the assessment
//     link selector deliberately skips them.

import { claimWireInfo } from './assessment-publish.js';
import { REVISION_RELATIONSHIPS } from './assessment-taxonomy.js';

const HEX64 = /^[0-9a-f]{64}$/;

/**
 * Resolve a finding's `subject_ref` to a publishable 64-hex pubkey, or
 * null when it can't be wired yet. An external `pubkey` wins; otherwise
 * a tagged entity's `keypair.pubkey` (the same registry path the
 * assessment about-entity mirror uses).
 */
export function resolveSubjectPubkey(subjectRef, entities) {
    const r = subjectRef || {};
    if (typeof r.pubkey === 'string' && HEX64.test(r.pubkey)) return r.pubkey;
    if (r.identity_id && entities) {
        const ent = entities[r.identity_id];
        const pk = ent && ent.keypair && ent.keypair.pubkey;
        if (typeof pk === 'string' && HEX64.test(pk)) return pk;
    }
    return null;
}

/** The verbatim source URL for a finding's wire `r` — the first anchor that has one. */
function findingSourceUrl(finding) {
    for (const a of finding.anchors || []) {
        const s = a && a.source_ref;
        if (s && (s.url_raw || s.url)) return s.url_raw || s.url;
    }
    return '';
}

/** Map stored anchors to the builder's `{quote, selector, timestamp}` shape. */
function wireAnchors(finding) {
    return (finding.anchors || []).map((a) => ({
        quote:     a.quote,
        selector:  a.selector || null,
        timestamp: a.timestamp == null ? null : a.timestamp
    }));
}

/**
 * Findings that are wire-ready (subject resolvable) and stale. Each
 * entry: `{ finding, subjectPubkey, sourceUrl, anchors }`.
 */
export function selectFindingsToPublish({ findings, entities }) {
    const out = [];
    for (const f of Object.values(findings || {})) {
        if (f.publishedAt && (f.updated || 0) <= f.publishedAt) continue;
        const subjectPubkey = resolveSubjectPubkey(f.subject_ref, entities);
        if (!subjectPubkey) continue;   // subject not keyed yet — a later batch / never
        const anchors = wireAnchors(f);
        if (!anchors.length || !anchors.some((a) => String(a.quote || '').trim())) continue;
        out.push({ finding: f, subjectPubkey, sourceUrl: findingSourceUrl(f), anchors });
    }
    out.sort((x, y) => (x.finding.created || 0) - (y.finding.created || 0));
    return out;
}

/**
 * The kind-1985 maneuver mirrors to publish: every wire-ready finding
 * not yet mirrored (`mirroredAt` unset). Keyed on mirror state, not the
 * finding's publish state — a rejected mirror retries next batch. The
 * reader still skips a candidate whose 30062 was attempted this batch
 * and failed.
 */
export function selectFindingMirrors({ findings, entities }) {
    const out = [];
    for (const f of Object.values(findings || {})) {
        if (f.mirroredAt) continue;
        const subjectPubkey = resolveSubjectPubkey(f.subject_ref, entities);
        if (!subjectPubkey) continue;
        out.push({ finding: f, subjectPubkey, maneuver: f.maneuver, sourceUrl: findingSourceUrl(f) });
    }
    out.sort((x, y) => (x.finding.created || 0) - (y.finding.created || 0));
    return out;
}

/**
 * The `revision/*` story-change edges to publish — kind-30055 links
 * whose relationship is a revision value, wire-ready on both endpoints.
 * Each entry: `{ link, source, target }` (the selectLinksToPublish
 * shape), so the reader emits them with the same builder.
 */
export function selectRevisionEdgesToPublish({ links, claims, canon }) {
    const out = [];
    for (const link of Object.values(links || {})) {
        if (!REVISION_RELATIONSHIPS.includes(link.relationship)) continue;
        if (link.publishedAt && (link.updated || 0) <= link.publishedAt) continue;
        const source = claimWireInfo(claims, canon(link.source_claim_id), link.source_snapshot || {});
        const target = claimWireInfo(claims, canon(link.target_claim_id), link.target_snapshot || {});
        if (!source || !target) continue;
        out.push({ link, source, target });
    }
    out.sort((x, y) => (x.link.created || 0) - (y.link.created || 0));
    return out;
}
