// portal/publish-history.js — the case's own publish record, read from
// the signed-event journal (JOURNAL 2026-10-01): which keys signed this
// case's events, and which relays CONFIRMED them. Pure helpers here;
// the resolveIdentities seam over the real journal lives in
// portal-identity-journal.test.mjs.
//
// Provenance: INTERPRETATION (2026-10-01) — expires 2026-12-30

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// storage.js (reached through identity-strip.js → case-membership.js)
// binds chrome.storage.local at import time.
globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(k, cb) { cb({}); }, set(o, cb) { cb && cb(); }, remove(k, cb) { cb && cb(); } } }
};

const {
    relayReadUrl, summarizeJournal, rankHistoryRelays, extraReadRelays,
    loadJournalRows, HISTORY_RELAY_CAP
} = await import('../src/portal/publish-history.js');

const ME = 'a'.repeat(64);
const OLD = 'b'.repeat(64);
const ENTITY = 'e'.repeat(64);

const row = (kind, pubkey, relays) => ({ kind, pubkey, relays });
const ok = (url) => ({ url, success: true, assumed: false });
const assumed = (url) => ({ url, success: true, assumed: true });
const failed = (url) => ({ url, success: false, assumed: false });

test('relayReadUrl: wss normalized to one spelling; plaintext, LAN and junk refused', () => {
    assert.equal(relayReadUrl('wss://relay.primal.net'), 'wss://relay.primal.net');
    assert.equal(relayReadUrl(' wss://Relay.Primal.NET/ '), 'wss://relay.primal.net', 'case and trailing slash fold');
    assert.equal(relayReadUrl('wss://relay.example.com/inbox/'), 'wss://relay.example.com/inbox');
    assert.equal(relayReadUrl('ws://localhost:7777'), 'ws://localhost:7777', 'a local relay is fine');
    assert.equal(relayReadUrl('ws://127.0.0.1:7777/'), 'ws://127.0.0.1:7777');
    assert.equal(relayReadUrl('ws://relay.example.com'), null, 'plaintext off-box is refused');
    assert.equal(relayReadUrl('ws://192.168.1.5:7777'), null, 'a LAN socket is refused');
    assert.equal(relayReadUrl('https://relay.example.com'), null);
    assert.equal(relayReadUrl('wss://user:pw@relay.example.com'), null, 'no credentials in a read URL');
    for (const junk of ['', 'relay.example.com', 'javascript:alert(1)', null, 42, undefined]) {
        assert.equal(relayReadUrl(junk), null, `junk: ${String(junk)}`);
    }
});

test('summarizeJournal: operator kinds only, CONFIRMED relays only', () => {
    const s = summarizeJournal([
        row(30023, ME, [ok('wss://relay.primal.net'), assumed('wss://relay.damus.io'), failed('wss://nos.lol')]),
        row(30040, ME.toUpperCase(), [ok('wss://relay.primal.net/')]),
        row(0, ENTITY, [ok('wss://entity-only.example')]),      // entity kind-0: an ENTITY key signs it
        row(1, ENTITY, [ok('wss://entity-only.example')]),      // mention note: an ENTITY key signs it
        row(30023, 'not-a-key', [ok('wss://x.example')]),
        row(30055, OLD, [ok('ws://relay.example.com')]),        // plaintext: never read from
        null, {}, row(30023, ME, 'not-an-array')
    ]);
    assert.deepEqual([...s.keys()].sort(), [ME, OLD]);
    assert.equal(s.get(ME).count, 3, 'three operator-kind rows signed by ME (pubkey case folded)');
    assert.deepEqual([...s.get(ME).relays], [['wss://relay.primal.net', 2]],
        'assumed and failed attempts are no evidence; spellings fold');
    assert.equal(s.get(OLD).count, 1);
    assert.equal(s.get(OLD).relays.size, 0);
    assert.equal(summarizeJournal(undefined).size, 0);
});

