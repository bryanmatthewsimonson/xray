// YouTube comment parsing — Phase 9 identity layer, Phase III.
//
// YouTube does NOT ship comments in the initial HTML. They lazy-load as
// the viewer scrolls, via POSTs to the InnerTube endpoint
// `/youtubei/v1/next` (continuation requests). X-Ray's MAIN-world
// api-interceptor (Phase 8a) captures those response bodies into the
// content-script buffer; this module turns them into the normalized
// comment tree the reader + Phase II identity loop already consume.
//
// Two response shapes coexist in the wild and this parser handles both:
//
//   1. LEGACY — `commentThreadRenderer` → `comment.commentRenderer`,
//      with inline `replies.commentRepliesRenderer` for nested replies.
//      Cleanly threadable.
//
//   2. MODERN — "framework updates": `frameworkUpdates.entityBatchUpdate
//      .mutations[].payload.commentEntityPayload`, where the comment
//      content + author live in a flat entity payload and the thread
//      structure lives elsewhere (separate continuations). We extract
//      these flat (top-level; parentId null) — modern reply threads
//      arrive in their own continuation requests and are rarely in the
//      initial buffer.
//
// The author's `channelId` (UC…) is the STABLE identifier — the same
// role substack's user_id plays — so YouTube commenters get the same
// dedup-able identity treatment as every other platform via
// resolveStableId('youtube', author).
//
// The parser is defensive: it walks recursively and extracts whatever it
// finds, skipping malformed nodes rather than throwing. YouTube reshapes
// these payloads periodically; a missed field degrades one comment, not
// the whole capture.

/**
 * Parse a set of `/youtubei/v1/next` response objects into a comment
 * tree. Pure — accepts already-parsed JSON objects (the buffer-bound
 * caller does the JSON.parse). Deduplicates by commentId across all
 * responses (continuation pages overlap).
 *
 * @param {Array<object>} responses  parsed InnerTube response objects
 * @returns {{ tree: Array<object>, total: number }}
 */
export function parseComments(responses) {
  const byId = new Map();        // commentId → node
  const parentOf = new Map();    // childId → parentId (legacy threads)

  for (const resp of (Array.isArray(responses) ? responses : [])) {
    if (!resp || typeof resp !== 'object') continue;
    // Legacy: find every commentThreadRenderer (carries its own replies).
    walk(resp, (node) => {
      if (node.commentThreadRenderer) {
        ingestLegacyThread(node.commentThreadRenderer, byId, parentOf);
      }
      // Legacy stray commentRenderer not wrapped in a thread (reply
      // continuation payloads). Captured as top-level if we don't
      // already know its parent.
      if (node.commentRenderer) {
        const c = fromCommentRenderer(node.commentRenderer);
        if (c && !byId.has(c.id)) byId.set(c.id, c);
      }
      // Modern: commentEntityPayload inside frameworkUpdates mutations.
      if (node.commentEntityPayload) {
        const c = fromEntityPayload(node.commentEntityPayload);
        if (c && !byId.has(c.id)) byId.set(c.id, c);
      }
    });
  }

  // Assemble the tree. Apply known parent links (legacy); everything
  // else is top-level.
  for (const [childId, parentId] of parentOf) {
    if (byId.has(childId)) byId.get(childId).parentId = parentId;
  }

  const tree = [];
  const total = byId.size;
  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) {
      byId.get(node.parentId).children.push(node);
    } else {
      node.parentId = null;
      tree.push(node);
    }
  }

  return { tree, total };
}

/**
 * Recursively visit every plain-object node in `obj`, calling
 * `visit(node)` on each. Arrays are traversed; primitives ignored.
 * Bounded against cyclic structures (InnerTube payloads are acyclic
 * JSON, but be safe) via a visited set.
 */
function walk(obj, visit, seen = new Set()) {
  if (!obj || typeof obj !== 'object') return;
  if (seen.has(obj)) return;
  seen.add(obj);
  if (Array.isArray(obj)) {
    for (const item of obj) walk(item, visit, seen);
    return;
  }
  try { visit(obj); } catch (_) { /* one bad node never breaks the walk */ }
  for (const key of Object.keys(obj)) {
    walk(obj[key], visit, seen);
  }
}

/**
 * Ingest a legacy commentThreadRenderer: the top comment plus any inline
 * replies, recording parent links so the tree assembler nests them.
 */
function ingestLegacyThread(thread, byId, parentOf) {
  const topCr = thread.comment && thread.comment.commentRenderer;
  const top = topCr ? fromCommentRenderer(topCr) : null;
  if (top && !byId.has(top.id)) byId.set(top.id, top);

  const replyContents = thread.replies
    && thread.replies.commentRepliesRenderer
    && thread.replies.commentRepliesRenderer.contents;
  if (top && Array.isArray(replyContents)) {
    for (const rc of replyContents) {
      const cr = rc && rc.commentRenderer;
      if (!cr) continue;
      const reply = fromCommentRenderer(cr);
      if (!reply) continue;
      if (!byId.has(reply.id)) byId.set(reply.id, reply);
      parentOf.set(reply.id, top.id);
    }
  }
}

/**
 * Extract a normalized comment node from a LEGACY commentRenderer.
 * Returns null if it has no usable id.
 */
