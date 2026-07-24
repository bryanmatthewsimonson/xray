// Entity pages — EP.1/EP.2 (docs/ENTITY_PAGE_KICKOFF.md). The pins
// here enforce the kickoff §3 guard rails structurally: no typed
// fields or numeric slots in the tool (the retired fact layer must
// not sneak back through the page), no minted key-claim ids, grounded
// citations or dropped-and-disclosed, the corpus-v4 one-request-
// builder rule in ensureExtracts (cache keys byte-identical to the
// Analyze/Pre-analyze path's), and order-insensitive staleness.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// entity-page pulls case-synthesis → entity-model transitively, which
// reads chrome.storage at module load — stub first (the LLM-test idiom).
globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

const EP = await import('../src/shared/entity-page.js');
const { corpusMapRequest, corpusExtractKey } = await import('../src/shared/case-synthesis.js');
const { createGroundingIndex } = await import('../src/shared/quote-grounding.js');

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

// ---- guard rails on the tool schema (kickoff §3.1/§3.3) --------------------

test('page tool: no typed-field or numeric slots — the fact layer cannot return here', () => {
    const tool = EP.buildEntityPageTool();
    const json = JSON.stringify(tool.input_schema);
    for (const banned of ['"field"', 'valid_from', 'valid_to', 'observed_at', 'value_ref',
                          '"enum"', '"integer"', '"number"', 'score', 'probability', 'verdict']) {
        assert.ok(!json.includes(banned), `schema must not carry ${banned}`);
    }
    assert.equal(tool.name, EP.ENTITY_PAGE_TOOL_NAME);
    assert.deepEqual(tool.input_schema.required, ['lead']);
});

