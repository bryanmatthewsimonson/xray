// EventBuilder tests — issue #9.
//
// Covers the small/synchronous builders. The big one
// (buildArticleEvent) does enough storage-touching work that it
// already gets exercised end-to-end in the smoke test; pinning
// every tag here would be high-maintenance churn. Focus instead
// on the wire-shape contracts that other clients depend on:
// kind-30078 entity-sync events and kind-10002 NIP-65 relay lists.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// EventBuilder transitively imports Storage which probes
// `chrome.storage.local` at module-load time. Stub a minimal
// chrome global before importing.
globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

const { EventBuilder } = await import('../src/shared/event-builder.js');

const PUBKEY = '4ba5145ddce7322c3422096997fdf9d5cf9198312d7567b0dda275e580654a9f';

test('buildEntitySyncEvent has the d/L/l tags the pull filter expects', () => {
    const ev = EventBuilder.buildEntitySyncEvent('entity_abc', 'CIPHERTEXT', 'person', PUBKEY);
    assert.equal(ev.kind, 30078);
    assert.equal(ev.pubkey, PUBKEY);
    assert.equal(ev.content, 'CIPHERTEXT');
    const dTag = ev.tags.find((t) => t[0] === 'd');
    const LTag = ev.tags.find((t) => t[0] === 'L');
    const lTag = ev.tags.find((t) => t[0] === 'l');
    const tTag = ev.tags.find((t) => t[0] === 'entity-type');
    assert.deepEqual(dTag, ['d', 'entity_abc']);
    assert.deepEqual(LTag, ['L', 'xray/entity-sync']);
    assert.deepEqual(lTag, ['l', 'v1', 'xray/entity-sync']);
    assert.deepEqual(tTag, ['entity-type', 'person']);
});

test('buildClaimEvent (thin) — about p-tags, source, key; text in content', () => {
    const entities = {
        entity_p: { id: 'entity_p', name: 'Jane Roe',  type: 'person',       keypair: { pubkey: 'a'.repeat(64) } },
        entity_o: { id: 'entity_o', name: 'Acme Corp', type: 'organization', keypair: { pubkey: 'b'.repeat(64) } }
    };
    const claim = {
        id: 'claim_0123456789abcdef',
        text: 'Jane Roe runs Acme Corp.',
        about: ['entity_p', 'entity_o'],
        source: 'entity_p',
        is_key: true
    };
    const ev = EventBuilder.buildClaimEvent(claim, 'https://x.test/a', 'A Title', PUBKEY, entities);

    assert.equal(ev.kind, 30040);
    assert.equal(ev.content, 'Jane Roe runs Acme Corp.', 'claim text is the content');
    assert.deepEqual(ev.tags.find((t) => t[0] === 'd'), ['d', 'claim_0123456789abcdef']);
    assert.deepEqual(ev.tags.find((t) => t[0] === 'r'), ['r', 'https://x.test/a']);

    // About entities → p-tag (queryable) + human-readable entity name.
    const aboutPs = ev.tags.filter((t) => t[0] === 'p' && t[3] === 'about').map((t) => t[1]);
    assert.deepEqual(aboutPs.sort(), ['a'.repeat(64), 'b'.repeat(64)]);
    const aboutNames = ev.tags.filter((t) => t[0] === 'entity' && t[2] === 'about').map((t) => t[1]);
    assert.deepEqual(aboutNames.sort(), ['Acme Corp', 'Jane Roe']);

    // Source entity → p-tag(source) + source name.
    assert.deepEqual(ev.tags.find((t) => t[0] === 'p' && t[3] === 'source'), ['p', 'a'.repeat(64), '', 'source']);
    assert.deepEqual(ev.tags.find((t) => t[0] === 'source'), ['source', 'Jane Roe']);

    assert.deepEqual(ev.tags.find((t) => t[0] === 'key'), ['key', 'true']);
    assert.deepEqual(ev.tags.find((t) => t[0] === 'client'), ['client', 'xray']);

    // No legacy structured tags.
    for (const dead of ['claim-text', 'claim-type', 'crux', 'confidence', 'attribution', 'subject', 'object', 'predicate', 'claimant']) {
        assert.equal(ev.tags.find((t) => t[0] === dead), undefined, `no legacy ${dead} tag`);
    }
});

test('buildClaimEvent (thin) — free-text source, no source p-tag, no key when absent', () => {
    const claim = { id: 'claim_x', text: 'A.', about: [], source: 'An unnamed official', is_key: false };
    const ev = EventBuilder.buildClaimEvent(claim, 'https://x.test/a', '', PUBKEY, {});
    assert.deepEqual(ev.tags.find((t) => t[0] === 'source'), ['source', 'An unnamed official']);
    assert.equal(ev.tags.find((t) => t[0] === 'p' && t[3] === 'source'), undefined, 'free-text source gets no p-tag');
    assert.equal(ev.tags.find((t) => t[0] === 'key'), undefined, 'no key tag when not a key claim');
    assert.equal(ev.tags.find((t) => t[0] === 'title'), undefined, 'empty title omitted');
});

