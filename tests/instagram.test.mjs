// Instagram handler tests — Phase 8c.
//
// Pin the URL grammar and the og:description parser. Both are
// pure functions; the rest of `synthesizeArticle` is tested via
// the smoke checklist on real Instagram pages.

import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};
globalThis.window = globalThis.window || {
    location: { hostname: 'www.instagram.com', pathname: '/p/AbCdEf123/' }
};

const { shortcodeFromUrl, parseOgDescription, extractMetaFields, extractContentImageUrls, extractMediaFromGraphQL, extractUserFromGraphQL } =
    await import('../src/shared/platforms/instagram.js');

// ------------------------------------------------------------------
// URL grammar
// ------------------------------------------------------------------

test('shortcodeFromUrl matches /p/<shortcode>/', () => {
    assert.equal(shortcodeFromUrl('https://www.instagram.com/p/AbCdEf-_/'), 'AbCdEf-_');
});

test('shortcodeFromUrl matches /reel/<shortcode>/', () => {
    assert.equal(shortcodeFromUrl('https://www.instagram.com/reel/Cx9Y8Z/'), 'Cx9Y8Z');
});

test('shortcodeFromUrl matches /tv/<shortcode>/ (legacy IGTV)', () => {
    assert.equal(shortcodeFromUrl('https://www.instagram.com/tv/B12345/'), 'B12345');
});

test('shortcodeFromUrl matches /<user>/p/<shortcode>/', () => {
    assert.equal(shortcodeFromUrl('https://www.instagram.com/natgeo/p/Xyz_42/'), 'Xyz_42');
});

test('shortcodeFromUrl matches /<user>/reel/<shortcode>/', () => {
    assert.equal(shortcodeFromUrl('https://www.instagram.com/natgeo/reel/Qrs8w/'), 'Qrs8w');
});

test('shortcodeFromUrl rejects profile pages and unrelated paths', () => {
    assert.equal(shortcodeFromUrl('https://www.instagram.com/natgeo/'), null);
    assert.equal(shortcodeFromUrl('https://www.instagram.com/explore/'), null);
    assert.equal(shortcodeFromUrl('https://www.instagram.com/'), null);
    assert.equal(shortcodeFromUrl('https://example.com/p/abc/'), null);
});

test('shortcodeFromUrl handles m. subdomain', () => {
    assert.equal(shortcodeFromUrl('https://m.instagram.com/p/AbCdEf/'), 'AbCdEf');
});

test('shortcodeFromUrl returns null on malformed input', () => {
    assert.equal(shortcodeFromUrl('not a url'), null);
    assert.equal(shortcodeFromUrl(''), null);
});

// ------------------------------------------------------------------
// og:description parser
// ------------------------------------------------------------------

test('parseOgDescription extracts author + handle + caption from full structured form', () => {
    const desc = '1,234 likes, 56 comments — Jane Doe (@janedoe) on Instagram: "Beautiful sunset 🌅"';
    const out = parseOgDescription(desc);
    assert.equal(out.author,  'Jane Doe');
    assert.equal(out.handle,  'janedoe');
    assert.equal(out.caption, 'Beautiful sunset 🌅');
});

test('parseOgDescription handles missing leading engagement counts', () => {
    const desc = 'Jane Doe (@janedoe) on Instagram: "Hello"';
    const out = parseOgDescription(desc);
    assert.equal(out.author,  'Jane Doe');
    assert.equal(out.handle,  'janedoe');
    assert.equal(out.caption, 'Hello');
});

test('parseOgDescription handles missing parenthesized handle', () => {
    const desc = '12 likes — Jane Doe on Instagram: "Hi"';
    const out = parseOgDescription(desc);
    assert.equal(out.author,  'Jane Doe');
    assert.equal(out.handle,  null);
    assert.equal(out.caption, 'Hi');
});

