// Case dossier — CD.1, the orbit assembler (docs/CASE_DOSSIER_DESIGN.md).
//
// Assembles everything in a case entity's orbit into the five dossier
// sections (§3.1–§3.5): shape of knowledge, knots, timeline events,
// evidence groups, entities×roles. DERIVED, COMPUTED ON READ — no new
// wire kind, nothing persisted, no publish path, no relay fetch. The
// same split as `case-export.js`: a storage-aware collector
// (`collectCaseDossierData`) and pure builders (`buildCaseDossier` +
// one per section), with `generatedAt` injected so output is fully
// deterministic. There is deliberately NO clock read in this module —
// "overdue"-style derivations belong to the render layer (CD.2/CD.3).
//
// Membership is asymmetric by design and worth restating (§1, §3.2):
//   - §3.1 propositions are CLAIM-mediated (a proposition's claim has
//     the case in `about`);
//   - §3.2 integrity findings are ENTITY-mediated (a finding's
//     `entity_ids` intersects the orbit) — a finding about an orbit
//     person belongs to the case even when its word/deed claims were
//     captured under other folders.
//
// Inputs that are not chrome.storage are injectable with live
// defaults (`options.x ?? live read`): the archive + audit IndexedDB
// reads, and `wire` — other authors' parsed relay items — which is
// injection-ONLY: this module never opens a relay, and output must
// never depend on when "Load from relays" was clicked. Disagreement
// is data: verdict/match variance objects render side-by-side counts
// and NEVER merge (P5); there is no case-level score of any kind (P2).

import { EntityModel } from './entity-model.js';
import { ClaimModel } from './claim-model.js';
import { parseMetaDate } from './dossier-time.js';
import { EvidenceLinker } from './evidence-linker.js';
import { TruthAdjudicationModel, VerdictModel, verdictVariance } from './truth-adjudication-model.js';
import { IntegrityModel, matchVariance } from './integrity-model.js';
import { ForensicModel } from './forensic-model.js';
import { attestationConvergence } from './truth-attestation.js';
import { makeClaimRefCanonicalizer, isLocalClaimId } from './claim-ref.js';
import { collectCaseEntityIds } from './case-bundle.js';
import { listArticles } from './archive-cache.js';
import { listPredictions, listResolutions, listRuns } from './audit/audit-cache.js';
import { Utils } from './utils.js';

// ------------------------------------------------------------------
// Gather (storage-aware)
// ------------------------------------------------------------------

/**
 * Collect everything the pure builders need for one case. Bulk reads
 * only — one canonicalizer snapshot, one pass over each model map —
 * never the per-record N×get walk.
 *
 * options:
 *   articles, predictions, resolutions, auditRuns — injected arrays;
 *       default to the live IndexedDB reads (`?? `, so `[]` is honored)
 *   wire — { verdicts:[], findings:[], articles:[] } parsed relay
 *       items from OTHER authors; injection-only, defaults empty.
 *       wire.verdicts/findings must carry the local proposition ids
 *       they rule on (`proposition_id` / `word_proposition_id`) — the
 *       caller owns that coordinate→proposition mapping.
 *   forensicSubjectRefs — { entityId → subject_ref } caller-asserted
 *       bridges into the forensic subject keyspace (stamped
 *       `matched_via: 'caller'`).
 */
