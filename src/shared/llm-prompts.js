// LLM-assist prompts + tool schema — Phase 14.5
// (docs/PHASE_14_5_LLM_ASSIST_KICKOFF.md).
//
// PURE module: no network, no chrome, no DOM. It defines (1) the model
// roster the Options picker offers, (2) the single `propose_capture`
// tool whose JSON-Schema maps onto the existing model `create()` inputs,
// and (3) the system prompt — built from the SAME taxonomy modules the
// validators read, so the embedded vocabulary can never drift from what
// the firewall accepts.
//
// The suggestion engine returns VERBATIM quotes (so the reader can
// resolve them to anchors) and stamps nothing itself: provenance
// (`suggested_by: 'llm:<model>'`) is applied at accept-time by the
// reader, against the model id actually used. Quotes are machine-
// checked against the article (shared/quote-grounding.js): a claim or
// finding whose quote cannot be located cannot be accepted, so the
// prompt is blunt with the model about what a quote must be.

import {
    ASSESSMENT_LABEL_GROUPS, STANCE_LABELS, STANCE_VALUES,
    CLAIM_RELATIONSHIPS, REVISION_RELATIONSHIPS
} from './assessment-taxonomy.js';
import {
    FORENSIC_MANEUVER_GROUPS, MANEUVER_GUIDE, ROLES, BASIS_VALUES
} from './forensic-taxonomy.js';
import { ENTITY_TYPES } from './entity-model.js';

// The entity types the MODEL may propose. A `case` is the RESEARCHER's
// investigation workspace — authored fields only (entity-field-schemas.js),
// never a thing named inside an article — so the model is structurally
// unable to mint one; humans create cases in the side panel, which
// remains the only path. Papers, lawsuits, books, products type as
// `thing`. (ENTITY_TYPES itself is untouched: it is wire-visible via
// the kind-0 `about` parse in adopt-entity.js and must keep `case`.)
export const SUGGESTABLE_ENTITY_TYPES = Object.freeze(
    ENTITY_TYPES.filter((t) => t !== 'case'));

// ------------------------------------------------------------------
// Model roster — exact ids only (no date suffixes). Default to the
// latest capable Claude; the Options picker renders these.
// ------------------------------------------------------------------

// Ordered most-capable-first; the Options picker renders this verbatim.
// Adding a model is this line + nothing else — every caller resolves
// through resolveModel(), and the corpus/lens/audit passes all read the
// user's stored choice. Cost note (per MTok in/out, 2026-07): Fable 5
// $10/$50 · Opus 4.8 $5/$25 · Sonnet 5 $3/$15 · Haiku 4.5 $1/$5.
export const LLM_MODELS = Object.freeze([
    { id: 'claude-fable-5',    label: 'Claude Fable 5 (most capable — highest cost)' },
    { id: 'claude-opus-4-8',   label: 'Claude Opus 4.8 (most capable Opus)' },
    { id: 'claude-opus-4-7',   label: 'Claude Opus 4.7' },
    { id: 'claude-sonnet-5',   label: 'Claude Sonnet 5 (near-Opus quality, Sonnet cost)' },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (balanced)' },
    { id: 'claude-haiku-4-5',  label: 'Claude Haiku 4.5 (fastest / cheapest)' }
]);

export const DEFAULT_LLM_MODEL = 'claude-opus-4-8';

// Dedicated chrome.storage.local keys. The API key is a SECRET (its own
// key, never `preferences`, never exported, never logged); the model is
// a plain preference. Defined here (pure module) so the Options page and
// the SW client share them without the page importing the fetch client.
export const LLM_KEY_STORAGE   = 'xray:llm:key';
export const LLM_MODEL_STORAGE = 'xray:llm:model';

export function isKnownModel(id) {
    return LLM_MODELS.some((m) => m.id === id);
}

/** Map an arbitrary stored value to a real model id (defaulting). */
export function resolveModel(id) {
    return isKnownModel(id) ? id : DEFAULT_LLM_MODEL;
}

// The Anthropic Messages API surface this module targets. The client
// (src/shared/llm-client.js) is the only thing that reads these.
export const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
export const ANTHROPIC_VERSION = '2023-06-01';

// The set of artifact kinds a pass can request. 'all' covers them all.
export const SUGGEST_TASKS = Object.freeze([
    'all', 'entities', 'claims', 'facts', 'assessments', 'relationships', 'findings'
]);

