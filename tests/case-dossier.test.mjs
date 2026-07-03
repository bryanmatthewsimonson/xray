// Case dossier — CD.1 orbit assembler tests
// (docs/CASE_DOSSIER_DESIGN.md §3, §6). Same chrome.storage.local shim
// pattern as truth-adjudication-model.test.mjs. Records are seeded
// directly into the stores the models read, so the fixture controls
// created-time, occurred_at, precision, supersession, and attestation
// exactly — the assembler's composition logic is what's under test, not
// the models' own validation (those have their own suites).

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

const { assembleCaseDossier } = await import('../src/shared/case-dossier.js');

// ------------------------------------------------------------------
// Fixture — an eggs-shaped orbit exercising every section.
// ------------------------------------------------------------------

const CASE = 'entity_case';

function keyed(records) {
    const out = {};
    for (const r of records) out[r.id] = r;
    return out;
}

function seedFixture() {
    _stateStore.clear();

    _stateStore.set('entities', keyed([
        { id: CASE,           name: 'Eggs case',  type: 'case' },
        { id: 'entity_zhong', name: 'Zhong 2019', type: 'publication' },
        { id: 'entity_eco',   name: 'EcoHealth',  type: 'organization',
          keypair: { pubkey: 'pk_eco' } },
        { id: 'entity_other', name: 'Offshore',   type: 'organization' }
    ]));

    _stateStore.set('article_claims', keyed([
        { id: 'claim_1', text: 'eggs bad',   about: [CASE, 'entity_zhong'],
          source: null, is_key: true,  source_url: 'https://u1', created: 100 },
        { id: 'claim_2', text: 'eggs fine',  about: [CASE, 'entity_eco'],
          source: null, is_key: false, source_url: 'https://u2', created: 200 },
        { id: 'claim_3', text: 'eggs prot',  about: [CASE],
          source: null, is_key: false, source_url: 'https://u1', created: 300 },
        // NOT about the case — must be excluded from the orbit.
        { id: 'claim_out', text: 'unrelated', about: ['entity_other'],
          source: null, is_key: false, source_url: 'https://u9', created: 400 }
    ]));

    _stateStore.set('adjudicable_propositions', keyed([
        { id: 'prop_1', claim_id: 'claim_1', proposition_class: 'state-fact',
          resolution_criteria: { criteria: 'x' }, subject_role: 'unclassified',
          occurred_at: 1000, occurred_precision: 'year', created: 500, updated: 500 },
        { id: 'prop_2', claim_id: 'claim_2', proposition_class: 'event-fact',
          resolution_criteria: { criteria: 'y' }, subject_role: 'unclassified',
          occurred_at: 2000, occurred_precision: 'day', created: 600, updated: 600 },
        { id: 'prop_3', claim_id: 'claim_3', proposition_class: 'state-fact',
          resolution_criteria: { criteria: 'z' }, subject_role: 'unclassified',
          occurred_at: null, occurred_precision: null, created: 700, updated: 700 },
        // Over a non-orbit claim — excluded.
        { id: 'prop_out', claim_id: 'claim_out', proposition_class: 'state-fact',
          resolution_criteria: { criteria: 'q' }, subject_role: 'unclassified',
          occurred_at: null, occurred_precision: null, created: 800, updated: 800 }
    ]));

    _stateStore.set('adjudicated_verdicts', keyed([
        // prop_1: a superseded false ruling, then the active true one.
        { id: 'v1', proposition_id: 'prop_1', verdict: 'established-false',
          standard_of_proof: 'preponderance', evidence_for: [], evidence_against: [],
          caveats: ['c'], supersedes: null, superseded_by: 'v2', created: 900 },
        { id: 'v2', proposition_id: 'prop_1', verdict: 'established-true',
          standard_of_proof: 'clear-and-convincing', evidence_for: [], evidence_against: [],
          caveats: ['c'], supersedes: 'v1', superseded_by: null, created: 1000 },
        // prop_2: a single active ruling.
        { id: 'v3', proposition_id: 'prop_2', verdict: 'insufficient-evidence',
          standard_of_proof: 'preponderance', evidence_for: [], evidence_against: [],
          caveats: ['c'], supersedes: null, superseded_by: null, created: 1100 }
        // prop_3: unruled.
    ]));

    _stateStore.set('evidence_links', keyed([
        { id: 'link_c1', relationship: 'contradicts', source_claim_id: 'claim_1',
          target_claim_id: 'claim_2', suggested_by: 'user',
          source_snapshot: null, target_snapshot: null, publishedAt: null, created: 1200 },
        { id: 'link_c2', relationship: 'contradicts', source_claim_id: 'claim_2',
          target_claim_id: 'claim_3', suggested_by: 'user',
          source_snapshot: null, target_snapshot: null, publishedAt: null, created: 1300 },
        // Two supports on the SAME wire origin — convergence collapses to one.
        { id: 'link_s1', relationship: 'supports', source_claim_id: 'claim_1',
          target_claim_id: 'claim_3', suggested_by: 'user',
          attestation: { origin_key: 'wire-x', tier: 'tier-2', independence_note: '' },
          source_snapshot: null, target_snapshot: null, publishedAt: null, created: 1400 },
        { id: 'link_s2', relationship: 'supports', source_claim_id: 'claim_2',
          target_claim_id: 'claim_3', suggested_by: 'user',
          attestation: { origin_key: 'wire-x', tier: 'tier-2', independence_note: '' },
          source_snapshot: null, target_snapshot: null, publishedAt: null, created: 1500 },
        // A contradicts link touching NO orbit claim — excluded from clusters.
        { id: 'link_out', relationship: 'contradicts', source_claim_id: 'claim_out',
          target_claim_id: '30040:pk_x:foreign', suggested_by: 'user',
          source_snapshot: null, target_snapshot: { text: 'f', url: 'https://f' },
          publishedAt: null, created: 1600 }
    ]));

    _stateStore.set('integrity_findings', keyed([
        { id: 'intg_1', word_proposition_id: 'wprop', deed_proposition_ids: ['prop_2'],
          entity_ids: ['entity_zhong'], match: 'broken', standard_of_proof: 'clear-and-convincing',
          evidence_for: [], evidence_against: [], caveats: ['c'], gap: null,
          supersedes: null, superseded_by: null, created: 1700 },
        // Superseded — excluded (chain heads only).
        { id: 'intg_super', word_proposition_id: 'wprop', deed_proposition_ids: ['prop_2'],
          entity_ids: ['entity_zhong'], match: 'fulfilled', standard_of_proof: 'clear-and-convincing',
          evidence_for: [], evidence_against: [], caveats: ['c'], gap: null,
          supersedes: null, superseded_by: 'intg_1', created: 1650 },
        // Entity not in the orbit — excluded.
        { id: 'intg_out', word_proposition_id: 'wprop2', deed_proposition_ids: [],
          entity_ids: ['entity_notinorbit'], match: 'broken', standard_of_proof: 'clear-and-convincing',
          evidence_for: [], evidence_against: [], caveats: ['c'], gap: null,
          supersedes: null, superseded_by: null, created: 1800 }
    ]));

    _stateStore.set('behavioral_findings', keyed([
        // Subject label matches an orbit entity name — included.
        { id: 'forx_1', subject_ref: { label: 'EcoHealth' }, role: 'institution',
          maneuver: 'selective-omission', anchors: [], counter_note: 'n',
          basis: 'stated', suggested_by: 'user', created: 1900 },
        // Subject matches nothing in the orbit — excluded.
        { id: 'forx_out', subject_ref: { label: 'Nobody' }, role: 'critic',
          maneuver: 'strawman', anchors: [], counter_note: 'n',
          basis: 'stated', suggested_by: 'user', created: 2000 }
    ]));
}

