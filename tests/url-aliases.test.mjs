// URL alias layer (url-aliases.js). Load-bearing pins: resolution is
// idempotent (non-aliases come back unchanged), writes flatten chains
// so lookups stay one hop, cycles are refused, and both ends go
// through the unified normalizer.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// storage.js touches chrome.storage at module load; stub it first.
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
    }
};

const { recordAlias, resolveAlias, loadAliasMap, resolveWithMap } =
    await import('../src/shared/url-aliases.js');
const { Utils } = await import('../src/shared/utils.js');

function resetState() { _stateStore.clear(); }

const ORIGINAL = 'https://example.com/story';
const MIRROR   = 'https://archive.ph/AbC12';
const MIRROR2  = 'https://12ft.io/proxy?q=https://example.com/story-alt';

test('resolveAlias is idempotent: a URL nobody aliased comes back as itself', async () => {
    resetState();
    assert.equal(await resolveAlias(ORIGINAL), Utils.normalizeUrl(ORIGINAL));
    assert.equal(await resolveAlias(''), '');
});

test('recordAlias + resolveAlias: basic round trip, normalized both ends', async () => {
    resetState();
    assert.equal(await recordAlias(MIRROR, ORIGINAL), true);
    assert.equal(await resolveAlias(MIRROR), Utils.normalizeUrl(ORIGINAL));
    // A differently-written form of the same alias resolves too — the
    // unified normalizer keys the map.
    assert.equal(await resolveAlias('https://archive.ph/AbC12#frag'),
        Utils.normalizeUrl(ORIGINAL));
});

test('self-aliases and invalid URLs are no-ops', async () => {
    resetState();
    assert.equal(await recordAlias(ORIGINAL, ORIGINAL), false);
    assert.equal(await recordAlias('', ORIGINAL), false);
    assert.equal(await recordAlias(MIRROR, ''), false);
    assert.deepEqual(await loadAliasMap(), {});
});

test('writes flatten chains: lookups stay one hop', async () => {
    resetState();
    // B → C first, then A → B: A must store C directly.
    await recordAlias(MIRROR, ORIGINAL);              // B → C
    await recordAlias(MIRROR2, MIRROR);               // A → B (flattens to C)
    const map = await loadAliasMap();
    assert.equal(map[Utils.normalizeUrl(MIRROR2)], Utils.normalizeUrl(ORIGINAL));
    assert.equal(await resolveAlias(MIRROR2), Utils.normalizeUrl(ORIGINAL));
});

test('re-pointing: aliasing an existing target re-points its dependents', async () => {
    resetState();
    // A → B, then B itself turns out to be an alias of C.
    await recordAlias(MIRROR2, MIRROR);               // A → B
    await recordAlias(MIRROR, ORIGINAL);              // B → C
    const map = await loadAliasMap();
    assert.equal(map[Utils.normalizeUrl(MIRROR2)], Utils.normalizeUrl(ORIGINAL), 'A re-pointed to C');
    assert.equal(map[Utils.normalizeUrl(MIRROR)], Utils.normalizeUrl(ORIGINAL));
});

test('cycles are refused', async () => {
    resetState();
    await recordAlias(MIRROR, ORIGINAL);              // B → C
    assert.equal(await recordAlias(ORIGINAL, MIRROR), false, 'C → B would cycle');
    // The map is unchanged and resolution still terminates.
    assert.equal(await resolveAlias(MIRROR), Utils.normalizeUrl(ORIGINAL));
    assert.equal(await resolveAlias(ORIGINAL), Utils.normalizeUrl(ORIGINAL));
});

test('resolveWithMap survives a hand-corrupted cyclic map', () => {
    const a = Utils.normalizeUrl('https://a.example/x');
    const b = Utils.normalizeUrl('https://b.example/y');
    const cyclic = { [a]: b, [b]: a };
    assert.equal(resolveWithMap(cyclic, a), b, 'terminates, one hop wins');
});
