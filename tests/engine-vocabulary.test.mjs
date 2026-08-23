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
const { DIRECT_ENGINE_ID, DIRECT_PROVIDER, DIRECT_ENGINE_IDS } = await import('../src/shared/direct-transcribe.js');
const { DEEPGRAM_ENGINE_ID, DEEPGRAM_PROVIDER } = await import('../src/shared/direct-transcribe-deepgram.js');
const { TRANSCRIBE_ENGINES, normalizeEngine, getTranscribeConfig } = await import('../src/shared/transcriber-client.js');
const { FLAGS_DEFAULTS } = await import('../src/shared/metadata/feature-flags.js');

/** The engine ids the picker actually iterates. Parsed from the source
 *  so adding one to the array without teaching the rest of the
 *  vocabulary fails here. */
function pickerEngines() {
    const m = /const PICKER_ENGINES = \[([^\]]*)\]/.exec(READER_SRC);
    assert.ok(m, 'PICKER_ENGINES is no longer declared where the guard can find it');
    return m[1].split(',').map((s) => s.trim()).filter(Boolean).map((token) => (
        token === 'DIRECT_ENGINE_ID' ? DIRECT_ENGINE_ID
            : token === 'DEEPGRAM_DIRECT_ENGINE_ID' ? DEEPGRAM_ENGINE_ID
                : token.replace(/^['"]|['"]$/g, '')
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
        const key = engine === DIRECT_ENGINE_ID ? '\\[DIRECT_ENGINE_ID\\]'
            : engine === DEEPGRAM_ENGINE_ID ? '\\[DEEPGRAM_DIRECT_ENGINE_ID\\]'
                : engine;
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
    // The invariant is one flag check PER handler, not a fixed count —
    // DC.3 added a third handler and a hardcoded 2 would have hidden a
    // missing gate rather than catching it.
    const handlers = bg.match(/if \(message\.type === 'xray:transcribe:direct:[a-z]+'\)/g) || [];
    assert.ok(handlers.length >= 3, `expected every direct handler, found ${handlers.length}`);
    const gates = bg.match(/isEnabled\('directCloudTranscription'\)/g) || [];
    assert.equal(gates.length, handlers.length,
        'EVERY direct handler must check the flag — including the poll, which an MV3 worker '
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
    // The Options engine <select> is independent of the localTranscription
    // checkbox and is never cleared when that flag goes off, so
    // 'local'/'assemblyai'/'deepgram' can outlive it. With the companion
    // flag off every one of those is refused by the SW, so the click
    // guard must route them to the picker instead of a dead end.
    assert.match(READER_CODE,
        /if \(!_transcribeCfg\.enabled && _transcribeCfg\.directEnabled\s*\n?\s*&& !isDirectEngine\(provider \|\| _transcribeCfg\.engine\)\) \{/,
        'the click guard must test the RESOLVED engine against the direct SET');
    assert.match(READER_CODE,
        /if \(!_transcribeCfg\.enabled && _transcribeCfg\.directEnabled && !isDirectEngine\(e\)\)/,
        'transcribeTooltip must widen the same way as the click guard');
});

test('no direct-engine comparison in the flow tests a SINGLE id', () => {
    // The bug this replaces, field-found 2026-08-16 the moment Deepgram
    // shipped: both the click guard and the consent block compared
    // against DIRECT_ENGINE_ID alone. Selecting Deepgram therefore
    // silently re-opened the picker ("nothing happens"), and — worse —
    // skipped the page-URL refusal and the confirm dialog entirely.
    //
    // The previous version of this guard asserted the LITERAL string
    // `!== DIRECT_ENGINE_ID`, so it passed while the behavior was wrong
    // for the second engine: it pinned the implementation instead of the
    // invariant. Pin the invariant — comparisons go through the set, and
    // a third engine inherits every gate for free.
    const flow = /async function runTranscribeFlow\(provider\)[\s\S]*?\n}/.exec(READER_CODE);
    assert.ok(flow, 'runTranscribeFlow moved');
    const bare = [...flow[0].matchAll(/[!=]== ?DIRECT_ENGINE_ID|[!=]== ?DEEPGRAM_DIRECT_ENGINE_ID/g)];
    assert.deepEqual(bare.map((m) => m[0]), [],
        'compare against DIRECT_ENGINE_IDS via isDirectEngine(), never one id');
    assert.match(flow[0], /isDirectEngine\(/, 'the flow must consult the set');
});

test('every engine the picker marks `direct` is a member of the direct set', () => {
    // ENGINE_META.direct drives the picker's availability branch; the
    // DIRECT_ENGINE_IDS set drives the consent and refusal gates. If the
    // two ever disagree, an engine renders as companion-free while
    // skipping the gates that exist because it is.
    // Scope to the ENGINE_META object — an unscoped scan matches any
    // computed key in the file and then runs forward looking for
    // `direct: true`, which found `[skey]` from an unrelated object.
    const metaBody = /const ENGINE_META = \{([\s\S]*?)\n\};/.exec(READER_SRC);
    assert.ok(metaBody, 'ENGINE_META moved');
    const metaDirect = [...metaBody[1].matchAll(/\[(\w+)\]: \{(?:(?!\n    \},?)[\s\S])*?direct: true/g)]
        .map((m) => m[1]);
    const setBody = /const DIRECT_ENGINE_IDS = \[([^\]]*)\]/.exec(READER_CODE);
    assert.ok(setBody, 'DIRECT_ENGINE_IDS moved');
    const inSet = setBody[1].split(',').map((x) => x.trim()).filter(Boolean);
    assert.deepEqual(metaDirect.sort(), inSet.sort(),
        'ENGINE_META `direct: true` and DIRECT_ENGINE_IDS must name the same engines');
});

test('the consent dialog and the page refusal cover EVERY direct engine', () => {
    const flow = /async function runTranscribeFlow\(provider\)[\s\S]*?\n}/.exec(READER_CODE)[0];
    const gate = flow.indexOf('if (isDirectEngine(provider)) {');
    const refuse = flow.indexOf('directSubmissionProblem(');
    const confirmAt = flow.indexOf('confirmDirectSubmission(');
    assert.ok(gate > -1, 'the direct consent block must gate on the set');
    assert.ok(refuse > gate && confirmAt > refuse,
        'refuse an impossible submission, then ask the user to approve a possible one');
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

test('a direct-only picker never probes the companion', () => {
    // The health probe exists to mark Local unavailable when HF_TOKEN is
    // missing. With the companion flag off, Local is not on the menu at
    // all — so the probe is a round trip to a socket nothing is
    // listening on, on the one path whose premise is that nothing is
    // installed. It must be gated on the companion actually being shown.
    const picker = /async function openEnginePicker\(\)[\s\S]*?\n}/.exec(READER_CODE);
    assert.ok(picker, 'openEnginePicker moved');
    const probeAt = picker[0].indexOf("'xray:transcribe:ping'");
    assert.ok(probeAt > 0, 'the health probe moved');
    const gateAt = picker[0].indexOf('if (companionEnabled) {');
    assert.ok(gateAt > 0 && gateAt < probeAt,
        'the companion health probe must be gated on companionEnabled');
});

test('the direct route refuses a page URL before starting the job', () => {
    // Field failure 2026-08-15: AssemblyAI was handed an HTML page and
    // answered with a paid error. The refusal must run BEFORE the
    // confirm dialog (no point asking the user to approve something
    // that cannot work) and before the job starts.
    const flow = /async function runTranscribeFlow\(provider\)[\s\S]*?_transcribeRunning = true;/.exec(READER_CODE);
    assert.ok(flow, 'runTranscribeFlow moved');
    const refuseAt = flow[0].indexOf('directSubmissionProblem(');
    const confirmAt = flow[0].indexOf('confirmDirectSubmission(');
    const startAt = flow[0].indexOf('runTranscriptionJob(');
    assert.ok(refuseAt > 0, 'the direct route must consult directSubmissionProblem');
    assert.ok(confirmAt > refuseAt, 'refuse an impossible submission before asking the user to approve it');
    assert.ok(startAt === -1 || startAt > refuseAt);
});

test('the picker marks the direct engine unavailable before the click, not after', () => {
    // Field report 2026-08-16: "AssemblyAI (direct)" was offered on a
    // YouTube capture and only refused once clicked, on a page where it
    // structurally cannot work. The picker already had an availability
    // idiom for choices that cannot succeed (missing API key, missing
    // HF_TOKEN); the direct engine's structural limit has to use it too.
    const picker = /async function openEnginePicker\(\)[\s\S]*?\n}/.exec(READER_CODE);
    assert.ok(picker, 'openEnginePicker moved');
    assert.match(picker[0], /const blockedDirect = meta\.direct/,
        'the picker must compute the direct engine\'s structural availability');
    assert.match(picker[0], /blockedDirect\s*\n?\s*\?\s*blockedDirect\.short/,
        'an unavailable direct engine must show its reason on the menu row');
    // And the row must not be clickable into a doomed job.
    const clickAt = picker[0].indexOf('runTranscribeFlow(engine)');
    const guardAt = picker[0].indexOf('if (blockedDirect) {');
    assert.ok(guardAt > 0 && guardAt < clickAt,
        'clicking an unavailable direct row must explain, never start a job');
    // keyed gates the estimate line; blockedDirect must suppress it too,
    // or the row would advertise a cost for a run that cannot happen.
    assert.match(picker[0], /const keyed = !blockedLocal && !blockedDirect/);
});

test('the refusal toast uses the detail half of the problem', () => {
    // directSubmissionProblem returns {short, detail}; passing the
    // object to toast() would render "[object Object]".
    assert.match(READER_CODE, /toast\(problem\.detail,/);
    assert.ok(!/toast\(problem,/.test(READER_CODE));
});

test('DC.2: the Options status panel is told whether direct cloud is configured', () => {
    // deriveCompanionState cannot know on its own, and the panel has no
    // flag gate — it polls on load for every user. Wiring it to the
    // live CHECKBOX rather than the stored flag keeps it honest while
    // the user is still deciding, before they hit Save.
    const opts = readRepo('src/options/index.js');
    assert.match(opts, /directEnabled: !!document\.getElementById\('pref-direct-cloud-transcription'\)\?\.checked/,
        'the status panel must reflect the direct-cloud checkbox');
});

test('DC.2: companion setup advice is structurally unreachable on the direct route', () => {
    // renderTranscribeBanner's docsHint tells the user to install the
    // companion and run `uv run xray-transcriber`. Gating it on a
    // substring ("not reachable") left it one careless string away from
    // firing on the one route whose premise is that nothing is
    // installed. Gate on the route itself.
    assert.match(READER_CODE, /docsHint: routing\.route !== 'direct' &&/,
        'the docs hint must be gated on the route, not only on error text');
});

test('DC.2: the opening banner names who is actually being contacted', () => {
    // Originally pinned the literal 'Contacting AssemblyAI…' — which
    // became wrong the moment a second vendor shipped. Same lesson as
    // the DIRECT_ENGINE_ID guard: assert the rule, not the snapshot.
    assert.match(READER_CODE, /`Contacting \$\{vendor\}…`/,
        'a direct run must name the vendor it is actually contacting');
    assert.ok(!/'Contacting AssemblyAI/.test(READER_CODE),
        'no vendor may be hardcoded into the in-flight banner');
});

test('DC.3: both direct engines share one flag and one admission gate', () => {
    // One consent decision covers "may X talk to a transcription
    // provider directly" — not one per vendor. A second flag would let
    // a user believe they had turned the capability off while another
    // vendor still had it.
    assert.deepEqual([...DIRECT_ENGINE_IDS].sort(), [DEEPGRAM_ENGINE_ID, DIRECT_ENGINE_ID].sort());
    for (const id of DIRECT_ENGINE_IDS) {
        assert.ok(pickerEngines().includes(id), `${id} is not offered by the picker`);
    }
});

test('DC.3: the Deepgram selection id stays out of the persisted enum too', () => {
    assert.ok(!TRANSCRIBE_ENGINES.includes(DEEPGRAM_ENGINE_ID));
    assert.equal(normalizeEngine(DEEPGRAM_ENGINE_ID), 'local',
        'the same collapse that keeps the AssemblyAI id picker-only');
    assert.ok(!readRepo('src/options/index.js').includes(DEEPGRAM_ENGINE_ID));
    assert.notEqual(DEEPGRAM_ENGINE_ID, DEEPGRAM_PROVIDER);
});

test('DC.3: the Deepgram picker line states the property a user could not guess', () => {
    // Its one meaningful difference from AssemblyAI direct: a torn-down
    // worker loses the request outright, because Deepgram issues no id
    // and does not store transcripts.
    const meta = /\[DEEPGRAM_DIRECT_ENGINE_ID\]: \{([\s\S]*?)\n    \}/.exec(READER_SRC);
    assert.ok(meta, 'the Deepgram ENGINE_META entry moved');
    assert.match(meta[1], /cannot resume|interrupt/i,
        'say that this route cannot resume if interrupted');
    assert.ok(!/audio leaves your machine/i.test(meta[1]),
        'that is the companion cloud disclosure and it is false here');
});

test('the consent dialog names the vendor THIS run will reach', () => {
    // Field-found 2026-08-16: the dialog hardcoded "AssemblyAI" and said
    // it while the run went to Deepgram. A consent surface that names
    // the wrong recipient is worse than no dialog — the user approved a
    // disclosure to a party that was not the one receiving it.
    const fn = /function confirmDirectSubmission\([\s\S]*?\n}/.exec(READER_CODE);
    assert.ok(fn, 'confirmDirectSubmission moved');
    assert.match(fn[0], /function confirmDirectSubmission\(sourceUrl, articleUrl, engine\)/,
        'it must be told which engine is running');
    assert.match(fn[0], /ENGINE_META\[engine\][\s\S]*?\.vendor/, 'and read the vendor from it');
    assert.ok(!/AssemblyAI|Deepgram/.test(fn[0]),
        'no vendor may be hardcoded in a consent string');
    // The call site must pass it.
    assert.match(READER_CODE, /confirmDirectSubmission\(sourceUrl, a\.url, provider\)/);
});

test('no user-facing direct-path string hardcodes one vendor', () => {
    // The whole class, not the three instances that were found: the
    // in-flight banner and the picker cost line had the same defect.
    const flow = /async function runTranscribeFlow\(provider\)[\s\S]*?\n}/.exec(READER_CODE)[0];
    assert.ok(!/'Contacting AssemblyAI/.test(flow), 'the banner must name the running vendor');
    assert.match(READER_CODE, /renderTranscribeBanner\(vendor\s*\n?\s*\?\s*`Contacting \$\{vendor\}/);

    const estimate = /if \(meta && meta\.direct\) \{([\s\S]*?)\n    \}/.exec(READER_CODE);
    assert.ok(estimate, 'the direct branch of engineEstimate moved');
    assert.ok(!/AssemblyAI|Deepgram/.test(estimate[1]),
        'the picker cost line must not hardcode a vendor — both direct rows render from it');
    assert.match(estimate[1], /meta\.vendor/);
});

test('every direct engine declares the vendor name its prose needs', () => {
    const metaBody = /const ENGINE_META = \{([\s\S]*?)\n\};/.exec(READER_SRC)[1];
    const directEntries = [...metaBody.matchAll(/\[(\w+)\]: \{((?:(?!\n    \},?)[\s\S])*?direct: true(?:(?!\n    \},?)[\s\S])*)/g)];
    assert.ok(directEntries.length >= 2, 'expected both direct engines');
    for (const [, key, body] of directEntries) {
        assert.match(body, /vendor: '/, `${key} has no vendor name for prose`);
    }
});

test('an unresolved prior submission is SURFACED, not just returned', () => {
    // runTranscriptionJob returns priorSubmission; before this fix
    // nothing consumed it, so the one case that can cost money with no
    // result was reported to no one. The unit test asserted the flag;
    // nothing asserted the seam.
    assert.match(READER_CODE, /if \(out\.priorSubmission\)/,
        'the reader must consume the flag');
    const hits = [...READER_CODE.matchAll(/if \(out\.priorSubmission\)/g)];
    assert.equal(hits.length, 2,
        'surface it on BOTH outcomes — a later success does not undo an earlier charge');
});
