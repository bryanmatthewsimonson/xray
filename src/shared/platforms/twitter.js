// Twitter / X platform handler — Phase 3c (issue #14).
//
// Runs in the content script on `twitter.com` / `x.com` pages.
// Synthesizes the article from scratch — Twitter pages aren't
// article-shaped and Readability returns garbage on them.
//
// Scope of MVP:
//
//   ✓ Status detail pages (`/<handle>/status/<id>`) — the page shows a
//     focal tweet plus thread continuation by the same author + replies
//     by other users.
//   ✓ Single tweet capture: id, author, text, timestamp, engagement
//     (likes / replies / retweets / views), media URLs.
//   ✓ Thread detection — multiple tweets by the focal tweet's author
//     in the article DOM, concatenated into one body.
//   ✓ Replies by OTHER users → `comments[]` so the reader can publish
//     them as opt-in kind-30041 events (same flow as Substack).
//   ✗ Profile pages, search pages, list pages — no focal tweet to
//     anchor on. Detected and rejected with a clear hint.
//   ✗ Quoted-tweet recursive extraction — rendered as a markdown
//     link to the quoted tweet for now.
//   ✗ Polls / spaces / community notes / etc.
//
// Known fragility: Twitter's DOM relies on `data-testid` selectors,
// which are *more* stable than class names but still churn — see
// `docs/JOURNAL.md` "youtube-arms-race" for our defensive philosophy.
// Strict-first selectors with loud diagnostics on extraction failure
// are the pattern.

// ------------------------------------------------------------------
// Detection
// ------------------------------------------------------------------

export function isTwitterStatusPage() {
    const host = window.location.hostname;
    if (!/^(www\.)?(twitter|x)\.com$/i.test(host)) return false;
    return /^\/[^/]+\/status\/\d+/.test(window.location.pathname);
}

export function isTwitterPage() {
    const host = window.location.hostname;
    return /^(www\.)?(twitter|x)\.com$/i.test(host);
}

/**
 * Pull the canonical tweet id out of the URL. Returns null if the
 * URL doesn't match a status path.
 */
export function tweetIdFromUrl(url = window.location.href) {
    try {
        const u = new URL(url);
        const m = u.pathname.match(/^\/[^/]+\/status\/(\d+)/);
        return m ? m[1] : null;
    } catch (_) { return null; }
}

// ------------------------------------------------------------------
// Tweet element extraction
// ------------------------------------------------------------------

/**
 * Walk the DOM and pull every `<article>` representing a tweet. Returns
 * the elements in document order — which matches the visual top-to-bottom
 * order that Twitter renders threads in.
 */
function pickTweetElements() {
    return Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
}

/**
 * Scrape one tweet element into a plain-data object. Defensive about
 * missing fields — most are best-effort, only the focal-tweet check
 * relies on having an id.
 */
