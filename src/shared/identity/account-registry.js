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
