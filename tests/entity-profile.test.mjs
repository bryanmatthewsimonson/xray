// Entity-profile tests — Phase 19.7, post fact-layer retirement
// (2026-07-20): the kind-0 `about` is the honest self-description +
// type + aliases ONLY. The kind-30067 fact sheet and the fact-derived
// field lines are gone; the module-surface pin below keeps them gone.

import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

const profileModule = await import('../src/shared/entity-profile.js');
const { buildProfileAbout, profileAboutHash, profileContentHash } = profileModule;

function fixtureDossier() {
    return {
        subject: { id: 'entity_' + '1'.repeat(16), name: 'W.H.O.', type: 'organization',
                   description: 'Global health agency.', foreign: false },
        identity: {
            family: [
                { id: 'entity_' + '1'.repeat(16), name: 'W.H.O.', relation: 'self' },
                { id: 'entity_' + '2'.repeat(16), name: 'World Health Organization', relation: 'alias' }
            ],
            external_ids: [],
            accounts: [], equivalence_pubkeys: [], mentions: []
        }
    };
}

test('profile about: type line + description + aliases — nothing else', () => {
    const about = buildProfileAbout(fixtureDossier());
    assert.match(about, /organization entity\. Global health agency\./);
    assert.match(about, /Also mentioned as: World Health Organization\./);
    assert.equal(about.split('\n').length, 2, 'exactly the two lines — no field lines');
    // No alias line when the family is just the root.
    const solo = fixtureDossier();
    solo.identity.family = [solo.identity.family[0]];
    assert.ok(!buildProfileAbout(solo).includes('Also mentioned as'));
});

test('profile about: the 24.3 maintainer line leads when a maintainer npub is given', () => {
    const about = buildProfileAbout(fixtureDossier(), { maintainerNpub: 'npub1testmaintainer' });
    const lines = about.split('\n');
    assert.match(lines[0], /An X-Ray subject record maintained by npub1testmaintainer/);
    assert.match(lines[0], /not the subject posting/, 'the honest-labeling clause rides');
});

test('profile about: no judgment vocabulary, ever (§3.5 on the wire hardest of all)', () => {
    const about = buildProfileAbout(fixtureDossier(), { maintainerNpub: 'npub1x' });
    for (const banned of ['verdict', 'ruling', 'score', 'credib', 'liar', 'trustworth']) {
        assert.ok(!about.toLowerCase().includes(banned), `"${banned}" must not appear`);
    }
});

test('retirement pin: the fact-sheet surface is GONE from the module', () => {
    // A re-introduction of kind 30067 must confront this pin (and the
    // rationale in the module header + JOURNAL) first.
    for (const gone of ['buildFactSheetEvent', 'parseFactSheetEvent',
                        'factSheetContentHash', 'FACT_SHEET_KIND', 'FACT_SHEET_D']) {
        assert.ok(!(gone in profileModule), `${gone} stays retired`);
    }
    assert.ok(!buildProfileAbout(fixtureDossier()).includes('30067'),
        'the about no longer points at a fact sheet');
});

test('republish hashing: about hash is content-only; profile hash covers name+about+nip05', async () => {
    const d = fixtureDossier();
    const about = buildProfileAbout(d);
    assert.equal(await profileAboutHash(about), await profileAboutHash(about), 'stable');
    assert.notEqual(await profileAboutHash(about), await profileAboutHash(about + 'x'));

    const entity = { name: 'W.H.O.', nip05: '' };
    const h1 = await profileContentHash(entity, about);
    assert.equal(h1, await profileContentHash({ name: 'W.H.O.', nip05: '' }, about), 'stable');
    assert.notEqual(h1, await profileContentHash({ name: 'WHO renamed', nip05: '' }, about),
        'a rename moves the hash — the 19.8 republish-gate fix holds');
});
