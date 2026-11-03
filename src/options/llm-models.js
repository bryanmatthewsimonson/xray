// Options → Advanced → LLM assist → Model. The built-in roster, then
// the newer models the saved key's Anthropic account lists, in their
// own group (JOURNAL 2026-09-29). Moved out of index.js when the picker
// gained the account check; the worker makes the call (xray:llm:models)
// and holds the key — this page only renders what comes back.

import {
    LLM_MODELS, LLM_DISCOVERED_MODELS_STORAGE, newerThanRoster, resolveModel
} from '../shared/llm-prompts.js';

const browserApi = (typeof browser !== 'undefined' && browser.runtime) ? browser : chrome;

export const NEWER_GROUP_LABEL = 'Newer — not yet verified with X-Ray';

/** The picker as data: the roster in order, then the newer models. */
export function pickerEntries(discovered) {
    return [
        ...LLM_MODELS.map((m) => ({ group: null, id: m.id, label: m.label })),
        ...discovered.map((m) => ({ group: NEWER_GROUP_LABEL, id: m.id, label: m.label }))
    ];
}

function render(sel, discovered, selected) {
    sel.textContent = '';
    let group = null;
    for (const e of pickerEntries(discovered)) {
        const opt = document.createElement('option');
        opt.value = e.id;
        opt.textContent = e.label;
        if (!e.group) { sel.appendChild(opt); continue; }
        if (!group) {
            group = document.createElement('optgroup');
            group.label = e.group;
            sel.appendChild(group);
        }
        group.appendChild(opt);
    }
    sel.value = resolveModel(selected, discovered);
}

function readStoredModels() {
    return new Promise((resolve) => {
        browserApi.storage.local.get([LLM_DISCOVERED_MODELS_STORAGE], (res) => {
            const stored = res ? res[LLM_DISCOVERED_MODELS_STORAGE] : null;
            resolve(newerThanRoster(stored && stored.models));
        });
    });
}

function setStatus(text) {
    const el = document.getElementById('llm-models-status');
    if (!el) return;
    el.textContent = text;
    el.hidden = !text;
}

/**
 * Render from the stored list, selecting the saved model; then, with a
 * key saved, ask the account for newer models without holding up the
 * page.
 */
export async function setupModelPicker({ saved, hasKey }) {
    const sel = document.getElementById('pref-llm-model');
    if (!sel) return;
    render(sel, await readStoredModels(), saved);
    if (hasKey) refreshModelPicker();
}

/** Ask the worker for the account's newer models; re-render, keeping the current choice. */
export async function refreshModelPicker() {
    const sel = document.getElementById('pref-llm-model');
    if (!sel) return;
    let res;
    try {
        res = await browserApi.runtime.sendMessage({ type: 'xray:llm:models' });
    } catch (err) {
        res = { ok: false, error: (err && err.message) || 'no response from the extension' };
    }
    if (res && res.ok) {
        render(sel, newerThanRoster(res.models), sel.value);
        setStatus('');
    } else {
        setStatus(`Couldn't check your Anthropic account for newer models: ${(res && res.error) || 'no response'}`);
    }
}