// The selectable suggestion categories (SUGGEST_TASKS without the 'all'
// convenience). Each maps to a rules block in buildSystemPrompt and a
// checkbox in Options. Default ON = the EXTRACTION kinds only (entities,
// claims); the JUDGMENT kinds (relationships, assessments, findings) are
// opt-in. The rationale: a false-positive extraction is a one-click
// reject, but a false-positive judgment is the tool manufacturing a
// verdict — the exact thing X-Ray refuses to render automatically.
export const SUGGEST_KINDS = Object.freeze(SUGGEST_TASKS.filter((t) => t !== 'all'));
export const SUGGEST_DEFAULT_KINDS = Object.freeze(['entities', 'claims']);
export const LLM_SUGGEST_KINDS_STORAGE = 'xray:llm:suggest_kinds';

// Category metadata for the Options checkboxes (rendered in this order).
export const SUGGEST_KIND_LABELS = Object.freeze([
    { kind: 'entities', label: 'Entities',
        hint: 'people, organizations, places, and things named in the text' },
    { kind: 'claims', label: 'Claims',
        hint: 'atomized assertions the article makes, each anchored to a verbatim quote' },
    { kind: 'facts', label: 'Entity facts',
        hint: 'structured biographical values (birth date, headquarters, role) — ONLY what this article\u2019s text asserts, never the model\u2019s own knowledge' },
    { kind: 'relationships', label: 'Relationships (evidence links)',
        hint: 'typed links between claims — most useful across multiple articles' },
    { kind: 'assessments', label: 'Assessments',
        hint: 'a stance / issue labels on a claim — your judgment to own, not the model’s' },
    { kind: 'findings', label: 'Forensic findings',
        hint: 'structural maneuvers, plus baselines & story-change edges — experimental' }
]);

// Proposal kind → selectable category. Baselines and revisions ride with
// the forensic-findings layer (the prompt bundles their rules with it).
const PROPOSAL_KIND_TO_CATEGORY = Object.freeze({
    entity: 'entities', claim: 'claims', fact: 'facts', assessment: 'assessments',
    relationship: 'relationships', finding: 'findings',
    baseline: 'findings', revision: 'findings'
});

/** The selectable category a raw proposal kind belongs to (or null). */
export function categoryOfProposalKind(kind) {
    return PROPOSAL_KIND_TO_CATEGORY[kind] || null;
}

/**
 * Coerce a stored value into a valid enabled-kinds array. An ABSENT
 * value (not an array) falls back to the defaults; an explicit array is
 * filtered to known categories (and may be empty — the user turned
 * everything off, which the caller treats as "nothing to suggest").
 */
export function normalizeSuggestKinds(value) {
    if (!Array.isArray(value)) return SUGGEST_DEFAULT_KINDS.slice();
    return value.filter((k) => SUGGEST_KINDS.includes(k));
}

// ------------------------------------------------------------------
// Tool schema — one discriminated-union tool keyed by `kind`. We do NOT
// use strict mode: the real firewall is each model's create() at accept
// time, so the schema stays permissive and human-readable. Every field
// is optional; `kind` selects which ones matter.
// ------------------------------------------------------------------

const PROPOSAL_KINDS = Object.freeze([
    'entity', 'claim', 'fact', 'assessment', 'relationship', 'finding', 'baseline', 'revision'
]);

