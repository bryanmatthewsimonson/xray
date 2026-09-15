// The capture→publish session records leak — field-found 2026-08-25.
//
// Every capture writes `xray:article:<id>` into chrome.storage.session
// (the reader + the publish flow look the capture up by id), and
// NOTHING ever removed one. chrome.storage.session holds ~10MB; a heavy
// casework day (transcripts, an EPUB, court PDFs) fills it, after which
// EVERY new capture fails to register — "publish will fail until the
// browser is restarted". The record must outlive the reader tab's reads
// (reload and sign-time both re-read it), so the fix is quota-triggered
// EVICTION, oldest-first, never the newest few — not delete-on-read.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { putSessionArticle, KEEP_NEWEST } = await import('../src/shared/session-articles.js');

/** A storage-area stub: fails set() with a quota error until `evicted`
 *  frees enough entries, tracks every call. */
function stubArea({ existing = {}, failSets = 1 } = {}) {
    const store = { ...existing };
    let failuresLeft = failSets;
    const calls = { sets: [], removes: [] };
    return {
        store, calls,
        get(keys, cb) {
            if (keys === null) { cb({ ...store }); return; }
            const out = {};
            for (const k of [].concat(keys)) if (k in store) out[k] = store[k];
            cb(out);
        },
        set(obj, cb) {
            calls.sets.push(Object.keys(obj));
            if (failuresLeft > 0) {
                failuresLeft -= 1;
                globalThis.chrome.runtime.lastError = { message: 'Session storage quota bytes exceeded. Values were not stored.' };
                cb();
                globalThis.chrome.runtime.lastError = null;
                return;
            }
            Object.assign(store, obj);
            cb();
        },
        remove(keys, cb) {
            calls.removes.push([].concat(keys));
            for (const k of [].concat(keys)) delete store[k];
            cb && cb();
        }
    };
}
globalThis.chrome = globalThis.chrome || { runtime: { lastError: null } };

const rec = (createdAt) => ({ article: { title: 't' }, sourceTabId: null, createdAt });

test('happy path: one set, no reads, no evictions', async () => {
    const area = stubArea({ failSets: 0 });
    const out = await putSessionArticle(area, 'xray:article:new', rec(1000));
    assert.equal(out.ok, true);
    assert.equal(area.calls.sets.length, 1);
    assert.equal(area.calls.removes.length, 0);
});

test('quota failure evicts the OLDEST records and retries once — the capture registers', async () => {
    const existing = {};
    for (let i = 0; i < 12; i++) existing[`xray:article:old${i}`] = rec(i * 1000);
    existing['unrelated:key'] = { keep: true };
    const area = stubArea({ existing, failSets: 1 });
    const out = await putSessionArticle(area, 'xray:article:new', rec(99000));
    assert.equal(out.ok, true, 'the write must succeed after eviction');
    assert.equal(out.evicted.length > 0, true);
    // Oldest evicted first…
    assert.ok(out.evicted.includes('xray:article:old0'));
    // …the newest KEEP_NEWEST survive…
    const survivors = Object.keys(area.store).filter((k) => k.startsWith('xray:article:old'));
    assert.ok(survivors.length >= KEEP_NEWEST, `the newest ${KEEP_NEWEST} must never be evicted`);
    assert.ok(survivors.includes('xray:article:old11'), 'the newest existing record survives');
    // …and other namespaces are untouched (the lens session cache lives here too).
    assert.ok('unrelated:key' in area.store, 'eviction must not leave the xray:article: namespace');
    assert.equal(area.calls.sets.length, 2, 'exactly one retry');
});

test('still failing after eviction: honest error, no retry loop', async () => {
    const existing = {};
    for (let i = 0; i < 10; i++) existing[`xray:article:old${i}`] = rec(i);
    const area = stubArea({ existing, failSets: 5 });
    const out = await putSessionArticle(area, 'xray:article:new', rec(99));
    assert.equal(out.ok, false);
    assert.match(out.error, /quota/i);
    assert.equal(area.calls.sets.length, 2, 'one attempt + one retry, never a loop');
});

test('nothing evictable (only the protected newest exist): honest failure, no useless retry', async () => {
    const area = stubArea({ existing: { 'xray:article:a': rec(1) }, failSets: 5 });
    const out = await putSessionArticle(area, 'xray:article:new', rec(2));
    assert.equal(out.ok, false);
    assert.equal(area.calls.sets.length, 1, 'no retry when eviction freed nothing');
    assert.equal(area.calls.removes.length, 0);
});

test('a non-quota set error does not trigger eviction — it is not a space problem', async () => {
    const area = stubArea({ existing: { 'xray:article:a': rec(1) }, failSets: 1 });
    // Rewrite the stub's failure message for this case.
    const origSet = area.set.bind(area);
    area.set = (obj, cb) => {
        area.calls.sets.push(Object.keys(obj));
        globalThis.chrome.runtime.lastError = { message: 'An unexpected error occurred' };
        cb();
        globalThis.chrome.runtime.lastError = null;
    };
    const out = await putSessionArticle(area, 'xray:article:new', rec(2));
    assert.equal(out.ok, false);
    assert.equal(area.calls.removes.length, 0, 'no eviction on a non-quota failure');
    void origSet;
});

test('SEAM: both write sites route through the helper', async () => {
    const { readFileSync } = await import('node:fs');
    const strip = (x) => x.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const bg = strip(readFileSync(new URL('../src/background/index.js', import.meta.url), 'utf8'));
    const reader = strip(readFileSync(new URL('../src/reader/index.js', import.meta.url), 'utf8'));
    assert.match(bg, /putSessionArticle\(/, 'the capture handler must use the evicting write');
    assert.match(reader, /putSessionArticle\(/, 'the PDF registration must use the evicting write');
    // The raw leak shape must not survive at either site: a bare
    // area.set of an xray:article: key.
    for (const [name, src] of [['background', bg], ['reader', reader]]) {
        assert.ok(!/area\.set\(\{ \['xray:article:'/.test(src), `${name} still writes the record without eviction`);
    }
});
