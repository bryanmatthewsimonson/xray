// Podcast identity discovery tests — the Phase-22 "Find identity"
// assist. Pure module + the SW-side lookup pipeline with stubbed
// fetch: link scan, the Podcasting 2.0 UUIDv5 vector, hand-rolled
// feed reading, episode matching, and the privacy contract (Apple is
// contacted only when the capture carries no answer of its own).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    scanPodcastSignals, looksLikeFeedUrl, isPublicFeedUrl,
    itunesLookupUrl, itunesSearchUrl, mapItunesResults,
    readFeedXml, parseItunesDuration,
    PODCAST_GUID_NAMESPACE, normalizeFeedUrlForGuid, computePodcastGuid,
    titleSimilarity, matchEpisode,
    lookupPodcastIdentity, describePodcastLookup
} from '../src/shared/podcast-identity.js';

// Tripwire by default: any test that reaches the network without
// explicitly installing a mock is a failure.
globalThis.fetch = () => { throw new Error('TRIPWIRE: network reached — a gate failed'); };

// ------------------------------------------------------------------
// Signal scan
// ------------------------------------------------------------------

test('scanPodcastSignals: Apple podcast links yield the iTunes id', () => {
    const article = {
        links: [
            { url: 'https://example.com/about', text: 'About' },
            { url: 'https://podcasts.apple.com/us/podcast/mormon-stories-podcast/id315106175', text: 'Apple' }
        ]
    };
    assert.equal(scanPodcastSignals(article).itunesId, '315106175');

    // Country and slug are optional; the legacy host counts too.
    assert.equal(scanPodcastSignals({
        links: [{ url: 'https://podcasts.apple.com/podcast/id999' }]
    }).itunesId, '999');
    assert.equal(scanPodcastSignals({
        links: [{ url: 'https://itunes.apple.com/gb/podcast/some-show/id42?i=1000' }]
    }).itunesId, '42');
});

test('scanPodcastSignals: feed-shaped links collected, junk excluded', () => {
    const signals = scanPodcastSignals({
        links: [
            { url: 'https://feeds.megaphone.fm/mormonstories' },       // feeds. host
            { url: 'https://example.com/podcast.rss' },                 // .rss
            { url: 'https://anchor.fm/s/abc123/podcast/rss' },          // trailing /rss
            { url: 'https://blog.example.com/feed/' },                  // trailing /feed/
            { url: 'https://example.com/sitemap.xml' },                 // NOT a feed
            { url: 'https://example.com/article' },                     // plain page
            { url: 'https://feeds.megaphone.fm/mormonstories' }         // dupe
        ]
    });
    assert.deepEqual(signals.feedUrls, [
        'https://feeds.megaphone.fm/mormonstories',
        'https://example.com/podcast.rss',
        'https://anchor.fm/s/abc123/podcast/rss',
        'https://blog.example.com/feed/'
    ]);
});

test('looksLikeFeedUrl: only http(s), rejects non-URLs', () => {
    assert.equal(looksLikeFeedUrl('ftp://feeds.example.com/rss'), false);
    assert.equal(looksLikeFeedUrl('not a url'), false);
    assert.equal(looksLikeFeedUrl(null), false);
    assert.equal(looksLikeFeedUrl('https://example.com/rss-feed.xml'), true);
});

test('scanPodcastSignals: search terms — byline first, platforms excluded', () => {
    const signals = scanPodcastSignals({
        byline: 'Mormon Stories Podcast',
        siteName: 'YouTube',
        title: 'Dr. John Dehlin on Faith Crisis | Ep. 2117'
    });
    assert.deepEqual(signals.searchTerms, ['Mormon Stories Podcast']);

    // A title segment that self-identifies as a show becomes a term.
    const fromTitle = scanPodcastSignals({
        byline: '',
        siteName: 'Spotify',
        title: 'Why We Sleep — The Daily Podcast'
    });
    assert.deepEqual(fromTitle.searchTerms, ['The Daily Podcast']);
});

