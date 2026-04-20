// NSecBunker WebSocket client. Ported verbatim from the userscript.
// Only the default URL changed (uses the user preference if set).

import { CONFIG } from './config.js';
import { Utils } from './utils.js';

export const NSecBunkerClient = {
  ws: null,
  connected: false,
  url: null,
  pendingRequests: new Map(),
  requestId: 0,
  keys: new Map(),

  connect: async (url) => {
    return new Promise((resolve, reject) => {
      if (NSecBunkerClient.connected && NSecBunkerClient.ws?.readyState === WebSocket.OPEN) {
        resolve(true);
        return;
      }

      NSecBunkerClient.url = url || CONFIG.nsecbunker.defaultUrl;
      Utils.log('Connecting to NSecBunker:', NSecBunkerClient.url);

      try {
        const ws = new WebSocket(NSecBunkerClient.url);

        ws.onopen = () => {
          Utils.log('Connected to NSecBunker');
          NSecBunkerClient.ws = ws;
          NSecBunkerClient.connected = true;
          resolve(true);
        };

        ws.onerror = (error) => {
          Utils.error('NSecBunker connection error:', error);
          NSecBunkerClient.connected = false;
          reject(error);
        };

        ws.onclose = () => {
          Utils.log('NSecBunker connection closed');
          NSecBunkerClient.connected = false;
          NSecBunkerClient.ws = null;
        };

        ws.onmessage = (msg) => NSecBunkerClient.handleMessage(msg);

        setTimeout(() => {
          if (!NSecBunkerClient.connected) {
            ws.close();
            reject(new Error('NSecBunker connection timeout'));
          }
        }, CONFIG.nsecbunker.timeout);
      } catch (e) {
        reject(e);
      }
    });
  },

  handleMessage: (msg) => {
    try {
      const data = JSON.parse(msg.data);
      Utils.log('NSecBunker message:', data);

      if (data.id && NSecBunkerClient.pendingRequests.has(data.id)) {
        const { resolve, reject } = NSecBunkerClient.pendingRequests.get(data.id);
        NSecBunkerClient.pendingRequests.delete(data.id);
        if (data.error) reject(new Error(data.error));
        else            resolve(data.result);
      }
    } catch (e) {
      Utils.error('Error parsing NSecBunker message:', e);
    }
  },

  sendRequest: (method, params) => {
    return new Promise((resolve, reject) => {
      if (!NSecBunkerClient.connected || !NSecBunkerClient.ws) {
        reject(new Error('Not connected to NSecBunker'));
        return;
      }

      const id = ++NSecBunkerClient.requestId;
      NSecBunkerClient.pendingRequests.set(id, { resolve, reject });
      NSecBunkerClient.ws.send(JSON.stringify({ id, method, params }));

      setTimeout(() => {
        if (NSecBunkerClient.pendingRequests.has(id)) {
          NSecBunkerClient.pendingRequests.delete(id);
          reject(new Error('Request timeout'));
        }
      }, CONFIG.nsecbunker.timeout);
    });
  },

  createKey: async (name, metadata = {}) => {
    Utils.log('Creating key:', name);
    const result = await NSecBunkerClient.sendRequest('create_key', { name, metadata });
    NSecBunkerClient.keys.set(name, result);
    return result;
  },

  getKey: async (name) => {
    if (NSecBunkerClient.keys.has(name)) return NSecBunkerClient.keys.get(name);
    const result = await NSecBunkerClient.sendRequest('get_key', { name });
    if (result) NSecBunkerClient.keys.set(name, result);
    return result;
  },

  listKeys: async () => (await NSecBunkerClient.sendRequest('list_keys', {})) || [],

  signEvent: async (event, keyName) => {
    Utils.log('Signing event with key:', keyName);
    return await NSecBunkerClient.sendRequest('sign_event', { key_name: keyName, event });
  },

  getPublicKey: async (keyName) => {
    const key = await NSecBunkerClient.getKey(keyName);
    return key?.pubkey;
  },

  disconnect: () => {
    if (NSecBunkerClient.ws) { NSecBunkerClient.ws.close(); NSecBunkerClient.ws = null; }
    NSecBunkerClient.connected = false;
    NSecBunkerClient.keys.clear();
  }
};
