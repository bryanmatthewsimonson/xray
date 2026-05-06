// Anchor capture tests — Phase 9a Day 2.
//
// Spec: XRAY_METADATA_SPEC.md §6.3 + §7. The pure `buildSelectors`
// function is exhaustively tested; `captureFromSelection` is sanity-
// tested with a minimal fake DOM.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  buildSelectors,
  captureFromSelection,
  xpathFor,
  isStableId
} = await import('../src/shared/metadata/anchor-capture.js');

// ------------------------------------------------------------------
// buildSelectors — pure path
// ------------------------------------------------------------------

test('buildSelectors emits TextQuoteSelector with exact', () => {
  const out = buildSelectors({ exact: 'the cat sat' });
  assert.equal(out.selectors.length, 1);
  assert.deepEqual(out.selectors[0], { type: 'TextQuoteSelector', exact: 'the cat sat' });
});

test('buildSelectors emits TextQuoteSelector with prefix + suffix', () => {
  const out = buildSelectors({
    exact: 'cat',
    prefix: 'the',
    suffix: ' sat'
  });
  assert.deepEqual(out.selectors[0], {
    type: 'TextQuoteSelector',
    exact: 'cat',
    prefix: 'the',
    suffix: ' sat'
  });
});

test('buildSelectors caps prefix at 32 chars (keeps tail)', () => {
  const longPrefix = 'a'.repeat(50) + 'PREFIX';
  const out = buildSelectors({ exact: 'x', prefix: longPrefix });
  // We want the 32 chars *immediately before* the selection.
  assert.equal(out.selectors[0].prefix.length, 32);
  assert.ok(out.selectors[0].prefix.endsWith('PREFIX'));
});

test('buildSelectors caps suffix at 32 chars (keeps head)', () => {
  const longSuffix = 'SUFFIX' + 'a'.repeat(50);
  const out = buildSelectors({ exact: 'x', suffix: longSuffix });
  assert.equal(out.selectors[0].suffix.length, 32);
  assert.ok(out.selectors[0].suffix.startsWith('SUFFIX'));
});

test('buildSelectors omits prefix/suffix when empty', () => {
  const out = buildSelectors({ exact: 'x', prefix: '', suffix: '' });
  assert.equal('prefix' in out.selectors[0], false);
  assert.equal('suffix' in out.selectors[0], false);
});

test('buildSelectors emits RangeSelector when XPath + offsets present', () => {
  const out = buildSelectors({
    exact: 'foo',
    startContainerXPath: '/html/body/article/p[3]/text()[1]',
    startOffset: 14,
    endContainerXPath: '/html/body/article/p[3]/text()[1]',
    endOffset: 17
  });
  assert.equal(out.selectors.length, 2);
  assert.deepEqual(out.selectors[1], {
    type: 'RangeSelector',
    startContainer: '/html/body/article/p[3]/text()[1]',
    startOffset: 14,
    endContainer: '/html/body/article/p[3]/text()[1]',
    endOffset: 17
  });
});

test('buildSelectors omits RangeSelector when offsets missing', () => {
  const out = buildSelectors({
    exact: 'foo',
    startContainerXPath: '/html/body/p',
    startOffset: 0,
    endContainerXPath: '/html/body/p'
    // endOffset missing
  });
  assert.equal(out.selectors.length, 1);
  assert.equal(out.selectors[0].type, 'TextQuoteSelector');
});

test('buildSelectors emits CssSelector with stable id', () => {
  const out = buildSelectors({
    exact: 'foo',
    startContainerId: 'main-content'
  });
  // [TextQuote, Css]
  assert.equal(out.selectors.length, 2);
  assert.deepEqual(out.selectors[1], { type: 'CssSelector', value: '#main-content' });
});

test('buildSelectors emits CssSelector from CSS path when no id', () => {
  const out = buildSelectors({
    exact: 'foo',
    startContainerCssPath: 'article > div.body > p:nth-child(3)'
  });
  assert.equal(out.selectors[1].type, 'CssSelector');
  assert.equal(out.selectors[1].value, 'article > div.body > p:nth-child(3)');
});

test('buildSelectors order: TextQuote, Range, Css', () => {
  const out = buildSelectors({
    exact: 'foo',
    prefix: 'pre',
    suffix: 'suf',
    startContainerXPath: '/x',
    startOffset: 0,
    endContainerXPath: '/x',
    endOffset: 3,
    startContainerId: 'main'
  });
  assert.equal(out.selectors.length, 3);
  assert.equal(out.selectors[0].type, 'TextQuoteSelector');
  assert.equal(out.selectors[1].type, 'RangeSelector');
  assert.equal(out.selectors[2].type, 'CssSelector');
});

test('buildSelectors returns empty selectors on empty exact', () => {
  const out = buildSelectors({ exact: '' });
  assert.deepEqual(out.selectors, []);
  assert.equal(out.fullExact, '');
});

