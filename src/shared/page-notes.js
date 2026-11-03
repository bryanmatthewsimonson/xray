// Page notes — the user's local, UNPUBLISHED personal notes anchored to
// a passage or a video moment on a web page (inline overlay, phase 1).
//
// Storage: Storage.get('page_notes', {}) — a map keyed by note id, so
// mergeBackup accrues by id like the other content maps (the key is on
// WORKSPACE_CONTENT_KEYS). Notes never leave the machine: no event kind.

import { Storage } from './storage.js';
import { normalize } from './metadata/url-normalizer.js';

const STORAGE_KEY = 'page_notes';
export const MAX_NOTE_TEXT = 10000;

function newId() {
    const bytes = new Uint8Array(8);
    globalThis.crypto.getRandomValues(bytes);
    return 'pn_' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function readAll() {
    const map = await Storage.get(STORAGE_KEY, {});
    return map && typeof map === 'object' ? map : {};
}

export const PageNotes = {
    async list() {
        return Object.values(await readAll());
    },

    async forUrl(url) {
        const target = normalize(url);
        return (await this.list()).filter((n) => n.url === target);
    },

    async save({ id, url, anchor = null, quote = null, seconds = null, text } = {}) {
        const body = typeof text === 'string' ? text.trim() : '';
        if (!body) throw new Error('Note text is required');
        if (body.length > MAX_NOTE_TEXT) {
            throw new Error(`Note text exceeds ${MAX_NOTE_TEXT} characters`);
        }
        if (typeof url !== 'string' || !url) throw new Error('Note url is required');

        const map = await readAll();
        const now = Date.now();
        const noteId = id || newId();
        const prior = map[noteId];
        const note = {
            id: noteId,
            url: normalize(url),
            anchor,
            quote,
            seconds,
            text: body,
            created: prior ? prior.created : now,
            updated: now
        };
        map[noteId] = note;
        await Storage.set(STORAGE_KEY, map);
        return note;
    },

    async remove(id) {
        const map = await readAll();
        if (!(id in map)) return;
        delete map[id];
        await Storage.set(STORAGE_KEY, map);
    }
};
