// Entity-dossier tests — Phase 19.3 (ENTITY_DOSSIER_DESIGN §5, §8
// test spine): determinism, integrity ROUTED not inlined, and the
// grade-word string guard (the lens-guards pattern). Fixtures ride the
// collector's injectable snapshots; the chrome stub only backs the
// canonicalizer reads.
//
// 2026-07-20: the Phase 19 typed-fields section (facts, conflicts,
// field edges, compact projection) is RETIRED with the fact layer —
// the pins at the bottom keep it retired. The dossier remains:
// identity / content / judgments / relationships over claims.

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

const dossierModule = await import('../src/shared/entity-dossier.js');
const { collectEntityDossierData, buildEntityDossier, assembleEntityDossier } = dossierModule;

// --- Fixtures ---------------------------------------------------------

const ROOT  = 'entity_' + 'a'.repeat(16);
const ALIAS = 'entity_' + 'b'.repeat(16);
const OTHER = 'entity_' + 'c'.repeat(16);
const PK_ROOT = 'f'.repeat(64);

function fixtureEntities() {
    return {
        [ROOT]:  { id: ROOT, name: 'Elena Vargas', type: 'person',
                   keypair: { pubkey: PK_ROOT }, description: 'A person.' },
        [ALIAS]: { id: ALIAS, name: 'Mayor Elena Vargas', type: 'person',
                   canonical_id: ROOT, keypair: { pubkey: '1'.repeat(64) } },
        [OTHER]: { id: OTHER, name: 'Acme Corp', type: 'organization',
                   keypair: { pubkey: '2'.repeat(64) } }
    };
}

const claim = (id, about, extra = {}) => ({
    id, text: extra.text || `Claim ${id}.`, source_url: extra.url || 'https://x.test/a',
    about, source: extra.source ?? null, is_key: !!extra.is_key,
    created: extra.created || 100,
    quote: extra.quote || `quoted ${id}`,
    article_hash: extra.hash || 'd'.repeat(64),
    publishedEventId: extra.published || null
});

function baseOptions(overrides = {}) {
    return {
        entities: fixtureEntities(),
        claims: {},
        assessments: {},
        propositions: [],
        verdicts: [],
        integrity: [],
        articles: [],
        predictions: [],
        resolutions: [],
        auditRuns: [],
        accounts: {},
        equivalence: { rootId: ROOT, pubkeys: [PK_ROOT] },
        generatedAt: 1751500000,
        ...overrides
    };
}

// --- Tests ------------------------------------------------------------

test('dossier: deterministic — same data + generatedAt ⇒ deep-equal', async () => {
    _stateStore.clear();
    const opts = baseOptions({
        claims: {
            c1: claim('claim_1', [ROOT]),
            c2: claim('claim_2', [ROOT], { created: 50, is_key: true })
        }
    });
    const a = await assembleEntityDossier(ROOT, opts);
    const b = await assembleEntityDossier(ROOT, opts);
    assert.deepEqual(a, b);
    assert.equal(a.generated_at, 1751500000, 'generatedAt injected, no clock read');
});

test('dossier: alias family re-unification — claims captured under the alias appear on the root dossier', async () => {
    _stateStore.clear();
    const opts = baseOptions({
        claims: {
            c1: claim('claim_1', [ALIAS]),
            c2: claim('claim_2', [ROOT])
        }
    });
    // Requested via the ALIAS id — the dossier is still the root's.
    const d = await assembleEntityDossier(ALIAS, opts);
    assert.equal(d.subject.id, ROOT, 'dossier subject is the canonical root');
    assert.equal(d.coverage.claims, 2, 'claims from both family members aggregate');
    const family = d.identity.family.map((f) => f.relation).sort();
    assert.deepEqual(family, ['alias', 'self']);
});

