// Extraction-analysis publishing — MA.6, kind 30070
// (docs/MAP_ARTIFACT_KICKOFF.md §MA.6).
//
// THE load-bearing pins, in order of how much damage a regression does:
//   1. ONLY human-accepted material publishes (the binding maintainer
//      rule). Open atoms, dismissed atoms, un-accepted rationales, and
//      un-accepted sources/questions must never reach the wire.
//   2. Claims are REFERENCED by coordinate, never copied. No quote,
//      span, or offset may appear anywhere in the event — that is what
//      keeps a single copy of a span on the wire and makes an edited
//      claim unable to contradict a published analysis.
//   3. No case frame leaks (corpus-v7 made extraction article-intrinsic;
//      case-scoped rationale belongs to the 30068 brief).
//   4. Round-trip: build → parse returns what was put in.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// claim-ref.js pulls storage.js transitively, which reads chrome.storage
// at module load — stub before importing (the standard idiom here).
globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

const EP = await import('../src/shared/extraction-publish.js');

const HASH = 'a'.repeat(64);
const PUBKEY = 'b'.repeat(64);
const URL = 'https://example.com/story';

const assertion = (over = {}) => ({
    key: 'a:0-40', quote: 'a verbatim span from the article', start: 0, end: 32,
    why: 'the model said this carries the argument',
    text: 'a suggested claim text',
    status: 'open', accepted_claim_id: null, triaged_at: null,
    accepted_why: null, accepted_why_provenance: null,
    first_seen: { model: 'claude-test', promptVersion: 'corpus-v7', producer: 'map',
                  caseName: 'COVID origins', scopeQuestion: 'Where did it start?', at: 1000 },
    ...over
});

const record = (over = {}) => ({
    articleHash: HASH, url: URL, title: 'The Story',
    assertions: [], sources: [], open_questions: [], positions: [],
    merged_keys: ['k1'], dropped_ungrounded: 2, updatedAt: 5000,
    ...over
});

// One accepted atom whose claim is published.
const ACCEPTED = assertion({
    key: 'a:0-32', status: 'accepted', accepted_claim_id: 'claim_1',
    accepted_why: 'this is the load-bearing step of the argument',
    accepted_why_provenance: 'user'
});
const COORDS = { claim_1: `30040:${PUBKEY}:claim_1` };

// ---- 1. only accepted material publishes -----------------------------------

test('publishableAnalysis: open and dismissed atoms NEVER publish', () => {
    const p = EP.publishableAnalysis(record({
        assertions: [
            ACCEPTED,
            assertion({ key: 'a:100-140', status: 'open' }),
            assertion({ key: 'a:200-240', status: 'dismissed' }),
            // Accepted but with no claim id — nothing to reference.
            assertion({ key: 'a:300-340', status: 'accepted', accepted_claim_id: null })
        ]
    }), COORDS);
    assert.equal(p.assertions.length, 1, 'only the accepted, claim-bearing atom');
    assert.equal(p.assertions[0].claim, COORDS.claim_1);
});

test('publishableAnalysis: an UN-accepted rationale never publishes, even on an accepted atom', () => {
    const p = EP.publishableAnalysis(record({
        assertions: [assertion({
            status: 'accepted', accepted_claim_id: 'claim_1',
            why: 'MODEL RATIONALE the human never endorsed',
            accepted_why: null
        })]
    }), COORDS);
    assert.equal(p.assertions.length, 1, 'the atom publishes as a bare claim reference');
    assert.equal('why' in p.assertions[0], false, 'no rationale field at all');
    assert.ok(!JSON.stringify(p).includes('MODEL RATIONALE'));
});

