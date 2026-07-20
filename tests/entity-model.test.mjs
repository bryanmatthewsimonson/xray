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
        entityTypeToTag, generateEntityId, installEntityStorageBridge,
        mergeEntityRefs, findEntityByName } =
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

test('entity: authored_fields — case framing round-trips; sourced fields rejected (Phase 19.1)', async () => {
    resetState();
    const kase = await EntityModel.create({ name: 'Covid Origins', type: 'case' });

    const updated = await EntityModel.update(kase.id, {
        authored_fields: {
            scope_question: { value: '  Where did SARS-CoV-2 originate?  ' },
            status:         { value: 'active' }
        }
    });
    assert.equal(updated.authored_fields.scope_question.value, 'Where did SARS-CoV-2 originate?', 'trimmed');
    assert.equal(updated.authored_fields.status.value, 'active');
    assert.ok(Number.isFinite(updated.authored_fields.status.updated));

    // Invalid enum value and non-authored fields are rejected.
    await assert.rejects(EntityModel.update(kase.id, {
        authored_fields: { status: { value: 'paused' } }
    }), /not one of/);
    await assert.rejects(EntityModel.update(kase.id, {
        authored_fields: { founded: { value: '1948' } }
    }), /not an authored field/, 'sourced biography never enters via authored_fields');

    const person = await EntityModel.create({ name: 'Case Person', type: 'person' });
    await assert.rejects(EntityModel.update(person.id, {
        authored_fields: { scope_question: { value: 'x' } }
    }), /not an authored field/, 'case fields do not exist on person entities');

    // null clears; empty values drop the field.
    const cleared = await EntityModel.update(kase.id, { authored_fields: null });
    assert.equal('authored_fields' in cleared, false);
});

