// SMOKE_TEST DC-1, moved off the human list and off the agent list.
//
// The row read: "With directCloudTranscription OFF, 'AssemblyAI (direct)'
// is ABSENT from the picker — hidden, not greyed. With BOTH flags off the
// Transcribe button itself is absent." It was tagged agent-verifiable,
// but the picker lives in the reader — an extension page the connector
// cannot attach to — so no agent could ever run it, and no unit test
// asserted the first half either: the rule was one inline ternary inside
// a DOM render loop. visiblePickerEngines() is that ternary, lifted out
// so the machine can run it on every `npm test`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { visiblePickerEngines } = await import('../src/reader/transcribe-flow.js');

const ENGINES = ['local', 'assemblyai', 'deepgram', 'assemblyai-direct', 'deepgram-direct'];
const META = {
    local: {}, assemblyai: {}, deepgram: {},
    'assemblyai-direct': { direct: true },
    'deepgram-direct': { direct: true }
};

test('DC-1a: direct engines are ABSENT when the direct flag is off', () => {
    const shown = visiblePickerEngines(ENGINES, META, { companionEnabled: true, directEnabled: false });
    assert.deepEqual(shown, ['local', 'assemblyai', 'deepgram']);
    assert.ok(!shown.some((e) => META[e].direct), 'no direct engine may be offered — hidden, not greyed');
});

test('companion engines are ABSENT when the companion flag is off (direct-only install)', () => {
    const shown = visiblePickerEngines(ENGINES, META, { companionEnabled: false, directEnabled: true });
    assert.deepEqual(shown, ['assemblyai-direct', 'deepgram-direct']);
});

test('both on: every engine, in picker order', () => {
    assert.deepEqual(visiblePickerEngines(ENGINES, META, { companionEnabled: true, directEnabled: true }), ENGINES);
});

test('DC-1b: both off ⇒ nothing (the button itself is hidden upstream; the menu would be empty)', () => {
    assert.deepEqual(visiblePickerEngines(ENGINES, META, { companionEnabled: false, directEnabled: false }), []);
});

test('an engine with no META entry is never offered (a typo cannot add a phantom row)', () => {
    const shown = visiblePickerEngines([...ENGINES, 'ghost'], META, { companionEnabled: true, directEnabled: true });
    assert.ok(!shown.includes('ghost'));
});

test('SEAM: the reader picker renders THROUGH this helper, and the inline rule is gone', () => {
    // The failure this guards: helper tested, render loop still using
    // its own copy of the ternary (the 2026-08 signature — green tests,
    // wrong behaviour).
    const src = readFileSync(new URL('../src/reader/index.js', import.meta.url), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    assert.match(src, /visiblePickerEngines\(PICKER_ENGINES, ENGINE_META, \{ companionEnabled, directEnabled \}\)/,
        'the picker must get its engine list from the helper');
    assert.ok(!/meta\.direct \? !directEnabled : !companionEnabled/.test(src),
        'the inline visibility ternary must not survive beside the helper');
});
