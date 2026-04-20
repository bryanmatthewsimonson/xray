// URL metadata query service. Queries NOSTR relays for every event kind
// X-Ray knows about related to the current URL, aggregates them, and
// caches the result. Ported from the userscript with no behavioral change.

var URLMetadataService = {
  cache: new Map(),
  subscriptions: new Map(),
  activeQueries: new Map(),

  EVENT_KINDS: {
    ANNOTATION: 32123,
    CONTENT_RATING: 32124,
    ENTITY_REFERENCE: 32125,
    RATING_AGGREGATE: 32126,
    FACT_CHECK: 32127,
    PROFILE_URL_MAPPING: 32128,
    HEADLINE_CORRECTION: 32129,
    DISPUTE_REBUTTAL: 32130,
    RELATED_CONTENT: 32131,
    URL_REACTION: 32132,
    TRUST_ATTESTATION: 32140,
    VERIFICATION_RESULT: 32141,
    SOURCE_CITATION: 32142,
    CONTENT_ARCHIVE: 32143,
    METADATA_AGGREGATE: 32144
  },

  normalizeUrl: (url) => Utils.normalizeUrl(url),

  computeUrlHash: async (url) => Utils.sha256(URLMetadataService.normalizeUrl(url)),

  buildQueryFilters: (normalizedUrl) => {
    const K = URLMetadataService.EVENT_KINDS;
    const coreKinds = [
      K.ANNOTATION, K.CONTENT_RATING, K.ENTITY_REFERENCE, K.RATING_AGGREGATE,
      K.FACT_CHECK, K.PROFILE_URL_MAPPING, K.HEADLINE_CORRECTION,
      K.DISPUTE_REBUTTAL, K.RELATED_CONTENT, K.URL_REACTION
    ];
    const extendedKinds = [
      K.TRUST_ATTESTATION, K.VERIFICATION_RESULT, K.SOURCE_CITATION,
      K.CONTENT_ARCHIVE, K.METADATA_AGGREGATE
    ];
    return [
      { kinds: coreKinds,     '#r': [normalizedUrl] },
      { kinds: extendedKinds, '#r': [normalizedUrl] }
    ];
  },

  queryMetadata: async (url, relayUrls = null) => {
    const normalizedUrl = URLMetadataService.normalizeUrl(url);
    const urlHash = await URLMetadataService.computeUrlHash(url);

    const cached = await URLMetadataService.getCachedMetadata(urlHash);
    if (cached && (Date.now() - cached.timestamp) < 300000) {
      Utils.log('Using cached metadata for:', normalizedUrl);
      return cached.data;
    }

    if (!relayUrls) {
      relayUrls = CONFIG.relays.filter(r => r.enabled && r.read).map(r => r.url);
    }

    Utils.log('Querying metadata for:', normalizedUrl, 'from', relayUrls.length, 'relays');

    const filters = URLMetadataService.buildQueryFilters(normalizedUrl);
    const events = [];

    const queryPromises = relayUrls.map(async (relayUrl) => {
      try {
        const relayEvents = await URLMetadataService.queryRelay(relayUrl, filters);
        events.push(...relayEvents);
      } catch (e) {
        Utils.log('Failed to query relay:', relayUrl, e.message);
      }
    });
    await Promise.allSettled(queryPromises);

    const uniqueEvents = URLMetadataService.deduplicateEvents(events);
    const metadata = URLMetadataService.aggregateMetadata(uniqueEvents, normalizedUrl);
    await URLMetadataService.cacheMetadata(urlHash, metadata);
    return metadata;
  },

  queryRelay: (relayUrl, filters) => {
    return new Promise(async (resolve, reject) => {
      const events = [];
      const subId = 'nmd_' + Utils.generateId();

      try {
        const ws = await NostrClient.connectToRelay(relayUrl);

        const timeout = setTimeout(() => resolve(events), 5000);

        // Wrap the shared NostrClient.onmessage handler so both the generic
        // relay client and this query receive messages.
        const originalHandler = ws.onmessage;
        ws.onmessage = (msg) => {
          try {
            const data = JSON.parse(msg.data);
            const [type, ...rest] = data;
            if (type === 'EVENT' && rest[0] === subId) {
              events.push(rest[1]);
            } else if (type === 'EOSE' && rest[0] === subId) {
              clearTimeout(timeout);
              ws.onmessage = originalHandler;
              ws.send(JSON.stringify(['CLOSE', subId]));
              resolve(events);
            } else if (originalHandler) {
              originalHandler(msg);
            }
          } catch (_) {
            if (originalHandler) originalHandler(msg);
          }
        };

        ws.send(JSON.stringify(['REQ', subId, ...filters]));
      } catch (e) {
        reject(e);
      }
    });
  },

  deduplicateEvents: (events) => {
    const seen = new Map();
    for (const event of events) {
      if (!seen.has(event.id) || event.created_at > seen.get(event.id).created_at) {
        seen.set(event.id, event);
      }
    }
    return Array.from(seen.values());
  },

  aggregateMetadata: (events, normalizedUrl) => {
    const metadata = {
      url: normalizedUrl,
      queryTime: Date.now(),
      eventCount: events.length,
      annotations: [],
      comments: [],
      ratings: [],
      factChecks: [],
      headlineCorrections: [],
      disputes: [],
      relatedContent: [],
      reactions: [],
      entityReferences: [],
      aggregates: {
        trustScore: null,
        ratingCounts: { total: 0 },
        verdictSummary: null
      }
    };

    const K = URLMetadataService.EVENT_KINDS;
    for (const event of events) {
      try {
        const parsed = URLMetadataService.parseEvent(event);
        if (!parsed) continue;

        switch (event.kind) {
          case K.ANNOTATION: {
            const annotationType = event.tags.find(t => t[0] === 'annotation-type');
            if (annotationType && annotationType[1] === 'comment') metadata.comments.push(parsed);
            else                                                   metadata.annotations.push(parsed);
            break;
          }
          case K.CONTENT_RATING:        metadata.ratings.push(parsed); break;
          case K.FACT_CHECK:            metadata.factChecks.push(parsed); break;
          case K.HEADLINE_CORRECTION:   metadata.headlineCorrections.push(parsed); break;
          case K.DISPUTE_REBUTTAL:      metadata.disputes.push(parsed); break;
          case K.RELATED_CONTENT:       metadata.relatedContent.push(parsed); break;
          case K.URL_REACTION:          metadata.reactions.push(parsed); break;
          case K.ENTITY_REFERENCE:      metadata.entityReferences.push(parsed); break;
          case K.RATING_AGGREGATE:
          case K.METADATA_AGGREGATE:
            if (parsed.trustScore !== undefined) metadata.aggregates.trustScore = parsed.trustScore;
            break;
        }
      } catch (e) {
        Utils.log('Failed to parse event:', event.id, e);
      }
    }

    metadata.aggregates.ratingCounts.total = metadata.ratings.length;
    metadata.aggregates.annotationCount    = metadata.annotations.length;
    metadata.aggregates.factCheckCount     = metadata.factChecks.length;

    if (metadata.aggregates.trustScore === null && metadata.ratings.length > 0) {
      metadata.aggregates.trustScore = URLMetadataService.computeTrustScore(metadata.ratings);
    }
    if (metadata.factChecks.length > 0) {
      metadata.aggregates.verdictSummary = URLMetadataService.computeVerdictSummary(metadata.factChecks);
    }

    return metadata;
  },

  parseEvent: (event) => {
    const tags = new Map();
    for (const tag of event.tags) {
      const [key, ...values] = tag;
      if (!tags.has(key)) tags.set(key, []);
      tags.get(key).push(values);
    }

    let content = {};
    try { content = JSON.parse(event.content); }
    catch (_) { content = { text: event.content }; }

    return {
      id: event.id,
      pubkey: event.pubkey,
      createdAt: event.created_at,
      kind: event.kind,
      tags: Object.fromEntries(tags),
      content,
      raw: event
    };
  },

  computeTrustScore: (ratings) => {
    if (ratings.length === 0) return null;
    const weights = { accuracy: 0.30, quality: 0.15, depth: 0.10, clarity: 0.10, bias: 0.20, sources: 0.15 };
    let totalScore = 0, totalWeight = 0;
    for (const rating of ratings) {
      const content = rating.content;
      if (!content.ratings) continue;
      for (const [dimension, score] of Object.entries(content.ratings)) {
        const weight = weights[dimension] || 0.1;
        if (typeof score === 'number' && score >= 0 && score <= 5) {
          totalScore += (score / 5) * weight;
          totalWeight += weight;
        }
      }
    }
    return totalWeight > 0 ? totalScore / totalWeight : null;
  },

  computeVerdictSummary: (factChecks) => {
    const verdicts = { true: 0, false: 0, misleading: 0, unverifiable: 0, satire: 0, opinion: 0 };
    for (const fc of factChecks) {
      const verdict = fc.content.verdict?.toLowerCase() || 'unverifiable';
      if (verdicts.hasOwnProperty(verdict)) verdicts[verdict]++;
    }
    let primary = 'none', maxCount = 0;
    for (const [verdict, count] of Object.entries(verdicts)) {
      if (count > maxCount) { maxCount = count; primary = verdict; }
    }
    const hasDebunking = verdicts.false > 0 || verdicts.misleading > 0;
    return {
      primary,
      counts: verdicts,
      total: factChecks.length,
      hasDebunking,
      severity: hasDebunking ? (verdicts.false > verdicts.misleading ? 'high' : 'medium') : 'low'
    };
  },

  cacheMetadata: async (urlHash, metadata) => {
    const cacheKey = 'nmd_cache_' + urlHash;
    await Storage.set(cacheKey, { timestamp: Date.now(), data: metadata });
    URLMetadataService.cache.set(urlHash, { timestamp: Date.now(), data: metadata });
  },

  getCachedMetadata: async (urlHash) => {
    if (URLMetadataService.cache.has(urlHash)) return URLMetadataService.cache.get(urlHash);
    const cacheKey = 'nmd_cache_' + urlHash;
    const cached = await Storage.get(cacheKey, null);
    if (cached) URLMetadataService.cache.set(urlHash, cached);
    return cached;
  },

  subscribeToUpdates: async (url, callback) => {
    const normalizedUrl = URLMetadataService.normalizeUrl(url);
    const subId = 'nmd_sub_' + Utils.generateId();
    const relayUrls = CONFIG.relays.filter(r => r.enabled && r.read).map(r => r.url);
    const filters = URLMetadataService.buildQueryFilters(normalizedUrl);
    const since = Math.floor(Date.now() / 1000);
    const realtimeFilters = filters.map(f => ({ ...f, since }));

    URLMetadataService.subscriptions.set(subId, {
      url: normalizedUrl,
      callback,
      relays: new Map()
    });

    for (const relayUrl of relayUrls) {
      try {
        const ws = await NostrClient.connectToRelay(relayUrl);
        ws.send(JSON.stringify(['REQ', subId, ...realtimeFilters]));
        URLMetadataService.subscriptions.get(subId).relays.set(relayUrl, ws);
      } catch (e) {
        Utils.log('Failed to subscribe to relay:', relayUrl, e.message);
      }
    }
    return subId;
  },

  unsubscribe: (subId) => {
    const sub = URLMetadataService.subscriptions.get(subId);
    if (!sub) return;
    for (const [, ws] of sub.relays) {
      try { ws.send(JSON.stringify(['CLOSE', subId])); } catch (_) { /* ignore */ }
    }
    URLMetadataService.subscriptions.delete(subId);
  },

  clearCache: async () => {
    URLMetadataService.cache.clear();
    const keys = await Storage.keys();
    for (const key of keys) {
      if (key.startsWith('nmd_cache_')) await Storage.delete(key);
    }
  }
};
