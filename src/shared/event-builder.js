// Ported from the nostr-article-capture userscript (v4.2.0, src/event-builder.js).
// See roadmap: #20, Phase 2: #13.
//
// Adaptation from upstream:
//   - The userscript imports `RelayClient` for its archive-query methods
//     (queryArticleFromRelays / getArchivedArticle). X-Ray dropped both:
//     the relay client lives in the background service worker, and the
//     archive path shipped in `archive-cache.js` + the reader (Phase 7).

import { Storage } from './storage.js';
import { Crypto } from './crypto.js';
import { Utils } from './utils.js';
import { ContentExtractor } from './content-extractor.js';
import { buildRespondsToTag, RESPONDS_TO_RELATIONSHIPS } from './metadata/builders.js';
import { articleHash } from './audit/article-hash.js';
import { generateEntityId, canonicalIdOf } from './entity-model.js';
import { bandISO } from './dossier-time.js';

// Re-export the metadata helpers so callers that already import from
// `event-builder.js` don't need a second import path. See spec §6.4.
export { buildRespondsToTag, RESPONDS_TO_RELATIONSHIPS } from './metadata/builders.js';

export const EventBuilder = {
  // Assemble the publish-path article BODY — the markdown that follows
  // the metadata header in a published 30023's content. This is the
  // canonical-article-hash input (Phase 13.4): the audited text is the
  // published text in full, so video Description/Transcript sections
  // are INSIDE it, and the transcript chunking below is part of the
  // content address — a formatting tweak here changes video hashes and
  // gets the wire-change treatment (docs/EPISTEMIC_AUDIT_DESIGN.md
  // §"Canonical article hash").
  assembleArticleBody: (article) => {
    // Convert content to markdown, preserving formatting and images.
    // `_contentIsMarkdown` is the EXPLICIT already-converted marker
    // (set by the reader's publish path, whose draft is markdown):
    // htmlToMarkdown is not idempotent, and markdown legitimately
    // contains '<' (inline small-image tags, code fences) — sniffing
    // would re-convert it, mangling the published body AND forking
    // the publish-path hash from the capture hash every audit
    // anchors to. Conversion runs ONCE per body, ever.
    let markdownContent = article.content || '';
    if (markdownContent && markdownContent.includes('<') && !article._contentIsMarkdown) {
      markdownContent = ContentExtractor.htmlToMarkdown(markdownContent);
    }

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

    return markdownContent;
  },

  // Build NIP-23 article event (kind 30023).
  //
  // `authorAccountPubkey` (Phase 9 identity) is the deterministic
  // PlatformAccount pubkey of the POST author — when present, emitted as
  // a `['p', pubkey, '', 'author']` reference so the post is linked to
  // the same stable identity used for that author's comments elsewhere.
  // Additive + optional: existing 4-arg callers are unaffected and emit
  // no author p-tag, exactly as before.
  buildArticleEvent: async (article, entities, userPubkey, claims = [], authorAccountPubkey = null) => {
    const markdownContent = EventBuilder.assembleArticleBody(article);

    // Header fields are interpolated raw between the `---` markers; a
    // value smuggling a newline could forge the header terminator and
    // leak header residue (the Archived date) into a third party's
    // hash recomputation (Phase 13.4). Newlines have no business in a
    // title/byline/site name anyway — flatten them.
    const headerField = (v) => String(v == null ? '' : v).replace(/[\r\n]+/g, ' ');

    // Build metadata header for published content
    let metadataHeader = '---\n';
    metadataHeader += `**Source**: [${headerField(article.title)}](${headerField(article.url)})\n`;

    // For video content, use "Channel" instead of "Author"
    if (article.contentType === 'video' && article.byline) {
      metadataHeader += `**Channel**: ${headerField(article.byline)}\n`;
    } else {
      const metaParts = [];
      if (article.siteName) metaParts.push(`**Publisher**: ${headerField(article.siteName)}`);
      if (article.byline) metaParts.push(`**Author**: ${headerField(article.byline)}`);
      if (metaParts.length) metadataHeader += metaParts.join(' | ') + '\n';
    }

    const dateParts = [];
    if (article.publishedAt) {
      dateParts.push(`**Published**: ${new Date(article.publishedAt * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`);
    }
    dateParts.push(`**Archived**: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`);
    metadataHeader += dateParts.join(' | ') + '\n';

    metadataHeader += '---\n\n';

    // Prepend metadata header to content
    const content = metadataHeader + markdownContent;

    // Canonical article hash (Phase 13.4): SHA-256 of the normalized
    // body — exactly what stripMetadataHeader recovers from this
    // event's content, so any third party can verify the tag from the
    // event alone. The anchor every audit kind joins on (`#x`).
    const articleXHash = await articleHash(markdownContent);

    // Note: Images are kept as original URLs to avoid exceeding relay event size limits
    // (base64 embedding can inflate events to megabytes, causing universal relay rejection).
    // The original absolute URLs are preserved by Turndown's image rule.
    
    // Build tags
    const tags = [
      ['d', await EventBuilder.generateDTag(article.url)],
      ['title', article.title || 'Untitled'],
      ['published_at', String(article.publishedAt || Math.floor(Date.now() / 1000))],
      ['r', article.url],
      ['x', articleXHash],
      ['client', 'xray']
    ];

    // ONE r-dedupe mechanism for every co-emit below (responds-to,
    // capture-url, link): the primary r above stays FIRST (readers
    // take the first r as the article URL), and no duplicate r tag is
    // ever emitted regardless of which blocks overlap.
    const seenR = new Set([article.url]);
    const pushR = (u) => {
      if (u && !seenR.has(u)) {
        tags.push(['r', u]);
        seenR.add(u);
      }
    };
    
    if (article.excerpt) {
      tags.push(['summary', article.excerpt.substring(0, 500)]);
    }
    
    if (article.featuredImage) {
      tags.push(['image', article.featuredImage]);
    }
    
    if (article.byline) {
      tags.push(['author', article.byline]);
    }

    // Phase 18 C2 — scholarly identity (additive/optional): a DOI rides
    // as a greppable `doi` tag plus its NIP-73 external-id form
    // (['i', 'doi:<lowercase>']); an arXiv id as `arxiv`. Metadata the
    // publisher embedded, never inferred.
    if (article.scholar && article.scholar.doi) {
      tags.push(['doi', article.scholar.doi]);
      tags.push(['i', 'doi:' + article.scholar.doi.toLowerCase()]);
    }
    if (article.scholar && article.scholar.arxiv_id) {
      const v = article.scholar.arxiv_version ? 'v' + article.scholar.arxiv_version : '';
      tags.push(['arxiv', article.scholar.arxiv_id + v]);
    }

    // Phase 21 — podcast identity (additive/optional): universal
    // podcast IDs the USER supplied at import, never inferred. Greppable
    // tag + NIP-73 external-id co-emit, the DOI pattern. All values
    // String()-coerced (a numeric iTunes id would kill the event at the
    // relay — the Instagram pk lesson). Feed GUIDs (podcast-namespace
    // UUIDs) are lowercased in the `i` form; episode guids are
    // case-significant free strings and ride verbatim.
    if (article.podcast) {
      const pod = article.podcast;
      if (pod.show)  tags.push(['show', String(pod.show)]);
      if (pod.feed_guid) {
        tags.push(['podcast_guid', String(pod.feed_guid)]);
        tags.push(['i', 'podcast:guid:' + String(pod.feed_guid).toLowerCase()]);
      }
      if (pod.episode_guid) {
        tags.push(['podcast_episode_guid', String(pod.episode_guid)]);
        tags.push(['i', 'podcast:item:guid:' + String(pod.episode_guid)]);
      }
      if (pod.feed_url) {
        tags.push(['feed_url', String(pod.feed_url)]);
        pushR(String(pod.feed_url));   // co-emitted after the primary r; deduped
      }
      if (pod.itunes_id) tags.push(['itunes_id', String(pod.itunes_id)]);
    }

    // Transcript structure manifest — DISTINCT from `transcript_lang`
    // (that one is a per-track language manifest with different
    // positional semantics). Bodies live in content, always; this is a
    // count manifest so consumers know what was imported.
    if (article.transcript_meta) {
      const tm = article.transcript_meta;
      tags.push(['transcript_meta',
        `${tm.format || ''}:${tm.turn_count || 0}:${tm.speaker_count || 0}`]);
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
            pushR(ref.target);
          }
        } catch (_) { /* invalid relationship; silently drop the entry */ }
      }
    }

    // `capture-url` extension (docs/NIP_DRAFT.md): the address this
    // capture was actually fetched from, present ONLY when it differs
    // from the identity URL — i.e. an archive/mirror capture re-keyed
    // to its recovered original. At most one per event. Also co-emit
    // an indexed `r` so relays answer `#r=<mirror>` on this event —
    // strictly AFTER the primary `r`: readers take the FIRST `r` as
    // the article URL (reconstructArticleFromEvent invariant).
    if (article.capture_url && article.capture_url !== article.url) {
      tags.push(['capture-url', article.capture_url]);
      pushR(article.capture_url);
    }

    // `link` extension (docs/NIP_DRAFT.md; named `cites` pre-rename):
    // one tag per distinct EXTERNAL outbound link in the captured
    // body, document order. Linkage only — endorsement/response is
    // `responds-to`. The extraction cap means absence is NOT evidence
    // of absence. Indexed `r` co-emits for the first 25 targets make
    // the edge queryable from the linked side; they come after the
    // primary r / responds-to / capture-url co-emits and share their
    // dedupe (the FIRST r stays the article URL).
    if (Array.isArray(article.links)) {
      let linked = 0;
      for (const link of article.links) {
        if (!link || !link.url || link.internal) continue;
        const anchorText = String(link.text || '').slice(0, 120);
        tags.push(anchorText ? ['link', link.url, anchorText] : ['link', link.url]);
        if (linked < 25) pushR(link.url);
        linked += 1;
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
        
        // Add name tag for clients that don't resolve pubkeys.
        // Keep in sync with entity-model.js entityTypeToTag.
        const tagType = entity.type === 'person' ? 'person' : entity.type === 'organization' ? 'org' : entity.type === 'thing' ? 'thing' : entity.type === 'case' ? 'case' : 'place';
        tags.push([tagType, entity.name, entityRef.context]);

        // If this entity is an alias, also tag the canonical entity
        if (entity.canonical_id) {
          const canonical = await Storage.entities.get(entity.canonical_id);
          if (canonical && canonical.keypair && !taggedPubkeys.has(canonical.keypair.pubkey)) {
            tags.push(['p', canonical.keypair.pubkey, '', entityRef.context]);
            taggedPubkeys.add(canonical.keypair.pubkey);
            const canonTagType = canonical.type === 'person' ? 'person' : canonical.type === 'organization' ? 'org' : canonical.type === 'thing' ? 'thing' : canonical.type === 'case' ? 'case' : 'place';
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
    
    // Add claim tags (thin — Phase 10.2)
    if (Array.isArray(claims)) {
      for (const claim of claims) {
        tags.push(claim.is_key ? ['claim', claim.text, 'key'] : ['claim', claim.text]);
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
      // Guarantee every tag value is a string. Article metadata harvested
      // from a page's JSON-LD can legitimately be an array (`articleSection`)
      // or an object (`inLanguage: {"@type":"Language","name":"en"}`); a
      // single non-string tag value makes relays reject the *entire* event
      // with "invalid: tag val was not a string".
      tags: EventBuilder.sanitizeTags(tags),
      content
    };

    return event;
  },

  // Coerce a single tag atom to a string, or null if it can't be reduced
  // to a meaningful one. Strings pass through; numbers/booleans stringify;
  // arrays flatten (filtering empties) and join; schema.org-shaped objects
  // yield their `name` / `@value` / `@id`; everything else is rejected.
  coerceTagAtom: (value) => {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (value == null) return null;
    if (Array.isArray(value)) {
      const parts = value.map(EventBuilder.coerceTagAtom).filter((p) => p);
      return parts.length ? parts.join(', ') : null;
    }
    if (typeof value === 'object') {
      const candidate = value.name || value['@value'] || value['@id'];
      return typeof candidate === 'string' ? candidate : null;
    }
    return null;
  },

  // Make a tag array NOSTR-valid: every element must be a string. The tag
  // name (index 0) must be a non-empty string or the tag is dropped; if a
  // tag's primary value (index 1) collapses to null the whole tag is
  // dropped (publishing a `["section"]` with no value is meaningless);
  // trailing positional slots (e.g. the empty marker in `["p", pk, "",
  // "author"]`) are preserved as empty strings.
  sanitizeTags: (tags) => {
    const out = [];
    for (const tag of (tags || [])) {
      if (!Array.isArray(tag) || tag.length === 0) continue;
      const name = tag[0];
      if (typeof name !== 'string' || !name) continue;
      const rest = tag.slice(1).map(EventBuilder.coerceTagAtom);
      if (tag.length > 1 && rest[0] == null) continue;
      out.push([name, ...rest.map((atom) => (atom == null ? '' : atom))]);
    }
    return out;
  },

  // Generate d-tag from URL (16 chars)
  generateDTag: async (url) => {
    const hash = await Crypto.sha256(url);
    return hash.substring(0, 16);
  },

  // Build kind 0 profile event for entity. `about` (19.7, additive
  // param) is the enriched dossier-assembled text from
  // entity-profile.js#buildProfileAbout — published-claim facts only,
  // contested fields omitted, "per <source>" attribution; when absent
  // the pre-19.7 boilerplate ships unchanged. `externalIds` emits
  // NIP-39 ['i', ...] tags (E2 is unshipped, so usually empty).
  buildProfileEvent: (entity, canonicalNpub, about = null, externalIds = []) => {
    const tags = [];
    if (canonicalNpub) {
      tags.push(['refers_to', canonicalNpub]);
    }
    for (const extId of (externalIds || [])) {
      if (extId) tags.push(['i', String(extId), '']);
    }
    return {
      kind: 0,
      pubkey: entity.keypair.pubkey,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content: JSON.stringify({
        name: entity.name,
        about: about || `${entity.type} entity created by X-Ray`,
        nip05: entity.nip05 || undefined
      })
    };
  },

  // Build kind 30040 claim event — thin, entity-centric (Phase 10.2).
  //
  // Wire format (see docs/CLAIMS_REDESIGN.md):
  //   ['d', id], ['r', sourceUrl], ['title', articleTitle]
  //   per about-entity:  ['p', pubkey, '', 'about'] + ['entity', name, 'about']
  //   source (who said it):
  //     entity    → ['p', pubkey, '', 'source'] + ['source', name]
  //     free text → ['source', text]
  //     null      → (the article — no tag)
  //   ['key', 'true']?   ['anchor', <selector-json>]?   ['client', 'xray']
  //   text provenance (Phase 14.5 hardening — all additive/optional):
  //     ['quote', <verbatim article span>]   the span the claim is drawn from
  //     ['x', <canonical article hash>]      binds the quote to the exact
  //                                          article version (joins the
  //                                          audit family's `#x` queries)
  //     ['captured_at', <unix seconds>]      when the human captured the
  //                                          claim (created_at is publish time)
  //   content = claim text
  //
  // "What the network says about entity P" is then a single relay query:
  //   { kinds:[30040], "#p":[P_pubkey] }
  //
  // `predictionRef` (Phase 13.6, RQ6 — additive optional): when this
  // claim was promoted from a prediction-ledger entry, `{pred_d}` is
  // the 30058's wire d, and the claim emits an `a` back-reference so
  // lineage runs both directions. The coordinate's pubkey is the
  // publisher's — predictions and their promoted claims share one
  // signer in the v1 flow.
  buildClaimEvent: (claim, articleUrl, articleTitle, userPubkey, entities, predictionRef = null) => {
    const dict = entities || {};
    const tags = [
      ['d', claim.id],
      ['r', articleUrl],
    ];
    if (articleTitle) tags.push(['title', articleTitle]);
    if (predictionRef && predictionRef.pred_d) {
      tags.push(['a', `30058:${userPubkey}:${predictionRef.pred_d}`, '', 'prediction']);
    }

    // About entities — the queryable core. Entity ids resolve through
    // their canonical_id chain (E3, Phase 17A): a claim about an alias
    // tags the CANONICAL identity's pubkey, so the network's view of a
    // person doesn't fragment across merge history. Alias + canonical
    // both in `about` collapse to one p-tag pair. When the canonical
    // record isn't in the passed dict, the alias record is used as-is
    // (best effort — the publish sweep keeps canonicals in the batch).
    const seenAboutIds = new Set();
    for (const eid of (Array.isArray(claim.about) ? claim.about : [])) {
      const cid = canonicalIdOf(eid, dict);
      const ent = dict[cid] && dict[cid].keypair ? dict[cid] : dict[eid];
      if (!ent || !ent.keypair || seenAboutIds.has(ent.id)) continue;
      seenAboutIds.add(ent.id);
      tags.push(['p', ent.keypair.pubkey, '', 'about']);
      tags.push(['entity', ent.name, 'about']);
    }

    // Source — an entity id, free text, or null (= the article).
    if (claim.source) {
      if (/^entity_/.test(claim.source)) {
        const scid = canonicalIdOf(claim.source, dict);
        const s = dict[scid] && dict[scid].keypair ? dict[scid] : dict[claim.source];
        if (s && s.keypair) {
          tags.push(['p', s.keypair.pubkey, '', 'source']);
          tags.push(['source', s.name]);
        }
      } else {
        tags.push(['source', claim.source]);
      }
    }

    if (claim.is_key) tags.push(['key', 'true']);
    if (claim.anchor) tags.push(['anchor', JSON.stringify(claim.anchor)]);
    if (claim.quote) tags.push(['quote', claim.quote]);
    if (claim.article_hash) tags.push(['x', claim.article_hash]);
    if (claim.created) tags.push(['captured_at', String(claim.created)]);

    // Fact layer (Phase 19 §4, additive): ['fact', field, value,
    // subject pubkey] + per-slot band-truncated ISO dates — a
    // year-precision date goes out as '1962', never a fabricated full
    // timestamp. Wire facts are pubkey-keyed; a subject with no
    // resolvable pubkey emits NO fact tags at all (a fact tag without
    // its subject is dead wire data). Readers that don't know `fact`
    // see a normal claim.
    if (claim.fact) {
      // Wire facts are pubkey-keyed, and a foreign-adopted subject's
      // foreign_pubkey is exactly as resolvable as a local keypair —
      // requiring a LOCAL keypair silently dropped the whole fact
      // layer for adopted subjects (19.8 review fix). Root-else-alias
      // pick by usable wire pubkey.
      const wirePk = (r) => (r && ((r.keypair && r.keypair.pubkey) || r.foreign_pubkey)) || null;
      const fcid = canonicalIdOf(claim.fact.entity_id, dict);
      const subj = wirePk(dict[fcid]) ? dict[fcid] : dict[claim.fact.entity_id];
      const subjPk = wirePk(subj);
      if (subjPk) {
        tags.push(['fact', claim.fact.field, claim.fact.value, subjPk]);
        const slots = [
          ['valid_from',  claim.fact.valid_from,  claim.fact.valid_from_precision],
          ['valid_to',    claim.fact.valid_to,    claim.fact.valid_to_precision],
          ['observed_at', claim.fact.observed_at, claim.fact.observed_precision]
        ];
        for (const [slot, at, precision] of slots) {
          if (at !== null && at !== undefined) {
            tags.push([slot, bandISO(at, precision || 'exact'), precision || 'exact']);
          }
        }
      } else {
        Utils.log('Fact subject unresolvable in entity dict — omitting fact tags for claim', claim.id);
      }
    }
    tags.push(['client', 'xray']);

    return {
      kind: 30040,
      pubkey: userPubkey,
      created_at: Math.floor(Date.now() / 1000),
      tags: EventBuilder.sanitizeTags(tags),
      content: claim.text || ''
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
        ['client', 'xray'],
        ['entity-type', entityType],
        ['L', 'xray/entity-sync'],
        ['l', 'v1', 'xray/entity-sync']
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
        ['client', 'xray'],
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

  // Inverse of buildCommentEvent (Phase 12.1) — reconstruct a captured
  // comment from a kind-30041 event, for the portal's read-back path.
  // Pure and defensive in the parseClaimEvent style: tags first with
  // content fallback, optional tags become null/0, and anything that
  // isn't a usable comment (wrong kind, no text anywhere) returns null
  // so callers can fall back to a generic event row.
  //
  // `comment-date` was written in SECONDS by buildCommentEvent (which
  // normalizes ms upstream), but be tolerant on read: a 13-digit value
  // from some other writer is treated as ms and converted.
  parseCommentEvent: (event) => {
    if (!event || event.kind !== 30041) return null;
    const tags = event.tags || [];
    const first = (name) => { const t = tags.find((x) => x[0] === name); return t ? t[1] : ''; };
    const num = (name) => {
      const v = first(name);
      if (v === '') return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const text = first('comment-text') || event.content || '';
    if (!text) return null;
    let commentDate = num('comment-date');
    if (commentDate !== null && commentDate > 10_000_000_000) {
      commentDate = Math.floor(commentDate / 1000); // ms → s
    }
    const commenter = tags.find((x) => x[0] === 'p' && x[3] === 'commenter');
    const reactions = num('reaction-count');
    const restacks  = num('restack-count');
    return {
      id:              first('d') || event.id || '',
      text,
      author:          first('comment-author') || 'Unknown',
      platform:        first('platform') || '',
      authorHandle:    first('author-handle') || null,
      authorUrl:       first('author-url') || null,
      commentDate,
      replyTo:         first('reply-to') || null,
      reactionCount:   reactions === null ? 0 : reactions,
      restackCount:    restacks === null ? 0 : restacks,
      commenterPubkey: (commenter && commenter[1]) || null,
      url:             first('r') || '',
      title:           first('title') || '',
      pubkey:          event.pubkey || '',
      created_at:      event.created_at || 0,
      eventId:         event.id || null
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
  buildPlatformAccountEvent: (account, userPubkey, linkedEntityPubkey = null) => {
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
    // KS.2 wire addition (docs/KNOWLEDGE_SHARING_DESIGN.md §10): the
    // linking user's entity WIRE pubkey as a role-marked p tag. The
    // `linked-entity` id string above is reader-local; this makes
    // account → entity resolution a one-hop relay query for strangers.
    if (linkedEntityPubkey && /^[0-9a-f]{64}$/i.test(linkedEntityPubkey)) {
      tags.push(['p', linkedEntityPubkey, '', 'linked-entity']);
    }
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
    const linkPTag = event.tags.find((x) => Array.isArray(x) && x[0] === 'p' && x[3] === 'linked-entity');
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
      linkedEntityId: get('linked-entity') || null,
      linkedEntityPubkey: linkPTag ? linkPTag[1] : null
    };
  },

  // (Kind-30043 evidence links: builder deleted in Phase 11.2 — the
  // kind is retired per docs/ASSESSMENTS_DESIGN.md. Cross-source claim
  // relationships publish as kind 30055 via
  // metadata/builders.buildClaimRelationshipEvent, flag-gated.)

  // ─── Archive Reader: Relay Retrieval ───

  /**
   * Reconstruct an article object from a kind 30023 NOSTR event.
   * Inverse of buildArticleEvent().
   */
  /**
   * Rebuild the tagged-entity ref list from a kind-30023 event's typed
   * name tags (['person'|'org'|'place'|'thing'|'case', name, context]).
   * Async — the deterministic id derivation hashes type:name, and it
   * matches the local registry's own derivation, so reconstructed refs
   * JOIN local entity records when they exist and still render (name +
   * type from the wire) when they don't. Best-effort and fail-open: a
   * tag that can't be mapped is skipped. Separate from the synchronous
   * reconstructArticleFromEvent — callers attach the result to
   * `article.entities` themselves.
   */
  reconstructEntityRefsFromEvent: async (event) => {
    if (!event || event.kind !== 30023 || !Array.isArray(event.tags)) return [];
    // Inverse of the builder's tag-type ternary (see buildArticleEvent)
    // and entity-model.js entityTypeToTag.
    const TAG_TO_TYPE = {
      person: 'person', org: 'organization', place: 'place',
      thing: 'thing', case: 'case'
    };
    const refs = [];
    const seen = new Set();
    for (const tag of event.tags) {
      const type = TAG_TO_TYPE[tag[0]];
      if (!type || !tag[1]) continue;
      const name = tag[1];
      const context = tag[2] || null;
      try {
        const entityId = await generateEntityId(type, name);
        const key = `${entityId} ${context || ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        refs.push({ entity_id: entityId, type, name, context });
      } catch (_) { /* fail-open: skip the unmappable tag */ }
    }
    return refs;
  },

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
      // capture-url extension: the mirror address this capture was
      // fetched from (identity = the first `r`, always the original).
      capture_url: tags['capture-url'] || null,
      // link extension: only EXTERNAL links publish, so read-back
      // marks them all external. Dual-read: a few events shipped under
      // the pre-rename `cites` tag (same positions) — read second.
      // Null (not []) when the event predates the extension — "not
      // captured" is not "zero links".
      links: (() => {
        const linkTags = (tagArrays['link'] && tagArrays['link'].length)
          ? tagArrays['link'] : tagArrays['cites'];
        return (linkTags && linkTags.length)
          ? linkTags.map(v => ({ url: v[0] || '', text: v[1] || '', count: 1, internal: false }))
          : null;
      })(),
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
      // Phase 13.4 — the canonical article hash the publisher computed
      // at build time (the `x` tag). Carried as published rather than
      // recomputed: a markdown→HTML→markdown round trip would not
      // byte-match the original body. Null on pre-13.4 events.
      _articleHash: tags['x'] || null,
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

    // Phase 21 — podcast identity round-trip. Presence-gated on the
    // tags (never platform alone — no all-null objects). The transcript
    // TURN BODIES live in the content markdown, so transcript_meta
    // restores counts only; speaker names re-parse from the body.
    if (tags['podcast_guid'] || tags['podcast_episode_guid'] || tags['feed_url']
        || tags['itunes_id'] || tags['show']) {
      article.podcast = {
        show:         tags['show']                 || null,
        feed_guid:    tags['podcast_guid']         || null,
        episode_guid: tags['podcast_episode_guid'] || null,
        feed_url:     tags['feed_url']             || null,
        itunes_id:    tags['itunes_id']            || null,
        episode_url:  article.url                  || null
      };
    }
    if (tags['transcript_meta']) {
      const [format, turns, speakers] = String(tags['transcript_meta']).split(':');
      article.transcript_meta = {
        format:        format || '',
        turn_count:    parseInt(turns, 10) || 0,
        speaker_count: parseInt(speakers, 10) || 0,
        speakers:      null   // names live in the content body
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
  }
};
