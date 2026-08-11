// T1 backup hygiene (docs/ROAD_TO_1_0.md B4/T1, 2026-08-10):
//   - the CREDENTIAL CLASS never rides in any export (the old guard
//     pinned one key, `xray:llm:key`, while options.html read as an
//     assurance about the class);
//   - the shareable copy omits every private key, is stamped, and
//     Restore refuses it (merge is its path in);
//   - backups are stamped with the producing version + per-database
//     IndexedDB versions, and restore/merge refuse a newer-than-
//     understood file BEFORE any write (the case-bundle pattern);
//   - the Options restore/merge surfaces route the warn channel into
//     the persistent report, never console.warn, and never auto-reload
//     over a report the user needs to read.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

await import('fake-indexeddb/auto');

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(__dirname, '..', rel), 'utf8');

// storage.js (pulled in via identity-profiles.js) touches chrome.storage
// at module load; stub it first. Callback-style, like the real API.
const _stateStore = new Map();
globalThis.chrome = {
    storage: {
        local: {
            get(keys, cb) {
                if (keys === null) { cb(Object.fromEntries(_stateStore)); return; }
                const out = {};
                for (const k of Array.isArray(keys) ? keys : [keys]) {
                    if (_stateStore.has(k)) out[k] = _stateStore.get(k);
                }
                cb(out);
            },
            set(obj, cb) {
                for (const [k, v] of Object.entries(obj)) _stateStore.set(k, v);
                cb && cb();
            },
            remove(keys, cb) {
                for (const k of Array.isArray(keys) ? keys : [keys]) _stateStore.delete(k);
                cb && cb();
            }
        }
    },
    runtime: {
        getManifest() { return { version: '88.0.0-test' }; }
    }
};

const {
    collectBackup, applyBackup, mergeBackup,
    CREDENTIAL_STORAGE_KEYS, IDENTITY_STORAGE_KEYS
} = await import('../src/shared/backup.js');
const { LLM_KEY_STORAGE } = await import('../src/shared/llm-prompts.js');
const {
    TRANSCRIBER_TOKEN_STORAGE, ASSEMBLYAI_KEY_STORAGE, DEEPGRAM_KEY_STORAGE
} = await import('../src/shared/transcriber-client.js');
const { WORKSPACE_DATABASES } = await import('../src/shared/identity-profiles.js');

const SECRETS = {
    [LLM_KEY_STORAGE]: 'sk-ant-SECRET-LLM',
    [TRANSCRIBER_TOKEN_STORAGE]: 'hf_SECRET-companion-token',
    [ASSEMBLYAI_KEY_STORAGE]: 'aai-SECRET-key',
    [DEEPGRAM_KEY_STORAGE]: 'dg-SECRET-key'
};

function seedStorage() {
    _stateStore.clear();
    _stateStore.set('preferences', JSON.stringify({ debug: false }));
    _stateStore.set('article_claims', JSON.stringify({ 'https://example.com/a': [{ id: 'claim_1' }] }));
    _stateStore.set('local_primary_identity', JSON.stringify({ nsec: 'nsec1SECRETPRIMARY', pubkey: 'p'.repeat(64) }));
    _stateStore.set('identity_profiles', JSON.stringify({ profiles: [{ label: 'main', nsec: 'nsec1SECRETPROFILE' }] }));
    _stateStore.set('local_keys', JSON.stringify({ 'xray:user': { privateKey: 'a'.repeat(64) } }));
    for (const [k, v] of Object.entries(SECRETS)) _stateStore.set(k, v);
}

// ---- the credential CLASS never rides in any export -----------------

test('every known credential constant is in CREDENTIAL_STORAGE_KEYS', () => {
    for (const key of [LLM_KEY_STORAGE, TRANSCRIBER_TOKEN_STORAGE,
        ASSEMBLYAI_KEY_STORAGE, DEEPGRAM_KEY_STORAGE]) {
        assert.ok(CREDENTIAL_STORAGE_KEYS.includes(key),
            `${key} missing from CREDENTIAL_STORAGE_KEYS`);
    }
});

