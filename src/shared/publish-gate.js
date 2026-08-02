// publish-gate.js — the ONE path from signer to relays (Phase 29.1,
// docs/EVENT_STORE_DESIGN.md §3.2).
//
// Behind the `storeFirstPublish` flag the gate inverts the publish
// order: journal the signed event as a 'pending' outbox row FIRST
// (event-journal.js recordSigned), then run the inline relay attempt,
// then snapshot the per-relay results (recordFlushAttempt). A publish
// that no relay accepts leaves the pending row in place — the
// signature is never lost (§1.1); the 29.2 flusher rebroadcasts it
// verbatim later. The inline attempt is load-bearing: the queue is a
// failure fallback, not a delay — the happy path still publishes at
// capture time.
//
// Flag OFF is BYTE-FOR-BYTE today's behavior: attempt first, and
// journal via the legacy recordPublished ONLY when the call site
// journaled on success before 29.1 (`legacyJournalOnSuccess`). Sites
// that never journaled (the portal four, the network kind-3 mirror,
// entity-sync's clearRemote) pass false, so flag-off keeps even their
// defects intact.
//
// The relay transport is INJECTED (confirmed-publish.js precedent)
// because callers span four contexts: extension pages publish through
// the SW's pool via the `xray:relay:publish` message
// (relayPublishTransport below), the reader's capture families are
// gated INSIDE the SW's xray:capture:publish handler, and in-process
// contexts (the SW itself, entity-sync in the sidepanel) inject
// NostrClient.publishToRelays — or publishConfirmed composed over
// either transport, so the IDENTITY_KINDS confirmed-retry still wraps
// the relay leg inside the gate. IndexedDB is origin-shared, so the
// journal rows land identically regardless of context.
//
// The ledger-marking rule (CONFIRMED — non-assumed — relay OKs only,
// JOURNAL 2026-07-10) is UNCHANGED and stays at the call sites in
// 29.1; `confirmedOk` in the return is that same computation, offered
// so sites need not re-derive it.
//
// "Signed ⇒ journaled" is guard-tested at the transport layer
// (tests/publish-transport-guard.test.mjs): outside this module, the
// SW's message handlers, and nostr-client.js itself, no module calls
// NostrClient.publishToRelays or sends xray:relay:publish /
// xray:capture:publish.

import { Utils } from './utils.js';
import { loadFlags, isEnabled } from './metadata/feature-flags.js';
import { recordSigned, recordFlushAttempt, recordPublished } from './event-journal.js';

/**
 * CONFIRMED (non-assumed) relay OK count from a publish result
 * summary — the JOURNAL 2026-07-10 ledger rule's input, tolerant of
 * summaries that predate the `confirmed` field.
 */
export function confirmedCount(results) {
    if (!results) return 0;
    if (typeof results.confirmed === 'number') return results.confirmed;
    return Array.isArray(results.results)
        ? results.results.filter((r) => r && r.success && !r.assumed).length : 0;
}

/**
 * Publish one SIGNED event through the store-first gate.
 *
 * @param {object} opts
 * @param {object}   opts.signedEvent  the signed event, verbatim
 * @param {string[]} opts.relays       relay urls for the transport
 * @param {Function} opts.publish      injected transport:
 *                                     (relays, signedEvent) → results
 * @param {object|null} [opts.ledger]  {model, localId, extra} — how the
 *                                     flusher marks the local model on a
 *                                     late confirm (design §3.1); null
 *                                     when no local ledger exists
 * @param {string|null} [opts.articleUrl]
 * @param {boolean} [opts.legacyJournalOnSuccess]  flag-off only: journal
 *                                     via recordPublished when
 *                                     results.successful > 0 — true
 *                                     exactly for the sites that did so
 *                                     before 29.1
 * @returns {Promise<{results: object, confirmedOk: boolean,
 *          journaled: boolean}>} the transport's results plus whether a
 *          CONFIRMED ok occurred. A transport failure rethrows after
 *          the sign-time journal write, so under the flag the pending
 *          row survives the error path too.
 */
export async function gatePublish({
    signedEvent,
    relays,
    publish,
    ledger = null,
    articleUrl = null,
    legacyJournalOnSuccess = false
} = {}) {
    if (!signedEvent || !signedEvent.id || !signedEvent.sig) {
        throw new Error('publish-gate: a SIGNED event (id + sig) is required');
    }
    if (typeof publish !== 'function') {
        throw new Error('publish-gate: an injected publish(relays, signedEvent) transport is required');
    }
    await loadFlags();
    if (isEnabled('storeFirstPublish')) {
        // Store-first (§3.2): sign → journal ('pending') → inline
        // attempt → snapshot. The journal write is best-effort by
        // design: a busted IDB must not block the relay attempt, it
        // just narrows durability back to today's.
        try {
            await recordSigned(signedEvent, { ledger, articleUrl });
        } catch (err) {
            Utils.error('publish-gate: sign-time journal write failed', err);
        }
        const results = await publish(relays, signedEvent);
        try {
            await recordFlushAttempt(signedEvent.id, results);
        } catch (err) {
            Utils.error('publish-gate: flush-attempt snapshot failed', err);
        }
        return { results, confirmedOk: confirmedCount(results) > 0, journaled: true };
    }

    // Legacy (flag off): attempt first; a zero-success publish is
    // discarded exactly as before 29.1.
    const results = await publish(relays, signedEvent);
    let journaled = false;
    if (legacyJournalOnSuccess && results && results.successful > 0) {
        try {
            await recordPublished(signedEvent, results, { articleUrl });
            journaled = true;
        } catch (err) {
            Utils.error('publish-gate: journal write failed', err);
        }
    }
    return { results, confirmedOk: confirmedCount(results) > 0, journaled };
}

function runtimeApi() {
    if (typeof browser !== 'undefined' && browser.runtime) return browser;
    if (typeof chrome !== 'undefined' && chrome.runtime) return chrome;
    return null;
}

/**
 * The extension-page relay transport: publish through the SW's socket
 * pool via the `xray:relay:publish` message. Resolves to the relay
 * result summary; rejects with the SW's error string (or an empty
 * message, so call sites' own fallback strings apply) when the SW
 * refuses or the channel drops.
 */
export function relayPublishTransport() {
    return async (relays, signedEvent) => {
        const api = runtimeApi();
        if (!api) throw new Error('publish-gate: no extension runtime for the relay transport');
        const resp = await api.runtime.sendMessage({
            type: 'xray:relay:publish', event: signedEvent, relays
        });
        if (!resp || !resp.ok) throw new Error((resp && resp.error) || '');
        return resp.results;
    };
}

/**
 * Verbatim re-broadcast of an ALREADY-JOURNALED (or foreign) signed
 * event — the portal's reconcile repair and the network page's
 * re-broadcast-your-follows action. Deliberately NOT the gate: these
 * events either already have their journal row or are someone else's
 * signed work, which must never enter this install's journal (it
 * would pollute the export bundle and the review-queue's myCoords).
 * New SIGN sites go through gatePublish, never this.
 */
export async function rebroadcastEvent(relays, signedEvent) {
    return relayPublishTransport()(relays, signedEvent);
}
