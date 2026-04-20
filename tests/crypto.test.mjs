// Crypto module tests — ported from the userscript's tests/crypto-tests.js.
// Runs under Node's built-in `--test` runner. Node 20+ has globalThis.crypto
// populated with WebCrypto, so `src/shared/crypto.js` works unchanged.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Crypto } from '../src/shared/crypto.js';

// BIP-340 canonical test vectors (a small, well-known subset).
// Full BIP-340 vectors live in the BIP repo; the userscript's test file
// uses these three as baseline sanity checks.
const TV1_PRIV = '0000000000000000000000000000000000000000000000000000000000000001';
const TV1_EXPECTED = '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'; // G.x
const TV2_PRIV = '0000000000000000000000000000000000000000000000000000000000000003';
const TV2_EXPECTED = 'f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9';
const TV3_PRIV = '0000000000000000000000000000000000000000000000000000000000000002';
const TV3_EXPECTED = 'c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5';

test('1. key generation', async () => {
    const priv = Crypto.generatePrivateKey();
    assert.equal(priv.length, 64);
    assert.match(priv, /^[0-9a-f]{64}$/);

    const pub = Crypto.getPublicKey(priv);
    assert.equal(pub.length, 64);
    assert.match(pub, /^[0-9a-f]{64}$/);

    // Deterministic derivation
    assert.equal(Crypto.getPublicKey(priv), pub);

    // Different inputs → different outputs
    const priv2 = Crypto.generatePrivateKey();
    assert.notEqual(priv, priv2);
    assert.notEqual(Crypto.getPublicKey(priv2), pub);
});

test('2. public-key derivation — BIP-340 vectors', async () => {
    assert.equal(Crypto.getPublicKey(TV1_PRIV), TV1_EXPECTED);
    assert.equal(Crypto.getPublicKey(TV2_PRIV), TV2_EXPECTED);
    assert.equal(Crypto.getPublicKey(TV3_PRIV), TV3_EXPECTED);

    // privkey = 0 must throw
    assert.throws(() => Crypto.getPublicKey('0'.repeat(64)), /out of range/);

    // privkey = N (curve order) must throw
    assert.throws(
        () => Crypto.getPublicKey('fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141'),
        /out of range/
    );
});

test('3. bech32 npub/nsec encoding', async () => {
    const npub = Crypto.hexToNpub(TV1_EXPECTED);
    assert.ok(npub);
    assert.ok(npub.startsWith('npub1'));

    const nsec = Crypto.hexToNsec(TV1_PRIV);
    assert.ok(nsec);
    assert.ok(nsec.startsWith('nsec1'));

    // Round-trips
    assert.equal(Crypto.npubToHex(npub), TV1_EXPECTED);
    assert.equal(Crypto.nsecToHex(nsec), TV1_PRIV);

    const npub2 = Crypto.hexToNpub(TV2_EXPECTED);
    assert.equal(Crypto.npubToHex(npub2), TV2_EXPECTED);
});

test('4. bech32 decoding — error cases', async () => {
    const npub = Crypto.hexToNpub(TV1_EXPECTED);
    const nsec = Crypto.hexToNsec(TV1_PRIV);

    // Wrong prefix
    assert.equal(Crypto.npubToHex('nsec1' + npub.slice(5)), null);
    assert.equal(Crypto.nsecToHex('npub1' + nsec.slice(5)), null);

    // Garbled
    assert.equal(Crypto.npubToHex('npub1invalidcharsxxxxxxxxxxxxxxxxx'), null);

    // Empty
    assert.equal(Crypto.npubToHex(''), null);

    // Too short
    assert.equal(Crypto.npubToHex('npub1abc'), null);
});

test('5. event hash — NIP-01 compliance', async () => {
    const evt = {
        pubkey: TV1_EXPECTED,
        created_at: 1234567890,
        kind: 1,
        tags: [],
        content: 'Hello, Nostr!'
    };
    const serialized = JSON.stringify([0, evt.pubkey, evt.created_at, evt.kind, evt.tags, evt.content]);
    const expected = createHash('sha256').update(serialized, 'utf8').digest('hex');

    const got = await Crypto.getEventHash(evt);
    assert.equal(got, expected);
    assert.equal(got.length, 64);
    assert.match(got, /^[0-9a-f]{64}$/);

    // With tags
    const evt2 = {
        pubkey: TV2_EXPECTED,
        created_at: 1700000000,
        kind: 30023,
        tags: [['d', 'test-slug'], ['title', 'Test Article'], ['t', 'nostr']],
        content: 'This is a **long-form** article.'
    };
    const serialized2 = JSON.stringify([0, evt2.pubkey, evt2.created_at, evt2.kind, evt2.tags, evt2.content]);
    const expected2 = createHash('sha256').update(serialized2, 'utf8').digest('hex');
    assert.equal(await Crypto.getEventHash(evt2), expected2);
});

