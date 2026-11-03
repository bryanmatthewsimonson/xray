// PR-5 of docs/PORTAL_UX_REVIEW.md — the inspector's opener stops being
// a secret (C2), and the timeline says how to use it (B3-caption).
//
// C2: row titles opened the inspector, disclosed ONLY by a hover
// tooltip — invisible on touch and to anyone who does not hover. A
// visible trailing ⓘ on every row, bound to the same handler; the title
// click stays.
// B3: drag-to-brush existed only as mouse handlers and an HTML comment.
// One caption under the chart, whenever it renders unbrushed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

// A minimal document so the pure builder can be driven in node.
globalThis.document = {
    createElement(tag) {
        const node = {
            tagName: tag.toUpperCase(), className: '', textContent: '', attrs: {}, listeners: {},
            setAttribute(k, v) { this.attrs[k] = v; },
            addEventListener(type, fn) { this.listeners[type] = fn; },
            appendChild(c) { (this.children ||= []).push(c); return c; }
        };
        return node;
    }
};

const { inspectButton, TIMELINE_HINT } = await import('../src/portal/row-controls.js');

test('C2: the ⓘ is a real button, labelled for assistive tech, bound to the handler it is given', () => {
    let opened = 0;
    const btn = inspectButton(() => { opened += 1; });
    assert.equal(btn.tagName, 'BUTTON');
    assert.equal(btn.attrs.type, 'button');
    assert.ok(/inspect/i.test(btn.attrs['aria-label'] || ''), 'screen readers must hear what it does');
    assert.ok(btn.textContent.length > 0, 'it must be VISIBLE — that is the whole point');
    btn.listeners.click({ stopPropagation() {} });
    assert.equal(opened, 1);
});

test('C2 SEAM: every row builder that opens the inspector on title-click also renders the ⓘ', () => {
    const portal = read('src/portal/index.js');
    const caseView = read('src/portal/case-view.js');
    // Each place a title click opens the inspector must carry the
    // visible opener beside it — count them, so a fourth row builder
    // added later without the ⓘ fails here.
    const titleOpeners = (src) => (src.match(/titleEl\.title = 'Inspect — raw event/g) || []).length;
    const visibleOpeners = (src) => (src.match(/inspectButton\(/g) || []).length;
    assert.equal(titleOpeners(portal), 1);
    assert.equal(visibleOpeners(portal), titleOpeners(portal), 'index.js: every title-opener row has its ⓘ');
    assert.equal(titleOpeners(caseView), 2);
    assert.equal(visibleOpeners(caseView), titleOpeners(caseView), 'case-view.js: every title-opener row has its ⓘ');
});

test('B3: the timeline caption exists, says what to do, and renders only when UNBRUSHED', () => {
    assert.match(TIMELINE_HINT, /drag/i);
    assert.match(TIMELINE_HINT, /filter/i);
    const portal = read('src/portal/index.js');
    // It is appended in renderTimeline, guarded by the brush state —
    // once a range is active the ✕ chip carries the affordance instead.
    assert.match(portal, /if \(!brushed\) \{[^}]*TIMELINE_HINT/s,
        'the caption must be conditional on the chart being unbrushed');
});

test('B3: the HTML comment was not the only disclosure any more', () => {
    // The comment at index.html ("Drag across bars to brush a range")
    // may stay — it is for maintainers — but it must no longer be the
    // ONLY place the affordance is stated.
    const html = readFileSync(new URL('../src/portal/index.html', import.meta.url), 'utf8');
    assert.match(html, /Drag across bars/);   // still there, for maintainers
    const portal = read('src/portal/index.js');
    assert.match(portal, /xr-portal__timeline-hint/, 'a rendered, user-visible hint element exists');
});
