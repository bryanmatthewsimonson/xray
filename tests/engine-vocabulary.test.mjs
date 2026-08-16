// Engine vocabulary — the copies that must not drift apart.
//
// A selectable transcription engine id has to be known to SIX separate
// places, none of which import each other:
//
//   1. reader/index.js   ENGINE_META      — label, badge, disclosure
//   2. reader/index.js   PICKER_ENGINES   — the iterated list
//   3. reader/index.js   ENGINE_PROVIDER  — which saved API key it needs
//   4. transcribe-flow.js PROVIDER_LABELS — banner + toast wording
//   5. diarized-transcript.js providerDisplayName — heading + track chip
//   6. transcriber-client.js keys{}       — the presence booleans
//
// Nothing checked them before this file. Two concrete failures the
// review found by inspection, both silent:
//
//   - An id missing from PROVIDER_LABELS falls through to 'locally' in
//     providerPhrase, so a run that handed a third party a URL
//     announces itself as local — the durable lie the JOURNAL ruled
//     against on 2026-08-02.
//   - The picker's availability mark tested keys[engine] against a
//     PROVIDER-keyed map, so any engine id that is not literally a
//     provider name would read "No API key saved" forever with the key
//     sitting right there.
//
// These are source-grep assertions on purpose: the reader is a DOM
// module that cannot be imported under node --test, and the whole point
// is to catch a future engine added to one list and forgotten in
// another.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

const repoUrl = (p) => new URL(`../${p}`, import.meta.url);
const readRepo = (p) => readFileSync(repoUrl(p), 'utf8');

/** Grep the CODE, not the prose. Comments here legitimately name the
 *  module they explain NOT importing — the exact string these guards
 *  look for. */
