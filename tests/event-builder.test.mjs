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
    for (const name of ['quote', 'x', 'captured_at', 'anchor']) {
        assert.equal(ev.tags.find((t) => t[0] === name), undefined, `no ${name} tag`);
    }
});