test('parseOgDescription handles smart-quote captions', () => {
    const desc = '5 likes — Bob (@bob) on Instagram: “smart-quoted caption”';
    const out = parseOgDescription(desc);
    assert.equal(out.author,  'Bob');
    assert.equal(out.handle,  'bob');
    assert.equal(out.caption, 'smart-quoted caption');
});

test('parseOgDescription falls back to whole-string caption on unparseable input', () => {
    const desc = 'Some random non-Instagram-shaped string';
    const out = parseOgDescription(desc);
    assert.equal(out.author,  null);
    assert.equal(out.handle,  null);
    assert.equal(out.caption, 'Some random non-Instagram-shaped string');
});

test('parseOgDescription returns nulls for empty/missing input', () => {
    assert.deepEqual(parseOgDescription(''),
        { author: null, handle: null, caption: null });
    assert.deepEqual(parseOgDescription(null),
        { author: null, handle: null, caption: null });
    assert.deepEqual(parseOgDescription(undefined),
        { author: null, handle: null, caption: null });
});

// ------------------------------------------------------------------
// extractMetaFields with synthetic doc
// ------------------------------------------------------------------

function fakeMetaDoc(metas) {
    return {
        querySelector(selector) {
            // Match `meta[property="<x>"]` or `meta[name="<x>"]`.
            const m = selector.match(/^meta\[(property|name)="([^"]+)"\]$/);
            if (!m) return null;
            const [, kind, key] = m;
            const found = metas.find((tag) => tag[kind] === key);
            return found ? { getAttribute: (a) => found[a] || '' } : null;
        }
    };
}

test('extractMetaFields reads og + twitter pairs', () => {
    const doc = fakeMetaDoc([
        { property: 'og:title',       content: 'Bob on Instagram: "x"' },
        { property: 'og:description', content: '5 likes, 2 comments — Bob (@bob) on Instagram: "x"' },
        { property: 'og:image',       content: 'https://cdn/x.jpg' },
        { property: 'og:url',         content: 'https://www.instagram.com/p/Xyz/' },
        { name: 'twitter:label1', content: 'Likes' },
        { name: 'twitter:data1',  content: '5' },
        { name: 'twitter:label2', content: 'Comments' },
        { name: 'twitter:data2',  content: '2' }
    ]);
    const meta = extractMetaFields(doc);
    assert.equal(meta.title, 'Bob on Instagram: "x"');
    assert.equal(meta.image, 'https://cdn/x.jpg');
    assert.equal(meta.url,   'https://www.instagram.com/p/Xyz/');
    assert.equal(meta.engagement.likes, 5);
    assert.equal(meta.engagement.comments, 2);
});

// ------------------------------------------------------------------
// Content-image scraper
// ------------------------------------------------------------------

function fakeImg({ src = '', currentSrc = '', width = 0, height = 0,
                   naturalWidth = 0, naturalHeight = 0 } = {}) {
    return {
        src, currentSrc, width, height, naturalWidth, naturalHeight,
        getAttribute(name) {
            if (name === 'src') return src;
            if (name === 'width')  return String(width);
            if (name === 'height') return String(height);
            return null;
        }
    };
}

test('extractContentImageUrls picks Instagram CDN images', () => {
    const imgs = [
        fakeImg({ src: 'https://scontent-iad3-1.cdninstagram.com/v/t51/post-1.jpg', naturalWidth: 1080 }),
        fakeImg({ src: 'https://scontent.cdninstagram.com/v/t51/post-2.jpg',         naturalWidth: 1080 })
    ];
    const out = extractContentImageUrls(imgs);
    assert.equal(out.length, 2);
    assert.ok(out.every((u) => u.includes('cdninstagram.com')));
});

test('extractContentImageUrls accepts fbcdn.net hosts (Instagram CDN aliases)', () => {
    const imgs = [
        fakeImg({ src: 'https://scontent-iad3-1.fbcdn.net/v/t51/post.jpg', naturalWidth: 720 })
    ];
    const out = extractContentImageUrls(imgs);
    assert.equal(out.length, 1);
});

