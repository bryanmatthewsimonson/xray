// adopt-entity.js tests — Phase 25.2b (the KS.3 adopt-on-sight flow,
// extracted from the sidepanel so the Network page runs identical
// prompts). Real EntityModel over the chrome-storage stub; the relay
// query and confirm() are injected.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const _stateStore = new Map();
globalThis.chrome = {
    storage: {
        local: {
            get(keys, cb) { const o = {}; for (const k of (Array.isArray(keys) ? keys : [keys])) if (_stateStore.has(k)) o[k] = _stateStore.get(k); cb(o); },
            set(obj, cb) { for (const [k, v] of Object.entries(obj)) _stateStore.set(k, v); cb && cb(); },
            remove(keys, cb) { for (const k of (Array.isArray(keys) ? keys : [keys])) _stateStore.delete(k); cb && cb(); }
        }
    }
};

const { adoptForeignEntity, proposeForeignIdentity } = await import('../src/shared/adopt-entity.js');
const { EntityModel } = await import('../src/shared/entity-model.js');

const FOREIGN_PK = 'a1'.repeat(32);

function kind0Query({ name, about } = {}) {
    return async (filter) => {
        assert.deepEqual(filter.kinds, [0]);
        return {
            ok: true,
            events: [{
                id: '1'.repeat(64), pubkey: FOREIGN_PK, kind: 0, created_at: 100,
                tags: [], content: JSON.stringify({ name, about })
            }]
        };
    };
}

beforeEach(() => _stateStore.clear());

test('proposeForeignIdentity: kind-0 name + X-Ray about-line type', async () => {
    const p = await proposeForeignIdentity(FOREIGN_PK, {
        query: kind0Query({ name: 'Dr. Remote', about: 'organization entity created by X-Ray' }),
        defaultType: 'person'
    });
    assert.equal(p.name, 'Dr. Remote');
    assert.equal(p.type, 'organization');
});

test('proposeForeignIdentity: offline fallback = pubkey prefix + default type', async () => {
    const p = await proposeForeignIdentity(FOREIGN_PK, {
        query: async () => { throw new Error('offline'); },
        defaultType: 'person'
    });
    assert.equal(p.name, FOREIGN_PK.slice(0, 12) + '…');
    assert.equal(p.type, 'person');
});

test('adopt without context entity: single confirm → read-only foreign entity', async () => {
    const prompts = [];
    const result = await adoptForeignEntity(FOREIGN_PK, {
        query: kind0Query({ name: 'Jane Remote' }),
        confirmFn: (msg) => { prompts.push(msg); return true; }
    });
    assert.equal(result.status, 'adopted');
    assert.equal(prompts.length, 1);
    assert.match(prompts[0], /read-only foreign entity/);
    assert.equal(EntityModel.isForeign(result.entity), true);
    assert.equal(result.entity.name, 'Jane Remote');
});

test('cancel adopts nothing', async () => {
    const result = await adoptForeignEntity(FOREIGN_PK, {
        query: kind0Query({ name: 'Jane Remote' }),
        confirmFn: () => false
    });
    assert.equal(result.status, 'cancelled');
    const all = await EntityModel.getAll();
    assert.equal(Object.values(all).length, 0);
});

test('alias offer appears only with a same-type context entity, and applies', async () => {
    const mine = await EntityModel.create({ name: 'Jane Local', type: 'person' });
    const prompts = [];
    const result = await adoptForeignEntity(FOREIGN_PK, {
        query: kind0Query({ name: 'Jane Remote', about: 'person entity created by X-Ray' }),
        confirmFn: (msg) => { prompts.push(msg); return true; },   // accept the ALIAS offer
        contextEntity: mine,
        entities: { [mine.id]: mine }
    });
    assert.equal(result.status, 'adopted');
    assert.equal(result.asAlias, true);
    assert.match(prompts[0], /as an ALIAS of "Jane Local"/);
    assert.equal(result.entity.canonical_id, mine.id);
});

test('invalid pubkey / missing query → invalid, no prompts', async () => {
    assert.deepEqual(await adoptForeignEntity('nope', { query: async () => ({}) }), { status: 'invalid' });
    assert.deepEqual(await adoptForeignEntity(FOREIGN_PK, {}), { status: 'invalid' });
});
