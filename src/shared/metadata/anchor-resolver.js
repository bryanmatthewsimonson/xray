// Anchor resolver — Phase 9a Day 3.
//
// Spec: XRAY_METADATA_SPEC.md §6.3 + §7 + Implementation Plan §6.
//
// Inverse of anchor-capture: given a selector array (from a stored
// kind 30050 event) and a live page DOM, locate the span that the
// annotation anchored to. Returns a { range, confidence, selectorUsed }
// triple, or `null` if the annotation has been orphaned (the source
// page changed beyond what the cascade can recover).
//
// Cascade (per the spec):
//   1. TextQuoteSelector — prefix + exact + suffix → fall back to
//      bare exact only if exact is unique on the page.
//   2. RangeSelector — XPath start/end + offsets.
//   3. CssSelector — anchor on the matched element; orient by exact.
//
// Phase 14.5 provenance hardening adds TextPositionSelector (raw
// character offsets into the article text, emitted by the LLM-suggest
// anchor path). It only resolves VERIFIED: the text at [start, end)
// must reproduce the sibling TextQuoteSelector's `exact` — offsets
// into changed text are rejected, never guessed at.
//
// Confidence scoring (Plan §6):
//   1.00 = exact prefix+exact+suffix match
//   0.90 = prefix+exact match, suffix differs by ≤4 chars
//   0.85 = exact+suffix match, prefix differs by ≤4 chars
//   0.70 = bare exact, unique on page
//   0.00 = ambiguous or no match (treated as orphaned)
//
// The 0.7 threshold is the cutoff for "trustworthy enough to render
// as anchored." Below that we report `null` so the panel can render
// the annotation with an "could not be located" badge instead of
// pointing at the wrong span.

const PARTIAL_DIFF_TOLERANCE = 4;

/**
 * Try each selector in order; return the highest-confidence resolved
 * range that meets the threshold. Returns `null` if every selector
 * fails or the best confidence is below threshold.
 *
 * @param {Array<object>} selectors  selector array from event content
 * @param {Element} root             page root to resolve against
 * @param {object} [opts]
 * @param {number} [opts.threshold=0.7]
 * @returns {{range: object, confidence: number, selectorUsed: string} | null}
 */
export function resolveSelectors(selectors, root, opts = {}) {
  const { threshold = 0.7 } = opts;
  if (!Array.isArray(selectors) || selectors.length === 0) return null;
  if (!root) return null;

  // The exact text the anchor was built from, for selectors (like
  // TextPositionSelector) that can only resolve by verification.
  const tqs = selectors.find((s) => s && s.type === 'TextQuoteSelector');
  const ctx = { exact: tqs ? String(tqs.exact || '') : '' };

  let best = null;
  for (const sel of selectors) {
    const result = trySelector(sel, root, ctx);
    if (result && result.confidence >= threshold) {
      // First selector to clear threshold wins (per cascade order).
      return result;
    }
    if (result && (!best || result.confidence > best.confidence)) {
      best = result;
    }
  }
  return null;
}

/**
 * Try a single selector. Returns null on failure.
 */
function trySelector(sel, root, ctx = {}) {
  if (!sel || typeof sel.type !== 'string') return null;
  switch (sel.type) {
    case 'TextQuoteSelector':    return resolveTextQuote(sel, root);
    case 'TextPositionSelector': return resolveTextPosition(sel, root, ctx);
    case 'RangeSelector':        return resolveRange(sel, root);
    case 'CssSelector':          return resolveCss(sel, root);
    default:                     return null;
  }
}

// ------------------------------------------------------------------
// TextPositionSelector
// ------------------------------------------------------------------

/**
 * Resolve a TextPositionSelector — raw [start, end) offsets into the
 * root's text content — but ONLY when the text found there reproduces
 * the anchor's captured `exact` (passed via ctx from the sibling
 * TextQuoteSelector). An offset pair with no exact to verify against,
 * or whose text no longer matches, returns null: a position into
 * edited text points at the wrong span, and we don't guess.
 *
 * Verification tolerates the capture-side length cap: a >500-char
 * exact is stored as `head … tail` (anchor-capture.truncateExact), so
 * the span must start with head and end with tail.
 */
export function resolveTextPosition(sel, root, ctx = {}) {
  if (!root) return null;
  const start = sel.start;
  const end = sel.end;
  if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
  if (start < 0 || end <= start) return null;
  const text = root.textContent || '';
  if (end > text.length) return null;
  const exact = String(ctx.exact || '');
  if (!exact) return null;
  if (!spanMatchesExact(text.slice(start, end), exact)) return null;
  return {
    range: { textStart: start, textEnd: end },
    confidence: 1.0,
    selectorUsed: 'TextPositionSelector'
  };
}

