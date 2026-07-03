// Anchor resolver tests — Phase 9a Day 3.
//
// Covers the cascade (TextQuoteSelector primary, RangeSelector,
// CssSelector), confidence scoring, and orphan handling. Resolves
// against a small corpus of fixture pages with perturbations
// applied between capture and resolve to verify the cascade actually
// degrades gracefully.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  resolveSelectors,
  resolveTextQuote,
  resolveTextPosition,
  resolveRange,
  resolveCss,
  resolveXPath
} = await import('../src/shared/metadata/anchor-resolver.js');

// ------------------------------------------------------------------
// Fake DOM (matches anchor-capture.test.mjs shape)
// ------------------------------------------------------------------

function el(tag, { id = null, attrs = {}, children = [] } = {}) {
  const node = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    id,
    _attrs: new Map(Object.entries(attrs)),
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
    },
    querySelector(selector) {
      // Implements only `#id` selectors (sufficient for our resolver
      // — anchor-capture only emits `#id` form).
      if (typeof selector !== 'string') return null;
      const m = /^#(.+)$/.exec(selector);
      if (!m) return null;
      const target = unescape(m[1]);
      const stack = [this];
      while (stack.length) {
        const cur = stack.pop();
        if (cur.id === target) return cur;
        for (const c of cur.children) stack.push(c);
      }
      return null;
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

// CSS-escape inverse for the simple `\3a ` form used by our capturer.
function unescape(s) {
  return s.replace(/\\([0-9a-fA-F]{2})\s?/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

// Build a fixture article with a stable shape for the cascade tests.
function fixture(text1 = 'the federal reserve targets 2% inflation. inflation, defined as the year-over-year change in cpi, remained elevated through q3.') {
  const t = text(text1);
  const p = el('p', { id: 'lead', children: [t] });
  return el('article', { children: [p] });
}

// ------------------------------------------------------------------
// resolveTextQuote — strategy ladder
// ------------------------------------------------------------------

test('TextQuote: full prefix+exact+suffix → confidence 1.0', () => {
  const root = fixture();
  const result = resolveTextQuote({
    type: 'TextQuoteSelector',
    exact: 'inflation, defined as the year-over-year change in cpi',
    prefix: 'the federal reserve targets 2% inflation. ',
    suffix: ', remained elevated through q3'
  }, root);
  assert.equal(result.confidence, 1.0);
  assert.equal(result.selectorUsed, 'TextQuoteSelector');
});

test('TextQuote: prefix+exact match, slightly different suffix → 0.9', () => {
  const root = fixture();
  // The stored suffix differs by 1 char from what's on the page.
  const result = resolveTextQuote({
    type: 'TextQuoteSelector',
    exact: 'inflation, defined as the year-over-year change in cpi',
    prefix: 'the federal reserve targets 2% inflation. ',
    // Original suffix had a typo or extra space; close but not exact.
    suffix: ', remained elevated through Q3'
  }, root);
  assert.equal(result.confidence, 0.9);
});

test('TextQuote: exact+suffix match, slightly different prefix → 0.85', () => {
  const root = fixture();
  const result = resolveTextQuote({
    type: 'TextQuoteSelector',
    exact: 'inflation, defined as the year-over-year change in cpi',
    // Prefix differs by a couple chars.
    prefix: 'the federal reserve targets 2% iNflation. ',
    suffix: ', remained elevated through q3'
  }, root);
  assert.equal(result.confidence, 0.85);
});

test('TextQuote: bare exact, unique → 0.7', () => {
  const root = fixture();
  const result = resolveTextQuote({
    type: 'TextQuoteSelector',
    exact: 'year-over-year change in cpi'
  }, root);
  assert.equal(result.confidence, 0.7);
});

test('TextQuote: ambiguous bare exact → null (orphaned)', () => {
  const root = fixture('inflation rises. inflation falls. inflation flat.');
  const result = resolveTextQuote({
    type: 'TextQuoteSelector',
    exact: 'inflation'
  }, root);
  assert.equal(result, null);
});

test('TextQuote: exact missing → null', () => {
  const root = fixture();
  const result = resolveTextQuote({
    type: 'TextQuoteSelector',
    exact: 'no such phrase appears anywhere'
  }, root);
  assert.equal(result, null);
});

test('TextQuote: empty exact → null', () => {
  const root = fixture();
  assert.equal(resolveTextQuote({ type: 'TextQuoteSelector', exact: '' }, root), null);
  assert.equal(resolveTextQuote({ type: 'TextQuoteSelector' }, root), null);
});

test('TextQuote: range carries text offsets', () => {
  const t1 = 'first sentence. ';
  const t2 = 'second sentence here. ';
  const t3 = 'third sentence ends.';
  const root = el('article', { children: [el('p', { children: [text(t1 + t2 + t3)] })] });
  const result = resolveTextQuote({
    type: 'TextQuoteSelector',
    exact: 'second sentence here',
    prefix: 'first sentence. ',
    suffix: '. third sentence'
  }, root);
  assert.equal(result.range.textStart, t1.length);
  assert.equal(result.range.textEnd, t1.length + 'second sentence here'.length);
});

// ------------------------------------------------------------------
// resolveSelectors — cascade priority
// ------------------------------------------------------------------

test('cascade: TextQuote with confidence 1.0 wins immediately', () => {
  const root = fixture();
  const result = resolveSelectors([
    {
      type: 'TextQuoteSelector',
      exact: 'inflation, defined as the year-over-year change in cpi',
      prefix: 'the federal reserve targets 2% inflation. ',
      suffix: ', remained elevated through q3'
    },
    { type: 'RangeSelector', startContainer: '/p[1]/text()[1]', startOffset: 0,
      endContainer: '/p[1]/text()[1]', endOffset: 5 }
  ], root);
  assert.equal(result.selectorUsed, 'TextQuoteSelector');
  assert.equal(result.confidence, 1.0);
});

test('cascade: falls through to Range when TextQuote orphans', () => {
  const root = fixture();
  const result = resolveSelectors([
    { type: 'TextQuoteSelector', exact: 'phrase that does not exist anywhere' },
    { type: 'RangeSelector', startContainer: '/p[1]/text()[1]', startOffset: 0,
      endContainer: '/p[1]/text()[1]', endOffset: 5 }
  ], root);
  assert.equal(result.selectorUsed, 'RangeSelector');
  assert.equal(result.confidence, 0.7);
});

test('cascade: returns null when every selector fails', () => {
  const root = fixture();
  const result = resolveSelectors([
    { type: 'TextQuoteSelector', exact: 'phrase that does not exist anywhere' },
    { type: 'RangeSelector', startContainer: '/p[42]/text()[1]', startOffset: 0,
      endContainer: '/p[42]/text()[1]', endOffset: 5 },
    { type: 'CssSelector', value: '#nonexistent' }
  ], root);
  assert.equal(result, null);
});

test('cascade: returns null on empty selector array', () => {
  assert.equal(resolveSelectors([], el('article')), null);
  assert.equal(resolveSelectors(null, el('article')), null);
});

test('cascade: returns null when root is null', () => {
  assert.equal(resolveSelectors([{ type: 'TextQuoteSelector', exact: 'x' }], null), null);
});

test('cascade: respects custom threshold', () => {
  const root = fixture();
  // Bare-exact gives 0.7. Threshold 0.8 should reject it.
  const result = resolveSelectors([
    { type: 'TextQuoteSelector', exact: 'year-over-year change in cpi' }
  ], root, { threshold: 0.8 });
  assert.equal(result, null);
});

// ------------------------------------------------------------------
// resolveXPath
// ------------------------------------------------------------------

test('resolveXPath: tag[N] path', () => {
  const target = el('p', { id: 'target' });
  const root = el('article', {
    children: [
      el('p'),
      el('p'),
      target
    ]
  });
  assert.equal(resolveXPath('/p[3]', root), target);
});

test('resolveXPath: text()[N] path', () => {
  const t1 = text('first');
  const t2 = text('second');
  const p = el('p');
  // Append text nodes manually; el() helper handles only Elements via children
  p.appendChild(t1);
  p.appendChild(t2);
  const root = el('article', { children: [p] });
  assert.equal(resolveXPath('/p[1]/text()[2]', root), t2);
});

test('resolveXPath: returns null on missing index', () => {
  const root = el('article', { children: [el('p'), el('p')] });
  assert.equal(resolveXPath('/p[99]', root), null);
});

test('resolveXPath: returns null on malformed segment', () => {
  const root = el('article', { children: [el('p')] });
  assert.equal(resolveXPath('/<bogus>', root), null);
});

// ------------------------------------------------------------------
// resolveRange
// ------------------------------------------------------------------

test('Range: resolves XPath endpoints + offsets', () => {
  const t = text('the quick brown fox');
  const p = el('p', { children: [t] });
  const root = el('article', { children: [p] });
  const result = resolveRange({
    type: 'RangeSelector',
    startContainer: '/p[1]/text()[1]',
    startOffset: 4,
    endContainer: '/p[1]/text()[1]',
    endOffset: 9
  }, root);
  assert.equal(result.confidence, 0.7);
  assert.equal(result.range.startContainer, t);
  assert.equal(result.range.endContainer, t);
  assert.equal(result.range.startOffset, 4);
  assert.equal(result.range.endOffset, 9);
});

test('Range: returns null on unresolvable XPath', () => {
  const root = el('article', { children: [el('p')] });
  assert.equal(resolveRange({
    type: 'RangeSelector',
    startContainer: '/p[99]/text()[1]',
    startOffset: 0,
    endContainer: '/p[99]/text()[1]',
    endOffset: 5
  }, root), null);
});

// ------------------------------------------------------------------
// resolveCss
// ------------------------------------------------------------------

test('Css: resolves #id selector', () => {
  const target = el('p', { id: 'main-content' });
  const root = el('article', {
    children: [el('p', { id: 'header' }), target]
  });
  const result = resolveCss({ type: 'CssSelector', value: '#main-content' }, root);
  assert.equal(result.confidence, 0.7);
  assert.equal(result.range.container, target);
});

test('Css: returns null on no match', () => {
  const root = el('article');
  assert.equal(resolveCss({ type: 'CssSelector', value: '#nonexistent' }, root), null);
});

// ------------------------------------------------------------------
// Perturbation suite — verify graceful degradation
// ------------------------------------------------------------------

// Each scenario captures a selector array from a "before" page and
// then resolves against an "after" page that has been perturbed.
// We expect specific confidence levels per perturbation.

test('perturbation: identical page → confidence 1.0', () => {
  const root = fixture();
  const result = resolveSelectors([{
    type: 'TextQuoteSelector',
    exact: 'year-over-year change in cpi',
    prefix: 'inflation, defined as the ',
    suffix: ', remained elevated through'
  }], root);
  assert.equal(result.confidence, 1.0);
});

test('perturbation: paragraph reorder (XPath breaks, TextQuote saves us)', () => {
  const t = text('the federal reserve targets 2% inflation. inflation, defined as the year-over-year change in cpi, remained elevated through q3.');
  const root = el('article', {
    children: [
      el('p', { children: [text('an unrelated paragraph appended above')] }),  // moved to top
      el('p', { id: 'lead', children: [t] })
    ]
  });
  const result = resolveSelectors([
    {
      type: 'TextQuoteSelector',
      exact: 'year-over-year change in cpi',
      prefix: 'inflation, defined as the ',
      suffix: ', remained elevated through'
    },
    {
      type: 'RangeSelector',
      // Captured when lead was /p[1]; after perturbation it's /p[2].
      startContainer: '/p[1]/text()[1]', startOffset: 0,
      endContainer: '/p[1]/text()[1]', endOffset: 5
    }
  ], root);
  assert.equal(result.selectorUsed, 'TextQuoteSelector');
  assert.equal(result.confidence, 1.0);
});

test('perturbation: class-name change does not affect TextQuote', () => {
  // Captured against `<p class="old-class">`. After perturbation,
  // class is renamed but visible text identical.
  const t = text('inflation, defined as the year-over-year change in cpi, remained elevated through q3.');
  const root = el('article', { children: [el('p', { id: 'lead', children: [t] })] });
  const result = resolveSelectors([{
    type: 'TextQuoteSelector',
    exact: 'year-over-year change in cpi',
    prefix: 'inflation, defined as the ',
    suffix: ', remained elevated through'
  }], root);
  assert.equal(result.confidence, 1.0);
});

test('perturbation: typo correction in suffix → 0.9', () => {
  // Original suffix was ", remained elevated through q3." with q3 lowercase.
  // After correction, it's "Q3" — single-char change.
  const t = text('inflation, defined as the year-over-year change in cpi, remained elevated through Q3.');
  const root = el('article', { children: [el('p', { children: [t] })] });
  const result = resolveSelectors([{
    type: 'TextQuoteSelector',
    exact: 'year-over-year change in cpi',
    prefix: 'inflation, defined as the ',
    suffix: ', remained elevated through q3'
  }], root);
  // Suffix differs at position [27] only (q→Q). Diff = 1.
  assert.equal(result.confidence, 0.9);
});

test('perturbation: exact removed entirely → orphaned (null)', () => {
  const t = text('the article has been completely rewritten with no original phrasing.');
  const root = el('article', { children: [el('p', { children: [t] })] });
  const result = resolveSelectors([{
    type: 'TextQuoteSelector',
    exact: 'year-over-year change in cpi',
    prefix: 'inflation, defined as the ',
    suffix: ', remained elevated through'
  }], root);
  assert.equal(result, null);
});

test('perturbation: extra inline emphasis tags do not break TextQuote', () => {
  // Visible text identical; inline <em> tags added around 'cpi'.
  // textContent flattens to identical string.
  const root = el('article', {
    children: [el('p', {
      children: [
        text('inflation, defined as the year-over-year change in '),
        el('em', { children: [text('cpi')] }),
        text(', remained elevated through q3.')
      ]
    })]
  });
  const result = resolveSelectors([{
    type: 'TextQuoteSelector',
    exact: 'year-over-year change in cpi',
    prefix: 'inflation, defined as the ',
    suffix: ', remained elevated through'
  }], root);
  assert.equal(result.confidence, 1.0);
});

test('perturbation: same exact appears twice on a page without prefix → orphaned', () => {
  const t = text('inflation matters. inflation matters more. inflation again.');
  const root = el('article', { children: [el('p', { children: [t] })] });
  const result = resolveSelectors([{
    type: 'TextQuoteSelector',
    exact: 'inflation'
    // no prefix or suffix to disambiguate
  }], root);
  assert.equal(result, null);
});

// ------------------------------------------------------------------
// TextPositionSelector — Phase 14.5 provenance hardening
// ------------------------------------------------------------------

test('TextPosition: verified offsets → confidence 1.0', () => {
  const root = fixture();
  const full = root.textContent;
  const exact = 'inflation, defined as the year-over-year change in cpi';
  const start = full.indexOf(exact);
  const result = resolveTextPosition(
    { type: 'TextPositionSelector', start, end: start + exact.length },
    root,
    { exact }
  );
  assert.equal(result.confidence, 1.0);
  assert.equal(result.selectorUsed, 'TextPositionSelector');
  assert.deepEqual(result.range, { textStart: start, textEnd: start + exact.length });
});

test('TextPosition: offsets into changed text → null (never guess)', () => {
  const root = fixture();
  const result = resolveTextPosition(
    { type: 'TextPositionSelector', start: 0, end: 10 },
    root,
    { exact: 'inflation, defined as' }
  );
  assert.equal(result, null);
});

test('TextPosition: no sibling exact to verify against → null', () => {
  const root = fixture();
  const result = resolveTextPosition(
    { type: 'TextPositionSelector', start: 0, end: 10 },
    root,
    {}
  );
  assert.equal(result, null);
});

test('TextPosition: malformed offsets → null', () => {
  const root = fixture();
  const ctx = { exact: 'the federal' };
  assert.equal(resolveTextPosition({ type: 'TextPositionSelector', start: -1, end: 5 }, root, ctx), null);
  assert.equal(resolveTextPosition({ type: 'TextPositionSelector', start: 5, end: 5 }, root, ctx), null);
  assert.equal(resolveTextPosition({ type: 'TextPositionSelector', start: 0, end: 99999 }, root, ctx), null);
  assert.equal(resolveTextPosition({ type: 'TextPositionSelector', start: '0', end: 10 }, root, ctx), null);
});

test('TextPosition: verifies a truncated (head … tail) exact', () => {
  const root = fixture();
  const full = root.textContent;
  const result = resolveTextPosition(
    { type: 'TextPositionSelector', start: 0, end: full.length },
    root,
    { exact: full.slice(0, 20) + ' … ' + full.slice(-20) }
  );
  assert.equal(result.confidence, 1.0);
});

test('cascade: TextPosition disambiguates a repeated exact that orphans TextQuote', () => {
  const t = text('inflation matters. inflation matters more. inflation again.');
  const root = el('article', { children: [el('p', { children: [t] })] });
  const full = root.textContent;
  const second = full.indexOf('inflation', 1);
  const result = resolveSelectors([
    { type: 'TextQuoteSelector', exact: 'inflation' },   // ambiguous → null
    { type: 'TextPositionSelector', start: second, end: second + 'inflation'.length }
  ], root);
  assert.equal(result.selectorUsed, 'TextPositionSelector');
  assert.equal(result.confidence, 1.0);
  assert.equal(result.range.textStart, second);
});
