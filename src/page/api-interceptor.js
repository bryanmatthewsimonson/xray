// MAIN-world fetch + XHR hook — Phase 8a anti-obfuscation infra.
//
// Lives in the page's main world (same as nip07-bridge.js). Wraps
// `window.fetch` and `XMLHttpRequest` so that the content script
// can be told about responses to URLs matching configured patterns.
// Captured response bodies stream back via window.postMessage,
// using the same envelope nonce convention the NIP-07 bridge uses.
//
// Why MAIN world: the page's own JS calls `fetch()`. The isolated
// content-script world has its own `fetch` that the page never
// touches, so a hook there sees nothing. To intercept what the
// page calls, we have to be in the page's globals.
//
// Activation model: this script is NOT auto-injected via manifest
// content_scripts. A platform handler decides on-demand to inject
// it via `chrome.scripting.executeScript({ world: 'MAIN', files:
// ['dist/api-interceptor.bundle.js'] })`. Once installed, it stays
// passive until told what to capture via the activation message
// described below.
//
// Wire protocol (all postMessages tagged with the X-Ray nonce):
//
//   1. Content → page: { type: 'xr:apihook:configure',
//                        patterns: [{ urlIncludes, headerIncludes }] }
//      Replaces the active pattern set. An empty array disables.
//
//   2. Page → content: { type: 'xr:apihook:event',
//                        url, method, headers, body }
//      Fired once per matching response. `body` is text-decoded
//      (we hold a `.clone().text()` of the response).
//
//   3. Content → page: { type: 'xr:apihook:teardown' }
//      Restores the original fetch + XHR. Called on tab unload or
//      when the platform handler decides we're done.

