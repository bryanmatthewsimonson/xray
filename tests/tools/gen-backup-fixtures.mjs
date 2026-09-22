// Golden BACKUP fixture generator — the four `xray-backup/1` files under
//   tests/fixtures/backup/{full-v1,shareable-v1,bytes-omitted-v1,legacy-prestamp}.json
//
// RESET_PLAN §7 R0 "Golden fixtures before any refactor thread starts"
// (audit finding WIRE-05, docs/audit-2026-09-05/wire-and-schema.md: zero
// persisted-shape fixtures — a backup file written today has no pinned
// example, so a refactor of backup.js / the row normalizers / the
// storage encoding could change what restores without any test going
// red). tests/backup-fixtures.test.mjs restores each file through the
// CURRENT applyBackup, re-exports it through collectBackup, and asserts
// the invariants I1–I13 of the mapping pass's fixturePlan.
//
// How the files are made (the plan's own rule, RESET_PLAN §7 R0): the
// generator seeds a workspace BY HAND — storage keys in the Storage
// wrapper's JSON-string encoding, IndexedDB rows through the owning
// modules' openers with raw put()s (NEVER through recordSigned /
// recordPublished / saveArticle, whose timestamps read the clock) — and
// then EXPORTS through collectBackup, so a fixture is exactly what the
// shipping exporter writes. Only `exportedAt` and `xrayVersion` are
// overwritten afterwards (both are environment stamps: the clock and the
// manifest). shareable-v1 is collectBackup({shareable:true}) taken AFTER
// applyBackup(full-v1), so it is provably the same content minus the
// identity keys; bytes-omitted-v1 is collectBackup({includeSourceBytes:
// false}) of the same state; legacy-prestamp is hand-built to the
// pre-T1 shape (no dbVersions / xrayVersion, a v1-shaped journal row, a
// raw-object storage value) that older installs really wrote.
//
// Determinism: every timestamp derives from FIXED_TIME_S, every key is a
// BIP-340 test-vector scalar (fixture-keys.mjs — the only private keys a
// fixture may ever contain), signing is deterministic, hashes are sha256
// of fixed labels, and the output JSON has sorted keys. Running this
// twice yields byte-identical files; the test regenerates in memory and
// deep-equals the checked-in files, so a stale fixture is red.
//
// Run:  node tests/tools/gen-backup-fixtures.mjs
//
// Provenance: INTERPRETATION (2026-09-14) — an agent artifact under
// RESET_PLAN R0; the maintainer has not ruled on it.

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

await import('fake-indexeddb/auto');

// backup.js pulls storage.js, which probes chrome.storage.local at module
// load. A Map-backed, callback-style stub (the tests/backup.test.mjs
// idiom) is installed ONLY when a host test has not installed its own —
// the generator reads and writes storage through the chrome API alone,
// so it works against either.
if (!globalThis.chrome) {
    const _stateStore = new Map();
    globalThis.chrome = {
        storage: {
            local: {
                get(keys, cb) {
                    if (keys === null) { cb(Object.fromEntries(_stateStore)); return; }
                    const out = {};
                    for (const k of Array.isArray(keys) ? keys : [keys]) {
                        if (_stateStore.has(k)) out[k] = _stateStore.get(k);
                    }
                    cb(out);
                },
                set(obj, cb) {
                    for (const [k, v] of Object.entries(obj)) _stateStore.set(k, v);
                    cb && cb();
                },
                remove(keys, cb) {
                    for (const k of Array.isArray(keys) ? keys : [keys]) _stateStore.delete(k);
                    cb && cb();
                }
            }
        }
    };
}

import { REPO_ROOT, txDone, stableStringify, sortKeysDeep } from './idb-fixture-harness.mjs';
import {
    TV1, TV2, TV3, FIXED_TIME_S, FIXED_ISO, FIXTURE_ORIGIN, FIXTURE_RELAY, signWith, fixtureHash
} from './fixture-keys.mjs';

