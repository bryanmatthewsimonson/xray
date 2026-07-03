// Global configuration. Imported by whichever bundle needs it.
// Used by: shared/utils.js, shared/storage.js, shared/nostr-client.js,
// content/ui.js, background/index.js (indirectly via the above).

export const CONFIG = {
    // Kept in lockstep with manifest.json/package.json by
    // `npm run version:set` (scripts/set-version.mjs).
    version: '0.6.0',
    // Off by default — users who want noise can flip
    // `preferences.debug` in the options page Advanced tab.
    debug: false,

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

/**
 * Apply user-supplied overrides from `preferences.config_overrides` onto
 * the in-memory CONFIG object. Keeps the rest of the codebase reading
 * CONFIG.* synchronously while honoring Settings → Advanced changes.
 *
 * Called once after Storage.initialize() in every entry-point bundle.
 * Idempotent: blank fields fall back to factory defaults.
 */
export function applyConfigOverrides(overrides) {
    if (!overrides || typeof overrides !== 'object') return;
    if (typeof overrides.article_cache_enabled === 'boolean') {
        CONFIG.articleCache.enabled = overrides.article_cache_enabled;
    }
    if (Number.isFinite(overrides.article_cache_budget_mb) && overrides.article_cache_budget_mb > 0) {
        CONFIG.articleCache.maxSizeBytes = overrides.article_cache_budget_mb * 1024 * 1024;
    }
    if (Number.isFinite(overrides.min_content_length) && overrides.min_content_length >= 0) {
        CONFIG.extraction.min_content_length = overrides.min_content_length;
        CONFIG.extraction.minContentLength = overrides.min_content_length;
    }
    if (Number.isFinite(overrides.max_claim_length) && overrides.max_claim_length > 0) {
        CONFIG.tagging.max_claim_length = overrides.max_claim_length;
    }
}
