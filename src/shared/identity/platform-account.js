// Platform-account identity core — Phase 9 identity layer, Phase I.
//
// The generalized methodology for turning a captured social-media author
// (a commenter, a post author) into a STABLE, cross-capture, cross-device
// identity that can be referenced from NOSTR events and, later, linked to
// a canonical person (entity).
//
// The pipeline, top to bottom:
//
//   handler-specific raw author object
//        │  resolveStableId(platform, raw)      ← per-platform precedence
//        ▼
//   { platform, stableId, handle, displayName, profileUrl, avatarUrl, verified }
//        │  deriveAccountPubkey(platform, stableId)   ← deterministic
//        ▼
//   accountPubkey  (a curve point; an IDENTIFIER, never a signing key)
//        │  makeAccountRecord(...)
//        ▼
//   PlatformAccount record  → Storage.platformAccounts (chrome.storage)
//        │  (Phase IV) link to entity → kind 32126 linked-entity
//        ▼
//   canonical person via the entity alias system
//
// ── The deterministic pubkey, and why it is safe ──────────────────────
//
// accountPubkey = getPublicKey( sha256("xray:platform-account:v1:" +
//                                       platform + ":" + stableId) )
//
// Properties:
//   • Deterministic — the same (platform, stableId) yields the same
//     pubkey forever, on every device, for every user who captures that
//     account. That is what makes a commenter's `p`-tag dedup-able and
//     queryable across captures (the global join key).
//   • Guessable — anyone who knows the handle can derive it. This is
//     FINE because the pubkey is only ever used as an IDENTIFIER (a
//     `p`-tag reference). It is NEVER a signing identity.
//
// HARD INVARIANT: the derived private key is computed transiently and
// discarded. It is never stored, never returned, never used to sign.
// kind 32126 PlatformAccount events and comment events are authored and
// signed by the CAPTURING USER's own key; the account pubkey appears
// only as a `p` reference. If anyone ever signed an event AS an account
// pubkey it would be meaningless noise — nothing queries for events
// signed by an account pubkey, only events that reference one.

import { Utils } from '../utils.js';
import { Crypto } from '../crypto.js';

// Domain separation tag. Bump the version suffix only if the derivation
// scheme changes — doing so re-namespaces EVERY account pubkey, so it is
// a breaking change to the identity graph. Treat as frozen.
const DERIVATION_DOMAIN = 'xray:platform-account:v1:';

// Per-platform stable-identifier precedence. The FIRST field present on
// the raw author object wins. A platform absent from this map, or a raw
// object carrying none of its fields, yields no stableId — and an author
// with no stableId does NOT become a platform account (a display name
// alone is not a stable identity; see resolveStableId).
//
// Rationale per platform:
//   youtube   — channelId (UC…) is permanent; handles can change.
//   substack  — numeric user_id is canonical; handle is stable-ish.
//   twitter   — only the handle is captured today (no numeric id).
//   instagram — numeric pk is permanent; handle can change.
//   facebook  — numeric id when present; else the vanity handle.
//   tiktok    — numeric author id when present; else the @unique_id.
const STABLE_ID_PRECEDENCE = Object.freeze({
  youtube:   ['channelId', 'channel_id', 'stableId'],
  substack:  ['userId', 'user_id', 'stableId', 'handle'],
  twitter:   ['userId', 'user_id', 'stableId', 'handle'],
  instagram: ['pk', 'userId', 'user_id', 'stableId', 'handle'],
  facebook:  ['authorId', 'author_id', 'userId', 'stableId', 'handle'],
  tiktok:    ['authorId', 'author_id', 'userId', 'stableId', 'uniqueId', 'handle']
});

/**
 * The set of platforms we know how to mint a stable identity for.
 */
export const KNOWN_PLATFORMS = Object.freeze(Object.keys(STABLE_ID_PRECEDENCE));

/**
 * Resolve the stable identifier for an author on a platform, applying
 * the platform's field precedence. Returns a trimmed string, or null
 * when no stable identifier is available (e.g. a generic WordPress
 * commenter for whom we only have a display name).
 *
 * @param {string} platform
 * @param {object} raw   raw author object from a platform handler
 * @returns {string|null}
 */