test('publishableAnalysis: sources and open questions ride ONLY when individually accepted', () => {
    const p = EP.publishableAnalysis(record({
        assertions: [ACCEPTED],
        sources: [
            { key: 's:1', target_hint: 'Nature', quote: 'a span', status: 'accepted' },
            { key: 's:2', target_hint: 'UNREVIEWED OUTLET', quote: 'a span', status: 'open' },
            { key: 's:3', target_hint: 'REJECTED OUTLET', status: 'dismissed' }
        ],
        open_questions: [
            { key: 'q:1', text: 'Who approved it?', status: 'accepted' },
            { key: 'q:2', text: 'UNREVIEWED QUESTION', status: 'open' }
        ]
    }), COORDS);
    assert.deepEqual(p.sources.map((s) => s.target_hint), ['Nature']);
    assert.deepEqual(p.open_questions, ['Who approved it?']);
    const json = JSON.stringify(p);
    assert.ok(!json.includes('UNREVIEWED'));
    assert.ok(!json.includes('REJECTED OUTLET'));
});

test('publishableAnalysis: rows with no status at all (pre-MA.6 records) are NOT accepted', () => {
    // Backward compat must fail CLOSED: a record written before the
    // review fields existed has no accepted material, so it publishes
    // nothing rather than everything.
    const p = EP.publishableAnalysis(record({
        assertions: [assertion({ status: undefined })],
        sources: [{ key: 's:1', target_hint: 'Nature' }],
        open_questions: [{ key: 'q:1', text: 'q' }]
    }), COORDS);
    assert.equal(p.assertions.length, 0);
    assert.equal(p.sources.length, 0);
    assert.equal(p.open_questions.length, 0);
    assert.equal(EP.hasPublishableAnalysis(record(), COORDS), false);
});

test('buildExtractionAnalysisEvent REFUSES when nothing was reviewed and accepted', () => {
    assert.throws(() => EP.buildExtractionAnalysisEvent({
        record: record({ assertions: [assertion({ status: 'open' })] }), coordByClaimId: COORDS
    }), /nothing has been reviewed and accepted/);
    assert.throws(() => EP.buildExtractionAnalysisEvent({ record: null }), /articleHash is required/);
});

test('an accepted atom whose claim is UNPUBLISHED is omitted and disclosed, not guessed at', () => {
    const p = EP.publishableAnalysis(record({ assertions: [ACCEPTED] }), {});   // no coords
    assert.equal(p.assertions.length, 0, 'no coordinate ⇒ nothing to reference');
    assert.equal(p.coverage.accepted, 1, 'the acceptance is still counted');
    assert.equal(p.coverage.accepted_but_unpublished, 1, 'and the reason it is absent is disclosed');
});

// ---- 2. references, never copies -------------------------------------------

test('THE anti-duplication pin: no quote, span, or offset appears anywhere in the event', () => {
    const ev = EP.buildExtractionAnalysisEvent({
        record: record({
            assertions: [ACCEPTED],
            sources: [{ key: 's:1', target_hint: 'Nature', quote: 'a verbatim span from the article', status: 'accepted' }]
        }),
        coordByClaimId: COORDS, articleUrl: URL, articleTitle: 'The Story'
    });
    const whole = JSON.stringify(ev);
    assert.ok(!whole.includes('a verbatim span from the article'),
        'the article span lives in the CLAIM, never here — one copy on the wire');
    assert.ok(!whole.includes('a suggested claim text'), 'the claim text lives in the claim');
    assert.ok(!/"start"|"end"|"a:0-32"/.test(whole), 'no offsets and no local span keys');
    // The claim is present, as a coordinate.
    assert.ok(whole.includes(COORDS.claim_1));
    assert.ok(ev.tags.some((t) => t[0] === 'a' && t[1] === COORDS.claim_1 && t[3] === 'analyzed'));
});

test('the event carries no case frame (corpus-v7 — extraction is article-intrinsic)', () => {
    const ev = EP.buildExtractionAnalysisEvent({
        record: record({ assertions: [ACCEPTED] }), coordByClaimId: COORDS
    });
    const whole = JSON.stringify(ev);
    assert.ok(!whole.includes('COVID origins'), 'no caseName');
    assert.ok(!whole.includes('Where did it start?'), 'no scopeQuestion');
    assert.ok(!whole.includes('k1'), 'no merged_keys — that is cache bookkeeping');
});

