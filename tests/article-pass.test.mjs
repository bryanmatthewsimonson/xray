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
import { WRONG_TYPES, WRONG_ROWS, assertTotal } from './helpers/hostile.mjs';

// case-dossier pulls the model modules, which read chrome.storage at
// module load — stub before importing (the standard LLM-test idiom).
globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

const {
    ensureArticleExtract, articleSourceForExtract, claimProposalsFromExtract,
    entityProposalsFromExtract, entityYield
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

// The keepalive spans exactly the one long cold map call: a long-form
// transcript at the 400k bound can hold it for minutes with nothing else
// messaging the SW, which is the MV3 teardown that reads as bare "no
// response". It must stop on EVERY exit path — a leaked interval pings
// the service worker forever, and a rejecting call is the path most
// likely to leak.
test('keepalive: started around the live call, stopped on success, failure, AND rejection', async () => {
    const trace = [];
    const keepalive = () => { trace.push('start'); return { stop: () => trace.push('stop') }; };

    await ensureArticleExtract(
        { article: ARTICLE, articleHash: 'a'.repeat(64), url: URL_A, title: 'A title', keepalive,
          sendMessage: async () => ({ ok: true, extract: V8_EXTRACT, model: 'm' }) }, io());
    assert.deepEqual(trace, ['start', 'stop'], 'success stops it');

    trace.length = 0;
    await ensureArticleExtract(
        { article: ARTICLE, articleHash: 'a'.repeat(64), url: URL_A, title: 'A title', keepalive,
          sendMessage: async () => ({ ok: false, error: 'rate limit' }) }, io());
    assert.deepEqual(trace, ['start', 'stop'], 'a failed call stops it');

    trace.length = 0;
    const rejected = await ensureArticleExtract(
        { article: ARTICLE, articleHash: 'a'.repeat(64), url: URL_A, title: 'A title', keepalive,
          sendMessage: async () => { throw new Error('message port closed'); } }, io());
    assert.equal(rejected.status, 'failed');
    assert.deepEqual(trace, ['start', 'stop'], 'an SW teardown mid-call stops it');
});

test('keepalive: a cache hit never starts one (no call, nothing to keep alive)', async () => {
    let started = 0;
    const out = await ensureArticleExtract(
        { article: ARTICLE, articleHash: 'a'.repeat(64), url: URL_A, title: 'A title',
          keepalive: () => { started++; return { stop: () => {} }; },
          sendMessage: async () => ({ ok: true, extract: V8_EXTRACT, model: 'm' }) },
        io({ getExtract: async () => ({ extract: V8_EXTRACT, model: 'cached-model' }) }));
    assert.equal(out.status, 'cached');
    assert.equal(started, 0);
});

test('keepalive: omitting it is legal — the pass runs unchanged (injection, not a dependency)', async () => {
    const out = await ensureArticleExtract(
        { article: ARTICLE, articleHash: 'a'.repeat(64), url: URL_A, title: 'A title',
          sendMessage: async () => ({ ok: true, extract: V8_EXTRACT, model: 'm' }) }, io());
    assert.equal(out.status, 'ran');
});

// A salvaged extract is valid ONLY if the schema's required fields were
// emitted before the cut. Nothing forces the model to emit `position`
// first, so a truncated call can hand back complete atoms and no
// position — which the schema rejects. That must read as the truncation
// it is: reporting it as a shape problem ("invalid extract") sends the
// reader hunting a parser bug that does not exist, and drops the count
// of what was actually recovered.
test('a truncation that loses a required field reports TRUNCATION, not a shape error', async () => {
    const salvagedNoPosition = {
        key_assertions: [
            { quote: 'a', text: 'A.', load_bearing: true },
            { quote: 'b', text: 'B.', load_bearing: false }
        ]
    };
    const out = await ensureArticleExtract(
        { article: ARTICLE, articleHash: 'a'.repeat(64), url: URL_A, title: 'A title',
          sendMessage: async () => ({ ok: true, extract: salvagedNoPosition, model: 'm', partial: true }) },
        io());
    assert.equal(out.status, 'failed');
    assert.match(out.error, /hit its output limit/, 'named as a truncation');
    assert.match(out.error, /2 complete assertion/, 'says how much was actually recovered');
    assert.match(out.error, /\$\.position/, 'names the field the cut lost');
    assert.doesNotMatch(out.error, /^invalid extract$/);
});

test('a COMPLETE response with an unusable shape is a different message, and still names the field', async () => {
    const out = await ensureArticleExtract(
        { article: ARTICLE, articleHash: 'a'.repeat(64), url: URL_A, title: 'A title',
          sendMessage: async () => ({ ok: true, extract: { key_assertions: [] }, model: 'm' }) },
        io());
    assert.equal(out.status, 'failed');
    assert.match(out.error, /cannot use/);
    assert.match(out.error, /\$\.position/);
    assert.doesNotMatch(out.error, /output limit/, 'not blamed on truncation');
});

test('describeExtractErrors renders both error shapes, never [object Object]', async () => {
    const { describeExtractErrors } = await import('../src/shared/article-pass.js');
    const rendered = describeExtractErrors([
        { path: '$.position', message: 'required field missing' },
        '$.entities: no row carries a name and mention — malformed map output',
        { path: '$.x', message: 'ignored — capped at two' }
    ]);
    assert.match(rendered, /\$\.position required field missing/);
    assert.match(rendered, /no row carries a name and mention/);
    assert.doesNotMatch(rendered, /object Object/);
    assert.doesNotMatch(rendered, /capped at two/, 'a toast is not a log');
    assert.equal(describeExtractErrors([]), 'no reason reported');
    assert.equal(describeExtractErrors(null), 'no reason reported');
});

// The live crash: a 48-minute transcript came back with a non-array
// `entities`, and `(x || [])` rescues only FALSY values — a truthy wrong
// type sails through to .map. The tool is not strict:true, so the API
// guarantees nothing; and validateCorpusExtract does not catch it,
// because it walks a normalized COPY and discards it. Every wrong type
// the model can emit is exercised here, for both converters.
test('a wrong-typed list field never crashes a converter (the live .map TypeError)', async () => {
    const WRONG = [
        ['object',  { E1: { ref: 'E1', name: 'Jane' } }],
        ['string',  'Jane Doe, Acme Corp'],
        ['number',  7],
        ['boolean', true],
        ['null',    null],
        ['absent',  undefined]
    ];
    for (const [label, bad] of WRONG) {
        const extract = { position: { summary: 's' }, key_assertions: [], entities: bad };
        assert.doesNotThrow(() => entityProposalsFromExtract(extract), `entities as ${label}`);
        assert.doesNotThrow(() => claimProposalsFromExtract(extract), `entities as ${label} (claim side)`);
        assert.deepEqual(entityProposalsFromExtract(extract), [], `entities as ${label} yields nothing`);

        const atomsBad = { position: { summary: 's' }, key_assertions: bad, entities: [] };
        assert.doesNotThrow(() => claimProposalsFromExtract(atomsBad), `key_assertions as ${label}`);
        assert.deepEqual(claimProposalsFromExtract(atomsBad), [], `key_assertions as ${label} yields nothing`);
    }
});

test('a wrong-typed entities list does not silently drop VALID atoms', async () => {
    // The failure mode to avoid while fixing the crash: bailing out of
    // the whole converter. The atoms are independently well-formed and
    // must still become proposals — only their entity refs are lost.
    const extract = {
        position: { summary: 's' },
        key_assertions: [{ quote: 'a real span', text: 'A.', load_bearing: true, about: ['E1'] }],
        entities: { E1: { name: 'Jane' } }        // wrong type
    };
    const claims = claimProposalsFromExtract(extract);
    assert.equal(claims.length, 1, 'the atom survives');
    assert.equal(claims[0].quote, 'a real span');
    assert.deepEqual(claims[0].about, [], 'its ref drops, since no entity list could be read');
});

test('listField is the guard, and it is exported so other consumers can share it', async () => {
    const { listField } = await import('../src/shared/article-pass.js');
    assert.deepEqual(listField({ a: [1, 2] }, 'a'), [1, 2]);
    assert.deepEqual(listField({ a: { not: 'an array' } }, 'a'), []);
    assert.deepEqual(listField({ a: 'string' }, 'a'), []);
    assert.deepEqual(listField(null, 'a'), []);
    assert.deepEqual(listField(undefined, 'a'), []);
});

// "No entity suggestions" had four different causes wearing one
// silence. entityYield is what lets the reader tell them apart, so each
// cause must be distinguishable from the counts alone.
test('entityYield distinguishes every reason entities can come back empty', async () => {
    const { entityYield } = await import('../src/shared/article-pass.js');
    const core = { position: { summary: 's' }, key_assertions: [] };

    const absent = entityYield(core);
    assert.equal(absent.absent, true);
    assert.equal(absent.wrongType, false);
    assert.equal(absent.rows, 0);

    const wrong = entityYield({ ...core, entities: { E1: { name: 'Alice' } } });
    assert.equal(wrong.wrongType, true, 'the poisoned-cache failure is its own state');
    assert.equal(wrong.absent, false);
    assert.equal(wrong.rows, 0);

    const empty = entityYield({ ...core, entities: [] });
    assert.equal(empty.rows, 0);
    assert.equal(empty.absent, false, 'an empty list is a real answer, not an absent one');
    assert.equal(empty.wrongType, false);

    // The transcript-suspect case: rows arrive, every one lacks the
    // verbatim mention the converter requires.
    const noMentions = entityYield({ ...core, entities: [
        { ref: 'E1', name: 'Alice', type: 'person' },
        { ref: 'E2', name: 'Bob', type: 'person', mention: '   ' }
    ] });
    assert.equal(noMentions.rows, 2);
    assert.equal(noMentions.proposed, 0);
    assert.equal(noMentions.noMention, 2, 'names the rule that refused them');
    assert.equal(noMentions.noName, 0);

    const mixed = entityYield({ ...core, entities: [
        { ref: 'E1', name: 'Alice', type: 'person', mention: 'Alice' },
        { ref: 'E2', name: '', type: 'person', mention: 'x' },
        { ref: 'E3', name: 'Carol', type: 'person' }
    ] });
    assert.deepEqual(
        { rows: mixed.rows, proposed: mixed.proposed, noName: mixed.noName, noMention: mixed.noMention },
        { rows: 3, proposed: 1, noName: 1, noMention: 1 });
});

test('entityYield.proposed always equals what the converter actually returns', async () => {
    const { entityYield } = await import('../src/shared/article-pass.js');
    // The count and the converter must never disagree — a message that
    // says "3 proposed" over a list of 1 is worse than no message.
    for (const entities of [
        undefined, null, [], { bad: 1 }, 'nope',
        [{ ref: 'E1', name: 'A', type: 'person', mention: 'A' }],
        [{ ref: 'E1', name: 'A', type: 'person', mention: 'A' }, { name: 'B' }, null, 'junk']
    ]) {
        const extract = { position: { summary: 's' }, key_assertions: [], entities };
        assert.equal(entityYield(extract).proposed, entityProposalsFromExtract(extract).length,
            `count matches converter for ${JSON.stringify(entities)}`);
    }
});

// Both halves of the claim→entity link are model-produced through a
// non-strict tool, and the two sides used to normalize DIFFERENTLY — the
// `about` side stringified, the knownRefs side stored the raw value. A
// model emitting integer refs then lost every link, silently.
test('claim→entity links survive a non-string ref (the type-asymmetry corruption)', async () => {
    const extract = {
        position: { summary: 's' },
        key_assertions: [{ quote: 'q1', text: 'A.', load_bearing: true, about: [1] }],
        entities: [{ ref: 1, name: 'WHO', type: 'organization', mention: 'WHO' }]
    };
    const claims = claimProposalsFromExtract(extract);
    assert.equal(claims.length, 1);
    assert.deepEqual(claims[0].about, ['1'], 'the link survives; both sides normalize the same way');
});

test('a ref of 0 is a real ref, not a falsy one to be swallowed', async () => {
    const extract = {
        position: { summary: 's' },
        key_assertions: [{ quote: 'q', text: 'A.', load_bearing: true, about: [0] }],
        entities: [{ ref: 0, name: 'Zero Corp', type: 'organization', mention: 'Zero Corp' }]
    };
    assert.deepEqual(claimProposalsFromExtract(extract)[0].about, ['0']);
});

// The invariant the comment claims: `about` may only point at entities
// that ACTUALLY reach the modal. The two predicates used to differ, so a
// row dropped by the converter still had its ref admitted here — the
// chip vanished at render and the link died at accept, with no message.
test('a ref whose entity row was DROPPED is not admitted as a link', async () => {
    const extract = {
        position: { summary: 's' },
        key_assertions: [{ quote: 'q', text: 'A.', load_bearing: true, about: ['E1', 'E2'] }],
        entities: [
            { ref: 'E1', name: 'Kept', type: 'person', mention: 'Kept' },
            { ref: 'E2', name: 'Dropped', type: 'person' }        // no mention → refused
        ]
    };
    const claims = claimProposalsFromExtract(extract);
    assert.deepEqual(claims[0].about, ['E1'],
        'E2 never reaches the modal, so no claim may claim to be about it');
    assert.deepEqual(entityProposalsFromExtract(extract).map((e) => e.ref), ['E1'],
        'and the two functions agree on which rows survived');
});

test('force bypasses the cache — the only escape from a valid-but-poor reading', async () => {
    const CACHED = { position: { summary: 'cached' }, key_assertions: [{ quote: 'q', load_bearing: true }] };
    const FRESH = { position: { summary: 'fresh' }, key_assertions: [{ quote: 'q2', load_bearing: true }] };
    let calls = 0;
    const io_ = { getExtract: async () => ({ extract: CACHED, model: 'old' }),
                  saveExtract: async () => {}, record: async () => ({ status: 'unchanged' }), now: () => 0 };
    const args = { article: ARTICLE, articleHash: 'a'.repeat(64), url: URL_A, title: 'A title',
                   sendMessage: async () => { calls += 1; return { ok: true, extract: FRESH, model: 'm' }; } };

    const cached = await ensureArticleExtract(args, io_);
    assert.equal(cached.status, 'cached');
    assert.equal(calls, 0, 'the default path still pays nothing on a hit');

    const forced = await ensureArticleExtract({ ...args, force: true }, io_);
    assert.equal(forced.status, 'ran', 'force re-reads at full price');
    assert.equal(calls, 1);
    assert.equal(forced.extract.position.summary, 'fresh');
});

// ---- the shared hostile set, applied to THIS consumer -----------------
//
// tests/helpers/hostile.mjs is the one source of malformed model output.
// A fixture set used only by its own test is a fixture set in name only,
// so every consumer of model output runs against it. The contract is one
// line: reject, drop, or report — never throw, never invent.

test('HOSTILE: both converters survive every wrong type in every field', () => {
    const GOOD = {
        position: { summary: 's', side_label: null },
        key_assertions: [{ quote: 'q', text: 'T', load_bearing: true, about: ['E1'] }],
        entities: [{ ref: 'E1', name: 'Alice', type: 'person', mention: 'Alice' }],
        source_references: [{ quote: 'c', target_hint: 'h' }],
        open_questions: ['why?']
    };
    for (const field of Object.keys(GOOD)) {
        assertTotal(assert, GOOD, field, (o) => claimProposalsFromExtract(o));
        assertTotal(assert, GOOD, field, (o) => entityProposalsFromExtract(o));
        assertTotal(assert, GOOD, field, (o) => entityYield(o));
    }
    // And the extract itself being the wrong type, not just its fields.
    for (const [label, bad] of WRONG_TYPES) {
        assert.doesNotThrow(() => claimProposalsFromExtract(bad), `whole extract as ${label}`);
        assert.doesNotThrow(() => entityProposalsFromExtract(bad), `whole extract as ${label}`);
        assert.doesNotThrow(() => entityYield(bad), `whole extract as ${label}`);
    }
});

test('HOSTILE: junk ROWS inside good lists drop without taking the good rows', () => {
    const extract = {
        position: { summary: 's' },
        key_assertions: [...WRONG_ROWS, { quote: 'real', text: 'R', load_bearing: true }],
        entities: [...WRONG_ROWS, { ref: 'E1', name: 'Alice', type: 'person', mention: 'Alice' }]
    };
    const claims = claimProposalsFromExtract(extract);
    const ents = entityProposalsFromExtract(extract);
    assert.equal(claims.length, 1, 'exactly the one real atom');
    assert.equal(claims[0].quote, 'real');
    assert.equal(ents.length, 1, 'exactly the one real entity');
    assert.equal(ents[0].name, 'Alice');
    // The counts must agree with what the converters actually returned —
    // a message that overstates the yield is worse than no message.
    assert.equal(entityYield(extract).proposed, ents.length);
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

// (The slim-call tests — claimIndexForSuggest / mergeSuggestProposals —
// retired in UA.3 with the machinery they pinned.)


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

// ---- the archive-row preference (the markdown-canonical fork fix) ----------

test('articleSourceForExtract prefers the ARCHIVE row — reader-object drift cannot fork the cache key', async () => {
    // A markdown-canonical capture (PDF/EPUB/transcript, or published-
    // then-archived): the reader's hashableArticle carries the markdown
    // verbatim, while the archive row stores the HTML rendering with no
    // marker — assembleArticleBody produces DIFFERENT text from the two
    // (htmlToMarkdown is not idempotent), so whichever object feeds the
    // unit decides the cache key. The row must win whenever it exists.
    const readerObject = { title: 'P', content: '- item', _contentIsMarkdown: true };
    const archivedObject = { title: 'P', content: '<ul><li>item</li></ul>', entities: [{ entity_id: CASE }] };
    const rec = { url: URL_A, articleHash: 'b'.repeat(64), article: archivedObject };

    const src = await articleSourceForExtract(
        { url: URL_A, fallbackArticle: readerObject, fallbackHash: null, fallbackTitle: 'P' },
        { getArchived: async () => rec });
    assert.equal(src.source, 'archive');
    assert.equal(src.article, archivedObject);
    assert.equal(src.articleHash, 'b'.repeat(64));

    // The key computed from the preferred source equals the key the
    // Analyze path computes for the same row.
    const readerUnit = articleMemberUnit({ article: src.article, articleHash: src.articleHash, url: URL_A, title: src.title });
    const data = fixtureData();
    data.articles = [rec];
    const units = await buildMemberUnits(data);
    assert.ok(units.length === 1);
    assert.equal(await corpusExtractKey(corpusMapRequest(readerUnit)),
        await corpusExtractKey(corpusMapRequest(units[0])),
        'archive-sourced reader unit and Analyze unit share one key');

    // No archive row → the reader object is the honest fallback.
    const fb = await articleSourceForExtract(
        { url: URL_A, fallbackArticle: readerObject, fallbackHash: 'c'.repeat(64), fallbackTitle: 'P' },
        { getArchived: async () => null });
    assert.equal(fb.source, 'reader');
    assert.equal(fb.article, readerObject);
    // And a throwing archive read degrades to the fallback, never up.
    const thrown = await articleSourceForExtract(
        { url: URL_A, fallbackArticle: readerObject, fallbackHash: null, fallbackTitle: 'P' },
        { getArchived: async () => { throw new Error('idb closed'); } });
    assert.equal(thrown.source, 'reader');
});

// ---- one substrate end to end ----------------------------------------------

test('ensureArticleExtract returns the unit text — the slim call and modal ground in what the extract read', async () => {
    const out = await ensureArticleExtract(
        { article: ARTICLE, articleHash: 'a'.repeat(64), url: URL_A, title: 'A title',
          sendMessage: async () => ({ ok: true, extract: V8_EXTRACT, model: 'm' }) },
        io());
    assert.equal(out.status, 'ran');
    const unit = articleMemberUnit({ article: ARTICLE, articleHash: 'a'.repeat(64), url: URL_A, title: 'A title' });
    assert.equal(out.text, unit.text, 'the returned substrate IS the unit text');
});

test('a rejecting sendMessage becomes status "failed", never an unhandled rejection', async () => {
    const out = await ensureArticleExtract(
        { article: ARTICLE, articleHash: 'a'.repeat(64), url: URL_A, title: 'A title',
          sendMessage: async () => { throw new Error('The message port closed'); } },
        io());
    assert.equal(out.status, 'failed');
    assert.match(out.error, /message port closed/);
});

test('GUARD (source pin): the reader routes the unified pass through the archive source and canonical substrate', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('../src/reader/index.js', import.meta.url), 'utf8');
    const fn = src.slice(src.indexOf('async function runSuggestPass'), src.indexOf('function reviewSuggestions'));
    assert.ok(fn.includes('articleSourceForExtract('),
        'the unit article comes from the archive-preferred source, never state.article directly');
    assert.ok(fn.includes('groundingText: canonicalText'),
        'the modal grounds the unified pass against the canonical text the extract read');
    assert.ok(!/is_key/.test(fn), 'the article pass flow never touches is_key (guard rail 6)');
});

// ---- corpus-v9 (UA.2): entities from the one reading ------------------------

const V9_EXTRACT = {
    position: { summary: 'what A argues', side_label: null },
    entities: [
        { ref: 'E1', name: 'Alice Chen', type: 'person', mention: 'Alice Chen' },
        { ref: 'E2', name: 'Acme Lab', type: 'organization', mention: 'Acme Lab' },
        { ref: 'E3', name: 'No Mention', type: 'person', mention: '   ' },   // ungroundable → dropped
        { name: 'Ref-free Corp', type: 'organization', mention: 'Ref-free Corp' }
    ],
    key_assertions: [
        { quote: 'Body A text', text: 'A claim.', load_bearing: true, why_load_bearing: 'w',
          about: ['E1', 'E2', 'E9'] },                      // E9 unknown → filtered
        { quote: 'enough words', text: 'Another.', load_bearing: false, about: 'not-an-array' }
    ]
};

test('entityProposalsFromExtract: modal-shaped entity rows; mention-less entries drop', () => {
    const rows = entityProposalsFromExtract(V9_EXTRACT);
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map((r) => r.kind), ['entity', 'entity', 'entity']);
    assert.equal(rows[0].ref, 'E1');
    assert.equal(rows[0].name, 'Alice Chen');
    assert.equal(rows[0].entity_type, 'person');
    assert.equal(rows[0].mention, 'Alice Chen');
    assert.equal(rows[0].from_extract, true);
    assert.equal(rows[2].ref, '', 'a ref-free entry still rides (nothing links to it)');
    assert.ok(!rows.some((r) => r.name === 'No Mention'), 'nothing to ground ⇒ not a proposal');
    for (const r of rows) assert.ok(!('is_key' in r));
});

