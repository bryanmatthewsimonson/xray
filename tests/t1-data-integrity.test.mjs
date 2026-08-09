// T1 — "stop the bleeding" regressions (docs/ROAD_TO_1_0.md B1-B4).
//
// Each of these observes a defect that shipped and that no existing test
// could see: a capture deleting an earlier capture, a publish surface
// reporting success no relay gave, and a merge installing a colleague's
// private keys while the dialog promised it would not.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8');

// ---- B1: capturing must never delete an earlier capture -------------

test('B1: saveArticle does not run eviction', () => {
    const src = read('src', 'shared', 'archive-cache.js');
    const save = src.slice(src.indexOf('export async function saveArticle'),
        src.indexOf('export async function getArticle'));
    assert.ok(save.length > 0, 'found saveArticle');
    assert.doesNotMatch(save, /evictIfNeeded\s*\(/,
        'saveArticle must not evict — a capture destroying an earlier one is silent corpus loss');
});

test('B1: nothing on any write path calls evictIfNeeded', () => {
    const src = read('src', 'shared', 'archive-cache.js');
    // The function may still exist (deliberate, explicit use later), but
    // must have no caller inside this module.
    const calls = src.match(/^\s*evictIfNeeded\s*\(/gm) || [];
    assert.equal(calls.length, 0, 'evictIfNeeded has no automatic caller');
});

test('B1: the unlimitedStorage the cache assumes is actually requested', () => {
    const manifest = JSON.parse(read('manifest.json'));
    assert.ok(manifest.permissions.includes('unlimitedStorage'),
        'archive-cache reasons about storage headroom; the permission must be real');
});

// ---- B2: resolving is not acceptance --------------------------------

// gatePublish returns confirmedOk precisely so call sites need not
// re-derive it. Reading bare `ok` is how "Published — readable in any
// NOSTR client" came to be printed, and a durable publishedAt written,
// when zero relays confirmed (JOURNAL 2026-08-02, the MA.6 walk).
const PUBLISH_SURFACES = [
    ['src', 'portal', 'entity-page-block.js'],
    ['src', 'portal', 'synthesis-block.js'],
    ['src', 'portal', 'inspector.js'],
    ['src', 'portal', 'extraction-block.js'],
];

for (const parts of PUBLISH_SURFACES) {
    test(`B2: ${parts[parts.length - 1]} reads confirmedOk, not bare ok`, () => {
        const src = read(...parts);
        assert.match(src, /confirmedOk/,
            'a surface calling gatePublish must consult confirmedOk');
        assert.doesNotMatch(src, /ok:\s*true,\s*results:\s*gated\.results/,
            'hardcoding ok:true from a resolved gatePublish is the false-published-stamp defect');
    });
}

// ---- B3: a merge must not install someone else's keys ---------------

test('B3: local_keys is excluded from merge accrual', () => {
    const src = read('src', 'shared', 'backup.js');
    assert.match(src, /MERGE_EXCLUDED_KEYS/, 'the merge exclusion set exists');
    assert.match(src, /MERGE_EXCLUDED_KEYS\s*=\s*new Set\(\[[^\]]*'local_keys'/,
        'local_keys is in it — merging a colleague file must not install their signing keys');
    assert.match(src, /MERGE_EXCLUDED_KEYS\.has\(k\)/,
        'and the merge path actually consults it');
});

test('B3: local_keys stays workspace content for backup and restore', () => {
    // The fix must not go too far: restoring YOUR OWN backup has to
    // bring your entity keys back.
    const keys = read('src', 'shared', 'workspace-keys.js');
    assert.match(keys, /'local_keys'/,
        'local_keys remains workspace content — only MERGE accrual is blocked');
});

test('B3: the Options promise about identities is now true', () => {
    const html = read('src', 'options', 'options.html');
    assert.match(html, /settings\/identities in the file are ignored/,
        'the dialog states it; the merge exclusion is what makes it honest');
});

// ---- B4: a credential field must not display its secret -------------

test('B4: the companion auth token field is not a cleartext input', () => {
    const html = read('src', 'options', 'options.html');
    const field = html.slice(html.indexOf('id="pref-transcriber-token"') - 200,
        html.indexOf('id="pref-transcriber-token"') + 80);
    assert.match(field, /type="password"/,
        'it is populated from storage on every load, so type=text renders the secret on screen');
});
