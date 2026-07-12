// Entity-facts tests — Phase 19.1 (ENTITY_DOSSIER_DESIGN §4). The
// fact layer's validation and conflict machinery: cleanFact's contract,
// precision-band date agreement, contested-never-resolves, dismissals.

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
    cleanFact, isFactClaim, groupFactsByField, factConflicts,
    dismissalKey, FactDismissals
} = await import('../src/shared/entity-facts.js');
const { sameDateWithinPrecision, parseMetaDate, isValidDatePrecision } =
    await import('../src/shared/dossier-time.js');

const WHO = 'entity_' + '1'.repeat(16);
const OTHER = 'entity_' + '2'.repeat(16);

const factClaim = (id, field, value, extra = {}) => ({
    id,
    fact: { entity_id: WHO, field, value, value_ref: null, ...extra }
});

// ── dossier-time ───────────────────────────────────────────────────────

test('dossier-time: parseMetaDate honest band precision (extraction contract)', () => {
    assert.deepEqual(parseMetaDate('2020'), { at: Date.UTC(2020, 0, 1) / 1000, precision: 'year' });
    assert.equal(parseMetaDate('2020-06').precision, 'month');
    assert.equal(parseMetaDate('2020-06-15').precision, 'day');
    assert.equal(parseMetaDate(1600000000).precision, 'exact');
    assert.equal(parseMetaDate('not a date'), null);
    assert.equal(parseMetaDate(''), null);
    assert.ok(isValidDatePrecision('year') && !isValidDatePrecision('week'));
});

test('dossier-time: sameDateWithinPrecision — bands overlap, not exact-match', () => {
    const y1962 = parseMetaDate('1962');
    const d19620315 = parseMetaDate('1962-03-15');
    const y1963 = parseMetaDate('1963');
    assert.ok(sameDateWithinPrecision(y1962.at, 'year', d19620315.at, 'day'),
        '"1962" and "1962-03-15" are compatible statements');
    assert.equal(sameDateWithinPrecision(y1962.at, 'year', y1963.at, 'year'), false,
        '"1962" vs "1963" is a real disagreement');
    assert.ok(sameDateWithinPrecision(d19620315.at, 'day', d19620315.at + 3600, 'day'),
        'same day, different hours — day band agrees');
});

// ── cleanFact ─────────────────────────────────────────────────────────

test('cleanFact: valid sourced fact normalizes', () => {
    const f = cleanFact({
        entity_id: WHO, field: 'founded', value: '  1948  ',
        valid_from: Date.UTC(1948, 3, 7) / 1000, valid_from_precision: 'day'
    }, { about: [WHO], entityType: 'organization' });
    assert.equal(f.value, '1948', 'value trimmed');
    assert.equal(f.valid_from_precision, 'day');
    assert.equal(f.valid_to, null);
    assert.equal(f.value_ref, null);
});

test('cleanFact: rejects the design red lines', () => {
    const ok = { about: [WHO], entityType: 'organization' };
    assert.throws(() => cleanFact({ entity_id: WHO, field: 'founded', value: '1948' },
        { about: [OTHER], entityType: 'organization' }), /about/, 'subject must be in claim.about');
    assert.throws(() => cleanFact({ entity_id: 'not-an-id', field: 'founded', value: '1948' }, ok),
        /entity id/);
    assert.throws(() => cleanFact({ entity_id: WHO, field: 'birth_date', value: '1948' }, ok),
        /registry/, 'person field on an organization rejected');
    assert.throws(() => cleanFact({ entity_id: WHO, field: 'scope_question', value: 'x' },
        { about: [WHO], entityType: 'case' }), /authored/, 'authored fields never ride claims');
    assert.throws(() => cleanFact({ entity_id: WHO, field: 'founded', value: '' }, ok), /required/);
    assert.throws(() => cleanFact({ entity_id: WHO, field: 'founded', value: 'x'.repeat(501) }, ok), /500/);
    assert.throws(() => cleanFact({ entity_id: WHO, field: 'founded', value: '1948', value_ref: OTHER }, ok),
        /not an entity-ref/, 'value_ref forbidden on non-ref fields');
    assert.throws(() => cleanFact({ entity_id: WHO, field: 'leadership', value: 'Dr. X' }, ok),
        /value_ref/, 'entity-ref fields require value_ref');
    assert.throws(() => cleanFact({ entity_id: WHO, field: 'founded', value: '1948', valid_from: 1, valid_from_precision: 'week' }, ok),
        /precision/);
});

test('cleanFact: custom fields accepted as sourced single-valued text', () => {
    const f = cleanFact({ entity_id: WHO, field: 'custom:member-count', value: '194 states' },
        { about: [WHO], entityType: 'organization' });
    assert.equal(f.field, 'custom:member-count');
});

