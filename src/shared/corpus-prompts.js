// Case-corpus synthesis prompts — Phase 20.4
// (docs/CASE_SYNTHESIS_DESIGN.md). The pure prompt-and-tool layer for
// the two-stage map/reduce over a case's member articles:
//   MAP    — one call per article: what position does THIS article
//            argue, which assertions are load-bearing, whom does it
//            cite. Quotes are verbatim, machine-checked downstream.
//   REDUCE — one call over the compact map outputs + the deterministic
//            dossier digest: a grounded case brief (summary, positions,
//            cruxes of disagreement, load-bearing claims, coverage gaps)
//            plus reviewable proposals (cross-article links, is_key,
//            new claims).
//
// PHILOSOPHY (docs/PHILOSOPHY.md, CASE_DOSSIER_DESIGN §2.2): NO fused
// case score, NO verdict — neither tool schema has a numeric slot, and
// the reduce prompt forbids adjudicating between positions. Every quote
// is verbatim from the named member; the reduce may only summarize,
// extract, and surface disagreement side by side. (Phase 23.2 SUPERSEDES
// the original "no wire kind" note: the brief now publishes as a
// readable kind-30023 article AND a structured kind-30068 CaseBrief —
// prose/data only, still no fused score. corpus-publish.js.)
//
// Pure: no chrome, no network, no DOM, no clock. audit-prompt.js /
// lens-prompt.js are the pattern.

import { CLAIM_RELATIONSHIPS } from './assessment-taxonomy.js';

// DISCIPLINE (the 20.6 lesson, institutionalized 27 S.1): a prompt /
// tool / digest change must bump a version so stored briefs correctly go
// stale. The version is SPLIT so reduce-side iteration does not throw
// away the expensive per-article map cache (Phase 20.x):
//   - MAP_PROMPT_VERSION gates the map-extract CACHE key
//     (corpusExtractKey). Bump ONLY when the MAP prompt / tool / user
//     prompt changes — otherwise every cached extract is orphaned.
//   - CORPUS_PROMPT_VERSION is the OVERALL staleness + provenance version
//     (rides corpusInputHash, shown on the brief). Bump on ANY change to
//     either stage.
// They start equal ('corpus-v2') and diverge when a reduce-only change
// bumps the overall version while the map cache stays valid — which is
// exactly this change (representative digest + crux/holder nudge): the
// map prompt is untouched, so MAP_PROMPT_VERSION holds and cached
// extracts survive; CORPUS_PROMPT_VERSION goes to v3 so briefs re-run.
export const MAP_PROMPT_VERSION = 'corpus-v2';
export const CORPUS_PROMPT_VERSION = 'corpus-v3';
export const MAP_TOOL_NAME = 'emit_corpus_extract';
export const REDUCE_TOOL_NAME = 'emit_case_brief';
export const HYPOTHESIS_EDGE_PROMPT_VERSION = 'hyp-edges-v1';
export const HYPOTHESIS_EDGE_TOOL_NAME = 'propose_hypothesis_edges';

// Per-article map input bound — half the audit's 120k: 10–30 members
// make cost linear, and position/assertion extraction doesn't need the
// tail of a very long capture. Truncation is disclosed per member.
export const MAX_MEMBER_INPUT_CHARS = 60000;
export const MAX_CLAIMS_DIGEST_CHARS = 4000;
export const MAX_MAP_OUTPUT_TOKENS = 8192;
export const MAX_REDUCE_OUTPUT_TOKENS = 16384;
export const MAX_HYPOTHESIS_EDGE_OUTPUT_TOKENS = 8192;

// ------------------------------------------------------------------
// MAP — one article's position + load-bearing assertions
// ------------------------------------------------------------------

