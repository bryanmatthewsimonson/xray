// X-Ray — browsable one-page rendering of the dev-process discipline
// standards.
//
// Reads .claude/skills/<id>/SKILL.md (the source of truth) plus
// .claude/skills/README.md (roster, release-preflight ordering, seam
// map) and emits docs/discipline-standards.html. The HTML is GENERATED
// and committed; hand edits die at the next regen.
//
//   npm run docs:disciplines
//
// tests/discipline-docs.test.mjs asserts the committed file matches a
// fresh render, so a skill edit that skips the regen fails the suite.
//
// STRICT BY DESIGN. A drift guard compares a fresh render against the
// committed one, so anything this file drops SILENTLY is dropped on
// both sides and the guard stays green while the page lies. Every
// degradation path is therefore a throw: unknown or duplicated
// sections, an undiscovered skill, a missing README heading, an
// unsupported markdown construct. A red regen is the design; a quiet
// omission is the bug.
//
// Deliberately timestamp-free: any generated-at stamp would make the
// drift guard fail on every run.

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SKILLS = join(ROOT, '.claude', 'skills');
const OUT = join(ROOT, 'docs', 'discipline-standards.html');

// Fixes ORDER only — the five disciplines the maintainer specified,
// then the three argued from repo evidence. Membership is discovered
// from disk and cross-checked below.
export const IDS = [
    'product-manager', 'architect', 'continuous-improvement', 'automator',
    'ecosystem-pm', 'verification-engineer', 'security-threat-modeler', 'schema-evolution'
];

// Exactly the sections a discipline SKILL.md may carry, all of them
// rendered. An added, renamed, or duplicated heading is a hard error.
const SECTIONS = [
    'The question', 'First principles', 'Standards',
    'Failure mode', 'When to invoke', 'Protocol', 'Boundaries'
];

// A skills subdirectory is a DISCIPLINE iff its SKILL.md carries a
// "## Standards" section. That is a content test, not a denylist, so
// operational skills (xray-capture) are excluded by what they are.
const DISCIPLINE_MARKER = /^## Standards\s*$/m;

const NUL = '\u0000';
const RESTORE = new RegExp(NUL + '(\\d+)' + NUL, 'g');

const esc = s => s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * Inline markup. Code spans are tokenized out FIRST and restored last,
 * so their contents can never pair with emphasis markers outside them:
 * `src/**` followed by `**​/*.mjs` would otherwise open a <strong>
 * inside one <code> and close it inside another, producing overlapping
 * tags. NUL delimits the placeholders because the sources are prose and
 * cannot contain one; a bare digit sentinel would collide with ordinary
 * text ("of 46 confirmed findings").
 */
