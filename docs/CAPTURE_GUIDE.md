# Capture Guide

X-Ray captures articles and social-media posts as NOSTR events. It works
automatically on most websites, but the "hard-tier" platforms (Facebook,
Instagram, TikTok) need a little help from you to get a good capture.

This guide covers:

- [Instagram](#instagram)
- [Facebook](#facebook)
- [TikTok](#tiktok)
- [Easy-tier platforms](#easy-tier-platforms) (YouTube, Twitter/X, Substack, general articles)
- [Podcast transcripts (import)](#podcast-transcripts-import)
- [What to check after capture](#what-to-check-after-capture)
- [When a capture looks wrong](#when-a-capture-looks-wrong)

---

## Instagram

**The golden path:** open the specific post you want to capture, wait a
beat for it to fully load, then trigger X-Ray (toolbar icon or Ctrl/Cmd+Shift+X).

### Do this

1. **Navigate to a single post, reel, or IGTV URL.** X-Ray captures
   when the URL looks like one of these:
   - `instagram.com/p/<shortcode>/` — image or carousel post
   - `instagram.com/reel/<shortcode>/` — reel
   - `instagram.com/tv/<shortcode>/` — IGTV (legacy)
   - `instagram.com/<username>/p/<shortcode>/` — user-prefixed post
   - `instagram.com/<username>/reel/<shortcode>/` — user-prefixed reel

2. **If it's a carousel, swipe through all the slides before capturing.**
   Instagram lazy-loads slides as you navigate; the DOM scrape only sees
   slides that have been rendered. If you want every slide preserved,
   make sure you've clicked through them first. (X-Ray also tries to
   grab the full list from Instagram's GraphQL response, which often
   gets every slide even if you didn't swipe — but swiping is the
   reliable fallback.)

3. **Wait for the page to settle** before triggering X-Ray (toolbar icon or Ctrl/Cmd+Shift+X). X-Ray
   buffers Instagram's GraphQL responses as they fire during page load;
   if you trigger X-Ray (toolbar icon or Ctrl/Cmd+Shift+X) before those responses arrive, the author
   profile (verified flag, follower count, full name) won't be enriched.
   A second or two is enough on most connections.

4. **Trigger X-Ray (toolbar icon or Ctrl/Cmd+Shift+X).** It'll open the reader with the extracted
   post: caption, author, image URLs, engagement counts, screenshot
   evidence, and a hashed HTML snapshot.

### Don't do this

- **Don't capture from the profile grid.** The URL `instagram.com/<username>/`
  isn't a post — it's a feed. X-Ray will either decline to capture or
  produce a poor-quality result. Click into the specific post first.

- **Don't capture from Stories.** Stories are ephemeral and out of scope
  for an archive-the-public-record tool.

- **Don't capture feed/explore pages.** Same reason as profile grids —
  no focal post to anchor on.

### What you'll see in the reader

For Instagram posts, the reader shows:

- **Author chip** with profile pic, handle, verified check, follower
  count, post count, and biography when available.
- **Provenance chips** — `post` / `reel` / `igtv` for the post kind,
  and a `graphql` / `dom-scrape` / `og-meta` chip that tells you which
  extraction path produced the media list. `graphql` is best (all
  carousel slides); `dom-scrape` is slides-you've-navigated-to;
  `og-meta` is just the 1:1 thumbnail.
- **Screenshot evidence** in a collapsible `<details>` block — the
  visible slide at capture time, which is the always-works fallback.
- **Captured media** embedded inline in the markdown body.

---

## Facebook

**The golden path:** open the post in the detail-modal view (click into
it from the feed or a profile), let the page settle, and click the
X-Ray toolbar icon.

### Do this

1. **Open a specific post.** X-Ray recognizes these URL shapes:
   - `facebook.com/<user>/posts/<id>` — profile or page post
   - `facebook.com/<user>/videos/<id>` — video post
   - `facebook.com/<user>/photos/<set>/<id>` — photo post
   - `facebook.com/watch/?v=<id>` — watch/video
   - `facebook.com/reel/<id>` — reel
   - `facebook.com/permalink.php?story_fbid=<id>&id=<page>` — legacy
   - `facebook.com/story.php?story_fbid=<id>&id=<page>` — legacy
   - `facebook.com/share/p|v|r/<shortcode>/` — modern share links
   - `facebook.com/photo/?fbid=<id>` — photo detail
   - `facebook.com/groups/<g>/posts|permalink/<id>/` — group posts

   For personal-profile posts, the most reliable path is: open your
   friend's profile, click into the post, and let Facebook open it as
   a modal overlay with a URL like `.../posts/pfbid0...`.

2. **Scroll through the post so the images render.** Facebook aggressively
   lazy-loads images — the `<img>` tags don't have their `src` set
   until they enter the viewport. If you trigger X-Ray (toolbar icon or Ctrl/Cmd+Shift+X) on a post whose
   images haven't rendered yet, they won't be captured.

3. **Wait for the page to settle** before triggering X-Ray (toolbar icon or Ctrl/Cmd+Shift+X). Facebook's
   `/api/graphql/` responses fire during page load and navigation;
   X-Ray's buffer captures them as they arrive. Click the X-Ray toolbar icon after
   the post has finished loading.

4. **Trigger X-Ray (toolbar icon or Ctrl/Cmd+Shift+X).** You'll see the reader with the extracted
   post: author name and handle, the full post body text, any inline
   images, engagement counts (reactions / comments / shares when
   public), screenshot evidence, and a hashed HTML snapshot.

### Don't do this

- **Don't capture from the feed scroll.** The home feed has many posts
  visible at once; X-Ray will pick one (often the wrong one). Click
  into a specific post first.

- **Don't capture your own News Feed or profile landing page.** Those
  aren't single-post URLs.

- **Don't expect captures from posts you can't see.** If Facebook's
  privacy gates would hide the post (logged out, not in the friend
  circle, etc.), X-Ray can't see it either — it runs in the page,
  as you.

### What you'll see in the reader

For Facebook posts, the reader shows:

- **Author block** with handle, display name, and verified check when
  applicable.
- **Provenance chips** — post kind (`post` / `video` / `reel` / `photo`),
  an `extractedFrom` chip (`graphql` / `og-meta` / `dom-scrape` / `none`)
  showing which path produced the post body, and an `author: <source>`
  chip for where the author name came from.
- **Screenshot evidence** in a collapsible panel.
- **Captured images** inline in the `## Media` section.

### Known limitations

- **Screenshot may show only the top portion of tall posts.** Chrome's
  `tabs.captureVisibleTab` only captures what's on-screen. The full
  text and image URLs are preserved in the markdown body; the
  screenshot is an additional evidence layer, not the whole artifact.

- **Personal-profile posts often have no `og:description`.** X-Ray
  falls through to GraphQL (if you waited for it to fire) or DOM
  scraping (if you scrolled through the post). Both paths can degrade
  on specific post shapes; check the provenance chips after capture.

- **Private posts require you to be logged in.** X-Ray runs in the
  page as you; if you can see the post, X-Ray can too.

---

## TikTok

**The golden path:** open the specific video URL and trigger X-Ray (toolbar icon or Ctrl/Cmd+Shift+X).
TikTok is the easiest hard-tier platform — most of the metadata lives
in a server-rendered JSON blob that's in the HTML before any JS runs.

### Do this

1. **Navigate to a single video.** The canonical desktop URL is
   `tiktok.com/@<user>/video/<id>`.

2. **Trigger X-Ray (toolbar icon or Ctrl/Cmd+Shift+X).** Caption, hashtags, author, view/like/comment/
   share counts, duration, and cover image get captured, plus a
   screenshot and HTML snapshot.

### Don't do this

- **Don't capture from `vm.tiktok.com/<short>` links.** Those redirect;
  wait for the redirect to land on `@<user>/video/<id>` first.

- **Don't capture the For You feed.** Click into a specific video first.

---

## Easy-tier platforms

These "just work" without special handling:

- **YouTube** (`youtube.com/watch?v=<id>`) — transcript included when
  available, language selection for origin + user language, per-cue
  clickable timestamps that link back into the video.
  - **To capture comments, scroll down to the comments first.** YouTube
    loads comments lazily — they don't exist on the page until you
    scroll them into view. X-Ray captures whatever has loaded at the
    moment you open it, so: scroll the comments into view (and keep
    scrolling for more), *then* click the X-Ray button. Each captured
    commenter is recorded with their stable channel id, so the same
    person is recognized across videos. If you capture without
    scrolling, the reader will tell you no comments were loaded.
- **Twitter / X** (`x.com/<user>/status/<id>`) — focal tweet plus
  thread if it's a thread. Profiles and search pages are declined.
- **Substack** (`<publication>.substack.com/p/<slug>` or custom-domain
  Substacks) — article body plus comments if you opt in.
- **Any article page** — Readability extracts the main content. Works
  on most news sites, blogs, documentation, Wikipedia, etc.
- **PubMed Central** (`pmc.ncbi.nlm.nih.gov/articles/PMC<id>/`, legacy
  `www.ncbi.nlm.nih.gov/pmc/...` too) — plain server-rendered HTML, no
  timing quirks. On top of the article body, the capture carries the
  **reference list as structure** (year/DOI/PMID per entry, title and
  authors only where the page marks them — never guessed), figure
  captions, and the PMCID/PMID/DOI ids. References are a local capture
  record; nothing new publishes.
- **arXiv** (`arxiv.org/abs/<id>`) — the abs page shows only the
  abstract, so the capture **prefers the ar5iv full-text rendition**
  (`ar5iv.labs.arxiv.org`) when it's meaningfully fuller: the body is
  swapped for the full text, `capture_url` records the ar5iv address
  actually fetched, and the article's identity stays the `/abs/` URL.
  Honesty note: ar5iv is a machine conversion of the LaTeX source, not
  the PDF of record — figures/equations can differ; that's exactly why
  the provenance is recorded. If ar5iv has no conversion (or it's
  stub-short), you keep the abstract capture unchanged. `/pdf/` links
  route through the PDF capture path instead.

---

## Marking the source type (primary vs secondary)

Not all sources are equal evidence. The **original** WHO/Nature paper is
a *primary* source; a news article that summarizes it, or an op-ed that
disputes it, is *secondary*. X-Ray lets you declare this on any capture
so a reader (and a corpus analysis) can tell them apart.

In the reader, open **🎙 Media & source** and pick a **Source type**:

- **Primary record** — an official/original document, dataset, court
  filing, ruling, transcript, or raw recording.
- **Primary research** — the original study, paper, or preprint.
- **First-hand reporting** — eyewitness journalism, the on-the-record
  participant, the leaked document reported directly.
- **Analysis / commentary** — a review, op-ed, or article interpreting
  others' work (secondary).
- **Reference / summary** — an encyclopedia, explainer, or aggregator
  (tertiary).

X-Ray **suggests** a type from what it already knows — a captured paper
with a DOI is suggested as *Primary research*, an op-ed as *Analysis* —
but you confirm; it never publishes a type you didn't set. "Primary"
means the **originating** artifact others cite, not a write-up of it.
The declaration is metadata (it doesn't change the capture's content
hash), and primary sources get a badge in the portal.

**How the article cites its links.** The same dialog has an **Outbound
links** section listing the article's external links. For each, you can
declare *why* it's cited: **Cited as evidence** (the primary source the
argument relies on), **Mentioned** (background), **Supports**,
**Disputes**, or **Reviews**. This is what distinguishes a debater's
article that *disputes* the original paper from one that *cites it as
evidence* — and, combined with the linked paper's own *Primary research*
source type, traces the secondary→primary chain across a case. Roles are
optional metadata; leaving them unset changes nothing.

## Podcast transcripts (import)

A podcast episode lives at a URL — Spotify, Apple Podcasts, Substack,
YouTube, or the show's own site. X-Ray treats **that URL as the
episode's identity**: capture the episode's page like any other page,
then tell X-Ray what it is and attach the transcript. (The same goes
for a **video hosted off YouTube** — declare it, attach its
transcript.) X-Ray never scrapes a podcast app or auto-looks-up feeds:
you bring the text and, optionally, the universal podcast IDs.

### The URL-first flow (preferred)

1. **Capture the episode's page** (toolbar icon or Ctrl/Cmd+Shift+X).
   Show notes and page metadata come along like any capture.
2. In the reader, click **🎙 Media…** in the toolbar.
3. **Declare what the URL contains** — "a podcast episode", or "a
   video". This is your declaration, published as a `media` tag; X-Ray
   never infers it.
4. **Fill the podcast identity** if you have it — Show, Feed GUID,
   Episode GUID, Feed URL, iTunes ID. These are the universal join:
   the same episode captured at its Spotify URL *and* its YouTube URL
   is recognizably one episode when both carry the same episode GUID —
   declare the same IDs on each capture.
5. **Paste or upload the transcript** in the same dialog. The preview
   confirms the detected format, turns, and speakers; **Save** appends
   a `## Transcript` section to the captured body, speaker-attributed,
   with per-turn timestamps that link into the episode.

Notes on the attach:

- **The content hash changes** — by design: the body genuinely grew.
  The archive keeps the pre-transcript version as a prior snapshot.
- **Attaching again replaces** the previously attached `## Transcript`
  section (the dialog warns you). A YouTube capture's own
  `## Transcript — <language>` sections are never touched.
- Once attached, selecting a sentence inside a turn and adding a claim
  prefills **"Who said it"** with that turn's speaker.
- Metadata-only saves (declare the type + IDs, no transcript) don't
  touch the body or the hash — safe on an already-published capture.

### No episode URL? The portal import (fallback)

When the transcript is all you have, import it as a standalone record
from the portal ("My Archive"):

- **Library header** — the `Import transcript…` button.
- **A case view** — beside `Add sources…`; importing here drops the
  record straight into that case, and the case re-renders immediately.

Paste or upload, watch the same `Detected: …` preview, fill **Title**
(required) and any metadata, and **Import** — X-Ray archives the
transcript as its own record and opens it in the reader.

### Accepted formats

X-Ray auto-detects the format — you don't pick one. It recognizes:

**WebVTT** (`.vtt` caption files). Voice tags (`<v Name>`) set the
speaker; a cue with two voices splits into two turns.

```
WEBVTT

00:00:03.000 --> 00:00:07.500
<v Dr. Fauci> The data on transmission was evolving weekly.

00:00:07.500 --> 00:00:11.000
<v Host> So what changed your assessment?
```

**SRT** (`.srt` subtitle files). A leading `- NAME:` label sets the
speaker and **carries forward** to following unlabeled cues (broadcast
convention), until the next label.

```
1
00:00:03,000 --> 00:00:07,500
- DR. FAUCI: The data on transmission was evolving weekly.

2
00:00:07,500 --> 00:00:11,000
- HOST: So what changed your assessment?
```

**Speaker lines** — the plain-text transcript most show sites publish.
Any of these line shapes work, mixed freely:

```
Dr. Fauci: The data on transmission was evolving weekly.
[12:04] Host: So what changed your assessment?
Dr. Fauci [12:08]: New household-contact studies, mostly.
```

A line with no label continues the previous speaker's turn; a blank line
ends the turn. A **speaker label** is 1–6 words (≤60 chars) before a
colon, containing a letter and starting with a capital or digit — so
`Dr. Fauci`, `HOST`, and `Speaker 1` all count, but a prose line like
`Note: this was recorded remotely` does not (it's kept as text, not read
as a speaker).

**Plain text** — if X-Ray sees no timestamps and no speaker labels, each
paragraph becomes an un-attributed turn. You still get an archived,
case-joinable record; you just won't get per-speaker attribution.

### Metadata fields (portal import)

The **🎙 Media…** dialog shares the Podcast-IDs fields below; the rest
apply to the standalone portal import:

- **Title** *(required)* — the episode title. Used as the record title
  and to build the identity slug.
- **Episode URL** *(optional)* — the canonical URL of the episode. When
  supplied, per-turn timestamps in the body link back into the audio
  (Media Fragments `#t=`). **Leave it blank** and X-Ray mints a local
  content-hashed identity (`file:///imported/<hash>/…`) — the transcript
  still archives and publishes fine; you can paste the real URL in the
  reader before publishing.
- **Show** — the podcast / show name. Becomes the record's site name and
  the `show` tag.
- **Host** — the host, recorded as the byline.
- **Published date** — the episode's publish date.
- **Podcast IDs** *(collapsed, all optional)* — the universal
  identifiers, when you have them: **Feed GUID** (the podcast-namespace
  feed UUID), **Episode GUID**, **Feed URL** (the RSS feed — a published
  transcript co-emits it as an indexed `r`, so a query can find every
  episode of the show), and **iTunes ID** (Apple's numeric collection
  id, digits only). X-Ray never guesses these; a field left blank emits
  no tag. See `docs/NIP_DRAFT.md` for the exact wire form.

### What you'll see in the reader

- The **speaker-labeled markdown body** — a `## Transcript` section with
  each turn as `` `M:SS` **Speaker:** text ``, timestamps linked into
  the episode when you gave an Episode URL.
- When you select a sentence in a turn and **Add claim**, the "Who said
  it" source is **pre-filled with that turn's speaker** — matched to an
  existing person entity when one exists, otherwise offered as a
  suggested name.
- If you imported without an Episode URL, the reader shows the synthetic
  `file:///imported/…` URL; edit it to the real episode URL before
  publishing if you have it.

---

## What to check after capture

Once the reader opens, glance at:

1. **Provenance chips** at the top of the reader. `graphql` or
   `ssr-script` means X-Ray got rich structured data. `dom-scrape`
   means it fell back to reading the page. `og-meta` means only the
   minimal metadata meta tags were available. `none` means extraction
   failed — you'll have the screenshot evidence but not much else.

2. **The screenshot evidence panel** — click "📸 Screenshot evidence"
   to expand it and confirm the right thing was captured.

3. **The markdown body** — switch to the Markdown tab to see exactly
   what will be published as the event body.

4. **The preview** — switch to Preview to see how it'll render in a
   NOSTR client.

If any of these look wrong, see the next section.

---

## When a capture looks wrong

### The author is wrong / missing

- **Instagram:** If the handle chip is missing, make sure you're on a
  specific post URL, not a profile or feed. X-Ray falls back through
  og-meta → URL path → GraphQL author — if all fail, the handle is
  unrecoverable without you logging in to your Instagram account.

- **Facebook:** If the author shows up as a sibling account instead of
  the focal post's author, you might have clicked capture before the
  focal GraphQL response fired. Wait a beat longer, then retry.

### The post body is empty or truncated

- **Instagram:** OG description includes the caption for public posts.
  Private or restricted posts won't have a caption; use the screenshot
  evidence instead.

- **Facebook:** Scroll to the full post body before capturing. The DOM
  scraper picks the longest visible text node; if lazy-loaded text
  hasn't rendered yet, you'll get less than the full post.

### The screenshot only shows part of the post

- Tall posts exceed one viewport. X-Ray captures what's visible when
  you trigger X-Ray (toolbar icon or Ctrl/Cmd+Shift+X). Scroll the post so the most important content is
  centered before clicking.

### The capture picks the wrong item

- **Facebook:** This usually happens when X-Ray's GraphQL candidate
  scorer picks a sibling story (long comment, adjacent feed unit).
  Make sure the post is the focal item on the page — open it as a
  modal or navigate to its permalink directly.

### Images are missing from the markdown body

- **Instagram carousels:** Swipe through all the slides before
  triggering X-Ray (toolbar icon or Ctrl/Cmd+Shift+X). The GraphQL path captures all slides; the DOM
  path captures only slides that have been rendered.

- **Facebook:** Scroll so the image gallery renders. FB sets
  `<img src=...>` only after images enter the viewport.

### The event was rejected by relays

Check the console; the relay's reason is usually the first clue. The
most common cases:

- `"invalid: tag val was not a string"` — a tag value came through as
  a number. Should be fixed in current code; file a bug if you see it.
- `"blocked"` / `"rate-limited"` — relay-specific; try publishing to a
  different relay in Settings.

---

## Filing bugs

When reporting a bad capture, include:

1. **The URL** you captured from.
2. **What the provenance chips said** (e.g. `graphql`, `og-meta`,
   `none`).
3. **The console output** — the `[X-Ray <Platform>]` lines narrate
   which extraction path ran and what it found. Copy the block from
   "buffer scan: walking N events" through "capture diagnostic:
   {...}".
4. **What was missing or wrong** — author, body, images, screenshot,
   specific claim.

The console narration is designed to make failures diagnosable from
a user's paste — if it doesn't answer "why did this capture look
wrong," that itself is a bug worth reporting.