export function buildMapTool() {
    return {
        name: MAP_TOOL_NAME,
        description: 'Report what THIS ONE article argues about the case — its position, its '
            + 'load-bearing assertions (each grounded in a verbatim quote), and the outside '
            + 'sources it points at. Do NOT adjudicate; report what the article claims.',
        input_schema: {
            type: 'object',
            properties: {
                position: {
                    type: 'object',
                    description: 'The stance this article takes on the case question.',
                    properties: {
                        summary: { type: 'string', description: 'One or two sentences: what this article argues.' },
                        side_label: { type: ['string', 'null'], description: 'A short label for the side it takes (e.g. "lab leak", "zoonosis"), or null if it takes none.' }
                    }
                },
                key_assertions: {
                    type: 'array',
                    description: 'The load-bearing claims this article makes — the ones its position rests on.',
                    items: {
                        type: 'object',
                        properties: {
                            quote: { type: 'string', description: 'ONE contiguous VERBATIM span copied from THIS article, character for character. Machine-checked — an unlocatable quote is dropped.' },
                            claim_ref: { type: ['string', 'null'], description: 'An EXISTING claim id from the supplied claims digest that states this assertion, or null if none.' },
                            why_load_bearing: { type: 'string', description: 'Why this assertion carries weight for the position.' }
                        },
                        required: ['quote']
                    }
                },
                source_references: {
                    type: 'array',
                    description: 'Outside sources this article cites in support.',
                    items: {
                        type: 'object',
                        properties: {
                            quote: { type: 'string', description: 'The verbatim span naming/using the source.' },
                            target_hint: { type: 'string', description: 'The cited outlet / url / title as written.' }
                        },
                        required: ['quote']
                    }
                },
                open_questions: {
                    type: 'array',
                    description: 'Questions this article leaves unresolved.',
                    items: { type: 'string' }
                }
            },
            required: ['position']
        }
    };
}

export function buildMapSystemPrompt({ caseName = '', scopeQuestion = '' } = {}) {
    return [
        'You are analyzing ONE article that belongs to a case corpus.',
        caseName ? `The case: "${caseName}".` : '',
        scopeQuestion ? `The question it investigates: "${scopeQuestion}".` : '',
        'Report only what THIS article argues — its position on the case question, the',
        'load-bearing assertions its position rests on, and the outside sources it cites.',
        'RULES:',
        '- Every quote must be ONE contiguous span copied VERBATIM from this article, character',
        '  for character (keep punctuation, capitalization, typos). It is machine-checked; a quote',
        '  that cannot be located in the article is dropped.',
        '- Do NOT adjudicate, rate, or say which side is right. Report the article\'s claims.',
        '- If the article takes no side, say so (side_label = null).',
        '- Prefer claim_ref values from the supplied digest when an assertion matches an existing',
        '  claim; otherwise leave claim_ref null. Never invent a claim id.'
    ].filter(Boolean).join('\n');
}

export function buildMapUserPrompt({ memberText = '', memberMeta = {}, claimsDigest = '' } = {}) {
    const head = [
        memberMeta.title ? `TITLE: ${memberMeta.title}` : '',
        memberMeta.url ? `URL: ${memberMeta.url}` : ''
    ].filter(Boolean).join('\n');
    const digest = claimsDigest
        ? `\n\nEXISTING CLAIMS ALREADY EXTRACTED FROM THIS ARTICLE (id — text):\n${claimsDigest.slice(0, MAX_CLAIMS_DIGEST_CHARS)}`
        : '';
    return `${head}\n\nARTICLE TEXT:\n---\n${memberText}\n---${digest}`;
}

// ------------------------------------------------------------------
// REDUCE — the grounded case brief + proposals
// ------------------------------------------------------------------