export async function collectCaseDossierData(caseEntityId, options = {}) {
    const caseEntity = await EntityModel.get(caseEntityId);
    if (!caseEntity) throw new Error(`Entity not found: ${caseEntityId}`);
    if (caseEntity.type !== 'case') {
        throw new Error(`Entity ${caseEntityId} is not a case (type: ${caseEntity.type})`);
    }

    const [allClaims, allEntities, allLinks, allPropositions, allVerdicts,
           allIntegrity, canon, orbitEntityIds] = await Promise.all([
        ClaimModel.getAll(),
        EntityModel.getAll(),
        EvidenceLinker.getAll(),
        TruthAdjudicationModel.list(),
        VerdictModel.list(),
        IntegrityModel.list(),
        makeClaimRefCanonicalizer(),
        collectCaseEntityIds(caseEntityId)
    ]);

    const articles    = options.articles    ?? await listArticles();
    const predictions = options.predictions ?? await listPredictions();
    const resolutions = options.resolutions ?? await listResolutions();
    const auditRuns   = options.auditRuns   ?? await listRuns();
    const wire = {
        verdicts: [], findings: [], articles: [],
        ...(options.wire || {})
    };
    const forensicSubjectRefs = options.forensicSubjectRefs || {};

    // Orbit entities (sorted for determinism), resolved records.
    const entityIds = [...orbitEntityIds].sort();
    const orbitEntities = [];
    const danglingEntityIds = [];
    for (const id of entityIds) {
        if (allEntities[id]) orbitEntities.push(allEntities[id]);
        else danglingEntityIds.push(id);
    }

    // Tag-membership key set (Phase 20.1): the case's whole alias
    // family — an archive record tagged with an alias of the case is
    // still a member. Claims keep the case-id spine (E3 canonicalizes
    // claim tags to the root at authoring time).
    const family = await EntityModel.aliasFamily(caseEntityId, allEntities);
    const membershipIds = (family && family.ids && family.ids.length)
        ? family.ids : [caseEntityId];

    // Orbit claims: claim-mediated membership (about includes the case),
    // key-first then oldest-first (the case-export order).
    const orbitClaims = Object.values(allClaims)
        .filter((c) => (c.about || []).includes(caseEntityId))
        .sort((a, b) => (b.is_key ? 1 : 0) - (a.is_key ? 1 : 0) || (a.created || 0) - (b.created || 0));
    const orbitClaimIds = new Set(orbitClaims.map((c) => c.id));

    // Propositions: the full map (integrity deed refs may point outside
    // the orbit) + the claim-mediated orbit subset.
    const propositionsById = {};
    for (const p of allPropositions) propositionsById[p.id] = p;
    const orbitPropositions = allPropositions.filter((p) => orbitClaimIds.has(p.claim_id));

    // Verdict chains grouped per proposition (list() is oldest-first,
    // so each chain arrives oldest-first).
    const verdictsByProposition = {};
    for (const v of allVerdicts) {
        (verdictsByProposition[v.proposition_id] ||= []).push(v);
    }

    // Integrity chain heads with an orbit entity among the subjects
    // (entity-mediated membership — see the header note).
    const orbitEntityIdSet = new Set(entityIds);
    const integrityHeads = allIntegrity.filter((f) =>
        !f.superseded_by
        && Array.isArray(f.entity_ids)
        && f.entity_ids.some((id) => orbitEntityIdSet.has(id)));

    const forensic = await collectForensicBridge(orbitEntities, forensicSubjectRefs, { excludeId: caseEntityId });

    // Links, endpoints pre-canonicalized once.
    const contradicts = [];
    const attestations = [];
    const orbitClaimIdForProposition = new Set(orbitPropositions.map((p) => p.claim_id));
    for (const link of Object.values(allLinks)) {
        const sourceRef = canon(link.source_claim_id);
        const targetRef = canon(link.target_claim_id);
        const withRefs = { ...link, source_ref: sourceRef, target_ref: targetRef };
        if (link.relationship === 'contradicts'
                && (orbitClaimIds.has(sourceRef) || orbitClaimIds.has(targetRef))) {
            contradicts.push(withRefs);
        }
        if (link.relationship === 'supports' && link.attestation
                && orbitClaimIdForProposition.has(targetRef)) {
            attestations.push(withRefs);
        }
    }
    // Contradicts in id order (deterministic knot node ordering).
    // Attestations in AUTHORING order (created, then id) — the
    // convergence baseline is the earliest-authored origin, so this
    // order must reach attestationConvergence intact.
    const byIdAsc = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    contradicts.sort(byIdAsc);
    attestations.sort((a, b) => (a.created || 0) - (b.created || 0) || byIdAsc(a, b));

    return {
        case: {
            id:     caseEntity.id,
            name:   caseEntity.name,
            type:   caseEntity.type,
            pubkey: (caseEntity.keypair && caseEntity.keypair.pubkey) || caseEntity.foreign_pubkey || null
        },
        membership_ids: membershipIds,
        // Full entity registry snapshot (Phase 20.3) — the case graph
        // resolves names for entities TAGGED on member articles that
        // never entered an orbit claim (so aren't in orbit.entities).
        // Builders ignore it; it only rides for graph consumers.
        entitiesById: allEntities,
        orbit: {
            entity_ids:          entityIds,
            entities:            orbitEntities,
            dangling_entity_ids: danglingEntityIds,
            claims:              orbitClaims
        },
        claimsById:    allClaims,
        propositions:  { all: propositionsById, orbit: orbitPropositions },
        verdicts:      { byProposition: verdictsByProposition },
        integrity:     integrityHeads,
        integrityAll:  allIntegrity,
        forensic,
        links:         { contradicts, attestations },
        articles,
        predictions,
        resolutions,
        auditRuns,
        wire
    };
}

// ------------------------------------------------------------------
// Shared pure derivations
// ------------------------------------------------------------------

/** Earliest matched deed's world-time for an integrity finding — the
 *  same rule as IntegrityModel.timelineForEntity, re-derived purely
 *  from the full proposition map so shared findings aren't re-fetched
 *  per entity. */
function earliestDeedDate(finding, propositionsById) {
    let best = null;
    for (const deedId of finding.deed_proposition_ids || []) {
        const deed = propositionsById[deedId];
        if (!deed || deed.occurred_at === null || deed.occurred_at === undefined) continue;
        if (!best || deed.occurred_at < best.occurred_at) {
            best = { occurred_at: deed.occurred_at, occurred_precision: deed.occurred_precision || 'exact' };
        }
    }
    return best;
}

// parseMetaDate moved to dossier-time.js (Phase 19.1) — shared with
// the entity-facts layer; behavior unchanged, tests stand.

/**
 * One row per distinct orbit source (normalized claim URL), enriched
 * with the archive record when one exists. Used by both the evidence
 * table and the timeline so their article views cannot drift.
 * Archive records carry no canonical content hash, so the local join
 * is by normalized URL; hashes ride in from the claims (and are what
 * audit runs / predictions join on).
 */