// ---- 3. shape + tags -------------------------------------------------------

test('event shape: kind, replaceable d-tag, x hash, coverage, and NIP anchoring', () => {
    const ev = EP.buildExtractionAnalysisEvent({
        record: record({
            assertions: [ACCEPTED, assertion({ key: 'a:9', status: 'open' })]
        }),
        coordByClaimId: COORDS, articleUrl: URL, articleTitle: 'The Story',
        articleCoord: `30023:${PUBKEY}:art-1`, createdAt: 1700
    });
    assert.equal(ev.kind, 30070);
    assert.equal(EP.EXTRACTION_ANALYSIS_KIND, 30070);
    const tag = (k) => (ev.tags.find((t) => t[0] === k) || [])[1];
    assert.equal(tag('d'), `xray-extraction:${HASH}`);
    assert.equal(EP.extractionDTag(HASH), `xray-extraction:${HASH}`);
    assert.equal(tag('x'), HASH, 'pins the analysis to the exact analyzed text');
    assert.equal(tag('t'), 'xray-extraction-analysis');
    assert.equal(tag('client'), 'xray');
    // Coverage on the event's FACE, so it survives content-blind aggregation.
    assert.equal(tag('reviewed'), '1:1:2', 'accepted:not_accepted:ungroundable_dropped');
    // NIP-73/22 anchoring per docs/NIP_DRAFT.md §Anchoring.
    assert.equal(tag('r'), URL);
    assert.equal(tag('i'), URL);
    assert.equal(tag('k'), 'web');
    assert.ok(ev.tags.some((t) => t[0] === 'a' && t[3] === 'article'));
    assert.equal(ev.created_at, 1700);
});

test('a URL-less record still builds (no anchoring tags rather than empty ones)', () => {
    const ev = EP.buildExtractionAnalysisEvent({
        record: record({ url: null, assertions: [ACCEPTED] }), coordByClaimId: COORDS
    });
    assert.ok(!ev.tags.some((t) => ['r', 'i', 'k'].includes(t[0])));
    assert.ok(ev.tags.some((t) => t[0] === 'd'));
});

test('generator provenance rides per assertion (P12) — model, prompt version, producer', () => {
    const ev = EP.buildExtractionAnalysisEvent({
        record: record({ assertions: [ACCEPTED] }), coordByClaimId: COORDS
    });
    const payload = JSON.parse(ev.content);
    assert.deepEqual(payload.assertions[0].generator,
        { model: 'claude-test', prompt_version: 'corpus-v7', producer: 'map' });
    assert.equal(payload.assertions[0].why_by, 'user', 'an edited rationale is attributed to the user');
});

// ---- 4. round trip ---------------------------------------------------------

test('round trip: build → parse returns the analysis', () => {
    const ev = EP.buildExtractionAnalysisEvent({
        record: record({
            assertions: [ACCEPTED],
            sources: [{ key: 's:1', target_hint: 'Nature', status: 'accepted' }],
            open_questions: [{ key: 'q:1', text: 'Who approved it?', status: 'accepted' }]
        }),
        coordByClaimId: COORDS, articleUrl: URL, articleTitle: 'The Story'
    });
    const back = EP.parseExtractionAnalysisEvent({ ...ev, kind: 30070 });
    assert.equal(back.articleHash, HASH);
    assert.equal(back.articleUrl, URL);
    assert.equal(back.assertions.length, 1);
    assert.equal(back.assertions[0].claim, COORDS.claim_1);
    assert.equal(back.assertions[0].why, 'this is the load-bearing step of the argument');
    assert.equal(back.assertions[0].whyBy, 'user');
    assert.equal(back.assertions[0].generator.promptVersion, 'corpus-v7');
    assert.deepEqual(back.sources, [{ targetHint: 'Nature', note: null }]);
    assert.deepEqual(back.openQuestions, ['Who approved it?']);
    assert.deepEqual(back.coverage, { accepted: 1, notAccepted: 0, ungroundableDropped: 2 });
    assert.deepEqual(back.analyzedClaims, [COORDS.claim_1]);
});