export function buildReduceTool() {
    return {
        name: REDUCE_TOOL_NAME,
        description: 'Synthesize a grounded case brief across the corpus: a summary, the positions '
            + 'present (attributed to articles), the cruxes of disagreement side by side, the '
            + 'load-bearing claims, coverage gaps, and reviewable proposals. NEVER a verdict, '
            + 'score, or probability — present disagreement as data, do not resolve it.',
        input_schema: {
            type: 'object',
            properties: {
                summary: { type: 'string', description: 'A neutral overview of what the corpus contains and where it disagrees. No conclusion of your own.' },
                positions: {
                    type: 'array',
                    description: 'The distinct positions the corpus articles take.',
                    items: {
                        type: 'object',
                        properties: {
                            label: { type: 'string', description: 'Short label for the position.' },
                            core_argument: { type: 'string', description: 'The position\'s central argument, in neutral terms.' },
                            holders: {
                                type: 'array',
                                description: 'The member articles that argue this position.',
                                items: { type: 'object', properties: { article_hash: { type: 'string' } }, required: ['article_hash'] }
                            }
                        },
                        required: ['label']
                    }
                },
                cruxes: {
                    type: 'array',
                    description: 'The load-bearing points of disagreement — a resolvable question, the sides\' views side by side, the evidence each cites, and what would resolve it.',
                    items: {
                        type: 'object',
                        properties: {
                            question: { type: 'string', description: 'The disputed question.' },
                            sides: {
                                type: 'array',
                                description: 'Each side\'s view (keyed to a position label). Present side by side; never pick one.',
                                items: {
                                    type: 'object',
                                    properties: {
                                        position_label: { type: 'string' },
                                        view: { type: 'string' }
                                    },
                                    required: ['view']
                                }
                            },
                            evidence_refs: {
                                type: 'array',
                                items: {
                                    type: 'object',
                                    properties: {
                                        article_hash: { type: 'string' },
                                        quote: { type: 'string', description: 'Verbatim span from the named member article.' }
                                    },
                                    required: ['article_hash', 'quote']
                                }
                            },
                            what_would_resolve: { type: 'string', description: 'What evidence or event would settle this crux.' }
                        },
                        required: ['question']
                    }
                },
                load_bearing: {
                    type: 'array',
                    description: 'The claims the whole case most turns on.',
                    items: {
                        type: 'object',
                        properties: {
                            claim_ref: { type: ['string', 'null'], description: 'An existing claim id, or null.' },
                            article_hash: { type: 'string' },
                            quote: { type: 'string', description: 'Verbatim span from the named member.' },
                            why: { type: 'string' }
                        },
                        required: ['article_hash', 'quote']
                    }
                },
                coverage_gaps: {
                    type: 'array',
                    description: 'What the corpus does NOT cover — perspectives, evidence, or questions absent (P6: absence is not evidence of absence).',
                    items: { type: 'string' }
                },
                proposals: {
                    type: 'array',
                    description: 'Reviewable actions a human accepts or rejects — cross-article links, is_key flags, or new claims. Nothing is applied automatically.',
                    items: {
                        type: 'object',
                        properties: {
                            kind: { type: 'string', enum: ['relationship', 'is_key', 'claim'] },
                            source_claim_id: { type: 'string', description: 'relationship: the source claim id (existing).' },
                            target_claim_id: { type: 'string', description: 'relationship: the target claim id (existing).' },
                            relationship: { type: 'string', enum: [...CLAIM_RELATIONSHIPS], description: 'relationship: the typed link.' },
                            claim_id: { type: 'string', description: 'is_key: the existing claim id to flag load-bearing.' },
                            article_hash: { type: 'string', description: 'claim: the member the new claim is drawn from.' },
                            text: { type: 'string', description: 'claim: the claim text.' },
                            quote: { type: 'string', description: 'claim: the verbatim span grounding it.' },
                            note: { type: 'string', description: 'A short rationale.' }
                        },
                        required: ['kind']
                    }
                }
            },
            required: ['summary']
        }
    };
}