test('page prompt: model knowledge banned, verdicts banned, disagreement side-by-side', () => {
    const p = EP.buildEntityPageSystemPrompt({
        entityName: 'W.H.O.', entityType: 'organization',
        caseName: 'Egg case', scopeQuestion: 'Do eggs raise CVD risk?'
    });
    assert.match(p, /"W\.H\.O\."/);
    assert.match(p, /NO OUTSIDE KNOWLEDGE/);
    assert.match(p, /NEVER output a verdict, score, probability/);
    assert.match(p, /side by side, never resolved/);
    assert.match(p, /Existing ids only/, 'key_claim_ids selection rule stated');
    assert.match(p, /The PAGE is about the subject, not the case/);
    // Frame-free variant carries no case lines.
    const bare = EP.buildEntityPageSystemPrompt({ entityName: 'X' });
    assert.ok(!/case "/.test(bare));
});

// ---- digest ----------------------------------------------------------------

function fixtureDossier() {
    return {
        subject: { id: 'entity_' + '1'.repeat(16), name: 'W.H.O.', type: 'organization', description: 'Agency.' },
        coverage: { claims: 3, articles: 2, unprocessed_sources: 0 },
        identity: { family: [
            { id: 'e1', name: 'W.H.O.', relation: 'self' },
            { id: 'e2', name: 'World Health Organization', relation: 'alias' }
        ] },
        judgments: {
            assessments: { total: 2, by_stance: { '1': 1, '-1': 1 } },
            verdicts: [{ proposition_id: 'p1' }],
            integrity_findings: [],
            forensic: []
        },
        relationships: { co_tagged: [{ entity_id: 'entity_' + '9'.repeat(16), shared_claims: 4, shared_articles: 2 }] }
    };
}

const claim = (id, extra = {}) => ({
    id, text: `Claim ${id}`, quote: `quoted ${id}`, article_hash: extra.hash || HASH_A,
    is_key: !!extra.is_key, created: extra.created || 100
});

test('digest: deterministic, capped, key-first, distributions-only — and no banned vocabulary', () => {
    const d = fixtureDossier();
    const claims = [claim('claim_b', { created: 200 }), claim('claim_a', { is_key: true, created: 300 })];
    const digest = EP.digestEntityDossier(d, { claims, namesById: { ['entity_' + '9'.repeat(16)]: 'Acme Corp' } });
    assert.equal(digest, EP.digestEntityDossier(d, { claims, namesById: { ['entity_' + '9'.repeat(16)]: 'Acme Corp' } }),
        'same inputs ⇒ same string');
    const parsed = JSON.parse(digest);
    assert.equal(parsed.subject.name, 'W.H.O.');
    assert.deepEqual(parsed.subject.aliases, ['World Health Organization']);
    assert.equal(parsed.claims[0].id, 'claim_a', 'key claims lead the index');
    assert.equal(parsed.articles.A1, HASH_A, 'art keys map back to full hashes');
    assert.deepEqual(parsed.judgments, {
        assessments_by_stance: { '1': 1, '-1': 1 },
        verdicts: 1, integrity_findings: 0, forensic_findings: 0
    }, 'distributions and counts only');
    assert.equal(parsed.co_tagged[0].name, 'Acme Corp');
    for (const banned of ['"score"', 'credibility', 'birth_date', '"field"']) {
        assert.ok(!digest.includes(banned), `digest must not carry ${banned}`);
    }
    // The cap holds.
    const many = Array.from({ length: EP.PAGE_DIGEST_CLAIM_CAP + 30 }, (_, i) => claim(`claim_${i}`, { created: i }));
    assert.equal(JSON.parse(EP.digestEntityDossier(d, { claims: many })).claims.length, EP.PAGE_DIGEST_CLAIM_CAP);
});

// ---- validation + the no-minting filter ------------------------------------

test('validateEntityPage: lead required; malformed sections/citations rejected', () => {
    assert.equal(EP.validateEntityPage({ lead: 'About the WHO.' }).ok, true);
    assert.equal(EP.validateEntityPage({}).ok, false, 'lead required');
    assert.equal(EP.validateEntityPage({
        lead: 'x', sections: [{ heading: 'History', body: 'Text.', citations: [{ article_hash: HASH_A, quote: 'q' }] }],
        key_claim_ids: ['claim_1'], disputes: [{ topic: 'T', sides: [{ view: 'V' }] }], gaps: ['g']
    }).ok, true);
    assert.equal(EP.validateEntityPage({ lead: 'x', sections: [{ heading: 'H' }] }).ok, false, 'section body required');
    assert.equal(EP.validateEntityPage({ lead: 'x', sections: [{ heading: 'H', body: 'B', citations: [{ quote: 'q' }] }] }).ok,
        false, 'citation needs its member hash');
});

test('filterKeyClaimIds: hallucinated ids can never reach the key-facts box', () => {
    const page = { lead: 'x', key_claim_ids: ['claim_real', 'claim_fake', 'claim_real2'] };
    const filtered = EP.filterKeyClaimIds(page, new Set(['claim_real', 'claim_real2']));
    assert.deepEqual(filtered.key_claim_ids, ['claim_real', 'claim_real2']);
    assert.deepEqual(EP.filterKeyClaimIds({ lead: 'x' }, []).key_claim_ids, [], 'absent → empty, never undefined');
});

// ---- grounding --------------------------------------------------------------

test('groundEntityPage: citations locate-or-drop, disclosed; a citation-less section is flagged uncited', () => {
    const textA = 'The agency was criticized for its early response. Officials defended the timeline.';
    const indexByMember = { [HASH_A]: createGroundingIndex(textA) };
    const page = {
        lead: 'About.',
        sections: [
            { heading: 'Criticism', body: 'B1', citations: [
                { article_hash: HASH_A, quote: 'criticized for its early response' },
                { article_hash: HASH_A, quote: 'this quote appears nowhere' },
                { article_hash: HASH_B, quote: 'unknown member' }
            ] },
            { heading: 'Unanchored', body: 'B2', citations: [] }
        ],
        disputes: [{ topic: 'Timeline', sides: [
            { view: 'Defended', article_hash: HASH_A, quote: 'Officials defended the timeline.' },
            { view: 'Attacked', article_hash: HASH_A, quote: 'never said' },
            { view: 'No anchor offered' }
        ] }]
    };
    const { page: grounded, grounding } = EP.groundEntityPage(page, indexByMember);
    assert.equal(grounding.checked, 5);
    assert.equal(grounding.dropped, 3);
    assert.equal(grounded.sections[0].citations.length, 1, 'unlocatable + unknown-member citations dropped');
    assert.equal(grounded.sections[0].uncited, false);
    assert.equal(grounded.sections[1].uncited, true, 'a section with no surviving citations is flagged, kept');
    assert.equal(grounded.disputes[0].sides[0].quote, 'Officials defended the timeline.');
    assert.equal(grounded.disputes[0].sides[1].quote, null, 'ungrounded side keeps its view, loses its anchor');
    assert.equal(grounded.disputes[0].sides[2].quote, null);
});

// ---- staleness --------------------------------------------------------------

test('entityPageInputHash: order-insensitive; member/claim/version changes each flip it', async () => {
    const members = [{ article_hash: HASH_A }, { article_hash: HASH_B }];
    const h1 = await EP.entityPageInputHash(members, ['c1', 'c2']);
    const h1rev = await EP.entityPageInputHash([...members].reverse(), ['c2', 'c1']);
    assert.equal(h1, h1rev, 'order-insensitive');
    assert.notEqual(h1, await EP.entityPageInputHash([members[0]], ['c1', 'c2']), 'membership change flips it');
    assert.notEqual(h1, await EP.entityPageInputHash(members, ['c1']), 'claim change flips it');
    assert.notEqual(h1, await EP.entityPageInputHash(members, ['c1', 'c2'], 'entity-page-v2'), 'version bump flips it');
});

// ---- ensureExtracts: cache-first + the one-request-builder rule -------------

const member = (hash, text) => ({ article_hash: hash, url: `https://x.test/${hash.slice(0, 4)}`, title: `T ${hash.slice(0, 4)}`, text, claims: [] });
const VALID_EXTRACT = { position: { summary: 'position' } };

test('ensureExtracts: valid cache hits cost nothing; misses call, validate, and persist under the Analyze-identical key', async () => {
    const mA = member(HASH_A, 'Body of article A.');
    const mB = member(HASH_B, 'Body of article B.');
    const frame = { caseName: 'Egg case', scopeQuestion: 'Do eggs raise CVD risk?' };

    // The Analyze-side keys, computed exactly as synthesis-block does.
    const keyA = await corpusExtractKey(corpusMapRequest(mA, frame));
    const keyB = await corpusExtractKey(corpusMapRequest(mB, frame));

    const saved = [];
    const sentRequests = [];
    const folded = [];
    const out = await EP.ensureExtracts([mA, mB], frame, {
        sendMessage: async (msg) => {
            assert.equal(msg.type, 'xray:llm:corpus-map');
            sentRequests.push(msg.request);
            return { ok: true, extract: VALID_EXTRACT, model: 'm-test' };
        }
    }, {
        getExtract: async (key) => key === keyA ? { extract: VALID_EXTRACT, model: 'm-cached' } : null,
        saveExtract: async (rec) => { saved.push(rec); },
        record: async (r) => { folded.push(r); return { status: 'saved' }; },
        now: () => 1234
    });

    assert.equal(out.hits, 1, 'A was cached');
    assert.equal(out.calls, 1, 'only B paid');
    assert.equal(out.extracts.length, 2);
    assert.equal(out.failures.length, 0);
    assert.equal(sentRequests.length, 1);
    assert.equal(JSON.stringify(sentRequests[0]), JSON.stringify(corpusMapRequest(mB, frame)),
        'the wire request is byte-identical to the Analyze path\'s — corpusMapRequest is the ONE builder');
    assert.equal(saved.length, 1);
    assert.equal(saved[0].key, keyB, 'persisted under exactly the key Analyze will look up');
    assert.equal(saved[0].cachedAt, 1234);
    // MA.1 — BOTH members fold into their durable records: the cache
    // hit (A) backfills, the fresh call (B) records for the first time.
    assert.equal(folded.length, 2, 'the durable fold rides both the hit and the miss');
    assert.deepEqual(folded.map((f) => f.member.article_hash).sort(), [HASH_A, HASH_B].sort());
    assert.deepEqual(folded.map((f) => f.key).sort(), [keyA, keyB].sort());
});

test('ensureExtracts: an invalid cached extract re-runs; a failed member lands in failures, not extracts', async () => {
    const mA = member(HASH_A, 'Body A.');
    const mB = member(HASH_B, 'Body B.');
    let calls = 0;
    const out = await EP.ensureExtracts([mA, mB], { caseName: '', scopeQuestion: '' }, {
        sendMessage: async (msg) => {
            calls++;
            if (msg.request.member_id === HASH_B) return { ok: false, error: 'boom' };
            return { ok: true, extract: VALID_EXTRACT, model: 'm' };
        }
    }, {
        getExtract: async () => ({ extract: { not: 'valid' }, model: 'm' }),   // invalid — never a hit
        saveExtract: async () => {},
        record: async () => ({ status: 'saved' }),
        now: () => 1
    });
    assert.equal(out.hits, 0, 'invalid cache entries never count as hits');
    assert.ok(calls >= 2, 'both members called (B may retry)');
    assert.equal(out.extracts.length, 1);
    assert.equal(out.extracts[0].article_hash, HASH_A);
    assert.equal(out.failures.length, 1);
    assert.equal(out.failures[0].module, HASH_B);
});
