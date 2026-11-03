// The provider host pin — guard-rail 1 of
// docs/DIRECT_CLOUD_TRANSCRIBE_KICKOFF.md.
//
// transcriber-client.js is pinned to LOOPBACK literals because a
// tampered stored value must never exfiltrate transcript text to a
// remote host, and that invariant is guarded because loopbackUrl() is a
// function a test can call. direct-transcribe.js is the deliberate
// remote exception, and its pin is a bare CONSTANT — the shape nothing
// in this repo guarded before this file existed. (Verified while
// writing it: ANTHROPIC_API_URL and SCHOLAR_FETCH_HOSTS are pinned the
// same way and have no guard either; the only test that names a pinned
// host does so incidentally.)
//
// So this file asserts the pin two ways, because they fail differently:
// behaviorally (what the module actually fetches) and structurally
// (that no stored value or response field can widen it later).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.fetch = () => { throw new Error('TRIPWIRE: host-pin test reached the network'); };

let storage = {};
globalThis.chrome = {
    storage: {
        local: {
            get(keys, cb) {
                const out = {};
                for (const k of (Array.isArray(keys) ? keys : [keys])) if (k in storage) out[k] = storage[k];
                cb(out);
            },
            set(obj, cb) { Object.assign(storage, obj); cb && cb(); },
            remove(keys, cb) { for (const k of [].concat(keys)) delete storage[k]; cb && cb(); }
        }
    }
};

const {
    ASSEMBLYAI_API_BASE, DIRECT_PROVIDER_ORIGINS,
    startDirectTranscription, getDirectJobStatus
} = await import('../src/shared/direct-transcribe.js');
const { DEEPGRAM_ORIGIN, DEEPGRAM_API_URL } = await import('../src/shared/direct-transcribe-deepgram.js');
const { ASSEMBLYAI_KEY_STORAGE } = await import('../src/shared/transcriber-client.js');

/** Every origin ANY direct-cloud module may reach. Aggregated here so
 *  adding a provider without declaring it fails this file. */
const ALL_DIRECT_ORIGINS = [...DIRECT_PROVIDER_ORIGINS, DEEPGRAM_ORIGIN];

const repoUrl = (p) => new URL(`../${p}`, import.meta.url);
const readRepo = (p) => readFileSync(repoUrl(p), 'utf8');
const MODULE_SRC = readRepo('src/shared/direct-transcribe.js');

/** Comments explain why a thing is NOT done — "companionFetch attaches
 *  the companion token to every request, so we do not reuse it" is
 *  exactly the prose these guards would otherwise flag. Grep the CODE. */
function stripComments(source) {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
}
const MODULE_CODE = stripComments(MODULE_SRC);

// ------------------------------------------------------------------
// 1. Behavioral — what does it actually fetch?
// ------------------------------------------------------------------

test('every request the module makes lands on a pinned https origin', async () => {
    storage = { [ASSEMBLYAI_KEY_STORAGE]: 'k' };
    const seen = [];
    const fetchFn = async (url) => {
        seen.push(url);
        return { ok: true, status: 200, json: async () => ({ id: 'abc', status: 'queued' }) };
    };
    await startDirectTranscription('https://cdn.example.com/a.mp3', { fetchFn });
    await getDirectJobStatus('abc', { fetchFn });
    assert.ok(seen.length >= 2);
    for (const url of seen) {
        const u = new URL(url);
        assert.equal(u.protocol, 'https:', `${url} is not https`);
        assert.ok(DIRECT_PROVIDER_ORIGINS.includes(u.origin), `${u.origin} is not a pinned origin`);
    }
});