test('buildClaimEvent (thin) — anchor selectors serialize to an anchor tag', () => {
    const anchor = [{ type: 'TextQuoteSelector', exact: 'a passage', prefix: 'before ', suffix: ' after' }];
    const claim = { id: 'claim_a', text: 'A passage claim.', about: [], source: null, is_key: false, anchor };
    const ev = EventBuilder.buildClaimEvent(claim, 'https://x.test/a', '', PUBKEY, {});
    const anchorTag = ev.tags.find((t) => t[0] === 'anchor');
    assert.ok(anchorTag, 'anchor tag present when claim.anchor is set');
    assert.deepEqual(JSON.parse(anchorTag[1]), anchor, 'anchor tag round-trips the selector array');

    // No anchor tag when the claim has none.
    const bare = EventBuilder.buildClaimEvent({ id: 'claim_b', text: 'X', about: [] }, 'https://x.test/a', '', PUBKEY, {});
    assert.equal(bare.tags.find((t) => t[0] === 'anchor'), undefined);
});

test('buildRelayListEvent emits one r-tag per relay, kind 10002', () => {
    const relays = [
        'wss://relay.damus.io',
        'wss://nos.lol',
        'wss://relay.nostr.band'
    ];
    const ev = EventBuilder.buildRelayListEvent(relays, PUBKEY);
    assert.equal(ev.kind, 10002);
    assert.equal(ev.pubkey, PUBKEY);
    assert.equal(ev.content, '');
    const rTags = ev.tags.filter((t) => t[0] === 'r');
    assert.equal(rTags.length, 3);
    assert.deepEqual(rTags.map((t) => t[1]), relays);
});

test('buildRelayListEvent ignores non-string and empty entries', () => {
    const ev = EventBuilder.buildRelayListEvent(
        ['wss://a.example', null, '', undefined, 42, 'wss://b.example'],
        PUBKEY
    );
    const rTags = ev.tags.filter((t) => t[0] === 'r');
    assert.deepEqual(rTags.map((t) => t[1]), ['wss://a.example', 'wss://b.example']);
});

test('buildArticleEvent surfaces evidence hashes as tags when present', async () => {
    const article = {
        url: 'https://www.facebook.com/x/posts/1',
        title: 'Test',
        markdown: '# x',
        domain: 'facebook.com',
        evidence: {
            screenshotHash:    'a'.repeat(64),
            screenshotUrl:     'https://blossom.example/x.png',
            htmlSnapshotHash:  'b'.repeat(64)
        }
    };
    const ev = await EventBuilder.buildArticleEvent(article, [], PUBKEY, []);
    assert.ok(ev.tags.some((t) => t[0] === 'screenshot_sha256' && t[1] === 'a'.repeat(64)));
    assert.ok(ev.tags.some((t) => t[0] === 'screenshot_url' && t[1] === 'https://blossom.example/x.png'));
    assert.ok(ev.tags.some((t) => t[0] === 'html_snapshot_sha256' && t[1] === 'b'.repeat(64)));
});

test('buildArticleEvent omits evidence tags when article.evidence is absent', async () => {
    const article = { url: 'https://x', title: 'Test', markdown: '# x', domain: 'x' };
    const ev = await EventBuilder.buildArticleEvent(article, [], PUBKEY, []);
    assert.ok(!ev.tags.some((t) => t[0].startsWith('screenshot_') || t[0] === 'html_snapshot_sha256'));
});

test('buildArticleEvent coerces Instagram numeric pk to string tag value', async () => {
    // Regression: relays reject events with non-string tag values
    // ("invalid: tag val was not a string"). Instagram's REST API
    // gives us a numeric `pk`; downstream emission must stringify.
    const article = {
        url: 'https://www.instagram.com/p/ABC/',
        title: 'Test',
        markdown: '# x',
        domain: 'instagram.com',
        platform: 'instagram',
        instagram: {
            shortcode: 'ABC',
            postKind: 'post',
            author: {
                handle: 'reasonmagazine',
                pk: 507869549,                   // number, not string
                verified: true,
                followerCount: 151000
            }
        }
    };
    const ev = await EventBuilder.buildArticleEvent(article, [], PUBKEY, []);
    for (const t of ev.tags) {
        for (const v of t) {
            assert.equal(typeof v, 'string',
                `tag ${JSON.stringify(t)} has non-string value ${JSON.stringify(v)}`);
        }
    }
    const idTag = ev.tags.find((t) => t[0] === 'author_id');
    assert.deepEqual(idTag, ['author_id', '507869549']);
});

// --- Phase 21 podcast identity tags ---------------------------------

const PODCAST_ARTICLE = {
    url: 'https://pod.example/ep1',
    title: 'Origins Debate',
    markdown: '## Transcript\n\n**Alice:** hi',
    contentType: 'transcript',
    platform: 'podcast',
    podcast: {
        show: 'The Show',
        feed_guid: 'ABC-DEF-123',
        episode_guid: 'Ep-GUID-Case-Sensitive',
        feed_url: 'https://pod.example/rss.xml',
        itunes_id: 1600000000,           // number — must stringify
        episode_url: 'https://pod.example/ep1'
    },
    transcript_meta: { format: 'srt', turn_count: 42, speaker_count: 3, speakers: ['Alice', 'Bob', 'Host'] }
};

