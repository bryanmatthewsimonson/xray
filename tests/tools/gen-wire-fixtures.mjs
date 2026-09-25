// Golden WIRE fixture generator — one signed event per EMITTED kind and
// per distinct shape of a kind:
//   tests/fixtures/wire/<kind>-<shape>.json
//
// RESET_PLAN §7 R0 "Golden fixtures before any refactor thread starts"
// (`tests/fixtures/wire/<kind>.json` … "re-verify id + signature and
// re-parse every wire fixture"; audit finding WIRE-05 in
// docs/audit-2026-09-05/wire-and-schema.md: "Builder tests assert tag
// presence, never byte-identical output or id recompute against a
// checked-in event"). The generic test tests/wire-fixtures.test.mjs
// verifies every fixture's id + sig, re-parses it with the CURRENT
// parser, and — where the builder is deterministic — REBUILDS it from
// the fixture's own inputs to identical id and sig, so a wire-format
// change is a red that must be a deliberate regeneration.
//
// Deviation from the R0 bullet, stated honestly: the bullet sources the
// events from "the maintainer's journal export"; that export is partial
// (WIRE-09) and carries real identities, so these are BUILDER-produced
// events under the three BIP-340 test-vector keys (fixture-keys.mjs).
// They pin the builders' wire shape, not any historical relay bytes.
//
// Fixture format:
//   { kind, shape, builder: { module, fn }, signer: 'TV1'|'TV3',
//     createdAt, inputs, rebuild: 'exact'|'verify-only', notes, event }
//
// Determinism: every timestamp derives from FIXED_TIME_S, every key is a
// test-vector scalar, signing is deterministic (BIP-340 nonce with no
// aux randomness), hashes are sha256 of fixed labels, output JSON has
// sorted keys. Two builders cannot be re-run byte-for-byte — the 30023
// capture article bakes today's locale date into its content, and the
// 30078 NIP-44 ciphertext carries a random nonce — so those two (and
// the hand-built kind-5 literal) are `verify-only`: the generator PINS
// their event from the checked-in file when the pinned event still
// matches the current builder modulo the volatile part, and mints fresh
// only when it does not. Running this twice yields identical files.
//
// The nine EventBuilder builders read Date.now inline — created_at is
// overwritten AFTER building. The metadata/audit/truth/corpus/entity-
// page/extraction/identity builders take `createdAt` and emit NO pubkey
// — it is set before signing. Inputs are passed through sortKeysDeep
// BEFORE building so a content whose JSON key order follows the input
// object (30056 findings, 30060 per-module means) is byte-stable and
// equals what the sorted-key fixture file records.
//
// Run:  node tests/tools/gen-wire-fixtures.mjs
//
// Provenance: INTERPRETATION (2026-09-14) — an agent artifact under
// RESET_PLAN R0; the maintainer has not ruled on it.

