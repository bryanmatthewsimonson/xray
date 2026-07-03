// Build identification — which build is actually loaded.
//
// The manifest version is ambiguous during development (every feature
// branch carries the same x.y.z), which makes "am I running the build
// I think I am?" unanswerable from the UI — exactly the failure mode
// of loading a stale bundle and hunting for a feature it predates.
// esbuild injects the __XRAY_BUILD_INFO__ define (version + git branch
// + short commit + '+dirty' marker + build timestamp; see
// esbuild.config.mjs); this module is the one reader of it, degrading
// gracefully when the define is absent (unit tests import source
// directly, unbundled) or git was unavailable at build time.

/**
 * The build stamp, or nulls where unknown.
 *
 * @returns {{version: string, branch: string|null, commit: string|null, builtAt: string|null}}
 */
export function getBuildInfo() {
    let stamp = null;
    try {
        // Replaced by esbuild's define in bundles; undefined in raw source.
        // eslint-disable-next-line no-undef
        stamp = typeof __XRAY_BUILD_INFO__ !== 'undefined' ? JSON.parse(__XRAY_BUILD_INFO__) : null;
    } catch (_) { stamp = null; }
    let manifestVersion = '';
    try {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest) {
            manifestVersion = chrome.runtime.getManifest().version || '';
        }
    } catch (_) { /* stays '' */ }
    return {
        version: manifestVersion || (stamp && stamp.version) || '',
        branch:  (stamp && stamp.branch) || null,
        commit:  (stamp && stamp.commit) || null,
        builtAt: (stamp && stamp.builtAt) || null
    };
}

/**
 * One-line human form: `v0.6.0 · claude/phase-15-x @ 88d4a66 · built
 * 2026-07-02 06:12 UTC`. Segments degrade independently; an empty
 * stamp yields just the version (or 'unknown build').
 *
 * @returns {string}
 */
export function formatBuildInfo(info = getBuildInfo()) {
    const bits = [];
    if (info.version) bits.push(`v${info.version}`);
    if (info.branch && info.commit) bits.push(`${info.branch} @ ${info.commit}`);
    else if (info.commit) bits.push(`@ ${info.commit}`);
    if (info.builtAt) {
        const d = new Date(info.builtAt);
        if (!Number.isNaN(d.getTime())) {
            bits.push(`built ${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`);
        }
    }
    return bits.length ? bits.join(' · ') : 'unknown build';
}
