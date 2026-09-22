// Per-shape parser dispatch for tests/wire-fixtures.test.mjs — one entry
// per `<kind>-<shape>` fixture. Each entry parses the fixture's signed
// event with the CURRENT read-side code and returns `{ parsed, checks }`
// where every check is `[label, actual, expected]` (deep-equal'd by the
// test). Kinds with no dedicated parser (0, 1, 5, 10002, 32125) assert
// the fields their documented readers consume (adopt-entity.js,
// entity-sync.js pullRelayListFor / pullEntities, portal/library.js).
//
// Split out of the test so the test file stays under ~500 lines; owns
// no policy of its own. Provenance: INTERPRETATION (2026-09-14) — an
// agent artifact under RESET_PLAN R0; the maintainer has not ruled on it.

import { EventBuilder } from '../../src/shared/event-builder.js';
import { parseClaimEvent } from '../../src/shared/claim-model.js';
import { parseAssessmentEvent } from '../../src/shared/assessment-model.js';
import { parseRelationshipEvent } from '../../src/shared/evidence-linker.js';
import { parseBehavioralFindingEvent } from '../../src/shared/forensic-model.js';
import { parseAdjudicatedVerdictEvent, parseIntegrityFindingEvent, ADJUDICATION_NAMESPACE } from '../../src/shared/truth-builders.js';
import {
    parseModuleResultEvent, parseAggregateAuditEvent, parsePredictionEntryEvent,
    parsePredictionResolutionEvent, parseDossierSnapshotEvent, parseAuditDisputeEvent
} from '../../src/shared/audit/builders.js';
import { parseReviewLabelEvent } from '../../src/shared/metadata/builders.js';
import { parseCaseBriefEvent, CASE_BRIEF_MARKER, caseBriefDTag } from '../../src/shared/corpus-publish.js';
import { ENTITY_PAGE_MARKER, entityPageDTag } from '../../src/shared/entity-page-publish.js';
import { parseExtractionAnalysisEvent, extractionDTag } from '../../src/shared/extraction-publish.js';
import { parseOwnedKeysManifest, verifyDelegationTag, OWNED_KEYS_D } from '../../src/shared/identity-builders.js';
import { parseFollowListEvent } from '../../src/shared/follow-publish.js';
import { parseFeedEvent } from '../../src/shared/entity-feed.js';
import { ASSESSMENT_LABEL_NAMESPACE } from '../../src/shared/assessment-taxonomy.js';
import { serializeEntityForSync, deserializeEntityFromSync } from '../../src/shared/entity-sync.js';
import { Crypto } from '../../src/shared/crypto.js';
import { stripMetadataHeader, articleHash } from '../../src/shared/audit/article-hash.js';

const tag = (ev, name) => (ev.tags.find((t) => t[0] === name) || [])[1] ?? null;
const tags = (ev, name) => ev.tags.filter((t) => t[0] === name);
const nonNull = (label, v) => [label + ' is non-null', v !== null && v !== undefined, true];

/** Shared checks for the three 30023 shapes: the article reconstructs and the feed row is an article. */
function articleCommon(f, ev) {
    const article = EventBuilder.reconstructArticleFromEvent(ev);
    const feed = parseFeedEvent(ev);
    return { article, checks: [
        nonNull('reconstructArticleFromEvent', article),
        ['title', article.title, tag(ev, 'title')],
        ['feed bucket', feed && feed.key, 'articles'],
        ['d tag present', typeof tag(ev, 'd'), 'string'],
        ['client tag', tag(ev, 'client'), 'xray']
    ] };
}