export function buildReduceSystemPrompt({ caseName = '', scopeQuestion = '' } = {}) {
    return [
        'You are synthesizing a case brief from per-article extracts and a structured dossier',
        caseName ? `for the case "${caseName}".` : '.',
        scopeQuestion ? `The question it investigates: "${scopeQuestion}".` : '',
        'Produce a grounded brief: a neutral summary, the positions present (attributed to the',
        'member articles that hold them), the cruxes of disagreement with each side\'s view SIDE',
        'BY SIDE, the load-bearing claims, the coverage gaps, and reviewable PROPOSALS.',
        'COMPLETENESS — the brief is a MAP of the WHOLE corpus, not a sample of it:',
        '- In each position\'s `holders`, list EVERY member article (by article_hash) that argues',
        '  that position, not a few examples. The holder lists are how a reader sees where all',
        '  the sources sit; a position held by twenty articles must name twenty holders.',
        '- Enumerate ALL the major cruxes the extracts reveal — the central contested questions of',
        '  the case, INCLUDING the specific scientific/evidentiary disputes surfaced in the',
        '  assertions (do not limit cruxes to those with a claim in the index). Cover every',
        '  significant disagreement rather than stopping at a handful.',
        'PROPOSALS (a human accepts or rejects each — nothing you propose is applied on its own):',
        '- Scan the digest\'s claims index for pairs of claims from DIFFERENT articles (the `art`',
        '  key differs) that contradict, support, update, or duplicate each other. Propose EVERY',
        '  such pair you find as a `relationship` proposal citing both existing claim ids —',
        '  cross-article links are the corpus\'s connective tissue and the primary thing this',
        '  synthesis adds over reading articles one at a time. Do not re-propose pairs already',
        '  listed under `contradictions` in the digest.',
        '- Propose `is_key` for existing claims the whole case turns on, and `claim` for',
        '  load-bearing assertions in the extracts that have no claim yet.',
        '- `art` keys are shorthand for READING the claims index only: the digest\'s `articles`',
        '  object maps each key to its full 64-hex hash. Anywhere the tool asks for an',
        '  `article_hash` (holders, evidence_refs, load_bearing, claim proposals), supply the',
        '  FULL hash from `articles` or the extract headers — never an `art` key.',
        'HARD RULES (docs/PHILOSOPHY.md):',
        '- NEVER output a verdict, score, probability, or "who is right". Disagreement is DATA —',
        '  present it, do not resolve it.',
        '- Every quote must be VERBATIM from the named member article (identified by its',
        '  article_hash). A quote that cannot be located there is dropped downstream.',
        '- Attribute positions only to articles that actually hold them; never invent holders.',
        '- Reference claim ids ONLY from the `claims` index in the dossier digest (each entry is',
        '  `id — text`); never invent, abbreviate, or shorthand a claim id. If no listed claim',
        '  fits a relationship or is_key proposal, OMIT it rather than guessing. Never link a',
        '  claim to itself.',
        '- coverage_gaps must name what the corpus does NOT cover — absence is not evidence of',
        '  absence.'
    ].filter(Boolean).join('\n');
}

// ------------------------------------------------------------------
// HYPOTHESIS EDGES — Phase 26 H.4 (docs/HYPOTHESIS_MAP_DESIGN.md §3)
// ------------------------------------------------------------------
// One reduce-shaped call over the dossier digest + the hypothesis
// list — no per-member map pass: the digest's `claims` index is the
// id-authority (the 20.6 discipline), and an edge's quote grounds
// against the REFERENCED CLAIM's own verbatim text downstream. The
// tool schema has NO numeric slot (grep-tested): an edge is a typed
// attachment, never a weighted one.

