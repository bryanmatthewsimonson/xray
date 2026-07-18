// Corpus-brief publishing — Phase 23.2. The readable 30023 article and
// the structured kind-30068 CaseBrief, both prose/data only (the
// Phase-20 no-fused-score firewall must survive publication). Pure — no
// chrome, no DOM.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
    CASE_BRIEF_KIND, CASE_BRIEF_MARKER, caseBriefDTag,
    renderCaseBriefMarkdown, buildCaseBriefArticle, buildCaseBriefEvent, parseCaseBriefEvent
} = await import('../src/shared/corpus-publish.js');

const PUB = 'ab'.repeat(32);
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

const RECORD = {
    caseId: 'entity_case1',
    promptVersion: 'corpus-v1',
    members: 2,
    grounding: { checked: 5, dropped: 1 },
    brief: {
        summary: 'Two camps disagree on the origin.',
        positions: [
            { label: 'Lab leak', core_argument: 'A research-related incident.', holders: [{ article_hash: HASH_A }] },
            { label: 'Zoonosis', core_argument: 'A natural spillover.', holders: [{ article_hash: HASH_B }] }
        ],
        cruxes: [{
            question: 'Does the genome show engineering?',
            sides: [
                { position_label: 'Lab leak', view: 'The furin site is suspicious.' },
                { position_label: 'Zoonosis', view: 'The site occurs in nature.' }
            ],
            evidence_refs: [{ article_hash: HASH_B, quote: 'No signatures of engineering were found.' }],
            what_would_resolve: 'An early-case sequence from the market.'
        }],
        load_bearing: [
            { claim_ref: null, article_hash: HASH_A, quote: 'The lab studied related coronaviruses.', why: 'Establishes capability.' }
        ],
        coverage_gaps: ['No primary lab records in the corpus.'],
        // proposals is reviewer-facing and MUST NOT publish.
        proposals: [{ kind: 'is_key', claim_id: 'c1' }]
    }
};

const MEMBER_INDEX = {
    [HASH_A]: { url: 'https://a.example/leak', title: 'The Lab-Leak Case', coord: `30023:${PUB}:aaaa1111` },
    [HASH_B]: { url: 'https://b.example/zoo', title: 'The Zoonosis Case', coord: `30023:${PUB}:bbbb2222` }
};

test('caseBriefDTag: one replaceable brief per case', () => {
    assert.equal(caseBriefDTag('entity_case1'), 'xray-brief:entity_case1');
});

test('renderCaseBriefMarkdown: prose sections, linked quotes, NO score/proposals', () => {
    const md = renderCaseBriefMarkdown(RECORD.brief,
        { caseName: 'COVID origins', scopeQuestion: 'Where did it come from?', memberCount: 2, memberIndex: MEMBER_INDEX });
    assert.ok(md.startsWith('# Case brief — COVID origins'));
    assert.ok(md.includes('## Summary'));
    assert.ok(md.includes('## Positions'));
    assert.ok(md.includes('## Cruxes of disagreement'));
    assert.ok(md.includes('## Load-bearing claims'));
    assert.ok(md.includes('## Coverage gaps'));
    // Quotes link back to their member source (kept inline — the few,
    // important citations).
    assert.ok(md.includes('[The Zoonosis Case](https://b.example/zoo)'));
    assert.ok(md.includes('> No signatures of engineering were found.'));
    // Readability: holders cite by number, not a full-title link soup.
    // first-appearance order → Lab-Leak (HASH_A) is [1], Zoonosis (HASH_B) [2].
    assert.ok(md.includes('*Held by:* [1]'), 'lab-leak holders cite by number');
    assert.ok(md.includes('*Held by:* [2]'), 'zoonosis holders cite by number');
    assert.ok(!md.includes('*Held by:* [The Lab-Leak Case]'), 'no full-title holder soup');
    // Sources appendix resolves every [N] with full link text.
    assert.ok(md.includes('## Sources'), 'has a Sources list');
    assert.ok(md.includes('1. [The Lab-Leak Case](https://a.example/leak)'), 'source 1 full link');
    assert.ok(md.includes('2. [The Zoonosis Case](https://b.example/zoo)'), 'source 2 full link');
    // Firewall: no fused numeric score, no verdict/rating language, and
    // proposals never leak into the prose.
    assert.ok(!/score|verdict|\d+\s*%|\d+\s*\/\s*100/i.test(md), 'no score/verdict/percentage');
    assert.ok(!md.includes('is_key'), 'proposals excluded from the publication');
    assert.ok(/not a ruling|does not rank or rule/i.test(md), 'states it is not a ruling');
});