test('claimProposalsFromExtract: v9 about refs ride, filtered to entities the extract proposes', () => {
    const rows = claimProposalsFromExtract(V9_EXTRACT);
    assert.deepEqual(rows[0].about, ['E1', 'E2'], 'the unknown E9 never dangles into the modal');
    assert.deepEqual(rows[1].about, [], 'a malformed about is calm');
    // v8 extracts (no entities list) keep working: every ref filters out.
    const v8rows = claimProposalsFromExtract(V8_EXTRACT);
    assert.deepEqual(v8rows[0].about ?? [], []);
});

test('GUARD (UA.2 rail 4): a v9 fold stores NO entities and NO about — the layer stays claim-shaped', () => {
    const member = { article_hash: 'a'.repeat(64), url: URL_A, title: 'A title',
        text: 'Body A text with enough words.' };
    const { record } = mergeExtractIntoRecord(null, {
        member, extract: V9_EXTRACT, key: 'k-v9', model: 'm', now: 1234
    });
    assert.ok(!('entities' in record), 'the record has no entities list');
    for (const a of record.assertions) {
        assert.ok(!('about' in a), 'atom refs never persist — coverage is computed on read');
        assert.ok(!('load_bearing' in a) && !('is_key' in a));
    }
});

test('GUARD (UA.2, source pin): the live Suggest path is ONE call — no xray:llm:suggest, one ensureArticleExtract', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('../src/reader/index.js', import.meta.url), 'utf8');
    const fn = src.slice(src.indexOf('async function runSuggestPass'), src.indexOf('function reviewSuggestions'));
    assert.ok(!fn.includes('xray:llm:suggest'),
        'UA.2: the separate entities call must never return to the live path');
    assert.equal((fn.match(/ensureArticleExtract\(/g) || []).length, 1,
        'exactly one extract fetch-or-run — the whole spend of a Suggest click');
    assert.ok(fn.includes("kinds.includes('entities') ? entityProposalsFromExtract"),
        'the entities kind gates what DERIVES from the reading (UA.3 — the preference is consumer-side)');
    assert.ok(fn.includes("kinds.includes('claims') ? claimProposalsFromExtract"),
        'the claims kind gates its half the same way');
});

