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
    mergeExtractIntoRecord, assertionClaimCoverage, partitionAssertions, normalizeExtractionRecord,
    setAssertionTriage, recordArticleExtraction, ASSERTION_OVERLAP_MIN,
    unionExtractWithRecord, reduceExtractFromRecord, mergeExtractionRecords,
    MAX_REDUCE_ASSERTIONS_PER_MEMBER, isTextPinnedKey, suggestExtractFromProposals,
    setAssertionRationale, setRowTriage, markRecordPublished
} = await import('../src/shared/map-artifacts.js');
const { createGroundingIndex } = await import('../src/shared/quote-grounding.js');

// A member whose text CONTAINS the quotes we ground against.
const TEXT = 'The lab leak hypothesis remains unproven. '
    + 'Gain-of-function research was funded at the Wuhan Institute. '
    + 'Zoonotic spillover is the mainstream scientific view.';

// A real 64-hex content hash: the merge path only trusts spans under a
// text-PINNED key (isTextPinnedKey), so a fixture with a toy id would
// silently skip every merge assertion below.
const HASH_A = 'a'.repeat(64);

function member(over = {}) {
    return { article_hash: HASH_A, url: 'https://ex.com/a', title: 'A', text: TEXT, claims: [], ...over };
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
    assert.equal(saved.articleHash, HASH_A);
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

// ---- MA.4: both producers share ONE layer ----------------------------------

test('suggestExtractFromProposals: only quote-bearing CLAIM proposals become atoms', () => {
    const out = suggestExtractFromProposals([
        { kind: 'claim', text: 'Funding went to Wuhan', quote: 'Gain-of-function research was funded at the Wuhan Institute' },
        { kind: 'claim', text: 'no quote so not an atom' },              // dropped: nothing to ground
        { kind: 'claim', text: 'blank quote', quote: '   ' },            // dropped
        { kind: 'entity', name: 'WIV', entity_type: 'organization' },    // not claim-shaped
        { kind: 'assessment', claim_ref: 'c1', stance: 1 },
        { kind: 'finding', subject_ref: 'e1' },
        null
    ]);
    assert.equal(out.key_assertions.length, 1, 'entities/assessments/findings are NOT this layer\'s business');
    assert.equal(out.key_assertions[0].text, 'Funding went to Wuhan');
    assert.equal(out.key_assertions[0].why_load_bearing, '');
    assert.deepEqual(suggestExtractFromProposals(null).key_assertions, []);
});

test('MA.4: a suggest fold stamps producer + suggested text, and dedups against a MAP atom on the same span', () => {
    // The map found this sentence first.
    const mapped = mergeExtractIntoRecord(null, {
        member: member(), extract: extract(), key: 'k-map', model: 'm-map', now: 10
    }).record;
    assert.equal(mapped.assertions[0].first_seen.producer, 'map');
    assert.equal(mapped.assertions[0].text, null, 'a map atom carries no authored claim text');

    // The reader's suggest pass proposes the SAME sentence plus a new one.
    const sugg = suggestExtractFromProposals([
        { kind: 'claim', text: 'Funding claim', quote: 'Gain-of-function research was funded at the Wuhan Institute' },
        { kind: 'claim', text: 'Spillover is mainstream', quote: 'Zoonotic spillover is the mainstream scientific view' }
    ]);
    const out = mergeExtractIntoRecord(mapped, {
        member: member(), extract: sugg, model: 'm-suggest', now: 20, producer: 'suggest'
    });
    assert.equal(out.changed, true);
    assert.equal(out.added, 1, 'the overlapping sentence is ONE atom, not two rows');
    assert.equal(out.record.assertions.length, 2);
    const kept = out.record.assertions.find((a) => a.quote.startsWith('Gain-of-function'));
    assert.equal(kept.first_seen.producer, 'map', 'first sighting wins — the map found it');
    const fresh = out.record.assertions.find((a) => a.quote.startsWith('Zoonotic'));
    assert.equal(fresh.first_seen.producer, 'suggest');
    assert.equal(fresh.text, 'Spillover is mainstream', 'the suggest pass\'s authored claim text rides along');
});

test('MA.4: a KEYLESS fold that adds nothing reports changed:false (no pointless rewrite)', () => {
    const rec = mergeExtractIntoRecord(null, {
        member: member(), extract: extract(), key: 'k1', now: 10
    }).record;
    // Same sentence, no fingerprint — the suggest path's shape.
    const again = mergeExtractIntoRecord(rec, {
        member: member(),
        extract: suggestExtractFromProposals([
            { kind: 'claim', text: 't', quote: 'Gain-of-function research was funded at the Wuhan Institute' }
        ]),
        now: 99, producer: 'suggest'
    });
    assert.equal(again.changed, false, 'every Suggest run must not bump updatedAt for nothing');
    assert.equal(again.added, 0);
    assert.equal(again.record.updatedAt, 10, 'the stored record is returned untouched');
    // A keyed fold still counts as changed even when atoms dedup (the
    // merged_keys ledger is what makes the NEXT identical fold free).
    const keyed = mergeExtractIntoRecord(rec, {
        member: member(), extract: extract(), key: 'k2', now: 50
    });
    assert.equal(keyed.changed, true);
});

test('MA.4: an ungroundable suggest quote is dropped and counted, never stored', () => {
    const out = mergeExtractIntoRecord(null, {
        member: member(),
        extract: suggestExtractFromProposals([
            { kind: 'claim', text: 'nope', quote: 'this sentence is not in the article at all' }
        ]),
        now: 5, producer: 'suggest'
    });
    assert.equal(out.record.assertions.length, 0);
    assert.equal(out.droppedUngrounded, 1);
    assert.equal(out.changed, true, 'a first-ever record with a disclosed drop count is worth storing');
});

test('MA.4: an unknown producer value normalizes to map — never an arbitrary string', () => {
    const out = mergeExtractIntoRecord(null, {
        member: member(), extract: extract(), key: 'k', now: 1, producer: 'something-else'
    });
    assert.equal(out.record.assertions[0].first_seen.producer, 'map');
});

// ---- MA.6: the review fields the publish projection reads -------------------

test('MA.6 setAssertionRationale: accept, edit-flips-provenance, and withdraw', () => {
    const rec = mergeExtractIntoRecord(null, {
        member: member(), extract: extract(), key: 'k1', model: 'm', now: 10
    }).record;
    const key = rec.assertions[0].key;

    // Accepting the model's draft keeps it attributed to the model.
    const a = setAssertionRationale(rec, key, '  carries the funding argument  ', { now: 20 });
    assert.equal(a.assertions[0].accepted_why, 'carries the funding argument', 'trimmed');
    assert.equal(a.assertions[0].accepted_why_provenance, 'llm');
    assert.equal(a.assertions[0].rationale_accepted_at, 20);

    // An edited rationale is the human's words.
    const b = setAssertionRationale(a, key, 'my own wording', { provenance: 'user', now: 30 });
    assert.equal(b.assertions[0].accepted_why_provenance, 'user');

    // Withdrawing leaves the atom accepted but rationale-less.
    const c = setAssertionRationale(b, key, null, { now: 40 });
    assert.equal(c.assertions[0].accepted_why, null);
    assert.equal(c.assertions[0].accepted_why_provenance, null);
    // Blank/whitespace is a withdrawal, not an empty rationale.
    assert.equal(setAssertionRationale(b, key, '   ', { now: 41 }).assertions[0].accepted_why, null);
    // The model's own draft is never touched.
    assert.equal(c.assertions[0].why, 'funding link');
});

test('MA.6 setRowTriage: sources and open questions are individually acceptable', () => {
    const rec = mergeExtractIntoRecord(null, {
        member: member(), extract: extract(), key: 'k1', now: 10
    }).record;
    const srcKey = rec.sources[0].key;
    const qKey = rec.open_questions[0].key;

    const withSrc = setRowTriage(rec, 'sources', srcKey, 'accepted', { now: 20, note: 'chased it' });
    assert.equal(withSrc.sources[0].status, 'accepted');
    assert.equal(withSrc.sources[0].triaged_at, 20);
    assert.equal(withSrc.sources[0].accepted_note, 'chased it');

    const withQ = setRowTriage(withSrc, 'open_questions', qKey, 'dismissed', { now: 21 });
    assert.equal(withQ.open_questions[0].status, 'dismissed');

    // Re-opening clears the triage stamp.
    assert.equal(setRowTriage(withQ, 'open_questions', qKey, 'open', { now: 22 })
        .open_questions[0].triaged_at, null);
    // A bad list name is a programming error, not a silent no-op.
    assert.throws(() => setRowTriage(rec, 'assertions', 'x', 'accepted'), /unknown list/);
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

// ---- MA.7: the import re-grounds, and adopts nothing ------------------
//
// The old contract trusted the incoming record's start/end. It could
// not: `articleHash` hashes normalizeForHash(body) while spans index the
// UN-normalized body, so two machines inside one hash equivalence class
// agree on the hash and disagree on offsets. These pin the new contract.

// A LOCAL body that differs from the fixture TEXT only in whitespace —
// same articleHash class, different offsets. This is the exact shape of
// the bug, and every atom below must still land correctly.
const TEXT_TWIN = TEXT.replace(/\n/g, '\r\n').replace(/ /g, '  ');

// ---- the import boundary is a TRUST boundary --------------------------
//
// A backup file is arbitrary JSON authored on another machine, and
// mergeExtractionRecords runs INSIDE an IndexedDB transaction handler:
// a throw there does not lose one row, it aborts the transaction and
// fails the WHOLE restore with a bare AbortError. So the merge must be
// TOTAL — never throwing, for any input a file can contain.

test('the merge never throws on a hostile incoming record (a throw aborts the whole restore)', () => {
    const local = storedRecord();
    const HOSTILE = [
        ['assertions as object',      { assertions: { 0: { quote: 'x' } } }],
        ['assertions as string',      { assertions: 'not a list' }],
        ['positions as object',       { positions: { a: 1 } }],
        ['positions as string',       { positions: 'xyz' }],
        ['sources as number',         { sources: 7 }],
        ['open_questions as bool',    { open_questions: true }],
        ['merged_keys as object',     { merged_keys: { k: 1 } }],
        ['null rows inside lists',    { assertions: [null, 'junk'], sources: [null], positions: [null] }],
        ['updatedAt as object',       { updatedAt: {} }],
        ['dropped_ungrounded string', { dropped_ungrounded: 'soon' }],
        ['everything at once',        { assertions: 'a', positions: 1, sources: {}, open_questions: null,
                                        merged_keys: 3, updatedAt: [], dropped_ungrounded: {} }]
    ];
    for (const [label, over] of HOSTILE) {
        const incoming = { ...storedRecord(), ...over };
        assert.doesNotThrow(() => mergeExtractionRecords(local, incoming, { localText: TEXT, now: 1 }), label);
        // And the LOCAL side too — a row written by an earlier restore,
        // before this guard existed, is already sitting in IndexedDB.
        assert.doesNotThrow(
            () => mergeExtractionRecords({ ...storedRecord(), ...over }, storedRecord(), { localText: TEXT, now: 1 }),
            label + ' (local side)');
    }
});

test('a string list is not iterated as CHARACTERS (worse than a throw)', () => {
    // `for (const x of "abc")` yields "a","b","c" — each non-empty, so
    // each survives the row guards and could be pushed as a row.
    const out = mergeExtractionRecords(storedRecord(),
        { ...storedRecord(), open_questions: 'abc', sources: 'xyz' },
        { localText: TEXT, now: 1 });
    for (const row of out.record.open_questions) assert.equal(typeof row, 'object');
    for (const row of out.record.sources) assert.equal(typeof row, 'object');
});

test('a non-numeric updatedAt does not persist NaN (which would make `changed` true forever)', () => {
    const out = mergeExtractionRecords(storedRecord(),
        { ...storedRecord(), updatedAt: {}, dropped_ungrounded: 'soon' },
        { localText: TEXT, now: 1 });
    assert.ok(Number.isFinite(out.record.updatedAt), 'updatedAt stays a real number');
    assert.ok(Number.isFinite(out.record.dropped_ungrounded));
    // NaN !== NaN would flip `changed` on every re-import, forever.
    const again = mergeExtractionRecords(out.record, out.record, { localText: TEXT, now: 1 });
    assert.equal(again.changed, false, 're-merging an identical record is a no-op');
});

test('normalizeExtractionRecord drops what carries no meaning and invents nothing', () => {
    assert.equal(normalizeExtractionRecord(null), null);
    assert.equal(normalizeExtractionRecord('a row'), null);
    assert.equal(normalizeExtractionRecord([]), null, 'an array is not a record');

    const n = normalizeExtractionRecord({
        articleHash: 'h', url: 5, title: {}, assertions: [null, { quote: 'q' }, 'junk'],
        sources: 'nope', merged_keys: ['ok', 7], updatedAt: 'later', extra_field: 'kept'
    });
    assert.deepEqual(n.assertions, [{ quote: 'q' }], 'unusable rows drop, the good one survives');
    assert.deepEqual(n.sources, []);
    assert.deepEqual(n.merged_keys, ['ok'], 'merged_keys are strings');
    assert.equal(n.url, null, 'a non-string url is no url, not "5"');
    assert.equal(n.title, null);
    assert.equal(n.updatedAt, 0);
    assert.equal(n.extra_field, 'kept', 'unknown fields ride through — this is not a whitelist');
});

test('MA.7: the merge REFUSES without local text — there is no degraded mode', () => {
    const local = storedRecord();
    const out = mergeExtractionRecords(local, storedRecord());
    assert.equal(out.skipped, 'no-local-text');
    assert.equal(out.changed, false);
    assert.equal(out.record, local, 'nothing is written when nothing can be verified');
    // Empty string is not text either.
    assert.equal(mergeExtractionRecords(local, storedRecord(), { localText: '' }).skipped, 'no-local-text');
    // And the refusal precedes any span arithmetic: a wholesale add of a
    // record this machine has no text for is refused too.
    assert.equal(mergeExtractionRecords(null, storedRecord()).skipped, 'no-local-text');
});

test('MA.7: incoming atoms are re-located in the LOCAL text, foreign offsets ignored', () => {
    // The incoming record's spans index a whitespace-divergent twin, so
    // its offsets are WRONG here by construction. Prove they are unused.
    const incoming = mergeExtractIntoRecord(null, {
        member: member({ text: TEXT_TWIN }),
        extract: extract({ key_assertions: [
            { quote: 'Gain-of-function research was funded at the Wuhan Institute', why_load_bearing: 'foreign-why' }
        ] }),
        key: 'k-foreign', model: 'm-foreign', now: 500
    }).record;
    const foreignAtom = incoming.assertions.find((a) => a.quote.includes('Gain-of-function'));
    assert.ok(TEXT.slice(foreignAtom.start, foreignAtom.end) !== foreignAtom.quote,
        'precondition: the foreign span does NOT index the local text');

    // Merged against a record with no such atom, so it must be ADDED.
    const bare = { ...storedRecord(), assertions: [] };
    const { record, counts } = mergeExtractionRecords(bare, incoming, { localText: TEXT, now: 1000 });
    assert.equal(counts.unlocated, 0);
    const added = record.assertions.find((a) => a.quote.includes('Gain-of-function'));
    assert.ok(added, 'the atom landed');
    assert.equal(TEXT.slice(added.start, added.end), added.quote,
        'the STORED span indexes the LOCAL text — this is the whole fix');
    assert.equal(added.key, `a:${added.start}-${added.end}`, 'the key is recomputed from local coordinates');
    assert.equal(added.first_seen.imported, true, 'provenance on its face');
});

test('MA.7: a whitespace-divergent twin dedups by QUOTE, not by span', () => {
    // Same sentence, both machines — offsets differ, so span overlap
    // alone could miss the twin. Untruncated quote identity finds it.
    const local = storedRecord();
    const incoming = mergeExtractIntoRecord(null, {
        member: member({ text: TEXT_TWIN }), extract: extract(),
        key: 'k-foreign', model: 'm-foreign', now: 500
    }).record;
    const before = local.assertions.length;
    const { record } = mergeExtractionRecords(local, incoming, { localText: TEXT, now: 1000 });
    const gof = record.assertions.filter((a) => a.quote.includes('Gain-of-function'));
    assert.equal(gof.length, 1, 'ONE atom, not a near-duplicate pair');
    assert.equal(gof[0].why, 'w1', 'the local atom wins — the foreign copy never replaces it');
    assert.equal(record.assertions.length, before, 'no atom was invented');
});

test('MA.7: an unlocatable incoming quote is REFUSED and disclosed, never stored', () => {
    const local = { ...storedRecord(), assertions: [] };
    const incoming = {
        ...storedRecord(),
        assertions: [{
            key: 'a:0-10', quote: 'THIS SENTENCE IS NOWHERE IN THE LOCAL ARTICLE',
            start: 0, end: 45, status: 'accepted', accepted_claim_id: 'claim_foreign',
            first_seen: { model: 'm-foreign', promptVersion: 'corpus-v7', at: 5 }
        }]
    };
    const { record, counts } = mergeExtractionRecords(local, incoming, { localText: TEXT, now: 1000 });
    assert.equal(counts.unlocated, 1);
    assert.equal(counts.regrounded, 0);
    assert.equal(record.assertions.length, 0, 'a quote that cannot be located never becomes a proposal (P3/P4)');
    // Disclosed as a finding, not swallowed into dropped_ungrounded.
    assert.equal((record.imported_unlocated || []).length, 1);
    assert.ok(record.imported_unlocated[0].quote.startsWith('THIS SENTENCE'));
    assert.equal(record.dropped_ungrounded, local.dropped_ungrounded,
        'the published ungroundable counter is NOT overloaded with import failures');
});

test('MA.7: a foreign ruling is ATTRIBUTED, never adopted as the local decision', () => {
    const local = storedRecord();
    let incoming = storedRecord();
    const zooKey = incoming.assertions.find((a) => a.quote.startsWith('Zoonotic')).key;
    const labKey = incoming.assertions.find((a) => a.quote.startsWith('The lab leak')).key;
    incoming = setAssertionTriage(incoming, zooKey, 'accepted', { claimId: 'claim_foreign', now: 900 });
    incoming = setAssertionRationale(incoming, zooKey, 'the foreign reason', { provenance: 'user', now: 900 });
    incoming = setAssertionTriage(incoming, labKey, 'accepted', { claimId: 'claim_conflict', now: 902 });

    const { record, counts } = mergeExtractionRecords(local, incoming, { localText: TEXT, now: 1000 });
    const zoo = record.assertions.find((a) => a.quote.startsWith('Zoonotic'));
    const lab = record.assertions.find((a) => a.quote.startsWith('The lab leak'));

    // The local atom's OWN triage is untouched — a file cannot rule.
    assert.equal(zoo.status, 'open', 'an imported accept does NOT become the local decision');
    assert.equal(zoo.accepted_claim_id, null, 'no foreign claim id lands in a local field');
    assert.ok(!zoo.accepted_why, "the signer's own rationale field stays empty");
    // It rides attributed and inert instead.
    assert.equal(zoo.imported_ruling.status, 'accepted');
    assert.equal(zoo.imported_ruling.foreign_claim_id, 'claim_foreign');
    assert.equal(zoo.imported_ruling.why, 'the foreign reason',
        'the rationale survives — the old adoption silently dropped it');
    assert.equal(counts.importedRulings >= 1, true);
    // partitionAssertions must still see it as open: attribution is not triage.
    assert.ok(partitionAssertions(record).open.some((a) => a.quote.startsWith('Zoonotic')));

    // A local atom that ALREADY has a ruling gets no imported_ruling at all.
    assert.equal(lab.status, 'dismissed', 'the local decision stands');
    assert.equal(lab.imported_ruling, undefined, 'no attribution over an existing local ruling');
});

test('MA.7: foreign merged_keys and publish stamps are never imported', () => {
    const local = { ...storedRecord(), merged_keys: ['k-local'] };
    const incoming = {
        ...storedRecord(),
        merged_keys: ['k-foreign'],
        published_at: 12345,
        published_event_id: 'e'.repeat(64)
    };
    const { record } = mergeExtractionRecords(local, incoming, { localText: TEXT, now: 1000 });
    assert.deepEqual(record.merged_keys, ['k-local'],
        'a foreign fingerprint would suppress this machine’s own fold of its own paid extract');
    assert.equal(record.published_at, undefined, 'a publish ledger is a claim about what THIS identity signed');
    assert.equal(record.published_event_id, undefined);

    // Same on the wholesale-add path — the old code adopted the object.
    const fresh = mergeExtractionRecords(null, incoming, { localText: TEXT, now: 1000 });
    assert.deepEqual(fresh.record.merged_keys, []);
    assert.equal(fresh.record.published_at, undefined);
    assert.equal(fresh.record.published_event_id, undefined);
});

test('mergeExtractionRecords: an UNPINNED (url:) key is refused before anything else', () => {
    // buildMemberUnits keys a member `url:<sha16>` when the archive row
    // has no canonical hash. That key names a URL, not a text, so two
    // installs can hold same-key records over DIFFERENT bodies.
    const local = { ...storedRecord(), articleHash: 'url:abc123' };
    const incoming = { ...storedRecord(), articleHash: 'url:abc123' };
    const out = mergeExtractionRecords(local, incoming, { localText: TEXT });
    assert.equal(out.skipped, 'unpinned-key', 'refused even WITH text — the key names no text to be the right one');
    assert.equal(out.changed, false);
    assert.equal(out.record, local, 'the local record is returned untouched');
    const add = mergeExtractionRecords(null, incoming, { localText: TEXT });
    assert.equal(add.skipped, 'unpinned-key');
    assert.equal(add.changed, false);
    assert.equal(isTextPinnedKey('a'.repeat(64)), true);
    assert.equal(isTextPinnedKey('url:abc123'), false);
    assert.equal(isTextPinnedKey(''), false);
    assert.equal(isTextPinnedKey('A'.repeat(64)), false, 'uppercase is not the canonical form');
    assert.equal(mergeExtractionRecords(storedRecord(), storedRecord(), { localText: TEXT }).skipped, undefined);
});

test('mergeExtractionRecords: null sides, positions latest-wins per frame, counts take max', () => {
    const local = storedRecord();
    assert.deepEqual(mergeExtractionRecords(local, null), { record: local, changed: false });
    const incoming = {
        ...storedRecord(),
        positions: [{ caseName: '', scopeQuestion: '', summary: 'newer intrinsic', side_label: null, at: 9999 }],
        dropped_ungrounded: 7,
        updatedAt: 9999
    };
    const { record } = mergeExtractionRecords(local, incoming, { localText: TEXT, now: 1000 });
    assert.equal(record.positions.find((p) => !p.caseName).summary, 'newer intrinsic', 'same frame → newer at wins');
    assert.equal(record.dropped_ungrounded, 7, 'counts take max, never a double-counting sum');
    assert.equal(record.updatedAt, 9999);
});

test('MA.7: re-importing the same file twice is a no-op', () => {
    const incoming = storedRecord();
    const first = mergeExtractionRecords(null, incoming, { localText: TEXT, now: 1000 });
    assert.equal(first.changed, true);
    const second = mergeExtractionRecords(first.record, incoming, { localText: TEXT, now: 2000 });
    assert.equal(second.changed, false, 'idempotent without a merged_keys ledger — quote identity carries it');
    assert.equal(second.record.assertions.length, first.record.assertions.length);
});

test('markRecordPublished: a LEDGER stamp — it never gates accrual', () => {
    const rec = storedRecord();
    const stamped = markRecordPublished(rec, { eventId: 'e'.repeat(64), now: 5000 });
    assert.equal(stamped.published_at, 5000);
    assert.equal(stamped.published_event_id, 'e'.repeat(64));
    assert.deepEqual(stamped.assertions, rec.assertions, 'publishing changes no analysis state');

    // A later fold accrues onto a published record and deliberately
    // LEAVES the stamp: the surface must be able to say both "published
    // on the 5th" and "3 atoms found since".
    // Stamp a record holding ONE atom, then accrue a DIFFERENT sentence
    // of the same text. (A quote overlapping an existing atom would
    // correctly dedup, and one absent from TEXT would correctly refuse —
    // neither would exercise accrual.)
    const oneAtom = markRecordPublished(mergeExtractIntoRecord(null, {
        member: member(),
        extract: extract({ key_assertions: [
            { quote: 'The lab leak hypothesis remains unproven', why_load_bearing: 'w' }] }),
        key: 'k-one', model: 'm', now: 100
    }).record, { eventId: 'e'.repeat(64), now: 5000 });
    const { record, changed } = mergeExtractionRecords(oneAtom, {
        ...oneAtom,
        assertions: [{ key: 'a:900-950', quote: 'Zoonotic spillover is the mainstream scientific view',
                       start: 900, end: 950, status: 'open',
                       first_seen: { model: 'm', promptVersion: 'corpus-v7', at: 6000 } }],
        updatedAt: 6000
    }, { localText: TEXT, now: 6000 });
    assert.equal(changed, true);
    assert.equal(record.published_at, 5000, 'accrual does not clear the publish stamp');
    assert.ok(record.assertions.length > oneAtom.assertions.length,
        'the new sentence accrued onto a published record');

    // No event id (a publish that never got one back) is null, not absent.
    assert.equal(markRecordPublished(rec, { now: 1 }).published_event_id, null);
});