test('dossier: source-mediated membership + zero-claim article lands as a first-class row', async () => {
    _stateStore.clear();
    const opts = baseOptions({
        claims: {
            // ROOT is the SOURCE (speaker), not in about — still orbit.
            c1: claim('claim_s', [OTHER], { source: ROOT, url: 'https://x.test/s', created: 50 })
        },
        articles: [
            { url: 'https://x.test/tagged-only',
              article: { title: 'Tagged, unprocessed', entities: [{ entity_id: ALIAS, context: 'Mayor Elena Vargas spoke' }] } }
        ]
    });
    const d = await assembleEntityDossier(ROOT, opts);
    assert.equal(d.coverage.claims, 1, 'source-mediated claim is in the orbit');
    // 20.1 union membership: the family-tagged zero-claim article is a
    // first-class content row (processed:false), not a backlog footnote.
    const taggedRow = d.content.articles.find((a) => a.url === 'https://x.test/tagged-only');
    assert.ok(taggedRow, 'family-tagged zero-claim article is a first-class row (via membership_ids)');
    assert.equal(taggedRow.processed, false);
    assert.equal(taggedRow.membership, 'tag');
    assert.deepEqual(d.content.unprocessed, [], 'unprocessed carries only wire-32125 items now');
    assert.equal(d.identity.mentions.length, 1, 'grounded mention captured');
});

test('dossier: relationships — co-tagged entities counted from shared orbit claims', async () => {
    _stateStore.clear();
    const opts = baseOptions({
        claims: {
            c1: claim('claim_1', [ROOT, OTHER]),
            c2: claim('claim_2', [ROOT, OTHER], { url: 'https://x.test/b' }),
            c3: claim('claim_3', [ROOT])
        }
    });
    const d = await assembleEntityDossier(ROOT, opts);
    assert.deepEqual(d.relationships.co_tagged, [
        { entity_id: OTHER, shared_claims: 2, shared_articles: 2 }
    ]);
});

test('dossier: judgments — distributions only, integrity ROUTED not inlined, no score keys', async () => {
    _stateStore.clear();
    const opts = baseOptions({
        claims: { c1: claim('claim_1', [ROOT]) },
        assessments: {
            a1: { id: 'assess_1', stance: 2, claim_ref: { claim_id: 'claim_1' } },
            a2: { id: 'assess_2', stance: -1, claim_ref: { claim_id: 'claim_1' } },
            a3: { id: 'assess_3', stance: null, claim_ref: { claim_id: 'claim_1' } }
        }
    });
    const d = await assembleEntityDossier(ROOT, opts);
    assert.equal(d.judgments.assessments.total, 3);
    assert.deepEqual(d.judgments.assessments.by_stance, { '2': 1, '-1': 1, unstanced: 1 });
    assert.equal(d.judgments.integrity_record_ref, ROOT,
        'route to truth-entity-record.js — a REFERENCE, not a record');
    assert.equal(typeof d.judgments.integrity_record_ref, 'string');
    for (const banned of ['commitments', 'calibration', 'corrections']) {
        assert.ok(!(banned in d.judgments), `${banned} is NOT inlined (route, never re-derive)`);
    }
});

test('dossier: grade-word string guard — no scores, grades, or liar-class labels anywhere', async () => {
    _stateStore.clear();
    const opts = baseOptions({
        claims: {
            c1: claim('claim_1', [ROOT]),
            c2: claim('claim_2', [ROOT]),
            c3: claim('claim_3', [ROOT], { is_key: true })
        },
        assessments: { a1: { id: 'assess_1', stance: 1, claim_ref: { claim_id: 'claim_3' } } }
    });
    const d = await assembleEntityDossier(ROOT, opts);
    const json = JSON.stringify(d).toLowerCase();
    // The §3.5 firewall vocabulary: no dossier-level score, person-
    // grade, or character-class label may exist in the OBJECT — not
    // even as a key name.
    for (const w of ['"score"', 'person_grade', 'credibility', 'trustworth', '"liar', 'truthfulness_rating', 'reputation_score']) {
        assert.ok(!json.includes(w), `banned vocabulary "${w}" absent`);
    }
});

