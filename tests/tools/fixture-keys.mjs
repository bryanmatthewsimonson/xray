// Test-only key material and constants shared by every golden-fixture
// generator and test (tests/tools/gen-*-fixtures.mjs, tests/*-fixtures.test.mjs).
//
// Every private key in every checked-in fixture is one of the BIP-340
// test-vector scalars 1, 2 and 3 — the secp256k1 generator multiples the
// crypto suite already uses (tests/crypto.test.mjs). They are the most
// recognisably NOT-real keys that exist: nothing derived from them can be
// mistaken for an identity, and the hygiene tests allowlist exactly these
// values so any other 64-hex private key or nsec in a fixture is a defect.
// Signing is deterministic in this tree (BIP-340 nonce with no aux
// randomness, crypto.js), so a fixture's id and sig are reproducible from
// (event, key) — that is what lets a test REBUILD a fixture and compare.
//
// Timestamps are fixed. Fixtures never contain Date.now().

import { Crypto } from '../../src/shared/crypto.js';

const hexKey = (n) => n.toString(16).padStart(64, '0');

function keypair(scalar) {
    const privateKey = hexKey(scalar);
    const pubkey = Crypto.getPublicKey(privateKey);
    return Object.freeze({
        scalar, privateKey, pubkey,
        npub: Crypto.hexToNpub(pubkey),
        nsec: Crypto.hexToNsec(privateKey)
    });
}

/** The user's primary signing identity in fixtures. */
export const TV1 = keypair(1);
/** The `xray:user` entity-sync key in fixtures. */
export const TV2 = keypair(2);
/** An entity (case / person / org) key in fixtures. */
export const TV3 = keypair(3);

export const TEST_KEYS = Object.freeze([TV1, TV2, TV3]);
export const ALLOWED_PRIVATE_KEYS = Object.freeze(TEST_KEYS.map((k) => k.privateKey));
export const ALLOWED_PUBKEYS = Object.freeze(TEST_KEYS.map((k) => k.pubkey));
export const ALLOWED_NSECS = Object.freeze(TEST_KEYS.map((k) => k.nsec));

/** One fixed second (2023-11-14T22:13:20Z) — every created_at / cachedAt / runAt in a fixture derives from it. */
export const FIXED_TIME_S = 1700000000;
export const FIXED_TIME_MS = FIXED_TIME_S * 1000;
export const FIXED_ISO = '2023-11-14T22:13:20.000Z';

/** RFC 2606 hosts only. */
export const FIXTURE_ORIGIN = 'https://example.com';
export const FIXTURE_RELAY = 'wss://relay.example';

/** Sign a fixture event in place with one of the test keys; sets pubkey if absent. */
export async function signWith(event, key) {
    if (!event.pubkey) event.pubkey = key.pubkey;
    if (event.pubkey !== key.pubkey) throw new Error(`event.pubkey ${event.pubkey} is not ${key.pubkey}`);
    const signed = await Crypto.signEvent(event, key.privateKey);
    if (!signed) throw new Error('Crypto.signEvent returned null');
    return signed;
}

/** Deterministic 64-hex "hash" for fixture ids — sha256 of a label, so ids are readable in diffs only via their label. */
export async function fixtureHash(label) {
    const bytes = new TextEncoder().encode(`xray-fixture:${label}`);
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