test('entity: findEntityByName — exact-name lookup across types', async () => {
    resetState();
    const who = await EntityModel.create({ name: 'World Health Organization', type: 'organization' });

    const hit = await findEntityByName('World Health Organization');
    assert.equal(hit && hit.id, who.id, 'organization resolves by exact name');

    const normalized = await findEntityByName('  world   HEALTH organization ');
    assert.equal(normalized && normalized.id, who.id, 'case + whitespace normalize like the id derivation');

    assert.equal(await findEntityByName('Centers for Disease Control'), null, 'unknown name → null');
    assert.equal(await findEntityByName(''), null, 'empty name → null, no registry read');

    // Same name as BOTH a person and an organization: ENTITY_TYPES
    // order wins — person first.
    const personAmbig = await EntityModel.create({ name: 'Mercury', type: 'person' });
    await EntityModel.create({ name: 'Mercury', type: 'organization' });
    const ambig = await findEntityByName('Mercury');
    assert.equal(ambig && ambig.id, personAmbig.id, 'person outranks organization on a name collision');
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

// ── Entity refs: merge + wire round trip (the reload-loses-tags fix) ──

test('mergeEntityRefs: dedupes on entity_id+context, current wins, archived appends', () => {
    const current = [
        { entity_id: 'entity_a', type: 'person', name: 'A (renamed)', context: 'ctx1' }
    ];
    const archived = [
        { entity_id: 'entity_a', type: 'person', name: 'A', context: 'ctx1' },   // dup — dropped
        { entity_id: 'entity_a', type: 'person', name: 'A', context: 'ctx2' },   // same entity, new mention — kept
        { entity_id: 'entity_b', type: 'organization', name: 'B', context: null },
        { entity_id: null, name: 'junk' },                                        // no id — dropped
        null                                                                      // tolerated
    ];
    const merged = mergeEntityRefs(current, archived);
    assert.equal(merged.length, 3);
    assert.equal(merged[0].name, 'A (renamed)', 'current ref wins on the dupe key');
    assert.deepEqual(merged.map((r) => `${r.entity_id}:${r.context}`),
        ['entity_a:ctx1', 'entity_a:ctx2', 'entity_b:null']);
});

test('mergeEntityRefs: empty/absent inputs fail open', () => {
    assert.deepEqual(mergeEntityRefs(undefined, undefined), []);
    assert.equal(mergeEntityRefs(null, [{ entity_id: 'entity_x', context: 'c' }]).length, 1);
    assert.deepEqual(mergeEntityRefs([{ entity_id: 'entity_x', context: 'c' }], null),
        [{ entity_id: 'entity_x', context: 'c' }]);
});

test('reconstructEntityRefsFromEvent: wire round trip rebuilds ids that join the registry', async () => {
    resetState();
    installEntityStorageBridge();

    const person = await EntityModel.create({ name: 'Elena Vargas', type: 'person' });
    const org    = await EntityModel.create({ name: 'Acme Corp', type: 'organization' });
    const ev = await EventBuilder.buildArticleEvent(
        { url: 'https://example.com/article', title: 'T', content: 'Body text.' },
        [
            { entity_id: person.id, context: 'Elena Vargas said' },
            { entity_id: org.id,    context: 'at Acme Corp' }
        ],
        'a'.repeat(64)
    );

    const refs = await EventBuilder.reconstructEntityRefsFromEvent({ ...ev, id: 'e'.repeat(64) });
    assert.equal(refs.length, 2);
    const back = Object.fromEntries(refs.map((r) => [r.name, r]));
    // The derived ids MATCH the registry's — reconstructed refs join
    // local records; this is what makes portal-opened articles show
    // their tagged entities.
    assert.equal(back['Elena Vargas'].entity_id, person.id);
    assert.equal(back['Elena Vargas'].type, 'person');
    assert.equal(back['Elena Vargas'].context, 'Elena Vargas said');
    assert.equal(back['Acme Corp'].entity_id, org.id);
    assert.equal(back['Acme Corp'].type, 'organization');

    // Fail-open shapes.
    assert.deepEqual(await EventBuilder.reconstructEntityRefsFromEvent(null), []);
    assert.deepEqual(await EventBuilder.reconstructEntityRefsFromEvent({ kind: 1, tags: [] }), []);
});

// --- canonicalIdOf / resolveCanonical (Phase 17A E3) --------------------------

test('entity: canonicalIdOf — pure chain walk with cycle guard and dangling fallback', async () => {
    resetState();
    const a = await EntityModel.create({ name: 'Root Person', type: 'person' });
    const b = await EntityModel.create({ name: 'Alias One', type: 'person' });
    const c = await EntityModel.create({ name: 'Alias Two', type: 'person' });
    await EntityModel.linkAlias(b.id, a.id);
    await EntityModel.linkAlias(c.id, b.id);   // chain c → (resolved) a

    const { canonicalIdOf } = await import('../src/shared/entity-model.js');
    const all = await EntityModel.getAll();
    assert.equal(canonicalIdOf(c.id, all), a.id, 'chain resolves to root');
    assert.equal(canonicalIdOf(a.id, all), a.id, 'root resolves to itself');
    assert.equal(canonicalIdOf('entity_0000000000000000', all), 'entity_0000000000000000',
        'unknown id returns itself');

    // Dangling chain stops at the last resolvable record.
    const snapshot = { [b.id]: { ...all[b.id], canonical_id: 'entity_gone' } };
    assert.equal(canonicalIdOf(b.id, snapshot), b.id);

    // Cycle guard: hand-built cycle can't loop forever.
    const cyc = {
        entity_x: { id: 'entity_x', canonical_id: 'entity_y' },
        entity_y: { id: 'entity_y', canonical_id: 'entity_x' }
    };
    assert.ok(['entity_x', 'entity_y'].includes(canonicalIdOf('entity_x', cyc)));

    // resolveCanonical: id-taking convenience returns the ROOT record.
    const root = await EntityModel.resolveCanonical(c.id);
    assert.equal(root.id, a.id);
    assert.equal(await EntityModel.resolveCanonical('entity_0000000000000000'), null);
});

// --- markProfilePublished (Phase 19.7; fact-sheet stamps retired 2026-07-20) --

test('entity: markProfilePublished stamps the profile hash WITHOUT bumping updated', async () => {
    resetState();
    const e = await EntityModel.create({ name: 'Corpus Person', type: 'person' });
    const updatedBefore = e.updated;

    const stamped = await EntityModel.markProfilePublished(e.id, {
        profileEventId: 'evt_profile', profileHash: 'p'.repeat(64)
    });
    assert.equal(stamped.publishedProfileHash, 'p'.repeat(64));
    assert.equal(stamped.publishedProfileEventId, 'evt_profile');
    assert.ok(Number.isFinite(stamped.profilePublishedAt));
    assert.equal(stamped.updated, updatedBefore,
        'stamping a publish must not look like a local edit — or republish self-triggers forever');
    assert.equal(await EntityModel.markProfilePublished('entity_0000000000000000', {}), null);
});

test('retype-in-place (CW.2): update({type}) keeps id, keyName, and pubkey — the sanctioned migration for mistyped entities', async () => {
    const paper = await EntityModel.create({ name: 'Proximal Origin Retype Test', type: 'case' });
    const beforePubkey = paper.keypair && paper.keypair.pubkey;
    assert.ok(beforePubkey, 'entity has a keypair');

    const retyped = await EntityModel.update(paper.id, { type: 'thing' });
    assert.equal(retyped.type, 'thing', 'type changed');
    assert.equal(retyped.id, paper.id, 'id never re-derives on retype');
    assert.equal(retyped.keyName, paper.keyName, 'key slot unchanged');
    assert.equal(retyped.keypair && retyped.keypair.pubkey, beforePubkey,
        'pubkey unchanged — published kind-0s keep their address');

    // The id stays sha16(ORIGINAL type:name) — the wire-visible stable
    // identifier — so it deliberately no longer matches a fresh
    // derivation from the NEW type (CASE_WORKSPACE_KICKOFF §4.6).
    assert.equal(paper.id, await generateEntityId('case', 'Proximal Origin Retype Test'));

    // An invalid type is still rejected.
    await assert.rejects(EntityModel.update(paper.id, { type: 'project' }), /type/i);
});
