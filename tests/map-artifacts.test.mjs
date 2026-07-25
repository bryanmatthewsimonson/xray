// Durable per-article extraction layer — MA.1
// (docs/MAP_ARTIFACT_KICKOFF.md). The load-bearing pins:
//   - unreviewed ≠ disposable: assertions persist with durable triage;
//   - merge, not replace: re-folds diff IN new atoms, dedup by span
//     overlap, first-sighting provenance kept, triage preserved;
//   - claims-free storage: no claim_ref ever lands on the record;
//     coverage is computed on read against the CURRENT claim set;
//   - grounded or dropped: an ungroundable quote is counted, never
//     stored; the stored quote is the article's OWN span.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// Utils.log/error read CONFIG.debug at call time; stub chrome so the
// module graph loads headless (the standard idiom).
globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

const {
    mergeExtractIntoRecord, assertionClaimCoverage, partitionAssertions,
    setAssertionTriage, recordArticleExtraction, ASSERTION_OVERLAP_MIN,
    unionExtractWithRecord, reduceExtractFromRecord, mergeExtractionRecords,
    MAX_REDUCE_ASSERTIONS_PER_MEMBER
} = await import('../src/shared/map-artifacts.js');
const { createGroundingIndex } = await import('../src/shared/quote-grounding.js');

// A member whose text CONTAINS the quotes we ground against.
const TEXT = 'The lab leak hypothesis remains unproven. '
    + 'Gain-of-function research was funded at the Wuhan Institute. '
    + 'Zoonotic spillover is the mainstream scientific view.';

function member(over = {}) {
    return { article_hash: 'hashA', url: 'https://ex.com/a', title: 'A', text: TEXT, claims: [], ...over };
}

function extract(over = {}) {
    return {
        position: { summary: 'Argues the question is open', side_label: 'undecided' },
        key_assertions: [
            { quote: 'Gain-of-function research was funded at the Wuhan Institute', why_load_bearing: 'funding link' }
        ],
        source_references: [{ quote: 'the mainstream scientific view', target_hint: 'Nature' }],
        open_questions: ['Who approved the funding?'],
        ...over
    };
}

// ---- grounding: stored quote is the article's own span, ungrounded dropped ----

test('assertions ground against member text; the stored quote is the article span', () => {
    const { record, added, droppedUngrounded } = mergeExtractIntoRecord(null,
        { member: member(), extract: extract(), key: 'k1', model: 'm1', now: 10 });
    assert.equal(droppedUngrounded, 0);
    assert.equal(record.assertions.length, 1);
    const a = record.assertions[0];
    assert.equal(a.quote, 'Gain-of-function research was funded at the Wuhan Institute');
    assert.equal(TEXT.slice(a.start, a.end), a.quote, 'span indexes the canonical text');
    assert.equal(a.status, 'open');
    assert.equal(a.accepted_claim_id, null);
    assert.equal(a.first_seen.model, 'm1');
    assert.ok(added >= 3, 'assertion + source + open question all counted');
});

test('an ungroundable quote is dropped and counted (P6), never stored', () => {
    const { record, droppedUngrounded } = mergeExtractIntoRecord(null, {
        member: member(),
        extract: extract({ key_assertions: [{ quote: 'this phrase is nowhere in the article body at all' }] }),
        key: 'k1', now: 10
    });
    assert.equal(record.assertions.length, 0);
    assert.equal(droppedUngrounded, 1);
    assert.equal(record.dropped_ungrounded, 1, 'the drop count is stored for disclosure');
});

test('the record never stores claim_ref even when the extract carries one (claims-free storage)', () => {
    const withRef = extract();
    withRef.key_assertions[0].claim_ref = 'claim_deadbeef';
    const { record } = mergeExtractIntoRecord(null, { member: member(), extract: withRef, key: 'k1', now: 10 });
    assert.ok(!('claim_ref' in record.assertions[0]), 'claim_ref must not leak onto the durable record');
});