test('extractContentImageUrls rejects non-Instagram-CDN URLs', () => {
    const imgs = [
        fakeImg({ src: 'https://example.com/avatar.png', naturalWidth: 300 }),
        fakeImg({ src: 'data:image/png;base64,AAA',     naturalWidth: 300 }),
        fakeImg({ src: '',                              naturalWidth: 300 })
    ];
    assert.deepEqual(extractContentImageUrls(imgs), []);
});

test('extractContentImageUrls filters tiny avatars by size', () => {
    const imgs = [
        fakeImg({ src: 'https://scontent.cdninstagram.com/v/t51/avatar.jpg', naturalWidth: 100, naturalHeight: 100 }),
        fakeImg({ src: 'https://scontent.cdninstagram.com/v/t51/post.jpg',   naturalWidth: 1080, naturalHeight: 1080 })
    ];
    const out = extractContentImageUrls(imgs);
    assert.equal(out.length, 1);
    assert.ok(out[0].includes('post.jpg'));
});

test('extractContentImageUrls filters s120x120-style avatar paths', () => {
    const imgs = [
        fakeImg({ src: 'https://scontent.cdninstagram.com/v/t51/s120x120/avatar.jpg' }),
        fakeImg({ src: 'https://scontent.cdninstagram.com/v/t51/s640x640/post.jpg' })
    ];
    const out = extractContentImageUrls(imgs);
    assert.equal(out.length, 1);
    assert.ok(out[0].includes('s640x640'));
});

test('extractContentImageUrls dedups by path but RETAINS query string', () => {
    // Same image, two different cache-busting query params. We
    // must keep the FULL URL of whichever variant we saw first —
    // Instagram's CDN returns 403 to URLs without their signed
    // tokens, so a path-only URL is unloadable.
    const imgs = [
        fakeImg({ src: 'https://scontent.cdninstagram.com/v/t51/x.jpg?_nc_cat=1&token=abc', naturalWidth: 1080 }),
        fakeImg({ src: 'https://scontent.cdninstagram.com/v/t51/x.jpg?_nc_cat=2&token=def', naturalWidth: 1080 })
    ];
    const out = extractContentImageUrls(imgs);
    assert.equal(out.length, 1);
    // The retained URL must include its signing query string —
    // otherwise the rendered <img> in the reader returns 403.
    assert.ok(out[0].includes('?'),
        'returned URL must include query string (Instagram auth tokens)');
    assert.ok(out[0].includes('token=abc'),
        'first-seen variant should win the dedup race');
});

test('extractContentImageUrls preserves order of first-seen variants', () => {
    const imgs = [
        fakeImg({ src: 'https://scontent.cdninstagram.com/v/t51/a.jpg?t=1', naturalWidth: 1080 }),
        fakeImg({ src: 'https://scontent.cdninstagram.com/v/t51/b.jpg?t=1', naturalWidth: 1080 }),
        fakeImg({ src: 'https://scontent.cdninstagram.com/v/t51/c.jpg?t=1', naturalWidth: 1080 })
    ];
    const out = extractContentImageUrls(imgs);
    assert.equal(out.length, 3);
    assert.ok(out[0].includes('a.jpg'));
    assert.ok(out[1].includes('b.jpg'));
    assert.ok(out[2].includes('c.jpg'));
});

test('extractContentImageUrls handles empty + null input', () => {
    assert.deepEqual(extractContentImageUrls([]),     []);
    assert.deepEqual(extractContentImageUrls(null),   []);
    assert.deepEqual(extractContentImageUrls(undefined), []);
});

// ------------------------------------------------------------------
// GraphQL response → carousel media
// ------------------------------------------------------------------

