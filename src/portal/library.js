// Portal library model (Phase 12.2, docs/PORTAL_DESIGN.md).
//
// Pure functions from fetched relay records to the browsable item
// model the Library view renders: per-type parsing (on the Phase 12.1
// parsers), facet extraction (platform / source domain / case /
// client), and cross-cutting search over a per-item haystack. No DOM,
// no chrome.* — index.js owns the view, this module owns the shape.
//
// "Case" is local knowledge: a claim/assessment/article belongs to a
// case when one of its `p` tags is the pubkey of a local entity of
// type 'case' (a case IS an entity — Phase 11). Callers pass the
// entity index from identity resolution; on a machine that doesn't
// hold the case entity, the facet is simply absent — by design, the
// portal never invents structure the local registry can't confirm.

import { parseClaimEvent } from '../shared/claim-model.js';
import { parseAssessmentEvent } from '../shared/assessment-model.js';
import { parseRelationshipEvent } from '../shared/evidence-linker.js';
import { EventBuilder } from '../shared/event-builder.js';
import {
    parseModuleResultEvent, parseAggregateAuditEvent,
    parsePredictionEntryEvent, parsePredictionResolutionEvent,
    parseDossierSnapshotEvent, parseAuditDisputeEvent
} from '../shared/audit/builders.js';
import { parseBehavioralFindingEvent } from '../shared/forensic-model.js';

// Tags written by this extension (current + userscript-era value).
export const OUR_CLIENT_TAGS = new Set(['xray', 'nostr-article-capture']);

// Tab order for the Library. 'other' catches 1985 label mirrors,
// 10002 relay lists, 30078 sync blobs, 32125 entity↔article links,
// and the dormant metadata kinds — listed, lightly summarized,
// never dropped.
export const TYPE_DEFS = [
    { key: 'article',    label: 'Articles' },
    { key: 'claim',      label: 'Claims' },
    { key: 'comment',    label: 'Comments' },
    { key: 'assessment', label: 'Assessments' },
    { key: 'audit',      label: 'Audits' },
    { key: 'prediction', label: 'Predictions' },
    { key: 'finding',    label: 'Findings' },
    { key: 'link',       label: 'Links' },
    { key: 'entity',     label: 'Entities' },
    { key: 'case',       label: 'Cases' },
    { key: 'account',    label: 'Accounts' },
    { key: 'other',      label: 'Other' }
];

const KIND_LABELS = {
    30023: 'Article',
    30040: 'Claim',
    30041: 'Comment',
    30054: 'Assessment',
    30055: 'Link',
    1985:  'Label',
    0:     'Profile',
    32125: 'Entity link',
    32126: 'Account',
    10002: 'Relay list',
    30078: 'Entity sync',
    30050: 'Annotation',
    30051: 'Fact-check',
    30052: 'Rating',
    30053: 'Topic trust',
    9803:  'Vote',
    30056: 'Module result',
    30057: 'Aggregate audit',
    30058: 'Prediction',
    30059: 'Resolution',
    30060: 'Dossier',
    30061: 'Dispute',
    30062: 'Behavioral finding'
};

export function kindLabel(kind) {
    return KIND_LABELS[kind] || `kind ${kind}`;
}

function firstTag(event, name) {
    const t = (event.tags || []).find((x) => x[0] === name);
    return t ? t[1] : '';
}

function tagValues(event, name) {
    return (event.tags || []).filter((x) => x[0] === name).map((x) => x[1]);
}

function domainOf(url) {
    try { return new URL(url).hostname; } catch (_) { return ''; }
}

/**
 * Build one library item from one fetched record.
 *
 * @param {{event: object, relays: string[]}} record
 * @param {Object<string, {entityId: string, name: string, type: string}>} entityIndex
 *        local entity registry keyed by entity PUBKEY
 * @returns {object} item
 */
