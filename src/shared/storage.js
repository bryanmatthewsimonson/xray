// Storage wrapper. In the userscript this sat on top of GM_setValue /
// GM_getValue / GM_deleteValue / GM_listValues. Here it sits on top of
// chrome.storage.local. The outer API (Storage.get / set / delete / keys
// and the publications/people/organizations/preferences/keypairs sub-objects)
// is preserved so callers don't change.
//
// Values are stored JSON-serialized just like the original script so that
// exports/imports remain compatible.

import { CONFIG } from './config.js';
import { Utils } from './utils.js';

export const Storage = (() => {
  const area = (typeof browser !== 'undefined' && browser.storage) ? browser.storage.local : chrome.storage.local;

  const rawGet = (key) => new Promise((resolve) => {
    try {
      area.get([key], (res) => resolve(res ? res[key] : undefined));
    } catch (_) { resolve(undefined); }
  });

  const rawSet = (key, value) => new Promise((resolve) => {
    try {
      area.set({ [key]: value }, () => resolve(true));
    } catch (_) { resolve(false); }
  });

  const rawDelete = (key) => new Promise((resolve) => {
    try {
      area.remove([key], () => resolve(true));
    } catch (_) { resolve(false); }
  });

  const rawKeys = () => new Promise((resolve) => {
    try {
      area.get(null, (all) => resolve(all ? Object.keys(all) : []));
    } catch (_) { resolve([]); }
  });

  const Store = {
    get: async (key, defaultValue = null) => {
      try {
        const value = await rawGet(key);
        if (value === undefined || value === null) return defaultValue;
        // Values written by this wrapper are JSON strings. Tolerate raw
        // values just in case older or unmigrated data shows up.
        if (typeof value === 'string') {
          try { return JSON.parse(value); } catch (_) { return value; }
        }
        return value;
      } catch (e) {
        Utils.error('Storage get error:', e);
        return defaultValue;
      }
    },
    set:    async (key, value) => { try { return await rawSet(key, JSON.stringify(value)); } catch (e) { Utils.error('Storage set error:', e); return false; } },
    delete: async (key)        => { try { return await rawDelete(key); }                   catch (e) { Utils.error('Storage delete error:', e); return false; } },
    keys:   async ()           => { try { return await rawKeys(); }                        catch (e) { Utils.error('Storage keys error:', e); return []; } },

    initialize: async () => {
      const defaults = {
        publications: {},
        people: {},
        organizations: {},
        keypair_registry: {},
        preferences: {
          default_relays: CONFIG.relays.filter(r => r.enabled).map(r => r.url),
          media_handling: 'embed',
          theme: 'dark',
          debug: false,
          nsecbunker_url: CONFIG.nsecbunker.defaultUrl
        },
        recent_publications: []
      };
      for (const [key, value] of Object.entries(defaults)) {
        const existing = await Store.get(key);
        if (existing === null) await Store.set(key, value);
      }
      await Store._runMigrations();
      Utils.log('Storage initialized');
    },

    // Run idempotent data migrations. Each migration declares a key in
    // `preferences._migrations` so it only runs once per profile.
    _runMigrations: async () => {
      const prefs = await Store.get('preferences', {});
      const applied = prefs._migrations || {};
      let changed = false;

      // 2026-04-20 — wss://offchain.pub is a WoT-gated relay that rejects
      // every event from pubkeys outside the operators' trust set. Users
      // who had it in their default list were seeing 100% publish failure
      // on that relay. Drop it; they can re-add if they're in the set.
      if (!applied.drop_offchain_pub && Array.isArray(prefs.default_relays)) {
        const filtered = prefs.default_relays.filter((u) => !/offchain\.pub/i.test(String(u)));
        if (filtered.length !== prefs.default_relays.length) {
          prefs.default_relays = filtered;
          changed = true;
          Utils.log('[migration] dropped wss://offchain.pub from saved relay list');
        }
        applied.drop_offchain_pub = true;
        changed = true;
      }

      if (changed) {
        prefs._migrations = applied;
        await Store.set('preferences', prefs);
      }
    },

    publications: {
      getAll: async () => await Store.get('publications', {}),
      get:    async (id) => (await Store.get('publications', {}))[id] || null,
      save:   async (id, data) => {
        const pubs = await Store.get('publications', {});
        pubs[id] = { ...data, updated: Math.floor(Date.now() / 1000) };
        await Store.set('publications', pubs);
        return pubs[id];
      },
      delete: async (id) => {
        const pubs = await Store.get('publications', {});
        delete pubs[id];
        await Store.set('publications', pubs);
      }
    },

    people: {
      getAll: async () => await Store.get('people', {}),
      get:    async (id) => (await Store.get('people', {}))[id] || null,
      save:   async (id, data) => {
        const people = await Store.get('people', {});
        people[id] = { ...data, updated: Math.floor(Date.now() / 1000) };
        await Store.set('people', people);
        return people[id];
      },
      delete: async (id) => {
        const people = await Store.get('people', {});
        delete people[id];
        await Store.set('people', people);
      }
    },

    organizations: {
      getAll: async () => await Store.get('organizations', {}),
      get:    async (id) => (await Store.get('organizations', {}))[id] || null,
      save:   async (id, data) => {
        const orgs = await Store.get('organizations', {});
        orgs[id] = { ...data, updated: Math.floor(Date.now() / 1000) };
        await Store.set('organizations', orgs);
        return orgs[id];
      },
      delete: async (id) => {
        const orgs = await Store.get('organizations', {});
        delete orgs[id];
        await Store.set('organizations', orgs);
      }
    },

    preferences: {
      get: async ()        => await Store.get('preferences', {}),
      set: async (prefs)   => await Store.set('preferences', prefs),
      update: async (updates) => {
        const current = await Store.get('preferences', {});
        await Store.set('preferences', { ...current, ...updates });
      }
    },

    keypairs: {
      getAll: async () => await Store.get('keypair_registry', {}),
      get:    async (id) => (await Store.get('keypair_registry', {}))[id] || null,
      save:   async (id, data) => {
        const registry = await Store.get('keypair_registry', {});
        registry[id] = { ...data, updated: Math.floor(Date.now() / 1000) };
        await Store.set('keypair_registry', registry);
        Utils.log('Saved keypair to registry:', id);
        return registry[id];
      },
      delete: async (id) => {
        const registry = await Store.get('keypair_registry', {});
        delete registry[id];
        await Store.set('keypair_registry', registry);
      },
      exportAll: async () => JSON.stringify(await Store.get('keypair_registry', {}), null, 2),
      importAll: async (jsonStr) => {
        try {
          const imported = JSON.parse(jsonStr);
          const registry = await Store.get('keypair_registry', {});
          await Store.set('keypair_registry', { ...registry, ...imported });
          Utils.log('Imported keypairs:', Object.keys(imported).length);
          return true;
        } catch (e) {
          Utils.error('Failed to import keypairs:', e);
          return false;
        }
      }
    },

    // -----------------------------------------------------------------
    // v4-compatibility façades
    // -----------------------------------------------------------------
    // The userscript v4 event-builder (ported in Phase 2) expects these
    // sub-namespaces. Phase 4 swaps out the `entities` stub for a real
    // registry; Phase 7 swaps out `articleCache` for an IndexedDB
    // implementation. `relays` is a read-through wrapper over the
    // existing preferences storage, shaped to match the v4 contract.
    entities: {
      get:     async (_id) => null,           // Phase 4 (#15) returns real entities
      getAll:  async () => ({}),
      save:    async () => {
        throw new Error('Entity storage not implemented until Phase 4 (#15)');
      }
    },

    relays: {
      // Returns `{ relays: [{url, read, write, enabled}] }` to match v4.
      // X-Ray currently stores only a flat URL list in preferences, so
      // every relay is assumed read+write+enabled.
      get: async () => {
        const prefs = await Store.get('preferences', {});
        const urls = Array.isArray(prefs.default_relays) ? prefs.default_relays : [];
        return {
          relays: urls.map((url) => ({ url, read: true, write: true, enabled: true }))
        };
      }
    },

    articleCache: {
      // Phase 7 (#18) replaces these with IndexedDB-backed storage.
      getForUrl: async (_url) => null,
      save:      async (_article) => {}
    }
  };

  return Store;
})();
