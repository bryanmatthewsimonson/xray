// Substack API client — post metadata + comment tree.
//
// Runs in the background service worker (via xray:substack:fetchPost /
// xray:substack:fetchComments message types) so we bypass page CORS
// and connect-src policies. Every fetch uses credentials:'include' so
// the user's Substack session cookie accompanies the request — this is
// what unlocks full content for paywalled posts that the user is
// subscribed to, and gated comment threads on paid publications.
//
// Two endpoints on the public API:
//
//   GET <apiOrigin>/api/v1/posts/<slug>
//     → rich post metadata: id, title, subtitle, body_html,
//       publishedBylines, cover_image, audience, post_date,
//       publication_id, section_id, postTags, reaction_count,
//       comment_count, restacks, wordcount, audio_items, podcast_*,
//       video_upload_id, etc.
//
//   GET <apiOrigin>/api/v1/post/<postId>/comments?all_comments=true&sort=oldest_first
//     → nested comment tree with stable author handles.
//
// Both endpoints work uniformly on subdomain (*.substack.com) and
// custom-domain publications (e.g. thefp.com).
//
// Comment response example (abbreviated):
//
//   { "comments": [
//       { "id": 124149072,
//         "body": "…",
//         "body_json": { … tiptap doc … },
//         "publication_id": 888615,
//         "post_id": 165417845,
//         "user_id": 12345,
//         "ancestor_path": "",        -- "/" separated ids; "" = top-level
//         "type": "comment",
//         "deleted": false,
//         "date": "2025-06-08T16:09:08.428Z",
//         "edited_at": null,
//         "status": "ok",              -- "ok" | "flagged" | …
//         "pinned_by_user_id": null,
//         "restacks": 0,
//         "name": "Jane Smith",
//         "photo_url": "https://…",
//         "handle": "janesmith",
//         "reactor_names": [],
//         "reaction": null,
//         "reactions": { "❤": 12 },
//         "reaction_count": 12,
//         "children": [ … same shape … ]
//       },
//       …
//   ] }
//
// Quirks worth handling:
//   - deleted/flagged comments may have body=null, body_json=null and
//     name=null; we keep them in the tree (for thread structure) but
//     mark as deleted so the UI can skip them on publish.
//   - `handle` is the stable public identifier; `name` is display-only
//     and mutable. Treat handle as canonical.
//   - `children` already threads for us; no need to reconstruct from
//     ancestor_path unless we want flat listings.

// ------------------------------------------------------------------
// Post metadata fetcher
// ------------------------------------------------------------------

/**
 * Fetch full post metadata + body for a Substack slug. For paywalled
 * posts, the full body is returned only when the user is an authorized
 * subscriber (we send cookies via credentials:'include'); otherwise we
 * get an anonymized teaser — still enough for the structured metadata.
 *
 * The returned object is projected to X-Ray's canonical shape via
 * shapeSubstackPost(). Callers should merge these fields onto the
 * existing (Readability-extracted) article.
 *
 * @param {string} apiOrigin  e.g. "https://www.thefp.com"
 * @param {string} slug       the URL slug (no leading "/p/")
 * @returns {Promise<object>} shaped post
 */