const { collectBackup, applyBackup, BACKUP_FORMAT } = await import('../../src/shared/backup.js');
const { WORKSPACE_CONTENT_KEYS, WORKSPACE_DATABASES } = await import('../../src/shared/workspace-keys.js');
const { openArchiveDb, urlHash } = await import('../../src/shared/archive-cache.js');
const { openAuditDb } = await import('../../src/shared/audit/audit-cache.js');
const { openEventJournalDb, eventAddress } = await import('../../src/shared/event-journal.js');
const { normalizeExtractionRecord } = await import('../../src/shared/map-artifacts.js');
const { replaceableKey } = await import('../../src/shared/nostr-events.js');
const { Crypto } = await import('../../src/shared/crypto.js');

export const GENERATOR = 'tests/tools/gen-backup-fixtures.mjs';
export const FIXTURE_DIR = join(REPO_ROOT, 'tests', 'fixtures', 'backup');
export const FIXTURE_FILES = Object.freeze([
    'full-v1.json', 'shareable-v1.json', 'bytes-omitted-v1.json', 'legacy-prestamp.json'
]);
/** The three current-format files: stamped, restorable through applyBackup (shareable is merge-only). */
export const STAMPED_FILES = Object.freeze(['full-v1.json', 'shareable-v1.json', 'bytes-omitted-v1.json']);

/** The `xrayVersion` stamp every generated file carries — informational only (backup.js extensionVersion). */
export const FIXTURE_XRAY_VERSION = '0.0.0-fixture';

const DB_OPENERS = {
    'xray-archive': openArchiveDb,
    'xray-audits': openAuditDb,
    'xray-events': openEventJournalDb
};

// ---------------------------------------------------------------------------
// Material

const T = FIXED_TIME_S;
const A_URL = `${FIXTURE_ORIGIN}/articles/fixture-a`;
const PDF_URL = `${FIXTURE_ORIGIN}/articles/fixture-a.pdf`;

// '%PDF-1.7\n' + a few non-ASCII bytes, so the base64 marker round trip is exercised.
export const PDF_BYTES = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x00, 0xff, 0x80, 0x7f]);

// The article's canonical body — PLAIN text (no '<', so assembleArticleBody
// passes it through unconverted) that contains every extraction quote
// verbatim: the MA.7 merge re-locates each quote HERE, and the test's
// merge-after-apply invariant needs every atom to land as `kept`.
const QUOTE_1 = 'The fixture council approved the relay budget on 14 November 2023.';
const QUOTE_2 = 'Every published event in this archive is signed by the fixture identity.';
export const ARTICLE_BODY = `${QUOTE_1}\n\nA second paragraph carries the second load-bearing sentence. ${QUOTE_2}\n\nA closing line with no claim in it.\n`;

const enc = (value) => JSON.stringify(sortKeysDeep(value));

async function sha256Hex(bytes) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function signedEvent(key, { kind, tags = [], content = '', created_at = T }) {
    const event = { kind, pubkey: key.pubkey, created_at, tags, content };
    const signed = await signWith(event, key);
    if (!(await Crypto.verifySignature(signed))) throw new Error(`fixture event kind ${kind} failed to verify`);
    return signed;
}

function keyData(key, name, metadata) {
    return {
        name,
        privateKey: key.privateKey,
        pubkey: key.pubkey,
        npub: key.npub,
        nsec: key.nsec,
        metadata,
        created: T
    };
}

// --- storage ---------------------------------------------------------------

/**
 * One id→record map per WORKSPACE_CONTENT_KEYS key (mergeStorageValue
 * only merges maps, so every content key is a map with ≥1 id). A key
 * added to the boundary list without a template here throws — the
 * generator, like the test, refuses to let a new content store ship
 * without a fixture.
 */
