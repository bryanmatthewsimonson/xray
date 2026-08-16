# Direct cloud transcription — transcribe with nothing installed (kickoff)

**Status: DC.1 IMPLEMENTED 2026-08-15 — code complete, first real runs
PASSED, §5 criterion NOT yet met.** Two episodes transcribed end to end
through the direct route on 2026-08-15 (PodBean and Mormon Discussions),
after the first attempt exposed a URL-discovery gap — the media-hint
detector did not read schema.org JSON-LD, so a page URL was submitted
and the provider returned "File type text/html" (fixed in `22d9d94`).
DC-2 PASSED with the companion service stopped — the observation that
establishes the path has no hidden companion dependency. §5 still needs
a run on a machine where the companion was never installed (a fresh
browser profile; the load-bearing half) and one transcript feeding a
claim or entity page (deferred to real corpus work, which is better
evidence than a staged run). See the walk ledger in
`docs/SMOKE_TEST.md`. Approved by the maintainer the same day. DC.1's §5 criterion is
NOT met and cannot be met from a desk: it requires transcripts produced
with no companion running, at least one on a machine where the companion
has never been installed (`docs/SMOKE_TEST.md` §Direct cloud
transcription, rows DC-1..DC-6). DC.2 and DC.3 are not started.
Originally drafted at
the maintainer's request after the Transcribe Anywhere smoke walk
(PR #334), during which the maintainer asked the question this document
exists to answer: "is it possible to transcribe anything without running
a service on the local machine at all?" The answer found in the code is
yes, for a large and well-defined class of media — see §1.

Related: `docs/TRANSCRIBE_ANYWHERE_KICKOFF.md` (the wave that made a
direct media URL available to the extension in the first place — this
proposal is only practical because of it), `companion/transcriber/README.md`
(the service this makes optional, not obsolete), `docs/THREAT_MODEL.md`
B9/B10/B12 (the companion boundary rows a direct path does NOT inherit —
it needs its own), `docs/ROAD_TO_1_0.md` T5 (the open item declaring the
companion effectively Windows-oriented).

## 1. Diagnosis — the install is the adoption cliff, and it is not load-bearing for cloud

X-Ray can transcribe spoken-word evidence only for a user who has
installed and is running a local Python service. That is a steep ask:
`uv`, a Python toolchain, a service to keep running, and — for the local
engine — an `HF_TOKEN` that requires creating a Hugging Face account and
accepting the pyannote model's terms. The companion's dependency set is
also built around a CUDA stack (`cu130`, an NVIDIA R580+ driver) that
only pays off on a Windows/NVIDIA box; `pyproject.toml`'s
`required-environments` names win32 and linux only.

The maintainer's own Mac is the honest test case, and it fails the way a
new user's machine would: `/health` reports `device: cpu` and
`hf_token: false`, so the local engine cannot run at all. What works
there is AssemblyAI — but only with the companion running, which on
2026-08-15 cost a debugging session when a days-old service was still
serving pre-update code. For everyone who is not the maintainer, the
install is where the funnel ends, and the spoken-word evidence simply
stays outside the corpus.

**The service is not actually required for the cloud engines.** Evidence
from this repo, not from speculation:

- `companion/transcriber/transcriber/providers/assemblyai.py:101` creates
  the transcript with `"audio_url": upload_url`. That field takes a URL
  AssemblyAI fetches itself. The companion uploads first only because it
  happens to hold a local *file* — a file it downloaded because the
  YouTube-era design always started from a platform page. Given a public
  media URL there is nothing to download and nothing to upload.
- The same call already sets `"speaker_labels": True`
  (`assemblyai.py:105`), so diarization comes from the provider. No
  pyannote, no `HF_TOKEN`, no GPU.
- Deepgram's runner posts audio bytes to `/v1/listen`
  (`deepgram.py:34`), and that endpoint has an equivalent remote-URL
  mode. (Confirm against their current API before slicing — this
  document does not treat it as established.)

What made this newly practical is the Transcribe Anywhere wave: the
content script now extracts a direct media URL from an ordinary page
(`mediaHints.fileUrl` → `transcribeSourceUrl`), which is exactly how the
Blubrry episode in the 2026-08-15 walk got transcribed. "How do you get
a media URL out of a web page" was the hard half of a serviceless
design, and a content script that loads pages as a real browser already
answers it.

**The job to be hired:** let a user with an API key and no install turn
a podcast episode into a diarized transcript inside the capture → claims
pipeline.

## 2. The design in one paragraph

A new extension-side module talks to a transcription provider directly
from the service worker: submit `transcribeSourceUrl(article)` as the
provider's remote-audio URL, poll until done, normalize the response
into the existing `{segments, language, model_info}` contract, and hand
it to the SAME adoption seam the companion result uses
(`adoptDiarizedTranscript`), so the body, the timeMap, the
Media-Fragments claim anchors, the Speakers modal, and the publish path
are all unchanged and untouched. It is a second *source* of a result
object, not a second pipeline. The companion is not replaced: it stays
the local-and-private option and the only path for platform pages whose
media URLs are signed. Selection is explicit rather than magic — the
engine picker gains "AssemblyAI (direct)" alongside the
companion-routed engines, so the user can always see which one ran, and
`extraction-method` keeps naming the engine that actually did the work.

## 3. Guard rails (the mistakes that must not return)

1. **The loopback pin is not loosened — it is bypassed by a different
   module.** `transcriber-client.js` stays pinned to loopback literals
   with its stated invariant intact. Direct-cloud traffic lives in a
   NEW module with its own pinned provider hosts (`api.assemblyai.com`,
   `api.deepgram.com`, https only, no user-configurable host). Do not
   add a "base URL" preference to either module.
2. **One result contract, not two dialects.** The normalizer must
   produce exactly what the companion produces. `providers/normalize.py`
   is the reference; a JS twin that drifts from it is the single most
   likely long-term defect in this design (§7 prices it). Share
   fixtures across both sides or the drift is a matter of time.
3. **Adoption is reused, never reimplemented.** No second body
   composer, no second hash recipe, no second track slot. If the
   direct path needs something the adoption seam cannot express, that
   is a signal to change the seam once, not to fork it.
4. **Honest engine naming survives.** `extractionMethodFor` already
   publishes `<provider>-<model>`; a direct run must name the same
   provider it used. "local" for a cloud run was called a durable lie
   once (JOURNAL 2026-08-02) and that ruling still governs.
5. **The consent sentence changes and must be rewritten, not reused.**
   Today: "the episode audio leaves this machine." There: the audio
   never touches this machine — X-Ray hands a third party a URL and
   they fetch it. That is arguably more privacy-preserving and it is
   definitely a different disclosure. Say the true one.
6. **Keys stay presence-only to pages.** The existing rule holds: the
   SW holds values, pages see booleans, `CREDENTIAL_STORAGE_KEYS`
   governs backup exclusion and erase-all.
7. **No new wire kinds, tags, or values.** The transcript adopts
   through the existing seam; if this proposal finds itself minting a
   tag, something has gone wrong in §2.

## 4. Slices (riskiest value assumption first)

- **DC.1 — AssemblyAI direct, one real episode.** The new module, the
  normalizer, the flag, and picker selection — enough to transcribe a
  capture whose `transcribeSourceUrl` is a direct media file, **with
  the companion service stopped**. Acceptance: the same PowerPress
  episode from the 2026-08-15 walk, transcribed end to end with nothing
  running locally, adopted into the reader.
- **DC.2 — the no-companion state becomes first-class.** Today the UI
  assumes a companion exists: the status panel, the picker's
  availability marks, and several error strings all describe a service.
  Make "no companion installed, direct cloud configured" a coherent,
  self-explaining state rather than a wall of setup errors.
- **DC.3 — Deepgram parity**, if and only if DC.1's criterion is met
  and the API confirms a remote-URL mode.
- **Deferred, not scheduled:** local-file upload direct to a provider;
  any attempt at platform pages (see §8).

## 5. Success criteria (falsifiable, with a check date)

**Check date: 2026-10-01, or the release tag after DC.1 lands,
whichever comes first.** By then: **at least three transcripts produced
with no companion service running**, at least one of them on a machine
where the companion has never been installed, and at least one feeding a
claim or an entity page rather than sitting in the archive.

The "never been installed" clause is the load-bearing half. This
feature's entire thesis is that the install is the cliff; a criterion
satisfiable on the maintainer's already-configured box would confirm
nothing about the thesis.

Non-use at the check date falsifies it.

## 6. Kill criteria

- If, with the direct path available and configured, the maintainer
  keeps reaching for the companion anyway across two consecutive check
  dates — the install was not the friction, and this surface retires.
- If providers cannot fetch a majority of the real episode URLs tried
  (hotlink protection, CDN referer checks, auth walls), the premise
  fails on contact and DC.1 stops rather than growing workarounds. Note
  the 2026-08-15 walk already found a site that 403s non-browser agents
  — the page, not the CDN file, but it is exactly the failure shape to
  watch.
- DC.3 never starts on a failed DC.1.

Kills execute on the record: rationale in `docs/JOURNAL.md`,
git-recoverable, re-arguable on merits (CONSTITUTION Art. 11).

## 7. Costs (maintainer attention — the scope budget)

- ~~**A manifest `host_permissions` entry is a one-way door.**~~
  **CORRECTED 2026-08-15, before DC.1 closed — this bullet was wrong
  and it mispriced the review.** `manifest.json` already declares
  `<all_urls>`, and three of the four third-party hosts the service
  worker fetches today (ar5iv, api.crossref.org, arbitrary image hosts)
  have no manifest entry at all. Adding `https://api.assemblyai.com/*`
  changes the granted host set by ZERO and adds no install-prompt
  warning; it is documentary, kept for the `ROAD_TO_1_0` T5 narrowing
  sweep. The real technical gate is the code-side pinned host constant
  (`tests/provider-host-pin.test.mjs`); the real consent gates are the
  flag and the API key. **The actual one-way door in DC.1 is
  `model_info.provider`** — see the §10 rulings.
- **The second normalizer is permanent carrying surface.** Two
  implementations of one contract, in two languages, maintained
  forever. This is the cost most likely to be underestimated.
- **A new THREAT_MODEL boundary.** The companion rows do not cover
  this: the extension itself now sends a credential and a URL to a
  third-party host.
- Review sessions: one per slice, plus the DC.1 acceptance walk on a
  machine with the companion stopped (~15 min).
- Permanent surfaces added: one feature flag, one module, one
  normalizer, provider host permissions. No wire kinds.

## 8. Non-goals / deferred (one line each)

- **Replacing the companion** — it remains the local, private, no-third-
  party option, and the only path for signed platform media.
- **YouTube and other platform pages** — their media URLs are signed and
  expiring; extracting one is what yt-dlp is for. YouTube already has a
  companion-free path (the built-in caption fetch); the companion is
  only needed there for diarized speaker labels.
- **Local files** — nothing to give a provider a URL for; wave 2 of the
  Transcribe Anywhere plan owns that, and it needs an upload path either
  way.
- **A provider-agnostic abstraction layer** — two providers is not
  enough evidence to design one; write the second concretely and
  extract later if a third arrives.
- **Loosening the loopback pin** — refused, not deferred.
- **Auto-selecting direct-vs-companion** — the user picks; a silent
  router would make "which engine ran, and did my audio leave" unanswerable
  at a glance.

## 9. Wire, schema, and discipline routing

- **Wire format: expected none.** The result adopts through the existing
  seam and `extraction-method` already carries `<provider>-<model>`.
  `ecosystem-pm` confirms at DC.1 rather than taking this line's word.
- **Schema:** one `FLAGS_DEFAULTS` entry; no new credential keys (the
  existing AssemblyAI/Deepgram keys are reused, and must stay inside
  `CREDENTIAL_STORAGE_KEYS`); no IndexedDB change. `schema-evolution`
  confirms.
- **architect:** manifest `host_permissions` is the one-way door here;
  also rules on where the new module sits relative to
  `transcriber-client.js` (sibling, not extension).
- **security-threat-modeler:** required on DC.1 — new network
  destination, credential egress from the SW, and the question of what a
  hostile captured page can influence about the URL submitted.
- **verification-engineer:** this path has no local service to stand up,
  so tests stub `fetch` at the module boundary; owns whether the shared
  normalizer fixtures are the right observer for guard-rail 2.
- **product-manager:** §5 check date enters the sweep; outcome recorded
  in JOURNAL at the date — used / parked / killed.

## 10. Open questions — SETTLED at the DC.1 design review, 2026-08-15

Recorded as rulings. Each was decided before code, most against a
discipline review's written recommendation being unanimous; where two
reviews disagreed, both positions and the resolution are in
`docs/JOURNAL.md`.

- **The published provenance id does not name the transport.** The
  picker id is `assemblyai-direct`; `model_info.provider` is the literal
  `assemblyai`. This is DC.1's one irreversible decision: the value
  reaches `diarizedHeading()` and therefore the hashed body, so a
  transport-suffixed id would fork the `x` content address of every
  direct transcript from its companion twin for the same audio.
- **`transcribeSourceUrl` is NOT inverted** (question 1 below). Changing
  it would re-key every in-flight job record via `media-key.js` and
  break resume, and would extend the page-chooses-the-URL surface to the
  eight platforms that currently escape it. Instead the direct submit
  shows a confirm dialog with the exact URL and host whenever the
  submitted address differs from the page URL.
- **Provider-cannot-fetch reports and stops** (question 2 below). No
  fallback to the companion, silent or otherwise — a fallback would
  convert the evidence kill criterion 2 depends on into a success, and
  would make "which engine ran" unanswerable at a glance. The
  provider's own error text surfaces verbatim.
- **Cost says "unknown" without a duration** (question 3 below). There
  is no probe on this path because nothing is downloaded; the picker
  already had honest wording for unknown-duration media and gained a
  direct-path variant that does not name the companion.
- **Companion vocabulary stays as-is in DC.1** (question 4 below),
  deferred to DC.2. DC.1's only obligation: no direct-path string
  contains "not reachable" (which makes the reader attach companion
  setup advice) or instructs the user to install or start a companion —
  machine-checked in `tests/engine-vocabulary.test.mjs`.
- **The direct engine is picker-only** (a scope cut, not in the original
  questions). It is never written to `xray:transcriber:engine`, because
  `normalizeEngine` would collapse it to `'local'` and Options would
  re-persist that. Cost: no "set direct as my default" until DC.2.

The original questions, kept for the record:

- Which URL to submit when a page yields both a direct file and a
  platform identity — today `transcribeSourceUrl` prefers the page URL
  for known platforms, and that rule was written for a downloader that
  could resolve them. A provider that cannot resolve pages may want the
  opposite preference.
- What to do when the provider cannot fetch the URL (hotlink
  protection, referer checks). Fall back to the companion when one is
  running? Report and stop? Falling back silently would undermine the
  "which engine ran" clarity of §2.
- Whether cost estimation is still honest without a duration. The
  companion probes duration; a direct submit does not know it, and
  providers meter per audio-hour. Saying "unknown" may be the only
  honest answer, as it already is for unknown-duration media.
- Whether DC.2 should let a user run X-Ray transcription having never
  seen the word "companion" — i.e. how much of the existing service
  vocabulary should become conditional UI.
