// Ported from the nostr-article-capture userscript (v4.2.0, src/event-builder.js).
// See roadmap: #20, Phase 2: #13.
//
// Adaptation from upstream:
//   - The userscript imports `RelayClient` for queryArticleFromRelays /
//     getArchivedArticle. X-Ray's relay client lives in the background
//     service worker (Phase 0), so those two methods route through a
//     SW message instead of calling RelayClient directly.
//   - Currently the archive-query paths are stubs (Phase 7: #18). The
//     method signatures are preserved so callers don't change.

import { Storage } from './storage.js';
import { Crypto } from './crypto.js';
import { ContentExtractor } from './content-extractor.js';
import { buildRespondsToTag, RESPONDS_TO_RELATIONSHIPS } from './metadata/builders.js';

// Re-export the metadata helpers so callers that already import from
// `event-builder.js` don't need a second import path. See spec §6.4.
export { buildRespondsToTag, RESPONDS_TO_RELATIONSHIPS } from './metadata/builders.js';

export const EventBuilder = {
  // Build NIP-23 article event (kind 30023).
  //
  // `authorAccountPubkey` (Phase 9 identity) is the deterministic
  // PlatformAccount pubkey of the POST author — when present, emitted as
  // a `['p', pubkey, '', 'author']` reference so the post is linked to
  // the same stable identity used for that author's comments elsewhere.
  // Additive + optional: existing 4-arg callers are unaffected and emit
  // no author p-tag, exactly as before.
  buildArticleEvent: async (article, entities, userPubkey, claims = [], authorAccountPubkey = null) => {
    // Convert content to markdown, preserving formatting and images
    let markdownContent = article.content || '';
    if (markdownContent && markdownContent.includes('<')) {
      markdownContent = ContentExtractor.htmlToMarkdown(markdownContent);
    }

    // Build metadata header for published content
    let metadataHeader = '---\n';
    metadataHeader += `**Source**: [${article.title}](${article.url})\n`;

    // For video content, use "Channel" instead of "Author"
    if (article.contentType === 'video' && article.byline) {
      metadataHeader += `**Channel**: ${article.byline}\n`;
    } else {
      const metaParts = [];
      if (article.siteName) metaParts.push(`**Publisher**: ${article.siteName}`);
      if (article.byline) metaParts.push(`**Author**: ${article.byline}`);
      if (metaParts.length) metadataHeader += metaParts.join(' | ') + '\n';
    }

    const dateParts = [];
    if (article.publishedAt) {
      dateParts.push(`**Published**: ${new Date(article.publishedAt * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`);
    }
    dateParts.push(`**Archived**: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`);
    metadataHeader += dateParts.join(' | ') + '\n';

    metadataHeader += '---\n\n';

    // For video content, include description and transcript as separate sections
    if (article.contentType === 'video') {
      // Include description section
      if (article.description) {
        markdownContent += '\n\n## Description\n\n' + article.description;
      }

      // Include clean transcript text as formatted markdown paragraphs
      if (article.transcript) {
        markdownContent += '\n\n## Transcript\n\n';
        // Break into paragraphs (every ~3 sentences) for readable markdown
        const sentences = article.transcript.match(/[^.!?]+[.!?]+\s*/g) || [article.transcript];
        let paragraph = '';
        let count = 0;
        for (const sentence of sentences) {
          paragraph += sentence;
          count++;
          if (count >= 3) {
            markdownContent += paragraph.trim() + '\n\n';
            paragraph = '';
            count = 0;
          }
        }
        if (paragraph.trim()) {
          markdownContent += paragraph.trim() + '\n\n';
        }
      }
    } else {
      // Append transcript for non-video content (legacy format)
      if (article.transcript) {
        markdownContent += '\n\n---\n\n## Transcript\n\n```\n' + article.transcript + '\n```';
      }
    }

    // Prepend metadata header to content
    const content = metadataHeader + markdownContent;

    // Note: Images are kept as original URLs to avoid exceeding relay event size limits
    // (base64 embedding can inflate events to megabytes, causing universal relay rejection).
    // The original absolute URLs are preserved by Turndown's image rule.
    
    // Build tags
    const tags = [
      ['d', await EventBuilder.generateDTag(article.url)],
      ['title', article.title || 'Untitled'],
      ['published_at', String(article.publishedAt || Math.floor(Date.now() / 1000))],
      ['r', article.url],
      ['client', 'nostr-article-capture']
    ];
    
    if (article.excerpt) {
      tags.push(['summary', article.excerpt.substring(0, 500)]);
    }
    
    if (article.featuredImage) {
      tags.push(['image', article.featuredImage]);
    }
    
    if (article.byline) {
      tags.push(['author', article.byline]);
    }

    // Phase 9 identity: reference the post author's stable PlatformAccount
    // pubkey, so the article is joined to the same identity used for that
    // author's comments and (Phase IV) their canonical person.
    if (authorAccountPubkey) {
      tags.push(['p', authorAccountPubkey, '', 'author']);
    }

    // Phase 9a — `responds-to` extension. Emit a tag for each declared
    // response target (URL, naddr, or nevent). Per spec §6.4, also emit
    // an indexed `r` tag for URL targets so relays can answer
    // `#r=<url>` queries on the response side.
    //
    // Shape: article.respondsTo = [{ target, relationship, relayHint? }]
    if (Array.isArray(article.respondsTo)) {
      for (const ref of article.respondsTo) {
        if (!ref || typeof ref.target !== 'string' || !ref.relationship) continue;
        try {
          tags.push(buildRespondsToTag(ref.target, ref.relationship, ref.relayHint || ''));
          // Co-emit an `r` tag for URL targets (skip nostr: refs).
          if (!/^nostr:/.test(ref.target)) {
            tags.push(['r', ref.target]);
          }
        } catch (_) { /* invalid relationship; silently drop the entry */ }
      }
    }

    // Add entity tags
    const taggedPubkeys = new Set();
    for (const entityRef of entities) {
      const entity = await Storage.entities.get(entityRef.entity_id);
      if (entity && entity.keypair) {
        // Add pubkey reference
        tags.push(['p', entity.keypair.pubkey, '', entityRef.context]);
        taggedPubkeys.add(entity.keypair.pubkey);
        
        // Add name tag for clients that don't resolve pubkeys
        const tagType = entity.type === 'person' ? 'person' : entity.type === 'organization' ? 'org' : entity.type === 'thing' ? 'thing' : 'place';
        tags.push([tagType, entity.name, entityRef.context]);

        // If this entity is an alias, also tag the canonical entity
        if (entity.canonical_id) {
          const canonical = await Storage.entities.get(entity.canonical_id);
          if (canonical && canonical.keypair && !taggedPubkeys.has(canonical.keypair.pubkey)) {
            tags.push(['p', canonical.keypair.pubkey, '', entityRef.context]);
            taggedPubkeys.add(canonical.keypair.pubkey);
            const canonTagType = canonical.type === 'person' ? 'person' : canonical.type === 'organization' ? 'org' : canonical.type === 'thing' ? 'thing' : 'place';
            tags.push([canonTagType, canonical.name, entityRef.context]);
          }
        }
      }
    }
    
    // Add publication branding tags
    if (article.siteName) {
      tags.push(['site_name', article.siteName]);
    }
    if (article.publicationIcon) {
      tags.push(['icon', article.publicationIcon]);
    }
    
    // Add claim tags
    if (Array.isArray(claims)) {
      for (const claim of claims) {
        if (claim.is_crux) {
          tags.push(['claim', claim.text, claim.type, 'crux']);
        } else {
          tags.push(['claim', claim.text, claim.type]);
        }
      }
    }

    // Add enhanced metadata tags (Phase 1)
    if (article.wordCount) tags.push(['word_count', String(article.wordCount)]);
    if (article.section) tags.push(['section', article.section]);
    if (article.keywords?.length) article.keywords.forEach(kw => tags.push(['t', kw.toLowerCase()]));
    if (article.language) tags.push(['lang', article.language]);
    if (article.dateModified) tags.push(['modified_at', String(Math.floor(new Date(article.dateModified).getTime() / 1000))]);
    if (article.isPaywalled) tags.push(['paywalled', 'true']);
    if (article.structuredData?.type) tags.push(['content_type', article.structuredData.type]);

    // Add content detection tags (Phase 2)
    if (article.contentType) tags.push(['content_format', article.contentType]);
    if (article.platform) tags.push(['platform', article.platform]);

    // Add video-specific tags (Phase 5)
    if (article.contentType === 'video' && article.videoMeta) {
      if (article.videoMeta.videoId) tags.push(['video_id', article.videoMeta.videoId]);
      if (article.videoMeta.duration) tags.push(['duration', article.videoMeta.duration]);
      if (article.byline) tags.push(['channel', article.byline]);
      if (article.transcript) tags.push(['transcript', 'true']);
      if (article.transcriptTimestamped) tags.push(['transcript_timestamped', 'true']);
      if (article.description) tags.push(['has_description', 'true']);
    }

    // Add YouTube-specific tags (Phase 3b — C2).
    //
    // We emit a richer set than the generic videoMeta block above so that
    // downstream relay consumers can filter / index on the full video
    // shape without having to re-parse the markdown body. Faithfulness-
    // first: every field that came from ytInitialPlayerResponse and
    // survived the synthesis step gets its own tag with a stable name.
    //
    // Also emits one `transcript_lang` tag per captured track, with
    // language + kind + role encoded so consumers can tell human vs. ASR
    // and origin-language vs. user-language at a glance without reading
    // content.
    if (article.youtube) {
      const y = article.youtube;
      if (y.videoId)         tags.push(['video_id',        y.videoId]);
      if (y.durationSeconds) tags.push(['duration',        String(y.durationSeconds)]);
      if (y.channel?.name)   tags.push(['channel',         y.channel.name]);
      if (y.channel?.channelId) tags.push(['channel_id',   y.channel.channelId]);
      if (y.category)        tags.push(['category',        y.category]);
      if (y.viewCount)       tags.push(['view_count',      String(y.viewCount)]);
      if (y.originLanguage)  tags.push(['origin_language', y.originLanguage]);
      if (y.userLanguage)    tags.push(['user_language',   y.userLanguage]);
      if (y.isLive === true) tags.push(['is_live',         'true']);
      if (y.isShort === true) tags.push(['is_short',       'true']);
      if (y.uploadDate)      tags.push(['upload_date',     y.uploadDate]);

      // One row per captured transcript with non-empty events. Encoded
      // as "<lang>:<kind>:<role>" so filters like `transcript_lang` =
      // `en:asr:origin-asr` or startsWith("en:") work cleanly.
      if (Array.isArray(y.transcripts)) {
        for (const t of y.transcripts) {
          if (!t || !Array.isArray(t.events) || t.events.length === 0) continue;
          const lang = t.languageCode || '';
          const kind = t.kind || 'human';
          const role = t.role || '';
          tags.push(['transcript_lang', `${lang}:${kind}:${role}`]);
        }
      }
    }

    // Add Twitter/X-specific tags (Phase 6)
    if (article.tweetMeta) {
      if (article.tweetMeta.tweetId) tags.push(['tweet_id', article.tweetMeta.tweetId]);
      if (article.tweetMeta.authorHandle) tags.push(['author_handle', '@' + article.tweetMeta.authorHandle]);
      if (article.tweetMeta.isThread) tags.push(['thread', 'true']);
      if (article.tweetMeta.threadLength > 1) tags.push(['thread_length', String(article.tweetMeta.threadLength)]);
    }

    // Instagram-specific tags (Phase 8c). The author tags below
    // give downstream consumers structured pointers to the
    // post's author account — `platform_account` is a generic
    // way to express "this came from `instagram:reasonmagazine`,"
    // useful for entity-system tooling and cross-post grouping.
    if (article.instagram) {
      const ig = article.instagram;
      if (ig.shortcode)    tags.push(['shortcode',          ig.shortcode]);
      if (ig.postKind)     tags.push(['post_kind',          ig.postKind]);
      if (ig.author && ig.author.handle) {
        tags.push(['author_handle',   '@' + ig.author.handle]);
        tags.push(['platform_account', `instagram:${ig.author.handle}`]);
      }
      // NOSTR requires all tag values to be strings. Instagram's REST
      // `user.pk` comes through as a number (e.g. `507869549`), so
      // coerce defensively — a number here crashes the relay with
      // "invalid: tag val was not a string" and loses the whole event.
      if (ig.author && ig.author.pk) tags.push(['author_id', String(ig.author.pk)]);
      if (ig.author && ig.author.verified) tags.push(['author_verified', 'true']);
      if (ig.author && ig.author.followerCount) tags.push(['author_followers', String(ig.author.followerCount)]);
    }

    // Facebook-specific tags (Phase 8d). Mirror Instagram's tagging
    // so cross-post grouping via `platform_account` works uniformly.
    if (article.facebook) {
      const fb = article.facebook;
      if (fb.postId)   tags.push(['post_id',   fb.postId]);
      if (fb.postKind) tags.push(['post_kind', fb.postKind]);
      if (fb.author && fb.author.handle) {
        tags.push(['author_handle',   '@' + fb.author.handle]);
        tags.push(['platform_account', `facebook:${fb.author.handle}`]);
      }
      if (fb.author && fb.author.verified) tags.push(['author_verified', 'true']);
    }

    // Add engagement metrics tags (Phase 4)
    if (article.engagement) {
      if (article.engagement.likes) tags.push(['engagement_likes', String(article.engagement.likes)]);
      if (article.engagement.shares) tags.push(['engagement_shares', String(article.engagement.shares)]);
      if (article.engagement.comments) tags.push(['engagement_comments', String(article.engagement.comments)]);
    }

    // Phase 8a evidence layer — when a hard-tier capture (FB/IG/TikTok)
    // produced a screenshot or HTML snapshot, surface their hashes
    // as event tags so downstream consumers can verify the evidence
    // wasn't substituted post-hoc. The actual blobs go in
    // article.evidence and the publish flow decides how to embed
    // them (inline base64, hosted URL, or omit).
    if (article.evidence) {
      if (article.evidence.screenshotHash)    tags.push(['screenshot_sha256', article.evidence.screenshotHash]);
      if (article.evidence.screenshotUrl)     tags.push(['screenshot_url',    article.evidence.screenshotUrl]);
      if (article.evidence.htmlSnapshotHash)  tags.push(['html_snapshot_sha256', article.evidence.htmlSnapshotHash]);
    }

    // Add topic tags
    tags.push(['t', 'article']);
    if (article.domain) {
      tags.push(['t', article.domain.replace(/\./g, '-')]);
    }
    
    // Build event
    const event = {
      kind: 30023,
      pubkey: userPubkey || '',
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content
    };
    
    return event;
  },

  // Generate d-tag from URL (16 chars)
  generateDTag: async (url) => {
    const hash = await Crypto.sha256(url);
    return hash.substring(0, 16);
  },

  // Build kind 0 profile event for entity
  buildProfileEvent: (entity, canonicalNpub) => {
    const tags = [];
    if (canonicalNpub) {
      tags.push(['refers_to', canonicalNpub]);
    }
    return {
      kind: 0,
      pubkey: entity.keypair.pubkey,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content: JSON.stringify({
        name: entity.name,
        about: `${entity.type} entity created by nostr-article-capture`,
        nip05: entity.nip05 || undefined
      })
    };
  },

  // Build kind 30040 claim event
  buildClaimEvent: (claim, articleUrl, articleTitle, userPubkey, entities) => {
    const tags = [
      ['d', claim.id],
      ['r', articleUrl],
      ['claim-text', claim.text],
      ['claim-type', claim.type],
      ['title', articleTitle],
    ];
    if (claim.is_crux) tags.push(['crux', 'true']);
    if (claim.confidence != null) tags.push(['confidence', String(claim.confidence)]);
    // Attribution tag
    tags.push(['attribution', claim.attribution || 'editorial']);
    // Claimant entity
    if (claim.claimant_entity_id && entities) {
      const claimant = entities[claim.claimant_entity_id];
      if (claimant && claimant.keypair) {
        tags.push(['p', claimant.keypair.pubkey, '', 'claimant']);
        tags.push(['claimant', claimant.name]);
      }
    }
    // Subject entities or freetext
    if (Array.isArray(claim.subject_entity_ids) && claim.subject_entity_ids.length > 0 && entities) {
      for (const sid of claim.subject_entity_ids) {
        const subject = entities[sid];
        if (subject && subject.keypair) {
          tags.push(['p', subject.keypair.pubkey, '', 'subject']);
          tags.push(['subject', subject.name]);
        }
      }
    } else if (claim.subject_text) {
      tags.push(['subject', claim.subject_text]);
    }
    // Object entities or freetext
    if (Array.isArray(claim.object_entity_ids) && claim.object_entity_ids.length > 0 && entities) {
      for (const oid of claim.object_entity_ids) {
        const obj = entities[oid];
        if (obj && obj.keypair) {
          tags.push(['p', obj.keypair.pubkey, '', 'object']);
          tags.push(['object', obj.name]);
        }
      }
    } else if (claim.object_text) {
      tags.push(['object', claim.object_text]);
    }
    // Predicate
    if (claim.predicate) {
      tags.push(['predicate', claim.predicate]);
    }
    // Quote date
    if (claim.quote_date) {
      tags.push(['quote-date', claim.quote_date]);
    }
    return {
      kind: 30040,
      pubkey: userPubkey,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content: claim.context || ''
    };
  },

  // Build kind 30078 entity sync event (NIP-78 application-specific data)
  buildEntitySyncEvent: (entityId, encryptedContent, entityType, userPubkey) => {
    return {
      kind: 30078,
      pubkey: userPubkey,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['d', entityId],
        ['client', 'nostr-article-capture'],
        ['entity-type', entityType],
        ['L', 'nac/entity-sync'],
        ['l', 'v1', 'nac/entity-sync']
      ],
      content: encryptedContent
    };
  },

  // Build a NIP-65 relay-list event (kind 10002). Each relay becomes
  // an `r`-tag; we don't distinguish read/write since the X-Ray UI
  // has a single relay list. Replaces any prior 10002 from this
  // pubkey on relays that honor NIP-09/replaceable semantics.
  buildRelayListEvent: (relayUrls, userPubkey) => {
    const tags = [];
    for (const url of relayUrls) {
      if (typeof url === 'string' && url) tags.push(['r', url]);
    }
    return {
      kind: 10002,
      pubkey: userPubkey,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content: ''
    };
  },

  // Build kind 32125 entity relationship event
  buildEntityRelationshipEvent: (entity, articleUrl, relationshipType, userPubkey, claimId) => {
    return {
      kind: 32125,
      pubkey: userPubkey,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['d', `${entity.id}:${articleUrl}:${relationshipType}`],
        ['r', articleUrl],
        ['p', entity.keypair.pubkey, '', relationshipType],
        ['entity-name', entity.name],
        ['entity-type', entity.type],
        ['relationship', relationshipType],
        ['client', 'nostr-article-capture'],
        ...(claimId ? [['claim-ref', claimId]] : [])
      ],
      content: ''
    };
  },

  // Build kind 30041 comment event.
  //
  // Accepted `comment` shape (all fields except id/text/platform are optional):
  //   id            string  — stable d-tag (namespaced by platform)
  //   text          string
  //   authorName    string  — display name
  //   authorHandle  string  — stable public identifier (e.g. Substack handle)
  //   authorUrl     string  — public profile URL
  //   platform      string  — 'substack' / 'twitter' / …
  //   timestamp     number  — ms-since-epoch OR seconds-since-epoch (auto-detected)
  //   replyTo       string  — parent comment's d-tag value (threads via NIP-10-ish)
  //   reactionCount number  — e.g. Substack heart count
  //   restacks      number  — Substack restacks
  //
  // `accountPubkey` is the optional synthetic PlatformAccount pubkey
  // (Phase 4 entity-keypair work). Safe to omit — Substack captures
  // don't require it; the handle + URL are already stable identifiers.
  buildCommentEvent: (comment, articleUrl, articleTitle, userPubkey, accountPubkey) => {
    // Auto-detect ms vs s timestamps. Substack gives us ISO strings that
    // we convert upstream to ms; pre-v4 callers pass ms directly.
    let commentDateSec = null;
    if (typeof comment.timestamp === 'number' && Number.isFinite(comment.timestamp)) {
      commentDateSec = comment.timestamp > 10_000_000_000
        ? Math.floor(comment.timestamp / 1000)   // ms → s
        : comment.timestamp;                      // already s
    }

    const tags = [
      ['d', String(comment.id)],
      ['r', articleUrl],
      ['title', articleTitle],
      ['comment-text', comment.text],
      ['comment-author', comment.authorName || comment.authorHandle || 'Unknown'],
      ['platform', comment.platform]
    ];
    if (comment.authorHandle) tags.push(['author-handle', comment.authorHandle]);
    if (comment.authorUrl)    tags.push(['author-url',    comment.authorUrl]);
    if (accountPubkey)        tags.push(['p', accountPubkey, '', 'commenter']);
    if (commentDateSec != null) tags.push(['comment-date', String(commentDateSec)]);
    if (comment.replyTo)      tags.push(['reply-to',    comment.replyTo]);
    if (Number.isFinite(comment.reactionCount) && comment.reactionCount > 0) {
      tags.push(['reaction-count', String(comment.reactionCount)]);
    }
    if (Number.isFinite(comment.restacks) && comment.restacks > 0) {
      tags.push(['restack-count', String(comment.restacks)]);
    }
    tags.push(['client', 'xray']);

    return {
      kind: 30041,
      pubkey: userPubkey,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content: comment.text
    };
  },

  // Build kind 32126 platform account event (Phase 9 identity layer).
  //
  // Consumes a PlatformAccount record from
  // shared/identity/platform-account.js (makeAccountRecord). The event
  // is authored/signed by the CAPTURING USER (`userPubkey`); the
  // account's deterministic pubkey appears only as a `p` reference —
  // it is an identifier, never a signer (see platform-account.js header).
  //
  // The `d` tag IS the account key (`<platform>:<stableId>`), so re-
  // publishing an updated record (new display name, a fresh entity link)
  // replaces in place per NIP-01 addressable-event semantics.
  buildPlatformAccountEvent: (account, userPubkey) => {
    if (!account || !account.key || !account.accountPubkey) {
      throw new Error('buildPlatformAccountEvent: account.key + account.accountPubkey required');
    }
    const tags = [
      ['d', account.key],
      ['p', account.accountPubkey, '', 'account'],
      ['account-platform', account.platform],
      ['account-id', account.stableId]
    ];
    if (account.handle)      tags.push(['account-username', account.handle]);
    if (account.displayName) tags.push(['account-name', account.displayName]);
    if (account.profileUrl)  tags.push(['r', account.profileUrl]);
    if (account.verified)    tags.push(['account-verified', 'true']);
    if (account.linkedEntityId) tags.push(['linked-entity', account.linkedEntityId]);
    tags.push(['client', 'xray']);

    return {
      kind: 32126,
      pubkey: userPubkey,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content: ''
    };
  },

  // Inverse of buildPlatformAccountEvent — rebuild a partial
  // PlatformAccount record from a received kind 32126 event. Used when
  // ingesting account events (e.g. a future relay-publish path) back
  // into the local registry. Returns null on a malformed event.
  reconstructPlatformAccount: (event) => {
    if (!event || event.kind !== 32126 || !Array.isArray(event.tags)) return null;
    const get = (name) => {
      const t = event.tags.find((x) => Array.isArray(x) && x[0] === name);
      return t ? t[1] : null;
    };
    const pTag = event.tags.find((x) => Array.isArray(x) && x[0] === 'p' && x[3] === 'account');
    const key = get('d');
    const accountPubkey = pTag ? pTag[1] : null;
    const platform = get('account-platform');
    const stableId = get('account-id');
    if (!key || !accountPubkey || !platform || !stableId) return null;
    return {
      key,
      accountPubkey,
      platform,
      stableId,
      handle: get('account-username') || '',
      displayName: get('account-name') || '',
      profileUrl: get('r') || '',
      verified: get('account-verified') === 'true',
      linkedEntityId: get('linked-entity') || null
    };
  },

  // Build kind 30043 evidence link event
  buildEvidenceLinkEvent: async (link, allClaims, userPubkey) => {
    const sourceClaim = allClaims[link.source_claim_id];
    const targetClaim = allClaims[link.target_claim_id];

    const tags = [
      ['d', link.id],
      ['source-claim', link.source_claim_id],
      ['target-claim', link.target_claim_id],
      ['relationship', link.relationship],
      ['client', 'nostr-article-capture']
    ];

    if (sourceClaim?.source_url) tags.push(['r', sourceClaim.source_url]);
    if (targetClaim?.source_url) tags.push(['r', targetClaim.source_url]);

    return {
      kind: 30043,
      pubkey: userPubkey,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content: link.note || ''
    };
  },

  // ─── Archive Reader: Relay Retrieval ───

  /**
   * Reconstruct an article object from a kind 30023 NOSTR event.
   * Inverse of buildArticleEvent().
   */
  reconstructArticleFromEvent: (event) => {
    if (!event || event.kind !== 30023) return null;

    // Parse tags into lookup maps
    const tags = {};
    const tagArrays = {};
    for (const tag of (event.tags || [])) {
      const [key, ...values] = tag;
      if (!tags[key]) tags[key] = values[0] || '';
      if (!tagArrays[key]) tagArrays[key] = [];
      tagArrays[key].push(values);
    }

    // Extract markdown content, stripping our metadata header
    let markdown = event.content || '';
    let description = '';
    let transcript = '';

    // Strip metadata header (between --- markers)
    const headerMatch = markdown.match(/^---\n[\s\S]*?\n---\n\n?/);
    if (headerMatch) {
      markdown = markdown.substring(headerMatch[0].length);
    }

    // Extract ## Description section
    const descMatch = markdown.match(/## Description\n\n([\s\S]*?)(?=\n## |\n---|\n$|$)/);
    if (descMatch) {
      description = descMatch[1].trim();
      markdown = markdown.replace(descMatch[0], '').trim();
    }

    // Extract ## Transcript section
    const transMatch = markdown.match(/## Transcript\n\n([\s\S]*?)$/);
    if (transMatch) {
      transcript = transMatch[1].trim();
      markdown = markdown.replace(transMatch[0], '').trim();
    }

    // Convert remaining markdown back to HTML
    let htmlContent = '';
    try {
      htmlContent = ContentExtractor.markdownToHtml(markdown);
    } catch (e) {
      htmlContent = markdown.split('\n\n').map(p => `<p>${p}</p>`).join('');
    }

    const article = {
      url: tags['r'] || '',
      content: htmlContent,
      textContent: markdown,
      title: tags['title'] || '',
      byline: tags['author'] || '',
      siteName: tags['site_name'] || '',
      domain: (tags['r'] || '').match(/https?:\/\/([^/]+)/)?.[1] || '',
      publishedAt: parseInt(tags['published_at']) || event.created_at,
      featuredImage: tags['image'] || '',
      publicationIcon: tags['icon'] || '',
      excerpt: tags['summary'] || '',
      isPaywalled: tags['paywalled'] === 'true',
      contentType: tags['content_format'] || 'article',
      platform: tags['platform'] || null,
      language: tags['lang'] || null,
      keywords: (tagArrays['t'] || []).map(v => v[0]),
      wordCount: parseInt(tags['word_count']) || 0,
      section: tags['section'] || null,
      description: description || null,
      transcript: transcript || null,
      engagement: null,
      videoMeta: null,
      tweetMeta: null,
      platformAccount: null,
      _fromArchive: true,
      _archiveSource: 'relay',
      _nostrEventId: event.id,
      _nostrCreatedAt: event.created_at,
      _nostrPubkey: event.pubkey,
    };

    // Reconstruct engagement
    const eLikes = parseInt(tags['engagement_likes']);
    const eShares = parseInt(tags['engagement_shares']);
    const eComments = parseInt(tags['engagement_comments']);
    if (eLikes || eShares || eComments) {
      article.engagement = { likes: eLikes || 0, shares: eShares || 0, comments: eComments || 0, views: 0 };
    }

    // Video-specific
    if (tags['video_id']) {
      article.videoMeta = { videoId: tags['video_id'], duration: tags['duration'] || '', channelName: tags['channel'] || '' };
    }

    // YouTube-specific reconstruction. Mirrors the buildArticleEvent
    // block above so `article.youtube` round-trips through the relay.
    // Transcripts themselves live in the markdown body (they'd blow the
    // event size budget as tags); we only restore the language manifest
    // here so consumers know what was captured.
    if (article.platform === 'youtube' || tags['video_id']) {
      const transcriptLangs = (tagArrays['transcript_lang'] || []).map((v) => {
        const [lang, kind, role] = String(v[0] || '').split(':');
        return { languageCode: lang || '', kind: kind || 'human', role: role || '' };
      });
      article.youtube = {
        videoId:         tags['video_id']        || null,
        durationSeconds: tags['duration'] ? parseInt(tags['duration'], 10) : null,
        channel: {
          name:      tags['channel']    || '',
          channelId: tags['channel_id'] || null
        },
        category:       tags['category']        || null,
        viewCount:      tags['view_count'] ? parseInt(tags['view_count'], 10) : null,
        originLanguage: tags['origin_language'] || null,
        userLanguage:   tags['user_language']   || null,
        isLive:         tags['is_live'] === 'true',
        isShort:        tags['is_short'] === 'true',
        uploadDate:     tags['upload_date']     || null,
        transcripts:    transcriptLangs   // manifest only; bodies live in content
      };
    }

    // Tweet-specific
    if (tags['tweet_id']) {
      article.tweetMeta = { tweetId: tags['tweet_id'], authorHandle: (tags['author_handle'] || '').replace('@', ''), isThread: tags['thread'] === 'true', threadLength: parseInt(tags['thread_length']) || 1 };
    }

    // Phase 8a evidence layer — read back hashes/URLs that confirm
    // a published event carried screenshot or HTML-snapshot
    // evidence. Body bytes (if inline) live elsewhere in the
    // event content; this just rehydrates the verifiable refs.
    if (tags['screenshot_sha256'] || tags['screenshot_url'] || tags['html_snapshot_sha256']) {
      article.evidence = {
        screenshotHash:    tags['screenshot_sha256']    || null,
        screenshotUrl:     tags['screenshot_url']       || null,
        htmlSnapshotHash:  tags['html_snapshot_sha256'] || null
      };
    }

    return article;
  },

  /**
   * Query NOSTR relays for a kind 30023 event matching a URL.
   * Stubbed until Phase 7 (#18) lands the Archive Reader. The method
   * signature is preserved; real wiring will route the query through
   * the background service worker's relay pool.
   */
  queryArticleFromRelays: async (_url, _userPubkey) => {
    // TODO(Phase 7 / #18): send { type: 'xray:relay:query', filter, relays }
    // to the background SW and reconstruct the article from the first
    // matching kind-30023 event.
    return null;
  },

  /**
   * Get an archived article. Stubbed until Phase 7 (#18).
   */
  getArchivedArticle: async (_url, _userPubkey) => {
    // TODO(Phase 7 / #18): IndexedDB cache lookup, then relay query.
    return null;
  }
};
