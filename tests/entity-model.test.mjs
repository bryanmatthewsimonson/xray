// Entity model tests — Phase 4 (issue #15).
//
// Stubs chrome.storage.local with an in-memory Map before importing the
// module graph, so Storage + LocalKeyManager work in Node without
// touching a real browser. Node's WebCrypto (globalThis.crypto) is
// already good enough for the actual keypair generation.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// --- chrome.storage.local shim ---------------------------------------
// Has to be installed BEFORE the first Storage import, because storage.js
// captures the backing store at module-load time. Node exposes
// globalThis.chrome nowhere, so we synthesize one.
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

const { EntityModel, ENTITY_TYPES, ENTITY_ICONS,
        entityTypeToTag, generateEntityId, installEntityStorageBridge } =
    await import('../src/shared/entity-model.js');
const { LocalKeyManager } = await import('../src/shared/local-key-manager.js');
const { EventBuilder } = await import('../src/shared/event-builder.js');

// Fresh state between groups of tests — tests that create entities
// should be independent.
function resetState() {
    _stateStore.clear();
    LocalKeyManager.keys.clear();
}

// ---------------------------------------------------------------------

test('entity: deterministic id generation', async () => {
    const a = await generateEntityId('person', 'Donald Trump');
    const b = await generateEntityId('person', '  donald   trump  '); // whitespace + case
    const c = await generateEntityId('person', 'Joe Biden');
    const d = await generateEntityId('organization', 'Donald Trump'); // different type
    assert.equal(a, b, 'name normalization must produce the same id');
    assert.notEqual(a, c, 'different name → different id');
    assert.notEqual(a, d, 'different type → different id');
    assert.match(a, /^entity_[0-9a-f]{16}$/);
});

test('entity: create generates keypair + merges keypair into get()', async () => {
    resetState();
    const ent = await EntityModel.create({ name: 'Test Person', type: 'person' });
    assert.equal(ent.name, 'Test Person');
    assert.equal(ent.type, 'person');
    assert.match(ent.id, /^entity_[0-9a-f]{16}$/);
    assert.ok(ent.keypair, 'keypair must be populated on returned record');
    assert.match(ent.keypair.pubkey,     /^[0-9a-f]{64}$/);
    assert.match(ent.keypair.privateKey, /^[0-9a-f]{64}$/);
    assert.match(ent.keypair.npub, /^npub1/);
    assert.match(ent.keypair.nsec, /^nsec1/);

    // Round-trip: fresh get() returns the same merged shape
    const fetched = await EntityModel.get(ent.id);
    assert.equal(fetched.keypair.pubkey, ent.keypair.pubkey);
});

test('entity: create is idempotent for same type/name', async () => {
    resetState();
    const a = await EntityModel.create({ name: 'Duplicate', type: 'thing' });
    const b = await EntityModel.create({ name: 'DUPLICATE ', type: 'thing' });
    assert.equal(a.id, b.id);
    assert.equal(a.keypair.pubkey, b.keypair.pubkey, 'idempotent create must not re-key');
});

test('entity: create rejects invalid type + empty name', async () => {
    resetState();
    await assert.rejects(() => EntityModel.create({ name: 'X', type: 'animal' }), /Invalid entity type/);
    await assert.rejects(() => EntityModel.create({ name: '',  type: 'person' }), /name is required/);
    await assert.rejects(() => EntityModel.create({ name: '   ', type: 'person' }), /name is required/);
});

test('entity: update patches mutable fields, keypair is immutable', async () => {
    resetState();
    const e = await EntityModel.create({ name: 'Patchable', type: 'person' });
    const pubkeyBefore = e.keypair.pubkey;
    const updated = await EntityModel.update(e.id, {
        description: 'revised',
        nip05: 'user@example.com',
        name: 'Patchable Renamed'
    });
    assert.equal(updated.description, 'revised');
    assert.equal(updated.nip05, 'user@example.com');
    assert.equal(updated.name, 'Patchable Renamed');
    assert.equal(updated.id, e.id,                       'id is stable under rename');
    assert.equal(updated.keypair.pubkey, pubkeyBefore,   'keypair unchanged under update');
    assert.ok(updated.updated >= e.updated);
});

