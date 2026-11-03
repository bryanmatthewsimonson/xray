// Page notes — local personal notes (inline overlay phase 1).

import { test } from 'node:test';
import assert from 'node:assert/strict';

const _stateStore = new Map();
globalThis.chrome = {
    storage: {
        local: {
            get(keys, cb) {
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

const { PageNotes } = await import('../src/shared/page-notes.js');
const { WORKSPACE_CONTENT_KEYS } = await import('../src/shared/workspace-keys.js');

const URL_A = 'https://example.com/article-a';

test('page_notes is workspace content (backed up, cleared on reset)', () => {
    assert.ok(WORKSPACE_CONTENT_KEYS.includes('page_notes'));
});

test('save creates a note with pn_ id, trimmed text, timestamps', async () => {
    _stateStore.clear();
    const n = await PageNotes.save({ url: URL_A, quote: 'a passage', text: '  my thought  ' });
    assert.match(n.id, /^pn_[0-9a-f]{16}$/);
    assert.equal(n.text, 'my thought');
    assert.equal(n.quote, 'a passage');
    assert.equal(n.anchor, null);
    assert.equal(n.seconds, null);
    assert.equal(typeof n.created, 'number');
    assert.equal(n.created, n.updated);
    assert.deepEqual(await PageNotes.list(), [n]);
});

test('save with an existing id updates in place and keeps created', async () => {
    _stateStore.clear();
    const n = await PageNotes.save({ url: URL_A, text: 'one', seconds: 12 });
    await new Promise((r) => setTimeout(r, 5));
    const m = await PageNotes.save({ id: n.id, url: URL_A, text: 'two', seconds: 12 });
    assert.equal(m.id, n.id);
    assert.equal(m.created, n.created);
    assert.ok(m.updated > n.updated);
    const all = await PageNotes.list();
    assert.equal(all.length, 1);
    assert.equal(all[0].text, 'two');
});

test('forUrl matches across tracking params and trailing slash', async () => {
    _stateStore.clear();
    await PageNotes.save({ url: URL_A + '/?utm_source=x', text: 'on A' });
    await PageNotes.save({ url: 'https://example.com/other', text: 'on other' });
    const got = await PageNotes.forUrl(URL_A + '?utm_campaign=y&fbclid=z');
    assert.equal(got.length, 1);
    assert.equal(got[0].text, 'on A');
    assert.equal(got[0].url, URL_A, 'stored normalized');
});

test('save rejects empty, whitespace-only, and oversize text', async () => {
    _stateStore.clear();
    await assert.rejects(PageNotes.save({ url: URL_A, text: '' }));
    await assert.rejects(PageNotes.save({ url: URL_A, text: '   \n ' }));
    await assert.rejects(PageNotes.save({ url: URL_A }));
    await assert.rejects(PageNotes.save({ url: URL_A, text: 'x'.repeat(10001) }));
    const ok = await PageNotes.save({ url: URL_A, text: 'x'.repeat(10000) });
    assert.equal(ok.text.length, 10000);
    assert.equal((await PageNotes.list()).length, 1, 'rejected saves wrote nothing');
});

test('remove deletes by id and is a no-op for unknown ids', async () => {
    _stateStore.clear();
    const a = await PageNotes.save({ url: URL_A, text: 'a' });
    const b = await PageNotes.save({ url: URL_A, text: 'b' });
    await PageNotes.remove('pn_doesnotexist0000');
    assert.equal((await PageNotes.list()).length, 2);
    await PageNotes.remove(a.id);
    assert.deepEqual((await PageNotes.list()).map((n) => n.id), [b.id]);
});