// ---- merge, not replace ----------------------------------------------------

test('re-folding a KNOWN fingerprint is an idempotent no-op', () => {
    const first = mergeExtractIntoRecord(null, { member: member(), extract: extract(), key: 'k1', now: 10 });
    const second = mergeExtractIntoRecord(first.record, { member: member(), extract: extract(), key: 'k1', now: 20 });
    assert.equal(second.changed, false);
    assert.equal(second.added, 0);
    assert.equal(second.record.assertions.length, 1);
    assert.equal(second.record.updatedAt, 10, 'a no-op fold does not bump updatedAt');
});

test('a NEW fingerprint with the SAME assertion span dedups (first sighting kept)', () => {
    const first = mergeExtractIntoRecord(null, { member: member(), extract: extract(), key: 'k1', model: 'm1', now: 10 });
    // Same underlying quote, different frame/prompt ⇒ different key.
    const second = mergeExtractIntoRecord(first.record, {
        member: member(), extract: extract(), key: 'k2', model: 'm2', now: 20,
        frame: { caseName: 'Other case' }
    });
    assert.equal(second.changed, true, 'a new key is folded (merged_keys grows)');
    assert.equal(second.record.assertions.length, 1, 'the overlapping assertion is not duplicated');
    assert.equal(second.record.assertions[0].first_seen.model, 'm1', 'first sighting provenance is kept');
    assert.ok(second.record.merged_keys.includes('k1') && second.record.merged_keys.includes('k2'));
});

test('a NEW, non-overlapping assertion is diffed IN', () => {
    const first = mergeExtractIntoRecord(null, { member: member(), extract: extract(), key: 'k1', now: 10 });
    const second = mergeExtractIntoRecord(first.record, {
        member: member(),
        extract: extract({ key_assertions: [{ quote: 'The lab leak hypothesis remains unproven' }] }),
        key: 'k2', now: 20
    });
    assert.equal(second.record.assertions.length, 2, 'the genuinely new atom accumulates');
});

test('a re-fold preserves triage on the surviving atom', () => {
    const first = mergeExtractIntoRecord(null, { member: member(), extract: extract(), key: 'k1', now: 10 });
    const triaged = setAssertionTriage(first.record, first.record.assertions[0].key, 'dismissed', { now: 15 });
    const second = mergeExtractIntoRecord(triaged, {
        member: member(), extract: extract(), key: 'k2', now: 20, frame: { caseName: 'X' }
    });
    assert.equal(second.record.assertions[0].status, 'dismissed', 'a dismissed atom stays dismissed across re-runs');
});

test('positions are per-frame: same frame replaces, new frame appends', () => {
    const a = mergeExtractIntoRecord(null, { member: member(), extract: extract(), key: 'k1', now: 10 });
    const b = mergeExtractIntoRecord(a.record, {
        member: member(), extract: extract({ position: { summary: 'refined', side_label: 'open' } }),
        key: 'k2', now: 20   // same (empty) frame
    });
    assert.equal(b.record.positions.length, 1, 'same frame ⇒ latest-wins');
    assert.equal(b.record.positions[0].summary, 'refined');
    const c = mergeExtractIntoRecord(b.record, {
        member: member(), extract: extract(), key: 'k3', now: 30, frame: { caseName: 'Second' }
    });
    assert.equal(c.record.positions.length, 2, 'a different frame appends beside');
});

test('the dedup threshold is span-overlap, no semantic guess', () => {
    // Two quotes with a large shared span (over the threshold) merge;
    // a small shared span does not. Uses substrings of the same text.
    const long = 'Gain-of-function research was funded at the Wuhan Institute';
    const sub = 'research was funded at the Wuhan Institute';   // ⊂ long, >60% of the shorter (itself)
    const first = mergeExtractIntoRecord(null, {
        member: member(), extract: extract({ key_assertions: [{ quote: long }] }), key: 'k1', now: 10
    });
    const second = mergeExtractIntoRecord(first.record, {
        member: member(), extract: extract({ key_assertions: [{ quote: sub }] }), key: 'k2', now: 20
    });
    assert.equal(second.record.assertions.length, 1, 'a contained span is the same atom');
    assert.ok(ASSERTION_OVERLAP_MIN > 0 && ASSERTION_OVERLAP_MIN <= 1);
});

