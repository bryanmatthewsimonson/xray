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

    // annotated-view.js is a pure renderer; it never sees `state` at all,
    // so the assertions above can't see a regression at the real seam —
    // reader/index.js's annotated render block, whose onTag deliberately
    // omits renderReader's `state.htmlDraft = body.innerHTML` sync AND
    // its `state.dirtySource` flip (the §3 draft-leak). Slice the WHOLE
    // block — renderAnnotatedSafely through the end of
    // installAnnotatedTagger — rather than one function: the leak can be
    // reintroduced by any handler in it, and a guard that watches one
    // function while five siblings mutate the same state is theatre.
    const readerSrc = await readFile(new URL('../src/reader/index.js', import.meta.url), 'utf8');
    const startMarker = 'function renderAnnotatedSafely';
    const endMarker = 'function installAnnotatedTagger';
    const start = readerSrc.indexOf(startMarker);
    const taggerAt = readerSrc.indexOf(endMarker);
    assert.ok(start > -1, 'scanner sanity: renderAnnotatedSafely exists in reader/index.js');
    assert.ok(taggerAt > start, 'scanner sanity: installAnnotatedTagger follows it');
    // End at the next top-level function AFTER installAnnotatedTagger.
    const afterTagger = readerSrc.slice(taggerAt + endMarker.length);
    const nextFnOffset = afterTagger.search(/\n(async )?function /);
    const end = nextFnOffset === -1
        ? readerSrc.length
        : taggerAt + endMarker.length + nextFnOffset;
    const blockSrc = readerSrc.slice(start, end);
    assert.ok(blockSrc.includes('async function renderAnnotated('), 'scanner sanity: the slice captures renderAnnotated');
    assert.ok(blockSrc.includes('onAnnotatedClick'), 'scanner sanity: the slice captures the click handler');
    assert.ok(blockSrc.includes('onTag:'), 'scanner sanity: the slice captures installAnnotatedTagger\'s onTag');
    // Strip `//` comments before matching: the paragraphs explaining this
    // guard deliberately name `state.htmlDraft = body.innerHTML` as the
    // line that must stay absent, which would otherwise self-trigger the
    // regex against the comment text rather than against real code.
    const blockCode = blockSrc.replace(/\/\/.*$/gm, '');
    assert.ok(/body\.innerHTML = state\.htmlDraft/.test(blockCode),
        'scanner sanity: the block still READS the draft to seed its display copy');
    assert.doesNotMatch(blockCode, /state\.(htmlDraft|dirtySource)\s*=/,
        'nothing in the annotated block may write the reader draft or flip its canonical source (the §3 draft-leak, held structurally)');
});

