// Entity-profile tests — Phase 19.7 (ENTITY_DOSSIER_DESIGN §6, §8
// spine): unpublished-claim facts excluded, contested omitted from the
// about but both-sides in the sheet, no judgment strings, and
// republish-hash idempotence (the MD-6 generated_at exclusion).

import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

const {
    buildProfileAbout, buildFactSheetEvent, parseFactSheetEvent,
    factSheetContentHash, profileAboutHash, FACT_SHEET_KIND, FACT_SHEET_D
} = await import('../src/shared/entity-profile.js');

const ENTITY_PK = 'a'.repeat(64);
const USER_PK = 'b'.repeat(64);
const HASH = 'c'.repeat(64);

// A hand-built dossier honoring the 19.3 field-row contract.
function fixtureDossier({ fields = [] } = {}) {
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
        },
        fields
    };
}

const ev = (claimId, { published = null, url = 'https://who-times.test/a', quote = 'quoted', capturedAt = 1751000000, pubkey = null } = {}) => ({
    claim_id: claimId, quote, source_url: url, article_hash: HASH,
    captured_at: capturedAt, suggested_by: 'user',
    published_event_id: published, published_pubkey: pubkey
});

const group = (value, evidence, extra = {}) => ({
    value, value_ref: extra.value_ref || null,
    valid_from: extra.valid_from ?? null, valid_from_precision: extra.valid_from_precision ?? null,
    valid_to: extra.valid_to ?? null, valid_to_precision: extra.valid_to_precision ?? null,
    observed_at: null, observed_precision: null, evidence
});

const row = (field, status, current, extra = {}) => ({
    field, label: extra.label || field, value_type: extra.value_type || 'text',
    multiple: false, evolves: false, provenance: extra.provenance || 'sourced',
    status, current, history: extra.history || [], conflicts: [], authored: extra.authored || null,
    coverage: { claims: current.length, published_claims: 0 }
});

test('profile about: only published-claim facts; unpublished stay local', () => {
    const d = fixtureDossier({
        fields: [
            row('headquarters', 'known', [group('Geneva', [ev('claim_1', { published: 'evt1' })])]),
            row('org_type', 'known', [group('UN agency', [ev('claim_2')])])   // NOT published
        ]
    });
    const about = buildProfileAbout(d);
    assert.match(about, /organization entity\. Global health agency\./);
    assert.match(about, /Also mentioned as: World Health Organization\./);
    assert.match(about, /headquarters: Geneva \(per who-times\.test, captured 2025-06-27\)/);
    assert.ok(!about.includes('UN agency'), 'unpublished-claim fact excluded — every line must verify from relays');
    assert.match(about, /Assembled from 1 captured source by an X-Ray archive/);
    assert.match(about, /kind-30067 fact sheet/);
});

test('profile about: contested fields OMITTED — even when one side is published', () => {
    const d = fixtureDossier({
        fields: [
            // Contested with ONE published side: status comes from the
            // FULL dossier, so the published side must NOT leak into
            // the about as if known.
            row('founded', 'contested', [
                group('1948', [ev('claim_1', { published: 'evt1' })]),
                group('1946', [ev('claim_2')])
            ])
        ]
    });
    const about = buildProfileAbout(d);
    assert.ok(!about.includes('1948'), 'the published side of a contested field does not leak');
    assert.ok(!about.includes('1946'));
    assert.ok(!about.toLowerCase().includes('contested'),
        'no public disagreement flag rides the profile');
});

test('profile about: authored framing and excluded fields never publish; boilerplate when empty', () => {
    const d = fixtureDossier({
        fields: [
            row('scope_question', 'known', [], { provenance: 'authored',
                authored: { value: 'What happened?', updated: 1 } }),
            row('headquarters', 'known', [group('Geneva', [ev('claim_1', { published: 'evt1' })])])
        ]
    });
    assert.ok(!buildProfileAbout(d).includes('What happened?'), 'authored framing never publishes as fact');
    const excluded = buildProfileAbout(d, { excludedFields: ['headquarters'] });
    assert.ok(!excluded.includes('Geneva'), 'per-field checklist honored');
    assert.match(excluded, /organization entity\./, 'boilerplate line survives');
    assert.ok(!excluded.includes('Assembled from'), 'no assembly line when nothing publishable');
});