function buildItem(record, entityIndex) {
    const event = record.event;
    const url = firstTag(event, 'r');
    const pTags = tagValues(event, 'p');

    let typeKey = 'other';
    let title = '';
    let sub = '';
    const haystack = [];
    // Structured fields the entity/case views key on (Phase 12.5);
    // null/absent where a kind doesn't carry them.
    const extra = {};

    switch (event.kind) {
        case 30023: {
            typeKey = 'article';
            title = firstTag(event, 'title') || '(untitled capture)';
            sub = domainOf(url) || url;
            // 13.7: the canonical article hash (13.4's x tag) — the
            // join key audit events anchor on. Null on pre-13.4 events.
            extra.articleHash = firstTag(event, 'x') || null;
            haystack.push(title, sub, url, ...tagValues(event, 't'), firstTag(event, 'author'));
            break;
        }
        case 30040: {
            typeKey = 'claim';
            const c = parseClaimEvent(event);
            const entityNames = (event.tags || [])
                .filter((x) => x[0] === 'entity' && x[2] === 'about')
                .map((x) => x[1]);
            title = c.text || '(empty claim)';
            const bits = [];
            if (c.source) bits.push(`source: ${c.source}`);
            if (entityNames.length) bits.push(`about ${entityNames.join(', ')}`);
            if (c.isKey) bits.push('key claim');
            sub = bits.join(' · ');
            haystack.push(c.text, c.source, ...entityNames, c.title);
            const dTag = (((event.tags || []).find((t) => t[0] === 'd')) || [])[1];
            if (dTag && event.pubkey) extra.claimCoord = `30040:${event.pubkey}:${dTag}`;
            break;
        }
        case 30041: {
            const c = EventBuilder.parseCommentEvent(event);
            if (c) {
                typeKey = 'comment';
                title = c.text;
                sub = [c.author, c.platform, c.authorHandle ? `@${c.authorHandle}` : '']
                    .filter(Boolean).join(' · ');
                haystack.push(c.text, c.author, c.authorHandle, c.platform, c.title);
            }
            break;
        }
        case 30054: {
            const a = parseAssessmentEvent(event);
            if (a) {
                typeKey = 'assessment';
                const bits = [];
                if (a.stance !== null) bits.push(`stance ${a.stance > 0 ? '+' : ''}${a.stance}`);
                if (a.labels.length) bits.push(a.labels.map((l) => l.label).join(', '));
                title = bits.join(' · ') || '(judgment)';
                sub = a.rationale;
                haystack.push(a.rationale, ...a.labels.map((l) => l.label), a.claimCoord);
                extra.claimCoord = a.claimCoord;
                extra.stance = a.stance;
                extra.labelCount = a.labels.length;
            }
            break;
        }
        case 30055: {
            const r = parseRelationshipEvent(event);
            if (r) {
                typeKey = 'link';
                title = r.relationship || '(link)';
                sub = r.note || r.urls.join('  ');
                haystack.push(r.relationship, r.note, ...r.urls);
                extra.relationship = r.relationship;
                extra.sourceCoord = r.source.coord || null;
                extra.targetCoord = r.target.coord || null;
            }
            break;
        }
        case 0: {
            let profile = {};
            try { profile = JSON.parse(event.content || '{}'); } catch (_) { /* malformed */ }
            const known = entityIndex[event.pubkey];
            typeKey = known && known.type === 'case' ? 'case' : 'entity';
            title = profile.name || (known && known.name) || '(profile)';
            sub = profile.about || '';
            haystack.push(title, sub, profile.nip05, known && known.type);
            break;
        }
        case 32126: {
            const acct = EventBuilder.reconstructPlatformAccount(event);
            if (acct) {
                typeKey = 'account';
                title = `${acct.platform}: ${acct.handle || acct.displayName || acct.stableId}`;
                sub = [acct.displayName, acct.linkedEntityId ? `linked to ${acct.linkedEntityId}` : '']
                    .filter(Boolean).join(' · ');
                haystack.push(acct.platform, acct.handle, acct.displayName, acct.stableId);
                extra.linkedEntityId = acct.linkedEntityId || null;
            }
            break;
        }
        case 1985: {
            const labels = (event.tags || []).filter((t) => t[0] === 'l').map((t) => t[1]);
            title = `Labels: ${labels.join(', ') || '(none)'}`;
            sub = url;
            haystack.push(...labels);
            break;
        }
        case 10002: {
            const relays = tagValues(event, 'r');
            title = `${relays.length} relay(s) declared`;
            sub = relays.join('  ');
            haystack.push(...relays);
            break;
        }
        case 30078: {
            title = firstTag(event, 'd') || '(entity sync)';
            sub = 'encrypted — listed, not decrypted';
            haystack.push(title);
            break;
        }
        case 32125: {
            title = `${firstTag(event, 'entity-name') || '(entity)'} — ${firstTag(event, 'relationship') || 'related'}`;
            sub = url;
            haystack.push(firstTag(event, 'entity-name'), firstTag(event, 'relationship'));
            break;
        }
        // ---- Phase 13 audit kinds (13.7) --------------------------
        // Display rules hold even in list titles: a score never
        // renders without its confidence, and sub-0.6 renders as
        // "needs human review" — never a number.
        case 30056: {
            const m = parseModuleResultEvent(event);
            if (m) {
                typeKey = 'audit';
                title = `Module result — ${m.module.replace(/_/g, ' ')}`;
                sub = url || `article ${m.articleHash.slice(0, 16)}…`;
                extra.articleHash = m.articleHash;
                extra.auditRole = 'module';
                extra.parsedModule = m;
                haystack.push(m.module, m.articleHash);
            }
            break;
        }
        case 30057: {
            const a = parseAggregateAuditEvent(event);
            if (a) {
                typeKey = 'audit';
                const reviewNeeded = typeof a.confidence !== 'number' || a.confidence < 0.6;
                title = reviewNeeded
                    ? 'Aggregate audit — needs human review'
                    : `Aggregate audit — ${a.finalScore} · conf ${a.confidence}`;
                sub = url || `article ${a.articleHash.slice(0, 16)}…`;
                extra.articleHash = a.articleHash;
                extra.auditRole = 'aggregate';
                extra.parsedAudit = a;
                haystack.push(a.articleHash, a.ceilingSource);
            }
            break;
        }
        case 30058: {
            const p = parsePredictionEntryEvent(event);
            if (p) {
                typeKey = 'prediction';
                title = p.text;
                sub = `prediction · ${p.hedgeLevel} · horizon ${p.horizonIso || p.horizon || 'unscheduled'}`;
                extra.articleHash = p.articleHash;
                extra.parsedPrediction = p;
                haystack.push(p.text, p.hedgeLevel);
            }
            break;
        }
        case 30059: {
            const r = parsePredictionResolutionEvent(event);
            if (r) {
                typeKey = 'prediction';
                title = `Resolution — ${r.outcome}`;
                sub = r.predictionCoord;
                extra.articleHash = r.articleHash;
                extra.parsedResolution = r;
                haystack.push(r.outcome, r.predictionCoord);
            }
            break;
        }
        case 30060: {
            const d = parseDossierSnapshotEvent(event);
            if (d) {
                typeKey = 'audit';
                title = `Dossier snapshot — ${d.subjectKind}${d.beat ? ` · ${d.beat}` : ''}`;
                sub = `window ${d.windowStart || '?'} → ${d.windowEnd || '?'}`;
                extra.auditRole = 'dossier';
                haystack.push(d.subjectKind, d.beat);
            }
            break;
        }
        case 30061: {
            const dis = parseAuditDisputeEvent(event);
            if (dis) {
                typeKey = 'audit';
                title = `Dispute — ${dis.status}`;
                sub = dis.targetCoord;
                extra.articleHash = dis.articleHash;
                extra.auditRole = 'dispute';
                extra.parsedDispute = dis;
                haystack.push(dis.targetKind, dis.status);
            }
            break;
        }
        // ---- Phase 14 behavioral finding (14.4) -------------------
        case 30062: {
            const f = parseBehavioralFindingEvent(event);
            if (f) {
                typeKey = 'finding';
                const subj = (f.subjectPubkey && entityIndex[f.subjectPubkey]
                    && entityIndex[f.subjectPubkey].name)
                    || (f.subjectPubkey ? `${f.subjectPubkey.slice(0, 10)}…` : '(unknown subject)');
                title = `Finding — ${f.maneuver}`;
                sub = `${subj} · ${f.role || 'subject'}`;
                extra.parsedFinding = f;
                haystack.push(f.maneuver, f.role, f.subjectPubkey, subj, f.url);
            }
            break;
        }
        default: {
            title = firstTag(event, 'd') || event.id || '(event)';
            sub = url;
            break;
        }
    }

    // Unparsable events of a known kind degrade to 'other' with a
    // generic summary rather than disappearing.
    if (!title) {
        title = firstTag(event, 'd') || event.id || '(event)';
        sub = sub || url;
    }

    // Case membership: any p-tag that is a local case-entity pubkey.
    const cases = [];
    for (const pk of pTags) {
        const known = entityIndex[pk];
        if (known && known.type === 'case' && !cases.includes(known.name)) cases.push(known.name);
    }
    // A case's own profile belongs to its case facet too.
    if (typeKey === 'case') {
        const self = entityIndex[event.pubkey];
        if (self && !cases.includes(self.name)) cases.push(self.name);
    }

    const domain = domainOf(url);
    // Accounts carry their platform under 'account-platform' (32126);
    // everything else that has one uses the plain 'platform' tag.
    const platform = event.kind === 32126
        ? firstTag(event, 'account-platform')
        : firstTag(event, 'platform');
    const client = firstTag(event, 'client');
    haystack.push(domain, platform, kindLabel(event.kind));

    return {
        id: event.id,
        event,
        relays: record.relays || [],
        kind: event.kind,
        typeKey,
        title,
        sub,
        url,
        domain,
        platform,
        client,
        cases,
        created_at: event.created_at || 0,
        searchText: haystack.filter(Boolean).join(' ').toLowerCase(),
        ...extra
    };
}

