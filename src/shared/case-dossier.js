// Case dossier — CD.1 orbit assembler
// (docs/CASE_DOSSIER_DESIGN.md §3, §6).
//
// `assembleCaseDossier(caseEntityId)` composes one case entity's orbit
// into the DERIVED, computed-on-read structure the portal case view
// (CD.2/CD.3/CD.4) renders. Following the design's §2 posture — and
// `audit/dossier.js` / `truth-entity-record.js` before it — it is:
//
//   - **read-only and side-effect-free**: it reads Storage, never
//     writes; it mutates nothing it reads.
//   - **deterministic**: no Date.now / Math.random; every ordering has
//     an explicit tiebreak, so the same events derive the same dossier
//     (the export/bundle determinism contract, §5).
//   - **no case-level score** (§2 principle 2): the honest headline is
//     the verdict-state DISTRIBUTION over the case's propositions, never
//     a fused number.
//   - **verdicts attach to propositions, never a person** — the join is
//     proposition_id → verdict chain head; no p-tag is consulted.
//
// SCOPE BOUNDARY (deliberate; see docs/JOURNAL.md 2026-07-03). This
// assembler spans the truth/claim/entity/link model, which is
// `chrome.storage.local`-backed and fully deterministic. Two of the
// design's §3 ingredients live OUTSIDE that model and are supplied by
// the rendering slices, which hold the portal's library/archive index:
//
//   - the §3.1 PREDICTION counts (audit-cache is keyed by article
//     x-hash; scoping to the orbit needs a url→hash index CD.1 doesn't
//     have), and
//   - the §3.3 PUBLICATION and CAPTURE timeline axes (article-metadata
//     and archive-cache timestamps).
//
// CD.1 therefore emits the WORLD-TIME and JUDGMENT-TIME axes (both are
// pure functions of the truth model) plus `article_urls`, so CD.3 can
// join the other two axes without CD.1 taking an IndexedDB dependency.

import { ClaimModel } from './claim-model.js';
import { EntityModel } from './entity-model.js';
import { EvidenceLinker } from './evidence-linker.js';
import {
    TruthAdjudicationModel, VerdictModel, verdictVariance
} from './truth-adjudication-model.js';
import { IntegrityModel } from './integrity-model.js';
import { ForensicModel } from './forensic-model.js';
import { attestationConvergence } from './truth-attestation.js';
import { makeClaimRefCanonicalizer } from './claim-ref.js';

// ------------------------------------------------------------------
// Small deterministic helpers
// ------------------------------------------------------------------

