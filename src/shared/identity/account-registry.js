// Account registry orchestration — Phase 9 identity layer, Phase II.
//
// Thin layer over the pure platform-account core (platform-account.js)
// and the storage registry (Storage.platformAccounts). Turns a raw
// handler author into a persisted PlatformAccount and hands back the
// deterministic accountPubkey for use as a `p`-tag reference on the
// captured comment/post event.
//
// Why a separate module from the pure core: the reader's comment-publish
// loop and (Phase III) the YouTube comment extractor both need the same
// normalize→derive→persist step. Centralizing it here avoids duplicating
// the dance and keeps platform-account.js free of any storage dependency
// (so its unit tests stay pure).

import { normalizeAuthor, makeAccountRecord } from './platform-account.js';
import { Storage } from '../storage.js';
import { Utils } from '../utils.js';
import { EntityModel } from '../entity-model.js';

/**
 * Pull the POST AUTHOR out of a captured article object, returning
 * `{ platform, raw }` for `recordAccount`, or null when the platform's
 * article shape carries no stable author identifier.
 *
 * Pure — knows the per-platform article shapes but touches no storage.
 * Substack is intentionally omitted: the post-API gives commenter
 * user_ids but not a reliable stable id for the post author, so we keep
 * the existing display-string byline rather than mint a shaky identity.
 *
 * @param {object} article
 * @returns {{platform: string, raw: object}|null}
 */
export function extractPostAuthor(article) {
  if (!article || typeof article !== 'object') return null;
  switch (article.platform) {
    case 'youtube': {
      const ch = article.youtube && article.youtube.channel;
      if (ch && ch.channelId) {
        return { platform: 'youtube', raw: { channelId: ch.channelId, displayName: ch.name } };
      }
      return null;
    }
    case 'instagram': {
      const a = article.instagram && article.instagram.author;
      if (a && (a.pk || a.handle)) return { platform: 'instagram', raw: a };
      return null;
    }
    case 'facebook': {
      const a = article.facebook && article.facebook.author;
      if (a && a.handle) return { platform: 'facebook', raw: a };
      return null;
    }
    case 'twitter':
    case 'x': {
      const a = article.twitter && article.twitter.author;
      if (a && a.handle) return { platform: 'twitter', raw: a };
      return null;
    }
    default:
      return null;
  }
}

/**
 * Materialize (or refresh) a PlatformAccount from a raw platform-handler
 * author object and persist it to the local registry. Returns the
 * record (carrying the deterministic `accountPubkey`), or null when the
 * author has no stable identifier — callers MUST treat null as "no
 * account; keep the display string only."
 *
 * Best-effort by contract: NEVER throws. Identity is an enrichment, not
 * a gate on publishing — a derivation or storage failure logs and
 * returns null so the caller's publish proceeds with the plain author
 * string it already has.
 *
 * @param {string} platform           e.g. 'substack', 'youtube'
 * @param {object} rawAuthor          handler author object
 * @param {object} [opts]             forwarded to makeAccountRecord
 * @param {string} [opts.seenOnUrl]
 * @param {number} [opts.now]
 * @returns {Promise<object|null>}    the PlatformAccount record, or null
 */
export async function recordAccount(platform, rawAuthor, opts = {}) {
  try {
    const normalized = normalizeAuthor(platform, rawAuthor);
    if (!normalized) return null;
    const record = await makeAccountRecord(normalized, opts);
    await Storage.platformAccounts.save(record);
    return record;
  } catch (err) {
    Utils.log('recordAccount failed (non-fatal):', err && err.message);
    return null;
  }
}

// ── Phase IV: manual account ↔ entity linking ──────────────────────────
//
// Per the v1 decision (manual linking only): an account materializes
// automatically, but declaring "this account IS this person" is always a
// deliberate user action. Multiple accounts pointed at one entity is the
// cross-platform collapse — no separate merge primitive needed.

/**
 * Link a platform account to a canonical person (entity). Validates the
 * entity exists. Throws on bad input (this is a deliberate user action,
 * so failures should surface, unlike the best-effort capture path).
 *
 * @param {string} accountKey  "<platform>:<stableId>"
 * @param {string} entityId
 * @returns {Promise<object>} the updated account record
 */
export async function linkAccountToEntity(accountKey, entityId) {
  if (!accountKey) throw new Error('linkAccountToEntity: accountKey required');
  if (!entityId) throw new Error('linkAccountToEntity: entityId required');
  const entity = await EntityModel.get(entityId);
  if (!entity) throw new Error('linkAccountToEntity: unknown entity ' + entityId);
  return await Storage.platformAccounts.link(accountKey, entityId);
}

/**
 * Remove an account's entity link.
 * @param {string} accountKey
 * @returns {Promise<object>} the updated account record
 */
export async function unlinkAccount(accountKey) {
  if (!accountKey) throw new Error('unlinkAccount: accountKey required');
  return await Storage.platformAccounts.link(accountKey, null);
}

/**
 * Resolve a captured account (by key OR by deterministic accountPubkey)
 * to the canonical person it belongs to. Follows the entity alias chain
 * so an account linked to an alias surfaces its canonical entity.
 * Returns null when the account is unknown or unlinked.
 *
 * This is the read-side join: given a comment's `p`-tag pubkey, "who is
 * this, really?"
 *
 * @param {string} accountKeyOrPubkey
 * @returns {Promise<object|null>} canonical entity, or null
 */
export async function resolveAccountToEntity(accountKeyOrPubkey) {
  if (!accountKeyOrPubkey) return null;
  let rec = null;
  if (/^[0-9a-f]{64}$/i.test(accountKeyOrPubkey)) {
    rec = await Storage.platformAccounts.findByPubkey(accountKeyOrPubkey);
  } else {
    rec = await Storage.platformAccounts.get(accountKeyOrPubkey);
  }
  if (!rec || !rec.linkedEntityId) return null;
  const entity = await EntityModel.get(rec.linkedEntityId);
  if (!entity) return null;
  return await EntityModel.resolveAlias(entity);
}

/**
 * All platform accounts linked directly to an entity (the inverse of
 * linkAccountToEntity). Used by the Entity Browser's "Linked accounts"
 * section.
 * @param {string} entityId
 * @returns {Promise<Array<object>>}
 */
export async function accountsForEntity(entityId) {
  if (!entityId) return [];
  return await Storage.platformAccounts.findByEntity(entityId);
}

/**
 * Every known platform account NOT yet linked to an entity — the
 * candidate list for the "Link an account…" picker.
 * @returns {Promise<Array<object>>}
 */
export async function listUnlinkedAccounts() {
  const all = await Storage.platformAccounts.getAll();
  return Object.values(all).filter((a) => a && !a.linkedEntityId);
}
