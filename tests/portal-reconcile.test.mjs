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

const { loadLocalLedger, reconcile } = await import('../src/portal/reconcile.js');
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
            source: `30040:${PK_B}:claim_zzz`,
            target: coord,
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
    const saved = await saveArticle({
        article: { url: 'https://x.com/a', title: 'The Article' },
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

    // Article: d = the archive cache's urlHash.
    assert.deepEqual(bySource('article')[0].addrs, [`30023:${PK_A}:${saved.urlHash}`]);
    assert.equal(bySource('article')[0].publishedEventId, EV('5'));
});

test('loadLocalLedger: link with a local-id endpoint gets no addr (id-only match)', async () => {
    _stateStore.clear();
    await Storage.set('evidence_links', {
        link_cccccccccccccccc: {
            id: 'link_cccccccccccccccc',
            source: 'claim_local000000001',          // endpoint still a local id
            target: `30040:${PK_A}:claim_pub`,
            relationship: 'supports',
            publishedAt: 100, publishedEventId: EV('6'), publishedKind: 30055
        }
    });
    const ledger = await loadLocalLedger({ pubkeys: [PK_A] });
    const link = ledger.find((e) => e.source === 'link');
    assert.deepEqual(link.addrs, []);
    assert.equal(link.publishedEventId, EV('6'));
});