export function buildHypothesisEdgeTool() {
    return {
        name: HYPOTHESIS_EDGE_TOOL_NAME,
        description: 'Propose claim→hypothesis attachments: which existing claims support or '
            + 'undermine which hypotheses. Propose for EVERY hypothesis, on BOTH sides where the '
            + 'claims bear on it. NEVER declare a winner, rank the hypotheses, or attach any '
            + 'strength — a human reviews every proposal.',
        input_schema: {
            type: 'object',
            properties: {
                edges: {
                    type: 'array',
                    description: 'The proposed attachments.',
                    items: {
                        type: 'object',
                        properties: {
                            hypothesis_id: { type: 'string', description: 'An id from the supplied hypothesis list. Never invent one.' },
                            claim_ref: { type: 'string', description: 'An EXISTING claim id from the dossier digest\'s claims index. Never invent one.' },
                            role: { type: 'string', enum: ['supports', 'undermines'], description: 'How the claim bears on the hypothesis.' },
                            quote: { type: 'string', description: 'ONE contiguous VERBATIM span copied from that claim\'s text, character for character. Machine-checked — an unlocatable quote drops the edge.' },
                            why: { type: 'string', description: 'One sentence: why this claim bears on this hypothesis this way.' }
                        },
                        required: ['hypothesis_id', 'claim_ref', 'role', 'quote']
                    }
                }
            },
            required: ['edges']
        }
    };
}

export function buildHypothesisEdgeSystemPrompt({ caseName = '', scopeQuestion = '' } = {}) {
    return [
        'You are mapping which captured claims bear on which competing hypotheses',
        caseName ? `for the case "${caseName}".` : '.',
        scopeQuestion ? `The question the case investigates: "${scopeQuestion}".` : '',
        'You are given the case\'s hypothesis list and a deterministic dossier digest whose',
        '`claims` index is the ONLY source of claim ids.',
        'HARD RULES (docs/PHILOSOPHY.md, docs/HYPOTHESIS_MAP_DESIGN.md §3):',
        '- Propose edges for EVERY hypothesis, and on BOTH sides: where the corpus contains a',
        '  claim that undermines a hypothesis, say so. A hypothesis left with only support you',
        '  could not scrutinize is a coverage gap — do not paper over it.',
        '- NEVER declare which hypothesis is right, rank them, or express strength, likelihood,',
        '  or confidence in any form. The map is structure; a human draws every conclusion.',
        '- A claim may support one hypothesis and undermine another — propose both edges.',
        '- hypothesis_id values come ONLY from the supplied list; claim_ref values come ONLY from',
        '  the digest\'s claims index. Never invent, abbreviate, or shorthand an id. If no listed',
        '  claim bears on a hypothesis, propose nothing for it rather than guessing.',
        '- Every quote must be ONE contiguous span copied VERBATIM from the referenced claim\'s',
        '  text. It is machine-checked; an unlocatable quote drops the whole edge.'
    ].filter(Boolean).join('\n');
}

export function buildHypothesisEdgeUserPrompt({ dossierDigest = '', hypotheses = [] } = {}) {
    const hypLines = hypotheses.map((h) =>
        `${h.id} — ${h.label}${h.statement && h.statement !== h.label ? `: ${h.statement}` : ''}`).join('\n');
    return `HYPOTHESES (id — label: statement):\n${hypLines}\n\n`
        + `DOSSIER DIGEST (deterministic, code-computed; its claims index is the only id source):\n${dossierDigest}`;
}

export function buildReduceUserPrompt({ dossierDigest = '', extracts = [] } = {}) {
    const extractText = extracts.map((e) => {
        const lines = [`ARTICLE ${e.article_hash}${e.title ? ` — ${e.title}` : ''}`];
        if (e.extract && e.extract.position) {
            lines.push(`  position: ${e.extract.position.summary || ''}`
                + (e.extract.position.side_label ? ` [side: ${e.extract.position.side_label}]` : ''));
        }
        for (const a of (e.extract && e.extract.key_assertions) || []) {
            lines.push(`  assertion: "${a.quote}"${a.claim_ref ? ` (claim ${a.claim_ref})` : ''}`);
        }
        return lines.join('\n');
    }).join('\n\n');
    return `DOSSIER DIGEST (deterministic, code-computed):\n${dossierDigest}\n\n`
        + `PER-ARTICLE EXTRACTS:\n${extractText}`;
}
