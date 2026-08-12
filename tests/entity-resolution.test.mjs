// The entity resolution ladder — UA.2
// (docs/UNIFIED_ARTICLE_PASS_KICKOFF.md §3 rail 3). The load-bearing
// pins: identity rungs resolve only what the registry would merge
// anyway; near-name rungs only ever RANK candidates (a human click
// stands between candidate and link); and NO candidate ever carries a
// numeric score — never-merge (CONSTITUTION Art. 6) is structural.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// entity-model reads chrome.storage at module load — stub first.
globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

const {
    rankEntityCandidates, defaultEntityChoice, isIdentityRung, rungLabel,
    RESOLUTION_RUNGS, MAX_ENTITY_CANDIDATES
} = await import('../src/shared/entity-resolution.js');
const { generateEntityId } = await import('../src/shared/entity-model.js');

// Registry fixture builder: records keyed by their REAL deterministic
// ids, so the identity rung's hash lookup finds them.
async function registryOf(rows) {
    const out = {};
    for (const r of rows) {
        const id = r.id || await generateEntityId(r.type, r.name);
        out[id] = { ...r, id };
    }
    return out;
}

test('identity rung: exact name+type resolves to the record the id hash would merge with', async () => {
    const reg = await registryOf([
        { name: 'Elena Vargas', type: 'person' },
        { name: 'Elena Vargas', type: 'organization' }   // same name, other type — must not match
    ]);
    const out = await rankEntityCandidates({ name: 'elena  VARGAS', type: 'person' }, reg);
    assert.ok(out.length >= 1);
    assert.equal(out[0].rung, 'exact');
    assert.equal(out[0].name, 'Elena Vargas');
    assert.equal(out[0].type, 'person');
    assert.ok(isIdentityRung(out[0].rung));
});

test('identity rung: a recorded alias resolves to its CANONICAL root (rung "alias")', async () => {
    const rootId = await generateEntityId('person', 'Robert Kennedy');
    const reg = await registryOf([
        { name: 'Robert Kennedy', type: 'person' },
        { name: 'RFK', type: 'person', canonical_id: rootId }
    ]);
    const out = await rankEntityCandidates({ name: 'RFK', type: 'person' }, reg);
    assert.equal(out[0].rung, 'alias');
    assert.equal(out[0].id, rootId, 'the candidate is the root, never the alias record');
    assert.equal(out[0].name, 'Robert Kennedy');
    assert.ok(isIdentityRung(out[0].rung));
});

test('near-name rung: token containment ranks below identity and dedupes to one root', async () => {
    const reg = await registryOf([
        { name: 'Elena Vargas', type: 'person' },
        { name: 'Mayor Elena Vargas', type: 'person' }
    ]);
    // "Elena Vargas" — exact hit first, the superset name as token-subset.
    const out = await rankEntityCandidates({ name: 'Elena Vargas', type: 'person' }, reg);
    assert.equal(out[0].rung, 'exact');
    assert.equal(out[1].rung, 'token-subset');
    assert.equal(out[1].name, 'Mayor Elena Vargas');
    // No exact record → near-name only.
    const near = await rankEntityCandidates({ name: 'Vargas Elena', type: 'person' }, reg);
    assert.ok(near.every((c) => c.rung === 'token-subset'));
});

test('near-name rung: surname + initial matches persons only, in both directions', async () => {
    const reg = await registryOf([
        { name: 'John Smith', type: 'person' },
        { name: 'Jane Smith', type: 'person' },
        { name: 'J. Smith', type: 'organization' }   // wrong type — never offered
    ]);
    const out = await rankEntityCandidates({ name: 'J. Smith', type: 'person' }, reg);
    assert.ok(out.length >= 2);
    assert.ok(out.every((c) => c.rung === 'surname-initial'));
    assert.deepEqual(out.map((c) => c.name).sort(), ['Jane Smith', 'John Smith']);
    // The other direction: a full proposal vs an abbreviated record.
    const reg2 = await registryOf([{ name: 'J. Smith', type: 'person' }]);
    const back = await rankEntityCandidates({ name: 'John Smith', type: 'person' }, reg2);
    assert.equal(back[0].rung, 'surname-initial');
    // Two FULL given names never ride this rung ("Jane" vs "John" is
    // a different person, not an abbreviation).
    const reg3 = await registryOf([{ name: 'Jane Smith', type: 'person' }]);
    const full = await rankEntityCandidates({ name: 'John Smith', type: 'person' }, reg3);
    assert.equal(full.length, 0);
});

test('GUARD (Art. 6): no candidate ever carries a numeric field — rungs are labels, not scores', async () => {
    const reg = await registryOf([
        { name: 'Elena Vargas', type: 'person' },
        { name: 'Mayor Elena Vargas', type: 'person' },
        { name: 'E. Vargas', type: 'person' }
    ]);
    const out = await rankEntityCandidates({ name: 'Elena Vargas', type: 'person' }, reg);
    for (const c of out) {
        assert.ok(RESOLUTION_RUNGS.includes(c.rung), `known rung: ${c.rung}`);
        for (const [k, v] of Object.entries(c)) {
            assert.ok(typeof v !== 'number', `no numeric field (${k}) on a candidate`);
        }
        assert.ok(!('score' in c) && !('confidence' in c) && !('similarity' in c));
    }
    assert.ok(out.length <= MAX_ENTITY_CANDIDATES);
});

test('defaultEntityChoice: identity pre-selects; single near-name pre-selects; plural near-name stays "new"', () => {
    assert.equal(defaultEntityChoice([]), 'new');
    assert.equal(defaultEntityChoice([{ id: 'a', rung: 'exact' }, { id: 'b', rung: 'token-subset' }]), 'a');
    assert.equal(defaultEntityChoice([{ id: 'a', rung: 'alias' }]), 'a');
    assert.equal(defaultEntityChoice([{ id: 'a', rung: 'token-subset' }]), 'a',
        'the pre-UA.2 single-candidate behavior, unchanged');
    assert.equal(defaultEntityChoice([
        { id: 'a', rung: 'token-subset' }, { id: 'b', rung: 'surname-initial' }
    ]), 'new', 'a default guess among plausible roots is where silent mis-linking creeps in');
});

test('degenerate inputs are calm; every rung has human wording', async () => {
    assert.deepEqual(await rankEntityCandidates({ name: '', type: 'person' }, {}), []);
    assert.deepEqual(await rankEntityCandidates({ name: 'X', type: '' }, {}), []);
    assert.deepEqual(await rankEntityCandidates({}, null), []);
    for (const r of RESOLUTION_RUNGS) {
        assert.ok(rungLabel(r).length > 10, `rung ${r} explains itself`);
    }
});
