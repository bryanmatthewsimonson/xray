import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

const { groundNotes, partitionSegments } = await import('../src/shared/annotations/segments.js');
const { PAGE_REASONS } = await import('../src/shared/annotations/notes.js');
const { createGroundingIndex } = await import('../src/shared/quote-grounding.js');

const TEXT = 'Alpha beta gamma delta. The transaction was completed in March. Epsilon zeta.';
const idx = createGroundingIndex(TEXT);

const mk = (id, family, quote, meta = { quote }) =>
    ({ id, family, quote, grounding: null, pageReason: null, title: '', body: '', meta, actions: [], reviewState: null, sub: [] });

test('groundNotes: verbatim quote grounds; miss demotes with a stated reason', () => {
    const out = groundNotes([
        mk('a', 'extraction', 'transaction was completed'),
        mk('b', 'extraction', 'text that is nowhere')
    ], idx);
    assert.equal(out[0].grounding.status, 'exact');
    assert.equal(TEXT.slice(out[0].grounding.start, out[0].grounding.end), out[0].grounding.exact);
    assert.equal(out[1].grounding, null);
    assert.equal(out[1].pageReason, PAGE_REASONS.couldNotLocate);
});

test('groundNotes: paraphrase-only claims use the strict tiers (locate, never fuzzy)', () => {
    const spy = { text: TEXT, ground() { throw new Error('ground() must not run for paraphrase claims'); },
        locate() { return { status: 'missing', score: 0, start: -1, end: -1, exact: '' }; } };
    const claim = mk('c', 'claim', 'a paraphrase of something', { quote: '' });
    const [out] = groundNotes([claim], spy);
    assert.equal(out.pageReason, PAGE_REASONS.noAnchorRecorded);
});

test('groundNotes: a paraphrase that locate() DOES find grounds normally (the success half)', () => {
    // The mirror of the test above: same strict-tier routing, but this
    // time locate hits. Without this the suite only ever proved the
    // demotion path, so a locate() that silently stopped returning
    // grounding would still look green.
    const hit = 'The transaction was completed in March.';
    const spy = {
        text: TEXT,
        ground() { throw new Error('ground() must not run for paraphrase claims'); },
        locate(q) {
            const start = TEXT.indexOf(q);
            return { status: 'exact', score: 1, start, end: start + q.length, exact: q };
        }
    };
    const [out] = groundNotes([mk('c2', 'claim', hit, { quote: '' })], spy);
    assert.equal(out.pageReason, null, 'a located paraphrase is NOT demoted to the page lane');
    assert.equal(out.grounding.status, 'exact');
    assert.equal(TEXT.slice(out.grounding.start, out.grounding.end), hit);
    assert.equal(out.grounding.exact, hit);
});

test('groundNotes: an edited body explains its own misses (editedAway, not couldNotLocate)', () => {
    const gone = mk('g', 'extraction', 'text that is nowhere');
    const [plain] = groundNotes([gone], idx);
    assert.equal(plain.pageReason, PAGE_REASONS.couldNotLocate,
        'unedited: the honest reason is that the text is not in this copy');
    const [edited] = groundNotes([gone], idx, { edited: true });
    assert.equal(edited.pageReason, PAGE_REASONS.editedAway,
        'edited: blame the edit, not the source');
    // A paraphrase miss has the same cause either way — only the
    // verbatim branch shifts.
    const para = mk('p', 'claim', 'a paraphrase of something', { quote: '' });
    assert.equal(groundNotes([para], idx, { edited: true })[0].pageReason, PAGE_REASONS.noAnchorRecorded);
});

test('PAGE_REASONS carries no reason string without a producer', () => {
    // `sourceNotCaptured` was removed with the S3 foreign ring that would
    // have emitted it: a reason nothing can produce is dead UI copy that
    // reads as a supported state.
    assert.equal(PAGE_REASONS.sourceNotCaptured, undefined);
    assert.ok(PAGE_REASONS.editedAway && PAGE_REASONS.couldNotLocate && PAGE_REASONS.noAnchorRecorded);
});

test('groundNotes: empty quotes and pre-set page reasons pass through untouched', () => {
    const preset = { ...mk('d', 'comment', ''), pageReason: PAGE_REASONS.pageLevelByDesign };
    const out = groundNotes([preset, mk('e', 'audit', '')], idx);
    assert.equal(out[0].pageReason, PAGE_REASONS.pageLevelByDesign);
    assert.equal(out[1].pageReason, PAGE_REASONS.noAnchorRecorded);
});

test('partitionSegments: overlap composes into disjoint covered intervals', () => {
    const n1 = { ...mk('n1', 'claim', 'x'), grounding: { status: 'exact', start: 10, end: 30, exact: '' } };
    const n2 = { ...mk('n2', 'extraction', 'y'), grounding: { status: 'exact', start: 20, end: 40, exact: '' } };
    const n3 = { ...mk('n3', 'audit', 'z'), grounding: { status: 'exact', start: 50, end: 60, exact: '' } };
    const paged = { ...mk('n4', 'claim', 'w'), pageReason: 'r' };
    const segs = partitionSegments([n1, n2, n3, paged]);
    assert.deepEqual(segs, [
        { start: 10, end: 20, ids: ['n1'] },
        { start: 20, end: 30, ids: ['n1', 'n2'] },
        { start: 30, end: 40, ids: ['n2'] },
        { start: 50, end: 60, ids: ['n3'] }
    ]);
});
