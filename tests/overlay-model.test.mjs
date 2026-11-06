import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOverlay, toLookupItems } from '../src/shared/overlay-model.js';

const URL1 = 'https://example.com/a';
const claim = { id: 'c1', text: 'T', quote: 'q1', anchor: [{ type: 'TextQuoteSelector', exact: 'q1' }], is_key: true };

test('judgments attach as judgmentKinds [assessment, verdict]', () => {
    const [it] = buildOverlay(URL1, {
        claims: [claim],
        assessmentsByClaim: new Map([['c1', [{ id: 'a' }]]]),
        verdictsByClaim: new Map([['c1', [{ id: 'v' }]]])
    });
    assert.equal(it.id, 'claim:c1');
    assert.deepEqual(it.judgmentKinds, ['assessment', 'verdict']);
    assert.equal(it.detail.assessments.length, 1);
    assert.equal(it.detail.text, 'T');
    assert.deepEqual(buildOverlay(URL1, { claims: [claim] })[0].judgmentKinds, []);
});

test('finding yields one item per anchor on this URL, none for other URLs', () => {
    const f = { id: 'f1', counter_note: 'n', anchors: [
        { selector: [], quote: 'x', source_ref: { url: URL1 }, timestamp: 12 },
        { selector: [], quote: 'y', source_ref: { url: 'https://other.com/' } },
        { selector: [], quote: 'z', source_ref: { url: URL1 + '#frag' } }
    ] };
    const items = buildOverlay(URL1, { findings: [f], secondsFor: () => 99 });
    assert.deepEqual(items.map((i) => i.id), ['finding:f1:0', 'finding:f1:2']);
    assert.equal(items[0].seconds, 12);
    assert.equal(items[1].seconds, 99);
    assert.equal(items[0].detail.counter_note, 'n');
});

test('extraction status open/accepted/dismissed -> unreviewed/accepted/rejected', () => {
    const mk = (key, status) => ({ key, quote: key, status });
    const items = buildOverlay(URL1, { extraction: { assertions: [mk('a', 'open'), mk('b', 'accepted'), mk('c', 'dismissed')] } });
    assert.deepEqual(items.map((i) => i.reviewState), ['unreviewed', 'accepted', 'rejected']);
    assert.equal(items[0].id, 'extraction:a');
});

test('extraction assertions that became claims are not duplicated when that claim is present', () => {
    const extraction = { assertions: [
        { key: 'a', quote: 'q1', status: 'accepted', accepted_claim_id: 'c1' },
        { key: 'b', quote: 'q2', status: 'accepted', accepted_claim_id: 'gone' }
    ] };
    const ids = buildOverlay(URL1, { claims: [claim], extraction }).map((i) => i.id);
    assert.deepEqual(ids, ['claim:c1', 'extraction:b']);
});

test('notes pass through with seconds', () => {
    const [it] = buildOverlay(URL1, { notes: [{ id: 'n1', quote: 'q', text: 'mine', seconds: 5 }], secondsFor: () => 1 });
    assert.equal(it.id, 'note:n1');
    assert.equal(it.seconds, 5);
    assert.equal(it.detail.text, 'mine');
});

test('secondsFor fills quote items lacking a timestamp', () => {
    const [it] = buildOverlay(URL1, { claims: [claim], secondsFor: (q) => (q === 'q1' ? 7 : null) });
    assert.equal(it.seconds, 7);
    assert.equal(toLookupItems([it])[0].seconds, 7);
});