export function buildSuggestTool() {
    return {
        name: 'propose_capture',
        description:
            'Propose capture artifacts extracted from the article for HUMAN REVIEW. '
            + 'Every item is a draft a person will confirm, edit, or reject — you never '
            + 'save or publish anything. Use local string refs (e.g. "E1", "C1") to link '
            + 'claims to their about-entities and relationships/findings to their claims.',
        input_schema: {
            type: 'object',
            properties: {
                proposals: {
                    type: 'array',
                    description: 'The proposed artifacts, in any order.',
                    items: {
                        type: 'object',
                        properties: {
                            kind: {
                                type: 'string',
                                enum: PROPOSAL_KINDS,
                                description: 'Which artifact this is.'
                            },
                            ref: {
                                type: 'string',
                                description: 'A short local id you assign to an entity ("E1") '
                                    + 'or claim ("C1"), so other proposals can reference it.'
                            },
                            // entity
                            name: {
                                type: 'string',
                                description: 'Entity display name (kind=entity). May add disambiguation '
                                    + 'beyond the article’s wording ("Elena Vargas", not "the mayor").'
                            },
                            entity_type: {
                                type: 'string', enum: SUGGESTABLE_ENTITY_TYPES,
                                description: 'Entity type (kind=entity) — always set it. Papers, lawsuits, '
                                    + 'books, products, reports, and named studies/cohorts are "thing" — '
                                    + 'never propose a case. If unsure, use "thing".'
                            },
                            mention: {
                                type: 'string',
                                description: 'REQUIRED for kind=entity: ONE contiguous VERBATIM span where '
                                    + 'the article names this entity, copied character for character. It is '
                                    + 'machine-checked against the article text; an entity whose mention '
                                    + 'cannot be located there is rejected. name may differ from mention — '
                                    + 'mention may not differ from the article.'
                            },
                            // claim
                            text: {
                                type: 'string',
                                description: 'The atomized assertion, in your own words (kind=claim).'
                            },
                            quote: {
                                type: 'string',
                                description: 'REQUIRED for kind=claim: ONE contiguous VERBATIM span from '
                                    + 'the article the claim is drawn from, copied character for character '
                                    + '(keep punctuation, capitalization, typos). It is machine-checked '
                                    + 'against the article text; a claim whose quote cannot be located '
                                    + 'there is rejected.'
                            },
                            about: {
                                type: 'array', items: { type: 'string' },
                                description: 'Entity refs ("E1") this claim concerns (kind=claim).'
                            },
                            is_key: {
                                type: 'boolean',
                                description: 'True if this is a central/load-bearing claim (kind=claim).'
                            },
                            // fact (Phase 19.6) — a structured biographical value the
                            // ARTICLE asserts, riding a claim. quote is REQUIRED and
                            // machine-checked; the value must come from the text, never
                            // from your own knowledge of the entity.
                            subject_ref: {
                                type: 'string',
                                description: 'REQUIRED for kind=fact: the entity ref ("E1") this fact '
                                    + 'describes. For kind=finding/baseline: the subject performing '
                                    + 'the maneuver.'
                            },
                            field: {
                                type: 'string',
                                description: 'REQUIRED for kind=fact: the typed field name from the subject\'s '
                                    + 'registry (person: birth_date, death_date, occupation, affiliation, role, '
                                    + 'religion, residence, nationality, education; organization: founded, '
                                    + 'dissolved, headquarters, leadership, org_type, parent_org; place: '
                                    + 'located_in, place_type; thing: thing_type, creator, created_date) — or '
                                    + '"custom:<lowercase-token>" for a field the registry lacks.'
                            },
                            value: {
                                type: 'string',
                                description: 'REQUIRED for kind=fact: the value AS THIS ARTICLE\'S TEXT states '
                                    + 'it (dates as "1962", "1962-03", or "1962-03-15" — only as precise as the '
                                    + 'text is). NEVER supply a value from your own knowledge of the entity.'
                            },
                            value_entity_ref: {
                                type: 'string',
                                description: 'For entity-ref fields (affiliation, leadership, parent_org, '
                                    + 'creator): the entity ref ("E2") the value points at (kind=fact).'
                            },
                            valid_from: {
                                type: 'string',
                                description: 'Validity start as the text states it — "1962", "1962-03", or '
                                    + '"1962-03-15" (kind=fact). Omit when the text gives none.'
                            },
                            valid_to: {
                                type: 'string',
                                description: 'Validity end, same grammar (kind=fact). Omit when open/unstated.'
                            },
                            observed_at: {
                                type: 'string',
                                description: 'When the source observed the value, same grammar (kind=fact).'
                            },
                            // assessment
                            claim_ref: {
                                type: 'string',
                                description: 'The claim ref ("C1") this assessment is about (kind=assessment).'
                            },
                            stance: {
                                type: ['integer', 'null'], enum: [...STANCE_VALUES, null],
                                description: 'Your graded agree↔disagree on the claim, -2..2, or null '
                                    + 'for a label-only assessment (kind=assessment). A PERSONAL judgment, '
                                    + 'not a fact verdict.'
                            },
                            labels: {
                                type: 'array',
                                description: 'Issue labels on the claim (kind=assessment).',
                                items: {
                                    type: 'object',
                                    properties: {
                                        label: { type: 'string', description: 'A taxonomy label or custom token.' },
                                        quote: { type: 'string', description: 'Verbatim span the label points at.' }
                                    },
                                    required: ['label']
                                }
                            },
                            rationale: { type: 'string', description: 'Free-text reasoning (kind=assessment).' },
                            // relationship + revision (both ride kind-30055)
                            source_claim_ref: {
                                type: 'string',
                                description: 'Source claim ref (kind=relationship/revision). For revisions, '
                                    + 'this is the EARLIER statement.'
                            },
                            target_claim_ref: {
                                type: 'string',
                                description: 'Target claim ref (kind=relationship/revision). For revisions, '
                                    + 'the LATER statement.'
                            },
                            relationship: {
                                type: 'string',
                                enum: [...CLAIM_RELATIONSHIPS, ...REVISION_RELATIONSHIPS],
                                description: 'The typed link (kind=relationship uses contradicts/supports/'
                                    + 'updates/duplicates; kind=revision uses narrative-patch/recharacterizes/walks-back).'
                            },
                            note: {
                                type: 'string',
                                description: 'A short note (relationship/revision/finding/baseline).'
                            },
                            // finding + baseline (subject_ref is shared with kind=fact above)
                            subject_label: {
                                type: 'string',
                                description: 'Subject display name, when not one of the proposed entities '
                                    + '(kind=finding/baseline).'
                            },
                            role: {
                                type: 'string', enum: ROLES,
                                description: 'The subject’s role in this exchange (kind=finding).'
                            },
                            maneuver: {
                                type: 'string',
                                description: 'The named maneuver, lowercase, one optional "family/" prefix '
                                    + '(kind=finding). Prefer a standard maneuver from the guide.'
                            },
                            basis: {
                                type: 'string', enum: BASIS_VALUES,
                                description: 'HOW you know — "quoted" only when the evidence is a verbatim '
                                    + 'span; otherwise "paraphrased" / "behavioral-cue" / "structural-inference" '
                                    + '(kind=finding).'
                            },
                            counter_note: {
                                type: 'string',
                                description: 'REQUIRED for a finding: the exonerating / alternative reading — '
                                    + 'what would make this NOT the maneuver. A finding with no counter-read '
                                    + 'is rejected.'
                            },
                            anchors: {
                                type: 'array',
                                description: 'The ordered evidence chain (kind=finding) — at least one, each '
                                    + 'with a VERBATIM quote. Every quote is machine-checked against the '
                                    + 'article text; a finding with an unlocatable quote is rejected.',
                                items: {
                                    type: 'object',
                                    properties: {
                                        quote: { type: 'string', description: 'ONE contiguous verbatim span copied exactly from the article.' },
                                        note:  { type: 'string', description: 'Optional note on this step.' }
                                    },
                                    required: ['quote']
                                }
                            }
                        },
                        required: ['kind']
                    }
                }
            },
            required: ['proposals']
        }
    };
}

