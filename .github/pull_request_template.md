<!--
  The four contract lines under "Contract" are RESET_PLAN §8's PR body
  contract. .github/workflows/pr-body.yml checks them with
  scripts/pr-body-check.mjs, which strips every HTML comment first — so
  nothing in these comments counts. Keep each label exactly as written,
  at the start of its own line, and write its answer after the colon or
  in place of the comment under it. Dependabot PRs are not checked.
-->

## What

<!-- One or two sentences: what this PR changes. -->

## Why

<!-- The reason. Link the issue it closes or references.
     A PR that changes a process file (.github/**, .claude/skills/**,
     docs/SMOKE_TEST.md, CONTRIBUTING.md, CLAUDE.md) also names the
     friction it relieves: add an entry at the bottom of
     docs/journal/YYYY-MM.md in this PR, or cite an existing one here
     as "JOURNAL YYYY-MM-DD". -->

Closes #

## Contract

Verification layer:
<!-- One of: unit | guard | machine-smoke | human-soak | none-because <reason>
     — the layer that can observe this change's principal risk
     (verification-engineer skill). Join two with "+", e.g. "unit + guard". -->

Wire format:
<!-- Required when a wire-lane file changed (event-builder.js,
     nostr-events.js, any *-publish.js, truth-builders.js,
     audit/builders.js, audit/publish-batch.js, metadata/builders.js,
     publish-gate.js, confirmed-publish.js, wire-copy.js). One of:
     none | additive | breaking | new-kind | retirement — then say
     whether already-published events still parse and render, and
     whether an older client degrades gracefully (ecosystem-pm skill).
     Otherwise leave it empty or delete the line. -->

Docs:
<!-- "none", or the docs this PR changes, e.g. docs/SMOKE_TEST.md, docs/NIP_DRAFT.md -->

Interpretive steps (n):
<!-- Replace n with the number of judgement calls you made that the
     maintainer has not ruled on, then list each as ONE list item that
     ends with your recommended default, e.g.
     - Counted a moved file as two lanes, not one — default: two.
     "Interpretive steps (0):" is a complete answer. -->

<!-- Optional — required only when this PR edits src/ files in more
     than one lane (the §8 lanes table, encoded in scripts/lanes.mjs).
     Copy this line out of the comment and give the reason:
Cross-lane: <why these lanes must change together>
-->

## How I tested

<!-- A fix: PR needs a tests/ change, or a line here:
     no-test rationale: <why no test can observe it> -->

- [ ] Chrome (or Chromium/Brave/Edge) — loaded the unpacked extension
      and exercised the affected path.
- [ ] `web-ext lint` passes locally.
- [ ] If the change touches relay traffic or event payloads, verified
      against a real relay (not just the event builder in isolation).

## Screenshots / recordings

<!-- For any UI change. -->

## Compatibility notes

<!-- Does it break existing stored preferences / keypair registry /
     IndexedDB records? (Wire-format changes go on the "Wire format:"
     line above.) -->
