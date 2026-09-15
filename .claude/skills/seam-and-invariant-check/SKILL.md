---
name: seam-and-invariant-check
description: >-
  Pre-commit discipline that targets the specific failure mode behind
  the 2026-08 field-bug cluster: code and tests that are green while
  the behavior is wrong, because the test asserted a helper instead of
  the seam, or pinned today's literal instead of the invariant. Invoke
  BEFORE committing any change that adds a returned field or flag, adds
  a second member to any set (engines, providers, routes, platforms,
  states), adds or edits a source-grep guard test, or adds user-visible
  strings. Trigger words: second provider, new engine, returned flag,
  guard test, picker, consent string, "tests are green".
---

# Seam and invariant check

## Why this exists

Written 2026-08-23, from a run of field-found bugs that shared one
property: **every test was green while the behavior was wrong.** The
maintainer, not the suite, found all of them. Documented individually
in docs/JOURNAL.md (2026-08-16 entries); the shapes:

1. `priorSubmission` was returned by the job driver, unit-tested, and
   consumed by NOTHING — the one case that can cost money silently was
   reported to no one. *The helper was tested; the seam was not.*
2. The charge warning used `toast()` — a single-slot, last-write-wins
   element — and was erased by the success toast milliseconds later.
   *Rendered output was never read; presence was asserted, visibility
   was not.*
3. `=== DIRECT_ENGINE_ID` comparisons broke the moment a second direct
   engine existed: the click guard dead-ended and the consent dialog
   was skipped. The guard test asserted the LITERAL `!==
   DIRECT_ENGINE_ID`, so it passed while wrong. *The snapshot was
   pinned; the invariant was not.*
4. The consent dialog hardcoded "AssemblyAI" and said it while running
   Deepgram. Same shape: prose written when one case existed.
5. "media URLs are signed and expire" was claimed for ALL platforms —
   true for five, false for three. *A sentence generalized to a set it
   was never checked against.*

## The checklist — run it against the diff, before commit

**1. Every new returned field has a consumer, and the consumer has a
test.** For each field/flag the diff adds to any return value: grep for
who reads it. Zero readers = the bug is already written. The test must
assert the CONSUMER's observable effect, not that the field exists.

**2. Second-member sweep.** If the diff adds a member to any set —
engine, provider, route, platform, state, message type — grep the whole
tree for comparisons, prose, and guards written against the FIRST
member alone: `=== '<first-id>'`, the first member's display name
inside string literals, availability checks keyed on it. Every hit is
either routed through the set or justified in a comment.

**3. Guard tests assert the rule, not the snapshot.** For every
source-grep assertion in the diff, ask: *would this still pass if a
second member were added and the behavior were wrong for it?* If yes,
rewrite it to assert the invariant (e.g. "no single-id comparison may
appear in this function", "no vendor name may be a literal in a consent
string"). Then NEGATIVE-CONTROL it: reintroduce the bug it protects
against and confirm the suite goes red. A guard that cannot be shown to
fail is decoration.

**4. Read the rendered string.** For every user-visible string the diff
adds or changes: print it with real inputs (a node one-liner is
enough) and read the output. Grammar breaks ("a instagram page"), wrong
recipients, and leaked ids are visible only in the rendered form.
Check the DISPLAY LIFETIME too: does anything overwrite or auto-clear
it before a human would see it? A notice about money or data loss must
be dismissable, not timed.

**5. Claims in prose must be individually true.** Any sentence shown to
the user that asserts a technical fact ("X does Y", "this cannot be
fetched") is checked against each case it will render for — not the
case it was written about.

## Scope honesty

This checklist catches the *wired-but-wrong* class. It does not replace
the live walk: adoption discarding article bodies (2026-08-16) was
found only by a human reading the result. Hand what remains to the
maintainer per `hand-to-maintainer` — steps in the message, ordered by
what fails worst.
