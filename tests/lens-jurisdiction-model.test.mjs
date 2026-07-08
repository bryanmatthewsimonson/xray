// Phase 16.1 — jurisdiction registry (docs/MORAL_LENS_JURISDICTION_DESIGN.md
// §4, §9 Q1, §10, Appendix A.2). Same chrome.storage.local shim pattern
// as forensic-model.test.mjs. The Appendix A definition templates ship
// as these fixtures — zero built-in jurisdictions exist in the code
// (§9 Q3), so the fixtures below are the templates' only executable home.

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

const {
    JurisdictionModel, slugifyJurisdictionId, generateAuthorityId,
    treatAsLiving, admissibleAuthorities, AUTHORITY_EXCERPT_CAP
} = await import('../src/shared/jurisdiction-model.js');
const { ClaimModel } = await import('../src/shared/claim-model.js');

function resetState() { _stateStore.clear(); }

// --- Appendix A.2 templates as fixtures --------------------------------------

function codifiedTemplate(over = {}) {
    return {
        jurisdiction_type: 'codified',
        display_name: 'US federal law (employment-discrimination excerpt)',
        internal_divisions: ['note circuit splits where they exist'],
        corpus: [{
            citation: { work: 'United States Code', edition: '2024 ed.',
                        locator: '42 U.S.C. § 2000e-2', language: 'en' },
            excerpt: 'It shall be an unlawful employment practice for an employer to fail or refuse to hire…',
            admissibility: 'published-statute'
        }],
        ...over
    };
}

function worldviewTemplate(over = {}) {
    return {
        jurisdiction_type: 'worldview',
        display_name: 'Christianity (multi-tradition)',
        internal_divisions: ['Catholic social teaching', 'Reformed', 'Anabaptist / peace-church'],
        corpus: [{
            citation: { work: 'Bible (NRSV)', edition: 'NRSV Updated Edition, 2021',
                        locator: 'Matthew 20:25-28', tradition: 'shared', language: 'en' },
            excerpt: 'whoever wishes to be first among you must be your slave',
            admissibility: 'published-scripture'
        }, {
            citation: { work: 'Rerum Novarum', edition: 'Vatican tr.',
                        locator: '§§ 20-22', tradition: 'Catholic social teaching', language: 'en' },
            excerpt: 'the rich must religiously refrain from cutting down the workmen\'s earnings',
            admissibility: 'published-doctrine'
        }],
        ...over
    };
}

function personaTemplate(over = {}) {
    return {
        jurisdiction_type: 'persona',
        display_name: 'bell hooks',
        is_living_person: false,
        corpus: [{
            citation: { work: 'The Will to Change', edition: 'Washington Square Press, 2004',
                        isbn: '9780743456081', locator: 'ch. 2, p. 35', language: 'en' },
            excerpt: 'Patriarchy is the single most life-threatening social disease assaulting the male body and spirit.',
            admissibility: 'published-book'
        }],
        ...over
    };
}

function livingPersonaTemplate(over = {}) {
    return {
        jurisdiction_type: 'persona',
        display_name: 'A Living Essayist',
        is_living_person: true,
        corpus: [{
            citation: { work: 'Why the patriarchy is killing men', edition: 'Substack, 2023-04-01',
                        locator: '¶ 4-6', language: 'en' },
            excerpt: 'Hierarchy hurts the people at the top too.',
            admissibility: 'published-essay'
        }],
        ...over
    };
}

// --- CRUD ---------------------------------------------------------------------

test('jurisdiction: creates the three Appendix A template kinds', async () => {
    resetState();
    const codified = await JurisdictionModel.create(codifiedTemplate());
    const worldview = await JurisdictionModel.create(worldviewTemplate());
    const persona = await JurisdictionModel.create(personaTemplate());

    assert.equal(codified.id, 'us-federal-law-employment-discrimination-excerpt');
    assert.equal(worldview.corpus.length, 2);
    assert.match(worldview.corpus[0].authority_id, /^auth_[0-9a-f]{16}$/);
    assert.equal(persona.is_living_person, false);
    assert.equal(codified.is_living_person, null, 'non-persona stores null — the guardrail never applies');
    assert.equal((await JurisdictionModel.list()).length, 3);

    const got = await JurisdictionModel.get(persona.id);
    assert.deepEqual(got, persona);
});

