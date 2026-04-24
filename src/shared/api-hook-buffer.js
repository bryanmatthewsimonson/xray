// API-hook event buffer — Phase 8c interceptor wiring.
//
// Sits in the content script's ISOLATED world. Listens for the
// MAIN-world api-interceptor's `xr:apihook:event` postMessages and
// holds them in a small ring buffer keyed by URL pattern. Platform
// handlers query this buffer when they need to enrich an extraction
// with data the page only shipped via API responses (e.g. Instagram
// carousel slides that get DOM-recycled before capture time).
//
// Why a buffer + query API rather than a "wait for next response":
// the page's GraphQL request typically fires during initial page
// load — long before the user clicks the FAB. By then the response
// is gone unless we captured it. Buffering everything that matched
// our patterns since page load gives the handler a synchronous
// query API at capture time.
//
// Cap: keep up to MAX_EVENTS, discard oldest. A typical Instagram
// page makes 5-15 GraphQL requests during navigation; 50 is a
// generous ceiling.

const MAX_EVENTS = 50;

// Singleton buffer — one per content-script context (per tab).
const _events = [];
let _installed = false;

/**
 * Start listening for `xr:apihook:event` messages from the page's
 * MAIN-world api-interceptor. Idempotent — safe to call multiple
 * times. Returns a teardown function that stops listening.
 */
export function installBufferListener() {
    if (_installed) return _teardown;
    _installed = true;
    window.addEventListener('message', _onMessage);
    return _teardown;
}

function _teardown() {
    if (!_installed) return;
    _installed = false;
    window.removeEventListener('message', _onMessage);
    _events.length = 0;
}

function _onMessage(ev) {
    if (ev.source !== window) return;
    const msg = ev.data;
    if (!msg || typeof msg !== 'object') return;
    if (msg.type !== 'xr:apihook:event') return;
    // Don't validate the nonce — we're reading messages from our
    // OWN page-world script back into the isolated world. There's
    // only one extension scattering them.
    _events.push({
        url:     String(msg.url || ''),
        method:  String(msg.method || ''),
        headers: msg.headers || {},
        body:    String(msg.body || ''),
        capturedAt: Date.now()
    });
    if (_events.length > MAX_EVENTS) _events.splice(0, _events.length - MAX_EVENTS);
    try { console.log('[X-Ray api-hook-buffer] queued event:', msg.url, '(buffer size:', _events.length, ')'); } catch (_) {}
}

/**
 * Configure the MAIN-world api-interceptor with the patterns to
 * capture. Posts an `xr:apihook:configure` envelope; the
 * interceptor (already loaded via the manifest content_script for
 * Instagram pages) installs the patterns and starts capturing.
 *
 * Patterns are { urlIncludes, headerIncludes } as documented in
 * src/shared/api-pattern.js.
 */
export function configureInterceptor(patterns) {
    try {
        window.postMessage({
            __xr: window.__xrNonce || 'xr_unknown',
            type: 'xr:apihook:configure',
            patterns: Array.isArray(patterns) ? patterns : []
        }, '*');
    } catch (err) {
        console.warn('[X-Ray api-hook] configure failed:', err);
    }
}

/**
 * Query the buffer for events matching `predicate`. Returns the
 * matching events in insertion order (oldest → newest). Useful
 * when a handler wants the most recent matching response — caller
 * does `findApiHookEvents(...).pop()`.
 *
 * @param {(event: {url, method, headers, body, capturedAt}) => boolean} predicate
 * @returns {Array<object>}
 */
export function findApiHookEvents(predicate) {
    if (typeof predicate !== 'function') return [];
    return _events.filter((e) => {
        try { return !!predicate(e); }
        catch (_) { return false; }
    });
}

/**
 * Convenience: parse `body` as JSON, returning null on parse
 * failure. Avoids try/catch sprawl in handler code.
 */
export function tryParseJson(body) {
    if (typeof body !== 'string' || !body) return null;
    try { return JSON.parse(body); }
    catch (_) { return null; }
}

/**
 * Test-only: clear the buffer. Not exported under a stable name
 * because production callers should never need this.
 */
export function _resetForTests() { _events.length = 0; _installed = false; }
