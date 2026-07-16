// follow-publish.js + buildFollowListEvent tests — Phase 25.6 (the
// kind-3 opt-in mirror; amended KNOWLEDGE_SHARING §9). NIP-02 shape,
// the global-scope-only guard, union-merge clobber protection,
// petname rules, and the flag default pin.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const _store = new Map();
globalThis.chrome = {
    storage: {
        local: {
            get(keys, cb) { const o = {}; for (const k of (Array.isArray(keys) ? keys : [keys])) if (_store.has(k)) o[k] = _store.get(k); cb(o); },
            set(obj, cb) { for (const [k, v] of Object.entries(obj)) _store.set(k, v); cb && cb(); },
            remove(keys, cb) { for (const k of (Array.isArray(keys) ? keys : [keys])) _store.delete(k); cb && cb(); }
        }
    }
};

const { selectFollowsToPublish, mergeWithRemote, parseFollowListEvent } =
    await import('../src/shared/follow-publish.js');
const { EventBuilder } = await import('../src/shared/event-builder.js');
const { FollowModel } = await import('../src/shared/follow-model.js');
const { FLAGS_DEFAULTS } = await import('../src/shared/metadata/feature-flags.js');

const ME = 'c'.repeat(64);
const PK_1 = '1'.repeat(64);
const PK_2 = '2'.repeat(64);
const PK_REMOTE = '9'.repeat(64);

beforeEach(() => _store.clear());

test('flag default: followListPublishing ships off', () => {
    assert.equal(FLAGS_DEFAULTS.followListPublishing, false);
});

// ------------------------------------------------------------------
// The global-only guard — case/entity anchors can never publish
// ------------------------------------------------------------------

test('selectFollowsToPublish reads ONLY the global anchor', async () => {
    await FollowModel.addFollow({ scope: 'global' }, { pubkey: PK_1, label: 'Alice' });
    await FollowModel.addFollow({ scope: 'case', entityId: 'entity_case' }, { pubkey: PK_2 });
    await FollowModel.addFollow({ scope: 'entity', entityId: 'entity_x' }, { pubkey: PK_REMOTE });
    const out = await selectFollowsToPublish();
    assert.deepEqual(out.map((e) => e.pubkey), [PK_1]);
});

// ------------------------------------------------------------------
// NIP-02 shape
// ------------------------------------------------------------------

test('buildFollowListEvent: standard NIP-02, empty content, hint slot, dedup', () => {
    const event = EventBuilder.buildFollowListEvent([
        { pubkey: PK_1, relayHints: ['wss://a.example'], label: 'Alice' },
        { pubkey: PK_1 },                                  // dupe drops
        { pubkey: PK_2 },
        { pubkey: 'garbage' }                              // invalid drops
    ], ME);
    assert.equal(event.kind, 3);
    assert.equal(event.content, '');
    assert.equal(event.pubkey, ME);
    assert.deepEqual(event.tags, [
        ['p', PK_1, 'wss://a.example'],   // labels OFF by default — no petname slot
        ['p', PK_2, '']
    ]);
});

test('petnames publish only on opt-in; remote-preserved labels always re-publish', () => {
    const entries = [
        { pubkey: PK_1, label: 'Alice' },
        { pubkey: PK_REMOTE, label: 'their-petname', remoteOnly: true }
    ];
    const off = EventBuilder.buildFollowListEvent(entries, ME);
    assert.deepEqual(off.tags, [
        ['p', PK_1, ''],                                   // local label private
        ['p', PK_REMOTE, '', 'their-petname']              // remote data never clobbered
    ]);
    const on = EventBuilder.buildFollowListEvent(entries, ME, { includeLabels: true });
    assert.deepEqual(on.tags[0], ['p', PK_1, '', 'Alice']);
});

test('parseFollowListEvent round-trips and rejects non-kind-3', () => {
    const event = EventBuilder.buildFollowListEvent(
        [{ pubkey: PK_1, relayHints: ['wss://a.example'], label: 'Alice' }], ME, { includeLabels: true });
    assert.deepEqual(parseFollowListEvent(event), [
        { pubkey: PK_1, relayHint: 'wss://a.example', petname: 'Alice' }
    ]);
    assert.deepEqual(parseFollowListEvent({ kind: 10002, tags: [['p', PK_1]] }), []);
});

// ------------------------------------------------------------------
// Clobber protection
// ------------------------------------------------------------------

test('mergeWithRemote unions remote-only entries, preserving hint + petname', () => {
    const local = [{ pubkey: PK_1, label: 'Alice', relayHints: [] }];
    const remote = {
        kind: 3,
        tags: [
            ['p', PK_1, 'wss://other.example'],            // already local — local wins
            ['p', PK_REMOTE, 'wss://r.example', 'friend']  // remote-only — preserved
        ],
        content: ''
    };
    const { entries, remoteOnly, localCount } = mergeWithRemote(local, remote);
    assert.equal(localCount, 1);
    assert.deepEqual(remoteOnly, [PK_REMOTE]);
    assert.equal(entries.length, 2);
    const preserved = entries.find((e) => e.pubkey === PK_REMOTE);
    assert.equal(preserved.remoteOnly, true);
    assert.equal(preserved.label, 'friend');
    assert.deepEqual(preserved.relayHints, ['wss://r.example']);
});

test('mergeWithRemote with no remote event is identity on local', () => {
    const local = [{ pubkey: PK_1 }, { pubkey: PK_2 }];
    const { entries, remoteOnly } = mergeWithRemote(local, null);
    assert.equal(entries.length, 2);
    assert.deepEqual(remoteOnly, []);
});

test('the merged set survives a full publish round-trip (nothing lost)', () => {
    const local = [{ pubkey: PK_1, label: 'Alice' }];
    const remote = { kind: 3, tags: [['p', PK_REMOTE, '', 'friend']], content: '' };
    const { entries } = mergeWithRemote(local, remote);
    const republished = EventBuilder.buildFollowListEvent(entries, ME);
    const readBack = parseFollowListEvent(republished);
    assert.deepEqual(readBack.map((e) => e.pubkey).sort(), [PK_1, PK_REMOTE].sort());
    assert.equal(readBack.find((e) => e.pubkey === PK_REMOTE).petname, 'friend');
});
