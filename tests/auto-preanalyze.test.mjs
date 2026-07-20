// Auto pre-analyze on capture — Phase 28 (flag `autoPreAnalyze`).
//
// The load-bearing pin here is IDENTITY: the auto path must produce a
// map request — and therefore a corpus-extracts cache key — that is
// byte-identical to what the Analyze run later computes for the same
// member (the corpus-v4 one-request-builder rule). A one-character
// drift silently orphans every prepaid extract: Analyze would find no
// hit and quietly pay again, which is precisely the failure mode this
// feature exists to prevent.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// case-dossier pulls the model modules, which read chrome.storage at
// module load — stub before importing (the standard LLM-test idiom).
globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

const { autoPreAnalyzeCapture } = await import('../src/shared/auto-preanalyze.js');
const { caseScopeQuestion } = await import('../src/shared/case-dossier.js');
const { buildMemberUnits, corpusMapRequest, corpusExtractKey } =
    await import('../src/shared/case-synthesis.js');
const { FLAGS_DEFAULTS } = await import('../src/shared/metadata/feature-flags.js');

// ---- fixture: one case, one archived member article ------------------------

const CASE = 'entity_case';
const URL_A = 'https://ex.com/a';

function fixtureData() {
    return {
        case: { id: CASE, name: 'Egg case' },
        membership_ids: [CASE],
        orbit: { claims: [] },
        wire: { articles: [] },
        claimsById: {},
        entitiesById: {
            [CASE]: {
                id: CASE, name: 'Egg case', type: 'case',
                authored_fields: { scope_question: { value: '  Do eggs raise CVD risk?  ' } }
            }
        },
        articles: [
            { url: URL_A, articleHash: 'hashA',
              article: { title: 'A', content: 'Body A text', entities: [{ entity_id: CASE }] } }
        ]
    };
}

const VALID_EXTRACT = { position: { summary: 'the member position' } };

// io defaults: every gate open, everything injectable per-test.
function io(overrides = {}) {
    return {
        loadFlags: async () => {},
        isEnabled: () => true,
        collectData: async () => fixtureData(),
        getExtract: async () => null,
        saveExtract: async () => {},
        now: () => 1234,
        ...overrides
    };
}

// ---- the consent economics pin ---------------------------------------------

test('autoPreAnalyze defaults OFF — a standing spend authorization must be opted into', () => {
    assert.ok(Object.prototype.hasOwnProperty.call(FLAGS_DEFAULTS, 'autoPreAnalyze'));
    assert.equal(FLAGS_DEFAULTS.autoPreAnalyze, false);
});

// ---- gates ----------------------------------------------------------------

test('flag off → status "off" with NO dossier load and NO call', async () => {
    let collected = 0, sent = 0;
    const out = await autoPreAnalyzeCapture(
        { caseEntityId: CASE, url: URL_A, sendMessage: async () => { sent++; return { ok: true }; } },
        io({ isEnabled: () => false, collectData: async () => { collected++; return fixtureData(); } }));
    assert.equal(out.status, 'off');
    assert.equal(collected, 0, 'the dossier is never loaded when the flag is off');
    assert.equal(sent, 0);
});

test('caseSynthesis/llmAssist off → "gated" before the dossier load', async () => {
    let collected = 0;
    const out = await autoPreAnalyzeCapture(
        { caseEntityId: CASE, url: URL_A, sendMessage: async () => ({ ok: true }) },
        io({ isEnabled: (f) => f === 'autoPreAnalyze',
             collectData: async () => { collected++; return fixtureData(); } }));
    assert.equal(out.status, 'gated');
    assert.equal(collected, 0);
});

test('missing case or url → "no-case"', async () => {
    const out = await autoPreAnalyzeCapture(
        { caseEntityId: null, url: URL_A, sendMessage: async () => ({ ok: true }) }, io());
    assert.equal(out.status, 'no-case');
});

// ---- THE identity pin ------------------------------------------------------

