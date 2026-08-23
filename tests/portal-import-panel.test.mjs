// PR-3 of docs/PORTAL_UX_REVIEW.md — import panel mechanics (the
// mechanical half of finding D1). Before this, every header import
// button ran the same line — "if something is open, close it and
// return" — so clicking a DIFFERENT importer while one was open merely
// closed the open one; the importer you asked for took a second click.
// The book panel also had no Close at all.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { createImportPanelSwitch } = await import('../src/portal/import-panel.js');

/** A host stub with the three things the switch touches. */
function stubHost() {
    const host = {
        children: [],
        dataset: {},
        get childElementCount() { return this.children.length; },
        replaceChildren(...kids) { this.children = kids; }
    };
    return host;
}
const mounter = (label) => (host) => { host.children.push(label); };

test('a closed host opens the requested panel', () => {
    const host = stubHost();
    const panels = createImportPanelSwitch(host);
    const r = panels.open('book', mounter('BOOK'));
    assert.equal(r, 'opened');
    assert.deepEqual(host.children, ['BOOK']);
    assert.equal(host.dataset.xrPanel, 'book');
});

test('the same button again CLOSES it (toggle preserved)', () => {
    const host = stubHost();
    const panels = createImportPanelSwitch(host);
    panels.open('book', mounter('BOOK'));
    const r = panels.open('book', mounter('BOOK'));
    assert.equal(r, 'closed');
    assert.equal(host.childElementCount, 0);
    assert.equal(host.dataset.xrPanel, undefined);
});

test('THE DEFECT: a different button SWAPS in one click, not two', () => {
    const host = stubHost();
    const panels = createImportPanelSwitch(host);
    panels.open('transcript', mounter('TRANSCRIPT'));
    const r = panels.open('book', mounter('BOOK'));
    assert.equal(r, 'opened', 'must open the book panel, not merely close the transcript one');
    assert.deepEqual(host.children, ['BOOK'], 'exactly one panel mounted — the one asked for');
    assert.equal(host.dataset.xrPanel, 'book');
});

test('a panel that removed ITSELF (its own Close button) leaves the switch consistent', () => {
    // Every panel's Close does panel.remove() — the host empties but no
    // one tells the switch. Keying on the live child count (not only
    // the name tag) means the next click of the SAME button opens again
    // instead of "closing" an already-empty host.
    const host = stubHost();
    const panels = createImportPanelSwitch(host);
    panels.open('urls', mounter('URLS'));
    host.children = [];                       // the panel's Close ran
    const r = panels.open('urls', mounter('URLS'));
    assert.equal(r, 'opened');
    assert.deepEqual(host.children, ['URLS']);
});

test('SEAM: every header importer goes through the switch; the old close-and-return line is gone', () => {
    const src = readFileSync(new URL('../src/portal/index.js', import.meta.url), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    assert.ok(!/if \(importHost\.childElementCount > 0\) \{ importHost\.replaceChildren\(\); return; \}/.test(src),
        'the two-click defect line must not survive anywhere');
    for (const name of ['transcript', 'book', 'urls', 'media']) {
        assert.match(src, new RegExp(`importPanels\\(\\)\\.open\\('${name}'`), `the ${name} importer must use the switch`);
    }
});

test('the book panel has a Close button like its siblings', () => {
    const src = readFileSync(new URL('../src/portal/import-book.js', import.meta.url), 'utf8');
    assert.match(src, /'Close'\)/, 'the book import panel had no way to dismiss it');
    assert.match(src, /card\.remove\(\)/, 'Close removes the panel, same idiom as the transcript/URL importers');
});
