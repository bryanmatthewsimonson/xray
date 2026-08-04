import { readFileSync, writeFileSync } from 'node:fs';

const MAP = {
    '01-headline-body-fidelity.md': 'headline_body_fidelity',
    '02-asymmetric-language.md':    'asymmetric_language',
    '03-number-hygiene.md':         'number_hygiene',
    '04-source-quality.md':         'source_quality',
    '05-internal-coherence.md':     'internal_coherence',
    '06-definitional-precision.md': 'definitional_precision',
    '07-omission.md':               'omission',
    '08-prediction-extraction.md':  'prediction_extraction',
    // The opinion family (R5/OP.2, docs/OPINION_MODULES_KICKOFF.md).
    // asymmetric_language / definitional_precision / prediction_extraction
    // are REUSED from the news set above — no duplicate entries.
    'opinion/op1-premise-accuracy.md':    'premise_accuracy',
    'opinion/op2-logical-validity.md':    'logical_validity',
    'opinion/op3-steel-manning.md':       'steel_manning',
    'opinion/op4-fact-interpretation.md': 'fact_interpretation_separation',
    'opinion/op5-disclosure.md':          'disclosure_transparency',
    'opinion/op6-originality.md':         'originality_synthesis'
};

const marker = /^#+\s*ARTICLE\s*$/m;
const dir = 'docs/auditor-prototype/prompts';

function toTemplate(s) {
    return '`' + s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${') + '`';
}

let body = '';
for (const [file, mod] of Object.entries(MAP)) {
    const content = readFileSync(`${dir}/${file}`, 'utf8');
    const m = content.match(marker);
    if (!m) throw new Error(`no # ARTICLE marker in ${file}`);
    const instructions = content.slice(0, m.index).trim();
    body += `    ${mod}:\n${toTemplate(instructions)},\n\n`;
}

const header = `// Standards: journalism-audit — docs/DISCIPLINES.md §2.
// X-Ray — vendored per-module audit methodology prompts.
//
// GENERATED, verbatim, from docs/auditor-prototype/prompts/01-08 and
// prompts/opinion/op1-op6 (the
// instruction portion before each file's "# ARTICLE" marker — exactly the
// CLI scorer's loadPrompt() slice). The extension can't read docs/ at
// runtime, so the per-module ("thorough") auditor vendors them here. These
// are the SAME methodology the findings schemas were derived from; the
// single-shot orchestrator uses a condensed summary instead.
//
// To regenerate after editing a prompt: node tools/gen-module-prompts.mjs
//
// Imported only by the background service worker (the audit runner), so it
// never weighs down the reader bundle.

export const MODULE_PROMPTS = Object.freeze({
${body}});
`;

writeFileSync('src/shared/audit/module-prompts.js', header);
console.log('wrote src/shared/audit/module-prompts.js');