test('the auto request and cache key are BYTE-IDENTICAL to the Analyze path\'s', async () => {
    const data = fixtureData();
    // The Analyze side, exactly as synthesis-block computes it: units
    // from buildMemberUnits, frame from data.case.name +
    // dossier.scope.question (= caseScopeQuestion — code-shared),
    // request from corpusMapRequest, key from corpusExtractKey.
    const units = await buildMemberUnits(data);
    const unit = units.find((u) => u.url === URL_A);
    assert.ok(unit, 'fixture sanity: the member unit exists');
    const analyzeReq = corpusMapRequest(unit,
        { caseName: data.case.name || '', scopeQuestion: caseScopeQuestion(data) });
    const analyzeKey = await corpusExtractKey(analyzeReq);

    let sentReq = null, saved = null;
    const out = await autoPreAnalyzeCapture(
        { caseEntityId: CASE, url: URL_A,
          sendMessage: async (msg) => {
              assert.equal(msg.type, 'xray:llm:corpus-map');
              sentReq = msg.request;
              return { ok: true, extract: VALID_EXTRACT, model: 'test-model' };
          } },
        io({ saveExtract: async (rec) => { saved = rec; } }));

    assert.equal(out.status, 'ran');
    assert.equal(JSON.stringify(sentReq), JSON.stringify(analyzeReq),
        'the wire request must be byte-identical — corpusMapRequest is the ONE builder');
    assert.equal(saved.key, analyzeKey,
        'the prepaid extract lands under exactly the key Analyze will look up');
    assert.equal(out.key, analyzeKey);
    assert.deepEqual(saved.extract, VALID_EXTRACT);
    assert.equal(saved.model, 'test-model');
    assert.equal(saved.cachedAt, 1234);
});

// ---- cache-first economics -------------------------------------------------

test('a VALID cached extract short-circuits: status "cached", no LLM call', async () => {
    let sent = 0;
    const out = await autoPreAnalyzeCapture(
        { caseEntityId: CASE, url: URL_A, sendMessage: async () => { sent++; return { ok: true }; } },
        io({ getExtract: async () => ({ extract: VALID_EXTRACT, model: 'm' }) }));
    assert.equal(out.status, 'cached');
    assert.equal(sent, 0, 'a hit costs nothing');
});

test('an INVALID cached extract does not count as a hit — the pass still runs', async () => {
    let sent = 0;
    const out = await autoPreAnalyzeCapture(
        { caseEntityId: CASE, url: URL_A,
          sendMessage: async () => { sent++; return { ok: true, extract: VALID_EXTRACT, model: 'm' }; } },
        io({ getExtract: async () => ({ extract: { not: 'an extract' }, model: 'm' }) }));
    assert.equal(out.status, 'ran');
    assert.equal(sent, 1);
});

// ---- failure posture -------------------------------------------------------

test('a failed or invalid map response → "failed", NOTHING saved, never a throw', async () => {
    let saved = 0;
    const failed = await autoPreAnalyzeCapture(
        { caseEntityId: CASE, url: URL_A, sendMessage: async () => ({ ok: false, error: 'boom' }) },
        io({ saveExtract: async () => { saved++; } }));
    assert.equal(failed.status, 'failed');
    assert.equal(failed.error, 'boom');

    const invalid = await autoPreAnalyzeCapture(
        { caseEntityId: CASE, url: URL_A,
          sendMessage: async () => ({ ok: true, extract: { wrong: true }, model: 'm' }) },
        io({ saveExtract: async () => { saved++; } }));
    assert.equal(invalid.status, 'failed');
    assert.equal(invalid.error, 'invalid extract');
    assert.equal(saved, 0, 'a failed pass must never poison the cache');
});

test('a URL that is not a member of the case → "no-member" with no call', async () => {
    let sent = 0;
    const out = await autoPreAnalyzeCapture(
        { caseEntityId: CASE, url: 'https://elsewhere.com/x',
          sendMessage: async () => { sent++; return { ok: true }; } },
        io());
    assert.equal(out.status, 'no-member');
    assert.equal(sent, 0);
});

// ---- the shared scope reader ----------------------------------------------

test('caseScopeQuestion: trims the authored field and defaults to "" — the ONE reader both paths share', () => {
    assert.equal(caseScopeQuestion(fixtureData()), 'Do eggs raise CVD risk?');
    const noField = fixtureData();
    delete noField.entitiesById[CASE].authored_fields;
    assert.equal(caseScopeQuestion(noField), '');
    assert.equal(caseScopeQuestion({ case: { id: 'missing' }, entitiesById: {} }), '');
});