test('rankHistoryRelays: only the given signers, most confirmations first, ties by URL', () => {
    const s = summarizeJournal([
        row(30023, ME, [ok('wss://b.example'), ok('wss://a.example')]),
        row(30040, ME, [ok('wss://b.example')]),
        row(30040, OLD, [ok('wss://c.example'), ok('wss://C.example/')]),   // one event: counts once
        row(30040, 'f'.repeat(64), [ok('wss://collaborator.example')])
    ]);
    assert.deepEqual(rankHistoryRelays(s, [ME, OLD]), ['wss://b.example', 'wss://a.example', 'wss://c.example']);
    assert.deepEqual(rankHistoryRelays(s, [ME]), ['wss://b.example', 'wss://a.example']);
    assert.deepEqual(rankHistoryRelays(s, []), []);
    assert.ok(!rankHistoryRelays(s, [ME, OLD]).includes('wss://collaborator.example'),
        'a signer outside the set contributes no relay');
});

test('extraReadRelays: appends what Settings lacks, never drops or reorders configured, capped', () => {
    const configured = ['wss://Relay.Primal.net/', 'ws://192.168.1.5:7777'];
    const ranked = ['wss://relay.primal.net', 'wss://nostr.oxtr.dev', 'wss://nostr.oxtr.dev', 'wss://relay.nostr.net'];
    assert.deepEqual(extraReadRelays(configured, ranked), ['wss://nostr.oxtr.dev', 'wss://relay.nostr.net'],
        'a configured relay is not repeated under another spelling; duplicates collapse');
    const many = Array.from({ length: 20 }, (_, i) => `wss://r${String(i).padStart(2, '0')}.example`);
    assert.equal(extraReadRelays([], many).length, HISTORY_RELAY_CAP);
    assert.deepEqual(extraReadRelays([], many, 2), ['wss://r00.example', 'wss://r01.example'], 'rank order kept');
    assert.deepEqual(extraReadRelays(undefined, undefined), []);
});

test('loadJournalRows never throws: an unreadable journal is an empty history', async () => {
    assert.deepEqual(await loadJournalRows(async () => { throw new Error('IndexedDB is not available'); }), []);
    assert.deepEqual(await loadJournalRows(async () => null), []);
    const rows = [row(30023, ME, [])];
    assert.deepEqual(await loadJournalRows(async () => rows), rows);
});

// ------------------------------------------------------------------
// Seams in the DOM-bound portal files (source guards — index.js and
// identity-strip.js are not importable without a page).
// ------------------------------------------------------------------

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

test('SEAM: the corpus is fetched from the read relays, which carry the history relays; publishing stays on Settings', () => {
    const src = read('src/portal/index.js');
    const calls = [...src.matchAll(/fetchCorpus\(\{([\s\S]*?)\}\);/g)].map((m) => m[1]);
    assert.ok(calls.length >= 1, 'sanity: index.js fetches the corpus');
    for (const args of calls) {
        assert.match(args, /relays:\s*state\.readRelays\b/, 'every corpus fetch reads state.readRelays');
    }
    assert.match(src, /state\.historyRelays\s*=\s*extraReadRelays\(state\.relays,\s*historyRelays\)/,
        'the history relays come from resolveIdentities via extraReadRelays');
    assert.match(src, /state\.readRelays\s*=\s*\[\.\.\.state\.relays,\s*\.\.\.state\.historyRelays\]/,
        'read relays = configured, then history');
    assert.match(src, /const relaysKey = \[\.\.\.state\.readRelays\]/,
        'the sync cursor is keyed on the relays actually read — a new history relay forces a full fetch');
    assert.match(src, /rebroadcastEvent\(state\.relays,/,
        'rebroadcast re-sends to the CONFIGURED relays, never to history-only ones');
});

test('SEAM: every identity source identity.js can emit has a plain-words chip label', async () => {
    const src = read('src/portal/identity.js');
    // add(<expr with at most one level of calls>, '<token>')
    const tokens = new Set([...src.matchAll(/\badd\((?:[^()]|\([^()]*\))*,\s*'([a-z-]+)'\)/g)].map((m) => m[1]));
    assert.ok(tokens.has('signer') && tokens.has('journal') && tokens.has('case-identity'),
        `sanity: the scanner sees the add() sites (${[...tokens]})`);
    const { IDENTITY_SOURCE_LABELS } = await import('../src/portal/identity-strip.js');
    for (const t of tokens) {
        assert.ok(IDENTITY_SOURCE_LABELS[t], `source '${t}' would render as its raw token — give it a label`);
    }
});