// ------------------------------------------------------------------
// Tests
// ------------------------------------------------------------------

test('throws on a missing case entity', async () => {
    seedFixture();
    await assert.rejects(() => assembleCaseDossier('entity_missing'), /Entity not found/);
});

test('case + coverage counts reflect the orbit, not the whole store', async () => {
    seedFixture();
    const d = await assembleCaseDossier(CASE);
    assert.equal(d.case.id, CASE);
    assert.equal(d.case.name, 'Eggs case');
    assert.deepEqual(d.coverage, {
        articles: 2,                    // u1, u2 (claim_out's u9 excluded)
        claims: 3,                      // claim_1..3 (claim_out excluded)
        claims_with_propositions: 3,    // prop_1..3 map to claim_1..3
        propositions: 3,                // prop_out excluded (non-orbit claim)
        entities: 3                     // case, zhong, eco (other/notinorbit excluded)
    });
});

test('propositions carry the active verdict head, collapsing supersession chains', async () => {
    seedFixture();
    const d = await assembleCaseDossier(CASE);
    const byProp = new Map(d.propositions.map((r) => [r.proposition.id, r]));

    const p1 = byProp.get('prop_1');
    assert.equal(p1.chain.length, 2);
    assert.equal(p1.head.id, 'v2');            // the un-superseded ruling
    assert.equal(p1.head.verdict, 'established-true');
    assert.equal(p1.superseded_count, 1);

    const p2 = byProp.get('prop_2');
    assert.equal(p2.head.verdict, 'insufficient-evidence');
    assert.equal(p2.superseded_count, 0);

    const p3 = byProp.get('prop_3');
    assert.equal(p3.head, null);               // unruled
    assert.equal(p3.chain.length, 0);
});