test('scanPodcastSignals: episode hints — numbering, clean title, capture meta', () => {
    const signals = scanPodcastSignals({
        title: 'Dr. John Dehlin on Faith Crisis | Ep. 2117',
        publishedAt: 1753900000,
        youtube: { durationSeconds: 5400 }
    });
    assert.equal(signals.episode.episodeNumber, 2117);
    assert.equal(signals.episode.cleanTitle, 'Dr. John Dehlin on Faith Crisis');
    assert.equal(signals.episode.publishedAt, 1753900000);
    assert.equal(signals.episode.durationSeconds, 5400);

    // "#2117" numbering (no "Ep" prefix) is recognized too.
    assert.equal(scanPodcastSignals({ title: 'Faith Crisis #2117' }).episode.episodeNumber, 2117);
    // Leading-position numbering with a separator.
    assert.equal(scanPodcastSignals({ title: 'Episode 12: The Start' }).episode.episodeNumber, 12);
    assert.equal(scanPodcastSignals({ title: 'Episode 12: The Start' }).episode.cleanTitle, 'The Start');
});

test('scanPodcastSignals: strong gate — link signals or a self-declared podcast', () => {
    assert.equal(scanPodcastSignals({
        links: [{ url: 'https://podcasts.apple.com/us/podcast/x/id1' }]
    }).strong, true);
    assert.equal(scanPodcastSignals({
        links: [{ url: 'https://feeds.example.com/show' }]
    }).strong, true);
    assert.equal(scanPodcastSignals({ byline: 'Mormon Stories Podcast' }).strong, true);
    assert.equal(scanPodcastSignals({
        byline: 'Some Channel', title: 'A video about birds'
    }).strong, false);
});

test('scanPodcastSignals: junk input never throws', () => {
    for (const junk of [null, undefined, {}, { links: 'nope' }, { links: [null, {}, { url: 42 }] }]) {
        const s = scanPodcastSignals(junk);
        assert.equal(s.itunesId, null);
        assert.deepEqual(s.feedUrls, []);
        assert.equal(s.strong, false);
    }
});

// ------------------------------------------------------------------
// iTunes request builders + mapper
// ------------------------------------------------------------------

test('itunesLookupUrl: digits only, never a URL from arbitrary input', () => {
    assert.equal(itunesLookupUrl('315106175'),
        'https://itunes.apple.com/lookup?id=315106175&entity=podcast');
    for (const junk of [null, undefined, '', 'abc', '12abc', '12 34', '1'.repeat(13), {}]) {
        assert.equal(itunesLookupUrl(junk), null, `rejects ${JSON.stringify(junk)}`);
    }
});

test('itunesSearchUrl: term is percent-encoded; empty/oversize rejected', () => {
    const url = itunesSearchUrl('Mormon Stories Podcast');
    assert.equal(url,
        'https://itunes.apple.com/search?media=podcast&entity=podcast&limit=5&term=Mormon%20Stories%20Podcast');
    assert.equal(itunesSearchUrl('  '), null);
    assert.equal(itunesSearchUrl('x'.repeat(201)), null);
});

test('mapItunesResults: keeps feed-bearing results, string-coerces ids', () => {
    const mapped = mapItunesResults({
        resultCount: 3,
        results: [
            { collectionName: 'Mormon Stories', collectionId: 315106175, feedUrl: 'https://feeds.example.com/ms' },
            { collectionName: 'No Feed Show', collectionId: 1 },
            'junk'
        ]
    });
    assert.deepEqual(mapped, [{
        collectionName: 'Mormon Stories',
        collectionId: '315106175',
        feedUrl: 'https://feeds.example.com/ms'
    }]);
    assert.deepEqual(mapItunesResults(null), []);
    assert.deepEqual(mapItunesResults({ results: 'nope' }), []);
});

// ------------------------------------------------------------------
// Feed reading
// ------------------------------------------------------------------

const FEED_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
     xmlns:podcast="https://podcastindex.org/namespace/1.0">
