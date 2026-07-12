// url-aliases.js — the general URL alias layer.
//
// Lots of addresses serve the SAME document as its canonical URL:
// archive mirrors, cache proxies, AMP caches, paywall strippers — and
// sites the structural resolver (url-identity.js) has never heard of.
// Every URL-keyed join in X-Ray (claims, archive rows, audits) forks
// when the same piece is reached through two addresses. This module is
// the healing map: normalized-alias → normalized-original, persisted
// under the `url_aliases` storage key.
//
// Aliases are OBSERVATIONS, recorded whenever an original is actually
// learned: a successful structural recovery at capture, a relay
// read-back whose event carries a capture-url tag, or the user's
// manual "Set original URL…" in the reader. Resolution is one hop by
// construction — recording flattens chains and refuses cycles — and
// resolving a URL nobody aliased returns it unchanged (idempotent),
// so callers can resolve unconditionally.
//
// Both ends go through the unified normalizer (Utils.normalizeUrl →
// metadata/url-normalizer.js), the same keying every join uses.

import { Storage } from './storage.js';
import { Utils } from './utils.js';

const KEY = 'url_aliases';
const MAX_HOPS = 5;   // defensive bound; writes keep the map flat anyway

function norm(url) {
    try { return Utils.normalizeUrl(String(url || '')) || ''; }
    catch (_) { return ''; }
}

/**
 * Pure resolution over an already-loaded map. Normalizes the input;
 * returns the terminal original, or the (normalized) input itself when
 * nothing aliases it. Cycle-safe via a visited set + hop bound.
 */
export function resolveWithMap(map, url) {
    let cur = norm(url);
    if (!cur || !map) return cur;
    const seen = new Set([cur]);
    for (let i = 0; i < MAX_HOPS; i++) {
        const next = map[cur];
        if (!next || seen.has(next)) break;
        seen.add(next);
        cur = next;
    }
    return cur;
}

/** The raw map — load once when resolving in a loop. */
export async function loadAliasMap() {
    const map = await Storage.get(KEY, {});
    return (map && typeof map === 'object') ? map : {};
}

/**
 * Resolve one URL through the alias map. Idempotent: a URL with no
 * alias entry comes back as itself (normalized).
 */
export async function resolveAlias(url) {
    return resolveWithMap(await loadAliasMap(), url);
}

/**
 * Record that `aliasUrl` is an address of `originalUrl`. Both ends are
 * normalized; self-aliases and invalid URLs are no-ops; a record that
 * would create a cycle is refused (returns false). Writes flatten:
 * the stored value is always the TERMINAL original, and any existing
 * entries pointing at the new alias are re-pointed, so lookups stay
 * one hop and cycles cannot form incrementally.
 */
export async function recordAlias(aliasUrl, originalUrl) {
    const alias = norm(aliasUrl);
    const original = norm(originalUrl);
    if (!alias || !original || alias === original) return false;

    const map = await loadAliasMap();
    const terminal = resolveWithMap(map, original);
    if (terminal === alias) return false;   // A→B when B→…→A — refuse
    if (map[alias] === terminal) return true;   // already known

    map[alias] = terminal;
    for (const [k, v] of Object.entries(map)) {
        if (v === alias) map[k] = terminal;   // keep the map flat
    }
    await Storage.set(KEY, map);
    return true;
}
