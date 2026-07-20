// Mention notes — Phase 17 E4 (docs/ENTITY_CORPUS_DESIGN.md §4.2):
// the entity speaks for itself. On article publish (with
// `entityCorpusPublishing` on), each tagged entity gets ONE kind-1
// text note signed by the entity's own key — so following the
// entity's npub in ANY NOSTR client surfaces its corpus, no custom
// kind, no prior knowledge of the publisher.
//
// Idempotence is local (the design's answer to kind-1 having no
// addressability): `published_mentions` keys on
// (entity, url, article hash) — a CHANGED article hash is
// deliberately a NEW note (edition provenance). Etiquette: notes
// publish only when the user publishes the article, capped per
// article; the cap and the loop live in the reader's publish batch.
//
// The note's quote is the grounded verbatim mention (the tag ref's
// `context` span) or, failing that, the strongest claim quote from
// this article about the entity (is_key first). No stored quote → no
// quote block; never a paraphrase.

import { Storage } from './storage.js';
import { Utils } from './utils.js';

export const PUBLISHED_MENTIONS_KEY = 'published_mentions';
export const MENTION_NOTE_CAP_PER_ARTICLE = 10;

/** The idempotence key: entity + normalized url + article hash. */
export function mentionKey(entityId, articleUrl, articleHash) {
    return `${entityId}|${Utils.normalizeUrl(articleUrl || '') || articleUrl || ''}|${articleHash || ''}`;
}

/**
 * The verbatim quote for an entity's mention note: the tag ref's
 * grounded `context` span, else the strongest claim quote from THIS
 * article whose `about` names the entity (is_key first, oldest
 * first). Null when nothing verbatim is stored — never a paraphrase.
 *
 * @param {object} input
 * @param {object} [input.ref]     the article's entity ref (may carry context)
 * @param {string} input.entityId
 * @param {string} input.articleUrl
 * @param {Array}  [input.claims]  claims with source_url == this article
 */
export function selectMentionQuote({ ref, entityId, articleUrl, claims = [] } = {}) {
    const ctx = ref && typeof ref.context === 'string' ? ref.context.trim() : '';
    if (ctx) return ctx;
    const url = Utils.normalizeUrl(articleUrl || '');
    const candidates = claims
        .filter((c) => c && c.quote
            && (c.about || []).includes(entityId)
            && Utils.normalizeUrl(c.source_url || '') === url)
        .sort((a, b) => (b.is_key ? 1 : 0) - (a.is_key ? 1 : 0) || (a.created || 0) - (b.created || 0));
    return candidates.length ? String(candidates[0].quote).trim() : null;
}

/**
 * Build the unsigned kind-1 mention note (§4.2's exact shape). Pure —
 * the caller signs with the ENTITY's key and publishes to the relays.
 *
 * CUSTODY (TEAM_CASE_DESIGN §2.1, normative): a case entity's key
 * signs EXACTLY its kind-0 and its 32125s — never a kind-1 note. With
 * case-bound workspaces every capture is case-tagged, so without this
 * refusal every article publish would mint a case-signed note.
 *
 * @param {object} input
 * @param {string} input.entityPubkey
 * @param {string} input.entityType       refuses 'case'
 * @param {string} input.publisherPubkey  the archive owner (user)
 * @param {string} input.articleTitle
 * @param {string} input.articleUrl
 * @param {string|null} input.articleCoord  '30023:<pubkey>:<dTag>' when the article landed
 * @param {string|null} input.articleHash   canonical article hash
 * @param {string|null} input.quote         verbatim mention (selectMentionQuote)
 * @param {number} [input.createdAt]
 */
export function buildMentionNoteEvent({
    entityPubkey, entityType, publisherPubkey, articleTitle, articleUrl,
    articleCoord = null, articleHash = null, quote = null, createdAt
} = {}) {
    if (entityType === 'case') {
        throw new Error('custody rule: a case key signs only its kind-0 and 32125s — never a mention note (TEAM_CASE_DESIGN §2.1)');
    }
    const lines = [`Mentioned in "${articleTitle || articleUrl}"`];
    if (quote) lines.push('', `"${quote}"`);
    lines.push('', articleUrl || '');

    const tags = [['r', articleUrl || '']];
    if (articleCoord) tags.push(['a', articleCoord, '', 'mention']);
    if (articleHash) tags.push(['x', articleHash]);
    if (publisherPubkey) tags.push(['p', publisherPubkey, '', 'publisher']);
    if (quote) tags.push(['quote', quote]);
    tags.push(['client', 'xray']);

    return {
        kind: 1,
        pubkey: entityPubkey,
        created_at: Number.isFinite(createdAt) ? createdAt : Math.floor(Date.now() / 1000),
        tags,
        content: lines.join('\n')
    };
}

/** The published-mentions ledger (workspace content). */
export const MentionLedger = {
    async getAll() {
        return await Storage.get(PUBLISHED_MENTIONS_KEY, {}) || {};
    },
    async has(key) {
        const all = await MentionLedger.getAll();
        return !!all[key];
    },
    async record(key, { eventId = null } = {}) {
        const all = await MentionLedger.getAll();
        all[key] = { at: Math.floor(Date.now() / 1000), eventId };
        await Storage.set(PUBLISHED_MENTIONS_KEY, all);
        return all[key];
    }
};
