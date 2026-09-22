// Golden IndexedDB fixture generator — one self-describing dump per
// shipped DB_VERSION per database:
//   tests/fixtures/idb/<db>-v<N>.json
//
// RESET_PLAN §7 R0 "Golden fixtures before any refactor thread starts"
// (audit finding WIRE-05, docs/audit-2026-09-05/wire-and-schema.md: zero
// persisted-shape fixtures; xray-audits at v7 with no upgrade-from-v(n)
// test). The generic test tests/idb-fixtures.test.mjs seeds each file at
// its version, lets the CURRENT module upgrade it, and reads every row
// back through the current API — so a ladder edit that strands a real
// install's rows is a red, not a field bug.
//
// Design (map option D): each fixture carries its OWN schema block plus
// rows already passed through backup.js toSerializable (ArrayBuffers as
// {__xrayBytes} markers). Each rung is seeded RAW — indexedDB.open(name, N)
// with the ladder below — never through a src/ module (which would
// upgrade to HEAD), then dumped with a versionless open. The ladders are
// hand-copied from HEAD's onupgradeneeded capped at N; the mapping pass
// verified by `git show` that every rung commit's ladder equals HEAD's
// capped there (ladders are additive-only; nothing was ever dropped or
// renamed). Rows are the literals each store's INTRODUCING commit wrote
// (ROW NOTES below name the fields that landed later without a bump).
//
// Determinism: every timestamp derives from FIXED_TIME_S, every key is a
// BIP-340 test-vector scalar (fixture-keys.mjs), signing is deterministic,
// hashes are sha256 of fixed labels, and output JSON has sorted keys.
// Running this twice yields byte-identical files; the test regenerates in
// memory and deep-equals the checked-in files, so a stale fixture is red.
//
// Run:  node tests/tools/gen-idb-fixtures.mjs
//
// Provenance: INTERPRETATION (2026-09-08) — an agent artifact under
// RESET_PLAN R0; the maintainer has not ruled on it.

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

await import('fake-indexeddb/auto');

// backup.js / archive-cache.js pull storage.js, which probes
// chrome.storage.local at module load. The minimal stub (no
// active_workspace → 'default') is only installed when a host test has
// not already installed its own.
globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

import {
    FIXTURE_DIR, fixtureFileName, openRawAt, openRawVersionless, createSchema,
    putRows, getAllRows, describeSchema, stableStringify, sortKeysDeep
} from './idb-fixture-harness.mjs';
import {
    TV1, TV2, FIXED_TIME_S, FIXED_ISO, FIXTURE_ORIGIN, FIXTURE_RELAY, signWith, fixtureHash
} from './fixture-keys.mjs';

const { toSerializable } = await import('../../src/shared/backup.js');
const { urlHash } = await import('../../src/shared/archive-cache.js');
const { Crypto } = await import('../../src/shared/crypto.js');

export const GENERATOR = 'tests/tools/gen-idb-fixtures.mjs';

// ---------------------------------------------------------------------------
// Schema ladders — HEAD's onupgradeneeded, one entry per rung, cumulative.

const IDX = (name, keyPath = name) => ({ name, keyPath, unique: false });
const STORE = (keyPath, indexes = []) => ({ keyPath, autoIncrement: false, indexes });

