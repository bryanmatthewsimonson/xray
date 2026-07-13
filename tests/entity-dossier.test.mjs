// Entity-dossier tests — Phase 19.3 (ENTITY_DOSSIER_DESIGN §5, §8
// test spine): determinism, unknown-by-default, contested-never-
// resolves, integrity ROUTED not inlined, and the grade-word string
// guard (the lens-guards pattern). Fixtures ride the collector's
// injectable snapshots; the chrome stub only backs the canonicalizer
// and dismissal reads.

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
    collectEntityDossierData, buildEntityDossier, assembleEntityDossier,
    buildFieldsSection, compactFieldRows
} = await import('../src/shared/entity-dossier.js');
const { dismissalKey } = await import('../src/shared/entity-facts.js');
const { fieldsForType } = await import('../src/shared/entity-field-schemas.js');

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

const factClaim = (id, entityId, field, value, extra = {}, claimExtra = {}) => ({
    id, text: `${field}: ${value}`, source_url: claimExtra.url || 'https://x.test/a',
    about: [entityId], source: null, is_key: false, created: claimExtra.created || 100,
    quote: claimExtra.quote || `quoted ${value}`,
    article_hash: claimExtra.hash || 'd'.repeat(64),
    publishedEventId: claimExtra.published || null,
    fact: { entity_id: entityId, field, value, value_ref: extra.value_ref || null,
            valid_from: extra.valid_from ?? null, valid_from_precision: extra.valid_from_precision ?? null,
            valid_to: extra.valid_to ?? null, valid_to_precision: extra.valid_to_precision ?? null,
            observed_at: null, observed_precision: null }
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
        dismissals: {},
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
            c1: factClaim('claim_1', ROOT, 'occupation', 'Mayor'),
            c2: factClaim('claim_2', ROOT, 'birth_date', '1962')
        }
    });
    const a = await assembleEntityDossier(ROOT, opts);
    const b = await assembleEntityDossier(ROOT, opts);
    assert.deepEqual(a, b);
    assert.equal(a.generated_at, 1751500000, 'generatedAt injected, no clock read');
});

test('dossier: unknown-by-default — a person with zero facts renders EVERY registry row', async () => {
    _stateStore.clear();
    const d = await assembleEntityDossier(ROOT, baseOptions());
    const personFields = fieldsForType('person').map((r) => r.field);
    assert.deepEqual(d.fields.map((r) => r.field), personFields, 'all 9 person rows present');
    for (const row of d.fields) {
        assert.equal(row.status, 'unknown', `${row.field} is unknown, not absent`);
        assert.deepEqual(row.current, []);
        assert.deepEqual(row.conflicts, []);
    }
    assert.equal(d.coverage.fields_known, 0);
});

test('dossier: contested never resolves — both values side by side, no winner anywhere', async () => {
    _stateStore.clear();
    const opts = baseOptions({
        claims: {
            c1: factClaim('claim_1', ROOT, 'birth_date', '1962'),
            c2: factClaim('claim_2', ROOT, 'birth_date', '1963')
        }
    });
    const d = await assembleEntityDossier(ROOT, opts);
    const row = d.fields.find((r) => r.field === 'birth_date');
    assert.equal(row.status, 'contested');
    assert.equal(row.conflicts.length, 1);
    assert.deepEqual(row.conflicts[0].claim_ids.sort(), ['claim_1', 'claim_2']);
    assert.equal(row.current.length, 2, 'BOTH values render');
    assert.ok(!JSON.stringify(d).includes('"winner"'), 'no winner key anywhere in the dossier');
});

