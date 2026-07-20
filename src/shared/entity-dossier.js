// entity-dossier.js — the computed-on-read entity dossier (Phase 19.3,
// docs/ENTITY_DOSSIER_DESIGN.md §5): "wikipedia-like, but every line
// can defend itself." Assembled strictly from captured content over
// the subject's ALIAS FAMILY; recompute-on-read, nothing persisted.
//
// Same collector/builder split as case-dossier.js: the storage-aware
// `collectEntityDossierData` bulk-reads one snapshot set; the pure
// `buildEntityDossier(data, generatedAt)` derives the sections
// (identity / content / judgments / relationships — the Phase 19
// typed-fields section was retired 2026-07-20 with the fact layer)
// with NO clock reads (`generatedAt` is injected). The collector emits
// a case-dossier-SHAPE-COMPATIBLE envelope (§7.2 — the `case` key
// carries the subject descriptor by design) so the shipped timeline /
// article-row builders are imported verbatim.
//
// Firewall (§2.4/§3.5): the judgments section carries DISTRIBUTIONS
// and an `integrity_record_ref` ROUTE into truth-entity-record.js —
// never an inlined record, never a score, never a person-grade. A
// string-guard test pins grade-words out of the whole object.

import { EntityModel, canonicalIdOf } from './entity-model.js';
import { ClaimModel } from './claim-model.js';
import { AssessmentModel } from './assessment-model.js';
import { TruthAdjudicationModel, VerdictModel, verdictVariance } from './truth-adjudication-model.js';
import { IntegrityModel } from './integrity-model.js';
import { makeClaimRefCanonicalizer } from './claim-ref.js';
import { listArticles } from './archive-cache.js';
import { listPredictions, listResolutions, listRuns } from './audit/audit-cache.js';
import { Storage } from './storage.js';
import { Crypto } from './crypto.js';
import {
    deriveArticleRows, buildTimelineEvents, buildTimelineGaps, collectForensicBridge
} from './case-dossier.js';
import { equivalencePubkeys } from './entity-equivalence.js';

// ------------------------------------------------------------------
// Gather (storage-aware)
// ------------------------------------------------------------------

/**
 * One bulk read per store; injectable snapshots (`options.x ?? live`)
 * for tests and for the 19.7 publish batch, which assembles many
 * dossiers off ONE snapshot set.
 */