test('parse is defensive: wrong kind, malformed content, and junk rows', () => {
    assert.equal(EP.parseExtractionAnalysisEvent(null), null);
    assert.equal(EP.parseExtractionAnalysisEvent({ kind: 30068, content: '{}' }), null);
    assert.equal(EP.parseExtractionAnalysisEvent({ kind: 30070, content: 'not json' }), null);
    assert.equal(EP.parseExtractionAnalysisEvent({ kind: 30070, content: '"a string"' }), null);
    // Junk rows are dropped, not half-parsed.
    const back = EP.parseExtractionAnalysisEvent({
        kind: 30070,
        tags: [['d', `xray-extraction:${HASH}`]],
        content: JSON.stringify({
            assertions: [{ claim: 'c1' }, { no_claim: true }, null],
            sources: [{ target_hint: 'ok' }, { junk: 1 }],
            open_questions: ['q', 42]
        })
    });
    assert.equal(back.assertions.length, 1);
    assert.equal(back.assertions[0].generator, null, 'absent generator is null, not invented');
    assert.equal(back.sources.length, 1);
    assert.deepEqual(back.openQuestions, ['q']);
    assert.equal(back.articleHash, HASH, 'recovered from the d-tag when content omits it');
});

// ---- the never-ship list, guarded BY LITERAL not by documentation ----------
// (the design panel's unanimous must-not-ship set; the lens-guards idiom)

test('GUARD: the event carries no judgment-surface tags and no numeric slot', () => {
    const ev = EP.buildExtractionAnalysisEvent({
        record: record({
            assertions: [ACCEPTED],
            sources: [{ key: 's:1', target_hint: 'Nature', status: 'accepted' }],
            open_questions: [{ key: 'q:1', text: 'q?', status: 'accepted' }]
        }),
        coordByClaimId: COORDS, articleUrl: URL
    });
    const tagNames = ev.tags.map((t) => t[0]);
    // No `p` tag: this must never surface in an entity's #p dossier query
    // beside real claims (the 30063 no-p posture, one layer earlier).
    assert.ok(!tagNames.includes('p'), 'no p tag');
    // No NIP-32 label namespace: that is the aggregation path that would
    // let a label consumer treat this as a taxonomy assertion.
    assert.ok(!tagNames.includes('L') && !tagNames.includes('l'), 'no L/l labels');
    // No NIP-22 ROOT scope: uppercase I/K would thread a machine review
    // ledger into comment UIs as the publisher's commentary. Lowercase
    // i/k (NIP-73 discoverability) is intended and present.
    assert.ok(!tagNames.includes('I') && !tagNames.includes('K'), 'no I/K root-scope tags');
    assert.ok(tagNames.includes('i') && tagNames.includes('k'), 'i/k ARE present (NIP-73)');
    // No fused number anywhere — not even a review-completeness ratio.
    const whole = JSON.stringify(ev).toLowerCase();
    for (const banned of ['"score"', 'confidence', 'stance', 'rating', 'ceiling',
                          'percent', 'ratio', 'probability', 'likelihood', 'rank']) {
        assert.ok(!whole.includes(banned), `forbidden numeric/judgment key "${banned}"`);
    }
});

