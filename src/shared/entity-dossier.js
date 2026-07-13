// entity-dossier.js — the computed-on-read entity dossier (Phase 19.3,
// docs/ENTITY_DOSSIER_DESIGN.md §5): "wikipedia-like, but every line
// can defend itself." Assembled strictly from captured content over
// the subject's ALIAS FAMILY; recompute-on-read, nothing persisted.
//
// Same collector/builder split as case-dossier.js: the storage-aware
// `collectEntityDossierData` bulk-reads one snapshot set; the pure
// `buildEntityDossier(data, generatedAt)` derives the five sections
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
import { fieldsForType, getFieldDef } from './entity-field-schemas.js';
import { isFactClaim, factConflicts, FactDismissals } from './entity-facts.js';
import { sameDateWithinPrecision } from './dossier-time.js';
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
    const dismissals  = options.dismissals  ?? await FactDismissals.getAll();
    const wire = { verdicts: [], findings: [], articles: [], ...(options.wire || {}) };
    const forensicSubjectRefs = options.forensicSubjectRefs || {};

    // Membership = the alias family (§5), rooted at the canonical.
    const { rootId, ids } = await EntityModel.aliasFamily(entityId, allEntities);
    const familyIds = [...ids].sort();
    const familySet = new Set(familyIds);
    const root = allEntities[rootId] || subjectRec;
    const familyEntities = familyIds.map((id) => allEntities[id]).filter(Boolean);

    // One pass over all claims, three buckets: orbit membership is
    // about OR source ∩ family; the subject's own facts; inbound
    // entity-ref facts pointing INTO the family (§5 relationships run
    // both directions).
    const orbitClaims = [];
    const factClaims = [];
    const inboundFactClaims = [];
    for (const c of Object.values(allClaims)) {
        const aboutHit = (c.about || []).some((id) => familySet.has(id));
        const sourceHit = typeof c.source === 'string' && familySet.has(c.source);
        if (aboutHit || sourceHit) orbitClaims.push(c);
        if (isFactClaim(c)) {
            if (familySet.has(c.fact.entity_id)) factClaims.push(c);
            else if (c.fact.value_ref && familySet.has(c.fact.value_ref)) inboundFactClaims.push(c);
        }
    }
    orbitClaims.sort((a, b) => (b.is_key ? 1 : 0) - (a.is_key ? 1 : 0)
        || (a.created || 0) - (b.created || 0));
    const byId = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    factClaims.sort(byId);
    inboundFactClaims.sort(byId);
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
            foreign:         root.foreign === true,
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
        factClaims,
        inboundFactClaims,
        dismissals,
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
                    : e.foreign === true ? 'foreign'
                    : 'alias',
                pubkey: (e.keypair && e.keypair.pubkey) || e.foreign_pubkey || null,
                suggested_by: e.suggested_by || 'user'
            })),
            accounts,
            external_ids: root.external_ids || [],
            equivalence,
            mentions
        },
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
// §5.2 Fields (pure)
// ------------------------------------------------------------------

// Type-aware value agreement over FACT records: dates agree within
// their honest precision bands ("1962" vs "1962-03-15" is one value),
// entity-refs compare by id, text case/whitespace-normalized. Same
// semantics as entity-facts' conflict comparator.
function factValuesAgree(def, fa, fb) {
    if (def && def.value_type === 'date') {
        const da = parseFactDateValue(fa);
        const db = parseFactDateValue(fb);
        if (da && db) return sameDateWithinPrecision(da.at, da.precision, db.at, db.precision);
    }
    if (def && def.value_type === 'entity-ref') {
        return (fa.value_ref || '') === (fb.value_ref || '');
    }
    const norm = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
    return norm(fa.value) === norm(fb.value);
}

function parseFactDateValue(fact) {
    const s = String(fact.value || '').trim();
    if (!s) return null;
    let precision = 'exact';
    if (/^\d{4}$/.test(s)) precision = 'year';
    else if (/^\d{4}-\d{2}$/.test(s)) precision = 'month';
    else if (/^\d{4}-\d{2}-\d{2}$/.test(s)) precision = 'day';
    const parsed = Date.parse(precision === 'year' ? `${s}-01-01` : precision === 'month' ? `${s}-01` : s);
    if (Number.isNaN(parsed)) return null;
    return { at: Math.floor(parsed / 1000), precision };
}

// The evidence entry every dossier value carries — the §5 click-
// through contract: claim id, verbatim quote, source, exact article
// version, provenance stamps.
function evidenceOf(claim) {
    return {
        claim_id:           claim.id,
        quote:              claim.quote || null,
        source_url:         claim.source_url || null,
        article_hash:       claim.article_hash || null,
        captured_at:        claim.created || null,
        suggested_by:       claim.suggested_by || 'user',
        published_event_id: claim.publishedEventId || null
    };
}

/**
 * One row per registry field for the subject's type — unknown-by-
 * default: EVERY row exists, an empty one saying "no captured source",
 * never a blank guess — plus synthesized rows for custom/off-registry
 * fields present in the fact set (appended, name-sorted).
 *
 * Status ladder: `unknown` (nothing) → `contested` (≥1 undismissed
 * conflict) → `multiple` (>1 distinct concurrent value, legally —
 * multiple:true or dismissed) → `known`. Conflicts carry BOTH claim
 * ids and no winner — they render side by side (§2.3).
 *
 * "Current" is `valid_to === null` — "still valid as asserted". A
 * clock comparison would need a clock read (banned in pure builders);
 * the render layer may re-bucket against display time.
 */
