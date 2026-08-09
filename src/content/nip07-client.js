// NIP-07 client. In the userscript this touched unsafeWindow.nostr
// directly; in MV3 the content script runs in an isolated world and
// cannot see page globals. We talk to src/page/nip07-bridge.js (injected
// into the MAIN world via the manifest) through tagged window.postMessage.

import { Utils } from '../shared/utils.js';
import { Crypto } from '../shared/crypto.js';

export const NIP07Client = (() => {
  const TAG = 'XRAY_NIP07';
  let reqSeq = 0;
  let ready = false;         // has the MAIN-world bridge signalled it loaded?
  let providerAvailable = false; // does window.nostr exist in MAIN world?

  // Listen for the bridge's ready broadcast so we know whether a NIP-07
  // provider is present without issuing an unnecessary probe. The bridge
  // ships on document_start so this is normally set well before the user
  // interacts with the UI.
  window.addEventListener('message', (ev) => {
    if (ev.source !== window) return;
    const data = ev.data;
    if (!data || data.tag !== TAG) return;
    if (data.direction === 'ready') {
      ready = true;
      providerAvailable = !!data.available;
      Utils.log('NIP-07 bridge ready, provider available:', providerAvailable);
    }
  });

  // Request ids must be UNGUESSABLE. The bridge and the client talk over
  // window.postMessage, which every script on the captured page can both
  // read and write — so a sequential counter let a hostile page predict
  // the next id, post its own `res` envelope, and win the race against
  // the real signer. Captured pages are adversarial by design here.
  const newId = () => {
    try {
      if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
        return globalThis.crypto.randomUUID();
      }
      const b = new Uint8Array(16);
      globalThis.crypto.getRandomValues(b);
      return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    } catch (_) {
      // Never fall back to a predictable id — failing closed is correct.
      throw new Error('NIP-07 bridge: no secure randomness available');
    }
  };

  const call = (method, ...args) => new Promise((resolve, reject) => {
    reqSeq += 1;                      // retained for logging/diagnostics only
    const id = newId();
    const timeout = setTimeout(() => {
      window.removeEventListener('message', onMessage);
      reject(new Error('NIP-07 bridge timeout for method: ' + method));
    }, 30000);

    const onMessage = (ev) => {
      if (ev.source !== window) return;
      const data = ev.data;
      if (!data || data.tag !== TAG || data.direction !== 'res' || data.id !== id) return;
      clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
      if (data.ok) resolve(data.result);
      else         reject(new Error(data.error || 'NIP-07 call failed'));
    };
    window.addEventListener('message', onMessage);

    window.postMessage({ tag: TAG, direction: 'req', id, method, args }, '*');
  });

  const Client = {
    available: false,
    publicKey: null,

    // Synchronous check. Relies on the ready broadcast from the bridge.
    checkAvailability: () => {
      Client.available = providerAvailable;
      return Client.available;
    },

    // Async probe — useful during startup before the ready event fires.
    probe: async () => {
      try {
        const result = await call('probe');
        providerAvailable = !!(result && result.available);
        Client.available = providerAvailable;
        return Client.available;
      } catch (_) {
        Client.available = false;
        return false;
      }
    },

    getPublicKey: async () => {
      if (!Client.checkAvailability()) {
        // Give the probe one chance in case ready hasn't arrived yet.
        if (!(await Client.probe())) {
          throw new Error('NIP-07 extension not available. Please install nos2x, Alby, or similar.');
        }
      }
      try {
        Client.publicKey = await call('getPublicKey');
        Utils.log('Got public key from NIP-07:', Client.publicKey);
        return Client.publicKey;
      } catch (e) {
        Utils.error('Failed to get public key from NIP-07:', e);
        throw new Error('Failed to get public key: ' + e.message);
      }
    },

    signEvent: async (event) => {
      if (!Client.checkAvailability() && !(await Client.probe())) {
        throw new Error('NIP-07 extension not available');
      }
      try {
        const unsignedEvent = {
          kind: event.kind,
          created_at: event.created_at,
          tags: event.tags,
          content: event.content,
          pubkey: event.pubkey
        };
        Utils.log('Requesting NIP-07 signature for event:', unsignedEvent);
        const signedEvent = await call('signEvent', unsignedEvent);
        // What comes back crossed the page's MAIN world, so it is
        // attacker-controlled until proven otherwise — an unguessable id
        // raises the cost of forging a reply but is not the control.
        // Verify what we actually care about: that this is OUR event,
        // signed by the key we asked to sign it.
        if (!signedEvent || typeof signedEvent !== 'object') {
          throw new Error('the signer returned no event');
        }
        if (signedEvent.pubkey !== unsignedEvent.pubkey) {
          throw new Error('the returned event is signed by a different key than the one requested');
        }
        for (const field of ['kind', 'created_at', 'content']) {
          if (JSON.stringify(signedEvent[field]) !== JSON.stringify(unsignedEvent[field])) {
            throw new Error(`the signer altered the event's ${field}`);
          }
        }
        if (JSON.stringify(signedEvent.tags) !== JSON.stringify(unsignedEvent.tags)) {
          throw new Error("the signer altered the event's tags");
        }
        // Recomputes the id from the content and checks BIP-340, so a
        // forged reply cannot pass without the private key.
        if (!(await Crypto.verifySignature(signedEvent))) {
          throw new Error('the returned signature did not verify');
        }
        Utils.log('Got signed event from NIP-07:', signedEvent);
        return signedEvent;
      } catch (e) {
        Utils.error('NIP-07 signing failed:', e);
        throw new Error('Signing failed: ' + e.message);
      }
    },

    getRelays: async () => {
      if (!Client.checkAvailability()) return null;
      try { return await call('getRelays'); }
      catch (e) { Utils.log('Could not get relays from NIP-07:', e); return null; }
    }
  };

  return Client;
})();
