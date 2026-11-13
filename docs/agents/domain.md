# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

This repo is **single-context**, with one difference from the skills' default layout: it has **no `docs/adr/`**. Decisions are already recorded elsewhere (see "Where decisions live"). Do not create `docs/adr/`.

## Before exploring, read these

- **`GLOSSARY.md`** at the repo root, if it exists.
- **`CLAUDE.md`**: the architecture, the four execution contexts, and the conventions. Until a glossary exists, its vocabulary is the project's vocabulary.
- **The decision records** that touch the area you're about to work in (next section).

If `GLOSSARY.md` doesn't exist, **proceed silently**. Don't flag its absence; don't suggest creating it upfront. The `/domain-modeling` skill creates it lazily when terms actually get resolved.

## Where decisions live

Where a skill says "ADR", use the record below that fits. When two of them disagree, `docs/CONSTITUTION.md` Art. 2 says which governs; read it instead of inferring an order from this table.

| Record | What it holds | Who writes it |
| --- | --- | --- |
| `docs/CONSTITUTION.md` | Project-wide law. Cited as `CONSTITUTION Art. <n>`. | Amended only by the maintainer (Art. 13). |
| `docs/RULINGS.md` | Maintainer rulings, one row each, quoting the maintainer's own words. Cited by `R-NNN`. | A row quotes the maintainer. An agent never writes a ruling on the maintainer's behalf. |
| `docs/*_DESIGN.md`, `docs/*_KICKOFF.md` | The design of one feature or wave. | Whoever designs it; the maintainer approves. |
| `docs/journal/YYYY-MM.md` | The engineering journal: non-obvious bugs, second-guessable design choices, third-party workarounds. Cited as `JOURNAL YYYY-MM-DD`. | Anyone, in the PR that makes the change. |

**To record a decision** (what the skills call "write an ADR"): add an entry at the BOTTOM of the current month's file in `docs/journal/`, then run `npm run docs:journal` to regenerate the index at `docs/JOURNAL.md`. Never edit the index by hand. `CONTRIBUTING.md`, "Governance", is the rule: every decision that accepts a design, kills a feature or resolves an open question gets a journal entry. If the decision is the maintainer's to make, the entry records the question and the recommended default, and the ruling itself is a `docs/RULINGS.md` row in the maintainer's words.

**To find past decisions**: grep `docs/journal/` and `docs/RULINGS.md` before proposing a change to the area.

## File structure

```
/
├── GLOSSARY.md              ← created lazily; does not exist yet
├── CLAUDE.md
├── docs/
│   ├── CONSTITUTION.md
│   ├── RULINGS.md
│   ├── JOURNAL.md           ← generated index, never edited
│   ├── journal/
│   │   └── YYYY-MM.md       ← entries, oldest first
│   └── agents/              ← this folder
└── src/
```

**When `GLOSSARY.md` is first created**, add it to `webExt.ignoreFiles` in `package.json` in the same PR. The extension is packaged from the repo root, and `npm run check:package` fails on a packaged file that nothing loads unless it is excluded there.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `GLOSSARY.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag conflicts with a recorded decision

If your output contradicts a constitution article, a ruling, a design doc or a journal entry, surface it explicitly rather than silently overriding, and cite it the way the table above shows:

> _Contradicts JOURNAL 2026-09-05 (LLM passes are jobs, never held-open messages), but worth reopening because…_

A conflict with `docs/CONSTITUTION.md` or a confirmed `docs/RULINGS.md` row is the maintainer's call, never the agent's.