test('a poisoned storage value cannot redirect a request', async () => {
    // The failure this rules out: a "base URL" preference creeping in
    // later, or a restored backup planting one. Nothing the module
    // reads from storage may reach the request URL.
    storage = {
        [ASSEMBLYAI_KEY_STORAGE]: 'k',
        'xray:transcriber:assemblyai:base': 'https://evil.example',
        'xray:transcriber:assemblyai:host': 'evil.example',
        'xray:transcriber:port': '1',
        'xray:lmstudio:url': 'https://evil.example/v1'
    };
    const seen = [];
    const fetchFn = async (url) => {
        seen.push(url);
        return { ok: true, status: 200, json: async () => ({ id: 'abc' }) };
    };
    await startDirectTranscription('https://cdn.example.com/a.mp3', { fetchFn });
    assert.equal(seen.length, 1);
    assert.equal(seen[0], `${ASSEMBLYAI_API_BASE}/transcript`);
    assert.ok(!seen[0].includes('evil.example'));
});

// ------------------------------------------------------------------
// 2. Structural — can the pin be widened later without noticing?
// ------------------------------------------------------------------

test('the base URL is a literal, not built from a stored or fetched value', () => {
    const line = MODULE_CODE.split('\n').find((l) => l.includes('export const ASSEMBLYAI_API_BASE'));
    assert.ok(line, 'ASSEMBLYAI_API_BASE is no longer declared where the guard can see it');
    assert.match(line, /=\s*'https:\/\/api\.assemblyai\.com\/v2'\s*;/,
        'the pinned base must stay a plain string literal — no template, no concatenation, no storage read');
});

test('the module reads no storage key that could name a host', () => {
    // Whitelist the ONE key it may read. Anything url/host/base/
    // endpoint-shaped is the smell this guard exists for.
    const reads = [...MODULE_CODE.matchAll(/storageGet\(\[([^\]]*)\]\)/g)].map((m) => m[1].trim());
    assert.deepEqual(reads, ['ASSEMBLYAI_KEY_STORAGE'],
        `direct-transcribe.js reads unexpected storage keys: ${reads.join(', ')}`);
    const suspicious = [...MODULE_CODE.matchAll(/^\s*(?:const|let|var)\s+\w*(?:url|host|base|endpoint)\w*\s*=\s*(?:await\s+)?storage/gim)];
    assert.equal(suspicious.length, 0, 'a host-shaped value is being read from storage');
});

test('the module imports no function from transcriber-client.js', () => {
    // companionFetch attaches the user's X-Transcriber-Token to EVERY
    // request; reusing it here would send the companion's shared secret
    // to AssemblyAI. Only the credential KEY NAME may be imported.
    const imports = [...MODULE_CODE.matchAll(/import\s+\{([^}]*)\}\s+from\s+'\.\/transcriber-client\.js'/g)]
        .flatMap((m) => m[1].split(',').map((x) => x.trim()).filter(Boolean));
    assert.deepEqual(imports, ['ASSEMBLYAI_KEY_STORAGE']);
    assert.ok(!/TRANSCRIBER_TOKEN_STORAGE/.test(MODULE_CODE),
        'the companion shared secret must never be referenced on a third-party path');
    assert.ok(!/companionFetch|transcriberBaseUrl/.test(MODULE_CODE),
        'the companion transport helpers must not be called here — they attach the companion token');
});

test('transcriber-client.js keeps its own loopback pin intact', () => {
    // Guard-rail 1 is two-sided: the direct path was added by writing a
    // NEW module, explicitly so this invariant did not have to loosen.
    const client = readRepo('src/shared/transcriber-client.js');
    assert.match(client, /transcriberBaseUrl[\s\S]{0,120}http:\/\/127\.0\.0\.1:/);
    assert.ok(!/api\.assemblyai\.com|api\.deepgram\.com/.test(client),
        'transcriber-client.js must not reach a third-party host — that is direct-transcribe.js\'s job');
});

// ------------------------------------------------------------------
// 3. Tree-wide — where may this host name appear at all?
// ------------------------------------------------------------------

test('the provider host appears only where it is pinned or declared', () => {
    const allowed = new Map([
        ['src/shared/direct-transcribe.js', null],   // the pin itself
        ['manifest.json', 1]                         // the documentary entry
    ]);
    for (const [file, expected] of allowed) {
        const count = (readRepo(file).match(/api\.assemblyai\.com/g) || []).length;
        assert.ok(count > 0, `${file} no longer names the pinned host`);
        if (expected !== null) assert.equal(count, expected, `${file} names the host ${count} times, expected ${expected}`);
    }
});

