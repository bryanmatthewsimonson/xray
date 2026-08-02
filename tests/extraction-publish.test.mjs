// Extraction-analysis publishing — MA.6, kind 30070
// (docs/MAP_ARTIFACT_KICKOFF.md §MA.6).
//
// DISCLOSURE POSTURE (maintainer, 2026-07-29, revising an earlier
// accepted-only rule): the WHOLE extraction unit publishes — every atom
// in every review state, WITH the model's prose — because the full queue
// is the better disclosure and a filter you cannot see cannot be
// audited. That makes the MARKING the only safeguard, so these pins are
// ordered by how much damage a regression does:
//
//   1. Every row carries a REQUIRED status, and an unknown status reads
//      as `unreviewed` — never as endorsed (fail-safe, not fail-open).
//   2. Model prose lives ONLY in `model_`-prefixed keys. It must never
//      appear as `quote`, as the human's `why`, or in `content`'s
//      top level.
//   3. Endorsement is a POINTER to a separately signed kind-30040, and
//      a human-attributable field on a non-accepted row is ignored on
//      the way back in — a hostile event cannot smuggle endorsement.
//   4. No judgment-surface tags and no numeric slot.
//   5. Round-trip fidelity.

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
    key: 'a:0-32', quote: 'a verbatim span from the article', start: 0, end: 32,
    why: 'MODEL RATIONALE about load-bearing-ness',
    text: 'MODEL PARAPHRASE of the claim',
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

const ACCEPTED = assertion({
    key: 'a:0-32', status: 'accepted', accepted_claim_id: 'claim_1',
    accepted_why: 'HUMAN rationale: this is the load-bearing step',
    accepted_why_provenance: 'user'
});
const COORDS = { claim_1: `30040:${PUBKEY}:claim_1` };

// ---- 1. the whole unit publishes, every state, REQUIRED status --------------

test('every atom publishes regardless of review state, each with a required status', () => {
    const p = EP.publishableAnalysis(record({
        assertions: [
            ACCEPTED,
            assertion({ key: 'a:40', quote: 'an open span', start: 40, end: 52, status: 'open' }),
            assertion({ key: 'a:60', quote: 'a dismissed span', start: 60, end: 76, status: 'dismissed' })
        ]
    }), COORDS);
    assert.equal(p.assertions.length, 3, 'the WHOLE queue publishes — the denominator is visible');
    assert.deepEqual(p.assertions.map((a) => a.status), ['accepted', 'unreviewed', 'dismissed']);
    for (const a of p.assertions) {
        assert.ok(EP.REVIEW_STATES.includes(a.status), 'status is required and from the closed set');
    }
    assert.deepEqual(p.coverage, {
        unreviewed: 1, accepted: 1, dismissed: 1, ungroundable_dropped: 2
    });
});

test('local "open" is published as "unreviewed", and an absent status fails SAFE', () => {
    assert.equal(EP.wireStatus('open'), 'unreviewed');
    assert.equal(EP.wireStatus(undefined), 'unreviewed', 'pre-MA.6 rows are unreviewed, not endorsed');
    assert.equal(EP.wireStatus('weird'), 'unreviewed');
    assert.equal(EP.wireStatus('accepted'), 'accepted');
    assert.equal(EP.wireStatus('dismissed'), 'dismissed');
    const p = EP.publishableAnalysis(record({
        assertions: [assertion({ status: undefined })]
    }), COORDS);
    assert.equal(p.assertions[0].status, 'unreviewed');
});

test('atoms publish in document order by span start — deterministic, and NOT a ranking', () => {
    const p = EP.publishableAnalysis(record({
        assertions: [
            assertion({ key: 'c', quote: 'third', start: 300, end: 305 }),
            assertion({ key: 'a', quote: 'first', start: 10, end: 15 }),
            assertion({ key: 'b', quote: 'second', start: 100, end: 106 })
        ]
    }), COORDS);
    assert.deepEqual(p.assertions.map((a) => a.quote), ['first', 'second', 'third']);
});