export async function collectEntityDossierData(entityId, options = {}) {
    const allEntities = options.entities ?? await EntityModel.getAll();
    const subjectRec = allEntities[entityId];
    if (!subjectRec) throw new Error(`Entity not found: ${entityId}`);

    const [allClaims, allAssessments, allPropositions, allVerdicts, allIntegrity, canon] =
        await Promise.all([
            options.claims       ?? ClaimModel.getAll(),
            options.assessments  ?? AssessmentModel.getAll(),
            options.propositions ?? TruthAdjudicationModel.list(),
            options.verdicts     ?? VerdictModel.list(),
            options.integrity    ?? IntegrityModel.list(),
            makeClaimRefCanonicalizer()
        ]);
    const articles    = options.articles    ?? await listArticles();
    const predictions = options.predictions ?? await listPredictions();
    const resolutions = options.resolutions ?? await listResolutions();
    const auditRuns   = options.auditRuns   ?? await listRuns();
    const wire = { verdicts: [], findings: [], articles: [], ...(options.wire || {}) };
    const forensicSubjectRefs = options.forensicSubjectRefs || {};

    // Membership = the alias family (§5), rooted at the canonical.
    const { rootId, ids } = await EntityModel.aliasFamily(entityId, allEntities);
    const familyIds = [...ids].sort();
    const familySet = new Set(familyIds);
    const root = allEntities[rootId] || subjectRec;
    const familyEntities = familyIds.map((id) => allEntities[id]).filter(Boolean);

    // Orbit membership: about OR source ∩ family. (The Phase 19 fact
    // buckets are gone with the fact layer's 2026-07-20 retirement.)
    const orbitClaims = [];
    for (const c of Object.values(allClaims)) {
        const aboutHit = (c.about || []).some((id) => familySet.has(id));
        const sourceHit = typeof c.source === 'string' && familySet.has(c.source);
        if (aboutHit || sourceHit) orbitClaims.push(c);
    }
    orbitClaims.sort((a, b) => (b.is_key ? 1 : 0) - (a.is_key ? 1 : 0)
        || (a.created || 0) - (b.created || 0));
    const byId = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    const orbitClaimIds = new Set(orbitClaims.map((c) => c.id));

    // Assessments on orbit claims (canonicalized refs), for the
    // judgments distribution.
    const assessments = Object.values(allAssessments || {})
        .filter((a) => a && a.claim_ref && orbitClaimIds.has(canon(a.claim_ref.claim_id)))
        .sort(byId);

    // Propositions + verdicts, claim-mediated (the case-dossier rule).
    const propositionsById = {};
    for (const p of allPropositions) propositionsById[p.id] = p;
    const orbitPropositions = allPropositions.filter((p) => orbitClaimIds.has(p.claim_id));
    const verdictsByProposition = {};
    for (const v of allVerdicts) {
        (verdictsByProposition[v.proposition_id] ||= []).push(v);
    }

    // Integrity chain heads with a family member among the subjects
    // (entity-mediated), and the forensic bridge over the family.
    const integrityHeads = allIntegrity.filter((f) =>
        !f.superseded_by
        && Array.isArray(f.entity_ids)
        && f.entity_ids.some((id) => familySet.has(id)));
    const forensic = await collectForensicBridge(familyEntities, forensicSubjectRefs, { excludeId: null });

    // Identity inputs: relations within the family, platform accounts,
    // equivalence pubkeys, grounded mentions from archived articles.
    // `external_ids` is emit-if-present (E2 is unshipped — no records
    // carry it yet, and the section must tolerate absence).
    const accountsAll = options.accounts ?? await Storage.platformAccounts.getAll();
    const accounts = Object.values(accountsAll || {})
        .filter((a) => a && a.linkedEntityId && familySet.has(a.linkedEntityId))
        .sort((a, b) => (a.key || '') < (b.key || '') ? -1 : 1);
    const equivalence = options.equivalence
        ?? await equivalencePubkeys(entityId).catch(() => null);
    const mentions = [];
    for (const rec of articles || []) {
        if (!rec || !rec.url || !rec.article) continue;
        for (const ref of rec.article.entities || []) {
            if (ref && familySet.has(ref.entity_id) && ref.context) {
                mentions.push({ entity_id: ref.entity_id, article_url: rec.url, context: ref.context });
            }
        }
    }
    mentions.sort((a, b) => (a.article_url + a.entity_id) < (b.article_url + b.entity_id) ? -1 : 1);

    return {
        // §7.2: the subject descriptor rides the `case` key so the
        // imported case-dossier builders work verbatim on this
        // envelope. `subject` carries the dossier-specific extras.
        case: {
            id:     root.id,
            name:   root.name,
            type:   root.type,
            pubkey: (root.keypair && root.keypair.pubkey) || root.foreign_pubkey || null
        },
        subject: {
            id:              root.id,
            requested_id:    entityId,
            name:            root.name,
            type:            root.type,
            description:     root.description || '',
            // The REAL foreign predicate — records carry keyName +
            // foreign_pubkey, never a `foreign` boolean (19.8 fix).
            foreign:         EntityModel.isForeign(root),
            authored_fields: root.authored_fields || null,
            pubkey:          (root.keypair && root.keypair.pubkey) || root.foreign_pubkey || null,
            npub:            (root.keypair && root.keypair.pubkey)
                ? Crypto.hexToNpub(root.keypair.pubkey)
                : (root.foreign_pubkey ? Crypto.hexToNpub(root.foreign_pubkey) : null)
        },
        membership_ids: familyIds,
        orbit: {
            entity_ids: familyIds,
            entities:   familyEntities,
            dangling_entity_ids: [],
            claims:     orbitClaims
        },
        assessments,
        identityInputs: {
            family: familyEntities.map((e) => ({
                id:     e.id,
                name:   e.name,
                type:   e.type,
                // The family roots at the canonical, so: the root is
                // `self`, foreign adoptions are `foreign`, everything
                // else is an `alias` of the root.
                relation: e.id === root.id ? 'self'
                    : EntityModel.isForeign(e) ? 'foreign'
                    : 'alias',
                pubkey: (e.keypair && e.keypair.pubkey) || e.foreign_pubkey || null,
                suggested_by: e.suggested_by || 'user'
            })),
            accounts,
            external_ids: root.external_ids || [],
            equivalence,
            mentions
        },
        // id → display name for every registry entity — render layers
        // resolve counterpart names with it.
        entityNamesById: Object.fromEntries(
            Object.values(allEntities).filter((e) => e && e.id).map((e) => [e.id, e.name])),
        claimsById:   allClaims,
        propositions: { all: propositionsById, orbit: orbitPropositions },
        verdicts:     { byProposition: verdictsByProposition },
        integrity:    integrityHeads,
        forensic,
        articles,
        predictions,
        resolutions,
        auditRuns,
        wire
    };
}

// ------------------------------------------------------------------
// §5.1 Identity (pure)
// ------------------------------------------------------------------

