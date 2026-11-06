// The content script's signing-state record for the Options Signing tab.
// Extracted from content/index.js (structure-guards rule 5 line ceiling).

import { Utils } from '../shared/utils.js';

/**
 * Persist the resolved signing state to chrome.storage.local so the
 * options Signing tab can show an honest status instead of always
 * falling through to "not detected" — the bug closed by issue #2.
 *
 * Writes the value JSON-stringified to match the convention of every
 * other key written through `Storage` (see `src/shared/storage.js` —
 * `set` always JSON.stringifies). The popup's `safeParse` handles
 * the round-trip.
 */
export function recordSigningState(method, pubkey = null) {
    try {
        const payload = JSON.stringify({
            method,                       // 'local' | 'nip07' | 'nsecbunker' | 'unconfigured' | '<x>-missing'
            pubkey,                       // hex pubkey when known, else null
            detectedAt: Date.now()
        });
        chrome.storage.local.set({ xr_signing_state: payload });
    } catch (err) {
        // Best-effort — never let a popup-visibility nicety crash the
        // content script's init.
        Utils.log('Failed to persist signing state:', err && err.message);
    }
}