const LADDERS = {
    'xray-archive': {
        // ecfec1b — Phase 7. (The file header's `lru` store was never minted.)
        1: { articles: STORE('urlHash', [IDX('lastAccessed'), IDX('publishedToRelay'), IDX('cachedAt')]) },
        // 7e614c2 — Phase 9a metadata stores: minted, never written or read.
        2: {
            annotations: STORE('eventId', [IDX('urlHash'), IDX('motivation'), IDX('author'), IDX('createdAt')]),
            factchecks: STORE('eventId', [IDX('urlHash'), IDX('ratingValue'), IDX('createdAt')]),
            ratings: STORE('eventId', [IDX('urlHash'), IDX('createdAt')]),
            helpfulness: STORE('eventId', [IDX('targetEventId'), IDX('voter'), IDX('createdAt')]),
            trust_graph: STORE('pubkey')
        },
        // c7b3121 — Phase 18 source documents.
        3: { source_documents: STORE('hash', [IDX('url'), IDX('fetchedAt')]) }
    },
    'xray-audits': {
        // aeb2dbe — Phase 13.1. Index NAME is camelCase, keyPath snake_case.
        1: {
            runs: STORE('id', [IDX('articleHash'), IDX('runAt')]),
            predictions: STORE('id', [IDX('articleHash'), IDX('resolutionStatus', 'resolution_status'), IDX('horizonIso', 'horizon_iso')]),
            resolutions: STORE('id', [IDX('predictionCoord', 'prediction_coord')])
        },
        2: { 'case-briefs': STORE('caseId') },               // b0847d6 — 20.4
        3: { 'corpus-extracts': STORE('key') },              // 84a2556
        4: { 'pending-suggestions': STORE('url') },          // 07806af — 28.2 (writer retired by UA.3)
        5: { 'case-link-suggestions': STORE('caseId') },     // ca58e77 — 28.3
        6: { 'entity-pages': STORE('entityId') },            // b58255e — EP.2
        7: { 'article-extractions': STORE('articleHash') }   // 3b9bf23 — MA.1
    },
    'xray-events': {
        // a81bda1 — 29.0 journal.
        1: { published_events: STORE('eventId', [IDX('kind'), IDX('address'), IDX('articleUrl'), IDX('publishedAt')]) },
        // d02105a — 29.1: ONE new index (nested keyPath) + the data pass.
        2: { published_events: STORE('eventId', [IDX('kind'), IDX('address'), IDX('articleUrl'), IDX('publishedAt'), IDX('flushState', 'flush.state')]) }
    },
    'xray-network': {
        // d2dda97 — 25.2b.
        1: { events: STORE('id', [IDX('kind'), IDX('pubkey'), IDX('created_at'), IDX('addr')]), meta: STORE('key') }
    },
    'xray-portal': {
        // 857ce3f — 12.3.
        1: { events: STORE('id', [IDX('kind'), IDX('pubkey'), IDX('created_at'), IDX('addr')]), meta: STORE('key') }
    }
};

const RUNG_COMMITS = {
    'xray-archive': { 1: 'ecfec1b', 2: '7e614c2', 3: 'c7b3121' },
    'xray-audits': { 1: 'aeb2dbe', 2: 'b0847d6', 3: '84a2556', 4: '07806af', 5: 'ca58e77', 6: 'b58255e', 7: '3b9bf23' },
    'xray-events': { 1: 'a81bda1', 2: 'd02105a' },
    'xray-network': { 1: 'd2dda97' },
    'xray-portal': { 1: '857ce3f' }
};