test('extractMediaFromGraphQL handles current shape (xdt_api...web_info.items[0])', () => {
    const parsed = {
        data: {
            xdt_api__v1__media__shortcode__web_info: {
                items: [{
                    code: 'DXc7J6XD7ik',
                    image_versions2: {
                        candidates: [
                            { url: 'https://cdn/big.jpg',  width: 1080, height: 1350 },
                            { url: 'https://cdn/med.jpg',  width: 750,  height: 938 }
                        ]
                    }
                }]
            }
        }
    };
    const out = extractMediaFromGraphQL(parsed);
    assert.equal(out.shortcode, 'DXc7J6XD7ik');
    assert.equal(out.media.length, 1);
    assert.equal(out.media[0].url, 'https://cdn/big.jpg');
    assert.equal(out.media[0].width, 1080);
});

test('extractMediaFromGraphQL extracts ALL carousel slides at highest res', () => {
    const slide = (id, w) => ({
        id,
        image_versions2: {
            candidates: [
                { url: `https://cdn/${id}-low.jpg`, width: 320, height: 320 },
                { url: `https://cdn/${id}-hi.jpg`,  width: w,   height: w   }
            ]
        }
    });
    const parsed = {
        data: {
            xdt_api__v1__media__shortcode__web_info: {
                items: [{
                    code: 'XYZ',
                    carousel_media: [slide('s1', 1080), slide('s2', 1080), slide('s3', 1080), slide('s4', 1080)]
                }]
            }
        }
    };
    const out = extractMediaFromGraphQL(parsed);
    assert.equal(out.media.length, 4);
    // Each slide must give us the high-res variant, not the low-res.
    for (let i = 0; i < 4; i++) {
        assert.ok(out.media[i].url.endsWith('-hi.jpg'), `slide ${i+1} should be high-res`);
        assert.equal(out.media[i].width, 1080);
    }
});

test('extractMediaFromGraphQL prefers video_versions over image_versions2 for video slides', () => {
    const parsed = {
        data: {
            xdt_api__v1__media__shortcode__web_info: {
                items: [{
                    code: 'V',
                    image_versions2: { candidates: [{ url: 'https://cdn/cover.jpg', width: 720, height: 720 }] },
                    video_versions:  [{ url: 'https://cdn/v.mp4',     width: 720, height: 720 }]
                }]
            }
        }
    };
    const out = extractMediaFromGraphQL(parsed);
    assert.equal(out.media.length, 1);
    assert.equal(out.media[0].type, 'video');
    assert.equal(out.media[0].url,  'https://cdn/v.mp4');
});

test('extractMediaFromGraphQL handles legacy shortcode_media + edge_sidecar shape', () => {
    // Older GraphQL endpoints used edge_sidecar_to_children for
    // carousels; display_resources for image-resolution variants.
    const parsed = {
        data: {
            shortcode_media: {
                shortcode: 'OLD',
                edge_sidecar_to_children: {
                    edges: [
                        { node: { display_resources: [
                            { src: 'https://cdn/old1-sm.jpg', config_width: 320,  config_height: 320 },
                            { src: 'https://cdn/old1-lg.jpg', config_width: 1080, config_height: 1080 }
                        ] } },
                        { node: { display_resources: [
                            { src: 'https://cdn/old2-sm.jpg', config_width: 320,  config_height: 320 },
                            { src: 'https://cdn/old2-lg.jpg', config_width: 1080, config_height: 1080 }
                        ] } }
                    ]
                }
            }
        }
    };
    const out = extractMediaFromGraphQL(parsed);
    assert.equal(out.shortcode, 'OLD');
    assert.equal(out.media.length, 2);
    assert.ok(out.media[0].url.endsWith('old1-lg.jpg'));
    assert.ok(out.media[1].url.endsWith('old2-lg.jpg'));
});