/**
 * Records → items, newest first.
 *
 * @param {Array<{event: object, relays: string[]}>} records
 * @param {{entityIndex?: object}} [opts]
 */
export function buildItems(records, { entityIndex = {} } = {}) {
    const list = Array.isArray(records) ? records : [];
    return list
        .filter((r) => r && r.event)
        .map((r) => buildItem(r, entityIndex))
        .sort((a, b) => b.created_at - a.created_at);
}

/** True when the event came from another NOSTR client (badge-worthy). */
export function isOtherClient(item) {
    return !!item.client && !OUR_CLIENT_TAGS.has(item.client);
}

export const EMPTY_FILTERS = Object.freeze({
    type: 'all',
    platform: '',
    domain: '',
    caseName: '',
    client: 'all',   // 'all' | 'ours' | 'other'
    status: 'all',   // 'all' | 'confirmed' | 'remote-only' | 'no-ledger' (12.6 reconciliation)
    query: '',
    after: 0,        // epoch seconds, inclusive — 0 = unset (timeline brush)
    before: 0        // epoch seconds, exclusive — 0 = unset
});

/**
 * Apply the Library filters. Search is token-AND over the haystack:
 * every whitespace-separated token must appear as a substring.
 */
export function applyFilters(items, filters) {
    const f = { ...EMPTY_FILTERS, ...(filters || {}) };
    const tokens = f.query.toLowerCase().split(/\s+/).filter(Boolean);
    return (Array.isArray(items) ? items : []).filter((item) => {
        if (f.type !== 'all' && item.typeKey !== f.type) return false;
        if (f.platform && item.platform !== f.platform) return false;
        if (f.domain && item.domain !== f.domain) return false;
        if (f.caseName && !item.cases.includes(f.caseName)) return false;
        if (f.after && item.created_at < f.after) return false;
        if (f.before && item.created_at >= f.before) return false;
        if (f.client === 'ours' && isOtherClient(item)) return false;
        if (f.client === 'other' && !isOtherClient(item)) return false;
        // reconStatus is annotated onto items after reconcile() runs;
        // unannotated items read as 'no-ledger' so the facet stays
        // honest before the (async) ledger diff lands.
        if (f.status !== 'all' && (item.reconStatus || 'no-ledger') !== f.status) return false;
        for (const token of tokens) {
            if (!item.searchText.includes(token)) return false;
        }
        return true;
    });
}

/** Per-type counts (for the tab badges), over already-filtered items. */
export function typeCounts(items) {
    const counts = { all: 0 };
    for (const def of TYPE_DEFS) counts[def.key] = 0;
    for (const item of (Array.isArray(items) ? items : [])) {
        counts.all++;
        if (counts[item.typeKey] !== undefined) counts[item.typeKey]++;
    }
    return counts;
}

/**
 * The Library's incremental-reveal window (12.7): the list renders
 * `limit` rows and a "show more" affordance for the rest, so a
 * many-thousand-event corpus can't jank first paint.
 */
export function pageWindow(items, limit) {
    const list = Array.isArray(items) ? items : [];
    const n = Number.isFinite(limit) && limit > 0 ? limit : list.length;
    return { shown: list.slice(0, n), remaining: Math.max(0, list.length - n) };
}

/**
 * Distinct values of a facet field with counts, most frequent first.
 * `field` is 'platform' | 'domain' | 'cases' (array-valued).
 */
export function facetValues(items, field) {
    const counts = new Map();
    for (const item of (Array.isArray(items) ? items : [])) {
        const raw = item[field];
        const values = Array.isArray(raw) ? raw : (raw ? [raw] : []);
        for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
    }
    return [...counts.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}
