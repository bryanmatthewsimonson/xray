// Case export — Phase 11.6 (docs/ASSESSMENTS_DESIGN.md).
//
// Turns a case entity's orbit — claims about it, your assessments,
// and its contradiction links — into a machine-readable JSON case
// file and a publishable Markdown report.
//
// DETERMINISTIC CONTENT SET: local claims whose `about` includes the
// entity, plus the foreign endpoints of `contradicts` links touching
// those claims (rendered from the links' stored snapshots). Network
// claims that were merely *viewed* are deliberately excluded — their
// presence would make the same case export differently depending on
// whether/when "Load from relays" was clicked.
//
// Split into a storage-aware `collectCaseData` and pure
// `buildCaseJson` / `buildCaseMarkdown` builders (the caller injects
// `generatedAt`, keeping the builders deterministic and testable).

import { ClaimModel } from './claim-model.js';
import { AssessmentModel } from './assessment-model.js';
import { EvidenceLinker } from './evidence-linker.js';
import { EntityModel } from './entity-model.js';
import { makeClaimRefCanonicalizer, isLocalClaimId } from './claim-ref.js';
import { STANCE_LABELS } from './assessment-taxonomy.js';

// ------------------------------------------------------------------
// Gather (storage-aware)
// ------------------------------------------------------------------

/**
 * Collect the case data for one entity. Returns the plain object the
 * pure builders consume.
 */
export async function collectCaseData(entityId) {
    const entity = await EntityModel.get(entityId);
    if (!entity) throw new Error(`Entity not found: ${entityId}`);

    const [allClaims, allAssessments, allLinks, canon] = await Promise.all([
        ClaimModel.getAll(),
        AssessmentModel.getAll(),
        EvidenceLinker.getAll(),
        makeClaimRefCanonicalizer()
    ]);

    // Canonical-keyed assessment lookup.
    const assessByRef = new Map();
    for (const a of Object.values(allAssessments)) {
        const ref = a.claim_ref && (a.claim_ref.claim_id || a.claim_ref.coord);
        if (ref) assessByRef.set(canon(ref), a);
    }

    // Local claims about the entity.
    const localClaims = Object.values(allClaims)
        .filter((c) => (c.about || []).includes(entityId))
        .sort((a, b) => (b.is_key ? 1 : 0) - (a.is_key ? 1 : 0) || (a.created || 0) - (b.created || 0));
    const aboutIds = new Set(localClaims.map((c) => c.id));

    // Contradiction links with at least one endpoint about the entity
    // (the 11.5 dashboard rule).
    const contradictions = [];
    const foreignEndpoints = new Map();   // canonicalRef → {ref, text, url, author_pubkey}
    for (const link of Object.values(allLinks)) {
        if (link.relationship !== 'contradicts') continue;
        const a = canon(link.source_claim_id);
        const b = canon(link.target_claim_id);
        if (!aboutIds.has(a) && !aboutIds.has(b)) continue;

        const endpoint = async (ref, snap) => {
            if (isLocalClaimId(ref)) {
                const rec = allClaims[ref] || await ClaimModel.get(ref);
                if (rec) {
                    return { ref: { claim_id: ref }, text: rec.text, url: rec.source_url };
                }
            }
            const out = {
                ref:  { coord: ref },
                text: (snap && snap.text) || '',
                url:  (snap && snap.url) || ''
            };
            if (snap && snap.author_pubkey) out.ref.author_pubkey = snap.author_pubkey;
            if (!isLocalClaimId(ref)) {
                foreignEndpoints.set(ref, {
                    coord: ref, text: out.text, url: out.url,
                    author_pubkey: (snap && snap.author_pubkey) || null
                });
            }
            return out;
        };

        contradictions.push({
            relationship: link.relationship,
            note:         link.note || '',
            suggested_by: link.suggested_by || 'user',
            source:       await endpoint(a, link.source_snapshot),
            target:       await endpoint(b, link.target_snapshot)
        });
    }

    // Entity-name resolution for about/source display.
    const nameCache = new Map();
    const entityName = async (id) => {
        if (!nameCache.has(id)) {
            const e = await EntityModel.get(id);
            nameCache.set(id, e ? e.name : '(missing entity)');
        }
        return nameCache.get(id);
    };

    const exportAssessment = (ref) => {
        const a = assessByRef.get(ref);
        if (!a) return null;
        return {
            stance:       a.stance,
            stance_label: a.stance === null || a.stance === undefined
                              ? null : (STANCE_LABELS[String(a.stance)] || String(a.stance)),
            rationale:    a.rationale || '',
            suggested_by: a.suggested_by || 'user',
            labels:       (a.labels || []).map((l) => ({
                label: l.label,
                ...(l.note ? { note: l.note } : {}),
                ...(l.anchor ? { anchor: l.anchor } : {}),
                suggested_by: l.suggested_by || 'user'
            }))
        };
    };

    const claims = [];
    for (const c of localClaims) {
        const aboutNames = [];
        for (const id of c.about || []) aboutNames.push(await entityName(id));
        let source = null;
        if (c.source) {
            source = /^entity_/.test(c.source) ? await entityName(c.source) : c.source;
        }
        claims.push({
            ref:        { claim_id: c.id },
            text:       c.text,
            url:        c.source_url,
            about:      aboutNames,
            ...(source ? { source } : {}),
            ...(c.is_key ? { is_key: true } : {}),
            origin:     'local',
            assessment: exportAssessment(c.id)
        });
    }
    for (const f of foreignEndpoints.values()) {
        claims.push({
            ref:        { coord: f.coord, ...(f.author_pubkey ? { author_pubkey: f.author_pubkey } : {}) },
            text:       f.text,
            url:        f.url,
            about:      [],
            origin:     'foreign',
            assessment: exportAssessment(canon(f.coord))
        });
    }

    // Label tally across everything included.
    const label_counts = {};
    for (const c of claims) {
        for (const l of (c.assessment && c.assessment.labels) || []) {
            label_counts[l.label] = (label_counts[l.label] || 0) + 1;
        }
    }

    return {
        case: {
            id:     entity.id,
            name:   entity.name,
            type:   entity.type,
            pubkey: (entity.keypair && entity.keypair.pubkey) || null
        },
        // 19.8: the authored case framing (scope question / status /
        // opened / closed) rides the export, always labeled as the
        // author's own framing — never as a sourced fact. Values only;
        // the per-field `updated` stamps stay local so the same case
        // always exports the same.
        scope: entity.authored_fields
            ? Object.fromEntries(Object.entries(entity.authored_fields)
                .map(([field, slot]) => [field, slot.value]))
            : null,
        claims,
        contradictions,
        label_counts
    };
}