test('extractMediaFromGraphQL handles REST /api/v1/media/ shape', () => {
    const parsed = {
        items: [{
            code: 'REST',
            image_versions2: {
                candidates: [{ url: 'https://cdn/rest.jpg', width: 1080, height: 1350 }]
            }
        }]
    };
    const out = extractMediaFromGraphQL(parsed);
    assert.equal(out.shortcode, 'REST');
    assert.equal(out.media[0].url, 'https://cdn/rest.jpg');
});

// ------------------------------------------------------------------
// User profile extractor
// ------------------------------------------------------------------

test('extractUserFromGraphQL finds user object at the canonical path', () => {
    const parsed = {
        data: {
            user: {
                pk: '507869549',
                username: 'reasonmagazine',
                full_name: 'Reason Magazine',
                is_verified: true,
                profile_pic_url: 'https://cdn/avatar.jpg',
                follower_count: 12345
            }
        }
    };
    const user = extractUserFromGraphQL(parsed, 'reasonmagazine');
    assert.ok(user);
    assert.equal(user.pk, '507869549');
    assert.equal(user.full_name, 'Reason Magazine');
});

test('extractUserFromGraphQL recursively walks for user objects', () => {
    // User data nested under multiple wrapping layers (xdt_*, etc.).
    const parsed = {
        data: {
            xdt_some_query: {
                user_info: {
                    user: {
                        pk: '1',
                        username: 'target',
                        full_name: 'Target Account'
                    }
                }
            }
        }
    };
    const user = extractUserFromGraphQL(parsed, 'target');
    assert.ok(user);
    assert.equal(user.full_name, 'Target Account');
});

test('extractUserFromGraphQL filters by username when multiple users present', () => {
    // The buffer often has multiple user responses (the logged-in
    // user, the profile being viewed, etc.). Must return the right one.
    const parsed = {
        data: {
            users: [
                { pk: '1', username: 'jeffbarrett44', full_name: 'Jeff Barrett' },
                { pk: '2', username: 'reasonmagazine', full_name: 'Reason Magazine' }
            ]
        }
    };
    const user = extractUserFromGraphQL(parsed, 'reasonmagazine');
    assert.ok(user);
    assert.equal(user.full_name, 'Reason Magazine');
});

test('extractUserFromGraphQL returns null when no matching user present', () => {
    const parsed = {
        data: {
            user: { pk: '1', username: 'someone_else', full_name: 'Other' }
        }
    };
    assert.equal(extractUserFromGraphQL(parsed, 'reasonmagazine'), null);
});

test('extractUserFromGraphQL accepts any user when requireUsername is null/falsy', () => {
    const parsed = { data: { user: { username: 'anyone', pk: '1' } } };
    const user = extractUserFromGraphQL(parsed, null);
    assert.ok(user);
    assert.equal(user.username, 'anyone');
});

test('extractUserFromGraphQL ignores non-user objects with id+username-like shape', () => {
    // Defensive: don't match on every object that happens to have
    // a username-shaped string. Must require the `username` key
    // explicitly.
    const parsed = { data: { other: { id: 'x', login: 'fakeuser', not_username: 'y' } } };
    assert.equal(extractUserFromGraphQL(parsed, 'fakeuser'), null);
});

test('extractMediaFromGraphQL recursively finds post item in deeply-nested SSR envelope', () => {
    // Instagram's `data-sjs` SSR blocks wrap the actual response
    // in a deep envelope: ScheduledServerJS → handle → __bbox →
    // complete → result → data → xdt_api... etc. Recursive walk
    // should find the post regardless of how it's wrapped.
    const post = {
        code: 'WRAPPED',
        image_versions2: { candidates: [{ url: 'https://cdn/wrapped.jpg', width: 1080, height: 1080 }] }
    };
    const wrapped = {
        require: [['ScheduledServerJS', 'handle', null, [{
            __bbox: {
                complete: true,
                result: {
                    data: {
                        xdt_api__v1__media__shortcode__web_info: {
                            items: [post]
                        }
                    }
                }
            }
        }]]]
    };
    const out = extractMediaFromGraphQL(wrapped);
    assert.ok(out, 'recursive walk must find the post item');
    assert.equal(out.shortcode, 'WRAPPED');
    assert.equal(out.media.length, 1);
});

