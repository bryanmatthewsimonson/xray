// Unified signing façade. Reads `preferences.signing_method` and dispatches
// to one of three concrete signers:
//   'local'      — Storage.primaryIdentity + Crypto.signEvent
//   'nip07'      — NIP07Client.{getPublicKey,signEvent} (content-script only)
//   'nsecbunker' — NSecBunkerClient.{getPublicKey,signEvent}
//
// NIP07Client lives in the content-script bundle (it talks to a MAIN-world
// page bridge over postMessage), so contexts that need NIP-07 must inject
// it via `Signer.configure({ nip07Client })`. Other contexts (popup,
// options, background) can use the façade for Local and NSecBunker, and
// route NIP-07 sign requests through an active tab via the existing
// `xray:sign` message — see [content/index.js].

import { Storage } from './storage.js';
import { Crypto } from './crypto.js';
import { Utils } from './utils.js';
import { NSecBunkerClient } from './nsecbunker-client.js';

let _nip07Client = null;
let _bunkerClient = NSecBunkerClient;
let _signRequestForwarder = null; // optional: ({type:'xray:sign',event}) => Promise<signedEvent>

export const Signer = {
  /**
   * Optional dependency injection. Call from the content script with
   * `{ nip07Client: NIP07Client }`. Other contexts can pass a forwarder
   * that proxies sign requests to a tab via chrome.tabs.sendMessage.
   */
  configure: ({ nip07Client, nsecBunkerClient, signRequestForwarder } = {}) => {
    if (nip07Client) _nip07Client = nip07Client;
    if (nsecBunkerClient) _bunkerClient = nsecBunkerClient;
    if (signRequestForwarder) _signRequestForwarder = signRequestForwarder;
  },

  getMethod: async () => {
    const prefs = await Storage.get('preferences', {});
    const m = prefs && prefs.signing_method;
    return m === 'nip07' || m === 'nsecbunker' ? m : 'local';
  },

  /**
   * Does this signing method need an actual web page — a NIP-07
   * `window.nostr` bridge — to sign? ONLY NIP-07 does. Local and
   * NSecBunker sign in any context (service worker, extension page),
   * so they never need a tab.
   *
   * This is WHY the capture→publish flow routes signing back through the
   * source tab: it is a NIP-07-only requirement, not a general one.
   * Callers must gate tab-routing on this — routing a Local/NSecBunker
   * sign through a tab (or failing for lack of one) is a bug, and breaks
   * publishing captures that have no live web page (imported EPUB
   * chapters, transcript imports, PDFs, portal reconstructions).
   */
  methodRequiresPageContext: (method) => method === 'nip07',

  isConfigured: async () => {
    const prefs = await Storage.get('preferences', {});
    return prefs && prefs.signing_method_configured === true;
  },

  /**
   * Probe each method's availability without changing the user's selection.
   * Useful for the Signing tab status indicators.
   */
  probe: async () => {
    const out = { local: false, nip07: false, nsecbunker: false };
    try {
      const id = await Storage.primaryIdentity.get();
      out.local = !!(id && id.privateKey);
    } catch (_) { /* ignore */ }
    if (_nip07Client && typeof _nip07Client.probe === 'function') {
      try { out.nip07 = !!(await _nip07Client.probe()); } catch (_) { /* ignore */ }
    }
    try {
      // NSecBunker probe is intentionally lazy — we don't auto-connect
      // here, just report whether a URL is configured. Real connection
      // happens in `signEvent` / Test connection.
      const prefs = await Storage.get('preferences', {});
      out.nsecbunker = !!(prefs && prefs.nsecbunker_url);
    } catch (_) { /* ignore */ }
    return out;
  },

  /** Resolve hex pubkey for the user's currently selected method. */
  getPublicKey: async () => {
    const method = await Signer.getMethod();
    if (method === 'local') {
      const id = await Storage.primaryIdentity.get();
      if (!id || !id.pubkey) {
        throw new Error('No local identity. Generate or import a key in Settings → Signing.');
      }
      return id.pubkey;
    }
    if (method === 'nip07') {
      if (!_nip07Client) {
        throw new Error('NIP-07 client not available in this context');
      }
      return await _nip07Client.getPublicKey();
    }
    if (method === 'nsecbunker') {
      const prefs = await Storage.get('preferences', {});
      const url = prefs && prefs.nsecbunker_url;
      if (!_bunkerClient.connected) {
        await _bunkerClient.connect(url);
      }
      if (typeof _bunkerClient.getPublicKey === 'function') {
        return await _bunkerClient.getPublicKey();
      }
      throw new Error('NSecBunker client missing getPublicKey');
    }
    throw new Error('Unknown signing method: ' + method);
  },

  /** Sign an unsigned NOSTR event. Returns the signed event. */
  signEvent: async (event) => {
    const method = await Signer.getMethod();

    if (method === 'local') {
      const id = await Storage.primaryIdentity.get();
      if (!id || !id.privateKey) {
        throw new Error('No local identity. Generate or import a key in Settings → Signing.');
      }
      const evt = { ...event, pubkey: event.pubkey || id.pubkey };
      return await Crypto.signEvent(evt, id.privateKey);
    }

    if (method === 'nip07') {
      if (_nip07Client) {
        return await _nip07Client.signEvent(event);
      }
      if (_signRequestForwarder) {
        return await _signRequestForwarder({ type: 'xray:sign', event });
      }
      throw new Error('NIP-07 not available in this context');
    }

    if (method === 'nsecbunker') {
      const prefs = await Storage.get('preferences', {});
      const url = prefs && prefs.nsecbunker_url;
      if (!_bunkerClient.connected) {
        await _bunkerClient.connect(url);
      }
      // Existing signature: signEvent(event, publicationId). Pass null
      // since the user's primary identity has no publicationId.
      return await _bunkerClient.signEvent(event, null);
    }

    throw new Error('Unknown signing method: ' + method);
  },

  /**
   * True when the user can sign right now without further setup. Cheap —
   * does not connect to NSecBunker; for that, run a Test connection.
   */
  isReady: async () => {
    const method = await Signer.getMethod();
    if (method === 'local') {
      const id = await Storage.primaryIdentity.get();
      return !!(id && id.privateKey);
    }
    if (method === 'nip07') {
      if (!_nip07Client) return false;
      try { return !!(await _nip07Client.probe()); }
      catch (_) { return false; }
    }
    if (method === 'nsecbunker') {
      const prefs = await Storage.get('preferences', {});
      return !!(prefs && prefs.nsecbunker_url);
    }
    return false;
  },

  /**
   * Persist the resolved signing state for the popup badge. Mirrors what
   * content/index.js used to do directly; called after init / setup.
   */
  recordSigningState: async () => {
    const method = await Signer.getMethod();
    let pubkey = null;
    try { pubkey = await Signer.getPublicKey(); } catch (_) { /* not ready */ }
    try {
      const payload = JSON.stringify({ method, pubkey, detectedAt: Date.now() });
      const area = (typeof browser !== 'undefined' && browser.storage)
        ? browser.storage.local
        : chrome.storage.local;
      area.set({ xr_signing_state: payload });
    } catch (err) {
      Utils.log('Failed to persist signing state:', err && err.message);
    }
  }
};
