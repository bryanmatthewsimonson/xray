// Feature flags — Phase 9a Day 5.
//
// Spec: Implementation Plan §14.
//
// Single source of truth for which Phase 9 features are user-visible.
// Day-1 motivations:
//   - Scaffold the deferred kinds (30051 / 30052 / 9803) in Phase 9a
//     so the data pipes are tested and the schemas are correct.
//     Flipping `factchecks: true` in 9b becomes a UI-surface change,
//     not a data-model change. Same for ratings / helpfulnessVoting.
//   - Reader-side: the SW always accepts incoming events of every
//     kind. Only PUBLISH paths and panel TABS are gated. So a user
//     who flips the flag manually starts contributing to the bridging
//     dataset before the v3 ranker ships.
//
// Override mechanism:
//   chrome.storage.local key `xray:flags`, plain object of
//   `{ flagName: boolean }`. The Advanced settings tab will expose a
//   "show experimental flags" disclosure in Week 2; for now flags
//   can be flipped via DevTools.

export const FLAGS_DEFAULTS = Object.freeze({
  // Live in 9a:
  annotations: true,
  respondsTo: true,
  topicTrust: true,
  trustGraphFilter: true,

  // Scaffolded but UI-gated in 9a; flip in 9b/9c:
  factchecks: false,
  ratings: false,
  helpfulnessVoting: false, // UI gate; SW always accepts incoming votes
  bridgingRanking: false,   // v3
  transitiveTrust: false    // v2
});

/**
 * In-memory flag cache. Populated by `loadFlags`; refreshed when the
 * SW receives a `xray:flags:reload` ping. Read with `isEnabled()`.
 */
let _flags = { ...FLAGS_DEFAULTS };

/**
 * Hydrate the in-memory flag cache from chrome.storage.local. Safe to
 * call multiple times. Falls back to defaults on read error.
 *
 * @returns {Promise<typeof FLAGS_DEFAULTS>} the resolved flag map
 */
export async function loadFlags() {
  try {
    const overrides = await readOverridesFromStorage();
    _flags = { ...FLAGS_DEFAULTS, ...sanitize(overrides) };
  } catch (_) {
    _flags = { ...FLAGS_DEFAULTS };
  }
  return _flags;
}

/**
 * Synchronous read for hot paths. Returns the last value loaded by
 * `loadFlags` (or the defaults if `loadFlags` has never been called).
 *
 * @param {keyof typeof FLAGS_DEFAULTS} flag
 * @returns {boolean}
 */
export function isEnabled(flag) {
  if (!Object.prototype.hasOwnProperty.call(FLAGS_DEFAULTS, flag)) return false;
  return _flags[flag] === true;
}

/**
 * Returns a snapshot of the current flag map (for diagnostics / the
 * Advanced settings tab UI).
 */
export function snapshot() {
  return { ..._flags };
}

/**
 * Persist a flag override. Used by the Advanced settings tab. Pass
 * `value === null` to revert to the default.
 *
 * @param {keyof typeof FLAGS_DEFAULTS} flag
 * @param {boolean | null} value
 * @returns {Promise<void>}
 */
export async function setOverride(flag, value) {
  if (!Object.prototype.hasOwnProperty.call(FLAGS_DEFAULTS, flag)) {
    throw new Error('Unknown flag: ' + flag);
  }
  const overrides = (await readOverridesFromStorage()) || {};
  if (value === null) delete overrides[flag];
  else overrides[flag] = !!value;
  await writeOverridesToStorage(overrides);
  await loadFlags();
}

/**
 * Reset all overrides. Useful for tests and "restore defaults" UI.
 */
export async function resetOverrides() {
  await writeOverridesToStorage({});
  await loadFlags();
}

// ------------------------------------------------------------------
// Storage shim
// ------------------------------------------------------------------

const STORAGE_KEY = 'xray:flags';

function readOverridesFromStorage() {
  return new Promise((resolve) => {
    const area = chromeStorage();
    if (!area) return resolve({});
    try {
      area.get([STORAGE_KEY], (res) => {
        const raw = res && res[STORAGE_KEY];
        if (raw === undefined || raw === null) return resolve({});
        if (typeof raw === 'string') {
          try { return resolve(JSON.parse(raw) || {}); } catch (_) { return resolve({}); }
        }
        if (typeof raw === 'object') return resolve(raw || {});
        return resolve({});
      });
    } catch (_) { resolve({}); }
  });
}

function writeOverridesToStorage(overrides) {
  return new Promise((resolve) => {
    const area = chromeStorage();
    if (!area) return resolve();
    try {
      area.set({ [STORAGE_KEY]: JSON.stringify(overrides || {}) }, () => resolve());
    } catch (_) { resolve(); }
  });
}

function chromeStorage() {
  if (typeof browser !== 'undefined' && browser.storage && browser.storage.local) {
    return browser.storage.local;
  }
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    return chrome.storage.local;
  }
  return null;
}

function sanitize(overrides) {
  const out = {};
  if (!overrides || typeof overrides !== 'object') return out;
  for (const key of Object.keys(FLAGS_DEFAULTS)) {
    if (typeof overrides[key] === 'boolean') out[key] = overrides[key];
  }
  return out;
}
