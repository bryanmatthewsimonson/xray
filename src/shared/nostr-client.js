// WebSocket relay client. Ported verbatim from the userscript. These
// WebSockets are short-lived (open, publish, close) and live in the
// content script, so we don't need to worry about the MV3 service worker
// lifecycle here.

import { Utils } from './utils.js';
import { CONFIG } from './config.js';

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

  closeAll: () => {
    for (const [url, ws] of NostrClient.connections) {
      try { ws.close(); } catch (e) { Utils.log('Error closing connection:', url, e); }
    }
    NostrClient.connections.clear();
    NostrClient.pendingPublishes.clear();
  }
};
