// The One Article Pass — UA.1 (docs/UNIFIED_ARTICLE_PASS_KICKOFF.md).
//
// The load-bearing pin here is IDENTITY, same as auto-preanalyze's: the
// reader's Suggest-time extract must produce a map request — and
// therefore a corpus-extracts cache key — byte-identical to what a
// case-bound Analyze run later computes for the same archived capture
// (the one-request-builder rule, now structural via articleMemberUnit).
// A one-character drift silently orphans every Suggest-paid extract and
// the pay-once economics quietly become pay-twice.
//
// The second pin is GUARD RAIL 6: nothing the article pass produces
// carries is_key — article-relative keyness is `load_bearing`, display
// only; and GUARD RAIL 4: the durable layer's atom contract gains no
// field from the v8 extract (text already existed; load_bearing stays
// off the record).

import { test } from 'node:test';
import assert from 'node:assert/strict';

// case-dossier pulls the model modules, which read chrome.storage at
// module load — stub before importing (the standard LLM-test idiom).
globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

const {
    ensureArticleExtract, claimProposalsFromExtract, claimIndexForSuggest, mergeSuggestProposals
} = await import('../src/shared/article-pass.js');
const { buildMemberUnits, corpusMapRequest, corpusExtractKey, articleMemberUnit } =
    await import('../src/shared/case-synthesis.js');
const { mergeExtractIntoRecord } = await import('../src/shared/map-artifacts.js');

// ---- fixture ---------------------------------------------------------------

const URL_A = 'https://ex.com/a';
const CASE = 'entity_case';

// The SAME article object on both sides: the archive row stores it, the
// reader passes it (hashableArticle) — assembleArticleBody sees one
// input either way.
const ARTICLE = { title: 'A title', content: 'Body A text with enough words.', entities: [{ entity_id: CASE }] };

function fixtureData() {
    return {
        case: { id: CASE, name: 'Egg case' },
        membership_ids: [CASE],
        orbit: { claims: [] },
        wire: { articles: [] },
        claimsById: {},
        entitiesById: { [CASE]: { id: CASE, name: 'Egg case', type: 'case' } },
        articles: [{ url: URL_A, articleHash: 'a'.repeat(64), article: ARTICLE }]
    };
}

const V8_EXTRACT = {
    position: { summary: 'what A argues', side_label: null },
    key_assertions: [
        { quote: 'Body A text', text: 'A makes a body claim.', load_bearing: true, why_load_bearing: 'it carries the position' },
        { quote: 'enough words', text: 'A has enough words.', load_bearing: false }
    ]
};

function io(overrides = {}) {
    return {
        getExtract: async () => null,
        saveExtract: async () => {},
        record: async () => ({ status: 'unchanged' }),
        now: () => 1234,
        ...overrides
    };
}

// ---- THE identity pin ------------------------------------------------------

test('the Suggest-time request and cache key are BYTE-IDENTICAL to the Analyze path\'s', async () => {
    // The Analyze side, exactly as synthesis-block computes it.
    const units = await buildMemberUnits(fixtureData());
    const unit = units.find((u) => u.url === URL_A);
    assert.ok(unit, 'fixture sanity: the member unit exists');
    const analyzeReq = corpusMapRequest(unit);
    const analyzeKey = await corpusExtractKey(analyzeReq);

    // The reader side: the same article object, hash, url, title.
    let sentReq = null, saved = null;
    const out = await ensureArticleExtract(
        { article: ARTICLE, articleHash: 'a'.repeat(64), url: URL_A, title: 'A title',
          sendMessage: async (msg) => {
              assert.equal(msg.type, 'xray:llm:corpus-map');
              sentReq = msg.request;
              return { ok: true, extract: V8_EXTRACT, model: 'test-model' };
          } },
        io({ saveExtract: async (rec) => { saved = rec; } }));

    assert.equal(out.status, 'ran');
    assert.equal(JSON.stringify(sentReq), JSON.stringify(analyzeReq),
        'the wire request must be byte-identical — articleMemberUnit is the ONE unit builder');
    assert.equal(saved.key, analyzeKey,
        'the Suggest-paid extract lands under exactly the key Analyze will look up');
    assert.equal(out.key, analyzeKey);
});