test('backup.js imports the credential constants instead of restating strings', () => {
    const src = read('src/shared/backup.js');
    assert.match(src, /import \{ LLM_KEY_STORAGE \} from '\.\/llm-prompts\.js'/);
    assert.match(src, /TRANSCRIBER_TOKEN_STORAGE, ASSEMBLYAI_KEY_STORAGE, DEEPGRAM_KEY_STORAGE/);
    // The one legitimate string mention left is in comments; the
    // exclusion list itself must be built from the imported class.
    assert.match(src, /EXCLUDED_STORAGE_KEYS = \[\.\.\.CREDENTIAL_STORAGE_KEYS/);
});

test('no credential value appears anywhere in a full backup', async () => {
    seedStorage();
    const backup = await collectBackup({ includeSourceBytes: true });
    for (const key of CREDENTIAL_STORAGE_KEYS) {
        assert.ok(!(key in backup.storage), `${key} leaked into backup.storage`);
    }
    const json = JSON.stringify(backup);
    for (const secret of Object.values(SECRETS)) {
        assert.ok(!json.includes(secret), `credential value ${secret} leaked into the backup JSON`);
    }
});

test('restore leaves every stored credential untouched', async () => {
    seedStorage();
    const backup = await collectBackup({ includeSourceBytes: true });
    // Simulate restoring onto a machine that has credentials configured.
    await applyBackup(backup);
    for (const [k, v] of Object.entries(SECRETS)) {
        assert.equal(_stateStore.get(k), v, `${k} was clobbered by restore`);
    }
});

// ---- shareable copy -------------------------------------------------

test('shareable copy omits every identity key, keeps content, and is stamped', async () => {
    seedStorage();
    const backup = await collectBackup({ includeSourceBytes: true, shareable: true });
    assert.equal(backup.shareable, true, 'shareable stamp missing');
    for (const key of IDENTITY_STORAGE_KEYS) {
        assert.ok(!(key in backup.storage), `${key} leaked into the shareable copy`);
    }
    assert.ok('article_claims' in backup.storage, 'content missing from the shareable copy');
    const json = JSON.stringify(backup);
    assert.ok(!json.includes('nsec1SECRET'), 'an nsec leaked into the shareable JSON');
    assert.ok(!json.includes('a'.repeat(64)), 'a private key hex leaked into the shareable JSON');
});

test('restore REFUSES a shareable copy and touches nothing', async () => {
    seedStorage();
    const shareable = await collectBackup({ includeSourceBytes: true, shareable: true });
    const before = new Map(_stateStore);
    await assert.rejects(() => applyBackup(shareable), /shareable copy/i);
    assert.deepEqual(Object.fromEntries(_stateStore), Object.fromEntries(before),
        'a refused restore mutated storage');
});

test('merge ACCEPTS a shareable copy (its designed path in)', async () => {
    seedStorage();
    const shareable = await collectBackup({ includeSourceBytes: true, shareable: true });
    _stateStore.delete('article_claims');   // receiving side lacks the content
    const summary = await mergeBackup(shareable);
    assert.ok(summary.storage.keysAdded >= 1, 'shareable content did not merge');
    assert.ok(_stateStore.has('article_claims'), 'merged content missing');
});

// ---- version stamps + newer-than-understood refusal -----------------

test('backups are stamped with the producing version and per-database versions', async () => {
    seedStorage();
    const backup = await collectBackup({ includeSourceBytes: true });
    assert.equal(backup.xrayVersion, '88.0.0-test');
    for (const name of WORKSPACE_DATABASES) {
        assert.ok(Number.isInteger(backup.dbVersions[name]) && backup.dbVersions[name] >= 1,
            `dbVersions missing ${name}`);
    }
});

test('restore refuses a newer-than-understood database BEFORE any write', async () => {
    seedStorage();
    const backup = await collectBackup({ includeSourceBytes: true });
    backup.dbVersions['xray-audits'] = 9999;
    backup.storage.article_claims = JSON.stringify({ 'https://example.com/PLANTED': [] });
    const before = new Map(_stateStore);
    await assert.rejects(() => applyBackup(backup),
        /newer than this X-Ray understands/,
        'newer backup was not refused with the named message');
    assert.deepEqual(Object.fromEntries(_stateStore), Object.fromEntries(before),
        'the refused restore wrote storage before the version check');
});

test('merge refuses a newer-than-understood database the same way', async () => {
    seedStorage();
    const backup = await collectBackup({ includeSourceBytes: true });
    backup.dbVersions['xray-archive'] = 9999;
    await assert.rejects(() => mergeBackup(backup), /newer than this X-Ray understands/);
});

test('a pre-stamp backup (no dbVersions) still restores', async () => {
    seedStorage();
    const backup = await collectBackup({ includeSourceBytes: true });
    delete backup.dbVersions;
    delete backup.xrayVersion;
    await applyBackup(backup);   // must not throw
    assert.ok(_stateStore.has('article_claims'));
});

test('mergeBackup threads onProgress through to the database stage', () => {
    const src = read('src/shared/backup.js');
    assert.match(src, /mergeBackup\(backup, \{ warn = \(\) => \{\}, onProgress = \(\) => \{\} \}/,
        'mergeBackup does not accept onProgress');
    assert.match(src, /mergeIntoDatabase\(name, dump, \{ warn, onProgress \}\)/,
        'mergeBackup drops onProgress instead of threading it');
});

// ---- Options surfaces (source guards, the t1 idiom) -----------------

test('the token field is never populated from storage — presence-only', () => {
    const src = read('src/options/index.js');
    assert.ok(!/getElementById\('pref-transcriber-token'\)\.value = await/.test(src),
        'the companion token value is loaded into the DOM again');
    assert.match(src, /setKeyStatus\('transcriber-token-status'/,
        'token presence status missing');
    const html = read('src/options/options.html');
    assert.match(html, /id="transcriber-token-status"/);
    assert.match(html, /id="transcriber-token-clear"/);
});

test('restore/merge warn channels feed the report, not the console', () => {
    const src = read('src/options/index.js');
    const restore = src.slice(src.indexOf('async function backupRestoreFromFile'),
        src.indexOf('async function backupMergeFromFile'));
    const merge = src.slice(src.indexOf('async function backupMergeFromFile'),
        src.indexOf('function stashBackupReport'));
    assert.ok(!restore.includes('console.warn'), 'restore still warns to the console');
    assert.ok(!merge.includes('console.warn'), 'merge still warns to the console');
    // Restore ALWAYS reloads (stale forms would clobber restored
    // settings on Save) — its report must survive the reload via the
    // sessionStorage stash, re-rendered by init.
    assert.match(restore, /stashBackupReport\(/, 'restore does not stash its report across the reload');
    assert.match(src, /renderStashedBackupReport\(\)/, 'init never re-renders the stashed report');
    // Merge suppresses the reload whenever anything needs reading.
    assert.match(merge, /!held && !errs\.length && !warns\.length/);
    // Both failure paths own the persistent report — refusals carry
    // multi-sentence guidance that must not live in a 3s flash.
    assert.match(restore, /catch \(e\) \{[\s\S]*?renderBackupReport\(/, 'restore catch drops the report');
    assert.match(merge, /catch \(e\) \{[\s\S]*?renderBackupReport\(/, 'merge catch drops the report');
    // flash() must cancel its prior timer, or a slow step's stale
    // timer wipes the outcome message sub-second.
    assert.match(src, /_flashTimers/, 'flash() no longer cancels stale clear-timers');
});

// ---- identity-less files must not take identities down --------------

test('restoring a file with no signing identity preserves identities and config', async () => {
    seedStorage();
    const backup = await collectBackup({ includeSourceBytes: true });
    // Simulate the delete-workspace snapshot / a stripped-stamp key-free
    // copy: content only, no identity, no config.
    delete backup.storage.local_primary_identity;
    delete backup.storage.identity_profiles;
    delete backup.storage.preferences;
    delete backup.shareable;
    const liveIdentity = _stateStore.get('local_primary_identity');
    const livePrefs = _stateStore.get('preferences');
    const warns = [];
    await applyBackup(backup, { warn: (m) => warns.push(m) });
    assert.equal(_stateStore.get('local_primary_identity'), liveIdentity,
        'an identity-less file erased the primary identity');
    assert.equal(_stateStore.get('preferences'), livePrefs,
        'an identity-less file erased install config');
    assert.ok(_stateStore.has('article_claims'), 'content was not restored');
    assert.ok(warns.some((w) => /no signing identity/.test(w)),
        'the scope narrowing was not reported through the warn channel');
});

test('a smuggled credential in an old backup is dropped WITH a named warn', async () => {
    seedStorage();
    const backup = await collectBackup({ includeSourceBytes: true });
    // Pre-B4 backups legitimately carried these.
    backup.storage[ASSEMBLYAI_KEY_STORAGE] = 'aai-OLD-BACKUP-key';
    const warns = [];
    await applyBackup(backup, { warn: (m) => warns.push(m) });
    assert.ok(!_stateStore.has(ASSEMBLYAI_KEY_STORAGE) || _stateStore.get(ASSEMBLYAI_KEY_STORAGE) === SECRETS[ASSEMBLYAI_KEY_STORAGE],
        'the smuggled credential was written');
    assert.ok(warns.some((w) => /credential/.test(w)),
        'the credential drop was silent');
});

test('the shareable export button exists and is wired', () => {
    const html = read('src/options/options.html');
    assert.match(html, /id="backup-download-shareable"/);
    const src = read('src/options/index.js');
    assert.match(src, /backup-download-shareable'\)\.addEventListener\('click', backupDownloadShareable\)/);
    assert.match(src, /shareable: true/);
});
