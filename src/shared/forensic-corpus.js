// Forensic corpus pass — FA.1 (docs/CORPUS_AUDIT_KICKOFF.md §4b).
// The pure half: the per-subject cross-article evidence bundle, the
// propose_forensic_findings tool, and the validation firewall. The
// reader's per-article Suggest structurally cannot see a maneuver
// pattern that spans a subject's statements over time — this pass can,
// and everything else stays the CRIMINOLOGY_DESIGN methodology:
// structure not intent (no honesty/confidence field exists anywhere),
// evidence-bound anchors (every quote grounded in STORED member text),
// falsifiability (counter_note required and rendered FIRST in review).

import { FORENSIC_MANEUVERS, ROLES, BASIS_VALUES, isValidManeuver, isValidRole, isValidBasis }
    from './forensic-taxonomy.js';
import { createGroundingIndex } from './quote-grounding.js';
import { Utils } from './utils.js';

export const FORENSIC_CORPUS_PROMPT_VERSION = 'forensic-corpus-v1';
export const FORENSIC_CORPUS_TOOL_NAME = 'propose_forensic_findings';
export const MAX_FINDINGS_PER_SUBJECT = 5;
export const MAX_SUBJECT_BUNDLE_CHARS = 60000;
export const MAX_FORENSIC_OUTPUT_TOKENS = 8192;

/**
 * The subject's cross-article evidence bundle: every claim naming them
 * (with quotes) and their mention contexts, per member. Pure over
 * injected data; char-capped, drop disclosed.
 *
 * @returns {{bundle: string, memberTexts: Object<url, string>, sources: number, truncated: boolean}}
 */
export function buildSubjectBundle({ subject, claims = [], articles = [] } = {}) {
    const lines = [`SUBJECT: ${subject.name} (${subject.type})`];
    const memberTexts = {};
    const perUrl = new Map();
    for (const rec of articles) {
        if (!rec || !rec.url || !rec.article) continue;
        const url = Utils.normalizeUrl(rec.url);
        for (const ref of (rec.article.entities || [])) {
            if (ref && ref.entity_id === subject.id && ref.context) {
                (perUrl.get(url) || perUrl.set(url, []).get(url))
                    .push(`mention: "${String(ref.context).slice(0, 300)}"`);
            }
        }
    }
    for (const c of claims) {
        if (!c || !c.source_url) continue;
        if (!(c.about || []).includes(subject.id) && c.source !== subject.id) continue;
        const url = Utils.normalizeUrl(c.source_url);
        (perUrl.get(url) || perUrl.set(url, []).get(url))
            .push(`claim: "${(c.text || '').slice(0, 200)}"${c.quote ? ` — quote: "${String(c.quote).slice(0, 300)}"` : ''}`);
    }
    let used = 0;
    let truncated = false;
    for (const [url, entries] of perUrl) {
        const rec = articles.find((r) => r && Utils.normalizeUrl(r.url) === url);
        const title = (rec && rec.article && rec.article.title) || url;
        const blockLines = [`SOURCE <${url}> — ${title}`, ...entries];
        const block = blockLines.join('\n');
        if (used + block.length > MAX_SUBJECT_BUNDLE_CHARS) { truncated = true; continue; }
        used += block.length;
        lines.push('', block);
        // The grounding substrate for the firewall: what we STORED
        // about this subject on this member (never re-fetched).
        memberTexts[url] = entries.join('\n');
    }
    return { bundle: lines.join('\n'), memberTexts, sources: perUrl.size, truncated };
}

