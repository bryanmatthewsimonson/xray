// Lens-reading prompt + tool — Phase 16.2
// (docs/MORAL_LENS_JURISDICTION_DESIGN.md §6, §7, §10, Appendix A).
//
// PURE module: no network, no chrome, no DOM. Authored from Appendix A
// (the re-authored normative input — the original "system-prompt
// draft" was never committed). One jurisdiction per call (§6 call
// topology); the tool input_schema is built FROM lens-schemas.js's
// MODEL_OUTPUT_SCHEMA so the model is guided by the exact shape the
// parse-time validator enforces — one source of truth, no drift.
//
// The jurisdiction-identity fields are INJECTED into the prompt and
// re-attached to the parsed output by code (lens-engine.js), never
// asked of the model — the audit-prompt inject-never-ask idiom. The
// model is asked only for readings, a reconstruction summary, and its
// own honesty flags (thin coverage, recommended sources).
//
// LENS_PROMPT_VERSION rides the §7 provenance block and is pinned by
// an exact-match test (the CURRENT_MODULE_VERSIONS "bump alongside the
// prompt" idiom) — bump it whenever the prompt text below changes
// meaningfully.

import { MODEL_OUTPUT_SCHEMA } from './lens-schemas.js';
import {
    LENS_ASSERTION_TYPE_LABELS, DISPOSITIONS, CORPUS_STANCES,
    UNCITED_DISPOSITIONS, GROUNDING_LEVELS
} from './lens-taxonomy.js';

export const LENS_PROMPT_VERSION = '1.0';
export const LENS_TOOL_NAME = 'emit_lens_reading';

/**
 * The single forced tool. Its input is this jurisdiction's readings of
 * the listed claims plus a reconstruction summary — nothing else. The
 * grounding report counts, the panel composition, and every
 * jurisdiction-identity field are computed in code, never asked of the
 * model.
 */
export function buildLensTool() {
    return {
        name: LENS_TOOL_NAME,
        description:
            'Emit this jurisdiction\'s reading of each listed assertion, matching the schema. '
            + 'One reading per claim id. Cite loaded authorities by their authority_id; '
            + 'paraphrase-first, quoting at most the stored excerpt text. Where the loaded '
            + 'corpus does not address an assertion, the honest answer is silent — never a guess.',
        input_schema: MODEL_OUTPUT_SCHEMA
    };
}

function formatCitationLine(authority) {
    const c = authority.citation || {};
    const bits = [c.work];
    if (c.edition) bits.push(c.edition);
    if (c.isbn) bits.push(`ISBN ${c.isbn}`);
    bits.push(c.locator);
    let line = bits.filter(Boolean).join(', ');
    if (c.tradition) line += ` — tradition/strand: ${c.tradition}`;
    if (c.language) line += ` [${c.language}]`;
    return line;
}

function corpusBlock(authorities) {
    return authorities.map((a) =>
        `[${a.authority_id}] ${formatCitationLine(a)} (admissibility: ${a.admissibility})\n`
        + `    excerpt (verbatim, the outer bound of what you may quote):\n`
        + `    "${a.excerpt}"`
    ).join('\n\n');
}

/**
 * System prompt for one jurisdiction: the eight Appendix A.1
 * principles, the §3.2 firewall, the §10 quoting discipline, and the
 * jurisdiction's own identity + loaded corpus, injected verbatim.
 *
 * Pure by construction: the ADMISSIBLE authority set and the effective
 * living-person bit are computed by the caller (lens-engine.js /
 * llm-client.js own the registry access and the §9 Q1 filtering) —
 * this module only renders what it is handed.
 *
 * @param {object} params
 * @param {object} params.jurisdiction  the registry record (identity fields)
 * @param {Array<object>} params.authorities  the ADMISSIBLE corpus rows
 * @param {boolean} [params.living]  the effective guardrail bit
 *   (treatAsLiving — unknown already resolved to true by the caller)
 * @returns {string}
 */
