// Anchor capture — Phase 9a Day 2.
//
// Spec: XRAY_METADATA_SPEC.md §6.3 + §7 + Implementation Plan §6.
//
// Builds a W3C-Web-Annotation-style selector array from a user's text
// selection. The output is what gets serialized into the kind 30050
// event's content body so a future reader can locate the same span on
// a page that may have been edited since the annotation was made.
//
// Two entry points:
//
//   - `buildSelectors(parts)` — PURE. Takes already-extracted strings
//     and DOM-coordinate primitives; returns the selector array. This
//     is what the test suite exercises.
//
//   - `captureFromSelection(selection, root)` — DOM-bound. Pulls the
//     primitives out of a live `Selection` object and delegates to
//     `buildSelectors`. Only meaningful in a content-script context.
//
// The selector array is ordered by robustness preference per the spec:
//   1. TextQuoteSelector — exact + prefix + suffix
//   2. RangeSelector     — XPath start/end + offsets
//   3. CssSelector       — only if start container has a stable id

const PREFIX_SUFFIX_CHARS = 32;
const EXACT_LENGTH_CAP = 500;
const EXACT_TRUNCATE_HEAD = 200;
const EXACT_TRUNCATE_TAIL = 200;
const ELLIPSIS_MARKER = '…'; // …

/**
 * Build a selector array from already-extracted primitives. Pure;
 * does not touch the DOM.
 *
 * @param {object} parts
 * @param {string} parts.exact         — selected text
 * @param {string} [parts.prefix]      — text immediately preceding
 * @param {string} [parts.suffix]      — text immediately following
 * @param {string} [parts.startContainerXPath]
 * @param {number} [parts.startOffset]
 * @param {string} [parts.endContainerXPath]
 * @param {number} [parts.endOffset]
 * @param {string} [parts.startContainerId]      — stable id if present
 * @param {string} [parts.startContainerCssPath] — fallback CSS path
 * @param {string} [parts.lang]                  — page language
 * @returns {{selectors: Array<object>, fullExact: string}}
 *   The selector array suitable for inclusion under
 *   `target.selector[]` in the JSON-LD body. `fullExact` is the
 *   un-truncated exact text — callers MAY include it in the body's
 *   `body.value` field if the selection was truncated for the
 *   selector.
 */
export function buildSelectors(parts = {}) {
  const exactRaw = String(parts.exact || '');
  if (!exactRaw) return { selectors: [], fullExact: '' };

  const truncated = truncateExact(exactRaw);

  const selectors = [];

  // 1) TextQuoteSelector — primary, robust to DOM changes.
  const tqs = {
    type: 'TextQuoteSelector',
    exact: truncated.exact
  };
  const prefix = sliceTail(parts.prefix, PREFIX_SUFFIX_CHARS);
  const suffix = sliceHead(parts.suffix, PREFIX_SUFFIX_CHARS);
  if (prefix) tqs.prefix = prefix;
  if (suffix) tqs.suffix = suffix;
  selectors.push(tqs);

  // 2) RangeSelector — secondary, used when TextQuoteSelector finds
  //    multiple matches or none.
  if (
    typeof parts.startContainerXPath === 'string' &&
    typeof parts.endContainerXPath === 'string' &&
    Number.isFinite(parts.startOffset) &&
    Number.isFinite(parts.endOffset)
  ) {
    selectors.push({
      type: 'RangeSelector',
      startContainer: parts.startContainerXPath,
      startOffset: parts.startOffset,
      endContainer: parts.endContainerXPath,
      endOffset: parts.endOffset
    });
  }

  // 3) CssSelector — fallback, only emitted when the container has a
  //    *stable* id. Generated React class names look stable but flip
  //    on every release; the spec says skip those. The caller is
  //    responsible for the stability check.
  if (typeof parts.startContainerId === 'string' && parts.startContainerId) {
    selectors.push({
      type: 'CssSelector',
      value: '#' + cssEscape(parts.startContainerId)
    });
  } else if (typeof parts.startContainerCssPath === 'string' && parts.startContainerCssPath) {
    selectors.push({
      type: 'CssSelector',
      value: parts.startContainerCssPath
    });
  }

  return { selectors, fullExact: exactRaw };
}

/**
 * Apply the spec's length cap on `exact`. If the selection is longer
 * than 500 chars, keep the first 200 and last 200 with an ellipsis
 * marker between them. The caller SHOULD also embed the full text in
 * the annotation body so consumers that fail to anchor can still show
 * what was selected.
 *
 * Visible-for-testing — exported indirectly via `buildSelectors`.
 */
function truncateExact(exact) {
  if (exact.length <= EXACT_LENGTH_CAP) return { exact, truncated: false };
  const head = exact.slice(0, EXACT_TRUNCATE_HEAD);
  const tail = exact.slice(-EXACT_TRUNCATE_TAIL);
  return {
    exact: head + ' ' + ELLIPSIS_MARKER + ' ' + tail,
    truncated: true
  };
}

function sliceHead(s, n) {
  if (typeof s !== 'string') return '';
  return s.length > n ? s.slice(0, n) : s;
}

function sliceTail(s, n) {
  if (typeof s !== 'string') return '';
  return s.length > n ? s.slice(-n) : s;
}

/**
 * Minimal CSS.escape polyfill (the function exists in browsers as
 * `CSS.escape`, but we want to avoid depending on it for testability).
 * Escapes the small set of chars that can break a `#id` selector.
 */
