// portal/reconcile.js tests — Phase 12.6 (docs/PORTAL_DESIGN.md).
//
// Two layers under test: the pure ledger-vs-items diff (confirmed by
// exact event id, confirmed by replaceable address when republished,
// missing, remote-only, no-ledger) and the storage-touching
// loadLocalLedger (real models against the chrome shim +
// fake-indexeddb, pinning every addr-derivation rule — claim
// coordinates from publishedPubkeys, the recomputable assess:/rel:
// d-tags, entity kind-0 addresses, article urlHash addresses).

import { test } from 'node:test';
import assert from 'node:assert/strict';

await import('fake-indexeddb/auto');

const _stateStore = new Map();
globalThis.chrome = {
    storage: {
        local: {
            get(keys, cb) {
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

const { loadLocalLedger, reconcile, countLocalOnly } = await import('../src/portal/reconcile.js');
const { Storage } = await import('../src/shared/storage.js');
const { Crypto } = await import('../src/shared/crypto.js');
const { saveArticle } = await import('../src/shared/archive-cache.js');

const PK_A = 'a'.repeat(64);
const PK_B = 'b'.repeat(64);
const ENTITY_PK = 'f'.repeat(64);
const EV = (n) => n.repeat(64);

function item(id, kind, pubkey, { d, relays = ['wss://r'] } = {}) {
    return {
        id, kind,
        event: { id, kind, pubkey, created_at: 1000, tags: d !== undefined ? [['d', d]] : [], content: '' },
        relays
    };
}

// ------------------------------------------------------------------
// reconcile() — pure
// ------------------------------------------------------------------

test('reconcile: exact id, address-match, missing, remote-only, no-ledger', () => {
    const ledger = [
        { source: 'claim', localId: 'claim_1', label: 'one', publishedEventId: EV('1'),
          addrs: [`30040:${PK_A}:claim_1`] },
        { source: 'claim', localId: 'claim_2', label: 'two', publishedEventId: EV('2'),
          addrs: [`30040:${PK_A}:claim_2`] },
        { source: 'claim', localId: 'claim_3', label: 'three', publishedEventId: EV('3'),
          addrs: [`30040:${PK_A}:claim_3`] }
    ];
    const items = [
        item(EV('1'), 30040, PK_A, { d: 'claim_1' }),          // exact id match
        item(EV('9'), 30040, PK_A, { d: 'claim_2' }),          // republished — addr match only
        item(EV('8'), 30040, PK_A, { d: 'claim_x' }),          // remote-only (ledgered kind)
        item(EV('7'), 30041, PK_A, { d: 'cmt:1' })             // no-ledger kind
    ];
    const r = reconcile(ledger, items);
    assert.deepEqual(r.summary, { ledgerPublished: 3, confirmed: 2, missing: 1, remoteOnly: 1 });
    assert.equal(r.missing[0].localId, 'claim_3');
    assert.equal(ledger[0].status, 'confirmed');
    assert.equal(ledger[1].status, 'confirmed-version');
    assert.equal(r.statusByEventId[EV('1')], 'confirmed');
    assert.equal(r.statusByEventId[EV('9')], 'confirmed');
    assert.equal(r.statusByEventId[EV('8')], 'remote-only');
    assert.equal(r.statusByEventId[EV('7')], 'no-ledger');
});

test('reconcile: empty inputs are calm', () => {
    const r = reconcile([], []);
    assert.deepEqual(r.summary, { ledgerPublished: 0, confirmed: 0, missing: 0, remoteOnly: 0 });
    assert.deepEqual(r.missing, []);
});

// ------------------------------------------------------------------
// loadLocalLedger() — against the real models
// ------------------------------------------------------------------

test('loadLocalLedger derives every addr rule from the local stores', async () => {
    _stateStore.clear();
    const coord = `30040:${PK_A}:claim_pub0000000001`;

    await Storage.set('article_claims', {
        claim_pub0000000001: {
            id: 'claim_pub0000000001', text: 'Published claim', source_url: 'https://x.com/a',
            publishedAt: 100, publishedEventId: EV('1'),
            publishedPubkey: PK_A, publishedPubkeys: [PK_A, PK_B]
        },
        claim_unpub00000002: { id: 'claim_unpub00000002', text: 'Never published', source_url: 'https://x.com/b' }
    });
    await Storage.set('claim_assessments', {
        assess_aaaaaaaaaaaaaaaa: {
            id: 'assess_aaaaaaaaaaaaaaaa',
            claim_ref: { coord, text: 'Published claim' },
            stance: -1, labels: [], rationale: 'r',
            publishedAt: 110, publishedEventId: EV('2')
        }
    });
    await Storage.set('evidence_links', {
        link_bbbbbbbbbbbbbbbb: {
            id: 'link_bbbbbbbbbbbbbbbb',
            // Real records store canonical refs under *_claim_id —
            // pinned here after the 12.7 review caught reconcile
            // reading nonexistent source/target fields.
            source_claim_id: `30040:${PK_B}:claim_zzz`,
            target_claim_id: coord,
            relationship: 'contradicts',
            // publishedKind matters: the 30043-retirement migration
            // clears publish markers that lack it (normalizeLink).
            publishedAt: 120, publishedEventId: EV('3'), publishedKind: 30055
        }
    });
    await Storage.set('entities', {
        entity_0123456789abcdef: {
            id: 'entity_0123456789abcdef', name: 'Someone', type: 'person',
            keyName: 'entity:entity_0123456789abcdef',
            publishedAt: 130, publishedEventId: EV('4')
        }
    });
    await Storage.set('local_keys', {
        'entity:entity_0123456789abcdef': { name: 'entity:entity_0123456789abcdef', pubkey: ENTITY_PK, privateKey: '1'.repeat(64) }
    });
    // A URL the archive's normalization rewrites — pins that the
    // article address uses the RAW-url hash (the wire d), not urlHash.
    const RAW_URL = 'https://X.com/a?utm_source=test';
    const saved = await saveArticle({
        article: { url: RAW_URL, title: 'The Article' },
        publishedToRelay: true,
        publishedEventId: EV('5')
    });

    const { LocalKeyManager } = await import('../src/shared/local-key-manager.js');
    await LocalKeyManager.init();

    const ledger = await loadLocalLedger({ pubkeys: [PK_A] });
    const bySource = (s) => ledger.filter((e) => e.source === s);

    // Claim: one entry per published claim, addrs across the pubkey history.
    assert.equal(bySource('claim').length, 1);
    assert.deepEqual(bySource('claim')[0].addrs.sort(), [
        `30040:${PK_A}:claim_pub0000000001`,
        `30040:${PK_B}:claim_pub0000000001`
    ]);

    // Assessment: d = assess:<sha16(coord)> across resolved pubkeys.
    const expectedAssessD = 'assess:' + (await Crypto.sha256(coord)).slice(0, 16);
    assert.deepEqual(bySource('assessment')[0].addrs, [`30054:${PK_A}:${expectedAssessD}`]);

    // Link: symmetric relationship sorts the coords before hashing.
    const [cA, cB] = [`30040:${PK_B}:claim_zzz`, coord].sort();
    const expectedRelD = 'rel:' + (await Crypto.sha256(`${cA}|${cB}|contradicts`)).slice(0, 16);
    assert.deepEqual(bySource('link')[0].addrs, [`30055:${PK_A}:${expectedRelD}`]);

    // Entity: replaceable kind-0 address under the entity's own key.
    assert.deepEqual(bySource('entity')[0].addrs, [`0:${ENTITY_PK}`]);

    // Article: d = sha256 of the RAW capture url (what the published
    // 30023 actually carries) — NOT the archive's normalized urlHash.
    const expectedArticleD = (await Crypto.sha256(saved.url || RAW_URL)).slice(0, 16);
    assert.deepEqual(bySource('article')[0].addrs, [`30023:${PK_A}:${expectedArticleD}`]);
    assert.equal(bySource('article')[0].publishedEventId, EV('5'));
});

test('countLocalOnly tallies never-published records across the models', async () => {
    _stateStore.clear();
    await Storage.set('article_claims', {
        claim_pub0000000001: {
            id: 'claim_pub0000000001', text: 'published', source_url: 'https://x.com/a',
            publishedAt: 100, publishedEventId: EV('1'), publishedPubkey: PK_A
        },
        claim_unpub00000002: { id: 'claim_unpub00000002', text: 'draft 1', source_url: 'https://x.com/b' },
        claim_unpub00000003: { id: 'claim_unpub00000003', text: 'draft 2', source_url: 'https://x.com/c' }
    });
    await Storage.set('claim_assessments', {
        assess_aaaaaaaaaaaaaaaa: { id: 'assess_aaaaaaaaaaaaaaaa', claim_ref: { text: 't' }, stance: 1, labels: [], rationale: '' }
    });
    const counts = await countLocalOnly();
    assert.equal(counts.claim, 2);
    assert.equal(counts.assessment, 1);
    assert.equal(counts.total >= 3, true);
});

test('loadLocalLedger: link with a local-id endpoint gets no addr (id-only match)', async () => {
    _stateStore.clear();
    await Storage.set('evidence_links', {
        link_cccccccccccccccc: {
            id: 'link_cccccccccccccccc',
            source_claim_id: 'claim_local000000001', // endpoint still a local id
            target_claim_id: `30040:${PK_A}:claim_pub`,
            relationship: 'supports',
            publishedAt: 100, publishedEventId: EV('6'), publishedKind: 30055
        }
    });
    const ledger = await loadLocalLedger({ pubkeys: [PK_A] });
    const link = ledger.find((e) => e.source === 'link');
    assert.deepEqual(link.addrs, []);
    assert.equal(link.publishedEventId, EV('6'));
});

// ------------------------------------------------------------------
// Audit kinds (13.8) — the publish ledger added for 30056–30059
// ------------------------------------------------------------------

const AUDIT_HASH = 'd'.repeat(64);
const RUN_AT = '2026-06-11T20:14:05Z';
const AUDITOR = { kind: 'model', id: 'anthropic/claude-sonnet-4-6' };
const sha16 = async (s) => (await Crypto.sha256(String(s))).slice(0, 16);

test('loadLocalLedger: audit addrs are recomputable from the records', async () => {
    const { AuditRunModel, PredictionModel, ResolutionModel } =
        await import('../src/shared/audit/audit-model.js');

    const run = await AuditRunModel.create({
        articleHash: AUDIT_HASH, auditor: AUDITOR, runAt: RUN_AT, source: 'cli-import',
        moduleResults: [
            { module: 'internal_coherence', module_version: '1.0', run_at: RUN_AT, failed: false },
            { module: 'omission', module_version: '1.0', run_at: RUN_AT, failed: false }
        ],
        aggregate: { final_score: 60 }
    });
    // Publish marks: one module + the aggregate. The unmarked module
    // must yield NO ledger entry — never published, nothing to confirm.
    await AuditRunModel.markEventPublished(run.id, 'mod:internal_coherence', EV('a'));
    await AuditRunModel.markEventPublished(run.id, 'agg', EV('b'));

    const pred = await PredictionModel.create({
        articleHash: AUDIT_HASH, text: 'Rates Will  Fall.',
        criteria: 'c', evidence_quote: 'q', tractability: 'publicly_resolvable'
    });
    await PredictionModel.markPublished(pred.id, EV('c'));

    const predCoord = `30058:${PK_A}:pred:${pred.id.slice('pred_'.length)}`;
    const res = await ResolutionModel.create({
        predictionCoord: predCoord, outcome: 'true', auditor: { kind: 'human', id: PK_A }
    });
    await ResolutionModel.markPublished(res.id, EV('d'));

    const ledger = await loadLocalLedger({ pubkeys: [PK_A] });
    const audits = ledger.filter((e) => e.source === 'audit');
    assert.equal(audits.length, 2, 'one entry per PUBLISHED run event — the unmarked module stays off the ledger');

    const modD = 'mod:' + (await sha16(`${AUDIT_HASH}|internal_coherence|1.0|${RUN_AT}`));
    const aggD = 'agg:' + (await sha16(`${AUDIT_HASH}|${AUDITOR.id}|${RUN_AT}`));
    assert.deepEqual(audits.find((e) => e.localId.endsWith('mod:internal_coherence')).addrs,
        [`30056:${PK_A}:${modD}`]);
    assert.deepEqual(audits.find((e) => e.localId.endsWith('/agg')).addrs,
        [`30057:${PK_A}:${aggD}`]);

    // Prediction: the local id shares its sha16 with the wire d.
    const predEntry = ledger.find((e) => e.source === 'prediction');
    assert.deepEqual(predEntry.addrs, [`30058:${PK_A}:pred:${pred.id.slice('pred_'.length)}`]);
    assert.equal(predEntry.publishedEventId, EV('c'));

    // Resolution: res:<sha16(coord)> — the id's own derivation.
    const resEntry = ledger.find((e) => e.source === 'resolution');
    assert.deepEqual(resEntry.addrs, [`30059:${PK_A}:res:${res.id.slice('res_'.length)}`]);
});

test('countLocalOnly: audit buckets count never-published records only', async () => {
    const { AuditRunModel, PredictionModel, ResolutionModel } =
        await import('../src/shared/audit/audit-model.js');

    // Self-contained: create BOTH a marked and an unmarked run here,
    // so the partial-run-exclusion assertion holds even when this
    // test runs in isolation (the shared fake-indexeddb DB makes the
    // prior test's records an order-dependence hazard otherwise).
    const marked = await AuditRunModel.create({
        articleHash: AUDIT_HASH, auditor: AUDITOR, runAt: '2026-06-12T02:00:00Z',
        source: 'cli-import',
        moduleResults: [{ module: 'omission', module_version: '1.0', run_at: '2026-06-12T02:00:00Z', failed: false }],
        aggregate: null
    });
    await AuditRunModel.markEventPublished(marked.id, 'mod:omission', EV('e'));
    await AuditRunModel.create({
        articleHash: AUDIT_HASH, auditor: AUDITOR, runAt: '2026-06-12T01:00:00Z',
        source: 'cli-import',
        moduleResults: [{ module: 'omission', module_version: '1.0', run_at: '2026-06-12T01:00:00Z', failed: false }],
        aggregate: null
    });
    await PredictionModel.create({
        articleHash: AUDIT_HASH, text: 'Another, unpublished prediction.',
        criteria: 'c', evidence_quote: 'q'
    });
    await ResolutionModel.create({
        predictionCoord: `30058:${PK_B}:pred:${'1'.repeat(16)}`, outcome: 'false'
    });

    const counts = await countLocalOnly();
    assert.equal(counts.auditRun, 1, 'the marked run is not local-only; the unmarked one is');
    assert.equal(counts.prediction, 1);
    assert.equal(counts.resolution, 1);
    assert.equal(counts.total >= 3, true);
});

test('reconcile: audit kinds are ledgered — unledgered ones surface as remote-only', () => {
    const ledger = [
        { source: 'audit', localId: 'audit_x/agg', label: 'agg', publishedEventId: EV('1'),
          addrs: [`30057:${PK_A}:agg:${'2'.repeat(16)}`] }
    ];
    const items = [
        item(EV('9'), 30057, PK_A, { d: 'agg:' + '2'.repeat(16) }),  // republished — addr match
        item(EV('8'), 30058, PK_A, { d: 'pred:' + '3'.repeat(16) }), // remote-only: ledgered kind, no record
        item(EV('6'), 30056, PK_A, { d: 'mod:' + '5'.repeat(16) }),  // remote-only: ledgered kind, no record
        item(EV('5'), 30059, PK_A, { d: 'res:' + '6'.repeat(16) }),  // remote-only: ledgered kind, no record
        item(EV('7'), 30061, PK_A, { d: 'dispute:' + '4'.repeat(16) }), // 30061 has no publish path — no-ledger
        item(EV('4'), 30060, PK_A, { d: 'dossier:' + '7'.repeat(16) })  // 30060 deferred — no-ledger by design
    ];
    const r = reconcile(ledger, items);
    assert.equal(r.statusByEventId[EV('9')], 'confirmed');
    assert.equal(r.statusByEventId[EV('8')], 'remote-only');
    assert.equal(r.statusByEventId[EV('6')], 'remote-only');
    assert.equal(r.statusByEventId[EV('5')], 'remote-only');
    assert.equal(r.statusByEventId[EV('7')], 'no-ledger');
    assert.equal(r.statusByEventId[EV('4')], 'no-ledger');
    assert.deepEqual(r.summary, { ledgerPublished: 1, confirmed: 1, missing: 0, remoteOnly: 3 });
});

test('loadLocalLedger: the 30056 address derives from findings.version, not the wrapper field', async () => {
    const { AuditRunModel } = await import('../src/shared/audit/audit-model.js');
    const run = await AuditRunModel.create({
        articleHash: 'e'.repeat(64), auditor: AUDITOR, runAt: RUN_AT, source: 'cli-import',
        moduleResults: [{
            module: 'internal_coherence', module_version: '1.0', run_at: RUN_AT,
            findings: { module: 'internal_coherence', version: '1.1' }, failed: false
        }],
        aggregate: null
    });
    await AuditRunModel.markEventPublished(run.id, 'mod:internal_coherence', EV('f'));
    const ledger = await loadLocalLedger({ pubkeys: [PK_A] });
    const entry = ledger.find((e) => e.source === 'audit' && e.localId === `${run.id}/mod:internal_coherence`);
    const d = 'mod:' + (await sha16(`${'e'.repeat(64)}|internal_coherence|1.1|${RUN_AT}`));
    assert.deepEqual(entry.addrs, [`30056:${PK_A}:${d}`],
        'the builder derives the wire d from findings.version — the ledger must recompute the same way');
});

// --- Phase 15.9: verdict + integrity ledger scans ------------------------

test('loadLocalLedger: published verdicts/integrity findings rebuild their 3006x addrs', async () => {
    _stateStore.clear();
    const { TruthAdjudicationModel, VerdictModel } = await import('../src/shared/truth-adjudication-model.js');
    const { IntegrityModel } = await import('../src/shared/integrity-model.js');
    const { ClaimModel } = await import('../src/shared/claim-model.js');

    const claim = await ClaimModel.create({
        text: 'The senator voted against the bill.',
        source_url: 'https://example.com/a', about: ['entity_x']
    });
    const prop = await TruthAdjudicationModel.create({
        claim_id: claim.id, proposition_class: 'event-fact',
        resolution_criteria: { criteria: 'Roll-call.' }, subject_role: 'enacted'
    });
    const v = await VerdictModel.create({
        proposition_id: prop.id, verdict: 'insufficient-evidence',
        caveats: ['single source']
    });
    await VerdictModel.markPublished(v.id, 'e'.repeat(64), PK_A, 'verdict_dtag_16char');

    const word = await TruthAdjudicationModel.create({
        claim_id: (await ClaimModel.create({
            text: 'I will vote against every tax.', source_url: 'https://example.com/w', about: ['entity_x']
        })).id,
        proposition_class: 'stated-commitment',
        resolution_criteria: { criteria: 'Recording.' }, subject_role: 'stated'
    });
    const f = await IntegrityModel.create({
        word_proposition_id: word.id, deed_proposition_ids: [prop.id],
        match: 'broken', evidence_for: [{ quote: 'Roll-call 88: Yea.' }],
        caveats: ['one vote']
    });
    await IntegrityModel.markPublished(f.id, 'f'.repeat(64), PK_A, 'integrity_dtag_16ch');

    const ledger = await loadLocalLedger({ pubkeys: [PK_A] });
    const vEntry = ledger.find((e) => e.source === 'verdict');
    assert.ok(vEntry, 'verdicts are ledgered');
    assert.deepEqual(vEntry.addrs, [`30063:${PK_A}:verdict_dtag_16char`]);
    const iEntry = ledger.find((e) => e.source === 'integrity');
    assert.ok(iEntry, 'integrity findings are ledgered');
    assert.deepEqual(iEntry.addrs, [`30064:${PK_A}:integrity_dtag_16ch`]);
});

test('countLocalOnly: unpublished chain heads count; superseded rulings never do', async () => {
    _stateStore.clear();
    const { TruthAdjudicationModel, VerdictModel } = await import('../src/shared/truth-adjudication-model.js');
    const { ClaimModel } = await import('../src/shared/claim-model.js');
    const claim = await ClaimModel.create({
        text: 'Another claim.', source_url: 'https://example.com/b'
    });
    const prop = await TruthAdjudicationModel.create({
        claim_id: claim.id, proposition_class: 'event-fact',
        resolution_criteria: { criteria: 'x' }, subject_role: 'enacted'
    });
    const v1 = await VerdictModel.create({
        proposition_id: prop.id, verdict: 'unresolved', caveats: ['waiting']
    });
    await VerdictModel.create({
        proposition_id: prop.id, supersedes: v1.id, verdict: 'insufficient-evidence',
        caveats: ['still thin']
    });
    const counts = await countLocalOnly();
    assert.equal(counts.verdict, 1, 'only the chain head — a superseded ruling never publishes by design');
    assert.ok(counts.total >= 1);
});