test('dossier: precision-band agreement is ONE value; dismissal turns contested into multiple', async () => {
    _stateStore.clear();
    // "1962" and "1962-03-15" agree within the year band → one group.
    const agree = await assembleEntityDossier(ROOT, baseOptions({
        claims: {
            c1: factClaim('claim_1', ROOT, 'birth_date', '1962'),
            c2: factClaim('claim_2', ROOT, 'birth_date', '1962-03-15')
        }
    }));
    const agreeRow = agree.fields.find((r) => r.field === 'birth_date');
    assert.equal(agreeRow.status, 'known');
    assert.equal(agreeRow.current.length, 1, 'band-compatible dates group as one value');
    assert.equal(agreeRow.current[0].evidence.length, 2, 'both claims cited as evidence');

    // A dismissed conflict is legal coexistence: status becomes multiple.
    const dismissed = await assembleEntityDossier(ROOT, baseOptions({
        claims: {
            c1: factClaim('claim_1', ROOT, 'religion', 'Catholic'),
            c2: factClaim('claim_2', ROOT, 'religion', 'Buddhist')
        },
        dismissals: { [dismissalKey('claim_1', 'claim_2')]: { dismissed_at: 1, note: 'converted' } }
    }));
    const relRow = dismissed.fields.find((r) => r.field === 'religion');
    assert.equal(relRow.status, 'multiple');
    assert.equal(relRow.conflicts.length, 0);
});

test('dossier: alias family re-unification — facts captured under the alias appear on the root dossier', async () => {
    _stateStore.clear();
    const opts = baseOptions({
        claims: {
            c1: factClaim('claim_1', ALIAS, 'occupation', 'Mayor'),
            c2: factClaim('claim_2', ROOT, 'occupation', 'City official')
        }
    });
    // Requested via the ALIAS id — the dossier is still the root's.
    const d = await assembleEntityDossier(ALIAS, opts);
    assert.equal(d.subject.id, ROOT, 'dossier subject is the canonical root');
    const occ = d.fields.find((r) => r.field === 'occupation');
    assert.equal(occ.current.length, 2, 'facts from both family members aggregate');
    const family = d.identity.family.map((f) => f.relation).sort();
    assert.deepEqual(family, ['alias', 'self']);
});

test('dossier: source-mediated membership + zero-claim article lands in unprocessed', async () => {
    _stateStore.clear();
    const opts = baseOptions({
        claims: {
            // ROOT is the SOURCE (speaker), not in about — still orbit.
            c1: { id: 'claim_s', text: 'X.', source_url: 'https://x.test/s', about: [OTHER],
                  source: ROOT, is_key: false, created: 50 }
        },
        articles: [
            { url: 'https://x.test/tagged-only',
              article: { title: 'Tagged, unprocessed', entities: [{ entity_id: ALIAS, context: 'Mayor Elena Vargas spoke' }] } }
        ]
    });
    const d = await assembleEntityDossier(ROOT, opts);
    assert.equal(d.coverage.claims, 1, 'source-mediated claim is in the orbit');
    assert.deepEqual(d.content.unprocessed.map((u) => u.url), ['https://x.test/tagged-only'],
        'family-tagged zero-claim article surfaces as backlog (via membership_ids)');
    assert.equal(d.identity.mentions.length, 1, 'grounded mention captured');
});

test('dossier: relationships — inbound entity-ref edge renders under the target', async () => {
    _stateStore.clear();
    // Acme Corp's leadership fact points AT Elena (value_ref = ROOT).
    const opts = baseOptions({
        claims: {
            c1: factClaim('claim_in', OTHER, 'leadership', 'Elena Vargas', { value_ref: ROOT }),
            c2: factClaim('claim_out', ROOT, 'affiliation', 'Acme Corp', { value_ref: OTHER })
        }
    });
    const d = await assembleEntityDossier(ROOT, opts);
    const inEdge = d.relationships.field_edges.find((e) => e.direction === 'in');
    const outEdge = d.relationships.field_edges.find((e) => e.direction === 'out');
    assert.equal(inEdge.field, 'leadership');
    assert.equal(inEdge.from_entity_id, OTHER);
    assert.equal(inEdge.to_entity_id, ROOT);
    assert.equal(outEdge.to_entity_id, OTHER);
    // Co-tagging: OTHER shares claim_in's about? claim_in is about OTHER
    // only — not orbit for ROOT via about, but IS via fact target…
    // co_tagged counts only orbit-claim co-abouts, so none here.
    assert.deepEqual(d.relationships.co_tagged, []);
});

