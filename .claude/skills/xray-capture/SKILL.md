---
name: xray-capture
description: Capture articles into X-Ray by URL and enumerate an article's outbound-link frontier for corpus expansion, driving the loaded extension through the claude-in-chrome connector. Use when the user asks to capture a URL into X-Ray, capture the links from an article, or expand a case corpus. Requires the claude-in-chrome connector, the X-Ray extension loaded, and the Capture-automation flag ON.
---

# X-Ray capture — drive the extension, expand the corpus

You are driving the X-Ray WebExtension through the user's real Chrome
(claude-in-chrome tools) to capture articles and enumerate capture
frontiers. You are a *researcher's runner*: you fetch and file, you
never judge, and **nothing model-produced becomes durable X-Ray data
through you** — proposals are accepted by the human in the reader,
or not at all.

## Connector limits (verified 2026-07-16 — design around these, not against them)

- The connector **cannot navigate to `chrome-extension://` URLs** (it
  forces an `https://` prefix) and **cannot attach the debugger to
  extension pages** ("Cannot attach debugger to chrome-extension://
  pages"). Everything that needed extension-page JS — IDB reads,
  `chrome.tabs.sendMessage`, `xray:llm:corpus-map` — is unreachable.
- Synthetic keys do not fire extension command shortcuts, and OS-level
  keystrokes into browsers are blocked by the computer-use tier.
- Therefore the ONLY verb you have against the extension is
  **navigation of ordinary pages** — which is exactly what the
  `#xray:capture` marker (Phase 27 K.4, flag-gated) exists for.

## Hard rules (the project constitution — these bind every step)

1. **No auto-accept, ever.** Never write entities, claims, links,
   facts, findings, or baselines anywhere. The ONLY writes you may
   cause are the extension's own capture flow (the marker → reader
   auto-archive).
2. **Never touch publish paths.** No relay messages, no signing.
3. **Pace yourself.** Captures run sequentially — one URL at a time,
   waiting for each load and verification before the next.
4. **Capture only where directed.** The user names the seed URL(s) or
   approves the frontier list before you fan out. Skip login-walled or
   paywalled pages you cannot render; report them as uncapturable
   rather than working around access controls.
5. **Suggest-pass scouting is currently NOT runnable by this skill**
   (it needs extension-context messaging the connector cannot reach).
   The reader's own Suggest button is the human's path; recommend it
   per-article instead of simulating it.

## Preflight (once per session)

1. Confirm the claude-in-chrome tools are loaded (ToolSearch if
   deferred), then `tabs_context_mcp {createIfEmpty: true}`.
2. Ask the user to flip **Options → Advanced → Capture automation** ON
   (the `#xray:capture` marker is default-off; it gates only the
   marker). Remind them to turn it back off when the session ends.
3. Probe once: navigate a group tab to a harmless captureable page
   with `#xray:capture` appended, wait ~3s, then `javascript_tool`:
   `document.documentElement.dataset.xrayCaptured` —
   - `"ok"` → capture fired; a reader tab opened (outside your group —
     you won't see it; that's expected).
   - `"flag-off"` → the flag isn't on; ask again.
   - `undefined` → the extension may not be loaded, or the page blocked
     the content script; try one reload, then report.

## Capture one URL

1. Navigate a group tab to `<URL>#xray:capture` (if the URL already
   has a fragment, the marker replaces it — note that to the user).
2. Wait for load + ~5s (the marker waits 1.5s after init to let
   dynamic pages settle, then opens the reader, which auto-archives).
   **SPAs (Medium, some news sites) need ~10s** — a capture that fires
   before the body renders archives an empty shell.
3. Verify on the SAME tab (ordinary page — attachable):
   `document.documentElement.dataset.xrayCaptured` → expect `"ok"`.
   `"error"`/`undefined` → report the URL as failed (paywall? consent
   wall? script-blocked?); retry at most once.
4. **A stamp of `"ok"` means the capture FIRED, not that the content
   was good.** Check `document.title` in the same probe: a title like
   `"archive.is"`, `"Just a moment…"`, `"Medium"`, or a bare hostname
   means an interstitial/loading state was live when the capture ran —
   wait for the real title and re-capture (see the re-capture note
   below). Batch the title into the verification expression:
   `({stamp: document.documentElement.dataset.xrayCaptured, title: document.title, len: document.body.innerText.length})`
   — `len` under ~2000 on a supposed article is another tell.
5. **Re-capturing:** navigate somewhere else first (`https://example.com`)
   and back. Going from `<url>` to `<url>#xray:capture` used to be a
   silent no-op (same-document navigation → no re-init); a `hashchange`
   listener now covers it, but a full navigation is still the reliable
   path, and re-capture is safe — the archive keys by URL and keeps the
   prior version.