test('dossier: foreign/keyless subject renders; envelope stays case-builder compatible', async () => {
    _stateStore.clear();
    const FOREIGN = 'entity_' + 'e'.repeat(16);
    const entities = {
        [FOREIGN]: { id: FOREIGN, name: 'Foreign Person', type: 'person',
                     foreign: true, foreign_pubkey: '3'.repeat(64) }
    };
    const opts = baseOptions({
        entities,
        equivalence: { rootId: FOREIGN, pubkeys: ['3'.repeat(64)] },
        claims: { c1: claim('claim_1', [FOREIGN]) }
    });
    const d = await assembleEntityDossier(FOREIGN, opts);
    assert.equal(d.subject.foreign, true);
    assert.match(d.subject.npub, /^npub1/, 'npub derived from foreign_pubkey');
    assert.equal(d.coverage.claims, 1);

    // Envelope compatibility: the collector's output must satisfy the
    // imported case-dossier builders' key contract.
    const data = await collectEntityDossierData(FOREIGN, opts);
    for (const key of ['case', 'orbit', 'claimsById', 'propositions', 'verdicts',
                       'integrity', 'forensic', 'articles', 'predictions',
                       'resolutions', 'auditRuns', 'wire', 'membership_ids']) {
        assert.ok(key in data, `envelope carries ${key}`);
    }
    assert.equal(data.case.id, FOREIGN, 'the subject rides the case key (§7.2)');
    assert.ok(Array.isArray(data.orbit.claims));
});

test('dossier: authored case framing survives on the subject — never as sourced content', async () => {
    _stateStore.clear();
    const CASE = 'entity_' + '9'.repeat(16);
    const entities = {
        [CASE]: { id: CASE, name: 'Covid Origins', type: 'case',
                  keypair: { pubkey: '4'.repeat(64) },
                  authored_fields: { scope_question: { value: 'Where did it originate?', updated: 100 },
                                     status: { value: 'active', updated: 100 } } }
    };
    const d = await assembleEntityDossier(CASE, baseOptions({
        entities, equivalence: { rootId: CASE, pubkeys: [] }
    }));
    assert.equal(d.subject.authored_fields.scope_question.value, 'Where did it originate?',
        'the case layer\'s authored framing rides the subject descriptor');
    assert.equal(d.subject.authored_fields.status.value, 'active');
});

// --- Fact-layer retirement pins (2026-07-20) ---------------------------------

test('retirement: the typed-fields section is GONE from the dossier and the module', async () => {
    _stateStore.clear();
    const d = await assembleEntityDossier(ROOT, baseOptions({
        claims: { c1: claim('claim_1', [ROOT]) }
    }));
    assert.ok(!('fields' in d), 'no fields section');
    for (const gone of ['fields_known', 'fields_total', 'fields_contested', 'facts_total']) {
        assert.ok(!(gone in d.coverage), `coverage.${gone} stays retired`);
    }
    assert.ok(!('field_edges' in d.relationships), 'fact-derived edges stay retired');
    for (const gone of ['buildFieldsSection', 'compactFieldRows']) {
        assert.ok(!(gone in dossierModule), `${gone} stays retired`);
    }
});

test('retirement: a legacy claim still carrying .fact is an ordinary claim to the dossier', async () => {
    _stateStore.clear();
    const legacy = claim('claim_legacy', [ROOT]);
    legacy.fact = { entity_id: ROOT, field: 'birth_date', value: '1962' };
    const d = await assembleEntityDossier(ROOT, baseOptions({ claims: { c1: legacy } }));
    assert.equal(d.coverage.claims, 1, 'the claim participates normally');
    assert.ok(!('fields' in d), 'its dead fact payload resurrects nothing');
});
