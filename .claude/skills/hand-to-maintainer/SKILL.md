---
name: hand-to-maintainer
description: >-
  Hand manual verification to the maintainer as runnable instructions,
  and record what came back. Invoke WHENEVER work is complete that has
  any check no automated layer can observe — before saying a branch is
  ready, before opening or merging a PR, before a v* tag, and any time
  the words "smoke", "walk", "owed", "needs-human-eyes", or a DC-/LT-/
  K-style row id are about to appear in a message to the maintainer.
  Also invoke when the maintainer reports having tested something, to
  record it. Trigger words: smoke row, walk, owed, manual test, how do
  I test this, needs-human-eyes, ready to merge, release tag.
---

# Handing verification to the maintainer

## Why this exists

Written 2026-08-16, from direct maintainer feedback after the direct-cloud
transcription wave:

> "You keep telling me about 'smoke rows owed' but I'm a human looking at
> Claude Code and there's no instructions about what is needed. […] half
> the time you're wrong about it or have misjudged its importance."

Both halves of that are the problem. **Naming a row id is not handing over
work** — `docs/SMOKE_TEST.md` is a reference document, not something the
maintainer is reading in the terminal. And **claiming a row's status
without evidence is worse than saying nothing**, because it silently
converts an unknown into a false record. In that same wave the maintainer
had already satisfied §5's load-bearing "never installed" clause on a
fresh profile, and it was reported as outstanding for several turns.

## The rule

**Never name a row id without the steps beside it, in the message.**
The maintainer must be able to act on the message alone, with
`docs/SMOKE_TEST.md` open in no tab.

**Never assert a check's status you did not observe or were not told.**
Unknown is a legitimate state. Say "not confirmed", never "owed" as if
it were a fact about what the maintainer did.

## The format

Present checks as a numbered list. Every item gets four things, in this
order, and nothing else:

1. **Setup** — the exact precondition, including flags and which
   profile. Skip only if identical to the previous item.
2. **Do** — the literal click path or command. Not "exercise the
   picker"; "open a YouTube capture, click ▾ next to Transcribe".
3. **Expect** — one concrete observable. Something seen, not inferred.
4. **If it differs** — one line on what that would mean, so a failure
   report is diagnostic rather than just "it didn't work".

Order by what fails worst, not by row id. Mark anything that costs money
or is irreversible. State the total time honestly.

Ask for the reply in the cheapest form that is still unambiguous:

> Reply with the numbers: `1 2 4 pass, 3 fail: <what you saw>`.

Nothing else is required of them — not a file edit, not a doc, not a
commit.

## Recording what comes back

When the maintainer reports results, **immediately**:

- Update the walk ledger in `docs/SMOKE_TEST.md` with the date and the
  observation, not just PASS. What they saw is the evidence; the verdict
  is a summary of it.
- Record a partial walk as PARTIAL with the specific rows named. Never
  round up to PASS.
- If a report contradicts something previously written down, correct the
  document in the same turn and say so plainly.
- A row the maintainer covered incidentally still counts — ask before
  listing it as unconfirmed if their report implies it.

## Judging importance honestly

Say which checks are load-bearing and which are cheap, and be right
about it. The test: **what would this observation change?** A check that
cannot change a decision does not belong in the list.

- Money, data loss, and anything published are load-bearing.
- A check no automated layer can EVER observe (service-worker teardown,
  a real provider's behavior, whether prose is true) is load-bearing.
- Wording and cosmetics are cheap. Say so; do not pad the list to look
  thorough.

If the honest answer is "nothing here needs a human", say that.

## Anti-patterns

- Listing row ids and stopping.
- "Smoke rows owed" with no steps.
- A list so long it will not be run — three items that get done beat
  nine that do not.
- Reporting status as fact when it was never observed.
- Asking the maintainer to open, read, or edit a document to report back.
