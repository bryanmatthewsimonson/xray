// Utility helpers. API-compatible with the userscript's Utils object.

import { CONFIG } from './config.js';

export const Utils = {
    generateId: () => Date.now().toString(36) + Math.random().toString(36).substr(2),

    slugify: (text) => text
        .toString()
        .toLowerCase()
        .trim()
        .replace(/\s+/g, '-')
        .replace(/[^\w\-]+/g, '')
        .replace(/\-\-+/g, '-')
        .replace(/^-+/, '')
        .replace(/-+$/, ''),

    sha256: async (message) => {
        const msgBuffer = new TextEncoder().encode(message);
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    },

    normalizeUrl: (url) => {
        try {
            const parsed = new URL(url);
            const trackingParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid'];
            trackingParams.forEach(param => parsed.searchParams.delete(param));
            parsed.hash = '';
            parsed.hostname = parsed.hostname.toLowerCase();
            if ((parsed.protocol === 'https:' && parsed.port === '443') ||
                (parsed.protocol === 'http:'  && parsed.port === '80')) {
                parsed.port = '';
            }
            let normalized = parsed.toString();
            if (normalized.endsWith('/') && parsed.pathname !== '/') {
                normalized = normalized.slice(0, -1);
            }
            return normalized;
        } catch (e) {
            return url;
        }
    },

    getDomain: (url) => {
        try { return new URL(url).hostname.replace(/^www\./, ''); }
        catch (e) { return ''; }
    },

    formatDate: (timestamp) => {
        const date = new Date(timestamp * 1000);
        return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    },

    escapeHtml: (text) => {
        // In a service worker there's no `document`; fall back to manual escape.
        if (typeof document === 'undefined') {
            return String(text == null ? '' : text)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        }
        const div = document.createElement('div');
        div.textContent = text == null ? '' : String(text);
        return div.innerHTML;
    },

    debounce: (func, wait) => {
        let timeout;
        return function executedFunction(...args) {
            const later = () => { clearTimeout(timeout); func(...args); };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    },

    // Cross-origin fetch helper. In MV3 the content script's fetch is subject
    // to CORS; host_permissions in the manifest grant access to arbitrary
    // origins. For cross-origin fetches that still trip CORS at the server,
    // route through the background service worker (its fetches aren't subject
    // to page CSP and don't emit the page's Origin header).
    fetchBinary: async (url, { timeout = 30000 } = {}) => {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), timeout);
        try {
            const res = await fetch(url, { signal: controller.signal, credentials: 'omit' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const buf = await res.arrayBuffer();
            const type = res.headers.get('content-type') || 'application/octet-stream';
            return { buffer: buf, type };
        } finally {
            clearTimeout(t);
        }
    },

    // Convert ArrayBuffer to base64 data URL (used for image embedding).
    bufferToDataUrl: (buffer, mime) => {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
        }
        return `data:${mime};base64,${btoa(binary)}`;
    },

    notify: (title, message) => {
        // Ask the service worker to raise a real browser notification. Content
        // scripts cannot use chrome.notifications directly.
        try {
            chrome.runtime.sendMessage({ type: 'xray:notify', title, body: message });
        } catch (_) { /* background may be asleep — ignore */ }
    },

    // Runtime debug flag. Seeded from CONFIG.debug at bundle time;
    // content/index.js and background/index.js override it on startup
    // from `preferences.debug` so the options toggle takes effect
    // without a rebuild. Errors always print.
    _debug: CONFIG.debug,
    setDebug: (v) => { Utils._debug = !!v; },
    log:   (...args) => { if (Utils._debug) console.log('[X-Ray]', ...args); },
    error: (...args) => { console.error('[X-Ray]', ...args); }
};