export function buildLensSystemPrompt({ jurisdiction, authorities = [], living = false }) {
    const j = jurisdiction || {};
    const divisions = Array.isArray(j.internal_divisions) ? j.internal_divisions : [];

    const identity = [
        `Jurisdiction: ${j.display_name} (${j.jurisdiction_type})`,
        divisions.length
            ? `Internal divisions (pluralism is encoded — say WHICH strand a reading reconstructs; there is never one decree for a divided tradition): ${divisions.join('; ')}`
            : null,
        living
            ? 'LIVING-PERSON GUARDRAIL: this persona is (or must be treated as) a living person. Reconstruct PUBLISHED POSITIONS ONLY — never inferred private belief, motive, or character. If the loaded published corpus does not carry a position, the reading is silent.'
            : null
    ].filter(Boolean).join('\n');

    return `You are X-Ray's lens-reading engine. You reconstruct how ONE named perspective — a jurisdiction — would read specific assertions from an article, grounded ONLY in that jurisdiction's loaded corpus of authorities. You speak in the perspective's voice, never the tool's, and you never rule on what is true.

${identity}

LOADED CORPUS (the ONLY admissible ground — your background knowledge of this tradition, author, or legal code is inadmissible; if the corpus does not carry it, the reading cannot use it):

${corpusBlock(authorities)}

GOVERNING PRINCIPLES (non-negotiable):
1. Ground-in-corpus. Every reading traces to the loaded authorities above, cited by authority_id and locator with an honest grounding level (${GROUNDING_LEVELS.join(' | ')}). A locator you cannot anchor to a named edition makes the grounding "inference" AND gets a thin_coverage_flags entry naming which authority could not be anchored and why.
2. Lens-vs-truth separation. You never pronounce a fact true or false. For assertions marked FACTUAL you may only describe the corpus — corpus_stance: ${CORPUS_STANCES.join(' | ')} — a statement about the corpus, not about reality. Factual assertions never get a disposition.
3. Steelman. Reconstruct the strongest good-faith version of the jurisdiction's response — the reading a thoughtful adherent would recognize as fair — never a caricature.
4. Encoded pluralism. Where the tradition is internally divided, say which strand your reading reconstructs, and where the strands would part ways.
5. Living-person guardrail. Published positions only, where it applies (stated above when it does).
6. Calibrated confidence. confidence (high | medium | low) measures reconstruction FIDELITY — how directly the corpus addresses the assertion, how unified the tradition is, how much inference was required. Never how true the assertion is, and never how strongly the jurisdiction feels.
7. Cite-precedent / flag-silence. Every disposition cites authorities. Where the corpus is silent, the reading is "silent" — plus recommended_sources naming what would need to be loaded to do better. Where the corpus only thinly or obliquely addresses a claim, say so in thin_coverage_flags. An uncited reading is only valid as ${UNCITED_DISPOSITIONS.join(' or ')} (or a silent corpus_stance).
8. Split content from framing. Evaluate an assertion's substance and its framing SEPARATELY in content_vs_framing — the jurisdiction may endorse what is said and reject how it is said.

DISPOSITIONS (non-factual assertions only): ${DISPOSITIONS.join(' | ')}.

QUOTING DISCIPLINE: cite by locator; paraphrase by default. You may quote AT MOST the stored excerpt text given above — never more, never from memory.

OUTPUT: use the ${LENS_TOOL_NAME} tool and nothing else. Exactly one reading per listed claim id — do not re-echo claim text, do not add claims, do not describe the panel or other jurisdictions.`;
}

/**
 * The user turn: the typed assertion list + the article text (for
 * context — framing readings need the surrounding text). The claim
 * list is the code-side §7 target set; ids and types are authoritative.
 */
export function buildLensUserPrompt({ articleText = '', articleTitle = '', articleUrl = '', claims = [] } = {}) {
    const meta = (articleTitle || articleUrl)
        ? `Article under reading: ${articleTitle ? `"${articleTitle}"` : ''}${articleUrl ? ` <${articleUrl}>` : ''}\n\n`
        : '';
    const claimLines = claims.map((c) =>
        `- claim_id: ${c.id} [${String(c.type).toUpperCase()} — ${LENS_ASSERTION_TYPE_LABELS[c.type] || c.type}]\n  "${c.text}"`
    ).join('\n');

    return `${meta}Read the following assertions under the jurisdiction defined in your instructions. Assertions marked FACTUAL get a corpus_stance only (what the loaded corpus says, descriptively); all others get a disposition.

ASSERTIONS:
${claimLines}

ARTICLE TEXT (context for the assertions — especially framing):
---
${articleText}
---`;
}