export function deriveArticleRows(data) {
    const byUrl = new Map();   // normalized url → row
    for (const claim of data.orbit.claims) {
        const url = Utils.normalizeUrl(claim.source_url || '');
        if (!url) continue;
        if (!byUrl.has(url)) {
            byUrl.set(url, { url, claims: [], article_hashes: new Set() });
        }
        const row = byUrl.get(url);
        row.claims.push(claim);
        if (claim.article_hash) row.article_hashes.add(claim.article_hash);
    }

    const archiveByUrl = new Map();
    for (const rec of data.articles || []) {
        if (rec && rec.url) archiveByUrl.set(rec.url, rec);
    }

    const memberIds = new Set(data.membership_ids || [data.case.id]);
    const taggedWithMember = (rec) => ((rec && rec.article && rec.article.entities) || [])
        .some((e) => e && memberIds.has(e.entity_id));

    const rows = [];
    for (const url of [...byUrl.keys()].sort()) {
        const { claims, article_hashes } = byUrl.get(url);
        const rec = archiveByUrl.get(url) || null;
        const article = (rec && rec.article) || null;
        rows.push({
            url,
            title:          (article && article.title) || null,
            article_hashes: [...article_hashes].sort(),
            published:      article ? parseMetaDate(article.date || article.publishedTime) : null,
            captured_at:    rec ? (rec.cachedAt || null) : null,
            capture: {
                archived:           !!rec,
                screenshot:         !!(article && article.evidence && article.evidence.screenshot),
                published_to_relay: !!(rec && rec.publishedToRelay)
            },
            // Outbound links as captured (null = capture predates link
            // extraction — "not captured", never "zero links").
            links: (article && Array.isArray(article.links)) ? article.links : null,
            claims,
            processed:  true,
            membership: taggedWithMember(rec) ? 'both' : 'claims'
        });
    }

    // Tag-membership sources with zero orbit claims (Phase 20.1 union
    // membership): archive records tagged with a MEMBER entity are
    // FIRST-CLASS rows — same shape, claims empty, `processed:false`
    // carrying the "no claims extracted yet" state on the row. The
    // hashes ride from the record itself so audit runs still join.
    // (Pre-20.1 these were `unprocessed/local-tag` footnotes; the
    // unprocessed list now carries only wire-injected 32125 items.)
    for (const rec of data.articles || []) {
        if (!rec || !rec.url) continue;
        const url = Utils.normalizeUrl(rec.url) || rec.url;
        if (byUrl.has(url) || rows.some((r) => r.url === url)) continue;
        if (!taggedWithMember(rec)) continue;
        const article = rec.article || null;
        rows.push({
            url,
            title:          (article && article.title) || null,
            article_hashes: rec.articleHash ? [rec.articleHash] : [],
            published:      article ? parseMetaDate(article.date || article.publishedTime) : null,
            captured_at:    rec.cachedAt || null,
            capture: {
                archived:           true,
                screenshot:         !!(article && article.evidence && article.evidence.screenshot),
                published_to_relay: !!rec.publishedToRelay
            },
            links: (article && Array.isArray(article.links)) ? article.links : null,
            claims:     [],
            processed:  false,
            membership: 'tag'
        });
    }
    rows.sort((a, b) => a.url < b.url ? -1 : a.url > b.url ? 1 : 0);

    const unprocessed = [];
    for (const item of data.wire.articles || []) {
        const url = Utils.normalizeUrl((item && item.url) || '');
        if (!url || byUrl.has(url) || rows.some((r) => r.url === url)) continue;
        unprocessed.push({ url, title: (item && item.title) || null, source: 'wire-32125' });
    }
    unprocessed.sort((a, b) => a.url < b.url ? -1 : a.url > b.url ? 1 : 0);

    return { rows, unprocessed };
}

// ------------------------------------------------------------------
// Forensic bridge (shared with entity-dossier.js, Phase 19.3)
// ------------------------------------------------------------------

/**
 * Forensic findings live in a different keyspace (subject_ref:
 * identity/pubkey/account/label — not entity ids). Per entity, build
 * the candidate cascade — caller-asserted ref, then pubkey, then name
 * label — and stamp `matched_via` on every row. An entity with no
 * bridge and no match emits an `{matched_via: null, finding: null}`
 * marker (except `excludeId`, the dossier's own subject/case record).
 * Extracted verbatim from the case collector; storage-aware
 * (ForensicModel reads).
 */
export async function collectForensicBridge(entities, forensicSubjectRefs = {}, { excludeId = null } = {}) {
    const forensic = [];
    for (const entity of entities || []) {
        const candidates = [];
        if (forensicSubjectRefs[entity.id]) {
            candidates.push({ via: 'caller', ref: forensicSubjectRefs[entity.id] });
        }
        const pubkey = (entity.keypair && entity.keypair.pubkey) || entity.foreign_pubkey || null;
        if (pubkey) candidates.push({ via: 'pubkey', ref: { pubkey } });
        if (entity.name) candidates.push({ via: 'label', ref: { label: entity.name } });

        const seen = new Set();
        for (const { via, ref } of candidates) {
            for (const finding of await ForensicModel.getForSubject(ref)) {
                if (seen.has(finding.id)) continue;
                seen.add(finding.id);
                forensic.push({ entity_id: entity.id, matched_via: via, finding });
            }
        }
        if (!forensicSubjectRefs[entity.id] && !pubkey && seen.size === 0
                && entity.id !== excludeId) {
            forensic.push({ entity_id: entity.id, matched_via: null, finding: null });
        }
    }
    return forensic;
}

// ------------------------------------------------------------------
// §3.1 Shape of knowledge
// ------------------------------------------------------------------