test('6. event signing & verification', async () => {
    const signingKey = TV2_PRIV;
    const signingPub = Crypto.getPublicKey(signingKey);

    const noteEvent = {
        pubkey: signingPub,
        created_at: 1234567890,
        kind: 1,
        tags: [],
        content: 'Test note for signing'
    };

    const signed = await Crypto.signEvent({ ...noteEvent }, signingKey);
    assert.equal(typeof signed.sig, 'string');
    assert.equal(signed.sig.length, 128);
    assert.match(signed.sig, /^[0-9a-f]{128}$/);
    assert.equal(typeof signed.id, 'string');
    assert.equal(signed.id.length, 64);

    // id matches the recomputed NIP-01 hash
    assert.equal(signed.id, await Crypto.getEventHash(noteEvent));

    // Signature verifies
    assert.equal(await Crypto.verifySignature(signed), true);

    // Tampered content → fails
    assert.equal(await Crypto.verifySignature({ ...signed, content: 'TAMPERED' }), false);

    // Tampered signature → fails
    assert.equal(await Crypto.verifySignature({ ...signed, sig: 'ff' + signed.sig.slice(2) }), false);

    // Sign with a different key and verify
    const noteEvent2 = {
        pubkey: TV1_EXPECTED,
        created_at: 1700000000,
        kind: 1,
        tags: [['e', 'abc123']],
        content: 'Another test note'
    };
    const signed2 = await Crypto.signEvent({ ...noteEvent2 }, TV1_PRIV);
    assert.equal(await Crypto.verifySignature(signed2), true);

    // Wrong pubkey claim → fails
    assert.equal(await Crypto.verifySignature({ ...signed2, pubkey: signingPub }), false);
});

test('7. sha256 utility', async () => {
    assert.equal(
        await Crypto.sha256(''),
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
    assert.equal(
        await Crypto.sha256('Hello, World!'),
        createHash('sha256').update('Hello, World!').digest('hex')
    );
});

test('8. hexToBytes / bytesToHex round-trip', async () => {
    const hexSample = 'deadbeef0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c';
    const bytes = Crypto.hexToBytes(hexSample);
    assert.equal(bytes.length, 32);
    assert.equal(bytes[0], 0xde);
    assert.equal(bytes[1], 0xad);
    assert.equal(Crypto.bytesToHex(bytes), hexSample);

    // Edge: all zeros
    const zeroHex = '0'.repeat(64);
    const zeroBytes = Crypto.hexToBytes(zeroHex);
    assert.ok(zeroBytes.every((b) => b === 0));
    assert.equal(Crypto.bytesToHex(zeroBytes), zeroHex);

    // Edge: all 0xff
    const ffHex = 'f'.repeat(64);
    const ffBytes = Crypto.hexToBytes(ffHex);
    assert.ok(ffBytes.every((b) => b === 0xff));
    assert.equal(Crypto.bytesToHex(ffBytes), ffHex);
});

test('9. liftX — point recovery', async () => {
    const P = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F');
    const Gx = BigInt('0x' + TV1_EXPECTED); // G.x
    const lifted = Crypto.liftX(TV1_EXPECTED);
    assert.equal(lifted[0], Gx);
    assert.equal(lifted[1] % 2n, 0n);

    // y² ≡ x³ + 7 (mod P)
    const mod = (a) => ((a % P) + P) % P;
    assert.equal(mod(lifted[1] * lifted[1]), mod(lifted[0] * lifted[0] * lifted[0] + 7n));
});

test('10. ECDH shared secret', async () => {
    const aPriv = TV3_PRIV, aPub = Crypto.getPublicKey(aPriv);
    const bPriv = TV2_PRIV, bPub = Crypto.getPublicKey(bPriv);

    const ab = await Crypto.getSharedSecret(aPriv, bPub);
    const ba = await Crypto.getSharedSecret(bPriv, aPub);
    assert.equal(ab, ba);
    assert.equal(ab.length, 64);
    assert.match(ab, /^[0-9a-f]{64}$/);

    // Self-shared-secret (used for encrypt-to-self in NIP-44 entity sync)
    const self = await Crypto.getSharedSecret(aPriv, aPub);
    assert.equal(self.length, 64);
});

test('11. deterministic signing (same event → same signature)', async () => {
    const signingKey = TV2_PRIV;
    const signingPub = Crypto.getPublicKey(signingKey);
    const base = {
        pubkey: signingPub,
        created_at: 1234567890,
        kind: 1,
        tags: [],
        content: 'Deterministic test'
    };
    const a = await Crypto.signEvent({ ...base }, signingKey);
    const b = await Crypto.signEvent({ ...base }, signingKey);
    assert.equal(a.sig, b.sig);
});

test('12. tagged hash — BIP-340', async () => {
    const data = Crypto.hexToBytes('0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20');
    const th = await Crypto.taggedHash('BIP0340/challenge', data);
    assert.equal(th.length, 32);
    assert.ok(th instanceof Uint8Array);

    // Manual verification: SHA256(SHA256(tag) || SHA256(tag) || msg)
    const tagDigest = createHash('sha256').update('BIP0340/challenge').digest();
    const manual = createHash('sha256')
        .update(Buffer.concat([tagDigest, tagDigest, Buffer.from(data)]))
        .digest('hex');
    assert.equal(Crypto.bytesToHex(th), manual);
});

test('13. verifySignature — edge cases', async () => {
    // Missing sig
    assert.equal(
        await Crypto.verifySignature({ id: 'abc', pubkey: TV1_EXPECTED, content: '', kind: 1, created_at: 0, tags: [] }),
        false
    );

    // Short sig
    const signed = await Crypto.signEvent(
        { pubkey: Crypto.getPublicKey(TV2_PRIV), created_at: 1, kind: 1, tags: [], content: 'x' },
        TV2_PRIV
    );
    assert.equal(await Crypto.verifySignature({ ...signed, sig: 'aabb' }), false);
});