// ---- UA.3 review round: the fold pins the retired suite carried ------------

test('a FRESH run folds the extract into the durable record (MA.1) with the fingerprint key', async () => {
    let folded = null;
    const out = await ensureArticleExtract(
        { article: ARTICLE, articleHash: 'a'.repeat(64), url: URL_A, title: 'A title',
          frame: { caseName: 'Egg case', scopeQuestion: 'Q?' },
          sendMessage: async () => ({ ok: true, extract: V8_EXTRACT, model: 'test-model' }) },
        io({ record: async (opts) => { folded = opts; return { status: 'saved' }; } }));
    assert.equal(out.status, 'ran');
    assert.ok(folded, 'the fold ran');
    assert.equal(folded.member.article_hash, 'a'.repeat(64));
    assert.deepEqual(folded.extract, V8_EXTRACT);
    assert.equal(folded.key, out.key, 'the fold carries the cache fingerprint for idempotence');
    assert.equal(folded.model, 'test-model');
    assert.equal(folded.frame.caseName, 'Egg case');
});

test('fold and cache-save failures never disturb the paid run', async () => {
    const out = await ensureArticleExtract(
        { article: ARTICLE, articleHash: 'a'.repeat(64), url: URL_A, title: 'A title',
          sendMessage: async () => ({ ok: true, extract: V8_EXTRACT, model: 'm' }) },
        io({ record: async () => { throw new Error('idb closed'); },
             saveExtract: async () => { throw new Error('quota'); } }));
    assert.equal(out.status, 'ran', 'the extract still reaches the caller');
    assert.deepEqual(out.extract, V8_EXTRACT);
});