export function resolveStableId(platform, raw) {
  if (typeof platform !== 'string' || !raw || typeof raw !== 'object') return null;
  const precedence = STABLE_ID_PRECEDENCE[platform];
  if (!precedence) return null;
  for (const field of precedence) {
    const v = raw[field];
    if (v === 0) return '0';                    // a literal numeric id 0
    if (v === null || v === undefined) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return null;
}

/**
 * The canonical account key: `<platform>:<stableId>`. This is the dedup
 * key for the storage registry and the basis of the kind 32126 `d` tag.
 * Lowercases the platform (a constant vocabulary) but NOT the stableId
 * (channel ids and some handles are case-sensitive).
 *
 * @param {string} platform
 * @param {string} stableId
 * @returns {string}
 */
export function accountKey(platform, stableId) {
  return String(platform).toLowerCase() + ':' + String(stableId);
}

/**
 * Normalize a raw platform-handler author object into the canonical
 * shape. Returns null when the author has no stable identifier — callers
 * MUST treat null as "not a platform account; keep the display string
 * only." Never fabricates a stableId from a display name.
 *
 * @param {string} platform
 * @param {object} raw
 * @returns {{platform, stableId, handle, displayName, profileUrl, avatarUrl, verified}|null}
 */
export function normalizeAuthor(platform, raw) {
  if (typeof platform !== 'string' || !platform || !raw || typeof raw !== 'object') return null;
  const p = platform.toLowerCase();
  const stableId = resolveStableId(p, raw);
  if (!stableId) return null;

  const str = (v) => (v === null || v === undefined ? '' : String(v).trim());
  return {
    platform: p,
    stableId,
    handle: str(raw.handle || raw.username || raw.uniqueId),
    displayName: str(raw.displayName || raw.name || raw.fullName),
    profileUrl: str(raw.profileUrl || raw.url),
    avatarUrl: str(raw.avatarUrl || raw.photo_url || raw.avatar),
    verified: raw.verified === true
  };
}

/**
 * Derive the deterministic account pubkey (x-only hex) for a platform
 * account. See the module header for the safety invariant: the private
 * key is transient and discarded; the returned pubkey is an identifier
 * only.
 *
 * @param {string} platform
 * @param {string} stableId
 * @returns {Promise<string>} 64-char hex x-only pubkey
 */
export async function deriveAccountPubkey(platform, stableId) {
  if (typeof platform !== 'string' || !platform) throw new Error('deriveAccountPubkey: platform required');
  if (stableId === null || stableId === undefined || String(stableId) === '') {
    throw new Error('deriveAccountPubkey: stableId required');
  }
  const seed = DERIVATION_DOMAIN + platform.toLowerCase() + ':' + String(stableId);

  // Hash → candidate privkey. On the astronomically rare out-of-range
  // result, re-hash with an incrementing counter so derivation stays
  // deterministic. In practice the loop body runs exactly once.
  for (let counter = 0; counter < 1000; counter++) {
    const material = counter === 0 ? seed : seed + ':' + counter;
    const candidateHex = await Utils.sha256(material);  // 64 hex chars
    try {
      // getPublicKey throws 'out of range' if the scalar is 0 or >= N.
      const pubkey = Crypto.getPublicKey(candidateHex);
      // candidateHex (the privkey) goes out of scope here and is GC'd.
      // We deliberately never store, log, or return it.
      return pubkey;
    } catch (_) {
      // out of range — try the next counter
    }
  }
  // 1000 consecutive out-of-range hashes is impossible for a real curve;
  // treat as a programming error rather than returning a bad key.
  throw new Error('deriveAccountPubkey: exhausted derivation attempts');
}

/**
 * Build a complete PlatformAccount record from a normalized author.
 * This is the shape persisted in Storage.platformAccounts.
 *
 * `now` is injectable for deterministic tests (the codebase forbids
 * Date.now() in workflow scripts, but this is a normal module; still,
 * accepting `now` keeps the record-shape tests timestamp-free).
 *
 * @param {object} normalized  output of normalizeAuthor (non-null)
 * @param {object} [opts]
 * @param {number} [opts.now]            unix seconds
 * @param {string} [opts.seenOnUrl]      URL where this account was just seen
 * @param {string|null} [opts.linkedEntityId]
 * @returns {Promise<object>} the record (includes accountPubkey + key)
 */
export async function makeAccountRecord(normalized, opts = {}) {
  if (!normalized || !normalized.platform || !normalized.stableId) {
    throw new Error('makeAccountRecord: normalized author with platform + stableId required');
  }
  const now = Number.isFinite(opts.now) ? opts.now : Math.floor(Date.now() / 1000);
  const key = accountKey(normalized.platform, normalized.stableId);
  const accountPubkey = await deriveAccountPubkey(normalized.platform, normalized.stableId);
  return {
    key,                                   // "<platform>:<stableId>" — registry primary key
    accountPubkey,                         // deterministic identifier (NOT a signing key)
    platform: normalized.platform,
    stableId: normalized.stableId,
    handle: normalized.handle || '',
    displayName: normalized.displayName || '',
    profileUrl: normalized.profileUrl || '',
    avatarUrl: normalized.avatarUrl || '',
    verified: normalized.verified === true,
    linkedEntityId: opts.linkedEntityId || null,   // Phase IV manual link
    firstSeen: now,
    lastSeen: now,
    npub: Crypto.hexToNpub(accountPubkey)  // convenience for UI display
  };
}