import { writeFileSync, mkdirSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// event-builder.js / entity-sync.js pull storage.js, which probes
// chrome.storage.local at module load. Minimal callback stub, only when
// a host test has not installed its own.
globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

import { REPO_ROOT, sortKeysDeep, stableStringify } from './idb-fixture-harness.mjs';
import {
    TV1, TV2, TV3, FIXED_TIME_S, FIXTURE_ORIGIN, FIXTURE_RELAY, signWith, fixtureHash
} from './fixture-keys.mjs';

// Import order mirrors tests/metadata-assessments.test.mjs (flags +
// taxonomy before the metadata builders).
await import('../../src/shared/metadata/feature-flags.js');
await import('../../src/shared/assessment-taxonomy.js');
const { Crypto } = await import('../../src/shared/crypto.js');
const { EventBuilder } = await import('../../src/shared/event-builder.js');
const MB = await import('../../src/shared/metadata/builders.js');
const AB = await import('../../src/shared/audit/builders.js');
const TB = await import('../../src/shared/truth-builders.js');
const CP = await import('../../src/shared/corpus-publish.js');
const EPP = await import('../../src/shared/entity-page-publish.js');
const XP = await import('../../src/shared/extraction-publish.js');
const IB = await import('../../src/shared/identity-builders.js');
const MN = await import('../../src/shared/mention-notes.js');
const ES = await import('../../src/shared/entity-sync.js');
const PA = await import('../../src/shared/identity/platform-account.js');

export const GENERATOR = 'tests/tools/gen-wire-fixtures.mjs';
export const FIXTURE_DIR = join(REPO_ROOT, 'tests', 'fixtures', 'wire');
export const KEYS = Object.freeze({ TV1, TV2, TV3 });

/** The kind-5 literal at entity-sync.js clearRemote — content is exact. */
export const DELETION_CONTENT = 'X-Ray entity sync — clear remote';

/** The `**Published** | **Archived**` header line buildArticleEvent bakes from the wall clock / locale. */
export const ARTICLE_DATE_LINE_RE = /^(\*\*Published\*\*: [^\n]*\| )?\*\*Archived\*\*: [^\n]*$/m;

const ORIGIN = FIXTURE_ORIGIN;               // https://example.com
const ORG = 'https://example.org';
const RELAY = FIXTURE_RELAY;                 // wss://relay.example
const T = FIXED_TIME_S;

// Deterministic 64-hex "hashes" — sha256 of a label (fixture-keys.mjs).
const H = {};
for (const label of ['article:a', 'article:b', 'article:story', 'claim-event', 'source-event', 'target-event',
    'agg-event', 'sync-event:1', 'sync-event:2', 'input-hash']) {
    H[label] = await fixtureHash(label);
}

const ENTITY_ID = 'entity_' + H['article:a'].slice(0, 16);
const CASE_ID = 'entity_' + H['article:b'].slice(0, 16);
const CLAIM_ID = 'claim_' + H['claim-event'].slice(0, 16);
const CLAIM_COORD = `30040:${TV1.pubkey}:${CLAIM_ID}`;
const CLAIM_COORD_B = `30040:${TV3.pubkey}:claim_${H['target-event'].slice(0, 16)}`;
const ARTICLE_COORD = `30023:${TV1.pubkey}:${H['article:story'].slice(0, 16)}`;

// ---------------------------------------------------------------------------
// Shared input literals (canonical: alphabetical keys — see header).

const ARTICLE_URL = `${ORIGIN}/story`;

const CASE_RECORD = {
    caseId: CASE_ID,
    promptVersion: 'corpus-v1',
    members: 2,
    grounding: { checked: 5, dropped: 1 },
    brief: {
        summary: 'Two camps disagree on the origin.',
        positions: [
            { label: 'Lab leak', core_argument: 'A research-related incident.', holders: [{ article_hash: H['article:a'] }] },
            { label: 'Zoonosis', core_argument: 'A natural spillover.', holders: [{ article_hash: H['article:b'] }] }
        ],
        cruxes: [{
            question: 'Does the genome show engineering?',
            sides: [
                { position_label: 'Lab leak', view: 'The furin site is suspicious.' },
                { position_label: 'Zoonosis', view: 'The site occurs in nature.' }
            ],
            evidence_refs: [{ article_hash: H['article:b'], quote: 'No signatures of engineering were found.' }],
            what_would_resolve: 'An early-case sequence from the market.'
        }],
        load_bearing: [
            { claim_ref: null, article_hash: H['article:a'], quote: 'The lab studied related coronaviruses.', why: 'Establishes capability.' }
        ],
        coverage_gaps: ['No primary lab records in the corpus.'],
        proposals: [{ kind: 'is_key', claim_id: 'c1' }]   // reviewer-facing; MUST NOT publish
    }
};
const MEMBER_INDEX = {
    [H['article:a']]: { url: `${ORIGIN}/leak`, title: 'The Lab-Leak Case', coord: `30023:${TV1.pubkey}:aaaa1111` },
    [H['article:b']]: { url: `${ORIGIN}/zoo`, title: 'The Zoonosis Case', coord: `30023:${TV1.pubkey}:bbbb2222` }
};

const ENTITY_PAGE_RECORD = {
    entityId: ENTITY_ID,
    page: {
        lead: 'The corpus presents the W.H.O. as the central agency in the dispute.',
        sections: [
            { heading: 'Early response', body: 'According to the Times, the agency moved slowly.',
              citations: [{ article_hash: H['article:a'], quote: 'the agency moved slowly in January' }], uncited: false },
            { heading: 'Unanchored context', body: 'Background summary.', citations: [], uncited: true }
        ],
        key_claim_ids: ['claim_1', 'claim_2', 'claim_3'],
        disputes: [{ topic: 'Timeline', sides: [
            { view: 'Slow', article_hash: H['article:a'], quote: 'moved slowly' },
            { view: 'Fast', article_hash: H['article:b'], quote: 'acted within days' }
        ] }],
        gaps: ['Nothing on funding sources.']
    },
    grounding: { checked: 3, dropped: 1 },
    model: 'claude-test', promptVersion: 'entity-page-v1',
    inputHash: H['input-hash'], members: 2, analyzed: 2, createdAt: T
};
const KEY_CLAIMS = [
    { id: 'claim_1', text: 'Founded in 1948.', quote: 'founded in 1948', source_url: `${ORIGIN}/a`,
      publishedEventId: 'evt1', publishedPubkey: TV3.pubkey },
    { id: 'claim_2', text: 'HQ in Geneva.', quote: 'headquartered in Geneva', source_url: `${ORG}/b`,
      publishedEventId: 'evt2', publishedPubkey: null },
    { id: 'claim_3', text: 'Unpublished claim.', quote: null, source_url: null,
      publishedEventId: null, publishedPubkey: null }
];

const SYNC_ENTITY_PUBLIC = {
    id: ENTITY_ID, name: 'Jane Roe', type: 'person', description: 'A person entity.',
    nip05: '', canonical_id: null, created: T - 3600, updated: T, publishedAt: null, publishedEventId: null
};
/** The 30078 plaintext: the public record plus TV3's keypair (never written to a fixture file). */
export function syncEntityWithKey(entityPublic) {
    return { ...entityPublic, keypair: { privateKey: TV3.privateKey, pubkey: TV3.pubkey, npub: TV3.npub, nsec: TV3.nsec } };
}
export async function syncConversationKey() {
    return await Crypto.nip44GetConversationKey(TV1.privateKey, TV1.pubkey);
}

const MODEL = { kind: 'model', id: 'anthropic/claude-sonnet-4-6' };
const PIPELINE = { kind: 'pipeline', id: 'xray-auditor/0.1.0/anthropic/claude-sonnet-4-6' };
const HUMAN = { kind: 'human', id: TV1.pubkey };

const EXTRACTION_ASSERTION = (over) => ({
    key: 'a:0-32', quote: 'a verbatim span from the article', start: 0, end: 32,
    why: 'MODEL RATIONALE about load-bearing-ness', text: 'MODEL PARAPHRASE of the claim',
    status: 'open', accepted_claim_id: null, triaged_at: null, accepted_why: null, accepted_why_provenance: null,
    first_seen: { model: 'claude-test', promptVersion: 'corpus-v7', producer: 'map',
                  caseName: 'COVID origins', scopeQuestion: 'Where did it start?', at: T },
    ...over
});

// ---------------------------------------------------------------------------
// The spec table. `build(inputs, createdAt, pinned)` returns the UNSIGNED
// event with pubkey set; the generator signs with `signer`. `pinned` is
// the checked-in event (if any) for verify-only shapes.

const setTime = (ev, createdAt) => { ev.created_at = createdAt; return ev; };
const withPubkey = (ev, key) => ({ ...ev, pubkey: key.pubkey });

export const SPECS = [
    {
        kind: 30023, shape: 'capture-article', signer: 'TV1', rebuild: 'verify-only',
        builder: { module: 'src/shared/event-builder.js', fn: 'EventBuilder.buildArticleEvent' },
        notes: 'Content bakes the wall-clock/locale `**Archived**` date (event-builder.js buildArticleEvent) and '
            + 'created_at is Date.now inline, so the event is pinned once; the test compares tags exactly and '
            + 'content with the Published|Archived header line stripped (ARTICLE_DATE_LINE_RE). Entity tags never '
            + 'emit today (Storage.entities.get is a dead stub); entities/claims are passed empty.',
        inputs: {
            article: {
                url: ARTICLE_URL, title: 'The Story', domain: 'example.com', siteName: 'Example Daily',
                byline: 'Jane Reporter', publishedAt: T - 86400, _contentIsMarkdown: true,
                content: '# The Story\n\nThe agency moved slowly in January, the Times reported.\n\n'
                    + 'A second paragraph with a [link](https://example.org/ref).\n'
            },
            entities: [], userPubkey: TV1.pubkey, claims: []
        },
        async build(i, createdAt) {
            return setTime(await EventBuilder.buildArticleEvent(i.article, i.entities, i.userPubkey, i.claims), createdAt);
        },
        // Pinned event survives when the CURRENT builder agrees modulo the date line.
        async stillCurrent(pinnedEvent, fresh) {
            return JSON.stringify(pinnedEvent.tags) === JSON.stringify(fresh.tags)
                && pinnedEvent.content.replace(ARTICLE_DATE_LINE_RE, '') === fresh.content.replace(ARTICLE_DATE_LINE_RE, '');
        }
    },
    {
        kind: 30023, shape: 'case-brief-article', signer: 'TV1', rebuild: 'exact',
        builder: { module: 'src/shared/corpus-publish.js', fn: 'buildCaseBriefArticle' },
        notes: 'Sibling of the 30068 CaseBrief: marker t=xray-case-brief, d=xray-brief:<caseId>, reciprocal a cross-link. '
            + 'record.brief.proposals is present in the inputs precisely because it must NOT publish.',
        inputs: { record: CASE_RECORD, caseName: 'COVID origins', scopeQuestion: 'Where did it start?', memberIndex: MEMBER_INDEX, userPubkey: TV1.pubkey },
        build(i, createdAt) { return withPubkey(CP.buildCaseBriefArticle({ ...i, createdAt }), TV1); }
    },
    {
        kind: 30023, shape: 'entity-page-article', signer: 'TV1', rebuild: 'exact',
        builder: { module: 'src/shared/entity-page-publish.js', fn: 'buildEntityPageArticle' },
        notes: 'USER-signed entity page: marker t=xray-entity-page, d=xray-entity-page:<entityId>, subject p tag (TV3), '
            + 'a key-fact refs only for PUBLISHED claims, x tags for cited member hashes.',
        inputs: { record: ENTITY_PAGE_RECORD, entity: { id: ENTITY_ID, name: 'W.H.O.' }, entityPubkey: TV3.pubkey, keyClaims: KEY_CLAIMS, userPubkey: TV1.pubkey },
        build(i, createdAt) { return withPubkey(EPP.buildEntityPageArticle({ ...i, createdAt }), TV1); }
    },
    {
        kind: 0, shape: 'entity-profile', signer: 'TV3', rebuild: 'exact',
        builder: { module: 'src/shared/event-builder.js', fn: 'EventBuilder.buildProfileEvent + reader attachCreatorBinding' },
        notes: 'The READER shape (src/reader/index.js attachCreatorBinding): builder output plus [p, primary, "", creator] '
            + 'and a NIP-26 delegation tag minted from TV1 to TV3 with a PINNED conditions string '
            + '(production embeds a wall-clock window). Entity-signed (TV3).',
        inputs: {
            entity: { id: ENTITY_ID, name: 'W.H.O.', type: 'organization', nip05: '', keypair: { pubkey: TV3.pubkey } },
            canonicalNpub: null, about: null, externalIds: ['wikidata:Q7817'],
            creatorPubkey: TV1.pubkey,
            delegation: { delegator: 'TV1', conditions: IB.entityDelegationConditions({ kinds: [0], from: T - 86400, until: T + 365 * 86400 }) }
        },
        async build(i, createdAt) {
            const ev = setTime(EventBuilder.buildProfileEvent(i.entity, i.canonicalNpub, i.about, i.externalIds), createdAt);
            ev.tags.push(['p', i.creatorPubkey, '', 'creator']);
            ev.tags.push(await IB.mintDelegationTag(KEYS[i.delegation.delegator].privateKey, i.entity.keypair.pubkey, i.delegation.conditions));
            return ev;
        }
    },
    {
        kind: 30040, shape: 'claim', signer: 'TV1', rebuild: 'exact',
        builder: { module: 'src/shared/event-builder.js', fn: 'EventBuilder.buildClaimEvent' },
        notes: 'Thin entity-centric claim: about + source entity (TV3), key flag, anchor/quote/x/captured_at provenance.',
        inputs: {
            claim: {
                id: CLAIM_ID, text: 'Jane Roe runs Acme Corp.', about: [ENTITY_ID], source: ENTITY_ID, is_key: true,
                quote: 'Jane Roe runs Acme Corp.', article_hash: H['article:story'], created: T - 60,
                anchor: [{ type: 'TextQuoteSelector', exact: 'Jane Roe runs Acme Corp.' }]
            },
            articleUrl: ARTICLE_URL, articleTitle: 'The Story', userPubkey: TV1.pubkey,
            entities: { [ENTITY_ID]: { id: ENTITY_ID, name: 'Jane Roe', type: 'person', keypair: { pubkey: TV3.pubkey } } },
            predictionRef: null
        },
        build(i, createdAt) {
            return setTime(EventBuilder.buildClaimEvent(i.claim, i.articleUrl, i.articleTitle, i.userPubkey, i.entities, i.predictionRef), createdAt);
        }
    },
    {
        kind: 30041, shape: 'comment', signer: 'TV1', rebuild: 'exact',
        builder: { module: 'src/shared/event-builder.js', fn: 'EventBuilder.buildCommentEvent' },
        notes: 'Full captured-comment shape (ms timestamp normalized to seconds, reply-to, reaction/restack counts, commenter p). '
            + 'accountPubkey is the DERIVED platform-account identifier for youtube:UCabc (deriveAccountPubkey), not a held key.',
        inputs: {
            comment: {
                id: 'cmt:substack:98765', text: 'This completely contradicts what he said last week.',
                authorName: 'Jane Reader', authorHandle: 'janereader', authorUrl: `${ORIGIN}/@janereader`,
                platform: 'substack', timestamp: (T + 120) * 1000, replyTo: 'cmt:substack:98000', reactionCount: 12, restacks: 3
            },
            articleUrl: `${ORIGIN}/p/post`, articleTitle: 'The Post', userPubkey: TV1.pubkey,
            accountPubkey: await PA.deriveAccountPubkey('youtube', 'UCabc')
        },
        build(i, createdAt) {
            return setTime(EventBuilder.buildCommentEvent(i.comment, i.articleUrl, i.articleTitle, i.userPubkey, i.accountPubkey), createdAt);
        }
    },
    {
        kind: 30078, shape: 'entity-sync', signer: 'TV1', rebuild: 'verify-only',
        builder: { module: 'src/shared/event-builder.js', fn: 'EventBuilder.buildEntitySyncEvent (content: entity-sync.js pushEntities)' },
        notes: 'Content is NIP-44 v2 ciphertext (random nonce — pinned once) of serializeEntityForSync(entity with TV3 keypair) '
            + 'under the TV1<->TV1 self conversation key. The plaintext carries TV3\'s private key ONLY inside the ciphertext; '
            + 'the fixture inputs hold the public record and the test re-attaches the keypair from fixture-keys.',
        inputs: { entityId: ENTITY_ID, entityType: 'person', userPubkey: TV1.pubkey, entity: SYNC_ENTITY_PUBLIC },
        async build(i, createdAt, pinned) {
            const plaintext = ES.serializeEntityForSync(syncEntityWithKey(i.entity));
            const convKey = await syncConversationKey();
            let ct = pinned && pinned.content;
            if (!ct || (await Crypto.nip44Decrypt(ct, convKey)) !== plaintext) ct = await Crypto.nip44Encrypt(plaintext, convKey);
            return setTime(EventBuilder.buildEntitySyncEvent(i.entityId, ct, i.entityType, i.userPubkey), createdAt);
        },
        async stillCurrent(pinnedEvent, fresh) { return pinnedEvent.content === fresh.content && JSON.stringify(pinnedEvent.tags) === JSON.stringify(fresh.tags); }
    },
    {
        kind: 10002, shape: 'relay-list', signer: 'TV1', rebuild: 'exact',
        builder: { module: 'src/shared/event-builder.js', fn: 'EventBuilder.buildRelayListEvent' },
        notes: 'NIP-65: one r tag per relay in input order, empty content.',
        inputs: { relayUrls: [RELAY, `${RELAY}/archive`], userPubkey: TV1.pubkey },
        build(i, createdAt) { return setTime(EventBuilder.buildRelayListEvent(i.relayUrls, i.userPubkey), createdAt); }
    },
    {
        kind: 3, shape: 'follow-list', signer: 'TV1', rebuild: 'exact',
        builder: { module: 'src/shared/event-builder.js', fn: 'EventBuilder.buildFollowListEvent' },
        notes: 'NIP-02 mirror with includeLabels ON so the petname slot is pinned; second entry has no hint (empty slot kept).',
        inputs: { entries: [{ pubkey: TV3.pubkey, relayHints: [RELAY], label: 'Entity Three' }, { pubkey: TV2.pubkey }], userPubkey: TV1.pubkey, options: { includeLabels: true } },
        build(i, createdAt) { return setTime(EventBuilder.buildFollowListEvent(i.entries, i.userPubkey, i.options), createdAt); }
    },
    {
        kind: 32125, shape: 'entity-article', signer: 'TV1', rebuild: 'exact',
        builder: { module: 'src/shared/event-builder.js', fn: 'EventBuilder.buildEntityRelationshipEvent' },
        notes: 'Entity<->article edge as the reader emits it (resolveRelationshipsToPublish: relationshipType about|source, claim-ref). '
            + 'No builder test existed before this fixture.',
        inputs: { entity: { id: ENTITY_ID, name: 'Jane Roe', type: 'person', keypair: { pubkey: TV3.pubkey } }, articleUrl: ARTICLE_URL, relationshipType: 'about', userPubkey: TV1.pubkey, claimId: CLAIM_ID },
        build(i, createdAt) { return setTime(EventBuilder.buildEntityRelationshipEvent(i.entity, i.articleUrl, i.relationshipType, i.userPubkey, i.claimId), createdAt); }
    },
    {
        kind: 32126, shape: 'platform-account', signer: 'TV1', rebuild: 'exact',
        builder: { module: 'src/shared/event-builder.js', fn: 'EventBuilder.buildPlatformAccountEvent (record: identity/platform-account.js makeAccountRecord)' },
        notes: 'The account p is the DERIVED identifier for youtube:UCabc (an allowed non-key pubkey in the hygiene test); linked-entity p is TV3.',
        inputs: { platform: 'youtube', raw: { channelId: 'UCabc', handle: '@jane', displayName: 'Jane', verified: true }, now: T, profileUrl: `${ORIGIN}/@jane`, userPubkey: TV1.pubkey, linkedEntityPubkey: TV3.pubkey },
        async build(i, createdAt) {
            const rec = await PA.makeAccountRecord(PA.normalizeAuthor(i.platform, i.raw), { now: i.now });
            rec.profileUrl = i.profileUrl;
            return setTime(EventBuilder.buildPlatformAccountEvent(rec, i.userPubkey, i.linkedEntityPubkey), createdAt);
        }
    },
    {
        kind: 30054, shape: 'assessment', signer: 'TV1', rebuild: 'exact',
        builder: { module: 'src/shared/metadata/builders.js', fn: 'buildAssessmentEvent' },
        notes: 'Full shape: stance + labels (one enriched with anchor/note), about pubkey (TV3), claim event id, relay hint.',
        inputs: {
            claimCoord: CLAIM_COORD, claimUrl: `${ORIGIN}/video?utm_source=feed`, claimEventId: H['claim-event'], relayHint: RELAY,
            stance: -1, labels: [{ label: 'misleading', anchor: [{ type: 'TextQuoteSelector', exact: 'mutual agreement' }], note: 'closure framed as neutral' }, 'fallacy/strawman'],
            rationale: 'Both sides confirm it was not mutual.', aboutPubkeys: [TV3.pubkey], suggestedBy: 'user'
        },
        async build(i, createdAt) { return withPubkey((await MB.buildAssessmentEvent({ ...i, createdAt })).event, TV1); }
    },
    {
        kind: 1985, shape: 'assessment-mirror', signer: 'TV1', rebuild: 'exact',
        builder: { module: 'src/shared/metadata/builders.js', fn: 'buildAssessmentMirrorEvent' },
        notes: 'NIP-32 mirror of the 30054 labels under xray/assessment; no p by design (never labels the author).',
        inputs: { claimCoord: CLAIM_COORD, labels: [{ label: 'misleading', note: 'note stays on the 30054' }, 'fallacy/strawman'], claimUrl: `${ORIGIN}/video?utm_source=feed`, relayHint: RELAY },
        build(i, createdAt) { return withPubkey(MB.buildAssessmentMirrorEvent({ ...i, createdAt }).event, TV1); }
    },
    {
        kind: 30055, shape: 'relationship', signer: 'TV1', rebuild: 'exact',
        builder: { module: 'src/shared/metadata/builders.js', fn: 'buildClaimRelationshipEvent' },
        notes: 'Directional edge (supports) — endpoints NOT sorted; symmetric values would be.',
        inputs: {
            sourceCoord: CLAIM_COORD_B, targetCoord: CLAIM_COORD, relationship: 'supports',
            sourceUrl: `${ORIGIN}/video-2?utm_source=x`, targetUrl: `${ORIGIN}/video-1`,
            sourceEventId: H['source-event'], targetEventId: H['target-event'], sourceRelayHint: RELAY, targetRelayHint: '',
            note: 'Cites the same court filing.', suggestedBy: 'user'
        },
        async build(i, createdAt) { return withPubkey((await MB.buildClaimRelationshipEvent({ ...i, createdAt })).event, TV1); }
    },
    {
        kind: 1985, shape: 'review-label', signer: 'TV1', rebuild: 'exact',
        builder: { module: 'src/shared/metadata/builders.js', fn: 'buildReviewRequestLabelEvent' },
        notes: 'xray/review label on an addressable coordinate; never a p.',
        inputs: { value: 'review-requested', targetCoord: CLAIM_COORD, targetEventId: H['claim-event'], url: ARTICLE_URL, relayHint: RELAY },
        build(i, createdAt) { return withPubkey(MB.buildReviewRequestLabelEvent({ ...i, createdAt }).event, TV1); }
    },
    {
        kind: 1985, shape: 'forensic-mirror', signer: 'TV1', rebuild: 'exact',
        builder: { module: 'src/shared/metadata/builders.js', fn: 'buildForensicFindingMirrorEvent' },
        notes: 'The ONE 1985 shape that carries a p (the labeled subject, TV3) under xray/forensic.',
        inputs: { subjectPubkey: TV3.pubkey, maneuver: 'darvo/attack', sourceUrl: `${ORIGIN}/x` },
        build(i, createdAt) { return withPubkey(MB.buildForensicFindingMirrorEvent({ ...i, createdAt }).event, TV1); }
    },
    {
        kind: 1985, shape: 'verdict-mirror', signer: 'TV1', rebuild: 'exact',
        builder: { module: 'src/shared/truth-builders.js', fn: 'buildVerdictMirrorEvent' },
        notes: 'xray/adjudication label on the claim coordinate, never a pubkey.',
        inputs: { claimCoord: CLAIM_COORD, verdict: 'established-false', sourceUrl: `${ORIGIN}/article` },
        build(i, createdAt) { return withPubkey(TB.buildVerdictMirrorEvent({ ...i, createdAt }).event, TV1); }
    },
    {
        kind: 30062, shape: 'forensic-finding', signer: 'TV1', rebuild: 'exact',
        builder: { module: 'src/shared/metadata/builders.js', fn: 'buildBehavioralFindingEvent' },
        notes: 'counterNote and one quoted anchor are REQUIRED; content = note + "### Counter-read" + counterNote; subject p = TV3.',
        inputs: {
            subjectPubkey: TV3.pubkey, maneuver: 'defense/usefulness-pivot', role: 'apologist',
            anchors: [{ quote: 'I care about the truth, not what the church says.', selector: [{ type: 'TextQuoteSelector', exact: 'I care about the truth' }] }],
            counterNote: 'He may simply be conceding utility alongside the truth claim.',
            note: 'Shifts the axis from is-it-true to is-it-useful.', basis: 'quoted', sourceUrl: `${ORIGIN}/clip?utm_source=x`,
            relationshipCoord: null, suggestedBy: 'user'
        },
        async build(i, createdAt) { return withPubkey((await MB.buildBehavioralFindingEvent({ ...i, createdAt })).event, TV1); }
    },
    {
        kind: 30056, shape: 'module-result', signer: 'TV1', rebuild: 'exact',
        builder: { module: 'src/shared/audit/builders.js', fn: 'buildModuleResultEvent' },
        notes: 'internal_coherence findings; content JSON key order FOLLOWS the findings object, so the inputs are canonical (sorted) literals.',
        inputs: {
            articleHash: H['article:story'], module: 'internal_coherence', runAt: '2023-11-14T22:13:20Z',
            findings: {
                module: 'internal_coherence', version: '1.0', score: 62, confidence: 0.78, confidence_notes: 'clean structure',
                auditor_caveats: ['Surface scan only.'],
                contradictions: [{ type: 'numerical', claim_a: 'rose 12%', claim_b: 'nearly doubled', evidence_quote_a: 'rose 12 percent',
                                   evidence_quote_b: 'nearly doubled', is_dialectic_intent: false, severity: 'high' }],
                logical_gaps: []
            },
            articleCoord: ARTICLE_COORD, relayHint: RELAY, articleUrl: ARTICLE_URL, beats: ['monetary-policy'], auditor: MODEL, modelParams: 'temperature=0'
        },
        async build(i, createdAt) { return withPubkey((await AB.buildModuleResultEvent({ ...i, createdAt })).event, TV1); }
    },
    {
        kind: 30057, shape: 'aggregate-audit', signer: 'TV1', rebuild: 'exact',
        builder: { module: 'src/shared/audit/builders.js', fn: 'buildAggregateAuditEvent' },
        notes: 'raw (71.2) > ceiling (80)? no — so NO ceiling-binding tag; finalScore <= min(raw, ceiling) invariant holds.',
        inputs: {
            articleHash: H['article:story'], runAt: '2023-11-14T22:13:25Z', finalScore: 64.5, rawScore: 71.2, ceiling: 80,
            ceilingSource: 'heuristic:source-quality/1.0', confidence: 0.71, knowabilityNotes: 'Ceiling derived from sourcing pattern: 50% named.',
            moduleContributions: [
                { module: 'internal_coherence', coord: `30056:${TV1.pubkey}:mod:1111111111111111`, eventId: H['agg-event'], score: 62, confidence: 0.78, weight: 0.10 },
                { module: 'source_quality', coord: `30056:${TV1.pubkey}:mod:2222222222222222`, score: 58, confidence: 0.8, weight: 0.20 }
            ],
            topStrengths: ['headline_body_fidelity: 88'], topConcerns: ['source_quality: 58'],
            articleUrl: ARTICLE_URL, beats: ['monetary-policy'], auditor: PIPELINE, constituents: [MODEL]
        },
        async build(i, createdAt) { return withPubkey((await AB.buildAggregateAuditEvent({ ...i, createdAt })).event, TV1); }
    },
    {
        kind: 30058, shape: 'prediction-entry', signer: 'TV1', rebuild: 'exact',
        builder: { module: 'src/shared/audit/builders.js', fn: 'buildPredictionEntryEvent' },
        notes: 'd = pred:sha16(hash|normalized text); content is the prediction text ONLY.',
        inputs: {
            articleHash: H['article:story'], predictionText: 'Rates will fall by December.', predictionType: 'explicit', hedgeLevel: 'confident',
            attribution: 'named_source', attributedName: 'Chair Powell', horizon: 'by the end of the year', horizonIso: '2026-12-31',
            criteria: 'Fed funds target below current on Dec 31', tractability: 'publicly_resolvable',
            evidenceQuote: 'rates will come down before December', moduleVersion: '1.0', articleUrl: ARTICLE_URL, auditor: MODEL
        },
        async build(i, createdAt) { return withPubkey((await AB.buildPredictionEntryEvent({ ...i, createdAt })).event, TV1); }
    },
    {
        kind: 30059, shape: 'prediction-resolution', signer: 'TV1', rebuild: 'exact',
        builder: { module: 'src/shared/audit/builders.js', fn: 'buildPredictionResolutionEvent' },
        notes: 'Typed evidence (url / nostr_event / quote); human auditor (TV1) adds [p, id, "", auditor].',
        inputs: {
            predictionCoord: `30058:${TV1.pubkey}:pred:1111111111111111`, articleHash: H['article:story'], outcome: 'false', confidence: 0.9,
            resolvedAt: '2027-01-15T00:00:00Z',
            evidence: [
                { kind: 'url', value: `${ORG}/data`, description: 'the December print' },
                { kind: 'nostr_event', value: `30023:${TV1.pubkey}:abcd1234abcd1234`, description: 'captured follow-up' },
                { kind: 'quote', value: 'rates ended the year higher', description: 'from the follow-up' }
            ],
            notes: 'Rates rose; the prediction failed on its own criteria.', auditor: HUMAN
        },
        async build(i, createdAt) { return withPubkey((await AB.buildPredictionResolutionEvent({ ...i, createdAt })).event, TV1); }
    },
    {
        kind: 30060, shape: 'dossier-snapshot', signer: 'TV1', rebuild: 'exact',
        builder: { module: 'src/shared/audit/builders.js', fn: 'buildDossierSnapshotEvent' },
        notes: 'publication_x_beat subject (TV3) with a canonical beat slug; per-module means key order follows the input (canonical literal).',
        inputs: {
            subjectKind: 'publication_x_beat', entityPubkey: TV3.pubkey, beat: 'monetary-policy',
            windowStart: '2023-01-01T00:00:00Z', windowEnd: '2023-11-14T00:00:00Z', articleCount: 14,
            scoreMean: 73.5, scoreMedian: 75, scoreStdev: 8.1, shrinkageK: 10, populationMean: 77, shrinkageFactor: 0.42,
            perModuleMeans: { omission: 71.5, source_quality: 68.2 },
            predictions: {
                total: 9, resolved: 4,
                calibration: { confident: { resolved: 2, true_count: 1, rate: 0.5 }, hedged: { resolved: 2, true_count: 2, rate: 1 }, speculative: { resolved: 0, true_count: 0, rate: null } },
                calibration_v1: { version: 'calibration-v1', mean_brier: 0.305, resolved_count: 4, multiplier: null }
            },
            auditor: PIPELINE
        },
        async build(i, createdAt) { return withPubkey((await AB.buildDossierSnapshotEvent({ ...i, createdAt })).event, TV1); }
    },
    {
        kind: 30061, shape: 'audit-dispute', signer: 'TV1', rebuild: 'exact',
        builder: { module: 'src/shared/audit/builders.js', fn: 'buildAuditDisputeEvent' },
        notes: 'Dispute of an aggregate audit by a human auditor (TV1); content = the dispute summary.',
        inputs: {
            targetCoord: `30057:${TV1.pubkey}:agg:2222222222222222`, targetKind: 'aggregate_audit', articleHash: H['article:story'],
            contested: ['the omission finding quoting "no parent was reached"'],
            evidence: [
                { kind: 'url', value: `${ORIGIN}/parents-statement`, description: 'parents were quoted here' },
                { kind: 'quote', value: 'we spoke to the reporter on Tuesday', description: 'from the statement' }
            ],
            disputeSummary: 'The omission module missed a published stakeholder response.', auditor: HUMAN
        },
        async build(i, createdAt) { return withPubkey((await AB.buildAuditDisputeEvent({ ...i, createdAt })).event, TV1); }
    },
    {
        kind: 30063, shape: 'verdict', signer: 'TV1', rebuild: 'exact',
        builder: { module: 'src/shared/truth-builders.js', fn: 'buildAdjudicatedVerdictEvent' },
        notes: 'event-fact / established-true under preponderance; NEVER a p tag. The truth tag() helper TRIMS trailing empty slots — compare raw arrays.',
        inputs: {
            claimCoord: CLAIM_COORD, propositionClass: 'event-fact', verdict: 'established-true', standardOfProof: 'preponderance',
            resolutionCriteria: { criteria: 'The official roll-call record.' }, subjectRole: 'enacted', occurredAt: 1614729600, occurredPrecision: 'day',
            evidenceFor: [{ quote: 'Roll-call 71: Nay.', tier: 'tier-1', url: `${ORG}/71` }],
            caveats: ['Could not verify a later motion.'], method: 'manual record check',
            rationale: 'Cross-checked against the certified journal.', sourceUrl: `${ORIGIN}/article`
        },
        async build(i, createdAt) { return withPubkey((await TB.buildAdjudicatedVerdictEvent({ ...i, createdAt })).event, TV1); }
    },
    {
        kind: 30064, shape: 'integrity-finding', signer: 'TV1', rebuild: 'exact',
        builder: { module: 'src/shared/truth-builders.js', fn: 'buildIntegrityFindingEvent' },
        notes: 'Words-vs-deeds finding: subject IS p-tagged (TV3, role subject); deliberately NO 1985 mirror exists for this kind.',
        inputs: {
            subjectPubkey: TV3.pubkey,
            word: { coord: `30040:${TV1.pubkey}:claim_word000000000000`, class: 'stated-commitment', occurredAt: 1600000000, occurredPrecision: 'day' },
            deeds: [
                { coord: `30040:${TV1.pubkey}:claim_deed100000000000`, class: 'event-fact', occurredAt: 1614729600, occurredPrecision: 'day' },
                { coord: `30040:${TV1.pubkey}:claim_deed200000000000`, class: 'state-fact' }
            ],
            match: 'broken', evidenceFor: [{ quote: 'Roll-call 88: Yea.', tier: 'tier-1' }], caveats: ['Single vote against a multi-year pledge.']
        },
        async build(i, createdAt) { return withPubkey((await TB.buildIntegrityFindingEvent({ ...i, createdAt })).event, TV1); }
    },
    {
        kind: 30068, shape: 'case-brief', signer: 'TV1', rebuild: 'exact',
        builder: { module: 'src/shared/corpus-publish.js', fn: 'buildCaseBriefEvent' },
        notes: 'Structured CaseBrief: content JSON {case_name, scope_question, summary, positions, cruxes, load_bearing, coverage_gaps} — no proposals, no score.',
        inputs: { record: CASE_RECORD, caseName: 'COVID origins', scopeQuestion: 'Where did it start?', memberIndex: MEMBER_INDEX, userPubkey: TV1.pubkey },
        build(i, createdAt) { return withPubkey(CP.buildCaseBriefEvent({ ...i, createdAt }), TV1); }
    },
    {
        kind: 30069, shape: 'owned-keys', signer: 'TV1', rebuild: 'exact',
        builder: { module: 'src/shared/identity-builders.js', fn: 'buildOwnedKeysManifest' },
        notes: 'Creator-binding manifest: rows sorted by pubkey (TV3 sorts before TV2 by hex); primary-signed, pubkey spread in by the reader.',
        inputs: { entities: [{ pubkey: TV3.pubkey, id: ENTITY_ID, name: 'Jane Roe' }, { pubkey: TV2.pubkey, id: CASE_ID, name: 'COVID origins' }] },
        build(i, createdAt) { return withPubkey(IB.buildOwnedKeysManifest({ ...i, createdAt }), TV1); }
    },
    {
        kind: 30070, shape: 'extraction-analysis', signer: 'TV1', rebuild: 'exact',
        builder: { module: 'src/shared/extraction-publish.js', fn: 'buildExtractionAnalysisEvent' },
        notes: 'Whole-unit disclosure: one accepted atom (endorsed a ref) + one open atom; face-value counts on tags; r/i/k anchoring.',
        inputs: {
            record: {
                articleHash: H['article:story'], url: ARTICLE_URL, title: 'The Story',
                assertions: [
                    EXTRACTION_ASSERTION({ status: 'accepted', accepted_claim_id: 'claim_1', accepted_why: 'HUMAN rationale: this is the load-bearing step', accepted_why_provenance: 'user' }),
                    EXTRACTION_ASSERTION({ key: 'a:90-99', quote: 'open span', start: 90, end: 99 })
                ],
                sources: [], open_questions: [], positions: [], merged_keys: ['k1'], dropped_ungrounded: 2, updatedAt: T
            },
            coordByClaimId: { claim_1: `30040:${TV1.pubkey}:claim_1` }, articleTitle: 'The Story', articleUrl: ARTICLE_URL, articleCoord: ARTICLE_COORD
        },
        build(i, createdAt) { return withPubkey(XP.buildExtractionAnalysisEvent({ ...i, createdAt }), TV1); }
    },
    {
        kind: 1, shape: 'mention-note', signer: 'TV3', rebuild: 'exact',
        builder: { module: 'src/shared/mention-notes.js', fn: 'buildMentionNoteEvent' },
        notes: 'ENTITY-signed (TV3) text note: r / a(mention) / x / p(publisher = TV1) / quote / client. A case entity may never sign one.',
        inputs: {
            entityPubkey: TV3.pubkey, entityType: 'person', publisherPubkey: TV1.pubkey, articleTitle: 'The Story', articleUrl: ARTICLE_URL,
            articleCoord: ARTICLE_COORD, articleHash: H['article:story'], quote: 'Jane Roe runs Acme Corp.'
        },
        build(i, createdAt) { return MN.buildMentionNoteEvent({ ...i, createdAt }); }
    },
    {
        kind: 5, shape: 'deletion', signer: 'TV1', rebuild: 'verify-only',
        builder: { module: 'src/shared/entity-sync.js', fn: 'clearRemote (inline literal — no builder function)' },
        notes: 'Hand-built to the exact clearRemote literal: e tags for the user\'s own 30078 ids (relay order), then [k, 30078], '
            + 'content "X-Ray entity sync — clear remote". verify-only because there is no builder to call; the test pins the literal shape.',
        inputs: { syncEventIds: [H['sync-event:1'], H['sync-event:2']], userPubkey: TV1.pubkey },
        build(i, createdAt) {
            return { kind: 5, pubkey: i.userPubkey, created_at: createdAt, tags: [...i.syncEventIds.map((id) => ['e', id]), ['k', '30078']], content: DELETION_CONTENT };
        }
    }
];

export function fixtureFileName(spec) { return `${spec.kind}-${spec.shape}.json`; }
export function specFor(kind, shape) { return SPECS.find((s) => s.kind === kind && s.shape === shape) || null; }

/** Rebuild the UNSIGNED event for a fixture from its own inputs + createdAt (the real builder, same adapter as generation). */
export async function rebuildUnsigned(fixture, pinnedEvent = null) {
    const spec = specFor(fixture.kind, fixture.shape);
    if (!spec) throw new Error(`no spec for ${fixture.kind}-${fixture.shape}`);
    const ev = await spec.build(sortKeysDeep(fixture.inputs), fixture.createdAt, pinnedEvent);
    if (!ev.pubkey) ev.pubkey = KEYS[fixture.signer].pubkey;
    return ev;
}

function readPinned(spec) {
    const path = join(FIXTURE_DIR, fixtureFileName(spec));
    if (!existsSync(path)) return null;
    try { return JSON.parse(readFileSync(path, 'utf8')); } catch (_) { return null; }
}

/** Build one fixture object in memory. `pinned` is the checked-in fixture (verify-only shapes reuse its event when still current). */
export async function buildFixture(spec, pinned = readPinned(spec)) {
    const inputs = sortKeysDeep(spec.inputs);
    const meta = { kind: spec.kind, shape: spec.shape, builder: spec.builder, signer: spec.signer, createdAt: T, inputs, rebuild: spec.rebuild, notes: spec.notes };
    const pinnedEvent = pinned && JSON.stringify(sortKeysDeep(pinned.inputs)) === JSON.stringify(inputs) && pinned.createdAt === T ? pinned.event : null;
    const unsigned = await spec.build(inputs, T, pinnedEvent);
    if (!unsigned.pubkey) unsigned.pubkey = KEYS[spec.signer].pubkey;
    const fresh = await signWith(unsigned, KEYS[spec.signer]);
    let event = fresh;
    if (spec.rebuild === 'verify-only' && pinnedEvent && spec.stillCurrent && (await spec.stillCurrent(pinnedEvent, fresh))) {
        event = pinnedEvent;
    }
    if (event.pubkey !== KEYS[spec.signer].pubkey) throw new Error(`${fixtureFileName(spec)}: pubkey is not ${spec.signer}`);
    if (!(await Crypto.verifySignature(event))) throw new Error(`${fixtureFileName(spec)}: does not verify`);
    return JSON.parse(stableStringify({ ...meta, event }));
}

/** Map<fileName, fixture> for every spec — what the test regenerates and compares. */
export async function buildAllFixtures() {
    const out = new Map();
    for (const spec of SPECS) out.set(fixtureFileName(spec), await buildFixture(spec));
    return out;
}

async function main() {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    const fixtures = await buildAllFixtures();
    for (const [file, fixture] of fixtures) {
        writeFileSync(join(FIXTURE_DIR, file), stableStringify(fixture));
        process.stdout.write(`wrote ${file}  (${fixture.rebuild}, ${fixture.signer}, ${fixture.event.tags.length} tags)\n`);
    }
    const stale = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.json') && !fixtures.has(f));
    for (const f of stale) process.stdout.write(`STALE (not in SPECS, left in place): ${f}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    await main();
}
