// Speaker → entity identification — the pure halves of the 🗣
// Speakers modal. Pins: the binding lookup the claim-prefill
// resolution consults (label-context entity refs), the voice-split
// grouping ("same voice as Speaker N"), the ref diff (upserts +
// removals), and the per-voice facts derived from raw companion
// segments (display-label mapping mirrors diarized-transcript.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

const { speakerEntityId, speakerBindings, speakerFacts, diffSpeakerRefs, voiceSplitGroups, decorateSpeakerLabels } =
    await import('../src/reader/speakers-modal.js');

// Hand-built DOM stub (no jsdom — house rule): just enough element
// surface for the decorator's querySelectorAll('strong, b') walk.
function stubEl(text) {
    const attrs = {};
    const classes = new Set();
    return {
        textContent: text,
        classList: {
            add: (c) => classes.add(c),
            remove: (c) => classes.delete(c),
            contains: (c) => classes.has(c)
        },
        setAttribute: (k, v) => { attrs[k] = v; },
        removeAttribute: (k) => { delete attrs[k]; },
        get attrs() { return attrs; },
        get classes() { return classes; }
    };
}
function stubBody(els) {
    return { querySelectorAll: () => els };
}

const SPEAKERS = ['Speaker 1', 'Speaker 2', 'Speaker 3'];
const REFS = [
    { entity_id: 'entity_aaa', context: 'Speaker 1' },
    { entity_id: 'entity_bbb', context: 'some ordinary mention' },
    { entity_id: 'entity_aaa', context: 'Speaker 3' }   // voice-split: same person
];

test('speakerEntityId: exact label-context match; ordinary mention refs never match', () => {
    assert.equal(speakerEntityId(REFS, 'Speaker 1'), 'entity_aaa');
    assert.equal(speakerEntityId(REFS, 'Speaker 3'), 'entity_aaa');
    assert.equal(speakerEntityId(REFS, 'Speaker 2'), null);
    assert.equal(speakerEntityId(REFS, 'some ordinary'), null, 'prefix of a mention is not a label match');
    assert.equal(speakerEntityId(null, 'Speaker 1'), null);
    assert.equal(speakerEntityId(REFS, ''), null);
});

test('speakerBindings: label → entity map, unbound labels absent', () => {
    const b = speakerBindings(REFS, SPEAKERS);
    assert.deepEqual([...b], [['Speaker 1', 'entity_aaa'], ['Speaker 3', 'entity_aaa']]);
});

test('speakerFacts: raw labels → display labels, turn counts, first utterance', () => {
    const segments = [
        { start: 0, end: 4, speaker: 'SPEAKER_00', text: 'Hello there, welcome.' },
        { start: 4, end: 9, speaker: 'SPEAKER_01', text: 'Thanks for having me.' },
        { start: 9, end: 15, speaker: 'SPEAKER_00', text: 'Let us begin.' },
        { start: 15, end: 18, speaker: null, text: 'crosstalk' }
    ];
    const f = speakerFacts(segments);
    assert.deepEqual([...f.keys()], ['Speaker 1', 'Speaker 2']);
    assert.equal(f.get('Speaker 1').turns, 2);
    assert.equal(f.get('Speaker 1').firstStartSec, 0);
    assert.equal(f.get('Speaker 2').firstText, 'Thanks for having me.');
    assert.deepEqual([...speakerFacts([]).keys()], [], 'imports without segments get empty facts');
});

test('diffSpeakerRefs: upserts, re-binds, and unbinds', () => {
    const chosen = new Map([
        // Speaker 1 re-bound to a DIFFERENT person; Speaker 2 newly
        // bound; Speaker 3 unbound (absent from chosen).
        ['Speaker 1', { entityId: 'entity_ccc', type: 'person', name: 'Carol' }],
        ['Speaker 2', { entityId: 'entity_aaa', type: 'person', name: 'Alice' }]
    ]);
    const { refs, removed } = diffSpeakerRefs({ entities: REFS, speakers: SPEAKERS, chosen });
    assert.deepEqual(refs, [
        { entity_id: 'entity_ccc', type: 'person', name: 'Carol', context: 'Speaker 1' },
        { entity_id: 'entity_aaa', type: 'person', name: 'Alice', context: 'Speaker 2' }
    ]);
    assert.deepEqual(removed.sort(), ['Speaker 1', 'Speaker 3'],
        're-bind removes the old ref; unbind removes outright');
    // Ordinary mention refs are never touched — the diff only speaks
    // in labels, and index.js filters removals by label context.
    assert.ok(!removed.includes('some ordinary mention'));
});

test('decorateSpeakerLabels: bound labels get the name attribute; unbinding clears it', () => {
    const article = {
        transcript_meta: { speakers: ['Speaker 1', 'Speaker 2'] },
        entities: [{ entity_id: 'entity_aaa', name: 'Ed Nachel', context: 'Speaker 1' }]
    };
    const s1 = stubEl('Speaker 1:');
    const s2 = stubEl('Speaker 2:');
    const other = stubEl('Not a label');
    const body = stubBody([s1, s2, other]);

    assert.equal(decorateSpeakerLabels(body, article), 1);
    assert.equal(s1.attrs['data-xr-speaker-entity'], 'Ed Nachel');
    assert.ok(s1.classes.has('xr-speaker-id'));
    assert.ok(!s2.classes.has('xr-speaker-id'));
    assert.deepEqual(other.attrs, {});

    // Unbind → the re-run clears the stale decoration.
    article.entities = [];
    assert.equal(decorateSpeakerLabels(body, article), 0);
    assert.ok(!s1.classes.has('xr-speaker-id'));
    assert.equal(s1.attrs['data-xr-speaker-entity'], undefined);

    // A binding whose entity name IS the label decorates nothing
    // (imported transcripts with real-name labels — redundant).
    article.entities = [{ entity_id: 'entity_x', name: 'Speaker 2', context: 'Speaker 2' }];
    assert.equal(decorateSpeakerLabels(body, article), 0);
});

test('voiceSplitGroups: labels sharing one entity group together', () => {
    const chosen = new Map([
        ['Speaker 1', { entityId: 'entity_aaa' }],
        ['Speaker 2', { entityId: 'entity_bbb' }],
        ['Speaker 3', { entityId: 'entity_aaa' }]
    ]);
    assert.deepEqual(voiceSplitGroups(chosen), [['Speaker 1', 'Speaker 3']]);
    assert.deepEqual(voiceSplitGroups(new Map()), []);
});
