// Global configuration. Imported by whichever bundle needs it.
// Used by: shared/utils.js, shared/storage.js, shared/nostr-client.js,
// content/ui.js, background/index.js (indirectly via the above).

export const CONFIG = {
    version: '0.2.0',
    debug: true,

    nsecbunker: {
        defaultUrl: 'ws://localhost:5454',
        timeout: 30000
    },

    relays: [
        { url: 'wss://relay.damus.io',     read: true, write: true, enabled: true  },
        { url: 'wss://nos.lol',            read: true, write: true, enabled: true  },
        { url: 'wss://relay.nostr.band',   read: true, write: true, enabled: true  },
        { url: 'wss://relay.snort.social', read: true, write: true, enabled: false },
        { url: 'wss://nostr.wine',         read: true, write: true, enabled: false }
    ],

    ui: {
        fabPosition: { bottom: '20px', right: '20px' },
        panelWidth: '600px',
        panelMaxHeight: '90vh',
        theme: 'dark'
    },

    extraction: {
        // snake_case keys match the v4 userscript for drop-in portability
        // of content-extractor.js and related modules.
        min_content_length: 200,
        max_title_length: 300,
        // camelCase legacy aliases kept for compatibility with pre-Phase-2
        // X-Ray callers. Safe to remove once nothing references them.
        minContentLength: 200,
        maxTitleLength: 300,
        maxSummaryLength: 500
    },

    articleCache: {
        enabled: true,
        maxSizeBytes: 100 * 1024 * 1024, // 100MB budget (Phase 7 uses IndexedDB)
        evictionTarget: 0.75,
        compressionThreshold: 100000
    },

    tagging: {
        selection_debounce_ms: 300,
        min_selection_length: 2,
        max_selection_length: 100,
        max_claim_length: 500
    }
};

// Shared mutable state (Phase 3+ platform handlers may use this).
export const _state = { fabRef: null };