test('GUARD: kind 30070 is the ONLY kind this module emits (no mirror, no twin)', async () => {
    const { readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    // NB: the local `URL` const below shadows the global constructor, so
    // resolve the path from import.meta.dirname rather than new URL().
    const src = await readFile(join(import.meta.dirname, '../src/shared/extraction-publish.js'), 'utf8');
    const kinds = new Set();
    for (const m of src.matchAll(/\bkind\s*[:=]\s*(\d{4,5})\b/g)) kinds.add(Number(m[1]));
    for (const m of src.matchAll(/\b(?:[A-Z][A-Z0-9_]*_)?KIND(?:_[A-Z0-9][A-Z0-9_]*)?\s*=\s*(\d{4,5})\b/g)) kinds.add(Number(m[1]));
    assert.deepEqual([...kinds].sort(), [30070],
        'no kind-1985 label mirror, no readable 30023 twin, no kind-1 note — and never 30066');
    // The reserved/declined numbers must not appear at all.
    for (const reserved of [30065, 30066, 30067]) {
        assert.ok(!src.includes(String(reserved)), `${reserved} must not be referenced`);
    }
});

test('GUARD: the publish boundary REFUSES a record whose key does not pin a text', () => {
    // A url:<sha16> fallback key names a URL, not a text — its `x` would
    // be a fabricated content hash. All three judges flagged this
    // independently; it is enforced, not documented.
    assert.throws(() => EP.buildExtractionAnalysisEvent({
        record: record({ articleHash: 'url:deadbeefdeadbeef', assertions: [ACCEPTED] }),
        coordByClaimId: COORDS
    }), /does not pin a text/);
    // And a plausible-but-non-hex id is refused too.
    assert.throws(() => EP.buildExtractionAnalysisEvent({
        record: record({ articleHash: 'z'.repeat(64), assertions: [ACCEPTED] }),
        coordByClaimId: COORDS
    }), /does not pin a text/);
});

test('withheld[]: the known-unknowns log names every field kept back, and why', () => {
    const ev = EP.buildExtractionAnalysisEvent({
        record: record({
            assertions: [
                ACCEPTED,
                assertion({ key: 'a:9', status: 'open', text: 'a model paraphrase', why: 'a model rationale' })
            ],
            sources: [{ key: 's:1', target_hint: 'Nature', quote: 'model copy of a span', status: 'open' }],
            open_questions: [{ key: 'q:1', text: 'unaccepted q', status: 'open' }],
            positions: [{ caseName: 'COVID origins', scopeQuestion: 'Where?', summary: 'p', at: 1 }]
        }),
        coordByClaimId: COORDS
    });
    const fields = JSON.parse(ev.content).withheld.map((w) => w.field);
    for (const expected of ['assertions.unaccepted', 'assertions.text', 'assertions.why',
                            'positions', 'case_frame', 'merged_keys',
                            'sources.unaccepted', 'sources.quote', 'open_questions.unaccepted']) {
        assert.ok(fields.includes(expected), `withheld must name ${expected}`);
    }
    // Every reason is stated, and the withheld VALUES never leak.
    const whole = JSON.stringify(ev);
    assert.ok(!whole.includes('a model paraphrase'));
    assert.ok(!whole.includes('a model rationale'));
    assert.ok(!whole.includes('COVID origins'));
    // Round-trips.
    const back = EP.parseExtractionAnalysisEvent({ ...ev, kind: 30070 });
    assert.ok(back.withheld.length >= 9);
    assert.equal(back.withheld.find((w) => w.field === 'assertions.unaccepted').count, 1);
});

// ---- claim coordinate index ------------------------------------------------

test('claimCoordIndex: only PUBLISHED claims get coordinates', () => {
    const idx = EP.claimCoordIndex([
        { id: 'claim_1', publishedPubkey: PUBKEY },
        { id: 'claim_2' },                                  // local-only
        { id: 'claim_3', publishedPubkey: 'not-hex' },       // malformed
        null
    ]);
    assert.deepEqual(Object.keys(idx), ['claim_1']);
    assert.equal(idx.claim_1, `30040:${PUBKEY}:claim_1`);
    assert.deepEqual(EP.claimCoordIndex(null), {});
});
