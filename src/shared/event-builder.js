// Builders for every NOSTR event kind the userscript publishes. Identical
// event/tag shape to the userscript so existing relays/consumers continue
// to parse what X-Ray emits.

import { NostrCrypto } from './crypto.js';
import { ContentProcessor } from './content-processor.js';
import { Utils } from './utils.js';

export const EventBuilder = {
  // NIP-23 long-form article (kind 30023).
  buildArticleEvent: async (article, options = {}) => {
    const {
      pubkey,
      authorPubkey,
      tags: additionalTags = [],
      mediaHandling = 'reference'
    } = options;

    if (!pubkey) throw new Error('Publication pubkey is required');

    const urlHash = await Utils.sha256(article.url);
    const dTag = urlHash.substring(0, 16);

    let content = article.markdown || ContentProcessor.htmlToMarkdown(article.content);

    if (mediaHandling === 'reference') {
      Utils.log('Using reference URLs for images');
    } else if (mediaHandling === 'embed') {
      Utils.log('Embedding images as base64...');
      content = await ContentProcessor.embedImagesInMarkdown(content, (current, total) => {
        Utils.log(`Embedding image ${current}/${total}...`);
      });
      Utils.log('Image embedding complete');
    }

    const tags = [
      ['d', dTag],
      ['title', article.title],
      ['published_at', String(article.publishedAt || article.extractedAt)],
      ['client', 'nostr-article-capture']
    ];
    if (article.excerpt)       tags.push(['summary', article.excerpt.substring(0, 500)]);
    if (article.featuredImage) tags.push(['image', article.featuredImage]);
    tags.push(['r', article.url]);
    if (authorPubkey) tags.push(['p', authorPubkey, '', 'author']);
    if (article.byline) tags.push(['author', article.byline]);
    tags.push(['t', 'article']);
    tags.push(['t', article.domain.replace(/\./g, '-')]);

    for (const tag of additionalTags) {
      if (typeof tag === 'string')      tags.push(['t', tag.toLowerCase()]);
      else if (Array.isArray(tag))      tags.push(tag);
    }

    const event = {
      kind: 30023,
      pubkey,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content
    };
    event.id = await NostrCrypto.getEventHash(event);
    return event;
  },

  // Kind 0 profile metadata.
  buildProfileEvent: async (pubkey, profile) => {
    const content = JSON.stringify({
      name: profile.name,
      display_name: profile.displayName || profile.name,
      about: profile.about || '',
      picture: profile.picture || '',
      banner: profile.banner || '',
      website: profile.website || '',
      nip05: profile.nip05 || '',
      lud16: profile.lud16 || ''
    });
    const event = { kind: 0, pubkey, created_at: Math.floor(Date.now() / 1000), tags: [], content };
    event.id = await NostrCrypto.getEventHash(event);
    return event;
  },

  // Kind 1 short note.
  buildNoteEvent: async (pubkey, text, options = {}) => {
    const { replyTo, mentions = [], tags: additionalTags = [] } = options;
    const tags = [];
    if (replyTo) {
      tags.push(['e', replyTo.id, '', 'reply']);
      if (replyTo.pubkey) tags.push(['p', replyTo.pubkey]);
    }
    for (const mention of mentions)         tags.push(['p', mention]);
    for (const tag of additionalTags)       tags.push(tag);

    const event = { kind: 1, pubkey, created_at: Math.floor(Date.now() / 1000), tags, content: text };
    event.id = await NostrCrypto.getEventHash(event);
    return event;
  },

  // URL Annotation (kind 32123).
  buildAnnotationEvent: async (url, data, pubkey) => {
    const normalizedUrl = Utils.normalizeUrl(url);
    const urlHash = await Utils.sha256(normalizedUrl);
    const dTag = urlHash.substring(0, 16);

    const tags = [
      ['d', dTag],
      ['r', normalizedUrl],
      ['annotation-type', data.type],
      ['confidence', String(Math.round(data.confidence) / 100).substring(0, 4)],
      ['client', 'nostr-article-capture']
    ];
    if (data.evidenceUrl && data.evidenceUrl.trim()) {
      tags.push(['evidence', data.evidenceUrl.trim()]);
    }

    const event = { kind: 32123, pubkey, created_at: Math.floor(Date.now() / 1000), tags, content: data.content };
    event.id = await NostrCrypto.getEventHash(event);
    return event;
  },

  // Fact-Check (kind 32127).
  buildFactCheckEvent: async (url, data, pubkey) => {
    const normalizedUrl = Utils.normalizeUrl(url);
    const urlHash = await Utils.sha256(normalizedUrl);
    const dTag = urlHash.substring(0, 16);

    const tags = [
      ['d', dTag],
      ['r', normalizedUrl],
      ['claim', data.claim.substring(0, 200)],
      ['verdict', data.verdict],
      ['client', 'nostr-article-capture']
    ];
    if (data.evidenceSources && data.evidenceSources.length > 0) {
      data.evidenceSources.forEach(source => {
        if (source.url && source.url.trim()) {
          tags.push(['evidence', source.url.trim(), source.type || 'other']);
        }
      });
    }

    const event = { kind: 32127, pubkey, created_at: Math.floor(Date.now() / 1000), tags, content: data.explanation };
    event.id = await NostrCrypto.getEventHash(event);
    return event;
  },

  // Headline Correction (kind 32129).
  buildHeadlineCorrectionEvent: async (url, data, pubkey) => {
    const normalizedUrl = Utils.normalizeUrl(url);
    const urlHash = await Utils.sha256(normalizedUrl);
    const dTag = urlHash.substring(0, 16);

    const tags = [
      ['d', dTag],
      ['r', normalizedUrl],
      ['original-headline', data.original],
      ['suggested-headline', data.suggested],
      ['client', 'nostr-article-capture']
    ];
    const event = { kind: 32129, pubkey, created_at: Math.floor(Date.now() / 1000), tags, content: data.reason };
    event.id = await NostrCrypto.getEventHash(event);
    return event;
  },

  // URL Reaction (kind 32132).
  buildReactionEvent: async (url, data, pubkey) => {
    const normalizedUrl = Utils.normalizeUrl(url);
    const urlHash = await Utils.sha256(normalizedUrl);
    const dTag = urlHash.substring(0, 16);

    const tags = [
      ['d', dTag],
      ['r', normalizedUrl],
      ['reaction', data.emoji],
      ['client', 'nostr-article-capture']
    ];
    if (data.aspect) tags.push(['aspect', data.aspect]);
    if (data.reason) tags.push(['reason', data.reason]);

    const event = { kind: 32132, pubkey, created_at: Math.floor(Date.now() / 1000), tags, content: data.content || '' };
    event.id = await NostrCrypto.getEventHash(event);
    return event;
  },

  // Related Content (kind 32131).
  buildRelatedContentEvent: async (url, data, pubkey) => {
    const normalizedUrl = Utils.normalizeUrl(url);
    const urlHash = await Utils.sha256(normalizedUrl);
    const dTag = urlHash.substring(0, 16);

    const tags = [
      ['d', dTag],
      ['r', normalizedUrl],
      ['related-url', data.relatedUrl],
      ['relation-type', data.relationType],
      ['client', 'nostr-article-capture']
    ];
    if (data.title) tags.push(['related-title', data.title]);
    tags.push(['relevance', data.relevance.toString()]);

    const event = { kind: 32131, pubkey, created_at: Math.floor(Date.now() / 1000), tags, content: data.description || '' };
    event.id = await NostrCrypto.getEventHash(event);
    return event;
  },

  // Content Rating (kind 32124). Eight rating dimensions.
  buildRatingEvent: async (url, data, pubkey) => {
    const normalizedUrl = Utils.normalizeUrl(url);
    const urlHash = await Utils.sha256(normalizedUrl);
    const dTag = urlHash.substring(0, 16);

    const tags = [
      ['d', dTag],
      ['r', normalizedUrl],
      ['url-hash', urlHash],
      ['client', 'nostr-article-capture']
    ];

    const dimensions = ['accuracy', 'quality', 'depth', 'clarity', 'bias', 'sources', 'relevance', 'originality'];
    let totalScore = 0, ratedDimensions = 0;
    dimensions.forEach(dim => {
      if (data.ratings && data.ratings[dim] !== undefined && data.ratings[dim] !== null) {
        const score = Math.min(10, Math.max(0, parseInt(data.ratings[dim], 10)));
        tags.push(['rating', dim, score.toString(), '10']);
        totalScore += score;
        ratedDimensions++;
      }
    });
    if (ratedDimensions > 0) {
      const overallScore = (totalScore / ratedDimensions).toFixed(1);
      tags.push(['overall', overallScore, '10']);
    }
    tags.push(['methodology', data.methodology || 'manual-review']);
    if (data.confidence !== undefined) {
      const confidence = Math.min(100, Math.max(0, parseInt(data.confidence, 10)));
      tags.push(['confidence', confidence.toString()]);
    }

    const event = { kind: 32124, pubkey, created_at: Math.floor(Date.now() / 1000), tags, content: data.review || '' };
    event.id = await NostrCrypto.getEventHash(event);
    return event;
  },

  // Threaded Comment (kind 32123, annotation-type=comment).
  buildCommentEvent: async (url, data, pubkey) => {
    const normalizedUrl = Utils.normalizeUrl(url);
    const urlHash = await Utils.sha256(normalizedUrl);
    const dTag = urlHash.substring(0, 16);

    const tags = [
      ['d', dTag],
      ['r', normalizedUrl],
      ['url-hash', urlHash],
      ['annotation-type', 'comment'],
      ['client', 'nostr-article-capture']
    ];
    if (data.parentId) tags.push(['e', data.parentId, '', 'reply']);
    if (data.rootId)   tags.push(['e', data.rootId,   '', 'root']);
    if (Array.isArray(data.mentions)) {
      data.mentions.forEach(m => tags.push(['p', m]));
    }

    const event = { kind: 32123, pubkey, created_at: Math.floor(Date.now() / 1000), tags, content: data.comment || '' };
    event.id = await NostrCrypto.getEventHash(event);
    return event;
  }
};