test('buildSelectors handles missing input safely', () => {
  const out = buildSelectors();
  assert.deepEqual(out.selectors, []);
  assert.equal(out.fullExact, '');
});

// ------------------------------------------------------------------
// Length cap on `exact`
// ------------------------------------------------------------------

test('buildSelectors does NOT truncate at exactly 500 chars', () => {
  const exact = 'a'.repeat(500);
  const out = buildSelectors({ exact });
  assert.equal(out.selectors[0].exact, exact);
  assert.equal(out.fullExact, exact);
});

test('buildSelectors truncates above 500 chars to head + tail', () => {
  const head = 'H'.repeat(200);
  const middle = 'M'.repeat(200);
  const tail = 'T'.repeat(200);
  const exact = head + middle + tail; // 600 chars
  const out = buildSelectors({ exact });
  // Truncated to first 200 + ' … ' + last 200 = head + ' … ' + tail
  assert.ok(out.selectors[0].exact.startsWith(head));
  assert.ok(out.selectors[0].exact.endsWith(tail));
  assert.ok(out.selectors[0].exact.includes('…'));
  assert.equal(out.fullExact, exact); // full text preserved for body
});

test('buildSelectors fullExact preserves the un-truncated selection', () => {
  const exact = 'x'.repeat(1500);
  const out = buildSelectors({ exact });
  assert.equal(out.fullExact, exact);
  assert.ok(out.selectors[0].exact.length < exact.length);
});

// ------------------------------------------------------------------
// CSS escape
// ------------------------------------------------------------------

test('buildSelectors CSS-escapes id with special chars', () => {
  const out = buildSelectors({ exact: 'x', startContainerId: 'foo:bar' });
  // colon must be escaped to be valid in #selector
  assert.match(out.selectors[1].value, /^#foo\\3a\s*bar$/);
});

// ------------------------------------------------------------------
// isStableId
// ------------------------------------------------------------------

test('isStableId accepts kebab-case', () => {
  assert.equal(isStableId('main-content'), true);
  assert.equal(isStableId('article-body'), true);
});

test('isStableId accepts snake_case', () => {
  assert.equal(isStableId('main_content'), true);
});

test('isStableId accepts dot-namespace', () => {
  assert.equal(isStableId('app.main.body'), true);
});

test('isStableId rejects React 18 useId form `:r0:`', () => {
  assert.equal(isStableId(':r0:'), false);
  assert.equal(isStableId(':r5a:'), false);
});

test('isStableId rejects emotion `_h:` form', () => {
  assert.equal(isStableId('_h:42'), false);
});

test('isStableId rejects emotion classname-as-id', () => {
  assert.equal(isStableId('css-1abc23'), false);
});

test('isStableId rejects long hex / GUID', () => {
  assert.equal(isStableId('a1b2c3d4e5f6789012345678'), false);
  assert.equal(isStableId('A1B2C3D4-E5F6-7890-1234-567890ABCDEF'), false);
});

test('isStableId rejects leading-digit ids', () => {
  assert.equal(isStableId('1main'), false);
  assert.equal(isStableId('123abc'), false);
});

test('isStableId rejects too-long ids', () => {
  assert.equal(isStableId('a'.repeat(65)), false);
});

test('isStableId rejects empty / non-string', () => {
  assert.equal(isStableId(''), false);
  assert.equal(isStableId(null), false);
  assert.equal(isStableId(undefined), false);
  assert.equal(isStableId(42), false);
});

// ------------------------------------------------------------------
// xpathFor — minimal fake DOM
// ------------------------------------------------------------------

function el(tag, { id = null, children = [] } = {}) {
  const node = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    id,
    children: [],
    childNodes: [],
    parentNode: null,
    parentElement: null,
    appendChild(c) {
      c.parentNode = this;
      c.parentElement = this.nodeType === 1 ? this : c.parentElement;
      this.childNodes.push(c);
      if (c.nodeType === 1) this.children.push(c);
    },
    get textContent() {
      let out = '';
      const walk = (n) => {
        if (n.nodeType === 3) { out += n.data || ''; return; }
        for (const c of n.childNodes || []) walk(c);
      };
      walk(this);
      return out;
    }
  };
  for (const c of children) node.appendChild(c);
  return node;
}

function text(data) {
  return {
    nodeType: 3,
    data,
    parentNode: null,
    parentElement: null,
    childNodes: []
  };
}

test('xpathFor: text node under p[1]', () => {
  const t = text('hello');
  const p = el('p', { children: [t] });
  const root = el('article', { children: [p] });
  const xp = xpathFor(t, root);
  assert.equal(xp, '/p[1]/text()[1]');
});

test('xpathFor: nested element p[3]', () => {
  const root = el('article', {
    children: [
      el('p', { children: [text('one')] }),
      el('p', { children: [text('two')] }),
      el('p', { children: [text('three')] })
    ]
  });
  const target = root.children[2]; // the third <p>
  assert.equal(xpathFor(target, root), '/p[3]');
});

