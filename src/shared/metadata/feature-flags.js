// Feature flags — Phase 9a Day 5.
//
// Spec: Implementation Plan §14.
//
// Single source of truth for which features are user-visible.
//
// Reader-side: the SW always accepts incoming events of every kind.
// Only PUBLISH paths and panel TABS are gated.
//
// Override mechanism:
//   chrome.storage.local key `xray:flags`, plain object of
//   `{ flagName: boolean }`. Flags without an Options control are
//   flipped via DevTools — see docs/ROAD_TO_1_0.md B10.
//
// RETIRED 2026-08-09 (T3, ratified): eight keys that no isEnabled()
// call ever read — annotations, respondsTo, topicTrust, factchecks,
// ratings, helpfulnessVoting, bridgingRanking, transitiveTrust. Three
// defaulted TRUE, so they read as live guarantees while guaranteeing
// nothing, and a third of the registry being noise is what made the
// real promote-or-kill questions invisible. Names kept here in the
// record (Art. 3); a stale `xray:flags` override for one of them is
// ignored by sanitize() and needs no migration.
//
// `respondsTo` is the trap in that list: the FLAG was dead, but the
// responds-to TAG is emitted on every kind-30023
// (event-builder.js:262-273) and is untouched.

export const FLAGS_DEFAULTS = Object.freeze({
  // Phase 9a survivor — read at src/network/index.js:811 (the feed's
  // trusted-provenance narrow toggle).
  trustGraphFilter: true,

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
  // PUBLISH paths for the kind-0 entity profile and the E4 kind-1
  // mention notes. ENTITY KEYS SIGN these, relays are public, and
  // publication is irrevocable in practice (NIP-09 deletion is
  // best-effort only) — the Options disclosure says all of this.
  // Local dossiers are never gated — they're the product. (The
  // kind-30067 fact sheet this flag once also gated retired
  // 2026-07-20 with the fact layer; `readerAddFact`, which gated the
  // Add-fact button, is removed outright.)
  entityCorpusPublishing: false,

  // Phase 20.4 (docs/CASE_SYNTHESIS_DESIGN.md) — gates the portal case
  // dashboard's "Analyze corpus" LLM synthesis (a grounded brief +
  // reviewable proposals over ALL member articles). Requires `llmAssist`
  // AND the API key on top: a corpus run sends every member article to
  // Anthropic (N× a suggest pass), so it carries its own consent gate.
  // The brief is local-only — no wire kind; proposals materialize as
  // ordinary 30040/30055 through the normal publish paths.
  caseSynthesis: false,

  // (`autoPreAnalyze` — the Phase-28 opt-in map prepay riding the
  // Suggest click — RETIRED in UA.3, 2026-08-12: since the One
  // Article Pass, EVERY Suggest click runs the one cache-first map
  // call, so "also prepay the map" became the click's ordinary
  // meaning and the flag gated nothing. Art. 3: recorded in JOURNAL,
  // git-recoverable, re-arguable. loadFlags drops unknown stored
  // overrides silently, so stale `xray:flags` entries are inert.)

  // AI vision (post-28): gates the reader's "Describe images" surface —
  // per-image OCR transcription + captioning via the Anthropic vision
  // API (`xray:vision:describe`). Independent of `llmAssist` (its
  // consent covers the article TEXT leaving the device; this one covers
  // the article's IMAGES), and additionally requires the shared
  // user-supplied API key. Every run is an explicit per-click action
  // with an image-count confirm, and every caption/transcription is a
  // proposal the human accepts per image — accepted notes merge into
  // the body WITH the model id inline, so provenance survives publish.
  aiVision: false,

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
  followListPublishing: false,

  // Local transcription (docs/JOURNAL.md "YouTube DOM arms race" is
  // the why): gates the "Capture & transcribe locally" context-menu
  // item and the reader's Transcribe button, both of which talk to the
  // loopback companion service (companion/transcriber/, yt-dlp →
  // WhisperX → pyannote on 127.0.0.1). Nothing leaves the machine;
  // the flag exists because the surface is useless without the
  // companion installed. Ordinary YouTube captures are never gated.
  localTranscription: false,

  // The optional LM Studio post-pass over a finished local transcript:
  // drafts claim candidates via a LOOPBACK OpenAI-compatible endpoint
  // (localhost:1234). Distinct from llmAssist (Anthropic, paid, its
  // own key) — this one is local-only and free. Every suggestion still
  // goes through the human-accept review modal; nothing auto-mints.
  transcriptClaimDrafts: false,

  // Phase 29.1 (docs/EVENT_STORE_DESIGN.md §3.2, §9): gates STORE-FIRST
  // publishing in publish-gate.js — journal the signed event as a
  // 'pending' outbox row BEFORE the relay attempt, so a publish no
  // relay accepts can never lose the signature. Off = today's behavior
  // byte-for-byte (attempt first; journal only where a site journaled
  // before). A publish-path change, so it ships default-off until the
  // §12 smoke rows pass (Q2 2026-08-02: smoke is sufficient, no soak).
  storeFirstPublish: false,

  // MA.6 (docs/MAP_ARTIFACT_KICKOFF.md §MA.6, docs/NIP_DRAFT.md
  // §Kind 30070): gates the PUBLISH path for kind 30070 — one
  // article's extraction analysis (its machine-proposed load-bearing
  // spans with the publisher's review state on each, the outside
  // sources it leans on, what it leaves open). The local extraction
  // layer, its review surfaces, and the backup merge-import are never
  // gated — they're the product.
  //
  // This flag is a REAL gate, not a formality: the maintainer's
  // 2026-07-29 posture publishes the WHOLE extraction unit — every
  // atom in every review state, WITH the model's prose — because a
  // filter a reader cannot see cannot be audited. What keeps that
  // honest is the MARKING (a required per-row `status`, model prose
  // confined to `model_`-prefixed keys, endorsement expressible only
  // as a coordinate to a separately signed claim), not a narrow
  // projection. So the default stays off, and turning it on is a
  // decision about disclosure rather than a convenience.
  extractionAnalysisPublishing: false
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
