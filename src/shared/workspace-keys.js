// Workspace boundary lists — Phase 28.1
// (docs/CASE_BOUND_WORKSPACES_KICKOFF.md §2/§4). Split out of
// identity-profiles.js so storage.js can consult the boundary without
// an import cycle (identity-profiles → storage). identity-profiles
// re-exports all three names — every existing import keeps working and
// the pin tests keep pinning.
//
// THE RULE: a key/database on these lists is WORKSPACE CONTENT — it is
// namespaced by the active workspace, cleared by workspace reset, and
// (for WORKSPACE_DATABASES) covered by backups. Everything else is
// per-install configuration or identity.

// chrome.storage.local keys holding captured or authored CONTENT (and
// its publish stamps), plus the per-workspace key registry and the
// portal's pasted viewer npubs. Extend when a new content store ships.
export const WORKSPACE_CONTENT_KEYS = Object.freeze([
    'entities',                 // entity records (keypairs joined from local_keys)
    'local_keys',               // per-entity keys + the xray:user sync key
    'article_claims',           // claims + their publish stamps
    'evidence_links',           // 30055 edges + attestation metadata
    'claim_assessments',        // 30054 assessments
    'behavioral_findings',      // 30062 forensic findings
    'adjudicable_propositions', // Phase 15 propositions
    'adjudicated_verdicts',     // Phase 15 verdict chains
    'integrity_findings',       // Phase 15 words-vs-deeds findings
    'platform_accounts',        // Phase 9 account registry
    'portal_identities',        // portal viewer npubs (pasted, read-only)
    'lens_jurisdictions',       // Phase 16 jurisdiction registry + corpora
    'url_aliases',              // URL alias map (url-aliases.js) — derived
                                // from captured content, so workspace data
    'entity_fact_dismissals',   // RETIRED (2026-07-20, with the fact
                                // layer) — kept listed so workspace
                                // clears still purge legacy data
    'entity_dedupe_dismissals', // Phase 17A "Not duplicates" record
    'follow_sets',              // Phase 25 follow registry
    'incorporated_artifacts',   // Phase 25.3 reviewed-in foreign artifacts
    'incorporation_dismissals', // Phase 25.3 declined proposals
    'case_hypotheses',          // Phase 26 hypothesis records
    'hypothesis_edges',         // Phase 26 claim→hypothesis edges
    'published_mentions'        // E4 mention-note idempotence ledger —
                                // publish stamps for THIS workspace's corpus
]);

// IndexedDB databases holding workspace content. Doubles as the BACKUP
// coverage list (backup.js) — derived caches stay off it.
export const WORKSPACE_DATABASES = Object.freeze([
    'xray-archive',             // captured article cache (archive-cache.js)
    'xray-audits',              // audit records — PRECIOUS
    'xray-events'               // signed-event journal (event-journal.js)
]);

// Derived, rebuildable relay caches: never backed up, but cleared by
// workspace reset and namespaced per workspace (2026-07-19 incident —
// an unscoped cache resurfaced the previous project's entire corpus).
export const DERIVED_CACHE_DATABASES = Object.freeze([
    'xray-portal',              // portal event cache (portal-cache.js)
    'xray-network'              // Phase 25 network cache
]);

/**
 * The on-disk IndexedDB name for `base` in workspace `wsId`. The
 * DEFAULT workspace keeps the bare name — existing installs' data IS
 * the default workspace, so introducing workspaces migrates nothing.
 */
export function workspaceDbName(base, wsId) {
    return (!wsId || wsId === 'default') ? base : `${base}::${wsId}`;
}

/**
 * The active workspace id, read straight from extension storage —
 * call-time only, no import-time chrome dependency, so the
 * dependency-light IDB cache modules can use it and their Node tests
 * (no chrome stub) fall back to 'default' = the bare DB names they
 * have always used. storage.js keeps its own CACHED copy for hot
 * key-mapping; DB opens are rare enough to read fresh.
 */
export async function activeWorkspaceId() {
    try {
        const area = (typeof browser !== 'undefined' && browser.storage)
            ? browser.storage.local
            : (typeof chrome !== 'undefined' && chrome.storage ? chrome.storage.local : null);
        if (!area) return 'default';
        const raw = await new Promise((resolve) => {
            try { area.get(['active_workspace'], (res) => resolve(res ? res.active_workspace : undefined)); }
            catch (_) { resolve(undefined); }
        });
        if (typeof raw === 'string') {
            try { return String(JSON.parse(raw) || 'default'); } catch (_) { return raw || 'default'; }
        }
        return 'default';
    } catch (_) { return 'default'; }
}

/** `workspaceDbName(base)` under the ACTIVE workspace. */
export async function resolveActiveDbName(base) {
    return workspaceDbName(base, await activeWorkspaceId());
}