// ---- coverage: computed on read, never stored ------------------------------

test('assertionClaimCoverage links to an existing claim by span overlap, ties to smaller id', () => {
    const rec = mergeExtractIntoRecord(null, { member: member(), extract: extract(), key: 'k1', now: 10 }).record;
    const withClaim = member({
        claims: [{ id: 'claim_9', quote: 'Gain-of-function research was funded at the Wuhan Institute' },
                 { id: 'claim_1', quote: 'Gain-of-function research was funded at the Wuhan Institute' }]
    });
    const cov = assertionClaimCoverage(rec, withClaim);
    assert.equal(cov[rec.assertions[0].key], 'claim_1', 'ties break to the smaller claim id');
});

test('assertionClaimCoverage is null when no claim overlaps', () => {
    const rec = mergeExtractIntoRecord(null, { member: member(), extract: extract(), key: 'k1', now: 10 }).record;
    const cov = assertionClaimCoverage(rec, member({ claims: [{ id: 'c', quote: 'unrelated text' }] }));
    assert.equal(cov[rec.assertions[0].key], null);
});

// ---- triage partition + apply ----------------------------------------------

test('partitionAssertions treats unknown status as OPEN (never hides an atom)', () => {
    const rec = { assertions: [{ key: 'a', status: 'open' }, { key: 'b', status: 'weird' }, { key: 'c', status: 'accepted' }] };
    const p = partitionAssertions(rec);
    assert.deepEqual(p.open.map((a) => a.key), ['a', 'b']);
    assert.deepEqual(p.accepted.map((a) => a.key), ['c']);
});

test('setAssertionTriage records the accepted claim id and clears it on re-open', () => {
    const rec = mergeExtractIntoRecord(null, { member: member(), extract: extract(), key: 'k1', now: 10 }).record;
    const key = rec.assertions[0].key;
    const acc = setAssertionTriage(rec, key, 'accepted', { claimId: 'claim_x', now: 30 });
    assert.equal(acc.assertions[0].status, 'accepted');
    assert.equal(acc.assertions[0].accepted_claim_id, 'claim_x');
    assert.equal(acc.assertions[0].triaged_at, 30);
    const reopened = setAssertionTriage(acc, key, 'open', { now: 40 });
    assert.equal(reopened.assertions[0].status, 'open');
    assert.equal(reopened.assertions[0].triaged_at, null);
});

// ---- the storage wrapper: never throws -------------------------------------

test('recordArticleExtraction folds through injected io and reports added count', async () => {
    let saved = null;
    const out = await recordArticleExtraction(
        { member: member(), extract: extract(), key: 'k1', model: 'm', frame: {} },
        { getRecord: async () => null, saveRecord: async (r) => { saved = r; }, now: () => 99 });
    assert.equal(out.status, 'saved');
    assert.ok(out.added >= 1);
    assert.equal(saved.articleHash, 'hashA');
    assert.equal(saved.updatedAt, 99);
});

test('recordArticleExtraction NEVER throws — a save failure is reported, not raised', async () => {
    const out = await recordArticleExtraction(
        { member: member(), extract: extract(), key: 'k1' },
        { getRecord: async () => null, saveRecord: async () => { throw new Error('quota'); }, now: () => 1 });
    assert.equal(out.status, 'failed');
    assert.match(out.error, /quota/);
});

test('recordArticleExtraction on a known key reports "unchanged" and re-saves nothing', async () => {
    const existing = mergeExtractIntoRecord(null, { member: member(), extract: extract(), key: 'k1', now: 5 }).record;
    let saves = 0;
    const out = await recordArticleExtraction(
        { member: member(), extract: extract(), key: 'k1' },
        { getRecord: async () => existing, saveRecord: async () => { saves++; }, now: () => 9 });
    assert.equal(out.status, 'unchanged');
    assert.equal(saves, 0);
});

