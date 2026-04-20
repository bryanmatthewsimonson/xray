// Runs in the page's MAIN world. Bridges window.nostr (NIP-07 providers like
// Alby, nos2x) to the content script via window.postMessage. The content
// script cannot see window.nostr directly because it lives in an isolated
// world, so we relay requests through a tagged postMessage protocol.

(function () {
  'use strict';

  const TAG = 'XRAY_NIP07';

  function available() {
    return typeof window !== 'undefined' && !!window.nostr;
  }

  async function handle(method, args) {
    if (!available()) throw new Error('No NIP-07 provider (window.nostr) is available on this page.');
    switch (method) {
      case 'getPublicKey':
        return await window.nostr.getPublicKey();
      case 'signEvent':
        return await window.nostr.signEvent(args[0]);
      case 'getRelays':
        return typeof window.nostr.getRelays === 'function' ? await window.nostr.getRelays() : {};
      case 'nip04Encrypt':
        if (!window.nostr.nip04 || !window.nostr.nip04.encrypt) throw new Error('nip04 not supported');
        return await window.nostr.nip04.encrypt(args[0], args[1]);
      case 'nip04Decrypt':
        if (!window.nostr.nip04 || !window.nostr.nip04.decrypt) throw new Error('nip04 not supported');
        return await window.nostr.nip04.decrypt(args[0], args[1]);
      case 'probe':
        return { available: available() };
      default:
        throw new Error('Unknown NIP-07 method: ' + method);
    }
  }

  window.addEventListener('message', async (ev) => {
    if (ev.source !== window) return;
    const data = ev.data;
    if (!data || data.tag !== TAG || data.direction !== 'req') return;
    const { id, method, args } = data;
    try {
      const result = await handle(method, args || []);
      window.postMessage({ tag: TAG, direction: 'res', id, ok: true, result }, '*');
    } catch (err) {
      window.postMessage({
        tag: TAG,
        direction: 'res',
        id,
        ok: false,
        error: err && err.message ? err.message : String(err)
      }, '*');
    }
  });

  // Advertise that the bridge is ready so the content script can probe lazily.
  try {
    window.postMessage({ tag: TAG, direction: 'ready', available: available() }, '*');
  } catch (_) { /* ignore */ }
})();
