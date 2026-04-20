// NIP-44 v2 (ChaCha20 + HMAC-SHA256 + padding) tests.
// Exercises the real `Crypto.nip44Encrypt` / `Crypto.nip44Decrypt` from
// src/shared/crypto.js — not a parallel implementation. The goal is to
// catch regressions if we ever re-port crypto.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Crypto } from '../src/shared/crypto.js';

// Two fixed keys for deterministic tests. These aren't real user keys.
const ALICE = '0000000000000000000000000000000000000000000000000000000000000002';
const BOB   = '0000000000000000000000000000000000000000000000000000000000000003';

test('nip44: conversation key is symmetric between Alice↔Bob', async () => {
    const alicePub = Crypto.getPublicKey(ALICE);
    const bobPub   = Crypto.getPublicKey(BOB);

    const ab = await Crypto.nip44GetConversationKey(ALICE, bobPub);
    const ba = await Crypto.nip44GetConversationKey(BOB, alicePub);

    assert.deepEqual(Array.from(ab), Array.from(ba));
    assert.equal(ab.length, 32);
});

test('nip44: encrypt → decrypt round-trips plaintext', async () => {
    const alicePub = Crypto.getPublicKey(ALICE);
    const conv = await Crypto.nip44GetConversationKey(ALICE, alicePub); // encrypt-to-self

    const plaintexts = [
        'a',
        'Hello, NIP-44!',
        'A moderately long message that straddles a pad boundary: ' + 'x'.repeat(200),
        'Unicode roundtrip: π λ 🎉 漢字 emoji emojiemoji',
        'Edge: a single character'
    ];
    for (const plain of plaintexts) {
        const payload = await Crypto.nip44Encrypt(plain, conv);
        const decoded = await Crypto.nip44Decrypt(payload, conv);
        assert.equal(decoded, plain);
    }
});

test('nip44: HMAC tamper detection', async () => {
    const alicePub = Crypto.getPublicKey(ALICE);
    const conv = await Crypto.nip44GetConversationKey(ALICE, alicePub);

    const payload = await Crypto.nip44Encrypt('Sensitive data', conv);
    // Flip a byte near the middle of the ciphertext portion.
    const raw = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
    raw[40] ^= 0xff;
    let tampered = '';
    for (const b of raw) tampered += String.fromCharCode(b);
    const tamperedB64 = btoa(tampered);

    await assert.rejects(() => Crypto.nip44Decrypt(tamperedB64, conv), /HMAC/);
});

test('nip44: wrong version byte is rejected', async () => {
    const alicePub = Crypto.getPublicKey(ALICE);
    const conv = await Crypto.nip44GetConversationKey(ALICE, alicePub);

    const payload = await Crypto.nip44Encrypt('hi', conv);
    const raw = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
    raw[0] = 0x01; // valid NIP-44 is 0x02
    let tampered = '';
    for (const b of raw) tampered += String.fromCharCode(b);
    await assert.rejects(
        () => Crypto.nip44Decrypt(btoa(tampered), conv),
        /Unsupported NIP-44 version/
    );
});

test('nip44: Alice can decrypt what Bob sent her', async () => {
    const alicePub = Crypto.getPublicKey(ALICE);
    const bobPub   = Crypto.getPublicKey(BOB);

    const bobsView   = await Crypto.nip44GetConversationKey(BOB,   alicePub);
    const alicesView = await Crypto.nip44GetConversationKey(ALICE, bobPub);

    const payload = await Crypto.nip44Encrypt('Meet me at midnight', bobsView);
    const decoded = await Crypto.nip44Decrypt(payload, alicesView);
    assert.equal(decoded, 'Meet me at midnight');
});