test('buildArticleEvent: podcast identity tags + NIP-73 i-forms, all string-coerced', async () => {
    const ev = await EventBuilder.buildArticleEvent(PODCAST_ARTICLE, [], PUBKEY, []);
    for (const t of ev.tags) for (const v of t) assert.equal(typeof v, 'string', `non-string in ${JSON.stringify(t)}`);
    const has = (k, v) => assert.ok(ev.tags.some((t) => t[0] === k && t[1] === v), `missing ${k}=${v}`);
    has('show', 'The Show');
    has('podcast_guid', 'ABC-DEF-123');
    has('i', 'podcast:guid:abc-def-123');                        // feed GUID lowercased in i form
    has('podcast_episode_guid', 'Ep-GUID-Case-Sensitive');
    has('i', 'podcast:item:guid:Ep-GUID-Case-Sensitive');       // episode GUID case preserved
    has('feed_url', 'https://pod.example/rss.xml');
    has('itunes_id', '1600000000');                             // coerced
    has('transcript_meta', 'srt:42:3');
    has('content_format', 'transcript');
    has('platform', 'podcast');
    // feed_url co-emitted as a second r AFTER the primary (article url first).
    const rTags = ev.tags.filter((t) => t[0] === 'r').map((t) => t[1]);
    assert.equal(rTags[0], 'https://pod.example/ep1', 'primary r stays first');
    assert.ok(rTags.includes('https://pod.example/rss.xml'), 'feed_url co-emitted as r');
});

test('buildArticleEvent: no podcast/transcript_meta tags when the fields are absent', async () => {
    const ev = await EventBuilder.buildArticleEvent(
        { url: 'https://x/y', title: 'T', markdown: '# a' }, [], PUBKEY, []);
    for (const k of ['show', 'podcast_guid', 'podcast_episode_guid', 'feed_url', 'itunes_id', 'transcript_meta']) {
        assert.ok(!ev.tags.some((t) => t[0] === k), `unexpected ${k} tag`);
    }
});

test('reconstructArticleFromEvent: podcast + transcript_meta round-trip', async () => {
    const ev = await EventBuilder.buildArticleEvent(PODCAST_ARTICLE, [], PUBKEY, []);
    const back = EventBuilder.reconstructArticleFromEvent(ev);
    assert.equal(back.contentType, 'transcript');
    assert.equal(back.platform, 'podcast');
    assert.equal(back.podcast.feed_guid, 'ABC-DEF-123');
    assert.equal(back.podcast.episode_guid, 'Ep-GUID-Case-Sensitive');
    assert.equal(back.podcast.feed_url, 'https://pod.example/rss.xml');
    assert.equal(back.podcast.itunes_id, '1600000000');
    assert.equal(back.podcast.show, 'The Show');
    assert.equal(back.transcript_meta.turn_count, 42);
    assert.equal(back.transcript_meta.speaker_count, 3);
    assert.equal(back.transcript_meta.speakers, null, 'names live in the body, not the manifest');
});

// --- Phase 22 user-declared media tag --------------------------------

test('buildArticleEvent: media tag emits for the two known values only', async () => {
    for (const v of ['podcast', 'video']) {
        const ev = await EventBuilder.buildArticleEvent(
            { url: 'https://x/y', title: 'T', markdown: '# a', media: v }, [], PUBKEY, []);
        assert.deepEqual(ev.tags.find((t) => t[0] === 'media'), ['media', v]);
    }
    // Absent field and unknown value both emit nothing.
    for (const article of [
        { url: 'https://x/y', title: 'T', markdown: '# a' },
        { url: 'https://x/y', title: 'T', markdown: '# a', media: 'hologram' }
    ]) {
        const ev = await EventBuilder.buildArticleEvent(article, [], PUBKEY, []);
        assert.ok(!ev.tags.some((t) => t[0] === 'media'), 'unexpected media tag');
    }
});

test('reconstructArticleFromEvent: media round-trips; unknown value reads as absent', async () => {
    const ev = await EventBuilder.buildArticleEvent(
        { url: 'https://x/y', title: 'T', markdown: '# a', media: 'podcast' }, [], PUBKEY, []);
    assert.equal(EventBuilder.reconstructArticleFromEvent(ev).media, 'podcast');

    // A hand-forged unknown value must not survive read-back.
    const forged = { ...ev, tags: ev.tags.map((t) => (t[0] === 'media' ? ['media', 'hologram'] : t)) };
    assert.equal(EventBuilder.reconstructArticleFromEvent(forged).media, null);

    const plain = await EventBuilder.buildArticleEvent(
        { url: 'https://x/y', title: 'T', markdown: '# a' }, [], PUBKEY, []);
    assert.equal(EventBuilder.reconstructArticleFromEvent(plain).media, null);
});

test('buildRelayListEvent stamps created_at to a recent unix second', () => {
    const before = Math.floor(Date.now() / 1000);
    const ev = EventBuilder.buildRelayListEvent(['wss://a'], PUBKEY);
    const after = Math.floor(Date.now() / 1000);
    assert.ok(ev.created_at >= before && ev.created_at <= after,
        `created_at ${ev.created_at} outside [${before}, ${after}]`);
});

// --- Tag sanitization: relays reject any non-string tag value with
// "invalid: tag val was not a string". Article metadata harvested from a
// page's JSON-LD can be an array (articleSection) or an object
// (inLanguage), so buildArticleEvent must coerce before emitting. ---

