// LLM entity audit — Phase 17 E2 (docs/ENTITY_CORPUS_DESIGN.md §3.2).
// The pure half: the registry digest the model reads, the
// propose_entity_ops tool schema, and the validation firewall that
// stands between raw model output and the Accept buttons.
//
// For what the E1 token heuristics can't see: "Robert Smith" vs "Bob
// Smith", "the Diocese" vs "Diocese of Springfield", one name used by
// two different people. Five ops, every one human-accepted:
//
//   merge       → EntityModel.linkAlias (nothing deleted, undoable)
//   rename      → EntityModel.update({name}) — display only; ids are
//                 create-time-derived and update() never rederives
//                 (§7 Q1, pinned in tests)
//   retype      → EntityModel.update({type}) — rare; the review row
//                 warns it changes id derivation for FUTURE lookups
//   split       → manual-assisted: Accept creates the second entity;
//                 re-pointing article refs stays the human's job
//   external_id → appended to record.external_ids; published as a
//                 NIP-39 `i` tag on the entity's kind-0
//
// The firewall mirrors the 14.5 discipline: merges/splits must cite
// evidence grounded in STORED mention text (never re-fetched), op
// endpoints must exist and be mergeable, and anything failing renders
// rejected-with-reason — never silently dropped.
//
// Pure: no chrome, no network, no DOM, no clock.

import { canonicalIdOf, ENTITY_TYPES } from './entity-model.js';
import { Utils } from './utils.js';

export const ENTITY_AUDIT_PROMPT_VERSION = 'entity-audit-v1';
export const ENTITY_AUDIT_TOOL_NAME = 'propose_entity_ops';

// Input bounds: the digest is names/descriptions/snippets, not bodies —
// generous caps still keep a large registry to one call.
export const MAX_ENTITY_AUDIT_DIGEST_CHARS = 120000;
export const MAX_MENTIONS_PER_ENTITY = 3;
export const MAX_MENTION_CHARS = 200;
export const MAX_ENTITY_AUDIT_OUTPUT_TOKENS = 8192;

const EXTERNAL_ID_SCHEMES = ['wikidata', 'url'];

/** The forced tool: a flat op list, discriminated on `op`. */
export function buildEntityAuditTool() {
    return {
        name: ENTITY_AUDIT_TOOL_NAME,
        description: 'Propose entity-registry corrections. Every op is reviewed by a human; '
            + 'cite evidence from the supplied mentions. Never invent an entity id.',
        input_schema: {
            type: 'object',
            required: ['ops'],
            properties: {
                ops: {
                    type: 'array',
                    items: {
                        type: 'object',
                        required: ['op', 'note'],
                        properties: {
                            op: { type: 'string', enum: ['merge', 'rename', 'retype', 'split', 'external_id'] },
                            alias_id: { type: 'string', description: 'merge: the entity that becomes an alias.' },
                            canonical_id: { type: 'string', description: 'merge: the entity that stays canonical.' },
                            entity_id: { type: 'string', description: 'rename/retype/split/external_id: the target entity.' },
                            name: { type: 'string', description: 'rename: the corrected display name.' },
                            entity_type: { type: 'string', enum: ENTITY_TYPES, description: 'retype: the corrected type.' },
                            sides: {
                                type: 'array',
                                description: 'split: the distinct identities sharing this record (2+), each with its own evidence.',
                                items: {
                                    type: 'object',
                                    required: ['name'],
                                    properties: {
                                        name: { type: 'string' },
                                        evidence: { type: 'array', items: { type: 'object', properties: {
                                            entity_id: { type: 'string' }, quote: { type: 'string' }
                                        } } }
                                    }
                                }
                            },
                            scheme: { type: 'string', enum: EXTERNAL_ID_SCHEMES, description: 'external_id: the identifier scheme.' },
                            value: { type: 'string', description: 'external_id: the identifier (e.g. Q42, or a canonical URL).' },
                            evidence: {
                                type: 'array',
                                description: 'merge: grounded mention quotes — at least one per endpoint, copied VERBATIM from the supplied mentions.',
                                items: {
                                    type: 'object',
                                    required: ['entity_id', 'quote'],
                                    properties: {
                                        entity_id: { type: 'string' },
                                        quote: { type: 'string', description: 'A verbatim fragment of a supplied mention for this entity. Machine-checked.' }
                                    }
                                }
                            },
                            note: { type: 'string', description: 'One sentence: why this correction is right.' }
                        }
                    }
                }
            }
        }
    };
}