async function contentTemplates() {
    const claimId = `claim_${(await fixtureHash('claim:budget')).slice(0, 16)}`;
    const orgId = 'ent_org_fixture';
    const personId = 'ent_person_fixture';
    const hypId = `hyp_${(await fixtureHash('hypothesis:budget')).slice(0, 16)}`;
    const flushedArticleAddress = `30023:${TV1.pubkey}:fixture-article-a`;
    return {
        entities: {
            [orgId]: { id: orgId, type: 'organization', name: 'Fixture Council', pubkey: TV3.pubkey, npub: TV3.npub, created: T, updated: T },
            [personId]: { id: personId, type: 'person', name: 'A. Fixture', created: T, updated: T }
        },
        local_keys: {
            'xray:user': keyData(TV2, 'xray:user', { purpose: 'entity-sync' }),
            [`entity:${orgId}`]: keyData(TV3, `entity:${orgId}`, { entityId: orgId })
        },
        article_claims: {
            [claimId]: {
                id: claimId, text: 'The fixture council approved the relay budget.', source_url: A_URL,
                quote: QUOTE_1, entities: [orgId], is_key: false, created: T, updated: T,
                publishedAt: null, publishedEventId: null, publishedPubkeys: []
            }
        },
        evidence_links: {
            link_fixture_1: { id: 'link_fixture_1', from: claimId, to: claimId, relation: 'supports', created: T }
        },
        claim_assessments: {
            assess_fixture_1: { id: 'assess_fixture_1', claim_id: claimId, verdict: 'supported', notes: 'A fixture assessment.', created: T }
        },
        behavioral_findings: {
            finding_fixture_1: { id: 'finding_fixture_1', entity_id: orgId, pattern: 'fixture-pattern', claims: [claimId], created: T }
        },
        adjudicable_propositions: {
            prop_fixture_1: { id: 'prop_fixture_1', text: 'The relay budget was approved.', class: 'factual', claims: [claimId], created: T }
        },
        adjudicated_verdicts: {
            verdict_fixture_1: { id: 'verdict_fixture_1', proposition_id: 'prop_fixture_1', state: 'established', standard: 'preponderance', created: T }
        },
        integrity_findings: {
            integrity_fixture_1: { id: 'integrity_fixture_1', entity_id: orgId, words: [claimId], deeds: [], created: T }
        },
        platform_accounts: {
            acct_fixture_1: { id: 'acct_fixture_1', platform: 'web', handle: 'fixture-council', url: `${FIXTURE_ORIGIN}/fixture-council`, entity_id: orgId, created: T }
        },
        portal_identities: {
            [TV2.npub]: { id: TV2.npub, npub: TV2.npub, label: 'A followed portal viewer', added: T }
        },
        lens_jurisdictions: {
            jur_fixture_1: { id: 'jur_fixture_1', name: 'Fixture jurisdiction', type: 'civic', corpus: [], created: T }
        },
        url_aliases: {
            [`${FIXTURE_ORIGIN}/articles/fixture-a?utm=1`]: { id: `${FIXTURE_ORIGIN}/articles/fixture-a?utm=1`, canonical: A_URL, created: T }
        },
        entity_fact_dismissals: {
            dismiss_fact_fixture_1: { id: 'dismiss_fact_fixture_1', entity_id: orgId, fact_key: 'retired', at: T }
        },
        entity_dedupe_dismissals: {
            [`${orgId}|${personId}`]: { id: `${orgId}|${personId}`, a: orgId, b: personId, at: T }
        },
        follow_sets: {
            follow_fixture_1: { id: 'follow_fixture_1', pubkey: TV2.pubkey, npub: TV2.npub, label: 'A followed author', relays: [FIXTURE_RELAY], added: T }
        },
        incorporated_artifacts: {
            incorporated_fixture_1: { id: 'incorporated_fixture_1', address: flushedArticleAddress, from: TV2.pubkey, kind: 30023, at: T }
        },
        incorporation_dismissals: {
            dismissed_fixture_1: { id: 'dismissed_fixture_1', address: `30040:${TV2.pubkey}:claim-declined`, at: T }
        },
        case_hypotheses: {
            [hypId]: { id: hypId, case_id: orgId, text: 'The budget approval was routine.', status: 'open', created: T }
        },
        hypothesis_edges: {
            edge_fixture_1: { id: 'edge_fixture_1', claim_id: claimId, hypothesis_id: hypId, relation: 'supports', created: T }
        },
        published_mentions: {
            [`${orgId}|${flushedArticleAddress}`]: { id: `${orgId}|${flushedArticleAddress}`, entity_id: orgId, address: flushedArticleAddress, at: T }
        }
    };
}