(function () {
    if (window.__xrApiHookInstalled) return;
    window.__xrApiHookInstalled = true;
    // One-time install log so the page console shows the hook is
    // loaded. Critical for diagnosing "we never see GraphQL
    // responses" — most of the time the issue is the manifest
    // entry didn't take effect (extension reload required) rather
    // than a code bug.
    try { console.log('[X-Ray api-interceptor] installed in MAIN world'); } catch (_) {}

    // The NIP-07 bridge uses the same nonce; if it's not loaded yet
    // we generate our own. The content-script side accepts either —
    // matching is done on `type` prefix `xr:apihook:`.
    const NONCE = (window.__xrNonce ||= 'xr_' + Math.random().toString(36).slice(2));
    let activePatterns = [];

    const originalFetch = window.fetch;
    const OriginalXHR   = window.XMLHttpRequest;

    function send(envelope) {
        try { window.postMessage({ __xr: NONCE, ...envelope }, '*'); }
        catch (_) { /* postMessage rejects non-cloneable values; swallow */ }
    }

    /**
     * Returns true if a request URL + headers match any configured
     * pattern. Pure function — exported via `window.__xrTestMatch`
     * for unit-test access.
     */
    function matchesAnyPattern(url, headers) {
        if (!activePatterns.length) return false;
        const headerEntries = headerEntriesOf(headers);
        for (const p of activePatterns) {
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
        if (typeof headers.entries === 'function') return [...headers.entries()];
        if (Array.isArray(headers)) return headers;
        if (typeof headers === 'object') return Object.entries(headers);
        return [];
    }

    function plainHeaders(headerLike) {
        const out = {};
        for (const [k, v] of headerEntriesOf(headerLike)) out[String(k).toLowerCase()] = String(v);
        return out;
    }

    // --- fetch wrapper ---
    window.fetch = async function patchedFetch(input, init) {
        const url = typeof input === 'string' ? input
            : (input && input.url) ? input.url
            : String(input);
        const reqHeaders = (init && init.headers) ||
            (input && typeof input === 'object' && input.headers) || {};

        const response = await originalFetch.call(this, input, init);
        try {
            if (matchesAnyPattern(url, reqHeaders)) {
                // .clone() so the page can still read the body itself.
                response.clone().text().then((body) => {
                    try { console.log('[X-Ray api-interceptor] captured fetch:', url, '(' + body.length + ' bytes)'); } catch (_) {}
                    send({
                        type:    'xr:apihook:event',
                        source:  'fetch',
                        url,
                        method:  (init && init.method) || (input && input.method) || 'GET',
                        headers: plainHeaders(response.headers),
                        body
                    });
                }).catch(() => {});
            }
        } catch (_) { /* swallow — never let the hook break the page */ }
        return response;
    };

    // --- XMLHttpRequest wrapper ---
    function PatchedXHR() {
        const xhr = new OriginalXHR();
        let _url = '';
        let _method = 'GET';
        const _reqHeaders = {};

        const origOpen = xhr.open;
        xhr.open = function (method, url) {
            _method = method;
            _url    = url;
            return origOpen.apply(xhr, arguments);
        };

        const origSetHeader = xhr.setRequestHeader;
        xhr.setRequestHeader = function (name, value) {
            _reqHeaders[String(name).toLowerCase()] = String(value);
            return origSetHeader.apply(xhr, arguments);
        };

        xhr.addEventListener('load', () => {
            try {
                if (!matchesAnyPattern(_url, _reqHeaders)) return;
                // responseText is only valid for text-shaped responses;
                // for arraybuffer/blob the field throws. Catch and skip.
                let body = '';
                try { body = xhr.responseText || ''; } catch (_) { return; }
                send({
                    type:    'xr:apihook:event',
                    source:  'xhr',
                    url:     _url,
                    method:  _method,
                    headers: parseRespHeaders(xhr.getAllResponseHeaders() || ''),
                    body
                });
            } catch (_) { /* swallow */ }
        });

        return xhr;
    }
    // Preserve the constructor's static surface (XMLHttpRequest.UNSENT etc).
    PatchedXHR.prototype = OriginalXHR.prototype;
    for (const k of Object.getOwnPropertyNames(OriginalXHR)) {
        if (!(k in PatchedXHR)) {
            try { PatchedXHR[k] = OriginalXHR[k]; } catch (_) {}
        }
    }
    window.XMLHttpRequest = PatchedXHR;

    function parseRespHeaders(raw) {
        const out = {};
        for (const line of raw.split(/\r?\n/)) {
            const i = line.indexOf(':');
            if (i > 0) out[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
        }
        return out;
    }

    // --- control-channel listener ---
    // No nonce check on control messages: content scripts in the
    // ISOLATED world can't see `window.__xrNonce` (different world,
    // different `window` object), so any nonce they post would be
    // a stand-in. `ev.source === window` already restricts the
    // sender to our own window's content script — sufficient
    // security for configure/teardown. Output messages back TO the
    // content script still carry the nonce as a tag for filtering
    // on the receiving end.
    window.addEventListener('message', (ev) => {
        if (ev.source !== window) return;
        const msg = ev.data;
        if (!msg || typeof msg !== 'object') return;
        if (msg.type === 'xr:apihook:configure') {
            activePatterns = Array.isArray(msg.patterns) ? msg.patterns : [];
            try { console.log('[X-Ray api-interceptor] configured with', activePatterns.length, 'pattern(s):', activePatterns); } catch (_) {}
        } else if (msg.type === 'xr:apihook:teardown') {
            window.fetch = originalFetch;
            window.XMLHttpRequest = OriginalXHR;
            activePatterns = [];
            window.__xrApiHookInstalled = false;
        }
    });

    // Test hook — only used by the bundled module's own unit test
    // when running in a browser-shaped JSDOM. Strips out in
    // production via dead-code elim is desirable but not critical
    // since it's just a function reference.
    window.__xrApiHookSetPatterns = (patterns) => { activePatterns = patterns || []; };
    window.__xrApiHookMatch = matchesAnyPattern;
})();