6. Report title (from the tab) and move to the next URL.
5. **Tab pileup is real:** every capture opens a reader tab the
   connector cannot close (they're outside the group). Tell the user
   at the end how many reader tabs they'll find and that each shows a
   captured article ready for claim extraction.
6. **PDFs:** a direct PDF URL with `#xray:capture` WORKS (verified
   2026-08-23): the content script runs inside Chrome's PDF viewer
   document and hands off to the reader's `?pdf=` path, stamping `ok`.
   You cannot open that reader page yourself (extension page), so the
   stamp is your whole observation; the reader side is the human's.

## Enumerate the frontier

Extension IDB is unreachable, so the frontier comes from a **workspace
backup export** the user hands you:

1. Ask the user: Options → Advanced → Workspace → download backup
   (source bytes not needed), and give you the file path (usually
   `~/Downloads/…json`).
2. Parse it in node (it is one JSON object):
   `databases['xray-archive'].stores.articles` (explore the exact
   nesting — `format` and `exportedAt` sit at the top level) → each
   record has `url`, `articleHash`, and `article.links` (shape
   `{url, text, count, internal}`, capped at 100 with
   `article.links_truncated`).
3. Frontier = every non-`internal` link URL across the seed records,
   minus every `url` already in the archive, deduped, with citation
   counts and which seeds cite it. Disclose `links_truncated` seeds.
4. Present the frontier as a numbered pick list sorted by citation
   count. **Wait for the user to pick** (or confirm "all"), then loop
   the capture procedure sequentially over the picks.
5. The export is a snapshot — captures made after it won't be in it.
   Re-request an export if you need a fresh frontier; don't guess.

## Failure modes

| Symptom | Meaning | Do |
|---|---|---|
| `dataset.xrayCaptured === "flag-off"` | Capture automation off | Ask the user to enable it in Options → Advanced |
| `dataset.xrayCaptured` undefined after reload, or the page cannot be scripted at all and the `#xray:capture` marker is STILL in the tab URL after the settle time | content script absent (chrome://, the Chrome Web Store, other gallery/blocked pages). **NOT PDFs** — verified 2026-08-23: the content script runs inside Chrome's PDF viewer and the marker hands off through the Phase 18 `xray:pdf:open` route, stamping `ok` | Report uncapturable, never work around it |
| `"error"` stamp | the marker branch threw | Read the console (`pattern: "X-Ray"`) — it logs the reason verbatim |
| Stamp `"ok"` but the title is `archive.is` / `Just a moment…` / `Medium` | captured an interstitial, not the article | Wait for the real title, then re-capture via a full navigation |
| Stamp never appears on one specific host | the content script may be throwing before the marker runs | Console first, guess never — this is how the archive.is `<base href>` bug was found (JOURNAL 2026-07-17) |
| Navigate mangles the URL | you passed a `chrome-extension://` URL | Don't — ordinary pages only (see Connector limits) |
| Frontier stale | export predates recent captures | Ask for a fresh export |

## Reporting back

Give the user a per-URL table (title + outcome), not just a count.
State plainly: how many reader tabs are now open (one per capture, all
outside the group — you cannot close them), which URLs failed and why,
and which captured content you are UNSURE about. An honest "this one
may have caught a loading page" is worth more than a green checkmark
they later discover was empty.

## Agent smoke walk (added 2026-08-23, maintainer directive)

Beyond capture, this skill drives the loaded extension through the
**agent-verifiable subset of `docs/SMOKE_TEST.md`** so machine-checkable
rows stop consuming the maintainer's twenty minutes and stop shipping
unwalked.

**When:** after any behavior-changing branch is loaded (the soak rule's
companion), before asking the maintainer to walk anything, and before a
release tag.

**What:** only rows tagged `agent-verifiable`. Rows tagged
`needs-human-eyes` are out of scope BY DEFINITION — do not attempt
them, do not mark them, and never report a row you did not run
(`hand-to-maintainer` owns the human handoff and the honesty rules).

**What may carry the tag (the criterion — added 2026-08-23 after the
first walk found both tagged rows unrunnable):** a row is
`agent-verifiable` ONLY if (a) its Do is an ordinary-page navigation
and (b) its Expect is readable on that same ordinary page — the
`dataset.xrayCaptured` stamp, `document.title`,
`document.body.innerText.length`, or the console. The reader, Options,
the portal and every other extension page are unreachable to the
connector (see Connector limits) — a row that needs one of them is
not agent-verifiable however mechanical it looks, and a row that
needs a publish never is. If a row's invariant is actually a pure
rule, the right move is to LIFT it into a unit test and retag it
`unit` (DC-1 is the worked example: `tests/picker-visibility.test.mjs`)
— that takes it off every list, human and agent. The runnable set
today is `docs/SMOKE_TEST.md` § "Agent walk — the capture marker (AW)".

**How:**
1. Confirm the extension is loaded and which branch built `dist/`
   (`git rev-parse --abbrev-ref HEAD` + the Options build stamp).
2. Walk each agent-verifiable row via the claude-in-chrome connector:
   perform the row's Do column, observe its Expect column literally —
   read rendered text, not DOM presence alone.
3. Record results in the walk ledger the same way a human walk is
   recorded: date, rows, PASS/FAIL **with what was observed**, and the
   build hash. An agent walk is labelled `(agent)` so it is never
   mistaken for human eyes.
4. On any FAIL: stop, report with the observation, do not continue to
   dependent rows.

**Boundaries:** never publish to relays during a smoke walk; never
spend a paid API call unless the row explicitly requires it and the
maintainer approved the spend; never mark a `needs-human-eyes` row.