async function storageEntries() {
    const templates = await contentTemplates();
    const out = {};
    for (const key of WORKSPACE_CONTENT_KEYS) {
        const map = templates[key];
        if (!map || typeof map !== 'object' || Object.keys(map).length === 0) {
            throw new Error(`gen-backup-fixtures: no content template for WORKSPACE_CONTENT_KEYS entry '${key}' — add one`);
        }
        out[key] = enc(map);
    }
    const stray = Object.keys(templates).filter((k) => !WORKSPACE_CONTENT_KEYS.includes(k));
    if (stray.length) throw new Error(`gen-backup-fixtures: templates for non-content keys: ${stray.join(', ')}`);

    // Install config (rides in full AND shareable copies).
    out.preferences = enc({ debug: false, default_relays: [FIXTURE_RELAY], signing_method: 'local' });
    out['xray:flags'] = enc({ captureAutomation: false });
    // The three identity keys, in the REAL module shapes:
    // storage.js primaryIdentity, identity-profiles.js, local-key-manager.js.
    out.local_primary_identity = enc({
        privateKey: TV1.privateKey, pubkey: TV1.pubkey, npub: TV1.npub, nsec: TV1.nsec, created: T
    });
    out.identity_profiles = enc({
        [TV1.pubkey]: {
            pubkey: TV1.pubkey, npub: TV1.npub, label: 'Fixture primary',
            privateKey: TV1.privateKey, nsec: TV1.nsec, created: T
        }
    });
    return out;
}

// --- databases -------------------------------------------------------------

async function journalEvents() {
    const flushed = await signedEvent(TV1, {
        kind: 30023,
        tags: [['d', 'fixture-article-a'], ['title', 'Fixture Article A'], ['r', A_URL]],
        content: `# Fixture Article A\n\n${ARTICLE_BODY}`,
        created_at: T + 20
    });
    const pending = await signedEvent(TV1, {
        kind: 30040,
        tags: [['d', 'claim_fixture_budget'], ['r', A_URL]],
        content: 'The fixture council approved the relay budget.',
        created_at: T + 40
    });
    return { flushed, pending };
}

