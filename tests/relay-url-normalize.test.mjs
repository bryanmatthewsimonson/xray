// normalizeRelayUrl + deserializeEntityFromSync tolerance tests.
//
// These two functions are the unsung heroes of cross-browser sync —
// the fixes that landed on 2026-04-22 made userscript history
// importable and stopped the relay-adoption prompt from suggesting
// dupes. Without unit coverage they're easy to regress with a
// well-meaning "tighten the validator" change.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// Same chrome.storage.local shim that other entity-sync tests use —
// entity-sync.js imports Storage which expects chrome.storage to
// exist at import time.
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
            set(obj, cb) { for (const [k, v] of Object.entries(obj)) _stateStore.set(k, v); cb && cb(); },
            remove(keys, cb) { for (const k of Array.isArray(keys) ? keys : [keys]) _stateStore.delete(k); cb && cb(); }
        }
    }
};

const { normalizeRelayUrl, deserializeEntityFromSync } = await import('../src/shared/entity-sync.js');

test('normalizeRelayUrl strips a trailing slash', () => {
    assert.equal(normalizeRelayUrl('wss://relay.example.com/'), 'wss://relay.example.com');
    assert.equal(normalizeRelayUrl('wss://relay.example.com'), 'wss://relay.example.com');
});

test('normalizeRelayUrl lowercases scheme + host', () => {
    assert.equal(normalizeRelayUrl('WSS://Relay.Example.COM/'), 'wss://relay.example.com');
});

test('normalizeRelayUrl trims surrounding whitespace', () => {
    assert.equal(normalizeRelayUrl('  wss://r.example  '), 'wss://r.example');
});

test('normalizeRelayUrl preserves path and port', () => {
    assert.equal(normalizeRelayUrl('wss://r.example:7777/relay'), 'wss://r.example:7777/relay');
});

test('normalizeRelayUrl returns empty string for non-string input', () => {
    assert.equal(normalizeRelayUrl(null), '');
    assert.equal(normalizeRelayUrl(undefined), '');
    assert.equal(normalizeRelayUrl(42), '');
});

test('normalizeRelayUrl makes trailing-slash variants compare equal', () => {
    // The exact dedup case that bit us: Edge had `wss://nos.lol`,
    // Firefox pushed `wss://nos.lol/`, both should hash to the same
    // Set member.
    const a = normalizeRelayUrl('wss://nos.lol');
    const b = normalizeRelayUrl('wss://nos.lol/');
    assert.equal(a, b);
    assert.ok(new Set([a, b]).size === 1);
});

test('deserializeEntityFromSync accepts X-Ray-shaped payload (16-char id, privateKey)', () => {
    const payload = JSON.stringify({
        id: 'entity_1234567890abcdef',
        name: 'Alice',
        type: 'person',
        keypair: {
            privateKey: 'a'.repeat(64),
            pubkey:     'b'.repeat(64)
        }
    });
    const out = deserializeEntityFromSync(payload);
    assert.ok(out, 'must accept X-Ray shape');
    assert.equal(out.keypair.privateKey, 'a'.repeat(64));
});

test('deserializeEntityFromSync accepts userscript-shaped payload (64-char id, privkey)', () => {
    const payload = JSON.stringify({
        id: 'entity_' + 'c'.repeat(64),
        name: 'Bob',
        type: 'person',
        keypair: {
            privkey: 'd'.repeat(64),
            pubkey:  'e'.repeat(64)
        }
    });
    const out = deserializeEntityFromSync(payload);
    assert.ok(out, 'must accept userscript shape');
    // Must normalize `privkey` to `privateKey` on the way out so
    // downstream X-Ray code only sees one field name.
    assert.equal(out.keypair.privateKey, 'd'.repeat(64));
    assert.equal(out.keypair.privkey, undefined,
        'userscript-only field name must be normalized away');
});

test('deserializeEntityFromSync rejects malformed input', () => {
    assert.equal(deserializeEntityFromSync('not json'), null);
    assert.equal(deserializeEntityFromSync('null'), null);
    assert.equal(deserializeEntityFromSync('"a string"'), null);
    assert.equal(deserializeEntityFromSync(JSON.stringify({})), null);
    assert.equal(deserializeEntityFromSync(JSON.stringify({
        id: 'not_an_entity_id', name: 'X', type: 'person',
        keypair: { privateKey: 'a'.repeat(64), pubkey: 'b'.repeat(64) }
    })), null);
    assert.equal(deserializeEntityFromSync(JSON.stringify({
        id: 'entity_1234567890abcdef', name: 'X', type: 'person',
        keypair: { pubkey: 'b'.repeat(64) }   // missing privkey/privateKey
    })), null);
});
