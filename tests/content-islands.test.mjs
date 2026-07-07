// HTML-island tests — Phase 18 C1 (docs/COMPLEX_CONTENT_DESIGN.md §4).
//
// The classifier and sanitizer walk plain node interfaces, so the
// fixtures are hand-built stubs (the anchor-test pattern) — no jsdom.
// The render side (markdownToHtml) is exercised through its
// no-DOMParser fallback: island bodies must come out ESCAPED, never
// as live markup, when they can't be re-sanitized.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    isComplexTable, sanitizeIslandNode, sanitizeIslandString,
    wrapIsland, islandPattern
} from '../src/shared/content-islands.js';

// ------------------------------------------------------------------
// Stub DOM
// ------------------------------------------------------------------

function el(tag, attrs = {}, children = []) {
    return {
        nodeType: 1,
        tagName: tag.toUpperCase(),
        nodeName: tag.toUpperCase(),
        childNodes: children,
        getAttribute: (n) => (Object.prototype.hasOwnProperty.call(attrs, n) ? attrs[n] : null)
    };
}
function text(s) { return { nodeType: 3, nodeValue: s, childNodes: [] }; }

function simpleTable() {
    return el('table', {}, [
        el('thead', {}, [el('tr', {}, [el('th', {}, [text('A')]), el('th', {}, [text('B')])])]),
        el('tbody', {}, [el('tr', {}, [el('td', {}, [text('1')]), el('td', {}, [text('2')])])])
    ]);
}

// ------------------------------------------------------------------
// isComplexTable
// ------------------------------------------------------------------

test('classifier: a simple grid is NOT complex (GFM keeps it)', () => {
    assert.equal(isComplexTable(simpleTable()), false);
});

test('classifier: colspan/rowspan > 1 → complex', () => {
    const t1 = el('table', {}, [el('tr', {}, [el('td', { colspan: '2' }, [text('x')])])]);
    const t2 = el('table', {}, [el('tr', {}, [el('td', { rowspan: '3' }, [text('x')])])]);
    const t3 = el('table', {}, [el('tr', {}, [el('td', { colspan: '1' }, [text('x')])])]);
    assert.equal(isComplexTable(t1), true);
    assert.equal(isComplexTable(t2), true);
    assert.equal(isComplexTable(t3), false, 'span of 1 is not complex');
});

test('classifier: caption, nested table, multi-row header, block cells → complex', () => {
    assert.equal(isComplexTable(el('table', {}, [el('caption', {}, [text('c')])])), true);
    assert.equal(isComplexTable(el('table', {}, [el('tr', {}, [el('td', {}, [el('table')])])])), true);
    assert.equal(isComplexTable(el('table', {}, [
        el('thead', {}, [el('tr'), el('tr')])
    ])), true);
    assert.equal(isComplexTable(el('table', {}, [el('tr', {}, [el('td', {}, [el('p', {}, [text('para')])])])])), true);
    assert.equal(isComplexTable(el('table', {}, [el('tr', {}, [el('td', {}, [el('br')])])])), true);
});

test('classifier: non-tables and junk are false', () => {
    assert.equal(isComplexTable(null), false);
    assert.equal(isComplexTable(el('div')), false);
    assert.equal(isComplexTable(text('x')), false);
});

// ------------------------------------------------------------------
// sanitizeIslandNode — the canonical serializer
// ------------------------------------------------------------------

test('sanitizer: deterministic — same tree, same string', () => {
    const t = () => el('table', { style: 'color:red' }, [
        el('tr', {}, [el('td', { colspan: '2', onclick: 'evil()' }, [text('  a   b  ')])])
    ]);
    const a = sanitizeIslandNode(t(), 'table');
    const b = sanitizeIslandNode(t(), 'table');
    assert.equal(a, b);
    assert.equal(a, '<table><tr><td colspan="2">a b</td></tr></table>',
        'unknown attrs dropped, whitespace collapsed, fixed attr order');
});

test('sanitizer: escapes text and attribute values', () => {
    const t = el('table', {}, [el('tr', {}, [
        el('td', { colspan: '2"><script>' }, [text('<img src=x onerror=1>')])
    ])]);
    const out = sanitizeIslandNode(t, 'table');
    assert.ok(!out.includes('<img'), 'text content escaped');
    assert.ok(!out.includes('<script'), 'attr value escaped');
    assert.ok(out.includes('&lt;img'), 'escaped form present');
});

test('sanitizer: unknown elements unwrap; active content drops outright', () => {
    const t = el('table', {}, [el('tr', {}, [el('td', {}, [
        el('div', {}, [text('kept text')]),
        el('script', {}, [text('alert(1)')]),
        el('style', {}, [text('body{}')])
    ])])]);
    const out = sanitizeIslandNode(t, 'table');
    assert.ok(out.includes('kept text'), 'div unwraps to its text');
    assert.ok(!out.includes('alert(1)'), 'script text does not even leak');
    assert.ok(!out.includes('body{}'), 'style text does not leak');
});