test('coerceTagAtom reduces JSON-LD shapes to strings or null', () => {
    assert.equal(EventBuilder.coerceTagAtom('hi'), 'hi');
    assert.equal(EventBuilder.coerceTagAtom(42), '42');
    assert.equal(EventBuilder.coerceTagAtom(true), 'true');
    assert.equal(EventBuilder.coerceTagAtom(['History', 'Religion']), 'History, Religion');
    assert.equal(EventBuilder.coerceTagAtom({ '@type': 'Language', name: 'en' }), 'en');
    assert.equal(EventBuilder.coerceTagAtom({ '@value': 'fr' }), 'fr');
    assert.equal(EventBuilder.coerceTagAtom(null), null);
    assert.equal(EventBuilder.coerceTagAtom({ shape: 'unknown' }), null);
});

test('sanitizeTags keeps valid tags untouched and drops valueless ones', () => {
    const tags = [
        ['d', 'abc'],
        ['p', PUBKEY, '', 'author'],   // empty marker slot must survive
        ['t', 'article']
    ];
    assert.deepEqual(EventBuilder.sanitizeTags(tags), tags);

    // A section that collapsed to null (e.g. unstringifiable object) is dropped.
    const dropped = EventBuilder.sanitizeTags([['section', { weird: true }], ['t', 'ok']]);
    assert.deepEqual(dropped, [['t', 'ok']]);
});

test('buildArticleEvent stringifies array section and object language', async () => {
    const article = {
        url: 'https://www.josephsmithpapers.org/intro/x',
        title: 'Intro',
        domain: 'josephsmithpapers.org',
        excerpt: 'An introduction.',
        wordCount: 5000,
        section: ['History', 'Religion'],                       // JSON-LD array
        language: { '@type': 'Language', name: 'en' },          // JSON-LD object
        keywords: ['council', 'nauvoo'],
        structuredData: { type: 'Article' }
    };
    const ev = await EventBuilder.buildArticleEvent(article, [], PUBKEY, []);

    // Nothing in the event may be a non-string tag value.
    for (const t of ev.tags) {
        for (const v of t) {
            assert.equal(typeof v, 'string',
                `tag ${JSON.stringify(t)} has non-string value ${JSON.stringify(v)}`);
        }
    }
    assert.deepEqual(ev.tags.find((t) => t[0] === 'section'), ['section', 'History, Religion']);
    assert.deepEqual(ev.tags.find((t) => t[0] === 'lang'), ['lang', 'en']);
});

// ------------------------------------------------------------------
// parseCommentEvent — Phase 12.1 read-back (inverse of buildCommentEvent)
// ------------------------------------------------------------------

const FULL_COMMENT = {
    id: 'cmt:substack:98765',
    text: 'This completely contradicts what he said last week.',
    authorName: 'Jane Reader',
    authorHandle: 'janereader',
    authorUrl: 'https://substack.com/@janereader',
    platform: 'substack',
    timestamp: 1749500000000,    // ms — builder normalizes to seconds
    replyTo: 'cmt:substack:98000',
    reactionCount: 12,
    restacks: 3
};
const ACCOUNT_PUBKEY = 'c'.repeat(64);

test('parseCommentEvent round-trips buildCommentEvent field-for-field', () => {
    const ev = EventBuilder.buildCommentEvent(
        FULL_COMMENT, 'https://example.substack.com/p/post', 'The Post', PUBKEY, ACCOUNT_PUBKEY);
    const c = EventBuilder.parseCommentEvent(ev);
    assert.ok(c, 'parser must accept its own builder output');
    assert.equal(c.id, FULL_COMMENT.id);
    assert.equal(c.text, FULL_COMMENT.text);
    assert.equal(c.author, FULL_COMMENT.authorName);
    assert.equal(c.platform, 'substack');
    assert.equal(c.authorHandle, FULL_COMMENT.authorHandle);
    assert.equal(c.authorUrl, FULL_COMMENT.authorUrl);
    assert.equal(c.commentDate, 1749500000); // ms → s happened at build time
    assert.equal(c.replyTo, FULL_COMMENT.replyTo);
    assert.equal(c.reactionCount, 12);
    assert.equal(c.restackCount, 3);
    assert.equal(c.commenterPubkey, ACCOUNT_PUBKEY);
    assert.equal(c.url, 'https://example.substack.com/p/post');
    assert.equal(c.title, 'The Post');
    assert.equal(c.pubkey, PUBKEY);
});

test('parseCommentEvent: minimal comment degrades to nulls and zeros', () => {
    const ev = EventBuilder.buildCommentEvent(
        { id: 'cmt:youtube:1', text: 'short', platform: 'youtube' },
        'https://youtube.com/watch?v=x', 'Video', PUBKEY, null);
    const c = EventBuilder.parseCommentEvent(ev);
    assert.equal(c.author, 'Unknown');
    assert.equal(c.authorHandle, null);
    assert.equal(c.authorUrl, null);
    assert.equal(c.commentDate, null);
    assert.equal(c.replyTo, null);
    assert.equal(c.reactionCount, 0);
    assert.equal(c.restackCount, 0);
    assert.equal(c.commenterPubkey, null);
});