test('entity: search ranks exact > prefix > substring', async () => {
    resetState();
    await EntityModel.create({ name: 'Donald Trump',     type: 'person' });
    await EntityModel.create({ name: 'Donald Trump Jr.', type: 'person' });
    await EntityModel.create({ name: 'Something Donald', type: 'person' });
    await EntityModel.create({ name: 'Joe Biden',        type: 'person' });

    const results = await EntityModel.search('donald trump');
    assert.equal(results[0].name, 'Donald Trump',     'exact match first');
    assert.equal(results[1].name, 'Donald Trump Jr.', 'prefix match second');
    assert.equal(results.length, 2,                   'substring "donald trump" should not match "Something Donald"');
});

test('entity: linkAlias sets canonical_id, resolveAlias walks the chain', async () => {
    resetState();
    const canonical = await EntityModel.create({ name: 'Donald Trump',        type: 'person' });
    const alias     = await EntityModel.create({ name: 'Donald J. Trump',     type: 'person' });
    await EntityModel.linkAlias(alias.id, canonical.id);

    const aliasFetched = await EntityModel.get(alias.id);
    assert.equal(aliasFetched.canonical_id, canonical.id);

    const resolved = await EntityModel.resolveAlias(aliasFetched);
    assert.equal(resolved.id, canonical.id);
});

test('entity: linkAlias rejects type mismatch', async () => {
    resetState();
    const person = await EntityModel.create({ name: 'Paris',        type: 'person' });
    const place  = await EntityModel.create({ name: 'Paris',        type: 'place' }); // same name, different type → different id
    await assert.rejects(
        () => EntityModel.linkAlias(person.id, place.id),
        /Type mismatch/
    );
});

test('entity: linkAlias rejects self-link', async () => {
    resetState();
    const e = await EntityModel.create({ name: 'Self', type: 'person' });
    await assert.rejects(() => EntityModel.linkAlias(e.id, e.id), /Cannot alias/);
});

test('entity: linkAlias detects cycles', async () => {
    resetState();
    const a = await EntityModel.create({ name: 'A', type: 'person' });
    const b = await EntityModel.create({ name: 'B', type: 'person' });
    const c = await EntityModel.create({ name: 'C', type: 'person' });
    await EntityModel.linkAlias(b.id, a.id);
    await EntityModel.linkAlias(c.id, b.id);
    // Now: c → b → a. Linking a → c would close the cycle.
    await assert.rejects(() => EntityModel.linkAlias(a.id, c.id), /Cycle detected/);
});

test('entity: linkAlias flattens to the deepest canonical (no long chains)', async () => {
    resetState();
    const root  = await EntityModel.create({ name: 'Root',  type: 'person' });
    const mid   = await EntityModel.create({ name: 'Mid',   type: 'person' });
    const leaf  = await EntityModel.create({ name: 'Leaf',  type: 'person' });
    await EntityModel.linkAlias(mid.id, root.id);
    // Linking leaf → mid should flatten to leaf → root directly.
    const linked = await EntityModel.linkAlias(leaf.id, mid.id);
    assert.equal(linked.canonical_id, root.id);
});

test('entity: delete unlinks aliases instead of cascading', async () => {
    resetState();
    const canonical = await EntityModel.create({ name: 'Canon',   type: 'thing' });
    const alias     = await EntityModel.create({ name: 'AliasOf', type: 'thing' });
    await EntityModel.linkAlias(alias.id, canonical.id);

    await EntityModel.delete(canonical.id);
    // Alias still exists; its canonical_id has been cleared.
    const stillThere = await EntityModel.get(alias.id);
    assert.ok(stillThere, 'alias should not be cascade-deleted');
    assert.equal(stillThere.canonical_id, null);
});