function inline(s) {
    const spans = [];
    let t = esc(s).replace(/`([^`]+)`/g, (_, c) => `${NUL}${spans.push(c) - 1}${NUL}`);
    t = t
        .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // Single-asterisk emphasis is deliberately UNSUPPORTED: this repo's
    // prose is full of unbackticked glob syntax (docs/*KICKOFF*.md,
    // tests/*-guards*, any *builders*.js, xray:llm:*), which no regex can
    // tell apart from emphasis. Supporting it rendered those as
    // docs/<em>KICKOFF</em>.md. Use **bold** in the sources instead.
    return t.replace(RESTORE, (_, i) => `<code>${spans[i]}</code>`);
}

/**
 * Block renderer for the markdown subset these files use: paragraphs,
 * ordered and unordered lists with indented continuations, and pipe
 * tables. Unsupported constructs throw rather than degrading — see the
 * STRICT BY DESIGN note above.
 */
export function md(body, { olClass = '', where = '' } = {}) {
    const lines = body.split('\n');
    const out = [];
    let mode = null;
    let items = [];
    let para = [];
    let rows = [];

    const bail = msg => { throw new Error(`${where || 'markdown'}: ${msg}`); };

    const flush = () => {
        if (mode === 'ol' || mode === 'ul') {
            const cls = mode === 'ol' && olClass ? ` class="${olClass}"` : '';
            out.push(`<${mode}${cls}>` + items.map(it =>
                `<li>${inline(it.join(' ').replace(/\s+/g, ' ').trim())}</li>`).join('') + `</${mode}>`);
        } else if (mode === 'p' && para.length) {
            out.push(`<p>${inline(para.join(' ').replace(/\s+/g, ' ').trim())}</p>`);
        } else if (mode === 'table' && rows.length) {
            const cells = r => r.split('|').slice(1, -1).map(c => c.trim());
            out.push('<div class="twrap"><table><thead><tr>' +
                cells(rows[0]).map(h => `<th>${inline(h)}</th>`).join('') +
                '</tr></thead><tbody>' +
                rows.slice(2).map(r => '<tr>' + cells(r).map(c => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') +
                '</tbody></table></div>');
        }
        mode = null; items = []; para = []; rows = [];
    };

    for (const raw of lines) {
        const line = raw.replace(/\s+$/, '');
        // A blank line does NOT close a list: several Standards lists put
        // blank lines between items, and flushing there restarts numbering.
        if (!line.trim()) {
            if (mode === 'ol' || mode === 'ul') continue;
            flush();
            continue;
        }

        const trimmed = line.trim();
        if (trimmed.startsWith('```')) bail('code fences are not supported');
        if (trimmed.startsWith('> ')) bail('blockquotes are not supported');
        if (/^-{3,}$/.test(trimmed)) bail('thematic breaks are not supported');

        const indented = /^\s{2,}\S/.test(raw);
        if (indented && /^(?:\d+\.|[-*])\s/.test(trimmed)) {
            bail('nested lists are not supported — they would flatten into the parent item');
        }

        const mOl = line.match(/^(\d+)\.\s+(.*)$/);
        const mUl = line.match(/^-\s+(.*)$/);

        if (trimmed.startsWith('|')) {
            if (mode !== 'table') { flush(); mode = 'table'; }
            rows.push(trimmed);
        } else if (mOl) {
            if (mode !== 'ol') { flush(); mode = 'ol'; }
            items.push([mOl[2]]);
        } else if (mUl && !indented) {
            if (mode !== 'ul') { flush(); mode = 'ul'; }
            items.push([mUl[1]]);
        } else if (indented && (mode === 'ol' || mode === 'ul') && items.length) {
            items[items.length - 1].push(trimmed);
        } else {
            if (mode !== 'p') { flush(); mode = 'p'; }
            para.push(trimmed);
        }
    }
    flush();
    return out.join('\n');
}