export function buildShapeOfKnowledge(data) {
    const claimText = (id) => (data.claimsById[id] && data.claimsById[id].text) || null;

    const propositions = [];
    const byState = {};
    const byStandard = {};
    let unadjudicated = 0;
    for (const p of data.propositions.orbit) {
        const chain = data.verdicts.byProposition[p.id] || [];
        const head = chain.find((v) => !v.superseded_by) || null;
        const wireForProp = (data.wire.verdicts || []).filter((w) => w && w.proposition_id === p.id);
        if (head) {
            byState[head.verdict] = (byState[head.verdict] || 0) + 1;
            byStandard[head.standard_of_proof] = (byStandard[head.standard_of_proof] || 0) + 1;
        } else {
            unadjudicated += 1;
        }
        propositions.push({
            proposition_id:     p.id,
            claim_id:           p.claim_id,
            claim_text:         claimText(p.claim_id),
            proposition_class:  p.proposition_class,
            occurred_at:        p.occurred_at ?? null,
            occurred_precision: p.occurred_precision ?? null,
            verdict_head: head ? {
                id:                head.id,
                verdict:           head.verdict,
                standard_of_proof: head.standard_of_proof,
                caveats:           head.caveats || [],
                created:           head.created,
                chain_length:      chain.length
            } : null,
            // Disagreement is data (P5): local head beside other
            // authors' rulings, counted, never merged.
            variance: verdictVariance([...(head ? [head] : []), ...wireForProp])
        });
    }

    // Prediction ledger scoped to the orbit's article hashes. Open vs
    // resolved comes from the stored status — no clock, no "overdue".
    const orbitHashes = new Set();
    for (const c of data.orbit.claims) if (c.article_hash) orbitHashes.add(c.article_hash);
    const entries = (data.predictions || [])
        .filter((p) => p && orbitHashes.has(p.articleHash))
        .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
        .map((p) => ({
            id:                p.id,
            text:              p.text,
            hedge_level:       p.hedge_level ?? null,
            horizon_iso:       p.horizon_iso ?? null,
            resolution_status: p.resolution_status || 'open',
            article_hash:      p.articleHash,
            resolutions: (data.resolutions || [])
                .filter((r) => r && (r.prediction_coord || '').endsWith(p.id) && r.article_hash === p.articleHash)
                .sort((a, b) => (a.resolved_at || 0) - (b.resolved_at || 0))
                .map((r) => ({ outcome: r.outcome, resolved_at: r.resolved_at ?? null }))
        }));

    const claimsWithPropositions = new Set(data.propositions.orbit.map((p) => p.claim_id)).size;

    return {
        propositions,
        distribution: {
            by_state:       byState,
            unadjudicated,
            by_standard:    byStandard,
            states_present: Object.keys(byState).sort(),
            total:          data.propositions.orbit.length
        },
        predictions: {
            open:     entries.filter((e) => e.resolution_status === 'open').length,
            resolved: entries.filter((e) => e.resolution_status !== 'open').length,
            entries
        },
        coverage: {
            claims:                    data.orbit.claims.length,
            claims_with_propositions:  claimsWithPropositions,
            propositions:              data.propositions.orbit.length
        }
    };
}

// ------------------------------------------------------------------
// §3.2 Knots
// ------------------------------------------------------------------

