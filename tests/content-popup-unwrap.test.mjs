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
