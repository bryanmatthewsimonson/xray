# Transcribe Anywhere — generalize the media transcribe funnel (kickoff)

**Status: PROPOSED 2026-08-12 — design approved in maintainer
dialogue; ratification is the maintainer's merge (Art. 11).**
Drafted from a brainstorming dialogue with the maintainer
(2026-08-12) over a six-surface code map (companion contract,
extension flow, capture surfaces, Phases 21/22, docs history,
flags/settings). The maintainer's recorded choices: the pull is
every non-YouTube media class at once (podcasts, alt video, social
video, local files, long-tail sites — Mormon Stories named); slice 1
targets a real Mormon Stories episode page; both entry points
(capture-first and paste-a-URL) ship in wave 1; architecture is the
yt-dlp-resolver funnel, staged (Approach A), over extension-resolved
media URLs (rejected: signed/expiring IG/FB URLs, re-implements
yt-dlp badly) and an everything-at-once wave (rejected: triples the
walk burden; local files don't serve slice 1).

Related: `companion/transcriber/README.md` (the service this
widens), `docs/ROADMAP.md` Phases 21–22 (the manual transcript layer
this completes), `docs/THREAT_MODEL.md` B9/B10 (the boundary rows
TA.1 must update), `docs/JOURNAL.md` 2026-07-15 → 2026-08-08 (the
transcribe design rulings this inherits), `docs/ROAD_TO_1_0.md` B11
/ T4 / T5 (the open items this touches).

## 1. Diagnosis — the pipeline is generic; the gates are not

When casework hits spoken-word evidence anywhere other than YouTube
— podcast episodes, Rumble/Vimeo/X video, TikTok/IG/FB video,
long-tail sites with embedded players (the live pull: Mormon Stories
episode pages), recordings on disk — X-Ray cannot produce a diarized
transcript into the capture → claims pipeline. The evidence stays
outside the corpus, or enters only through the Phase-21/22 manual
path when a transcript already exists somewhere else.

The code map shows the restriction is gating, not machinery:

- The companion's downloader is yt-dlp called generically
  (`download.py` `ydl.extract_info(url)`); the only server-side
  restriction is the URL validator — https + YouTube host allowlist
  + video-id regex (`server.py:103-137`). Everything downstream
  (bestaudio → WhisperX/pyannote or cloud engines, progress, the
  worker child protocol) is source-agnostic.
- Extension-side, the composition core is already shared and
  neutral: `mergeTurns`/`buildTranscriptSection` serve both the
  diarized path and Phase-21 podcast import; the timeMap, the
  W3C Media-Fragments claim anchors, the engine picker, the resume
  state machine, and the publish path carry nothing YouTube-shaped.
  The coupling is five gates — context-menu `documentUrlPatterns`
  (`background/index.js:124-127`), the reader button's
  platform==='youtube' check (`reader/index.js:2398-2400`), the
  `runTranscribeFlow` guard, the `adoptDiarizedTranscript` guard +
  `a.youtube.transcripts` track slot, and the videoId-keyed job
  record (`transcribe-flow.js` `jobRecordKey`).
- Phases 21/22 already built the landing seam for non-YouTube
  transcripts — media/podcast identity tags, transcript attach, one
  shared hash recipe (`transcript-article.js:274-281`) — but only
  for transcripts the user already has. No audio-URL discovery
  exists anywhere (`readFeedXml` deliberately skips `<enclosure>`,
  `podcast-identity.js`).

So this wave is mostly *un-gating*: widen the input contract,
generalize job identity, and let the existing pipeline do what it
already does.

## 2. The design in one paragraph

The companion accepts any **https, public-host URL** — page URL or
direct media URL — and yt-dlp resolves it, exactly the pattern
YouTube uses today (we already send the watch *page* URL). The
validator's replacement enforces https-only, no embedded
credentials, and hostname resolution to public unicast addresses
(deny loopback/private/link-local, mirroring the extension's SSRF
pin in `podcast-identity.js`); yt-dlp finding no media fails the job
with a named error. Job identity generalizes from videoId to a
`media_key` (YouTube videoId when the URL is YouTube — preserving
existing resume records and dedupe — else a hash of the normalized
URL), advertised via a `/health` `generic_urls` capability flag on
the established `request_provider` pattern, with older companions
refused client-side, fix named. Extension-side the five gates become
media-signal gates, adoption goes platform-neutral (a neutral
`article.transcripts` track slot with read-side fallback to
`a.youtube.transcripts`; the "## Description — YouTube" rename and
`&t=Ns` link form apply only on YouTube, everything else uses the
existing generic `<url>#t=<s>` fallback), and two entry points ship:
capture-first (reader Transcribe button on media signals, plus a
"Transcribe from source" action in the 🎙 Media & source modal on
*every* capture as the zero-noise escape hatch) and a portal
"Transcribe a URL" panel beside the Phase-21 import that creates a
transcript-canonical article bound to the active case. Zero wire
changes; local files follow in wave 2 via an upload endpoint, only
after wave 1's success criterion is met.

## 3. Guard rails (the mistakes that must not return)

1. **The loopback pin is untouchable.** Both client base URLs stay
   pinned to loopback literals; only port/path configurable
   (`transcriber-client.js:1-16`). No new remote fetch target for
   transcript text, ever.
2. **Wire format: none.** The `media` whitelist stays exactly
   `podcast`|`video` (`event-builder.js:374-376`); time provenance
   keeps riding the existing anchor tag as Media-Fragments
   selectors; `extraction-method` keeps naming the real engine. The
   diarized-wire guard test must stay green with no new tag names.
3. **The absent-companion degradation contract is tested, not
   aspirational.** Flag off → no surface exists. Companion absent →
   `{ok:false, unreachable}` with the fix named. Old companion +
   non-YouTube URL → refused client-side ("update the companion"),
   never a silent server 400 — the request_provider precedent.
4. **Media identity is user-declared.** yt-dlp probe metadata may
   *prefill* the Media modal; nothing writes until Save. The
   discovery-vs-declaration line (the recorded JOURNAL rulings on
   media identity) holds for every new source.
5. **Honest engine labeling** — the transcript heading and
   extraction-method name the engine that actually ran; an explicit
   "Local" choice is refused rather than silently cloud-routed.
6. **One hash recipe.** The portal paste-URL panel reuses
   `computeTranscriptArticleHash` and the Phase-21 article builder —
   no forked producer.
7. **Adoption safety.** Re-hash honestly, invalidate stale timeMaps,
   refuse (never overwrite) when the capture changed mid-job — and
   respect the bare vs suffixed `## Transcript` heading dichotomy so
   the attach upsert can never clobber a diarized section. The
   applyMediaResult empty-body near-miss (JOURNAL) is the recorded
   hazard at exactly this seam.
8. **MV3 topology unchanged** — page-driven job loop, one short
   `xray:transcribe:*` message per poll, fetches in the SW only.
9. **Key hygiene unchanged** — any future engine credential joins
   the `CREDENTIAL_STORAGE_KEYS` class; presence-only booleans to
   pages; erase-all and backup exclusion keep holding.
10. **SSRF honesty.** The public-address gate is best-effort (yt-dlp
    follows redirects and re-resolves DNS; rebinding is not fully
    closed). The THREAT_MODEL rows state the residual risk plainly:
    blind SSRF, bounded by loopback-only + extension-origin CORS +
    optional token + user-chosen URLs. No pretending it's zero.

## 4. Slices (riskiest value assumption first)

**Wave 1 — the URL funnel.**

- **TA.1 — companion generic URLs + minimal reader path.** The new
  URL gate, `media_key` identity/dedupe, `/health generic_urls`,
  client capability refusal, platform-neutral adoption (neutral
  track slot, per-platform heading/link transforms), and the Media &
  source modal's "Transcribe from source" action on any capture.
  THREAT_MODEL B9/B10 updates ride this PR. **Acceptance walk: a
  real Mormon Stories episode page → diarized transcript adopted in
  the reader.**
- **TA.2 — discoverability.** Capture-time `mediaHints` (local-only:
  audio/video elements, known embed iframes), reader button gating
  on media signals (contentType video / declared media / hints),
  context-menu widening to all http(s) pages, cost-estimate
  neutrality (platform duration when known, otherwise "duration
  checked by the companion — 4 h cap", no fake numbers).
- **TA.3 — portal "Transcribe a URL".** Beside the Phase-21 import
  panel; creates a transcript-canonical article (same builder, same
  hash recipe) with the pasted URL as identity, active-case binding,
  prefill-only media identity.
- **TA.4 — verification & consent sweep.** SMOKE_TEST rows for the
  diarized flow, engine picker, and Speakers modal (existing debt —
  these surfaces have no rows at all) plus a Transcribe-Anywhere
  row; the USER_GUIDE flag-table entry for `localTranscription`
  (closes its share of B11); README scope + CAPTURE_GUIDE updates.

**Wave 2 — local files (gated on §5).** TA.5: multipart upload
endpoint on the companion, portal file picker beside TA.3,
timestamps degrade to plain text (no URL to fragment-link). Starts
only after wave 1's success criterion is met — dogfood before
deepen.

**Wave 3 — pull-driven polish (may never happen).** RSS enclosure
prefill in Find-identity, cookies-file UX for anti-bot sites,
per-platform social-video polish. Each item waits for a recorded
casework pull.

## 5. Success criteria (falsifiable, with check date)

**Check date: 2026-09-15, or the next release tag, whichever comes
first.** By then, real casework has produced **at least three
diarized transcripts from non-YouTube sources, at least one of them
a Mormon Stories episode, feeding claims or entity pages.** Non-use
at the check date falsifies the wave. The acceptance walk (TA.1's
Mormon Stories walk) proves it works; only casework pull proves it
was worth building — never conflate them.

## 6. Kill criteria

If no non-YouTube transcript feeds any case across two consecutive
check dates, the added surfaces retire — the portal paste-URL panel
first, then TA.2's discoverability gating (the Media-modal action
and the widened companion gate may stay if genuinely zero-carry).
Wave 2 never starts on a failed wave 1. Kills execute on the record:
JOURNAL rationale, git-recoverable, re-arguable (Art. 11).

## 7. Costs (maintainer attention — the scope budget)

- TA.1: one review session + the ~15-minute Mormon Stories walk +
  THREAT_MODEL row sign-off. The companion needs a version bump and
  a `uv sync` on the maintainer's machine.
- TA.2/TA.3: one review session each; TA.3 adds a ~5-minute
  paste-URL walk.
- TA.4: one review session; the smoke rows repay debt this wave
  would otherwise inherit silently.
- Wave 2 (TA.5): one review + one local-file walk — only after the
  §5 criterion is met.
- Permanent carrying surface added: one companion capability flag,
  one portal panel, zero wire kinds, zero new feature flags.

## 8. Non-goals / deferred (one line each)

- **Live streams** — companion refuses them today; unchanged.
- **Auto-transcription on capture** — always user-initiated; cost
  and audio-leaves-machine consent stay per-job decisions.
- **Transcript translation** — no casework pull recorded.
- **Speaker identification beyond voice→entity binding** — the
  existing mechanism already generalizes; nothing new.
- **Relaxing the loopback pin or cloud-fetching audio server-side**
  — refused, not deferred; cloud engines keep receiving only
  locally-downloaded audio.
- **RSS enclosure discovery** — wave 3, behind a recorded pull;
  `readFeedXml`'s enclosure skip stands until then.
- **A new feature flag** — `localTranscription` remains the gate;
  its Options copy generalizes to "media captures".

## 9. Wire, schema, and discipline routing

- **Wire format: none.** No new kinds, tags, or values; ecosystem-pm
  reviews the TA.1/TA.3 PRs to certify the callout.
- **Schema (schema-evolution review, same PRs):** job-record key
  `xray:transcribe:job:<mediaKey>` (YouTube records unchanged —
  videoId *is* their mediaKey); neutral `article.transcripts` slot
  with read-side fallback to `a.youtube.transcripts` for existing
  archives; `a.transcription` cache re-key. No DB_VERSION bump, no
  backup-format change.
- **security-threat-modeler:** required on TA.1 (a loopback service
  shelling out to yt-dlp now accepts arbitrary user-designated
  URLs); the §3.10 residual-risk wording is the review's anchor.
- **architect:** no new kinds, storage namespaces, manifest
  permissions, or `xray:*` message types — TA.3 reuses
  `xray:transcribe:start`. Reversibility: everything here is
  two-way-door except the companion's public URL gate semantics,
  which the capability flag versions.
- **verification-engineer:** owns the TA.4 smoke rows and the walk
  ledger entries; the companion pytest CI gap (T4) stays a separate
  1.0 item, not absorbed here.
- **product-manager:** the §5 check date enters the sweep; outcome
  recorded in JOURNAL at the check date — used / parked / killed.

## 10. Open questions (settled at implementation review, not here)

- Exact `media_key` URL normalization (strip tracking params?
  lowercase host only?) — settle in TA.1 with tests, mindful that
  over-normalization merges distinct episodes and under-
  normalization forks resume records.
- Windows specifics of the public-address resolve check
  (getaddrinfo timing, IPv6 handling) — TA.1 pytest territory.
- Whether TikTok/IG/FB need the cookies-file posture documented on
  day one or only when a walk hits anti-bot friction — TA.2.
- Where the TA.3 panel surfaces errors for long-running jobs when
  the portal tab closes (job records already survive; the resume
  UX may need a portal affordance) — TA.3.