export function buildKnots(data) {
    // Contradiction clusters: connected components over the orbit's
    // contradicts edges. The knot — not the individual contradicted
    // claim — is the unit of interest.
    const parent = new Map();
    const find = (x) => {
        while (parent.get(x) !== x) {
            parent.set(x, parent.get(parent.get(x)));
            x = parent.get(x);
        }
        return x;
    };
    const union = (a, b) => {
        if (!parent.has(a)) parent.set(a, a);
        if (!parent.has(b)) parent.set(b, b);
        const ra = find(a), rb = find(b);
        if (ra !== rb) parent.set(ra, rb);
    };
    const nodeInfo = new Map();   // ref → {ref, local, text, url, author_pubkey}
    const noteNode = (ref, snap) => {
        if (nodeInfo.has(ref)) return;
        if (isLocalClaimId(ref)) {
            const rec = data.claimsById[ref];
            nodeInfo.set(ref, {
                ref, local: true,
                text: (rec && rec.text) || '',
                url:  (rec && rec.source_url) || '',
                author_pubkey: null
            });
        } else {
            nodeInfo.set(ref, {
                ref, local: false,
                text: (snap && snap.text) || '',
                url:  (snap && snap.url) || '',
                author_pubkey: (snap && snap.author_pubkey) || null
            });
        }
    };
    for (const link of data.links.contradicts) {
        union(link.source_ref, link.target_ref);
        noteNode(link.source_ref, link.source_snapshot);
        noteNode(link.target_ref, link.target_snapshot);
    }
    const members = new Map();    // root → Set<ref>
    for (const ref of nodeInfo.keys()) {
        const root = find(ref);
        (members.get(root) || members.set(root, new Set()).get(root)).add(ref);
    }
    const contradictions = [...members.values()].map((refs) => {
        const nodes = [...refs].sort().map((r) => nodeInfo.get(r));
        const edges = data.links.contradicts
            .filter((l) => refs.has(l.source_ref) && refs.has(l.target_ref))
            .map((l) => ({
                link_id:      l.id,
                source_ref:   l.source_ref,
                target_ref:   l.target_ref,
                note:         l.note || '',
                suggested_by: l.suggested_by || 'user'
            }));
        return { size: nodes.length, nodes, edges };
    }).sort((a, b) => b.size - a.size
        || (a.nodes[0].ref < b.nodes[0].ref ? -1 : a.nodes[0].ref > b.nodes[0].ref ? 1 : 0));

    // Words-vs-deeds gaps: integrity chain heads on orbit entities,
    // world-timed by their earliest matched deed. Variance over every
    // head ruling on the same word proposition (+ injected wire
    // findings) — side by side, never merged.
    const headsByWord = {};
    for (const f of data.integrityAll || []) {
        if (!f.superseded_by) (headsByWord[f.word_proposition_id] ||= []).push(f);
    }
    const integrity = data.integrity.map((f) => {
        const when = earliestDeedDate(f, data.propositions.all);
        const wireForWord = (data.wire.findings || [])
            .filter((w) => w && w.word_proposition_id === f.word_proposition_id);
        return {
            finding_id:           f.id,
            word_proposition_id:  f.word_proposition_id,
            deed_proposition_ids: f.deed_proposition_ids || [],
            match:                f.match,
            standard_of_proof:    f.standard_of_proof,
            gap:                  f.gap || null,
            entity_ids:           f.entity_ids || [],
            occurred_at:          when ? when.occurred_at : null,
            occurred_precision:   when ? when.occurred_precision : null,
            variance: matchVariance([...(headsByWord[f.word_proposition_id] || []), ...wireForWord])
        };
    });

    const forensic = data.forensic
        .filter((row) => row.finding)
        .map((row) => ({
            entity_id:   row.entity_id,
            matched_via: row.matched_via,
            finding_id:  row.finding.id,
            role:        row.finding.role,
            maneuver:    row.finding.maneuver,
            basis:       row.finding.basis || null,
            created:     row.finding.created
        }));
    const unbridged = data.forensic.filter((row) => !row.finding && row.matched_via === null).length;

    return {
        contradictions,
        integrity,
        forensic,
        coverage: {
            contradiction_edges:              data.links.contradicts.length,
            clusters:                         contradictions.length,
            integrity_findings:               integrity.length,
            forensic_findings:                forensic.length,
            entities_without_subject_bridge:  unbridged
        }
    };
}

// ------------------------------------------------------------------
// §3.3 Timeline events (axis-tagged) + gap callouts (CD.3)
// ------------------------------------------------------------------

const GAP_DAY = 86400;
// Precision uncertainty windows, generous so a gap is flagged only when
// it clears the coarser side's band — under-flagging beats a false
// "fabrication" callout (P4: never manufacture precision).
const PRECISION_WINDOW = { exact: 0, day: GAP_DAY, month: 31 * GAP_DAY, year: 366 * GAP_DAY };
const precisionWindow = (p) => PRECISION_WINDOW[p] ?? 0;
// "Long after" threshold for late-preservation. A named constant, not a
// clock read; tunable once the corpus says what "long" is (§3.3).
const CAPTURE_LAG_SECONDS = 365 * GAP_DAY;

/**
 * The three §3.3 gap callouts — the value-add no flat link folder has.
 * Pure over the collector `data` (pairing needs claim→article→
 * proposition structure the flat events array has already flattened
 * away). Precision-aware: a comparison must clear the coarser band's
 * window before it counts, so a year-precision date never fabricates a
 * day-level anomaly. Returns a deterministically-sorted array.
 */
export function buildTimelineGaps(data, articleRows = null) {
    const gaps = [];
    const { rows } = articleRows || deriveArticleRows(data);

    // Propositions indexed by their underlying claim id (orbit only).
    const propsByClaim = new Map();
    for (const p of data.propositions.orbit) {
        (propsByClaim.get(p.claim_id) || propsByClaim.set(p.claim_id, []).get(p.claim_id)).push(p);
    }

    for (const row of rows) {
        const pub = row.published;   // { at, precision } | null
        // published-before-occurred: the source discussed an event
        // before it happened (prediction — or fabrication).
        if (pub) {
            for (const c of row.claims) {
                for (const p of propsByClaim.get(c.id) || []) {
                    if (p.occurred_at === null || p.occurred_at === undefined) continue;
                    const slack = Math.max(precisionWindow(pub.precision), precisionWindow(p.occurred_precision));
                    if (p.occurred_at - pub.at > slack) {
                        gaps.push({
                            kind:               'published-before-occurred',
                            article_url:        row.url,
                            claim_id:           c.id,
                            proposition_id:     p.id,
                            published_at:       pub.at,
                            occurred_at:        p.occurred_at,
                            occurred_precision: p.occurred_precision || 'exact',
                            lead_seconds:       p.occurred_at - pub.at
                        });
                    }
                }
            }
            // capture-long-after-publication: late preservation, a
            // weaker archival claim.
            if (row.captured_at && row.captured_at - pub.at > CAPTURE_LAG_SECONDS) {
                gaps.push({
                    kind:         'capture-long-after-publication',
                    article_url:  row.url,
                    published_at: pub.at,
                    captured_at:  row.captured_at,
                    lag_seconds:  row.captured_at - pub.at
                });
            }
        }
    }

    // story-changed-after-event: a ruling superseded after the world
    // event it concerns — the narrative moved once the facts were in.
    for (const p of data.propositions.orbit) {
        if (p.occurred_at === null || p.occurred_at === undefined) continue;
        const chain = data.verdicts.byProposition[p.id] || [];
        if (chain.length < 2) continue;
        const head = chain.find((v) => !v.superseded_by);
        if (!head || !head.created) continue;
        const slack = precisionWindow(p.occurred_precision);
        if (head.created - p.occurred_at > slack) {
            gaps.push({
                kind:               'story-changed-after-event',
                proposition_id:     p.id,
                occurred_at:        p.occurred_at,
                occurred_precision: p.occurred_precision || 'exact',
                verdict_id:         head.id,
                verdict_created:    head.created,
                chain_length:       chain.length,
                lag_seconds:        head.created - p.occurred_at
            });
        }
    }

    const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;
    const refOf = (g) => g.proposition_id || g.article_url || '';
    gaps.sort((a, b) => cmp(a.kind, b.kind) || cmp(refOf(a), refOf(b))
        || cmp(a.claim_id || '', b.claim_id || ''));
    return gaps;
}

