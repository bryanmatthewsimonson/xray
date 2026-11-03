import test from 'node:test';
import assert from 'node:assert/strict';
// anchor-resolve imports diarized-transcript, which transitively touches
// chrome.storage at module load; stub it as the other tests do.
globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

const {
    normalizeForMatch, buildTextIndex, locate, resolve, quoteToSeconds,
    ACCEPT_CONFIDENCE, FUZZY_MAX_QUOTE, MAX_PAGE_CHARS
} = await import('../src/shared/anchor-resolve.js');

test('constants', () => {
    assert.equal(ACCEPT_CONFIDENCE, 0.7);
    assert.equal(FUZZY_MAX_QUOTE, 200);
    assert.equal(MAX_PAGE_CHARS, 2 * 1024 * 1024);
});

test('normalizeForMatch folds quotes, dashes, NBSP, markdown', () => {
    assert.equal(normalizeForMatch('“It’s — *fine*” [here](https://x.y)'), '"It\'s - fine" here');
    assert.equal(normalizeForMatch('  a  b\n\tc  '), 'a b c');
    assert.equal(normalizeForMatch('**bold** __und__ –‒'), 'bold und --');
});

test('resolve: exact with prefix/suffix → 1.0 quote-context', () => {
    const idx = buildTextIndex([{ ref: 'a', text: 'alpha beta gamma beta delta' }]);
    const r = resolve(idx, { anchor: [{ type: 'TextQuoteSelector', exact: 'beta', prefix: 'gamma ', suffix: ' delta' }] });
    assert.deepEqual([r.range.start, r.method, r.confidence], [17, 'quote-context', 1]);
});

test('resolve: unique exact quote → 0.9 exact-unique', () => {
    const idx = buildTextIndex([{ ref: 'a', text: 'alpha beta gamma beta delta' }]);
    const r = resolve(idx, { quote: 'gamma' });
    assert.deepEqual([r.range.start, r.range.end, r.method, r.confidence], [11, 16, 'exact-unique', 0.9]);
});

test('resolve: TextPositionSelector is ignored', () => {
    const idx = buildTextIndex([{ ref: 'a', text: 'alpha beta gamma' }]);
    const r = resolve(idx, { anchor: [{ type: 'TextPositionSelector', start: 0, end: 5 }] });
    assert.equal(r.range, null);
    assert.equal(r.method, 'none');
});

test('resolve: duplicate exact without context is unresolved', () => {
    const idx = buildTextIndex([{ ref: 'a', text: 'beta x beta' }]);
    assert.equal(resolve(idx, { quote: 'beta' }).range, null);
});

test('resolve: fuzzy accepts one-word drift ≥ 0.7, rejects > 200 chars', () => {
    const page = 'Intro text here. The committee decided to postpone the final vote until next spring. Outro.';
    const idx = buildTextIndex([{ ref: 'a', text: page }]);
    const r = resolve(idx, { quote: 'The committee decided to delay the final vote until next spring.' });
    assert.equal(r.method, 'fuzzy');
    assert.ok(r.confidence >= ACCEPT_CONFIDENCE && r.confidence < 1);
    assert.ok(idx.text.slice(r.range.start, r.range.end).includes('postpone the final vote'));

    const long = 'word '.repeat(60).trim();
    assert.ok(long.length > FUZZY_MAX_QUOTE);
    const idx2 = buildTextIndex([{ ref: 'a', text: long.replace('word', 'wurd') }]);
    assert.equal(resolve(idx2, { quote: long }).range, null);
    // unrelated text is rejected
    assert.equal(resolve(idx, { quote: 'completely different sentence about cats' }).range, null);
});

test('resolve: spans segments and locate() maps back to refs', () => {
    const idx = buildTextIndex([{ ref: 'p1', text: 'one two' }, { ref: 'p2', text: 'three four' }]);
    const r = resolve(idx, { quote: 'two three' });
    assert.deepEqual(locate(idx, r.range.start, r.range.end), { startRef: 'p1', startOffset: 4, endRef: 'p2', endOffset: 5 });
});

test('locate: raw offsets survive whitespace collapsing and markdown stripping', () => {
    const raw = '  hello   *big*  world';
    const idx = buildTextIndex([{ ref: 'p', text: raw }]);
    const r = resolve(idx, { quote: 'big world' });
    const loc = locate(idx, r.range.start, r.range.end);
    assert.equal(raw.slice(loc.startOffset, loc.endOffset), 'big*  world');
});

const timeMap = [
    { start: 0, end: 20, startSec: 5, endSec: 12 },
    { start: 22, end: 60, startSec: 70, endSec: 95 }
];
test('quoteToSeconds: timeMap path', () => {
    const markdown = 'first paragraph here\n\nsecond paragraph holds the quoted words';
    assert.equal(quoteToSeconds('the quoted words', { markdown, timeMap }), 70);
    assert.equal(quoteToSeconds('first paragraph', { markdown, timeMap }), 5);
    assert.equal(quoteToSeconds('absent quote entirely', { markdown, timeMap }), null);
    assert.equal(quoteToSeconds('the quoted words', { content: markdown, timeMap }), 70);
});

test('quoteToSeconds: caption &t= paragraph path', () => {
    const md = '[0:05](https://www.youtube.com/watch?v=abc&t=5s) hello there\n\n[1:10](https://www.youtube.com/watch?v=abc&t=70s) the quoted line';
    assert.equal(quoteToSeconds('the quoted line', { markdown: md }), 70);
    assert.equal(quoteToSeconds('hello there', { markdown: md }), 5);
});

test('quoteToSeconds: no timing → null', () => {
    assert.equal(quoteToSeconds('some plain sentence', { markdown: 'A plain article with some plain sentence in it.' }), null);
    assert.equal(quoteToSeconds('', { markdown: 'x' }), null);
    assert.equal(quoteToSeconds('x', null), null);
});
