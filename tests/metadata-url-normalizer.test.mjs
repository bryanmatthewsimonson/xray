// URL normalizer tests — Phase 9a Day 1.
//
// Spec: XRAY_METADATA_SPEC.md §6.2 + Phase 9a Implementation Plan §5.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { normalize, urlHash } = await import('../src/shared/metadata/url-normalizer.js');

// ------------------------------------------------------------------
// Rule 1 — lowercase scheme + host
// ------------------------------------------------------------------

test('lowercases scheme', () => {
  assert.equal(normalize('HTTPS://example.com/'), 'https://example.com/');
  assert.equal(normalize('HTTP://example.com/'), 'http://example.com/');
});

test('lowercases hostname', () => {
  assert.equal(normalize('https://Example.COM/foo'), 'https://example.com/foo');
  assert.equal(normalize('https://NEWS.YCombinator.com/item?id=1'), 'https://news.ycombinator.com/item?id=1');
});

test('does NOT lowercase path', () => {
  // Many servers are case-sensitive on path. We must preserve case.
  assert.equal(
    normalize('https://example.com/Article-About-Things'),
    'https://example.com/Article-About-Things'
  );
});

test('does NOT lowercase query values', () => {
  assert.equal(
    normalize('https://example.com/?q=Hello+World'),
    'https://example.com/?q=Hello%20World'
  );
});

// ------------------------------------------------------------------
// Rule 2 — strip default ports
// ------------------------------------------------------------------

test('strips default port :443 for https', () => {
  assert.equal(normalize('https://example.com:443/path'), 'https://example.com/path');
});

test('strips default port :80 for http', () => {
  assert.equal(normalize('http://example.com:80/path'), 'http://example.com/path');
});

test('strips default port :21 for ftp', () => {
  assert.equal(normalize('ftp://example.com:21/file'), 'ftp://example.com/file');
});

test('strips default port :443 for wss', () => {
  assert.equal(normalize('wss://relay.example:443/'), 'wss://relay.example/');
});

test('preserves non-default ports', () => {
  assert.equal(normalize('https://example.com:8443/path'), 'https://example.com:8443/path');
  assert.equal(normalize('http://localhost:3000/'), 'http://localhost:3000/');
});

// ------------------------------------------------------------------
// Rule 3 — drop tracking params
// ------------------------------------------------------------------

test('strips utm_* tracking params', () => {
  assert.equal(
    normalize('https://example.com/article?utm_source=newsletter&utm_medium=email&utm_campaign=launch'),
    'https://example.com/article'
  );
});

test('strips fbclid', () => {
  assert.equal(
    normalize('https://example.com/article?fbclid=IwAR1234'),
    'https://example.com/article'
  );
});

test('strips gclid', () => {
  assert.equal(
    normalize('https://example.com/article?gclid=Cj0K'),
    'https://example.com/article'
  );
});

test('strips msclkid', () => {
  assert.equal(
    normalize('https://example.com/article?msclkid=abc'),
    'https://example.com/article'
  );
});

test('strips Mailchimp ids', () => {
  assert.equal(
    normalize('https://example.com/article?mc_cid=abc&mc_eid=def'),
    'https://example.com/article'
  );
});

test('strips Substack share trackers', () => {
  assert.equal(
    normalize('https://author.substack.com/p/post?__source=share-preview&__share=foo'),
    'https://author.substack.com/p/post'
  );
});

test('strips Instagram igshid', () => {
  assert.equal(
    normalize('https://www.instagram.com/p/ABC/?igshid=xyz'),
    'https://www.instagram.com/p/ABC'
  );
});

test('strips YouTube share `feature` param', () => {
  assert.equal(
    normalize('https://www.youtube.com/watch?v=dQw4w9WgXcQ&feature=share'),
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
  );
});

test('strips Spotify `si` share param', () => {
  assert.equal(
    normalize('https://open.spotify.com/track/foo?si=abc123'),
    'https://open.spotify.com/track/foo'
  );
});

test('strips X/Twitter `s` and `t` share params', () => {
  // s and t are the X share trackers. On X domains we strip them; on
  // other domains they're treated as content (per the documented
  // trade-off).
  assert.equal(
    normalize('https://x.com/user/status/12345?s=20&t=abc'),
    'https://x.com/user/status/12345'
  );
  assert.equal(
    normalize('https://twitter.com/user/status/12345?s=20'),
    'https://twitter.com/user/status/12345'
  );
});