export function buildEntityAuditSystemPrompt() {
    return [
        'You audit a personal research registry of entities (people, organizations,',
        'places, things, cases) extracted from captured articles. Propose corrections',
        'via the propose_entity_ops tool. A human reviews every proposal.',
        'RULES:',
        '- Entity ids come ONLY from the supplied registry — never invent, shorten, or',
        '  guess one.',
        '- merge: propose ONLY when the mentions show the same real-world entity under',
        '  two records (name variants, nicknames, abbreviations). Cite at least one',
        '  verbatim mention fragment per endpoint in `evidence` — fragments are',
        '  machine-checked against the supplied mentions; altered text is discarded.',
        '- Do NOT merge different entities that share a name; that is a `split` signal',
        '  when one RECORD mixes two identities, or nothing at all.',
        '- rename: only to correct an obviously wrong or misspelled display name.',
        '- retype: only when the type is factually wrong (an organization recorded as a',
        '  person). Rare.',
        '- external_id: only identifiers you are confident of (a Wikidata Q-id, an',
        '  official site). When unsure, omit.',
        '- Every op carries a one-sentence `note`. Fewer, better-evidenced ops beat',
        '  many speculative ones. An empty ops list is a fine answer.'
    ].join('\n');
}

/**
 * The registry digest: one block per entity — id, name, type,
 * description, alias links, and up to MAX_MENTIONS_PER_ENTITY stored
 * mention snippets with their article title/URL. Pure over injected
 * {entities, articles}; char-capped with the drop disclosed.
 *
 * @param {object} input
 * @param {object} input.entities  id → record
 * @param {Array}  input.articles  archive records (mention source)
 * @returns {{digest: string, included: number, truncated: number,
 *            mentionTextByEntity: Object<string,string[]>}}
 */
export function buildRegistryDigest({ entities = {}, articles = [] } = {}) {
    // Mentions: entity refs on archive records carry the grounded
    // `context` span from tagging time — the stored evidence corpus.
    const mentionsByEntity = new Map();
    for (const rec of articles) {
        const art = rec && rec.article;
        if (!art) continue;
        const title = art.title || rec.url || '';
        for (const ref of (art.entities || [])) {
            if (!ref || !ref.entity_id || !ref.context) continue;
            const list = mentionsByEntity.get(ref.entity_id) || [];
            if (list.length >= MAX_MENTIONS_PER_ENTITY) continue;
            list.push({ context: String(ref.context).slice(0, MAX_MENTION_CHARS), title, url: rec.url || '' });
            mentionsByEntity.set(ref.entity_id, list);
        }
    }

    const records = Object.values(entities)
        .filter((e) => e && e.id)
        .sort((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : 0)
            || (String(a.name) < String(b.name) ? -1 : 1));

    const mentionTextByEntity = {};
    const blocks = [];
    let included = 0;
    let truncated = 0;
    let used = 0;
    for (const e of records) {
        const mentions = mentionsByEntity.get(e.id) || [];
        mentionTextByEntity[e.id] = [String(e.name || ''), ...mentions.map((m) => m.context)];
        const lines = [
            `[${e.id}] ${e.name} (${e.type})${e.description ? ` — ${String(e.description).slice(0, 200)}` : ''}`
        ];
        if (e.canonical_id) lines.push(`  alias of → [${e.canonical_id}]`);
        for (const m of mentions) {
            lines.push(`  mention: "${m.context}" — ${m.title}${m.url ? ` <${m.url}>` : ''}`);
        }
        const block = lines.join('\n');
        if (used + block.length > MAX_ENTITY_AUDIT_DIGEST_CHARS) { truncated++; continue; }
        used += block.length + 1;
        included++;
        blocks.push(block);
    }
    return { digest: blocks.join('\n'), included, truncated, mentionTextByEntity };
}

export function buildEntityAuditUserPrompt(digest) {
    return `THE REGISTRY (id, name, type, aliases, stored mentions):\n\n${digest}\n\n`
        + 'Audit it with the propose_entity_ops tool.';
}

// Normalized containment: does `quote` appear in any of the entity's
// stored mention strings? (Whitespace-collapsed, case-insensitive —
// the stored text is the substrate, never re-fetched.)
function normText(s) {
    return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
}
function quoteGrounds(quote, mentionTexts) {
    const q = normText(quote);
    if (!q) return false;
    return (mentionTexts || []).some((t) => normText(t).includes(q));
}