export function buildFieldsSection(data) {
    const subjectType = data.subject.type;
    const registry = fieldsForType(subjectType);
    const dismissals = data.dismissals || {};

    // Facts grouped by field, subject-side only.
    const byField = new Map();
    for (const c of data.factClaims) {
        const f = c.fact.field;
        if (!byField.has(f)) byField.set(f, []);
        byField.get(f).push(c);
    }

    const fieldNames = [
        ...registry.map((r) => r.field),
        ...[...byField.keys()].filter((f) => !registry.some((r) => r.field === f)).sort()
    ];

    const rows = [];
    for (const field of fieldNames) {
        const def = getFieldDef(subjectType, field)
            || { field, label: field, value_type: 'text', multiple: false, evolves: false, provenance: 'sourced' };
        const claims = byField.get(field) || [];

        // Group agreeing claims into ValueGroups with merged evidence.
        const groups = [];
        for (const c of claims) {
            const hit = groups.find((g) => factValuesAgree(def, g._fact, c.fact));
            if (hit) {
                hit.evidence.push(evidenceOf(c));
            } else {
                groups.push({
                    _fact:               c.fact,
                    value:               c.fact.value,
                    value_ref:           c.fact.value_ref || null,
                    valid_from:          c.fact.valid_from ?? null,
                    valid_from_precision: c.fact.valid_from_precision ?? null,
                    valid_to:            c.fact.valid_to ?? null,
                    valid_to_precision:  c.fact.valid_to_precision ?? null,
                    observed_at:         c.fact.observed_at ?? null,
                    observed_precision:  c.fact.observed_precision ?? null,
                    evidence:            [evidenceOf(c)]
                });
            }
        }
        // Ordered by valid_from asc, nulls first, then lowest claim id.
        const groupOrder = (a, b) =>
            ((a.valid_from ?? -Infinity) - (b.valid_from ?? -Infinity))
            || (a.evidence[0].claim_id < b.evidence[0].claim_id ? -1 : 1);
        for (const g of groups) delete g._fact;
        const current = groups.filter((g) => g.valid_to === null).sort(groupOrder);
        const history = groups.filter((g) => g.valid_to !== null).sort(groupOrder);

        const conflicts = factConflicts(claims, { entityType: subjectType, dismissals });

        const authored = (def.provenance === 'authored'
            && data.subject.authored_fields
            && data.subject.authored_fields[field]) || null;

        const status = conflicts.length > 0 ? 'contested'
            : (current.length > 1) ? 'multiple'
            : (groups.length > 0 || authored) ? 'known'
            : 'unknown';

        rows.push({
            field:      def.field,
            label:      def.label,
            value_type: def.value_type,
            multiple:   def.multiple,
            evolves:    def.evolves,
            provenance: def.provenance,
            status,
            current,
            history,
            conflicts,
            authored,
            coverage: {
                claims: claims.length,
                published_claims: claims.filter((c) => c.publishedEventId).length
            }
        });
    }

    return {
        rows,
        coverage: {
            fields_total:   rows.length,
            fields_known:   rows.filter((r) => r.status !== 'unknown').length,
            fields_contested: rows.filter((r) => r.status === 'contested').length,
            facts_total:    data.factClaims.length
        }
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
    const rootId = data.subject.id;

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

    // Field-derived edges from entity-ref facts, both directions.
    const field_edges = [];
    for (const c of data.factClaims || []) {
        if (c.fact.value_ref) {
            field_edges.push({
                direction: 'out', field: c.fact.field,
                from_entity_id: rootId, to_entity_id: c.fact.value_ref,
                value: c.fact.value, claim_id: c.id
            });
        }
    }
    for (const c of data.inboundFactClaims || []) {
        field_edges.push({
            direction: 'in', field: c.fact.field,
            from_entity_id: c.fact.entity_id, to_entity_id: rootId,
            value: c.fact.value, claim_id: c.id
        });
    }
    field_edges.sort((a, b) => (a.claim_id < b.claim_id ? -1 : a.claim_id > b.claim_id ? 1 : 0));

    return { co_tagged, field_edges };
}

// ------------------------------------------------------------------
// Assembly
// ------------------------------------------------------------------

/** Pure: same data + same generatedAt ⇒ deep-equal dossier. */
export function buildEntityDossier(data, generatedAt) {
    const articleRows = deriveArticleRows(data);
    const fields = buildFieldsSection(data);
    return {
        subject:      data.subject,
        generated_at: generatedAt ?? null,
        coverage: {
            claims:   (data.orbit.claims || []).length,
            articles: articleRows.rows.length,
            unprocessed_sources: articleRows.unprocessed.length,
            ...fields.coverage
        },
        identity:      buildIdentitySection(data),
        fields:        fields.rows,
        content:       buildContentSection(data, articleRows),
        judgments:     buildJudgmentsSection(data),
        relationships: buildRelationshipsSection(data)
    };
}

export async function assembleEntityDossier(entityId, options = {}) {
    const data = await collectEntityDossierData(entityId, options);
    return buildEntityDossier(data, options.generatedAt ?? null);
}

/**
 * The side panel's compact projection: the first `n` known/multiple
 * rows (registry order), plus the contested count. Pure over a built
 * dossier so it's testable without DOM.
 */
export function compactFieldRows(dossier, n = 5) {
    const known = (dossier.fields || []).filter((r) => r.status === 'known' || r.status === 'multiple');
    return {
        rows: known.slice(0, n).map((r) => ({
            field: r.field,
            label: r.label,
            status: r.status,
            value: r.current.length ? r.current[0].value : (r.authored ? r.authored.value : null),
            extra: Math.max(0, r.current.length - 1)
        })),
        more: Math.max(0, known.length - n),
        contested: (dossier.fields || []).filter((r) => r.status === 'contested').length
    };
}