test('preserves `s` and `t` params on non-X hosts', () => {
  // Some hosts use `s=` or `t=` as content. We don't strip on those.
  assert.equal(
    normalize('https://example.com/search?s=query&t=results'),
    'https://example.com/search?s=query&t=results'
  );
});

test('preserves content query params alongside trackers', () => {
  assert.equal(
    normalize('https://example.com/article?id=42&utm_source=newsletter&page=3'),
    'https://example.com/article?id=42&page=3'
  );
});

test('tracking-param stripping is case-insensitive on key', () => {
  assert.equal(
    normalize('https://example.com/article?UTM_SOURCE=Foo&Fbclid=Bar'),
    'https://example.com/article'
  );
});

test('strips multiple known trackers in one URL', () => {
  assert.equal(
    normalize('https://example.com/x?utm_source=a&utm_medium=b&fbclid=c&gclid=d&msclkid=e&_ga=f'),
    'https://example.com/x'
  );
});

test('strips mc_cid, mc_eid, _ga, _gl', () => {
  assert.equal(
    normalize('https://example.com/article?mc_cid=a&mc_eid=b&_ga=c&_gl=d'),
    'https://example.com/article'
  );
});

test('strips ref/referrer/source generic trackers', () => {
  assert.equal(
    normalize('https://example.com/article?ref=twitter&referrer=foo&source=bar'),
    'https://example.com/article'
  );
});

// ------------------------------------------------------------------
// Rule 4 — fragments
// ------------------------------------------------------------------

test('strips plain fragment', () => {
  assert.equal(normalize('https://example.com/article#section-1'), 'https://example.com/article');
});

test('strips empty fragment', () => {
  assert.equal(normalize('https://example.com/article#'), 'https://example.com/article');
});

test('preserves W3C text fragment', () => {
  // Text Fragments are part of the canonical URL because annotations
  // may anchor to a text fragment.
  const url = 'https://example.com/article#:~:text=specific%20phrase';
  assert.equal(normalize(url), url);
});

test('preserves text fragment with anchor prefix', () => {
  const url = 'https://example.com/article#section:~:text=specific';
  // Both forms acceptable per spec; current rule keeps the whole hash
  // when ":~:text=" is present.
  assert.equal(normalize(url), url);
});

// ------------------------------------------------------------------
// Rule 5 — trailing slash on non-root path
// ------------------------------------------------------------------

test('strips trailing slash on non-root path', () => {
  assert.equal(normalize('https://example.com/article/'), 'https://example.com/article');
});

test('strips trailing slash even with query', () => {
  assert.equal(
    normalize('https://example.com/article/?id=1'),
    'https://example.com/article?id=1'
  );
});

test('strips trailing slash even with text fragment', () => {
  assert.equal(
    normalize('https://example.com/article/#:~:text=hi'),
    'https://example.com/article#:~:text=hi'
  );
});

test('preserves root slash', () => {
  assert.equal(normalize('https://example.com/'), 'https://example.com/');
});

test('preserves trailing slash inside path (only strips final)', () => {
  // Foo/bar/ → Foo/bar (only one slash stripped from the end)
  assert.equal(normalize('https://example.com/Foo/bar/'), 'https://example.com/Foo/bar');
});

// ------------------------------------------------------------------
// Rule 6 — sort query parameters
// ------------------------------------------------------------------

test('sorts query parameters alphabetically', () => {
  assert.equal(
    normalize('https://example.com/?b=2&a=1&c=3'),
    'https://example.com/?a=1&b=2&c=3'
  );
});

test('sorted output is invariant under input ordering', () => {
  const a = normalize('https://example.com/?id=5&page=2&sort=date');
  const b = normalize('https://example.com/?sort=date&id=5&page=2');
  const c = normalize('https://example.com/?page=2&sort=date&id=5');
  assert.equal(a, b);
  assert.equal(b, c);
});