function cssEscape(str) {
  return String(str).replace(/[^a-zA-Z0-9_-]/g, (c) =>
    '\\' + c.charCodeAt(0).toString(16).padStart(2, '0') + ' '
  );
}

// ------------------------------------------------------------------
// DOM-bound helpers (content-script only)
// ------------------------------------------------------------------

/**
 * Pull selector primitives out of a live `Selection` object and
 * delegate to `buildSelectors`. Returns null if the selection is
 * empty or collapsed.
 *
 * The `root` argument is the DOM root we treat as the article body.
 * XPaths are computed relative to the document, but the prefix/suffix
 * are read from the rendered text inside `root` so prefix/suffix do
 * not leak text from the page chrome (header, footer, sidebar).
 *
 * @param {Selection} selection
 * @param {Element} [root=document.body]
 * @returns {ReturnType<typeof buildSelectors> | null}
 */
export function captureFromSelection(selection, root) {
  if (!selection || typeof selection.rangeCount !== 'number' || selection.rangeCount === 0) {
    return null;
  }
  const range = selection.getRangeAt(0);
  if (!range || range.collapsed) return null;

  const exact = String(selection.toString() || '');
  if (!exact) return null;

  const rootEl = root || (typeof document !== 'undefined' ? document.body : null);
  if (!rootEl) {
    // No DOM — return TextQuoteSelector only, with no prefix/suffix.
    return buildSelectors({ exact });
  }

  // Prefix/suffix from the rendered text of `root`. We read up to
  // PREFIX_SUFFIX_CHARS on each side. `Range`-based extraction is more
  // accurate than walking textContent but harder to test; this naive
  // textContent approach works for the typical article case.
  const fullText = rootEl.textContent || '';
  const exactIdx = fullText.indexOf(exact);
  let prefix = '';
  let suffix = '';
  if (exactIdx >= 0) {
    prefix = fullText.slice(Math.max(0, exactIdx - PREFIX_SUFFIX_CHARS), exactIdx);
    suffix = fullText.slice(exactIdx + exact.length, exactIdx + exact.length + PREFIX_SUFFIX_CHARS);
  }

  // RangeSelector — XPath of start/end containers.
  const startContainerXPath = xpathFor(range.startContainer, rootEl);
  const endContainerXPath = xpathFor(range.endContainer, rootEl);

  // CssSelector — only if start container's parent (or itself) has
  // a stable id. We treat React-style generated ids (e.g. `:r0:`,
  // `_h:42`) as unstable.
  const startContainerEl = range.startContainer.nodeType === 1
    ? range.startContainer
    : range.startContainer.parentElement;
  const stableId = startContainerEl && isStableId(startContainerEl.id || '')
    ? startContainerEl.id
    : null;

  return buildSelectors({
    exact,
    prefix,
    suffix,
    startContainerXPath,
    startOffset: range.startOffset,
    endContainerXPath,
    endOffset: range.endOffset,
    startContainerId: stableId
  });
}

/**
 * Compute a positional XPath from `root` to `node`. Position-only,
 * tag-aware. Does not use class names or text content (those break on
 * publisher edits). Returns `''` if node is not under root.
 */
export function xpathFor(node, root) {
  if (!node || !root) return '';
  // Resolve to the parent element if node is a text/comment node.
  let parts = [];
  let cur = node;
  // For text nodes we want `text()[N]`; for elements we want `tag[N]`.
  while (cur && cur !== root) {
    const parent = cur.parentNode || cur.parentElement;
    if (!parent) return '';
    const idx = childIndex(parent, cur);
    if (cur.nodeType === 3) {
      parts.unshift(`text()[${idx}]`);
    } else if (cur.nodeType === 1) {
      const tag = (cur.tagName || '').toLowerCase();
      parts.unshift(`${tag}[${idx}]`);
    } else {
      // Comment / other — index by node().
      parts.unshift(`node()[${idx}]`);
    }
    cur = parent;
  }
  if (cur !== root) return ''; // node was not under root
  return '/' + parts.join('/');
}

/**
 * 1-based index of `child` among its sibling nodes of the same type.
 * Mirrors XPath semantics — text()[2] means the second text node
 * sibling, not the second node overall.
 */
function childIndex(parent, child) {
  if (!parent || !parent.childNodes) return 1;
  let n = 0;
  for (const sibling of parent.childNodes) {
    if (sibling.nodeType === child.nodeType) {
      if (child.nodeType === 1 && sibling.tagName !== child.tagName) continue;
      n += 1;
      if (sibling === child) return n;
    }
  }
  return n || 1;
}

/**
 * Heuristic: a "stable" id is one that doesn't look auto-generated by
 * a framework. Stable: kebab-case slugs, snake_case, namespaces with
 * dots. Unstable: emotion / styled-components / React fiber ids
 * (`:r0:`, `_h:42`, `css-1abc23`, leading-digit), GUID-ish,
 * hyperlong base64.
 */
export function isStableId(id) {
  if (!id || typeof id !== 'string') return false;
  if (id.length > 64) return false;
  if (/^:r\w*:$/.test(id)) return false;            // React 18 useId
  if (/^_h:/.test(id)) return false;                // emotion / styled
  if (/^css-[a-z0-9]+$/i.test(id)) return false;    // emotion classnames-as-ids
  if (/^[A-Fa-f0-9-]{16,}$/.test(id)) return false; // long hex / GUID
  if (/^\d/.test(id)) return false;                 // leading digit
  // Anything else: kebab/snake/dot/camelCase — probably stable.
  return /^[A-Za-z][\w.\-:]*$/.test(id);
}