test('an atom with no quote is not an atom — nothing verifiable to publish', () => {
    const p = EP.publishableAnalysis(record({ assertions: [assertion({ quote: '' })] }), COORDS);
    assert.equal(p.assertions.length, 0);
});

// ---- 2. model prose is quarantined by name ---------------------------------

test('THE marking pin: model prose appears ONLY in model_-prefixed keys', () => {
    const p = EP.publishableAnalysis(record({ assertions: [ACCEPTED] }), COORDS);
    const a = p.assertions[0];
    assert.equal(a.model_note, 'MODEL RATIONALE about load-bearing-ness');
    assert.equal(a.model_proposed_text, 'MODEL PARAPHRASE of the claim');
    // The model's words are NOT the article's span and NOT the human's why.
    assert.equal(a.quote, 'a verbatim span from the article');
    assert.equal(a.why, 'HUMAN rationale: this is the load-bearing step');
    assert.notEqual(a.quote, a.model_proposed_text);
    assert.notEqual(a.why, a.model_note);
    // No un-prefixed alias for either piece of model prose.
    for (const k of Object.keys(a)) {
        if (k === 'model_note' || k === 'model_proposed_text') continue;
        assert.notEqual(a[k], 'MODEL RATIONALE about load-bearing-ness', `key ${k} aliases model prose`);
        assert.notEqual(a[k], 'MODEL PARAPHRASE of the claim', `key ${k} aliases model prose`);
    }
});

test('the human why rides ONLY on an accepted row, never on unreviewed/dismissed', () => {
    const p = EP.publishableAnalysis(record({
        assertions: [
            // A human rationale left over on a row later re-opened.
            assertion({ key: 'a:1', quote: 'reopened span', status: 'open',
                        accepted_why: 'STALE HUMAN RATIONALE' }),
            assertion({ key: 'a:2', quote: 'dismissed span', start: 50, end: 64, status: 'dismissed',
                        accepted_why: 'STALE HUMAN RATIONALE' })
        ]
    }), COORDS);
    for (const a of p.assertions) {
        assert.equal('why' in a, false, `${a.status} row must carry no human why`);
    }
    assert.ok(!JSON.stringify(p).includes('STALE HUMAN RATIONALE'));
});

// ---- 3. endorsement is a pointer, unforgeable -------------------------------

test('endorsement is a claim COORDINATE, and only accepted rows get one', () => {
    const p = EP.publishableAnalysis(record({
        assertions: [ACCEPTED, assertion({ key: 'a:9', quote: 'open span', start: 90, end: 99 })]
    }), COORDS);
    const acc = p.assertions.find((a) => a.status === 'accepted');
    const open = p.assertions.find((a) => a.status === 'unreviewed');
    assert.equal(acc.claim, COORDS.claim_1);
    assert.equal('claim' in open, false, 'an unreviewed row has no claim slot at all');
});

test('accepted-but-unpublished is honest AND unusable as authority', () => {
    const p = EP.publishableAnalysis(record({ assertions: [ACCEPTED] }), {});   // no coords
    assert.equal(p.assertions[0].status, 'accepted', 'the human did rule — say so');
    assert.equal(p.assertions[0].claim, null, 'but there is nothing to fetch');
    assert.equal(p.assertions[0].endorsement, 'local-only');
    assert.equal(p.coverage.accepted_local_only, 1, 'and it is counted');
});

test('the tag block is the ENDORSEMENT index — only endorsed atoms get an `a` coord', () => {
    const ev = EP.buildExtractionAnalysisEvent({
        record: record({
            assertions: [ACCEPTED, assertion({ key: 'a:9', quote: 'open span', start: 90, end: 99 })]
        }),
        coordByClaimId: COORDS, articleUrl: URL
    });
    const endorsed = ev.tags.filter((t) => t[0] === 'a' && t[3] === 'endorsed');
    assert.equal(endorsed.length, 1, 'one endorsed atom ⇒ one coordinate');
    assert.equal(endorsed[0][1], COORDS.claim_1);
});

