// Extraction-record import planning — MA.7
// (docs/MAP_ARTIFACT_KICKOFF.md §MA.7).
//
// The planner exists because the body a quote must be re-grounded
// against lives in a DIFFERENT IndexedDB database than the merge
// transaction, so it cannot be fetched from inside that transaction at
// all. These pin the properties that makes the arrangement safe:
//
//   1. bodies are resolved BEFORE any transaction, in bounded chunks;
//   2. a body-lookup failure REFUSES rather than degrading to trusting
//      foreign offsets;
//   3. the two refusal reasons stay distinct ("I hold no copy" is a gap,
//      "your quote is not in the copy I hold" is a finding);
//   4. the report is written for a human who has to decide what to do.

import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

const { mergeExtractionRows, describeImportRefusals, IMPORT_CHUNK_RECORDS } =
    await import('../src/shared/extraction-import.js');

const BODY = 'Intro.\n\nThe audit was never delivered to the council.\n\nA second finding sits here.\n';
const HASH = 'a'.repeat(64);

const row = (over = {}) => ({
    articleHash: HASH, url: 'https://ex.test/a', title: 'A',
    assertions: [{
        key: 'a:0-10', quote: 'The audit was never delivered to the council',
        start: 999, end: 1042,   // deliberately WRONG offsets
        status: 'open', why: 'w',
        first_seen: { model: 'm', promptVersion: 'corpus-v7', at: 1 }
    }],
    sources: [], open_questions: [], positions: [],
    merged_keys: [], dropped_ungrounded: 0, updatedAt: 1,
    ...over
});

// A runChunk that behaves like backup.js's mergeRows: applies the deep
// merge against a fake store and reports the four counters.
function fakeStore(initial = {}) {
    const store = { ...initial };
    const runChunk = async (rows, deepMerge) => {
        const stats = { added: 0, merged: 0, kept: 0, skipped: 0 };
        for (const r of rows) {
            const existing = store[r.articleHash];
            const m = deepMerge(existing === undefined ? undefined : existing, r);
            if (m && m.skipped) { stats.skipped += 1; continue; }
            if (m && m.changed) {
                store[r.articleHash] = m.record;
                if (existing === undefined) stats.added += 1; else stats.merged += 1;
            } else stats.kept += 1;
        }
        return stats;
    };
    return { store, runChunk };
}

test('the planner re-grounds against the resolved body and IGNORES foreign offsets', async () => {
    const { store, runChunk } = fakeStore();
    const out = await mergeExtractionRows([row()], runChunk, {
        bodies: async () => new Map([[HASH, { text: BODY, url: 'https://ex.test/a', vintage: 'current' }]]),
        now: () => 1000
    });
    assert.equal(out.stats.added, 1);
    assert.equal(out.refusals.regroundedQuotes, 1);
    assert.equal(out.refusals.noLocalText, 0);
    const a = store[HASH].assertions[0];
    assert.equal(BODY.slice(a.start, a.end), a.quote, 'the stored span indexes the LOCAL body');
    assert.notEqual(a.start, 999, 'the foreign offset was discarded');
});

test('no local body ⇒ REFUSED, named by URL, and nothing written', async () => {
    const { store, runChunk } = fakeStore();
    const out = await mergeExtractionRows([row()], runChunk, {
        bodies: async () => new Map(),   // this machine holds no copy
        now: () => 1000
    });
    assert.equal(out.stats.skipped, 1);
    assert.equal(out.stats.added, 0);
    assert.equal(store[HASH], undefined);
    assert.equal(out.refusals.noLocalText, 1);
    assert.deepEqual(out.unresolved.map((u) => u.url), ['https://ex.test/a'],
        'the report names WHICH article, so the user can capture it');
});

test('a body-lookup FAILURE refuses too — it never degrades to trusting offsets', async () => {
    const { store, runChunk } = fakeStore();
    const out = await mergeExtractionRows([row()], runChunk, {
        bodies: async () => { throw new Error('idb exploded'); },
        now: () => 1000
    });
    assert.equal(out.stats.skipped, 1);
    assert.equal(store[HASH], undefined, 'a failed lookup must not become a silent trust');
    assert.equal(out.refusals.noLocalText, 1);
});

test('an unpinned url: key is refused before the text question is even asked', async () => {
    const { runChunk } = fakeStore();
    let asked = null;
    const out = await mergeExtractionRows([row({ articleHash: 'url:deadbeef' })], runChunk, {
        bodies: async (hashes) => { asked = hashes; return new Map(); },
        now: () => 1000
    });
    assert.equal(out.refusals.unpinnedKey, 1);
    assert.equal(asked, null, 'the archive is not even opened for a key that names no text');
    assert.equal(out.refusals.noLocalText, 0, 'and it is NOT miscounted as a missing body');
});

test('chunking: bodies are resolved per chunk, and the loop yields between them', async () => {
    const many = [];
    for (let i = 0; i < IMPORT_CHUNK_RECORDS + 5; i++) {
        many.push(row({ articleHash: String(i).padStart(64, '0') }));
    }
    const { runChunk } = fakeStore();
    const calls = [];
    let yields = 0;
    await mergeExtractionRows(many, runChunk, {
        bodies: async (hashes) => { calls.push(hashes.length); return new Map(); },
        now: () => 1, yieldNow: async () => { yields += 1; }
    });
    assert.equal(calls.length, 2, 'two chunks for 30 records at a 25 cap');
    assert.deepEqual(calls, [IMPORT_CHUNK_RECORDS, 5]);
    assert.equal(yields, 1, 'yielded between chunks, not after the last one');
});

test('progress is reported per chunk so a big import does not look hung', async () => {
    const many = [];
    for (let i = 0; i < IMPORT_CHUNK_RECORDS + 1; i++) {
        many.push(row({ articleHash: String(i).padStart(64, '0') }));
    }
    const { runChunk } = fakeStore();
    const seen = [];
    await mergeExtractionRows(many, runChunk, {
        bodies: async () => new Map(), now: () => 1,
        yieldNow: async () => {}, onProgress: (p) => seen.push(p)
    });
    assert.deepEqual(seen, [{ done: 25, total: 26 }, { done: 26, total: 26 }]);
});

test('describeImportRefusals writes for a human, and keeps the two reasons apart', () => {
    const lines = describeImportRefusals({
        regroundedQuotes: 4, noLocalText: 2, unlocatedQuotes: 1, unpinnedKey: 0, importedRulings: 3
    }, [{ url: 'https://a.test/1' }, { url: 'https://b.test/2' }]);
    const all = lines.join('\n');
    assert.match(all, /re-located/, 'says the quotes were re-grounded locally');
    assert.match(all, /holds no\s+copy/, '"I hold no copy" is its own diagnosis');
    assert.match(all, /https:\/\/a\.test\/1/, 'and names the articles to capture');
    assert.match(all, /could NOT be found in the text/, '"not in the copy I hold" is a DIFFERENT diagnosis');
    assert.match(all, /ATTRIBUTED/, 'imported rulings are disclosed as not-applied');
    // A clean merge says nothing at all.
    assert.deepEqual(describeImportRefusals({}, []), []);
    assert.deepEqual(describeImportRefusals(null, []), []);
});