test('jurisdiction: id is a slug — explicit ids validated, collisions rejected', async () => {
    resetState();
    assert.equal(slugifyJurisdictionId('bell hooks'), 'bell-hooks');
    assert.equal(slugifyJurisdictionId('  Éthique & Law! '), 'ethique-law');

    await JurisdictionModel.create(personaTemplate({ id: 'bell-hooks' }));
    await assert.rejects(
        () => JurisdictionModel.create(personaTemplate({ id: 'bell-hooks' })),
        /already exists/);
    await assert.rejects(
        () => JurisdictionModel.create(personaTemplate({ id: 'Bell_Hooks' })),
        /Invalid jurisdiction id/, 'uppercase/underscores rejected — house grammar');
});

test('jurisdiction: display_name and jurisdiction_type are required/validated', async () => {
    resetState();
    await assert.rejects(() => JurisdictionModel.create({ jurisdiction_type: 'codified' }),
        /display_name is required/);
    await assert.rejects(
        () => JurisdictionModel.create({ jurisdiction_type: 'religion', display_name: 'X' }),
        /Invalid jurisdiction_type/);
});

test('jurisdiction: entity_id is persona-only (§4)', async () => {
    resetState();
    await assert.rejects(
        () => JurisdictionModel.create(worldviewTemplate({ entity_id: 'entity_abc' })),
        /entity_id is persona-only/);
    // Persona entity_id must reference an existing entity.
    await assert.rejects(
        () => JurisdictionModel.create(personaTemplate({ entity_id: 'entity_missing' })),
        /Entity not found/);
});

test('jurisdiction: update patches; id and jurisdiction_type are immutable', async () => {
    resetState();
    const j = await JurisdictionModel.create(worldviewTemplate());
    const patched = await JurisdictionModel.update(j.id, {
        display_name: 'Christianity (three strands)',
        corpus_provenance: { curated_by: 'maintainer', selection_basis: 'texts the article itself cites' }
    });
    assert.equal(patched.display_name, 'Christianity (three strands)');
    assert.equal(patched.corpus_provenance.curated_by, 'maintainer');
    assert.equal(patched.corpus_provenance.candidate_pool, null);

    await assert.rejects(() => JurisdictionModel.update(j.id, { jurisdiction_type: 'persona' }),
        /immutable/);
    await assert.rejects(() => JurisdictionModel.update('nope', { display_name: 'x' }),
        /Jurisdiction not found/);
});

test('jurisdiction: delete removes; addAuthority/removeAuthority round-trip, idempotent', async () => {
    resetState();
    const j = await JurisdictionModel.create(codifiedTemplate());
    const auth = await JurisdictionModel.addAuthority(j.id, {
        citation: { work: 'Code of Federal Regulations', edition: '2024', locator: '29 C.F.R. § 1604.11' },
        excerpt: 'Harassment on the basis of sex is a violation…',
        admissibility: 'published-regulation'
    });
    assert.match(auth.authority_id, /^auth_[0-9a-f]{16}$/);
    const again = await JurisdictionModel.addAuthority(j.id, {
        citation: { work: 'Code of Federal Regulations', edition: '2024', locator: '29 C.F.R. § 1604.11' },
        excerpt: 'Harassment on the basis of sex is a violation…',
        admissibility: 'published-regulation'
    });
    assert.equal(again.authority_id, auth.authority_id, 'idempotent on the derived id');
    assert.equal((await JurisdictionModel.get(j.id)).corpus.length, 2);

    assert.equal(await JurisdictionModel.removeAuthority(j.id, auth.authority_id), true);
    assert.equal(await JurisdictionModel.removeAuthority(j.id, auth.authority_id), false);
    assert.equal(await JurisdictionModel.delete(j.id), true);
    assert.equal(await JurisdictionModel.get(j.id), null);
});

// --- Authority validation (§10 quoting discipline) ------------------------------

test('authority: excerpt is required, capped at 500, never silently truncated (§10)', async () => {
    resetState();
    const base = codifiedTemplate({ corpus: [] });
    const j = await JurisdictionModel.create(base);

    await assert.rejects(() => JurisdictionModel.addAuthority(j.id, {
        citation: { work: 'USC', locator: '§1' }, admissibility: 'published-statute'
    }), /excerpt is required/);

    // Exactly the cap passes through untouched.
    const atCap = await JurisdictionModel.addAuthority(j.id, {
        citation: { work: 'USC', locator: '§1' },
        excerpt: 'a'.repeat(AUTHORITY_EXCERPT_CAP),
        admissibility: 'published-statute'
    });
    assert.equal(atCap.excerpt.length, 500);

    await assert.rejects(() => JurisdictionModel.addAuthority(j.id, {
        citation: { work: 'USC', locator: '§2' },
        excerpt: 'a'.repeat(AUTHORITY_EXCERPT_CAP + 1),
        admissibility: 'published-statute'
    }), /exceeds 500 characters.*never silently truncated/s);
});