function stripComments(source) {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const READER_SRC = readRepo('src/reader/index.js');
const READER_CODE = stripComments(READER_SRC);
const { providerPhrase } = await import('../src/reader/transcribe-flow.js');
const { providerDisplayName } = await import('../src/shared/diarized-transcript.js');
const { DIRECT_ENGINE_ID, DIRECT_PROVIDER } = await import('../src/shared/direct-transcribe.js');
const { TRANSCRIBE_ENGINES, normalizeEngine, getTranscribeConfig } = await import('../src/shared/transcriber-client.js');
const { FLAGS_DEFAULTS } = await import('../src/shared/metadata/feature-flags.js');

/** The engine ids the picker actually iterates. Parsed from the source
 *  so adding one to the array without teaching the rest of the
 *  vocabulary fails here. */
function pickerEngines() {
    const m = /const PICKER_ENGINES = \[([^\]]*)\]/.exec(READER_SRC);
    assert.ok(m, 'PICKER_ENGINES is no longer declared where the guard can find it');
    return m[1].split(',').map((s) => s.trim()).filter(Boolean).map((token) => (
        token === 'DIRECT_ENGINE_ID' ? DIRECT_ENGINE_ID : token.replace(/^['"]|['"]$/g, '')
    ));
}

test('every picker engine has a human label everywhere it is rendered', () => {
    for (const engine of pickerEngines()) {
        if (engine === 'local') continue;   // local is the null-provider case by design
        assert.notEqual(providerPhrase(engine), 'locally',
            `${engine} falls through to "locally" in the banner and toast — add it to PROVIDER_LABELS `
            + 'in src/reader/transcribe-flow.js');
        assert.ok(providerDisplayName(engine),
            `${engine} has no providerDisplayName — the transcript heading would name it wrongly`);
    }
});

test('every picker engine has ENGINE_META and an ENGINE_PROVIDER mapping', () => {
    for (const engine of pickerEngines()) {
        const key = engine === DIRECT_ENGINE_ID ? '\\[DIRECT_ENGINE_ID\\]' : engine;
        assert.match(READER_SRC, new RegExp(`ENGINE_META = \\{[\\s\\S]*?${key}:`),
            `${engine} is iterated by the picker but has no ENGINE_META entry`);
        assert.match(READER_SRC, new RegExp(`ENGINE_PROVIDER = \\{[\\s\\S]*?${key}:`),
            `${engine} has no ENGINE_PROVIDER entry — its availability mark would be wrong`);
    }
});

test('the picker looks a key up by PROVIDER, never by engine id', () => {
    // The bug this pins: keys is provider-keyed, so keys[engine] is
    // undefined for any engine id that is not itself a provider name.
    assert.match(READER_SRC, /_transcribeCfg\.keys\[provider\]/,
        'the availability mark must index keys by provider');
    assert.ok(!/_transcribeCfg\.keys && _transcribeCfg\.keys\[engine\]/.test(READER_SRC),
        'keys is provider-keyed — indexing it by engine id silently reports "No API key saved"');
});

test('every ENGINE_PROVIDER value is a real key-presence provider', async () => {
    const cfg = await getTranscribeConfig();
    const providers = new Set(Object.keys(cfg.keys || {}));
    const body = /const ENGINE_PROVIDER = \{([\s\S]*?)\n\};/.exec(READER_SRC);
    assert.ok(body, 'ENGINE_PROVIDER is no longer declared where the guard can find it');
    for (const [, value] of body[1].matchAll(/:\s*'([^']+)'/g)) {
        assert.ok(providers.has(value),
            `ENGINE_PROVIDER maps to "${value}", which getTranscribeConfig().keys does not report`);
    }
    assert.ok(providers.has(DIRECT_PROVIDER));
});

test('the direct engine is picker-only — it never enters the persisted enum', () => {
    // Maintainer ruling for DC.1. normalizeEngine collapses any value it
    // does not recognize to 'local', and Options re-persists whatever
    // normalizeEngine returns — so a direct id written to
    // xray:transcriber:engine would be silently destroyed on the next
    // Settings save. DC.2 owns widening this properly, WITH the
    // round-trip persistence test schema-evolution asked for.
    assert.ok(!TRANSCRIBE_ENGINES.includes(DIRECT_ENGINE_ID),
        'the direct engine entered the persisted enum without the migration DC.2 owes');
    assert.equal(normalizeEngine(DIRECT_ENGINE_ID), 'local',
        'this collapse is exactly why the id stays out of the persisted enum');
    assert.ok(!readRepo('src/options/index.js').includes(DIRECT_ENGINE_ID),
        'the Options engine <select> must not offer a value normalizeEngine would destroy');
});

test('the selection id and the wire-visible provenance id stay distinct', () => {
    // The whole B1 hazard in one assertion: the picker id carries the
    // transport, the published provenance id must not.
    assert.equal(DIRECT_ENGINE_ID, 'assemblyai-direct');
    assert.equal(DIRECT_PROVIDER, 'assemblyai');
    assert.notEqual(DIRECT_ENGINE_ID, DIRECT_PROVIDER);
});

test('the direct flag is registered and ships off', () => {
    assert.ok(Object.prototype.hasOwnProperty.call(FLAGS_DEFAULTS, 'directCloudTranscription'),
        'the flag must exist in FLAGS_DEFAULTS or isEnabled silently returns undefined');
    assert.equal(FLAGS_DEFAULTS.directCloudTranscription, false);
});

test('the Transcribe button is reachable with the companion flag OFF', () => {
    // The feature exists for users who installed nothing. Gating the
    // button on localTranscription alone would make it unreachable for
    // exactly them — and the acceptance walk would not catch it,
    // because the maintainer already has that flag on.
    assert.match(READER_SRC, /if \(!cfg\.enabled && !directEnabled\)/,
        'the button gate must admit a direct-only configuration');
});

test('no direct-path string sends the user to install a companion', () => {
    // reader/index.js attaches the setup hint ("install the companion,
    // uv run xray-transcriber") to any error containing "not
    // reachable", so that substring is forbidden outright.
    //
    // Naming the companion is fine — and good — when the sentence says
    // one is NOT needed ("no companion service"). What must never
    // appear is an instruction to install or start one, on the single
    // path whose entire premise is that nothing is installed.
    const meta = /\[DIRECT_ENGINE_ID\]: \{([\s\S]*?)\n    \}/.exec(READER_SRC);
    assert.ok(meta, 'the direct ENGINE_META entry moved');
    assert.ok(!/not reachable/i.test(meta[1]),
        'that substring makes the reader attach companion setup advice');
    assert.ok(!/\buv run\b|README\.md|install the companion|start the (companion|service)/i.test(meta[1]),
        'the direct engine must never instruct the user to install or start a companion');
    for (const mention of meta[1].match(/[^.]*companion[^.]*/gi) || []) {
        assert.match(mention, /\bno\b|\bnever\b|\bwithout\b/i,
            `"${mention.trim()}" mentions the companion without saying it is unnecessary`);
    }
});

test('the direct route resolver and the direct handlers agree on the flag name', () => {
    // A typo'd flag name in isEnabled() returns undefined — falsy —
    // which would silently disable the feature rather than failing.
    const bg = readRepo('src/background/index.js');
    const handlers = bg.match(/xray:transcribe:direct:(start|status)/g) || [];
    assert.equal(handlers.length, 2, 'both direct message handlers must exist');
    const gates = bg.match(/isEnabled\('directCloudTranscription'\)/g) || [];
    assert.equal(gates.length, 2,
        'BOTH direct handlers must check the flag — including the poll, which an MV3 worker '
        + 'reaches after waking, potentially after the flag was turned off');
});

test('neither direct handler contains a polling loop', () => {
    // The corpus-reduce lesson: a service worker that loops is killed
    // mid-job. On this path that also orphans an already-PAID provider
    // job whose id was never persisted.
    const bg = readRepo('src/background/index.js');
    const block = bg.slice(bg.indexOf("'xray:transcribe:direct:start'"),
        bg.indexOf("'xray:transcribe:claims'"));
    assert.ok(block.length > 0, 'the direct handler block moved');
    assert.ok(!/\bfor\s*\(;;\)|\bwhile\s*\(/.test(block),
        'the reader drives the job — one short message per step, never a loop in the worker');
});

test('the direct disclosure says what actually happens, not the cloud-upload line', () => {
    const meta = /\[DIRECT_ENGINE_ID\]: \{([\s\S]*?)\n    \}/.exec(READER_SRC)[1];
    assert.ok(!/audio leaves this machine/i.test(meta),
        'that is the companion cloud engines\' disclosure and it is FALSE here — the audio never '
        + 'touches this machine');
    assert.match(meta, /address/i, 'the disclosure must say the media ADDRESS is what is sent');
    // And the sub-line the picker actually RENDERS (engineEstimate),
    // not just the tooltip-only `detail`, carries the trade-off.
    const estimate = /if \(meta && meta\.direct\) \{([\s\S]*?)\n    \}/.exec(READER_SRC);
    assert.ok(estimate, 'the direct branch of engineEstimate moved');
    assert.match(estimate[1], /never touches this machine/);
    assert.match(estimate[1], /learns the address/);
});

test('the reader does not bundle the credentialed-egress module', () => {
    // direct-transcribe.js reads the API key from storage and performs
    // the third-party fetch; it is service-worker-only by design. The
    // reader needs exactly one string from it, and importing the module
    // to get that string would put a key-reading helper into a page
    // bundle — the slow way to erode "keys stay presence-only to pages".
    assert.ok(!/from '\.\.\/shared\/direct-transcribe\.js'/.test(READER_CODE),
        'reader/index.js must not import shared/direct-transcribe.js — copy the id, guarded below');
    const declared = /const DIRECT_ENGINE_ID = '([^']+)'/.exec(READER_CODE);
    assert.ok(declared, 'the reader must declare its own DIRECT_ENGINE_ID literal');
    assert.equal(declared[1], DIRECT_ENGINE_ID,
        'the reader\'s copy of the engine id drifted from shared/direct-transcribe.js');
});