test('renderCaseBriefMarkdown: missing member degrades to an unlinked quote', () => {
    const md = renderCaseBriefMarkdown(RECORD.brief, { caseName: 'X', memberIndex: {} });
    assert.ok(md.includes('> No signatures of engineering were found.'));
    // The X-Ray link is always present; what's absent is any SOURCE
    // attribution line under a quote.
    assert.ok(!md.includes('> — ['), 'no quote source links when the member index is empty');
    assert.ok(!md.includes('*Held by:*'), 'no holder links either');
});

test('buildCaseBriefArticle: kind 30023, recognizer + d + member a-tags + cross-link', () => {
    const ev = buildCaseBriefArticle({ record: RECORD, caseName: 'COVID origins', memberIndex: MEMBER_INDEX, userPubkey: PUB, createdAt: 1000 });
    assert.equal(ev.kind, 30023);
    const has = (k, v) => assert.ok(ev.tags.some((t) => t[0] === k && t[1] === v), `missing ${k}=${v}`);
    has('d', 'xray-brief:entity_case1');
    has('t', CASE_BRIEF_MARKER);
    has('title', 'Case brief — COVID origins');
    // cross-link to the structured sibling by coordinate (no id chicken-egg).
    has('a', `${CASE_BRIEF_KIND}:${PUB}:xray-brief:entity_case1`);
    // member coordinate refs + content-hash refs.
    assert.ok(ev.tags.some((t) => t[0] === 'a' && t[1] === `30023:${PUB}:aaaa1111` && t[3] === 'member'));
    has('x', HASH_A); has('x', HASH_B);
    // the body is the readable markdown.
    assert.ok(ev.content.includes('## Cruxes of disagreement'));
});

test('buildCaseBriefEvent: kind 30068, structured payload, grounded disclosure, NO score field', () => {
    const ev = buildCaseBriefEvent({ record: RECORD, caseName: 'COVID origins', scopeQuestion: 'Origin?', memberIndex: MEMBER_INDEX, userPubkey: PUB, createdAt: 1000 });
    assert.equal(ev.kind, CASE_BRIEF_KIND);
    const payload = JSON.parse(ev.content);
    assert.equal(payload.summary, 'Two camps disagree on the origin.');
    assert.equal(payload.positions.length, 2);
    assert.equal(payload.cruxes.length, 1);
    assert.ok(!('proposals' in payload), 'proposals never publish');
    // Firewall: no score/verdict/rating anywhere in the structured event.
    assert.ok(!/"(score|verdict|rating|confidence)"/i.test(ev.content), 'no score-like field');
    const has = (k, v) => assert.ok(ev.tags.some((t) => t[0] === k && t[1] === v), `missing ${k}=${v}`);
    has('d', 'xray-brief:entity_case1');
    has('prompt_version', 'corpus-v1');
    has('grounded', '5:1');
    has('a', `30023:${PUB}:xray-brief:entity_case1`);   // cross-link to the readable article
});

test('parseCaseBriefEvent: round-trips the structured event', () => {
    const ev = buildCaseBriefEvent({ record: RECORD, caseName: 'COVID origins', scopeQuestion: 'Origin?', memberIndex: MEMBER_INDEX, userPubkey: PUB, createdAt: 1000 });
    const back = parseCaseBriefEvent(ev);
    assert.equal(back.caseId, 'entity_case1');
    assert.equal(back.caseName, 'COVID origins');
    assert.equal(back.scopeQuestion, 'Origin?');
    assert.equal(back.promptVersion, 'corpus-v1');
    assert.equal(back.brief.summary, 'Two camps disagree on the origin.');
    assert.equal(back.brief.load_bearing.length, 1);
    assert.deepEqual(back.grounding, { checked: 5, dropped: 1 });
    assert.deepEqual(back.memberHashes, [HASH_A, HASH_B]);
    assert.equal(back.members.length, 2, 'member coordinate refs recovered');
    // a non-30068 event is rejected.
    assert.equal(parseCaseBriefEvent({ kind: 30023, content: '{}', tags: [] }), null);
});
