// Entity-page publishing — EP.4 (docs/ENTITY_PAGE_KICKOFF.md). Pins:
// the wire artifact is ONE replaceable kind-30023 (no new wire kind —
// the 30067 lesson), its d-tag is stable per subject (wiki-revision
// semantics), `a`-refs cite only PUBLISHED claims with resolvable
// coordinates, member hashes ride as `x` tags, and the rendered
// markdown carries no judgment vocabulary.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
    ENTITY_PAGE_MARKER, entityPageDTag, renderEntityPageMarkdown, buildEntityPageArticle
} = await import('../src/shared/entity-page-publish.js');

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const USER_PK = 'c'.repeat(64);
const SUBJ_PK = 'd'.repeat(64);
const ENTITY = { id: 'entity_' + '1'.repeat(16), name: 'W.H.O.' };

function fixtureRecord() {
    return {
        entityId: ENTITY.id,
        page: {
            lead: 'The corpus presents the W.H.O. as the central agency in the dispute.',
            sections: [
                { heading: 'Early response', body: 'According to the Times, the agency moved slowly.',
                  citations: [{ article_hash: HASH_A, quote: 'the agency moved slowly in January' }], uncited: false },
                { heading: 'Unanchored context', body: 'Background summary.', citations: [], uncited: true }
            ],
            key_claim_ids: ['claim_1', 'claim_2', 'claim_3'],
            disputes: [{ topic: 'Timeline', sides: [
                { view: 'Slow', article_hash: HASH_A, quote: 'moved slowly' },
                { view: 'Fast', article_hash: HASH_B, quote: 'acted within days' }
            ] }],
            gaps: ['Nothing on funding sources.']
        },
        grounding: { checked: 3, dropped: 1 },
        model: 'claude-test', promptVersion: 'entity-page-v1',
        inputHash: 'f'.repeat(64), members: 2, analyzed: 2, createdAt: 1751500000
    };
}

const KEY_CLAIMS = [
    { id: 'claim_1', text: 'Founded in 1948.', quote: 'founded in 1948', source_url: 'https://who-times.test/a',
      publishedEventId: 'evt1', publishedPubkey: SUBJ_PK },
    { id: 'claim_2', text: 'HQ in Geneva.', quote: 'headquartered in Geneva', source_url: 'https://x.test/b',
      publishedEventId: 'evt2', publishedPubkey: null },
    { id: 'claim_3', text: 'Unpublished claim.', quote: null, source_url: null,
      publishedEventId: null, publishedPubkey: null }
];

test('dTag + marker: stable per subject — republish REPLACES (wiki-revision semantics)', () => {
    assert.equal(entityPageDTag(ENTITY.id), `xray-entity-page:${ENTITY.id}`);
    assert.equal(entityPageDTag(ENTITY.id), entityPageDTag(ENTITY.id));
    assert.equal(ENTITY_PAGE_MARKER, 'xray-entity-page');
});

test('markdown: deterministic; carries lead, key facts with quotes, sections, disputes, gaps, provenance', () => {
    const record = fixtureRecord();
    const md = renderEntityPageMarkdown(record, { entityName: 'W.H.O.', keyClaims: KEY_CLAIMS.slice(0, 2), generatedAt: 1751500000 });
    assert.equal(md, renderEntityPageMarkdown(record, { entityName: 'W.H.O.', keyClaims: KEY_CLAIMS.slice(0, 2), generatedAt: 1751500000 }),
        'same inputs ⇒ same body');
    assert.match(md, /^# W\.H\.O\./);
    assert.match(md, /## Key facts/);
    assert.match(md, /- Founded in 1948\. — who-times\.test/);
    assert.match(md, /“founded in 1948”/, 'the quote IS the verification, rendered');
    assert.match(md, /## Early response/);
    assert.match(md, /“the agency moved slowly in January”/);
    assert.match(md, /No verbatim citation survived grounding/, 'uncited sections disclose themselves');
    assert.match(md, /## Where sources disagree/);
    assert.match(md, /### Timeline/);
    assert.match(md, /## What this corpus does not establish/);
    assert.match(md, /this page adjudicates nothing/, 'the provenance footer carries the posture');
    assert.match(md, /2 captured sources; 3 quotes machine-checked, 1 dropped/);
});

test('markdown: no judgment vocabulary — the §3.5 wire posture', () => {
    const md = renderEntityPageMarkdown(fixtureRecord(), { entityName: 'W.H.O.', keyClaims: KEY_CLAIMS });
    for (const banned of ['verdict', 'credibility', 'trustworth', 'liar', 'probability']) {
        assert.ok(!md.toLowerCase().includes(banned), `"${banned}" must not appear`);
    }
});

test('article: replaceable 30023 — d/title/t/p tags; USER-signed shape (no pubkey set here)', () => {
    const ev = buildEntityPageArticle({
        record: fixtureRecord(), entity: ENTITY, entityPubkey: SUBJ_PK,
        keyClaims: KEY_CLAIMS, userPubkey: USER_PK, createdAt: 1751600000
    });
    assert.equal(ev.kind, 30023, 'ONE ordinary article kind — no new wire kind');
    assert.equal(ev.created_at, 1751600000);
    const tag = (k) => (ev.tags.find((t) => t[0] === k) || [])[1];
    assert.equal(tag('d'), entityPageDTag(ENTITY.id));
    assert.equal(tag('title'), 'W.H.O. — entity page');
    assert.equal(tag('t'), ENTITY_PAGE_MARKER);
    assert.deepEqual(ev.tags.find((t) => t[0] === 'p'), ['p', SUBJ_PK, '', 'subject']);
    assert.ok(!('pubkey' in ev), 'the caller signs — custody stays with the USER identity');
});

test('article: a-refs cite only PUBLISHED claims with resolvable coordinates; x tags carry cited member hashes', () => {
    const ev = buildEntityPageArticle({
        record: fixtureRecord(), entity: ENTITY, entityPubkey: SUBJ_PK,
        keyClaims: KEY_CLAIMS, userPubkey: USER_PK, createdAt: 1
    });
    const aRefs = ev.tags.filter((t) => t[0] === 'a' && t[3] === 'key-fact').map((t) => t[1]);
    assert.deepEqual(aRefs.sort(), [
        `30040:${USER_PK}:claim_2`,          // no publishedPubkey → the caller's key is the coordinate
        `30040:${SUBJ_PK}:claim_1`
    ].sort());
    assert.ok(!aRefs.some((a) => a.includes('claim_3')), 'an unpublished claim gets NO coordinate');
    const xTags = ev.tags.filter((t) => t[0] === 'x').map((t) => t[1]);
    assert.deepEqual(xTags.sort(), [HASH_A, HASH_B].sort(), 'section + grounded dispute hashes, deduped');
});

test('article: a claim published with no resolvable pubkey anywhere is omitted, never a broken coordinate', () => {
    const ev = buildEntityPageArticle({
        record: fixtureRecord(), entity: ENTITY,
        keyClaims: [{ id: 'claim_x', text: 'T', publishedEventId: 'evt', publishedPubkey: null }],
        userPubkey: null, createdAt: 1
    });
    assert.equal(ev.tags.filter((t) => t[0] === 'a').length, 0);
    assert.equal(ev.tags.filter((t) => t[0] === 'p').length, 0, 'no subject p-tag without a pubkey');
});

test('article: record.page required — a pageless record throws instead of publishing emptiness', () => {
    assert.throws(() => buildEntityPageArticle({ record: {}, entity: ENTITY }), /record\.page/);
    assert.throws(() => buildEntityPageArticle({ record: fixtureRecord(), entity: null }), /entity/);
});
