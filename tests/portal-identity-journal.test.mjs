// portal/identity.js over the REAL signed-event journal (JOURNAL
// 2026-10-01). The live signer can move away from a case (Options ▸
// Signing "Use", a restore, a rebind) while everything the case published
// stays signed by its earlier key — and the portal used to ask only for
// the live one, so the case's corpus vanished and reconcile called it
// missing. These drive resolveIdentities end to end: rows written by
// event-journal's own recordPublished into fake-indexeddb, the workspace
// registry and profiles in the chrome.storage shim.
//
// Provenance: INTERPRETATION (2026-10-01) — expires 2026-12-30

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
await import('fake-indexeddb/auto');

const { Storage } = await import('../src/shared/storage.js');
const { LocalKeyManager } = await import('../src/shared/local-key-manager.js');
const { recordPublished, clear: clearJournal } = await import('../src/shared/event-journal.js');
const { resolveIdentities } = await import('../src/portal/identity.js');
const { resolverIdentity } = await import('../src/portal/audit-data.js');

const LIVE = '1'.repeat(64);        // the live Local signer, a saved profile
const CASE_KEY = '2'.repeat(64);    // the case's bound identity, a saved profile
const OLDER = '3'.repeat(64);       // a profile that signed here before, bound nowhere now
const COLLAB = '4'.repeat(64);      // a collaborator: their rows arrived by merge-import
const VIEWER = '5'.repeat(64);      // a pasted read-only archive
const ENTITY = '6'.repeat(64);      // an entity key: signs kind-0 profiles

const profile = (pubkey, label) => ({ pubkey, label, privateKey: 'f'.repeat(64), npub: 'npub1x', nsec: 'nsec1x', created: 1 });
let seq = 0;
async function journal(kind, pubkey, relays) {
    seq++;
    const event = {
        id: seq.toString(16).padStart(64, '0'), pubkey, kind, created_at: 1790000000 + seq,
        tags: kind >= 30000 ? [['d', `d-${seq}`]] : [], content: '', sig: 'a'.repeat(128)
    };
    const results = {
        successful: relays.filter((r) => r.success).length,
        confirmed: relays.filter((r) => r.success && !r.assumed).length,
        failed: relays.filter((r) => !r.success).length,
        total: relays.length,
        results: relays
    };
    await recordPublished(event, results);
}
const ok = (url) => ({ url, success: true, assumed: false });
const assumed = (url) => ({ url, success: true, assumed: true });

async function seed({ bound = CASE_KEY } = {}) {
    _stateStore.clear();
    LocalKeyManager.keys.clear();
    await clearJournal();
    await Storage.set('preferences', { signing_method: 'local', signing_method_configured: true });
    await Storage.set('local_primary_identity', { pubkey: LIVE, privateKey: '9'.repeat(64) });
    await Storage.set('identity_profiles', {
        [LIVE]: profile(LIVE, 'Personal'), [CASE_KEY]: profile(CASE_KEY, 'Case key'), [OLDER]: profile(OLDER, 'Older')
    });
    await Storage.set('workspaces', {
        default: { id: 'default', label: 'Default workspace', case_entity_id: null, identity_pubkey: bound, created: 1 }
    });
    await Storage.set('portal_identities', [VIEWER]);
}

const sourcesFor = (list, pk) => {
    const hit = list.find((i) => i.pubkey === pk);
    return hit ? [...hit.sources].sort() : null;
};