test('recordArticleExtraction skips cleanly on missing member or extract', async () => {
    const out = await recordArticleExtraction({ member: null, extract: extract() },
        { getRecord: async () => null, saveRecord: async () => {} });
    assert.equal(out.status, 'skipped');
});

// ---- MA.3: the durable layer feeds the reduce -------------------------------

function storedRecord() {
    // A record accumulated across two frames: one assertion the live
    // run will re-find, one it won't, one dismissed by a human.
    const base = mergeExtractIntoRecord(null, {
        member: member(),
        extract: extract({ key_assertions: [
            { quote: 'Gain-of-function research was funded at the Wuhan Institute', why_load_bearing: 'w1' },
            { quote: 'Zoonotic spillover is the mainstream scientific view', why_load_bearing: 'w2' },
            { quote: 'The lab leak hypothesis remains unproven', why_load_bearing: 'w3' }
        ] }),
        key: 'k-old', model: 'm-old', now: 100
    }).record;
    // Human dismissed the lab-leak atom.
    const dismissedKey = base.assertions.find((a) => a.quote.startsWith('The lab leak')).key;
    return setAssertionTriage(base, dismissedKey, 'dismissed', { now: 200 });
}

test('unionExtractWithRecord: live assertions all ride; record-only ones diff in; dismissed stay out', () => {
    const rec = storedRecord();
    const live = {
        position: { summary: 'live position', side_label: 'x' },
        key_assertions: [{ quote: 'Gain-of-function research was funded at the Wuhan Institute', why_load_bearing: 'live-why' }]
    };
    const idx = createGroundingIndex(member().text);
    const out = unionExtractWithRecord(live, rec, idx);
    const quotes = out.key_assertions.map((a) => a.quote);
    assert.equal(quotes.length, 2, 'one live + one record-only');
    assert.equal(quotes[0], 'Gain-of-function research was funded at the Wuhan Institute', 'live first, untouched');
    assert.equal(out.key_assertions[0].why_load_bearing, 'live-why', 'the live atom is not replaced by the stored twin');
    assert.ok(quotes.includes('Zoonotic spillover is the mainstream scientific view'), 'the record-only atom joined');
    assert.ok(!quotes.some((q) => q.startsWith('The lab leak')), 'a dismissed atom never re-enters the reduce');
    assert.equal(out.position.summary, 'live position', 'the live position wins');
});

test('unionExtractWithRecord: the cap protects the reduce, live atoms are never dropped', () => {
    const rec = storedRecord();
    const manyLive = {
        position: { summary: 's' },
        key_assertions: Array.from({ length: MAX_REDUCE_ASSERTIONS_PER_MEMBER + 3 },
            (_, i) => ({ quote: `live quote ${i}` }))
    };
    const out = unionExtractWithRecord(manyLive, rec, createGroundingIndex(member().text));
    assert.equal(out.key_assertions.length, MAX_REDUCE_ASSERTIONS_PER_MEMBER + 3,
        'over-cap LIVE output rides in full — only record extras are capped (to zero here)');
});

test('reduceExtractFromRecord: recovery for a failed member — latest position + open/accepted atoms', () => {
    let rec = storedRecord();
    // A second frame's position, newer.
    rec = mergeExtractIntoRecord(rec, {
        member: member(),
        extract: { position: { summary: 'newer position', side_label: 'later' }, key_assertions: [] },
        key: 'k-new', now: 300, frame: { caseName: 'Another case' }
    }).record;
    const out = reduceExtractFromRecord(rec);
    assert.equal(out.position.summary, 'newer position', 'latest stored position');
    assert.equal(out.key_assertions.length, 2, 'open atoms ride, the dismissed one does not');
    assert.ok(out.key_assertions.every((a) => a.quote && typeof a.why_load_bearing === 'string'));
    assert.equal(reduceExtractFromRecord(null), null);
    assert.equal(reduceExtractFromRecord({ assertions: [], positions: [] }), null, 'an empty record recovers nothing');
});