// ── grouping + conflicts ──────────────────────────────────────────────

test('facts: isFactClaim + groupFactsByField', () => {
    const a = factClaim('claim_a', 'headquarters', 'Geneva');
    const b = factClaim('claim_b', 'headquarters', 'Geneva, Switzerland');
    const plain = { id: 'claim_c', text: 'no fact layer' };
    assert.ok(isFactClaim(a));
    assert.equal(isFactClaim(plain), false);
    const grouped = groupFactsByField([a, b, plain]);
    assert.deepEqual([...grouped.keys()], ['headquarters']);
    assert.equal(grouped.get('headquarters').length, 2);
});

test('conflicts: single-valued disagreement is contested — both named, no winner', () => {
    const a = factClaim('claim_a', 'headquarters', 'Geneva');
    const b = factClaim('claim_b', 'headquarters', 'New York');
    const out = factConflicts([a, b], { entityType: 'organization' });
    assert.equal(out.length, 1);
    assert.deepEqual(out[0].claim_ids, ['claim_a', 'claim_b']);
    assert.deepEqual(out[0].values, ['Geneva', 'New York']);
    assert.equal('winner' in out[0], false, 'never a winner');
    assert.equal(out[0].dismissal_key, dismissalKey('claim_b', 'claim_a'), 'key is order-independent');
});

test('conflicts: text normalization + multiple:true + date bands suppress false disputes', () => {
    // Case/whitespace variants of one value are agreement, not dispute.
    assert.equal(factConflicts([
        factClaim('claim_a', 'headquarters', 'Geneva'),
        factClaim('claim_b', 'headquarters', '  GENEVA ')
    ], { entityType: 'organization' }).length, 0);

    // multiple:true fields never conflict (dual nationality is data).
    assert.equal(factConflicts([
        factClaim('claim_a', 'nationality', 'French'),
        factClaim('claim_b', 'nationality', 'Swiss')
    ], { entityType: 'person' }).length, 0);

    // Date facts agree within precision bands…
    assert.equal(factConflicts([
        factClaim('claim_a', 'birth_date', '1962'),
        factClaim('claim_b', 'birth_date', '1962-03-15')
    ], { entityType: 'person' }).length, 0, 'year band contains the day');
    // …and conflict across them.
    assert.equal(factConflicts([
        factClaim('claim_a', 'birth_date', '1962'),
        factClaim('claim_b', 'birth_date', '1963')
    ], { entityType: 'person' }).length, 1);
});

test('conflicts: validity intervals — disjoint never conflicts, unknown does', () => {
    const t2019 = Date.UTC(2019, 0, 1) / 1000, t2020 = Date.UTC(2020, 0, 1) / 1000;
    const t2021 = Date.UTC(2021, 0, 1) / 1000, t2022 = Date.UTC(2022, 0, 1) / 1000;
    // Disjoint tenures: an evolving field's history, not a dispute.
    assert.equal(factConflicts([
        factClaim('claim_a', 'headquarters', 'Geneva',   { valid_from: t2019, valid_to: t2020 }),
        factClaim('claim_b', 'headquarters', 'New York', { valid_from: t2021, valid_to: t2022 })
    ], { entityType: 'organization' }).length, 0);
    // Unknown validity is treated as overlapping (conservative).
    assert.equal(factConflicts([
        factClaim('claim_a', 'headquarters', 'Geneva', { valid_from: t2019, valid_to: t2020 }),
        factClaim('claim_b', 'headquarters', 'New York')
    ], { entityType: 'organization' }).length, 1);
});

test('conflicts: entity-ref fields compare by ref; dismissals suppress', async () => {
    const a = factClaim('claim_a', 'parent_org', 'UN', { value_ref: WHO });
    const b = factClaim('claim_b', 'parent_org', 'United Nations', { value_ref: WHO });
    assert.equal(factConflicts([a, b], { entityType: 'organization' }).length, 0,
        'same ref under different display text agrees');

    const c = factClaim('claim_c', 'parent_org', 'League', { value_ref: OTHER });
    assert.equal(factConflicts([a, c], { entityType: 'organization' }).length, 1);

    _stateStore.clear();
    await FactDismissals.dismiss('claim_a', 'claim_c', 'both parents are defensible');
    const dismissals = await FactDismissals.getAll();
    assert.equal(factConflicts([a, c], { entityType: 'organization', dismissals }).length, 0,
        'dismissed pair no longer reported');
    assert.ok(dismissals[dismissalKey('claim_c', 'claim_a')].note.length > 0);

    await FactDismissals.undismiss('claim_a', 'claim_c');
    assert.equal(factConflicts([a, c], { entityType: 'organization', dismissals: await FactDismissals.getAll() }).length, 1,
        'undismiss re-surfaces the conflict');
});