test('the case corpus stays "me" after the live signer moved: bound identity + journal profiles', async () => {
    await seed();
    await journal(30023, CASE_KEY, [ok('wss://relay.primal.net'), ok('wss://nostr.oxtr.dev'), assumed('wss://relay.damus.io')]);
    await journal(30040, OLDER, [ok('wss://offchain.pub')]);
    await journal(30040, LIVE, [ok('wss://nos.lol')]);
    await journal(30040, COLLAB, [ok('wss://collaborator.example')]);
    await journal(30040, VIEWER, [ok('wss://viewer.example')]);
    await journal(0, ENTITY, [ok('wss://entity.example')]);

    const { identities, viewers, signer, historyRelays } = await resolveIdentities();

    assert.equal(signer.pubkey, LIVE);
    assert.deepEqual(sourcesFor(identities, LIVE), ['journal', 'signer']);
    assert.deepEqual(sourcesFor(identities, CASE_KEY), ['case-identity', 'journal'],
        'the bound identity is "me" though it is not the live signer');
    assert.deepEqual(sourcesFor(identities, OLDER), ['journal'],
        'a saved profile that signed this case\'s events is "me"');
    // The fences: only PROFILES qualify from the journal.
    assert.equal(sourcesFor(identities, COLLAB), null, 'a merged-in collaborator never becomes "me"');
    assert.equal(sourcesFor(viewers, COLLAB), null);
    assert.equal(sourcesFor(identities, VIEWER), null, 'a pasted viewer stays a viewer (28.4)');
    assert.deepEqual(sourcesFor(viewers, VIEWER), ['manual']);
    assert.equal(sourcesFor(identities, ENTITY), null, 'an entity key is never "me"');

    assert.deepEqual([...historyRelays].sort(),
        ['wss://nos.lol', 'wss://nostr.oxtr.dev', 'wss://offchain.pub', 'wss://relay.primal.net'],
        'the relays that CONFIRMED "my" events — not an assumed send, a collaborator\'s, a viewer\'s or an entity\'s');
});

test('a key that is "me" only through a claim stamp adds no read relay (merge-import can carry the stamp)', async () => {
    await seed();
    // A collaborator's claims arrived by merge-import with their publish
    // stamps (pre-existing: that alone makes the key "me"), and so did
    // their journal rows. Their relays must not become read destinations.
    await Storage.set('article_claims', {
        c1: { id: 'c1', text: 't', source_url: 'https://example.com', publishedPubkey: COLLAB, publishedPubkeys: [COLLAB] }
    });
    await journal(30040, COLLAB, [ok('wss://collaborator.example')]);
    await journal(30023, CASE_KEY, [ok('wss://relay.nostr.net')]);
    const { identities, historyRelays } = await resolveIdentities();
    assert.deepEqual(sourcesFor(identities, COLLAB), ['publish-history'], 'sanity: the stamp makes it an identity');
    assert.deepEqual(historyRelays, ['wss://relay.nostr.net']);
});

test('a bound case with nothing published yet: the binding alone makes its identity "me"', async () => {
    await seed();
    const { identities, historyRelays } = await resolveIdentities();
    assert.deepEqual(sourcesFor(identities, CASE_KEY), ['case-identity']);
    assert.deepEqual(sourcesFor(identities, LIVE), ['signer']);
    assert.deepEqual(historyRelays, []);
});

test('an unbound case adds no case identity', async () => {
    await seed({ bound: null });
    const { identities } = await resolveIdentities();
    assert.equal(sourcesFor(identities, CASE_KEY), null);
    assert.deepEqual(identities.map((i) => i.pubkey), [LIVE]);
});

test('an unreadable journal degrades to the old sources — never a throw', async () => {
    await seed();
    const out = await resolveIdentities({ readJournal: async () => { throw new Error('quota'); } });
    assert.deepEqual(sourcesFor(out.identities, LIVE), ['signer']);
    assert.deepEqual(sourcesFor(out.identities, CASE_KEY), ['case-identity']);
    assert.deepEqual(out.historyRelays, []);
});

test('the new sources never become the resolution signer (resolverIdentity)', async () => {
    await seed();
    await journal(30023, CASE_KEY, [ok('wss://relay.primal.net')]);
    // Under NIP-07 the portal has no signer key: the case identity and
    // the journal's profiles are LOCAL keys the NIP-07 signer is not.
    await Storage.set('preferences', { signing_method: 'nip07', signing_method_configured: true });
    const { identities } = await resolveIdentities();
    assert.ok(identities.some((i) => i.sources.includes('case-identity')), 'sanity: the case identity resolved');
    assert.equal(resolverIdentity(identities), null,
        'no claim stamp evidences the NIP-07 key, so Resolve disables rather than minting under a local key');
});