// ------------------------------------------------------------------
// System prompt — assembled from the live taxonomy so the embedded
// vocabulary always matches the validators.
// ------------------------------------------------------------------

function labelMenu() {
    return Object.entries(ASSESSMENT_LABEL_GROUPS)
        .map(([group, labels]) => `  - ${group}: ${labels.join(', ')}`)
        .join('\n');
}

function maneuverGuideText() {
    const lines = [];
    for (const [family, maneuvers] of Object.entries(FORENSIC_MANEUVER_GROUPS)) {
        lines.push(`  ${family}:`);
        for (const m of maneuvers) {
            const g = MANEUVER_GUIDE[m] || {};
            const def = g.definition || '';
            const ind = (g.indicators || []).join('; ');
            const counter = (g.counterIndicators || []).join('; ');
            lines.push(`    - ${m} — ${def}`);
            if (ind) lines.push(`        indicators: ${ind}`);
            if (counter) lines.push(`        counter-indicators (what would make it NOT this): ${counter}`);
        }
    }
    return lines.join('\n');
}

function stanceMenu() {
    return STANCE_VALUES.map((v) => `${v} = ${STANCE_LABELS[String(v)]}`).join(', ');
}

const RULES_ALL = `
GROUND RULES (non-negotiable):
- You PROPOSE; a human confirms every item. Nothing you return is saved or published automatically.
- Quote VERBATIM. Every quote must be ONE contiguous span copied exactly from the article text, character for character — keep the article's punctuation, capitalization, and typos. Never paraphrase inside a quote, never merge separate sentences, never add ellipses you didn't see, never fix what the article got wrong.
- Quotes are machine-checked. Each quote is located in the article text before an item can be accepted: a claim or finding whose quote cannot be found is rejected outright, and an assessment label whose quote cannot be found is saved without its anchor. Your conclusion may be your own words — the quote may not.
- Be conservative. Prefer a few high-quality, well-anchored proposals over many weak ones. If the article does not support an artifact, omit it.
- Use the propose_capture tool and nothing else.`;