test('guard (hash seam): reader/index.js has exactly ONE writer of state.articleHash', async () => {
    // F13. The Annotated view's whole note set keys on the capture hash,
    // so every path that recomputes one must re-render the margin. Eight
    // sites used to assign it and each had to REMEMBER; three did. The
    // invariant is structural: one writer, which re-renders, so
    // forgetting is not expressible.
    const src = await readFile(new URL('../src/reader/index.js', import.meta.url), 'utf8');
    const code = src.replace(/\/\/.*$/gm, '');
    assert.ok(code.includes('function applyArticleHashes'), 'scanner sanity: the seam exists');
    assert.ok(/applyArticleHashes\([\s\S]{0,400}?articleHash:/.test(code),
        'scanner sanity: callers route hashes through the seam');
    const writes = code.match(/state\.articleHash\s*=(?!=)/g) || [];
    assert.equal(writes.length, 1,
        `state.articleHash must be assigned in exactly one place (applyArticleHashes); found ${writes.length}`);
    // …and that one assignment is inside the seam.
    const seamAt = code.indexOf('function applyArticleHashes');
    const writeAt = code.search(/state\.articleHash\s*=(?!=)/);
    assert.ok(writeAt > seamAt && writeAt - seamAt < 600, 'the single assignment lives inside applyArticleHashes');
});

test('guard (escape-interpolation): hostile action ids and reviewState never break out of an attribute', () => {
    const hostile = mkNote('h1', 'claim', { actions: ['locate', '" onmouseover="x'], reviewState: '"><img src=x>' });
    const html = AV.renderCard(hostile);
    assert.match(html, /xr-ann-act--/, 'scanner sanity: the action class still renders');
    assert.doesNotMatch(html, /" onmouseover=/, 'the hostile action id cannot break out of the class/data-action attribute or its label text');
    assert.doesNotMatch(html, /"><img src=x>/, 'the hostile reviewState cannot break out of the review class attribute');
});

// The §10 row 1 invariant, stated once so the guard and its mutation
// harness cannot drift: the margin may count WITHIN a family and may
// state its labeled coverage split, but it must never fuse families into
// one number — no "6 insights", no density figure, no score.
export function assertNoFusedNumber(AVmod) {
    // 3 claims + 2 audit + 1 forensic = 6 total; "6" must not appear.
    const notes = [
        mkNote('c1', 'claim'), mkNote('c2', 'claim'), mkNote('c3', 'claim'),
        mkNote('a1', 'audit'), mkNote('a2', 'audit'), mkNote('f1', 'forensic')
    ];
    const html = AVmod.renderStrip({ notes, visibility: {} });
    assert.match(html, /Claims · 3/, 'scanner sanity: per-family counts render');
    assert.match(html, /6 anchored · 0 page notes/, 'the labeled coverage measurement renders (the §10 row 1 carve-out)');
    const COVERAGE = /6 anchored · 0 page notes/;
    const stripped = html.replace(COVERAGE, '');
    assert.doesNotMatch(stripped, /\b6\b/, 'no cross-family insight total outside the labeled coverage split');
    // (a) The cards panel is the OTHER surface that sees every family at
    // once, and the original guard never looked at it.
    const panel = AVmod.renderCardsPanel(notes);
    assert.match(panel, /data-note="c1"/, 'scanner sanity: the panel renders cards');
    assert.doesNotMatch(panel, /\b6\b/, 'the cards panel carries no cross-family total either');
    // (b) No fraction/ratio anywhere in the strip, and no number wearing
    // an aggregate noun — a "coverage 0.86" or "6 insights" is the same
    // fused figure the \b6\b check would miss the moment the fixture
    // count changed.
    assert.doesNotMatch(stripped, /\b\d+\.\d+\b/, 'no decimal ratio/score in the strip');
    assert.doesNotMatch(stripped, /\b\d+\s*(insights|notes|score|density)\b/i,
        'no number labeled as an aggregate outside the coverage span');
    // Both word orders. The mutation run that produced this line put
    // "density 6" in the strip and the number-first pattern sailed past
    // it — a guard that only knows one phrasing of the thing it forbids
    // is a guard against phrasing, not against the thing.
    assert.doesNotMatch(stripped, /\b(insights|notes|score|density|total)\s*[:·]?\s*\d+\b/i,
        'nor an aggregate noun followed by its number');
    // (c) The legend explains the marks; a digit there is either a count
    // that belongs on a chip or a threshold the user cannot act on.
    assert.doesNotMatch(AVmod.legendHtml(), /\d/, 'the legend carries no numbers at all');
}

test('guard (no-fused-number): the strip renders per-family counts and coverage, never a summed insight total', () => {
    assertNoFusedNumber(AV);
});

test('guard (audit body-tint firewall): an audit-only segment is silent, and density can never re-tint it', () => {
    const byId = new Map([
        ['a1', { family: 'audit' }], ['a2', { family: 'audit' }], ['a3', { family: 'audit' }],
        ['c1', { family: 'claim' }]
    ]);
    const auditOnly = AV.segClass({ start: 0, end: 5, ids: ['a1', 'a2'] }, byId);
    assert.match(auditOnly, /xr-ann-seg--silent/, 'an audit-only segment is silent');
    assert.doesNotMatch(auditOnly, /xr-ann-seg--dense/, 'and never carries the density tint');
    // The firewall breach the CSS-order version allowed: three audit
    // notes on one span tripped the density step and painted the body.
    const denseAudit = AV.segClass({ start: 0, end: 5, ids: ['a1', 'a2', 'a3'] }, byId);
    assert.match(denseAudit, /xr-ann-seg--silent/, 'three overlapping audit notes stay silent');
    assert.doesNotMatch(denseAudit, /xr-ann-seg--dense/,
        'silent beats dense STRUCTURALLY — the audit family never tints the body (§5.3)');
    // A mixed segment is a normal tinted span: the firewall is about
    // audit ALONE, not about suppressing every span audit touches.
    const mixed = AV.segClass({ start: 0, end: 5, ids: ['a1', 'c1'] }, byId);
    assert.doesNotMatch(mixed, /xr-ann-seg--silent/, 'audit + claim tints normally');
});

test('guard (every anchored note has a card): an unlisted family still renders, before the audit fence', () => {
    // FAMILY_ORDER is today's member list, not the invariant. An anchored
    // note of a family nobody has added to it still gets a tinted span
    // and a rail marker, so a missing card is a click into silence.
    const notes = [mkNote('c1', 'claim'), mkNote('z1', 'futurekind'), mkNote('a1', 'audit')];
    const html = AV.renderCardsPanel(notes);
    assert.match(html, /data-note="c1"/, 'scanner sanity: the known family renders');
    assert.match(html, /data-note="z1"/, 'the unlisted family gets a card too');
    const zAt = html.indexOf('data-note="z1"');
    const fenceAt = html.indexOf('xr-ann-group--audit');
    assert.ok(fenceAt > -1 && zAt < fenceAt, 'the fallback group renders BEFORE the audit fence, which stays last');
});

test('guard (page notes offer no locate): a note with no passage never offers "Show in text"', () => {
    const page = mkNote('p1', 'claim', {
        grounding: null, pageReason: 'No anchor was recorded when this was made',
        actions: ['locate', 'assess']
    });
    const html = AV.renderCard(page);
    assert.match(html, /data-action="assess"/, 'scanner sanity: other actions survive');
    assert.doesNotMatch(html, /data-action="locate"/,
        'neither the action button nor the clickable quote offers a jump a page note cannot make');
    // The anchored twin still offers it — the rule is about page notes.
    assert.match(AV.renderCard(mkNote('p2', 'claim', { actions: ['locate'] })), /data-action="locate"/);
});

test('chip state is rendered, not implied: an off family paints its chip off and says so', () => {
    // The strip is repainted from scratch on every re-render, so the
    // caller's persisted visibility has to reach renderStrip or an accept
    // silently un-hides what the user put away (§2 — state always
    // visible, hide-with-disclosure, no silent defaults).
    const notes = [mkNote('c1', 'claim'), mkNote('x1', 'extraction')];
    const html = AV.renderStrip({ notes, visibility: { extraction: false } });
    assert.match(html, /xr-ann-chip--off/, 'the hidden family\'s chip renders in its off state');
    assert.match(html, /data-family="extraction"[\s\S]{0,80}aria-pressed="false"|aria-pressed="false"[\s\S]{0,80}data-family="extraction"/,
        'and says so to assistive tech');
    // The visible family is unaffected.
    assert.match(html, /aria-pressed="true"/, 'the family still shown stays pressed');
});

test('guard (reserved-vocabulary): non-truth chrome carries no reserved word; the truth sub-card lawfully does', () => {
    const notes = [mkNote('c1', 'claim'), mkNote('x1', 'extraction'), mkNote('a1', 'audit'), mkNote('f1', 'forensic'), mkNote('p1', 'prediction')];
    // Every projector that renders chrome is swept — the page-notes lane
    // and the shell included: a reserved word introduced in either would
    // have slipped past a sweep of only the strip/cards/legend.
    const pageNotes = notes.map((n) => ({ ...n, grounding: null, pageReason: 'no anchor' }));
    for (const html of [AV.renderStrip({ notes, visibility: {} }), AV.renderCardsPanel(notes),
        AV.legendHtml(), AV.renderPageNotes(pageNotes), AV.annotatedShellHtml({ title: 't' })]) {
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

    // The page-notes lane fences audit too (MARGIN_DESIGN §5.3 — "a
    // fenced block in EVERY layout"), not just the anchored cards panel.
    const pageNotes = [
        mkNote('pc1', 'claim', { pageReason: 'no anchor' }),
        mkNote('pa1', 'audit', { pageReason: 'no anchor' })
    ];
    const pageHtml = AV.renderPageNotes(pageNotes);
    const pageFenceStart = pageHtml.indexOf('xr-ann-group--audit');
    assert.ok(pageFenceStart > -1, 'scanner sanity: the page-notes audit fence exists');
    const pageFence = pageHtml.slice(pageFenceStart);
    assert.ok(pageFence.includes('data-note="pa1"'), 'the audit page note is inside the fence');
    assert.doesNotMatch(pageFence, /data-family="claim"|data-family="extraction"|data-family="forensic"|data-family="prediction"/,
        'no other family renders inside or after the page-notes audit fence');
    const pageBeforeFence = pageHtml.slice(0, pageFenceStart);
    assert.ok(pageBeforeFence.includes('data-note="pc1"'), 'the non-audit page note renders before the fence');
    assert.doesNotMatch(pageBeforeFence, /data-family="audit"/, 'no audit page note escapes the page-notes fence');
});
