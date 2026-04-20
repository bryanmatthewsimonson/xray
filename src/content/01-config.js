// Global configuration. Shared across content script modules via the
// isolated-world `window` (each content script in the array is loaded in
// order into the same isolated world, so `var`/`const` at the top level
// is visible to later scripts).

var CONFIG = {
  version: '1.8.0',
  debug: true,

  nsecbunker: {
    defaultUrl: 'ws://localhost:5454',
    timeout: 30000
  },

  relays: [
    { url: 'wss://relay.damus.io',       read: true, write: true, enabled: true  },
    { url: 'wss://nos.lol',              read: true, write: true, enabled: true  },
    { url: 'wss://relay.nostr.band',     read: true, write: true, enabled: true  },
    { url: 'wss://relay.snort.social',   read: true, write: true, enabled: false },
    { url: 'wss://nostr.wine',           read: true, write: true, enabled: false }
  ],

  ui: {
    fabPosition: { bottom: '20px', right: '20px' },
    panelWidth: '600px',
    panelMaxHeight: '90vh',
    theme: 'dark'
  },

  extraction: {
    minContentLength: 200,
    maxTitleLength: 200,
    maxSummaryLength: 500
  }
};
