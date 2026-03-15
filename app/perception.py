"""Perception interfaces for AI-E."""
from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from .artifacts import ScreenshotResult, iso_timestamp, take_screenshot


@dataclass
class PerceptionFrame:
    """Immutable description of a captured frame."""

    label: str
    timestamp: str
    screenshot: ScreenshotResult
    frame_hash: Optional[str]

    def as_dict(self) -> dict[str, object]:
        payload: dict[str, object] = {
            "label": self.label,
            "timestamp": self.timestamp,
            "status": self.screenshot.status,
        }
        if self.screenshot.path:
            payload["path"] = str(self.screenshot.path)
        if self.frame_hash:
            payload["hash"] = self.frame_hash
        if self.screenshot.reason:
            payload["reason"] = self.screenshot.reason
        return payload


@dataclass
class MovementDelta:
    """Simple movement detection result comparing consecutive frames."""

    label: str
    timestamp: str
    changed: bool
    status: str
    reason: Optional[str] = None

    def as_dict(self) -> dict[str, object]:
        payload: dict[str, object] = {
            "label": self.label,
            "timestamp": self.timestamp,
            "changed": self.changed,
            "status": self.status,
        }
        if self.reason:
            payload["reason"] = self.reason
        return payload


class BasePerceptionAdapter:
    """Common helpers for window-bound perception adapters."""

    name = "base"

    def __init__(self) -> None:
        self._target_exe: str = ""

    def bind_target(self, exe_path: str) -> None:
        self._target_exe = Path(exe_path).name.lower() if exe_path else ""

    def capture_frame(self, run_dir: Path, label: str) -> PerceptionFrame:  # pragma: no cover - interface hook
        raise NotImplementedError

    def detect_delta(self, previous: Optional[PerceptionFrame], current: PerceptionFrame) -> MovementDelta:
        if previous is None:
            return MovementDelta(
                label=current.label,
                timestamp=current.timestamp,
                changed=False,
                status="baseline",
                reason="first frame captured",
            )
        if previous.frame_hash is None or current.frame_hash is None:
            return MovementDelta(
                label=current.label,
                timestamp=current.timestamp,
                changed=True,
                status="unknown",
                reason="insufficient frame data",
            )
        changed = previous.frame_hash != current.frame_hash
        status = "delta" if changed else "steady"
        return MovementDelta(label=current.label, timestamp=current.timestamp, changed=changed, status=status)

    def describe(self) -> str:
        return self.name


class UnityWindowPerception(BasePerceptionAdapter):
    """Default perception adapter for Unity-based windows."""

    name = "unity_window_perception"

    def capture_frame(self, run_dir: Path, label: str) -> PerceptionFrame:
        if not self._target_exe:
            screenshot = ScreenshotResult(label=label, path=None, status="no_data", reason="perception_target_missing")
            return PerceptionFrame(label=label, timestamp=iso_timestamp(), screenshot=screenshot, frame_hash=None)
        screenshot = take_screenshot(run_dir, label)
        frame_hash = self._hash_path(screenshot.path) if screenshot.path else None
        return PerceptionFrame(label=label, timestamp=iso_timestamp(), screenshot=screenshot, frame_hash=frame_hash)

    @staticmethod
    def _hash_path(path: Path) -> Optional[str]:
        try:
            data = path.read_bytes()
        except (OSError, AttributeError):
            return None
        return hashlib.sha256(data).hexdigest()