test('xpathFor: returns "" when node is not under root', () => {
  const stranger = el('span');
  const root = el('article', { children: [el('p')] });
  assert.equal(xpathFor(stranger, root), '');
});

// ------------------------------------------------------------------
// captureFromSelection — fake selection
// ------------------------------------------------------------------

function fakeSelection({ exact, range }) {
  return {
    rangeCount: 1,
    getRangeAt: () => range,
    toString: () => exact
  };
}

test('captureFromSelection extracts prefix + suffix from rendered text', () => {
  const t = text('the quick brown fox jumps over the lazy dog');
  const root = el('article', { children: [el('p', { children: [t] })] });
  const range = {
    collapsed: false,
    startContainer: t,
    endContainer: t,
    startOffset: 4,
    endOffset: 9
  };
  const sel = fakeSelection({ exact: 'quick', range });
  const out = captureFromSelection(sel, root);
  assert.equal(out.selectors[0].type, 'TextQuoteSelector');
  assert.equal(out.selectors[0].exact, 'quick');
  assert.equal(out.selectors[0].prefix, 'the ');
  assert.equal(out.selectors[0].suffix, ' brown fox jumps over the lazy d');
});

test('captureFromSelection returns null on collapsed range', () => {
  const t = text('hello');
  const root = el('article', { children: [el('p', { children: [t] })] });
  const range = { collapsed: true, startContainer: t, endContainer: t, startOffset: 0, endOffset: 0 };
  const sel = fakeSelection({ exact: '', range });
  assert.equal(captureFromSelection(sel, root), null);
});

test('captureFromSelection returns null on empty selection', () => {
  assert.equal(captureFromSelection(null, null), null);
  assert.equal(captureFromSelection({ rangeCount: 0 }, null), null);
});

test('captureFromSelection emits RangeSelector with XPaths', () => {
  const t = text('the quick brown fox');
  const root = el('article', { children: [el('p', { children: [t] })] });
  const range = {
    collapsed: false,
    startContainer: t,
    endContainer: t,
    startOffset: 4,
    endOffset: 9
  };
  const out = captureFromSelection(fakeSelection({ exact: 'quick', range }), root);
  // Should have TextQuote then Range
  assert.equal(out.selectors[1].type, 'RangeSelector');
  assert.equal(out.selectors[1].startContainer, '/p[1]/text()[1]');
  assert.equal(out.selectors[1].startOffset, 4);
  assert.equal(out.selectors[1].endContainer, '/p[1]/text()[1]');
  assert.equal(out.selectors[1].endOffset, 9);
});

test('captureFromSelection emits CssSelector when start container has stable id', () => {
  const t = text('the quick brown fox');
  const p = el('p', { id: 'lead-paragraph', children: [t] });
  const root = el('article', { children: [p] });
  const range = {
    collapsed: false,
    startContainer: t,
    endContainer: t,
    startOffset: 4,
    endOffset: 9
  };
  const out = captureFromSelection(fakeSelection({ exact: 'quick', range }), root);
  const css = out.selectors.find((s) => s.type === 'CssSelector');
  assert.ok(css);
  assert.equal(css.value, '#lead-paragraph');
});

test('captureFromSelection skips CssSelector when start container has unstable id', () => {
  const t = text('the quick brown fox');
  const p = el('p', { id: ':r5:', children: [t] });
  const root = el('article', { children: [p] });
  const range = {
    collapsed: false,
    startContainer: t,
    endContainer: t,
    startOffset: 4,
    endOffset: 9
  };
  const out = captureFromSelection(fakeSelection({ exact: 'quick', range }), root);
  const css = out.selectors.find((s) => s.type === 'CssSelector');
  assert.equal(css, undefined);
});

test('captureFromSelection: selection spans multiple paragraphs', () => {
  const t1 = text('paragraph one ends with rebuttal. ');
  const t2 = text('Paragraph two starts.');
  const p1 = el('p', { children: [t1] });
  const p2 = el('p', { children: [t2] });
  const root = el('article', { children: [p1, p2] });
  const range = {
    collapsed: false,
    startContainer: t1,
    endContainer: t2,
    startOffset: 24,        // 'rebuttal. '
    endOffset: 13           // 'Paragraph two'
  };
  const sel = fakeSelection({ exact: 'rebuttal. Paragraph two', range });
  // The captureFromSelection helper uses textContent which won't
  // produce 'rebuttal. Paragraph two' contiguously (textContent
  // concatenates without separator); accept that prefix/suffix may
  // be empty in that case.
  const out = captureFromSelection(sel, root);
  assert.equal(out.selectors[0].type, 'TextQuoteSelector');
  assert.equal(out.selectors[0].exact, 'rebuttal. Paragraph two');
  // RangeSelector with XPaths in two different paragraphs
  const range_sel = out.selectors.find((s) => s.type === 'RangeSelector');
  assert.equal(range_sel.startContainer, '/p[1]/text()[1]');
  assert.equal(range_sel.endContainer, '/p[2]/text()[1]');
});