const RULES_ENTITIES = `
ENTITIES (people / organizations / places / things named in the text):
- name is the DISPLAY name — disambiguate when helpful ("Elena Vargas", not "the mayor"), and reuse the same name for the same real-world entity across proposals.
- mention is REQUIRED: the single verbatim span where the text names this entity. An entity whose mention cannot be located in the article is rejected.
- Give each a short local ref ("E1", "E2", …) so claims and findings can point at it.
- type must be one of: ${SUGGESTABLE_ENTITY_TYPES.join(', ')}. The definitions matter — misclassification is the most common entity error, so read them carefully:
  - person: a named human being.
  - organization: a named institution, company, agency, court, lab, publication, or movement.
  - place: a named geographic or physical location.
  - thing: anything else with a name — a scientific paper, a lawsuit or court case, a book, a study or named cohort, a product, a report, a policy, a dataset, an event. When in doubt, it is a thing.
- A SCIENTIFIC PAPER is a thing, never anything else. A LAWSUIT or COURT CASE is a thing. In X-Ray, "case" names the researcher's own investigation workspace — it is never named inside an article, it is not in your type list, and you must never propose one.`;

function rulesClaims() {
    return `
CLAIMS (atomized assertions the article makes or reports):
- text is the assertion in clear, standalone form. quote is REQUIRED: the single contiguous VERBATIM span it is drawn from — a claim without a locatable quote is rejected.
- If a conclusion rests on several passages, do not stitch them into one quote: anchor the claim to the single most load-bearing span, and propose the other passages as their own claims (atomize; you can link them with relationships).
- about lists the entity refs the claim concerns (link to your entity proposals).
- Give each claim a ref ("C1", "C2", …) so assessments and relationships can point at it.`;
}

function rulesFacts() {
    return `
ENTITY FACTS (structured biographical values THIS ARTICLE asserts — a fact is a claim with a typed field):
- never supply a value from your own knowledge of the entity — only what this article's text asserts. If you know the WHO was founded in 1948 but this article doesn't say so, there is NO fact to propose.
- quote is REQUIRED: the single contiguous VERBATIM span asserting the value — a fact whose quote cannot be located in the article is rejected.
- subject_ref points at the entity the fact describes (propose the entity too if it isn't already); field comes from the subject's type registry or "custom:<token>".
- value carries EXACTLY the precision the text does: a year stays "1962" — never expand to a full date the text didn't state. Same for valid_from/valid_to/observed_at.
- for entity-ref fields (affiliation, leadership, parent_org, creator) also set value_entity_ref to the target entity's ref.
- Give each fact a ref ("F1", "F2", …).`;
}

function rulesAssessments() {
    return `
ASSESSMENTS (your judgment on a claim — a PERSONAL stance, never a fact verdict):
- claim_ref points at the claim. stance is your graded agree↔disagree: ${stanceMenu()}, or null for label-only.
- labels flag issues with the claim. Prefer these standard labels (custom lowercase tokens allowed):
${labelMenu()}
  Attach a verbatim quote to each label where you can.
- Provide at least one of stance or labels. A stance is an opinion to be debated, not a truth ruling.`;
}

function rulesRelationships() {
    return `
RELATIONSHIPS (typed links between two of your proposed claims):
- relationship is one of: ${CLAIM_RELATIONSHIPS.join(', ')}.
- source_claim_ref and target_claim_ref both reference claims you proposed above.`;
}