/**
 * The validation firewall. Raw model ops in; {accepted, rejected} out,
 * every rejection carrying its reason. Nothing here mutates anything —
 * the caller's Accept buttons do.
 *
 * @param {Array} ops  raw tool output
 * @param {object} input
 * @param {object} input.entities             id → record
 * @param {object} input.mentionTextByEntity  id → [stored mention strings]
 */
export function validateEntityOps(ops, { entities = {}, mentionTextByEntity = {} } = {}) {
    const accepted = [];
    const rejected = [];
    const seen = new Set();
    const fail = (op, reason) => rejected.push({ op, reason });
    const has = (id) => !!(id && entities[id]);

    for (const op of Array.isArray(ops) ? ops : []) {
        if (!op || typeof op !== 'object') { fail(op, 'Not an op object'); continue; }
        if (!String(op.note || '').trim()) { fail(op, 'Missing the required note'); continue; }
        const key = JSON.stringify([op.op, op.alias_id, op.canonical_id, op.entity_id, op.name, op.entity_type, op.scheme, op.value]);
        if (seen.has(key)) { fail(op, 'Duplicate op'); continue; }

        if (op.op === 'merge') {
            if (!has(op.alias_id) || !has(op.canonical_id)) { fail(op, 'Merge endpoint is not a known entity id'); continue; }
            if (op.alias_id === op.canonical_id) { fail(op, 'Merge endpoints are the same entity'); continue; }
            const a = entities[op.alias_id];
            const c = entities[op.canonical_id];
            if (a.type !== c.type) { fail(op, `Type mismatch: ${a.type} vs ${c.type}`); continue; }
            if (canonicalIdOf(op.alias_id, entities) === canonicalIdOf(op.canonical_id, entities)) {
                fail(op, 'Already alias-linked'); continue;
            }
            const ev = Array.isArray(op.evidence) ? op.evidence : [];
            const grounds = (id) => ev.some((e) => e && e.entity_id === id
                && quoteGrounds(e.quote, mentionTextByEntity[id]));
            if (!grounds(op.alias_id) || !grounds(op.canonical_id)) {
                fail(op, 'Evidence must include a grounded stored-mention quote for BOTH endpoints'); continue;
            }
        } else if (op.op === 'rename') {
            if (!has(op.entity_id)) { fail(op, 'Unknown entity id'); continue; }
            const name = String(op.name || '').trim();
            if (!name) { fail(op, 'Rename needs a name'); continue; }
            if (name === entities[op.entity_id].name) { fail(op, 'Name is unchanged'); continue; }
        } else if (op.op === 'retype') {
            if (!has(op.entity_id)) { fail(op, 'Unknown entity id'); continue; }
            if (!ENTITY_TYPES.includes(op.entity_type)) { fail(op, `Invalid type: ${op.entity_type}`); continue; }
            if (op.entity_type === entities[op.entity_id].type) { fail(op, 'Type is unchanged'); continue; }
        } else if (op.op === 'split') {
            if (!has(op.entity_id)) { fail(op, 'Unknown entity id'); continue; }
            const sides = Array.isArray(op.sides) ? op.sides.filter((s) => s && String(s.name || '').trim()) : [];
            if (sides.length < 2) { fail(op, 'Split needs at least two named sides'); continue; }
            const grounded = sides.filter((s) => (s.evidence || []).some((e) =>
                e && quoteGrounds(e.quote, mentionTextByEntity[op.entity_id])));
            if (grounded.length < 2) {
                fail(op, 'Each split side needs a grounded stored-mention quote'); continue;
            }
        } else if (op.op === 'external_id') {
            if (!has(op.entity_id)) { fail(op, 'Unknown entity id'); continue; }
            if (!EXTERNAL_ID_SCHEMES.includes(op.scheme)) { fail(op, `Unknown scheme: ${op.scheme}`); continue; }
            const value = String(op.value || '').trim();
            if (!value) { fail(op, 'external_id needs a value'); continue; }
            if (op.scheme === 'wikidata' && !/^Q\d+$/.test(value)) { fail(op, 'Wikidata id must look like Q42'); continue; }
            if (op.scheme === 'url' && !/^https?:\/\//.test(value)) { fail(op, 'URL identifier must be http(s)'); continue; }
            const existing = entities[op.entity_id].external_ids || [];
            if (existing.includes(`${op.scheme}:${value}`)) { fail(op, 'Already recorded'); continue; }
        } else {
            fail(op, `Unknown op: ${op.op}`); continue;
        }
        seen.add(key);
        accepted.push(op);
    }
    Utils.log(`Entity audit firewall: ${accepted.length} accepted, ${rejected.length} rejected`);
    return { accepted, rejected };
}