test('the manifest declaration and the module allowlist agree in both directions', () => {
    // The entry grants nothing on its own — <all_urls> is already
    // declared — but it documents the dependency for the ROAD_TO_1_0 T5
    // permission-narrowing sweep, which would otherwise have to
    // rediscover it from source. If the two ever disagree, the sweep
    // gets a wrong answer.
    const manifest = JSON.parse(readRepo('manifest.json'));
    const declared = manifest.host_permissions
        .filter((h) => /assemblyai|deepgram/.test(h))
        .map((h) => new URL(h.replace(/\*$/, '')).origin);
    assert.deepEqual(declared.sort(), [...ALL_DIRECT_ORIGINS].sort());
    assert.ok(manifest.host_permissions.includes('<all_urls>'),
        'if <all_urls> is ever dropped, the provider entry stops being documentary and becomes load-bearing — '
        + 'revisit docs/JOURNAL.md on this ruling before changing it');
});

// ------------------------------------------------------------------
// 4. The SECOND provider (DC.3) is pinned the same way
// ------------------------------------------------------------------

const DG_SRC = readRepo('src/shared/direct-transcribe-deepgram.js');
const DG_CODE = stripComments(DG_SRC);

test('the Deepgram endpoint is a literal, and its origin agrees with the URL', () => {
    const line = DG_CODE.split('\n').find((l) => l.includes('export const DEEPGRAM_API_URL'));
    assert.ok(line, 'DEEPGRAM_API_URL is no longer declared where the guard can see it');
    assert.match(line, /=\s*'https:\/\/api\.deepgram\.com\/v1\/listen'\s*;/,
        'the pinned endpoint must stay a plain string literal');
    assert.equal(new URL(DEEPGRAM_API_URL).origin, DEEPGRAM_ORIGIN);
});

test('the Deepgram module reads only its credential key from storage', () => {
    const reads = [...DG_CODE.matchAll(/storageGet\(\[([^\]]*)\]\)/g)].map((m) => m[1].trim());
    assert.deepEqual(reads, ['DEEPGRAM_KEY_STORAGE']);
    assert.ok(!/TRANSCRIBER_TOKEN_STORAGE|companionFetch|transcriberBaseUrl/.test(DG_CODE),
        'the companion transport and its shared secret must not appear on a third-party path');
});

test('the Deepgram module shares the admission gate rather than copying it', () => {
    // The one provider-neutral piece. A second copy would drift, and the
    // drift would be a security gate.
    assert.match(DG_CODE, /import \{[^}]*blockedDirectMediaUrl[^}]*\} from '\.\/direct-transcribe\.js'/);
    assert.ok(!/NAT64_PREFIX|nat64EmbeddedV4|blockedImageUrl/.test(DG_CODE),
        'the address table belongs to one module only');
});

test('only the service worker reaches either direct module', () => {
    for (const entry of ['src/content/index.js', 'src/reader/index.js', 'src/options/index.js',
        'src/sidepanel/index.js', 'src/portal/index.js', 'src/network/index.js']) {
        assert.ok(!stripComments(readRepo(entry)).includes('direct-transcribe-deepgram.js'),
            `${entry} imports the Deepgram module; it belongs to the background worker`);
    }
    assert.ok(stripComments(readRepo('src/background/index.js')).includes('direct-transcribe-deepgram.js'));
});

test('the provider hosts appear only where they are pinned or declared', () => {
    assert.equal((readRepo('manifest.json').match(/api\.deepgram\.com/g) || []).length, 1);
    // deepgram.py is the COMPANION's own client — a different process,
    // not part of the extension's pinned surface.
    for (const file of ['src/shared/direct-transcribe.js', 'src/shared/transcriber-client.js']) {
        assert.ok(!/api\.deepgram\.com/.test(readRepo(file)),
            `${file} must not name the Deepgram host`);
    }
});
