from __future__ import annotations

from orchestrator.env_guard import enforce_python

enforce_python()

import json
from pathlib import Path

from .utils import ensure_dir


def save_playability_report(report: dict, path: str) -> None:
    destination = Path(path)
    ensure_dir(destination.parent)
    destination.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")