export function buildTimelineEvents(data, articleRows = null) {
    const events = [];
    const undated = [];
    const push = (axis, kind, ref, label, when) => {
        if (when && when.at !== null && when.at !== undefined) {
            events.push({ axis, at: when.at, precision: when.precision || 'exact', kind, ref, label });
        } else {
            undated.push({ axis, kind, ref, label });
        }
    };

    // World time: propositions' occurred_at (mandatory precision — a
    // year-precision event is a year-wide band, never a fake date) and
    // integrity findings' earliest matched deed.
    for (const p of data.propositions.orbit) {
        const when = (p.occurred_at !== null && p.occurred_at !== undefined)
            ? { at: p.occurred_at, precision: p.occurred_precision || 'exact' } : null;
        push('world', 'proposition', p.id, p.proposition_class, when);
    }
    for (const f of data.integrity) {
        push('world', 'integrity-finding', f.id, f.match, earliestDeedDate(f, data.propositions.all));
    }

    const { rows } = articleRows || deriveArticleRows(data);
    for (const row of rows) {
        push('publication', 'article-published', row.url, row.title || row.url, row.published);
        if (row.captured_at) {
            push('capture', 'article-captured', row.url, row.title || row.url,
                { at: row.captured_at, precision: 'exact' });
        }
    }
    for (const c of data.orbit.claims) {
        push('capture', 'claim-captured', c.id, c.text ? c.text.slice(0, 80) : c.id,
            c.created ? { at: c.created, precision: 'exact' } : null);
    }

    // Judgment time: every verdict in every orbit chain (supersessions
    // stay visible as their own events), findings, prediction horizons
    // and resolutions.
    for (const p of data.propositions.orbit) {
        for (const v of data.verdicts.byProposition[p.id] || []) {
            push('judgment', 'verdict', v.id, v.verdict,
                v.created ? { at: v.created, precision: 'exact' } : null);
        }
    }
    for (const f of data.integrity) {
        push('judgment', 'integrity-finding', f.id, f.match,
            f.created ? { at: f.created, precision: 'exact' } : null);
    }
    for (const row of data.forensic) {
        if (!row.finding) continue;
        push('judgment', 'forensic-finding', row.finding.id, row.finding.maneuver,
            row.finding.created ? { at: row.finding.created, precision: 'exact' } : null);
    }
    const orbitHashes = new Set();
    for (const c of data.orbit.claims) if (c.article_hash) orbitHashes.add(c.article_hash);
    for (const p of (data.predictions || []).filter((p) => p && orbitHashes.has(p.articleHash))) {
        push('judgment', 'prediction-horizon', p.id, p.text ? p.text.slice(0, 80) : p.id,
            parseMetaDate(p.horizon_iso));
        for (const r of (data.resolutions || [])
                .filter((r) => r && (r.prediction_coord || '').endsWith(p.id))) {
            push('judgment', 'prediction-resolution', p.id, r.outcome || 'resolved',
                r.resolved_at ? { at: r.resolved_at, precision: 'exact' } : null);
        }
    }

    const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;
    events.sort((a, b) => a.at - b.at || cmp(a.axis, b.axis) || cmp(a.kind, b.kind) || cmp(a.ref, b.ref));
    undated.sort((a, b) => cmp(a.axis, b.axis) || cmp(a.kind, b.kind) || cmp(a.ref, b.ref));

    const byAxis = {};
    for (const e of events) byAxis[e.axis] = (byAxis[e.axis] || 0) + 1;

    const gaps = buildTimelineGaps(data, articleRows);

    return {
        events,
        undated,   // never silently dropped (P6), never faked (P4)
        gaps,      // the §3.3 cross-axis anomalies (CD.3 renders them)
        coverage: { dated: events.length, undated: undated.length, gaps: gaps.length, by_axis: byAxis }
    };
}

// ------------------------------------------------------------------
// §3.4 Evidence groups
// ------------------------------------------------------------------