// ROW NOTES — what each rung's rows deliberately LACK because the field
// landed later without a version bump (so a real install at that rung
// never wrote it). Carried into producedBy.note.
const RUNG_NOTES = {
    'xray-archive': {
        1: 'articles rows are the ecfec1b literal: no articleHash/priorVersions (811929e, no bump) and no captureUrl (e775c44, no bump).',
        2: 'articles rows byte-identical to v1 (7e614c2 changed no row); the five metadata stores were minted with no writer or reader in any commit — carried with ZERO rows, as every real install has them.',
        3: 'articles rows are the c7b3121 literal (articleHash + priorVersions present, captureUrl absent — e775c44 landed three days later without a bump); source_documents carries a real byte payload whose hash is sha256(bytes); metadata stores still empty.'
    },
    'xray-audits': {
        1: 'runs/predictions/resolutions are the aeb2dbe audit-model literals: no captureArticleHash, no publishedPubkey, no module_version/claim_ref_at/article_hash (all later, no bump).',
        2: 'adds case-briefs in the b0847d6 synthesis-block literal (no triage/recovered/cached — 04bab21, no bump). Older stores keep their introducing-commit literal.',
        3: 'adds corpus-extracts in the 84a2556 literal (no partial — e544406, no bump).',
        4: 'adds pending-suggestions in the 07806af import-urls literal; the writer was retired by UA.3 but HEAD still reads and deletes these rows, so the rung carries one.',
        5: 'adds case-link-suggestions in the ca58e77 links-block literal (no list/count API at HEAD — read raw or by caseId).',
        6: 'adds entity-pages in the 1e1a0b6 first-writer literal (store minted in b58255e; no keySelection/edited/publishedAt — later, no bump).',
        7: 'adds article-extractions in the 3b9bf23 MA.1 literal (no assertions[].text / first_seen.producer — 842e555 MA.4; no imported_unlocated — 056b581 MA.7; both no bump). articleHash is 64-hex so mergeExtractionRows trusts the record.'
    },
    'xray-events': {
        1: 'the a81bda1 recordPublished literal (address by eventAddress; no signedAt/flush/ledger) — the FIVE address-rule cases the v1->v2 migration recomputes: confirmed d-tagged, assumed-only, kind-0 null address, d-less null address, empty-d "kind:pubkey:". Every event is really signed by TV1.',
        2: 'the d02105a recordSigned / recordFlushAttempt literal (address by replaceableKey, signedAt, flush, ledger) — pending, flushed and replaceable kind-0 rows. Every event is really signed by TV1.'
    },
    'xray-network': {
        1: 'the d2dda97 rowFromRecord literal (no dTag — unlike xray-portal): addressable, replaceable (addr kind:pubkey) and regular (addr "") events, plus the lastLookedAt cursor and one profile:<pubkey> row in meta. Events signed by TV1 (own) and TV2 (a followed author).'
    },
    'xray-portal': {
        1: 'the 857ce3f rowFromRecord literal (with dTag): addressable, replaceable and regular events, plus the one `sync` meta row. Every event is really signed by TV1.'
    }
};

