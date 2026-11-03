// Tests for ContentExtractor._unwrapInlinePopups — the josephsmithpapers.org
// inline-name fix. There's no jsdom in this harness, so we exercise the
// branch logic against hand-built DOM stubs (same approach as the platform
// handler tests).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ContentExtractor } from '../src/shared/content-extractor.js';

// Minimal stubs ----------------------------------------------------------

function makeRef(className, textContent) {
    return { className, textContent };
}

function makeWrapper(ref) {
    return {
        ref,
        replaced: null,
        removed: false,
        querySelector() { return this.ref; },
        replaceWith(node) { this.replaced = node; },
        remove() { this.removed = true; }
    };
}

function makeRoot(wrappers) {
    return {
        // A Document exposes createTextNode; mark text nodes so we can assert.
        createTextNode(text) { return { nodeType: 3, text }; },
        querySelectorAll(sel) {
            assert.equal(sel, 'aside.popup-wrapper');
            return wrappers;
        }
    };
}

// Tests ------------------------------------------------------------------

test('entity reference is replaced with its visible text', () => {
    const wrap = makeWrapper(makeRef('reference staticPopup', 'Nauvoo'));
    const root = makeRoot([wrap]);

    const count = ContentExtractor._unwrapInlinePopups(root);

    assert.equal(count, 1);
    assert.equal(wrap.removed, false);
    assert.deepEqual(wrap.replaced, { nodeType: 3, text: 'Nauvoo' });
});

test('person reference text is trimmed', () => {
    const wrap = makeWrapper(makeRef('reference staticPopup', '  Brigham Young\n\t'));
    const root = makeRoot([wrap]);

    ContentExtractor._unwrapInlinePopups(root);

    assert.deepEqual(wrap.replaced, { nodeType: 3, text: 'Brigham Young' });
});

test('editorial-note footnote markers are dropped, not inlined', () => {
    const wrap = makeWrapper(makeRef('editorial-note-static staticPopup', '1'));
    const root = makeRoot([wrap]);

    const count = ContentExtractor._unwrapInlinePopups(root);

    assert.equal(count, 0);
    assert.equal(wrap.removed, true);
    assert.equal(wrap.replaced, null);
});

test('empty wrapper with no reference is removed', () => {
    const wrap = makeWrapper(null);
    const root = makeRoot([wrap]);

    ContentExtractor._unwrapInlinePopups(root);

    assert.equal(wrap.removed, true);
    assert.equal(wrap.replaced, null);
});

test('handles a mix of entity and footnote wrappers in one pass', () => {
    const name = makeWrapper(makeRef('reference staticPopup', 'Nauvoo'));
    const note = makeWrapper(makeRef('editorial-note-static staticPopup', '1'));
    const person = makeWrapper(makeRef('reference staticPopup', 'Brigham Young'));
    const root = makeRoot([name, note, person]);

    const count = ContentExtractor._unwrapInlinePopups(root);

    assert.equal(count, 2);
    assert.equal(name.replaced.text, 'Nauvoo');
    assert.equal(person.replaced.text, 'Brigham Young');
    assert.equal(note.removed, true);
});

test('never throws on a malformed root', () => {
    assert.equal(ContentExtractor._unwrapInlinePopups(null), 0);
    assert.equal(ContentExtractor._unwrapInlinePopups({}), 0);
});

// Inline-overlay nodes are stripped from the capture clone ---------------

test('_stripOverlayNodes removes pins/chip/style/frame and unwraps marks', () => {
    const log = [];
    const mk = (name, kids = []) => {
        const n = {
            name, parentNode: null, childNodes: kids,
            get firstChild() { return this.childNodes[0] || null; },
            insertBefore(c, ref) {
                if (c.parentNode) c.parentNode.childNodes.splice(c.parentNode.childNodes.indexOf(c), 1);
                this.childNodes.splice(this.childNodes.indexOf(ref), 0, c); c.parentNode = this;
            },
            removeChild(c) { this.childNodes.splice(this.childNodes.indexOf(c), 1); c.parentNode = null; log.push(c.name); }
        };
        kids.forEach((k) => { k.parentNode = n; });
        return n;
    };
    const text = mk('text');
    const mark = mk('mark', [text]);
    const pin = mk('pin');
    const chip = mk('chip');
    const para = mk('p', [mark, pin]);
    const body = mk('body', [para, chip]);
    const root = {
        querySelectorAll(sel) {
            if (sel.includes('.xr-ov-pin')) return [pin, chip];
            if (sel === '.xr-ov-mark') return [mark];
            return [];
        }
    };
    ContentExtractor._stripOverlayNodes(root);
    assert.deepEqual(para.childNodes.map((n) => n.name), ['text']);
    assert.deepEqual(body.childNodes.map((n) => n.name), ['p']);
    assert.ok(log.includes('pin') && log.includes('chip') && log.includes('mark'));
    assert.doesNotThrow(() => ContentExtractor._stripOverlayNodes(null));
});