test('authority: citation work+locator and a valid admissibility are required (§9 Q1)', async () => {
    resetState();
    const j = await JurisdictionModel.create(codifiedTemplate({ corpus: [] }));
    await assert.rejects(() => JurisdictionModel.addAuthority(j.id, {
        citation: { locator: '§1' }, excerpt: 'x', admissibility: 'published-statute'
    }), /citation\.work is required/);
    await assert.rejects(() => JurisdictionModel.addAuthority(j.id, {
        citation: { work: 'USC' }, excerpt: 'x', admissibility: 'published-statute'
    }), /citation\.locator is required/);
    await assert.rejects(() => JurisdictionModel.addAuthority(j.id, {
        citation: { work: 'USC', locator: '§1' }, excerpt: 'x', admissibility: 'blog-post'
    }), /Invalid admissibility/);
});

test('authority: claim_id is the web-only specialization — must reference an existing claim', async () => {
    resetState();
    const j = await JurisdictionModel.create(worldviewTemplate({ corpus: [] }));
    await assert.rejects(() => JurisdictionModel.addAuthority(j.id, {
        citation: { work: 'Some article', locator: '¶ 2' },
        excerpt: 'x', admissibility: 'published-article', claim_id: 'claim_missing'
    }), /Claim not found/);

    const claim = await ClaimModel.create({
        text: 'The tradition holds servanthood above rank.',
        source_url: 'https://example.com/essay'
    });
    const auth = await JurisdictionModel.addAuthority(j.id, {
        citation: { work: 'Some article', locator: '¶ 2' },
        excerpt: 'x', admissibility: 'published-article', claim_id: claim.id
    });
    assert.equal(auth.claim_id, claim.id);

    // anchor without claim_id is rejected — it IS the capture specialization.
    await assert.rejects(() => JurisdictionModel.addAuthority(j.id, {
        citation: { work: 'Another', locator: '¶ 3' },
        excerpt: 'y', admissibility: 'published-article', anchor: []
    }), /anchor requires claim_id/);
});

// --- Living-person guardrail (§9 Q1 — fail closed) ------------------------------

test('guardrail: treatAsLiving fails closed on absent/unknown living bit', async () => {
    resetState();
    const unknown = await JurisdictionModel.create(personaTemplate({
        id: 'unknown-bit', is_living_person: undefined
    }));
    assert.equal(unknown.is_living_person, null, 'unknown stored as null');
    assert.equal(treatAsLiving(unknown), true, 'absent/unknown ⇒ treated as living');

    const living = await JurisdictionModel.create(livingPersonaTemplate({ id: 'living' }));
    assert.equal(treatAsLiving(living), true);

    const deceased = await JurisdictionModel.create(personaTemplate({ id: 'deceased' }));
    assert.equal(treatAsLiving(deceased), false, 'explicit false is the only non-living persona');

    const worldview = await JurisdictionModel.create(worldviewTemplate());
    assert.equal(treatAsLiving(worldview), false, 'the guardrail never applies to non-personas');
});

test('guardrail: admissibleAuthorities filters social captures for living personas only', async () => {
    resetState();
    const social = {
        citation: { work: 'x.com post', locator: 'status/123' },
        excerpt: 'a tweet', admissibility: 'social-capture'
    };
    const living = await JurisdictionModel.create(livingPersonaTemplate({
        id: 'living-mixed',
        corpus: [livingPersonaTemplate().corpus[0], social]
    }));
    const admissible = admissibleAuthorities(living);
    assert.equal(admissible.length, 1, 'social capture excluded for the living persona');
    assert.equal(admissible[0].admissibility, 'published-essay');

    const deceased = await JurisdictionModel.create(personaTemplate({
        id: 'deceased-mixed',
        corpus: [personaTemplate().corpus[0], social]
    }));
    assert.equal(admissibleAuthorities(deceased).length, 2,
        'everything is admissible once is_living_person is explicitly false');
});

test('authority ids are deterministic (idempotent authoring)', async () => {
    const a = await generateAuthorityId({ work: 'W', edition: 'E', locator: 'L' }, 'text');
    const b = await generateAuthorityId({ work: 'W', edition: 'E', locator: 'L' }, 'text');
    const c = await generateAuthorityId({ work: 'W', edition: 'E', locator: 'L' }, 'other text');
    assert.equal(a, b);
    assert.notEqual(a, c);
    assert.match(a, /^auth_[0-9a-f]{16}$/);
});