test('parseCommentEvent rejects wrong kinds and textless events', () => {
    assert.equal(EventBuilder.parseCommentEvent(null), null);
    assert.equal(EventBuilder.parseCommentEvent({ kind: 30040, tags: [], content: 'x' }), null);
    assert.equal(EventBuilder.parseCommentEvent({ kind: 30041, tags: [['d', 'x']], content: '' }), null);
});

test('parseCommentEvent tolerates a foreign ms-precision comment-date', () => {
    const c = EventBuilder.parseCommentEvent({
        kind: 30041,
        tags: [['d', 'x'], ['comment-text', 'hi'], ['comment-date', '1749500000000']],
        content: 'hi'
    });
    assert.equal(c.commentDate, 1749500000);
});

test('buildCommentEvent tag vocabulary is pinned (parser contract)', () => {
    const ev = EventBuilder.buildCommentEvent(
        FULL_COMMENT, 'https://example.substack.com/p/post', 'The Post', PUBKEY, ACCOUNT_PUBKEY);
    const names = [...new Set(ev.tags.map((t) => t[0]))].sort();
    assert.deepEqual(names, [
        'author-handle', 'author-url', 'client', 'comment-author',
        'comment-date', 'comment-text', 'd', 'p', 'platform',
        'r', 'reaction-count', 'reply-to', 'restack-count', 'title'
    ]);
});

test('buildClaimEvent — text-provenance tags round-trip through parseClaimEvent', async () => {
    const { parseClaimEvent } = await import('../src/shared/claim-model.js');
    const HASH = 'c'.repeat(64);
    const claim = {
        id: 'claim_prov', text: 'The audit never arrived.',
        about: [], source: null, is_key: false,
        quote: 'We never received the audit — not once…',
        article_hash: HASH,
        anchor: [{ type: 'TextQuoteSelector', exact: 'We never received the audit — not once…', prefix: 'said: “', suffix: '” and' },
                 { type: 'TextPositionSelector', start: 34, end: 74 }],
        created: 1751500000
    };
    const ev = EventBuilder.buildClaimEvent(claim, 'https://x.test/a', 'T', PUBKEY, {});

    assert.deepEqual(ev.tags.find((t) => t[0] === 'quote'), ['quote', claim.quote]);
    assert.deepEqual(ev.tags.find((t) => t[0] === 'x'), ['x', HASH]);
    assert.deepEqual(ev.tags.find((t) => t[0] === 'captured_at'), ['captured_at', '1751500000']);

    // The inverse read recovers the full provenance chain.
    const parsed = parseClaimEvent(ev);
    assert.equal(parsed.quote, claim.quote);
    assert.equal(parsed.articleHash, HASH);
    assert.equal(parsed.capturedAt, 1751500000);
    assert.ok(Array.isArray(parsed.anchor));
    assert.equal(parsed.anchor.find((s) => s.type === 'TextPositionSelector').start, 34);
});

test('buildClaimEvent — provenance tags are absent when the claim has none (no empty tags)', () => {
    const claim = { id: 'claim_bare', text: 'A.', about: [], source: null, is_key: false };
    const ev = EventBuilder.buildClaimEvent(claim, 'https://x.test/a', '', PUBKEY, {});
    for (const name of ['quote', 'x', 'captured_at', 'anchor', 'fact', 'valid_from', 'valid_to', 'observed_at']) {
        assert.equal(ev.tags.find((t) => t[0] === name), undefined, `no ${name} tag`);
    }
});

// --- Canonical p-tags (Phase 17A E3) -----------------------------------------

test('buildClaimEvent — alias about-entity emits the CANONICAL pubkey p-tag', () => {
    const CANON_PK = 'f'.repeat(64);
    const dict = {
        entity_root:  { id: 'entity_root', name: 'Elena Vargas', type: 'person',
                        keypair: { pubkey: CANON_PK } },
        entity_alias: { id: 'entity_alias', name: 'Mayor Elena Vargas', type: 'person',
                        canonical_id: 'entity_root', keypair: { pubkey: '1'.repeat(64) } }
    };
    const claim = { id: 'claim_e3a', text: 'A.', about: ['entity_alias'], source: 'entity_alias', is_key: false };
    const ev = EventBuilder.buildClaimEvent(claim, 'https://x.test/a', '', PUBKEY, dict);

    assert.deepEqual(ev.tags.filter((t) => t[0] === 'p' && t[3] === 'about').map((t) => t[1]),
        [CANON_PK], 'about p-tag targets the canonical identity');
    assert.deepEqual(ev.tags.find((t) => t[0] === 'entity'), ['entity', 'Elena Vargas', 'about']);
    assert.deepEqual(ev.tags.find((t) => t[0] === 'p' && t[3] === 'source'),
        ['p', CANON_PK, '', 'source'], 'source resolves canonically too');
});

test('buildClaimEvent — alias + canonical both in about collapse to ONE p-tag pair', () => {
    const CANON_PK = 'f'.repeat(64);
    const dict = {
        entity_root:  { id: 'entity_root', name: 'Elena Vargas', type: 'person', keypair: { pubkey: CANON_PK } },
        entity_alias: { id: 'entity_alias', name: 'Mayor Elena Vargas', type: 'person',
                        canonical_id: 'entity_root', keypair: { pubkey: '1'.repeat(64) } }
    };
    const claim = { id: 'claim_e3b', text: 'A.', about: ['entity_alias', 'entity_root'], source: null, is_key: false };
    const ev = EventBuilder.buildClaimEvent(claim, 'https://x.test/a', '', PUBKEY, dict);
    assert.equal(ev.tags.filter((t) => t[0] === 'p' && t[3] === 'about').length, 1);
    assert.equal(ev.tags.filter((t) => t[0] === 'entity').length, 1);
});

