// PR-8 of docs/PORTAL_UX_REVIEW.md — header regroup (D1 layout half) and
// the identity fold (D2 fold half).
//
// D1: the header mixed three action families in one row — four import
// buttons, a graph view, two sync buttons. Now ONE "Add ▾" menu (the
// case view's "Sources ▾" idiom), Refresh stays visible, and Full
// resync + Across workspaces live in a "⋯" overflow.
// D2: the identity strip (chips + viewer input + settings button) folds
// behind a one-line summary: "Showing events signed by <key> ▸".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const readRaw = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const read = (p) => readRaw(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const { addMenuOptions, identitySummaryLine } = await import('../src/portal/header-chrome.js');

// ------------------------------------------------------------------
// The Add ▾ menu
// ------------------------------------------------------------------

test('Add ▾ lists the three always-on importers, placeholder first', () => {
    const opts = addMenuOptions({ transcribeEnabled: false });
    assert.equal(opts[0].value, '', 'first option is the inert label');
    assert.match(opts[0].label, /Add/);
    assert.deepEqual(opts.slice(1).map((o) => o.value), ['transcript', 'book', 'urls']);
    assert.ok(!opts.some((o) => o.value === 'media'), 'Transcribe a URL is flag-gated — absent when off, not greyed');
});

test('Add ▾ gains "Transcribe a URL" only when localTranscription is on', () => {
    const opts = addMenuOptions({ transcribeEnabled: true });
    assert.deepEqual(opts.slice(1).map((o) => o.value), ['transcript', 'media', 'book', 'urls']);
    const media = opts.find((o) => o.value === 'media');
    assert.match(media.label, /Transcribe a URL/);
});

test('every Add ▾ option carries a human label and a title (the old buttons had both)', () => {
    for (const o of addMenuOptions({ transcribeEnabled: true }).slice(1)) {
        assert.ok(o.label && o.label.length > 3, `${o.value} needs a label`);
        assert.ok(o.title && o.title.length > 10, `${o.value} needs its explanatory title`);
    }
});

// ------------------------------------------------------------------
// The identity summary line
// ------------------------------------------------------------------

const PK_A = '76c03326' + 'a'.repeat(52) + '0039';
const PK_B = 'b'.repeat(64);

test('one identity: "Showing events signed by <shortKey>"', () => {
    const line = identitySummaryLine({ identities: [{ pubkey: PK_A }], viewers: [] });
    assert.match(line, /^Showing events signed by 76c03326…0039$/);
});

test('two identities are listed, not counted — you should see WHOSE events', () => {
    const line = identitySummaryLine({ identities: [{ pubkey: PK_A }, { pubkey: PK_B }], viewers: [] });
    assert.match(line, /76c03326…0039/);
    assert.match(line, /bbbbbbbb…bbbb/);
});

test('viewers are named as viewing, never folded into "signed by"', () => {
    // identity.js fences manual-only pubkeys as VIEWERS (never "me"); the
    // summary must keep that distinction visible.
    const line = identitySummaryLine({ identities: [{ pubkey: PK_A }], viewers: [{ pubkey: PK_B }] });
    assert.match(line, /signed by 76c03326…0039/);
    assert.match(line, /viewing bbbbbbbb…bbbb/);
    assert.ok(line.indexOf('signed by') < line.indexOf('viewing'));
});

test('no identity at all says so plainly', () => {
    assert.match(identitySummaryLine({ identities: [], viewers: [] }), /No archive identity/);
});

// ------------------------------------------------------------------
// SEAMS — the markup and the wiring actually changed
// ------------------------------------------------------------------

test('SEAM (D1): the four import buttons are gone from the header; one Add ▾ select replaces them', () => {
    const html = readRaw('src/portal/index.html');
    for (const id of ['xr-import-transcript', 'xr-transcribe-url', 'xr-import-book', 'xr-import-urls']) {
        assert.ok(!html.includes(`id="${id}"`), `${id} must not be a header button any more`);
    }
    assert.match(html, /<select[^>]*id="xr-add-menu"/);
    assert.match(html, /<button[^>]*id="xr-refresh"/, 'Refresh stays a visible button');
    assert.match(html, /<select[^>]*id="xr-more-menu"/, 'the ⋯ overflow exists');
    assert.ok(!html.includes('id="xr-resync"'), 'Full resync moves into the overflow');
    assert.ok(!html.includes('id="xr-cross-ws"'), 'Across workspaces moves into the overflow');
});

test('SEAM (D1): the Add ▾ menu is composed from the pure list, gated on the flag, and drives the panel switch', () => {
    const src = read('src/portal/index.js');
    assert.match(src, /addMenuOptions\(\{ transcribeEnabled: isEnabled\('localTranscription'\) \}\)/,
        'the menu must be built from the pure list, gated on the real flag');
    // Fix Round 1's Critical finding on the button this replaces: the
    // gate was read before flags loaded and read the default (off).
    assert.match(src, /await loadFlags\(\);[\s\S]{0,400}addMenuOptions\(/,
        'the options must be composed AFTER flags load');
    for (const name of ['transcript', 'media', 'book', 'urls']) {
        assert.match(src, new RegExp(`importPanels\\(\\)\\.open\\('${name}'`), `${name} still goes through the PR-3 switch`);
    }
});

test('SEAM (D1): the ⋯ overflow routes Across workspaces to the nav stack and Full resync to the cache clear', () => {
    const src = read('src/portal/index.js');
    const more = /const more = \$\('#xr-more-menu'\)[\s\S]{0,1400}/.exec(src);
    assert.ok(more, 'the overflow is wired');
    assert.match(more[0], /navigateTo\(\{ name: 'cross-workspace' \}\)/, 'Across workspaces must stay re-traceable (PR-6)');
    assert.match(more[0], /clearAll\(\)/, 'Full resync must still clear the cache before refetching');
    assert.match(src, /\$\('#xr-more-menu'\)\.disabled = busy/, 'setBusy must disable the overflow (resync lives there)');
});

test('SEAM (D2): the identity strip is a <details> behind a rendered summary', () => {
    const html = readRaw('src/portal/index.html');
    assert.match(html, /<details[^>]*id="xr-identity"/);
    assert.match(html, /<summary[^>]*id="xr-identity-summary"/);
    const src = read('src/portal/index.js');
    assert.match(src, /identitySummaryLine\(\{ identities: state\.identities, viewers: state\.viewers \}\)/,
        'renderIdentityChips must write the summary from the pure line');
});