/** Decoded rows (ArrayBuffers live) for every store of every covered DB. */
async function databaseRows() {
    const articleHash = await fixtureHash('article-hash:fixture-a');
    const aHash = await urlHash(A_URL);
    const pdfHash = await sha256Hex(PDF_BYTES);
    const corpusExtractKey = await fixtureHash('corpus-extract:fixture-a');
    const annotationId = await fixtureHash('event:annotation-1');
    const { flushed, pending } = await journalEvents();
    const confirmedRelays = [{ url: FIXTURE_RELAY, success: true, assumed: false }];

    const start1 = ARTICLE_BODY.indexOf(QUOTE_1);
    const start2 = ARTICLE_BODY.indexOf(QUOTE_2);
    if (start1 < 0 || start2 < 0) throw new Error('gen-backup-fixtures: ARTICLE_BODY must contain both quotes');

    const firstSeen = { model: 'claude-fixture', promptVersion: 'corpus-v9', producer: 'map', caseName: '', scopeQuestion: '', at: T };
    const assertion = (quote, start, why) => ({
        key: `a:${start}-${start + quote.length}`, quote, start, end: start + quote.length,
        text: null, why, status: 'open', accepted_claim_id: null, triaged_at: null,
        first_seen: firstSeen
    });
    // PRE-NORMALIZED: normalizeExtractionRecord(row) must deep-equal row
    // (every list present as an array, merged_keys strings, counts finite,
    // url/title strings) — the generator asserts it below.
    const extraction = {
        articleHash, url: A_URL, title: 'Fixture Article A',
        assertions: [
            assertion(QUOTE_1, start1, 'The budget decision is the article\'s central fact.'),
            assertion(QUOTE_2, start2, 'The signing claim is what the archive rests on.')
        ],
        sources: [{ key: 's:relay-budget-minutes', quote: 'the relay budget', target_hint: 'council minutes', first_seen: firstSeen }],
        open_questions: [{ key: 'q:who-voted-against-the-budget', text: 'Who voted against the budget?', first_seen: firstSeen }],
        positions: [],
        imported_unlocated: [],
        merged_keys: [corpusExtractKey],
        dropped_ungrounded: 0,
        updatedAt: T
    };
    const normalized = normalizeExtractionRecord(extraction);
    if (JSON.stringify(sortKeysDeep(normalized)) !== JSON.stringify(sortKeysDeep(extraction))) {
        throw new Error('gen-backup-fixtures: the article-extractions row is not pre-normalized');
    }

    const predId = `pred_${(await fixtureHash('prediction:relay')).slice(0, 16)}`;
    const resId = `res_${(await fixtureHash('resolution:relay')).slice(0, 16)}`;

    return {
        'xray-archive': {
            articles: [{
                urlHash: aHash, url: A_URL,
                article: { url: A_URL, title: 'Fixture Article A', content: ARTICLE_BODY, siteName: 'Example', byline: 'A. Fixture' },
                articleHash, priorVersions: [],
                cachedAt: T, lastAccessed: T + 60, source: 'capture',
                publishedToRelay: true, publishedEventId: flushed.id
            }],
            annotations: [{
                eventId: annotationId, urlHash: aHash, motivation: 'commenting', author: TV1.pubkey,
                createdAt: T + 100, body: 'A fixture annotation.'
            }],
            factchecks: [{
                eventId: await fixtureHash('event:factcheck-1'), urlHash: aHash, ratingValue: 'true',
                createdAt: T + 110, claim: QUOTE_1
            }],
            ratings: [{
                eventId: await fixtureHash('event:rating-1'), urlHash: aHash, createdAt: T + 120, value: 4
            }],
            helpfulness: [{
                eventId: await fixtureHash('event:helpfulness-1'), targetEventId: annotationId, voter: TV1.pubkey,
                createdAt: T + 130, helpful: true
            }],
            trust_graph: [{
                pubkey: TV1.pubkey, follows: [TV2.pubkey], updatedAt: T + 140
            }],
            source_documents: [{
                hash: pdfHash, bytes: PDF_BYTES.buffer.slice(0), mime: 'application/pdf',
                url: PDF_URL, size: PDF_BYTES.length, fetchedAt: T
            }]
        },
        'xray-audits': {
            runs: [{
                id: `audit_${(await fixtureHash('audit-run:fixture-a')).slice(0, 16)}`,
                articleHash, auditor: { kind: 'human', id: TV1.pubkey }, runAt: FIXED_ISO, source: 'manual',
                moduleResults: [{ module: 'prediction_extraction', module_version: '1.0', run_at: FIXED_ISO, findings: {}, failed: false }],
                aggregate: null, events: {}, created: T, updated: T
            }],
            predictions: [{
                id: predId, articleHash,
                text: 'The relay budget will be spent by 2025.', type: 'explicit', hedge_level: 'hedged',
                attributed_to: 'article_voice', attributed_source_name: null, condition: null,
                horizon: 'by 2025', horizon_iso: '2025-01-01', criteria: '', tractability: 'ambiguous',
                evidence_quote: QUOTE_1, anchor: null, claim_ref: null, auditor: null, extracted_at: null,
                resolution_status: 'resolved_true', latest_resolution_id: resId,
                publishedAt: null, publishedEventId: null, created: T, updated: T + 3600
            }],
            resolutions: [{
                id: resId, prediction_coord: `30058:${TV1.pubkey}:${predId}`, outcome: 'true', evidence: [],
                notes: 'Resolved in the fixture.', confidence: null, auditor: null, resolved_at: T + 3600,
                publishedAt: null, publishedEventId: null, created: T + 3600, updated: T + 3600
            }],
            'case-briefs': [{
                caseId: 'ent_org_fixture',
                brief: { summary: 'A one-paragraph fixture brief.', sections: [] },
                grounding: { checked: 1, dropped: 0 },
                inputHash: await fixtureHash('brief-input:fixture-case'),
                model: 'claude-fixture', promptVersion: 'corpus-v9',
                members: 1, analyzed: 1, failed: 0, usage: null
            }],
            'corpus-extracts': [{
                key: corpusExtractKey,
                extract: { key_assertions: [], source_references: [], open_questions: [] },
                model: 'claude-fixture', cachedAt: T
            }],
            'pending-suggestions': [{
                url: A_URL, articleHash, title: 'Fixture Article A',
                proposals: [{ kind: 'claim', text: 'The fixture council approved the relay budget.' }],
                model: 'claude-fixture', source: 'url-import', createdAt: T
            }],
            'case-link-suggestions': [{
                caseId: 'ent_org_fixture', acceptable: [], rejected: [],
                model: 'claude-fixture', promptVersion: 'claim-links-v1',
                claimCount: 1, truncatedClaims: 0, triage: {}, createdAt: T
            }],
            'entity-pages': [{
                entityId: 'ent_person_fixture',
                page: { sections: [] },
                grounding: { checked: 0, dropped: 0 },
                model: 'claude-fixture', promptVersion: 'entity-page-v1',
                inputHash: await fixtureHash('entity-page-input:fixture-person'),
                members: 1, analyzed: 1, createdAt: T
            }],
            'article-extractions': [extraction]
        },
        'xray-events': {
            published_events: [
                {
                    eventId: flushed.id, kind: flushed.kind, pubkey: flushed.pubkey,
                    address: replaceableKey(flushed), createdAt: flushed.created_at, event: flushed,
                    articleUrl: A_URL, signedAt: T + 20, publishedAt: T + 25, relays: confirmedRelays,
                    flush: { state: 'flushed', attempts: 1, nextAttemptAt: null },
                    ledger: null
                },
                {
                    eventId: pending.id, kind: pending.kind, pubkey: pending.pubkey,
                    address: replaceableKey(pending), createdAt: pending.created_at, event: pending,
                    articleUrl: A_URL, signedAt: T + 40, publishedAt: null, relays: [],
                    flush: { state: 'pending', attempts: 0, nextAttemptAt: T + 640 },
                    ledger: { model: 'claim', localId: 'claim_fixture_budget', extra: null, markedAt: null }
                }
            ]
        }
    };
}