test('a hostile/malformed event cannot smuggle endorsement onto an unreviewed row', () => {
    const back = EP.parseExtractionAnalysisEvent({
        kind: 30070,
        tags: [['d', `xray-extraction:${HASH}`]],
        content: JSON.stringify({
            assertions: [{
                quote: 'a span', status: 'unreviewed',
                // All of these must be ignored on a non-accepted row.
                claim: `30040:${PUBKEY}:forged`, why: 'FORGED HUMAN RATIONALE',
                why_by: 'user', endorsement: 'local-only'
            }, {
                quote: 'another span', status: 'TOTALLY-BOGUS',
                claim: `30040:${PUBKEY}:forged2`, why: 'FORGED TOO'
            }]
        })
    });
    for (const a of back.assertions) {
        assert.equal(a.status, 'unreviewed', 'unknown status reads as unreviewed');
        assert.equal(a.claim, null, 'no claim honoured on a non-accepted row');
        assert.equal(a.why, null, 'no human rationale honoured');
        assert.equal(a.endorsement, null);
    }
    assert.ok(!JSON.stringify(back).includes('FORGED'));
});

// ---- 4. structural firewall + refusals -------------------------------------

test('GUARD: no judgment-surface tags and no numeric slot', () => {
    const ev = EP.buildExtractionAnalysisEvent({
        record: record({
            assertions: [ACCEPTED],
            sources: [{ key: 's:1', target_hint: 'Nature', status: 'accepted' }],
            open_questions: [{ key: 'q:1', text: 'q?', status: 'open' }]
        }),
        coordByClaimId: COORDS, articleUrl: URL
    });
    const names = ev.tags.map((t) => t[0]);
    assert.ok(!names.includes('p'), 'no p tag — never beside real claims in a #p dossier query');
    assert.ok(!names.includes('L') && !names.includes('l'), 'no NIP-32 label aggregation path');
    assert.ok(!names.includes('I') && !names.includes('K'), 'no NIP-22 root scope');
    assert.ok(names.includes('i') && names.includes('k'), 'i/k ARE present (NIP-73 discoverability)');
    // Check KEYS, not the serialized blob: a fixture's own prose may
    // legitimately contain the word "rationale", and a substring sweep
    // over values would flag it. The firewall is about slots the format
    // offers, not words a human happened to type.
    const keys = new Set();
    (function walk(v) {
        if (Array.isArray(v)) { v.forEach(walk); return; }
        if (!v || typeof v !== 'object') return;
        for (const [k, val] of Object.entries(v)) { keys.add(k.toLowerCase()); walk(val); }
    })(JSON.parse(ev.content));
    for (const n of names) keys.add(String(n).toLowerCase());
    for (const banned of ['score', 'confidence', 'stance', 'rating', 'ceiling',
                          'percent', 'ratio', 'probability', 'likelihood', 'rank',
                          'weight', 'severity', 'grade']) {
        for (const k of keys) {
            assert.ok(!k.includes(banned), `forbidden numeric/judgment key "${k}"`);
        }
    }
});

