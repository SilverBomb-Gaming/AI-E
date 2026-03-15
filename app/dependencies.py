"""Runtime dependency health checks for AI-E."""
from __future__ import annotations

from dataclasses import dataclass
from importlib.util import find_spec
from typing import List


@dataclass
class DependencyStatus:
    name: str
    module: str
    purpose: str
    install_hint: str
    available: bool


_OPTIONAL_DEPENDENCIES = (
    ("psutil", "psutil", "Process attach and diagnostics", "pip install psutil"),
    ("mss", "mss", "Screenshot capture", "pip install mss"),
    ("pynput", "pynput", "Keyboard/mouse capture & push-to-talk", "pip install pynput"),
    ("sounddevice", "sounddevice", "Microphone recording", "pip install sounddevice"),
)


def check_dependencies() -> List[DependencyStatus]:
    statuses: List[DependencyStatus] = []
    for label, module, purpose, hint in _OPTIONAL_DEPENDENCIES:
        available = find_spec(module) is not None
        statuses.append(
            DependencyStatus(
                name=label,
                module=module,
                purpose=purpose,
                install_hint=hint,
                available=available,
            ),
        )
    return statuses


def dependency_warnings() -> List[str]:
    warnings: List[str] = []
    for status in check_dependencies():
        if not status.available:
            warnings.append(f"{status.name}: {status.purpose}. Install via {status.install_hint}.")
    return warnings


def dependency_summary_text() -> str:
    missing = dependency_warnings()
    if not missing:
        return "All optional capture dependencies available."
    return "\n".join(missing)