test('sort handles repeated keys (stable, by value)', () => {
  // URL spec preserves repeated keys; sort by key, then by value.
  // URLSearchParams.entries() preserves insertion order for same key.
  const out = normalize('https://example.com/?b=2&a=2&a=1');
  // Both `a` entries before `b`. Within `a`, original order preserved.
  assert.match(out, /^https:\/\/example\.com\/\?a=2&a=1&b=2$/);
});

// ------------------------------------------------------------------
// Edge cases
// ------------------------------------------------------------------

test('returns input unchanged on parse failure', () => {
  assert.equal(normalize('not a url'), 'not a url');
  assert.equal(normalize(''), '');
  assert.equal(normalize('::::'), '::::');
});

test('handles non-string input safely', () => {
  assert.equal(normalize(null), null);
  assert.equal(normalize(undefined), undefined);
  // numbers/objects are passed through (no string ops to do)
  assert.equal(normalize(42), 42);
});

test('handles URL with username/password (preserves them)', () => {
  // Rare but possible. Don't strip auth.
  assert.equal(
    normalize('https://user:pass@example.com/'),
    'https://user:pass@example.com/'
  );
});

test('handles IDN hostname', () => {
  // The URL constructor punycodes IDN automatically. We just make sure
  // we don't accidentally lowercase the punycoded form (it's already
  // lowercase ASCII).
  const out = normalize('https://Bücher.example/');
  assert.match(out, /^https:\/\/xn--/);
});

test('handles IPv6 host', () => {
  assert.equal(normalize('https://[::1]:443/'), 'https://[::1]/');
  assert.equal(normalize('http://[::1]:80/'), 'http://[::1]/');
});

test('handles port 0 (preserves it)', () => {
  // Edge case but valid syntax. Don't accidentally strip.
  assert.equal(normalize('http://example.com:0/'), 'http://example.com:0/');
});

test('handles URL-encoded path correctly', () => {
  assert.equal(
    normalize('https://example.com/Hello%20World'),
    'https://example.com/Hello%20World'
  );
});

test('combined: strips trackers, sorts params, lowercases host, strips slash', () => {
  assert.equal(
    normalize('HTTPS://Example.COM:443/Article/?utm_source=Foo&id=5&fbclid=Bar&page=2#section'),
    'https://example.com/Article?id=5&page=2'
  );
});

// ------------------------------------------------------------------
// Cross-platform / real-world URL fixtures
// ------------------------------------------------------------------

test('Substack post with share trackers', () => {
  assert.equal(
    normalize('https://noahpinion.substack.com/p/the-fed-is-now-pricing-in-recession?__source=share-preview&utm_source=email&utm_medium=email-share-preview&__share=foo'),
    'https://noahpinion.substack.com/p/the-fed-is-now-pricing-in-recession'
  );
});

test('YouTube watch URL with share feature', () => {
  assert.equal(
    normalize('https://www.youtube.com/watch?v=dQw4w9WgXcQ&feature=youtu.be'),
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
  );
});

test('YouTube short URL (youtu.be) is NOT canonicalized to youtube.com', () => {
  // We don't do host rewrites — that would change semantics. The user
  // can configure per-host equivalences higher up the stack.
  assert.equal(
    normalize('https://youtu.be/dQw4w9WgXcQ?si=abc'),
    'https://youtu.be/dQw4w9WgXcQ'
  );
});

test('Twitter/X status URL with share params', () => {
  assert.equal(
    normalize('https://x.com/jack/status/20?s=20&t=ABC'),
    'https://x.com/jack/status/20'
  );
});

test('Mobile m. host preserved', () => {
  // We do NOT rewrite m.x.com → x.com. Different content (mobile site).
  assert.equal(
    normalize('https://m.example.com/article'),
    'https://m.example.com/article'
  );
});

test('AMP URL preserved as-is', () => {
  // We do NOT rewrite /amp/ paths to non-AMP. That's a per-publisher
  // policy decision that doesn't belong in URL normalization.
  assert.equal(
    normalize('https://example.com/article/amp/'),
    'https://example.com/article/amp'
  );
});

test('Bitcoin Magazine deep article URL', () => {
  assert.equal(
    normalize('https://bitcoinmagazine.com/business/article-slug?utm_source=feed'),
    'https://bitcoinmagazine.com/business/article-slug'
  );
});

