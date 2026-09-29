// The worker's door for xray:llm:models (JOURNAL 2026-09-29): the
// models the saved key's Anthropic account lists that are newer than
// the built-in roster. The call spends the key, so it answers extension
// pages only, with the check the LLM-job door makes (./llm-jobs.js);
// the page gets the list, never the key.

import { refreshDiscoveredModels } from '../shared/llm-client.js';
import { fromExtensionPage } from './llm-jobs.js';

/**
 * Answer one xray:llm:models message.
 *
 * @param {function} sendResponse
 * @param {object} sender  the runtime.MessageSender
 * @param {object} [deps]  test seam: { refresh }
 * @returns {boolean} true while the answer is pending (the onMessage contract)
 */
export function respondLlmModels(sendResponse, sender, { refresh = refreshDiscoveredModels } = {}) {
    if (!fromExtensionPage(sender)) {
        sendResponse({ ok: false, error: 'The model list answers extension pages only.' });
        return false;
    }
    refresh().then(
        (result) => sendResponse(result),
        (err) => sendResponse({ ok: false, error: (err && err.message) || 'Could not list the models' })
    );
    return true;
}
