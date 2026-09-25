// Shared test fixture — NOT a test file (node --test only picks up
// *.test.mjs).
//
// Option C (docs/NIP07_IDENTITY_KICKOFF.md, ratified 2026-08-11) makes
// EntityModel.create REFUSE when no local primary identity exists —
// the legacy branch minted a random, unrecoverable key. Every suite
// that creates entities therefore seeds a primary in its reset. The
// value is stored in storage.js's wrapper encoding (a JSON string),
// so it can be planted directly into a raw chrome.storage stub map
// from a synchronous reset function.
import { Crypto } from '../src/shared/crypto.js';

export const TEST_PRIMARY_HEX = '11'.repeat(32);
export const TEST_PRIMARY_PUBKEY = Crypto.getPublicKey(TEST_PRIMARY_HEX);
export const TEST_PRIMARY_JSON = JSON.stringify({
    privateKey: TEST_PRIMARY_HEX,
    pubkey: TEST_PRIMARY_PUBKEY,
    npub: Crypto.hexToNpub(TEST_PRIMARY_PUBKEY)
});

/** Plant the primary into a raw store map (chrome.storage.local stub). */
export function seedPrimary(stateStore) {
    stateStore.set('local_primary_identity', TEST_PRIMARY_JSON);
}