/** Cumulative schema at `version` (rungs <= version merged; the later rung wins for a re-declared store). */
export function schemaAt(db, version) {
    const ladder = LADDERS[db];
    if (!ladder) throw new Error(`no ladder for ${db}`);
    const out = {};
    for (const v of Object.keys(ladder).map(Number).sort((a, b) => a - b)) {
        if (v > version) continue;
        for (const [store, spec] of Object.entries(ladder[v])) {
            out[store] = {
                keyPath: spec.keyPath,
                autoIncrement: spec.autoIncrement,
                indexes: [...spec.indexes].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
            };
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// Row material

const T = FIXED_TIME_S;
const A_URL = `${FIXTURE_ORIGIN}/a`;
const B_URL = `${FIXTURE_ORIGIN}/b`;
const PDF_URL = `${FIXTURE_ORIGIN}/a.pdf`;

// '%PDF-1.7\n' + a few non-ASCII bytes, so the base64 marker round trip is exercised.
const PDF_BYTES = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x00, 0xff, 0x80, 0x7f]);

const CONFIRMED_RELAYS = [{ url: FIXTURE_RELAY, success: true, assumed: false }];
const ASSUMED_RELAYS = [{ url: FIXTURE_RELAY, success: true, assumed: true }];

async function sha256Hex(bytes) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hash16(label) {
    return (await fixtureHash(label)).slice(0, 16);
}

/** A really-signed event: deterministic id + sig from (event, key). */
async function signedEvent(key, { kind, tags = [], content = '', created_at = T }) {
    const event = { kind, pubkey: key.pubkey, created_at, tags, content };
    const signed = await signWith(event, key);
    if (!(await Crypto.verifySignature(signed))) throw new Error(`fixture event kind ${kind} failed to verify`);
    return signed;
}

const dTagOf = (event) => (((event.tags || []).find((t) => t[0] === 'd')) || [])[1];

// --- xray-archive ------------------------------------------------------------

async function archiveRows(version) {
    const pdfHash = await sha256Hex(PDF_BYTES);
    const aHash = await urlHash(A_URL);
    const bHash = await urlHash(B_URL);
    const publishedB = await fixtureHash('event:article-b');

    // ecfec1b record literal (v1 and v2 rungs).
    const v1Articles = [
        {
            urlHash: aHash, url: A_URL,
            article: { url: A_URL, title: 'Article A', content: '<p>Article A body.</p>' },
            cachedAt: T, lastAccessed: T + 60, source: 'capture',
            publishedToRelay: false, publishedEventId: null
        },
        {
            urlHash: bHash, url: B_URL,
            article: { url: B_URL, title: 'Article B', content: '<p>Article B body.</p>' },
            cachedAt: T + 100, lastAccessed: T + 100, source: 'relay',
            publishedToRelay: true, publishedEventId: publishedB
        }
    ];

    // c7b3121 record literal (v3 rung): articleHash + priorVersions.
    const v3Articles = [
        {
            urlHash: aHash, url: A_URL,
            article: {
                url: A_URL, title: 'Article A', markdown: '# Article A\n\nArticle A body.',
                content: '<p>Article A body.</p>', extraction: { source_hash: pdfHash }
            },
            articleHash: await fixtureHash('article-hash:a'),
            priorVersions: [],
            cachedAt: T, lastAccessed: T + 60, source: 'capture',
            publishedToRelay: false, publishedEventId: null
        },
        {
            urlHash: bHash, url: B_URL,
            article: {
                url: B_URL, title: 'Article B', markdown: '# Article B\n\nArticle B body, revised.',
                content: '<p>Article B body, revised.</p>'
            },
            articleHash: await fixtureHash('article-hash:b'),
            priorVersions: [{
                article: {
                    url: B_URL, title: 'Article B', markdown: '# Article B\n\nArticle B body.',
                    content: '<p>Article B body.</p>'
                },
                articleHash: await fixtureHash('article-hash:b:prior'),
                cachedAt: T + 100, source: 'capture', displacedAt: T + 200
            }],
            cachedAt: T + 100, lastAccessed: T + 200, source: 'capture',
            publishedToRelay: true, publishedEventId: publishedB
        }
    ];

    const rows = { articles: version >= 3 ? v3Articles : v1Articles };
    if (version >= 2) {
        // Minted, never written, never read: every real install has them empty.
        Object.assign(rows, { annotations: [], factchecks: [], ratings: [], helpfulness: [], trust_graph: [] });
    }
    if (version >= 3) {
        rows.source_documents = [{
            hash: pdfHash, bytes: PDF_BYTES.buffer.slice(0), mime: 'application/pdf',
            url: PDF_URL, size: PDF_BYTES.length, fetchedAt: T
        }];
    }
    return rows;
}

// --- xray-audits -------------------------------------------------------------

async function auditRows(version) {
    const ahA = await fixtureHash('article-hash:a');
    const predOpenId = `pred_${await hash16('prediction:open')}`;
    const predResolvedId = `pred_${await hash16('prediction:resolved')}`;
    const resId = `res_${await hash16('resolution:1')}`;
    const predCoord = `30058:${TV1.pubkey}:${predResolvedId}`;
    const corpusExtractKey = await fixtureHash('corpus-extract:a');

    const prediction = (id, over) => ({
        id, articleHash: ahA,
        text: '', type: 'explicit', hedge_level: 'hedged', attributed_to: 'article_voice',
        attributed_source_name: null, condition: null, horizon: '', horizon_iso: null,
        criteria: '', tractability: 'ambiguous', evidence_quote: '', anchor: null,
        claim_ref: null, auditor: null, extracted_at: null,
        resolution_status: 'open', latest_resolution_id: null,
        publishedAt: null, publishedEventId: null, created: T, updated: T,
        ...over
    });

    const rows = {
        runs: [{
            id: `audit_${await hash16('audit-run:a')}`,
            articleHash: ahA,
            auditor: { kind: 'human', id: TV1.pubkey },
            runAt: FIXED_ISO,
            source: 'manual',
            moduleResults: [{
                module: 'prediction_extraction', module_version: '1.0', run_at: FIXED_ISO,
                findings: {}, failed: false
            }],
            aggregate: null,
            events: {},
            created: T, updated: T
        }],
        predictions: [
            prediction(predOpenId, {
                text: 'Example will publish a second article by 2027.',
                horizon: 'by 2027', horizon_iso: '2027-01-01'
            }),
            prediction(predResolvedId, {
                text: 'Example will retire the v1 store within a year.',
                horizon: 'within a year', horizon_iso: '2024-11-14',
                auditor: { kind: 'human', id: TV1.pubkey }, extracted_at: T,
                resolution_status: 'resolved_true', latest_resolution_id: resId,
                updated: T + 3600
            })
        ],
        resolutions: [{
            id: resId,
            prediction_coord: predCoord,
            outcome: 'true',
            evidence: [],
            notes: 'Resolved in the fixture.',
            confidence: null,
            auditor: null,
            resolved_at: T + 3600,
            publishedAt: null, publishedEventId: null,
            created: T + 3600, updated: T + 3600
        }]
    };
    if (version >= 2) {
        rows['case-briefs'] = [{
            caseId: 'ent_case_fixture',
            brief: { summary: 'A one-paragraph fixture brief.', sections: [] },
            grounding: { checked: 1, dropped: 0 },
            inputHash: await fixtureHash('brief-input:case'),
            model: 'claude-fixture', promptVersion: 'corpus-v1',
            members: 1, analyzed: 1, failed: 0, usage: null
        }];
    }
    if (version >= 3) {
        rows['corpus-extracts'] = [{
            key: corpusExtractKey,
            extract: { key_assertions: [], source_references: [], open_questions: [] },
            model: 'claude-fixture', cachedAt: T
        }];
    }
    if (version >= 4) {
        rows['pending-suggestions'] = [{
            url: A_URL, articleHash: ahA, title: 'Article A',
            proposals: [{ kind: 'claim', text: 'Article A asserts a fixture claim.' }],
            model: 'claude-fixture', source: 'url-import', createdAt: T
        }];
    }
    if (version >= 5) {
        rows['case-link-suggestions'] = [{
            caseId: 'ent_case_fixture', acceptable: [], rejected: [],
            model: 'claude-fixture', promptVersion: 'claim-links-v1',
            claimCount: 1, truncatedClaims: 0, triage: {}, createdAt: T
        }];
    }
    if (version >= 6) {
        rows['entity-pages'] = [{
            entityId: 'ent_person_fixture',
            page: { sections: [] },
            grounding: { checked: 0, dropped: 0 },
            model: 'claude-fixture', promptVersion: 'entity-page-v1',
            inputHash: await fixtureHash('entity-page-input:person'),
            members: 1, analyzed: 1, createdAt: T
        }];
    }
    if (version >= 7) {
        rows['article-extractions'] = [{
            articleHash: ahA, url: A_URL, title: 'Article A',
            assertions: [{
                key: 'a:0-15', quote: 'Article A body.', start: 0, end: 15,
                why: 'The only sentence.', status: 'open',
                accepted_claim_id: null, triaged_at: null,
                first_seen: { model: 'claude-fixture', promptVersion: 'map-v7', caseName: '', scopeQuestion: '', at: T }
            }],
            sources: [], open_questions: [], positions: [],
            merged_keys: [corpusExtractKey],
            dropped_ungrounded: 0, updatedAt: T
        }];
    }
    return rows;
}

// --- xray-events -------------------------------------------------------------

/** a81bda1 eventAddress: `kind:pubkey:d` for addressable kinds with a d tag, else null. */
function v1Address(event) {
    if (!(event.kind >= 30000 && event.kind < 40000)) return null;
    const d = (event.tags || []).find((t) => t[0] === 'd');
    return d ? `${event.kind}:${event.pubkey}:${d[1] || ''}` : null;
}

function v1Row(event, { publishedAt, relays, articleUrl = null }) {
    return {
        eventId: event.id, kind: event.kind, pubkey: event.pubkey,
        address: v1Address(event), createdAt: event.created_at, event,
        publishedAt, relays, articleUrl
    };
}

async function eventRowsV1() {
    const confirmed = await signedEvent(TV1, { kind: 30023, tags: [['d', 'article-1']], content: '# Article A' });
    const assumed = await signedEvent(TV1, { kind: 30040, tags: [['d', 'claim_x']], content: 'A claim.', created_at: T + 1 });
    const kind0 = await signedEvent(TV1, { kind: 0, tags: [], content: '{"name":"Fixture"}', created_at: T + 2 });
    const dless = await signedEvent(TV1, { kind: 30078, tags: [], content: '', created_at: T + 3 });
    const emptyD = await signedEvent(TV1, { kind: 30040, tags: [['d', '']], content: 'Empty d.', created_at: T + 4 });
    return {
        published_events: [
            v1Row(confirmed, { publishedAt: T + 1000, relays: CONFIRMED_RELAYS, articleUrl: A_URL }),
            v1Row(assumed, { publishedAt: T + 2000, relays: ASSUMED_RELAYS }),
            v1Row(kind0, { publishedAt: T + 3000, relays: CONFIRMED_RELAYS }),
            v1Row(dless, { publishedAt: T + 4000, relays: ASSUMED_RELAYS }),
            v1Row(emptyD, { publishedAt: T + 5000, relays: CONFIRMED_RELAYS })
        ]
    };
}

async function eventRowsV2() {
    const { replaceableKey } = await import('../../src/shared/nostr-events.js');
    const pending = await signedEvent(TV1, { kind: 30040, tags: [['d', 'claim_fixture']], content: 'A pending claim.', created_at: T + 10 });
    const flushed = await signedEvent(TV1, { kind: 30023, tags: [['d', 'article-1']], content: '# Article A', created_at: T + 20 });
    const profile = await signedEvent(TV1, { kind: 0, tags: [], content: '{"name":"Fixture"}', created_at: T + 30 });
    const base = (event, articleUrl) => ({
        eventId: event.id, kind: event.kind, pubkey: event.pubkey,
        address: replaceableKey(event), createdAt: event.created_at, event, articleUrl
    });
    return {
        published_events: [
            {
                ...base(pending, null),
                signedAt: T + 10, publishedAt: null, relays: [],
                flush: { state: 'pending', attempts: 0, nextAttemptAt: T + 10 },
                ledger: { model: 'claim', localId: 'claim_fixture', extra: null, markedAt: null }
            },
            {
                ...base(flushed, A_URL),
                signedAt: T + 20, publishedAt: T + 25, relays: CONFIRMED_RELAYS,
                flush: { state: 'flushed', attempts: 1, nextAttemptAt: null },
                ledger: null
            },
            {
                ...base(profile, null),
                signedAt: T + 30, publishedAt: T + 35, relays: CONFIRMED_RELAYS,
                flush: { state: 'flushed', attempts: 1, nextAttemptAt: null },
                ledger: null
            }
        ]
    };
}

// --- xray-network / xray-portal ----------------------------------------------

async function cacheEvents(authorOfOthers) {
    const { replaceableKey } = await import('../../src/shared/nostr-events.js');
    const article = await signedEvent(TV1, { kind: 30023, tags: [['d', 'a1']], content: '# Article A' });
    const profile = await signedEvent(authorOfOthers, { kind: 0, tags: [], content: '{"name":"Followed"}', created_at: T + 1 });
    const note = await signedEvent(authorOfOthers, { kind: 1, tags: [], content: 'A note.', created_at: T + 2 });
    return [article, profile, note].map((event) => ({
        event,
        addr: replaceableKey(event) || '',   // '' for regular events — IDB indexes skip absent keys
        dTag: dTagOf(event) || ''
    }));
}

async function networkRows() {
    const events = await cacheEvents(TV2);
    return {
        events: events.map(({ event, addr }) => ({
            id: event.id, kind: event.kind, pubkey: event.pubkey, created_at: event.created_at,
            addr, event, relays: [FIXTURE_RELAY], firstSeenAt: T + 5, lastSeenAt: T + 5
        })),
        meta: [
            { key: 'lastLookedAt', value: T + 5 },
            { key: `profile:${TV2.pubkey}`, value: { name: 'Followed', about: 'A fixture profile.', updatedAt: T + 1 } }
        ]
    };
}

async function portalRows() {
    const events = await cacheEvents(TV1);
    return {
        events: events.map(({ event, addr, dTag }) => ({
            id: event.id, kind: event.kind, pubkey: event.pubkey, created_at: event.created_at,
            dTag, addr, event, relays: [FIXTURE_RELAY], firstSeenAt: T + 5, lastSeenAt: T + 5
        })),
        meta: [{
            key: 'sync',
            value: {
                lastSyncAt: T + 5,
                authorsKey: await fixtureHash('portal:authors'),
                relaysKey: await fixtureHash('portal:relays')
            }
        }]
    };
}

const ROW_BUILDERS = {
    'xray-archive': archiveRows,
    'xray-audits': auditRows,
    'xray-events': (version) => (version >= 2 ? eventRowsV2() : eventRowsV1()),
    'xray-network': () => networkRows(),
    'xray-portal': () => portalRows()
};

// ---------------------------------------------------------------------------
// Seed RAW, dump RAW, serialize

/** Every (db, version) rung this generator produces, in file order. */
export function rungList() {
    const out = [];
    for (const db of Object.keys(LADDERS).sort()) {
        for (const version of Object.keys(LADDERS[db]).map(Number).sort((a, b) => a - b)) out.push({ db, version });
    }
    return out;
}

/** Build one fixture object in memory (seeds a private raw database, dumps it, serializes). */
export async function buildFixture(db, version) {
    const schema = schemaAt(db, version);
    const rows = await ROW_BUILDERS[db](version);

    const missing = Object.keys(schema).filter((s) => !(s in rows));
    const extra = Object.keys(rows).filter((s) => !(s in schema));
    if (missing.length || extra.length) {
        throw new Error(`${db} v${version}: rows/schema mismatch (missing ${missing}, extra ${extra})`);
    }

    // Private name: never a name a src/ module resolves, so a host test's
    // module handles are untouched; put() is idempotent by key, so a
    // second build in the same process yields the same dump.
    const name = `xray-fixture-gen:${db}:v${version}`;
    const seeded = await openRawAt(name, version, (target) => createSchema(target, schema));
    try {
        for (const [store, list] of Object.entries(rows)) await putRows(seeded, store, list);
    } finally { seeded.close(); }

    const raw = await openRawVersionless(name);
    let dumpedSchema, stores;
    try {
        if (raw.version !== version) throw new Error(`${name}: dumped at v${raw.version}, expected v${version}`);
        dumpedSchema = describeSchema(raw);
        stores = {};
        for (const store of Array.from(raw.objectStoreNames)) {
            stores[store] = toSerializable(await getAllRows(raw, store));   // key-ascending by IDB contract
        }
    } finally { raw.close(); }

    const fixture = {
        db,
        version,
        producedBy: {
            generator: GENERATOR,
            commitOfRung: RUNG_COMMITS[db][version],
            note: RUNG_NOTES[db][version]
        },
        schema: dumpedSchema,
        stores
    };

    // Self-checks: the fixture must survive JSON verbatim (no undefined,
    // no non-plain values) and archive rows must key by the module's urlHash.
    const roundTrip = JSON.parse(stableStringify(fixture));
    if (JSON.stringify(roundTrip) !== JSON.stringify(sortKeysDeep(fixture))) {
        throw new Error(`${db} v${version}: fixture is not JSON-stable`);
    }
    if (db === 'xray-archive') {
        for (const row of stores.articles) {
            if ((await urlHash(row.url)) !== row.urlHash) throw new Error(`${db} v${version}: urlHash(${row.url}) != ${row.urlHash}`);
        }
    }
    return roundTrip;
}

/** Map<fileName, fixture> for every rung — what the test regenerates and compares. */
export async function buildAllFixtures() {
    const out = new Map();
    for (const { db, version } of rungList()) {
        out.set(fixtureFileName(db, version), await buildFixture(db, version));
    }
    return out;
}

async function main() {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    const fixtures = await buildAllFixtures();
    for (const [file, fixture] of fixtures) {
        writeFileSync(join(FIXTURE_DIR, file), stableStringify(fixture));
        const counts = Object.entries(fixture.stores).map(([s, r]) => `${s}=${r.length}`).join(' ');
        process.stdout.write(`wrote ${file}  (${counts})\n`);
    }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    await main();
}
