// Facebook handler tests — Phase 8d.
//
// Pin the URL grammar across all recognized Facebook post/video/reel
// /photo shapes, the og:description parser, and the GraphQL recursive
// walker. `synthesizeArticle` itself is tested via the smoke checklist
// on real Facebook pages — too much page-world interaction to mock.

import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};
globalThis.window = globalThis.window || {
    location: { hostname: 'www.facebook.com', pathname: '/reasonmagazine/posts/1234567890', href: 'https://www.facebook.com/reasonmagazine/posts/1234567890' }
};

const { postRefFromUrl, parseOgDescription, extractMetaFields, extractPostFromGraphQL, extractContentImageUrls, parseFacebookDateString, parseRelativeTime, findCreationTime } =
    await import('../src/shared/platforms/facebook.js');

// ------------------------------------------------------------------
// URL grammar
// ------------------------------------------------------------------

test('postRefFromUrl matches /<user>/posts/<id>', () => {
    const r = postRefFromUrl('https://www.facebook.com/reasonmagazine/posts/1234567890');
    assert.deepEqual(r, { id: '1234567890', kind: 'post' });
});

test('postRefFromUrl matches /<user>/posts/<pfbid...>', () => {
    const r = postRefFromUrl('https://www.facebook.com/reasonmagazine/posts/pfbid0abcdef123');
    assert.deepEqual(r, { id: 'pfbid0abcdef123', kind: 'post' });
});

test('postRefFromUrl matches /<user>/videos/<id>', () => {
    const r = postRefFromUrl('https://www.facebook.com/reasonmagazine/videos/9876543210');
    assert.deepEqual(r, { id: '9876543210', kind: 'video' });
});

test('postRefFromUrl matches /<user>/photos/<set>/<id>', () => {
    const r = postRefFromUrl('https://www.facebook.com/reasonmagazine/photos/a.111/222');
    assert.deepEqual(r, { id: '222', kind: 'photo' });
});

test('postRefFromUrl matches /reel/<id>', () => {
    const r = postRefFromUrl('https://www.facebook.com/reel/abcDEF12345');
    assert.deepEqual(r, { id: 'abcDEF12345', kind: 'reel' });
});

test('postRefFromUrl matches /watch/?v=<id>', () => {
    const r = postRefFromUrl('https://www.facebook.com/watch/?v=1234567890');
    assert.deepEqual(r, { id: '1234567890', kind: 'video' });
});

test('postRefFromUrl matches /permalink.php?story_fbid=<id>', () => {
    const r = postRefFromUrl('https://www.facebook.com/permalink.php?story_fbid=999&id=111');
    assert.deepEqual(r, { id: '999', kind: 'post' });
});

test('postRefFromUrl matches /story.php?story_fbid=<id>', () => {
    const r = postRefFromUrl('https://www.facebook.com/story.php?story_fbid=888&id=222');
    assert.deepEqual(r, { id: '888', kind: 'post' });
});

test('postRefFromUrl matches /share/p|v|r/<shortcode>', () => {
    assert.deepEqual(postRefFromUrl('https://www.facebook.com/share/p/aBc123XYZ/'),
        { id: 'aBc123XYZ', kind: 'post' });
    assert.deepEqual(postRefFromUrl('https://www.facebook.com/share/v/aBc123XYZ/'),
        { id: 'aBc123XYZ', kind: 'video' });
    assert.deepEqual(postRefFromUrl('https://www.facebook.com/share/r/aBc123XYZ/'),
        { id: 'aBc123XYZ', kind: 'reel' });
});

test('postRefFromUrl matches /photo/?fbid=<id> and /photo.php?fbid=<id>', () => {
    assert.deepEqual(postRefFromUrl('https://www.facebook.com/photo/?fbid=5555'),
        { id: '5555', kind: 'photo' });
    assert.deepEqual(postRefFromUrl('https://www.facebook.com/photo.php?fbid=6666'),
        { id: '6666', kind: 'photo' });
});

test('postRefFromUrl matches /groups/<g>/posts|permalink/<id>/', () => {
    assert.deepEqual(postRefFromUrl('https://www.facebook.com/groups/mygroup/posts/1234/'),
        { id: '1234', kind: 'post' });
    assert.deepEqual(postRefFromUrl('https://www.facebook.com/groups/123456/permalink/7890/'),
        { id: '7890', kind: 'post' });
});

test('postRefFromUrl rejects profile pages and non-Facebook origins', () => {
    assert.equal(postRefFromUrl('https://www.facebook.com/reasonmagazine/'), null);
    assert.equal(postRefFromUrl('https://www.facebook.com/'), null);
    assert.equal(postRefFromUrl('https://example.com/reasonmagazine/posts/123'), null);
});