export function buildEvidenceGroups(data, articleRows = null) {
    // Convergence per proposition — exact reuse of the attestation
    // grouping ("twelve outlets, one press release" collapses to one
    // origin group, derivation on its face).
    const byProposition = {};
    for (const p of data.propositions.orbit) {
        const links = data.links.attestations.filter((l) => l.target_ref === p.claim_id);
        if (links.length > 0) byProposition[p.id] = attestationConvergence(links);
    }

    const originKeysByClaim = new Map();
    for (const l of data.links.attestations) {
        if (!l.attestation || !l.attestation.origin_key) continue;
        (originKeysByClaim.get(l.target_ref) || originKeysByClaim.set(l.target_ref, new Set()).get(l.target_ref))
            .add(l.attestation.origin_key);
    }

    const runsByHash = new Map();
    const indexRun = (hash, run) => {
        if (!hash) return;
        (runsByHash.get(hash) || runsByHash.set(hash, []).get(hash)).push(run);
    };
    for (const run of data.auditRuns || []) {
        if (!run || !run.articleHash) continue;
        indexRun(run.articleHash, run);
        // Truncated-capture runs key to the SLICED text's hash; the
        // join alias carries the full capture's hash so claim-keyed
        // rows (always the full-body hash) still find the run.
        if (run.captureArticleHash && run.captureArticleHash !== run.articleHash) {
            indexRun(run.captureArticleHash, run);
        }
    }

    const { rows, unprocessed } = articleRows || deriveArticleRows(data);

    // Link edges across THIS corpus (the case's evidence set).
    const linkEdges = deriveLinkEdges({
        articles: rows.map((r) => ({ url: r.url, links: r.links })),
        corpusUrls: rows.map((r) => r.url)
    });

    const articles = rows.map((row) => {
        const originKeys = new Set();
        for (const c of row.claims) {
            for (const k of originKeysByClaim.get(c.id) || []) originKeys.add(k);
        }
        // Audit aggregates join on the canonical hash ONLY, and ship
        // raw — band/review classification is a display rule
        // (audit/display.js#auditCardChipData) and lives in CD.2 so it
        // cannot fork. Never aggregated upward (§3.4).
        const seenRunIds = new Set();
        const audit_runs = row.article_hashes
            .flatMap((h) => runsByHash.get(h) || [])
            // The two-key index could surface one run twice if a row
            // ever carried both its hashes — dedupe by run identity.
            .filter((run) => !seenRunIds.has(run.id) && seenRunIds.add(run.id))
            .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
            .map((run) => ({
                run_id:    run.id,
                auditor:   (run.auditor && run.auditor.id) || run.auditor || null,
                run_at:    run.runAt ?? null,
                aggregate: run.aggregate ?? null
            }));
        return {
            url:            row.url,
            title:          row.title,
            article_hashes: row.article_hashes,
            published_at:   row.published ? row.published.at : null,
            published_precision: row.published ? row.published.precision : null,
            captured_at:    row.captured_at,
            capture:        row.capture,
            processed:      row.processed !== false,
            membership:     row.membership || 'claims',
            claim_ids:      row.claims.map((c) => c.id),
            claims: row.claims.map((c) => ({
                claim_id:       c.id,
                text:           c.text,
                quote:          c.quote || null,
                anchor_present: !!c.anchor
            })),
            origin_keys: [...originKeys].sort(),
            audit_runs,
            links: {
                captured:     Array.isArray(row.links),
                external:     (linkEdges.links[row.url] || {}).external_count || 0,
                corpus_links: (linkEdges.links[row.url] || {}).corpus_targets || [],
                linked_by:    linkEdges.linked_by[row.url] || []
            }
        };
    });

    return {
        by_proposition: byProposition,
        articles,
        unprocessed_sources: unprocessed,
        coverage: {
            articles:             articles.length,
            articles_with_claims: articles.filter((a) => a.claim_ids.length > 0).length,
            attested_articles:    articles.filter((a) => a.origin_keys.length > 0).length,
            articles_with_audit:  articles.filter((a) => a.audit_runs.length > 0).length,
            // "No claims extracted yet" — claimless member rows plus
            // wire-injected 32125 sources (coverage on its face, P6).
            unprocessed:          articles.filter((a) => !a.processed).length + unprocessed.length
        }
    };
}

// ------------------------------------------------------------------
// Link edges — both sides of the outbound-link graph
// ------------------------------------------------------------------

/**
 * Pure both-sides view of the captured `link` tags within a corpus:
 * who an article links out to, and which corpus articles link back to
 * it. Internal links (same-host navigation) are excluded; self-links
 * are dropped; everything joins through the unified normalizer so an
 * archive capture and a direct capture meet on one URL.
 *
 * @param {{articles: Array<{url: string, links: Array<{url:string, internal?:boolean}>|null}>,
 *          corpusUrls: Iterable<string>}} input
 * @returns {{links: Object<string, {external_count:number, corpus_targets:string[]}>,
 *            linked_by: Object<string, string[]>}}
 */