export function buildForensicCorpusTool() {
    return {
        name: FORENSIC_CORPUS_TOOL_NAME,
        description: 'Propose behavioral findings about THIS subject across the supplied sources. '
            + 'Describe structure, never intent; every anchor quote is machine-checked; every '
            + 'finding needs an honest counter-read. A human reviews everything.',
        input_schema: {
            type: 'object',
            required: ['findings'],
            properties: {
                findings: {
                    type: 'array',
                    items: {
                        type: 'object',
                        required: ['maneuver', 'anchors', 'counter_note', 'basis', 'role'],
                        properties: {
                            maneuver: { type: 'string', enum: [...FORENSIC_MANEUVERS] },
                            role: { type: 'string', enum: [...ROLES] },
                            basis: { type: 'string', enum: [...BASIS_VALUES] },
                            anchors: {
                                type: 'array',
                                description: 'The evidence chain, in order. 2+ sources make the pattern.',
                                items: {
                                    type: 'object',
                                    required: ['url', 'quote'],
                                    properties: {
                                        url: { type: 'string', description: 'A SOURCE url from the bundle.' },
                                        quote: { type: 'string', description: 'VERBATIM from that source\'s supplied material. Machine-checked.' }
                                    }
                                }
                            },
                            counter_note: { type: 'string', description: 'The honest innocent reading of the same evidence (required — falsifiability).' },
                            note: { type: 'string', description: 'One sentence naming the pattern.' }
                        }
                    }
                }
            }
        }
    };
}

export function buildForensicCorpusSystemPrompt() {
    return [
        'You are a forensic analyst of PUBLIC STATEMENTS. Given one subject\'s statements and',
        'mentions across several sources, propose behavioral findings — maneuvers the subject',
        'performs around the truth — via the propose_forensic_findings tool.',
        'RULES (the methodology is normative):',
        '- STRUCTURE, NOT INTENT: describe what the text does. Never assert lying, deception,',
        '  motive, or state of mind. There is no field for them; do not smuggle them into notes.',
        '- Every anchor quote must be VERBATIM from the supplied material for its named source.',
        '  Altered text is discarded by a machine check.',
        '- A pattern needs the chain: prefer findings whose anchors span two or more sources.',
        '- counter_note is the honest INNOCENT reading of the same evidence — write it as if',
        '  defending the subject; a weak strawman counter-read is grounds for rejection.',
        '- Fewer, better-evidenced findings beat many speculative ones. An empty list is fine.'
    ].join('\n');
}

export function buildForensicCorpusUserPrompt(bundle) {
    return `${bundle}\n\nPropose behavioral findings via the tool.`;
}

const INTENT_WORDS = /\b(lying|liar|lied|deceiv|dishonest|bad faith|intends? to mislead|deliberately false)\b/i;

/**
 * The firewall. Grounds every anchor against the subject's STORED
 * per-source material; enforces taxonomy, counter-reads, the intent
 * red line (Rule 1 — even in free-text notes), and the per-subject cap.
 */
export function validateForensicProposals(findings, { memberTexts = {} } = {}) {
    const accepted = [];
    const rejected = [];
    const fail = (f, reason) => rejected.push({ finding: f, reason });
    const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    for (const f of Array.isArray(findings) ? findings : []) {
        if (!f || typeof f !== 'object') { fail(f, 'Not a finding'); continue; }
        if (accepted.length >= MAX_FINDINGS_PER_SUBJECT) { fail(f, `Over the per-subject cap (${MAX_FINDINGS_PER_SUBJECT})`); continue; }
        if (!isValidManeuver(f.maneuver)) { fail(f, `Invalid maneuver: ${f.maneuver}`); continue; }
        if (!isValidRole(f.role)) { fail(f, `Invalid role: ${f.role}`); continue; }
        if (!isValidBasis(f.basis)) { fail(f, `Invalid basis: ${f.basis}`); continue; }
        if (!String(f.counter_note || '').trim()) { fail(f, 'Missing the counter-read (falsifiability)'); continue; }
        if (INTENT_WORDS.test(`${f.note || ''} ${f.counter_note || ''}`)) {
            fail(f, 'Asserts intent/dishonesty — structure only (Rule 1)'); continue;
        }
        const anchors = Array.isArray(f.anchors) ? f.anchors : [];
        if (anchors.length === 0) { fail(f, 'No evidence anchors'); continue; }
        const grounded = anchors.every((a) => {
            const text = memberTexts[Utils.normalizeUrl((a && a.url) || '')];
            return text && a.quote && norm(text).includes(norm(a.quote));
        });
        if (!grounded) { fail(f, 'An anchor quote does not ground in its source\'s stored material'); continue; }
        accepted.push(f);
    }
    return { accepted, rejected };
}

// Reused by the grounding substrate above — a per-source index is
// overkill for containment checks, but exported for FA.2's span join.
export { createGroundingIndex };