// ---------------------------------------------------------------------------
// Seeding (default workspace, through the module openers, raw put())

function areaGetAll() {
    return new Promise((resolve) => chrome.storage.local.get(null, (all) => resolve(all || {})));
}

function areaRemove(keys) {
    return new Promise((resolve) => chrome.storage.local.remove(keys, () => resolve()));
}

function areaSet(obj) {
    return new Promise((resolve) => chrome.storage.local.set(obj, () => resolve()));
}

async function clearAllStores(db) {
    const names = Array.from(db.objectStoreNames);
    if (!names.length) return;
    const tx = db.transaction(names, 'readwrite');
    for (const n of names) tx.objectStore(n).clear();
    await txDone(tx);
}

async function putRows(db, storeName, rows) {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    for (const row of rows) store.put(row);
    await txDone(tx);
}

/** Empty the ACTIVE workspace: every storage key, every store of every covered DB. */
export async function emptyWorkspace() {
    const keys = Object.keys(await areaGetAll());
    if (keys.length) await areaRemove(keys);
    for (const name of WORKSPACE_DATABASES) {
        await clearAllStores(await DB_OPENERS[name]());
    }
}

async function seedWorkspace() {
    await emptyWorkspace();
    await areaSet(await storageEntries());
    const rows = await databaseRows();
    for (const name of WORKSPACE_DATABASES) {
        const db = await DB_OPENERS[name]();
        const live = Array.from(db.objectStoreNames).sort();
        const seeded = Object.keys(rows[name] || {}).sort();
        if (JSON.stringify(live) !== JSON.stringify(seeded)) {
            throw new Error(`gen-backup-fixtures: ${name} stores ${live.join(',')} != seeded ${seeded.join(',')} — add rows for the new store`);
        }
        for (const [store, list] of Object.entries(rows[name])) await putRows(db, store, list);
    }
}

// ---------------------------------------------------------------------------
// Files

/** Overwrite the two environment stamps with fixed values. */
function stamp(backup) {
    return { ...backup, exportedAt: FIXED_ISO, xrayVersion: FIXTURE_XRAY_VERSION };
}

/** Sorted-key, JSON-stable copy (what the file holds, what the test compares). */
function canonical(fixture) {
    const roundTrip = JSON.parse(stableStringify(fixture));
    if (JSON.stringify(roundTrip) !== JSON.stringify(sortKeysDeep(fixture))) {
        throw new Error('gen-backup-fixtures: fixture is not JSON-stable (undefined or non-plain values)');
    }
    return roundTrip;
}

/**
 * The pre-T1 file shape (backup.js header: "absent in older files, which
 * stay restorable"): no dbVersions, no xrayVersion, no includesSourceBytes;
 * a v1-shaped journal row (the pre-29.1 recordPublished literal, assumed-
 * only) and a RAW-OBJECT storage value (the legacy non-string encoding
 * decodeStorageValue tolerates). Its journal row migrates on the way in
 * with a clock-based nextAttemptAt, so its round trip is loosened.
 */