export function deriveLinkEdges({ articles, corpusUrls } = {}) {
    const corpus = new Set();
    for (const u of corpusUrls || []) {
        const n = Utils.normalizeUrl(u || '');
        if (n) corpus.add(n);
    }
    const links = {};
    const linkedBy = new Map();
    for (const a of articles || []) {
        if (!a || !a.url || !Array.isArray(a.links)) continue;
        const from = Utils.normalizeUrl(a.url);
        if (!from) continue;
        const targets = new Set();
        for (const l of a.links) {
            if (!l || !l.url || l.internal) continue;
            const to = Utils.normalizeUrl(l.url);
            if (!to || to === from) continue;
            targets.add(to);
            if (corpus.has(to)) {
                if (!linkedBy.has(to)) linkedBy.set(to, new Set());
                linkedBy.get(to).add(from);
            }
        }
        links[from] = {
            external_count: targets.size,
            corpus_targets: [...targets].filter((u) => corpus.has(u)).sort()
        };
    }
    return {
        links,
        linked_by: Object.fromEntries([...linkedBy.entries()]
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([k, v]) => [k, [...v].sort()]))
    };
}

// ------------------------------------------------------------------
// §3.5 Entities involved
// ------------------------------------------------------------------

export function buildEntitiesInvolved(data) {
    const rows = new Map();   // entity_id → row
    const rowFor = (entity) => {
        if (!rows.has(entity.id)) {
            rows.set(entity.id, {
                entity_id:  entity.id,
                name:       entity.name,
                type:       entity.type,
                pubkey:     (entity.keypair && entity.keypair.pubkey) || entity.foreign_pubkey || null,
                roles:      new Map(),
                claim_count: 0,
                // The click-through handle: the coverage-capped record
                // (truth-entity-record.js) is the ONE per-person
                // surface — the dossier routes to it, never re-invents
                // or inlines it.
                record_ref: entity.id
            });
        }
        return rows.get(entity.id);
    };
    const addRole = (row, role) => row.roles.set(role, (row.roles.get(role) || 0) + 1);

    const byId = new Map(data.orbit.entities.map((e) => [e.id, e]));
    for (const claim of data.orbit.claims) {
        const counted = new Set();
        for (const id of claim.about || []) {
            if (id === data.case.id || !byId.has(id)) continue;
            const row = rowFor(byId.get(id));
            addRole(row, 'subject');
            if (!counted.has(id)) { row.claim_count += 1; counted.add(id); }
        }
        if (claim.source && /^entity_/.test(claim.source)
                && claim.source !== data.case.id && byId.has(claim.source)) {
            const row = rowFor(byId.get(claim.source));
            addRole(row, 'source');
            if (!counted.has(claim.source)) { row.claim_count += 1; counted.add(claim.source); }
        }
    }
    for (const f of data.integrity) {
        for (const id of f.entity_ids || []) {
            if (id === data.case.id || !byId.has(id)) continue;
            addRole(rowFor(byId.get(id)), 'integrity-subject');
        }
    }
    const bridged = new Set();
    for (const row of data.forensic) {
        if (!row.finding || row.entity_id === data.case.id || !byId.has(row.entity_id)) continue;
        addRole(rowFor(byId.get(row.entity_id)), row.finding.role || 'forensic-subject');
        bridged.add(row.entity_id);
    }

    const out = [...rows.values()]
        .sort((a, b) => a.entity_id < b.entity_id ? -1 : a.entity_id > b.entity_id ? 1 : 0)
        .map((row) => ({
            ...row,
            roles: [...row.roles.entries()]
                .sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)
                .map(([role, count]) => ({ role, count }))
        }));

    return {
        rows: out,
        coverage: {
            entities:             out.length,
            with_forensic_bridge: bridged.size,
            dangling:             data.orbit.dangling_entity_ids.length
        }
    };
}

// ------------------------------------------------------------------
// Assembly
// ------------------------------------------------------------------

/**
 * Pure assembly: same `data` + same `generatedAt` → deep-equal
 * dossier. The header is a DISTRIBUTION, never a number — no
 * case-level score exists anywhere in this object (P2; the only
 * score-bearing subtree is the raw per-article audit aggregates,
 * which are never rolled up).
 */
export function buildCaseDossier(data, generatedAt) {
    // Derive the article rows ONCE — three section builders consume
    // the same deterministic derivation (they accept it as an optional
    // param so direct callers/tests keep the old signatures).
    const articleRows = deriveArticleRows(data);
    const shape = buildShapeOfKnowledge(data);
    const evidence = buildEvidenceGroups(data, articleRows);
    return {
        case:         data.case,
        generated_at: generatedAt ?? null,
        coverage: {
            articles:                 evidence.coverage.articles,
            articles_with_claims:     evidence.coverage.articles_with_claims,
            claims:                   data.orbit.claims.length,
            claims_with_propositions: shape.coverage.claims_with_propositions,
            propositions:             shape.coverage.propositions,
            unprocessed_sources:      evidence.coverage.unprocessed,
            dangling_entity_ids:      data.orbit.dangling_entity_ids.length
        },
        orbit: {
            entity_ids:     data.orbit.entity_ids,
            claim_ids:      data.orbit.claims.map((c) => c.id).sort(),
            article_hashes: [...new Set(data.orbit.claims.map((c) => c.article_hash).filter(Boolean))].sort(),
            article_urls:   evidence.articles.map((a) => a.url)
        },
        shape_of_knowledge: shape,
        knots:              buildKnots(data),
        timeline:           buildTimelineEvents(data, articleRows),
        evidence,
        entities:           buildEntitiesInvolved(data)
    };
}

/** The design-doc entry point: collect + build. */
export async function assembleCaseDossier(caseEntityId, options = {}) {
    const data = await collectCaseDossierData(caseEntityId, options);
    return buildCaseDossier(data, options.generatedAt ?? null);
}