test('buildClaimEvent — canonical missing from dict falls back to the alias record', () => {
    const ALIAS_PK = '1'.repeat(64);
    const dict = {
        entity_alias: { id: 'entity_alias', name: 'Mayor Elena Vargas', type: 'person',
                        canonical_id: 'entity_root', keypair: { pubkey: ALIAS_PK } }
    };
    const claim = { id: 'claim_e3c', text: 'A.', about: ['entity_alias'], source: null, is_key: false };
    const ev = EventBuilder.buildClaimEvent(claim, 'https://x.test/a', '', PUBKEY, dict);
    assert.deepEqual(ev.tags.find((t) => t[0] === 'p' && t[3] === 'about'),
        ['p', ALIAS_PK, '', 'about'], 'best effort: reference survives rather than vanishing');
});

// --- Fact layer tags (Phase 19.2; docs/NIP_DRAFT.md kind 30040) --------------

test('buildClaimEvent — fact tags: subject pubkey + band-truncated ISO dates', async () => {
    const { parseClaimEvent } = await import('../src/shared/claim-model.js');
    const SUBJ_PK = 'd'.repeat(64);
    const entities = {
        entity_w: { id: 'entity_w', name: 'W.H.O.', type: 'organization', keypair: { pubkey: SUBJ_PK } }
    };
    const claim = {
        id: 'claim_fact1', text: 'Founded in April 1948.', about: ['entity_w'],
        source: null, is_key: false, created: 1751500000,
        fact: {
            entity_id: 'entity_w', field: 'founded', value: '1948', value_ref: null,
            valid_from: Date.UTC(1948, 3, 1) / 1000, valid_from_precision: 'month',
            valid_to: null, valid_to_precision: null,
            observed_at: 1751000000, observed_precision: 'exact'
        }
    };
    const ev = EventBuilder.buildClaimEvent(claim, 'https://x.test/a', '', PUBKEY, entities);

    assert.deepEqual(ev.tags.find((t) => t[0] === 'fact'),
        ['fact', 'founded', '1948', SUBJ_PK]);
    // Band-truncated ISO: month precision goes out as YYYY-MM — never a
    // fabricated full timestamp.
    assert.deepEqual(ev.tags.find((t) => t[0] === 'valid_from'),
        ['valid_from', '1948-04', 'month']);
    assert.equal(ev.tags.find((t) => t[0] === 'valid_to'), undefined, 'null slot emits no tag');
    const obs = ev.tags.find((t) => t[0] === 'observed_at');
    assert.equal(obs[2], 'exact');
    assert.match(obs[1], /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/, 'exact emits full ISO');

    // Tag order: fact tags sit between captured_at and client.
    const names = ev.tags.map((t) => t[0]);
    assert.ok(names.indexOf('fact') > names.indexOf('captured_at'));
    assert.ok(names.indexOf('fact') < names.indexOf('client'));

    // Round-trip through parseClaimEvent recovers the band faithfully.
    const parsed = parseClaimEvent(ev);
    assert.equal(parsed.fact.subject_pubkey, SUBJ_PK);
    assert.equal(parsed.fact.valid_from.at, claim.fact.valid_from);
    assert.equal(parsed.fact.valid_from.precision, 'month');
    assert.equal(parsed.fact.observed_at.at, 1751000000);
});

test('buildClaimEvent — fact with unresolvable subject emits NO fact tags', () => {
    const claim = {
        id: 'claim_fact2', text: 'A.', about: ['entity_gone'], source: null, is_key: false,
        fact: { entity_id: 'entity_gone', field: 'founded', value: '1948',
                valid_from: 0, valid_from_precision: 'year' }
    };
    const ev = EventBuilder.buildClaimEvent(claim, 'https://x.test/a', '', PUBKEY, {});
    for (const name of ['fact', 'valid_from', 'valid_to', 'observed_at']) {
        assert.equal(ev.tags.find((t) => t[0] === name), undefined,
            `${name} omitted when the subject has no pubkey (dead wire data)`);
    }
});

test('buildClaimEvent — foreign fact subject uses its synthesized keypair pubkey', () => {
    const FOREIGN_PK = 'e'.repeat(64);
    const entities = {
        entity_f: { id: 'entity_f', name: 'Foreign Person', type: 'person',
                    foreign: true, keypair: { pubkey: FOREIGN_PK } }
    };
    const claim = {
        id: 'claim_fact3', text: 'Born 1962.', about: ['entity_f'], source: null, is_key: false,
        fact: { entity_id: 'entity_f', field: 'birth_date', value: '1962',
                valid_from: Date.UTC(1962, 0, 1) / 1000, valid_from_precision: 'year' }
    };
    const ev = EventBuilder.buildClaimEvent(claim, 'https://x.test/a', '', PUBKEY, entities);
    assert.deepEqual(ev.tags.find((t) => t[0] === 'fact'),
        ['fact', 'birth_date', '1962', FOREIGN_PK]);
    assert.deepEqual(ev.tags.find((t) => t[0] === 'valid_from'),
        ['valid_from', '1962', 'year'], 'year precision emits bare YYYY');
});