// ---- record ⊕ record: the backup merge-import path --------------------------

test('mergeExtractionRecords: incoming-only atoms accrue; overlapping ones keep the local atom', () => {
    const local = storedRecord();
    const incoming = mergeExtractIntoRecord(null, {
        member: member(),
        extract: extract({ key_assertions: [
            { quote: 'Gain-of-function research was funded at the Wuhan Institute', why_load_bearing: 'foreign-why' },
            { quote: 'Police confirmed nothing at all', why_load_bearing: 'unfindable' }   // won't ground
        ] }),
        key: 'k-foreign', model: 'm-foreign', now: 500
    }).record;
    const { record, changed } = mergeExtractionRecords(local, incoming);
    assert.equal(changed, true, 'merged_keys accrue even when atoms dedup');
    const gof = record.assertions.find((a) => a.quote.startsWith('Gain-of-function'));
    assert.equal(gof.why, 'w1', 'the local atom wins on overlap — foreign copy never replaces it');
    assert.ok(record.merged_keys.includes('k-old') && record.merged_keys.includes('k-foreign'));
});

test('mergeExtractionRecords: a foreign human triage is adopted onto an OPEN local atom, never over a local decision', () => {
    const local = storedRecord();
    // Foreign side accepted the zoonosis atom and dismissed the GOF one;
    // locally the GOF atom is open and lab-leak is already dismissed.
    let incoming = storedRecord();
    const zooKey = incoming.assertions.find((a) => a.quote.startsWith('Zoonotic')).key;
    const gofKey = incoming.assertions.find((a) => a.quote.startsWith('Gain-of-function')).key;
    const labKey = incoming.assertions.find((a) => a.quote.startsWith('The lab leak')).key;
    incoming = setAssertionTriage(incoming, zooKey, 'accepted', { claimId: 'claim_foreign', now: 900 });
    incoming = setAssertionTriage(incoming, gofKey, 'dismissed', { now: 901 });
    incoming = setAssertionTriage(incoming, labKey, 'accepted', { claimId: 'claim_conflict', now: 902 });

    const { record } = mergeExtractionRecords(local, incoming);
    const zoo = record.assertions.find((a) => a.quote.startsWith('Zoonotic'));
    const gof = record.assertions.find((a) => a.quote.startsWith('Gain-of-function'));
    const lab = record.assertions.find((a) => a.quote.startsWith('The lab leak'));
    assert.equal(zoo.status, 'accepted', 'a decision made anywhere beats undecided');
    assert.equal(zoo.accepted_claim_id, 'claim_foreign');
    assert.equal(gof.status, 'dismissed', 'foreign dismissal adopted onto an open atom');
    assert.equal(lab.status, 'dismissed', 'CONFLICTING decisions resolve to the LOCAL one');
});

test('mergeExtractionRecords: null sides, positions latest-wins per frame, counts take max', () => {
    const local = storedRecord();
    assert.deepEqual(mergeExtractionRecords(local, null), { record: local, changed: false });
    assert.deepEqual(mergeExtractionRecords(null, local), { record: local, changed: true });
    const incoming = {
        ...storedRecord(),
        positions: [{ caseName: '', scopeQuestion: '', summary: 'newer intrinsic', side_label: null, at: 9999 }],
        dropped_ungrounded: 7,
        updatedAt: 9999
    };
    const { record } = mergeExtractionRecords(local, incoming);
    assert.equal(record.positions.find((p) => !p.caseName).summary, 'newer intrinsic', 'same frame → newer at wins');
    assert.equal(record.dropped_ungrounded, 7, 'counts take max, never a double-counting sum');
    assert.equal(record.updatedAt, 9999);
});