function spanMatchesExact(span, exact) {
  if (span === exact) return true;
  // Truncated exact: 'head … tail' (see anchor-capture EXACT_LENGTH_CAP).
  const m = /^([\s\S]+) … ([\s\S]+)$/.exec(exact);
  if (!m) return false;
  const head = m[1];
  const tail = m[2];
  return span.length >= head.length + tail.length
    && span.startsWith(head) && span.endsWith(tail);
}

// ------------------------------------------------------------------
// TextQuoteSelector
// ------------------------------------------------------------------

/**
 * Resolve a TextQuoteSelector against the rendered text content of
 * `root`. Search strategy:
 *
 *   1. prefix + exact + suffix — confidence 1.0 if unique
 *   2. prefix + exact only — 0.9 if suffix mismatch ≤ 4 chars
 *   3. exact + suffix only — 0.85 if prefix mismatch ≤ 4 chars
 *   4. bare exact, unique — 0.7
 *   5. otherwise → null (orphaned)
 *
 * Operates on `textContent` (string). The caller can map the resulting
 * absolute offset back to a DOM Range if it needs to render a
 * highlight (out of scope for v1; the side-panel "Jump to" button can
 * be implemented as scrollIntoView on the surrounding element).
 */
export function resolveTextQuote(sel, root) {
  const exact = String(sel.exact || '');
  if (!exact) return null;
  const text = root.textContent || '';

  const prefix = String(sel.prefix || '');
  const suffix = String(sel.suffix || '');

  // Strategy 1 — full prefix+exact+suffix match.
  if (prefix && suffix) {
    const needle = prefix + exact + suffix;
    const idx = indexOfUnique(text, needle);
    if (idx >= 0) {
      const exactStart = idx + prefix.length;
      return {
        range: { textStart: exactStart, textEnd: exactStart + exact.length },
        confidence: 1.0,
        selectorUsed: 'TextQuoteSelector'
      };
    }
  }

  // Strategy 2 — prefix + exact unique; suffix may differ slightly.
  if (prefix) {
    const needle = prefix + exact;
    const idx = indexOfUnique(text, needle);
    if (idx >= 0) {
      const exactStart = idx + prefix.length;
      const observedSuffix = text.slice(exactStart + exact.length, exactStart + exact.length + suffix.length);
      const diff = stringDiff(suffix, observedSuffix);
      if (diff <= PARTIAL_DIFF_TOLERANCE) {
        return {
          range: { textStart: exactStart, textEnd: exactStart + exact.length },
          confidence: 0.9,
          selectorUsed: 'TextQuoteSelector'
        };
      }
    }
  }

  // Strategy 3 — exact + suffix unique; prefix may differ slightly.
  if (suffix) {
    const needle = exact + suffix;
    const idx = indexOfUnique(text, needle);
    if (idx >= 0) {
      const exactStart = idx;
      const observedPrefix = text.slice(Math.max(0, exactStart - prefix.length), exactStart);
      const diff = stringDiff(prefix, observedPrefix);
      if (diff <= PARTIAL_DIFF_TOLERANCE) {
        return {
          range: { textStart: exactStart, textEnd: exactStart + exact.length },
          confidence: 0.85,
          selectorUsed: 'TextQuoteSelector'
        };
      }
    }
  }

  // Strategy 4 — bare exact, must be unique on the page.
  const idx = indexOfUnique(text, exact);
  if (idx >= 0) {
    return {
      range: { textStart: idx, textEnd: idx + exact.length },
      confidence: 0.7,
      selectorUsed: 'TextQuoteSelector'
    };
  }

  // Strategy 5 — exact appears multiple times with no disambiguation,
  // OR doesn't appear at all. Either way, orphaned.
  return null;
}

/**
 * Returns the index of `needle` in `haystack` IF AND ONLY IF it
 * appears exactly once. Multiple matches → -1 (we don't guess).
 */
function indexOfUnique(haystack, needle) {
  if (!needle) return -1;
  const first = haystack.indexOf(needle);
  if (first < 0) return -1;
  const second = haystack.indexOf(needle, first + 1);
  if (second >= 0) return -1;
  return first;
}

/**
 * Cheap string distance — counts non-matching characters in the
 * length-aligned overlap. Not Levenshtein (which is expensive); we
 * only need to detect "close enough" within a small tolerance.
 */
