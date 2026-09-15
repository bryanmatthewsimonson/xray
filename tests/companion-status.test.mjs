// Companion status derivation — the states a user cannot diagnose
// themselves, so each gets its own case.

import test from 'node:test';
import assert from 'node:assert/strict';

import { deriveCompanionState, engineName, localBlockedByHealth } from '../src/shared/companion-status.js';

const healthy = (over = {}) => ({
    ok: true,
    health: {
        status: 'ok', version: '0.1.0', device: 'cuda', ffmpeg: true, hf_token: true,
        provider: 'local', providers: { local: true, assemblyai: false, deepgram: false },
        request_provider: true, queue_depth: 0, ...over
    }
});

test('no response yet reads as checking, not as broken', () => {
    const s = deriveCompanionState({ resp: null });
    assert.equal(s.level, 'checking');
    assert.equal(s.steps.length, 0, 'does not accuse the user before the first answer');
});

test('unreachable names the port and carries the start command', () => {
    const s = deriveCompanionState({ resp: { ok: false, error: 'nope' }, port: 8756 });
    assert.equal(s.level, 'err');
    assert.equal(s.state, 'Not running');
    assert.match(s.detail, /8756/, 'names the port actually probed');
    assert.match(s.command, /uv run xray-transcriber/);
    assert.ok(s.steps.length > 0, 'failure carries the fix, not just the diagnosis');
    // The fact people get wrong: cloud engines still need the service.
    assert.match(s.detail, /AssemblyAI|Deepgram/);
});

test('a non-default port appears in the recovery text', () => {
    const s = deriveCompanionState({ resp: { ok: false }, port: 9999 });
    assert.match(s.detail, /9999/);
});

test('healthy service reads as running', () => {
    const s = deriveCompanionState({ resp: healthy(), enginePref: '' });
    assert.equal(s.level, 'ok');
    assert.equal(s.state, 'Running');
    assert.match(s.detail, /v0\.1\.0/);
    assert.match(s.detail, /cuda/);
    assert.equal(s.steps.length, 0);
});

// The trap: /health is exempt from the companion's token middleware, so
// a reachable-but-rejecting service answers 200 here while every real
// call 401s.
test('reachable but rejecting is an error, never "running"', () => {
    const s = deriveCompanionState({ resp: { ...healthy(), authOk: false } });
    assert.equal(s.level, 'err');
    assert.match(s.state, /rejecting/i);
    assert.match(s.detail, /401/);
    assert.ok(s.steps.some(x => /auth token/i.test(x)));
});

test('authOk true or absent does not trip the auth branch', () => {
    assert.equal(deriveCompanionState({ resp: { ...healthy(), authOk: true } }).level, 'ok');
    assert.equal(deriveCompanionState({ resp: healthy() }).level, 'ok');
});

test('an outdated build that ignores the engine choice warns, and says what will run', () => {
    const s = deriveCompanionState({
        resp: healthy({ request_provider: false, provider: 'local' }),
        enginePref: 'assemblyai'
    });
    assert.equal(s.level, 'warn');
    assert.match(s.detail, /ignores the engine/);
    assert.match(s.detail, /local/, 'names what it will actually run');
});

test('no engine preference means the companion default is not a mismatch', () => {
    const s = deriveCompanionState({ resp: healthy({ request_provider: false }), enginePref: '' });
    assert.equal(s.level, 'ok', 'nothing to ignore when nothing was asked for');
});

test('local engine without a Hugging Face token warns that jobs fail outright', () => {
    const s = deriveCompanionState({ resp: healthy({ hf_token: false }), enginePref: 'local' });
    assert.equal(s.level, 'warn');
    assert.match(s.detail, /no transcript at all/i, 'not "you lose speaker labels"');
    assert.ok(s.steps.some(x => /setx HF_TOKEN/.test(x)));
    assert.ok(s.steps.some(x => /AssemblyAI|Deepgram/.test(x)), 'offers the no-token way out');
});

test('a cloud engine does not care about the Hugging Face token', () => {
    const s = deriveCompanionState({ resp: healthy({ hf_token: false }), enginePref: 'assemblyai' });
    assert.equal(s.level, 'ok');
});

test('the companion default drives the local-token check when no preference is set', () => {
    assert.equal(deriveCompanionState({ resp: healthy({ hf_token: false, provider: 'local' }) }).level, 'warn');
    assert.equal(deriveCompanionState({ resp: healthy({ hf_token: false, provider: 'assemblyai' }) }).level, 'ok');
});

test('missing ffmpeg warns for every engine', () => {
    const s = deriveCompanionState({ resp: healthy({ ffmpeg: false }), enginePref: 'assemblyai' });
    assert.equal(s.level, 'warn');
    assert.match(s.detail, /ffmpeg/);
});

test('queue depth surfaces only when there is work', () => {
    assert.match(deriveCompanionState({ resp: healthy({ queue_depth: 2 }) }).detail, /2 job/);
    assert.doesNotMatch(deriveCompanionState({ resp: healthy() }).detail, /job\(s\)/);
});

test('"ask per video" is reported as such, not as an engine name', () => {
    const s = deriveCompanionState({ resp: healthy(), enginePref: 'ask' });
    assert.match(s.detail, /asked per video/);
});

test('a device still probing is omitted rather than shown as unknown', () => {
    assert.doesNotMatch(deriveCompanionState({ resp: healthy({ device: 'unknown' }) }).detail, /unknown/);
});