test('a double-encoded field is repaired IN THE CACHED EXTRACT, not just for validation', async () => {
    // The seam, not the helper — this session's repeated lesson. If only
    // a validation view were repaired, the raw string would be cached
    // and every later Suggest would serve it to the converter: exactly
    // the 2026-08-13 poison with a fresh coat of paint.
    const { ensureArticleExtract } = await import('../src/shared/article-pass.js');
    const rows = [{ ref: 'E1', name: 'Alice', type: 'person', mention: 'Alice said' }];
    const DOUBLE_ENCODED = {
        position: { summary: 's' },
        key_assertions: [{ quote: 'q', text: 't', load_bearing: true }],
        entities: JSON.stringify(rows)
    };
    let saved = null;
    const out = await ensureArticleExtract(
        { article: { title: 'T', content: '<p>Body text long enough to matter.</p>', url: 'https://e.com/a' },
          articleHash: 'a'.repeat(64), url: 'https://e.com/a', title: 'T',
          sendMessage: async () => ({ ok: true, extract: DOUBLE_ENCODED, model: 'm' }) },
        { getExtract: async () => null,
          saveExtract: async (row) => { saved = row; },
          record: async () => ({ status: 'unchanged' }), now: () => 0 });
    assert.equal(out.status, 'ran', 'a recoverable payload must not fail the pass');
    assert.deepEqual(out.extract.entities, rows);
    assert.ok(saved, 'the extract was cached');
    assert.ok(Array.isArray(saved.extract.entities),
        'the CACHED extract carries the repaired array, never the raw string');
    assert.deepEqual(saved.extract.entities, rows);
});