test('only the service worker reaches the direct transcription module', () => {
    for (const entry of ['src/content/index.js', 'src/reader/index.js', 'src/options/index.js',
        'src/sidepanel/index.js', 'src/portal/index.js', 'src/network/index.js']) {
        assert.ok(!stripComments(readRepo(entry)).includes('direct-transcribe.js'),
            `${entry} imports the direct transcription module; it belongs to the background worker`);
    }
    assert.ok(stripComments(readRepo('src/background/index.js')).includes('direct-transcribe.js'),
        'the background worker is the one context that must import it');
});

test('a direct-only install never dead-ends on a leftover companion engine', () => {
    // The Options engine <select> is independent of the
    // localTranscription checkbox and is never cleared when that flag
    // goes off, so 'local'/'assemblyai'/'deepgram' can outlive it. With
    // the companion flag off, every one of those is refused by the SW
    // with "Local transcription is off" — pushing a user who
    // deliberately installed nothing toward installing a companion.
    // The guard must test the RESOLVED engine, not just its absence.
    const guard = /if \(!_transcribeCfg\.enabled && _transcribeCfg\.directEnabled\s*\n\s*&& \(provider \|\| _transcribeCfg\.engine\) !== DIRECT_ENGINE_ID\)/;
    assert.match(READER_CODE, guard,
        'runTranscribeFlow must route ANY non-direct engine to the picker when the companion flag is off');
    assert.ok(!/if \(!provider && !_transcribeCfg\.enabled && _transcribeCfg\.directEnabled\)/.test(READER_CODE),
        'the `!provider`-only form let a stored engine preference brick the button');
    // The tooltip must not promise a local run it cannot perform.
    assert.match(READER_CODE,
        /if \(!_transcribeCfg\.enabled && _transcribeCfg\.directEnabled && e !== DIRECT_ENGINE_ID\)/,
        'transcribeTooltip must widen the same way as the click guard');
});

test('the direct flag has a real Options control, matching what the docs and errors promise', () => {
    // Adversarial review found the flag shipped with no UI at all: the
    // smoke-walk setup line and the runtime refusal string both said
    // "Options → Advanced", and there was nothing there. A default-off
    // flag with no control is only reachable by hand-editing
    // chrome.storage.local from a devtools console.
    const html = readRepo('src/options/options.html');
    const opts = readRepo('src/options/index.js');
    assert.match(html, /id="pref-direct-cloud-transcription"/,
        'no checkbox exists for directCloudTranscription');
    assert.match(opts, /setOverride\('directCloudTranscription'/,
        'the checkbox is never persisted');
    assert.match(opts, /pref-direct-cloud-transcription'\)\.checked = isEnabled\('directCloudTranscription'\)/,
        'the checkbox never loads its current state');
    // The disclosure has to be at the point of the decision, and it must
    // not repeat the companion cloud engines' (false) upload line.
    const hint = /pref-direct-cloud-transcription[\s\S]{0,2000}?<\/p>/.exec(html)[0];
    assert.ok(!/audio leaves your machine/i.test(hint),
        'that is the companion cloud disclosure and it is false for this route');
    // Whitespace-tolerant: these phrases wrap across lines in the HTML.
    assert.match(hint, /never\s+touches\s+this\s+machine/i);
    assert.match(hint, /learns\s+the\s+address/i);
});