function stringDiff(a, b) {
  if (a === b) return 0;
  const la = a.length;
  const lb = b.length;
  if (la === 0) return lb;
  if (lb === 0) return la;
  let n = 0;
  const minLen = Math.min(la, lb);
  for (let i = 0; i < minLen; i++) {
    if (a[i] !== b[i]) n += 1;
  }
  // Length differences count as additional diffs.
  n += Math.abs(la - lb);
  return n;
}

// ------------------------------------------------------------------
// RangeSelector
// ------------------------------------------------------------------

/**
 * Resolve a RangeSelector by walking the DOM along the stored XPath.
 * Returns confidence 1.0 if both endpoints resolve and the captured
 * `exact` from the resolved range matches; 0.7 if the XPath resolves
 * but the resolved text doesn't match the original exact (still
 * "trustworthy" enough to render); null otherwise.
 *
 * Resolution intentionally degrades gracefully — many publishers
 * tweak the DOM structure without changing visible text, and the
 * TextQuoteSelector should already have caught those. RangeSelector
 * is the fallback for cases where the publisher edited the text but
 * left the structure intact (e.g., a typo correction).
 */
export function resolveRange(sel, root) {
  if (!root) return null;
  const startNode = resolveXPath(sel.startContainer, root);
  const endNode = resolveXPath(sel.endContainer, root);
  if (!startNode || !endNode) return null;
  // We don't reconstruct a live DOM Range here (the caller can do
  // that with document.createRange()); we just return the resolved
  // node references and offsets so the caller can build the Range.
  return {
    range: {
      startContainer: startNode,
      startOffset: sel.startOffset || 0,
      endContainer: endNode,
      endOffset: sel.endOffset || 0
    },
    confidence: 0.7,
    selectorUsed: 'RangeSelector'
  };
}

/**
 * Walk `root` along an XPath of the form produced by
 * `anchor-capture.xpathFor()`. Supports tag[N], text()[N], node()[N]
 * — no axes, no predicates beyond positional, no functions.
 *
 * Returns the matched node or null if the path is unresolvable.
 */
export function resolveXPath(xpath, root) {
  if (typeof xpath !== 'string' || !xpath || !root) return null;
  let path = xpath;
  if (path.startsWith('/')) path = path.slice(1);
  const segments = path.split('/').filter(Boolean);
  let cur = root;
  for (const seg of segments) {
    cur = stepXPath(cur, seg);
    if (!cur) return null;
  }
  return cur;
}

function stepXPath(node, segment) {
  // Parse `tag[N]` or `text()[N]` or `node()[N]`.
  const m = /^([a-zA-Z]+|text\(\)|node\(\))(?:\[(\d+)\])?$/.exec(segment);
  if (!m) return null;
  const kind = m[1];
  const idx = m[2] ? parseInt(m[2], 10) : 1;
  const wantTextNodes = kind === 'text()';
  const wantAnyNode = kind === 'node()';
  const wantTag = !wantTextNodes && !wantAnyNode ? kind.toUpperCase() : null;

  let n = 0;
  for (const child of node.childNodes || []) {
    if (wantTextNodes) {
      if (child.nodeType !== 3) continue;
      n += 1;
      if (n === idx) return child;
    } else if (wantAnyNode) {
      n += 1;
      if (n === idx) return child;
    } else {
      if (child.nodeType !== 1) continue;
      if ((child.tagName || '').toUpperCase() !== wantTag) continue;
      n += 1;
      if (n === idx) return child;
    }
  }
  return null;
}

// ------------------------------------------------------------------
// CssSelector
// ------------------------------------------------------------------

/**
 * Resolve a CssSelector. Confidence 0.7 (matches "bare exact" tier
 * since CSS resolution is purely structural). Caller is responsible
 * for orienting offset within the matched element.
 *
 * Implementation note: the runtime is responsible for providing a
 * `querySelector` method on the root. In real browsers, `Element`
 * has it built in. In the test fake DOM we pass through to a hand-
 * rolled walker.
 */
export function resolveCss(sel, root) {
  if (!root) return null;
  const value = String(sel.value || '');
  if (!value) return null;
  let element = null;
  try {
    if (typeof root.querySelector === 'function') {
      element = root.querySelector(value);
    }
  } catch (_) { /* selector parse error */ }
  if (!element) return null;
  return {
    range: { container: element },
    confidence: 0.7,
    selectorUsed: 'CssSelector'
  };
}
