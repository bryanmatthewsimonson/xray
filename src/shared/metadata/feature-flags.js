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
  transitiveTrust: false,   // v2

  // Phase 11 (docs/ASSESSMENTS_DESIGN.md): gates the PUBLISH paths for
  // kind 30054 assessments, kind 30055 claim relationships, and the
  // kind-1985 label mirror. Local capture/badges/rollups/export are
  // never gated — they're the product.
  assessmentPublishing: false,

  // Phase 13 (docs/EPISTEMIC_AUDIT_DESIGN.md): gates the PUBLISH paths
  // for the audit kinds (30056 module results, 30057 aggregate audits,
  // and the 30058–30061 family as their slices land). Local
  // import/render/ledger is never gated — the Phase 11 split. Audit
  // EXECUTION additionally requires a user-supplied API key, which is
  // its own consent gate on top of this flag.
  epistemicAuditing: false,

  // Phase 14 (docs/CRIMINOLOGY_DESIGN.md): gates the PUBLISH paths for
  // kind 30062 behavioral findings, their kind-1985 maneuver mirror, and
  // the `revision/*` story-change edges on kind 30055. Local capture /
  // baselines / rollups are never gated — they're the product.
  forensicPublishing: false,

  // Phase 15 (docs/TRUTH_ADJUDICATION_DESIGN.md): gates the PUBLISH
  // paths for kind 30063 adjudicated verdicts, their kind-1985 mirror,
  // and kind 30064 integrity findings. Local atomization / verdicts /
  // findings / entity records are never gated — they're the product.
  truthAdjudicationPublishing: false,

  // Phase 14.5 (docs/PHASE_14_5_LLM_ASSIST_KICKOFF.md): gates the
  // in-extension LLM-assist suggestion pass — the reader "Suggest…"
  // control + the `xray:llm:suggest` background call to the Anthropic
  // Messages API. Off by default, AND requires a user-supplied API key
  // (a second consent gate, since the article text leaves the device).
  // The feature only ever PROPOSES artifacts for human review; nothing
  // auto-saves and nothing auto-publishes — publishing stays behind the
  // existing assessmentPublishing / forensicPublishing flags.
  llmAssist: false,

  // Knowledge Sharing KS.2 (docs/KNOWLEDGE_SHARING_DESIGN.md §3): gates
  // the PUBLISH path for kind 32126 platform-account identity events —
  // the deterministic cross-user person rendezvous. Publishing
  // discloses your captured-account → entity link graph, so it is
  // opt-in. The local account registry is never gated.
  platformAccountPublishing: false,

  // Phase 16 (docs/MORAL_LENS_JURISDICTION_DESIGN.md §6): gates the
  // reader's lens-reading surface — the per-jurisdiction perspectival
  // reading of normative/evaluative/framing assertions. Independent of
  // `llmAssist` (its `enabled` bit means Suggest, a different consent),
  // and additionally requires the user-supplied API key: a lens pass
  // sends the article text PLUS the jurisdiction definitions and
  // captured authority excerpts to Anthropic. Derived view only —
  // nothing is durably saved, nothing is published, no wire kind
  // exists (30066 is left free, guard-tested).
  moralLens: false,

  // Phase 19.7 (docs/ENTITY_DOSSIER_DESIGN.md §6, ECD §4.5): gates the
  // PUBLISH paths for the enriched kind-0 entity profile and the
  // kind-30067 entity fact sheet. ENTITY KEYS SIGN these, relays are
  // public, and publication is irrevocable in practice (NIP-09
  // deletion is best-effort only) — the Options disclosure says all
  // of this. Local dossiers / facts / conflicts are never gated —
  // they're the product. Hard prereq honored: Phase 17A (E1 dedupe +
  // E3 canonical sweep) shipped first.
  entityCorpusPublishing: false,

  // Phase 19.5 — gates the reader tagger popover's "Add fact" button
  // (the structured-fact capture entry). Purely a UI-visibility gate:
  // the fact flow, records, 30040 fact tags, and dossier assembly are
  // unchanged. Off by default because the button crowds the popover
  // and facts are a power-user surface.
  readerAddFact: false,

  // Phase 20.4 (docs/CASE_SYNTHESIS_DESIGN.md) — gates the portal case
  // dashboard's "Analyze corpus" LLM synthesis (a grounded brief +
  // reviewable proposals over ALL member articles). Requires `llmAssist`
  // AND the API key on top: a corpus run sends every member article to
  // Anthropic (N× a suggest pass), so it carries its own consent gate.
  // The brief is local-only — no wire kind; proposals materialize as
  // ordinary 30040/30055 through the normal publish paths.
  caseSynthesis: false,

  // Phase 27 K.4: the `#xray:capture` URL marker — a driving agent's
  // capture trigger (the connector can neither reach extension pages
  // nor fire the command shortcut, so navigation is the only verb it
  // has). Gates ONLY the marker; the toolbar/shortcut/menu capture
  // paths are unconditional as ever. Captures pages, nothing more.
  captureAutomation: false,

  // Phase 25 (docs/NETWORK_CLIENT_DESIGN.md §8): gates the Network
  // SURFACE — the standalone follows-feed page, its context-menu item,
  // and the options/sidepanel links. Reading relays is not a
  // disclosure beyond what the portal already does, but the surface
  // ships default-off while the phase is in flight. Publish
  // affordances inside it carry their own flags (reviewCoordination,
  // followListPublishing) as those slices land.
  networkPage: false,

  // Phase 25.4 (NETWORK_CLIENT_DESIGN §6): gates the KS.6 PUBLISH
  // affordances — the "Request review" xray/review kind-1985 label
  // (portal inspector) and the Network page's re-broadcast-who-you-
  // follow button. Reading/assembling the review queue is never gated.
  reviewCoordination: false,

  // Phase 25.6 (amended KNOWLEDGE_SHARING §9): gates the kind-3
  // NIP-02 follow-list mirror — publishing WHO YOU FOLLOW under your
  // primary identity, replaceable but irrevocable in practice. Global
  // scope only (case/entity follow sets never publish); every publish
  // merges with the current remote kind 3 first (never blind-replace,
  // for users who also run another client on the same nsec). The
  // options checkbox shows a consent dialog on first enable.
  followListPublishing: false
});

/**
 * In-memory flag cache. Populated by `loadFlags`. There is no reload
 * broadcast — callers `await loadFlags()` immediately before each
 * `isEnabled()` gate so a sleeping/woken SW never reads stale flags.
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
