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

test('toLookupItems copies anchors defensively (only locating selector fields)', () => {
    const polluted = [
        { type: 'TextQuoteSelector', exact: 'e', prefix: 'p', suffix: 's', note: 'SECRET', label: 'SECRET' },
        { type: 'TextPositionSelector', start: 1, end: 4, extra: { deep: 'SECRET' } },
        'SECRET', null, 7
    ];
    const items = buildOverlay(URL1, {
        claims: [
            { id: 'c1', text: 't', quote: 'q', anchor: polluted },
            { id: 'c2', text: 't', quote: 'q', anchor: { type: 'TextQuoteSelector', exact: 'e', note: 'SECRET' } },
            { id: 'c3', text: 't', quote: 'q', anchor: 'SECRET' }
        ]
    });
    const lookup = toLookupItems(items);
    assert.ok(!JSON.stringify(lookup).includes('SECRET'));
    assert.deepEqual(lookup[0].anchor, [
        { type: 'TextQuoteSelector', exact: 'e', prefix: 'p', suffix: 's' },
        { type: 'TextPositionSelector', start: 1, end: 4 }
    ]);
    assert.deepEqual(lookup[1].anchor, { type: 'TextQuoteSelector', exact: 'e' });
    assert.equal(lookup[2].anchor, null);
});

test('LOOKUP_ALLOWED_KEYS contains none of the private-text keys', () => {
    for (const bad of ['text', 'content', 'body', 'note', 'verdict', 'assessment', 'stance', 'labels']) {
        assert.ok(!LOOKUP_ALLOWED_KEYS.includes(bad), bad);
    }
});

test('every content-script capture runs with the overlay suspended', async () => {
    // UI.openReader is the single capture entry; in the content script it
    // may only be reached through capturePage (withOverlaySuspended), so a
    // new capture trigger cannot let overlay markers into an extraction.
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('../src/content/index.js', import.meta.url), 'utf8');
    const calls = src.match(/UI\.openReader\(/g) || [];
    assert.equal(calls.length, 1, 'exactly one direct UI.openReader call');
    assert.match(src, /withOverlaySuspended\(overlayHandle, \(\) => UI\.openReader\(opts\)\)/);
});