test('distribution is verdictVariance over the active heads (no fused score)', async () => {
    seedFixture();
    const d = await assembleCaseDossier(CASE);
    assert.equal(d.distribution.total, 2);     // prop_3 has no head
    assert.deepEqual(d.distribution.by_state, {
        'established-true': 1,
        'insufficient-evidence': 1
    });
    assert.equal(d.distribution.unanimous, false);
    // The header is a distribution, never a single number.
    assert.equal('score' in d.distribution, false);
});

test('contradiction clusters are connected components over orbit-touching edges', async () => {
    seedFixture();
    const d = await assembleCaseDossier(CASE);
    const clusters = d.knots.contradiction_clusters;
    assert.equal(clusters.length, 1);          // link_c1 + link_c2 chain into one
    assert.deepEqual(clusters[0].claim_refs, ['claim_1', 'claim_2', 'claim_3']);
    assert.deepEqual(clusters[0].link_ids, ['link_c1', 'link_c2']);
    assert.equal(clusters[0].contradicts_count, 2);
});

test('integrity findings join by entity_ids, chain heads only', async () => {
    seedFixture();
    const d = await assembleCaseDossier(CASE);
    const ids = d.knots.integrity_findings.map((f) => f.id);
    assert.deepEqual(ids, ['intg_1']);         // super excluded, out-of-orbit excluded
});

test('forensic findings join by subject match, unmatched excluded', async () => {
    seedFixture();
    const d = await assembleCaseDossier(CASE);
    const ids = d.knots.forensic_findings.map((f) => f.id);
    assert.deepEqual(ids, ['forx_1']);         // EcoHealth matched; Nobody excluded
});

test('evidence groups articles by url and measures attestation convergence', async () => {
    seedFixture();
    const d = await assembleCaseDossier(CASE);
    // u1 carries claim_1 + claim_3; u2 carries claim_2.
    const u1 = d.evidence.articles.find((a) => a.url === 'https://u1');
    assert.deepEqual(u1.claim_ids, ['claim_1', 'claim_3']);
    assert.equal(u1.key_claim_count, 1);       // claim_1 is_key
    // Two supports on one wire origin collapse to a single origin.
    assert.equal(d.evidence.convergence.total_attestations, 2);
    assert.equal(d.evidence.convergence.origin_count, 1);
});

test('entities carry their roles-in-this-case', async () => {
    seedFixture();
    const d = await assembleCaseDossier(CASE);
    const byId = new Map(d.entities.map((e) => [e.entity_id, e]));
    assert.deepEqual(byId.get(CASE).roles, ['case']);
    assert.deepEqual(byId.get('entity_zhong').roles, ['about', 'integrity-subject']);
    assert.deepEqual(byId.get('entity_eco').roles, ['about', 'forensic:institution']);
    // sorted by name: EcoHealth, Eggs case, Zhong 2019
    assert.deepEqual(d.entities.map((e) => e.name), ['EcoHealth', 'Eggs case', 'Zhong 2019']);
});

test('timeline emits world + judgment axes, preserves precision bands, sorts ascending', async () => {
    seedFixture();
    const d = await assembleCaseDossier(CASE);
    const world = d.timeline.filter((e) => e.axis === 'world');
    const judgment = d.timeline.filter((e) => e.axis === 'judgment');

    // world: prop_1 (year), prop_2 (day), integrity-deed (from prop_2, day)
    assert.equal(world.length, 3);
    const p1w = world.find((e) => e.ref === 'prop_1');
    assert.equal(p1w.precision, 'year');       // no false precision — band preserved
    assert.equal(p1w.at, 1000);

    // judgment: v1 (superseded), v2, v3, integrity-finding, forensic-finding
    assert.equal(judgment.length, 5);
    assert.ok(judgment.some((e) => e.kind === 'verdict-superseded' && e.ref === 'v1'));
    assert.ok(judgment.some((e) => e.kind === 'forensic-finding' && e.ref === 'forx_1'));

    // Non-decreasing by time (nulls last — none here).
    for (let i = 1; i < d.timeline.length; i++) {
        assert.ok((d.timeline[i - 1].at ?? Infinity) <= (d.timeline[i].at ?? Infinity));
    }
});