function extractTweet(article) {
    const out = {
        id:           null,
        url:          '',
        author: {
            handle:     '',
            displayName:'',
            profileUrl: '',
            avatarUrl:  ''
        },
        text:         '',
        html:         '',
        timestamp:    null,                // ISO string
        engagement: {
            replies:    0,
            retweets:   0,
            likes:      0,
            views:      0
        },
        media:        [],                  // [{ type: 'image' | 'video', url }]
        quotedTweetUrl: null
    };

    // --- author ---
    // The "User-Name" testid block contains both display name + @handle
    // wrapped in <a href="/handle">. The first such anchor whose href
    // looks like a profile path is the author.
    const userBlock = article.querySelector('[data-testid="User-Name"]');
    if (userBlock) {
        const profileLinks = userBlock.querySelectorAll('a[role="link"][href^="/"]');
        for (const a of profileLinks) {
            const href = a.getAttribute('href') || '';
            if (/^\/[^/]+$/.test(href)) {
                out.author.handle     = href.slice(1);
                out.author.profileUrl = location.origin + href;
                break;
            }
        }
        // Display name = the first non-empty text content within the block,
        // before the @handle.
        const nameSpan = userBlock.querySelector('span');
        if (nameSpan) out.author.displayName = (nameSpan.textContent || '').trim();
    }
    const avatarImg = article.querySelector('[data-testid^="UserAvatar-"] img');
    if (avatarImg) out.author.avatarUrl = avatarImg.getAttribute('src') || '';

    // --- timestamp + canonical url ---
    // The status link wraps the <time> element. href="/handle/status/<id>"
    const timeEl = article.querySelector('time');
    if (timeEl) {
        out.timestamp = timeEl.getAttribute('datetime') || null;
        const linkAnc = timeEl.closest('a');
        if (linkAnc && linkAnc.href) {
            out.url = linkAnc.href;
            const m = linkAnc.getAttribute('href').match(/\/status\/(\d+)/);
            if (m) out.id = m[1];
        }
    }

    // --- tweet text ---
    const textEl = article.querySelector('[data-testid="tweetText"]');
    if (textEl) {
        out.text = (textEl.textContent || '').trim();
        out.html = textEl.innerHTML;
    }

    // --- engagement counts ---
    // Each engagement button has data-testid in a known set; the count
    // string lives in a nested <span>. Empty / hidden = 0.
    const ENGAGEMENT_TESTIDS = {
        reply:   'replies',
        retweet: 'retweets',
        like:    'likes'
    };
    for (const [testid, field] of Object.entries(ENGAGEMENT_TESTIDS)) {
        const btn = article.querySelector(`[data-testid="${testid}"]`);
        if (!btn) continue;
        const countText = (btn.textContent || '').trim();
        out.engagement[field] = parseEngagementCount(countText);
    }
    // Views often live on an <a href="…/analytics"> sibling — try to
    // surface it. Twitter shows them as e.g. "12.3K" inline.
    const viewsLink = article.querySelector('a[href*="/analytics"]');
    if (viewsLink) {
        out.engagement.views = parseEngagementCount((viewsLink.textContent || '').trim());
    }

    // --- media ---
    const photoEls = article.querySelectorAll('[data-testid="tweetPhoto"] img');
    for (const img of photoEls) {
        const src = img.getAttribute('src');
        if (src) out.media.push({ type: 'image', url: src });
    }
    const videoEls = article.querySelectorAll('video');
    for (const v of videoEls) {
        // <video> elements have a poster attribute that's the still
        // frame; the actual playable URL is harder to extract reliably.
        const poster = v.getAttribute('poster');
        if (poster) out.media.push({ type: 'video', url: poster, thumbnail: true });
    }

    // --- quoted tweet ---
    // Quoted tweets render as nested article-like blocks. The link to
    // the quoted tweet is on the wrapper <a role="link" href="/handle/status/id">.
    const quoted = article.querySelector('[data-testid="tweet"][role="link"]');
    if (quoted) {
        const a = quoted.querySelector('a[href*="/status/"]');
        if (a) out.quotedTweetUrl = a.href;
    }

    return out;
}

/**
 * Parse "12.3K" / "1.2M" / "123" / "" → integer count.
 */
function parseEngagementCount(text) {
    if (!text) return 0;
    const m = String(text).trim().match(/^([\d.]+)\s*([KMB])?$/i);
    if (!m) return 0;
    const n = parseFloat(m[1]);
    if (!Number.isFinite(n)) return 0;
    const mult = m[2] ? ({ K: 1e3, M: 1e6, B: 1e9 })[m[2].toUpperCase()] || 1 : 1;
    return Math.round(n * mult);
}

// ------------------------------------------------------------------
// Synthesize an article from a status detail page
// ------------------------------------------------------------------