test('sanitizer: href hygiene — javascript: dropped, https/relative kept', () => {
    const cell = (href) => el('table', {}, [el('tr', {}, [el('td', {}, [
        el('a', { href }, [text('link')])
    ])])]);
    assert.ok(!sanitizeIslandNode(cell('javascript:alert(1)'), 'table').includes('href'));
    assert.ok(sanitizeIslandNode(cell('https://x.test/a'), 'table').includes('href="https://x.test/a"'));
    assert.ok(sanitizeIslandNode(cell('/relative/path'), 'table').includes('href="/relative/path"'));
    assert.ok(!sanitizeIslandNode(cell('vbscript:x'), 'table').includes('href'));
});

test('sanitizer: whitespace-only text dropped between structural tags, kept in cells', () => {
    const t = el('table', {}, [
        text('\n  '),
        el('tr', {}, [text('\n    '), el('td', {}, [text('a'), text(' '), text('b')])]),
        text('\n')
    ]);
    assert.equal(sanitizeIslandNode(t, 'table'), '<table><tr><td>a b</td></tr></table>');
});

test('sanitizer: void elements self-close; wrong root refuses', () => {
    const t = el('table', {}, [el('colgroup', {}, [el('col', { span: '2' })]),
        el('tr', {}, [el('td', {}, [text('a'), el('br'), text('b')])])]);
    const out = sanitizeIslandNode(t, 'table');
    assert.ok(out.includes('<col span="2"/>'));
    assert.ok(out.includes('a<br/>b'));
    assert.equal(sanitizeIslandNode(el('div'), 'table'), '');
    assert.equal(sanitizeIslandNode(simpleTable(), 'math'), '', 'profile root enforced');
});

test('sanitizer: math profile serializes MathML, drops unknown attrs', () => {
    const m = el('math', { display: 'block', class: 'x' }, [
        el('mrow', {}, [
            el('mi', {}, [text('x')]), el('mo', {}, [text('=')]),
            el('mfrac', {}, [el('mn', {}, [text('1')]), el('mn', {}, [text('2')])])
        ])
    ]);
    assert.equal(sanitizeIslandNode(m, 'math'),
        '<math display="block"><mrow><mi>x</mi><mo>=</mo><mfrac><mn>1</mn><mn>2</mn></mfrac></mrow></math>');
});

// ------------------------------------------------------------------
// Fences + render-side fallback
// ------------------------------------------------------------------

test('wrapIsland/islandPattern round-trip', () => {
    const wrapped = wrapIsland('<table><tr><td>x</td></tr></table>', 'table');
    const m = islandPattern().exec(wrapped);
    assert.ok(m);
    assert.equal(m[1], 'table');
    assert.equal(m[2], '<table><tr><td>x</td></tr></table>');
});

test('sanitizeIslandString: null without DOMParser (node env)', () => {
    assert.equal(typeof DOMParser, 'undefined');
    assert.equal(sanitizeIslandString('<table></table>', 'table'), null);
    assert.equal(sanitizeIslandString('<table></table>', 'nope'), null);
});

test('markdownToHtml: an island that cannot be re-sanitized renders ESCAPED, never live', async () => {
    const { ContentExtractor } = await import('../src/shared/content-extractor.js');
    const md = 'Before.\n\n'
        + wrapIsland('<table><tr><td onclick="evil()">x</td></tr></table>', 'table')
        + '\n\nAfter.';
    const html = ContentExtractor.markdownToHtml(md);
    assert.ok(!/<table/.test(html), 'no live table markup without sanitization');
    assert.ok(html.includes('&lt;table&gt;'), 'body escaped as text');
    assert.ok(!html.includes('\u0000'), 'no placeholder residue');
    assert.ok(html.includes('<p>Before.</p>'));
    assert.ok(html.includes('<p>After.</p>'));
});

test('markdownToHtml: a hostile fence in foreign markdown cannot inject', async () => {
    const { ContentExtractor } = await import('../src/shared/content-extractor.js');
    const md = wrapIsland('<script>alert(1)</script>', 'table');
    const html = ContentExtractor.markdownToHtml(md);
    assert.ok(!html.includes('<script'), 'no live script');
});

// ------------------------------------------------------------------
// Prototype-pollution regression (PR #108 follow-up)
// ------------------------------------------------------------------

test('sanitizer: hostile prototype-named elements unwrap instead of crashing', () => {
    // `constructor`/`toString` resolve through Object.prototype on a
    // plain profile literal; treating them as "allowed tags" made the
    // attr loop throw and killed the WHOLE capture at extract time.
    for (const hostile of ['constructor', 'toString', 'hasOwnProperty']) {
        const t = el('table', {}, [
            el('tr', {}, [el('td', {}, [el(hostile, {}, [text('payload')])])])
        ]);
        const out = sanitizeIslandNode(t, 'table');
        assert.ok(out.includes('payload'), out);            // content survives, unwrapped
        assert.ok(!out.includes('<' + hostile), out);       // tag never serializes
    }
    const m = el('math', {}, [el('constructor', {}, [text('x')])]);
    const out = sanitizeIslandNode(m, 'math');
    assert.ok(out.includes('x') && !out.includes('<constructor'), out);
});