export async function fetchSubstackPost(apiOrigin, slug) {
    if (!apiOrigin) throw new Error('Missing apiOrigin');
    if (!slug) throw new Error('Missing slug');

    const url = `${apiOrigin.replace(/\/$/, '')}/api/v1/posts/${encodeURIComponent(slug)}`;
    const res = await fetch(url, {
        method: 'GET',
        credentials: 'include',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) throw new Error(`Substack post API ${res.status} ${res.statusText}`);
    const raw = await res.json();
    if (!raw || typeof raw !== 'object' || typeof raw.id !== 'number') {
        throw new Error('Unexpected post payload shape');
    }
    return shapeSubstackPost(raw);
}

/**
 * Project Substack's /api/v1/posts/<slug> response to a clean shape.
 * Preserve every field that has archival value for faithful capture;
 * drop renderer-internal stuff (themeVariables, postTheme, etc.).
 */
function shapeSubstackPost(raw) {
    const firstByline = Array.isArray(raw.publishedBylines) && raw.publishedBylines.length
        ? raw.publishedBylines[0]
        : null;
    return {
        // Identity
        id:            raw.id,
        slug:          raw.slug,
        canonicalUrl:  raw.canonical_url,
        type:          raw.type,                 // 'newsletter' | 'podcast' | 'thread' | 'video'
        audience:      raw.audience,             // 'everyone' | 'only_paid' | 'founding' | …
        publicationId: raw.publication_id,
        sectionId:     raw.section_id,

        // Content
        title:          typeof raw.title === 'string' ? raw.title : null,
        subtitle:       typeof raw.subtitle === 'string' ? raw.subtitle : null,
        description:    typeof raw.description === 'string' ? raw.description : null,
        bodyHtml:       typeof raw.body_html === 'string' ? raw.body_html : null,
        truncatedBodyText: typeof raw.truncated_body_text === 'string' ? raw.truncated_body_text : null,
        wordcount:      Number.isFinite(raw.wordcount) ? raw.wordcount : null,
        coverImage:     typeof raw.cover_image === 'string' ? raw.cover_image : null,
        socialTitle:    typeof raw.social_title === 'string' ? raw.social_title : null,

        // Byline (first byline only — Substack supports multi-author but
        // the primary render uses the first one)
        byline: firstByline ? {
            name:      typeof firstByline.name === 'string' ? firstByline.name : null,
            handle:    typeof firstByline.handle === 'string' ? firstByline.handle : null,
            photoUrl:  typeof firstByline.photo_url === 'string' ? firstByline.photo_url : null,
            bio:       typeof firstByline.bio === 'string' ? firstByline.bio : null,
            profileSetUpAt: firstByline.profile_set_up_at || null
        } : null,
        // Full multi-author list for archival
        allBylines: Array.isArray(raw.publishedBylines) ? raw.publishedBylines.map(b => ({
            name: b.name, handle: b.handle, photoUrl: b.photo_url, bio: b.bio
        })) : [],

        // Engagement (authoritative — better than DOM scraping)
        reactionCount: Number.isFinite(raw.reaction_count) ? raw.reaction_count : 0,
        reactions:     raw.reactions && typeof raw.reactions === 'object' ? raw.reactions : {},
        commentCount:  Number.isFinite(raw.comment_count) ? raw.comment_count : 0,
        childCommentCount: Number.isFinite(raw.child_comment_count) ? raw.child_comment_count : 0,
        restacks:      Number.isFinite(raw.restacks) ? raw.restacks : 0,

        // Timestamps
        postDate:      typeof raw.post_date === 'string' ? raw.post_date : null,
        updatedAt:     typeof raw.updated_at === 'string' ? raw.updated_at : null,

        // Media
        hasVoiceover:  raw.has_voiceover === true,
        audioItems:    Array.isArray(raw.audio_items) ? raw.audio_items : [],
        podcast: raw.podcast_url || raw.podcast_duration ? {
            url:      raw.podcast_url || null,
            duration: raw.podcast_duration || null,
            artUrl:   raw.podcast_art_url || null
        } : null,
        videoUploadId: raw.video_upload_id || null,

        // Tags + taxonomy
        postTags: Array.isArray(raw.postTags) ? raw.postTags.map(t => ({
            id:   t.id,
            name: t.name,
            slug: t.slug
        })) : [],

        // Paywall state
        unlockedWithIP: raw.unlockedWithIP === true,
        freeUnlockRequired: raw.free_unlock_required === true,
        meterType:    raw.meter_type || null,
        currentUserPostMeter: raw.current_user_post_meter || null,

        // Raw payload kept for archival ("capture everything faithfully")
        _raw: raw
    };
}

// ------------------------------------------------------------------
// Comment fetcher
// ------------------------------------------------------------------

/**
 * Fetch the full comment tree for a Substack post. With
 * credentials:'include', logged-in paid subscribers see the full
 * thread; anonymous callers see whatever's publicly visible (often
 * nothing on paid publications).
 *
 * @param {string} apiOrigin
 * @param {number|string} postId
 * @returns {Promise<{ comments: object[], total: number, deletedCount: number }>}
 */
export async function fetchSubstackComments(apiOrigin, postId) {
    if (!apiOrigin) throw new Error('Missing apiOrigin');
    if (!postId) throw new Error('Missing postId');

    const url = `${apiOrigin.replace(/\/$/, '')}/api/v1/post/${encodeURIComponent(postId)}/comments?all_comments=true&sort=oldest_first`;

    const res = await fetch(url, {
        method: 'GET',
        credentials: 'include',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) {
        throw new Error(`Substack API ${res.status} ${res.statusText}`);
    }
    const payload = await res.json();
    if (!payload || !Array.isArray(payload.comments)) {
        throw new Error('Unexpected comment payload shape');
    }

    const shaped = payload.comments.map(shapeComment).filter(Boolean);
    const total = countTree(shaped);
    const deletedCount = countTree(shaped, (c) => c.deleted);

    // One-line debug breadcrumb so the next shape-shift is easy to spot
    // when a fresh capture comes back with mostly-deleted bodies.
    // eslint-disable-next-line no-console
    console.log('[X-Ray Substack] comments:', {
        total, deletedCount,
        sample: payload.comments[0] ? {
            hasBody: typeof payload.comments[0].body === 'string',
            hasBodyJson: !!payload.comments[0].body_json,
            status: payload.comments[0].status,
            deleted: payload.comments[0].deleted
        } : null
    });

    return { comments: shaped, total, deletedCount };
}

// ------------------------------------------------------------------
// Normalization
// ------------------------------------------------------------------

/**
 * Project a raw comment node to X-Ray's canonical shape. Keeps the
 * children array structural (recursively shaped) so UI + publish can
 * walk the tree the same way the user sees it on Substack.
 *
 * Output:
 *   id             number  — Substack's native comment id
 *   parentId       number|null  — from ancestor_path last segment; null at top level
 *   body           string  — plaintext; empty string for deleted
 *   date           string  — ISO 8601
 *   editedAt       string|null
 *   deleted        boolean — "deleted" or "status !== ok" or body null
 *   author: {
 *     handle       string|null  — stable public identifier
 *     name         string|null  — display name
 *     profileUrl   string|null  — <handle>.substack.com if handle present
 *     avatarUrl    string|null
 *     userId       number|null
 *   }
 *   reactionCount  number
 *   reactions      { [emoji]: count }  — e.g. { "❤": 12 }
 *   restacks       number
 *   children       array of shaped comments (recursive)
 */
function shapeComment(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const ancestors = typeof raw.ancestor_path === 'string' ? raw.ancestor_path : '';
    const ancestorIds = ancestors.split('/').filter(Boolean).map((s) => parseInt(s, 10)).filter(Number.isFinite);
    const parentId = ancestorIds.length ? ancestorIds[ancestorIds.length - 1] : null;

    // Body resolution: Substack has been migrating toward body_json
    // (a Tiptap doc) and often leaves `body` null. Try body first
    // (cheap, plaintext), then extract text from body_json if needed.
    let body = typeof raw.body === 'string' ? raw.body : '';
    const bodyJson = (raw.body_json && typeof raw.body_json === 'object') ? raw.body_json : null;
    if (!body && bodyJson) {
        body = extractTextFromTiptap(bodyJson);
    }

    // A comment is "deleted" when it's genuinely gone (explicit flag,
    // or no body AND no body_json at all). A non-'ok' status alone is
    // not sufficient — Substack uses 'flagged' for community-reported
    // comments whose bodies are still visible to the reporter and to
    // paid subscribers.
    const deleted = raw.deleted === true ||
                    raw.status === 'deleted' ||
                    (!body && !bodyJson);

    const author = {
        handle: typeof raw.handle === 'string' ? raw.handle : null,
        name: typeof raw.name === 'string' ? raw.name : null,
        profileUrl: raw.handle ? `https://${raw.handle}.substack.com` : null,
        avatarUrl: typeof raw.photo_url === 'string' ? raw.photo_url : null,
        userId: typeof raw.user_id === 'number' ? raw.user_id : null
    };

    const children = Array.isArray(raw.children)
        ? raw.children.map(shapeComment).filter(Boolean)
        : [];

    return {
        id: raw.id,
        parentId,
        body,
        bodyJson,        // preserved for richer future rendering
        bodyHtml: null,  // reserved — future commit may walk bodyJson → HTML
        date: typeof raw.date === 'string' ? raw.date : null,
        editedAt: typeof raw.edited_at === 'string' ? raw.edited_at : null,
        status: typeof raw.status === 'string' ? raw.status : null,
        deleted,
        author,
        reactionCount: Number.isFinite(raw.reaction_count) ? raw.reaction_count : 0,
        reactions: raw.reactions && typeof raw.reactions === 'object' ? raw.reactions : {},
        restacks: Number.isFinite(raw.restacks) ? raw.restacks : 0,
        children
    };
}

/**
 * Walk a Tiptap document and join its text leaves into a single plain
 * string. Used as a fallback when Substack omits the plain `body`
 * field and only ships `body_json`.
 *
 * Tiptap docs are nested `{ type, content: [...] }` trees. Text nodes
 * carry `{ type: 'text', text: '...' }`. Block-level nodes (paragraph,
 * heading, blockquote, bulletList, etc.) get a trailing newline so the
 * output isn't one run-on line.
 */
function extractTextFromTiptap(doc) {
    if (!doc || typeof doc !== 'object') return '';
    const BLOCK_TYPES = new Set([
        'paragraph', 'heading', 'blockquote',
        'bulletList', 'orderedList', 'listItem',
        'codeBlock', 'horizontalRule'
    ]);
    let out = '';
    const walk = (node) => {
        if (!node || typeof node !== 'object') return;
        if (node.type === 'text' && typeof node.text === 'string') {
            out += node.text;
            return;
        }
        if (node.type === 'hardBreak') { out += '\n'; return; }
        if (Array.isArray(node.content)) {
            for (const child of node.content) walk(child);
        }
        if (BLOCK_TYPES.has(node.type) && out.length && !out.endsWith('\n\n')) {
            out += out.endsWith('\n') ? '\n' : '\n\n';
        }
    };
    walk(doc);
    return out.trim();
}

/**
 * Walk a shaped comment tree, counting nodes (optionally filtered).
 */
export function countTree(tree, predicate) {
    let n = 0;
    const walk = (list) => {
        for (const c of list) {
            if (!predicate || predicate(c)) n++;
            if (c.children && c.children.length) walk(c.children);
        }
    };
    walk(tree);
    return n;
}

/**
 * Flatten a shaped tree into a list in traversal order. Useful for
 * publish iteration where we want to publish parents first so
 * `reply-to` references resolve.
 */
export function flattenTree(tree) {
    const out = [];
    const walk = (list, depth) => {
        for (const c of list) {
            out.push({ ...c, _depth: depth });
            if (c.children && c.children.length) walk(c.children, depth + 1);
        }
    };
    walk(tree, 0);
    return out;
}