// --- capture-url extension (url-identity; docs/NIP_DRAFT.md) -----------------

test('buildArticleEvent emits capture-url + a mirror r AFTER the primary r', async () => {
    const article = {
        url: 'https://example.com/story',
        capture_url: 'https://archive.ph/AbC12',
        title: 'Test', markdown: '# x', domain: 'example.com'
    };
    const ev = await EventBuilder.buildArticleEvent(article, [], PUBKEY, []);

    const capTags = ev.tags.filter((t) => t[0] === 'capture-url');
    assert.equal(capTags.length, 1, 'at most one capture-url');
    assert.deepEqual(capTags[0], ['capture-url', 'https://archive.ph/AbC12']);

    // First-r invariant: readers take the FIRST r as the article URL;
    // the mirror co-emit must come after it.
    const rValues = ev.tags.filter((t) => t[0] === 'r').map((t) => t[1]);
    assert.equal(rValues[0], 'https://example.com/story', 'primary r stays first');
    assert.ok(rValues.includes('https://archive.ph/AbC12'), 'mirror co-emitted for #r queries');
});

test('buildArticleEvent omits capture-url when absent or equal to the identity URL', async () => {
    const plain = await EventBuilder.buildArticleEvent(
        { url: 'https://example.com/a', title: 'T', markdown: '# x', domain: 'example.com' },
        [], PUBKEY, []);
    assert.ok(!plain.tags.some((t) => t[0] === 'capture-url'));

    const same = await EventBuilder.buildArticleEvent(
        { url: 'https://example.com/a', capture_url: 'https://example.com/a', title: 'T', markdown: '# x', domain: 'example.com' },
        [], PUBKEY, []);
    assert.ok(!same.tags.some((t) => t[0] === 'capture-url'),
        'no self-referential capture-url noise');
    assert.equal(same.tags.filter((t) => t[0] === 'r').length, 1);
});

test('reconstructArticleFromEvent: first r is the identity, capture-url reads back', async () => {
    const article = {
        url: 'https://example.com/story',
        capture_url: 'https://web.archive.org/web/2020/https://example.com/story',
        title: 'Test', markdown: '# Test\n\nBody.', domain: 'example.com'
    };
    const ev = await EventBuilder.buildArticleEvent(article, [], PUBKEY, []);
    const back = EventBuilder.reconstructArticleFromEvent({ ...ev, id: 'e'.repeat(64) });
    assert.ok(back);
    assert.equal(back.url, 'https://example.com/story',
        'identity = first r, never the mirror');
    assert.equal(back.capture_url, 'https://web.archive.org/web/2020/https://example.com/story');
});

// --- link extension (outbound links; docs/NIP_DRAFT.md) ----------------------

test('buildArticleEvent emits link tags for external links only, r co-emits capped at 25', async () => {
    const links = [];
    for (let i = 0; i < 30; i++) {
        links.push({ url: `https://site${String(i).padStart(2, '0')}.org/x`, text: `source ${i}`, count: 1, internal: false });
    }
    links.push({ url: 'https://example.com/nav', text: 'home', count: 3, internal: true });
    const article = {
        url: 'https://example.com/story', title: 'T', markdown: '# x',
        domain: 'example.com', links
    };
    const ev = await EventBuilder.buildArticleEvent(article, [], PUBKEY, []);

    const linkTags = ev.tags.filter((t) => t[0] === 'link');
    assert.equal(linkTags.length, 30, 'every EXTERNAL link emitted; internal never');
    assert.deepEqual(linkTags[0], ['link', 'https://site00.org/x', 'source 0'], 'document order + anchor text');
    assert.equal(ev.tags.filter((t) => t[0] === 'cites').length, 0, 'the pre-rename cites tag is never emitted');

    const rValues = ev.tags.filter((t) => t[0] === 'r').map((t) => t[1]);
    assert.equal(rValues[0], 'https://example.com/story', 'primary r stays FIRST');
    assert.equal(rValues.length, 1 + 25, 'r co-emits capped at 25');
    assert.ok(!rValues.includes('https://site29.org/x'), 'target 30 gets a link tag but no r');
    assert.ok(!rValues.includes('https://example.com/nav'), 'internal links never co-emit');
});

test('buildArticleEvent link tags: anchor text bounded to 120, empty text omitted, r deduped', async () => {
    const article = {
        url: 'https://example.com/story', title: 'T', markdown: '# x', domain: 'example.com',
        capture_url: 'https://archive.ph/AbC12',
        links: [
            { url: 'https://other.org/long', text: 'z'.repeat(300), count: 1, internal: false },
            { url: 'https://other.org/bare', text: '', count: 1, internal: false },
            // Already co-emitted as the capture-url mirror — no second r.
            { url: 'https://archive.ph/AbC12', text: 'self-archive', count: 1, internal: false }
        ]
    };
    const ev = await EventBuilder.buildArticleEvent(article, [], PUBKEY, []);
    const linkTags = ev.tags.filter((t) => t[0] === 'link');
    assert.equal(linkTags[0][2].length, 120, 'anchor text truncated to 120');
    assert.equal(linkTags[1].length, 2, 'no empty third element for bare links');
    const archiveRs = ev.tags.filter((t) => t[0] === 'r' && t[1] === 'https://archive.ph/AbC12');
    assert.equal(archiveRs.length, 1, 'r co-emits dedupe against existing r tags');
});

