// HTML snapshot tests — Phase 8a.
//
// snapshot() runs against DOM nodes; we use a minimal fake DOM
// (just enough to satisfy the methods snapshot() touches) instead
// of pulling jsdom in as a dep. Keeps the test surface honest about
// what the function actually requires from a Node.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapshot, snapshotHash } from '../src/shared/html-snapshot.js';

// Minimal DOM Element shim. Implements just what snapshot() touches:
// nodeType, tagName, attributes, children, parentNode, removeChild,
// removeAttribute, setAttribute, outerHTML, cloneNode.
function el(tag, { attrs = {}, children = [] } = {}) {
    const node = {
        nodeType: 1,
        tagName: tag.toUpperCase(),
        children: [],
        parentNode: null,
        _attrs: new Map(Object.entries(attrs)),
        get attributes() {
            return [...this._attrs.entries()].map(([name, value]) => ({ name, value }));
        },
        removeAttribute(name) { this._attrs.delete(name); },
        setAttribute(name, value) { this._attrs.set(name, String(value)); },
        removeChild(child) {
            const idx = this.children.indexOf(child);
            if (idx >= 0) this.children.splice(idx, 1);
        },
        cloneNode(deep) {
            const copy = el(tag, { attrs: Object.fromEntries(this._attrs) });
            if (deep) {
                for (const c of this.children) {
                    const child = c.cloneNode(true);
                    child.parentNode = copy;
                    copy.children.push(child);
                }
            }
            return copy;
        },
        get outerHTML() {
            const attrStr = [...this._attrs.entries()]
                .map(([k, v]) => ` ${k}="${v}"`).join('');
            const open = `<${tag.toLowerCase()}${attrStr}>`;
            const close = `</${tag.toLowerCase()}>`;
            const inner = this.children.map((c) => c.outerHTML).join('');
            return open + inner + close;
        }
    };
    for (const c of children) {
        c.parentNode = node;
        node.children.push(c);
    }
    return node;
}

test('snapshot returns empty string for non-element input', () => {
    assert.equal(snapshot(null), '');
    assert.equal(snapshot(undefined), '');
    assert.equal(snapshot('string'), '');
    assert.equal(snapshot({ nodeType: 3, textContent: 'text node' }), '');
});

test('snapshot strips <script> tags entirely', () => {
    const root = el('div', {
        children: [
            el('p', { children: [] }),
            el('script', { attrs: { src: 'evil.js' } }),
            el('span', {})
        ]
    });
    const out = snapshot(root);
    assert.ok(!out.includes('<script'), 'must not contain <script');
    assert.ok(out.includes('<p'), 'must keep <p');
    assert.ok(out.includes('<span'), 'must keep <span');
});

test('snapshot strips on* event handlers but keeps other attributes', () => {
    const root = el('button', {
        attrs: { onclick: 'doEvil()', onmouseover: 'x()', id: 'btn', 'aria-label': 'Click me' }
    });
    const out = snapshot(root);
    assert.ok(!out.includes('onclick'), 'onclick must be stripped');
    assert.ok(!out.includes('onmouseover'), 'onmouseover must be stripped');
    assert.ok(out.includes('id="btn"'), 'id must be preserved');
    assert.ok(out.includes('aria-label'), 'aria-* must be preserved');
});

test('snapshot strips data: URLs in src/href', () => {
    const root = el('div', {
        children: [
            el('img',  { attrs: { src: 'data:image/png;base64,AAAA', alt: 'evil' } }),
            el('img',  { attrs: { src: 'https://example.com/ok.png', alt: 'ok' } }),
            el('a',    { attrs: { href: 'data:text/html,<script>alert(1)</script>' } })
        ]
    });
    const out = snapshot(root);
    assert.ok(!out.includes('data:image'), 'data:image src must be stripped');
    assert.ok(!out.includes('data:text/html'), 'data:text/html href must be stripped');
    assert.ok(out.includes('https://example.com/ok.png'),
        'normal https src must be preserved');
});

test('snapshot strips <iframe>, <object>, <embed>, <noscript>, <link>, <meta>', () => {
    const root = el('div', {
        children: [
            el('iframe',  {}),
            el('object',  {}),
            el('embed',   {}),
            el('noscript',{}),
            el('link',    {}),
            el('meta',    {}),
            el('p',       {})
        ]
    });
    const out = snapshot(root);
    for (const tag of ['iframe', 'object', 'embed', 'noscript', 'link', 'meta']) {
        assert.ok(!out.includes(`<${tag}`), `${tag} must be stripped`);
    }
    assert.ok(out.includes('<p'), '<p> must be preserved');
});

test('snapshot does not modify the source element', () => {
    const root = el('div', {
        attrs: { onclick: 'evil()' },
        children: [el('script', {})]
    });
    snapshot(root);
    // Source still has the unsafe content.
    const stillHasOnclick = root._attrs.has('onclick');
    const stillHasScript  = root.children.some((c) => c.tagName === 'SCRIPT');
    assert.ok(stillHasOnclick, 'cloneNode must isolate sanitization from the live tree');
    assert.ok(stillHasScript,  'live tree script element must be untouched');
});

test('snapshot truncates beyond maxBytes with a marker', () => {
    // Build a large element whose outerHTML well exceeds 200 bytes.
    const giant = el('div', {
        children: Array.from({ length: 50 }, () => el('p', { attrs: { class: 'x'.repeat(20) } }))
    });
    const out = snapshot(giant, { maxBytes: 200 });
    const bytes = new TextEncoder().encode(out).length;
    assert.ok(bytes <= 200, `truncated output must fit cap (${bytes} > 200)`);
    assert.ok(out.endsWith('truncated by X-Ray html-snapshot -->'),
        'truncated output must end with the marker');
});

test('snapshot below cap leaves marker absent', () => {
    const small = el('p', { attrs: { id: 'tiny' } });
    const out = snapshot(small);
    assert.ok(!out.includes('truncated'), 'no marker when under cap');
});

test('snapshotHash returns a 64-char hex sha256', async () => {
    const html = '<p>hello</p>';
    const hash = await snapshotHash(html);
    assert.ok(typeof hash === 'string', 'must return string');
    assert.equal(hash.length, 64, 'sha256 hex is 64 chars');
    assert.match(hash, /^[0-9a-f]{64}$/);
});

test('snapshotHash is deterministic for identical input', async () => {
    const a = await snapshotHash('<p>same</p>');
    const b = await snapshotHash('<p>same</p>');
    assert.equal(a, b);
});
