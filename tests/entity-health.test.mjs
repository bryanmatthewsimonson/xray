// Entity-health tests — Phase 17A E1 (ENTITY_CORPUS_DESIGN §3.1).
// The deterministic duplicate report: three detectors, family
// exclusion, dismissals, determinism. Detectors only sort by
// suspicion — no test here asserts a merge happens automatically,
// because none ever does.

import { test } from 'node:test';
import assert from 'node:assert/strict';

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
            set(obj, cb) { for (const [k, v] of Object.entries(obj)) _stateStore.set(k, v); cb && cb(); },
            remove(keys, cb) { for (const k of Array.isArray(keys) ? keys : [keys]) _stateStore.delete(k); cb && cb(); }
        }
    }
};

const {
    nameClusterPairs, sharedAccountPairs, coMentionPairs,
    dedupeReport, recentMerges, DedupeDismissals
} = await import('../src/shared/entity-health.js');
const { dismissalKey } = await import('../src/shared/entity-facts.js');

const E = (id, name, type, extra = {}) => ({ id: `entity_${id}`, name, type, ...extra });

const VARGAS       = E('a'.repeat(16), 'Elena Vargas', 'person');
const MAYOR_VARGAS = E('b'.repeat(16), 'Mayor Elena Vargas', 'person');
const ACME         = E('c'.repeat(16), 'Acme Corp', 'organization');
const ACME_PLACE   = E('d'.repeat(16), 'Acme Corp', 'place');
const UNRELATED    = E('e'.repeat(16), 'Jordan Smith', 'person');

test('health: name detector — containment + exact, within type only', () => {
    const pairs = nameClusterPairs([VARGAS, MAYOR_VARGAS, ACME, ACME_PLACE, UNRELATED]);
    assert.equal(pairs.length, 1, 'cross-type same-name (Acme org vs place) is NOT a pair');
    assert.deepEqual([pairs[0].a, pairs[0].b].sort(), [VARGAS.id, MAYOR_VARGAS.id].sort());
    assert.equal(pairs[0].reason, 'token-containment');

    const exact = nameClusterPairs([VARGAS, E('f'.repeat(16), '  elena   VARGAS ', 'person')]);
    assert.equal(exact[0].reason, 'exact-normalized');

    // Partial token overlap is not containment.
    const none = nameClusterPairs([VARGAS, E('9'.repeat(16), 'Elena Cruz', 'person')]);
    assert.equal(none.length, 0);
});

test('health: shared-account detector — same platform identity, cross-key', () => {
    const accounts = {
        'youtube:UC123': { key: 'youtube:UC123', platform: 'youtube', stableId: 'UC123',
                           handle: 'elenav', linkedEntityId: VARGAS.id },
        'youtube:@elenav': { key: 'youtube:@elenav', platform: 'youtube', stableId: '@elenav',
                             handle: 'elenav', linkedEntityId: MAYOR_VARGAS.id },
        'twitter:jsmith': { key: 'twitter:jsmith', platform: 'twitter', stableId: 'jsmith',
                            handle: 'jsmith', linkedEntityId: UNRELATED.id }
    };
    const pairs = sharedAccountPairs([VARGAS, MAYOR_VARGAS, UNRELATED], accounts);
    assert.equal(pairs.length, 1);
    assert.deepEqual([pairs[0].a, pairs[0].b].sort(), [VARGAS.id, MAYOR_VARGAS.id].sort());
    assert.equal(pairs[0].evidence.platform, 'youtube');
});

test('health: co-mention detector — containing spans, same article, same type', () => {
    const articles = [{
        url: 'https://x.test/a',
        entities: [
            { entity_id: VARGAS.id, context: 'Elena Vargas said the audit' },
            { entity_id: MAYOR_VARGAS.id, context: 'Mayor Elena Vargas said the audit today' },
            { entity_id: UNRELATED.id, context: 'Jordan Smith disagreed' }
        ]
    }];
    const pairs = coMentionPairs([VARGAS, MAYOR_VARGAS, UNRELATED], articles);
    assert.equal(pairs.length, 1);
    assert.equal(pairs[0].detector, 'co-mention');
    assert.equal(pairs[0].evidence.article_url, 'https://x.test/a');
});

test('health: dedupeReport — family exclusion, dismissals, determinism, clustering', () => {
    const entities = {
        [VARGAS.id]: VARGAS,
        [MAYOR_VARGAS.id]: MAYOR_VARGAS,
        [UNRELATED.id]: UNRELATED
    };
    const base = { entities, accounts: {}, articles: [] };

    const r1 = dedupeReport(base);
    assert.equal(r1.counts.pairs, 1);
    assert.equal(r1.clusters.length, 1);
    assert.deepEqual(r1.clusters[0].detectors, ['name']);

    // Determinism: same inputs, deep-equal output.
    assert.deepEqual(dedupeReport(base), r1);

    // Already-merged pair vanishes (same alias family).
    const merged = {
        ...entities,
        [MAYOR_VARGAS.id]: { ...MAYOR_VARGAS, canonical_id: VARGAS.id }
    };
    assert.equal(dedupeReport({ ...base, entities: merged }).counts.pairs, 0,
        'a pair inside one alias family is not a suspect');

    // Dismissed pair vanishes.
    const dismissals = { [dismissalKey(VARGAS.id, MAYOR_VARGAS.id)]: { dismissed_at: 1, note: '' } };
    assert.equal(dedupeReport({ ...base, dismissals }).counts.pairs, 0,
        '"Not duplicates" suppresses the pair');
});

test('health: multi-detector pairs collapse into one cluster', () => {
    const entities = { [VARGAS.id]: VARGAS, [MAYOR_VARGAS.id]: MAYOR_VARGAS };
    const accounts = {
        'youtube:UC1': { key: 'youtube:UC1', platform: 'youtube', stableId: 'UC1', handle: 'ev', linkedEntityId: VARGAS.id },
        'youtube:@ev': { key: 'youtube:@ev', platform: 'youtube', stableId: '@ev', handle: 'ev', linkedEntityId: MAYOR_VARGAS.id }
    };
    const report = dedupeReport({ entities, accounts, articles: [] });
    assert.equal(report.clusters.length, 1, 'same ids under two detectors = one cluster');
    assert.deepEqual(report.clusters[0].detectors, ['account', 'name']);
    assert.equal(report.counts.pairs, 2);
});

test('health: recentMerges — alias rows newest first; dismissal store round-trips', async () => {
    const rows = [
        { ...MAYOR_VARGAS, canonical_id: VARGAS.id, updated: 200 },
        { ...UNRELATED, canonical_id: VARGAS.id, updated: 300 },
        VARGAS
    ];
    const merges = recentMerges(rows);
    assert.deepEqual(merges.map((m) => m.id), [UNRELATED.id, MAYOR_VARGAS.id]);

    _stateStore.clear();
    await DedupeDismissals.dismiss(VARGAS.id, MAYOR_VARGAS.id, 'father and son');
    const all = await DedupeDismissals.getAll();
    assert.ok(all[dismissalKey(MAYOR_VARGAS.id, VARGAS.id)], 'order-independent key');
    assert.equal(all[dismissalKey(VARGAS.id, MAYOR_VARGAS.id)].note, 'father and son');
    assert.equal(await DedupeDismissals.undismiss(VARGAS.id, MAYOR_VARGAS.id), true);
    assert.deepEqual(await DedupeDismissals.getAll(), {});
});