test('reconstructArticleFromEvent reads link tags back as links; null when absent', async () => {
    const article = {
        url: 'https://example.com/story', title: 'T', markdown: '# Test\n\nBody.', domain: 'example.com',
        links: [
            { url: 'https://other.org/paper', text: 'the study', count: 2, internal: false },
            { url: 'https://example.com/nav', text: 'home', count: 1, internal: true }
        ]
    };
    const ev = await EventBuilder.buildArticleEvent(article, [], PUBKEY, []);
    const back = EventBuilder.reconstructArticleFromEvent({ ...ev, id: 'e'.repeat(64) });
    assert.deepEqual(back.links, [{ url: 'https://other.org/paper', text: 'the study', count: 1, internal: false }],
        'external links round-trip; internal were never published');

    const plain = await EventBuilder.buildArticleEvent(
        { url: 'https://example.com/a', title: 'T', markdown: '# x', domain: 'example.com' }, [], PUBKEY, []);
    const backPlain = EventBuilder.reconstructArticleFromEvent({ ...plain, id: 'f'.repeat(64) });
    assert.equal(backPlain.links, null, 'pre-extension events read back null, not []');
});

test('reconstructArticleFromEvent dual-reads the legacy cites tag (pre-rename window)', async () => {
    const article = {
        url: 'https://example.com/story', title: 'T', markdown: '# Test\n\nBody.', domain: 'example.com',
        links: [{ url: 'https://other.org/paper', text: 'the study', count: 1, internal: false }]
    };
    const ev = await EventBuilder.buildArticleEvent(article, [], PUBKEY, []);
    // Rewrite the emitted link tags to the pre-rename name — same positions.
    const legacy = {
        ...ev,
        id: 'e'.repeat(64),
        tags: ev.tags.map((t) => (t[0] === 'link' ? ['cites', ...t.slice(1)] : t))
    };
    const back = EventBuilder.reconstructArticleFromEvent(legacy);
    assert.deepEqual(back.links, [{ url: 'https://other.org/paper', text: 'the study', count: 1, internal: false }],
        'events published in the brief cites window still reconstruct');
});

test('r co-emits share ONE dedupe: no duplicate r tags across responds-to/capture-url/link', async () => {
    const article = {
        url: 'https://example.com/story', title: 'T', markdown: '# x', domain: 'example.com',
        capture_url: 'https://archive.ph/AbC12',
        respondsTo: [
            { target: 'https://example.com/story', relationship: 'extends' },   // = primary r
            { target: 'https://archive.ph/AbC12', relationship: 'rebuts' },     // = capture_url mirror
            { target: 'https://other.org/piece', relationship: 'rebuts' },
            { target: 'https://other.org/piece', relationship: 'extends' }      // repeated target
        ],
        links: [
            { url: 'https://other.org/piece', text: 'cited too', count: 1, internal: false },
            { url: 'https://fresh.example/x', text: 'fresh', count: 1, internal: false }
        ]
    };
    const ev = await EventBuilder.buildArticleEvent(article, [], PUBKEY, []);
    const rValues = ev.tags.filter((t) => t[0] === 'r').map((t) => t[1]);
    assert.equal(new Set(rValues).size, rValues.length, 'no duplicate r tags');
    assert.equal(rValues[0], 'https://example.com/story', 'primary r stays first');
    assert.deepEqual(new Set(rValues), new Set([
        'https://example.com/story', 'https://archive.ph/AbC12',
        'https://other.org/piece', 'https://fresh.example/x'
    ]));
});

// --- buildProfileEvent (Phase 19.7 — the FIRST profile-event tests) -----------

test('buildProfileEvent — boilerplate back-compat + enriched about + i tags', () => {
    const entity = {
        id: 'entity_pp', name: 'W.H.O.', type: 'organization', nip05: '',
        keypair: { pubkey: 'a'.repeat(64) }
    };
    // Pre-19.7 call shape: unchanged boilerplate.
    const plain = EventBuilder.buildProfileEvent(entity, null);
    assert.equal(plain.kind, 0);
    assert.equal(plain.pubkey, 'a'.repeat(64));
    assert.equal(JSON.parse(plain.content).about, 'organization entity created by X-Ray');
    assert.deepEqual(plain.tags, []);

    // Enriched about replaces the boilerplate; refers_to + i tags ride.
    const enriched = EventBuilder.buildProfileEvent(entity, 'npub1canonical',
        'organization entity. Global health agency.\nheadquarters: Geneva (per who-times.test)',
        ['wikidata:Q7817']);
    const content = JSON.parse(enriched.content);
    assert.match(content.about, /per who-times\.test/);
    assert.deepEqual(enriched.tags.find((t) => t[0] === 'refers_to'), ['refers_to', 'npub1canonical']);
    assert.deepEqual(enriched.tags.find((t) => t[0] === 'i'), ['i', 'wikidata:Q7817', '']);
});
