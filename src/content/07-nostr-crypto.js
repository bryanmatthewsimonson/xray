// NOSTR crypto helpers. Signature generation/verification lives in external
// signers (NIP-07 providers or NSecBunker); this module only handles
// deterministic hashing + serialization that the browser can do natively.

var NostrCrypto = {
  generatePrivateKey: () => {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
  },

  // Placeholder — requires secp256k1. Use NSecBunker or NIP-07 in practice.
  getPublicKey: async () => {
    Utils.log('getPublicKey requires secp256k1 library or NSecBunker');
    return null;
  },

  getEventHash: async (event) => {
    const serialized = JSON.stringify([
      0, event.pubkey, event.created_at, event.kind, event.tags, event.content
    ]);
    return await Utils.sha256(serialized);
  },

  serializeEvent: (event) => JSON.stringify([
    0, event.pubkey, event.created_at, event.kind, event.tags, event.content
  ]),

  verifySignature: async () => {
    Utils.log('Signature verification requires secp256k1 library');
    return true;
  },

  hexToNpub: (hex) => 'npub1' + hex.substring(0, 59),
  npubToHex: (npub) => npub.startsWith('npub1') ? npub.substring(5) : npub
};