test('postRefFromUrl accepts m. and fb.com subdomains', () => {
    assert.deepEqual(postRefFromUrl('https://m.facebook.com/reel/abc'),
        { id: 'abc', kind: 'reel' });
    assert.deepEqual(postRefFromUrl('https://fb.com/share/p/xyz/'),
        { id: 'xyz', kind: 'post' });
});

test('postRefFromUrl returns null on malformed input', () => {
    assert.equal(postRefFromUrl('not a url'), null);
    assert.equal(postRefFromUrl(''), null);
});

// ------------------------------------------------------------------
// og:description parser
// ------------------------------------------------------------------

test('parseOgDescription extracts author + body from "<Author>: \\"<body>\\""', () => {
    const out = parseOgDescription('Reason Magazine: "The rich don\'t pay their fair share — 5 myths"');
    assert.equal(out.author, 'Reason Magazine');
    assert.equal(out.body,   'The rich don\'t pay their fair share — 5 myths');
});

test('parseOgDescription handles smart-quoted bodies', () => {
    const out = parseOgDescription('Some Page: “smart-quoted post body”');
    assert.equal(out.author, 'Some Page');
    assert.equal(out.body,   'smart-quoted post body');
});

test('parseOgDescription handles "<Author> wrote on Facebook: <body>"', () => {
    const out = parseOgDescription('Jane Doe wrote on Facebook: Hello world');
    assert.equal(out.author, 'Jane Doe');
    assert.equal(out.body,   'Hello world');
});

test('parseOgDescription extracts leading engagement counts', () => {
    const out = parseOgDescription('1,234 likes, 56 comments, 7 shares — Reason Magazine: "Body"');
    assert.equal(out.author, 'Reason Magazine');
    assert.equal(out.body,   'Body');
    assert.equal(out.engagement.likes,    1234);
    assert.equal(out.engagement.comments, 56);
    assert.equal(out.engagement.shares,   7);
});

test('parseOgDescription falls back to whole-string body on unparseable input', () => {
    const out = parseOgDescription('Some random post content with no recognizable structure');
    assert.equal(out.author, null);
    assert.equal(out.body,   'Some random post content with no recognizable structure');
});

test('parseOgDescription returns nulls for empty/missing input', () => {
    assert.deepEqual(parseOgDescription(''),
        { author: null, body: null, engagement: {} });
    assert.deepEqual(parseOgDescription(null),
        { author: null, body: null, engagement: {} });
});

// ------------------------------------------------------------------
// extractMetaFields
// ------------------------------------------------------------------

function fakeMetaDoc(metas) {
    return {
        querySelector(selector) {
            const m = selector.match(/^meta\[(property|name)="([^"]+)"\]$/);
            if (!m) return null;
            const [, kind, key] = m;
            const found = metas.find((tag) => tag[kind] === key);
            return found ? { getAttribute: (a) => found[a] || '' } : null;
        }
    };
}

test('extractMetaFields reads og + description fallback', () => {
    const doc = fakeMetaDoc([
        { property: 'og:title',       content: 'Reason Magazine | Facebook' },
        { property: 'og:description', content: 'Reason Magazine: "Body"' },
        { property: 'og:image',       content: 'https://scontent/x.jpg' },
        { property: 'og:url',         content: 'https://www.facebook.com/reasonmagazine/posts/123' },
        { property: 'og:site_name',   content: 'Facebook' }
    ]);
    const meta = extractMetaFields(doc);
    assert.equal(meta.title,    'Reason Magazine | Facebook');
    assert.equal(meta.description, 'Reason Magazine: "Body"');
    assert.equal(meta.image,    'https://scontent/x.jpg');
    assert.equal(meta.siteName, 'Facebook');
});

test('extractMetaFields falls back to meta[name=description] when og:description missing', () => {
    const doc = fakeMetaDoc([
        { name: 'description', content: 'Some text' }
    ]);
    const meta = extractMetaFields(doc);
    assert.equal(meta.description, 'Some text');
});

// ------------------------------------------------------------------
// GraphQL recursive walker
// ------------------------------------------------------------------

test('extractPostFromGraphQL finds a story by actors + message.text', () => {
    const parsed = {
        data: {
            node: {
                actors: [{ name: 'Jane Doe', username: 'jane', is_verified: true }],
                message: { text: 'Hello world' },
                creation_time: 1700000000,
                feedback: {
                    reaction_count:      { count: 42 },
                    comments:            { total_count: 7 },
                    share_count:         { count: 3 }
                }
            }
        }
    };
    const out = extractPostFromGraphQL(parsed);
    assert.ok(out);
    assert.equal(out.user.name, 'Jane Doe');
    assert.equal(out.user.username, 'jane');
    assert.equal(out.story.message.text, 'Hello world');
    assert.equal(out.engagement.reactions, 42);
    assert.equal(out.engagement.comments,  7);
    assert.equal(out.engagement.shares,    3);
});

