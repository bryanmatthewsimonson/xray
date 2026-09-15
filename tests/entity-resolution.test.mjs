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

// ---- UA.2 review round additions -------------------------------------------

test('the candidate cap holds and cross-type canonical roots are dropped', async () => {
    // Cap: many token matches → at most MAX_ENTITY_CANDIDATES.
    const rows = [];
    for (let i = 0; i < MAX_ENTITY_CANDIDATES + 3; i++) {
        rows.push({ name: `Elena Vargas ${'X'.repeat(i + 1)}`, type: 'person' });
    }
    rows.push({ name: 'Elena Vargas', type: 'person' });
    const reg = await registryOf(rows);
    const out = await rankEntityCandidates({ name: 'Elena Vargas', type: 'person' }, reg);
    assert.equal(out.length, MAX_ENTITY_CANDIDATES);
    assert.equal(out[0].rung, 'exact', 'identity survives the cap at the top');

    // Cross-type root: a hand-built (corrupt) snapshot whose alias chain
    // crosses types must drop the candidate, never offer a wrong-typed
    // root. (EntityModel.create forbids this; the ladder still guards.)
    const aliasId = await generateEntityId('person', 'RFK');
    const corrupt = {
        org_root: { id: 'org_root', name: 'RFK Media', type: 'organization' },
        [aliasId]: { id: aliasId, name: 'RFK', type: 'person', canonical_id: 'org_root' }
    };
    const crossed = await rankEntityCandidates({ name: 'RFK', type: 'person' }, corrupt);
    assert.ok(!crossed.some((c) => c.id === 'org_root'), 'a wrong-typed root is never offered');
});

test('a lone surname-initial candidate does NOT pre-select (rail 3 — Accept-all must not ratify a new-rung guess)', async () => {
    const reg = await registryOf([{ name: 'John Smith', type: 'person' }]);
    const out = await rankEntityCandidates({ name: 'J. Smith', type: 'person' }, reg);
    assert.equal(out.length, 1);
    assert.equal(out[0].rung, 'surname-initial');
    assert.equal(defaultEntityChoice(out), 'new',
        'ranked and offered — but the human must actively pick it');
});
