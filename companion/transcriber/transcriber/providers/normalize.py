"""Pure normalization shared by the cloud providers.

Turns provider-flavored utterances into the local result's segment
shape: {start, end, speaker, text} — seconds rounded to 3 decimals,
speaker a stable SPEAKER_NN label (or None), text stripped.  The
extension's speakerDisplayMap maps ANY distinct raw labels to
"Speaker N" by first appearance, so all that matters here is that
labels are DISTINCT and STABLE; SPEAKER_NN matches the local
pyannote form so downstream treatment is byte-identical.

Long speaker turns are SPLIT into sentence-ish segments using the
per-word timestamps: the extension's mergeTurns never breaks inside a
single segment, so an unsplit five-minute monologue would become one
giant paragraph with one coarse t=start,end provenance range.  The
split restores the local path's sentence granularity.

No I/O, no provider imports — everything here is unit-testable with
plain dicts.
"""

# A segment never grows past this once a sentence boundary or speaker
# change offers a break. Matches Whisper's practical segment ceiling.
MAX_SEGMENT_S = 30.0

_SENTENCE_END = (".", "!", "?", '."', '!"', '?"', ".'", "!'", "?'", ".)", "!)", "?)")


def speaker_label(index: int) -> str:
    """SPEAKER_00-style label for a first-appearance index."""
    return f"SPEAKER_{index:02d}"


def stable_speaker_labels(raw_labels) -> dict:
    """Map raw provider labels (A/B, 0/1, ...) to SPEAKER_NN.

    First-appearance order over the given iterable; None/empty entries
    are skipped (an unlabelled utterance stays unlabelled — never
    invent a speaker).  Raw labels are keyed by str() so AssemblyAI's
    "A" and Deepgram's integer 0 both work.
    """
    mapping: "dict[str, str]" = {}
    for raw in raw_labels:
        if raw is None or raw == "":
            continue
        key = str(raw)
        if key not in mapping:
            mapping[key] = speaker_label(len(mapping))
    return mapping


def normalize_language(code, fallback: str = "en") -> str:
    """Provider language codes -> the primary subtag Whisper emits.

    AssemblyAI returns forms like "en_us"; Intl.DisplayNames on the
    extension side chokes on underscores, so reduce to the primary
    subtag ("en").  Hyphenated BCP-47 forms reduce the same way.
    """
    s = str(code or "").strip().lower()
    if not s:
        return fallback
    return s.replace("_", "-").split("-")[0] or fallback


def _ends_sentence(text: str) -> bool:
    return text.endswith(_SENTENCE_END)


def split_words_into_segments(words, max_s: float = MAX_SEGMENT_S) -> list:
    """Word timings -> sentence-ish {start, end, text} segments.

    ``words`` is a list of {"text", "start", "end"} in SECONDS (callers
    map provider shapes to this first).  Breaks after a word that ends
    a sentence, or hard-breaks when the running segment exceeds
    ``max_s`` — so a five-minute monologue yields many tightly-timed
    segments instead of one.  Words with missing timing inherit the
    running segment's bounds; a sentence made ENTIRELY of untimed
    words is never dropped — its text carries into the next timed
    segment (transcript text loss would be silent and canonical).
    """
    segments = []
    cur_words: "list[str]" = []
    cur_start = cur_end = None

    def flush() -> None:
        nonlocal cur_words, cur_start, cur_end
        text = " ".join(w for w in cur_words if w).strip()
        if not text:
            cur_words, cur_start, cur_end = [], None, None
            return
        if cur_start is None:
            return  # no timing yet — keep accumulating into the next piece
        segments.append(
            {
                "start": round(float(cur_start), 3),
                "end": round(float(cur_end if cur_end is not None else cur_start), 3),
                "text": text,
            }
        )
        cur_words, cur_start, cur_end = [], None, None

    for w in words or []:
        text = str((w or {}).get("text") or "").strip()
        if not text:
            continue
        start = w.get("start")
        end = w.get("end")
        if cur_start is None and start is not None:
            cur_start = start
        if end is not None:
            cur_end = end
        elif start is not None:
            cur_end = max(cur_end or 0, start)
        cur_words.append(text)
        duration = (cur_end - cur_start) if (cur_start is not None and cur_end is not None) else 0.0
        if _ends_sentence(text) or duration >= max_s:
            flush()
    flush()
    return segments


def utterances_to_segments(utterances, max_s: float = MAX_SEGMENT_S) -> list:
    """Provider utterances -> the result's segments array.

    ``utterances`` is the COMMON shape both providers are mapped to
    before calling: {"speaker": raw-or-None, "start", "end" (seconds),
    "text", "words": [{"text", "start", "end"}, ...] or []}.  Speaker
    labels are remapped to SPEAKER_NN by first appearance ACROSS the
    whole list; utterances without word timings stay whole.
    """
    labels = stable_speaker_labels(u.get("speaker") for u in utterances or [])
    segments = []
    for u in utterances or []:
        raw = u.get("speaker")
        speaker = labels.get(str(raw)) if raw is not None and raw != "" else None
        pieces = split_words_into_segments(u.get("words") or [], max_s=max_s)
        if not pieces:
            text = str(u.get("text") or "").strip()
            if not text or u.get("start") is None:
                continue
            end = u.get("end") if u.get("end") is not None else u.get("start")
            pieces = [
                {
                    "start": round(float(u["start"]), 3),
                    "end": round(float(end), 3),
                    "text": text,
                }
            ]
        for p in pieces:
            segments.append({**p, "speaker": speaker})
    # The result contract orders keys start/end/speaker/text; dict key
    # order is cosmetic in JSON but keep it tidy for humans diffing
    # jobs/<id>.json against the local pipeline's output.
    return [
        {"start": s["start"], "end": s["end"], "speaker": s["speaker"], "text": s["text"]}
        for s in segments
    ]