test('FT article with subscriber-share token preserved (no known tracker key)', () => {
  // Don't strip params we don't recognize. False positives are worse
  // than false negatives here — a missed tracker just slightly forks
  // the metadata graph; an over-stripped param breaks article access.
  assert.equal(
    normalize('https://www.ft.com/content/abc-123?shareType=nongift'),
    'https://www.ft.com/content/abc-123?shareType=nongift'
  );
});

test('Bitcoin Optech newsletter URL with utm_*', () => {
  assert.equal(
    normalize('https://bitcoinops.org/en/newsletters/2026/04/30/?utm_source=newsletter&utm_medium=email'),
    'https://bitcoinops.org/en/newsletters/2026/04/30'
  );
});

test('Stacker News post URL', () => {
  assert.equal(
    normalize('https://stacker.news/items/12345/r/foo'),
    'https://stacker.news/items/12345/r/foo'
  );
});

// ------------------------------------------------------------------
// urlHash
// ------------------------------------------------------------------

test('urlHash returns 16-character hex prefix', async () => {
  const h = await urlHash('https://example.com/article');
  assert.match(h, /^[0-9a-f]{16}$/);
});

test('urlHash is deterministic', async () => {
  const a = await urlHash('https://example.com/article');
  const b = await urlHash('https://example.com/article');
  assert.equal(a, b);
});

test('urlHash equates URLs that normalize equal', async () => {
  // Different surface forms that all normalize to the same canonical
  // URL must hash identically. This is the load-bearing property.
  const a = await urlHash('https://Example.COM/article?utm_source=x&id=5');
  const b = await urlHash('HTTPS://example.com:443/article?id=5');
  const c = await urlHash('https://example.com/article?id=5#section');
  assert.equal(a, b);
  assert.equal(b, c);
});

test('urlHash differs for different normalized URLs', async () => {
  const a = await urlHash('https://example.com/article-1');
  const b = await urlHash('https://example.com/article-2');
  assert.notEqual(a, b);
});

// ------------------------------------------------------------------
// Normalizer unification (JOURNAL 2026-07-09): the legacy
// ContentExtractor list merged in, and the delegate pinned.
// ------------------------------------------------------------------

test('legacy-only tracking params are stripped after unification', () => {
  assert.equal(
    normalize('https://example.com/a?mkt_tok=T&oly_anon_id=1&oly_enc_id=2&vero_id=3&wickedid=4&id=5'),
    'https://example.com/a?id=5'
  );
  assert.equal(
    normalize('https://example.com/a?__twitter_impression=true&_gid=GA1.2.3&spm=a2h0k.1&x=1'),
    'https://example.com/a?x=1'
  );
  assert.equal(
    normalize('https://example.com/a?share_source=copy_web&q=covid'),
    'https://example.com/a?q=covid'
  );
});

test("'from' is NOT stripped — a content param on real sites (review 2026-07-10)", () => {
  // Pagination offsets / date ranges / converter origins ride in
  // 'from'; stripping it would merge genuinely distinct pages across
  // every metadata join. Under-merge beats over-merge.
  assert.notEqual(
    normalize('https://example.com/list?q=covid&from=100'),
    normalize('https://example.com/list?q=covid&from=200')
  );
  assert.equal(
    normalize('https://example.com/a?from=timeline&q=covid'),
    'https://example.com/a?from=timeline&q=covid'
  );
});

test('ContentExtractor.normalizeUrl IS the unified normalizer (delegate pin)', async () => {
  // Article identity (d-tags) and every downstream join must agree on
  // one canonical form. The delegate must not re-diverge.
  const { ContentExtractor } = await import('../src/shared/content-extractor.js');
  const cases = [
    'https://Example.COM:443/Article/?b=2&a=1&utm_source=x',
    'https://example.com/paper?mkt_tok=abc&id=7#fn-3',
    'https://example.com/page#:~:text=exact%20quote',
    'not a url at all'
  ];
  for (const url of cases) {
    assert.equal(ContentExtractor.normalizeUrl(url), normalize(url), url);
  }
  // The legacy keep-some-anchors hash heuristic is gone: every
  // non-text-fragment anchor strips, params sort.
  assert.equal(
    ContentExtractor.normalizeUrl('https://example.com/story?z=1&a=2#section-name'),
    'https://example.com/story?a=2&z=1'
  );
});
