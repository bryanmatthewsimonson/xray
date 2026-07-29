// Reader extraction bar — MA.2b (docs/MAP_ARTIFACT_KICKOFF.md).
//
// The pure renderer: how a mapping run becomes verifiable from the
// article itself. Pins the honesty properties — silent when there is
// nothing to say, counts and provenance on the face, quotes escaped and
// carried as locate targets, and a prior-version record disclosed rather
// than rendered as if it applied to the current text.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { renderExtractionBar } = await import('../src/reader/extraction-bar.js');

const assertion = (over = {}) => ({
    key: 'a:0-20', quote: 'a verbatim span', start: 0, end: 15,
    why: 'carries the position', status: 'open',
    accepted_claim_id: null, triaged_at: null,
    first_seen: { model: 'claude-test', promptVersion: 'corpus-v4', at: 1000000 },
    ...over
});

const record = (over = {}) => ({
    articleHash: 'a'.repeat(64), url: 'https://ex.com/a', title: 'A',
    assertions: [assertion()], sources: [], open_questions: [], positions: [],
    merged_keys: ['k1'], dropped_ungrounded: 0, updatedAt: 1000000,
    ...over
});

// ---- silence when there is nothing to say ----------------------------------

test('no record → renders NOTHING (an unanalyzed article carries no empty block)', () => {
    assert.equal(renderExtractionBar(null), '');
    assert.equal(renderExtractionBar(undefined), '');
});

test('an empty record renders nothing', () => {
    assert.equal(renderExtractionBar(record({ assertions: [], sources: [], open_questions: [] })), '');
});

// ---- the verification surface ----------------------------------------------

test('a record renders counts, provenance, the quote, and the durable marker', () => {
    const html = renderExtractionBar(record());
    assert.match(html, /Extracted assertions/);
    assert.match(html, /durable/, 'the durability of the record is stated on its face');
    assert.match(html, /1 assertion\b/);
    assert.match(html, /1 open/);
    assert.match(html, /claude-test/, 'model provenance renders (P12)');
    assert.match(html, /corpus-v4/, 'prompt version renders (P12)');
    assert.match(html, /a verbatim span/);
    assert.match(html, /carries the position/);
});

test('quotes are carried as locate targets so a span can be checked against the body', () => {
    const html = renderExtractionBar(record());
    assert.match(html, /data-action="locate"/);
    assert.match(html, /data-quote="a verbatim span"/);
});

test('triage state renders: accepted and dismissed fold into a collapsed section', () => {
    const html = renderExtractionBar(record({
        assertions: [
            assertion({ key: 'a:1', status: 'open' }),
            assertion({ key: 'a:2', status: 'accepted', accepted_claim_id: 'claim_x', quote: 'accepted span' }),
            assertion({ key: 'a:3', status: 'dismissed', quote: 'dismissed span' })
        ]
    }));
    assert.match(html, /3 assertions/);
    assert.match(html, /1 open/);
    assert.match(html, /1 accepted as claims/);
    assert.match(html, /1 dismissed/);
    assert.match(html, /Already triaged \(2\)/);
    assert.match(html, /✓ accepted as a claim/);
});

test('an unknown status counts as OPEN — never silently hidden', () => {
    const html = renderExtractionBar(record({ assertions: [assertion({ status: 'weird' })] }));
    assert.match(html, /1 open/);
    assert.ok(!/Already triaged/.test(html));
});

test('dropped ungroundable quotes are disclosed (P6)', () => {
    const html = renderExtractionBar(record({ dropped_ungrounded: 3 }));
    assert.match(html, /3 ungroundable quotes dropped/);
});

test('the bar points at where triage actually happens — it never implies a local accept', () => {
    const html = renderExtractionBar(record());
    assert.match(html, /case dashboard/, 'names the surface that mints claims');
    assert.ok(!/<button/.test(html), 'read-only: no accept/dismiss controls here');
});

test('sources and open questions render — the fields that were previously paid for and unused', () => {
    const html = renderExtractionBar(record({
        sources: [{ key: 's:1', quote: 'as Nature reported', target_hint: 'Nature' }],
        open_questions: [{ key: 'q:1', text: 'Who approved the funding?' }]
    }));
    assert.match(html, /Cited sources \(1\)/);
    assert.match(html, /Nature/);
    assert.match(html, /Open questions this article leaves \(1\)/);
    assert.match(html, /Who approved the funding\?/);
});

test('an ALL-ungroundable record still speaks: a paid pass that retained nothing is disclosed, not silent (P6)', () => {
    // mergeExtractIntoRecord saves a record with zero assertions when
    // every quote failed grounding. Rendering nothing would read as
    // "never analyzed" — the opposite of coverage on its face.
    const html = renderExtractionBar(record({
        assertions: [], sources: [], open_questions: [], dropped_ungrounded: 4
    }));
    assert.match(html, /Extracted assertions/);
    assert.match(html, /none retained/);
    assert.match(html, /4 proposed quotes could be located/);
    assert.match(html, /never turned into a claim/);
    // Still silent when there is genuinely nothing at all.
    assert.equal(renderExtractionBar(record({
        assertions: [], sources: [], open_questions: [], dropped_ungrounded: 0
    })), '');
});

// ---- honesty about prior versions ------------------------------------------

test('no current record but a PRIOR-version record → discloses it instead of rendering nothing', () => {
    const html = renderExtractionBar(null, { priorRuns: 2 });
    assert.match(html, /Extracted assertions/);
    assert.match(html, /2 extraction records anchor to a <em>previous version<\/em>/);
    assert.match(html, /never transfer across edits/);
});

test('a current record PLUS prior-version records discloses the extras', () => {
    const html = renderExtractionBar(record(), { priorRuns: 1 });
    assert.match(html, /1 further extraction record/);
    assert.match(html, /not shown here/);
});

// ---- escaping --------------------------------------------------------------

test('quote text is HTML-escaped in both the body and the locate attribute', () => {
    const html = renderExtractionBar(record({
        assertions: [assertion({ quote: '<script>alert("x")</script> & "quoted"' })]
    }));
    assert.ok(!/<script>/.test(html), 'no raw script tag survives');
    assert.match(html, /&lt;script&gt;/);
    assert.match(html, /&quot;/);
});
