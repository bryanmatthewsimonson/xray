// confirmed-publish.js — KS.7's confirmed-OK publish (Phase 25.5;
// TEAM_CASE §2.5: "the events whose silent loss breaks joining").
//
// `publishToRelays` already distinguishes CONFIRMED (the relay
// answered OK true) from ASSUMED (a timeout hope — JOURNAL
// 2026-07-10). For most kinds an assumed success is tolerable: the
// portal reconcile pass catches losses later. Identity kinds are
// different — a silently dropped kind-0 / 32125 / 32126 / 30069 /
// 10002 / 3 breaks the rendezvous machinery strangers join through,
// and nothing downstream re-checks them. So identity-kind publishes
// succeed only on `confirmed > 0`, and an assumed-only round retries.
//
// Re-publishing is safe by construction: events are immutable and
// id-keyed, so a relay that already accepted one treats the retry as
// a no-op duplicate.

import { NostrClient } from './nostr-client.js';

// The kinds whose silent loss breaks cross-user joining. Pinned by
// test; extend deliberately.
export const IDENTITY_KINDS = Object.freeze([0, 3, 10002, 30069, 32125, 32126]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Publish and require at least one relay CONFIRMATION. An
 * assumed-only or zero-success round retries (same relays — dupes are
 * no-ops) up to `retries` extra times.
 *
 * @param {string[]} relays
 * @param {object} event                    signed event
 * @param {object} [opts]
 * @param {Function} [opts.publish]         injectable (tests); defaults to NostrClient.publishToRelays
 * @param {number}  [opts.retries=1]        extra attempts after the first
 * @param {number}  [opts.delayMs=1500]     pause between attempts
 * @returns {Promise<{ok: boolean, result: object, attempts: number}>}
 *          `ok` = confirmed > 0; `result` is the LAST attempt's
 *          publishToRelays result (shape unchanged for callers).
 */
export async function publishConfirmed(relays, event, {
    publish = NostrClient.publishToRelays,
    retries = 1,
    delayMs = 1500
} = {}) {
    let attempts = 0;
    let result = null;
    // First attempt + `retries` retries.
    for (let i = 0; i <= retries; i++) {
        attempts++;
        result = await publish(relays, event);
        if (result && result.confirmed > 0) {
            return { ok: true, result, attempts };
        }
        if (i < retries && delayMs > 0) await sleep(delayMs);
    }
    return { ok: false, result, attempts };
}