test('entity: markPublished records publishedAt without bumping updated', async () => {
    resetState();
    const e = await EntityModel.create({ name: 'Marked', type: 'thing' });
    const updatedBefore = e.updated;
    // Make sure a second passes on slow machines so timestamps differ
    // — or don't, the invariant is strictly `updated` unchanged.
    const marked = await EntityModel.markPublished(e.id, 'aabbccdd'.repeat(8));
    assert.ok(marked.publishedAt > 0);
    assert.equal(marked.publishedEventId, 'aabbccdd'.repeat(8));
    assert.equal(marked.updated, updatedBefore, 'publish must not bump `updated`');
});

test('entity: tag name maps + ENTITY_TYPES is exhaustive', () => {
    // If we add a new entity type later, this map has to stay in sync
    // with the duplicated entity-tag ternaries inside
    // EventBuilder.buildArticleEvent (the buildArticleEvent test below
    // pins the emitted tag per type, so a divergence fails there).
    assert.deepEqual(ENTITY_TYPES.slice().sort(), ['case', 'organization', 'person', 'place', 'thing']);
    assert.equal(entityTypeToTag('person'),       'person');
    assert.equal(entityTypeToTag('organization'), 'org');
    assert.equal(entityTypeToTag('place'),        'place');
    assert.equal(entityTypeToTag('thing'),        'thing');
    assert.equal(entityTypeToTag('case'),         'case');
    for (const type of ENTITY_TYPES) {
        assert.ok(ENTITY_ICONS[type], `ENTITY_ICONS must cover ${type}`);
    }
});

test('entity: buildArticleEvent name-tags every entity type per entityTypeToTag', async () => {
    resetState();
    installEntityStorageBridge();   // buildArticleEvent reads Storage.entities

    const refs = [];
    for (const type of ENTITY_TYPES) {
        const e = await EntityModel.create({ name: `${type} fixture`, type });
        refs.push({ entity_id: e.id, context: 'about' });
    }

    const ev = await EventBuilder.buildArticleEvent(
        { url: 'https://example.com/article', title: 'T', content: 'Body text.' },
        refs,
        'a'.repeat(64)
    );

    // The duplicated entity-tag ternaries inside buildArticleEvent must
    // agree with entityTypeToTag for every type — a new type that only
    // updates the map falls back to 'place' silently on the wire.
    for (const type of ENTITY_TYPES) {
        const expected = [entityTypeToTag(type), `${type} fixture`, 'about'];
        const tag = ev.tags.find((t) => t[0] === expected[0] && t[1] === expected[1]);
        assert.deepEqual(tag, expected, `kind-30023 name tag for entity type '${type}'`);
    }
});

// ── Foreign keyless entities (Knowledge Sharing KS.3) ─────────────────

test('importForeign: creates a keyless record with a synthesized keypair', async () => {
    resetState();
    const pk = 'a'.repeat(64);
    const e = await EntityModel.importForeign({ name: 'Jane Remote', type: 'person', pubkey: pk });
    assert.match(e.id, /^entity_[0-9a-f]{16}$/);
    assert.equal(e.keyName, null);
    assert.equal(e.foreign_pubkey, pk);
    assert.equal(e.keypair.pubkey, pk);
    assert.equal(e.keypair.privateKey, null);
    assert.equal(e.keypair.nsec, null);
    assert.ok(e.keypair.npub && e.keypair.npub.startsWith('npub1'));
    assert.ok(EntityModel.isForeign(e));
});

test('importForeign: id derives from the pubkey, not (type, name)', async () => {
    resetState();
    const local = await EntityModel.create({ name: 'Donald Trump', type: 'person' });
    const foreign = await EntityModel.importForeign({ name: 'Donald Trump', type: 'person', pubkey: 'b'.repeat(64) });
    assert.notEqual(foreign.id, local.id);   // never silently collides with yours
    assert.ok(!EntityModel.isForeign(local));
});

test('importForeign: re-adopt refreshes displayables, keeps identity', async () => {
    resetState();
    const pk = 'c'.repeat(64);
    const first = await EntityModel.importForeign({ name: 'Old Name', type: 'person', pubkey: pk });
    const second = await EntityModel.importForeign({ name: 'New Name', type: 'person', pubkey: pk, description: 'now with a bio' });
    assert.equal(second.id, first.id);
    assert.equal(second.name, 'New Name');
    assert.equal(second.description, 'now with a bio');
    assert.equal(second.created, first.created);
});

