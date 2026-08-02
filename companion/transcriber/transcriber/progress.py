"""Wall-clock progress estimation for blocking stages.

Extracted from pipeline.py so the cloud providers can reuse it (the
Deepgram request and the WhisperX transcribe call are both opaque
blocking operations with no progress callback).  Stdlib only.
"""

import threading
import time
from typing import Callable

Emit = Callable[[dict], None]


class ProgressTicker:
    """Emits wall-clock-estimated progress for a blocking stage.

    Estimate: elapsed wall clock over an expected runtime, mapped into
    the [lo, hi] band and capped at hi.
    """

    def __init__(
        self,
        emit: Emit,
        stage: str,
        lo: float,
        hi: float,
        estimate_s: float,
        interval_s: float = 2.0,
    ) -> None:
        self._emit = emit
        self._stage = stage
        self._lo = lo
        self._hi = hi
        self._estimate_s = max(estimate_s, 1.0)
        self._interval_s = interval_s
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._t0 = 0.0

    def start(self) -> None:
        self._t0 = time.monotonic()
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self._thread.join(timeout=5.0)

    def _loop(self) -> None:
        while not self._stop.wait(self._interval_s):
            frac = min((time.monotonic() - self._t0) / self._estimate_s, 1.0)
            progress = self._lo + (self._hi - self._lo) * frac
            self._emit({"stage": self._stage, "progress": round(progress, 4)})