/** Split a markdown body into an exact heading -> body map, rejecting duplicates. */
export function sectionMap(text, where) {
    const secs = {};
    for (const p of text.split(/^## /m).slice(1)) {
        const nl = p.indexOf('\n');
        const name = (nl < 0 ? p : p.slice(0, nl)).trim();
        if (name in secs) throw new Error(`${where}: duplicate section "${name}"`);
        secs[name] = nl < 0 ? '' : p.slice(nl + 1).trim();
    }
    return secs;
}

function parseSkill(id) {
    const where = `.claude/skills/${id}/SKILL.md`;
    const txt = readFileSync(join(SKILLS, id, 'SKILL.md'), 'utf8');
    const fmEnd = txt.indexOf('\n---', 4);
    if (fmEnd < 0) throw new Error(`${where}: no frontmatter terminator`);
    const rest = txt.slice(fmEnd + 4);

    const titleLine = (rest.match(/^#\s+(.+)$/m) || [])[1];
    if (!titleLine) throw new Error(`${where}: no title heading`);
    // Split on the FIRST em dash only, so a title containing a second
    // one keeps the rest of its tagline instead of dropping it.
    const tm = titleLine.match(/^(.*?)\s+—\s+([\s\S]*)$/);
    const title = tm ? tm[1] : titleLine;
    const tagline = tm ? tm[2] : '';

    const secs = sectionMap(rest, where);
    const got = Object.keys(secs).sort().join('|');
    const want = [...SECTIONS].sort().join('|');
    if (got !== want) {
        const missing = SECTIONS.filter(s => !(s in secs));
        const extra = Object.keys(secs).filter(s => !SECTIONS.includes(s));
        throw new Error(`${where}: section set mismatch` +
            (missing.length ? `; missing: ${missing.join(', ')}` : '') +
            (extra.length ? `; unexpected: ${extra.join(', ')}` : '') +
            ' — the renderer emits exactly the known sections, so an unlisted one would vanish silently');
    }

    const lead = rest.replace(/^#\s+.+$/m, '').split(/^## /m)[0].trim();
    if (lead.includes('\n\n')) {
        throw new Error(`${where}: lead has more than one paragraph — only the first would render`);
    }
    return { id, title, tagline, lead, secs };
}

/** Discover discipline directories and cross-check against the declared order. */
function discoverIds() {
    const found = readdirSync(SKILLS, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => e.name)
        .filter(name => {
            const f = join(SKILLS, name, 'SKILL.md');
            return existsSync(f) && DISCIPLINE_MARKER.test(readFileSync(f, 'utf8'));
        });
    const missing = found.filter(id => !IDS.includes(id));
    const stale = IDS.filter(id => !found.includes(id));
    if (missing.length || stale.length) {
        throw new Error('.claude/skills: discipline set mismatch' +
            (missing.length ? `; on disk but not in IDS: ${missing.join(', ')}` : '') +
            (stale.length ? `; in IDS but not on disk: ${stale.join(', ')}` : '') +
            ' — add it to IDS (which fixes render order) so it cannot be omitted silently');
    }
    return IDS;
}

export function renderDisciplineDocs() {
    const skills = discoverIds().map(parseSkill);

    const readmePath = '.claude/skills/README.md';
    const readme = readFileSync(join(SKILLS, 'README.md'), 'utf8');
    const rsecs = sectionMap(readme, readmePath);
    const need = name => {
        if (!(name in rsecs)) throw new Error(`${readmePath}: missing section "${name}"`);
        return rsecs[name];
    };
    const preflight = need('Release preflight — the shared ordering');
    const seams = need('Seams — who owns a contested call');

    const mandates = {};
    for (const m of need('The roster').matchAll(/\|\s*\[`([^`]+)`\][^|]*\|\s*(.+?)\s*\|\s*$/gm)) {
        mandates[m[1]] = m[2];
    }
    for (const s of skills) {
        if (!mandates[s.id]) throw new Error(`${readmePath}: no roster mandate for "${s.id}"`);
    }

    const OPEN = ['First principles', 'Standards', 'Failure mode'];
    const OPS = ['When to invoke', 'Protocol', 'Boundaries'];

    const renderSec = (s, name) => {
        const where = `${s.id}/SKILL.md §${name}`;
        const inner = md(s.secs[name], { olClass: name === 'Standards' ? 'statute' : '', where });
        const mod = name === 'Failure mode' ? ' block--failure' : '';
        return `<section class="block${mod}"><h4 class="block__h">${esc(name)}</h4>${inner}</section>`;
    };

    const discs = skills.map((s, i) => {
        const n = String(i + 1).padStart(2, '0');
        return `<article class="disc" id="${s.id}">
      <header class="disc__head">
        <p class="eyebrow"><span class="num">${n}</span><code>${esc(s.id)}</code></p>
        <h3 class="disc__title">${esc(s.title)}</h3>
        ${s.tagline ? `<p class="disc__tag">${esc(s.tagline)}</p>` : ''}
        <p class="disc__mandate">${inline(s.lead.replace(/\s+/g, ' '))}</p>
      </header>
      <details class="q"><summary>The elicitation question <span class="q__note">(scaffolding — discarded)</span></summary>
        ${md(s.secs['The question'], { where: `${s.id}/SKILL.md §The question` })}
      </details>
      ${OPEN.map(name => renderSec(s, name)).join('')}
      <details class="ops"><summary>Operational detail — when to invoke, protocol, boundaries</summary>
        ${OPS.map(name => renderSec(s, name)).join('')}
      </details>
    </article>`;
    }).join('\n');

    const roster = skills.map((s, i) => `<li class="roster__item">
    <a href="#${s.id}"><span class="roster__n">${String(i + 1).padStart(2, '0')}</span><code>${esc(s.id)}</code></a>
    <p>${inline(mandates[s.id])}</p>
  </li>`).join('');

    const nav = skills.map((s, i) =>
        `<li><a href="#${s.id}"><span>${String(i + 1).padStart(2, '0')}</span>${esc(s.id)}</a></li>`).join('');

    return `<!doctype html>
<!-- GENERATED by tools/gen-discipline-docs.mjs from
     .claude/skills/<id>/SKILL.md and .claude/skills/README.md.
     Do not hand-edit: run \`npm run docs:disciplines\` after changing a
     SKILL.md. tests/discipline-docs.test.mjs fails on drift. -->
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dev-process discipline standards — X-Ray</title>
<style>
:root{
  --paper:#EFF2F3; --leaf:#FFFFFF; --ink:#12171A; --ink-soft:#5B686E;
  --blueprint:#1B5875; --blueprint-soft:#E3EDF2; --rust:#8F3F27; --rust-soft:#F5E7E1;
  --rule:#D3DBDE; --rule-soft:#E4EAEC;
  --serif:Georgia,'Iowan Old Style','Palatino Linotype',Palatino,'Times New Roman',serif;
  --sans:system-ui,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
  --mono:Consolas,'SF Mono',Menlo,'DejaVu Sans Mono',ui-monospace,monospace;
}
@media (prefers-color-scheme:dark){:root{
  --paper:#0E1214; --leaf:#151A1D; --ink:#E4EAEC; --ink-soft:#96A4AA;
  --blueprint:#74B0CC; --blueprint-soft:#16262E; --rust:#CC8264; --rust-soft:#241813;
  --rule:#232B2F; --rule-soft:#1B2225;
}}
:root[data-theme="dark"]{
  --paper:#0E1214; --leaf:#151A1D; --ink:#E4EAEC; --ink-soft:#96A4AA;
  --blueprint:#74B0CC; --blueprint-soft:#16262E; --rust:#CC8264; --rust-soft:#241813;
  --rule:#232B2F; --rule-soft:#1B2225;
}
:root[data-theme="light"]{
  --paper:#EFF2F3; --leaf:#FFFFFF; --ink:#12171A; --ink-soft:#5B686E;
  --blueprint:#1B5875; --blueprint-soft:#E3EDF2; --rust:#8F3F27; --rust-soft:#F5E7E1;
  --rule:#D3DBDE; --rule-soft:#E4EAEC;
}
*{box-sizing:border-box}
html{background:var(--paper)}
body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--serif);
  font-size:17px;line-height:1.62;-webkit-font-smoothing:antialiased}
a{color:var(--blueprint)}
a:focus-visible,summary:focus-visible{outline:2px solid var(--blueprint);outline-offset:3px;border-radius:2px}
code{font-family:var(--mono);font-size:.86em;background:var(--rule-soft);
  padding:.1em .34em;border-radius:2px;word-break:break-word}
.wrap{max-width:1180px;margin:0 auto;padding:0 28px 96px}
.mast{border-bottom:2px solid var(--ink);padding:56px 0 26px;margin-bottom:38px}
.mast__eyebrow{font-family:var(--sans);font-size:11px;letter-spacing:.16em;text-transform:uppercase;
  color:var(--blueprint);margin:0 0 18px;font-weight:600}
.mast h1{font-size:clamp(30px,4.4vw,50px);line-height:1.08;margin:0 0 16px;
  text-wrap:balance;font-weight:400;letter-spacing:-.015em}
.mast__sub{font-size:19px;color:var(--ink-soft);margin:0;max-width:60ch}
.meta{display:flex;flex-wrap:wrap;gap:8px;margin-top:24px;font-family:var(--sans);font-size:12px}
.chip{border:1px solid var(--rule);padding:5px 11px;border-radius:2px;color:var(--ink-soft);background:var(--leaf)}
.chip--key{border-color:var(--blueprint);color:var(--blueprint);background:var(--blueprint-soft)}
.cols{display:grid;grid-template-columns:216px 1fr;gap:52px;align-items:start}
.rail{position:sticky;top:24px;font-family:var(--sans);font-size:13px}
.rail h2{font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--ink-soft);
  margin:0 0 12px;font-weight:600}
.rail ol{list-style:none;margin:0 0 26px;padding:0;display:flex;flex-direction:column;gap:1px}
.rail a{display:flex;gap:9px;padding:5px 7px;text-decoration:none;color:var(--ink);border-radius:2px}
.rail a:hover{background:var(--blueprint-soft);color:var(--blueprint)}
.rail a span{color:var(--ink-soft);font-variant-numeric:tabular-nums;font-size:11px;padding-top:2px}
.rail__links{display:flex;flex-direction:column;gap:6px;border-top:1px solid var(--rule);padding-top:14px}
.rail__links a{padding:0}
.sec{margin-bottom:56px}
.sec > h2{font-size:11px;letter-spacing:.16em;text-transform:uppercase;font-family:var(--sans);
  color:var(--blueprint);font-weight:600;margin:0 0 18px;padding-bottom:9px;border-bottom:1px solid var(--rule)}
.lede{font-size:18px;max-width:66ch}
.sec p,.sec li{max-width:66ch}
.roster{list-style:none;margin:0;padding:0;display:grid;gap:1px;background:var(--rule);border:1px solid var(--rule)}
.roster__item{background:var(--leaf);padding:15px 18px}
.roster__item a{display:flex;gap:10px;align-items:baseline;text-decoration:none;margin-bottom:5px}
.roster__item a code{background:none;padding:0;font-size:14px;font-weight:600;color:var(--blueprint)}
.roster__n{font-family:var(--sans);font-size:11px;color:var(--ink-soft);font-variant-numeric:tabular-nums}
.roster__item p{margin:0;font-size:15px;color:var(--ink-soft);line-height:1.5;max-width:none}
@media(min-width:900px){.roster{grid-template-columns:1fr 1fr}}
.disc{border-top:2px solid var(--ink);padding-top:26px;margin-bottom:64px;scroll-margin-top:20px}
.disc__head{margin-bottom:22px}
.eyebrow{font-family:var(--sans);font-size:11px;letter-spacing:.14em;text-transform:uppercase;
  margin:0 0 10px;display:flex;gap:10px;align-items:center}
.eyebrow .num{color:var(--ink-soft);font-variant-numeric:tabular-nums}
.eyebrow code{background:var(--blueprint-soft);color:var(--blueprint);font-weight:600;letter-spacing:0;
  text-transform:none;font-size:12px}
.disc__title{font-size:29px;margin:0 0 6px;font-weight:400;letter-spacing:-.01em;text-wrap:balance}
.disc__tag{margin:0 0 14px;color:var(--ink-soft);font-size:18px;font-style:italic;max-width:60ch}
.disc__mandate{margin:0;max-width:66ch}
.block{margin:26px 0}
.block__h{font-family:var(--sans);font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;
  color:var(--ink-soft);font-weight:600;margin:0 0 12px}
.block p,.block li{max-width:66ch}
.block ul{padding-left:19px}
.block ul li{margin-bottom:9px}
ol.statute{list-style:none;counter-reset:std;margin:0;padding:0 0 0 52px;
  border-left:1px solid var(--rule);position:relative}
ol.statute > li{counter-increment:std;position:relative;margin-bottom:20px;padding-bottom:20px;
  border-bottom:1px solid var(--rule-soft)}
ol.statute > li:last-child{border-bottom:none;margin-bottom:0;padding-bottom:0}
ol.statute > li::before{content:counter(std);position:absolute;left:-52px;width:34px;text-align:right;
  font-family:var(--sans);font-size:12px;font-weight:600;color:var(--blueprint);
  font-variant-numeric:tabular-nums;padding-top:4px}
ol.statute > li strong:first-child{color:var(--ink)}
.block--failure{background:var(--rust-soft);border-left:3px solid var(--rust);
  padding:18px 22px;border-radius:0 2px 2px 0}
.block--failure .block__h{color:var(--rust)}
details{margin:18px 0}
details summary{cursor:pointer;font-family:var(--sans);font-size:12.5px;color:var(--blueprint);
  padding:7px 0;border-top:1px solid var(--rule);border-bottom:1px solid var(--rule);font-weight:500}
details summary::marker{color:var(--ink-soft)}
details[open] summary{margin-bottom:6px}
.q summary{border-bottom:none}
.q__note{color:var(--ink-soft);font-style:italic}
.q p{color:var(--ink-soft);font-style:italic;max-width:66ch}
.ops{margin-top:26px}
.twrap{overflow-x:auto;margin:14px 0}
table{border-collapse:collapse;width:100%;font-size:15px;font-family:var(--sans)}
th,td{text-align:left;padding:9px 13px;border-bottom:1px solid var(--rule);vertical-align:top}
th{font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-soft);
  border-bottom:1px solid var(--ink)}
.note{border:1px solid var(--rule);background:var(--leaf);padding:18px 22px;margin:20px 0}
.note p{margin:0 0 10px}
.note p:last-child{margin:0}
footer{border-top:2px solid var(--ink);margin-top:56px;padding-top:22px;
  font-family:var(--sans);font-size:13px;color:var(--ink-soft)}
footer code{font-size:12px}
@media(max-width:860px){
  .cols{grid-template-columns:1fr;gap:0}
  .rail{position:static;margin-bottom:40px;border-bottom:1px solid var(--rule);padding-bottom:20px}
  .rail ol{display:grid;grid-template-columns:1fr 1fr;gap:2px}
  body{font-size:16px}
  ol.statute{padding-left:38px}
  ol.statute > li::before{left:-38px;width:26px}
  .wrap{padding:0 18px 64px}
}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
</style>
</head>
<body>
<div class="wrap">
<header class="mast">
  <p class="mast__eyebrow">X-Ray · dev-process disciplines</p>
  <h1>Dev-process discipline standards</h1>
  <p class="mast__sub">Eight review disciplines for how the software gets built — derived, not listed,
  in the method that produced <code>docs/PHILOSOPHY.md</code>.</p>
  <div class="meta">
    <span class="chip chip--key">Advisory — nothing merge-blocking</span>
    <span class="chip">Tier-3 process tooling (Art. 13)</span>
    <span class="chip">Maintainer alone merges (Art. 11)</span>
    <span class="chip">Generated from <code>.claude/skills/</code></span>
  </div>
</header>

<div class="cols">
<nav class="rail" aria-label="Disciplines">
  <h2>The eight</h2>
  <ol>${nav}</ol>
  <div class="rail__links">
    <a href="#seams">Seams</a>
    <a href="#preflight">Release preflight</a>
    <a href="#scope">What this is</a>
  </div>
</nav>

<main>
<section class="sec" id="scope">
  <h2>What this is</h2>
  <p class="lede">Each discipline follows the <code>docs/DISCIPLINES.md</code> §0 method: the
  idealized-practitioner question used as elicitation and then discarded, first principles extracted,
  numbered checkable standards codified, and the discipline's characteristic failure mode named beside
  the standard that counters it. No discipline exempts itself.</p>
  <div class="note">
    <p><code>docs/DISCIPLINES.md</code> governs the disciplines the <em>product</em> draws on — how X-Ray
    judges truth. These govern the <em>engineering process</em> — how X-Ray gets built. They are Tier-3
    process tooling under CONSTITUTION Art. 13.</p>
    <p><strong>Not a revival of the College of Personas</strong> killed on 2026-07-22. That draft reified
    the scaffolding — eighteen anthropomorphized offices with a check-graph standing in for the standards.
    Here the standards are the deliverable, the role name is only the invocation handle, and there is no
    check-graph, no quorum, and no office with authority. Every skill outputs a review report; the
    maintainer decides and merges.</p>
  </div>
  <p>Five disciplines were specified by the maintainer; three — <code>verification-engineer</code>,
  <code>security-threat-modeler</code>, <code>schema-evolution</code> — were argued from repo evidence and
  ranked by risk × trigger frequency. Nothing here blocks a merge until one of its standards graduates to
  a guard test by its own explicit clause, the Art. 8.6 posture applied to process.</p>
</section>

<section class="sec">
  <h2>The roster</h2>
  <ul class="roster">${roster}</ul>
</section>

<section class="sec" id="preflight">
  <h2>Release preflight — the shared ordering</h2>
  ${md(preflight, { where: `${readmePath} §Release preflight` })}
</section>

<section class="sec" id="seams">
  <h2>Seams — who owns a contested call</h2>
  <p>Where two skills touch, one owns the ruling and the other cites it. These were set by a cross-skill
  consistency review that found the drafts triplicating wire-format review, running two contradictory
  automation ladders, and keeping two verification-debt ledgers.</p>
  ${md(seams, { where: `${readmePath} §Seams` })}
</section>

<section class="sec">
  <h2>The disciplines in full</h2>
  <p>Nothing below is abridged. Standards, first principles, failure modes and boundaries are shown open;
  the operational sections are collapsed.</p>
</section>

${discs}

<footer>
  <p>Generated by <code>tools/gen-discipline-docs.mjs</code> from
  <code>.claude/skills/&lt;id&gt;/SKILL.md</code> and <code>.claude/skills/README.md</code>, which govern.
  Regenerate with <code>npm run docs:disciplines</code>.</p>
</footer>
</main>
</div>
</div>
</body>
</html>
`;
}

// CLI: `npm run docs:disciplines`
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    const html = renderDisciplineDocs();
    writeFileSync(OUT, html, 'utf8');
    console.log(`wrote docs/discipline-standards.html (${html.length} chars, ${IDS.length} disciplines)`);
}
