"""Diagnostics helpers for elevation and window focus tracking."""
from __future__ import annotations

import ctypes
import getpass
import os
import sys
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

try:
    import psutil
except ImportError:  # pragma: no cover - optional dependency
    psutil = None  # type: ignore[assignment]

from .artifacts import iso_timestamp

if os.name == "nt":  # pragma: no cover - Windows-specific APIs
    import ctypes.wintypes as wintypes

    _user32 = ctypes.windll.user32
else:  # pragma: no cover - non-Windows fallback
    wintypes = None  # type: ignore[assignment]
    _user32 = None  # type: ignore[assignment]


def is_process_elevated() -> bool:
    if os.name != "nt":  # pragma: no cover - Windows only check
        return False
    try:
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:  # noqa: BLE001
        return False


def collect_environment_snapshot() -> Dict[str, Any]:
    exe_path = Path(sys.executable) if sys.executable else Path("python.exe")
    return {
        "pid": os.getpid(),
        "process_name": exe_path.name,
        "exe_path": str(exe_path),
        "cwd": os.getcwd(),
        "username": getpass.getuser(),
        "is_elevated": is_process_elevated(),
    }


@dataclass
class FocusTransition:
    ts: str
    pid: Optional[int]
    title: str
    exe: str
    is_target: bool
    reason: str


@dataclass
class FocusSummary:
    supported: bool
    target_focus_seconds: float = 0.0
    non_target_focus_seconds: float = 0.0
    transitions: List[FocusTransition] = field(default_factory=list)
    last_foreground: Optional[Dict[str, Any]] = None

    def as_dict(self) -> Dict[str, Any]:
        return {
            "supported": self.supported,
            "target_focus_seconds": round(self.target_focus_seconds, 2),
            "non_target_focus_seconds": round(self.non_target_focus_seconds, 2),
            "transitions": [transition.__dict__ for transition in self.transitions],
            "last_foreground": self.last_foreground,
        }


class FocusTracker:
    """Background watchdog that records foreground window transitions."""

    def __init__(
        self,
        *,
        target_exe: str,
        log_callback: Optional[Callable[[str, Dict[str, Any]], None]] = None,
        poll_interval: float = 0.5,
        max_transitions: int = 100,
    ) -> None:
        self._supported = os.name == "nt"
        self._target_exe = Path(target_exe).name.lower() if target_exe else ""
        self._target_pid: Optional[int] = None
        self._log_callback = log_callback
        self._poll_interval = poll_interval
        self._max_transitions = max_transitions
        self._thread: Optional[threading.Thread] = None
        self._running = False
        self._lock = threading.Lock()
        self._summary = FocusSummary(supported=self._supported)
        self._last_seen_state: Optional[str] = None
        self._last_seen_ts = time.monotonic()

    def start(self) -> None:
        if not self._supported or self._running:
            return
        self._running = True
        self._thread = threading.Thread(target=self._loop, name="FocusTracker", daemon=True)
        self._thread.start()

    def stop(self) -> FocusSummary:
        if not self._supported:
            return self._summary
        self._running = False
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=1.5)
        return self._summary

    def snapshot(self) -> FocusSummary:
        with self._lock:
            transitions = list(self._summary.transitions)
            last = self._summary.last_foreground.copy() if isinstance(self._summary.last_foreground, dict) else self._summary.last_foreground
        return FocusSummary(
            supported=self._summary.supported,
            target_focus_seconds=self._summary.target_focus_seconds,
            non_target_focus_seconds=self._summary.non_target_focus_seconds,
            transitions=transitions,
            last_foreground=last,
        )

    def update_target(self, pid: Optional[int], exe_path: Optional[str]) -> None:
        self._target_pid = pid
        if exe_path:
            self._target_exe = Path(exe_path).name.lower()

    # -----------------
    # Internal helpers
    # -----------------
    def _loop(self) -> None:
        while self._running:
            info = self._foreground_info()
            now = time.monotonic()
            if info is not None:
                state = "target" if self._is_target(info) else "other"
                self._record_duration(state, now)
                if self._should_record_transition(info):
                    self._record_transition(info, state)
            time.sleep(self._poll_interval)

    def _foreground_info(self) -> Optional[Dict[str, Any]]:
        if not self._supported or not _user32:
            return None
        hwnd = _user32.GetForegroundWindow()
        if hwnd == 0:
            return None
        pid = wintypes.DWORD()  # type: ignore[call-arg]
        _user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        length = _user32.GetWindowTextLengthW(hwnd)
        buffer = ctypes.create_unicode_buffer(length + 1)
        _user32.GetWindowTextW(hwnd, buffer, length + 1)
        exe = ""
        title = buffer.value.strip()
        name = ""
        if psutil is not None:  # type: ignore[truthy-bool]
            try:
                proc = psutil.Process(pid.value)
                exe = proc.exe() or ""
                name = proc.name() or ""
            except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.Error):
                pass
        return {
            "pid": pid.value,
            "hwnd": int(hwnd),
            "title": title or "(untitled)",
            "exe": exe,
            "process_name": name,
        }

    def _is_target(self, info: Dict[str, Any]) -> bool:
        if self._target_pid and info.get("pid") == self._target_pid:
            return True
        if not self._target_exe:
            return False
        exe_name = Path(info.get("exe") or "").name.lower()
        return exe_name == self._target_exe

    def _record_duration(self, state: str, now: float) -> None:
        if self._last_seen_ts is None:
            self._last_seen_ts = now
        delta = max(0.0, now - self._last_seen_ts)
        with self._lock:
            if self._last_seen_state == "target":
                self._summary.target_focus_seconds += delta
            elif self._last_seen_state == "other":
                self._summary.non_target_focus_seconds += delta
            self._last_seen_state = state
        self._last_seen_ts = now

    def _should_record_transition(self, info: Dict[str, Any]) -> bool:
        last = self._summary.last_foreground
        return not last or last.get("pid") != info.get("pid") or last.get("title") != info.get("title")

    def _record_transition(self, info: Dict[str, Any], state: str) -> None:
        entry = FocusTransition(
            ts=iso_timestamp(),
            pid=info.get("pid"),
            title=info.get("title", ""),
            exe=info.get("exe", ""),
            is_target=state == "target",
            reason="target_focus" if state == "target" else "focus_shift",
        )
        with self._lock:
            self._summary.transitions.append(entry)
            if len(self._summary.transitions) > self._max_transitions:
                self._summary.transitions.pop(0)
            self._summary.last_foreground = {
                "pid": info.get("pid"),
                "title": info.get("title"),
                "exe": info.get("exe"),
                "process_name": info.get("process_name"),
                "is_target": entry.is_target,
            }
        if self._log_callback:
            payload = {
                "pid": entry.pid,
                "title": entry.title,
                "exe": entry.exe,
                "is_target": entry.is_target,
                "reason": entry.reason,
            }
            self._log_callback("focus_transition", payload)
