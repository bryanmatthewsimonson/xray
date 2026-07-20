// LLM entity audit tests — Phase 17 E2 (ENTITY_CORPUS_DESIGN.md §3.2).
//
// The pure halves: the registry digest (what leaves the device), the
// propose_entity_ops schema (no numeric-score smuggling), and the
// validation firewall — evidence grounded against STORED mentions,
// endpoints checked, every rejection reasoned. Plus the §7 Q1 pin:
// rename never rederives the entity id.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const _store = new Map();
globalThis.chrome = {
    storage: {
        local: {
            get(keys, cb) {
                const out = {};
                for (const k of Array.isArray(keys) ? keys : [keys]) {
                    if (_store.has(k)) out[k] = _store.get(k);
                }
                cb(out);
            },
            set(obj, cb) { for (const [k, v] of Object.entries(obj)) _store.set(k, v); cb && cb(); },
            remove(keys, cb) { for (const k of Array.isArray(keys) ? keys : [keys]) _store.delete(k); cb && cb(); }
        }
    }
};

const {
    buildEntityAuditTool, buildRegistryDigest, validateEntityOps,
    ENTITY_AUDIT_TOOL_NAME, MAX_MENTIONS_PER_ENTITY
} = await import('../src/shared/llm-entity-audit.js');
const { EntityModel } = await import('../src/shared/entity-model.js');
const { LocalKeyManager } = await import('../src/shared/local-key-manager.js');

const ENTITIES = {
    ent_bob: { id: 'ent_bob', name: 'Bob Smith', type: 'person' },
    ent_robert: { id: 'ent_robert', name: 'Robert Smith', type: 'person' },
    ent_org: { id: 'ent_org', name: 'Diocese of Springfield', type: 'organization' },
    ent_alias: { id: 'ent_alias', name: 'The Diocese', type: 'organization', canonical_id: 'ent_org' }
};
const MENTIONS = {
    ent_bob: ['Bob Smith', 'store owner Bob Smith reported the theft'],
    ent_robert: ['Robert Smith', 'Robert Smith, who runs the resale shop'],
    ent_org: ['Diocese of Springfield'],
    ent_alias: ['The Diocese']
};