test('dossier: judgments — distributions only, integrity ROUTED not inlined, no score keys', async () => {
    _stateStore.clear();
    const claim = factClaim('claim_1', ROOT, 'occupation', 'Mayor');
    const opts = baseOptions({
        claims: { c1: claim },
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
            c1: factClaim('claim_1', ROOT, 'birth_date', '1962'),
            c2: factClaim('claim_2', ROOT, 'birth_date', '1963'),
            c3: factClaim('claim_3', ROOT, 'occupation', 'Mayor')
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
        claims: { c1: factClaim('claim_1', FOREIGN, 'residence', 'Springfield') }
    });
    const d = await assembleEntityDossier(FOREIGN, opts);
    assert.equal(d.subject.foreign, true);
    assert.match(d.subject.npub, /^npub1/, 'npub derived from foreign_pubkey');
    assert.equal(d.fields.find((r) => r.field === 'residence').status, 'known');

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

test('dossier: authored fields surface labeled, never as sourced facts; compactFieldRows projects', async () => {
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
    const scope = d.fields.find((r) => r.field === 'scope_question');
    assert.equal(scope.status, 'known');
    assert.equal(scope.provenance, 'authored', 'labeled as the user\'s own framing');
    assert.equal(scope.authored.value, 'Where did it originate?');
    assert.deepEqual(scope.current, [], 'authored values never masquerade as sourced ValueGroups');

    const compact = compactFieldRows(d, 1);
    assert.equal(compact.rows.length, 1);
    assert.equal(compact.rows[0].value, 'Where did it originate?', 'authored value backs the compact row');
    assert.equal(compact.contested, 0);
    assert.ok(compact.more >= 1, 'remaining known rows counted');
});

test('dossier: buildFieldsSection appends custom fields after the registry, name-sorted', async () => {
    _stateStore.clear();
    const opts = baseOptions({
        claims: {
            c1: factClaim('claim_1', ROOT, 'custom:blood-type', 'O-negative'),
            c2: factClaim('claim_2', ROOT, 'custom:alma-mater', 'Springfield U')
        }
    });
    const data = await collectEntityDossierData(ROOT, opts);
    const fields = buildFieldsSection(data);
    const names = fields.rows.map((r) => r.field);
    const personCount = fieldsForType('person').length;
    assert.deepEqual(names.slice(personCount), ['custom:alma-mater', 'custom:blood-type']);
    assert.equal(fields.rows.find((r) => r.field === 'custom:blood-type').status, 'known');
});

// --- 19.8 review fixes --------------------------------------------------------

test('dossier: same value with different validity windows stays TWO groups (one history, one current)', async () => {
    _stateStore.clear();
    const t2005 = Date.UTC(2005, 0, 1) / 1000, t2009 = Date.UTC(2009, 0, 1) / 1000;
    const t2019 = Date.UTC(2019, 0, 1) / 1000;
    const opts = baseOptions({
        claims: {
            c1: factClaim('claim_1', ROOT, 'residence', 'London',
                { valid_from: t2005, valid_from_precision: 'year', valid_to: t2009, valid_to_precision: 'year' }),
            c2: factClaim('claim_2', ROOT, 'residence', 'London',
                { valid_from: t2019, valid_from_precision: 'year' })
        }
    });
    const d = await assembleEntityDossier(ROOT, opts);
    const row = d.fields.find((r) => r.field === 'residence');
    assert.equal(row.history.length, 1, 'the 2005–2009 stint is history');
    assert.equal(row.current.length, 1, 'the 2019– stint is current');
    assert.equal(row.current[0].valid_from, t2019,
        'each assertion keeps its OWN window — never the first claim\'s');
});

test('dossier: relationship edges carry counterpart_name, never the subject\'s own name', async () => {
    _stateStore.clear();
    const opts = baseOptions({
        claims: {
            c1: factClaim('claim_in', OTHER, 'leadership', 'Elena Vargas', { value_ref: ROOT })
        }
    });
    const d = await assembleEntityDossier(ROOT, opts);
    const inEdge = d.relationships.field_edges.find((e) => e.direction === 'in');
    assert.equal(inEdge.counterpart_name, 'Acme Corp',
        'the inbound edge names the OTHER party (the fact value text is the subject itself)');
});