<channel>
  <title><![CDATA[Mormon Stories Podcast]]></title>
  <podcast:guid>9b024349-ccf0-5f69-a609-6b82873eab3c</podcast:guid>
  <!-- a comment with a fake <item> inside must not confuse the reader -->
  <item>
    <title>Ep. 2117: Dr. John Dehlin &amp; Faith Crisis</title>
    <guid isPermaLink="false">Buzz-EP2117-CaseSENSITIVE</guid>
    <pubDate>Wed, 30 Jul 2026 12:00:00 GMT</pubDate>
    <itunes:duration>1:30:15</itunes:duration>
  </item>
  <item>
    <title><![CDATA[Ep. 2116: Another Guest]]></title>
    <guid>https://example.com/ep2116</guid>
    <pubDate>Wed, 23 Jul 2026 12:00:00 GMT</pubDate>
    <itunes:duration>3600</itunes:duration>
  </item>
</channel>
</rss>`;

test('readFeedXml: channel title, podcast:guid, item fields', () => {
    const feed = readFeedXml(FEED_XML);
    assert.equal(feed.title, 'Mormon Stories Podcast');
    assert.equal(feed.podcastGuid, '9b024349-ccf0-5f69-a609-6b82873eab3c');
    assert.equal(feed.items.length, 2);

    const [ep1, ep2] = feed.items;
    assert.equal(ep1.title, 'Ep. 2117: Dr. John Dehlin & Faith Crisis');   // entity decoded
    assert.equal(ep1.guid, 'Buzz-EP2117-CaseSENSITIVE');                    // case preserved
    assert.equal(ep1.pubDate, Math.floor(Date.parse('Wed, 30 Jul 2026 12:00:00 GMT') / 1000));
    assert.equal(ep1.durationSeconds, 5415);                                // 1:30:15
    assert.equal(ep2.durationSeconds, 3600);                                // bare seconds
    assert.equal(ep2.title, 'Ep. 2116: Another Guest');                     // CDATA unwrapped
});

test('readFeedXml: alternate prefix accepted only for UUID-shaped guid values', () => {
    const alt = readFeedXml(
        '<rss><channel><title>T</title><pi:guid>9B024349-CCF0-5F69-A609-6B82873EAB3C</pi:guid></channel></rss>');
    assert.equal(alt.podcastGuid, '9b024349-ccf0-5f69-a609-6b82873eab3c');  // lowercased

    const notUuid = readFeedXml(
        '<rss><channel><title>T</title><pi:guid>not-a-uuid</pi:guid></channel></rss>');
    assert.equal(notUuid.podcastGuid, null);
});

test('readFeedXml: junk and non-feed input never throws', () => {
    for (const junk of [null, undefined, '', 42, '<html><head><title>A Page</title></head></html>']) {
        const feed = readFeedXml(junk);
        assert.deepEqual(feed.items, []);
        assert.equal(feed.podcastGuid, null);
    }
});

test('parseItunesDuration: the three shapes, junk -> null', () => {
    assert.equal(parseItunesDuration('3723'), 3723);
    assert.equal(parseItunesDuration('1:02:03'), 3723);
    assert.equal(parseItunesDuration('62:03'), 3723);
    for (const junk of [null, '', 'abc', '1:2:3:4']) assert.equal(parseItunesDuration(junk), null);
});

// ------------------------------------------------------------------
// Podcast GUID (UUIDv5)
// ------------------------------------------------------------------

test('computePodcastGuid: the Podcasting 2.0 documented vector', async () => {
    assert.equal(PODCAST_GUID_NAMESPACE, 'ead4c236-bf58-58c6-a2c6-a6b28d128cb6');
    // podcast-namespace guid.md: podnews.net/rss →
    // 9b024349-ccf0-5f69-a609-6b82873eab3c (scheme + trailing slashes
    // stripped before hashing).
    const expected = '9b024349-ccf0-5f69-a609-6b82873eab3c';
    assert.equal(await computePodcastGuid('https://podnews.net/rss'), expected);
    assert.equal(await computePodcastGuid('http://podnews.net/rss/'), expected);
    assert.equal(await computePodcastGuid('podnews.net/rss'), expected);
    assert.equal(await computePodcastGuid(''), null);
});

test('normalizeFeedUrlForGuid: scheme and trailing slashes only', () => {
    assert.equal(normalizeFeedUrlForGuid('https://podnews.net/rss//'), 'podnews.net/rss');
    assert.equal(normalizeFeedUrlForGuid('podnews.net/rss'), 'podnews.net/rss');
    // Path case is significant — the spec strips nothing else.
    assert.equal(normalizeFeedUrlForGuid('https://Podnews.net/RSS'), 'Podnews.net/RSS');
});

// ------------------------------------------------------------------
// Episode matching
// ------------------------------------------------------------------

const ITEMS = [
    { guid: 'g-2117', title: 'Ep. 2117: Dr. John Dehlin & Faith Crisis',
      pubDate: 1753876800, durationSeconds: 5415 },
    { guid: 'g-2116', title: 'Ep. 2116: Another Guest',
      pubDate: 1753272000, durationSeconds: 3600 },
    { guid: 'g-2115', title: 'Ep. 2115: Yet Another Topic',
      pubDate: 1752667200, durationSeconds: 4000 }
];

test('matchEpisode: episode number + duration proximity -> strong', () => {
    const hit = matchEpisode(ITEMS, {
        title: 'Dr. John Dehlin on Faith Crisis | Ep. 2117',
        cleanTitle: 'Dr. John Dehlin on Faith Crisis',
        episodeNumber: 2117,
        publishedAt: 1753900000,          // ~6.4 h after the feed pubDate
        durationSeconds: 5400             // 15 s off
    });
    assert.ok(hit);
    assert.equal(hit.item.guid, 'g-2117');
    assert.equal(hit.confidence, 'strong');
    assert.ok(hit.reasons.some((r) => r.includes('2117')));
});

test('matchEpisode: fuzzy title alone -> moderate; date breaks ties', () => {
    const hit = matchEpisode(ITEMS, {
        title: 'Another Guest',
        cleanTitle: 'Another Guest',
        episodeNumber: null,
        publishedAt: null,
        durationSeconds: null
    });
    assert.ok(hit);
    assert.equal(hit.item.guid, 'g-2116');
    assert.equal(hit.confidence, 'moderate');

    // Same weak title everywhere: pubDate proximity decides.
    const twins = [
        { guid: 'a', title: 'Weekly Update', pubDate: 1753876800, durationSeconds: null },
        { guid: 'b', title: 'Weekly Update', pubDate: 1700000000, durationSeconds: null }
    ];
    const dated = matchEpisode(twins, {
        title: 'Weekly Update', cleanTitle: 'Weekly Update',
        episodeNumber: null, publishedAt: 1753900000, durationSeconds: null
    });
    assert.equal(dated.item.guid, 'a');
});

test('matchEpisode: nothing clears the floor -> null (no wrong prefill)', () => {
    assert.equal(matchEpisode(ITEMS, {
        title: 'Completely Unrelated Lecture',
        cleanTitle: 'Completely Unrelated Lecture',
        episodeNumber: null, publishedAt: null, durationSeconds: null
    }), null);
    assert.equal(matchEpisode([], { title: 'x' }), null);
    assert.equal(matchEpisode(null, null), null);
});

test('titleSimilarity: Jaccard, not containment — short generic titles cannot score 1.0', () => {
    // The adversarial-review bug: min-denominator containment made a
    // sparse recurring item title ('Faith Crisis', 'Trailer') a perfect
    // match against any capture title containing it.
    const contained = titleSimilarity('Faith Crisis', 'Ep. 2117: Dr. John Dehlin Faith Crisis');
    assert.ok(contained < 0.6, `contained short title must stay below moderate, got ${contained}`);
    assert.equal(titleSimilarity('', 'anything'), 0);
    assert.ok(titleSimilarity('Faith Crisis Explained', 'Faith Crisis Explained') >= 0.99, 'identical titles ≈ 1');
    assert.ok(titleSimilarity('Wade Christofferson Abuse Coverup', 'Wade Christofferson abuse coverup — full story')
        > titleSimilarity('Trailer', 'Wade Christofferson Abuse Coverup Trailer'),
    'substantial overlap beats one generic shared token');
});

test('isPublicFeedUrl: the SSRF pin', () => {
    assert.ok(isPublicFeedUrl('https://feeds.example.com/rss'));
    assert.ok(isPublicFeedUrl('https://mormonstories.org/feed'));
    for (const bad of [
        'http://feeds.example.com/rss',            // https only
        'https://localhost/feed',
        'https://sub.localhost/feed',
        'https://127.0.0.1:8756/feed',
        'https://10.0.0.5/feed',
        'https://172.16.0.1/feed',
        'https://192.168.1.10/feed',
        'https://169.254.1.1/feed',
        'https://100.64.0.1/feed',                 // CGNAT
        'https://0.0.0.0/feed',
        'https://224.0.0.1/feed',
        'https://nas.local/feed',
        'https://fileserver/feed',                 // single-label intranet
        'https://[::1]/feed',
        'https://user:pw@feeds.example.com/rss',   // userinfo smuggling
        'not a url'
    ]) {
        assert.equal(isPublicFeedUrl(bad), false, `must reject: ${bad}`);
    }
});

// ------------------------------------------------------------------
// The lookup pipeline (stubbed fetch)
// ------------------------------------------------------------------

function stubFetch(routes) {
    const calls = [];
    const fetchFn = async (url) => {
        calls.push(url);
        for (const [pattern, body] of routes) {
            if (url.includes(pattern)) {
                return {
                    ok: true, status: 200,
                    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
                    json: async () => (typeof body === 'string' ? JSON.parse(body) : body)
                };
            }
        }
        return { ok: false, status: 404, text: async () => '', json: async () => ({}) };
    };
    return { calls, fetchFn };
}

const LOOKUP_RESPONSE = {
    resultCount: 1,
    results: [{ collectionName: 'Mormon Stories', collectionId: 315106175,
        feedUrl: 'https://feeds.example.com/ms' }]
};

const CAPTURE_SIGNALS = {
    itunesId: '315106175',
    feedUrls: [],
    searchTerms: ['Mormon Stories Podcast'],
    episode: {
        title: 'Dr. John Dehlin on Faith Crisis | Ep. 2117',
        cleanTitle: 'Dr. John Dehlin on Faith Crisis',
        episodeNumber: 2117,
        publishedAt: 1753900000,
        durationSeconds: 5400
    }
};

test('lookupPodcastIdentity: Apple-id path — lookup, feed, full candidate', async () => {
    const { calls, fetchFn } = stubFetch([
        ['itunes.apple.com/lookup', LOOKUP_RESPONSE],
        ['feeds.example.com/ms', FEED_XML]
    ]);
    const result = await lookupPodcastIdentity(CAPTURE_SIGNALS, { fetchFn });

    assert.deepEqual(result.candidate, {
        show: 'Mormon Stories Podcast',                       // the feed's own title wins
        feed_guid: '9b024349-ccf0-5f69-a609-6b82873eab3c',
        episode_guid: 'Buzz-EP2117-CaseSENSITIVE',            // verbatim, case preserved
        feed_url: 'https://feeds.example.com/ms',
        itunes_id: '315106175'
    });
    assert.equal(result.match.confidence, 'strong');
    assert.equal(calls.length, 2);
    // The id lookup never sends the show name; no search call happened.
    assert.ok(!calls.some((u) => u.includes('itunes.apple.com/search')));
});

test('lookupPodcastIdentity: direct feed link — Apple never contacted', async () => {
    const { calls, fetchFn } = stubFetch([['feeds.example.com/ms', FEED_XML]]);
    const result = await lookupPodcastIdentity({
        ...CAPTURE_SIGNALS, itunesId: null, feedUrls: ['https://feeds.example.com/ms']
    }, { fetchFn });

    assert.equal(result.candidate.show, 'Mormon Stories Podcast');
    assert.equal(result.candidate.itunes_id, undefined, 'no id claimed without an Apple source');
    assert.ok(calls.every((u) => !u.includes('apple.com')), 'privacy: Apple untouched');
});

test('lookupPodcastIdentity: search fallback discloses the show name in notes', async () => {
    const { calls, fetchFn } = stubFetch([
        ['itunes.apple.com/search', LOOKUP_RESPONSE],
        ['feeds.example.com/ms', FEED_XML]
    ]);
    const result = await lookupPodcastIdentity({
        ...CAPTURE_SIGNALS, itunesId: null, feedUrls: []
    }, { fetchFn });

    assert.equal(result.candidate.itunes_id, '315106175');
    assert.ok(calls.some((u) => u.includes('itunes.apple.com/search')));
    assert.ok(result.notes.some((n) => n.includes('sent to Apple')), 'disclosure note present');
});

test('lookupPodcastIdentity: declared GUID wins over computed on mismatch', async () => {
    // The feed declares podnews's GUID but lives at a different URL, so
    // the computed UUIDv5 differs — declared wins, with a note.
    const { fetchFn } = stubFetch([['feeds.example.com/ms', FEED_XML]]);
    const result = await lookupPodcastIdentity({
        itunesId: null, feedUrls: ['https://feeds.example.com/ms'], searchTerms: [], episode: {}
    }, { fetchFn });

    assert.equal(result.candidate.feed_guid, '9b024349-ccf0-5f69-a609-6b82873eab3c');
    assert.ok(result.notes.some((n) => n.includes('declared feed GUID differs')));
});

test('lookupPodcastIdentity: no <podcast:guid> -> computed UUIDv5 fallback', async () => {
    const noGuidFeed = FEED_XML.replace(/<podcast:guid>[^<]*<\/podcast:guid>/, '');
    const { fetchFn } = stubFetch([['podnews.net/rss', noGuidFeed]]);
    const result = await lookupPodcastIdentity({
        itunesId: null, feedUrls: ['https://podnews.net/rss'], searchTerms: [], episode: {}
    }, { fetchFn });

    assert.equal(result.candidate.feed_guid, '9b024349-ccf0-5f69-a609-6b82873eab3c');
    assert.ok(result.notes.some((n) => n.includes('computed as UUIDv5')));
});

test('lookupPodcastIdentity: HTML masquerading as a feed fails HONESTLY — and never escalates to Apple search', async () => {
    // The adversarial-review majors, pinned together: (a) a
    // link-bearing capture whose feed fails must NOT fall through to
    // the show-name search the modal hint promised would not happen;
    // (b) the failure carries the notes (real cause disclosed).
    const { calls, fetchFn } = stubFetch([
        ['blog.example.com/feed', '<html><head><title>My Blog</title></head><body></body></html>']
    ]);
    let thrown = null;
    try {
        await lookupPodcastIdentity({
            itunesId: null, feedUrls: ['https://blog.example.com/feed'],
            searchTerms: ['Mormon Stories Podcast'], episode: {}
        }, { fetchFn });
    } catch (err) { thrown = err; }
    assert.ok(thrown, 'must reject');
    assert.match(thrown.message, /nothing was sent to Apple/i);
    assert.ok(calls.every((u) => !u.includes('itunes.apple.com/search')),
        'the show name must NOT reach the iTunes Search API when the capture carried links');
    assert.ok(Array.isArray(thrown.notes) && thrown.notes.some((n) => n.includes('not an RSS feed')),
        'failure carries the diagnostic notes');
});

test('lookupPodcastIdentity: capture-supplied non-public feed URLs are never fetched', async () => {
    const { calls, fetchFn } = stubFetch([]);
    let thrown = null;
    try {
        await lookupPodcastIdentity({
            itunesId: null,
            feedUrls: ['https://127.0.0.1:8756/feed', 'http://localhost:1234/feed', 'https://nas.local/rss'],
            searchTerms: [], episode: {}
        }, { fetchFn });
    } catch (err) { thrown = err; }
    assert.ok(thrown, 'must reject');
    assert.equal(calls.length, 0, 'the SW fetch must never touch loopback/private hosts');
    assert.ok(thrown.notes.some((n) => n.includes('skipped')), 'the skip is disclosed');
});

test('lookupPodcastIdentity: moderate episode matches are noted but NOT prefilled', async () => {
    // Same title everywhere, no episode number, close-but-not-exact
    // date → moderate at best; the GUID field must stay empty.
    const feed = `<?xml version="1.0"?><rss><channel><title>Show</title>
        <item><guid>ep-guid-1</guid><title>Completely Different Topic Entirely</title>
        <pubDate>Tue, 24 Feb 2026 12:00:00 GMT</pubDate></item></channel></rss>`;
    const { fetchFn } = stubFetch([['feeds.example.com/rss', feed]]);
    const result = await lookupPodcastIdentity({
        itunesId: null, feedUrls: ['https://feeds.example.com/rss'], searchTerms: [],
        episode: { title: 'Unrelated Capture Name', cleanTitle: 'Unrelated Capture Name',
                   episodeNumber: null, publishedAt: Date.parse('2026-02-25') / 1000, durationSeconds: null }
    }, { fetchFn });
    assert.equal(result.candidate.episode_guid, undefined, 'weak/moderate match must not prefill the GUID');
    if (result.match) {
        assert.notEqual(result.match.confidence, 'strong');
        assert.ok(result.notes.some((n) => n.includes('not prefilled')), 'the near-miss is disclosed for a manual pick');
    }
});

test('readFeedXml: hostile entities and CDATA cannot break the reader', () => {
    // Out-of-range refs must not throw (the never-throws contract) and
    // '&#38;lt;' is the literal text '&lt;', not '<' (single-pass decode).
    const feed = `<rss><channel><title>A &#x110000; B &#38;lt; C</title>
        <item><guid>g1</guid><title><![CDATA[Notes with an unpaired <!-- marker]]></title></item>
        <item><guid>g2</guid><title>Second Item Survives</title></item>
        </channel></rss>`;
    const parsed = readFeedXml(feed);
    assert.equal(parsed.title, 'A � B &lt; C');
    assert.equal(parsed.items.length, 2, 'an unpaired comment-open inside CDATA must not swallow later items');
    assert.equal(parsed.items[0].title, 'Notes with an unpaired <!-- marker');
    assert.equal(parsed.items[1].title, 'Second Item Survives');
});

test('lookupPodcastIdentity: no usable signals -> rejects with the house message', async () => {
    const { calls, fetchFn } = stubFetch([]);
    await assert.rejects(
        () => lookupPodcastIdentity({ itunesId: null, feedUrls: [], searchTerms: [], episode: {} }, { fetchFn }),
        /no podcast feed found/
    );
    assert.equal(calls.length, 0, 'nothing fetched without signals');
});

test('lookupPodcastIdentity: no confident episode match -> episode_guid absent, note says so', async () => {
    const { fetchFn } = stubFetch([['feeds.example.com/ms', FEED_XML]]);
    const result = await lookupPodcastIdentity({
        itunesId: null, feedUrls: ['https://feeds.example.com/ms'], searchTerms: [],
        episode: { title: 'Completely Unrelated', cleanTitle: 'Completely Unrelated' }
    }, { fetchFn });

    assert.equal(result.candidate.episode_guid, undefined);
    assert.ok(result.notes.some((n) => n.includes('no confident episode match')));
});

test('describePodcastLookup: show + confidence + reasons in one line', () => {
    const line = describePodcastLookup({
        candidate: { show: 'Mormon Stories Podcast' },
        match: { title: 'Ep. 2117: Dr. John Dehlin', confidence: 'strong',
            reasons: ['episode number 2117 matches'] }
    });
    assert.ok(line.includes('Mormon Stories Podcast'));
    assert.ok(line.includes('strong'));
    assert.ok(line.includes('2117'));
    assert.equal(describePodcastLookup(null), '');
});
