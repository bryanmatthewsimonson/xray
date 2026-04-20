// Substack comments — API-backed fetcher + normalizer.
//
// Runs in the background service worker (via the xray:substack:fetchComments
// message type) so we bypass page CORS and the API call isn't subject to
// the article tab's connect-src policy.
//
// Substack's own client fetches from:
//   GET <apiOrigin>/api/v1/post/<postId>/comments?all_comments=true&sort=oldest_first
//
// For public posts this endpoint is unauthenticated and returns the full
// tree as nested JSON. Example response shape (abbreviated):
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
// Fetcher (SW-side)
// ------------------------------------------------------------------

/**
 * Fetch all comments for a Substack post. Returns the *normalized* tree
 * — see shapeComment() for the output shape. Errors surface as thrown
 * exceptions; callers should wrap.
 *
 * @param {string} apiOrigin  e.g. "https://garymarcus.substack.com"
 * @param {number|string} postId
 * @returns {Promise<{ comments: object[], total: number, deletedCount: number }>}
 */
export async function fetchSubstackComments(apiOrigin, postId) {
    if (!apiOrigin) throw new Error('Missing apiOrigin');
    if (!postId) throw new Error('Missing postId');

    const url = `${apiOrigin.replace(/\/$/, '')}/api/v1/post/${encodeURIComponent(postId)}/comments?all_comments=true&sort=oldest_first`;

    const res = await fetch(url, {
        method: 'GET',
        credentials: 'omit',
        // Use a plain browser-ish user-agent header? Left default — the SW's
        // fetch has no Origin, and Substack's public comment endpoint
        // doesn't gate by User-Agent in our testing.
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

    const body = typeof raw.body === 'string' ? raw.body : '';
    const deleted = raw.deleted === true || !body || (raw.status && raw.status !== 'ok');

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
        date: typeof raw.date === 'string' ? raw.date : null,
        editedAt: typeof raw.edited_at === 'string' ? raw.edited_at : null,
        deleted,
        author,
        reactionCount: Number.isFinite(raw.reaction_count) ? raw.reaction_count : 0,
        reactions: raw.reactions && typeof raw.reactions === 'object' ? raw.reactions : {},
        restacks: Number.isFinite(raw.restacks) ? raw.restacks : 0,
        children
    };
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
