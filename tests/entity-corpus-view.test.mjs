// Entity corpus view tests — Phase 17 E5 (ENTITY_CORPUS_DESIGN.md
// §4.4). The DOM half is a browser surface; what's pinned here is the
// wire CONTRACT — the two relay filters the design specifies — and the
// per-kind row text (wire-first: it must render from tags/content
// alone, no local registry).

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { AUTHORED_FILTER, ABOUT_FILTER, rowText } =
    await import('../src/portal/entity-corpus-view.js');

const P = 'e'.repeat(64);

test('E5: the two §4.4 relay filters are the wire contract, pinned', () => {
    assert.deepEqual(AUTHORED_FILTER(P), {
        authors: [P], kinds: [0, 1, 30067], limit: 200
    }, 'the entity\'s own voice: profile + mention notes + fact sheet');
    assert.deepEqual(ABOUT_FILTER(P), {
        '#p': [P], kinds: [30023, 30040, 30054, 30062, 30063, 32125], limit: 300
    }, 'what the network says about it');
});

test('E5: rowText renders every kind from WIRE data alone', () => {
    assert.equal(rowText({ kind: 1, content: 'Mentioned in "The theft"\n\n"quote"\n\nhttps://x' }),
        'Mentioned in "The theft"');
    assert.equal(rowText({ kind: 30067, tags: [['fact', 'a'], ['fact', 'b'], ['x', 'h']] }),
        '2 sourced facts');
    assert.equal(rowText({ kind: 30023, tags: [['title', 'The article']] }), 'The article');
    assert.equal(rowText({ kind: 30023, tags: [['r', 'https://x/a']] }), 'https://x/a');
    assert.equal(rowText({ kind: 30040, content: 'The claim text', tags: [] }), 'The claim text');
    assert.equal(rowText({ kind: 32125, tags: [['r', 'https://x/a']] }), 'https://x/a');
    assert.equal(rowText({ kind: 30063, content: '', tags: [] }), 'kind 30063', 'honest fallback, never invented text');
});