async function legacyFixture() {
    const event = await signedEvent(TV1, {
        kind: 30040, tags: [['d', 'claim_legacy_fixture']], content: 'A legacy fixture claim.', created_at: T - 86400
    });
    const legacyClaimId = 'claim_legacy_fixture';
    return {
        format: BACKUP_FORMAT,
        exportedAt: FIXED_ISO,
        storage: {
            preferences: enc({ debug: false, default_relays: [FIXTURE_RELAY] }),
            local_primary_identity: enc({
                privateKey: TV1.privateKey, pubkey: TV1.pubkey, npub: TV1.npub, nsec: TV1.nsec, created: T - 86400
            }),
            // Legacy raw-object value: written before the wrapper's JSON-string encoding.
            article_claims: {
                [legacyClaimId]: { id: legacyClaimId, text: 'A legacy fixture claim.', source_url: `${FIXTURE_ORIGIN}/legacy`, created: T - 86400 }
            }
        },
        databases: {
            'xray-archive': {
                articles: [{
                    urlHash: await urlHash(`${FIXTURE_ORIGIN}/legacy`), url: `${FIXTURE_ORIGIN}/legacy`,
                    article: { url: `${FIXTURE_ORIGIN}/legacy`, title: 'Legacy Article', content: 'A legacy fixture claim.' },
                    cachedAt: T - 86400, lastAccessed: T - 86400, source: 'capture',
                    publishedToRelay: false, publishedEventId: null
                }]
            },
            'xray-events': {
                published_events: [{
                    eventId: event.id, kind: event.kind, pubkey: event.pubkey,
                    address: eventAddress(event), createdAt: event.created_at, event,
                    publishedAt: T - 86400 + 5,
                    relays: [{ url: FIXTURE_RELAY, success: true, assumed: true }],
                    articleUrl: null
                }]
            }
        }
    };
}

/**
 * Build all four fixtures in memory: Map<fileName, fixture>. Seeds the
 * ACTIVE workspace (and leaves it holding full-v1's content — callers
 * that care re-apply afterwards).
 */
export async function buildAllFixtures() {
    await seedWorkspace();
    const full = canonical(stamp(await collectBackup({ includeSourceBytes: true })));

    // The plan's rule: the shareable and bytes-omitted files are exports
    // of the state full-v1 RESTORES to, so they are provably the same content.
    const warnings = [];
    await applyBackup(full, { warn: (m) => warnings.push(m) });
    if (warnings.length) throw new Error(`gen-backup-fixtures: applyBackup(full) warned: ${warnings.join(' | ')}`);
    const shareable = canonical(stamp(await collectBackup({ shareable: true })));
    const bytesOmitted = canonical(stamp(await collectBackup({ includeSourceBytes: false })));
    const legacy = canonical(await legacyFixture());

    // Self-checks the generator refuses to write without.
    for (const key of WORKSPACE_CONTENT_KEYS) {
        if (!(key in full.storage)) throw new Error(`gen-backup-fixtures: full-v1 lacks content key ${key}`);
    }
    for (const [db, stores] of Object.entries(full.databases)) {
        for (const [store, rows] of Object.entries(stores)) {
            if (!Array.isArray(rows) || rows.length === 0) throw new Error(`gen-backup-fixtures: ${db}/${store} is empty`);
        }
    }
    if (bytesOmitted.databases['xray-archive'].source_documents !== null) {
        throw new Error('gen-backup-fixtures: bytes-omitted-v1 must record source_documents as null');
    }
    if (shareable.shareable !== true || 'local_primary_identity' in shareable.storage) {
        throw new Error('gen-backup-fixtures: shareable-v1 is not a shareable copy');
    }

    return new Map([
        ['full-v1.json', full],
        ['shareable-v1.json', shareable],
        ['bytes-omitted-v1.json', bytesOmitted],
        ['legacy-prestamp.json', legacy]
    ]);
}

async function main() {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    const fixtures = await buildAllFixtures();
    for (const [file, fixture] of fixtures) {
        writeFileSync(join(FIXTURE_DIR, file), stableStringify(fixture));
        const stores = Object.values(fixture.databases || {})
            .reduce((n, s) => n + Object.keys(s).length, 0);
        process.stdout.write(`wrote ${file}  (storage keys=${Object.keys(fixture.storage).length} stores=${stores})\n`);
    }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    await main();
}
