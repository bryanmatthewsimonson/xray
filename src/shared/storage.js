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
import { Crypto } from './crypto.js';

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
        platform_accounts: {},
        local_primary_identity: null,
        preferences: {
          default_relays: CONFIG.relays.filter(r => r.enabled).map(r => r.url),
          media_handling: 'embed',
          theme: 'dark',
          debug: false,
          nsecbunker_url: CONFIG.nsecbunker.defaultUrl,
          signing_method: 'local',
          signing_method_configured: false
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

      // 2026-05-01 — introduce explicit signing_method preference. Older
      // profiles auto-detected NIP-07 / NSecBunker at content-script init;
      // X-Ray now defaults to local signing and asks the user to choose
      // through the first-run prompt. Existing users land on 'local' with
      // signing_method_configured=false so the prompt fires once.
      if (!applied.signing_method_default) {
        if (typeof prefs.signing_method !== 'string') {
          prefs.signing_method = 'local';
          changed = true;
        }
        if (typeof prefs.signing_method_configured !== 'boolean') {
          prefs.signing_method_configured = false;
          changed = true;
        }
        applied.signing_method_default = true;
        changed = true;
      }

      // 2026-05-29 — the migration above set signing_method_configured=false
      // unconditionally, which made profiles that ALREADY had a local
      // signing key look "unconfigured": they got the first-run prompt and
      // were blocked from publishing until they re-confirmed via
      // Settings → Save. If a local primary identity exists, the user is
      // configured — flip the flag so no pointless Save is required.
      if (!applied.configured_if_keyed) {
        const localId = await Store.get('local_primary_identity', null);
        if (localId && localId.privateKey && prefs.signing_method_configured !== true) {
          prefs.signing_method_configured = true;
          Utils.log('[migration] existing local key → signing_method_configured=true');
          changed = true;
        }
        applied.configured_if_keyed = true;
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

    // The user's primary signing identity when signing_method === 'local'.
    // Kept distinct from `keypair_registry` (which holds entity keys) so
    // that an entity-keypair export never accidentally leaks the user's
    // own nsec. Shape: { privateKey, pubkey, npub, nsec, created } | null.
    primaryIdentity: {
      get: async () => await Store.get('local_primary_identity', null),

      set: async (privateKey) => {
        if (typeof privateKey !== 'string' || !/^[0-9a-fA-F]{64}$/.test(privateKey)) {
          throw new Error('Private key must be 64-char hex');
          }
        const pubkey = Crypto.getPublicKey(privateKey);
        const identity = {
          privateKey,
          pubkey,
          npub: Crypto.hexToNpub(pubkey),
          nsec: Crypto.hexToNsec(privateKey),
          created: Math.floor(Date.now() / 1000)
        };
        await Store.set('local_primary_identity', identity);
        return identity;
      },

      generate: async () => {
        return await Store.primaryIdentity.set(Crypto.generatePrivateKey());
      },

      importNsec: async (nsecOrHex) => {
        const trimmed = String(nsecOrHex || '').trim();
        let hex = null;
        if (/^nsec1[0-9a-z]+$/i.test(trimmed)) {
          hex = Crypto.nsecToHex(trimmed);
        } else if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
          hex = trimmed.toLowerCase();
        }
        if (!hex) throw new Error('Provide an nsec1… string or 64-char hex private key');
        return await Store.primaryIdentity.set(hex);
      },

      clear: async () => await Store.set('local_primary_identity', null)
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
    // Platform-account registry (Phase 9 identity layer)
    // -----------------------------------------------------------------
    // A registry of social-media accounts X-Ray has seen, keyed by
    // `<platform>:<stableId>` (the dedup key from
    // shared/identity/platform-account.js). Each record carries the
    // deterministic `accountPubkey` (an identifier, never a signing
    // key), the captured display fields, and an optional `linkedEntityId`
    // joining the account to a canonical person (set manually in v1).
    //
    // Lives in chrome.storage.local like every other registry
    // (keypairs / people / organizations) — small structured records
    // with reverse lookups, not bulky cached blobs.
    platformAccounts: {
      getAll: async () => await Store.get('platform_accounts', {}),
      get:    async (key) => (await Store.get('platform_accounts', {}))[key] || null,

      // Upsert. On re-capture of a known account, preserve `firstSeen`
      // and any existing `linkedEntityId`, bump `lastSeen`, and refresh
      // the mutable display fields (handle/displayName/avatar/verified
      // all drift over time; stableId + accountPubkey never do).
      save: async (record) => {
        if (!record || !record.key) throw new Error('platformAccounts.save: record.key required');
        const all = await Store.get('platform_accounts', {});
        const prev = all[record.key] || null;
        const now = Math.floor(Date.now() / 1000);
        const merged = {
          ...record,
          firstSeen: (prev && prev.firstSeen) || record.firstSeen || now,
          lastSeen: now,
          // Don't let a re-capture silently clobber a manual entity link.
          linkedEntityId: record.linkedEntityId != null
            ? record.linkedEntityId
            : (prev ? prev.linkedEntityId : null)
        };
        all[record.key] = merged;
        await Store.set('platform_accounts', all);
        return merged;
      },

      delete: async (key) => {
        const all = await Store.get('platform_accounts', {});
        delete all[key];
        await Store.set('platform_accounts', all);
      },

      // Reverse lookup by the deterministic account pubkey. Linear scan
      // — the registry is small (hundreds, not millions) and this is not
      // a hot path.
      findByPubkey: async (accountPubkey) => {
        if (!accountPubkey) return null;
        const all = await Store.get('platform_accounts', {});
        for (const rec of Object.values(all)) {
          if (rec && rec.accountPubkey === accountPubkey) return rec;
        }
        return null;
      },

      // All accounts linked to a given canonical entity (the inverse of
      // the manual link). Used to render "this person's accounts."
      findByEntity: async (entityId) => {
        if (!entityId) return [];
        const all = await Store.get('platform_accounts', {});
        return Object.values(all).filter((rec) => rec && rec.linkedEntityId === entityId);
      },

      // Manual entity link (Phase IV). Sets or clears linkedEntityId.
      link: async (key, entityId) => {
        const all = await Store.get('platform_accounts', {});
        if (!all[key]) throw new Error('platformAccounts.link: unknown account ' + key);
        all[key] = { ...all[key], linkedEntityId: entityId || null, lastSeen: Math.floor(Date.now() / 1000) };
        await Store.set('platform_accounts', all);
        return all[key];
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
      // The Settings page persists the structured shape under
      // preferences.relays. For back-compat with profiles that only ever
      // saw `default_relays` (flat URL list), synthesize the structured
      // shape on read with read=write=enabled=true.
      get: async () => {
        const prefs = await Store.get('preferences', {});
        if (Array.isArray(prefs.relays) && prefs.relays.length > 0) {
          return {
            relays: prefs.relays.map((r) => ({
              url: String(r && r.url || ''),
              read: r && r.read !== false,
              write: r && r.write !== false,
              enabled: r && r.enabled !== false
            })).filter((r) => r.url)
          };
        }
        const urls = Array.isArray(prefs.default_relays) ? prefs.default_relays : [];
        return {
          relays: urls.map((url) => ({ url, read: true, write: true, enabled: true }))
        };
      },

      set: async (relays) => {
        if (!Array.isArray(relays)) throw new Error('relays must be an array');
        const normalized = relays
          .map((r) => ({
            url: String(r && r.url || '').trim(),
            read: r && r.read !== false,
            write: r && r.write !== false,
            enabled: r && r.enabled !== false
          }))
          .filter((r) => r.url);
        const prefs = await Store.get('preferences', {});
        prefs.relays = normalized;
        // Keep default_relays in sync as the enabled-write URL list so
        // every existing reader (nostr-client.js etc.) continues working.
        prefs.default_relays = normalized
          .filter((r) => r.enabled && r.write)
          .map((r) => r.url);
        await Store.set('preferences', prefs);
        return normalized;
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