export const PARSERS = {
    '30023-capture-article': async (f, ev) => {
        const { article, checks } = articleCommon(f, ev);
        const i = f.inputs.article;
        return { parsed: article, checks: [...checks,
            ['url', article.url, i.url], ['title', article.title, i.title], ['byline', article.byline, i.byline],
            ['siteName', article.siteName, i.siteName], ['publishedAt', article.publishedAt, i.publishedAt],
            ['textContent is the body verbatim', article.textContent, i.content],
            ['stripMetadataHeader recovers the body', stripMetadataHeader(ev.content), i.content],
            ['x tag = articleHash(body)', tag(ev, 'x'), await articleHash(i.content)]
        ] };
    },
    '30023-case-brief-article': (f, ev) => {
        const { article, checks } = articleCommon(f, ev);
        return { parsed: article, checks: [...checks,
            ['d', tag(ev, 'd'), caseBriefDTag(f.inputs.record.caseId)],
            ['marker t', tags(ev, 't').map((t) => t[1]).includes(CASE_BRIEF_MARKER), true],
            ['title', tag(ev, 'title'), `Case brief — ${f.inputs.caseName}`],
            ['30068 cross-link', tags(ev, 'a').some((t) => t[1] === `30068:${f.inputs.userPubkey}:${caseBriefDTag(f.inputs.record.caseId)}`), true],
            ['proposals never publish', ev.content.includes('is_key'), false]
        ] };
    },
    '30023-entity-page-article': (f, ev) => {
        const { article, checks } = articleCommon(f, ev);
        return { parsed: article, checks: [...checks,
            ['d', tag(ev, 'd'), entityPageDTag(f.inputs.entity.id)],
            ['marker t', tags(ev, 't').map((t) => t[1]).includes(ENTITY_PAGE_MARKER), true],
            ['subject p', ev.tags.find((t) => t[0] === 'p'), ['p', f.inputs.entityPubkey, '', 'subject']],
            ['key-fact refs = published claims only', tags(ev, 'a').filter((t) => t[3] === 'key-fact').length,
                f.inputs.keyClaims.filter((c) => c.publishedEventId && (c.publishedPubkey || f.inputs.userPubkey)).length]
        ] };
    },
    '0-entity-profile': async (f, ev, ctx) => {
        const content = JSON.parse(ev.content);      // adopt-entity.js reads .name and the about pattern
        const delegation = await verifyDelegationTag(ev, { expectedDelegator: ctx.keys.TV1.pubkey });
        return { parsed: content, checks: [
            ['name', content.name, f.inputs.entity.name],
            ['about matches the adopt-entity pattern', new RegExp(`^${f.inputs.entity.type} entity created by X-Ray`).test(content.about), true],
            ['creator p', ev.tags.find((t) => t[0] === 'p' && t[3] === 'creator'), ['p', f.inputs.creatorPubkey, '', 'creator']],
            ['NIP-26 token verifies', delegation, { ok: true, delegator: ctx.keys.TV1.pubkey }],
            ['conditions pinned', ev.tags.find((t) => t[0] === 'delegation')[2], f.inputs.delegation.conditions],
            ['i tag', ev.tags.find((t) => t[0] === 'i'), ['i', f.inputs.externalIds[0], '']]
        ] };
    },
    '30040-claim': (f, ev) => {
        const p = parseClaimEvent(ev);
        return { parsed: p, checks: [nonNull('parseClaimEvent', p),
            ['id', p.id, f.inputs.claim.id], ['text', p.text, f.inputs.claim.text], ['url', p.url, f.inputs.articleUrl],
            ['isKey', p.isKey, true], ['articleHash', p.articleHash, f.inputs.claim.article_hash],
            ['about entity names', p.about, ['Jane Roe']], ['source', p.source, 'Jane Roe'],
            ['about p', ev.tags.find((t) => t[0] === 'p' && t[3] === 'about')[1], f.inputs.entities[f.inputs.claim.about[0]].keypair.pubkey]
        ] };
    },
    '30041-comment': (f, ev) => {
        const p = EventBuilder.parseCommentEvent(ev);
        const c = f.inputs.comment;
        return { parsed: p, checks: [nonNull('parseCommentEvent', p),
            ['id', p.id, c.id], ['text', p.text, c.text], ['author', p.author, c.authorName], ['platform', p.platform, c.platform],
            ['commentDate (ms normalized to s)', p.commentDate, Math.floor(c.timestamp / 1000)],
            ['replyTo', p.replyTo, c.replyTo], ['reactionCount', p.reactionCount, c.reactionCount], ['restackCount', p.restackCount, c.restacks],
            ['commenterPubkey', p.commenterPubkey, f.inputs.accountPubkey], ['url', p.url, f.inputs.articleUrl]
        ] };
    },
    '30078-entity-sync': async (f, ev, ctx) => {
        const convKey = await ctx.syncConversationKey();
        const plaintext = await Crypto.nip44Decrypt(ev.content, convKey);
        const entity = deserializeEntityFromSync(plaintext);
        return { parsed: entity, checks: [nonNull('deserializeEntityFromSync', entity),
            ['plaintext = serializeEntityForSync(entity with TV3 keypair)', plaintext, serializeEntityForSync(ctx.syncEntityWithKey(f.inputs.entity))],
            ['id', entity.id, f.inputs.entityId], ['name', entity.name, f.inputs.entity.name], ['type', entity.type, f.inputs.entityType],
            ['keypair is TV3 (inside the ciphertext only)', [entity.keypair.pubkey, entity.keypair.privateKey], [ctx.keys.TV3.pubkey, ctx.keys.TV3.privateKey]],
            ['pull filter tags', [tag(ev, 'd'), tag(ev, 'L'), tags(ev, 'l')[0]], [f.inputs.entityId, 'xray/entity-sync', ['l', 'v1', 'xray/entity-sync']]],
            ['entity-type', tag(ev, 'entity-type'), f.inputs.entityType]
        ] };
    },
    '10002-relay-list': (f, ev) => {
        const relays = tags(ev, 'r').map((t) => t[1]).filter((u) => /^wss?:\/\//.test(u));   // pullRelayListFor
        return { parsed: relays, checks: [['relays', relays, f.inputs.relayUrls], ['content', ev.content, '']] };
    },
    '3-follow-list': (f, ev) => {
        const p = parseFollowListEvent(ev);
        return { parsed: p, checks: [['entries', p, [
            { pubkey: f.inputs.entries[0].pubkey, relayHint: f.inputs.entries[0].relayHints[0], petname: f.inputs.entries[0].label },
            { pubkey: f.inputs.entries[1].pubkey, relayHint: '', petname: '' }
        ]], ['content (no legacy relay JSON)', ev.content, '']] };
    },
    '32125-entity-article': (f, ev) => {
        const i = f.inputs;
        const row = { d: tag(ev, 'd'), name: tag(ev, 'entity-name'), type: tag(ev, 'entity-type'), rel: tag(ev, 'relationship'), url: tag(ev, 'r') };
        return { parsed: row, checks: [
            ['portal row', row, { d: `${i.entity.id}:${i.articleUrl}:${i.relationshipType}`, name: i.entity.name, type: i.entity.type, rel: i.relationshipType, url: i.articleUrl }],
            ['p role = relationship', ev.tags.find((t) => t[0] === 'p'), ['p', i.entity.keypair.pubkey, '', i.relationshipType]],
            ['claim-ref', tag(ev, 'claim-ref'), i.claimId]
        ] };
    },
    '32126-platform-account': (f, ev) => {
        const p = EventBuilder.reconstructPlatformAccount(ev);
        const feed = parseFeedEvent(ev);
        return { parsed: p, checks: [nonNull('reconstructPlatformAccount', p),
            ['key', p.key, `${f.inputs.platform}:${f.inputs.raw.channelId}`], ['platform', p.platform, f.inputs.platform],
            ['stableId', p.stableId, f.inputs.raw.channelId], ['handle', p.handle, f.inputs.raw.handle], ['displayName', p.displayName, f.inputs.raw.displayName],
            ['verified', p.verified, true], ['profileUrl', p.profileUrl, f.inputs.profileUrl],
            ['linkedEntityPubkey', p.linkedEntityPubkey, f.inputs.linkedEntityPubkey], ['feed bucket', feed && feed.key, 'accounts']
        ] };
    },
    '30054-assessment': (f, ev) => {
        const p = parseAssessmentEvent(ev);
        return { parsed: p, checks: [nonNull('parseAssessmentEvent', p),
            ['claimCoord', p.claimCoord, f.inputs.claimCoord], ['claimEventId', p.claimEventId, f.inputs.claimEventId], ['stance', p.stance, f.inputs.stance],
            ['labels', p.labels.map((l) => l.label), ['misleading', 'fallacy/strawman']], ['label note', p.labels[0].note, f.inputs.labels[0].note],
            ['rationale', p.rationale, f.inputs.rationale], ['aboutPubkeys', p.aboutPubkeys, f.inputs.aboutPubkeys], ['url', p.url, f.inputs.claimUrl]
        ] };
    },
    '1985-assessment-mirror': (f, ev) => labelRow(f, ev, ASSESSMENT_LABEL_NAMESPACE, ['misleading', 'fallacy/strawman'], f.inputs.claimCoord, false),
    '1985-review-label': (f, ev) => {
        const p = parseReviewLabelEvent(ev);
        return { parsed: p, checks: [nonNull('parseReviewLabelEvent', p),
            ['value', p.value, f.inputs.value], ['targetCoord', p.targetCoord, f.inputs.targetCoord], ['targetEventId', p.targetEventId, f.inputs.targetEventId],
            ['url', p.url, f.inputs.url], ['never a p', tags(ev, 'p').length, 0]
        ] };
    },
    '1985-forensic-mirror': (f, ev) => labelRow(f, ev, 'xray/forensic', [f.inputs.maneuver], f.inputs.sourceUrl, true),
    '1985-verdict-mirror': (f, ev) => labelRow(f, ev, ADJUDICATION_NAMESPACE, [f.inputs.verdict], f.inputs.claimCoord, false),
    '30055-relationship': (f, ev) => {
        const p = parseRelationshipEvent(ev);
        return { parsed: p, checks: [nonNull('parseRelationshipEvent', p),
            ['relationship', p.relationship, f.inputs.relationship], ['source (directional — not sorted)', p.source, { coord: f.inputs.sourceCoord, eventId: f.inputs.sourceEventId }],
            ['target', p.target, { coord: f.inputs.targetCoord, eventId: f.inputs.targetEventId }], ['note', p.note, f.inputs.note],
            ['urls', p.urls, [f.inputs.sourceUrl, f.inputs.targetUrl]]
        ] };
    },
    '30062-forensic-finding': (f, ev) => {
        const p = parseBehavioralFindingEvent(ev);
        return { parsed: p, checks: [nonNull('parseBehavioralFindingEvent', p),
            ['subjectPubkey', p.subjectPubkey, f.inputs.subjectPubkey], ['maneuver', p.maneuver, f.inputs.maneuver], ['role', p.role, f.inputs.role],
            ['anchor quote', p.anchors[0].quote, f.inputs.anchors[0].quote], ['note', p.note, f.inputs.note], ['counterNote', p.counterNote, f.inputs.counterNote],
            ['basis', p.basis, f.inputs.basis], ['url', p.url, f.inputs.sourceUrl]
        ] };
    },
    '30056-module-result': (f, ev) => {
        const p = parseModuleResultEvent(ev);
        return { parsed: p, checks: [nonNull('parseModuleResultEvent', p),
            ['articleHash', p.articleHash, f.inputs.articleHash], ['module', p.module, f.inputs.module], ['runAt', p.runAt, f.inputs.runAt],
            ['score', p.score, f.inputs.findings.score], ['confidence', p.confidence, f.inputs.findings.confidence], ['auditor', p.auditor, f.inputs.auditor],
            ['articleCoord', p.articleCoord, f.inputs.articleCoord],
            ['findings round-trip (content adds evidence_quotes)', Object.fromEntries(Object.keys(f.inputs.findings).map((k) => [k, p.findings[k]])), f.inputs.findings],
            ['evidence_quotes collected', p.findings.evidence_quotes, [{ quote: 'rose 12 percent' }, { quote: 'nearly doubled' }]]
        ] };
    },
    '30057-aggregate-audit': (f, ev) => {
        const p = parseAggregateAuditEvent(ev);
        return { parsed: p, checks: [nonNull('parseAggregateAuditEvent', p),
            ['articleHash', p.articleHash, f.inputs.articleHash], ['finalScore', p.finalScore, f.inputs.finalScore], ['rawScore', p.rawScore, f.inputs.rawScore],
            ['ceiling', p.ceiling, f.inputs.ceiling], ['ceilingBinding (raw < ceiling)', p.ceilingBinding, false], ['auditor', p.auditor, f.inputs.auditor],
            ['moduleRefs', p.moduleRefs.map((m) => m.coord), f.inputs.moduleContributions.map((m) => m.coord)]
        ] };
    },
    '30058-prediction-entry': (f, ev) => {
        const p = parsePredictionEntryEvent(ev);
        return { parsed: p, checks: [nonNull('parsePredictionEntryEvent', p),
            ['text', p.text, f.inputs.predictionText], ['content is the text ONLY', ev.content, f.inputs.predictionText], ['articleHash', p.articleHash, f.inputs.articleHash],
            ['predictionType', p.predictionType, f.inputs.predictionType], ['hedgeLevel', p.hedgeLevel, f.inputs.hedgeLevel], ['attributedName', p.attributedName, f.inputs.attributedName],
            ['horizonIso', p.horizonIso, f.inputs.horizonIso], ['criteria', p.criteria, f.inputs.criteria], ['tractability', p.tractability, f.inputs.tractability]
        ] };
    },
    '30059-prediction-resolution': (f, ev) => {
        const p = parsePredictionResolutionEvent(ev);
        return { parsed: p, checks: [nonNull('parsePredictionResolutionEvent', p),
            ['predictionCoord', p.predictionCoord, f.inputs.predictionCoord], ['outcome', p.outcome, f.inputs.outcome], ['confidence', p.confidence, f.inputs.confidence],
            ['resolvedAt', p.resolvedAt, f.inputs.resolvedAt], ['evidence', p.evidence, f.inputs.evidence], ['auditor', p.auditor, f.inputs.auditor],
            ['human auditor p', ev.tags.find((t) => t[0] === 'p' && t[3] === 'auditor')[1], f.inputs.auditor.id]
        ] };
    },
    '30060-dossier-snapshot': (f, ev) => {
        const p = parseDossierSnapshotEvent(ev);
        return { parsed: p, checks: [nonNull('parseDossierSnapshotEvent', p),
            ['subjectKind', p.subjectKind, f.inputs.subjectKind], ['entityPubkey', p.entityPubkey, f.inputs.entityPubkey], ['beat', p.beat, f.inputs.beat],
            ['articleCount', p.articleCount, f.inputs.articleCount], ['scoreMean', p.scoreMean, f.inputs.scoreMean], ['shrinkageFactor', p.shrinkageFactor, f.inputs.shrinkageFactor],
            ['perModuleMeans', p.perModuleMeans, f.inputs.perModuleMeans], ['predictions', p.predictions, f.inputs.predictions]
        ] };
    },
    '30061-audit-dispute': (f, ev) => {
        const p = parseAuditDisputeEvent(ev);
        return { parsed: p, checks: [nonNull('parseAuditDisputeEvent', p),
            ['targetCoord', p.targetCoord, f.inputs.targetCoord], ['targetKind', p.targetKind, f.inputs.targetKind], ['status', p.status, 'open'],
            ['contested', p.contested, f.inputs.contested], ['evidence', p.evidence, f.inputs.evidence], ['disputeSummary', p.disputeSummary, f.inputs.disputeSummary]
        ] };
    },
    '30063-verdict': (f, ev) => {
        const p = parseAdjudicatedVerdictEvent(ev);
        return { parsed: p, checks: [nonNull('parseAdjudicatedVerdictEvent', p),
            ['claimCoord', p.claimCoord, f.inputs.claimCoord], ['propositionClass', p.propositionClass, f.inputs.propositionClass], ['verdict', p.verdict, f.inputs.verdict],
            ['standardOfProof', p.standardOfProof, f.inputs.standardOfProof], ['criteria', p.criteria, f.inputs.resolutionCriteria.criteria], ['subjectRole', p.subjectRole, f.inputs.subjectRole],
            ['occurredAt', p.occurredAt, f.inputs.occurredAt], ['evidenceFor quote', p.evidenceFor[0].quote, f.inputs.evidenceFor[0].quote], ['caveats', p.caveats, f.inputs.caveats],
            ['NEVER a p', tags(ev, 'p').length, 0]
        ] };
    },
    '30064-integrity-finding': (f, ev) => {
        const p = parseIntegrityFindingEvent(ev);
        return { parsed: p, checks: [nonNull('parseIntegrityFindingEvent', p),
            ['subjectPubkey', p.subjectPubkey, f.inputs.subjectPubkey], ['word', p.word, f.inputs.word], ['deeds coords', p.deeds.map((d) => d.coord), f.inputs.deeds.map((d) => d.coord)],
            ['match', p.match, f.inputs.match], ['caveats', p.caveats, f.inputs.caveats],
            ['subject p', ev.tags.find((t) => t[0] === 'p'), ['p', f.inputs.subjectPubkey, '', 'subject']]
        ] };
    },
    '30068-case-brief': (f, ev) => {
        const p = parseCaseBriefEvent(ev);
        const feed = parseFeedEvent(ev);
        return { parsed: p, checks: [nonNull('parseCaseBriefEvent', p),
            ['caseId', p.caseId, f.inputs.record.caseId], ['caseName', p.caseName, f.inputs.caseName], ['scopeQuestion', p.scopeQuestion, f.inputs.scopeQuestion],
            ['summary', p.brief.summary, f.inputs.record.brief.summary], ['coverage_gaps', p.brief.coverage_gaps, f.inputs.record.brief.coverage_gaps],
            ['proposals never publish', 'proposals' in JSON.parse(ev.content), false], ['feed bucket', feed && feed.key, 'briefs']
        ] };
    },
    '30069-owned-keys': (f, ev) => {
        const p = parseOwnedKeysManifest(ev);
        const expected = [...f.inputs.entities].sort((a, b) => (a.pubkey < b.pubkey ? -1 : 1));
        return { parsed: p, checks: [nonNull('parseOwnedKeysManifest', p),
            ['creatorPubkey', p.creatorPubkey, ev.pubkey], ['d', tag(ev, 'd'), OWNED_KEYS_D],
            ['owned rows sorted by pubkey', p.owned, expected.map((e) => ({ pubkey: e.pubkey, id: e.id, name: e.name }))],
            ['ownedPubkeys', [...p.ownedPubkeys], expected.map((e) => e.pubkey)]
        ] };
    },
    '30070-extraction-analysis': (f, ev) => {
        const p = parseExtractionAnalysisEvent(ev);
        return { parsed: p, checks: [nonNull('parseExtractionAnalysisEvent', p),
            ['articleHash', p.articleHash, f.inputs.record.articleHash], ['d', tag(ev, 'd'), extractionDTag(f.inputs.record.articleHash)],
            ['articleUrl', p.articleUrl, f.inputs.articleUrl], ['statuses (whole unit)', p.assertions.map((a) => a.status), ['accepted', 'unreviewed']],
            ['endorsed a ref', tags(ev, 'a').find((t) => t[3] === 'endorsed')[1], f.inputs.coordByClaimId.claim_1],
            ['face counts', [tag(ev, 'unreviewed'), tag(ev, 'endorsed'), tag(ev, 'dismissed'), tag(ev, 'ungrounded-dropped')], ['1', '1', '0', '2']]
        ] };
    },
    '1-mention-note': (f, ev) => {
        const i = f.inputs;
        return { parsed: ev.content, checks: [
            ['content template', ev.content, `Mentioned in "${i.articleTitle}"\n\n"${i.quote}"\n\n${i.articleUrl}`],
            ['tags', ev.tags, [['r', i.articleUrl], ['a', i.articleCoord, '', 'mention'], ['x', i.articleHash], ['p', i.publisherPubkey, '', 'publisher'], ['quote', i.quote], ['client', 'xray']]],
            ['entity-signed', ev.pubkey, i.entityPubkey]
        ] };
    },
    '5-deletion': (f, ev, ctx) => ({ parsed: tags(ev, 'e').map((t) => t[1]), checks: [
        ['tags = e-ids then k', ev.tags, [...f.inputs.syncEventIds.map((id) => ['e', id]), ['k', '30078']]],
        ['content literal', ev.content, ctx.DELETION_CONTENT], ['user-signed', ev.pubkey, f.inputs.userPubkey]
    ] })
};

/** The three aggregation-only 1985 mirrors share the feed row reader. */
function labelRow(f, ev, namespace, values, target, hasP) {
    const feed = parseFeedEvent(ev);
    return { parsed: feed, checks: [nonNull('parseFeedEvent', feed), ['bucket', feed.key, 'labels'],
        ['namespace', feed.parsed.namespace, namespace], ['values', feed.parsed.values, values], ['target', feed.parsed.target, target],
        ['regular event: no d', tag(ev, 'd'), null], ['content', ev.content, ''], ['p present', tags(ev, 'p').length > 0, hasP]
    ] };
}