test('extractMediaFromGraphQL recursive walk handles arbitrarily-keyed wrappers', () => {
    // Even if the wrapper key isn't one we explicitly know about,
    // the walk should find the post item by its shape.
    const post = {
        code: 'NEWFORM',
        carousel_media: [
            { image_versions2: { candidates: [{ url: 'https://cdn/a.jpg', width: 720, height: 720 }] } },
            { image_versions2: { candidates: [{ url: 'https://cdn/b.jpg', width: 720, height: 720 }] } }
        ]
    };
    const wrapped = { some_new_top_level_key: { totally_different_nesting: { item: post } } };
    const out = extractMediaFromGraphQL(wrapped);
    assert.ok(out);
    assert.equal(out.shortcode, 'NEWFORM');
    assert.equal(out.media.length, 2);
});

test('extractMediaFromGraphQL exposes item.user for handle fallback', () => {
    // Regression: real-world Instagram `/api/v1/media/<id>/info/`
    // response carries the author inline on the post item. When the
    // URL is `/p/<shortcode>/` (no username prefix) and og:description
    // isn't in the parseable shape, this is the only place the handle
    // survives.
    const parsed = {
        items: [{
            code: 'DXc7J6XD7ik',
            image_versions2: { candidates: [{ url: 'https://cdn/x.jpg', width: 1080, height: 1350 }] },
            user: {
                pk: '507869549',
                username: 'reasonmagazine',
                full_name: 'Reason Magazine',
                is_verified: true,
                profile_pic_url: 'https://cdn/avatar.jpg',
                follower_count: 400000
            }
        }]
    };
    const out = extractMediaFromGraphQL(parsed);
    assert.ok(out.user, 'user must be surfaced on the result');
    assert.equal(out.user.username, 'reasonmagazine');
    assert.equal(out.user.is_verified, true);
});

test('extractMediaFromGraphQL exposes legacy shortcode_media.owner as user', () => {
    // Legacy GraphQL responses use `owner` instead of `user` on the
    // shortcode_media node. Same purpose, different key — we accept
    // either so the caller doesn't need a branch.
    const parsed = {
        data: {
            shortcode_media: {
                shortcode: 'OLD',
                display_resources: [{ src: 'https://cdn/old.jpg', config_width: 1080, config_height: 1080 }],
                owner: {
                    id: '1', username: 'legacyuser', full_name: 'Legacy User', is_verified: false
                }
            }
        }
    };
    const out = extractMediaFromGraphQL(parsed);
    assert.ok(out.user, 'owner must surface as user');
    assert.equal(out.user.username, 'legacyuser');
});

test('extractMediaFromGraphQL returns null for unrecognized shapes', () => {
    assert.equal(extractMediaFromGraphQL(null), null);
    assert.equal(extractMediaFromGraphQL({}), null);
    assert.equal(extractMediaFromGraphQL({ data: {} }), null);
    assert.equal(extractMediaFromGraphQL({ data: { something_else: { items: [] } } }), null);
    assert.equal(extractMediaFromGraphQL({ items: [{}] }), null);
});

test('extractMetaFields parses K/M suffix engagement counts', () => {
    const doc = fakeMetaDoc([
        { name: 'twitter:label1', content: 'Likes' },
        { name: 'twitter:data1',  content: '1.2M' },
        { name: 'twitter:label2', content: 'Comments' },
        { name: 'twitter:data2',  content: '3.4K' }
    ]);
    const meta = extractMetaFields(doc);
    assert.equal(meta.engagement.likes,    1_200_000);
    assert.equal(meta.engagement.comments,     3_400);
});