test('article_urls hook exposes the orbit article set for the render slices', async () => {
    seedFixture();
    const d = await assembleCaseDossier(CASE);
    assert.deepEqual(d.article_urls, ['https://u1', 'https://u2']);
});

test('deterministic and side-effect-free (same output twice, store untouched)', async () => {
    seedFixture();
    const before = JSON.stringify([..._stateStore.entries()]);
    const d1 = await assembleCaseDossier(CASE);
    const d2 = await assembleCaseDossier(CASE);
    const after = JSON.stringify([..._stateStore.entries()]);
    assert.equal(JSON.stringify(d1), JSON.stringify(d2));   // deterministic
    assert.equal(before, after);                            // no writes
});

test('integrity findings carry an id tiebreak — same-created findings order deterministically', async () => {
    // Two findings share created:1700; seeded in reverse-id insertion
    // order. IntegrityModel.list sorts by created only, so without the
    // assembler's id tiebreak the wire-ingest order would leak through
    // and diverge the export hash peer-to-peer.
    _stateStore.clear();
    _stateStore.set('entities', keyed([
        { id: CASE, name: 'C', type: 'case' },
        { id: 'entity_x', name: 'X', type: 'organization' }
    ]));
    _stateStore.set('article_claims', keyed([
        { id: 'claim_x', text: 't', about: [CASE, 'entity_x'], source: null,
          is_key: false, source_url: 'https://u', created: 10 }
    ]));
    _stateStore.set('integrity_findings', keyed([
        { id: 'intg_b', word_proposition_id: 'w', deed_proposition_ids: [],
          entity_ids: ['entity_x'], match: 'broken', standard_of_proof: 'clear-and-convincing',
          evidence_for: [], evidence_against: [], caveats: ['c'], gap: null,
          supersedes: null, superseded_by: null, created: 1700 },
        { id: 'intg_a', word_proposition_id: 'w', deed_proposition_ids: [],
          entity_ids: ['entity_x'], match: 'broken', standard_of_proof: 'clear-and-convincing',
          evidence_for: [], evidence_against: [], caveats: ['c'], gap: null,
          supersedes: null, superseded_by: null, created: 1700 }
    ]));
    const d = await assembleCaseDossier(CASE);
    assert.deepEqual(d.knots.integrity_findings.map((f) => f.id), ['intg_a', 'intg_b']);
});

test('empty-url claims do not create phantom articles — the three article surfaces agree', async () => {
    _stateStore.clear();
    _stateStore.set('entities', keyed([{ id: CASE, name: 'C', type: 'case' }]));
    _stateStore.set('article_claims', keyed([
        { id: 'claim_u', text: 'has url',   about: [CASE], source: null,
          is_key: false, source_url: 'https://u1', created: 10 },
        { id: 'claim_e', text: 'empty url', about: [CASE], source: null,
          is_key: false, source_url: '', created: 20 }
    ]));
    const d = await assembleCaseDossier(CASE);
    assert.equal(d.coverage.claims, 2);                 // both claims are in the orbit
    assert.equal(d.coverage.articles, 1);               // but only one real article
    assert.deepEqual(d.evidence.articles.map((a) => a.url), ['https://u1']);
    assert.deepEqual(d.article_urls, ['https://u1']);   // all three agree
});

test('empty orbit: a case with no claims yields empty sections, not a throw', async () => {
    _stateStore.clear();
    _stateStore.set('entities', keyed([{ id: CASE, name: 'Empty', type: 'case' }]));
    const d = await assembleCaseDossier(CASE);
    assert.equal(d.coverage.claims, 0);
    assert.equal(d.propositions.length, 0);
    assert.equal(d.distribution.total, 0);
    assert.deepEqual(d.knots.contradiction_clusters, []);
    assert.deepEqual(d.timeline, []);
    assert.equal(d.evidence.convergence.total_attestations, 0);
});