export async function synthesizeArticle() {
    if (!isTwitterStatusPage()) return null;

    const focalId = tweetIdFromUrl();
    if (!focalId) return null;

    // The DOM may not have settled by the time the user clicks the
    // FAB. Give it up to ~2 seconds to render the focal tweet —
    // Twitter is a SPA and its content loads asynchronously after the
    // navigation event fires.
    const focal = await waitForFocalTweet(focalId, 2000);
    if (!focal) {
        console.warn('[X-Ray Twitter] focal tweet not found in DOM. URL:', window.location.href);
        return null;
    }

    // Pull every tweet currently rendered. Tweets by the focal
    // author, in the same DOM region as the focal tweet, count as
    // thread continuation. Tweets by other authors → comments.
    const allTweets = pickTweetElements().map(extractTweet).filter((t) => t.id);

    const threadAuthor = focal.author.handle.toLowerCase();
    const threadTweets = allTweets.filter((t) => t.author.handle.toLowerCase() === threadAuthor);
    const commentTweets = allTweets.filter((t) => t.author.handle.toLowerCase() !== threadAuthor);

    // Sort thread tweets by ID — Twitter ids are roughly chronological
    // (snowflake ids), so increasing-id sort matches publish order.
    threadTweets.sort((a, b) => {
        const aBig = BigInt(a.id);
        const bBig = BigInt(b.id);
        return aBig < bBig ? -1 : aBig > bBig ? 1 : 0;
    });

    const isThread = threadTweets.length > 1;
    const canonicalUrl = `https://x.com/${focal.author.handle}/status/${focal.id}`;
    const title = composeTitle(focal, isThread, threadTweets.length);

    // Body: each thread tweet as its own paragraph block, with a tiny
    // header line if it's a thread (so the user can see the structure
    // when reading the published article). Single-tweet captures get
    // the bare body text.
    const bodyMarkdown = composeMarkdownBody({
        focal,
        threadTweets,
        canonicalUrl,
        isThread
    });

    // Comments: replies by other users. The reader's publish flow
    // already supports an opt-in kind-30041 batch (same path Substack
    // uses) — we just need to hand it the right shape.
    const comments = commentTweets.map((t) => ({
        id:            t.id,
        body:          t.text,
        date:          t.timestamp,
        author: {
            name:       t.author.displayName,
            handle:     t.author.handle,
            profileUrl: t.author.profileUrl,
            avatarUrl:  t.author.avatarUrl
        },
        reactionCount: t.engagement.likes,
        restacks:      t.engagement.retweets,
        deleted:       false,
        children:      []
    }));

    const featuredImage = focal.media.find((m) => m.type === 'image')?.url
                       || focal.author.avatarUrl
                       || null;

    const publishedAtUnix = focal.timestamp
        ? Math.floor(Date.parse(focal.timestamp) / 1000)
        : null;

    return {
        title,
        url: canonicalUrl,
        domain: 'x.com',
        siteName: 'X (Twitter)',
        byline: focal.author.displayName || ('@' + focal.author.handle),
        publishedAt: publishedAtUnix,
        extractedAt: Math.floor(Date.now() / 1000),
        featuredImage,
        content:  basicMarkdownToHtml(bodyMarkdown),
        markdown: bodyMarkdown,
        excerpt:  focal.text.slice(0, 280),
        contentType: 'post',
        platform: 'twitter',
        engagement: {
            likes:    focal.engagement.likes,
            shares:   focal.engagement.retweets,
            comments: focal.engagement.replies,
            views:    focal.engagement.views
        },
        // Legacy `tweetMeta` shape consumed by event-builder.js:179 —
        // emits `tweet_id`, `author_handle`, `thread`, `thread_length`
        // tags on the kind-30023 event.
        tweetMeta: {
            tweetId:      focal.id,
            authorHandle: focal.author.handle,
            isThread,
            threadLength: threadTweets.length
        },
        // Richer per-platform structure for any downstream consumer
        // that wants more than the legacy tags.
        twitter: {
            tweetId:        focal.id,
            author:         focal.author,
            timestamp:      focal.timestamp,
            isThread,
            threadLength:   threadTweets.length,
            threadTweets,                   // [{id, text, timestamp, engagement, ...}]
            engagement:     focal.engagement,
            media:          focal.media,
            quotedTweetUrl: focal.quotedTweetUrl
        },
        // Pre-shaped comments so the reader's existing comment-publish
        // path picks them up. Mirrors Substack's contract.
        comments
    };
}

function composeTitle(focal, isThread, threadLen) {
    const handle = focal.author.handle ? '@' + focal.author.handle : 'Tweet';
    const preview = focal.text.replace(/\s+/g, ' ').trim().slice(0, 60);
    const ellipsis = focal.text.length > 60 ? '…' : '';
    const threadTag = isThread ? ` (thread, ${threadLen} tweets)` : '';
    return `${handle}: "${preview}${ellipsis}"${threadTag}`;
}

