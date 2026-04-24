// API-interceptor pattern matcher — extracted as a shared module so
// it can be unit-tested without spinning up a JSDOM. The MAIN-world
// api-interceptor (`src/page/api-interceptor.js`) re-implements the
// same logic inline (it can't import — it's bundled as an IIFE
// injected via chrome.scripting.executeScript). Keeping the
// canonical implementation here means the unit test pins one
// version of the rules; if behavior diverges between the two, the
// test for *this* one catches it as a regression even when the
// inline copy is the actual code that ran in the page.
//
// Pattern shape:
//   { urlIncludes?: string, headerIncludes?: string[] }
//
// Match semantics (AND across fields, OR across patterns):
//   - urlIncludes (if present): the request URL must contain it.
//     Case-sensitive — Facebook/Instagram URLs are mixed case but
//     the literal API paths we care about are stable lowercase.
//   - headerIncludes (if present + non-empty): at least one header
//     value (any header name) must contain at least one of the
//     listed needles. Headers are entries() of any iterable shape.

/**
 * @param {string} url
 * @param {Iterable<[string, string]> | object | null} headers
 * @param {Array<{urlIncludes?: string, headerIncludes?: string[]}>} patterns
 * @returns {boolean}
 */
export function matchesAnyPattern(url, headers, patterns) {
    if (!Array.isArray(patterns) || patterns.length === 0) return false;
    const headerEntries = headerEntriesOf(headers);
    for (const p of patterns) {
        if (typeof p.urlIncludes === 'string' && p.urlIncludes &&
            !url.includes(p.urlIncludes)) continue;
        if (Array.isArray(p.headerIncludes) && p.headerIncludes.length > 0) {
            const ok = p.headerIncludes.some((needle) =>
                headerEntries.some(([_n, v]) => typeof v === 'string' && v.includes(needle))
            );
            if (!ok) continue;
        }
        return true;
    }
    return false;
}

function headerEntriesOf(headers) {
    if (!headers) return [];
    // Array check first — Array also has `.entries()` but it returns
    // [index, value] tuples, not [name, value]. The array-of-tuples
    // branch is the one we want for `[['x-name', 'value']]` input.
    if (Array.isArray(headers)) return headers;
    if (typeof headers.entries === 'function') return [...headers.entries()];
    if (typeof headers === 'object') return Object.entries(headers);
    return [];
}