// ------------------------------------------------------------------
// Pure builders
// ------------------------------------------------------------------

/** The machine-readable case file. */
export function buildCaseJson(data, generatedAt) {
    return JSON.stringify({
        case:           data.case,
        ...(data.scope ? { scope: data.scope } : {}),
        generated_at:   generatedAt,
        generator:      'xray',
        claims:         data.claims,
        contradictions: data.contradictions,
        label_counts:   data.label_counts
    }, null, 2);
}

/** The publishable research-notes report. */
export function buildCaseMarkdown(data, generatedAt) {
    const lines = [];
    lines.push(`# Case: ${data.case.name}`);
    lines.push('');
    lines.push(`Generated ${generatedAt} by X-Ray · ${data.claims.length} claim${data.claims.length === 1 ? '' : 's'} · ${data.contradictions.length} contradiction${data.contradictions.length === 1 ? '' : 's'}`);
    lines.push('');

    // 19.8: the authored framing block — explicitly the author's, so a
    // reader never mistakes the scope question for a sourced finding.
    if (data.scope && Object.keys(data.scope).length > 0) {
        lines.push('## Case scope (author\'s framing)');
        lines.push('');
        if (data.scope.scope_question) lines.push(`**Scope question:** ${data.scope.scope_question}`);
        if (data.scope.status)         lines.push(`**Status:** ${data.scope.status}`);
        if (data.scope.opened)         lines.push(`**Opened:** ${data.scope.opened}`);
        if (data.scope.closed)         lines.push(`**Closed:** ${data.scope.closed}`);
        lines.push('');
    }

    // Claims grouped by stance (judged groups first, strongest
    // disagreement → strongest agreement, then unjudged).
    const groups = new Map();   // stance key → claims
    for (const c of data.claims) {
        const key = c.assessment && c.assessment.stance !== null && c.assessment.stance !== undefined
            ? String(c.assessment.stance) : 'no-stance';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(c);
    }
    const order = ['-2', '-1', '0', '1', '2', 'no-stance'];

    lines.push('## Claims');
    for (const key of order) {
        const group = groups.get(key);
        if (!group || group.length === 0) continue;
        lines.push('');
        lines.push(`### ${key === 'no-stance' ? 'No stance recorded' : `${STANCE_LABELS[key]} (${key})`}`);
        for (const c of group) {
            lines.push('');
            lines.push(`> ${c.text}`);
            const meta = [];
            if (c.is_key) meta.push('⭐ key');
            if (c.source) meta.push(`per ${c.source}`);
            if (c.about && c.about.length) meta.push(`about ${c.about.join(', ')}`);
            meta.push(c.origin === 'local' ? `[source](${c.url})` : `[foreign source](${c.url})`);
            lines.push(`— ${meta.join(' · ')}`);
            const a = c.assessment;
            if (a) {
                for (const l of a.labels || []) {
                    lines.push(`  - **${l.label}**${l.note ? ` — ${l.note}` : ''}`);
                }
                if (a.rationale) lines.push(`  - _${a.rationale}_`);
            }
        }
    }

    lines.push('');
    lines.push('## Inconsistencies');
    if (data.contradictions.length === 0) {
        lines.push('');
        lines.push('None recorded.');
    }
    for (const x of data.contradictions) {
        lines.push('');
        lines.push(`- “${x.source.text}” ([source](${x.source.url}))`);
        lines.push(`  **⚔ contradicts**`);
        lines.push(`  “${x.target.text}” ([source](${x.target.url}))${x.note ? ` — ${x.note}` : ''}`);
    }

    const tally = Object.entries(data.label_counts).sort((a, b) => b[1] - a[1]);
    if (tally.length > 0) {
        lines.push('');
        lines.push('## Label tally');
        lines.push('');
        for (const [label, n] of tally) lines.push(`- ${n}× ${label}`);
    }
    lines.push('');
    return lines.join('\n');
}