function composeMarkdownBody({ focal, threadTweets, canonicalUrl, isThread }) {
    const parts = [];
    const hdr = [];
    hdr.push(`**Tweet**: [@${focal.author.handle}](${canonicalUrl})`);
    if (focal.author.displayName) hdr.push(`**Author**: ${focal.author.displayName}`);
    if (focal.timestamp)          hdr.push(`**Posted**: ${new Date(focal.timestamp).toLocaleString()}`);
    if (isThread)                 hdr.push(`**Thread**: ${threadTweets.length} tweets`);
    const eng = focal.engagement;
    const engBits = [];
    if (eng.likes)    engBits.push(`${eng.likes.toLocaleString()} likes`);
    if (eng.retweets) engBits.push(`${eng.retweets.toLocaleString()} reposts`);
    if (eng.replies)  engBits.push(`${eng.replies.toLocaleString()} replies`);
    if (eng.views)    engBits.push(`${eng.views.toLocaleString()} views`);
    if (engBits.length) hdr.push(`**Engagement**: ${engBits.join(' · ')}`);
    hdr.push(`**Tweet ID**: \`${focal.id}\``);
    parts.push(`---\n${hdr.join('  \n')}\n---\n`);

    if (isThread) {
        threadTweets.forEach((t, i) => {
            parts.push(`### ${i + 1}/${threadTweets.length}\n\n${t.text}\n`);
            renderMediaSection(t).forEach((line) => parts.push(line));
        });
    } else {
        parts.push(focal.text + '\n');
        renderMediaSection(focal).forEach((line) => parts.push(line));
        if (focal.quotedTweetUrl) {
            parts.push(`> **Quoting**: [${escapeUrl(focal.quotedTweetUrl)}](${escapeUrl(focal.quotedTweetUrl)})\n`);
        }
    }

    return parts.join('\n');
}

function renderMediaSection(tweet) {
    if (!tweet.media || tweet.media.length === 0) return [];
    const lines = [];
    for (const m of tweet.media) {
        if (m.type === 'image') {
            lines.push(`![image](${escapeUrl(m.url)})\n`);
        } else if (m.type === 'video') {
            lines.push(`*[video — poster:* ![](${escapeUrl(m.url)})*]*\n`);
        }
    }
    return lines;
}

function escapeUrl(s) { return String(s || '').replace(/[\(\)]/g, ''); }

function basicMarkdownToHtml(md) {
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return md
        .split(/\n{2,}/)
        .map((block) => {
            if (block.startsWith('### ')) return `<h3>${esc(block.slice(4).trim())}</h3>`;
            if (block.startsWith('## '))  return `<h2>${esc(block.slice(3).trim())}</h2>`;
            if (block.startsWith('---'))  return `<hr />`;
            if (block.startsWith('> '))   return `<blockquote>${esc(block.slice(2)).replace(/\n/g, '<br>')}</blockquote>`;
            if (block.startsWith('!['))   return block;   // markdown image — pass through
            return `<p>${esc(block).replace(/\n/g, '<br>')}</p>`;
        })
        .join('\n');
}

// ------------------------------------------------------------------
// Wait for the focal tweet to render
// ------------------------------------------------------------------

function waitForFocalTweet(focalId, timeoutMs) {
    return new Promise((resolve) => {
        const find = () => {
            const tweets = pickTweetElements();
            for (const el of tweets) {
                const timeAnc = el.querySelector('time')?.closest('a');
                const href = timeAnc?.getAttribute('href') || '';
                if (href.includes(`/status/${focalId}`)) {
                    return extractTweet(el);
                }
            }
            return null;
        };
        const initial = find();
        if (initial) return resolve(initial);

        const start = Date.now();
        const obs = new MutationObserver(() => {
            const found = find();
            if (found) { obs.disconnect(); resolve(found); }
            else if (Date.now() - start > timeoutMs) {
                obs.disconnect(); resolve(null);
            }
        });
        obs.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => { obs.disconnect(); resolve(find()); }, timeoutMs);
    });
}