test('articleMemberUnit truncates to the map bound and discloses it', async () => {
    const { MAX_MEMBER_INPUT_CHARS } = await import('../src/shared/corpus-prompts.js');
    const long = { title: 'L', content: 'x'.repeat(MAX_MEMBER_INPUT_CHARS + 5000) };
    const unit = articleMemberUnit({ article: long, articleHash: 'h', url: 'https://x', title: 'L' });
    assert.equal(unit.text.length, MAX_MEMBER_INPUT_CHARS);
    assert.equal(unit.truncated, true);
    assert.ok(unit.total_chars > MAX_MEMBER_INPUT_CHARS);
    assert.deepEqual(unit.claims, [], 'claims never ride the unit at build time');
});

// ---- ensureArticleExtract flow ---------------------------------------------

test('cache hit → no call, no save; the hit still folds into the durable record', async () => {
    let sent = 0, folded = null, savedCount = 0;
    const out = await ensureArticleExtract(
        { article: ARTICLE, articleHash: 'a'.repeat(64), url: URL_A, title: 'A title',
          frame: { caseName: 'Egg case', scopeQuestion: 'Q?' },
          sendMessage: async () => { sent++; return { ok: true }; } },
        io({ getExtract: async () => ({ extract: V8_EXTRACT, model: 'cached-model' }),
             saveExtract: async () => { savedCount++; },
             record: async (opts) => { folded = opts; return { status: 'unchanged' }; } }));
    assert.equal(out.status, 'cached');
    assert.equal(sent, 0, 'a valid cached extract costs zero calls');
    assert.equal(savedCount, 0);
    assert.deepEqual(out.extract, V8_EXTRACT);
    assert.equal(out.model, 'cached-model');
    assert.equal(folded.frame.caseName, 'Egg case', 'the frame rides fold provenance only');
});

test('an INVALID cached extract does not count as a hit — the pass re-runs', async () => {
    let sent = 0;
    const out = await ensureArticleExtract(
        { article: ARTICLE, articleHash: 'a'.repeat(64), url: URL_A, title: 'A title',
          sendMessage: async () => { sent++; return { ok: true, extract: V8_EXTRACT, model: 'm' }; } },
        io({ getExtract: async () => ({ extract: { no: 'position' }, model: 'stale' }) }));
    assert.equal(out.status, 'ran');
    assert.equal(sent, 1);
});

test('a failed or invalid live call reports "failed" and saves nothing', async () => {
    let savedCount = 0;
    const failed = await ensureArticleExtract(
        { article: ARTICLE, articleHash: 'a'.repeat(64), url: URL_A, title: 'A title',
          sendMessage: async () => ({ ok: false, error: 'rate limit' }) },
        io({ saveExtract: async () => { savedCount++; } }));
    assert.equal(failed.status, 'failed');
    assert.equal(failed.error, 'rate limit');
    const invalid = await ensureArticleExtract(
        { article: ARTICLE, articleHash: 'a'.repeat(64), url: URL_A, title: 'A title',
          sendMessage: async () => ({ ok: true, extract: { not: 'an extract' } }) },
        io({ saveExtract: async () => { savedCount++; } }));
    assert.equal(invalid.status, 'failed');
    assert.equal(savedCount, 0);
});

test('no articleHash (edited body) → the extract still runs, the fold is skipped', async () => {
    let folded = 0;
    const out = await ensureArticleExtract(
        { article: ARTICLE, articleHash: null, url: URL_A, title: 'A title',
          sendMessage: async () => ({ ok: true, extract: V8_EXTRACT, model: 'm' }) },
        io({ record: async () => { folded++; return { status: 'saved' }; } }));
    assert.equal(out.status, 'ran');
    assert.equal(folded, 0, 'a record keyed by a hash that no longer describes this text must not fold');
});

// ---- guard rail 6: extract → proposals, is_key-free ------------------------