test('E2: tool schema — pinned name, op enum, no numeric-score keys (P2)', () => {
    const tool = buildEntityAuditTool();
    assert.equal(tool.name, ENTITY_AUDIT_TOOL_NAME);
    assert.deepEqual(tool.input_schema.properties.ops.items.properties.op.enum,
        ['merge', 'rename', 'retype', 'split', 'external_id']);
    const banned = /score|confidence|probability|rating|grade|likelihood/i;
    for (const k of (JSON.stringify(tool.input_schema).match(/"[^"]+":/g) || [])) {
        assert.ok(!banned.test(k.slice(1, -2)), `forbidden numeric key ${k}`);
    }
});

test('E2: buildRegistryDigest — blocks, alias lines, mention harvest capped, evidence corpus', () => {
    const articles = [
        { url: 'https://ex.com/a', article: { title: 'The theft', entities: [
            { entity_id: 'ent_bob', context: 'store owner Bob Smith reported the theft' },
            { entity_id: 'ent_bob', context: 'second mention' },
            { entity_id: 'ent_bob', context: 'third mention' },
            { entity_id: 'ent_bob', context: 'FOURTH mention — over the cap' },
            { entity_id: 'ent_org', context: 'the Diocese of Springfield said' }
        ] } },
        { url: 'https://ex.com/b', article: { title: 'B', entities: [
            { entity_id: 'ent_alias' }   // no context → no mention harvested
        ] } }
    ];
    const { digest, included, truncated, mentionTextByEntity } =
        buildRegistryDigest({ entities: ENTITIES, articles });
    assert.equal(included, 4);
    assert.equal(truncated, 0);
    assert.match(digest, /\[ent_bob\] Bob Smith \(person\)/);
    assert.match(digest, /alias of → \[ent_org\]/);
    assert.match(digest, /mention: "store owner Bob Smith reported the theft" — The theft/);
    assert.ok(!digest.includes('FOURTH'), `mentions capped at ${MAX_MENTIONS_PER_ENTITY}`);
    // The evidence corpus: name + harvested contexts.
    assert.ok(mentionTextByEntity.ent_bob.includes('Bob Smith'));
    assert.ok(mentionTextByEntity.ent_bob.some((t) => t.includes('reported the theft')));
});

test('E2: firewall — a grounded merge passes; every broken merge is rejected with a reason', () => {
    const ground = { entities: ENTITIES, mentionTextByEntity: MENTIONS };
    const good = {
        op: 'merge', alias_id: 'ent_bob', canonical_id: 'ent_robert', note: 'Same person',
        evidence: [
            { entity_id: 'ent_bob', quote: 'store owner Bob Smith' },
            { entity_id: 'ent_robert', quote: 'runs the resale shop' }
        ]
    };
    const cases = [
        [good, true, null],
        [{ ...good, alias_id: 'ent_nope' }, false, /not a known entity/],
        [{ ...good, canonical_id: 'ent_bob' }, false, /same entity/],
        [{ ...good, canonical_id: 'ent_org' }, false, /Type mismatch/],
        [{ op: 'merge', alias_id: 'ent_alias', canonical_id: 'ent_org', note: 'n', evidence: [
            { entity_id: 'ent_alias', quote: 'The Diocese' }, { entity_id: 'ent_org', quote: 'Diocese of Springfield' }
        ] }, false, /Already alias-linked/],
        [{ ...good, evidence: [{ entity_id: 'ent_bob', quote: 'store owner Bob Smith' }] }, false, /BOTH endpoints/],
        [{ ...good, evidence: [
            { entity_id: 'ent_bob', quote: 'a fabricated quote' },
            { entity_id: 'ent_robert', quote: 'runs the resale shop' }
        ] }, false, /BOTH endpoints/],
        [{ ...good, note: '  ' }, false, /note/]
    ];
    for (const [op, shouldPass, reasonRe] of cases) {
        const { accepted, rejected } = validateEntityOps([op], ground);
        if (shouldPass) assert.equal(accepted.length, 1, JSON.stringify(op));
        else {
            assert.equal(accepted.length, 0, JSON.stringify(op));
            assert.match(rejected[0].reason, reasonRe);
        }
    }
});

test('E2: firewall — rename/retype/split/external_id rules + dedup', () => {
    const ground = { entities: ENTITIES, mentionTextByEntity: MENTIONS };
    const run = (op) => validateEntityOps([op], ground);

    assert.equal(run({ op: 'rename', entity_id: 'ent_bob', name: 'Robert "Bob" Smith', note: 'n' }).accepted.length, 1);
    assert.match(run({ op: 'rename', entity_id: 'ent_bob', name: 'Bob Smith', note: 'n' }).rejected[0].reason, /unchanged/);
    assert.match(run({ op: 'rename', entity_id: 'ent_bob', name: ' ', note: 'n' }).rejected[0].reason, /needs a name/);

    assert.equal(run({ op: 'retype', entity_id: 'ent_bob', entity_type: 'organization', note: 'n' }).accepted.length, 1);
    assert.match(run({ op: 'retype', entity_id: 'ent_bob', entity_type: 'person', note: 'n' }).rejected[0].reason, /unchanged/);
    assert.match(run({ op: 'retype', entity_id: 'ent_bob', entity_type: 'alien', note: 'n' }).rejected[0].reason, /Invalid type/);

    const split = { op: 'split', entity_id: 'ent_bob', note: 'two people', sides: [
        { name: 'Bob Smith (owner)', evidence: [{ quote: 'store owner Bob Smith' }] },
        { name: 'Bob Smith (customer)', evidence: [{ quote: 'reported the theft' }] }
    ] };
    assert.equal(run(split).accepted.length, 1);
    assert.match(run({ ...split, sides: [split.sides[0]] }).rejected[0].reason, /two named sides/);
    assert.match(run({ ...split, sides: [split.sides[0], { name: 'X', evidence: [{ quote: 'nope not stored' }] }] })
        .rejected[0].reason, /grounded/);

    assert.equal(run({ op: 'external_id', entity_id: 'ent_org', scheme: 'wikidata', value: 'Q42', note: 'n' }).accepted.length, 1);
    assert.match(run({ op: 'external_id', entity_id: 'ent_org', scheme: 'wikidata', value: 'notaq', note: 'n' }).rejected[0].reason, /Q42/);
    assert.match(run({ op: 'external_id', entity_id: 'ent_org', scheme: 'url', value: 'ftp://x', note: 'n' }).rejected[0].reason, /http/);
    assert.match(run({ op: 'external_id', entity_id: 'ent_org', scheme: 'isbn', value: 'x', note: 'n' }).rejected[0].reason, /Unknown scheme/);

    // Duplicate ops collapse to one accept + one reasoned reject.
    const dup = { op: 'rename', entity_id: 'ent_bob', name: 'New Name', note: 'n' };
    const { accepted, rejected } = validateEntityOps([dup, { ...dup }], ground);
    assert.equal(accepted.length, 1);
    assert.match(rejected[0].reason, /Duplicate/);
});

test('E2 §7 Q1 pin: rename and retype NEVER rederive the entity id; external_ids round-trip', async () => {
    _store.clear();
    LocalKeyManager.keys.clear();
    const created = await EntityModel.create({ name: 'Elena Vargas', type: 'person' });
    const renamed = await EntityModel.update(created.id, { name: 'Mayor Elena Vargas' });
    assert.equal(renamed.id, created.id, 'rename keeps the id — no create-and-alias needed');
    const retyped = await EntityModel.update(created.id, { type: 'organization' });
    assert.equal(retyped.id, created.id, 'retype keeps the id');
    assert.ok(await EntityModel.get(created.id), 'still resolvable under the original id');

    const withIds = await EntityModel.update(created.id, { external_ids: ['wikidata:Q42', 'wikidata:Q42', ' '] });
    assert.deepEqual(withIds.external_ids, ['wikidata:Q42'], 'deduped + cleaned');
    const cleared = await EntityModel.update(created.id, { external_ids: [] });
    assert.equal(cleared.external_ids, undefined, 'empty clears the field');
});