test('fact sheet: contested fields appear BOTH SIDES (published only), a-coords name real publishers', () => {
    const d = fixtureDossier({
        fields: [
            row('founded', 'contested', [
                group('1948', [ev('claim_1', { published: 'evt1', pubkey: USER_PK })]),
                group('1946', [ev('claim_2', { published: 'evt2', pubkey: 'd'.repeat(64) })]),
                group('1949', [ev('claim_3')])   // unpublished side — withheld
            ], { value_type: 'date' })
        ]
    });
    const sheet = buildFactSheetEvent(d, {
        entityPubkey: ENTITY_PK, publisherPubkey: USER_PK, generatedAt: 1751500000
    });
    assert.equal(sheet.kind, FACT_SHEET_KIND);
    assert.equal(sheet.pubkey, ENTITY_PK, 'entity-signed');
    assert.deepEqual(sheet.tags.find((t) => t[0] === 'd'), ['d', FACT_SHEET_D]);
    assert.deepEqual(sheet.tags.find((t) => t[0] === 'p'), ['p', USER_PK, '', 'publisher']);

    const facts = sheet.tags.filter((t) => t[0] === 'fact');
    assert.deepEqual(facts.map((t) => t[2]).sort(), ['1946', '1948'],
        'both PUBLISHED sides present; the unpublished side is withheld');

    const coords = sheet.tags.filter((t) => t[0] === 'a' && t[3] === 'fact-source').map((t) => t[1]);
    assert.ok(coords.includes(`30040:${USER_PK}:claim_1`));
    assert.ok(coords.includes(`30040:${'d'.repeat(64)}:claim_2`), 'coordinate names the claim\'s ACTUAL publisher');
    assert.ok(!coords.some((c) => c.endsWith(':claim_3')), 'no coordinate for the unpublished claim');

    const content = JSON.parse(sheet.content);
    assert.equal(content.version, 1);
    for (const f of content.fields) {
        assert.equal(f.contested, true, 'the field-level contested flag survives on every side');
    }
    // Round-trip.
    const parsed = parseFactSheetEvent(sheet);
    assert.equal(parsed.d, FACT_SHEET_D);
    assert.equal(parsed.facts.length, 2);
    assert.equal(parsed.content.entity_id, d.subject.id);
});

test('fact sheet + about: no judgment vocabulary anywhere (§3.5 on the wire hardest of all)', () => {
    const d = fixtureDossier({
        fields: [
            row('headquarters', 'known', [group('Geneva', [ev('claim_1', { published: 'evt1' })])]),
            row('founded', 'contested', [
                group('1948', [ev('claim_2', { published: 'evt2' })]),
                group('1946', [ev('claim_3', { published: 'evt3' })])
            ])
        ]
    });
    const about = buildProfileAbout(d).toLowerCase();
    const sheet = JSON.stringify(buildFactSheetEvent(d, {
        entityPubkey: ENTITY_PK, publisherPubkey: USER_PK, generatedAt: 1
    })).toLowerCase();
    for (const banned of ['verdict', 'ruling', 'integrity', '"score', 'credib', 'liar', 'trustworth', ' is true', ' is false']) {
        assert.ok(!about.includes(banned), `about carries no "${banned}"`);
        assert.ok(!sheet.includes(banned), `sheet carries no "${banned}"`);
    }
    assert.match(about, /per who-times\.test/, 'attribution is "per <source>", never "is"');
});

test('republish hashing: generated_at excluded — same content twice hashes equal, a new fact differs', async () => {
    const fields = [row('headquarters', 'known', [group('Geneva', [ev('claim_1', { published: 'evt1' })])])];
    const d = fixtureDossier({ fields });
    const sheetA = buildFactSheetEvent(d, { entityPubkey: ENTITY_PK, publisherPubkey: USER_PK, generatedAt: 100 });
    const sheetB = buildFactSheetEvent(d, { entityPubkey: ENTITY_PK, publisherPubkey: USER_PK, generatedAt: 999 });
    assert.equal(await factSheetContentHash(sheetA), await factSheetContentHash(sheetB),
        'two assemblies of unchanged content hash EQUAL — the republish gate converges');

    const grown = fixtureDossier({
        fields: [...fields, row('org_type', 'known', [group('UN agency', [ev('claim_9', { published: 'evt9' })])])]
    });
    const sheetC = buildFactSheetEvent(grown, { entityPubkey: ENTITY_PK, publisherPubkey: USER_PK, generatedAt: 100 });
    assert.notEqual(await factSheetContentHash(sheetA), await factSheetContentHash(sheetC),
        'a new published fact changes the hash');

    assert.equal(await profileAboutHash(buildProfileAbout(d)), await profileAboutHash(buildProfileAbout(d)));
    assert.notEqual(await profileAboutHash(buildProfileAbout(d)), await profileAboutHash(buildProfileAbout(grown)));
});

test('fact sheet: band-truncated validity slots; empty when nothing published', () => {
    const d = fixtureDossier({
        fields: [row('leadership', 'known', [
            group('Dr. X', [ev('claim_1', { published: 'evt1' })], {
                valid_from: Date.UTC(2019, 0, 1) / 1000, valid_from_precision: 'year'
            })
        ], { value_type: 'entity-ref' })]
    });
    const sheet = buildFactSheetEvent(d, { entityPubkey: ENTITY_PK, publisherPubkey: USER_PK, generatedAt: 1 });
    assert.deepEqual(sheet.tags.find((t) => t[0] === 'fact'),
        ['fact', 'leadership', 'Dr. X', '2019', ''],
        'year-precision valid_from goes out as bare YYYY; open valid_to is empty');

    const empty = buildFactSheetEvent(fixtureDossier({
        fields: [row('org_type', 'known', [group('UN agency', [ev('claim_2')])])]
    }), { entityPubkey: ENTITY_PK, publisherPubkey: USER_PK, generatedAt: 1 });
    assert.equal(empty.tags.filter((t) => t[0] === 'fact').length, 0,
        'no published facts ⇒ no fact tags (the reader batch skips publishing it)');
});