export function buildIdentitySection(data) {
    const inputs = data.identityInputs || {};
    return {
        family: inputs.family || [],
        accounts: (inputs.accounts || []).map((a) => ({
            key: a.key, platform: a.platform, handle: a.handle || a.stableId || '',
            display_name: a.displayName || '', profile_url: a.profileUrl || '',
            npub: a.npub || null, linked_entity_id: a.linkedEntityId
        })),
        external_ids: inputs.external_ids || [],
        equivalence_pubkeys: (inputs.equivalence && inputs.equivalence.pubkeys) || [],
        mentions: inputs.mentions || []
    };
}

// ------------------------------------------------------------------
// §5.3 Content (pure — delegates to the shared case-dossier builders)
// ------------------------------------------------------------------

export function buildContentSection(data, articleRows) {
    const rows = articleRows || deriveArticleRows(data);
    return {
        articles:    rows.rows,
        unprocessed: rows.unprocessed,
        timeline: {
            events: buildTimelineEvents(data, rows),
            gaps:   buildTimelineGaps(data, rows)
        }
    };
}

// ------------------------------------------------------------------
// §5.4 Judgments (pure) — distributions + routes; NO score, ever.
// ------------------------------------------------------------------

export function buildJudgmentsSection(data) {
    const byStance = {};
    for (const a of data.assessments || []) {
        const key = a.stance === null || a.stance === undefined ? 'unstanced' : String(a.stance);
        byStance[key] = (byStance[key] || 0) + 1;
    }

    const verdicts = (data.propositions.orbit || []).map((p) => {
        const chain = data.verdicts.byProposition[p.id] || [];
        const head = chain.length ? chain[chain.length - 1] : null;
        return {
            proposition_id: p.id,
            claim_id:       p.claim_id,
            proposition:    p.proposition,
            // Side-by-side variance over local head + wire verdicts —
            // never merged into one ruling (§3.5 / P2).
            variance: verdictVariance([...(head ? [head] : []), ...((data.wire.verdicts || []).filter((v) => v.proposition_id === p.id))])
        };
    });

    return {
        assessments: {
            total: (data.assessments || []).length,
            by_stance: byStance
        },
        verdicts,
        integrity_findings: (data.integrity || []).map((f) => f.id),
        // ROUTE, never inline: the render layer resolves this through
        // truth-entity-record.js#entityIntegrityRecord (the coverage-
        // capped, dimension-separated record). Re-deriving or embedding
        // it here would mint a second source of truth.
        integrity_record_ref: data.subject.id,
        forensic: (data.forensic || [])
            .filter((row) => row.finding)
            .map((row) => ({
                entity_id:   row.entity_id,
                matched_via: row.matched_via,
                finding_id:  row.finding.id,
                role:        row.finding.role || null,
                maneuver:    row.finding.maneuver || null,
                created:     row.finding.created || null
            }))
    };
}

// ------------------------------------------------------------------
// §5.5 Relationships (pure) — both directions.
// ------------------------------------------------------------------

export function buildRelationshipsSection(data) {
    const familySet = new Set(data.membership_ids);

    // Co-tagged entities: shared claims + shared articles.
    const coCounts = new Map();   // entity_id → {claims, articles:Set}
    for (const c of data.orbit.claims || []) {
        for (const id of c.about || []) {
            if (familySet.has(id)) continue;
            if (!coCounts.has(id)) coCounts.set(id, { claims: 0, articles: new Set() });
            const row = coCounts.get(id);
            row.claims++;
            if (c.source_url) row.articles.add(c.source_url);
        }
    }
    const co_tagged = [...coCounts.entries()]
        .map(([entity_id, row]) => ({
            entity_id,
            shared_claims:   row.claims,
            shared_articles: row.articles.size
        }))
        .sort((a, b) => b.shared_claims - a.shared_claims
            || (a.entity_id < b.entity_id ? -1 : 1));

    return { co_tagged };
}

// ------------------------------------------------------------------
// Assembly
// ------------------------------------------------------------------

/** Pure: same data + same generatedAt ⇒ deep-equal dossier. */
export function buildEntityDossier(data, generatedAt) {
    const articleRows = deriveArticleRows(data);
    return {
        subject:      data.subject,
        generated_at: generatedAt ?? null,
        coverage: {
            claims:   (data.orbit.claims || []).length,
            articles: articleRows.rows.length,
            unprocessed_sources: articleRows.unprocessed.length
        },
        identity:      buildIdentitySection(data),
        content:       buildContentSection(data, articleRows),
        judgments:     buildJudgmentsSection(data),
        relationships: buildRelationshipsSection(data)
    };
}

export async function assembleEntityDossier(entityId, options = {}) {
    const data = await collectEntityDossierData(entityId, options);
    return buildEntityDossier(data, options.generatedAt ?? null);
}
