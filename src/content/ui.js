// X-Ray content-script capture surface.
//
// The floating action button (FAB) and the in-page capture panel were
// removed in the de-FAB refactor: capture is now triggered from the
// toolbar icon, the keyboard shortcut (Ctrl/Cmd+Shift+X), or the
// right-click menu, and always opens the captured page in the reader
// (one capture surface, no in-page chrome). What remains here is the
// capture core (`openReader`), a transient error toast, and the
// keypair-registry utilities the right-click menu invokes.

import { CONFIG } from '../shared/config.js';
import { Utils } from '../shared/utils.js';
import { Storage } from '../shared/storage.js';
import { ContentExtractor } from '../shared/content-extractor.js';
import { ContentDetector } from '../shared/content-detector.js';
import { captureForPlatform, enrichArticleForPlatform, detectPlatformFromDom } from '../shared/platforms/index.js';

export const UI = {
  // SVG glyphs for the toast (the only DOM this script still injects).
  icons: {
    check: '<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>',
    close: '<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>',
    warning: '<svg viewBox="0 0 24 24"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>'
  },

  // Extract the current page, hand off to the background SW, and let it
  // open the reader as a new tab. This is the single capture entry point;
  // every trigger (toolbar icon, keyboard shortcut, context menu) routes
  // here via the `xray:capture` message.
  openReader: async () => {
    try {
      // 1. Platform detection first — some platforms (YouTube, Twitter)
      //    aren't article-shaped and need to be synthesized from scratch
      //    rather than run through Readability.
      const detection = ContentDetector.detect();
      const platform = detection?.platform || detectPlatformFromDom();

      let enriched = await captureForPlatform(platform);

      // 2. If no synthesizer handled the page, fall back to Readability
      //    + platform-specific enrichment (Substack's path).
      if (!enriched) {
        const article = ContentExtractor.extractArticle();
        if (!article) {
          UI.showToast('Could not extract an article from this page.', 'error');
          return;
        }
        enriched = await enrichArticleForPlatform(article, platform);
      }

      // 3. Hand off to the reader via the background SW.
      const id = (crypto.randomUUID && crypto.randomUUID()) ||
                 (Date.now().toString(36) + Math.random().toString(36).slice(2));
      const resp = await chrome.runtime.sendMessage({
        type: 'xray:reader:open',
        id,
        article: enriched
      });
      if (!resp || !resp.ok) {
        throw new Error(resp?.error || 'Service worker did not acknowledge');
      }
    } catch (err) {
      Utils.error('openReader failed:', err);
      UI.showToast('Could not open reader: ' + (err.message || err), 'error');
    }
  },

  // Transient corner toast. Self-contained (styles in content.css under
  // the `xr-toast` prefix) so it never collides with the host page.
  showToast: (message, type = 'success') => {
    const existingToast = document.querySelector('.xr-toast');
    if (existingToast) existingToast.remove();

    const toast = document.createElement('div');
    toast.className = `xr-toast ${type}`;
    toast.innerHTML = `
      ${type === 'success' ? UI.icons.check : type === 'error' ? UI.icons.close : UI.icons.warning}
      <span>${Utils.escapeHtml(String(message))}</span>
    `;

    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add('visible'), 10);
    setTimeout(() => {
      toast.classList.remove('visible');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  },

  // Right-click menu → "Export Keypair Registry". Downloads the entity
  // keypair registry as JSON (the user's primary nsec lives elsewhere and
  // is never included — see storage.js).
  exportKeypairs: async () => {
    try {
      const registry = await Storage.keypairs.getAll();
      const count = Object.keys(registry).length;

      if (count === 0) {
        UI.showToast('No keypairs to export', 'warning');
        return;
      }

      const exportData = {
        exported_at: new Date().toISOString(),
        version: CONFIG.version,
        keypairs: registry
      };

      const jsonStr = JSON.stringify(exportData, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `nostr-keypair-registry-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);

      UI.showToast(`Exported ${count} keypairs to file`, 'success');
      Utils.log('Exported keypair registry:', count, 'entries');
    } catch (e) {
      Utils.error('Failed to export keypairs:', e);
      UI.showToast('Failed to export keypairs', 'error');
    }
  },

  // Right-click menu → "View Keypair Registry". Logs the registry to the
  // console and shows a short summary alert.
  viewKeypairs: async () => {
    try {
      const registry = await Storage.keypairs.getAll();
      const count = Object.keys(registry).length;

      console.log('=== X-Ray Keypair Registry ===');
      console.log('Total entries:', count);
      console.log(JSON.stringify(registry, null, 2));

      const publications = Object.entries(registry).filter(([, v]) => v.type === 'publication');
      const people       = Object.entries(registry).filter(([, v]) => v.type === 'person');

      let summary = `Keypair Registry: ${count} total\n`;
      summary += `Publications: ${publications.length}\n`;
      publications.forEach(([, data]) => {
        summary += `   • ${data.name} (${data.domain || 'no domain'})\n`;
        summary += `     pubkey: ${data.pubkey ? data.pubkey.substring(0, 16) + '...' : 'pending'}\n`;
      });

      summary += `People: ${people.length}\n`;
      people.forEach(([, data]) => {
        summary += `   • ${data.name}\n`;
        summary += `     pubkey: ${data.pubkey ? data.pubkey.substring(0, 16) + '...' : 'pending'}\n`;
      });

      alert(summary + '\n\nFull details logged to browser console.');
      UI.showToast(`Found ${count} keypairs - see console`, 'success');
    } catch (e) {
      Utils.error('Failed to view keypairs:', e);
      UI.showToast('Failed to view keypairs', 'error');
    }
  }
};
