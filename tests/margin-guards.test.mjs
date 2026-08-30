// Margin S1 guards — MARGIN_DESIGN.md §5.4 + the flag-default pin.
// Idiom: positive sanity assertion first, then the enforcing negative
// (the constitution-guards convention; helpers stay test-local).
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

const { FLAGS_DEFAULTS } = await import('../src/shared/metadata/feature-flags.js');

test('guard: marginView defaults OFF (MARGIN_DESIGN §9 — S1 ships behind its own default-off flag)', () => {
    assert.ok(Object.prototype.hasOwnProperty.call(FLAGS_DEFAULTS, 'marginView'),
        'the marginView key is registered in FLAGS_DEFAULTS');
    assert.equal(FLAGS_DEFAULTS.marginView, false);
});

import { readFile } from 'node:fs/promises';

const AV = await import('../src/reader/annotated-view.js');
const RESERVED = /verdict|ruling|opinion|court|integrity/i;

const mkNote = (id, family, over = {}) => ({
    id, family, quote: 'q ' + id, grounding: { status: 'exact', start: 0, end: 5, exact: 'q ' + id },
    pageReason: null, title: ({ claim: 'Claim', extraction: 'Claim proposal', forensic: 'Forensic finding — x',
        audit: 'Audit evidence — m', prediction: 'Prediction' })[family],
    body: 'b', meta: {}, actions: ['locate'], reviewState: family === 'extraction' ? 'open' : null, sub: [], ...over
});

test('guard (draft-leak): the annotated shell is read-only and the module never touches the draft body', async () => {
    const html = AV.annotatedShellHtml({ title: 't', bodyHtml: '<p>x</p>' });
    assert.match(html, /contenteditable="false"/, 'the annotated body is explicitly non-editable');
    assert.doesNotMatch(html, /contenteditable="true"/);
    const src = await readFile(new URL('../src/reader/annotated-view.js', import.meta.url), 'utf8');
    assert.ok(src.includes('xr-ann-body'), 'scanner sanity: the module builds the annotated body');
    assert.doesNotMatch(src, /xr-article__body/, 'annotated-view.js never references the editable draft body');
    assert.doesNotMatch(src, /htmlDraft\s*=/, 'annotated-view.js never assigns the draft');
});

test('guard (no-fused-number): the strip renders per-family counts and coverage, never a summed insight total', () => {
    // 3 claims + 2 audit + 1 forensic = 6 total; "6" must not appear.
    const notes = [
        mkNote('c1', 'claim'), mkNote('c2', 'claim'), mkNote('c3', 'claim'),
        mkNote('a1', 'audit'), mkNote('a2', 'audit'), mkNote('f1', 'forensic')
    ];
    const html = AV.renderStrip({ notes, visibility: {} });
    assert.match(html, /Claims · 3/, 'scanner sanity: per-family counts render');
    assert.match(html, /6 anchored · 0 page notes/, 'the labeled coverage measurement renders (the §10 row 1 carve-out)');
    const stripped = html.replace(/6 anchored · 0 page notes/, '');
    assert.doesNotMatch(stripped, /\b6\b/, 'no cross-family insight total outside the labeled coverage split');
});

test('guard (reserved-vocabulary): non-truth chrome carries no reserved word; the truth sub-card lawfully does', () => {
    const notes = [mkNote('c1', 'claim'), mkNote('x1', 'extraction'), mkNote('a1', 'audit'), mkNote('f1', 'forensic'), mkNote('p1', 'prediction')];
    for (const html of [AV.renderStrip({ notes, visibility: {} }), AV.renderCardsPanel(notes), AV.legendHtml()]) {
        assert.doesNotMatch(html, RESERVED);
    }
    const withTruth = AV.renderCard(mkNote('c9', 'claim', { sub: [{ kind: 'verdict', record: { verdict: 'supported', standard_of_proof: 'clear' } }] }));
    const truthStart = withTruth.indexOf('xr-ann-truth');
    assert.ok(truthStart > -1, 'scanner sanity: the truth sub-card exists');
    assert.doesNotMatch(withTruth.slice(0, truthStart), RESERVED, 'reserved words appear only at/inside the truth sub-card');
});

test('guard (audit-fence): audit cards render inside one fenced group, last, never interleaved', () => {
    const notes = [mkNote('a1', 'audit'), mkNote('c1', 'claim'), mkNote('a2', 'audit'), mkNote('x1', 'extraction')];
    const html = AV.renderCardsPanel(notes);
    const fenceStart = html.indexOf('xr-ann-group--audit');
    assert.ok(fenceStart > -1, 'scanner sanity: the audit fence exists');
    const fence = html.slice(fenceStart);
    assert.ok(fence.includes('data-note="a1"') && fence.includes('data-note="a2"'), 'every audit card is inside the fence');
    assert.doesNotMatch(fence, /data-family="claim"|data-family="extraction"|data-family="forensic"|data-family="prediction"/,
        'no other family renders inside or after the audit fence');
    const beforeFence = html.slice(0, fenceStart);
    assert.doesNotMatch(beforeFence, /data-family="audit"/, 'no audit card escapes the fence');
});