test('extractPostFromGraphQL walks deeply-nested envelopes', () => {
    const post = {
        actors: [{ name: 'Bob' }],
        message: { text: 'Deep post' }
    };
    const wrapped = {
        data: {
            viewer: {
                actor: {
                    posted_item_privacy_scope: {
                        feed_unit: { story: post }
                    }
                }
            }
        }
    };
    const out = extractPostFromGraphQL(wrapped);
    assert.ok(out, 'recursive walk must find the story');
    assert.equal(out.user.name, 'Bob');
    assert.equal(out.story.message.text, 'Deep post');
});

test('extractPostFromGraphQL handles creation_time + message shape (permalink response)', () => {
    const parsed = {
        data: {
            story: {
                creation_time: 1700000000,
                message: { text: 'Permalink post' }
            }
        }
    };
    const out = extractPostFromGraphQL(parsed);
    assert.ok(out);
    assert.equal(out.story.message.text, 'Permalink post');
});

test('extractPostFromGraphQL returns null on unrecognized shapes', () => {
    assert.equal(extractPostFromGraphQL(null), null);
    assert.equal(extractPostFromGraphQL({}), null);
    assert.equal(extractPostFromGraphQL({ data: { something_else: { id: '1' } } }), null);
});

// ------------------------------------------------------------------
// Content-image scraper
// ------------------------------------------------------------------

function fakeImg({ src = '', currentSrc = '', width = 0, height = 0,
                   naturalWidth = 0, naturalHeight = 0 } = {}) {
    return {
        src, currentSrc, width, height, naturalWidth, naturalHeight,
        getBoundingClientRect: () => ({ width, height }),
        getAttribute(name) {
            if (name === 'src') return src;
            if (name === 'width')  return String(width);
            if (name === 'height') return String(height);
            return null;
        }
    };
}

test('extractContentImageUrls accepts fbcdn hosts', () => {
    const imgs = [
        fakeImg({ src: 'https://scontent-iad3-1.xx.fbcdn.net/v/t39.30808-6/post1.jpg?_nc_oh=abc&oe=def', width: 800, height: 1000 }),
        fakeImg({ src: 'https://scontent-sjc3-1.xx.fbcdn.net/v/t39.30808-6/post2.jpg?_nc_oh=xyz', width: 800, height: 1000 })
    ];
    const out = extractContentImageUrls(imgs);
    assert.equal(out.length, 2);
    assert.ok(out.every((u) => u.includes('fbcdn.net')));
});

test('extractContentImageUrls retains signing query string', () => {
    // FB CDN returns 403 without signing tokens. Dedup key is path-only
    // but the emitted URL MUST include the query string.
    const imgs = [
        fakeImg({ src: 'https://scontent.xx.fbcdn.net/v/t39/post.jpg?_nc_oh=TOKEN&oe=DEADBEEF', width: 1080, height: 1080 })
    ];
    const out = extractContentImageUrls(imgs);
    assert.equal(out.length, 1);
    assert.ok(out[0].includes('?_nc_oh=TOKEN'));
});

test('extractContentImageUrls rejects non-fbcdn URLs', () => {
    const imgs = [
        fakeImg({ src: 'https://example.com/image.jpg', width: 1080, height: 1080 }),
        fakeImg({ src: 'data:image/png;base64,AAA',     width: 1080, height: 1080 })
    ];
    assert.deepEqual(extractContentImageUrls(imgs), []);
});

test('extractContentImageUrls filters avatars and icons by size', () => {
    const imgs = [
        fakeImg({ src: 'https://scontent.xx.fbcdn.net/v/avatar.jpg', width: 40,   height: 40 }),   // avatar
        fakeImg({ src: 'https://scontent.xx.fbcdn.net/v/post.jpg',   width: 1080, height: 1350 })  // content
    ];
    const out = extractContentImageUrls(imgs);
    assert.equal(out.length, 1);
    assert.ok(out[0].includes('post.jpg'));
});

test('extractContentImageUrls dedups by path but retains first-seen query', () => {
    // Same image, different signing params across reloads.
    const imgs = [
        fakeImg({ src: 'https://scontent.xx.fbcdn.net/v/post.jpg?_nc_oh=TOKEN1', width: 1080, height: 1080 }),
        fakeImg({ src: 'https://scontent.xx.fbcdn.net/v/post.jpg?_nc_oh=TOKEN2', width: 1080, height: 1080 })
    ];
    const out = extractContentImageUrls(imgs);
    assert.equal(out.length, 1);
    assert.ok(out[0].includes('TOKEN1'));
});

test('extractContentImageUrls handles empty / null input', () => {
    assert.deepEqual(extractContentImageUrls([]),     []);
    assert.deepEqual(extractContentImageUrls(null),   []);
    assert.deepEqual(extractContentImageUrls(undefined), []);
});