test('GUARD: kind 30070 is the ONLY kind this module emits (no mirror, no twin)', async () => {
    const { readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    // NB: the local `URL` const shadows the global constructor, so
    // resolve from import.meta.dirname rather than new URL().
    const src = await readFile(join(import.meta.dirname, '../src/shared/extraction-publish.js'), 'utf8');
    const kinds = new Set();
    for (const m of src.matchAll(/\bkind\s*[:=]\s*(\d{4,5})\b/g)) kinds.add(Number(m[1]));
    for (const m of src.matchAll(/\b(?:[A-Z][A-Z0-9_]*_)?KIND(?:_[A-Z0-9][A-Z0-9_]*)?\s*=\s*(\d{4,5})\b/g)) kinds.add(Number(m[1]));
    assert.deepEqual([...kinds].sort(), [30070],
        'no kind-1985 mirror, no readable 30023 twin, no kind-1 note — and never 30066');
    for (const reserved of [30065, 30066, 30067]) {
        assert.ok(!src.includes(String(reserved)), `${reserved} must not be referenced`);
    }
});

test('GUARD: the publish boundary REFUSES a record whose key does not pin a text', () => {
    // A url:<sha16> fallback key names a URL, not a text — its `x` would
    // be a fabricated content hash.
    assert.throws(() => EP.buildExtractionAnalysisEvent({
        record: record({ articleHash: 'url:deadbeefdeadbeef', assertions: [ACCEPTED] }),
        coordByClaimId: COORDS
    }), /does not pin a text/);
    assert.throws(() => EP.buildExtractionAnalysisEvent({
        record: record({ articleHash: 'z'.repeat(64), assertions: [ACCEPTED] }),
        coordByClaimId: COORDS
    }), /does not pin a text/);
});

test('an empty record mints nothing', () => {
    assert.equal(EP.hasPublishableAnalysis(record(), COORDS), false);
    assert.throws(() => EP.buildExtractionAnalysisEvent({ record: record(), coordByClaimId: COORDS }),
        /nothing publishable/);
    assert.throws(() => EP.buildExtractionAnalysisEvent({ record: null }), /articleHash is required/);
});

test('STILL never published: positions, case frame, merged_keys, source quotes', () => {
    const ev = EP.buildExtractionAnalysisEvent({
        record: record({
            assertions: [ACCEPTED],
            sources: [{ key: 's:1', target_hint: 'Nature', quote: 'MODEL COPY OF A SPAN', status: 'accepted' }],
            positions: [{ caseName: 'COVID origins', scopeQuestion: 'Where did it start?',
                          summary: 'MODEL PROSE characterizing the article', at: 1 }]
        }),
        coordByClaimId: COORDS, articleUrl: URL
    });
    const whole = JSON.stringify(ev);
    assert.ok(!whole.includes('MODEL PROSE characterizing'), 'positions never publish');
    assert.ok(!whole.includes('COVID origins'), 'no caseName');
    assert.ok(!whole.includes('Where did it start?'), 'no scopeQuestion');
    assert.ok(!whole.includes('k1'), 'no merged_keys');
    assert.ok(!whole.includes('MODEL COPY OF A SPAN'), 'ungrounded source quote never rides as a span');
    // And each omission is declared.
    const fields = JSON.parse(ev.content).withheld.map((w) => w.field);
    for (const f of ['positions', 'case_frame', 'merged_keys', 'sources.quote', 'assertions.ungroundable']) {
        assert.ok(fields.includes(f), `withheld must name ${f}`);
    }
});

test('event shape: kind, replaceable d-tag, x hash, face-value counts, NIP anchoring', () => {
    const ev = EP.buildExtractionAnalysisEvent({
        record: record({
            assertions: [ACCEPTED, assertion({ key: 'a:9', quote: 'open span', start: 90, end: 99 })]
        }),
        coordByClaimId: COORDS, articleUrl: URL, articleTitle: 'The Story',
        articleCoord: `30023:${PUBKEY}:art-1`, createdAt: 1700
    });
    assert.equal(ev.kind, 30070);
    assert.equal(EP.EXTRACTION_ANALYSIS_KIND, 30070);
    const tag = (k) => (ev.tags.find((t) => t[0] === k) || [])[1];
    assert.equal(tag('d'), `xray-extraction:${HASH}`);
    assert.equal(EP.extractionDTag(HASH), `xray-extraction:${HASH}`);
    assert.equal(tag('x'), HASH);
    assert.equal(tag('t'), 'xray-extraction-analysis');
    assert.equal(tag('client'), 'xray');
    // The denominator on the FACE, so content-blind aggregation still
    // sees that most of this is unreviewed.
    assert.equal(tag('unreviewed'), '1');
    assert.equal(tag('endorsed'), '1');
    assert.equal(tag('dismissed'), '0');
    assert.equal(tag('ungrounded-dropped'), '2');
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

// ---- 5. round trip ---------------------------------------------------------

test('round trip: build → parse preserves states, prose namespacing, and counts', () => {
    const ev = EP.buildExtractionAnalysisEvent({
        record: record({
            assertions: [
                ACCEPTED,
                assertion({ key: 'a:9', quote: 'open span', start: 90, end: 99, status: 'open' })
            ],
            sources: [{ key: 's:1', target_hint: 'Nature', status: 'accepted', accepted_note: 'chased it' },
                      { key: 's:2', target_hint: 'Unchecked Outlet', status: 'open' }],
            open_questions: [{ key: 'q:1', text: 'Who approved it?', status: 'accepted' },
                             { key: 'q:2', text: 'And when?', status: 'open' }]
        }),
        coordByClaimId: COORDS, articleUrl: URL, articleTitle: 'The Story'
    });
    const back = EP.parseExtractionAnalysisEvent({ ...ev, kind: 30070 });
    assert.equal(back.articleHash, HASH);
    assert.equal(back.articleUrl, URL);

    assert.equal(back.assertions.length, 2);
    const acc = back.assertions.find((a) => a.status === 'accepted');
    assert.equal(acc.claim, COORDS.claim_1);
    assert.equal(acc.why, 'HUMAN rationale: this is the load-bearing step');
    assert.equal(acc.whyBy, 'user');
    assert.equal(acc.modelNote, 'MODEL RATIONALE about load-bearing-ness');
    assert.equal(acc.modelProposedText, 'MODEL PARAPHRASE of the claim');
    assert.equal(acc.generator.promptVersion, 'corpus-v7');
    const open = back.assertions.find((a) => a.status === 'unreviewed');
    assert.equal(open.why, null);
    assert.equal(open.modelNote, 'MODEL RATIONALE about load-bearing-ness', 'model prose rides on unreviewed rows too');

    assert.deepEqual(back.sources.map((s) => [s.targetHint, s.status]),
        [['Nature', 'accepted'], ['Unchecked Outlet', 'unreviewed']]);
    assert.deepEqual(back.openQuestions.map((q) => [q.text, q.status]),
        [['Who approved it?', 'accepted'], ['And when?', 'unreviewed']]);
    assert.deepEqual(back.coverage,
        { unreviewed: 1, accepted: 1, dismissed: 0, ungroundableDropped: 2 });
    assert.deepEqual(back.endorsedClaims, [COORDS.claim_1]);
    // `withheld` names only what this record actually holds back — it is
    // not a fixed manifest, so assert on the fields, not on a count.
    assert.deepEqual(back.withheld.map((w) => w.field).sort(),
        ['assertions.ungroundable', 'merged_keys']);
});

test('parse is defensive: wrong kind, malformed content, and junk rows', () => {
    assert.equal(EP.parseExtractionAnalysisEvent(null), null);
    assert.equal(EP.parseExtractionAnalysisEvent({ kind: 30068, content: '{}' }), null);
    assert.equal(EP.parseExtractionAnalysisEvent({ kind: 30070, content: 'not json' }), null);
    assert.equal(EP.parseExtractionAnalysisEvent({ kind: 30070, content: '"a string"' }), null);
    const back = EP.parseExtractionAnalysisEvent({
        kind: 30070,
        tags: [['d', `xray-extraction:${HASH}`]],
        content: JSON.stringify({
            assertions: [{ quote: 'ok', status: 'accepted' }, { no_quote: true }, null],
            sources: [{ target_hint: 'ok' }, { junk: 1 }],
            open_questions: [{ text: 'q' }, 'a bare string', 42]
        })
    });
    assert.equal(back.assertions.length, 1);
    assert.equal(back.assertions[0].generator, null, 'absent generator is null, not invented');
    assert.equal(back.sources.length, 1);
    assert.equal(back.sources[0].status, 'unreviewed', 'absent status fails safe');
    assert.deepEqual(back.openQuestions, [{ text: 'q', status: 'unreviewed' }]);
    assert.equal(back.articleHash, HASH, 'recovered from the d-tag when content omits it');
});

// ---- claim coordinate index ------------------------------------------------

test('claimCoordIndex: only PUBLISHED claims get coordinates', () => {
    const idx = EP.claimCoordIndex([
        { id: 'claim_1', publishedPubkey: PUBKEY },
        { id: 'claim_2' },
        { id: 'claim_3', publishedPubkey: 'not-hex' },
        null
    ]);
    assert.deepEqual(Object.keys(idx), ['claim_1']);
    assert.equal(idx.claim_1, `30040:${PUBKEY}:claim_1`);
    assert.deepEqual(EP.claimCoordIndex(null), {});
});

// ---- 6. the gate ----------------------------------------------------------

test('publishing is OPT-IN: the flag defaults off', async () => {
    const { FLAGS_DEFAULTS } = await import('../src/shared/metadata/feature-flags.js');
    assert.ok(Object.prototype.hasOwnProperty.call(FLAGS_DEFAULTS, 'extractionAnalysisPublishing'));
    assert.equal(FLAGS_DEFAULTS.extractionAnalysisPublishing, false,
        'a format whose safeguard is its marking does not publish by default');
});

// ---- 7. the publish SURFACE's success predicate ---------------------------

// Regression guard for a defect the MA.6 browser walk caught: the
// `xray:relay:publish` handler resolves `{ok: true, results}` when the
// ATTEMPT ran, so a caller that stops at `resp.ok` announces success even
// when every relay was unreachable — and here that also wrote a durable
// `published_at` ledger stamp. JOURNAL 2026-07-10 already rules that a
// local publish ledger keys on `confirmed`, never `successful`.
// Guarded by literal because the surface is DOM-bound and the invariant
// is exactly the kind each new publish site forgets.
test('GUARD: the publish surface stamps only on a CONFIRMED relay OK', async () => {
    const { readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const src = await readFile(join(import.meta.dirname, '../src/portal/extraction-block.js'), 'utf8');

    // Phase 29.1 moved the TRANSPORT into the publish gate, but the
    // ledger rule stayed at the call site (EVENT_STORE_DESIGN §3.2 as
    // amended). The gate resolving is NOT acceptance — it returns
    // `confirmedOk` for exactly this check. Reading only `ok` is how an
    // unreachable relay came to report "published" and stamp the record.
    assert.match(src, /confirmedOk/,
        'the surface must key on the gate’s CONFIRMED predicate, not on the call resolving');
    assert.doesNotMatch(src, /xray:relay:publish/,
        'the transport belongs to the gate — a direct send bypasses journaling too');
    assert.match(src, /successful\s*>\s*0/,
        'an assumed-only round (sent, none confirmed) must be reported distinguishably');

    // The stamp must be UNREACHABLE without the confirmed check: the
    // check has to sit between the publish call and markRecordPublished.
    const publishCall = src.indexOf('gatePublish({');
    const confirmedGate = src.indexOf('!gated.confirmedOk');
    const stamp = src.indexOf('markRecordPublished(fresh');
    assert.ok(publishCall > 0 && confirmedGate > 0 && stamp > 0, 'all three landmarks present');
    assert.ok(publishCall < confirmedGate && confirmedGate < stamp,
        'the confirmed gate must sit between the publish call and the ledger stamp');
});