function fromCommentRenderer(cr) {
  if (!cr || typeof cr !== 'object') return null;
  const id = cr.commentId;
  if (!id) return null;

  const body = runsToText(cr.contentText);
  const authorName = simpleOrRuns(cr.authorText);
  const channelId = cr.authorEndpoint
    && cr.authorEndpoint.browseEndpoint
    && cr.authorEndpoint.browseEndpoint.browseId || null;
  const authorUrlPath = cr.authorEndpoint
    && cr.authorEndpoint.commandMetadata
    && cr.authorEndpoint.commandMetadata.webCommandMetadata
    && cr.authorEndpoint.commandMetadata.webCommandMetadata.url || '';
  const avatarUrl = pickThumbnail(cr.authorThumbnail);
  const dateText = simpleOrRuns(cr.publishedTimeText);
  const likeCount = parseAbbrevCount(simpleOrRuns(cr.voteCount));
  const verified = hasVerifiedBadge(cr);

  return makeNode({
    id, body, authorName, channelId, authorUrlPath, avatarUrl,
    dateText, likeCount, verified
  });
}

/**
 * Extract a normalized comment node from a MODERN commentEntityPayload.
 */
function fromEntityPayload(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const props = payload.properties || {};
  const author = payload.author || {};
  const toolbar = payload.toolbar || {};
  const id = props.commentId;
  if (!id) return null;

  const body = (props.content && props.content.content) || '';
  const channelId = author.channelId || null;
  const authorName = author.displayName || '';
  const avatarUrl = author.avatarThumbnailUrl || '';
  const dateText = props.publishedTime || '';
  // toolbar carries the like count as display text under a couple of
  // keys depending on the viewer's like state.
  const likeCount = parseAbbrevCount(
    toolbar.likeCountNotliked || toolbar.likeCountLiked || toolbar.likeCountA11y || ''
  );
  const verified = author.isVerified === true || author.isVerifiedArtist === true;

  return makeNode({
    id, body, authorName, channelId, avatarUrl,
    authorUrlPath: channelId ? '/channel/' + channelId : '',
    dateText, likeCount, verified
  });
}

/**
 * Assemble a normalized comment node in the shape the reader's comment
 * tree + the Phase II identity loop expect (mirrors the Substack
 * shapeComment output). `author.channelId` is the stable id the
 * identity layer keys on.
 */
function makeNode({ id, body, authorName, channelId, authorUrlPath, avatarUrl, dateText, likeCount, verified }) {
  // YouTube author display names are the @handle (post-2023). Keep both
  // a `handle` (without the leading @) and the raw `name`.
  const rawName = String(authorName || '').trim();
  const handle = rawName.startsWith('@') ? rawName.slice(1) : '';
  const profileUrl = authorUrlPath
    ? (authorUrlPath.startsWith('http') ? authorUrlPath : 'https://www.youtube.com' + authorUrlPath)
    : (channelId ? 'https://www.youtube.com/channel/' + channelId : '');

  return {
    id: String(id),
    parentId: null,
    body: String(body || ''),
    date: null,                       // YouTube only exposes relative time
    dateText: String(dateText || ''), // "2 years ago" — display only
    deleted: false,
    author: {
      name: rawName,
      handle,
      profileUrl,
      avatarUrl: String(avatarUrl || ''),
      channelId: channelId || null,   // ← stable identity key
      verified: verified === true
    },
    reactionCount: Number.isFinite(likeCount) ? likeCount : 0,
    restacks: 0,
    children: []
  };
}

// ── small field helpers ───────────────────────────────────────────────

function runsToText(obj) {
  if (!obj || typeof obj !== 'object') return '';
  if (Array.isArray(obj.runs)) return obj.runs.map((r) => (r && r.text) || '').join('');
  if (typeof obj.simpleText === 'string') return obj.simpleText;
  return '';
}

function simpleOrRuns(obj) {
  if (!obj || typeof obj !== 'object') return '';
  if (typeof obj.simpleText === 'string') return obj.simpleText;
  if (Array.isArray(obj.runs)) return obj.runs.map((r) => (r && r.text) || '').join('');
  return '';
}

function pickThumbnail(thumbObj) {
  const arr = thumbObj && Array.isArray(thumbObj.thumbnails) ? thumbObj.thumbnails : [];
  if (arr.length === 0) return '';
  // Largest last in YouTube's arrays.
  return arr[arr.length - 1].url || '';
}

function hasVerifiedBadge(cr) {
  // Legacy verified/artist badges live under authorCommentBadge or a
  // sponsorCommentBadge; presence of a verified-style badge is enough.
  const badge = cr.authorCommentBadge && cr.authorCommentBadge.authorCommentBadgeRenderer;
  if (!badge) return false;
  const icon = badge.icon && badge.icon.iconType;
  return icon === 'CHECK_CIRCLE_THICK' || icon === 'OFFICIAL_ARTIST_BADGE' || icon === 'VERIFIED';
}

/**
 * Parse a YouTube abbreviated count string ("1.2K", "3.4M", "1,234")
 * into an integer. Returns 0 for empty/unparseable. Approximate by
 * design — these feed a display hint + an optional event tag, not
 * anything load-bearing.
 */
export function parseAbbrevCount(s) {
  if (typeof s === 'number') return Math.max(0, Math.floor(s));
  if (typeof s !== 'string' || !s) return 0;
  const m = /([\d.,]+)\s*([KMB])?/i.exec(s.trim());
  if (!m) return 0;
  const num = parseFloat(m[1].replace(/,/g, ''));
  if (!Number.isFinite(num)) return 0;
  const mult = { k: 1e3, m: 1e6, b: 1e9 }[(m[2] || '').toLowerCase()] || 1;
  return Math.round(num * mult);
}
