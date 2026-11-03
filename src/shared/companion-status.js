// X-Ray — companion service status, derived.
//
// Pure: turns an `xray:transcribe:ping` reply plus the extension's own
// engine preference into the state a UI should show. No DOM, no
// storage, no network — so every branch is unit-testable, which matters
// because the misleading states here are the ones a user cannot
// diagnose themselves.
//
// The states worth their own branch, all seen in the field:
//   - unreachable          the service is not running (the common case)
//   - reachable but 401    TRANSCRIBER_TOKEN set service-side, not
//                          pasted here. /health is EXEMPT from the
//                          token middleware, so a naive check reports
//                          "running" while every real call fails.
//   - engine ignored       an older build without `request_provider`
//                          silently runs its own default instead of
//                          the engine picked here.
//   - local without a token  HF_TOKEN missing means local jobs fail
//                          outright — no transcript, not a transcript
//                          missing speaker labels.
//
// Never carries a secret: it reads /health BOOLEANS and the engine
// name, never a key or the auth token itself.

export const COMPANION_LEVELS = ['ok', 'warn', 'err', 'checking'];

/** Display name for an engine id. */
export function engineName(id) {
    const e = String(id || '').toLowerCase();
    if (e === 'assemblyai') return 'AssemblyAI';
    if (e === 'deepgram') return 'Deepgram';
    if (e === 'local') return 'local';
    return e || 'local';
}

/**
 * Whether a /health snapshot rules out running local jobs right now.
 * Currently just the missing-HF_TOKEN case — pyannote diarization can't
 * load without it, so the companion fails local jobs immediately
 * (pipeline.py). One definition shared by the Options status panel and
 * the reader's engine picker, so "local is blocked" never drifts
 * between the two surfaces.
 */
export function localBlockedByHealth(health) {
    return !!(health && health.hf_token === false);
}

/**
 * @param {object}  opts
 * @param {object=} opts.resp        the xray:transcribe:ping reply, or null while in flight
 * @param {string=} opts.enginePref  '' (companion default) | 'ask' | 'local' | 'assemblyai' | 'deepgram'
 * @param {number=} opts.port        the port probed, for the recovery text
 * @returns {{level:string, state:string, detail:string, steps:string[], command:string}}
 */
/**
 * `directEnabled` (DC.2): can this install transcribe with NO companion
 * at all? When it can, an absent companion is not a fault — it is a
 * supported, working configuration, and the panel must stop opening
 * with terminal instructions and a false "transcribing stays
 * unavailable". Every OTHER state is unaffected: a companion that is
 * running, outdated, rejecting auth, or missing HF_TOKEN is misbehaving
 * whether or not another route exists, and the tests pin that.
 */
export function deriveCompanionState({ resp, enginePref = '', port = 8756, directEnabled = false } = {}) {
    const base = { level: 'checking', state: 'Checking…', detail: '', steps: [], command: '' };
    if (!resp) return base;

    const startCommand = 'cd companion\\transcriber\nuv run xray-transcriber';

    if (!resp.ok) {
        // The companion-free configuration is a first-class state, not a
        // failure. Saying "transcribing stays unavailable" to a user who
        // can transcribe right now is simply false, and it was the first
        // thing they read (this panel has no flag gate and polls on
        // load).
        if (directEnabled) {
            return {
                level: 'warn',
                state: 'Not installed',
                detail: `Nothing is answering on 127.0.0.1:${port} — expected if you never installed it. `
                    + 'AssemblyAI (direct) transcribes without it. Installing the companion would add '
                    + 'local, private transcription that never leaves this machine, and the platform '
                    + 'pages a cloud provider cannot fetch (YouTube, Instagram, TikTok — their media '
                    + 'URLs are signed and expire).',
                steps: [],
                command: ''
            };
        }
        return {
            level: 'err',
            state: 'Not running',
            detail: `Nothing is answering on 127.0.0.1:${port}. Transcribing stays unavailable until the service is started — including for the AssemblyAI and Deepgram engines, which still download audio through it.`,
            steps: [
                'Open a terminal in your X-Ray repo.',
                'Run the command below and leave the window open — it runs in the foreground.',
                'This panel turns green on its own within a few seconds. No browser reload needed.'
            ],
            command: startCommand
        };
    }

    const h = resp.health || {};
    // An older build predating per-job engine choice reports no
    // `provider`; it only ever ran local.
    const companionDefault = String(h.provider || 'local').toLowerCase();

    // Reachable but rejecting us — the /health exemption trap.
    if (resp.authOk === false) {
        return {
            level: 'err',
            state: 'Running, but rejecting this extension',
            detail: 'The service is up, but it requires an auth token and the one saved here does not match. Every transcribe request will fail with 401 even though the health check passes.',
            steps: [
                'If the service sets TRANSCRIBER_TOKEN, paste the same value into "Companion auth token" below.',
                'If it does not, clear that field.'
            ],
            command: ''
        };
    }

    const version = h.version ? `v${h.version}` : 'version unknown';
    const device = h.device && h.device !== 'unknown' ? `, ${h.device}` : '';
    const facts = [`Running (${version}${device})`];

    // Which engine will ACTUALLY run: this extension's preference wins
    // when the build honors it, otherwise the companion's own default.
    let effective;
    if (enginePref === 'ask') effective = 'asked per video in the reader';
    else if (enginePref) effective = engineName(enginePref);
    else effective = `${engineName(companionDefault)} (the service's own default — no preference set here)`;
    facts.push(`engine: ${effective}`);
    if (h.queue_depth > 0) facts.push(`${h.queue_depth} job(s) running`);
    const detail = facts.join(' · ');

    // A build that ignores the per-job engine will silently run
    // something other than what the picker above says.
    if (enginePref && enginePref !== 'ask' && h.request_provider !== true) {
        return {
            level: 'warn',
            state: 'Running an outdated build',
            detail: `${detail}. This build ignores the engine picked here and will run ${engineName(companionDefault)} instead.`,
            steps: ['Update the service (git pull), then restart it.'],
            command: startCommand
        };
    }

    // ffmpeg is required for every engine; current builds refuse to
    // start without it, so this only fires on an older one.
    if (h.ffmpeg === false) {
        return {
            level: 'warn',
            state: 'Running without ffmpeg',
            detail: `${detail}. ffmpeg is missing, and every engine needs it to download audio.`,
            steps: ['Install it: winget install Gyan.FFmpeg', 'Restart the service from a NEW terminal.'],
            command: ''
        };
    }

    // Local jobs need HF_TOKEN or they fail before the download.
    const willRunLocal = enginePref === 'local' || (!enginePref && companionDefault === 'local');
    if (willRunLocal && localBlockedByHealth(h)) {
        return {
            level: 'warn',
            state: 'Running, but local jobs will fail',
            detail: `${detail}. No Hugging Face token, so local transcription fails before the download starts — you get no transcript at all.`,
            steps: [
                'Create a read token at https://hf.co/settings/tokens and accept the pyannote/speaker-diarization-community-1 terms.',
                'Run: setx HF_TOKEN hf_your_token_here',
                'Restart the service from a NEW terminal — setx never updates open ones.',
                'Or switch the engine above to AssemblyAI or Deepgram, which need no token.'
            ],
            command: ''
        };
    }

    return { level: 'ok', state: 'Running', detail, steps: [], command: '' };
}
