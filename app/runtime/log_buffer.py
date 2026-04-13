"""Thread-safe in-memory log buffer for runtime stdout/stderr."""
from __future__ import annotations

import threading
import time
from collections import deque

from .log_sanitizer import sanitize_log_text


class LogBuffer:
    def __init__(self, *, max_lines: int = 400) -> None:
        self._entries: deque[tuple[float, str, str]] = deque(maxlen=max_lines)
        self._lock = threading.Lock()

    def append(self, source: str, line: str) -> None:
        text = sanitize_log_text(line.rstrip())
        if not text:
            return
        now = time.time()
        stamp = time.strftime("%H:%M:%S", time.localtime(now))
        with self._lock:
            self._entries.append((now, source, f"[{stamp}] {source}: {text}"))

    def snapshot(self, *, limit: int = 200) -> tuple[str, ...]:
        with self._lock:
            if limit <= 0:
                return tuple(entry[2] for entry in self._entries)
            return tuple(entry[2] for entry in list(self._entries)[-limit:])

    def clear(self) -> None:
        with self._lock:
            self._entries.clear()

    def count_recent(self, source: str, *, window_seconds: float = 300.0) -> int:
        cutoff = time.time() - window_seconds
        with self._lock:
            return sum(1 for ts, entry_source, _ in self._entries if entry_source == source and ts >= cutoff)

    def recent_lines(
        self,
        *,
        source: str | None = None,
        window_seconds: float = 300.0,
        limit: int = 50,
    ) -> tuple[str, ...]:
        cutoff = time.time() - window_seconds
        with self._lock:
            filtered = [
                rendered
                for ts, entry_source, rendered in self._entries
                if ts >= cutoff and (source is None or entry_source == source)
            ]
        if limit <= 0:
            return tuple(filtered)
        return tuple(filtered[-limit:])