test('importForeign: adopting your own keyed pubkey returns the existing entity', async () => {
    resetState();
    const mine = await EntityModel.create({ name: 'Me Person', type: 'person' });
    const adopted = await EntityModel.importForeign({ name: 'Someone Else', type: 'person', pubkey: mine.keypair.pubkey });
    assert.equal(adopted.id, mine.id);
    assert.ok(!EntityModel.isForeign(adopted));
});

test('importForeign: validates pubkey, type, and canonical type-match', async () => {
    resetState();
    await assert.rejects(() => EntityModel.importForeign({ name: 'X', type: 'person', pubkey: 'nope' }));
    await assert.rejects(() => EntityModel.importForeign({ name: 'X', type: 'alien', pubkey: 'd'.repeat(64) }));
    const org = await EntityModel.create({ name: 'Acme', type: 'organization' });
    await assert.rejects(() => EntityModel.importForeign({ name: 'X', type: 'person', pubkey: 'd'.repeat(64), canonicalId: org.id }));
});

test('importForeign: adopt-as-alias joins the alias family', async () => {
    resetState();
    const mine = await EntityModel.create({ name: 'Jane Local', type: 'person' });
    const foreign = await EntityModel.importForeign({ name: 'Jane Remote', type: 'person', pubkey: 'e'.repeat(64), canonicalId: mine.id });
    assert.equal(foreign.canonical_id, mine.id);
    const resolved = await EntityModel.resolveAlias(foreign);
    assert.equal(resolved.id, mine.id);
});

test('importRecord: foreign_pubkey passes through keyless', async () => {
    resetState();
    const row = { id: 'entity_' + '1'.repeat(16), name: 'Foreign Row', type: 'person', foreign_pubkey: 'f'.repeat(64) };
    const e = await EntityModel.importRecord(row);
    assert.equal(e.keyName, null);
    assert.equal(e.keypair.pubkey, 'f'.repeat(64));
    assert.equal(e.keypair.privateKey, null);
    assert.ok(EntityModel.isForeign(e));
});

test('importRecord: a row without foreign_pubkey keeps an existing foreign binding', async () => {
    resetState();
    const pk = '8'.repeat(64);
    const foreign = await EntityModel.importForeign({ name: 'Round Trip Rita', type: 'person', pubkey: pk });
    // A bundle row round-tripped through a pre-KS.3 build loses the field.
    const e = await EntityModel.importRecord({ id: foreign.id, name: 'Round Trip Rita', type: 'person' });
    assert.equal(e.foreign_pubkey, pk);
    assert.equal(e.keyName, null);
    assert.equal(e.keypair.pubkey, pk);
    assert.ok(EntityModel.isForeign(e));
});

test('importRecord: never downgrades a keyed entity to foreign', async () => {
    resetState();
    const mine = await EntityModel.create({ name: 'Keyed Kate', type: 'person' });
    const e = await EntityModel.importRecord({ id: mine.id, name: 'Keyed Kate', type: 'person', foreign_pubkey: 'a'.repeat(64) });
    assert.equal(e.keyName, `entity:${mine.id}`);
    assert.equal(e.keypair.pubkey, mine.keypair.pubkey);
    assert.equal(e.keypair.privateKey, mine.keypair.privateKey);
    assert.ok(!EntityModel.isForeign(e));
});

test('getAll: merges foreign keypairs too', async () => {
    resetState();
    await EntityModel.create({ name: 'Local Larry', type: 'person' });
    await EntityModel.importForeign({ name: 'Foreign Fred', type: 'person', pubkey: '9'.repeat(64) });
    const all = await EntityModel.getAll();
    const fred = Object.values(all).find((e) => e.name === 'Foreign Fred');
    assert.equal(fred.keypair.pubkey, '9'.repeat(64));
    assert.equal(fred.keypair.privateKey, null);
});