test('no branch leaks a secret', () => {
    // Every state string is built from /health booleans and engine
    // names; a token or key must never reach the panel.
    const cases = [
        deriveCompanionState({ resp: null }),
        deriveCompanionState({ resp: { ok: false } }),
        deriveCompanionState({ resp: { ...healthy(), authOk: false } }),
        deriveCompanionState({ resp: healthy({ hf_token: false }), enginePref: 'local' }),
        deriveCompanionState({ resp: healthy({ request_provider: false }), enginePref: 'deepgram' })
    ];
    for (const s of cases) {
        const blob = JSON.stringify(s);
        assert.doesNotMatch(blob, /hf_[A-Za-z0-9]{8,}/, 'no Hugging Face token shape');
        assert.doesNotMatch(blob, /\bsk-[A-Za-z0-9]{8,}/, 'no API-key shape');
    }
});

// localBlockedByHealth is the standalone predicate the reader's engine
// picker uses to mark Local (WhisperX) unavailable — same fact
// deriveCompanionState's local-token branch reads, extracted so the two
// surfaces (Options status panel, reader picker) can never disagree.
test('localBlockedByHealth: true only when health explicitly says hf_token is false', () => {
    assert.equal(localBlockedByHealth({ hf_token: false }), true);
    assert.equal(localBlockedByHealth({ hf_token: true }), false);
    assert.equal(localBlockedByHealth({}), false, 'unset/unknown never blocks');
    assert.equal(localBlockedByHealth(null), false, 'a missing/failed probe never blocks');
    assert.equal(localBlockedByHealth(undefined), false);
});

test('engineName maps ids to display names', () => {
    assert.equal(engineName('assemblyai'), 'AssemblyAI');
    assert.equal(engineName('deepgram'), 'Deepgram');
    assert.equal(engineName('local'), 'local');
    assert.equal(engineName(''), 'local');
});

// ------------------------------------------------------------------
// DC.2 — "no companion installed, direct cloud configured" is a
// COHERENT STATE, not a wall of setup errors.
//
// setupCompanionStatus has no flag gate: this panel polls and renders
// on the Options page regardless of which transcription routes the user
// has enabled. Before DC.2 its "Not running" state told a direct-only
// user that "Transcribing stays unavailable until the service is
// started — including for the AssemblyAI and Deepgram engines", which
// is FALSE for them and is the first thing they would read.
//
// It is also the only surface in the inventory that fires BEFORE the
// user attempts anything, which is why it leads DC.2's work list.
// ------------------------------------------------------------------

test('DC.2: an absent companion is not an ERROR when direct cloud can transcribe', () => {
    const down = { ok: false, error: 'not reachable' };
    const withoutDirect = deriveCompanionState({ resp: down, port: 8756 });
    assert.equal(withoutDirect.level, 'err', 'unchanged when direct cloud is off');

    const withDirect = deriveCompanionState({ resp: down, port: 8756, directEnabled: true });
    assert.notEqual(withDirect.level, 'err',
        'an absent companion is an expected, working configuration for a direct-only user');
});

test('DC.2: the absent-companion detail is TRUE for a direct-only user', () => {
    const state = deriveCompanionState({
        resp: { ok: false }, port: 8756, directEnabled: true
    });
    const text = `${state.state} ${state.detail}`;
    assert.ok(!/stays unavailable/i.test(text),
        'transcribing does NOT stay unavailable — the direct route works without this service');
    assert.ok(!/including for the AssemblyAI and Deepgram engines/i.test(text),
        'that clause predates the direct route and is now false');
    assert.match(text, /direct/i, 'name the route that does work');
});

test('DC.2: it still says what the companion would ADD, without demanding it', () => {
    // Honest, not dismissive: the companion is not obsolete — it is the
    // local/private option and the only path for signed platform media.
    const state = deriveCompanionState({
        resp: { ok: false }, port: 8756, directEnabled: true
    });
    const text = `${state.detail} ${state.steps.join(' ')}`;
    assert.match(text, /local|private|YouTube|platform/i,
        'say what installing it would buy, so the choice is informed');
    // No imperative setup steps: nothing is broken in this state.
    assert.ok(state.steps.length === 0 || !/^Open a terminal/.test(state.steps[0]),
        'do not open with terminal instructions for a configuration that is working');
});

test('DC.2: a RUNNING companion renders identically whether or not direct is on', () => {
    // The flag must not perturb any state but the absent one.
    const up = { ok: true, health: { version: '1.2', device: 'cpu', request_provider: true, hf_token: true } };
    for (const enginePref of ['', 'local', 'assemblyai', 'ask']) {
        assert.deepEqual(
            deriveCompanionState({ resp: up, enginePref, directEnabled: true }),
            deriveCompanionState({ resp: up, enginePref }),
            `the direct flag changed a running-companion state (enginePref=${enginePref || 'none'})`
        );
    }
});

test('DC.2: an auth-rejecting companion is still an error, direct or not', () => {
    // Reachable-but-rejecting is a genuine misconfiguration the user
    // asked for by setting a token. Direct cloud does not excuse it.
    const rejecting = { ok: true, authOk: false, health: {} };
    assert.equal(deriveCompanionState({ resp: rejecting, directEnabled: true }).level, 'err');
});