test('claimProposalsFromExtract: modal-shaped rows, load_bearing display, NEVER is_key', () => {
    const rows = claimProposalsFromExtract(V8_EXTRACT);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((r) => r.ref), ['C1', 'C2']);
    assert.equal(rows[0].kind, 'claim');
    assert.equal(rows[0].text, 'A makes a body claim.');
    assert.equal(rows[0].load_bearing, true);
    assert.equal(rows[0].why_load_bearing, 'it carries the position');
    assert.equal(rows[1].load_bearing, false);
    assert.equal(rows[0].from_extract, true, 'marked so the MA.4 suggest fold skips them');
    for (const r of rows) {
        assert.ok(!('is_key' in r), 'GUARD RAIL 6: the article pass never writes is_key');
    }
});

test('claimProposalsFromExtract: text falls back to the quote; empty quotes drop; refs stay dense', () => {
    const rows = claimProposalsFromExtract({ key_assertions: [
        { quote: 'has a quote' },            // no text → quote is the text
        { quote: '   ' },                    // unquotable → dropped
        { text: 'no quote at all' },         // no quote → dropped
        { quote: 'second good', text: 't2' }
    ] });
    assert.equal(rows.length, 2);
    assert.equal(rows[0].text, 'has a quote');
    assert.deepEqual(rows.map((r) => r.ref), ['C1', 'C2'], 'refs number the kept rows');
});

// ---- the slim call's index + the merge -------------------------------------

test('claimIndexForSuggest: ref + capped text only', () => {
    const idx = claimIndexForSuggest([
        { ref: 'C1', text: 'x'.repeat(500) },
        { ref: 'C2', text: '  ' },           // empty text → excluded
        { ref: '', text: 'no ref' }          // no ref → excluded
    ]);
    assert.equal(idx.length, 1);
    assert.equal(idx[0].ref, 'C1');
    assert.equal(idx[0].text.length, 200);
    assert.deepEqual(Object.keys(idx[0]).sort(), ['ref', 'text'], 'no quotes, no flags ride the index');
});

test('mergeSuggestProposals: entity claim_refs invert onto claim about lists', () => {
    const claims = claimProposalsFromExtract(V8_EXTRACT);
    const merged = mergeSuggestProposals([
        { kind: 'entity', ref: 'E1', name: 'Alice', entity_type: 'person', claim_refs: ['C1', 'C9'] },
        { kind: 'entity', ref: 'E2', name: 'Bob', entity_type: 'person', claim_refs: ['C1', 'C2'] },
        { kind: 'entity', name: 'RefFree', entity_type: 'thing' }
    ], claims);
    assert.equal(merged.length, 5);
    const c1 = merged.find((p) => p.ref === 'C1');
    const c2 = merged.find((p) => p.ref === 'C2');
    assert.deepEqual(c1.about, ['E1', 'E2'], 'both entities concern C1; the unknown C9 is ignored');
    assert.deepEqual(c2.about, ['E2']);
    assert.deepEqual(claims[0].about ?? [], [], 'the input claim rows are not mutated');
});

// ---- guard rail 4: the layer's atom contract is unchanged ------------------

test('GUARD (UA.1 rail 4): a v8 fold stores text + why on atoms but NO load_bearing field', () => {
    const member = { article_hash: 'a'.repeat(64), url: URL_A, title: 'A title',
        text: 'Body A text with enough words.' };
    const { record } = mergeExtractIntoRecord(null, {
        member, extract: V8_EXTRACT, key: 'k1', model: 'm', now: 1234
    });
    assert.equal(record.assertions.length, 2);
    const flagged = record.assertions.find((a) => a.quote === 'Body A text');
    assert.equal(flagged.text, 'A makes a body claim.', 'the paraphrase rides the MA.4 text field');
    assert.equal(flagged.why, 'it carries the position');
    for (const a of record.assertions) {
        assert.ok(!('load_bearing' in a),
            'the article-extractions atom contract gains no field — load_bearing stays on the extract');
        assert.ok(!('is_key' in a));
    }
});
