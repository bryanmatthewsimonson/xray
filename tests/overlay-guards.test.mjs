import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOverlay, toLookupItems, LOOKUP_ALLOWED_KEYS } from '../src/shared/overlay-model.js';

const URL1 = 'https://example.com/a';

test('toLookupItems output keys are a subset of LOOKUP_ALLOWED_KEYS for every kind', () => {
    const items = buildOverlay(URL1, {
        claims: [{ id: 'c1', text: 'SECRET claim text', quote: 'q', anchor: null }],
        assessmentsByClaim: new Map([['c1', [{ stance: 'disputes', labels: ['x'] }]]]),
        verdictsByClaim: new Map([['c1', [{ verdict: 'false' }]]]),
        findings: [{ id: 'f', counter_note: 'SECRET', anchors: [{ quote: 'q', source_ref: { url: URL1 } }] }],
        extraction: { assertions: [{ key: 'k', quote: 'q', status: 'open', text: 'SECRET' }] },
        notes: [{ id: 'n', quote: 'q', text: 'SECRET note' }]
    });
    assert.deepEqual(new Set(items.map((i) => i.kind)), new Set(['claim', 'finding', 'extraction', 'note']));
    const lookup = toLookupItems(items);
    for (const it of lookup) {
        for (const k of Object.keys(it)) assert.ok(LOOKUP_ALLOWED_KEYS.includes(k), k);
        assert.equal('detail' in it, false);
    }
    assert.ok(!JSON.stringify(lookup).includes('SECRET'));
});

test('LOOKUP_ALLOWED_KEYS contains none of the private-text keys', () => {
    for (const bad of ['text', 'content', 'body', 'note', 'verdict', 'assessment', 'stance', 'labels']) {
        assert.ok(!LOOKUP_ALLOWED_KEYS.includes(bad), bad);
    }
});