/** Lower-cased, collapsed-whitespace key for a name/label match. */
function normName(s) {
    return String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** at ascending with nulls last, then a stable string tiebreak. */
function byTimeThen(a, b, aKey, bKey) {
    const at = a === null || a === undefined;
    const bt = b === null || b === undefined;
    if (at && bt) return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
    if (at) return 1;
    if (bt) return -1;
    if (a !== b) return a - b;
    return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
}

// ------------------------------------------------------------------
// Orbit
// ------------------------------------------------------------------

/**
 * The case's orbit, mirroring case-bundle/case-export membership:
 * claims whose `about` includes the case entity, and the union of those
 * claims' `about` entities + entity sources (+ their canonical targets,
 * alias depth ≤ 1).
 */
function buildOrbit(caseEntityId, allClaims, allEntities) {
    const orbitClaims = allClaims
        .filter((c) => (c.about || []).includes(caseEntityId))
        .sort((a, b) => (b.is_key ? 1 : 0) - (a.is_key ? 1 : 0)
                     || (a.created || 0) - (b.created || 0)
                     || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    const entityIds = new Set([caseEntityId]);
    for (const c of orbitClaims) {
        for (const id of c.about || []) entityIds.add(id);
        if (c.source && /^entity_/.test(c.source)) entityIds.add(c.source);
    }
    for (const id of [...entityIds]) {
        const rec = allEntities[id];
        if (rec && rec.canonical_id) entityIds.add(rec.canonical_id);
    }
    return { orbitClaims, entityIds };
}

// ------------------------------------------------------------------
// Union-find for contradiction clusters
// ------------------------------------------------------------------

function makeUF() {
    const parent = new Map();
    const find = (x) => {
        if (!parent.has(x)) parent.set(x, x);
        let r = x;
        while (parent.get(r) !== r) r = parent.get(r);
        // path-compress
        let cur = x;
        while (parent.get(cur) !== r) { const next = parent.get(cur); parent.set(cur, r); cur = next; }
        return r;
    };
    const union = (a, b) => { parent.set(find(a), find(b)); };
    return { find, union };
}

// ------------------------------------------------------------------
// Sections
// ------------------------------------------------------------------

/** §3.1 propositions with their active verdict head + full chain. */
function assemblePropositions(orbitClaimIds, allPropositions, verdictsByProp, claimsById) {
    const orbit = allPropositions.filter((p) => orbitClaimIds.has(p.claim_id));
    const rows = orbit.map((p) => {
        const chain = (verdictsByProp.get(p.id) || [])
            .slice()
            .sort((a, b) => (a.created || 0) - (b.created || 0)
                         || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        const head = chain.find((v) => !v.superseded_by) || null;
        return {
            proposition:      p,
            claim:            claimsById.get(p.claim_id) || null,
            chain,
            head,
            superseded_count: chain.filter((v) => v.superseded_by).length
        };
    });
    // Stable order: propositions by their claim order then id.
    rows.sort((a, b) => (a.proposition.created || 0) - (b.proposition.created || 0)
                     || (a.proposition.id < b.proposition.id ? -1 : 1));
    return rows;
}

/** §3.2 contradiction clusters — connected components over orbit-touching `contradicts` edges. */
function assembleContradictionClusters(orbitClaimIds, allLinks, canon) {
    const uf = makeUF();
    const touched = [];
    for (const l of allLinks) {
        if (l.relationship !== 'contradicts') continue;
        const a = canon(l.source_claim_id);
        const b = canon(l.target_claim_id);
        if (!orbitClaimIds.has(a) && !orbitClaimIds.has(b)) continue;
        touched.push({ link: l, a, b });
        uf.union(a, b);
    }
    const byRoot = new Map();
    for (const { link, a, b } of touched) {
        const root = uf.find(a);
        if (!byRoot.has(root)) {
            byRoot.set(root, { claim_refs: new Set(), link_ids: [], earliest: Infinity });
        }
        const g = byRoot.get(root);
        g.claim_refs.add(a);
        g.claim_refs.add(b);
        g.link_ids.push(link.id);
        if ((link.created || 0) < g.earliest) g.earliest = link.created || 0;
    }
    const clusters = [...byRoot.values()].map((g) => ({
        claim_refs: [...g.claim_refs].sort(),
        link_ids:   g.link_ids.slice().sort(),
        contradicts_count: g.link_ids.length,
        earliest:   g.earliest === Infinity ? 0 : g.earliest
    }));
    clusters.sort((a, b) => a.earliest - b.earliest
                         || (a.claim_refs[0] < b.claim_refs[0] ? -1
                            : a.claim_refs[0] > b.claim_refs[0] ? 1 : 0));
    return clusters.map(({ earliest, ...rest }) => rest);   // drop the sort key
}

/**
 * Best-effort join of a forensic subject_ref to an orbit entity. The
 * forensic layer keys subjects by identity_id / pubkey / account /
 * label, NOT entity_id, so the join is intentionally conservative:
 * exact identity_id/pubkey match against an orbit entity, else a
 * normalized-label == entity-name match. Returns the matched entity id
 * or null (an unmatched finding is simply not in the orbit — honest).
 */
function forensicOrbitEntityId(finding, orbitEntities) {
    const ref = finding.subject_ref || {};
    for (const e of orbitEntities) {
        const pubkey = e.keypair && e.keypair.pubkey;
        if (ref.identity_id && ref.identity_id === e.id) return e.id;
        if (ref.pubkey && pubkey && ref.pubkey === pubkey) return e.id;
    }
    if (ref.label) {
        const key = normName(ref.label);
        for (const e of orbitEntities) {
            if (key && normName(e.name) === key) return e.id;
        }
    }
    return null;
}

/** §3.5 entities × roles-in-this-case. */
function assembleEntities(caseEntityId, orbitClaims, entityIds, allEntities,
                          integrityFindings, forensicMatched) {
    const rows = new Map();   // id → {entity_id, name, type, roles:Set}
    const ensure = (id) => {
        if (!rows.has(id)) {
            const e = allEntities[id];
            rows.set(id, {
                entity_id: id,
                name:      e ? e.name : '(missing entity)',
                type:      e ? e.type : null,
                roles:     new Set()
            });
        }
        return rows.get(id);
    };
    ensure(caseEntityId).roles.add('case');
    for (const c of orbitClaims) {
        for (const id of c.about || []) {
            if (id !== caseEntityId) ensure(id).roles.add('about');
        }
        if (c.source && /^entity_/.test(c.source)) ensure(c.source).roles.add('source');
    }
    for (const f of integrityFindings) {
        for (const id of f.entity_ids || []) {
            if (entityIds.has(id)) ensure(id).roles.add('integrity-subject');
        }
    }
    for (const { entityId, finding } of forensicMatched) {
        ensure(entityId).roles.add(`forensic:${finding.role}`);
    }
    return [...rows.values()]
        .map((r) => ({ ...r, roles: [...r.roles].sort() }))
        .sort((a, b) => (normName(a.name) < normName(b.name) ? -1
                        : normName(a.name) > normName(b.name) ? 1
                        : a.entity_id < b.entity_id ? -1 : 1));
}

/** §3.3 world-time + judgment-time events, axis-tagged and flat. */
function assembleTimeline(propositionRows, integrityFindings, forensicMatched, propsById) {
    const events = [];

    for (const row of propositionRows) {
        const p = row.proposition;
        if (p.occurred_at !== null && p.occurred_at !== undefined) {
            events.push({
                axis:      'world',
                kind:      'proposition',
                at:        p.occurred_at,
                precision: p.occurred_precision || null,
                ref:       p.id,
                label:     p.proposition_class
            });
        }
        for (const v of row.chain) {
            events.push({
                axis:      'judgment',
                kind:      v.superseded_by ? 'verdict-superseded' : 'verdict',
                at:        v.created || null,
                precision: null,
                ref:       v.id,
                label:     v.verdict
            });
        }
    }

    for (const f of integrityFindings) {
        // Earliest matched deed's world-time.
        let occurredAt = null;
        let occurredPrecision = null;
        for (const deedId of f.deed_proposition_ids || []) {
            const deed = propsById.get(deedId);
            if (deed && deed.occurred_at !== null && deed.occurred_at !== undefined
                && (occurredAt === null || deed.occurred_at < occurredAt)) {
                occurredAt = deed.occurred_at;
                occurredPrecision = deed.occurred_precision || null;
            }
        }
        if (occurredAt !== null) {
            events.push({
                axis: 'world', kind: 'integrity-deed', at: occurredAt,
                precision: occurredPrecision, ref: f.id, label: f.match
            });
        }
        events.push({
            axis: 'judgment', kind: 'integrity-finding', at: f.created || null,
            precision: null, ref: f.id, label: f.match
        });
    }

    for (const { finding } of forensicMatched) {
        events.push({
            axis: 'judgment', kind: 'forensic-finding', at: finding.created || null,
            precision: null, ref: finding.id, label: finding.maneuver
        });
    }

    events.sort((a, b) => byTimeThen(a.at, b.at, `${a.kind}:${a.ref}`, `${b.kind}:${b.ref}`));
    return events;
}

// ------------------------------------------------------------------
// Public API
// ------------------------------------------------------------------

/**
 * Assemble the derived dossier for one case entity.
 *
 * @param {string} caseEntityId
 * @returns {Promise<object>} the five-section dossier (see module header)
 * @throws if the case entity does not exist
 */
export async function assembleCaseDossier(caseEntityId) {
    const caseEntity = await EntityModel.get(caseEntityId);
    if (!caseEntity) throw new Error(`Entity not found: ${caseEntityId}`);

    const [
        allClaimsMap, allEntities, allLinksMap,
        allPropositions, allVerdicts, allIntegrity, allForensicMap, canon
    ] = await Promise.all([
        ClaimModel.getAll(),
        EntityModel.getAll(),
        EvidenceLinker.getAll(),
        TruthAdjudicationModel.list(),
        VerdictModel.list(),
        IntegrityModel.list(),
        ForensicModel.getAll(),
        makeClaimRefCanonicalizer()
    ]);

    const allClaims = Object.values(allClaimsMap);
    const allLinks = Object.values(allLinksMap);
    const { orbitClaims, entityIds } = buildOrbit(caseEntityId, allClaims, allEntities);
    const orbitClaimIds = new Set(orbitClaims.map((c) => c.id));

    const claimsById = new Map(orbitClaims.map((c) => [c.id, c]));
    const propsById = new Map(allPropositions.map((p) => [p.id, p]));
    const verdictsByProp = new Map();
    for (const v of allVerdicts) {
        if (!verdictsByProp.has(v.proposition_id)) verdictsByProp.set(v.proposition_id, []);
        verdictsByProp.get(v.proposition_id).push(v);
    }

    // §3.1 propositions + verdict heads, and the case distribution.
    const propositionRows = assemblePropositions(orbitClaimIds, allPropositions, verdictsByProp, claimsById);
    const heads = propositionRows.map((r) => r.head).filter(Boolean);
    const distribution = verdictVariance(heads);

    // §3.2 knots.
    const contradictionClusters = assembleContradictionClusters(orbitClaimIds, allLinks, canon);
    // IntegrityModel.list() sorts by created only; add the id tiebreak
    // every other output array carries, so same-created findings can't
    // reorder peer-to-peer and diverge the export/bundle hash (§5).
    const integrityFindings = allIntegrity
        .filter((f) => !f.superseded_by && (f.entity_ids || []).some((id) => entityIds.has(id)))
        .sort((a, b) => (a.created || 0) - (b.created || 0)
                     || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const orbitEntities = [...entityIds].map((id) => allEntities[id]).filter(Boolean);
    const forensicMatched = [];
    for (const f of Object.values(allForensicMap)) {
        const entityId = forensicOrbitEntityId(f, orbitEntities);
        if (entityId) forensicMatched.push({ entityId, finding: f });
    }
    forensicMatched.sort((a, b) => (a.finding.created || 0) - (b.finding.created || 0)
                                || (a.finding.id < b.finding.id ? -1 : 1));

    // §3.4 evidence — orbit articles (by url) + attestation convergence.
    const articleMap = new Map();   // url → {url, claim_ids, key_claim_count}
    for (const c of orbitClaims) {
        const url = c.source_url || '';
        // A claim always carries a source_url through ClaimModel.create;
        // an empty one only survives a corrupted store. Skip it so the
        // three article surfaces (coverage.articles / evidence.articles /
        // article_urls) agree — article_urls already filters empties.
        if (!url) continue;
        if (!articleMap.has(url)) articleMap.set(url, { url, claim_ids: [], key_claim_count: 0 });
        const g = articleMap.get(url);
        g.claim_ids.push(c.id);
        if (c.is_key) g.key_claim_count += 1;
    }
    const articles = [...articleMap.values()]
        .map((g) => ({ ...g, claim_ids: g.claim_ids.slice().sort() }))
        .sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));
    const supportsLinks = allLinks.filter(
        (l) => l.relationship === 'supports' && l.attestation
            && (orbitClaimIds.has(canon(l.source_claim_id)) || orbitClaimIds.has(canon(l.target_claim_id))));
    const convergence = attestationConvergence(supportsLinks);

    // §3.5 entities × roles.
    const entities = assembleEntities(
        caseEntityId, orbitClaims, entityIds, allEntities, integrityFindings, forensicMatched);

    // §3.3 timeline (world + judgment axes).
    const timeline = assembleTimeline(propositionRows, integrityFindings, forensicMatched, propsById);

    const claimsWithPropositions = new Set(
        propositionRows.map((r) => r.proposition.claim_id)).size;

    return {
        case: {
            id:     caseEntity.id,
            name:   caseEntity.name,
            type:   caseEntity.type,
            pubkey: (caseEntity.keypair && caseEntity.keypair.pubkey) || null
        },
        coverage: {
            articles:                 articleMap.size,
            claims:                   orbitClaims.length,
            claims_with_propositions: claimsWithPropositions,
            propositions:             propositionRows.length,
            entities:                 entityIds.size
        },
        propositions: propositionRows,
        distribution,
        knots: {
            contradiction_clusters: contradictionClusters,
            integrity_findings:     integrityFindings,
            forensic_findings:      forensicMatched.map((m) => m.finding)
        },
        evidence: {
            articles,
            convergence
        },
        entities,
        timeline,
        // For the render slices (CD.2/CD.3) that hold the portal library
        // index: the orbit's article URLs, to join the prediction ledger
        // and the publication/capture timeline axes CD.1 does not carry.
        article_urls: articles.map((a) => a.url).filter(Boolean)
    };
}
