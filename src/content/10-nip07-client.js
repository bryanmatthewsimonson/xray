// NIP-07 client. In the userscript this touched unsafeWindow.nostr
// directly; in MV3 the content script runs in an isolated world and
// cannot see page globals. We talk to src/page/nip07-bridge.js (injected
// into the MAIN world via the manifest) through tagged window.postMessage.

var NIP07Client = (() => {
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

  const call = (method, ...args) => new Promise((resolve, reject) => {
    const id = ++reqSeq;
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