function rulesFindings() {
    return `
FINDINGS (the criminology layer — name a structural MANEUVER a subject performs around the truth):
- A finding describes a MOVE, never a verdict. There is NO field for intent, honesty, lying, or a score, by design — do not assert any.
- subject_ref (or subject_label) identifies who. role is one of: ${ROLES.join(', ')}.
- ATTRIBUTION — the most common error, so read carefully: the subject is the party who
  PERFORMED the move — the speaker of the quoted words or the actor of the described
  behavior. An author who describes, quotes, or criticizes SOMEONE ELSE's maneuver is
  NOT performing it. When an article reports "X said the criticism was politically
  motivated", the deflection is X's move, not the reporter's — even though the only
  verbatim span available is the reporter's sentence. Anchor to that span, attribute
  to X, and set basis "paraphrased" (the anchor evidences the move second-hand).
  If you cannot determine WHO performed a move, OMIT the finding entirely.
- maneuver names the move. Prefer a standard maneuver from the guide below; a lowercase custom
  token is allowed, and the fallacy/<token> namespace is valid for classical argumentation
  fallacies the guide doesn't list.
- anchors is the evidence chain: at least ONE anchor, each with a VERBATIM quote. A finding with no quoted evidence is rejected.
- counter_note is REQUIRED: the strongest alternative / exonerating reading — what would make this NOT the maneuver. A finding with no counter-read is rejected.
- basis records how you know: use "quoted" ONLY when the evidence is the subject's own verbatim words; otherwise "paraphrased", "behavioral-cue", or "structural-inference".
- Run this symmetrically — apply the same scrutiny to every SPEAKER whose own moves the
  text carries. Symmetric scrutiny means no party's moves are exempt; it does NOT mean
  attributing the covered parties' moves to the journalist reporting them.

MANEUVER GUIDE (definition / indicators / counter-indicators):
${maneuverGuideText()}`;
}

function rulesRevisionsBaselines() {
    return `
REVISIONS (a subject's self-serving story-change between two of your claims — secondary):
- relationship is one of: ${REVISION_RELATIONSHIPS.join(', ')}. source is the EARLIER statement, target the LATER.

BASELINES (a subject's established register — secondary, descriptive prose, no score):
- subject_ref/subject_label + a descriptive note. Never a rating.`;
}

/**
 * Build the system prompt for a pass. `tasks` (an array of categories)
 * selects which artifact rules to embed; the heavy maneuver guide is only
 * included when findings are in scope, to bound tokens. `task` (a single
 * string, 'all' by default) is kept for back-compat and is used only when
 * `tasks` is not supplied.
 *
 * @param {object} [opts]
 * @param {string[]} [opts.tasks]   enabled categories (preferred)
 * @param {string} [opts.task='all'] single category, or 'all' (fallback)
 * @param {string} [opts.url]
 * @param {string} [opts.title]
 */
export function buildSystemPrompt({ tasks = null, task = 'all', url = '', title = '', caseName = '', scopeQuestion = '' } = {}) {
    const effective = Array.isArray(tasks)
        ? tasks.filter((t) => SUGGEST_KINDS.includes(t))
        : (task === 'all' ? SUGGEST_KINDS.slice()
            : (SUGGEST_KINDS.includes(task) ? [task] : SUGGEST_KINDS.slice()));
    const wants = (kind) => effective.includes(kind);

    const head = `You are X-Ray's capture assistant. You read an article a person has captured and propose structured "capture artifacts" — entities, claims, assessments, relationships, and forensic findings — for that person to review and confirm. X-Ray is an evidence tool: it records WHAT was said and the STRUCTURE of how it was argued, and it renders no automated verdicts on truth or intent.`;

    const meta = (title || url)
        ? `\nArticle: ${title ? `"${title}"` : ''}${url ? ` <${url}>` : ''}`
        : '';

    // 28.3 — the researcher's active case frames the extraction: prefer
    // what is relevant to it, but faithfulness rules everything above
    // preference — and CW.1's no-minting rule gets restated where the
    // frame might otherwise tempt the model.
    const caseFrame = caseName
        ? `\nThe researcher's ACTIVE CASE: "${caseName}".${scopeQuestion ? ` Its scope question: "${scopeQuestion}".` : ''}`
            + ' Prefer artifacts relevant to this case when the article offers a choice, but extract FAITHFULLY:'
            + ' never invent relevance, and never propose the case itself as an entity.'
        : '';

    const parts = [head + meta + caseFrame, RULES_ALL];
    if (wants('entities'))      parts.push(RULES_ENTITIES);
    if (wants('claims'))        parts.push(rulesClaims());
    if (wants('facts'))         parts.push(rulesFacts());
    if (wants('assessments'))   parts.push(rulesAssessments());
    if (wants('relationships')) parts.push(rulesRelationships());
    if (wants('findings'))    { parts.push(rulesFindings()); parts.push(rulesRevisionsBaselines()); }
    return parts.join('\n');
}

/** The user-turn content: the article text the model extracts from. */
export function buildUserPrompt({ articleText = '', context = '' } = {}) {
    const ctx = context ? `\n\nAdditional context:\n${context}` : '';
    return `Here is the captured article text. Propose capture artifacts via propose_capture.\n\n---\n${articleText}\n---${ctx}`;
}
