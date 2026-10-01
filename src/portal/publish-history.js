// The active case's own publish record, read from the signed-event
// journal (`xray-events`, scoped to the active workspace) — the one
// store that knows WHO signed each event this case published and WHICH
// relays confirmed it (JOURNAL 2026-10-01). Two portal reads use it:
//
//   - identity.js: a saved identity profile that signed events here
//     stays "me" for this case after the live signer moves (Options ▸
//     Signing "Use", a backup restore, a rebind). Without it, everything
//     the case published under its earlier key drops out of the archive
//     and reconcile calls it missing.
//   - index.js: the relays that CONFIRMED those events are read too, on
//     top of the configured list — an event confirmed by a relay the user
//     later removed from Settings is still theirs to see.
//
// Only the kinds the portal asks for as "me" (corpus.js CONTENT_KINDS)
// count: entity kind-0 profiles and kind-1 mention notes in the journal
// are signed by ENTITY keys, never by the operator. Pure except
// loadJournalRows, which never throws.

import { listAll } from '../shared/event-journal.js';
import { Utils } from '../shared/utils.js';
import { CONTENT_KINDS } from './corpus.js';

const OPERATOR_KINDS = new Set(CONTENT_KINDS);
const HEX64 = /^[0-9a-f]{64}$/;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

// Extra read relays beyond the configured list — the network page's
// widening cap (network-feed.js WIDENED_RELAY_CAP): each relay is
// another paged query per refresh.
export const HISTORY_RELAY_CAP = 8;

/**
 * A relay URL the portal may READ from, normalized for comparison, or
 * null: wss only, or ws on a loopback host (a local relay). A merged-in
 * journal row can carry any string, so plaintext and LAN sockets are
 * refused rather than queried. `wss://Relay.Example/` and
 * `wss://relay.example` are one relay.
 */
export function relayReadUrl(url) {
    if (typeof url !== 'string') return null;
    let u;
    try { u = new URL(url.trim()); } catch (_) { return null; }
    if (u.username || u.password) return null;
    if (!(u.protocol === 'wss:' || (u.protocol === 'ws:' && LOOPBACK.has(u.hostname)))) return null;
    const s = u.toString();
    return s.endsWith('/') ? s.slice(0, -1) : s;
}

/**
 * Journal rows → per signer: how many operator-kind events it signed
 * and which relays CONFIRMED them (success && !assumed — the JOURNAL
 * 2026-07-10 rule: an assumed timeout is no evidence a relay has it).
 *
 * @param {Array<object>} rows  event-journal rows ({kind, pubkey, relays})
 * @returns {Map<string, {count: number, relays: Map<string, number>}>}
 */
export function summarizeJournal(rows) {
    const out = new Map();
    for (const row of Array.isArray(rows) ? rows : []) {
        if (!row || !OPERATOR_KINDS.has(row.kind)) continue;
        const pk = String(row.pubkey || '').toLowerCase();
        if (!HEX64.test(pk)) continue;
        let entry = out.get(pk);
        if (!entry) { entry = { count: 0, relays: new Map() }; out.set(pk, entry); }
        entry.count++;
        const confirmed = new Set();   // a relay confirms an event once
        for (const r of Array.isArray(row.relays) ? row.relays : []) {
            if (!r || !r.success || r.assumed) continue;
            const url = relayReadUrl(r.url);
            if (url) confirmed.add(url);
        }
        for (const url of confirmed) entry.relays.set(url, (entry.relays.get(url) || 0) + 1);
    }
    return out;
}

/**
 * The relays that confirmed events signed by any of `signers`, most
 * confirmations first (ties by URL, so the order — and the portal's
 * sync-cursor key — is stable).
 */
export function rankHistoryRelays(summary, signers) {
    const tally = new Map();
    for (const pk of signers || []) {
        const entry = summary && summary.get(pk);
        if (!entry) continue;
        for (const [url, n] of entry.relays) tally.set(url, (tally.get(url) || 0) + n);
    }
    return [...tally.entries()]
        .sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
        .map(([url]) => url);
}

/**
 * The ranked history relays the configured list does not already name,
 * capped. Configured relays are never dropped or reordered — this only
 * appends.
 */
export function extraReadRelays(configured, ranked, cap = HISTORY_RELAY_CAP) {
    const have = new Set((configured || []).map(relayReadUrl).filter(Boolean));
    const out = [];
    for (const url of ranked || []) {
        if (out.length >= cap) break;
        if (!have.has(url)) { have.add(url); out.push(url); }
    }
    return out;
}

/** The active workspace's journal rows; [] when unreadable (never throws). */
export async function loadJournalRows(listJournal = listAll) {
    try {
        const rows = await listJournal();
        return Array.isArray(rows) ? rows : [];
    } catch (err) {
        Utils.log('Portal: signed-event journal unreadable — publish history skipped:', err && err.message);
        return [];
    }
}