// ------------------------------------------------------------------
// Publish-date extraction
// ------------------------------------------------------------------

test('parseFacebookDateString handles "Monday, April 21, 2026 at 9:30 PM"', () => {
    const ts = parseFacebookDateString('Monday, April 21, 2026 at 9:30 PM');
    // Should parse to some unix seconds in April 2026.
    const d = new Date(ts * 1000);
    assert.equal(d.getUTCFullYear(), 2026);
    assert.equal(d.getUTCMonth(), 3);   // April = 3 (0-indexed)
});

test('parseFacebookDateString handles "April 21, 2026 at 9:30 PM"', () => {
    const ts = parseFacebookDateString('April 21, 2026 at 9:30 PM');
    const d = new Date(ts * 1000);
    assert.equal(d.getUTCFullYear(), 2026);
});

test('parseFacebookDateString returns null on unparseable input', () => {
    assert.equal(parseFacebookDateString('just some text'), null);
    assert.equal(parseFacebookDateString(''), null);
    assert.equal(parseFacebookDateString(null), null);
});

test('parseRelativeTime converts "12h" to an approximate unix seconds', () => {
    const now = 1_700_000_000_000;
    const ts = parseRelativeTime('12h', now);
    // Should be now - 12 hours.
    assert.equal(ts, Math.floor(now / 1000) - 12 * 3600);
});

test('parseRelativeTime handles "3d", "45m", "2w", "1y"', () => {
    const now = 1_700_000_000_000;
    assert.equal(parseRelativeTime('3d', now),  Math.floor(now / 1000) - 3 * 86400);
    assert.equal(parseRelativeTime('45m', now), Math.floor(now / 1000) - 45 * 60);
    assert.equal(parseRelativeTime('2w', now),  Math.floor(now / 1000) - 2 * 604800);
    assert.equal(parseRelativeTime('1y', now),  Math.floor(now / 1000) - 31536000);
});

test('parseRelativeTime returns null on garbage', () => {
    assert.equal(parseRelativeTime('yesterday'), null);
    assert.equal(parseRelativeTime('just now'),  null);
    assert.equal(parseRelativeTime(''),          null);
});

test('parseRelativeTime tolerates surrounding noise ("12h ·", " 3d ago")', () => {
    const now = 1_700_000_000_000;
    assert.equal(parseRelativeTime('12h ·', now),   Math.floor(now / 1000) - 12 * 3600);
    assert.equal(parseRelativeTime(' 3d ago', now), Math.floor(now / 1000) - 3 * 86400);
    assert.equal(parseRelativeTime('12h\n', now),   Math.floor(now / 1000) - 12 * 3600);
});

test('parseRelativeTime rejects non-word-boundary matches ("12hours", "12hr")', () => {
    // A body sentence like "for 12 hours now" should not accidentally
    // match — word-boundary anchor prevents picking up substrings
    // embedded in longer words.
    assert.equal(parseRelativeTime('12hours'), null);
    assert.equal(parseRelativeTime('12hr'),    null);
});

test('findCreationTime finds top-level creation_time', () => {
    assert.equal(findCreationTime({ creation_time: 1700000000 }), 1700000000);
});

test('findCreationTime walks into comet_sections.timestamp.story', () => {
    // Real-world FB GraphQL shape — timestamp nested deep.
    const story = {
        id: 'abc',
        message: { text: 'hello' },
        comet_sections: {
            timestamp: {
                story: { creation_time: 1700000000 }
            }
        }
    };
    assert.equal(findCreationTime(story), 1700000000);
});

test('findCreationTime walks into creation_story.creation_time', () => {
    const story = {
        message: { text: 'hi' },
        creation_story: { creation_time: 1600000000 }
    };
    assert.equal(findCreationTime(story), 1600000000);
});

test('findCreationTime skips comment/feedback trees', () => {
    // A comment's `feedback` may have its own `creation_time` that's
    // NOT the post's time. We should skip into them.
    const story = {
        message: { text: 'post body' },
        creation_time: 1700000000,
        feedback: {
            comments: [{ creation_time: 1700000999 }]  // comment time, NOT post time
        }
    };
    assert.equal(findCreationTime(story), 1700000000);
});

test('findCreationTime returns null when no timestamp present', () => {
    assert.equal(findCreationTime({}), null);
    assert.equal(findCreationTime({ message: { text: 'hi' } }), null);
    assert.equal(findCreationTime(null), null);
});

test('extractPostFromGraphQL picks owner/author when actors missing', () => {
    const parsed = {
        data: {
            story: {
                owner: { name: 'Alice' },
                actors: [{ name: 'Alice' }],
                message: { text: 'Owner-based post' }
            }
        }
    };
    const out = extractPostFromGraphQL(parsed);
    assert.ok(out);
    assert.equal(out.user.name, 'Alice');
});
