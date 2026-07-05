// WebSocket relay client. Ported verbatim from the userscript. These
// WebSockets are short-lived (open, publish, close) and live in the
// content script, so we don't need to worry about the MV3 service worker
// lifecycle here.

import { Utils } from './utils.js';
import { CONFIG } from './config.js';
import { firstValidEvent } from './nostr-events.js';

export const NostrClient = {
  connections: new Map(),
  subscriptions: new Map(),
  messageQueue: [],
  pendingPublishes: new Map(),

  connectToRelay: (url) => {
    return new Promise((resolve, reject) => {
      if (NostrClient.connections.has(url)) {
        const existing = NostrClient.connections.get(url);
        if (existing.readyState === WebSocket.OPEN) {
          Utils.log('Reusing existing connection to:', url);
          resolve(existing);
          return;
        }
        Utils.log('Closing stale connection to:', url);
        existing.close();
        NostrClient.connections.delete(url);
      }

      Utils.log('Connecting to relay:', url);

      let ws;
      try { ws = new WebSocket(url); }
      catch (e) {
        Utils.error('Failed to create WebSocket:', url, e);
        reject(new Error('Failed to create WebSocket: ' + e.message));
        return;
      }

      const connectionTimeout = setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          Utils.log('Connection timeout for:', url);
          ws.close();
          reject(new Error('Connection timeout'));
        }
      }, 10000);

      ws.onopen = () => {
        clearTimeout(connectionTimeout);
        Utils.log('Connected to relay:', url);
        NostrClient.connections.set(url, ws);
        resolve(ws);
      };

      ws.onerror = (error) => {
        clearTimeout(connectionTimeout);
        Utils.error('Relay connection error:', url, error);
        NostrClient.connections.delete(url);
        reject(new Error('Connection error'));
      };

      ws.onclose = (event) => {
        clearTimeout(connectionTimeout);
        Utils.log('Relay connection closed:', url, 'code:', event.code);
        NostrClient.connections.delete(url);
      };

      ws.onmessage = (msg) => NostrClient.handleMessage(url, msg);
    });
  },

  handleMessage: (url, msg) => {
    try {
      Utils.log('Received message from relay:', url, msg.data);
      const data = JSON.parse(msg.data);
      const [type, ...rest] = data;

      switch (type) {
        case 'OK': {
          const [eventId, success, message] = rest;
          Utils.log('Event publish result:', { url, eventId, success, message });
          NostrClient.resolvePendingPublish(url, eventId, success, message);
          break;
        }
        case 'EVENT': {
          const [subId, event] = rest;
          Utils.log('Received event:', { url, subId, event });
          // Dispatch to any registered subscription handler.
          const sub = NostrClient.subscriptions.get(subId);
          if (sub && typeof sub.onEvent === 'function') sub.onEvent(event, url);
          break;
        }
        case 'EOSE': {
          Utils.log('End of stored events:', { url, subId: rest[0] });
          const sub = NostrClient.subscriptions.get(rest[0]);
          if (sub && typeof sub.onEose === 'function') sub.onEose(url);
          break;
        }
        case 'NOTICE':
          Utils.log('Relay notice:', { url, message: rest[0] });
          break;
        case 'AUTH':
          Utils.log('Relay requires auth:', { url });
          break;
        default:
          Utils.log('Unknown message type:', type, rest);
      }
    } catch (e) {
      Utils.error('Error parsing relay message:', e, 'raw:', msg.data);
    }
  },

  resolvePendingPublish: (url, eventId, success, message) => {
    const key = `${url}:${eventId}`;
    const pending = NostrClient.pendingPublishes.get(key);
    if (pending) {
      Utils.log('Resolving pending publish:', key, 'success:', success);
      clearTimeout(pending.timeout);
      if (success) pending.resolve({ success: true, eventId, url });
      else         pending.reject(new Error(message || 'Relay rejected event'));
      NostrClient.pendingPublishes.delete(key);
    } else {
      Utils.log('No pending publish found for:', key);
    }
  },

  publishToRelay: (url, event) => {
    return new Promise(async (resolve, reject) => {
      const key = `${url}:${event.id}`;
      Utils.log('Publishing to relay:', url, 'event id:', event.id);

      try {
        const ws = await NostrClient.connectToRelay(url);

        const timeout = setTimeout(() => {
          if (NostrClient.pendingPublishes.has(key)) {
            Utils.log('Publish timeout for:', key);
            NostrClient.pendingPublishes.delete(key);
            // On timeout, assume success (many relays don't send OK).
            resolve({ success: true, eventId: event.id, url, assumed: true });
          }
        }, 8000);

        NostrClient.pendingPublishes.set(key, { resolve, reject, timeout });

        const message = JSON.stringify(['EVENT', event]);
        Utils.log('Sending event to relay:', url);
        ws.send(message);
        Utils.log('Event sent to relay:', url, event.id);
      } catch (e) {
        Utils.error('Failed to publish to relay:', url, e);
        reject(e);
      }
    });
  },

  publishToRelays: async (relayUrls, event) => {
    Utils.log('Publishing to relays:', relayUrls, 'event:', event.id);
    if (!event.id || !event.pubkey || !event.sig) {
      throw new Error('Event missing required fields (id, pubkey, or sig)');
    }

    const results = await Promise.allSettled(
      relayUrls.map(url => NostrClient.publishToRelay(url, event))
    );

    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed     = results.filter(r => r.status === 'rejected').length;

    Utils.log(`Published to ${successful}/${relayUrls.length} relays (${failed} failed)`);
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        Utils.log(`  ✓ ${relayUrls[i]}`, r.value.assumed ? '(assumed)' : '(confirmed)');
      } else {
        Utils.log(`  ✗ ${relayUrls[i]}:`, r.reason?.message);
      }
    });

    return {
      successful,
      failed,
      total: relayUrls.length,
      results: results.map((r, i) => ({
        url: relayUrls[i],
        success: r.status === 'fulfilled',
        assumed: r.status === 'fulfilled' ? r.value?.assumed : false,
        error: r.status === 'rejected' ? r.reason?.message : null
      }))
    };
  },

  /**
   * One-shot query across a list of relays. Opens a REQ on each,
   * accumulates EVENTs into a de-duplicated array (keyed by event
   * id — pubs to multiple relays produce the same event id), and
   * resolves either when EOSE has fired on every relay or the
   * timeout hits, whichever comes first. Either way the
   * subscription is CLOSEd and the array returned.
   *
   * Not a live subscription — the caller gets a point-in-time
   * snapshot. For live subscriptions we'd build a second method
   * that keeps the subscription open; Phase 5 C5 doesn't need it.
   *
   * @param {string[]} relayUrls
   * @param {object}   filter        a NIP-01 filter object
   * @param {number}   timeoutMs     default 5000
   * @returns {Promise<{events, byRelay, invalid}>}
   */
  queryRelays: async (relayUrls, filter, timeoutMs = 5000) => {
    const subId = 'xr_' + Math.random().toString(36).slice(2, 10);
    const events  = new Map();                            // id → [copies]
    const byRelay = new Map();                            // url → { received, eose }
    for (const url of relayUrls) byRelay.set(url, { received: 0, eose: false });

    return await new Promise((resolve) => {
      let resolved = false;
      const finish = async () => {
        if (resolved) return;
        resolved = true;
        // Send CLOSE to any relay whose socket is still open.
        for (const [url, ws] of NostrClient.connections) {
          if (ws.readyState === WebSocket.OPEN) {
            try { ws.send(JSON.stringify(['CLOSE', subId])); } catch (_) {}
          }
        }
        NostrClient.subscriptions.delete(subId);
        // Verify-on-ingest (KS.1): relays are untrusted input — only
        // BIP-340-valid events reach the caller. Copies of one id are
        // verified in arrival order and the first VALID one wins, so
        // a forged frame that races in reusing a real event's id
        // cannot censor an honest relay's copy. `invalid` counts ids
        // with no valid copy; additive — existing consumers
        // destructure only `events`/`byRelay`.
        const valid = [];
        let dropped = 0;
        for (const copies of events.values()) {
          const ev = await firstValidEvent(copies);
          if (ev) valid.push(ev);
          else dropped++;
        }
        if (dropped > 0) {
          Utils.log('queryRelays: dropped', dropped, 'event id(s) with no signature-valid copy');
        }
        resolve({
          events: valid,
          byRelay: Object.fromEntries(byRelay.entries()),
          invalid: dropped
        });
      };

      NostrClient.subscriptions.set(subId, {
        onEvent: (event, url) => {
          if (!event || !event.id) return;
          const stat = byRelay.get(url);
          if (stat) stat.received++;
          // Keep a few copies per id (relays may disagree — one may
          // serve a forged frame under a real id). Verification at
          // finish picks the first valid copy; capping bounds memory.
          const copies = events.get(event.id);
          if (!copies) events.set(event.id, [event]);
          else if (copies.length < 3) copies.push(event);
        },
        onEose: (url) => {
          const stat = byRelay.get(url);
          if (stat) stat.eose = true;
          // Resolve early if every relay has signalled end-of-stored.
          if ([...byRelay.values()].every((s) => s.eose)) finish();
        }
      });

      // Kick off the REQ per relay. Relay connection failures shouldn't
      // block the whole query — just mark that relay as 'no data'.
      for (const url of relayUrls) {
        NostrClient.connectToRelay(url)
          .then((ws) => {
            try { ws.send(JSON.stringify(['REQ', subId, filter])); }
            catch (_) { /* relay closed mid-send */ }
          })
          .catch((err) => {
            Utils.log('queryRelays: connect failed', url, err && err.message);
            // Mark as EOSE so we don't wait on it — but record the
            // failure too (Phase 12.7): a dead relay is otherwise
            // indistinguishable from an empty one ({received:0,
            // eose:true}), and callers like the portal's sync cursor
            // must not treat "unreachable" as "answered with nothing".
            // Additive fields; existing byRelay consumers are unaffected.
            const stat = byRelay.get(url);
            if (stat) {
              stat.eose = true;
              stat.failed = true;
              stat.error = (err && err.message) || 'connect failed';
            }
            if ([...byRelay.values()].every((s) => s.eose)) finish();
          });
      }

      // Hard ceiling regardless of EOSE state.
      setTimeout(finish, timeoutMs);
    });
  },

  closeAll: () => {
    for (const [url, ws] of NostrClient.connections) {
      try { ws.close(); } catch (e) { Utils.log('Error closing connection:', url, e); }
    }
    NostrClient.connections.clear();
    NostrClient.pendingPublishes.clear();
  }
};
